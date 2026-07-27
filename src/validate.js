/* 資料完整性檢查。用法：node src/validate.js  （在 myLearning 資料夾執行） */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
global.window = global;
for (const f of ['words.js', 'grammar.js', 'sentences.js', 'memes.js']) {
  new Function(fs.readFileSync(path.join(root, 'data', f), 'utf8')).call(global);
}

let fail = 0;
const bad = (msg) => { console.log('  ✗ ' + msg); fail++; };
const ok = (msg) => console.log('  ✓ ' + msg);

console.log('\n=== words.js ===');
const V = window.VOCAB, M = window.VOCAB_META;
console.log(`  total ${V.length} | ${JSON.stringify(M.byLevel)}`);
V.length === 6012 ? ok('6012 words') : bad(`expected 6012, got ${V.length}`);
const lvCount = {};
V.forEach(w => lvCount[w.lv] = (lvCount[w.lv] || 0) + 1);
Object.values(lvCount).every(n => n === 1002)
  ? ok('every level has exactly 1002 words')
  : bad('uneven level counts: ' + JSON.stringify(lvCount));
V.every((w, i) => w.i === i) ? ok('index field matches array position') : bad('index/position mismatch');
const noTr = V.filter(w => !w.tr);
noTr.length === 0 ? ok('all words have a Chinese gloss') : bad(`${noTr.length} without gloss`);
const dupW = new Set(); const dups = V.filter(w => dupW.size === dupW.add(w.w.toLowerCase()).size);
dups.length === 0 ? ok('no duplicate headwords') : bad('duplicates: ' + dups.slice(0, 5).map(w => w.w));
const badCf = V.filter(w => (w.cf || []).some(j => !V[j] || j === w.i));
badCf.length === 0 ? ok('confusable indices all resolve') : bad(`${badCf.length} bad cf refs`);
const simp = V.filter(w => /[们么这个说时国东车产业务实电脑网软间题问对开关买卖压级华丽亲爱习]/.test(w.tr || ''));
simp.length === 0 ? ok('no simplified-Chinese residue in glosses')
  : bad(`${simp.length} glosses look simplified: ` + simp.slice(0, 6).map(w => `${w.w}=${w.tr}`).join(', '));
const badPos = V.filter(w => /\)\.$|\.\.$/.test(w.p));
badPos.length === 0 ? ok('POS strings well formed') : bad(`${badPos.length} malformed POS: ` + badPos.slice(0, 4).map(w => w.w + '=' + w.p));

console.log('\n=== grammar.js ===');
const G = window.GRAMMAR, T = window.GRAMMAR_TITLES, R = window.GRAMMAR_ROADMAP;
const allIds = R.flatMap(s => s.ids);
allIds.length === 32 ? ok('roadmap lists 32 grammar points') : bad(`roadmap has ${allIds.length}`);
allIds.every(id => T[id]) ? ok('every roadmap id has a title') : bad('missing titles: ' + allIds.filter(id => !T[id]));
const authored = Object.keys(G);
console.log(`  authored units: ${authored.length} (${authored.join(', ')})`);
authored.every(id => T[id]) ? ok('authored units all titled') : bad('untitled authored unit');
let gItems = 0;
for (const [id, u] of Object.entries(G)) {
  if (!u.brief || !u.rules?.length || !u.items?.length) bad(`${id} incomplete`);
  u.items.forEach((it, n) => {
    gItems++;
    if (it.type === 'mc') {
      if (!it.q || !Array.isArray(it.opts) || it.opts.length < 3) bad(`${id}#${n} bad mc`);
      if (typeof it.a !== 'number' || !it.opts[it.a]) bad(`${id}#${n} bad answer index`);
      if (new Set(it.opts).size !== it.opts.length) bad(`${id}#${n} duplicate options`);
      if (!/_{2,}/.test(it.q)) bad(`${id}#${n} mc question has no blank`);
    } else if (it.type === 'fix') {
      if (!it.bad || !it.answer) bad(`${id}#${n} bad fix item`);
      if (it.bad === it.answer) bad(`${id}#${n} fix answer identical to prompt`);
    } else bad(`${id}#${n} unknown type ${it.type}`);
    if (!it.why) bad(`${id}#${n} missing explanation`);
  });
}
ok(`${gItems} grammar items checked`);

console.log('\n=== sentences.js ===');
const S = window.SENTENCES;
const keys = Object.keys(S);
const byW = new Map(V.map(w => [w.w, w]));
console.log(`  entries: ${keys.length}`);
const miss = keys.filter(k => !byW.has(k));
miss.length === 0 ? ok('every key exists in words.js') : bad(`unknown keys: ${miss.join(', ')}`);
let markProb = [];
for (const [k, s] of Object.entries(S)) {
  if (!s.ex || !s.zh) { bad(`${k} missing ex/zh`); continue; }
  const marks = s.ex.match(/\{[^}]*\}/g) || [];
  if (marks.length !== 1) { markProb.push(`${k}: ${marks.length} markers`); continue; }
  const tok = marks[0].slice(1, -1);
  const head = k.split(/[/(]/)[0].toLowerCase();
  const stem = head.slice(0, Math.max(4, head.length - 3));
  if (!tok.toLowerCase().startsWith(stem)) markProb.push(`${k}: marked "${tok}"`);
  if (/[{}]/.test(s.zh)) bad(`${k} zh should not contain braces`);
  const words = s.ex.replace(/[{}]/g, '').split(/\s+/).length;
  if (words < 5 || words > 14) markProb.push(`${k}: ${words} words (want 5-14)`);
  if (s.gp && !T[s.gp]) bad(`${k} references unknown grammar point ${s.gp}`);
}
markProb.length === 0 ? ok('all example sentences well formed')
  : (console.log('  ! review:'), markProb.forEach(p => console.log('      ' + p)));
const lvSpread = {};
keys.forEach(k => { const w = byW.get(k); if (w) lvSpread[w.lv] = (lvSpread[w.lv] || 0) + 1; });
console.log('  level spread:', JSON.stringify(lvSpread));
const withGp = keys.filter(k => S[k].gp).length, withTrap = keys.filter(k => S[k].trap).length;
console.log(`  with grammar link: ${withGp} | with trap note: ${withTrap}`);

console.log('\n=== memes.js ===');
const ME = window.MEMES || {};
const memeKeys = ['pause', 'resume', 'ok', 'fast', 'wrong', 'timeout', 'combo', 'clear', 'fail',
  'gameover', 'levelup', 'checkin', 'cards', 'review', 'sweep', 'wrongStage', 'bonus', 'daily'];
const missing = memeKeys.filter(k => !Array.isArray(ME[k]) || !ME[k].length);
missing.length === 0 ? ok(`${memeKeys.length} 個情境都有台詞`) : bad('缺少台詞的情境: ' + missing);
const chestTiers = ['wood', 'silver', 'gold', 'rainbow'];
const badChest = chestTiers.filter(t => !Array.isArray((ME.chest || {})[t]) || !ME.chest[t].length);
badChest.length === 0 ? ok('四種寶箱都有台詞') : bad('缺少寶箱台詞: ' + badChest);
const allLines = memeKeys.flatMap(k => ME[k] || []).concat(chestTiers.flatMap(t => (ME.chest || {})[t] || []));
const tooLong = allLines.filter(x => typeof x !== 'string' || x.length > 32);
tooLong.length === 0 ? ok(`${allLines.length} 句台詞都在 32 字以內`) : bad('過長或型別錯誤: ' + tooLong.slice(0, 3));
const emptyLine = allLines.filter(x => !String(x).trim());
emptyLine.length === 0 ? ok('沒有空白台詞') : bad(`${emptyLine.length} 句空白`);
const dupLine = new Set(); const dupM = allLines.filter(x => dupLine.size === dupLine.add(x).size);
dupM.length === 0 ? ok('沒有重複台詞') : bad('重複: ' + dupM.slice(0, 3));
console.log(`  total lines: ${allLines.length}`);

console.log(fail === 0 ? '\n✅ all checks passed\n' : `\n❌ ${fail} check(s) failed\n`);
process.exit(fail === 0 ? 0 : 1);
