# eclass-linux

eClass 補習班課程播放器的 **跨平台重寫**（Electron + Node）。原程式 `eclass.exe` 是 Windows-only 的 VB6 程式（v1.3.4），本專案用純 Node 重新實作其 API 客戶端、防盜鏈簽章與播放流程，Linux / Windows / macOS 通用。

> ⚠️ 需自己有**合法補習班帳號**。本專案為技術研究 / 自用跨平台，不含任何破解授權內容的功能。

## 功能

- 完整 eClass API 端點（逆向自原 exe）：登入、班級列表、單元/分段列表、週次講義、點數、取影片防盜鏈連結。
- **影片連結簽章**（`src/api/moviesign.js`）：Key 演算法已從 native VB6 反組譯還原並經伺服器驗證，純 `crypto` 實作、零 wine 依賴。
- 機器綁定：抓實體網卡 MAC + 主機名（對應原程式 `mMac` 模組，過濾虛擬網卡）。
- 影片播放：直接呼叫系統 **VLC** 播放帶 `expire/token` 的連結（原程式內嵌 axvlc/WMP，跨平台改外部 VLC 最穩）。
- Electron GUI + 純 CLI（`test/api-cli.js`）兩種操作方式。

## 安裝 / 執行

```bash
npm install
npm start          # 開 GUI
npm run smoke      # 離線單元測試（不連網）
# CLI 直接打 API：
node test/api-cli.js login <host> <code> <stuSN> <stuPass>
# 完整流程 E2E（需真帳號）：
node test/e2e-live.js makeup.jlweb.com.tw <code> <stuSN> <stuPass>
```

需系統已裝 VLC：`sudo apt install vlc`（或 Win/Mac 對應安裝）。

## 下載

到 [Releases](../../releases) 取各平台安裝檔（由 GitHub Actions 自動打包）：
Linux `AppImage`/`deb`/`tar.gz`、Windows `nsis`/`zip`、macOS `dmg`/`zip`。

## 逆向結果

原程式是 **native-compiled VB6**（非 p-code；有 `__vbaExceptHandler`/`_CIcos`），可直接反組譯。以下皆經實測 / 伺服器 oracle 驗證。

### 登入 `key` 不需要

`StuLogin.aspx` / `CheckMac.aspx` 的 `&key=` **伺服器根本不驗證**（實測 `key=0` 也回成功）。原程式每次登入送的是 client 隨機數，純裝飾。登入只要 `Code + StuSN + StuPass`。

### 資料端點靠帳密帶身分（無 session cookie）

伺服器不發 cookie，每支 API 都在 query 帶 `Code + StuSN + StuPass + MacID` 驗證。回應用 `<br/>` 分列、逗號分欄。

### 影片防盜鏈 `Key` 演算法（核心破解）

`GetMovieURLCDN.aspx` / `GetMovieURLS3.aspx` 的簽章：

```
Key  = md5_hex_lower( "2370" + StuSN + "4277" + Movie + Key2 )
Key2 = 任意數字（原程式用 CStr(Fix(Rnd()*1000000)); 伺服器不綁定其值）
```

- `2370` / `4277` 是 exe 內硬編 salt；中間動態值 = **學號 StuSN**（反組譯 vtable `+0x508` 呼叫）。
- hash 函式 `0x7142a0` 確認為**標準 MD5**（state 初始常數 `67452301/efcdab89/98badcfe/10325476`，VB6 以陣列手刻）。
- 輸入以 latin1 byte 餵入，輸出小寫全長 hex。
- 回應碼：`-1` 缺身分 / `-2` Key 空 / `-3` Key 錯 / `http://…?expire=&token=` 成功。

→ 本專案 `getMovieUrlCDN({ movie, groupId })` 會自動用登入後的 StuSN 簽 Key，呼叫端只需給段ID + GroupID。

## API 端點

| 端點 | 參數 | 用途 |
|---|---|---|
| `/CheckMac.aspx` | Code, StuSN, StuPass, MacID, ComputerName, key | 登入 + 綁機器（key 不驗） |
| `/StuLogin.aspx` | Code, StuSN, StuPass | 登入（回 `1,<姓名>`） |
| `/SaveStuLogin.aspx` `/SaveStuLogout.aspx` | Code / StuSN, Version, CustID | 狀態/版本回報 |
| `/ClassList1.aspx` | Code | 班級列表（`ClassID;GroupID;,名稱`） |
| `/ClassList2.aspx` | Code, **ClassID=GroupID** | 單元列表（`單元名,GroupID,MovieID,點數`） |
| `/MovieList.aspx` | Code, MovieID, **ClassID=GroupID** | 分段列表（`段序,段ID,可看`） |
| `/GetClassWeekNote.aspx` | Code, WeekID | 週次講義 |
| `/GetMovieURLCDN.aspx` `/GetMovieURLS3.aspx` | Key2, Key, Movie(段ID), Code, GroupID | 取防盜鏈影片連結 |
| `/GetClassPoint.aspx` `/CheckPoint.aspx` | Code | 點數/進度 |

> ⚠️ 欄位對應坑：`ClassList2` / `MovieList` 的 `ClassID` 參數要填 **ClassList1 的第二欄 GroupID**，不是第一欄 ClassID，否則回空。

## 已知主機（同一套系統賣給各補習班）

| 代號 | host |
|---|---|
| eclass | `svr1.eclass.com.tw` |
| handazyuku | `handazyuku.fortiddns.com` |
| faber | `hs.faber.com.tw` |
| jl | `makeup.jlweb.com.tw` |

影片存放：`<code>.s3.hicloud.net.tw`（hicloud S3 origin）、`<code>-jl28122118.cdn.hinet.net`（hinet CDN）。

## 原程式有、但本版「刻意不實作」的防護

原 exe 會用 WMI 偵測並**強制關閉錄影軟體**（OBS/oCam/ApowerREC/FlashBack/GameBar）、疊浮水印、攔鍵盤。這些是 DRM 側反制，對自用跨平台播放沒必要，本版不移植。

## 現況 / 待確認

- ✅ 登入、班級/單元/分段列表、點數、Key 簽章 → 全部跑通，E2E 驗證伺服器回合法簽章 URL。
- 🔶 影片實體下載：簽章 URL 合法，但部分帳號/班級的 CDN 物件回 404/403（路徑映射或內容上架狀態待釐清；非演算法問題）。
- 各補習班 host 的 `CustID` 對應待補。

## 專案結構

```
src/
  main/      main.js (Electron 主程序+IPC) · preload.js (白名單橋接)
  renderer/  index.html · style.css · renderer.js
  api/       eclass.js (端點) · moviesign.js (影片 Key 簽章, 已破解)
             keysign.js (登入 key, 伺服器不驗/保留相容) · machineid.js (MAC+主機名)
             parse.js (回應解析) · player.js (VLC)
test/        smoke.js (離線測試) · api-cli.js (CLI/抓包工具) · e2e-live.js (完整流程)
.github/workflows/  build-release.yml (三平台打包 + tag 發 release)
```

## 授權

MIT。僅限合法帳號之技術研究與自用。
