# eclass-linux — 運作原理與破解結論

> 本文件是整個專案的「結論總表」。想知道「到底能不能無限看、怎麼辦到的、有什麼前提」，看這份就夠。
> 技術細節與逆向過程見 `docs/native-playback-flow.md`（附錄 A–P）。
> 最後更新：2026-11-02。

---

## 一句話結論

**只要帳號登入成功（CheckMac 回 `1`）且影片已上架，無論扣點與否，都能無限取得、播放、下載影片。**
扣點機制在 CDN 層形同虛設——它只是補習班後台的「觀看權限記帳」，擋不住直接取連結。

---

## 為什麼扣點擋不住（實證）

| 測試 | 課程 | 扣點狀態 | 結果 |
|---|---|---|---|
| 未開通課 | 262/1552（段4783） | CheckPoint=1（**沒扣點**） | HTTP 206，3.60GB 完整下載 ✅ |
| 未開通課 | 256/1573（段4517） | CheckPoint=1（**沒扣點**） | HTTP 206，3.38GB ✅ |
| 已開通課 | 239/1648（段4463/4/5） | 已扣點（三天窗內） | HTTP 206 ✅ |
| 已開通課 | 256/1572（段4516） | 已扣點 | HTTP 206，3.03GB ✅ |

- **取連結（GetMovieURLCDN.aspx）伺服器端不扣點**：連取數次，餘額不動。
- **CDN 只驗 token 對不對 `.mp4` 路徑**，完全不管帳號有沒有扣過點。
- 結論：扣點純粹是商業記帳，對「直接取連結下載」沒有任何約束力。

---

## 取連結的正確公式（破解核心）

這是 2026-11-02 透過抓包原生 app 成功播放還原出來的，**三處關鍵**（之前全錯）：

```
# 1. 先登入拿身分
CheckMac.aspx?Code=<代碼>&StuSN=<學號>&StuPass=<密碼>&MacID=<綁定MAC>&ComputerName=<任意>&key=
  → 回 "1" = 登入成功；"2" = 機器(MAC)不符；"-1" = 帳密錯

# 2. 列出課程 → 單元 → 分段（拿到「段ID」）
ClassList1 → ClassList2(ClassID) → MovieList(MovieID, ClassID)
  MovieList 回 "段序,段ID,True<br/>..."，段ID 才是真正要的 Movie

# 3. 取影片連結（★三處關鍵★）
GetMovieURLCDN.aspx?Key2=<隨機數>&Key=<簽章>&Movie=<段ID>.mp4&Code=<代碼>&GroupID=&<身分>
  ★ Movie 參數要帶 .mp4            （例：4463.mp4，不是 4463）
  ★ Key = md5_hex( "2370"+StuSN+"4277"+<段ID>.mp4+Key2 )  ← 用含 .mp4 的字串算
  ★ GroupID 要留空                 （帶班級ID → CDN 路徑多一層 → 404）
  → 回 https://<host>/<段ID>.mp4?expire=<時戳>&token=<簽章>

# 4. 直接 GET 那條 URL → CDN 回 206，就是影片檔
```

**為什麼之前一直失敗**：舊版用 `/<GroupID>/<段ID>`（無副檔名）→ 404；硬加 `.mp4` 但 token 是對無副檔路徑簽的 → CDN WAF 403。真相是 token 必須對「含 .mp4 的路徑」簽，Movie 帶 .mp4 一起算 Key 才對得上。

---

## 三個前提 / 邊界（誠實說清楚）

### 1. 帳號要有效（CheckMac 回 1）
需要正確的 **Code + 學號 + 密碼 + 綁定的 MacID**。
- eClass 把帳號綁到「第一次登入用的網卡 MAC」，換機器送不同 MAC → 回 `2`（機器不符）、登不進去。
- 本專案把 MacID **寫死** 成 0102 帳號綁定的 `00-11-22-33-44-55`（實測唯一回 1 的值），所以任何裝置跑都認得。
- **換帳號** → 要改成那個帳號綁定的 MAC（`src/api/machineid.js` 的 `PINNED_MAC` + `www/js/platform-capacitor.js` 的 `PINNED_MAC`）。

### 2. 影片要真的上架
取連結會成功，但**檔案在不在 bucket 是另一回事**。
- 已驗證有檔的段：4463/4464/4465/4516/4783/4517。
- 若老師根本沒上傳某段 → 取連結成功但 CDN 回 `404 NoSuchKey`（UI 顯示「未上架」）。這不是能繞的，是檔案不存在。

### 3. 只在 JL（代碼 0102）這家完整驗證過
- 多校 host 清單（`src/core/schools.js`）裡其他補習班，多數伺服器已死（timeout/refused）。
- 目前確認「活著 + 取連結/簽章邏輯相同」的只有 **makeup.jlweb.com.tw（JL）**。
- 別家要重新驗證登入與取連結是否同一套。

---

## 扣點按鈕（補完整原生行為，非必要）

雖然扣點擋不住下載，但為了**完整還原原生 app 的補課流程**，UI 仍提供扣點：
- 分段清單上方「扣點狀態列」載入時查 `CheckPoint`：
  - 回 `0` = 已開通（三天觀看期內）→ 綠標「免再扣點」
  - 回 `1` = 未開通 → 顯示「扣點補課（扣 1 點）」按鈕，**二次確認**才送 `SaveStuLogin`
- `SaveStuLogin(MovieID,ClassID,Flag)` 扣 1 點，該課進三天觀看期；已在窗內再送不重複扣（伺服器判斷）。
- **注意**：這純粹是還原原生行為 / 給想正常補課的人用。要純下載的話完全不需要扣點。

---

## 功能總覽（全平台）

| 功能 | Electron（桌面） | Android（Capacitor） |
|---|---|---|
| 多校共用登入（Code→host） | ✅ | ✅ |
| 自動登入（並行試 host） | ✅ | ✅ |
| 課程/單元/分段瀏覽 | ✅ | ✅ |
| 播放（內嵌 / 外部 VLC） | ✅ 內嵌+VLC | ✅ 內嵌 |
| **下載影片** | ✅ 串流+續傳+進度 | ✅ 交系統下載管理員 |
| **狀態顯示**（可觀看/未開放） | ✅ | ✅ |
| **扣點補課按鈕** | ✅ | ✅ |
| MacID 寫死綁定值 | ✅ | ✅ |

---

## 關鍵檔案

| 檔案 | 作用 |
|---|---|
| `src/core/eclass-core.js` | 核心 API（含 `_getMovieUrl` 的 .mp4 公式、`saveStuLogin` 扣點） |
| `src/api/moviesign.js` | `Key` 簽章（MD5，含 .mp4） |
| `src/api/machineid.js` | MacID 寫死值（`PINNED_MAC`） |
| `src/core/schools.js` | 多校 Code→host 註冊表 |
| `src/main/main.js` | Electron IPC（含 `api:download`、`api:deductPoint`） |
| `src/renderer/ui.js` / `www/js/ui.js` | UI 邏輯（播放/下載/扣點/狀態） |
| `www/js/platform-capacitor.js` | Android 平台層（MacID 寫死、CapacitorHttp） |
| `docs/native-playback-flow.md` | 完整逆向過程（附錄 A–P） |

---

## 免責

本工具為個人學習 / 自己付費帳號的跨平台存取用途。請勿散佈他人帳號內容或商業侵權。
