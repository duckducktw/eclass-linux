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
 * 寫死的已綁定 MAC / 電腦名。
 * eClass 伺服器把帳號綁到「第一次登入用的 MAC」，之後換機器會回 "2"(機器不符)，
 * 需補習班後台解綁。為省掉跨裝置麻煩，這裡寫死成已綁定本帳號的那組，
 * 任何裝置跑這個 client 都會送同一個 MAC+電腦名 → 伺服器永遠認得。
 * 設環境變數 ECLASS_PINNED_MAC / ECLASS_PINNED_CN 可覆寫（換帳號時改這裡即可）。
 */
const PINNED_MAC = process.env.ECLASS_PINNED_MAC || '00-11-22-33-44-55';
const PINNED_CN = process.env.ECLASS_PINNED_CN || 'test-pc';

/**
 * 取得 MAC。預設回「寫死的已綁定 MAC」（pinned=true）。
 * 傳 { pinned: false } 才會去抓本機真實網卡（給想重新綁定時用）。
 * @param {object} [opts]
 * @param {boolean} [opts.pinned=true] 是否用寫死的已綁定 MAC
 * @param {'colon'|'dash'|'none'} [opts.sep='dash'] 原程式 UI 出現過 00-00-00-00-00-00（dash）
 * @returns {string|null}
 */
function getMac(opts = {}) {
  const sep = opts.sep || 'dash';
  if (opts.pinned !== false) {
    // 已綁定 MAC 本身就是 dash 格式；要別的分隔符再轉
    if (sep === 'colon') return PINNED_MAC.replace(/-/g, ':');
    if (sep === 'none') return PINNED_MAC.replace(/-/g, '');
    return PINNED_MAC;
  }
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

/** 電腦名。預設回寫死的已綁定電腦名；傳 false 回本機真實 hostname。 */
function getComputerName(pinned = true) {
  if (pinned) return PINNED_CN;
  return os.hostname();
}

/** 一次拿齊（預設用寫死的已綁定身分） */
function getMachineId(opts = {}) {
  return {
    macId: getMac(opts),
    computerName: getComputerName(opts.pinned !== false),
  };
}

module.exports = { getMac, getComputerName, getMachineId, isVirtual, PINNED_MAC, PINNED_CN };
