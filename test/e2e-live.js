'use strict';
/* e2e-live.js — 對真實伺服器跑完整資料流程 (需合法帳號)。
 * 用法: node test/e2e-live.js <host> <code> <stuSN> <stuPass>
 * 例:   node test/e2e-live.js makeup.jlweb.com.tw 0102 129535 2153
 * 不含影片 URL (Key/Key2 未破解)。
 */
const { EclassClient } = require('../src/api/eclass');
const { getMachineId } = require('../src/api/machineid');
const parse = require('../src/api/parse');

const [, , host, code, stuSN, stuPass] = process.argv;
if (!host) { console.error('usage: node test/e2e-live.js <host> <code> <stuSN> <stuPass>'); process.exit(1); }

(async () => {
  const m = getMachineId({ sep: 'dash' });
  const c = new EclassClient({ host, code });
  console.log('machine:', m);

  console.log('\n[1] CheckMac 登入');
  const login = await c.checkMac({ code, stuSN, stuPass, macId: m.macId, computerName: m.computerName });
  console.log('   回應:', JSON.stringify(login.body), '→', parse.parseCheckMac(login.body).ok ? '成功 ✓' : '失敗 ✗');
  if (!parse.parseCheckMac(login.body).ok) process.exit(2);

  console.log('\n[2] ClassList1 科目清單');
  const cl1 = await c.classList1();
  const subjects = parse.splitRows(cl1.body).map((r) => {
    const [ids, name] = r.split(',');
    const [classId] = ids.split(';');
    return { classId, name };
  });
  subjects.forEach((s) => console.log(`   ClassID=${s.classId}  ${s.name}`));
  if (subjects.length === 0) { console.log('   (無科目)'); process.exit(0); }

  const subj = subjects[subjects.length - 1]; // 取最後一科示範 (英文)
  console.log(`\n[3] ClassList2 單元清單 (ClassID=${subj.classId})`);
  const cl2 = await c.classList2(subj.classId);
  const units = parse.splitRows(cl2.body).map((r) => {
    const [name, cid, movieId, segs] = r.split(',');
    return { name, classId: cid, movieId, segs };
  });
  units.forEach((u) => console.log(`   MovieID=${u.movieId}  (${u.segs}段)  ${u.name}`));
  if (units.length === 0) process.exit(0);

  const unit = units[0];
  console.log(`\n[4] MovieList 分段清單 (MovieID=${unit.movieId}, ClassID=${subj.classId})`);
  const ml = await c.movieList(unit.movieId, subj.classId);
  const segs = parse.splitRows(ml.body).map((r) => {
    const [seq, segId, watchable] = r.split(',');
    return { seq, segId, watchable };
  });
  segs.forEach((s) => console.log(`   第${s.seq}段  段ID=${s.segId}  可看=${s.watchable}`));

  console.log('\n[5] 點數 / CheckPoint');
  console.log('   GetClassPoint:', JSON.stringify((await c.getClassPoint()).body));
  if (segs[0]) {
    console.log('   CheckPoint(段ID=' + segs[0].segId + '):',
      JSON.stringify((await c.checkPoint(unit.movieId, subj.classId)).body));
  }

  console.log('\n[6] 影片 URL (Key/Key2 未破解 → 預期 -2)');
  if (segs[0]) {
    const mv = await c.getMovieUrlCDN({ key2: '', key: '', movie: segs[0].segId, groupId: subj.classId });
    console.log('   GetMovieURLCDN:', JSON.stringify(mv.body), mv.body.trim() === '-2' ? '(缺 Key，符合預期)' : '');
  }

  console.log('\n✅ E2E 流程跑通 (登入→科目→單元→分段→點數)。影片 URL 待抓包補 Key。');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
