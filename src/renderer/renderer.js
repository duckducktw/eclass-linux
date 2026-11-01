'use strict';
/* renderer.js — UI 邏輯，全部走 window.eclass (preload 白名單) */
const $ = (id) => document.getElementById(id);
const show = (el, obj) => { el.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); };

let MACHINE = null;

async function boot() {
  const info = await window.eclass.bootInfo();
  MACHINE = info.machine;
  $('machine').textContent = `MAC ${info.machine.macId || '??'} · ${info.machine.computerName} · VLC ${info.vlc ? '✓' : '✗ (未安裝)'}`;
  const sel = $('hostSelect');
  sel.innerHTML = '';
  for (const [name, host] of Object.entries(info.knownHosts)) {
    const o = document.createElement('option');
    o.value = host; o.textContent = `${name} (${host})`;
    sel.appendChild(o);
  }
  if (info.savedHost) { $('hostCustom').value = info.savedHost; }
  if (info.savedCode) $('code').value = info.savedCode;
  if (info.savedStuSN) $('stuSN').value = info.savedStuSN;
}

function currentHost() {
  const custom = $('hostCustom').value.trim();
  return custom || $('hostSelect').value;
}

$('btnLogin').onclick = async () => {
  try {
    await window.eclass.connect(currentHost(), $('useHttps').checked);
    const r = await window.eclass.checkMac({
      code: $('code').value.trim(),
      stuSN: $('stuSN').value.trim(),
      stuPass: $('stuPass').value,
      macId: MACHINE.macId,
      computerName: MACHINE.computerName,
    });
    show($('loginOut'), r);
  } catch (e) { show($('loginOut'), 'ERROR: ' + e.message); }
};

$('btnLogout').onclick = async () => show($('loginOut'), await window.eclass.logout());

const code = () => $('code').value.trim();
$('btnClass1').onclick = async () => show($('listOut'), await window.eclass.classList1(code()));
$('btnClass2').onclick = async () => show($('listOut'), await window.eclass.classList2(code()));
$('btnPoint').onclick  = async () => show($('listOut'), await window.eclass.getClassPoint(code()));
$('btnMovieList').onclick = async () =>
  show($('listOut'), await window.eclass.movieList(code(), $('mlMovieId').value.trim(), $('mlClassId').value.trim()));

$('btnGetUrl').onclick = async () => {
  try {
    const r = await window.eclass.getMovieUrl($('movSource').value, {
      code: code(), movie: $('pMovie').value.trim(), groupId: $('pGroup').value.trim(),
      key: $('pKey').value.trim(), key2: $('pKey2').value.trim(),
    });
    show($('playOut'), r);
    if (r.url) $('movieUrl').value = r.url;
  } catch (e) { show($('playOut'), 'ERROR: ' + e.message); }
};

$('btnPlay').onclick = async () => {
  const url = $('movieUrl').value.trim();
  if (!url) return show($('playOut'), '沒有連結可播');
  try { show($('playOut'), await window.eclass.play(url, $('fs').checked)); }
  catch (e) { show($('playOut'), 'ERROR: ' + e.message); }
};

boot().catch((e) => show($('loginOut'), 'boot error: ' + e.message));
