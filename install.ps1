#Requires -Version 5.1
<#
.SYNOPSIS
  NESIX installer cho Windows.

.DESCRIPTION
  Tải release mới nhất từ GitHub, kiểm tra SHA256, cài vào %LOCALAPPDATA%\Nesix,
  cài dependency và tạo lệnh `nesix`.

  Chạy nhanh:
    irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1 | iex

  Cài bản cụ thể:
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1))) -Version 1.2.0

  Gỡ:
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1))) -Uninstall

.PARAMETER Version
  Version cần cài, ví dụ 1.2.0. Bỏ trống = bản mới nhất.

.PARAMETER Dir
  Thư mục cài. Mặc định %LOCALAPPDATA%\Nesix.

.PARAMETER ZipPath
  Cài từ file zip có sẵn (offline / test). Bỏ qua bước tải release.

.PARAMETER NoPath
  Không thêm thư mục bin vào PATH người dùng.

.PARAMETER InstallNode
  Tự đồng ý cài Node.js LTS qua winget khi máy chưa có Node >= 18.

.PARAMETER NoNodeCheck
  Bỏ qua kiểm tra Node.js (dùng khi đã chắc chắn có Node).

.PARAMETER Uninstall
  Gỡ NESIX. Mặc định giữ config token, thêm -Purge để xoá luôn.

.PARAMETER Purge
  Khi gỡ: xoá cả %APPDATA%\discord-nesix và %TEMP%\nesix-games.

.PARAMETER Force
  Không hỏi xác nhận, ghi đè thư mục không phải bản cài NESIX.

.PARAMETER SkipDoctor
  Không chạy --doctor sau khi cài.

.EXAMPLE
  irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1 | iex

.EXAMPLE
  .\install.ps1 -Version 1.2.0 -Dir D:\Tools\Nesix -NoPath
#>
# Không dùng param() ở đây: `irm ... | iex` không chấp nhận khối param ở đầu.
# Tham số được parse thủ công để hỗ trợ cả ba cách chạy:
#   .\install.ps1 -NoPath
#   irm .../install.ps1 | iex
#   & ([scriptblock]::Create((irm .../install.ps1))) -Version 1.2.0
$Version = ''
$Dir = ''
$ZipPath = ''
$NoPath = $false
$InstallNode = $false
$NoNodeCheck = $false
$Uninstall = $false
$Purge = $false
$Force = $false
$SkipDoctor = $false
$ShowHelp = $false

$argList = @($args)
for ($argIndex = 0; $argIndex -lt $argList.Count; $argIndex++) {
    $argName = [string]$argList[$argIndex]

    switch ($argName) {
        '-Version' {
            if ($argIndex + 1 -ge $argList.Count) { throw 'Thiếu giá trị cho -Version.' }
            $argIndex += 1
            $Version = [string]$argList[$argIndex]
            break
        }
        '-Dir' {
            if ($argIndex + 1 -ge $argList.Count) { throw 'Thiếu giá trị cho -Dir.' }
            $argIndex += 1
            $Dir = [string]$argList[$argIndex]
            break
        }
        '-ZipPath' {
            if ($argIndex + 1 -ge $argList.Count) { throw 'Thiếu giá trị cho -ZipPath.' }
            $argIndex += 1
            $ZipPath = [string]$argList[$argIndex]
            break
        }
        '-NoPath' { $NoPath = $true; break }
        '-InstallNode' { $InstallNode = $true; break }
        '-NoNodeCheck' { $NoNodeCheck = $true; break }
        '-Uninstall' { $Uninstall = $true; break }
        '-Purge' { $Purge = $true; break }
        '-Force' { $Force = $true; break }
        '-SkipDoctor' { $SkipDoctor = $true; break }
        '-Help' { $ShowHelp = $true; break }
        '-h' { $ShowHelp = $true; break }
        default { throw "Tham số không hợp lệ: $argName" }
    }
}

if ($ShowHelp) {
    Write-Host 'NESIX installer'
    Write-Host ''
    Write-Host '  irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1 | iex'
    Write-Host '  .\install.ps1 [-Version <x.y.z>] [-Dir <path>] [-ZipPath <file>] [-NoPath]'
    Write-Host '                [-InstallNode] [-NoNodeCheck] [-SkipDoctor] [-Force] [-Help]'
    Write-Host '  .\install.ps1 -Uninstall [-Purge] [-Force]'
    return
}

$ErrorActionPreference = 'Stop'

$script:OriginalProgressPreference = $ProgressPreference
$script:OriginalOutputEncoding = $null

try {
    $script:OriginalOutputEncoding = [Console]::OutputEncoding
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch {
    # Một số host không cho đổi encoding, bỏ qua.
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    # PowerShell 7+ đã mặc định TLS 1.2+, bỏ qua.
}

$Repo = '0xcRachel/discord-nesix'
$ReleasesBase = "https://github.com/$Repo/releases"
$MinNodeMajor = 18

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Warn([string]$Message) {
    Write-Host " [!] $Message" -ForegroundColor Yellow
}

function Write-Fail([string]$Message) {
    Write-Host " [x] $Message" -ForegroundColor Red
}

function Get-DefaultDir {
    $base = $env:LOCALAPPDATA
    if (-not $base) {
        $base = [Environment]::GetFolderPath('LocalApplicationData')
    }
    if (-not $base) {
        throw 'Không xác định được thư mục LOCALAPPDATA.'
    }
    return (Join-Path $base 'Nesix')
}

function Get-AppDataDir {
    $base = $env:APPDATA
    if (-not $base) {
        $base = [Environment]::GetFolderPath('ApplicationData')
    }
    if (-not $base) {
        return $null
    }
    return (Join-Path $base 'discord-nesix')
}

function Confirm-Action([string]$Message) {
    if ($Force) {
        return $true
    }
    try {
        $answer = Read-Host "$Message [y/N]"
    } catch {
        return $false
    }
    return ($answer -match '^(y|yes|co|có)$')
}

function Refresh-ProcessPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Find-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }
    $candidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }
    return $null
}

function Get-NodeVersion([string]$NodeExe) {
    try {
        $raw = & $NodeExe -p "process.versions.node" 2>$null
    } catch {
        return $null
    }
    if (-not $raw) {
        return $null
    }
    try {
        return [version]($raw.Trim())
    } catch {
        return $null
    }
}

function Install-NodeWithWinget {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        return $false
    }
    Write-Step 'Cài Node.js LTS bằng winget...'
    & winget install --id OpenJS.NodeJS.LTS -e --source winget --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "winget trả mã $LASTEXITCODE."
    }
    Refresh-ProcessPath
    return $true
}

function Invoke-Download([string]$Url, [string]$OutFile) {
    $ProgressPreference = 'SilentlyContinue'
    $attempt = 0
    while ($true) {
        $attempt += 1
        try {
            Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -MaximumRedirection 10
            return
        } catch {
            if ($attempt -ge 3) {
                throw "Tải thất bại: $Url`n$($_.Exception.Message)"
            }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

function Assert-Checksum([string]$ZipFile, [string]$ShaFile) {
    $raw = (Get-Content -Path $ShaFile -Raw -ErrorAction Stop).Trim()
    if (-not $raw) {
        throw "File checksum rỗng: $ShaFile"
    }
    $expected = ($raw -split '\s+')[0].ToLowerInvariant()
    if ($expected -notmatch '^[0-9a-f]{64}$') {
        throw "File checksum không hợp lệ: $ShaFile"
    }
    $actual = (Get-FileHash -Path $ZipFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "SHA256 không khớp, huỷ cài đặt.`n  Mong đợi: $expected`n  Thực tế:  $actual"
    }
    Write-Step "SHA256 hợp lệ ($($expected.Substring(0, 12))...)"
}

function Add-UserPath([string]$PathToAdd) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $target = $PathToAdd.TrimEnd('\')
    $parts = @()
    if ($current) {
        $parts = @($current -split ';' | Where-Object { $_ })
    }
    foreach ($part in $parts) {
        if ($part.TrimEnd('\') -ieq $target) {
            return $false
        }
    }
    $newValue = (@($parts) + $PathToAdd) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newValue, 'User')
    return $true
}

function Remove-UserPath([string]$PathToRemove) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $current) {
        return
    }
    $target = $PathToRemove.TrimEnd('\')
    $parts = @($current -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ine $target) })
    $newValue = $parts -join ';'
    if ($newValue -ne $current) {
        [Environment]::SetEnvironmentVariable('Path', $newValue, 'User')
    }
}

# ─── Đường dẫn ────────────────────────────────────────────────────────────────

if ($Dir) {
    $targetDir = [IO.Path]::GetFullPath($Dir)
} else {
    $targetDir = Get-DefaultDir
}
$shimDir = Join-Path $targetDir 'bin'
$manifestPath = Join-Path $targetDir 'install.json'

# ─── Gỡ cài đặt ───────────────────────────────────────────────────────────────

if ($Uninstall) {
    if (-not (Test-Path $targetDir)) {
        Write-Host "Không thấy thư mục cài: $targetDir"
        return
    }

    $message = "Gỡ NESIX khỏi $targetDir? (data, cache và log trong thư mục này sẽ bị xoá)"
    if ($Purge) {
        $configLabel = Get-AppDataDir
        if (-not $configLabel) {
            $configLabel = '%APPDATA%\discord-nesix'
        }
        $message = "Gỡ NESIX và xoá toàn bộ config/token trong $configLabel?"
    }
    if (-not (Confirm-Action $message)) {
        Write-Host 'Đã huỷ.'
        return
    }

    Write-Step 'Xoá PATH...'
    Remove-UserPath $shimDir

    Write-Step "Xoá $targetDir..."
    Remove-Item -Path $targetDir -Recurse -Force

    if ($Purge) {
        Write-Step 'Xoá config và dữ liệu tạm...'
        $configDir = Get-AppDataDir
        if ($configDir -and (Test-Path $configDir)) {
            Remove-Item -Path $configDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        $gamesDir = Join-Path $env:TEMP 'nesix-games'
        if (Test-Path $gamesDir) {
            Remove-Item -Path $gamesDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host ''
    Write-Host 'Đã gỡ NESIX.' -ForegroundColor Green
    return
}

# ─── Kiểm tra thư mục đích ────────────────────────────────────────────────────

if ((Test-Path $targetDir) -and (-not (Test-Path $manifestPath)) -and (-not $Force)) {
    $existing = @(Get-ChildItem -Path $targetDir -Force -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0) {
        throw "Thư mục $targetDir đã có dữ liệu và không phải bản cài NESIX. Dùng -Dir khác hoặc -Force nếu chắc chắn."
    }
}

# ─── Kiểm tra Node.js ─────────────────────────────────────────────────────────

$nodeExe = $null
if (-not $NoNodeCheck) {
    $nodeExe = Find-NodeExe
    $nodeVersion = $null
    if ($nodeExe) {
        $nodeVersion = Get-NodeVersion $nodeExe
    }

    if ((-not $nodeVersion) -or ($nodeVersion.Major -lt $MinNodeMajor)) {
        if ($nodeVersion) {
            Write-Warn "Node.js hiện tại $nodeVersion, cần >= $MinNodeMajor."
        } else {
            Write-Warn 'Chưa tìm thấy Node.js.'
        }

        $shouldInstall = $false
        if ($InstallNode) {
            $shouldInstall = $true
        } elseif (Confirm-Action 'Cài Node.js LTS bằng winget? (không có winget thì mở trang tải tay)') {
            $shouldInstall = $true
        }

        if ($shouldInstall) {
            if (-not (Install-NodeWithWinget)) {
                throw 'Không tìm thấy winget. Tải Node.js thủ công tại https://nodejs.org/en/download rồi chạy lại.'
            }
            $nodeExe = Find-NodeExe
            if ($nodeExe) {
                $nodeVersion = Get-NodeVersion $nodeExe
            }
        }

        if ((-not $nodeExe) -or (-not $nodeVersion) -or ($nodeVersion.Major -lt $MinNodeMajor)) {
            throw "Cần Node.js >= $MinNodeMajor. Tải tại https://nodejs.org/en/download (chọn LTS), sau đó chạy lại installer."
        }
    }

    Write-Step "Node.js $nodeVersion"
}

if (-not $nodeExe) {
    $nodeExe = Find-NodeExe
    if (-not $nodeExe) {
        throw 'Không tìm thấy node.exe. Bỏ -NoNodeCheck hoặc cài Node.js trước.'
    }
}

$npmExe = Join-Path (Split-Path -Parent $nodeExe) 'npm.cmd'
if (-not (Test-Path $npmExe)) {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCmd) {
        $npmExe = $npmCmd.Source
    } else {
        throw 'Không tìm thấy npm.cmd. Cài lại Node.js LTS.'
    }
}

# ─── Chuẩn bị file zip ────────────────────────────────────────────────────────

$tempZip = $null
$keepTempZip = $false

if ($ZipPath) {
    $zipFile = [IO.Path]::GetFullPath($ZipPath)
    if (-not (Test-Path $zipFile)) {
        throw "Không thấy file zip: $zipFile"
    }
    Write-Step "Dùng file local: $zipFile"

    $localSha = "$zipFile.sha256"
    if (Test-Path $localSha) {
        Assert-Checksum $zipFile $localSha
    } else {
        Write-Warn 'Không có file .sha256 đi kèm, bỏ qua kiểm tra checksum.'
    }
} else {
    if ($Version) {
        $cleanVersion = $Version -replace '^[vV]', ''
        $downloadBase = "$ReleasesBase/download/v$cleanVersion"
        Write-Step "Tải NESIX v$cleanVersion..."
    } else {
        $downloadBase = "$ReleasesBase/latest/download"
        Write-Step 'Tải NESIX bản mới nhất...'
    }

    $tempZip = Join-Path $env:TEMP ("nesix-" + [guid]::NewGuid().ToString('N') + ".zip")
    $keepTempZip = $true
    Invoke-Download "$downloadBase/nesix.zip" $tempZip

    $shaFile = "$tempZip.sha256"
    try {
        Invoke-Download "$downloadBase/nesix.zip.sha256" $shaFile
        Assert-Checksum $tempZip $shaFile
    } catch {
        if (Test-Path $shaFile) {
            Remove-Item $shaFile -Force -ErrorAction SilentlyContinue
        }
        throw "Không tải hoặc không xác minh được checksum. Chi tiết: $($_.Exception.Message)"
    } finally {
        if (Test-Path $shaFile) {
            Remove-Item $shaFile -Force -ErrorAction SilentlyContinue
        }
    }

    $zipFile = $tempZip
}

# ─── Giải nén và copy ─────────────────────────────────────────────────────────

$stageDir = Join-Path $env:TEMP ("nesix-stage-" + [guid]::NewGuid().ToString('N'))

try {
    Write-Step 'Giải nén...'
    New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
    Expand-Archive -Path $zipFile -DestinationPath $stageDir -Force

    if (-not (Test-Path (Join-Path $stageDir 'index.js'))) {
        throw 'Gói tải về không hợp lệ: thiếu index.js.'
    }
    if (-not (Test-Path (Join-Path $stageDir 'package.json'))) {
        throw 'Gói tải về không hợp lệ: thiếu package.json.'
    }

    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

    # Xoá code cũ để không sót file đã bị remove ở version mới.
    # data/, cache/, logs/ không nằm trong zip nên được giữ nguyên.
    $oldSrc = Join-Path $targetDir 'src'
    if (Test-Path $oldSrc) {
        Remove-Item -Path $oldSrc -Recurse -Force
    }

    Write-Step "Cài vào $targetDir..."
    Copy-Item -Path (Join-Path $stageDir '*') -Destination $targetDir -Recurse -Force
} finally {
    if (Test-Path $stageDir) {
        Remove-Item -Path $stageDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($keepTempZip -and $tempZip -and (Test-Path $tempZip)) {
        Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
    }
}

$packagePath = Join-Path $targetDir 'package.json'
$package = Get-Content -Path $packagePath -Raw | ConvertFrom-Json
$installedVersion = $package.version

# ─── Cài dependency ───────────────────────────────────────────────────────────

Write-Step 'Cài dependency (npm ci)...'
Push-Location $targetDir
try {
    $env:npm_config_update_notifier = 'false'

    & $npmExe ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'npm ci thất bại, thử npm install...'
        & $npmExe install --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm install thất bại (mã $LASTEXITCODE)."
        }
    }
} finally {
    Pop-Location
}

# ─── Tạo lệnh nesix ───────────────────────────────────────────────────────────

New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
$shimPath = Join-Path $shimDir 'nesix.cmd'
$shimContent = "@echo off`r`nsetlocal`r`nnode `"%~dp0..\index.js`" %*`r`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($shimPath, $shimContent, $utf8NoBom)

$pathAdded = $false
if (-not $NoPath) {
    $pathAdded = Add-UserPath $shimDir
}
$env:Path = "$shimDir;$env:Path"

# ─── Manifest ─────────────────────────────────────────────────────────────────

$sourceKind = 'release'
if ($ZipPath) {
    $sourceKind = 'local'
}
$manifest = [ordered]@{
    name        = 'nesix'
    repo        = $Repo
    version     = $installedVersion
    path        = $targetDir
    source      = $sourceKind
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($manifestPath, $manifestJson + "`n", $utf8NoBom)

# ─── Doctor ───────────────────────────────────────────────────────────────────

if (-not $SkipDoctor) {
    Write-Step 'Kiểm tra môi trường (--doctor)...'
    Push-Location $targetDir
    try {
        & $nodeExe index.js --doctor
    } catch {
        Write-Warn "Doctor lỗi: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
}

# ─── Kết thúc ─────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host "NESIX v$installedVersion đã cài tại: $targetDir" -ForegroundColor Green
if ($pathAdded) {
    Write-Host "Đã thêm $shimDir vào PATH người dùng. Mở terminal mới để dùng lệnh 'nesix'." -ForegroundColor Yellow
} elseif ($NoPath) {
    Write-Host "Chưa thêm PATH. Chạy trực tiếp: $shimPath" -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'Bắt đầu:'
Write-Host '  nesix --doctor'
Write-Host '  nesix --farm --dry-run'
Write-Host '  nesix'

$ProgressPreference = $script:OriginalProgressPreference
if ($script:OriginalOutputEncoding) {
    try { [Console]::OutputEncoding = $script:OriginalOutputEncoding } catch { }
}
