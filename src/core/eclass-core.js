/**
 * eclass-core.js — 平台無關的 eClass API client (UMD, 注入式 httpGet)。
 *
 * 設計：把原 src/api/eclass.js 的端點/簽章/身分邏輯整段抽出，不再綁定 Node https。
 * 建構時注入一個 httpGet 函式：
 *     httpGet(url: string) => Promise<{ status: number, body: string }>
 *   - Electron 用 Node https 實作 (見 src/api/eclass.js adapter)
 *   - Capacitor 用 CapacitorHttp.get 實作 (見 www/js/platform-capacitor.js)
 *
 * 簽章改用平台無關的 moviesign-core (純 JS MD5)，演算法與原本一致。
 * CheckMac 的 key 維持可空 (伺服器不驗)；此 core 預設送空 key。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./moviesign-core'));
  } else {
    root.EclassCore = factory(root.EclassMovieSign);
  }
})(typeof self !== 'undefined' ? self : this, function (movieSign) {
  'use strict';
  const computeMovieKey = movieSign.computeMovieKey;

  const KNOWN_HOSTS = {
    eclass: 'svr1.eclass.com.tw',
    handazyuku: 'handazyuku.fortiddns.com',
    faber: 'hs.faber.com.tw',
    jl: 'makeup.jlweb.com.tw',
  };

  function qs(params) {
    return params
      .filter(function (pair) { return pair[1] !== undefined && pair[1] !== null; })
      .map(function (pair) { return pair[0] + '=' + encodeURIComponent(pair[1]); })
      .join('&');
  }

  /**
   * @param {object} opts
   * @param {function} opts.httpGet  注入的 (url)=>Promise<{status,body}>
   * @param {string}   opts.host
   * @param {boolean}  [opts.https=true]
   * @param {string}   [opts.code]
   * @param {string}   [opts.version='1.3.4']
   */
  function EclassCore(opts) {
    opts = opts || {};
    if (typeof opts.httpGet !== 'function') {
      throw new Error('EclassCore 需要注入 httpGet(url)=>{status,body}');
    }
    this.httpGet = opts.httpGet;
    this.host = opts.host;
    this.https = opts.https !== false;
    this.version = opts.version || '1.3.4';
    this.code = opts.code || null;
    // 身分三件組，CheckMac 成功後存起來供資料端點重用
    this.auth = null; // { stuSN, stuPass, macId }
  }

  EclassCore.qs = qs;
  EclassCore.KNOWN_HOSTS = KNOWN_HOSTS;

  EclassCore.prototype._base = function () {
    return (this.https ? 'https' : 'http') + '://' + this.host;
  };

  EclassCore.prototype._authQs = function () {
    if (!this.auth) return '';
    return qs([
      ['StuSN', this.auth.stuSN],
      ['StuPass', this.auth.stuPass],
      ['MacID', this.auth.macId],
    ]);
  };

  /** 低階 GET：組完整 URL 後交給注入的 httpGet */
  EclassCore.prototype._get = function (path) {
    return this.httpGet(this._base() + path);
  };

  // --- 1. 登入 / 機器綁定 ---------------------------------------------------
  /**
   * CheckMac.aspx — 登入 + 綁定機器。key 伺服器不驗，預設送空。
   * @param {object} p { code, stuSN, stuPass, macId, computerName, key? }
   */
  EclassCore.prototype.checkMac = function (p) {
    const self = this;
    const query = qs([
      ['Code', p.code],
      ['StuSN', p.stuSN],
      ['StuPass', p.stuPass],
      ['MacID', p.macId],
      ['ComputerName', p.computerName],
      ['key', p.key || ''],
    ]);
    return this._get('/CheckMac.aspx?' + query).then(function (r) {
      if (String(r.body).trim() === '1') {
        self.auth = { stuSN: p.stuSN, stuPass: p.stuPass, macId: p.macId };
        self.code = p.code;
      }
      return r;
    });
  };

  EclassCore.prototype.saveStuLogout = function (code) {
    return this._get('/SaveStuLogout.aspx?Code=' + encodeURIComponent(code));
  };

  // --- 2. 科目 / 班級 / 影片列表 -------------------------------------------
  EclassCore.prototype.classList1 = function () {
    return this._get(
      '/ClassList1.aspx?Code=' + encodeURIComponent(this.code) + '&' + this._authQs()
    );
  };

  EclassCore.prototype.classList2 = function (classId) {
    return this._get(
      '/ClassList2.aspx?' +
        qs([['Code', this.code], ['ClassID', classId]]) +
        '&' + this._authQs()
    );
  };

  EclassCore.prototype.movieList = function (movieId, classId) {
    return this._get(
      '/MovieList.aspx?' +
        qs([['Code', this.code], ['MovieID', movieId], ['ClassID', classId]]) +
        '&' + this._authQs()
    );
  };

  EclassCore.prototype.getClassPoint = function () {
    return this._get(
      '/GetClassPoint.aspx?Code=' + encodeURIComponent(this.code) + '&' + this._authQs()
    );
  };

  EclassCore.prototype.checkPoint = function (movieId, classId) {
    return this._get(
      '/CheckPoint.aspx?' +
        qs([['Code', this.code], ['MovieID', movieId], ['ClassID', classId]]) +
        '&' + this._authQs()
    );
  };

  // --- 3. 影片串流 URL (防盜鏈) --------------------------------------------
  /**
   * 內部：組影片端點 URL 並自動簽 Key。
   * @param {'GetMovieURLCDN'|'GetMovieURLS3'} endpoint
   * @param {object} p { movie, groupId, key2? }
   */
  EclassCore.prototype._getMovieUrl = function (endpoint, p) {
    if (!this.auth || !this.auth.stuSN) {
      return Promise.reject(new Error('必須先 checkMac() 登入 (需要 StuSN 來簽 Key)'));
    }
    const signed = computeMovieKey({
      stuSN: this.auth.stuSN,
      movie: p.movie,
      key2: p.key2,
    });
    return this._get(
      '/' + endpoint + '.aspx?' +
        qs([
          ['Key2', signed.key2],
          ['Key', signed.key],
          ['Movie', p.movie],
          ['Code', this.code],
          ['GroupID', p.groupId],
        ]) +
        '&' + this._authQs()
    );
  };

  EclassCore.prototype.getMovieUrlCDN = function (p) {
    return this._getMovieUrl('GetMovieURLCDN', p);
  };

  EclassCore.prototype.getMovieUrlS3 = function (p) {
    return this._getMovieUrl('GetMovieURLS3', p);
  };

  return { EclassCore: EclassCore, KNOWN_HOSTS: KNOWN_HOSTS, qs: qs };
});
