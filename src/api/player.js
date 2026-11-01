'use strict';
/**
 * player.js — 用系統 VLC 播放防盜鏈影片連結。
 * 原 Windows 程式內嵌 VLC ActiveX (axvlc) / WMP；Linux 版直接呼叫 /usr/bin/vlc。
 * 這樣最省事也最穩：expire/token 連結直接丟給 VLC，過期前可播。
 */
const { spawn } = require('child_process');

/**
 * 以 VLC 播放一個 URL。
 * @param {string} url  帶 ?expire=&token= 的影片連結
 * @param {object} [opts]
 * @param {string} [opts.bin='vlc']
 * @param {boolean} [opts.fullscreen=false]
 * @returns {import('child_process').ChildProcess}
 */
function playInVlc(url, opts = {}) {
  const bin = opts.bin || 'vlc';
  const args = [];
  if (opts.fullscreen) args.push('--fullscreen');
  // --play-and-exit: 播完自動關；--no-video-title-show: 不顯示檔名
  args.push('--play-and-exit', '--no-video-title-show', url);
  const child = spawn(bin, args, { stdio: 'ignore', detached: false });
  return child;
}

/** 檢查系統有無 vlc */
function hasVlc(bin = 'vlc') {
  const { spawnSync } = require('child_process');
  const r = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

module.exports = { playInVlc, hasVlc };
