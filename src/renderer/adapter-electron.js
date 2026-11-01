'use strict';
/**
 * adapter-electron.js — 把 Electron 的 window.eclass.* (preload IPC) 包成
 * 共用 UI 期望的統一 facade window.ECLASS。
 * 平台差異全收斂在這層，ui.js 不碰平台細節。
 */
(function () {
  var E = window.eclass; // preload 暴露的 IPC 白名單

  // 友善名稱（補習班）→ 對應 known host。key 要與 core 的 KNOWN_HOSTS 對齊。
  var FRIENDLY = {
    jl: '升學文理補習班 (JL)',
    eclass: 'eClass 總站',
    handazyuku: '漢達補習班',
    faber: '法柏補習班',
  };

  function friendlyList(knownHosts) {
    var out = [];
    // JL 放第一個（最常用），其餘依序
    var order = ['jl', 'eclass', 'handazyuku', 'faber'];
    order.forEach(function (k) {
      if (knownHosts[k]) out.push({ key: k, name: FRIENDLY[k] || k, host: knownHosts[k] });
    });
    Object.keys(knownHosts).forEach(function (k) {
      if (order.indexOf(k) === -1) out.push({ key: k, name: FRIENDLY[k] || k, host: knownHosts[k] });
    });
    return out;
  }

  var machine = { macId: '00-11-22-33-44-55', computerName: 'linux-pc' };

  window.ECLASS = {
    platform: 'electron',
    hasExternalPlayer: true, // 桌面可用 VLC fallback

    bootInfo: function () {
      return E.bootInfo().then(function (info) {
        machine = info.machine || machine;
        return {
          hosts: friendlyList(info.knownHosts || {}),
          machine: machine,
          vlc: info.vlc,
          saved: { host: info.savedHost, code: info.savedCode, stuSN: info.savedStuSN },
        };
      });
    },

    connect: function (host, https) { return E.connect(host, https); },

    // 自動登入：並行試所有補習班，回 { hits:[{key,host,name}] }
    loginAuto: function (p) {
      return E.loginAuto({ code: p.code, stuSN: p.stuSN, stuPass: p.stuPass })
        .then(function (r) {
          var hits = (r.hits || []).map(function (h) {
            return { key: h.key, host: h.host, name: h.name, label: FRIENDLY[h.key] || h.key };
          });
          return { hits: hits };
        });
    },

    // 從通過的補習班選定一間 → 綁定為當前 client
    selectHost: function (p) {
      window.__code = p.code;
      return E.selectHost({ host: p.host, code: p.code, stuSN: p.stuSN });
    },

    classList1: function () {
      return E.classList1(window.__code).then(function (r) { return r.rows || []; });
    },
    classList2: function (groupId) {
      return E.classList2(groupId).then(function (r) { return r.rows || []; });
    },
    movieList: function (movieId, groupId) {
      return E.movieList(window.__code, movieId, groupId).then(function (r) { return r.rows || []; });
    },
    getMovieUrl: function (segId, groupId) {
      return E.getMovieUrl('cdn', { code: window.__code, movie: segId, groupId: groupId })
        .then(function (r) { return { ok: !!r.url, url: r.url, status: r.status, raw: r.raw }; });
    },
    playExternal: function (url, fs) { return E.play(url, !!fs); },
    logout: function () { return E.logout(); },
    openExternal: function (url) { return E.openExternal(url); },
  };
})();
