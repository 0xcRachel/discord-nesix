# NESIX - Discord Quest & Badge Toolkit

Công cụ CLI cho Windows: tự động làm Discord Quest và farm tiến độ 2 badge
**Game Variety** / **Game Time** bằng cách giả lập process game mà Discord có thể detect.

> **Cảnh báo quan trọng**
>
> - Farm badge bằng process giả lập **vi phạm Discord Terms of Service**. Tài khoản có thể bị khoá hoặc bị gắn cờ.
> - Badge Game Variety / Game Time vẫn đang **experimental**, chỉ một số tài khoản desktop được bật. Discord không công khai tiến độ qua API, nên số liệu trong tool chỉ là **ước tính cục bộ**.
> - Token Discord là mật khẩu tài khoản. Không chia sẻ token, không commit file cấu hình.
> - Chỉ dùng trên tài khoản của bạn. Tự chịu rủi ro.

---

## Tính năng

- Quest: xem, nhận, làm video, làm game, nhận thưởng, auto 24/7.
- Sửa các lỗi cũ:
  - Không còn treo vô hạn với quest `STREAM` / `ACTIVITY`.
  - Có xử lý `429` và `retry_after` của Discord.
  - Có timeout, phát hiện quest không tiến triển.
  - Tắt bằng `Ctrl+C` có cleanup process, lock và state.
  - Bỏ các dependency chết (`node-fetch`, `figlet`, `gradient-string`, `ws`).
- Badge:
  - Farm **Game Variety** bằng stub exe mang đúng tên executable Discord mong đợi.
  - Farm **Game Time** bằng cách cộng dồn thời gian các phiên.
  - Lưu tiến độ, resume sau khi tắt, giới hạn số game/ngày.
  - `--status` xem tier ước tính; `--doctor` kiểm tra môi trường.
- Steam:
  - Nguồn mặc định: **toàn bộ game detectable có Steam appid + exe Windows** (không cần sở hữu game).
  - Tuỳ chọn lọc theo game **đã cài** hoặc **sở hữu** (Steam Web API).
- Giao diện tiếng Việt, không emoji, không icon trang trí.

---

## Yêu cầu

- Windows 10/11.
- Node.js **18+** (khuyến nghị 20/22).
- Discord **desktop** đang chạy (không phải bản web).
- Discord đã bật:
  - `Settings > Activity Privacy > Share your detected activities`
  - Các setting liên quan đến analytics / "Use data to make Discord better" (badge yêu cầu analytics).
- PowerShell 5.1 hoặc .NET Framework 4.x để build stub exe lần đầu.

---

## Cài đặt

### Cài nhanh (khuyến nghị)

Mở **PowerShell** (không cần admin) và chạy:

```powershell
irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1 | iex
```

Installer sẽ:

1. Kiểm tra Node.js >= 18. Nếu thiếu, hỏi bạn có cài Node.js LTS qua `winget` không.
2. Tải release mới nhất từ GitHub và **kiểm tra SHA256** trước khi giải nén.
3. Cài vào `%LOCALAPPDATA%\Nesix` (không cần quyền admin).
4. Chạy `npm ci` để cài dependency.
5. Tạo lệnh `nesix` và thêm vào PATH người dùng.
6. Chạy `--doctor` để kiểm tra môi trường.

Mở terminal mới rồi dùng:

```powershell
nesix --doctor
nesix --farm --dry-run
nesix
```

Cài bản cụ thể hoặc thư mục khác:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1))) -Version 1.2.1 -Dir "D:\Tools\Nesix"
```

Không muốn thêm PATH:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1))) -NoPath
```

### Cập nhật

Chạy lại one-liner ở trên. Code được thay mới, còn `data/`, `cache/`, `logs/`
trong thư mục cài được giữ nguyên nên tiến độ không mất.

### Gỡ

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1))) -Uninstall
```

Thêm `-Purge` để xoá luôn token trong `%APPDATA%\discord-nesix`:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1))) -Uninstall -Purge -Force
```

### Kiểm tra file tải về

Installer luôn tải `nesix.zip.sha256` và so hash trước khi cài. Nếu muốn tự kiểm tra:

```powershell
$zip = "$env:TEMP\nesix.zip"
irm https://github.com/0xcRachel/discord-nesix/releases/latest/download/nesix.zip -OutFile $zip
(Get-FileHash $zip -Algorithm SHA256).Hash
irm https://github.com/0xcRachel/discord-nesix/releases/latest/download/nesix.zip.sha256
```

Hai hash phải giống nhau. Có thể đọc `install.ps1` trước khi chạy:

```powershell
irm https://raw.githubusercontent.com/0xcRachel/discord-nesix/main/install.ps1 | more
```

### Cài thủ công từ source

Dùng khi không muốn chạy one-liner, hoặc GitHub release không truy cập được:

```bash
git clone https://github.com/0xcRachel/discord-nesix.git
cd discord-nesix
npm install
node index.js --doctor
```

Lần đầu chạy, tool sẽ tải danh sách game detectable từ Discord và build
`cache/nesix-stub.exe`. Thao tác này cần mạng.

---

## Lấy token Discord

Chỉ thực hiện trên máy của bạn, tại `https://discord.com/app`.

Cách 1 - DevTools:

1. `F12` > tab **Application** > **Local Storage** > `https://discord.com`.
2. Tìm key `token`, copy giá trị (bỏ dấu ngoặc kép nếu có).

Cách 2 - Console (nếu cách 1 không có):

```js
(webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()
```

Sau đó:

```bash
node index.js --setup
```

Token được lưu tại `%APPDATA%\discord-nesix\config.json` dưới dạng **plaintext**.
Nếu không muốn lưu file, đặt biến môi trường `NESIX_TOKEN` trước khi chạy:

```powershell
$env:NESIX_TOKEN = "token_cua_ban"
node index.js --status
```

Tool không gửi token đi đâu ngoài `discord.com/api/v9`.

---

## Lệnh nhanh

```bash
node index.js                         # Menu tương tác
node index.js --setup                 # Nhập / đổi token
node index.js --status                # Trạng thái badge (ước tính)
node index.js --doctor                # Kiểm tra môi trường

node index.js --games refresh         # Tải lại danh sách game detectable
node index.js --steam import          # Đọc thư viện Steam cục bộ / game sở hữu

node index.js --farm                  # Farm Game Variety, mặc định 5 game
node index.js --farm --limit 10       # Farm 10 game
node index.js --farm --dwell 900      # Giữ mỗi game 900 giây (15 phút)
node index.js --farm --dry-run        # Chỉ in danh sách, không chạy
node index.js --farm --mode time --minutes 120
node index.js --farm --source installed
node index.js --farm --source owned

node index.js --auto                  # Quest auto 24/7
node index.js --debug                 # Dump JSON quest ra data/quests-debug.json
```

`--farm` **không cần token**. Chỉ quest và `--auto` mới cần token.

---

## Farm badge

### Cơ chế

Discord detect game bằng tên executable (và đường dẫn tương đối), không phải window title.
Tool hoạt động như sau:

1. Tải `/api/v9/applications/detectable`, lọc app có `executables.os = win32` và `third_party_skus.distributor = steam`.
2. Chọn một game chưa credit.
3. Copy `cache/nesix-stub.exe` vào:
   `%TEMP%\nesix-games\<appid>\<đường_dẫn_exe>`
   Ví dụ: `%TEMP%\nesix-games\570\dota2.exe`.
4. Chạy process đó với title là tên game. Stub là app WinForms, có cửa sổ thật.
5. Giữ process sống `--dwell` giây (mặc định 900s = 15 phút).
6. Kill process, dọn thư mục tạm, ghi state, nghỉ 10 giây, sang game tiếp theo.

Discord quét process khoảng 15 giây/lần. Trong log Discord
(`%APPDATA%\discord\logs\renderer_js.log`) sẽ thấy dạng:

```
[RunningGameStore] Running Games Changed
[Clips] decider: handleRunningGamesChange visibleGame=Dota 2
newPrimaryKey=c:/users/.../nesix-games/570/dota2.exe:Dota 2
```

Đây là bằng chứng Discord đã nhận đúng process.

### Credit

- `MIN_CREDIT_SEC = 600` (10 phút). Một phiên chỉ được tính credit variety khi:
  - process không thoát sớm, và
  - thời gian giữ >= `max(600, min(dwell, 900))` giây.
- Với dwell mặc định 900s, cần đủ 900s mới credit.
- Nếu bạn dừng giữa phiên, thời gian vẫn được cộng vào **Game Time**, nhưng không credit variety.
- Daily cap mặc định **20 game unique/ngày**; có thể đổi trong Settings.
- `--mode time` chạy luân phiên các game trong số phút chỉ định; vẫn credit variety cho game mới (tôn trọng daily cap), đồng thời cộng giờ.

### Nguồn game

| Nguồn | Ý nghĩa | Cần gì |
| --- | --- | --- |
| `detectable` (mặc định) | Toàn bộ game detectable có Steam appid + exe Windows | Mạng lần đầu |
| `installed` | Giao với game Steam đã cài trên máy | Steam library |
| `owned` | Giao với game sở hữu trên Steam | Steam API key + SteamID64, profile public |

Đổi mặc định trong `Settings > Nguồn game`, hoặc dùng `--source`.

### Bảng tier Game Variety

| Tier | Tên | Số game |
| --- | --- | --- |
| 1 | Sampler | 2 |
| 2 | Dabbler | 5 |
| 3 | Enthusiast | 10 |
| 4 | Ranger | 15 |
| 5 | Explorer | 20 |
| 6 | Adventurer | 30 |
| 7 | Voyager | 40 |
| 8 | Maverick | 60 |
| 9 | Polymath | 80 |
| 10 | Universalist | 100+ |

### Bảng tier Game Time

| Tier | Tên | Số giờ |
| --- | --- | --- |
| 1 | Casual | 1 |
| 2 | Recreational | 5 |
| 3 | Dedicated | 20 |
| 4 | Committed | 75 |
| 5 | Serious | 150 |
| 6 | Devoted | 300 |
| 7 | Seasoned | 500 |
| 8 | Ironclad | 1.000 |
| 9 | Unshakeable | 2.000 |
| 10 | Eternal | 5.000+ |

Thời gian farm thực tế để đạt Universalist (100 game) với dwell 15 phút là khoảng
**25 giờ** (chưa tính nghỉ). Game Time 5.000 giờ là mục tiêu dài hạn, không phù hợp
để farm trong một phiên.

---

## Quest

Menu và các lệnh:

- Xem danh sách quest: `quest:list`.
- Nhận quest: `quest:accept`.
- Làm quest: `quest:complete`.
  - Hỗ trợ `WATCH_VIDEO` và `PLAY_ON_DESKTOP`.
  - `STREAM_ON_DESKTOP` / `PLAY_ACTIVITY` được bỏ qua có thông báo, không treo.
- Nhận thưởng: `quest:claim`.
- Full auto: `quest:full` hoặc `--auto`.

`--auto` chạy vòng lặp: nhận -> làm -> claim -> nghỉ `pollIntervalMin` (mặc định 30 phút).
Nếu Discord yêu cầu captcha khi claim, tool sẽ cảnh báo để bạn claim thủ công.

---

## Trạng thái và kiểm tra

`node index.js --status` hiển thị:

- Tier ước tính Game Variety / Game Time.
- Số game credit hôm nay.
- Tổng số phiên.
- Nguồn detectable / Steam.
- Discord có đang chạy không.
- Tuổi cache detectable.
- Thống kê quest.

`node index.js --doctor` kiểm tra:

- Node.js, Windows.
- Discord desktop, thư mục Discord.
- Steam library.
- Cache detectable.
- Build stub exe.
- Token (nếu có).
- Quyền ghi `data/`.

---

## Cấu hình

Lưu tại `%APPDATA%\discord-nesix\config.json`:

| Key | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `token` | rỗng | Discord token |
| `gameSource` | `detectable` | Nguồn game |
| `dwellSec` | 900 | Giữ mỗi game (giây) |
| `dailyGameCap` | 20 | Số game unique credit/ngày |
| `heartbeatSec` | 30 | Chu kỳ heartbeat quest game |
| `videoStepSec` | 10 | Bước nhảy video quest |
| `maxBatchHours` | 6 | Giới hạn một batch quest |
| `pollIntervalMin` | 30 | Chu kỳ auto quest |
| `autoAccept` | true | Tự nhận quest |
| `autoClaim` | true | Tự claim |
| `steamApiKey` | rỗng | Steam Web API key |
| `steamId` | rỗng | SteamID64 |

Biến môi trường override: `NESIX_TOKEN`, `STEAM_API_KEY`, `STEAM_ID`.

---

## Cấu trúc thư mục

```
index.js
install.ps1          installer Windows (one-liner)
src/
  discord/
    api.js           REST wrapper, rate limit, 429
    detectable.js    tải / chuẩn hoá detectable list
    quests.js        phân loại + state machine quest
  steam/
    local.js         libraryfolders.vdf, appmanifest
    web.js           Steam Web API
    index.js         ghép nguồn game
  game/
    stub.js          build stub WinForms
    launcher.js      copy stub + spawn/kill
    farm.js          vòng lặp farm
  badges/
    catalog.js       tier Game Variety / Game Time
    engine.js        state, thống kê
  ui/
    render.js        bảng, progress, status
    menu.js          menu
  config.js
  lock.js
  logger.js
  paths.js
  rate-limit.js
data/                state.json, detectable.json, steam-owned.json (tự sinh)
cache/               nesix-stub.exe + source (tự sinh)
logs/                log theo ngày (tự sinh)
scripts/             build-release.ps1, smoke-launch.mjs
test/                node:test
```

`data/state.json` là nguồn tiến độ của tool. Có thể backup file này.
Nếu file hỏng, tool đổi tên thành `state.json.corrupt-<timestamp>` và bắt đầu lại.

---

## Xử lý lỗi

**Discord không detect game**

- Mở Discord **desktop**, không phải web.
- Bật `Activity Privacy > Share your detected activities`.
- Bật analytics / "Use data to make Discord better".
- Kiểm tra log `%APPDATA%\discord\logs\renderer_js.log` xem có `visibleGame=<tên game>` và đường dẫn `nesix-games`.
- Một số game có thể bị Discord bỏ qua nếu exe là launcher; tool đã ưu tiên exe không phải launcher.

**Badge không hiện**

- Badge đang experimental; chỉ một số tài khoản được bật.
- Thử restart Discord sau khi farm.
- Discord có thể cần thời gian để cập nhật; không có API xem tiến độ thật.

**`Discord desktop chưa chạy`**

- Mở Discord trước khi chạy `--farm`, hoặc dùng `--dry-run` để xem danh sách.

**Build stub thất bại**

- Chạy `node index.js --doctor`.
- Kiểm tra `cache/build-stub.ps1` và `cache/nesix-stub.cs`.
- Cần Windows PowerShell 5.1 hoặc `csc.exe` của .NET Framework 4.x.

**Antivirus báo stub**

- Stub là file exe không ký, bị đổi tên liên tục; AV có thể báo nhầm.
- Thêm exclusion cho `cache/` và `%TEMP%\nesix-games`, hoặc tự build stub từ source.
- Không tải stub từ nguồn lạ.

**`429 Too Many Requests`**

- Tool tự chờ theo `retry_after`.
- Không chạy nhiều instance; lock file `data/nesix.lock` sẽ chặn.

**Claim bị captcha**

- Discord yêu cầu captcha khi claim; mở Discord và claim thủ công.

**Steam không tìm thấy**

- Tool đọc registry `HKCU\Software\Valve\Steam\SteamPath` và các đường dẫn mặc định.
- Chạy `node index.js --steam import` để xem đường dẫn.

**`owned` lỗi**

- Steam profile phải public game details.
- Cần Steam Web API key và SteamID64.
- Thử `--steam import` để refresh cache.

---

## Bảo mật

- Token lưu plaintext trong `%APPDATA%\discord-nesix\config.json`. Hãy bảo vệ máy và file này.
- Log được che token / Steam key bằng regex, nhưng vẫn nên kiểm tra trước khi chia sẻ log.
- Không có telemetry; mọi request chỉ tới `discord.com` và `api.steampowered.com`.
- Không chạy tool trên máy dùng chung hoặc tài khoản không phải của bạn.

---

## Disclaimer

Dự án phục vụ mục đích học tập và tự động hoá cá nhân. Việc giả lập process game
để farm badge có thể vi phạm Discord ToS và gây rủi ro khoá tài khoản. Tác giả không
chịu trách nhiệm cho bất kỳ thiệt hại nào.
