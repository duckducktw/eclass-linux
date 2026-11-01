# eclass-linux

eClass 補習班課程播放器的 **Linux 版重寫**（Electron + Node）。原程式 `eclass.exe` 是 Windows-only 的 VB6 程式（v1.3.4），本專案用 Node 重新實作其 API 客戶端與播放流程。

> ⚠️ 需自己有**合法補習班帳號**。本專案為技術研究 / 自用跨平台，不含任何破解授權的功能。

## 功能

- 所有 eClass API 端點（逆向自原 exe 字串表）：登入、班級列表、週次講義、影片列表、點數、取影片防盜鏈連結。
- 機器綁定：抓實體網卡 MAC + 主機名（對應原程式的 `mMac` 模組，過濾虛擬網卡）。
- 影片播放：直接呼叫系統 **VLC**（`/usr/bin/vlc`）播放帶 `expire/token` 的連結（原程式內嵌 axvlc/WMP，Linux 改外部 VLC 最穩）。
- Electron GUI + 純 CLI（`test/api-cli.js`）兩種操作方式。

## 安裝 / 執行

```bash
npm install
npm start          # 開 GUI
npm run smoke      # 離線單元測試（14 項，不連網）
# CLI 直接打 API（方便抓包）：
node test/api-cli.js login <host> <code> <stuSN> <stuPass>
```

需系統已裝 VLC：`sudo apt install vlc`

## 已知主機（各補習班各自部署同一套系統）

| 代號 | host |
|---|---|
| eclass | `svr1.eclass.com.tw` |
| handazyuku | `handazyuku.fortiddns.com` |
| faber | `hs.faber.com.tw` |
| jl | `makeup.jlweb.com.tw` |

影片存放：`<code>.s3.hicloud.net.tw`（hicloud S3）、`<code>-jl28122118.cdn.hinet.net`（hinet CDN）。

## API 端點（全部 GET）

| 端點 | 參數 | 用途 |
|---|---|---|
| `/CheckMac.aspx` | Code, StuSN, StuPass, MacID, ComputerName, **key** | 登入 + 綁機器 |
| `/StuLogin.aspx` | Code | 登入 |
| `/SaveStuLogin.aspx` | Code, Flag / StuSN, Version, CustID | 狀態/版本回報 |
| `/SaveStuLogout.aspx` | Code | 登出 |
| `/ClassList1.aspx` `/ClassList2.aspx` | Code | 班級列表 |
| `/MovieList.aspx` | Code, MovieID, ClassID | 影片列表 |
| `/GetClassWeekNote.aspx` | Code, WeekID | 週次講義 |
| `/GetMovieURLS3.aspx` `/GetMovieURLCDN.aspx` | Key2, Key, Movie, Code, GroupID | 取防盜鏈影片連結 |
| `/GetClassPoint.aspx` `/CheckPoint.aspx` | Code | 點數/進度 |

## ⚠️ 唯一卡關點：`key` 簽章還原

`CheckMac.aspx` 要帶一個 `key`（client 算的 MD5 防偽碼）。**沒有正確的 key，登入會被伺服器拒絕。**

原 exe 是 VB6 **p-code**（`VB5!` 簽章、無 ThunRTMain），MD5 初始常數非字面量 → **key 的拼接順序 + salt 無法純靜態還原**。負責計算的是 VB 模組 `mMD5`，字串層只看得到欄位名、看不到公式。

還原有兩條路：

- **A. 反編譯**：Windows 用 VB Decompiler (Pro) 開 `eclass.exe`，看 `mMD5` + `CheckMac` 呼叫處的 p-code。
- **B. 抓包反推**（推薦，最快）：VM 跑原程式登入，用 mitmproxy/Fiddler 抓 `CheckMac.aspx` 實際送出的 `key`，再用本專案工具暴力試候選公式：

  ```bash
  node test/api-cli.js brute <code> <stuSN> <stuPass> <macId> <computerName> <抓到的key>
  ```

  命中後把結果填進 `src/api/keysign.js`：改 `ACTIVE_RECIPE` 選對的公式，`SALT` 填對的 salt（或設環境變數 `ECLASS_RECIPE` / `ECLASS_SALT`）。

  候選公式已內建於 `keysign.js`（concat_all / salt_prefix / snpass_mac / sn_mac / concat_amp…）。exe 字串區出現過的可疑常數：`23893110`、`JL23705999`、`LocalUser/L060`。

## 原程式有、但本版「刻意不實作」的防護

原 exe 會用 WMI 偵測並**強制關閉錄影軟體**（OBS/oCam/ApowerREC/FlashBack/GameBar）、疊浮水印、攔鍵盤。這些是 DRM 側的反制，對自用跨平台播放沒必要，本版不移植。

## 待確認（需抓包對照）

- `key` 的確切 MD5 公式與 salt
- 各 aspx 回應的實際欄位格式（本版 `parse.js` 做容錯解析，欄位語義待補）
- `GetMovieURL*` 的 `Key` / `Key2` 來源（client 算還是前一步回傳）
- `Code` session token 的有效期；各補習班的 `CustID`

## 專案結構

```
src/
  main/      main.js (Electron 主程序+IPC) · preload.js (白名單橋接)
  renderer/  index.html · style.css · renderer.js
  api/       eclass.js (端點) · keysign.js (key 簽章, 可替換)
             machineid.js (MAC+主機名) · parse.js (回應解析) · player.js (VLC)
test/        smoke.js (離線測試) · api-cli.js (CLI/抓包工具)
```

## 授權

MIT。僅限合法帳號之技術研究與自用。
