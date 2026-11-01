'use strict';
/**
 * Electron main process — eclass-linux
 * 持有 EclassClient，透過 IPC 把 API 暴露給 renderer。
 * 安全設定：contextIsolation 開、nodeIntegration 關，renderer 只能走 preload 白名單。
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
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
    title: 'eClass Linux',
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
  // 嘗試把回應當成 Code(session) 存起來；實際欄位需抓包確認
  if (parsed.ok) {
    const code = p.code; // 多數部署登入後沿用同一 Code 當 session
    client.code = code;
    store.set('code', code);
    store.set('stuSN', p.stuSN);
  }
  return { status: r.status, parsed, raw: r.body };
});

ipcMain.handle('api:classList1', async (_e, code) => {
  const r = await client.classList1(code);
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:classList2', async (_e, code) => {
  const r = await client.classList2(code);
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:movieList', async (_e, { code, movieId, classId }) => {
  const r = await client.movieList(code, movieId, classId);
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:getClassWeekNote', async (_e, { code, weekId }) => {
  const r = await client.getClassWeekNote(code, weekId);
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:getClassPoint', async (_e, code) => {
  const r = await client.getClassPoint(code);
  return { status: r.status, ...parse.parseList(r.body) };
});
ipcMain.handle('api:checkPoint', async (_e, code) => {
  const r = await client.checkPoint(code);
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
