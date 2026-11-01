'use strict';
/**
 * schools.js — 多校共用登入的「補習班代碼 → 主機」註冊表 (UMD, 平台無關)。
 *
 * 來源：逆向自原生 eclass.exe (VB6 v1.3.4) 的學校設定表
 *   (0x710140..0x710560 區，Code→host 成對硬編)，外加兩個全域預設主機。
 *
 * 用途：原生 app 是「單一執行檔、多補習班共用」，靠使用者輸入的 4 碼
 *   補習班代碼 (Code) 決定連哪台伺服器。本表還原該對應，讓重寫版：
 *     1) 已知 Code → 直接連對應 host (免盲試)
 *     2) 未知 Code → 回退並行試所有已知 host (CheckMac 會真驗帳密)
 *
 * ⚠️ 原生表中的 IP/DDNS 多為 2000 年代舊部署，實測多數已死
 *   (僅 makeup.jlweb.com.tw 存活)。保留供對照與未來校別擴充；
 *   httpsHint 標示該 host 慣用協定 (帶 port 的多為純 http)。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EclassSchools = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Code(4碼) → { host, name, https }
  // name 為已知友善名稱；未知者留代碼本身。
  var SCHOOLS = {
    '0102': { host: 'makeup.jlweb.com.tw', name: '升學文理補習班 (JL)', https: true, alive: true },
    '0041': { host: 'faigo.synology.me', name: '補習班 0041', https: true },
    '0018': { host: '114.32.237.176', name: '補習班 0018', https: false },
    '0055': { host: '114.34.92.6:8888', name: '補習班 0055', https: false },
    '0009': { host: '122.116.1.178', name: '補習班 0009', https: false },
    '0062': { host: 'handazyuku.fortiddns.com', name: '漢達補習班', https: true },
    '0047': { host: '220.130.155.38', name: '補習班 0047', https: false },
    '0060': { host: 'hs.faber.com.tw', name: '法柏補習班', https: true },
  };

  // 全域預設主機 (原生 0x75b034 / 0x75b028)，非表定代碼時的候選。
  var DEFAULT_HOSTS = [
    { host: 'makeup.jlweb.com.tw', name: '升學文理補習班 (JL)', https: true },
    { host: 'svr1.eclass.com.tw', name: 'eClass 總站', https: true },
  ];

  /** 依 Code 解析補習班。回 { host, name, https } 或 null。 */
  function resolve(code) {
    if (!code) return null;
    var key = String(code).trim();
    return SCHOOLS[key] || null;
  }

  /** 取所有已知 host 候選 (去重)，供未知 Code 時並行試。 */
  function allHosts() {
    var seen = {};
    var out = [];
    Object.keys(SCHOOLS).forEach(function (code) {
      var s = SCHOOLS[code];
      if (!seen[s.host]) { seen[s.host] = 1; out.push({ host: s.host, name: s.name, https: s.https !== false, code: code }); }
    });
    DEFAULT_HOSTS.forEach(function (s) {
      if (!seen[s.host]) { seen[s.host] = 1; out.push({ host: s.host, name: s.name, https: s.https !== false, code: null }); }
    });
    return out;
  }

  /** host 字串拆成 { hostname, port, https }。帶 port 的預設走 http。 */
  function parseHost(host, httpsHint) {
    var hasPort = host.indexOf(':') >= 0;
    if (hasPort) {
      var parts = host.split(':');
      return { hostname: parts[0], port: parseInt(parts[1], 10), https: httpsHint === true };
    }
    return { hostname: host, port: httpsHint === false ? 80 : 443, https: httpsHint !== false };
  }

  return {
    SCHOOLS: SCHOOLS,
    DEFAULT_HOSTS: DEFAULT_HOSTS,
    resolve: resolve,
    allHosts: allHosts,
    parseHost: parseHost,
  };
});
