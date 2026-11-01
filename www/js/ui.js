'use strict';
/**
 * ui.js — 兩平台共用的向導式 UI 邏輯。
 * 只依賴 window.ECLASS facade（由 adapter-electron.js / adapter-capacitor.js 提供）
 * 與 window.EclassParse（欄位切割）。不碰任何平台細節。
 *
 * 流程：選補習班 → 登入 → (自動) 科目清單 → 點科目 → 單元 → 點單元 → 分段 → 點段直接播。
 * 全程點擊，無需手填任何 ID / Key。
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var API = window.ECLASS;
  var parse = window.EclassParse || null;

  // 切欄：Electron adapter 回字串列、Capacitor 也回字串列 → 統一在這裡切
  function cols(row, sep) { return String(row).split(sep || ',').map(function (s) { return s.trim(); }); }

  var state = { hosts: [], host: null, https: true, code: '', name: '' };

  function setStep(n) {
    // 顯示到第 n 步（1=登入 2=課程 3=播放），之後的步驟隱藏
    ['stepLogin', 'stepBrowse', 'stepPlay'].forEach(function (id, i) {
      var el = $(id);
      if (!el) return;
      el.classList.toggle('active', i + 1 <= n);
    });
  }

  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  function busy(on, label) {
    var b = $('busy');
    b.style.display = on ? 'flex' : 'none';
    if (label) $('busyLabel').textContent = label;
  }

  // --- boot: 補習班卡片 ------------------------------------------------------
  function boot() {
    return API.bootInfo().then(function (info) {
      state.hosts = info.hosts;
      var wrap = $('hostCards');
      wrap.innerHTML = '';
      info.hosts.forEach(function (h) {
        var card = document.createElement('button');
        card.className = 'hostcard';
        card.innerHTML = '<div class="hc-name"></div><div class="hc-host"></div>';
        card.querySelector('.hc-name').textContent = h.name;
        card.querySelector('.hc-host').textContent = h.host;
        card.onclick = function () { selectHost(h, card); };
        wrap.appendChild(card);
      });
      // 還原上次
      if (info.saved && info.saved.code) $('code').value = info.saved.code;
      if (info.saved && info.saved.stuSN) $('stuSN').value = info.saved.stuSN;
      // 預選上次 host，否則第一個
      var savedHost = info.saved && info.saved.host;
      var pick = null;
      if (savedHost) pick = info.hosts.filter(function (h) { return h.host === savedHost; })[0];
      if (!pick) pick = info.hosts[0];
      if (pick) {
        var idx = info.hosts.indexOf(pick);
        selectHost(pick, wrap.children[idx]);
      }
      if (info.machine) {
        $('machine').textContent = '裝置 ' + (info.machine.computerName || '') + ' · ' + (info.machine.macId || '');
      }
    });
  }

  function selectHost(h, cardEl) {
    state.host = h.host;
    $('hostCards').querySelectorAll('.hostcard').forEach(function (c) { c.classList.remove('sel'); });
    if (cardEl) cardEl.classList.add('sel');
    $('advHost').value = ''; // 選了預設就清掉自訂
  }

  // --- login -----------------------------------------------------------------
  $('btnLogin').onclick = function () {
    var adv = $('advHost').value.trim();
    var host = adv || state.host;
    if (!host) return toast('請先選一間補習班', 'err');
    var code = $('code').value.trim();
    var stuSN = $('stuSN').value.trim();
    var stuPass = $('stuPass').value;
    if (!code || !stuSN || !stuPass) return toast('請填 Code、學號、密碼', 'err');

    state.host = host; state.code = code; window.__code = code;
    busy(true, '登入中…');
    API.login({ host: host, https: state.https, code: code, stuSN: stuSN, stuPass: stuPass })
      .then(function (r) {
        busy(false);
        if (r.ok) {
          state.name = r.name || '';
          $('who').textContent = r.name ? ('哈囉，' + r.name) : '登入成功';
          toast('登入成功', 'ok');
          setStep(2);
          loadClasses();
        } else {
          toast('登入失敗：' + (humanError(r)), 'err');
        }
      })
      .catch(function (e) { busy(false); toast('登入錯誤：' + e.message, 'err'); });
  };

  function humanError(r) {
    if (r && r.msg) return r.msg;
    if (r && r.status >= 500) return '伺服器錯誤（多半是補習班選錯）';
    return '帳號或密碼有誤';
  }

  $('btnLogout').onclick = function () {
    API.logout().then(function () {
      $('who').textContent = '';
      setStep(1);
      toast('已登出');
    });
  };

  // --- 科目 → 單元 → 分段 (全自動鏈) ----------------------------------------
  function loadClasses() {
    busy(true, '載入課程…');
    API.classList1().then(function (rows) {
      busy(false);
      var box = $('classList'); box.innerHTML = '';
      if (!rows.length) { box.innerHTML = '<div class="empty">沒有課程</div>'; return; }
      rows.forEach(function (row) {
        // "ClassID;GroupID;,班級名"
        var semi = String(row).split(';');
        var groupId = semi[1];
        var name = String(row).substring(String(row).indexOf(',') + 1);
        var disabled = /\[X\]/.test(name);
        addItem(box, name.replace(/\[X\]/, ' (停用)'), disabled, function (el) {
          selectOne(box, el);
          loadUnits(groupId);
          $('unitList').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });
    }).catch(function (e) { busy(false); toast('載入課程失敗：' + e.message, 'err'); });
  }

  function loadUnits(groupId) {
    var box = $('unitList'); box.innerHTML = '<div class="empty">載入中…</div>';
    $('segList').innerHTML = '';
    API.classList2(groupId).then(function (rows) {
      box.innerHTML = '';
      if (!rows.length) { box.innerHTML = '<div class="empty">此課程沒有單元</div>'; return; }
      rows.forEach(function (row) {
        var c = cols(row); // 單元名,GroupID,MovieID,段數
        var name = c[0], movieId = c[2], segs = c[3];
        addItem(box, name + (segs ? '  · ' + segs + ' 段' : ''), false, function (el) {
          selectOne(box, el);
          loadSegs(movieId, groupId);
          $('segList').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });
    }).catch(function (e) { toast('載入單元失敗：' + e.message, 'err'); });
  }

  function loadSegs(movieId, groupId) {
    var box = $('segList'); box.innerHTML = '<div class="empty">載入中…</div>';
    API.movieList(movieId, groupId).then(function (rows) {
      box.innerHTML = '';
      if (!rows.length) { box.innerHTML = '<div class="empty">沒有分段</div>'; return; }
      rows.forEach(function (row) {
        var c = cols(row); // 段序,段ID,可看
        var seq = c[0], segId = c[1], watchable = c[2] === 'True';
        addItem(box, '第 ' + seq + ' 段' + (watchable ? '' : ' (不可看)'), !watchable, function (el) {
          selectOne(box, el);
          play(segId, groupId);
        });
      });
    }).catch(function (e) { toast('載入分段失敗：' + e.message, 'err'); });
  }

  // --- 播放 ------------------------------------------------------------------
  function play(segId, groupId) {
    setStep(3);
    busy(true, '取得影片…');
    $('stepPlay').scrollIntoView({ behavior: 'smooth' });
    API.getMovieUrl(segId, groupId).then(function (r) {
      busy(false);
      if (!r.ok || !r.url) {
        toast('這段影片還沒上架（伺服器沒有檔案）', 'err');
        $('playHint').textContent = '取得連結成功但 CDN 上找不到影片檔，通常是老師還沒上傳這段。';
        return;
      }
      $('playHint').textContent = '';
      var v = $('player');
      v.src = r.url;
      v.load();
      var pr = v.play();
      if (pr && pr.catch) pr.catch(function () {});
      $('curUrl').value = r.url;
    }).catch(function (e) { busy(false); toast('播放錯誤：' + e.message, 'err'); });
  }

  // 桌面：用外部 VLC 開目前連結（Android 無此鈕）
  if ($('btnVlc')) {
    if (!API.hasExternalPlayer) { $('btnVlc').style.display = 'none'; }
    else $('btnVlc').onclick = function () {
      var u = $('curUrl').value.trim();
      if (!u) return toast('沒有連結');
      API.playExternal(u, false).catch(function (e) { toast('VLC: ' + e.message, 'err'); });
    };
  }

  // --- 小工具 ----------------------------------------------------------------
  function addItem(box, label, disabled, onClick) {
    var b = document.createElement('button');
    b.className = 'listitem' + (disabled ? ' disabled' : '');
    b.textContent = label;
    b.disabled = !!disabled;
    if (!disabled) b.onclick = function () { onClick(b); };
    box.appendChild(b);
  }
  function selectOne(box, el) {
    box.querySelectorAll('.listitem').forEach(function (c) { c.classList.remove('sel'); });
    el.classList.add('sel');
  }

  setStep(1);
  boot().catch(function (e) { toast('初始化失敗：' + e.message, 'err'); });
})();
