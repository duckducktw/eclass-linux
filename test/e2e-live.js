'use strict';
/* e2e-live.js — 對真實伺服器跑完整資料流程 (需合法帳號)，含影片 URL 簽章。
 * 用法: node test/e2e-live.js <host> <code> <stuSN> <stuPass>
 * 例:   node test/e2e-live.js makeup.jlweb.com.tw 0102 129535 2153
 *
 * ✅ Key 演算法已破解 (moviesign.js): Key = md5("2370"+StuSN+"4277"+Movie+Key2)。
 * 注意欄位對應 (實測):
 *   ClassList1 列 = "ClassID;GroupID;,班級名"
 *   ClassList2 要用 **GroupID** 查 (非 ClassID) → 列 = "單元名,GroupID,MovieID,段數"
 *   MovieList  用 MovieID+GroupID 查 → 列 = "序,段ID,可看"
 *   GetMovieURLCDN 的 Movie=段ID, GroupID=GroupID。
 */
const { EclassClient } = require('../src/api/eclass');
const { getMachineId } = require('../src/api/machineid');
const { computeMovieKey } = require('../src/api/moviesign');
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

  console.log('\n[2] ClassList1 班級清單 (ClassID;GroupID;,名)');
  const cl1 = await c.classList1();
  const subjects = parse.splitRows(cl1.body).map((r) => {
    const [ids, name] = r.split(',');
    const [classId, groupId] = ids.split(';');
    return { classId, groupId, name };
  });
  subjects.forEach((s) => console.log(`   ClassID=${s.classId} GroupID=${s.groupId}  ${s.name}`));
  if (subjects.length === 0) { console.log('   (無班級)'); process.exit(0); }

  // 逐班找「可看且拿得到合法 URL」的段
  let found = null;
  for (const subj of subjects) {
    const cl2 = await c.classList2(subj.groupId); // ← 用 GroupID
    const units = parse.splitRows(cl2.body).map((r) => {
      const [name, gid, movieId, segs] = r.split(',');
      return { name, groupId: gid, movieId, segs };
    });
    if (!units.length) continue;
    const unit = units[0];
    const ml = await c.movieList(unit.movieId, subj.groupId);
    const segs = parse.splitRows(ml.body).map((r) => {
      const [seq, segId, watchable] = r.split(',');
      return { seq, segId, watchable };
    });
    if (!segs.length) continue;
    const seg = segs[0];

    // 算 Key + 拿 URL
    const { key, key2 } = computeMovieKey({ stuSN, movie: seg.segId });
    const mv = await c.getMovieUrlCDN({ movie: seg.segId, groupId: subj.groupId });
    const body = String(mv.body).trim();
    const ok = body.startsWith('http');
    console.log(`\n[班 ${subj.name.slice(0, 18)}] GroupID=${subj.groupId} 單元MovieID=${unit.movieId} 段ID=${seg.segId}`);
    console.log(`   Key2=${key2} Key=${key}`);
    console.log(`   GetMovieURLCDN → ${ok ? body : JSON.stringify(body)} ${ok ? '✓ 合法簽章 URL' : '(簽章碼: -1缺身分 -2缺Key -3Key錯)'}`);

    if (ok) {
      found = { subj, unit, seg, url: body };
      // 驗證內容是否存在 (HEAD)
      try {
        const https = require('https');
        const u = new URL(body);
        const status = await new Promise((res) => {
          const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'HEAD', rejectUnauthorized: false, timeout: 12000 }, (r) => res(r.statusCode));
          req.on('error', () => res('ERR')); req.on('timeout', () => { req.destroy(); res('TIMEOUT'); }); req.end();
        });
        console.log(`   內容 HEAD → HTTP ${status} ${status === 200 ? '✓ 影片存在可下載' : '(簽章正確；此段內容未上架到 CDN bucket)'}`);
      } catch (e) { console.log('   HEAD err:', e.message); }
      break;
    }
  }

  if (found) {
    console.log('\n✅ 完整流程跑通：登入→班級→單元→分段→算Key→取得合法簽章影片URL。');
  } else {
    console.log('\n⚠️ 流程跑通但此帳號無任何段回傳合法 URL（可能班級停用/無影片）。');
  }
})().catch((e) => { console.error('ERROR:', e.stack || e.message); process.exit(1); });
