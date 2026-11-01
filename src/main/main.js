'use strict';
/**
 * Electron main process — eclass-linux
 * 持有 EclassClient，透過 IPC 把 API 暴露給 renderer。
 * 安全設定：contextIsolation 開、nodeIntegration 關，renderer 只能走 preload 白名單。
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');

// ⚠️ 必須在 app ready 之前、require electron 後第一時間設定。
// Ubuntu 24.04+ 的 AppArmor 預設擋 unprivileged user namespaces
// (apparmor_restrict_unprivileged_userns=1) → Electron 的 SUID sandbox helper
// 啟動失敗會直接 FATAL abort（使用者看到的是「點圖示沒反應/閃退」）。
// 本 app 不載入任何遠端網頁，renderer 已 contextIsolation + 無 nodeIntegration，
// 關掉 chromium 的 setuid 沙箱不增加此 app 的實際攻擊面，換「雙擊即用、免改系統」。
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-setuid-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// 工作列/選單圖示對應：Electron 視窗的 WM_CLASS 取自 app 名稱。
// 設成 'eClass' 以對上 .desktop 的 StartupWMClass，否則工作列會顯示 Electron 預設圖示。
app.setName('eClass');

const path = require('path');
const Store = require('electron-store');

const { EclassClient, KNOWN_HOSTS } = require('../api/eclass');
const { getMachineId } = require('../api/machineid');
const parse = require('../api/parse');
const { playInVlc, hasVlc } = require('../api/player');

const store = new Store({ name: 'eclass-linux' });

/** @type {EclassClient|null} */
let client = null;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'eClass',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC handlers --------------------------------------------------------

ipcMain.handle('app:bootInfo', async () => {
  return {
    knownHosts: KNOWN_HOSTS,
    machine: getMachineId({ sep: 'dash' }),
    vlc: hasVlc(),
    savedHost: store.get('host', ''),
    savedCode: store.get('code', ''),
    savedStuSN: store.get('stuSN', ''),
  };
});

ipcMain.handle('api:connect', async (_e, { host, https }) => {
  client = new EclassClient({ host, https });
  store.set('host', host);
  return { ok: true, host };
});

ipcMain.handle('api:checkMac', async (_e, p) => {
  if (!client) throw new Error('not connected');
  const r = await client.checkMac(p);
  const parsed = parse.parseCheckMac(r.body);
  if (parsed.ok) {
    store.set('code', p.code);
    store.set('stuSN', p.stuSN);
  }
  return { status: r.status, parsed, raw: r.body };
});

ipcMain.handle('api:classList1', async () => {
  const r = await client.classList1();
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:classList2', async (_e, classId) => {
  const r = await client.classList2(classId);
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:movieList', async (_e, { movieId, classId }) => {
  const r = await client.movieList(movieId, classId);
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:getClassWeekNote', async (_e, weekId) => {
  const r = await client.getClassWeekNote(weekId);
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:getClassPoint', async () => {
  const r = await client.getClassPoint();
  return { status: r.status, raw: r.body };
});
ipcMain.handle('api:checkPoint', async (_e, { movieId, classId }) => {
  const r = await client.checkPoint(movieId, classId);
  return { status: r.status, raw: r.body };
});

ipcMain.handle('api:getMovieUrl', async (_e, { source, params }) => {
  const r =
    source === 'cdn'
      ? await client.getMovieUrlCDN(params)
      : await client.getMovieUrlS3(params);
  const url = parse.extractMovieUrl(r.body);
  return { status: r.status, url, raw: r.body };
});

ipcMain.handle('player:play', async (_e, { url, fullscreen }) => {
  if (!hasVlc()) throw new Error('系統找不到 vlc，請先安裝：sudo apt install vlc');
  playInVlc(url, { fullscreen });
  return { ok: true };
});

ipcMain.handle('api:logout', async () => {
  if (client && client.code) await client.saveStuLogout(client.code);
  store.delete('code');
  return { ok: true };
});

ipcMain.handle('util:openExternal', async (_e, url) => {
  await shell.openExternal(url);
  return { ok: true };
});
