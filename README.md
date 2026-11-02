# eclass-linux

eClass 補習班課程播放器的**跨平台重寫**。原程式 `eclass.exe` 是 Windows-only 的 native VB6 程式（v1.3.4），本專案用純 Node 重新實作其 API 客戶端、防盜鏈簽章與播放/下載流程，一套核心同時跑 **Electron（Linux / Windows / macOS）** 與 **Android（Capacitor）**。

> ⚠️ 需自己有**合法補習班帳號**。本專案為技術研究 / 自用跨平台存取，請勿散佈他人帳號內容或商業侵權。

---

## 能做什麼（一句話）

**只要帳號登入成功、影片已上架，就能跨平台瀏覽、播放、下載自己課程的影片。**
完整的運作原理、破解結論與邊界見 **[`docs/CONCLUSION.md`](docs/CONCLUSION.md)**（想快速理解專案看那份就夠）；逐步逆向過程見 [`docs/native-playback-flow.md`](docs/native-playback-flow.md)。

## 功能

| 功能 | Electron（桌面） | Android |
|---|---|---|
| 多校共用登入（Code→host 自動對應） | ✅ | ✅ |
| 自動登入（並行試 host） | ✅ | ✅ |
| 課程 / 單元 / 分段瀏覽 | ✅ | ✅ |
| 影片播放 | ✅ 內嵌 + 外部 VLC | ✅ 內嵌 |
| **影片下載** | ✅ 串流 + 續傳 + 進度 | ✅ 交系統下載管理員 |
| **觀看狀態顯示**（可看 / 未開放 / 未上架） | ✅ | ✅ |
| **扣點補課按鈕**（二次確認，非下載必需） | ✅ | ✅ |
| MacID 綁定值寫死（跨裝置登入同帳號） | ✅ | ✅ |

- **影片連結簽章**（`src/core/moviesign-core.js`）：`Key` 演算法從 native VB6 反組譯還原、經伺服器驗證，純 JS MD5 實作、零 wine 依賴。簽章字串含 `.mp4` 副檔名（破解核心，見 CONCLUSION）。
- **零 session cookie**：伺服器不發 cookie，每支 API 在 query 帶 `Code + StuSN + StuPass + MacID` 驗身分。

---

## 安裝 / 執行（桌面）

```bash
npm install
npm start          # 開 Electron GUI
npm run smoke      # 離線單元測試（29 項，不連網）

# CLI 直接打 API / 抓包：
node test/api-cli.js login <host> <code> <stuSN> <stuPass>
# 完整流程 E2E（需真帳號）：
node test/e2e-live.js makeup.jlweb.com.tw <code> <stuSN> <stuPass>
```

外部播放需系統已裝 VLC：`sudo apt install vlc`（內嵌播放不需要）。

### 打包發佈

```bash
npm run dist       # 當前平台
npm run dist:all   # electron-builder -mwl 三平台
```

或到 [Releases](../../releases) 取 GitHub Actions 自動打包的安裝檔：Linux `AppImage`/`deb`/`tar.gz`、Windows `nsis`/`zip`、macOS `dmg`/`zip`。

## Android（Capacitor）

```bash
npm run cap:sync   # 同步核心到 www/ 並 cap sync
npm run cap:apk    # 組 debug APK（android/ gradlew assembleDebug）
```

Android 走 `www/`（Capacitor WebView + `CapacitorHttp`），共用 `www/js/core/` 的同一份核心邏輯。核心由 `scripts/copy-core-to-www.js` 從 `src/core/` 同步（`npm run core:copy`），**不要手改 `www/js/core/`**。

---

## 換帳號 / 換機器

eClass 把帳號綁到「第一次登入用的網卡 MAC」。本專案把 MacID **寫死**成 JL（代碼 `0102`）帳號綁定的 `00-11-22-33-44-55`，所以任何裝置跑都認得該帳號。換成**別的帳號**時改綁定 MAC：

- Electron：環境變數 `ECLASS_PINNED_MAC`（預設見 `src/api/machineid.js`）。
- Android：改 `www/js/platform-capacitor.js` 的 `PINNED_MAC`。

---

## 破解重點（摘要）

> 完整版見 [`docs/CONCLUSION.md`](docs/CONCLUSION.md)。

1. **登入 `key` 不驗**：`CheckMac.aspx` / `StuLogin.aspx` 的 `&key=` 伺服器不驗證（`key=0` 也成功），原程式送的是裝飾用隨機數。登入只要 `Code + StuSN + StuPass + MacID`。
2. **影片防盜鏈 `Key`**（核心）：
   ```
   Key  = md5_hex_lower( "2370" + StuSN + "4277" + "<段ID>.mp4" + Key2 )
   Key2 = 任意數字（伺服器不綁其值）
   ```
   - `2370`/`4277` 是 exe 內硬編 salt；中間動態值 = 學號 StuSN。
   - hash `0x7142a0` 確認為標準 MD5。
   - **三處關鍵**（之前全錯）：`Movie` 參數帶 `.mp4`、`Key` 用含 `.mp4` 的字串算、`GroupID` 留空。
3. **扣點對下載形同虛設**：取連結（`GetMovieURLCDN.aspx`）伺服器端不扣點，CDN 只驗 token 對不對 `.mp4` 路徑，不管有沒有扣過點。扣點純粹是補習班後台的觀看記帳。

## API 端點

| 端點 | 參數 | 用途 |
|---|---|---|
| `/CheckMac.aspx` | Code, StuSN, StuPass, MacID, ComputerName, key | 登入 + 綁機器（key 不驗；回 `1`=成功 / `2`=機器不符 / `-1`=帳密錯） |
| `/StuLogin.aspx` | Code, StuSN, StuPass | 登入（回 `1,<姓名>`） |
| `/SaveStuLogin.aspx` | MovieID, ClassID, Flag | **扣點補課**（扣 1 點，進三天觀看期） |
| `/ClassList1.aspx` | Code | 班級列表（`ClassID;GroupID;,名稱`） |
| `/ClassList2.aspx` | Code, **ClassID=GroupID** | 單元列表（`單元名,GroupID,MovieID,點數`） |
| `/MovieList.aspx` | Code, MovieID, **ClassID=GroupID** | 分段列表（`段序,段ID,可看`） |
| `/GetClassWeekNote.aspx` | Code, WeekID | 週次講義 |
| `/GetMovieURLCDN.aspx` `/GetMovieURLS3.aspx` | Key2, Key, Movie(`段ID.mp4`), Code, GroupID(空) | 取防盜鏈影片連結 |
| `/GetClassPoint.aspx` `/CheckPoint.aspx` | Code（+MovieID/ClassID） | 點數 / 觀看進度（`0`=已開通 / `1`=未開通） |

> ⚠️ 欄位對應坑：`ClassList2` / `MovieList` 的 `ClassID` 參數要填 **ClassList1 的第二欄 GroupID**，不是第一欄 ClassID，否則回空。

## 多校主機（同一套系統賣給各補習班）

`src/core/schools.js` 的 Code→host 註冊表（8 家帶代號 + 2 個 fallback host）：

| 代號 | 補習班 | host | 狀態 |
|---|---|---|---|
| 0102 | 升學文理 (JL) | `makeup.jlweb.com.tw` | ✅ 完整驗證（登入+取連結+下載） |
| 0041 | 補習班 0041 | `faigo.synology.me` | 清單內，未逐一驗證 |
| 0018 | 補習班 0018 | `114.32.237.176` | 同上 |
| 0055 | 補習班 0055 | `114.34.92.6:8888` | 同上 |
| 0009 | 補習班 0009 | `122.116.1.178` | 同上 |
| 0062 | 漢達 | `handazyuku.fortiddns.com` | 同上 |
| 0047 | 補習班 0047 | `220.130.155.38` | 同上 |
| 0060 | 法柏 | `hs.faber.com.tw` | 同上 |
| — | eClass 總站 | `svr1.eclass.com.tw` | 無代號 fallback host |

> 目前確認「活著 + 取連結/簽章邏輯相同」的只有 JL（0102）；其他家多數伺服器已死或待重驗。影片存放：`<code>.s3.hicloud.net.tw`（hicloud S3）、hinet CDN。

## 原程式有、本版「刻意不實作」的防護

原 exe 會用 WMI 偵測並強制關閉錄影軟體（OBS/oCam/ApowerREC/FlashBack/GameBar）、疊浮水印、攔鍵盤。這些是 DRM 側反制，對自用跨平台播放沒必要，本版不移植。

## 專案結構

```
src/
  core/      eclass-core.js (端點+扣點+取連結.mp4公式) · md5.js
             moviesign-core.js (Key 簽章) · parse-core.js (回應解析)
             schools.js (多校 Code→host 註冊表)   ← Electron/Android 共用
  api/       machineid.js (MAC+主機名, PINNED_MAC) · keysign.js (登入 key, 保留相容)
             eclass.js · moviesign.js · parse.js · player.js (VLC, Electron 包裝)
  main/      main.js (Electron 主程序+IPC: api:download / api:deductPoint) · preload.js
  renderer/  index.html · style.css · ui.js · adapter-electron.js
www/                              ← Android (Capacitor)
  index.html · js/ui.js
  js/core/*                       ← 由 scripts/copy-core-to-www.js 從 src/core 同步
  js/platform-capacitor.js (MacID 寫死 + CapacitorHttp) · adapter-capacitor.js
test/        smoke.js (離線測試) · api-cli.js (CLI/抓包) · e2e-live.js (完整流程)
docs/        CONCLUSION.md (結論總表) · native-playback-flow.md (逆向過程 附錄 A–P)
.github/workflows/  build-release.yml (三平台打包 + tag 發 release)
scripts/     copy-core-to-www.js
```

## 授權

MIT。僅限合法帳號之技術研究與自用。
