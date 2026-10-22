#Requires -Version 5.1
<#
.SYNOPSIS
  Đóng gói bản release NESIX thành .release/nesix.zip + checksum.

.DESCRIPTION
  Zip chỉ chứa code cần để chạy. Không chứa data/, cache/, logs/, node_modules/,
  test/ hay .git/ để installer có thể giải nén đè mà giữ nguyên tiến độ.

  Chạy:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1

  Kiểm tra tag (CI):
    $env:GITHUB_REF_NAME='v1.2.0'; ./scripts/build-release.ps1

.PARAMETER OutputDir
  Thư mục xuất file. Mặc định <repo>\.release

.PARAMETER SkipTagCheck
  Không kiểm tra GITHUB_REF_NAME khớp package.json version.
#>
[CmdletBinding()]
param(
    [string]$OutputDir = '',
    [switch]$SkipTagCheck
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $root 'package.json'
if (-not (Test-Path $packagePath)) {
    throw "Không thấy package.json tại $packagePath"
}

$package = Get-Content -Path $packagePath -Raw | ConvertFrom-Json
$version = $package.version

if ($env:GITHUB_REF_NAME -and (-not $SkipTagCheck)) {
    $expectedTag = "v$version"
    if ($env:GITHUB_REF_NAME -ne $expectedTag) {
        throw "Tag $($env:GITHUB_REF_NAME) không khớp version $version (mong đợi $expectedTag)."
    }
}

if (-not $OutputDir) {
    $OutputDir = Join-Path $root '.release'
}
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$include = @(
    'index.js',
    'package.json',
    'package-lock.json',
    'README.md',
    'install.ps1',
    'src'
)

$stage = Join-Path $env:TEMP ("nesix-release-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null

try {
    foreach ($item in $include) {
        $source = Join-Path $root $item
        if (-not (Test-Path $source)) {
            throw "Thiếu file bắt buộc: $item"
        }
        Copy-Item -Path $source -Destination $stage -Recurse -Force
    }

    $license = Join-Path $root 'LICENSE'
    if (Test-Path $license) {
        Copy-Item -Path $license -Destination $stage -Force
    }

    # Không cho node_modules lọt vào zip nếu có ai copy nhầm.
    $leaked = Get-ChildItem -Path $stage -Recurse -Force -Directory -Filter 'node_modules' -ErrorAction SilentlyContinue
    if ($leaked) {
        throw "Phát hiện node_modules trong bản đóng gói: $($leaked[0].FullName)"
    }

    $zipPath = Join-Path $OutputDir 'nesix.zip'
    if (Test-Path $zipPath) {
        Remove-Item -Path $zipPath -Force
    }

    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal

    $hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $shaPath = Join-Path $OutputDir 'nesix.zip.sha256'
    $shaLine = "$hash  nesix.zip`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($shaPath, $shaLine, $utf8NoBom)

    $sizeKb = [Math]::Round((Get-Item $zipPath).Length / 1KB, 1)

    Write-Host "Version : $version"
    Write-Host "Zip     : $zipPath ($sizeKb KB)"
    Write-Host "SHA256  : $hash"
    Write-Host "Checksum: $shaPath"
} finally {
    if (Test-Path $stage) {
        Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}
