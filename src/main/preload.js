'use strict';
/**
 * preload.js — contextBridge 白名單，renderer 只能呼叫這些。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eclass', {
  bootInfo: () => ipcRenderer.invoke('app:bootInfo'),
  connect: (host, https) => ipcRenderer.invoke('api:connect', { host, https }),
  checkMac: (p) => ipcRenderer.invoke('api:checkMac', p),
  classList1: (code) => ipcRenderer.invoke('api:classList1', code),
  classList2: (code) => ipcRenderer.invoke('api:classList2', code),
  movieList: (code, movieId, classId) =>
    ipcRenderer.invoke('api:movieList', { code, movieId, classId }),
  getClassWeekNote: (code, weekId) =>
    ipcRenderer.invoke('api:getClassWeekNote', { code, weekId }),
  getClassPoint: (code) => ipcRenderer.invoke('api:getClassPoint', code),
  checkPoint: (code) => ipcRenderer.invoke('api:checkPoint', code),
  getMovieUrl: (source, params) =>
    ipcRenderer.invoke('api:getMovieUrl', { source, params }),
  play: (url, fullscreen) =>
    ipcRenderer.invoke('player:play', { url, fullscreen }),
  logout: () => ipcRenderer.invoke('api:logout'),
  openExternal: (url) => ipcRenderer.invoke('util:openExternal', url),
});
