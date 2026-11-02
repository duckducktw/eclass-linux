'use strict';
/**
 * eclass.js — Node (Electron) adapter。
 *
 * 端點/簽章/解析邏輯已抽到平台無關的 src/core/eclass-core.js (注入式 httpGet)。
 * 本檔只負責：用 Node 內建 https/http 實作 httpGet，並把 EclassCore 包成
 * 原本的 EclassClient 介面 (main.js 用的那組方法)，維持桌面版行為不變。
 *
 * 端點全部逆向自 eclass.exe (VB6, v1.3.4)；GET + query string。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { EclassCore, KNOWN_HOSTS } = require('../core/eclass-core');

/**
 * 建一個 Node 版 httpGet(url)=>Promise<{status,body}>。
 * @param {object} cfg { timeout }
 */
function makeNodeHttpGet(cfg) {
  const timeout = (cfg && cfg.timeout) || 15000;
  return function nodeHttpGet(fullUrl) {
    const url = new URL(fullUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'eclass-linux/0.1.1',
      },
      timeout: timeout,
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
  };
}

/**
 * EclassClient — Electron 用的 adapter，內部委派給 EclassCore。
 * 保留原本 main.js 依賴的方法與 .code / .auth 屬性。
 */
class EclassClient {
  constructor(opts = {}) {
    this.timeout = opts.timeout || 15000;
    this.core = new EclassCore({
      httpGet: makeNodeHttpGet({ timeout: this.timeout }),
      host: opts.host,
      https: opts.https !== false,
      version: opts.version || '1.3.4',
      code: opts.code || null,
    });
  }

  // 讓舊程式讀 client.code / client.auth 仍可用 (委派給 core)
  get code() { return this.core.code; }
  set code(v) { this.core.code = v; }
  get auth() { return this.core.auth; }
  set auth(v) { this.core.auth = v; }
  get host() { return this.core.host; }

  static qs(params) { return EclassCore.qs(params); }

  checkMac(p) { return this.core.checkMac(p); }
  classList1() { return this.core.classList1(); }
  classList2(classId) { return this.core.classList2(classId); }
  movieList(movieId, classId) { return this.core.movieList(movieId, classId); }
  getClassPoint() { return this.core.getClassPoint(); }
  checkPoint(movieId, classId) { return this.core.checkPoint(movieId, classId); }
  getMovieUrlCDN(p) { return this.core.getMovieUrlCDN(p); }
  getMovieUrlS3(p) { return this.core.getMovieUrlS3(p); }
  saveStuLogout(code) { return this.core.saveStuLogout(code); }
  saveStuLogin(p) { return this.core.saveStuLogin(p); }

  /** GetClassWeekNote.aspx — 週次講義 (此部署多半未啟用)。保留給 main.js IPC。 */
  getClassWeekNote(weekId) {
    return this.core._get(
      `/GetClassWeekNote.aspx?${EclassCore.qs([
        ['Code', this.core.code],
        ['WeekID', weekId],
      ])}&${this.core._authQs()}`
    );
  }
}

module.exports = { EclassClient, KNOWN_HOSTS };
