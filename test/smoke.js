'use strict';
/* smoke.js — 不開 GUI、不連網，驗證所有模組可載入 + 關鍵函式行為正確 */
const assert = require('assert');
const { EclassClient, KNOWN_HOSTS } = require('../src/api/eclass');
const { computeKey, bruteforce, md5 } = require('../src/api/keysign');
const { getMachineId, isVirtual } = require('../src/api/machineid');
const parse = require('../src/api/parse');

let pass = 0;
function ok(name, cond) { assert(cond, name); console.log('  ✓', name); pass++; }

console.log('[smoke] modules load');
ok('KNOWN_HOSTS has eclass', KNOWN_HOSTS.eclass === 'svr1.eclass.com.tw');

console.log('[smoke] EclassClient qs ordering');
const qs = EclassClient.qs([['A', '1'], ['B', 'x y'], ['C', null], ['D', '中']]);
ok('qs skips null + encodes', qs === 'A=1&B=x%20y&D=%E4%B8%AD');

console.log('[smoke] URL builders produce correct paths');
const c = new EclassClient({ host: 'h.test', https: true, code: 'C' });
c.auth = { stuSN: 'S1', stuPass: 'P', macId: 'AA-BB' };
c._get = (p) => Promise.resolve({ status: 200, body: 'GET ' + p });
(async () => {
  ok('classList1 carries Code+auth',
     (await c.classList1()).body === 'GET /ClassList1.aspx?Code=C&StuSN=S1&StuPass=P&MacID=AA-BB');
  ok('classList2 carries ClassID',
     (await c.classList2('239')).body === 'GET /ClassList2.aspx?Code=C&ClassID=239&StuSN=S1&StuPass=P&MacID=AA-BB');
  ok('movieList order (Code,MovieID,ClassID)',
     (await c.movieList('1648', '239')).body === 'GET /MovieList.aspx?Code=C&MovieID=1648&ClassID=239&StuSN=S1&StuPass=P&MacID=AA-BB');
  const mv = await c.getMovieUrlCDN({ key2: 'k2', key: 'k', movie: '4463', groupId: '239' });
  ok('getMovieUrlCDN order (Key2,Key,Movie,Code,GroupID)',
     mv.body === 'GET /GetMovieURLCDN.aspx?Key2=k2&Key=k&Movie=4463&Code=C&GroupID=239&StuSN=S1&StuPass=P&MacID=AA-BB');

  console.log('[smoke] keysign deterministic + swappable');
  const f = { code: 'C', stuSN: 'S1', stuPass: 'P', macId: 'AA-BB', computerName: 'PC' };
  ok('computeKey is md5 hex (32)', /^[0-9a-f]{32}$/.test(computeKey('CheckMac', f)));
  ok('computeKey deterministic', computeKey('CheckMac', f) === computeKey('CheckMac', f));

  console.log('[smoke] bruteforce finds a known recipe');
  // 偽造一個 observed key = concat_all 無 salt，確認 bruteforce 命中
  const observed = md5(`${f.code}${f.stuSN}${f.stuPass}${f.macId}${f.computerName}`);
  const hits = bruteforce(f, observed, ['']);
  ok('bruteforce matches concat_all', hits.some((h) => h.recipe === 'concat_all'));

  console.log('[smoke] machineid');
  const m = getMachineId();
  ok('computerName present', typeof m.computerName === 'string' && m.computerName.length > 0);
  ok('lo is virtual', isVirtual('lo') && isVirtual('docker0') && !isVirtual('eth0'));

  console.log('[smoke] parse');
  ok('extractMovieUrl', parse.extractMovieUrl('x http://cdn/a.mp4?expire=1&token=z y') === 'http://cdn/a.mp4?expire=1&token=z');
  ok('parseCheckMac ok', parse.parseCheckMac('1').ok === true);
  ok('parseCheckMac denied', parse.parseCheckMac('Access Denied').ok === false);
  const list = parse.parseList('a, b<br/>c, d');
  ok('parseList rows/cols', list.rows.length === 2 && list.rows[0][1] === 'b');

  console.log(`\n[smoke] ALL ${pass} checks passed ✅`);
})().catch((e) => { console.error('\n[smoke] FAIL:', e.message); process.exit(1); });
