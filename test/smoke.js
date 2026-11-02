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
c.core._get = (p) => Promise.resolve({ status: 200, body: 'GET ' + p });
(async () => {
  ok('classList1 carries Code+auth',
     (await c.classList1()).body === 'GET /ClassList1.aspx?Code=C&StuSN=S1&StuPass=P&MacID=AA-BB');
  ok('classList2 carries ClassID',
     (await c.classList2('239')).body === 'GET /ClassList2.aspx?Code=C&ClassID=239&StuSN=S1&StuPass=P&MacID=AA-BB');
  ok('movieList order (Code,MovieID,ClassID)',
     (await c.movieList('1648', '239')).body === 'GET /MovieList.aspx?Code=C&MovieID=1648&ClassID=239&StuSN=S1&StuPass=P&MacID=AA-BB');
  // 影片端點現在自動簽 Key (moviesign) + 自動補 .mp4 (2026-11-02 抓包實證):
  //   Movie 一定帶 .mp4；GroupID 未指定時留空 (帶班級ID會讓CDN路徑多層→404)。
  const mv = await c.getMovieUrlCDN({ movie: '4463', key2: '123456' });
  ok('getMovieUrlCDN auto-signs Key + Movie帶.mp4 + GroupID空',
     /^GET \/GetMovieURLCDN\.aspx\?Key2=123456&Key=[0-9a-f]{32}&Movie=4463\.mp4&Code=C&GroupID=&StuSN=S1&StuPass=P&MacID=AA-BB$/.test(mv.body));
  // 若已帶 .mp4 不應重複加
  const mv2 = await c.getMovieUrlCDN({ movie: '4463.mp4', key2: '1' });
  ok('getMovieUrlCDN 不重複加 .mp4', /Movie=4463\.mp4&/.test(mv2.body) && !/4463\.mp4\.mp4/.test(mv2.body));
  // SaveStuLogin 扣點端點：Code,MovieID,ClassID,Flag + 身分
  const dl = await c.saveStuLogin({ movieId: '1648', classId: '239', flag: '0' });
  ok('saveStuLogin 參數順序 (Code,MovieID,ClassID,Flag)+auth',
     dl.body === 'GET /SaveStuLogin.aspx?Code=C&MovieID=1648&ClassID=239&Flag=0&StuSN=S1&StuPass=P&MacID=AA-BB');
  // checkPoint 參數
  const cp = await c.checkPoint('1648', '239');
  ok('checkPoint 帶 MovieID+ClassID',
     cp.body === 'GET /CheckPoint.aspx?Code=C&MovieID=1648&ClassID=239&StuSN=S1&StuPass=P&MacID=AA-BB');

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

  console.log('[smoke] schools registry (多校共用登入)');
  const schools = require('../src/core/schools');
  ok('resolve 0102 -> JL host',
     schools.resolve('0102').host === 'makeup.jlweb.com.tw');
  ok('resolve 0060 -> faber',
     schools.resolve('0060').host === 'hs.faber.com.tw');
  ok('resolve unknown -> null', schools.resolve('9999') === null);
  ok('resolve trims whitespace', schools.resolve(' 0102 ').host === 'makeup.jlweb.com.tw');
  const allH = schools.allHosts();
  ok('allHosts dedups + includes defaults', allH.length >= 8 && allH.some((h) => h.host === 'svr1.eclass.com.tw'));
  ok('port host flagged non-https', schools.resolve('0055').https === false);
  const ph = schools.parseHost('114.34.92.6:8888', false);
  ok('parseHost splits port', ph.hostname === '114.34.92.6' && ph.port === 8888 && ph.https === false);
  const ph2 = schools.parseHost('makeup.jlweb.com.tw', true);
  ok('parseHost https default 443', ph2.port === 443 && ph2.https === true);

  console.log(`\n[smoke] ALL ${pass} checks passed ✅`);
})().catch((e) => { console.error('\n[smoke] FAIL:', e.message); process.exit(1); });
