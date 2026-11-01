'use strict';
/**
 * eClass API client — 端點全部逆向自 eclass.exe (VB6, v1.3.4) 的 UTF-16 字串表。
 * 所有端點皆為 GET，參數帶在 query string，Content-Type: application/x-www-form-urlencoded。
 * 原程式用 WinHttp.WinHttpRequest.5.1；此處用 Node 內建 https/http。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { computeKey } = require('./keysign');
const { computeMovieKey } = require('./moviesign');

/**
 * 已知主機（各補習班各自部署同一套系統）。硬編於 exe。
 */
const KNOWN_HOSTS = {
  eclass: 'svr1.eclass.com.tw',
  handazyuku: 'handazyuku.fortiddns.com',
  faber: 'hs.faber.com.tw',
  jl: 'makeup.jlweb.com.tw',
};

class EclassClient {
  /**
   * @param {object} opts
   * @param {string} opts.host   伺服器主機 (如 svr1.eclass.com.tw)
   * @param {boolean} [opts.https=true]
   * @param {string}  [opts.version='1.3.4'] 回報給伺服器的 client 版本
   */
  constructor(opts = {}) {
    this.host = opts.host;
    this.https = opts.https !== false;
    this.version = opts.version || '1.3.4';
    this.code = opts.code || null; // 補習班代碼 (如 0102)，多數端點必帶
    this.timeout = opts.timeout || 15000;
    // 實測發現：資料端點普遍需要帶「身分三件組」(StuSN+StuPass+MacID)，
    // 伺服器不發 session cookie，靠每次請求帶帳密驗證。登入成功後存起來重用。
    this.auth = null; // { stuSN, stuPass, macId }
  }

  /** 帶身分的 query 片段 (資料端點都要) */
  _authQs() {
    if (!this.auth) return '';
    return EclassClient.qs([
      ['StuSN', this.auth.stuSN],
      ['StuPass', this.auth.stuPass],
      ['MacID', this.auth.macId],
    ]);
  }

  _base() {
    return `${this.https ? 'https' : 'http'}://${this.host}`;
  }

  /** 低階 GET，回傳 { status, body } */
  _get(path) {
    const url = new URL(this._base() + path);
    const lib = url.protocol === 'https:' ? https : http;
    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // 原程式 UA 是 WinHttp 預設；伺服器一般不檢查，保留可覆寫
        'User-Agent': 'eclass-linux/0.1.0',
      },
      timeout: this.timeout,
    };
    return new Promise((resolve, reject) => {
      const req = lib.request(url, options, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('request timeout')));
      req.end();
    });
  }

  static qs(params) {
    // 依原程式參數順序逐一 encode。null/undefined 省略。
    return params
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
  }

  // ---------------------------------------------------------------------------
  // 1. 登入 / 機器綁定
  // ---------------------------------------------------------------------------
  /**
   * CheckMac.aspx — 登入 + 綁定機器。
   * GET /CheckMac.aspx?Code=&StuSN=&StuPass=&MacID=&ComputerName=&key=
   * @param {object} p
   * @param {string} p.code     課程/補習班 Code
   * @param {string} p.stuSN    學號
   * @param {string} p.stuPass  密碼
   * @param {string} p.macId    網卡 MAC
   * @param {string} p.computerName
   */
  async checkMac(p) {
    const key = computeKey('CheckMac', {
      code: p.code,
      stuSN: p.stuSN,
      stuPass: p.stuPass,
      macId: p.macId,
      computerName: p.computerName,
    });
    const qs = EclassClient.qs([
      ['Code', p.code],
      ['StuSN', p.stuSN],
      ['StuPass', p.stuPass],
      ['MacID', p.macId],
      ['ComputerName', p.computerName],
      ['key', key],
    ]);
    const r = await this._get(`/CheckMac.aspx?${qs}`);
    // 實測：成功回 "1"，帳密錯回 "-1"。key 目前伺服器未驗(空 key 也回 1)，
    // 但保留 key 計算以相容其他部署。成功後存 auth 供資料端點重用。
    if (String(r.body).trim() === '1') {
      this.auth = { stuSN: p.stuSN, stuPass: p.stuPass, macId: p.macId };
      this.code = p.code;
    }
    return r;
  }

  /** StuLogin.aspx?Code= */
  stuLogin(code) {
    return this._get(`/StuLogin.aspx?Code=${encodeURIComponent(code)}`);
  }

  /** SaveStuLogin.aspx?Code=&Flag= */
  saveStuLogin(code, flag) {
    return this._get(
      `/SaveStuLogin.aspx?${EclassClient.qs([['Code', code], ['Flag', flag]])}`
    );
  }

  /** SaveStuLogin.aspx?StuSN=&Version=&CustID= (回報版本/補習班) */
  saveStuLoginMeta(stuSN, custId) {
    return this._get(
      `/SaveStuLogin.aspx?${EclassClient.qs([
        ['StuSN', stuSN],
        ['Version', this.version],
        ['CustID', custId],
      ])}`
    );
  }

  /** SaveStuLogout.aspx?Code= */
  saveStuLogout(code) {
    return this._get(`/SaveStuLogout.aspx?Code=${encodeURIComponent(code)}`);
  }

  // ---------------------------------------------------------------------------
  // 2. 科目 / 班級 / 影片列表  (全部需帶身分三件組; 實測於 makeup.jlweb.com.tw)
  // ---------------------------------------------------------------------------
  /**
   * ClassList1.aspx — 回「科目清單」。
   * 回應格式(實測): `ClassID;?;,科目名<br/>`  例: `239;256;,竹115秋高一英文EEC班黃(二)`
   * 需帶 Code + StuSN + StuPass + MacID，否則回空。
   */
  classList1() {
    return this._get(
      `/ClassList1.aspx?Code=${encodeURIComponent(this.code)}&${this._authQs()}`
    );
  }

  /**
   * ClassList2.aspx — 回某科目下的「單元/堂數清單」。
   * 需帶 ClassID(來自 ClassList1)。
   * 回應格式(實測): `單元名,ClassID,MovieID,段數<br/>`
   *   例: `第一課L1,239,1648,4`  → 該課 MovieID=1648，共 4 段
   * @param {string|number} classId
   */
  classList2(classId) {
    return this._get(
      `/ClassList2.aspx?${EclassClient.qs([
        ['Code', this.code],
        ['ClassID', classId],
      ])}&${this._authQs()}`
    );
  }

  /**
   * MovieList.aspx — 回某單元的「分段清單」。
   * 需帶 MovieID(來自 ClassList2) + ClassID。
   * 回應格式(實測): `段序,段ID,可看<br/>`  例: `1,4463,True`
   * @param {string|number} movieId  ClassList2 給的 MovieID (如 1648)
   * @param {string|number} classId
   */
  movieList(movieId, classId) {
    return this._get(
      `/MovieList.aspx?${EclassClient.qs([
        ['Code', this.code],
        ['MovieID', movieId],
        ['ClassID', classId],
      ])}&${this._authQs()}`
    );
  }

  /**
   * GetClassWeekNote.aspx — 週次講義 (此部署回「找不到資源」，可能未啟用)。
   * @param {string|number} weekId
   */
  getClassWeekNote(weekId) {
    return this._get(
      `/GetClassWeekNote.aspx?${EclassClient.qs([
        ['Code', this.code],
        ['WeekID', weekId],
      ])}&${this._authQs()}`
    );
  }

  // ---------------------------------------------------------------------------
  // 3. 影片串流 URL (防盜鏈) — ✅ Key 演算法已破解 (見 moviesign.js)
  //    Key = md5_hex( "2370" + StuSN + "4277" + Movie + Key2 )；Key2 任意。
  //    回應: "-1"缺身分 / "-2"Key空 / "-3"Key錯 / "http://...?expire=&token="成功。
  // ---------------------------------------------------------------------------
  /**
   * 內部：組影片端點 URL 並自動簽 Key。
   * @param {'GetMovieURLCDN'|'GetMovieURLS3'} endpoint
   * @param {object} p { movie(段ID,來自MovieList), groupId, key2? }
   */
  _getMovieUrl(endpoint, p) {
    if (!this.auth || !this.auth.stuSN) {
      throw new Error('必須先 checkMac() 登入 (需要 StuSN 來簽 Key)');
    }
    const { key, key2 } = computeMovieKey({
      stuSN: this.auth.stuSN,
      movie: p.movie,
      key2: p.key2, // 省略則自動隨機
    });
    return this._get(
      `/${endpoint}.aspx?${EclassClient.qs([
        ['Key2', key2],
        ['Key', key],
        ['Movie', p.movie],
        ['Code', this.code],
        ['GroupID', p.groupId],
      ])}&${this._authQs()}`
    );
  }

  /**
   * GetMovieURLS3.aspx — hicloud S3 版 (部分補習班用)。
   * @param {object} p { movie(段ID), groupId, key2? }
   */
  getMovieUrlS3(p) {
    return this._getMovieUrl('GetMovieURLS3', p);
  }

  /**
   * GetMovieURLCDN.aspx — hinet CDN 版。成功回傳帶時效簽章的影片 URL。
   * @param {object} p { movie(段ID,來自MovieList第二欄), groupId(來自ClassList1第二欄), key2? }
   */
  getMovieUrlCDN(p) {
    return this._getMovieUrl('GetMovieURLCDN', p);
  }

  // ---------------------------------------------------------------------------
  // 4. 點數 / 進度  (實測回單一數字)
  // ---------------------------------------------------------------------------
  /** GetClassPoint.aspx — 回點數 (實測回 "0")。需帶身分。 */
  getClassPoint() {
    return this._get(
      `/GetClassPoint.aspx?Code=${encodeURIComponent(this.code)}&${this._authQs()}`
    );
  }

  /** CheckPoint.aspx — 檢查某段是否可看/扣點 (實測帶 MovieID 回 "1")。 */
  checkPoint(movieId, classId) {
    return this._get(
      `/CheckPoint.aspx?${EclassClient.qs([
        ['Code', this.code],
        ['MovieID', movieId],
        ['ClassID', classId],
      ])}&${this._authQs()}`
    );
  }
}

module.exports = { EclassClient, KNOWN_HOSTS };
