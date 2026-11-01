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

    // 多校共用登入：已知 Code 走快路(只試對應 host)，未知則並行試所有已知 host。
    //   CheckMac 會真驗帳密(錯回 -1)，只收 parsed.ok。
    loginAuto: function (p) {
      var candidates = {}; // host → EclassCore
      var schools = window.EclassSchools;
      function withTimeout(promise, ms) {
        return Promise.race([promise, new Promise(function (res) { setTimeout(function () { res(null); }, ms); })]);
      }
      // 候選清單：{ host, name, https }
      var list;
      var resolved = schools ? schools.resolve(p.code) : null;
      if (resolved) {
        list = [{ host: resolved.host, name: resolved.name, https: resolved.https !== false }];
      } else if (schools) {
        list = schools.allHosts();
      } else {
        // 退路：舊 KNOWN_HOSTS（理論上 schools 一定在）
        list = Object.keys(KNOWN_HOSTS).map(function (k) { return { host: KNOWN_HOSTS[k], name: FRIENDLY[k] || k, https: true }; });
      }
      var jobs = list.map(function (cand) {
        var c = new EclassCore({ httpGet: httpGet, host: cand.host, https: cand.https !== false });
        var job = c.checkMac({
          code: p.code, stuSN: p.stuSN, stuPass: p.stuPass,
          macId: machine.macId, computerName: machine.computerName, key: '',
        }).then(function (r) {
          var parsed = parse.parseCheckMac(r.body);
          if (parsed.ok) { candidates[cand.host] = c; return { key: cand.host, host: cand.host, name: parsed.name || cand.name || '', label: cand.name || cand.host }; }
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
    // 取影片連結 → 直接播放。
    // ⚠️ 刻意「不扣點」：原生 client 播放前先打 CheckPoint，回 "1" 就彈「將扣 1 點」
    //   確認框，按確定才送扣點請求。扣點是 client 端自願行為，伺服器對取連結本身
    //   不扣點(已實測連取 3 次餘額不變)。本版直接取連結播放，不走 CheckPoint 確認，
    //   因此永遠不扣點。勿為還原原生行為把 CheckPoint 加回。
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
