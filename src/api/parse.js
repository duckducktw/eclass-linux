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

/** CheckMac 回應：判斷登入是否成功。不同部署回法不一，做寬鬆判斷 + 回傳原文。 */
function parseCheckMac(body) {
  const text = String(body).trim();
  const ok =
    /^(1|ok|true|success)/i.test(text) ||
    /登入成功|驗證成功/.test(text);
  const denied = /Access Denied|fail|error|錯誤|失敗/i.test(text);
  return { ok: ok && !denied, raw: text };
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
