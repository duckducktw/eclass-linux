/**
 * moviesign-core.js — 平台無關版的影片 Key 簽章 (UMD)。
 * 演算法與 src/api/moviesign.js 完全相同，只是把 Node crypto 換成純 JS md5Latin1，
 * 讓它能在 Capacitor WebView 執行。演算法本身不變：
 *     Key  = md5_hex_lower( "2370" + StuSN + "4277" + Movie + Key2 )
 *     Key2 = 任意數字字串
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./md5'));
  } else {
    root.EclassMovieSign = factory(root.EclassMD5);
  }
})(typeof self !== 'undefined' ? self : this, function (md5mod) {
  'use strict';
  const md5Latin1 = md5mod.md5Latin1;

  const SALT1 = '2370';
  const SALT2 = '4277';

  /**
   * @param {object} p
   * @param {string|number} p.stuSN
   * @param {string|number} p.movie
   * @param {string|number} [p.key2]
   * @returns {{ key: string, key2: string }}
   */
  function computeMovieKey(p) {
    const key2 =
      p.key2 !== undefined && p.key2 !== null && String(p.key2) !== ''
        ? String(p.key2)
        : String(Math.floor(Math.random() * 1000000));
    const input = SALT1 + p.stuSN + SALT2 + p.movie + key2;
    const key = md5Latin1(input);
    return { key: key, key2: key2 };
  }

  return { computeMovieKey: computeMovieKey, SALT1: SALT1, SALT2: SALT2 };
});
