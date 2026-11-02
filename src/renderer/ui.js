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
    // 一頁一頁：只顯示當前步（1=登入 2=瀏覽 3=播放）
    ['stepLogin', 'stepBrowse', 'stepPlay'].forEach(function (id, i) {
      var el = $(id);
      if (!el) return;
      el.classList.toggle('active', i + 1 === n);
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

  // --- boot ------------------------------------------------------------------
  function boot() {
    return API.bootInfo().then(function (info) {
      // 還原上次輸入
      if (info.saved && info.saved.code) $('code').value = info.saved.code;
      if (info.saved && info.saved.stuSN) $('stuSN').value = info.saved.stuSN;
      if (info.machine) {
        $('machine').textContent = '裝置 ' + (info.machine.computerName || '') + ' · ' + (info.machine.macId || '');
      }
    });
  }

  // --- login：自動試所有補習班 ---------------------------------------------
  function proceed(name, host) {
    state.name = name || '';
    $('who').textContent = name ? ('哈囉，' + name) : '登入成功';
    toast('登入成功', 'ok');
    setStep(2);
    loadClasses();
  }

  $('btnLogin').onclick = function () {
    var code = $('code').value.trim();
    var stuSN = $('stuSN').value.trim();
    var stuPass = $('stuPass').value;
    if (!code || !stuSN || !stuPass) return toast('請填代碼、學號、密碼', 'err');
    state.code = code; window.__code = code;

    busy(true, '登入中…（自動尋找補習班）');
    API.loginAuto({ code: code, stuSN: stuSN, stuPass: stuPass })
      .then(function (r) {
        var hits = r.hits || [];
        if (hits.length === 0) {
          busy(false);
          toast('登入失敗：代碼/學號/密碼有誤，或不屬於任何已知補習班', 'err');
          return;
        }
        if (hits.length === 1) {
          // 唯一命中 → 直接選定
          return API.selectHost({ host: hits[0].host, code: code, stuSN: stuSN })
            .then(function () { busy(false); proceed(hits[0].name, hits[0].host); });
        }
        // 多間命中 → 彈窗讓使用者選
        busy(false);
        showPicker(hits, code, stuSN);
      })
      .catch(function (e) { busy(false); toast('登入錯誤：' + e.message, 'err'); });
  };

  // 多補習班命中時的選擇彈窗
  function showPicker(hits, code, stuSN) {
    var mask = $('picker');
    var list = $('pickerList');
    list.innerHTML = '';
    hits.forEach(function (h) {
      var b = document.createElement('button');
      b.className = 'listitem';
      b.innerHTML = '<div class="hc-name"></div><div class="hc-host"></div>';
      b.querySelector('.hc-name').textContent = (h.label || h.key) + (h.name ? '　(' + h.name + ')' : '');
      b.querySelector('.hc-host').textContent = h.host;
      b.onclick = function () {
        mask.style.display = 'none';
        busy(true, '進入中…');
        API.selectHost({ host: h.host, code: code, stuSN: stuSN })
          .then(function () { busy(false); proceed(h.name, h.host); })
          .catch(function (e) { busy(false); toast('選擇失敗：' + e.message, 'err'); });
      };
      list.appendChild(b);
    });
    mask.style.display = 'flex';
  }
  if ($('pickerCancel')) $('pickerCancel').onclick = function () { $('picker').style.display = 'none'; };

  $('btnLogout').onclick = function () {
    API.logout().then(function () {
      $('who').textContent = '';
      setStep(1);
      toast('已登出');
    });
  };

  // --- 一頁一頁導航：課程 → 單元 → 分段 --------------------------------------
  function showPage(id) {
    ['pageClasses', 'pageUnits', 'pageSegs'].forEach(function (p) {
      var el = $(p); if (el) el.classList.toggle('active', p === id);
    });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }

  // 返回鍵
  if ($('backToClasses')) $('backToClasses').onclick = function () { showPage('pageClasses'); };
  if ($('backToUnits')) $('backToUnits').onclick = function () { showPage('pageUnits'); };
  if ($('backToSegs')) $('backToSegs').onclick = function () {
    var v = $('player'); if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); }
    setStep(2); showPage('pageSegs');
  };

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
        // 班級名裡的 [X] 只是課程標題標記，不代表學生不能看 —— 原版客戶端對這類班級
        // 照常開放進入。之前誤把 [X] 當停用旗標、整個班級鎖死 (disabled) 導致點不進去。
        // 一律可點；真正能不能看由段層級的「可看」狀態 + CDN 回應決定。
        addItem(box, name, false, function () {
          $('crumbClass').textContent = name;
          loadUnits(groupId);
          showPage('pageUnits');
        });
      });
      showPage('pageClasses');
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
        addItem(box, name + (segs ? '  · ' + segs + ' 段' : ''), false, function () {
          $('crumbUnit').textContent = name;
          loadSegs(movieId, groupId);
          showPage('pageSegs');
        });
      });
    }).catch(function (e) { toast('載入單元失敗：' + e.message, 'err'); });
  }

  function loadSegs(movieId, groupId) {
    var box = $('segList'); box.innerHTML = '<div class="empty">載入中…</div>';
    API.movieList(movieId, groupId).then(function (rows) {
      box.innerHTML = '';
      if (!rows.length) { box.innerHTML = '<div class="empty">沒有分段</div>'; return; }
      // 扣點狀態列（純提示、不擋播放）
      renderPointBar(box, movieId, groupId);
      rows.forEach(function (row) {
        var c = cols(row); // 段序,段ID,可看
        var seq = c[0], segId = c[1], watchable = c[2] === 'True';
        // 狀態標籤：可看(綠) / 未上架(灰)。實際「檔案在不在」會在點播/下載時由 CDN 回應確認。
        var status = watchable
          ? { cls: 'ok', text: '可觀看' }
          : { cls: 'off', text: '未開放' };
        addSegItem(box, segId, '第 ' + seq + ' 段', status, !watchable,
          function () { // 播放
            selectAllSeg(box, segId, 'play');
            play(segId, groupId, '單元' + movieId + '_第' + seq + '段');
          },
          function () { // 下載
            downloadSeg(segId, groupId, '單元' + movieId + '_第' + seq + '段', box);
          }
        );
      });
    }).catch(function (e) { toast('載入分段失敗：' + e.message, 'err'); });
  }

  // 扣點狀態列：純提示，不擋播放。扣點完全是「非必要」選項——不扣一樣能看。
  function renderPointBar(box, movieId, groupId) {
    if (!API.checkPoint) return;
    var bar = document.createElement('div');
    bar.className = 'point-bar';
    bar.textContent = '查詢開通狀態…';
    box.appendChild(bar);
    API.checkPoint(movieId, groupId).then(function (r) {
      if (r.opened) {
        bar.className = 'point-bar opened';
        bar.textContent = '✓ 本課已在三天觀看期內（已登記補課）';
        return;
      }
      if (r.needPoint) {
        // 未登記補課。影片「照樣能直接播放」，扣點只是把它登記成正式補課紀錄（非必要）。
        bar.className = 'point-bar info';
        bar.innerHTML = '';
        var txt = document.createElement('span');
        txt.className = 'pb-txt';
        txt.textContent = '可直接播放。若要登記為正式補課紀錄（選用），可扣 1 點。';
        var btn = document.createElement('button');
        btn.className = 'point-btn ghost';
        btn.textContent = '登記補課（選用，扣 1 點）';
        btn.onclick = function () { doDeduct(bar, btn, movieId, groupId); };
        bar.appendChild(txt); bar.appendChild(btn);
        return;
      }
      // 未知狀態也不擋，直接隱藏這條（不影響播放）
      bar.style.display = 'none';
    }).catch(function () { bar.style.display = 'none'; });
  }

  // 登記補課（選用，二次確認後送 SaveStuLogin 扣 1 點）
  function doDeduct(bar, btn, movieId, groupId) {
    if (!window.confirm('要把這堂登記為正式補課紀錄嗎？這會扣 1 點。\n（不登記也能直接播放，這一步是選用的）')) return;
    btn.disabled = true; btn.textContent = '登記中…';
    API.deductPoint(movieId, groupId, '0').then(function (r) {
      if (r.ok) {
        bar.className = 'point-bar opened';
        bar.textContent = '✓ 已登記補課，本課三天內列入正式紀錄';
        toast('已登記補課', 'ok');
      } else {
        btn.disabled = false; btn.textContent = '登記補課（選用，扣 1 點）';
        toast('登記失敗（伺服器回：' + r.raw + '）', 'err');
      }
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '登記補課（選用，扣 1 點）';
      toast('登記錯誤：' + e.message, 'err');
    });
  }


  // --- 播放 ------------------------------------------------------------------
  function play(segId, groupId, name) {
    setStep(3);
    if ($('crumbSeg')) $('crumbSeg').textContent = name || '';
    busy(true, '取得影片…');
    $('stepPlay').scrollIntoView({ behavior: 'smooth' });
    API.getMovieUrl(segId, groupId).then(function (r) {
      busy(false);
      if (!r.ok || !r.url) {
        toast('這段影片還沒上架（伺服器沒有檔案）', 'err');
        $('playHint').textContent = '取得連結成功但 CDN 上找不到影片檔，通常是老師還沒上傳這段。';
        return;
      }
      $('playHint').textContent = name ? ('播放中：' + name) : '';
      var v = $('player');
      v.src = r.url;
      v.load();
      var pr = v.play();
      if (pr && pr.catch) pr.catch(function () {});
      $('curUrl').value = r.url;
      window.__lastSeg = { segId: segId, groupId: groupId, name: name };
    }).catch(function (e) { busy(false); toast('播放錯誤：' + e.message, 'err'); });
  }

  // --- 下載 ------------------------------------------------------------------
  function downloadSeg(segId, groupId, name, box) {
    if (!API.download) { toast('此平台暫不支援下載', 'err'); return; }
    toast('準備下載…');
    // 進度訂閱（只掛一次）
    if (!downloadSeg._bound && API.onDownloadProgress) {
      downloadSeg._bound = true;
      API.onDownloadProgress(function (p) {
        if (p.segId == null) return;
        var bar = document.querySelector('[data-dlbar="' + p.segId + '"]');
        if (!bar) return;
        if (p.done) {
          bar.textContent = '✓ 已下載';
          bar.className = 'seg-dlbar done';
        } else {
          bar.textContent = '下載中 ' + Math.round(p.pct * 100) + '%'
            + (p.total ? ' (' + (p.got / 1e6).toFixed(0) + '/' + (p.total / 1e6).toFixed(0) + 'MB)' : '');
          bar.className = 'seg-dlbar active';
        }
      });
    }
    var bar = box && box.querySelector('[data-dlbar="' + segId + '"]');
    if (bar) { bar.textContent = '取得連結…'; bar.className = 'seg-dlbar active'; }
    API.download(segId, groupId, name).then(function (r) {
      if (r.canceled) { if (bar) bar.className = 'seg-dlbar'; if (bar) bar.textContent = ''; toast('已取消'); return; }
      if (!r.ok) {
        if (bar) { bar.textContent = '✗ 失敗'; bar.className = 'seg-dlbar err'; }
        toast('下載失敗：' + (r.error || ('HTTP ' + r.status)), 'err');
        return;
      }
      if (bar) { bar.textContent = '✓ 已下載'; bar.className = 'seg-dlbar done'; }
      toast('下載完成：' + r.path, 'ok');
    }).catch(function (e) {
      if (bar) { bar.textContent = '✗ 失敗'; bar.className = 'seg-dlbar err'; }
      toast('下載錯誤：' + e.message, 'err');
    });
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

  // 分段項目：含狀態標籤 + 播放鈕 + 下載鈕 + 下載進度條
  function addSegItem(box, segId, label, status, playDisabled, onPlay, onDownload) {
    var row = document.createElement('div');
    row.className = 'seg-row';
    // 標題 + 狀態徽章
    var head = document.createElement('div');
    head.className = 'seg-head';
    var t = document.createElement('span'); t.className = 'seg-title'; t.textContent = label;
    var badge = document.createElement('span'); badge.className = 'seg-badge ' + status.cls; badge.textContent = status.text;
    head.appendChild(t); head.appendChild(badge);
    // 按鈕列
    var btns = document.createElement('div');
    btns.className = 'seg-btns';
    var pb = document.createElement('button');
    pb.className = 'seg-btn play'; pb.textContent = '▶ 播放'; pb.disabled = !!playDisabled;
    if (!playDisabled) pb.onclick = onPlay;
    var db = document.createElement('button');
    db.className = 'seg-btn dl'; db.textContent = '⬇ 下載';
    if (API.hasDownload) { db.onclick = onDownload; } else { db.style.display = 'none'; }
    btns.appendChild(pb); btns.appendChild(db);
    // 下載進度條（用 data-dlbar 綁段ID 供進度更新定位）
    var bar = document.createElement('div');
    bar.className = 'seg-dlbar';
    bar.setAttribute('data-dlbar', String(segId));
    row.appendChild(head); row.appendChild(btns); row.appendChild(bar);
    box.appendChild(row);
    return { row: row, bar: bar, playBtn: pb, dlBtn: db };
  }
  function selectAllSeg(box, segId, kind) {
    box.querySelectorAll('.seg-row').forEach(function (c) { c.classList.remove('sel'); });
  }

  setStep(1);
  boot().catch(function (e) { toast('初始化失敗：' + e.message, 'err'); });
})();
