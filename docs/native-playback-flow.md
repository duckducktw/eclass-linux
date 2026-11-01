# 原生 eclass.exe —「取得影片並播放」全鏈路還原

> 逆向自 `eclass.exe`（native VB6, v1.3.4）。位址為 image base 0x400000 下的 VA。
> 本文件記錄**原生 app 的真實行為**，供對照我們的跨平台重寫版（重寫版刻意簡化、不扣點）。

## 總覽：使用者點一堂課 → 影片播放

```
點課程單元
   ↓
[1] CheckPoint.aspx          ← 查「這堂要不要扣點 / 能不能看」
   ↓
[2] 彈確認框 (扣點/不扣點/點數不足)   ← 扣點決策全在 client
   ↓ (使用者按「確定補課」)
[3] GetMovieURLCDN 或 GetMovieURLS3   ← 取防盜鏈簽章 URL
   ↓
[4] 組最終 URL (+ .mp4 / LocalUser 路徑規則)
   ↓
[5] 丟 VLC ActiveX (axvlc.dll) 播放
```

---

## [1] CheckPoint —— 扣點決策旗標（0x701ebf 起）

URL（GET，全部明文 query）：
```
https://{host}/CheckPoint.aspx?Code={code}&StuSN={sn}&StuPass={pass}&MovieID={movie}&ClassID={gid}&key={簽章}
```
- 回傳與字串 `"1"` 比對（`__vbaStrCmp` @ 0x702149）
- 實測：此端點**恆回 `"1"`**，連不存在的 MovieID 也是 → 伺服器端幾乎不把關，真正的門檻在 client 的彈框

## [2] 扣點確認框（0x702156 分支）

| CheckPoint 回傳 | 分支 | 行為 |
|---|---|---|
| `== "1"`（要扣點） | 先查 `GetClassPoint` 餘額 | 餘額足 → 彈「**補這堂課將扣 1 點，確定要補課?**」<br>餘額 0 → 「**點數不足, 無法補課**」直接擋 |
| `!= "1"`（免扣） | — | 彈「**補這堂課不扣點，確定要補課?**」 |

- 對話框標題：`學生雲端學習`
- 字串位址：`點數不足,無法補課`@0x70222a、`將扣1點`@0x702245、`不扣點`@0x702345
- **扣點 = client 端自願行為**：按「確定」後 client 才送扣點請求。伺服器對「取連結」本身不扣（實測連取 3 次餘額恆 8）
- `GetClassPoint.aspx?Code=&StuSN=&StuPass=&ClassID=&key=` → 回單一數字（餘額），`__vbaStrR8` 當數值用，顯示在標籤 `lblPointID`；取不到 fallback `"0"`

## [3][4] 取影片 URL + 路徑組裝

### CDN 來源（GetMovieURLCDN，主要，0x6fad90 區）
```
GET https://{host}/GetMovieURLCDN.aspx?Key2={rnd}&Key={簽章}&Movie={段ID}&Code=&GroupID=&StuSN=&StuPass=&MacID=
→ 回完整簽章 URL: https://{code}-{節點}.cdn.hinet.net/{GroupID}/{段ID}?expire=&token=
```
- `Key = md5_latin1( "2370" + StuSN + "4277" + Movie + Key2 )`（小寫 hex）
- `Key2 = CStr(Fix(Rnd()*1000000))`（隨機 6 位數，伺服器不綁定其值）
- 回傳有 `https://`→`http://` 的 Replace（`ord712`）；另有 `/LocalUser/L` 或 `/LocalUser/W` 分支（依某 flag）

### S3 來源（GetMovieURLS3，備援，0x70cc00 區）
```
GET https://{host}/GetMovieURLS3.aspx?...
→ 回傳用 ";" / Split (ord711) 拆成陣列，檢查 UBound==2 (必須 3 欄)
   不足 → "讀取資料發生錯誤"
→ 最終路徑用 __vbaVarCat 串上 ".mp4" (@0x70ccf4)
```
- 此部署（JL）用 CDN，S3 端點回 404

## [5] 播放 —— VLC ActiveX（axvlc.dll）

- 透過 VB late-binding（`__vbaLateIdCallLd` / `__vbaLateIdSt`）呼叫 VLC COM 物件的 vtable 方法：
  - `+0x4c4`（取/設 input）、`+0x4b8`（set URL）、`+0x40`/`+0x470`/`+0x474`（play/state）
- 全域設定：`[0x75b034]` = CDN host、`[0x75b04c]` = 播放狀態（`"10"`/`"11"`）
- 原生用 axvlc 是因 2000 年代 IE 無 HTML5 `<video>`；URL 本身是標準 HTTP 直鏈

---

## 與重寫版的差異（為何我們不扣點）

| 步驟 | 原生 app | 我們的重寫版 |
|---|---|---|
| CheckPoint | 打，依回傳彈扣點框 | **不打** |
| 扣點確認 | 按確定送扣點請求 | **不送**（無此流程） |
| 取連結 | GetMovieURLCDN | 同（算 Key 相同） |
| 播放 | VLC ActiveX | HTML5 `<video>` |

**結論**：扣點是原生 client 自己彈框、自己送請求的自願行為。重寫版直接「算 Key → 取連結 → `<video>` 播放」，跳過 CheckPoint 確認流程，因此**看幾次都不扣點**，且取連結伺服器本就不扣。
