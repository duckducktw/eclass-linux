'use strict';
/**
 * preload.js — contextBridge 白名單，renderer 只能呼叫這些。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eclass', {
  bootInfo: () => ipcRenderer.invoke('app:bootInfo'),
  connect: (host, https) => ipcRenderer.invoke('api:connect', { host, https }),
  checkMac: (p) => ipcRenderer.invoke('api:checkMac', p),
  loginAuto: (p) => ipcRenderer.invoke('api:loginAuto', p),
  selectHost: (p) => ipcRenderer.invoke('api:selectHost', p),
  classList1: (code) => ipcRenderer.invoke('api:classList1', code),
  classList2: (code) => ipcRenderer.invoke('api:classList2', code),
  movieList: (code, movieId, classId) =>
    ipcRenderer.invoke('api:movieList', { code, movieId, classId }),
  getClassWeekNote: (code, weekId) =>
    ipcRenderer.invoke('api:getClassWeekNote', { code, weekId }),
  getClassPoint: (code) => ipcRenderer.invoke('api:getClassPoint', code),
  checkPoint: (movieId, classId) =>
    ipcRenderer.invoke('api:checkPoint', { movieId, classId }),
  getMovieUrl: (source, params) =>
    ipcRenderer.invoke('api:getMovieUrl', { source, params }),
  deductPoint: (movieId, classId, flag) =>
    ipcRenderer.invoke('api:deductPoint', { movieId, classId, flag }),
  play: (url, fullscreen) =>
    ipcRenderer.invoke('player:play', { url, fullscreen }),
  download: (segId, groupId, suggestName) =>
    ipcRenderer.invoke('api:download', { segId, groupId, suggestName }),
  onDownloadProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('dl:progress', h);
    return () => ipcRenderer.removeListener('dl:progress', h);
  },
  logout: () => ipcRenderer.invoke('api:logout'),
  openExternal: (url) => ipcRenderer.invoke('util:openExternal', url),
});
