/**
 * parse-core.js — 平台無關版回應解析 (UMD)。
 * 內容與 src/api/parse.js 相同，改成 UMD 供 WebView 使用。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EclassParse = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function splitRows(body, rowSep) {
    rowSep = rowSep || '<br/>';
    return String(body)
      .split(rowSep)
      .map(function (r) { return r.trim(); })
      .filter(function (r) { return r.length > 0; });
  }

  function splitCols(row, colSep) {
    colSep = colSep || ', ';
    return row.split(colSep).map(function (c) { return c.trim(); });
  }

  function extractMovieUrl(body) {
    const m = String(body).match(/https?:\/\/[^\s"'<>]+/);
    return m ? m[0] : null;
  }

  function parseCheckMac(body) {
    const text = String(body).trim();
    const codeMap = {
      '1': { ok: true, code: 'OK', msg: '登入成功' },
      '2': { ok: false, code: 'MACHINE_MISMATCH', msg: '機器不符，帳號已綁定其他裝置' },
      '-1': { ok: false, code: 'BAD_CREDENTIALS', msg: '帳號或密碼錯誤' },
    };
    if (codeMap[text]) {
      return Object.assign({}, codeMap[text], { raw: text });
    }
    return { ok: false, code: 'UNKNOWN', msg: '未知回應', raw: text };
  }

  function parseList(body, rowSep, colSep) {
    const rows = splitRows(body, rowSep).map(function (r) {
      return splitCols(r, colSep);
    });
    return { rows: rows, raw: String(body) };
  }

  return {
    splitRows: splitRows,
    splitCols: splitCols,
    extractMovieUrl: extractMovieUrl,
    parseCheckMac: parseCheckMac,
    parseList: parseList,
  };
});
