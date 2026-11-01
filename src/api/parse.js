'use strict';
/**
 * parse.js — eClass aspx 回應解析。
 * 原程式用 VB6 Split 解回應；觀察到的分隔符：'<br/>' (列)、', ' (欄)。
 * 實際欄位意義需抓包對照（見 README 待確認表），此處提供容錯解析骨架。
 */

/** 把一段 aspx 回應依列/欄切開 */
function splitRows(body, rowSep = '<br/>') {
  return String(body)
    .split(rowSep)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

function splitCols(row, colSep = ', ') {
  return row.split(colSep).map((c) => c.trim());
}

/** 影片 URL 回應通常是直接一行 URL（含 ?expire=&token=）。抽出第一個 http(s) 連結。 */
function extractMovieUrl(body) {
  const m = String(body).match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

/** CheckMac 回應碼 (實測於 makeup.jlweb.com.tw):
 *   "1"  = 登入成功 (此 MAC 已綁定本帳號)
 *   "2"  = 機器不符 (帳號已綁定其他 MAC；換機需補習班後台解綁)
 *   "-1" = 帳號或密碼錯誤
 *   其他 HTML = 伺服器端執行階段錯誤 (參數缺漏等)
 */
function parseCheckMac(body) {
  const text = String(body).trim();
  const codeMap = {
    '1': { ok: true, code: 'OK', msg: '登入成功' },
    '2': { ok: false, code: 'MACHINE_MISMATCH', msg: '機器不符，帳號已綁定其他裝置' },
    '-1': { ok: false, code: 'BAD_CREDENTIALS', msg: '帳號或密碼錯誤' },
  };
  if (codeMap[text]) return { ...codeMap[text], raw: text };
  return { ok: false, code: 'UNKNOWN', msg: '未知回應', raw: text };
}

/** 通用列表解析（班級/影片/週次），回傳二維陣列 + 原文供偵錯 */
function parseList(body, rowSep = '<br/>', colSep = ', ') {
  const rows = splitRows(body, rowSep).map((r) => splitCols(r, colSep));
  return { rows, raw: String(body) };
}

module.exports = {
  splitRows,
  splitCols,
  extractMovieUrl,
  parseCheckMac,
  parseList,
};
