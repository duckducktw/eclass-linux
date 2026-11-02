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

  /**
   * SaveStuLogin.aspx — 扣點補課。原生按「確定補課」後送此請求，扣 1 點、
   * 該課進入三天觀看期（CheckPoint 之後回 "0" = 已開通免再扣）。
   * 逆向自原生：送 Code,MovieID,ClassID,Flag + 身分(StuSN/StuPass/MacID)。
   * 實測：每堂課第一次送扣 1 點；已在三天窗內再送不重複扣（伺服器端判斷）。
   * ⚠️ 會真的扣點，務必由使用者主動點「扣點」按鈕才呼叫。
   * @param {object} p { movieId, classId, flag? } flag 預設 '0'（原生查到的值）
   */
  EclassCore.prototype.saveStuLogin = function (p) {
    return this._get(
      '/SaveStuLogin.aspx?' +
        qs([
          ['Code', this.code],
          ['MovieID', p.movieId],
          ['ClassID', p.classId],
          ['Flag', p.flag != null ? p.flag : '0'],
        ]) +
        '&' + this._authQs()
    );
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
   *
   * ✅ 關鍵 (2026-11-02 抓包原生 app 成功播放 + 206 下載實證)：
   *   - `Movie` 參數必須帶 `.mp4` 副檔名 (段ID.mp4)，否則 CDN 回 404/403。
   *   - `Key` 的 MD5 也要用含 `.mp4` 的字串算，token 才對 `.mp4` 路徑有效。
   *   - `GroupID` 必須「留空」(不帶班級 ID)，否則 CDN 路徑多一層目錄 → 404。
   *   最終 CDN URL = https://{host}/{段ID}.mp4?expire=&token=  (根目錄, 無 GroupID 層)。
   *
   * @param {'GetMovieURLCDN'|'GetMovieURLS3'} endpoint
   * @param {object} p { movie (段ID,可帶或不帶.mp4), groupId?, key2? }
   */
  EclassCore.prototype._getMovieUrl = function (endpoint, p) {
    if (!this.auth || !this.auth.stuSN) {
      return Promise.reject(new Error('必須先 checkMac() 登入 (需要 StuSN 來簽 Key)'));
    }
    // 段ID 正規化：確保帶 .mp4 副檔名 (原生 app 行為)
    var seg = String(p.movie);
    var movieParam = /\.mp4$/i.test(seg) ? seg : seg + '.mp4';
    // GroupID 必須留空 (實測鐵律)：帶班級 ID → CDN 路徑多一層 /{gid}/{seg}.mp4 → 404 NoSuchKey；
    //   留空 → /{seg}.mp4 → 206 OK。呼叫端(UI/IPC)常順手把 groupId 傳進來，這裡一律忽略，
    //   避免再度 404。逃生閥：只有明確 forceGroupId===true 時才採用 p.groupId（保留給未來
    //   別家補習班 host 可能需要帶 GroupID 的情況，JL 實測必須空）。
    var groupId =
      p.forceGroupId === true && p.groupId != null ? p.groupId : '';
    const signed = computeMovieKey({
      stuSN: this.auth.stuSN,
      movie: movieParam,
      key2: p.key2,
    });
    return this._get(
      '/' + endpoint + '.aspx?' +
        qs([
          ['Key2', signed.key2],
          ['Key', signed.key],
          ['Movie', movieParam],
          ['Code', this.code],
          ['GroupID', groupId],
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
