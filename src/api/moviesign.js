'use strict';
/**
 * moviesign.js — 計算 GetMovieURLCDN / GetMovieURLS3 的 `Key` 防盜鏈簽章。
 *
 * ✅ 已完全逆向自 eclass.exe (native VB6, v1.3.4) 並用伺服器 oracle 驗證通過
 *    (makeup.jlweb.com.tw 回傳合法簽章 URL)。
 *
 * 演算法 (反組譯 0x6fad90 URL-build + hash 0x7142a0 = 標準 MD5；
 *          2026-11-02 抓包原生播放 + 206 下載實證修正)：
 *
 *     Movie = 段ID + ".mp4"   ← 必須帶副檔名！
 *     Key   = md5_hex_lower( "2370" + StuSN + "4277" + Movie + Key2 )   (Movie 已含 .mp4)
 *     Key2 = 任意數字字串 (原程式用 CStr(Fix(Rnd()*1000000))，伺服器不綁定其值)
 *     GroupID = ""  (空字串；帶班級 ID 會讓 CDN 路徑多一層目錄 → 404)
 *
 *   - "2370" / "4277" 為 exe 內硬編 salt (UTF-16 字串常數 0x415440 / 0x415450)。
 *   - 中間夾的動態值是 **StuSN(學號)** (反組譯為 this 物件 vtable +0x508 呼叫)。
 *   - hash 輸入以 **ASCII/Latin1 byte** 餵入 MD5 (非 UTF-16)；輸出取 **小寫全長 hex**。
 *   - `Movie` = MovieList 回傳的「段ID」+ ".mp4" (非 ClassList2 的 MovieID)。
 *   - 最終 CDN URL = https://{host}/{段ID}.mp4?expire=&token=  (根目錄, 無 GroupID 層)。
 *   - token 是對「含 .mp4 的路徑」簽的；若 Movie 不帶 .mp4，token 與 .mp4 路徑不符 → CDN WAF 403。
 *
 * 伺服器回應碼 (GetMovieURLCDN.aspx):
 *     -1  缺身分 (StuSN/StuPass/MacID 任一缺)
 *     -2  Key 空
 *     -3  Key 不正確
 *     http://... ?expire=&token=   成功，帶時效簽章的影片 URL
 *
 * 注意：拿到合法 URL 後能否真的下到檔，取決於該補習班帳號的影片是否已上架到
 *       對應 CDN/S3 bucket；簽章正確但內容不存在時 CDN 回 S3 NoSuchKey (404)。
 */
const crypto = require('crypto');

const SALT1 = '2370';
const SALT2 = '4277';

/**
 * 計算影片 Key。
 * @param {object} p
 * @param {string|number} p.stuSN  學號 (登入用的 StuSN)
 * @param {string|number} p.movie  段ID (MovieList 回傳的第二欄)
 * @param {string|number} [p.key2] Key2；省略則自動產生隨機 6 位數
 * @returns {{ key: string, key2: string }}
 */
function computeMovieKey(p) {
  const key2 =
    p.key2 !== undefined && p.key2 !== null
      ? String(p.key2)
      : String(Math.floor(Math.random() * 1000000));
  const input = `${SALT1}${p.stuSN}${SALT2}${p.movie}${key2}`;
  // ASCII/latin1 bytes → MD5 → 小寫 hex (全長 32)
  const key = crypto.createHash('md5').update(input, 'latin1').digest('hex');
  return { key, key2 };
}

module.exports = { computeMovieKey, SALT1, SALT2 };
