'use strict';
/**
 * afterPack hook — 修 Ubuntu 24.04+ 的 Electron 沙箱 FATAL。
 *
 * 問題：Ubuntu 24.04+ 的 AppArmor 預設擋 unprivileged user namespaces，
 *       Electron 的 SUID sandbox helper 在 chromium 初始化階段就 fork 失敗 →
 *       直接 FATAL abort。這發生在任何 JS（app.commandLine.appendSwitch）之前，
 *       所以只能在「進程啟動前」靠環境變數 ELECTRON_DISABLE_SANDBOX=1 解決。
 *
 * 做法：把打包出的原生 electron 執行檔改名為 <name>.bin，
 *       放一個 shell wrapper 同名、設好環境變數再 exec 真正的 binary。
 *       對 AppImage / deb / tar.gz 皆有效（它們最終都是執行這個檔）。
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const dir = context.appOutDir;
  const exe = context.packager.executableName || 'eClass Linux';
  const real = path.join(dir, exe);
  const moved = path.join(dir, exe + '.bin');

  if (!fs.existsSync(real)) {
    console.warn('[afterPack] 找不到執行檔:', real);
    return;
  }
  // 已處理過就跳過
  if (fs.existsSync(moved)) return;

  fs.renameSync(real, moved);
  const wrapper = `#!/bin/bash
# 自動注入：關閉 Electron setuid 沙箱 (Ubuntu 24.04+ AppArmor 相容)
export ELECTRON_DISABLE_SANDBOX=1
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/${exe}.bin" --no-sandbox "$@"
`;
  fs.writeFileSync(real, wrapper, { mode: 0o755 });
  console.log('[afterPack] 已套用 no-sandbox wrapper:', exe);
};
