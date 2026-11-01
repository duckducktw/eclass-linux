'use strict';
/**
 * app.js — Android (Capacitor WebView) 的 UI 邏輯。
 * 不走 Electron IPC，直接用 window.EclassCore + CapacitorHttp adapter (platform-capacitor.js)。
 * 播放用內嵌 <video> 元素，點擊單一段落時把簽章 URL 設給 video.src。
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var show = function (el, obj) {
    el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  };

  var EclassCore = window.EclassCore.EclassCore;
  var KNOWN_HOSTS = window.EclassCore.KNOWN_HOSTS;
  var parse = window.EclassParse;
  var platform = window.EclassPlatform;

  var httpGet = platform.makeHttpGet();
  var client = null;
  var MACHINE = { macId: '00-11-22-33-44-55', computerName: 'android-device' };

  // 記住目前選到的 GroupID / ClassID，供影片列表與簽章使用
  var state = { groupId: null, classId: null, movieId: null };

  function connect(host, https) {
    client = new EclassCore({ httpGet: httpGet, host: host, https: https });
    try { localStorage.setItem('host', host); } catch (e) {}
    return client;
  }

  function currentHost() {
    var custom = $('hostCustom').value.trim();
    return custom || $('hostSelect').value;
  }

  // --- boot ----------------------------------------------------------------
  function boot() {
    return platform.getMachineId().then(function (m) {
      MACHINE = m;
      $('machine').textContent = 'MAC ' + m.macId + ' · ' + m.computerName;
      var sel = $('hostSelect');
      sel.innerHTML = '';
      Object.keys(KNOWN_HOSTS).forEach(function (name) {
        var o = document.createElement('option');
        o.value = KNOWN_HOSTS[name];
        o.textContent = name + ' (' + KNOWN_HOSTS[name] + ')';
        sel.appendChild(o);
      });
      try {
        if (localStorage.getItem('host')) $('hostCustom').value = localStorage.getItem('host');
        if (localStorage.getItem('code')) $('code').value = localStorage.getItem('code');
        if (localStorage.getItem('stuSN')) $('stuSN').value = localStorage.getItem('stuSN');
      } catch (e) {}
    });
  }

  // --- login ---------------------------------------------------------------
  $('btnLogin').onclick = function () {
    connect(currentHost(), $('useHttps').checked);
    var p = {
      code: $('code').value.trim(),
      stuSN: $('stuSN').value.trim(),
      stuPass: $('stuPass').value,
      macId: MACHINE.macId,
      computerName: MACHINE.computerName,
      key: '',
    };
    client.checkMac(p).then(function (r) {
      var parsed = parse.parseCheckMac(r.body);
      show($('loginOut'), { status: r.status, parsed: parsed, raw: r.body });
      if (parsed.ok) {
        try {
          localStorage.setItem('code', p.code);
          localStorage.setItem('stuSN', p.stuSN);
        } catch (e) {}
      }
    }).catch(function (e) { show($('loginOut'), 'ERROR: ' + e.message); });
  };

  $('btnLogout').onclick = function () {
    if (client && client.code) {
      client.saveStuLogout(client.code).then(function () {
        show($('loginOut'), '已登出');
      }).catch(function (e) { show($('loginOut'), 'ERROR: ' + e.message); });
    } else {
      show($('loginOut'), '尚未登入');
    }
  };

  // --- class / unit / movie list ------------------------------------------
  function requireClient() {
    if (!client || !client.auth) {
      throw new Error('請先登入');
    }
  }

  $('btnClass1').onclick = function () {
    try { requireClient(); } catch (e) { return show($('listOut'), 'ERROR: ' + e.message); }
    client.classList1().then(function (r) {
      var rows = parse.splitRows(r.body);
      renderClassList(rows);
      show($('listOut'), '科目數: ' + rows.length);
    }).catch(function (e) { show($('listOut'), 'ERROR: ' + e.message); });
  };

  // 科目清單格式: "ClassID;GroupID;,班級名"
  function renderClassList(rows) {
    var box = $('classList');
    box.innerHTML = '';
    rows.forEach(function (row) {
      var semi = row.split(';');
      var classId = semi[0];
      var groupId = semi[1];
      var name = row.substring(row.indexOf(',') + 1);
      var btn = document.createElement('button');
      btn.className = 'listitem';
      btn.textContent = name;
      btn.onclick = function () {
        state.classId = classId;
        state.groupId = groupId;
        loadUnits(groupId);
      };
      box.appendChild(btn);
    });
  }

  // ClassList2: ClassID 欄位要填 GroupID (實測)
  function loadUnits(groupId) {
    show($('listOut'), '載入單元中...');
    client.classList2(groupId).then(function (r) {
      var rows = parse.splitRows(r.body);
      var box = $('unitList');
      box.innerHTML = '';
      rows.forEach(function (row) {
        // 單元名,GroupID,MovieID,段數
        var cols = row.split(',');
        var name = cols[0];
        var movieId = cols[2];
        var segs = cols[3];
        var btn = document.createElement('button');
        btn.className = 'listitem';
        btn.textContent = name + '  (' + (segs || '?') + ' 段)';
        btn.onclick = function () {
          state.movieId = movieId;
          loadSegments(movieId, groupId);
        };
        box.appendChild(btn);
      });
      show($('listOut'), '單元數: ' + rows.length);
    }).catch(function (e) { show($('listOut'), 'ERROR: ' + e.message); });
  }

  // MovieList: 段序,段ID,可看
  function loadSegments(movieId, groupId) {
    show($('listOut'), '載入分段中...');
    client.movieList(movieId, groupId).then(function (r) {
      var rows = parse.splitRows(r.body);
      var box = $('segList');
      box.innerHTML = '';
      rows.forEach(function (row) {
        var cols = row.split(',');
        var seq = cols[0];
        var segId = cols[1];
        var watchable = cols[2];
        var btn = document.createElement('button');
        btn.className = 'listitem';
        btn.textContent = '第 ' + seq + ' 段' + (watchable === 'True' ? '' : ' (不可看)');
        btn.disabled = watchable !== 'True';
        btn.onclick = function () { playSegment(segId, groupId); };
        box.appendChild(btn);
      });
      show($('listOut'), '分段數: ' + rows.length);
    }).catch(function (e) { show($('listOut'), 'ERROR: ' + e.message); });
  }

  // --- 取簽章 URL + <video> 播放 -------------------------------------------
  function playSegment(segId, groupId) {
    show($('playOut'), '取得簽章 URL 中... (段ID=' + segId + ')');
    client.getMovieUrlCDN({ movie: segId, groupId: groupId }).then(function (r) {
      var url = parse.extractMovieUrl(r.body);
      if (!url) {
        show($('playOut'), '取得失敗: ' + String(r.body).slice(0, 200));
        return;
      }
      $('movieUrl').value = url;
      var v = $('player');
      v.src = url;
      v.load();
      var playPromise = v.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () { /* 需使用者手勢時忽略 */ });
      }
      show($('playOut'), '播放中:\n' + url);
      v.scrollIntoView({ behavior: 'smooth' });
    }).catch(function (e) { show($('playOut'), 'ERROR: ' + e.message); });
  }

  // 手動貼 URL 播放
  $('btnPlayUrl').onclick = function () {
    var url = $('movieUrl').value.trim();
    if (!url) return show($('playOut'), '沒有連結可播');
    var v = $('player');
    v.src = url;
    v.load();
    v.play().catch(function () {});
    show($('playOut'), '播放中:\n' + url);
  };

  boot().catch(function (e) { show($('loginOut'), 'boot error: ' + e.message); });
})();
