'use strict';
/**
 * copy-core-to-www.js — 把 src/core/*.js (UMD 平台無關模組) 複製進 www/js/core/，
 * 讓 Capacitor 打包時能一併放進 APK。core 是單一真實來源，改 src/core 後跑此腳本同步。
 * 由 package.json 的 "cap:sync" / "prebuild" 自動觸發。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'core');
const DST = path.join(__dirname, '..', 'www', 'js', 'core');

fs.mkdirSync(DST, { recursive: true });
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
for (const f of files) {
  fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
  console.log('copied', f, '->', path.relative(process.cwd(), path.join(DST, f)));
}
console.log(`\n${files.length} core module(s) synced to www/js/core/`);
