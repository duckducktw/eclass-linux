'use strict';
/**
 * keysign.js — 計算 CheckMac.aspx 的 `key` 防偽校驗碼。
 *
 * ⚠️ 已知未知數 (THE one blocker):
 *   原程式 eclass.exe 是 VB6 **p-code**（有 `VB5!` 簽章、無 ThunRTMain），
 *   且 MD5 的初始常數不是字面量 → `key` 的「輸入拼接順序 + salt」無法純靜態還原。
 *   有獨立 VB 模組 `mMD5` 負責計算，字串層只看得到欄位名，看不到公式。
 *
 * 還原這個公式有兩條路（見 README「還原 key」章節）：
 *   A. 在 Windows 用 VB Decompiler (Pro) 反編譯 mMD5 + CheckMac 呼叫處。
 *   B. 在 VM 跑原程式登入，用 mitmproxy/Fiddler 抓 CheckMac 實際送出的 key，
 *      拿已知 StuSN/StuPass/MacID 去暴力試下列候選公式，命中即確定。
 *
 * 本檔把 key 算法做成**可替換**：找到正確公式後只改 ACTIVE_RECIPE 一處即可。
 */
const crypto = require('crypto');

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}
function md5Upper(s) {
  return md5(s).toUpperCase();
}

/**
 * 常見 VB6 補習班 client 的 key 組法候選。
 * salt 目前未知 —— 這些是「結構」候選；salt 常數需靠路徑 B 抓包反推填入。
 * exe 字串區出現過的可疑常數（可能是 salt 或測試值）：
 *   '23893110', 'JL23705999', 'LocalUser/L060', 'n@...'
 */
const SALT = process.env.ECLASS_SALT || ''; // ← 抓包反推後填進來

const RECIPES = {
  // 1) 全部參數順序串接 + salt
  concat_all: ({ code, stuSN, stuPass, macId, computerName }) =>
    md5(`${code}${stuSN}${stuPass}${macId}${computerName}${SALT}`),

  // 2) salt 前置
  salt_prefix: ({ code, stuSN, stuPass, macId, computerName }) =>
    md5(`${SALT}${code}${stuSN}${stuPass}${macId}${computerName}`),

  // 3) 只有帳密 + MAC（很多 client 只簽這三個）
  snpass_mac: ({ stuSN, stuPass, macId }) =>
    md5(`${stuSN}${stuPass}${macId}${SALT}`),

  // 4) 學號 + MAC + salt（綁機器導向）
  sn_mac: ({ stuSN, macId }) => md5(`${stuSN}${macId}${SALT}`),

  // 5) 大寫輸出變體
  concat_all_upper: ({ code, stuSN, stuPass, macId, computerName }) =>
    md5Upper(`${code}${stuSN}${stuPass}${macId}${computerName}${SALT}`),

  // 6) 用分隔符（有些系統用 & 或 |）
  concat_amp: ({ code, stuSN, stuPass, macId, computerName }) =>
    md5(`${code}&${stuSN}&${stuPass}&${macId}&${computerName}&${SALT}`),
};

/**
 * 目前啟用的公式。還原確認後改這裡。
 * 預設 concat_all —— 未確認前登入會被伺服器以 key 錯誤拒絕，屬預期行為。
 */
const ACTIVE_RECIPE = process.env.ECLASS_RECIPE || 'concat_all';

/**
 * @param {'CheckMac'} endpoint
 * @param {object} fields { code, stuSN, stuPass, macId, computerName }
 * @returns {string} key
 */
function computeKey(endpoint, fields) {
  const fn = RECIPES[ACTIVE_RECIPE];
  if (!fn) throw new Error(`unknown key recipe: ${ACTIVE_RECIPE}`);
  return fn(fields);
}

/**
 * 工具：對一組已知 (fields, 實際抓到的 key) 暴力試所有候選 + 常見 salt，
 * 命中就印出是哪個 recipe/salt。給路徑 B 用。
 * @param {object} fields
 * @param {string} observedKey  從抓包得到的真實 key
 * @param {string[]} saltCandidates
 */
function bruteforce(fields, observedKey, saltCandidates = ['', '23893110', 'JL23705999']) {
  const target = observedKey.toLowerCase();
  const results = [];
  for (const salt of saltCandidates) {
    const S = salt;
    const variants = {
      concat_all: `${fields.code}${fields.stuSN}${fields.stuPass}${fields.macId}${fields.computerName}${S}`,
      salt_prefix: `${S}${fields.code}${fields.stuSN}${fields.stuPass}${fields.macId}${fields.computerName}`,
      snpass_mac: `${fields.stuSN}${fields.stuPass}${fields.macId}${S}`,
      sn_mac: `${fields.stuSN}${fields.macId}${S}`,
      concat_amp: `${fields.code}&${fields.stuSN}&${fields.stuPass}&${fields.macId}&${fields.computerName}&${S}`,
    };
    for (const [name, input] of Object.entries(variants)) {
      const h = md5(input);
      if (h === target || h.toUpperCase() === observedKey) {
        results.push({ recipe: name, salt, input });
      }
    }
  }
  return results;
}

module.exports = { computeKey, bruteforce, RECIPES, md5, SALT, ACTIVE_RECIPE };
