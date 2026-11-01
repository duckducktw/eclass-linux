'use strict';
/**
 * machineid.js — 產生機器綁定用的 MacID + ComputerName。
 * 對應原程式 eclass.exe 的 mMac 模組行為：
 *   - MAC：透過 iphlpapi 抓網卡，過濾掉 *Virtual* 虛擬網卡與 00-00-00-00-00-00。
 *   - ComputerName：讀登錄檔 System\CurrentControlSet\Control\ComputerName\ComputerName。
 * Linux 等價：os.networkInterfaces() 抓第一張實體網卡 MAC；os.hostname() 當電腦名。
 */
const os = require('os');

/** 過濾虛擬網卡的名稱樣式（Linux 常見虛擬介面） */
const VIRTUAL_PATTERNS = [
  /^lo$/i,
  /^docker/i,
  /^br-/i,
  /^veth/i,
  /^virbr/i,
  /^vmnet/i,
  /^tun\d*/i,
  /^tap\d*/i,
  /^wg\d*/i,
  /^tailscale/i,
  /^zt/i, // zerotier
];

function isVirtual(name) {
  return VIRTUAL_PATTERNS.some((re) => re.test(name));
}

/**
 * 取得第一張實體網卡的 MAC（格式對齊原程式：大寫、冒號分隔；可選連字號）。
 * @param {object} [opts]
 * @param {'colon'|'dash'|'none'} [opts.sep='dash'] 原程式 UI 出現過 00-00-00-00-00-00（dash）
 * @returns {string|null}
 */
function getMac(opts = {}) {
  const sep = opts.sep || 'dash';
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (isVirtual(name)) continue;
    for (const a of addrs || []) {
      if (!a.mac) continue;
      if (a.mac === '00:00:00:00:00:00') continue;
      candidates.push({ name, mac: a.mac });
    }
  }
  if (candidates.length === 0) return null;
  // 偏好乙太 (en*/eth*) 其次無線 (wl*)，否則第一張
  candidates.sort((x, y) => rank(x.name) - rank(y.name));
  let mac = candidates[0].mac.toUpperCase(); // os 給的是冒號小寫
  if (sep === 'dash') mac = mac.replace(/:/g, '-');
  else if (sep === 'none') mac = mac.replace(/:/g, '');
  return mac;
}

function rank(name) {
  if (/^(en|eth)/i.test(name)) return 0;
  if (/^(wl|wlan)/i.test(name)) return 1;
  return 2;
}

/** 電腦名 */
function getComputerName() {
  return os.hostname();
}

/** 一次拿齊 */
function getMachineId(opts = {}) {
  return {
    macId: getMac(opts),
    computerName: getComputerName(),
  };
}

module.exports = { getMac, getComputerName, getMachineId, isVirtual };
