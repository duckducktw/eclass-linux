'use strict';
/**
 * adapter-capacitor.js — 把平台無關 core (window.EclassCore) + CapacitorHttp
 * 包成共用 UI 期望的統一 facade window.ECLASS。
 * 與 adapter-electron.js 提供相同介面，ui.js 兩平台共用。
 */
(function () {
  var EclassCore = window.EclassCore.EclassCore;
  var KNOWN_HOSTS = window.EclassCore.KNOWN_HOSTS;
  var parse = window.EclassParse;
  var platform = window.EclassPlatform;

  var FRIENDLY = {
    jl: '升學文理補習班 (JL)',
    eclass: 'eClass 總站',
    handazyuku: '漢達補習班',
    faber: '法柏補習班',
  };

  function friendlyList(knownHosts) {
    var out = [];
    var order = ['jl', 'eclass', 'handazyuku', 'faber'];
    order.forEach(function (k) {
      if (knownHosts[k]) out.push({ key: k, name: FRIENDLY[k] || k, host: knownHosts[k] });
    });
    Object.keys(knownHosts).forEach(function (k) {
      if (order.indexOf(k) === -1) out.push({ key: k, name: FRIENDLY[k] || k, host: knownHosts[k] });
    });
    return out;
  }

  var httpGet = platform.makeHttpGet();
  var client = null;
  var machine = { macId: '00-11-22-33-44-55', computerName: 'android-device' };

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  window.ECLASS = {
    platform: 'capacitor',
    hasExternalPlayer: false, // Android 只有內嵌 <video>

    bootInfo: function () {
      return platform.getMachineId().then(function (m) {
        machine = m;
        return {
          hosts: friendlyList(KNOWN_HOSTS),
          machine: m,
          vlc: false,
          saved: { host: lsGet('host'), code: lsGet('code'), stuSN: lsGet('stuSN') },
        };
      });
    },

    connect: function (host, https) {
      client = new EclassCore({ httpGet: httpGet, host: host, https: https !== false });
      lsSet('host', host);
      return Promise.resolve({ ok: true, host: host });
    },

    // 自動登入：並行對所有已知補習班試 CheckMac，回通過清單。
    loginAuto: function (p) {
      var candidates = {}; // host → EclassCore
      var keys = Object.keys(KNOWN_HOSTS);
      function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise(function (res) { setTimeout(function () { res(null); }, ms); })]);
      }
      var jobs = keys.map(function (key) {
        var host = KNOWN_HOSTS[key];
        var c = new EclassCore({ httpGet: httpGet, host: host, https: true });
        var job = c.checkMac({
          code: p.code, stuSN: p.stuSN, stuPass: p.stuPass,
          macId: machine.macId, computerName: machine.computerName, key: '',
        }).then(function (r) {
          var parsed = parse.parseCheckMac(r.body);
          if (parsed.ok) { candidates[host] = c; return { key: key, host: host, name: parsed.name || '', label: FRIENDLY[key] || key }; }
          return null;
        }).catch(function () { return null; });
        return withTimeout(job, 9500);
      });
      return Promise.all(jobs).then(function (res) {
        window.__autoCandidates = candidates;
        return { hits: res.filter(Boolean) };
      });
    },

    // 從通過的補習班選定一間 → 綁定為當前 client
    selectHost: function (p) {
      var c = (window.__autoCandidates || {})[p.host];
      if (!c) return Promise.reject(new Error('候選補習班已失效，請重新登入'));
      client = c;
      lsSet('host', p.host); lsSet('code', p.code); lsSet('stuSN', p.stuSN);
      return Promise.resolve({ ok: true, host: p.host });
    },

    classList1: function () {
      return client.classList1().then(function (r) { return parse.splitRows(r.body); });
    },
    classList2: function (groupId) {
      return client.classList2(groupId).then(function (r) { return parse.splitRows(r.body); });
    },
    movieList: function (movieId, groupId) {
      return client.movieList(movieId, groupId).then(function (r) { return parse.splitRows(r.body); });
    },
    getMovieUrl: function (segId, groupId) {
      return client.getMovieUrlCDN({ movie: segId, groupId: groupId }).then(function (r) {
        var url = parse.extractMovieUrl(r.body);
        return { ok: !!url, url: url, status: r.status, raw: r.body };
      });
    },
    playExternal: function () { return Promise.reject(new Error('Android 無外部播放器')); },
    logout: function () {
      if (client && client.code) return client.saveStuLogout(client.code).then(function () { return { ok: true }; });
      return Promise.resolve({ ok: true });
    },
    openExternal: function (url) { window.open(url, '_blank'); return Promise.resolve({ ok: true }); },
  };
})();
