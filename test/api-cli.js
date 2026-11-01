'use strict';
/* api-cli.js — 不開 GUI 直接打 API，方便抓包/驗證 key。
 * 用法:
 *   node test/api-cli.js login <host> <code> <stuSN> <stuPass>
 *   node test/api-cli.js class1 <host> <code>
 *   node test/api-cli.js brute <code> <stuSN> <stuPass> <macId> <computerName> <observedKey>
 */
const { EclassClient } = require('../src/api/eclass');
const { getMachineId } = require('../src/api/machineid');
const { bruteforce } = require('../src/api/keysign');

const [, , cmd, ...a] = process.argv;

(async () => {
  if (cmd === 'login') {
    const [host, code, stuSN, stuPass] = a;
    const m = getMachineId({ sep: 'dash' });
    const c = new EclassClient({ host });
    const r = await c.checkMac({ code, stuSN, stuPass, macId: m.macId, computerName: m.computerName });
    console.log('machine:', m);
    console.log('status:', r.status);
    console.log('body:', r.body);
  } else if (cmd === 'class1') {
    const [host, code] = a;
    const c = new EclassClient({ host });
    console.log((await c.classList1(code)).body);
  } else if (cmd === 'brute') {
    const [code, stuSN, stuPass, macId, computerName, observedKey] = a;
    const hits = bruteforce({ code, stuSN, stuPass, macId, computerName }, observedKey,
      ['', '23893110', 'JL23705999', 'eclass', 'ECLASS']);
    console.log(hits.length ? hits : '無命中 — 加更多 salt 候選或檢查欄位順序');
  } else {
    console.log('cmds: login | class1 | brute  (see file header)');
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
