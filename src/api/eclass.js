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
    this.code = null; // session token, 由 CheckMac/StuLogin 成功後取得
    this.timeout = opts.timeout || 15000;
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
  // 2. 班級 / 週次 / 影片列表
  // ---------------------------------------------------------------------------
  /** ClassList1.aspx?Code= */
  classList1(code) {
    return this._get(`/ClassList1.aspx?Code=${encodeURIComponent(code)}`);
  }

  /** ClassList2.aspx?Code= */
  classList2(code) {
    return this._get(`/ClassList2.aspx?Code=${encodeURIComponent(code)}`);
  }

  /** MovieList.aspx?Code=&MovieID=&ClassID= */
  movieList(code, movieId, classId) {
    return this._get(
      `/MovieList.aspx?${EclassClient.qs([
        ['Code', code],
        ['MovieID', movieId],
        ['ClassID', classId],
      ])}`
    );
  }

  /** GetClassWeekNote.aspx?Code=&WeekID= */
  getClassWeekNote(code, weekId) {
    return this._get(
      `/GetClassWeekNote.aspx?${EclassClient.qs([
        ['Code', code],
        ['WeekID', weekId],
      ])}`
    );
  }

  // ---------------------------------------------------------------------------
  // 3. 影片串流 URL (防盜鏈)
  // ---------------------------------------------------------------------------
  /**
   * GetMovieURLS3.aspx?Key2=&Key=&Movie=&Code=&GroupID=
   * 回傳帶 ?expire=&token= 的影片連結 (hicloud S3)
   */
  getMovieUrlS3(p) {
    return this._get(
      `/GetMovieURLS3.aspx?${EclassClient.qs([
        ['Key2', p.key2],
        ['Key', p.key],
        ['Movie', p.movie],
        ['Code', p.code],
        ['GroupID', p.groupId],
      ])}`
    );
  }

  /** GetMovieURLCDN.aspx?... (hinet CDN 版本) */
  getMovieUrlCDN(p) {
    return this._get(
      `/GetMovieURLCDN.aspx?${EclassClient.qs([
        ['Key2', p.key2],
        ['Key', p.key],
        ['Movie', p.movie],
        ['Code', p.code],
        ['GroupID', p.groupId],
      ])}`
    );
  }

  // ---------------------------------------------------------------------------
  // 4. 點數 / 進度
  // ---------------------------------------------------------------------------
  /** GetClassPoint.aspx?Code= */
  getClassPoint(code) {
    return this._get(`/GetClassPoint.aspx?Code=${encodeURIComponent(code)}`);
  }

  /** CheckPoint.aspx?Code= */
  checkPoint(code) {
    return this._get(`/CheckPoint.aspx?Code=${encodeURIComponent(code)}`);
  }
}

module.exports = { EclassClient, KNOWN_HOSTS };
