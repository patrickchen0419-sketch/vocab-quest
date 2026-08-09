/* 邏輯層測試（不需要瀏覽器）。用法：node src/test.js */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// --- 最小瀏覽器環境 ---
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.window = global;
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;

for (const f of ['data/words.js', 'data/grammar.js', 'data/sentences.js', 'data/memes.js', 'src/store.js', 'src/quiz.js']) {
  new Function(fs.readFileSync(path.join(root, f), 'utf8')).call(global);
}
const S = window.Store, Q = window.Quiz, V = window.VOCAB;

let pass = 0, fail = 0;
function t(name, fn) {
  try { const r = fn(); if (r === false) throw new Error('returned false'); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

console.log('\n--- 題目生成器 ---');
const sample = [0, 57, 500, 1200, 2509, 3000, 4000, 5000, 6011].map(i => V[i]);

t('q_e2c / q_c2e 對每個樣本都能生成，答案在選項中且四個選項互異', () => {
  for (const w of sample) {
    for (const gen of ['e2c', 'c2e']) {
      const q = gen === 'e2c' ? genOne(w, 'e2c') : genOne(w, 'c2e');
      assert(q, `${w.w} 無法生成 ${gen}`);
      assert(q.opts.length === 4, `${w.w} ${gen} 選項數 ${q.opts.length}`);
      assert(new Set(q.opts).size === 4, `${w.w} ${gen} 選項重複: ${q.opts}`);
      assert(q.opts[q.a] !== undefined, `${w.w} ${gen} 答案索引壞掉`);
      assert(Q.grade(q, q.a) === true, `${w.w} ${gen} 正解判成錯`);
      assert(Q.grade(q, (q.a + 1) % 4) === false, `${w.w} ${gen} 錯解判成對`);
    }
  }
});
function genOne(w, kind) {
  for (let k = 0; k < 40; k++) {
    const q = Q.forWord(w, kind === 'e2c' ? 0 : 1);
    if (q && q.kind === kind) return q;
  }
  // forWord 是隨機挑題型，改用整組題型直接找
  const set = Q.reviewSet([w.i]);
  return set.find(q => q.kind === kind) || null;
}

t('forWord 對全字庫 400 個隨機字都能產出可判分的題目', () => {
  for (let k = 0; k < 400; k++) {
    const w = V[Math.floor(Math.random() * V.length)];
    const q = Q.forWord(w);
    assert(q, `${w.w} 生不出題目`);
    assert(q.kind, 'kind 缺失');
    if (q.opts) {
      assert(q.opts.length >= 3, `${w.w} 選項太少`);
      assert(new Set(q.opts).size === q.opts.length, `${w.w} (${q.kind}) 選項重複: ${q.opts}`);
      assert(Q.grade(q, q.a) === true, `${w.w} (${q.kind}) 正解判錯`);
    } else {
      assert(q.answer || (q.accept && q.accept.length), `${w.w} (${q.kind}) 沒有答案`);
      assert(Q.grade(q, q.answer) === true, `${w.w} (${q.kind}) 正解判錯: ${q.answer}`);
    }
  }
});

t('聽力題不會拿「發音幾乎一樣」的字當選項（rice / raise 問題）', () => {
  const byW = new Map(V.map(w => [w.w, w]));
  assert(Q.phDist('raɪs', 'reɪz') < 3, 'phDist 應該判定 rice/raise 很接近');
  assert(Q.phDist('raɪs', 'ˈæpl̩') >= 2, 'phDist 應該判定差很多的字可以用');
  let checked = 0, bad = [];
  for (let k = 0; k < 3000; k++) {
    const w = V[Math.floor(Math.random() * V.length)];
    const q = Q.gen.listen(w);
    if (!q) continue;
    if (!q.opts.every(o => byW.has(o))) continue;      // 只檢查「聽音辨字」型
    checked++;
    const target = byW.get(q.opts[q.a]);
    q.opts.forEach((o, i) => {
      if (i === q.a) return;
      const other = byW.get(o);
      if (target && other && target.ph && other.ph && Q.phDist(target.ph, other.ph) < 2) {
        bad.push(`${target.w}(/${target.ph}/) vs ${other.w}(/${other.ph}/)`);
      }
    });
  }
  assert(checked > 100, '抽樣到的聽音辨字題太少：' + checked);
  assert(bad.length === 0, `有 ${bad.length} 組選項聽不出差別，例如 ${bad[0]}`);
});

t('聽力題會附上音標，畫面才能提供「聽不出來看音標」', () => {
  let withPh = 0, n = 0;
  for (let k = 0; k < 200; k++) {
    const w = V[Math.floor(Math.random() * V.length)];
    const q = Q.gen.listen(w);
    if (!q) continue;
    n++;
    if (q.prompt.ph) withPh++;
  }
  assert(n > 50, '樣本太少');
  assert(withPh / n > 0.9, `大部分聽力題都該帶音標：${withPh}/${n}`);
});

t('選項永遠不會重複：全字庫每個字掃 2 次', () => {
  // 曾經有兩個字的中文釋義都只有「誰」，2-gram 比對抓不到 → 出現兩個一樣的選項
  let dup = 0, badA = 0, sample = '';
  for (const w of V) {
    for (let k = 0; k < 2; k++) {
      const q = Q.forWord(w, null, 0);
      if (!q || !q.opts) continue;
      if (new Set(q.opts).size !== q.opts.length) { dup++; if (!sample) sample = `${w.w}(${q.kind}): ${q.opts.join(' | ')}`; }
      if (Q.grade(q, q.a) !== true) badA++;
    }
  }
  assert(dup === 0, `有 ${dup} 題選項重複，例如 ${sample}`);
  assert(badA === 0, `有 ${badA} 題的正解索引不對`);
});

t('釋義完全相同的兩個字不會互為選項', () => {
  // 找出釋義字面完全一樣的字對，確認不會被選成彼此的誘答
  const byTr = new Map();
  V.forEach(w => { if (w.tr) (byTr.get(w.tr.trim()) || byTr.set(w.tr.trim(), []).get(w.tr.trim())).push(w); });
  let pairs = 0;
  byTr.forEach(list => { if (list.length >= 2) pairs++; });
  assert(pairs > 0, '字庫裡沒有同釋義的字對，這個測試需要換樣本');
  for (const [tr, list] of byTr) {
    if (list.length < 2) continue;
    const w = list[0];
    for (let k = 0; k < 30; k++) {
      const q = Q.gen.e2c(w);
      if (!q) continue;
      const same = q.opts.filter(o => o.trim() === tr).length;
      assert(same === 1, `${w.w} 的選項出現 ${same} 個「${tr}」`);
    }
  }
});

t('拼字題答案接受大小寫與前後空白', () => {
  const w = V.find(x => Q.base(x.w) === 'academy');
  const q = Q.gen.spell(w);
  assert(q, '生不出 spell');
  // 拼字題只給字數，不給任何字母（連首字母都不給）
  assert(q.prompt.hint === '_______', `提示格式不對: ${q.prompt.hint}`);
  assert(!/[A-Za-z]/.test(q.prompt.hint), '提示不該出現任何字母');
  assert(q.prompt.hint.length === q.prompt.len, '底線數量要等於字母數');
  assert(Q.grade(q, 'ACADEMY') === true, '大寫應接受');
  assert(Q.grade(q, '  academy  ') === true, '空白應接受');
  assert(Q.grade(q, 'acadamy') === false, '拼錯應判錯');
});

t('括號型詞條的拼字題同時接受兩種形式（achieve / achievement）', () => {
  const w = V.find(x => x.w === 'achieve(ment)');
  const q = Q.gen.spell(w);
  assert(q, '生不出 spell');
  assert(Q.grade(q, 'achieve') === true, '應接受 achieve');
  assert(Q.grade(q, 'achievement') === true, '應接受 achievement');
  assert(Q.grade(q, 'achieved') === false, 'achieved 不該算對');
});

t('詞形變化題：選項互異、正解可判分，且涵蓋足夠多的字', () => {
  let made = 0;
  for (const w of V.filter(x => x.ex && Object.keys(x.ex).length).slice(0, 400)) {
    const q = Q.gen.form(w);
    if (!q) continue;
    made++;
    assert(new Set(q.opts).size === q.opts.length, `${w.w} form 選項重複: ${q.opts}`);
    assert(Q.grade(q, q.a) === true, `${w.w} form 正解判錯`);
    assert(q.prompt.ask, `${w.w} 沒說要問哪個形式`);
  }
  assert(made > 300, `只生成 ${made} 題詞形變化，太少`);
});

t('易混淆字題的選項都是拼字相近的真實單字', () => {
  const w = V.find(x => (x.cf || []).length >= 3);
  const q = Q.gen.confuse(w);
  assert(q, '生不出 confuse');
  assert(q.opts.length === 4 && new Set(q.opts).size === 4);
  assert(q.opts.every(o => V.some(x => x.w === o)), '選項含非真實單字');
  assert(Q.grade(q, q.a) === true, '正解判錯');
});

t('forWord 六種題型都會實際出現（守住加權選題）', () => {
  const w = V.find(x => x.w === 'academy');
  for (const tier of [0, 1, 4]) {
    const seen = new Set();
    for (let k = 0; k < 600; k++) seen.add(Q.forWord(w, tier).kind);
    for (const kind of ['e2c', 'c2e', 'listen', 'spell', 'form', 'confuse']) {
      assert(seen.has(kind), `box ${tier} 從未出現題型 ${kind}（只出現 ${[...seen]}）`);
    }
  }
});

t('forWord 依熟練度調整難度：熟字更常考拼字，生字更常考英→中', () => {
  const w = V.find(x => x.w === 'academy');
  const count = tier => {
    const c = {};
    for (let k = 0; k < 900; k++) { const kd = Q.forWord(w, tier).kind; c[kd] = (c[kd] || 0) + 1; }
    return c;
  };
  const fresh = count(0), known = count(5);
  assert(fresh.e2c > known.e2c, `生字應更常出 e2c（${fresh.e2c} vs ${known.e2c}）`);
  assert(known.spell > fresh.spell, `熟字應更常出 spell（${known.spell} vs ${fresh.spell}）`);
});

console.log('\n--- 運用層 ---');
t('applySet 生成克漏字／重組／中譯英，且都能判分', () => {
  const set = Q.applySet(9, []);
  assert(set.length >= 9, `只生成 ${set.length} 題`);
  const kinds = new Set(set.map(q => q.kind));
  ['cloze', 'order', 'trans'].forEach(k => assert(kinds.has(k), `缺少題型 ${k}`));
  assert(kinds.has('free'), '缺少自由造句題');
  for (const q of set) {
    if (q.noGrade) continue;
    if (q.opts) assert(Q.grade(q, q.a) === true, `${q.kind} 正解判錯`);
    else assert(Q.grade(q, q.answer) === true, `${q.kind} 正解判錯: ${q.answer}`);
  }
});

t('句子重組：正解含標點也算對，順序錯要判錯', () => {
  const byW = new Map(V.map(w => [w.w, w]));
  const w = byW.get('issue');
  let q = null;
  for (let k = 0; k < 60 && !q; k++) { const s = Q.applySet(6, [w.i]); q = s.find(x => x.kind === 'order'); }
  assert(q, '生不出 order');
  assert(Q.grade(q, q.answer) === true, '正解判錯');
  assert(Q.grade(q, q.answer.replace(/[.?!]$/, '')) === true, '缺句尾標點應仍算對');
  const rev = q.answer.split(' ').reverse().join(' ');
  assert(Q.grade(q, rev) === false, '亂序應判錯');
});

t('自由造句的機械檢查能抓到「沒用到目標字」與「缺標點」', () => {
  const w = V.find(x => x.w === 'issue');
  const q = Q.q_free(w);
  const good = Q.checkFree('The school issued a new rule today.', q.accept);
  assert(good.usedWord === true, '應偵測到用了 issue（變化形 issued）');
  assert(good.notes.length === 0, `乾淨句子不該有提醒: ${good.notes}`);
  const bad = Q.checkFree('i like apple', q.accept);
  assert(bad.usedWord === false, '應偵測到沒用到目標字');
  assert(bad.notes.length >= 3, `應有多項提醒，實際 ${bad.notes.length}`);
});

console.log('\n--- 文法 ---');
t('grammarSet 生成題目且正解可判分', () => {
  const g = Q.grammarSet(5);
  assert(g.questions.length === 5, `生成 ${g.questions.length} 題`);
  for (const q of g.questions) {
    assert(q.kind === 'gmc' || q.kind === 'gfix', 'kind 不對');
    if (q.opts) {
      assert(new Set(q.opts).size === q.opts.length, `選項重複: ${q.opts}`);
      assert(Q.grade(q, q.a) === true, 'gmc 正解判錯');
    } else {
      assert(Q.grade(q, q.answer) === true, 'gfix 正解判錯');
      assert(Q.grade(q, q.answer.toUpperCase()) === true, 'gfix 應忽略大小寫');
    }
    assert(q.why, '缺少解釋');
  }
});

t('所有 8 個文法單元的每一題正解都判得對', () => {
  for (const id of Object.keys(window.GRAMMAR)) {
    window.GRAMMAR[id].items.forEach((_, n) => {
      const q = Q.q_grammar(id, n);
      assert(q, `${id}#${n} 生不出`);
      if (q.opts) assert(Q.grade(q, q.a) === true, `${id}#${n} 正解判錯`);
      else assert(Q.grade(q, q.answer) === true, `${id}#${n} 正解判錯`);
    });
  }
});

console.log('\n--- 間隔複習排程 ---');
t('答對 → box 往上、到期日往後推；答錯 → box 歸零、當天到期', () => {
  const i = 100, today = S.todayStr();
  S.answer(i, true, 1);
  let r = S.rec(i);
  assert(r.b === 1, `box 應為 1，實際 ${r.b}`);
  assert(r.due === S.addDays(today, 1), `到期日應為明天，實際 ${r.due}`);
  S.answer(i, true, 1); S.answer(i, true, 1);
  r = S.rec(i);
  assert(r.b === 3 && r.due === S.addDays(today, 7), `三次答對後應 box3/7天，實際 box${r.b}/${r.due}`);
  S.answer(i, false, 1);
  r = S.rec(i);
  assert(r.b === 0, `答錯應歸零，實際 ${r.b}`);
  assert(r.due === today, `答錯應當天到期，實際 ${r.due}`);
});

t('首次作答正確率與總作答分開統計（重來不虛胖）', () => {
  const i = 200;
  S.answer(i, false, 1);   // 第一次答錯
  S.answer(i, true, 2);    // 重來答對
  S.answer(i, true, 2);
  const r = S.rec(i);
  assert(r.fs === 1, `首次作答數應為 1，實際 ${r.fs}`);
  assert(r.fr === 0, `首次答對數應為 0，實際 ${r.fr}`);
  assert(r.s === 3, `總作答數應為 3，實際 ${r.s}`);
});

t('dueList 依逾期天數排序，且不含未到期的字', () => {
  const list = S.dueList();
  const today = S.todayStr();
  assert(list.every(x => S.rec(x.i).due <= today), '含未到期的字');
  for (let k = 1; k < list.length; k++) assert(list[k - 1].over >= list[k].over, '排序不對');
});

console.log('\n--- 句子與文法出題率 ---');
t('每一關都固定有句子運用題與文法題', () => {
  const c = S.settings;
  c.applyPerStage = 2; c.gramPerStage = 1; c.sentRate = 60;
  const APPLY = ['cloze', 'order', 'trans', 'free'];
  let withApply = 0, withGram = 0;
  for (let k = 0; k < 20; k++) {
    const qs = Q.stageSet(3, 'C', 12, 0);
    assert(qs.length === 12, `題數應該維持 12，實際 ${qs.length}`);
    if (qs.filter(q => APPLY.includes(q.kind)).length >= 2) withApply++;
    if (qs.some(q => q.kind === 'gmc' || q.kind === 'gfix')) withGram++;
  }
  assert(withApply >= 18, `句子題名額沒生效：${withApply}/20`);
  assert(withGram >= 18, `文法題名額沒生效：${withGram}/20`);
});

t('出題以「沒學過的字」為優先', () => {
  const s = S.load();
  s.words = {};
  const ids = S.bucket(2, 'B');
  assert(ids.length >= 20, 'B 關字太少，換一個字母測');
  // 先把前 10 個字設成「已經學過而且練熟」
  const learned = ids.slice(0, 10);
  learned.forEach(i => { const r = S.rec(i); r.b = 4; r.due = S.addDays(S.todayStr(), 10); r.wr = 0; });
  let unseenFirst = 0, tot = 0;
  for (let k = 0; k < 30; k++) {
    const qs = Q.stageSet(2, 'B', 8, 0).filter(q => q.i != null);
    qs.forEach(q => { tot++; if (!S.isSeen(q.i)) unseenFirst++; });
  }
  assert(unseenFirst / tot > 0.85, `沒學過的字沒有被優先出：${unseenFirst}/${tot}`);
  s.words = {};
});

t('但保留最多 ¼ 名額給「本關到期或答錯過」的字，錯題不會被無限延後', () => {
  const s = S.load();
  s.words = {};
  const ids = S.bucket(2, 'C');
  const bad = ids.slice(0, 3);
  bad.forEach(i => { S.answer(i, false, 1); S.answer(i, false, 1); });   // 錯兩次
  let withBad = 0;
  for (let k = 0; k < 30; k++) {
    const qs = Q.stageSet(2, 'C', 12, 0).filter(q => q.i != null);
    const n = qs.filter(q => bad.includes(q.i)).length;
    assert(n <= 3, `錯題佔太多名額：${n}`);
    if (n >= 1) withBad++;
  }
  assert(withBad >= 28, `錯過的字幾乎沒被排進來：${withBad}/30`);
  s.words = {};
});

t('重新挑戰會換單字：答錯的字換題型再考，答對的字換掉', () => {
  const s = S.load();
  s.words = {};
  const ids = S.bucket(3, 'C');
  assert(ids.length >= 20, 'C 關字太少');
  // 第一輪：假設前 8 個字被考到，其中 3 個答錯
  const first = ids.slice(0, 8);
  const wrong = first.slice(0, 3), right = first.slice(3);
  const avoidKinds = {};
  first.forEach(i => { avoidKinds[i] = ['e2c']; });          // 假設全部考過英→中
  const qs = Q.stageSet(3, 'C', 10, 0, { keep: wrong, drop: right, avoidKinds });
  const got = qs.filter(q => q.i != null).map(q => q.i);
  // 答錯的字一定要再出現
  wrong.forEach(i => assert(got.includes(i), `答錯的字沒有再考：${V[i].w}`));
  // 答對的字要被換掉（除非字不夠）
  const kept = right.filter(i => got.includes(i));
  assert(kept.length === 0, `答對的字沒換掉：${kept.map(i => V[i].w)}`);
  // 而且題型要換掉
  qs.filter(q => avoidKinds[q.i]).forEach(q =>
    assert(q.kind !== 'e2c', `${V[q.i].w} 又出了同一種題型 e2c`));
  s.words = {};
});

t('字不夠時，重新挑戰仍然生得出題目（不會空白）', () => {
  const s = S.load();
  s.words = {};
  const ids = S.bucket(3, 'Z');
  if (!ids.length) return;
  const avoidKinds = {};
  ids.forEach(i => { avoidKinds[i] = ['e2c', 'c2e', 'listen', 'spell', 'form', 'confuse']; });
  const qs = Q.stageSet(3, 'Z', 10, 0, { keep: ids, drop: [], avoidKinds });
  assert(qs.length >= 1, '重來時生不出題目');
  qs.filter(q => q.i != null).forEach(q =>
    assert(V[q.i].w[0].toUpperCase() === 'Z', '重來時混進別的字母'));
  s.words = {};
});

t('關卡裡絕對不會出現別的字母的單字（每一級每一個字母都驗）', () => {
  // 硬規則：句子題湊不到本關的字就不出那題，不准把不相關的字拉進來
  for (const lv of [1, 3, 5]) {
    for (const L of S.LETTERS) {
      const ids = S.bucket(lv, L);
      if (!ids.length) continue;
      const qs = Q.stageSet(lv, L, 12, 0);
      qs.filter(q => q.i != null).forEach(q => {
        const w = V[q.i];
        assert(w.w[0].toUpperCase() === L,
          `第 ${lv} 級 ${L} 關混進了 ${w.w}（${w.w[0].toUpperCase()} 開頭、第 ${w.lv} 級、題型 ${q.kind}）`);
      });
      assert(!qs.some(q => q.outside), `第 ${lv} 級 ${L} 關出現延伸題（應該直接不出）`);
    }
  }
});

t('沒有例句的字母關就不出句子題，名額改考本關單字', () => {
  // 找一個「這一級這個字母完全沒有例句」的關（第 1、2、5、6 級目前都是）
  const SEN = window.SENTENCES;
  let target = null;
  for (const L of S.LETTERS) {
    const ids = S.bucket(1, L);
    if (ids.length >= 12 && ids.every(i => !SEN[V[i].w])) { target = { lv: 1, L, ids }; break; }
  }
  assert(target, '找不到完全沒有例句的關卡（例句庫可能已經全滿了）');
  for (let k = 0; k < 20; k++) {
    const qs = Q.stageSet(target.lv, target.L, 12, 0);
    const sent = qs.filter(q => ['cloze', 'order', 'trans', 'free'].includes(q.kind));
    assert(sent.length === 0, `${target.L} 關沒有例句卻出了句子題：` + sent.map(q => V[q.i].w));
    assert(qs.length === 12, `${target.L} 關題數不對：${qs.length}`);
    qs.filter(q => q.i != null).forEach(q =>
      assert(V[q.i].w[0].toUpperCase() === target.L, `${target.L} 關混進 ${V[q.i].w}`));
  }
});

t('第 3、4 級的每一個字母關都出得了句子題（例句已補齊）', () => {
  const SEN = window.SENTENCES;
  [3, 4].forEach(lv => {
    S.LETTERS.forEach(L => {
      const ids = S.bucket(lv, L);
      if (!ids.length) return;
      const withSent = ids.filter(i => SEN[V[i].w]).length;
      assert(withSent >= 1, `第 ${lv} 級 ${L} 關一個例句都沒有`);
    });
  });
});

t('字少的關卡湊不滿題數是正常的，但仍然只出本關的字', () => {
  const zIds = S.bucket(3, 'Z');
  if (!zIds.length) return;
  const qs = Q.stageSet(3, 'Z', 12, 0);
  assert(qs.length <= 12 && qs.length >= 1, '題數不合理：' + qs.length);
  qs.filter(q => q.i != null).forEach(q =>
    assert(V[q.i].w[0].toUpperCase() === 'Z', 'Z 關混進 ' + V[q.i].w));
  const own = new Set(qs.filter(q => q.i != null).map(q => q.i));
  assert(own.size === Math.min(zIds.length, 11), '本關的字沒用滿：' + own.size + '/' + Math.min(zIds.length, 11));
});

t('句子題優先用這一關的字，其次同一級', () => {
  const SEN = window.SENTENCES || {};
  const byW = new Map(V.map(w => [w.w, w]));
  // 第 3 級有例句的字最多，挑一個字首確定有例句的關來測
  const lv = 3;
  const letters = S.LETTERS.filter(L => S.bucket(lv, L).some(i => SEN[V[i].w]));
  assert(letters.length > 0, '找不到有例句的關卡');
  const L = letters[0];
  const ids = S.bucket(lv, L);
  let fromStage = 0, sameLv = 0, other = 0;
  for (let k = 0; k < 40; k++) {
    const qs = Q.applyPick(2, ids, lv);
    qs.forEach(q => {
      if (ids.includes(q.i)) fromStage++;
      else if (V[q.i].lv === lv) sameLv++;
      else other++;
    });
  }
  assert(fromStage > 0, '完全沒用到這一關的字');
  assert(other === 0 || sameLv + fromStage > other,
    `太常跑去用別級的字：關卡 ${fromStage} / 同級 ${sameLv} / 其他 ${other}`);
});

t('文法題跟著關卡：優先考這一關字連到的文法點', () => {
  const SEN = window.SENTENCES || {}, G = window.GRAMMAR;
  // 找一個「這一級這個字母裡有掛文法點的字」的關
  let target = null;
  for (const L of S.LETTERS) {
    const ids = S.bucket(3, L);
    const hit = ids.find(i => SEN[V[i].w] && SEN[V[i].w].gp && G[SEN[V[i].w].gp]);
    if (hit) { target = { L, ids, gp: SEN[V[hit].w].gp, word: V[hit].w }; break; }
  }
  assert(target, '找不到有連文法點的關卡');
  let matched = 0;
  for (let k = 0; k < 30; k++) {
    const qs = Q.grammarForStage(1, target.ids, 3);
    assert(qs.length === 1, '沒生出文法題');
    const links = target.ids.map(i => (SEN[V[i].w] || {}).gp).filter(x => x && G[x]);
    if (links.includes(qs[0].gid)) matched++;
  }
  assert(matched >= 27, `文法題沒跟著關卡的字走：${matched}/30`);
  const q = Q.grammarForStage(1, target.ids, 3)[0];
  assert(q.via && target.ids.some(i => V[i].w === q.via), '沒標出是從哪個字連過來的');
});

t('關卡沒有連到文法點時，按級別對應文法藍圖的階段', () => {
  assert(Q.bandForLevel(1)[0] === 'g1', '第 1 級應該對到第一階');
  assert(Q.bandForLevel(2).includes('g8'), '第 2 級也是第一階');
  assert(Q.bandForLevel(3)[0] === 'g9', '第 3 級應該對到第二階');
  assert(Q.bandForLevel(5)[0] === 'g17', '第 5 級應該對到第三階');
  assert(Q.bandForLevel(6)[0] === 'g25', '第 6 級應該對到第四階');
  // 目前只寫好第一階，所以高級別會退回「下一個沒精熟的單元」而不是生不出題
  const qs = Q.grammarForStage(2, [], 6);
  assert(qs.length === 2, '應該還是要生出 2 題文法題');
  qs.forEach(q => assert(q.kind === 'gmc' || q.kind === 'gfix', '不是文法題'));
});

t('句子題與文法題會散在考卷中間，不是全擠在最後', () => {
  const APPLY = ['cloze', 'order', 'trans', 'free', 'gmc', 'gfix'];
  let early = 0;
  for (let k = 0; k < 20; k++) {
    const qs = Q.stageSet(4, 'D', 12, 0);
    const pos = qs.map((q, i) => (APPLY.includes(q.kind) ? i : -1)).filter(i => i >= 0);
    if (pos.some(i => i < qs.length / 2)) early++;
  }
  assert(early >= 15, `插入題太集中在後面：${early}/20`);
});

t('有例句的字會直接考句子，比重可以調整', () => {
  const w = V.find(x => x.w === 'issue');
  assert(Q.hasSent(w), 'issue 應該有例句');
  const rate = (b) => {
    let sent = 0;
    for (let k = 0; k < 400; k++) {
      const kind = Q.forWord(w, b, 0).kind;
      if (['cloze', 'order', 'trans'].includes(kind)) sent++;
    }
    return sent / 400;
  };
  const c = S.settings;
  c.sentRate = 60;
  const mid = rate(2);
  assert(mid > 0.3 && mid < 0.75, `預設比重下的句子題率不合理：${mid}`);
  c.sentRate = 100;
  assert(rate(2) > mid, '調高比重應該更常出句子題');
  c.sentRate = 0;
  assert(rate(2) === 0, '比重 0 應該完全不出句子題');
  c.sentRate = 60;
  // 沒有例句的字只能考認字題
  const noSent = V.find(x => !Q.hasSent(x) && x.lv === 1);
  for (let k = 0; k < 50; k++) {
    assert(!['cloze', 'order', 'trans'].includes(Q.forWord(noSent, 2, 0).kind), '沒例句的字不該出句子題');
  }
});

t('熟練度越高越常考「自己組句子」（重組）', () => {
  const w = V.find(x => x.w === 'issue');
  const orderRate = b => {
    let n = 0;
    for (let k = 0; k < 500; k++) if (Q.forWord(w, b, 0).kind === 'order') n++;
    return n / 500;
  };
  assert(orderRate(5) > orderRate(0), '熟字應該更常考句子重組');
});

t('名額可以關掉：設成 0 就不出句子題與文法題', () => {
  const c = S.settings;
  c.applyPerStage = 0; c.gramPerStage = 0; c.sentRate = 0;
  const qs = Q.stageSet(3, 'C', 12, 0);
  assert(qs.every(q => !['cloze', 'order', 'trans', 'free', 'gmc', 'gfix'].includes(q.kind)), '關掉後還是出現句子／文法題');
  c.applyPerStage = 2; c.gramPerStage = 1; c.sentRate = 60;
});

console.log('\n--- 錯題加強出題率 ---');
t('錯過的字權重變高，連續答對會慢慢降回來', () => {
  const a = V.find(w => w.lv === 2 && !S.isSeen(w.i)).i;
  const b = V.filter(w => w.lv === 2 && !S.isSeen(w.i))[1].i;
  assert(S.errWeight(a) === 1, '沒紀錄的字權重應該是 1：' + S.errWeight(a));
  S.answer(a, true, 1);
  const rightW = S.errWeight(a);
  S.answer(b, false, 1);
  const wrongW = S.errWeight(b);
  assert(wrongW > rightW * 2, `答錯的權重要明顯高於答對：${wrongW} vs ${rightW}`);
  S.answer(b, false, 1);
  assert(S.errWeight(b) > wrongW, '錯第二次權重要再往上');
  const peak = S.errWeight(b);
  S.answer(b, true, 1); S.answer(b, true, 1); S.answer(b, true, 1);
  assert(S.errWeight(b) < peak, '連續答對之後權重要降下來');
});

t('抽題會依權重偏向錯題，但沒錯過的字仍有機會', () => {
  const ids = V.filter(w => w.lv === 5).slice(0, 20).map(w => w.i);
  ids.forEach(i => { const r = S.rec(i); r.b = 1; r.wr = 0; r.lw = 0; r.streakOk = 5; delete r.lwd; });
  const hot = ids.slice(0, 3);
  hot.forEach(i => { const r = S.rec(i); r.wr = 4; r.lw = 1; r.streakOk = 0; });
  let hotFirst = 0, coldSeen = 0;
  for (let k = 0; k < 300; k++) {
    const order = Q.byErrWeight(ids);
    if (hot.includes(order[0])) hotFirst++;
    if (!hot.includes(order[0])) coldSeen++;
  }
  assert(hotFirst > 150, `錯題排第一的次數太少：${hotFirst}/300`);
  assert(coldSeen > 20, `沒錯過的字完全被吃掉了：${coldSeen}/300`);
});

t('到期清單把錯題排前面', () => {
  const s = S.load();
  const ids = V.filter(w => w.lv === 6).slice(0, 6).map(w => w.i);
  ids.forEach(i => { const r = S.rec(i); r.b = 1; r.due = S.todayStr(); r.wr = 0; r.lw = 0; r.streakOk = 3; });
  const bad = ids[4];
  const r = S.rec(bad); r.wr = 5; r.lw = 1; r.streakOk = 0;
  const due = S.dueList().map(x => x.i);
  assert(due.indexOf(bad) < 3, '錯得最兇的字應該排在前面：' + due.indexOf(bad));
});

t('錯題本只收「錯過而且還沒練起來」的字，難字要錯 3 次以上', () => {
  const s = S.load();
  s.words = {};
  const ids = V.filter(w => w.lv === 4).slice(0, 5).map(w => w.i);
  const [w1, w2, w3] = ids;
  S.answer(w1, false, 1);                        // 錯 1 次
  S.answer(w2, false, 1); S.answer(w2, false, 1); S.answer(w2, false, 1);   // 錯 3 次 → 難字
  const r3 = S.rec(w3); r3.wr = 2; r3.b = 5;     // 錯過但已經練到 box 5
  const pool = S.wrongPool().map(x => x.i);
  assert(pool.includes(w1) && pool.includes(w2), '錯題本漏字');
  assert(!pool.includes(w3), 'box 5 的字不該還在錯題本');
  const lc = S.leeches().map(x => x.i);
  assert(lc.includes(w2) && !lc.includes(w1), '難字判定不對：' + JSON.stringify(lc));
  assert(S.wrongPool()[0].i === w2, '錯最多次的要排第一');
});

t('錯題關與難字關都抽得出題目', () => {
  const qs = Q.wrongSet(5, 0);
  assert(qs.length >= 1, '錯題關抽不出題');
  qs.forEach(q => assert(S.load().words[q.i].wr > 0, '錯題關混進沒錯過的字'));
  const ids = S.leeches(3).map(x => x.i);
  const lq = Q.fixSet(ids, 0);
  assert(lq.length === ids.length, '難字關題數不對');
});

console.log('\n--- 每日紀錄與成績單 ---');
t('summary 只採計第 1 次作答，並分開統計複習／運用／文法', () => {
  const d = S.day();
  d.log.length = 0; d.gram.length = 0; d.free.length = 0; d.newIds.length = 0;
  S.markNew([10, 11, 12]);
  S.logAnswer({ i: 10, t: 'e2c', ok: true, attempt: 1, ms: 2000 });
  S.logAnswer({ i: 11, t: 'spell', ok: false, attempt: 1, ms: 5000 });
  S.logAnswer({ i: 11, t: 'spell', ok: true, attempt: 2, ms: 3000 });   // 重來，不該計入
  S.logAnswer({ i: 12, t: 'cloze', ok: true, attempt: 1, ms: 4000 });
  S.logGrammar({ id: 'g1', n: 0, ok: true, attempt: 1, ms: 3000 });
  S.logGrammar({ id: 'g1', n: 1, ok: false, attempt: 1, ms: 3000 });
  S.logFree({ i: 10, w: V[10].w, text: 'Test sentence.', at: '' });
  const s = S.summary();
  assert(s.newCount === 3, `新字數 ${s.newCount}`);
  assert(s.reviewTotal === 2, `複習題數應為 2（cloze 歸運用），實際 ${s.reviewTotal}`);
  assert(s.reviewRight === 1 && s.reviewWrong === 1, `對${s.reviewRight}錯${s.reviewWrong}`);
  assert(s.applyTotal === 1 && s.applyRight === 1, `運用 ${s.applyRight}/${s.applyTotal}`);
  assert(s.gramTotal === 2 && s.gramRight === 1, `文法 ${s.gramRight}/${s.gramTotal}`);
  assert(s.wrongWords.length === 1 && s.wrongWords[0] === 11, `錯字清單 ${s.wrongWords}`);
  assert(s.free.length === 1, '自由造句沒記錄');
  assert(s.byType.e2c.n === 1 && s.byType.spell.n === 1, '題型統計不對');
});

t('連續天數：同一天重複學不會重複累加', () => {
  const before = S.touchStreak();
  const again = S.touchStreak();
  assert(before === again, `同日重複觸發: ${before} -> ${again}`);
  assert(before >= 1, '連續天數應至少 1');
});

t('XP 與等級：滿 400 XP 升一級', () => {
  const p = S.profile;
  p.xp = 0;
  assert(S.xpLevel(0) === 1 && S.xpLevel(399) === 1 && S.xpLevel(400) === 2, '等級換算錯');
  const r1 = S.addXp(399); assert(r1.levelUp === false, '399 不該升級');
  const r2 = S.addXp(1); assert(r2.levelUp === true && r2.level === 2, '400 應升到 Lv.2');
});

t('徽章在達成條件時解鎖，且不會重複發', () => {
  const p = S.profile;
  p.badges.length = 0;
  const got1 = S.checkBadges({ bestCombo: 12 });
  const names = got1.map(b => b.id);
  assert(names.includes('combo10'), `應解鎖十連擊，實際 ${names}`);
  const got2 = S.checkBadges({ bestCombo: 12 });
  assert(got2.every(b => b.id !== 'combo10'), '徽章重複發放');
});

t('history 回傳按日期排序的摘要', () => {
  const h = S.history(30);
  assert(Array.isArray(h) && h.length >= 1, '沒有歷史紀錄');
  for (let k = 1; k < h.length; k++) assert(h[k - 1].date <= h[k].date, '日期沒排序');
});

t('匯出的存檔結構可以被重新匯入（round-trip）', () => {
  const dump = JSON.stringify(S.load());
  const parsed = JSON.parse(dump);
  assert(parsed.profile && parsed.words && parsed.days, '存檔缺欄位');
  assert(typeof parsed.profile.xp === 'number', 'xp 型別不對');
});

console.log('\n--- 日期工具 ---');
t('跨月與跨年的日期加減正確', () => {
  assert(S.addDays('2026-01-31', 1) === '2026-02-01', S.addDays('2026-01-31', 1));
  assert(S.addDays('2026-12-31', 1) === '2027-01-01', S.addDays('2026-12-31', 1));
  assert(S.addDays('2024-02-28', 1) === '2024-02-29', '閏年 ' + S.addDays('2024-02-28', 1));
  assert(S.daysBetween('2026-01-01', '2026-03-01') === 59, '' + S.daysBetween('2026-01-01', '2026-03-01'));
  assert(S.daysBetween('2026-07-25', '2026-07-25') === 0);
});

console.log('\n--- 時間限制 ---');
t('每一種題型都有時間上限，且長題型給的時間比短題型多', () => {
  const L = Q.LIMITS;
  ['e2c', 'c2e', 'listen', 'confuse', 'form', 'spell', 'cloze', 'trans', 'order', 'gmc', 'gfix', 'free']
    .forEach(k => assert(L[k] > 0, `${k} 沒有時限`));
  assert(L.order > L.e2c, '句子重組應比四選一寬鬆');
  assert(L.gfix > L.gmc, '找錯改錯應比文法選擇寬鬆');
  assert(L.free >= L.order, '自由造句應該最寬鬆');
});

t('生成出來的每一題都帶 secs', () => {
  const all = Q.reviewSet([10, 20, 30]).concat(Q.applySet(6, []), Q.grammarSet(3).questions);
  assert(all.length > 5, '題目太少');
  all.forEach(q => assert(q.secs > 0, `${q.kind} 沒有 secs`));
});

console.log('\n--- 難度 ---');
t('四種難度的血量、時間、XP 倍率單調變化', () => {
  const o = S.DIFF_ORDER.map(id => S.DIFFICULTY[id]);
  for (let k = 1; k < o.length; k++) {
    assert(o[k].hearts <= o[k - 1].hearts, '血量應越來越少');
    assert(o[k].time <= o[k - 1].time, '時間應越來越緊');
    assert(o[k].xp >= o[k - 1].xp, 'XP 倍率應越來越高');
  }
});

t('難度會改變出題偏向：越難越常考拼字', () => {
  const w = V.find(x => x.w === 'academy');
  const count = shift => {
    let n = 0;
    for (let k = 0; k < 600; k++) if (Q.forWord(w, 1, shift).kind === 'spell') n++;
    return n;
  };
  assert(count(1) > count(-1), '難度提高應更常出拼字題');
});

t('公開四檔刻意寬鬆、獎勵也普通：血夠多、時間夠寬、XP 不誇張', () => {
  const o = S.DIFF_ORDER.map(id => S.DIFFICULTY[id]);
  assert(o[0].hearts >= 8, '輕鬆的血量不夠多：' + o[0].hearts);
  assert(o[o.length - 1].hearts >= 3, '公開難度不該只有一顆心 —— 那是究極的招牌');
  assert(o[0].time >= 1.5 && o[1].time > 1, '輕鬆／標準的時間應該很寬');
  assert(o[0].xp < 1 && o[1].xp < 1, '前面難度的獎勵應該低於基準（×1）');
  assert(o[o.length - 1].xp <= 1.5, '公開難度的 XP 不該追上究極階梯');
  o.forEach(d => assert(d.coin > 0 && d.coin <= 1.5, `${d.id} 的金幣倍率不該超過 ×1.5`));
});

t('setDifficulty 存得起來、讀得回', () => {
  S.setDifficulty('hard');
  assert(S.diff().id === 'hard', S.diff().id);
  S.setDifficulty('normal');
});

console.log('\n--- 究極階梯 ---');
t('兩段階梯各有入口密技，段內每個加號一階', () => {
  assert(S.ULTRA_MAX >= 12, '階數不夠：' + S.ULTRA_MAX);
  assert(S.SECRET_DIFFS.length === S.ULTRA_MAX, '階數與難度清單對不上');
  assert(S.ultraId(1) === 'ultra', '第 1 階要沿用舊 id，否則舊存檔會掉難度');
  assert(S.ULTRA_LADDERS.map(l => l.code).join(',') === 'EXTRA,EXTREMELY', '入口密技不對');
  assert(S.ultraEntry('EXTRA') === 1 && S.ultraEntry('EXTREMELY') === S.ASH_FROM, '入口階數不對');
  let n = 0;
  S.ULTRA_LADDERS.forEach(l => l.names.forEach((name, k) => {
    const d = S.DIFFICULTY[S.ultraId(++n)];
    assert(d.name === name, `第 ${n} 階的名字不對：${d.name}`);
    assert(d.code === l.code + '+'.repeat(k), `第 ${n} 階的密技不對：${d.code}`);
    assert(d.ultra === n && d.secret, `第 ${n} 階的標記不對`);
  }));
  assert(S.DIFFICULTY[S.ultraId(7)].code === 'EXTRA++++++', '究極段的頂應該是 EXTRA++++++');
  assert(S.DIFFICULTY[S.ultraId(S.ASH_FROM)].code === 'EXTREMELY', '灰燼段的第一階應該是 EXTREMELY');
  // 兩組密技不能互為前綴，否則打一組會誤觸另一組
  assert(!'EXTREMELY'.startsWith('EXTRA') && !'EXTRA'.startsWith('EXTREMELY'), '兩組密技互為前綴');
});

t('灰燼段（EXTREMELY）比究極段更狠：秒數下限、學習卡、拼字提示都收掉', () => {
  const fire = S.DIFFICULTY[S.ultraId(S.ASH_FROM - 1)];    // 究極段的頂
  const ash = S.DIFFICULTY[S.ultraId(S.ASH_FROM)];         // 灰燼段的第一階
  assert(!fire.ash && ash.ash, 'ash 標記不對');
  assert(ash.time < fire.time, '灰燼段的時間沒有更緊');
  assert(ash.xp > fire.xp && ash.coin > fire.coin, '灰燼段的獎勵沒有更高');
  assert(fire.minSec === 5 && ash.minSec === 3, `秒數下限不對：${fire.minSec} / ${ash.minSec}`);
  assert(!fire.noStudy && ash.noStudy, '灰燼段應該沒有學習卡');
  assert(!fire.noHint && ash.noHint, '灰燼段的拼字題應該不給字數');
  S.SECRET_DIFFS.slice(S.ASH_FROM - 1).forEach(id => {
    const d = S.DIFFICULTY[id];
    assert(d.pass === 1 && d.noItems && d.allKinds && d.chest === 'rainbow', `${d.name} 的規則沒有全開`);
  });
  const top = S.DIFFICULTY[S.ultraId(S.ULTRA_MAX)];
  assert(top.xp >= 30 && top.coin >= 12, '最頂階的獎勵不夠：XP ×' + top.xp);
});

t('階梯一階比一階硬、也一階比一階好賺', () => {
  const o = S.SECRET_DIFFS.map(id => S.DIFFICULTY[id]);
  for (let k = 1; k < o.length; k++) {
    assert(o[k].time < o[k - 1].time, `第 ${k + 1} 階的時間沒有更緊`);
    assert(o[k].pass >= o[k - 1].pass, `第 ${k + 1} 階的通關門檻沒有更嚴`);
    assert(o[k].xp > o[k - 1].xp, `第 ${k + 1} 階的 XP 沒有更高`);
    assert(o[k].coin > o[k - 1].coin, `第 ${k + 1} 階的金幣沒有更高`);
    assert(S.diffRank(o[k].id) > S.diffRank(o[k - 1].id), `第 ${k + 1} 階的排名沒有更高`);
  }
  assert(S.diffRank('ultra') > S.diffRank('extreme'), '第 1 階就該高於地獄');
  assert(o[0].xp >= 2.5 && o[0].hearts === 1, '第 1 階的參數被改鬆了');
  const top = o[o.length - 1];
  assert(top.pass === 1, '最頂階應該是「全對才算通關」：' + top.pass);
  assert(top.xp >= 10 && top.coin >= 5, '最頂階的獎勵不夠：XP ×' + top.xp);
  assert(top.xp / S.DIFFICULTY.extreme.xp >= 6, '究極和公開難度的獎勵差距不夠大');
});

t('第 3 階起禁道具、第 4 階起題型開關失效', () => {
  const at = n => S.DIFFICULTY[S.ultraId(n)];
  assert(!at(1).noItems && !at(2).noItems, '前兩階不該禁道具');
  for (let n = 3; n <= S.ULTRA_MAX; n++) assert(at(n).noItems, `第 ${n} 階應該禁道具`);
  assert(!at(3).allKinds, '第 3 階還不該蓋掉題型開關');
  for (let n = 4; n <= S.ULTRA_MAX; n++) assert(at(n).allKinds, `第 ${n} 階應該蓋掉題型開關`);

  S.setUltra(2);
  assert(S.itemsAllowed(), '第 2 階不該禁道具');
  S.setUltra(4);
  assert(!S.itemsAllowed(), '第 4 階沒有禁道具');
  S.toggleKind('spell');                                   // 玩家自己把拼字關掉
  assert(S.offKinds().includes('spell'), '沒有關掉拼字');
  assert(S.kindOn('spell'), '第 4 階應該無視題型開關');
  S.setUltra(0);
  assert(!S.kindOn('spell'), '回到公開難度，玩家關掉的題型要恢復生效');
  S.toggleKind('spell');
});

t('通關門檻跟著階數走，公開難度一律用 PASS_ACC', () => {
  S.setDifficulty('normal');
  assert(S.passAcc() === S.PASS_ACC, '公開難度的門檻被動到了');
  S.setUltra(1);
  assert(S.passAcc() > S.PASS_ACC, '第 1 階的門檻沒有變嚴');
  S.setUltra(S.ULTRA_MAX);
  assert(S.passAcc() === 1, '最頂階不是全對才過');
  S.setUltra(0);
});

t('ultraUp 一階一階往上，但只爬得到「自己這一段」的頂', () => {
  S.setUltra(0);
  S.setDifficulty('hard');
  assert(S.ultraUp() === 1 && S.diff().id === 'ultra', '第一次 up 沒有進第 1 階');
  assert(S.ultraUp() === 2 && S.diff().name === S.ULTRA_NAMES[1], '沒有升到第 2 階');
  for (let k = 0; k < 30; k++) S.ultraUp();
  assert(S.ultraLevel() === S.ASH_FROM - 1,
    `加號應該停在究極段的頂（第 ${S.ASH_FROM - 1} 階），不能撞進灰燼段：` + S.ultraLevel());
  // 灰燼段要另外一組密技才進得去；進去之後加號一樣只爬到自己這一段的頂
  S.setUltra(S.ultraEntry('EXTREMELY'));
  assert(S.diff().ash, '沒有進到灰燼段');
  for (let k = 0; k < 30; k++) S.ultraUp();
  assert(S.ultraLevel() === S.ULTRA_MAX, '灰燼段沒有爬到最頂：' + S.ultraLevel());
  S.setUltra(0);
  assert(!S.secretDiff() && S.settings.difficulty === 'hard', '關掉之後沒回到挑戰：' + S.settings.difficulty);
  S.setDifficulty('normal');
});

t('難度清單只列到爬到的那一階，還沒爬到的不劇透', () => {
  S.setUltra(0);
  assert(S.diffList().length === S.DIFF_ORDER.length, '沒解鎖卻列出究極');
  S.setUltra(3);
  assert(S.diffList().length === S.DIFF_ORDER.length + 3, '清單長度不對：' + S.diffList().join(','));
  assert(!S.diffList().includes(S.ultraId(4)), '第 4 階還沒爬到就列出來了');
  S.setDifficulty(S.ultraId(6));                           // 想用選的跳過去
  assert(S.ultraLevel() === 3, '沒爬到的階被選單跳過去了：' + S.ultraLevel());
  S.setDifficulty(S.ultraId(2));                           // 往回退是可以的
  assert(S.ultraLevel() === 2, '不能退回低階');
  S.setDifficulty('easy');
  assert(S.diff().ultra === 2, '究極強制中卻被換成公開難度');
  S.setUltra(0);
});

t('舊存檔只有布林值 secretDiff，換算成第 1 階', () => {
  S.setUltra(0);
  delete S.settings.ultraLv;
  S.settings.secretDiff = true;
  assert(S.ultraLevel() === 1 && S.secretDiff(), '舊存檔沒有換算成第 1 階');
  S.settings.secretDiff = false;
  assert(S.ultraLevel() === 0, '舊存檔關掉之後還是開著');
});

t('金幣跟著難度走：輕鬆最少、究極最頂最多', () => {
  S.setUltra(0);
  const at = id => { S.setDifficulty(id); return S.stageCoins(3, 5); };
  const easy = at('easy'), extreme = at('extreme');
  assert(easy < extreme, `輕鬆的金幣應該少於地獄：${easy} vs ${extreme}`);
  S.setUltra(S.ULTRA_MAX);
  const top = S.stageCoins(3, 5);
  assert(top > extreme * 3, `最頂階的金幣不夠多：${top} vs ${extreme}`);
  S.setUltra(0);
  S.setDifficulty('normal');
});

t('究極階梯的寶箱保底：走得出來就不會只拿到木箱', () => {
  const poor = { stars: 1, combo: 0, count: 5, retries: 1 };
  assert(S.chestTier(Object.assign({}, poor, { diff: 'normal' })) === 'wood', '公開難度不該有保底');
  assert(S.chestTier(Object.assign({}, poor, { diff: S.ultraId(1) })) === 'silver', '第 1 階保底銀箱');
  assert(S.chestTier(Object.assign({}, poor, { diff: S.ultraId(3) })) === 'gold', '第 3 階保底金箱');
  assert(S.chestTier(Object.assign({}, poor, { diff: S.ultraId(6) })) === 'rainbow', '第 6 階保底彩虹箱');
  // 保底只往上抬，不會把本來更好的箱子壓下來
  const great = { stars: 3, retries: 0, count: 20, combo: 20, diff: S.ultraId(1) };
  assert(S.chestTier(great) === 'rainbow', '保底把好成績壓下去了');
});

console.log('\n--- 每日任務與金幣 ---');
t('同一天的挑戰任務固定不變，且不再有逾時任務', () => {
  const a = S.questList('2026-07-25').map(q => q.id).join(',');
  const b = S.questList('2026-07-25').map(q => q.id).join(',');
  assert(a === b, '同一天任務不該變動');
  assert(!a.includes('notimeout'), '不該再有「沒有一題逾時」任務');
});

t('任務完成才發獎，而且只發一次', () => {
  const d = S.day();
  d.quests = {}; d.cleared = 5;
  const first = S.awardQuests();
  assert(first.some(q => q.id === 'clear1'), '通關任務沒發：' + first.map(q => q.id));
  const again = S.awardQuests();
  assert(again.length === 0, '重複發獎：' + again.map(q => q.id));
});

t('每個任務都同時給 XP 與金幣', () => {
  S.questList('2026-07-25').forEach(q => {
    assert(q.xp > 0, `${q.id} 沒有 XP`);
    assert(q.coin > 0, `${q.id} 沒有金幣`);
  });
});

t('金幣：買得起才扣款，買不起要擋下來', () => {
  const p = S.profile;
  p.coins = 0; p.inventory = {};
  assert(S.buy('heart').ok === false, '沒錢卻買成功');
  const cost = S.priceOf('heart');
  const purse = cost + 40;
  S.addCoins(purse);
  const r = S.buy('heart');
  assert(r.ok === true, '有錢卻買失敗：' + r.msg);
  assert(S.coins() === purse - cost, '扣款不對：' + S.coins());
  assert(S.inventory().heart === 1, '沒進背包');
  assert(S.consume('heart') === true && !S.inventory().heart, '消耗失敗');
});

t('外觀類道具買過就不能重複買，可裝備與取消', () => {
  const p = S.profile;
  p.coins = S.priceOf("theme_forest") + 50; p.inventory = {}; p.equipped = {};
  assert(S.buy('theme_forest').ok === true, '買不到主題');
  assert(S.buy('theme_forest').ok === false, '主題可以重複買');
  S.equip('theme_forest');
  assert(S.equipped('theme') === 'theme_forest', '沒裝備上');
  S.equip('theme_forest');
  assert(S.equipped('theme') === null, '再按一次應該取消裝備');
});

t('商店不賣會污染學習紀錄的道具', () => {
  const bad = S.SHOP.filter(x => /跳過|看答案|直接答對|自動答/.test(x.name + x.desc));
  assert(bad.length === 0, '出現了會讓紀錄失真的道具：' + bad.map(x => x.name));
});

console.log('\n--- 闖關地圖 ---');
t('關卡字數可由使用者指定，且優先出還沒學會的字', () => {
  const ids = S.bucket(3, 'B');
  const few = Q.stageSet(3, 'B', 5, 0);
  assert(few.length === 5, `指定 5 題卻出了 ${few.length} 題`);
  const all = Q.stageSet(3, 'B', ids.length, 0);
  assert(all.length === ids.length, '要全部時題數不對');
  S.answer(ids[0], true, 1); S.answer(ids[0], true, 1); S.answer(ids[0], true, 1);
  let firstIsWeak = 0;
  for (let k = 0; k < 30; k++) {
    const qs = Q.stageSet(3, 'B', 3, 0);
    if (!qs.some(q => q.i === ids[0])) firstIsWeak++;
  }
  assert(firstIsWeak > 20, '已經很熟的字仍然一直被抽到');
});

t('每一級 × 每個字母的關卡字數加起來剛好 1002', () => {
  for (let lv = 1; lv <= 6; lv++) {
    let sum = 0;
    S.LETTERS.forEach(L => { sum += S.mapStat(lv, L).total; });
    assert(sum === 1002, `第 ${lv} 級字數 ${sum}`);
  }
});

t('關卡的單字題只出該級、該字母開頭的字（句子與文法名額不受限）', () => {
  const RECOG_KINDS = ['e2c', 'c2e', 'listen', 'spell', 'form', 'confuse'];
  const qs = Q.stageSet(3, 'B', 12, 0);
  assert(qs.length > 0, '生不出題');
  qs.filter(q => RECOG_KINDS.includes(q.kind)).forEach(q => {
    const w = V[q.i];
    assert(w.lv === 3, `混到第 ${w.lv} 級的字 ${w.w}`);
    assert(w.w[0].toUpperCase() === 'B', `混到非 B 開頭的字 ${w.w}`);
  });
});

t('nextStage 會跳過沒有字的字母，走到底換下一級', () => {
  const n = S.nextStage(1, 'A');
  assert(n && n.lv === 1, '同級應往後走：' + JSON.stringify(n));
  const last = S.nextStage(1, 'Z');
  assert(last && last.lv === 2, 'Z 之後應跳下一級：' + JSON.stringify(last));
  assert(n.chunk === undefined, '不該再有段的概念');
  assert(S.nextStage(6, 'Z') === null, '最後一關之後不該還有下一關');
});

t('一個字母的字全部會了就自動完成、直接三星（篩掉的也算）', () => {
  const s = S.load();
  s.words = {}; s.map = {};
  const ids = S.bucket(2, 'K');
  assert(ids.length >= 2, 'K 關字太少');
  const before = S.mapStat(2, 'K');
  assert(before.full === false && before.stars === 0, '一開始不該是完成狀態');
  // 用快速篩選的方式標記（不是打關卡）
  ids.forEach(i => S.markKnown(i, 2));
  const after = S.mapStat(2, 'K');
  assert(after.known === after.total, '應該全部學會');
  assert(after.full === true, '完成度 100% 就該算完成');
  assert(after.stars === 3, '應該直接給三星，實際 ' + after.stars);
  assert(after.cleared === true, '應該算通過');
  assert(after.autoDone === true, '應該標記為自動完成');
  // 成就統計也要算進去
  const st = S.stats();
  assert(st.threeStars >= 1, '全三星統計沒算到自動完成的關');
  assert(st.clearedStages >= 1, '通關數沒算到自動完成的關');
  // 打過關卡的三星不會被降級
  s.map['2:K'] = { cleared: true, stars: 3, tries: 1, best: 1 };
  assert(S.mapStat(2, 'K').stars === 3, '打過的三星應該保留');
  s.words = {}; s.map = {};
});

t('全部學完＝真的通關：記進地圖、算今日通關數、發寶箱', () => {
  const s = S.load(), p = S.profile;
  s.words = {}; s.map = {}; p.chestBag = [];
  const d = S.day();
  d.cleared = 0;
  const ids = S.bucket(2, 'K');
  ids.forEach(i => S.markKnown(i, 2));
  const done = S.autoClear();
  assert(done.length >= 1, '沒有偵測到自動通關');
  const hit = done.find(x => x.lv === 2 && x.letter === 'K');
  assert(hit, '第 2 級 K 關沒被判定通關：' + JSON.stringify(done.map(x => x.lv + x.letter)));
  assert(s.map['2:K'] && s.map['2:K'].cleared === true, '沒記進關卡地圖');
  assert(s.map['2:K'].stars === 3, '沒給三星');
  assert(s.map['2:K'].auto === true, '沒標記為自動通關');
  assert(d.cleared >= 1, '沒算進今日通關數（每日任務要用）');
  assert(S.chestBag().some(c => /全部學會/.test(c.from)), '沒有發寶箱：' + JSON.stringify(S.chestBag()));
  // 不會重複觸發
  const again = S.autoClear();
  assert(!again.some(x => x.lv === 2 && x.letter === 'K'), '同一關重複通關');
  s.words = {}; s.map = {}; p.chestBag = [];
});

t('還沒全部學會就不會自動完成', () => {
  const s = S.load();
  s.words = {}; s.map = {};
  const ids = S.bucket(2, 'K');
  ids.slice(0, ids.length - 1).forEach(i => S.markKnown(i, 2));   // 少一個
  const st = S.mapStat(2, 'K');
  assert(st.full === false, '少一個字就不該算完成');
  assert(st.stars === 0, '不該給星星');
  s.words = {}; s.map = {};
});

t('重設一關：那些字回到沒學過，星星與通關紀錄清掉，別的關不受影響', () => {
  const s = S.load();
  s.words = {}; s.map = {};
  S.bucket(2, 'I').forEach(i => S.markKnown(i, 3));
  S.bucket(2, 'J').forEach(i => S.markKnown(i, 3));
  S.recordStage(2, 'I', true, 1, 3, 5);
  assert(S.mapStat(2, 'I').full === true, '前置條件：I 關應該是完成的');

  const out = S.resetStage(2, 'I');
  assert(out.words === S.bucket(2, 'I').length, `該清的字數不對：${out.words}`);
  const st = S.mapStat(2, 'I');
  assert(st.known === 0, 'I 關還有字被記成學會：' + st.known);
  assert(st.full === false && st.cleared === false, 'I 關還記著通關');
  assert(st.stars === 0 && st.tries === 0, '星星／挑戰次數沒清掉');
  assert(S.bucket(2, 'I').every(i => !S.isSeen(i) && S.needsCard(i)), '重設後應該要重新出學習卡');
  assert(S.mapStat(2, 'J').full === true, '不該動到隔壁的 J 關');
  s.words = {}; s.map = {};
});

t('通關才記 cleared，連勝正確增減', () => {
  const p = S.profile;
  p.winStreak = 0; p.inventory = {};
  S.recordStage(2, 'A', true, 0.9, 3);
  assert(S.winStreak() === 1, '通關後連勝應為 1');
  S.recordStage(2, 'B', true, 0.8, 2);
  assert(S.winStreak() === 2, '連勝沒累加');
  assert(S.mapStat(2, 'A').cleared === true, 'A 關沒記為通過');
  S.recordStage(2, 'C', false, 0.4, 1);
  assert(S.winStreak() === 0, '失敗後連勝應歸零');
  assert(S.mapStat(2, 'C').cleared === false, '沒過卻記成通過');
  assert(S.mapStat(2, 'C').tries === 1, '挑戰次數沒記');
});

t('連勝護盾會在失敗時擋下並被消耗', () => {
  const p = S.profile;
  p.winStreak = 3; p.inventory = { shield: 1 };
  const m = S.recordStage(4, 'D', false, 0.3, 1);
  assert(m.shielded === true, '護盾沒生效');
  assert(S.winStreak() === 3, '連勝沒保住：' + S.winStreak());
  assert(!S.inventory().shield, '護盾沒被消耗');
});

t('連勝加成有上限，不會無限膨脹', () => {
  const p = S.profile;
  p.winStreak = 100;
  assert(S.winStreakBonus() === 0.8, '上限應為 0.8，實際 ' + S.winStreakBonus());
  p.winStreak = 0;
  assert(S.winStreakBonus() === 0, '沒連勝就不該有加成');
});

t('通關門檻是 90%，低於就不算過', () => {
  assert(S.PASS_ACC === 0.90, '門檻改了記得同步說明文字');
  const p = S.profile;
  p.winStreak = 0; p.inventory = {};
  S.recordStage(5, 'A', false, 0.89, 1);
  assert(S.mapStat(5, 'A').cleared === false, '89% 不該算通過');
  S.recordStage(5, 'A', true, 0.90, 1);
  assert(S.mapStat(5, 'A').cleared === true, '90% 應該算通過');
});

console.log('\n--- 關卡紀錄（開始時間與使用時間）---');
t('每一關都留下開始時間、結束時間與用時', () => {
  const before = S.runLog().length;
  const id = S.startRun({ title: '測試關', lv: 3, letter: 'B', planned: 8 });
  assert(S.runLog().length === before + 1, '沒有新增關卡紀錄');
  const r0 = S.findRun(id);
  assert(r0.start && r0.startMs && r0.hour != null, '開始時間沒記全：' + JSON.stringify(r0));
  assert(r0.end === null, '還沒結束就有結束時間');
  const r = S.endRun(id, { passed: true, stars: 3, right: 8, answered: 8, acc: 1, combo: 8, xp: 120, coin: 30 });
  assert(r.end && r.sec >= 0, '結束時間或用時沒算：' + JSON.stringify(r));
  assert(r.passed === true && r.stars === 3, '結果沒寫進去');
  assert(S.runSeconds() >= r.sec, 'runSeconds 沒把這一關算進去');
  assert(S.runLog()[0].id === id, '最新的關卡應該排在最前面');
});

console.log('\n--- 作答紀錄 ---');
t('作答紀錄留住時間、你的答案與正確答案，並可篩選', () => {
  const d = S.day();
  d.log = []; d.gram = []; d.free = [];
  S.logAnswer({ i: 10, t: 'e2c', ok: true, attempt: 1, ms: 3000, given: 'A 的意思', right: 'A 的意思' });
  S.logAnswer({ i: 11, t: 'spell', ok: false, attempt: 1, ms: 9000, given: 'acadamy', right: 'academy', timeout: true });
  S.logGrammar({ id: 'g1', n: 0, ok: true, attempt: 1, ms: 4000, given: 'is', right: 'is' });
  S.logFree({ i: 12, w: 'issue', text: 'They issued a warning.' });
  const all = S.answerLog({});
  assert(all.total >= 4, '紀錄筆數不對：' + all.total);
  assert(all.rows.every(x => x.at), '每筆都要有時間戳');
  assert(all.rows.every(x => x.date), '每筆都要有日期');
  const wrong = S.answerLog({ only: 'wrong' });
  assert(wrong.rows.length === 1 && wrong.rows[0].given === 'acadamy', '答錯篩選不對');
  assert(wrong.rows[0].right === 'academy', '正確答案沒存下來');
  const free = S.answerLog({ only: 'free' });
  assert(free.rows.length === 1 && free.rows[0].cat === 'free', '自由造句篩選不對');
  const to = S.answerLog({ only: 'timeout' });
  assert(to.rows.length === 1, '逾時篩選不對');
  const page = S.answerLog({ limit: 2 });
  assert(page.rows.length === 2, '分頁沒生效');
  const tot = S.logTotals();
  assert(tot.n >= 2 && tot.first >= 2, 'logTotals 統計不對：' + JSON.stringify(tot));
});

console.log('\n--- 升等獎勵 ---');
t('升等會發獎勵，而且同一等只發一次', () => {
  const p = S.profile;
  p.xp = 0; p.rewardedLevel = 1; p.coins = 0; p.inventory = {};
  assert(S.claimLevelUps().length === 0, '沒升等卻發獎');
  S.addXp(S.XP_PER_LEVEL * 2);                  // 直接衝到 Lv.3
  const got = S.claimLevelUps();
  assert(got.length === 2, '兩級應該各發一次：' + got.length);
  assert(got.every(g => g.coin > 0), '升等應該給金幣');
  assert(S.coins() > 0, '金幣沒入帳');
  assert(S.inventory().fifty || S.inventory().heart || S.inventory().hourglass || S.inventory().xp2, '偶數等應該給道具');
  assert(S.claimLevelUps().length === 0, '重複發獎');
  assert(S.levelReward(5).unlock === 'theme_forest', 'Lv.5 應該解鎖主題');
});

t('每一等都有道具；10／50／100 等有大獎', () => {
  assert(S.levelReward(3).item, '單數等也要有道具');
  assert(S.levelReward(7).item, '每一等都要有道具');
  const r10 = S.levelReward(10);
  assert(r10.big && r10.chest === 'gold' && r10.mats.key === 1, 'Lv.10 要給金寶箱＋鑰匙');
  const r50 = S.levelReward(50);
  assert(r50.chest === 'rainbow' && r50.mats.gem_gold === 3, 'Lv.50 要給彩虹寶箱＋金鑽石');
  assert(r50.unlock === 'title_lv50', 'Lv.50 要發限定稱號');
  const r100 = S.levelReward(100);
  assert(r100.chest === 'rainbow' && r100.chestN === 3, 'Lv.100 要給三個彩虹寶箱');
  assert(r100.unlock === 'title_lv100', 'Lv.100 要發百級限定稱號');
  assert(S.levelReward(730).item && S.levelReward(730).coin > 0, '幾百等之後也要有獎可發');
});

t('百級稱號查得到名字、買不到、升等會真的發下來', () => {
  assert(S.shopItem('title_lv100').name.includes('一百級'), '百級稱號要查得到名字');
  assert(S.shopItem('title_lv200').name.includes('兩百級'), '兩百級稱號名字不對');
  assert(!S.buy('title_lv50').ok, '升等限定稱號不能用買的');
  assert(!S.buy('title_lv100').ok, '百級稱號不能用買的');
  const p = S.profile;
  p.xp = 0; p.rewardedLevel = 1;
  const chests = S.chestBagSummary().total, keys = S.matCount('key');
  S.addXp(S.XP_PER_LEVEL * 9);                  // 直接衝到 Lv.10
  const got = S.claimLevelUps();
  assert(got.length === 9, 'Lv.2〜10 應該各發一次：' + got.length);
  assert(S.chestBagSummary().total === chests + 1, 'Lv.10 的金寶箱要進背包');
  assert(S.matCount('key') === keys + 1, 'Lv.10 的鑰匙要進素材背包');
  assert(S.levelTitles().some(t => t.id === 'title_lv100'), '商店要展示下一個百級稱號目標');
});

console.log('\n--- 寶箱 ---');
t('大寶箱不能隨便給：金寶箱要 10 題以上全對不重來', () => {
  assert(S.chestTier({ stars: 3, retries: 0, count: 5 }) === 'silver', '小關卡全對只能給銀寶箱');
  assert(S.chestTier({ stars: 3, retries: 1, count: 20 }) === 'silver', '重來過就不該給金寶箱');
  assert(S.chestTier({ stars: 3, retries: 0, count: 10 }) === 'gold', '10 題全對不重來應該給金');
  assert(S.chestTier({ stars: 2, retries: 0, count: 20 }) === 'silver', '二星是銀寶箱');
  assert(S.chestTier({ stars: 1, combo: 12 }) === 'silver', '高連擊可以升到銀');
  assert(S.chestTier({ stars: 1, combo: 2 }) === 'wood', '普通表現是木寶箱');
});

t('彩虹寶箱需要 20 題全對＋連擊 20＋挑戰難度以上', () => {
  const base = { stars: 3, retries: 0, count: 20, combo: 20, diff: 'hard' };
  assert(S.chestTier(base) === 'rainbow', '條件全滿卻不是彩虹');
  assert(S.chestTier(Object.assign({}, base, { diff: 'normal' })) === 'gold', '標準難度不該給彩虹');
  assert(S.chestTier(Object.assign({}, base, { combo: 19 })) === 'gold', '連擊不足不該給彩虹');
  assert(S.chestTier(Object.assign({}, base, { count: 19 })) === 'gold', '題數不足不該給彩虹');
  assert(S.chestTier(Object.assign({}, base, { retries: 1 })) === 'silver', '重來過不該給彩虹');
  // 一般升級最多到金，只有加碼題（allowRainbow）能推到彩虹
  assert(S.upgradeChest('wood') === 'silver', '木應該升銀');
  assert(S.upgradeChest('gold') === 'gold', '一般情況金不該再升');
  assert(S.upgradeChest('gold', true) === 'rainbow', '加碼題應該能把金推到彩虹');
});

t('開箱抽獎：等級越高抽越多次，內容都會入帳並記錄', () => {
  const p = S.profile;
  p.coins = 0; p.xp = 0; p.inventory = {}; p.materials = {}; p.equipped = {};
  S.day().chests = [];
  const r = S.openChest('gold');
  assert(r.coin > 0 && r.xp > 0 && r.at, '開箱內容不完整：' + JSON.stringify(r));
  assert(r.drops.length >= S.CHEST.gold.rolls, `金寶箱應該抽 ${S.CHEST.gold.rolls} 次，實際 ${r.drops.length}`);
  assert(r.drops.every(d => d.label), '每個獎品都要有顯示文字');
  assert(S.coins() === r.coin, '金幣沒入帳');
  const matTotal = S.MAT_ORDER.reduce((a, id) => a + S.matCount(id), 0);
  const itemTotal = Object.values(S.inventory()).reduce((a, n) => a + n, 0);
  const gotFromDrops = r.drops.filter(d => d.kind === 'mat').reduce((a, d) => a + d.n, 0);
  assert(matTotal >= gotFromDrops, '素材沒進背包');
  assert(matTotal + itemTotal > 0, '一個獎品都沒發：' + JSON.stringify(r.drops));
  assert(S.chestLog().length === 1, '寶箱紀錄沒寫');
  assert(S.chestLog()[0].drops.length === r.drops.length, '紀錄沒存獎品明細');
});

t('稀有獎品機率低：木寶箱幾乎抽不到鑰匙／神秘禮物，彩虹明顯常見', () => {
  const rate = (tier, ids) => {
    let hit = 0;
    for (let k = 0; k < 4000; k++) if (ids.includes(S.rollOne(tier).id)) hit++;
    return hit / 4000;
  };
  const rare = ['m_key', 'i_revive', 'i_xp3', 'jackpot', 'megaxp', 'mystery', 'm_diamond'];
  const wood = rate('wood', rare), gold = rate('gold', rare), rainbow = rate('rainbow', rare);
  assert(wood < 0.05, '木寶箱的稀有率太高：' + wood);
  assert(gold > wood * 3, `金寶箱的稀有率應該明顯更高：${gold} vs ${wood}`);
  assert(rainbow > gold, `彩虹應該比金更容易出稀有：${rainbow} vs ${gold}`);
  assert(rate('wood', ['mystery']) < 0.01, '神秘禮物在木寶箱不該常見');
});

t('神秘禮物給的是還沒擁有的高階商品，全都有了就換成金幣大獎', () => {
  const p = S.profile;
  p.inventory = {}; p.coins = 0; p.materials = {};
  let gift = null;
  for (let k = 0; k < 60 && !gift; k++) {
    const r = S.openChest('rainbow');
    gift = (r.drops || []).find(d => d.kind === 'gift');
  }
  if (gift) {
    const it = S.shopItem(gift.item);
    assert(it && ['epic', 'legend', 'ultra'].includes(it.rarity), '神秘禮物應該是高階商品：' + JSON.stringify(gift));
    assert(S.inventory()[gift.item] >= 1, '神秘禮物沒進背包');
  }
  // 全部買光的情況：改給金幣大獎
  S.SHOP.forEach(x => { if (x.kind !== 'pack' && x.kind !== 'consumable') S.inventory()[x.id] = 1; });
  for (let k = 0; k < 40; k++) {
    const r = S.openChest('rainbow');
    const g = (r.drops || []).find(d => d.id === 'jackpot' && d.special);
    if (g) { assert(g.n >= 150, '金幣大獎太小'); break; }
  }
  p.inventory = {};
});

console.log('\n--- 任務：釘住、進度、每週每月 ---');
t('任務達成後就永久釘住，不會因為條件變動退回未完成', () => {
  const d = S.day();
  d.quests = {}; d.questDone = {}; d.cleared = 1; d.log = [];
  let q = S.questStatus().find(x => x.id === 'clear1');
  assert(q.done === true, '通關 1 關應該達成');
  assert(q.at, '達成時間沒記');
  d.cleared = 0;                                   // 條件被抽走
  q = S.questStatus().find(x => x.id === 'clear1');
  assert(q.done === true, '達成過的任務不該退回未完成');
});

t('每個任務都有目前進度與目標，可以畫進度條', () => {
  const list = S.questStatus('2026-07-25').concat(S.periodQuestStatus('week', '2026-07-25'), S.periodQuestStatus('month', '2026-07-25'));
  list.forEach(q => {
    assert(q.goal >= 1, `${q.id} 沒有目標值`);
    assert(typeof q.cur === 'number' && q.cur >= 0, `${q.id} 沒有目前進度`);
    assert(q.note, `${q.id} 沒有進度文字`);
    assert(q.xp > 0, `${q.id} 沒有 XP`);
  });
});

t('挑戰任務領完會換下一個，不會一直掛著做完的', () => {
  const t2 = '2026-07-28';
  const d = S.day(t2);
  d.quests = {}; d.questDone = {};
  const first = S.questList(t2).filter(q => ['連擊', '題型', '探索'].includes(q.tag));
  assert(first.length === 3, '應該有三個挑戰任務');
  // 假裝領走了「連擊」那一個
  const combo1 = first.find(q => q.tag === '連擊');
  d.quests[combo1.id] = true;
  const second = S.questList(t2).filter(q => q.tag === '連擊');
  assert(second.length === 1, '連擊任務應該還是只有一個');
  assert(second[0].id !== combo1.id, `領完之後應該換一個新的（還是 ${combo1.id}）`);
  // 其他類別不受影響
  const kind1 = first.find(q => q.tag === '題型');
  const kindNow = S.questList(t2).find(q => q.tag === '題型');
  assert(kindNow.id === kind1.id, '沒領的類別不該被換掉');
  // 固定任務與主打關不換
  d.quests.clear1 = true;
  assert(S.questList(t2).some(q => q.id === 'clear1'), '固定任務不該被換掉');
  d.quests = {}; d.questDone = {};
});

t('今日主打關只抽「還沒通過過」的關，不會叫人重打已經通關的', () => {
  const s = S.load();
  const snap = JSON.parse(JSON.stringify(s.words));
  const mapSnap = JSON.parse(JSON.stringify(s.map || {}));
  const t2 = '2026-07-30';
  S.day(t2).quests = {};
  try {
    // 第 1 級整級標成「通過過」（但字沒學完，所以完成度還不到 100%）
    s.map = s.map || {};
    S.LETTERS.forEach(L => { if (S.bucket(1, L).length) s.map['1:' + L] = { cleared: true, stars: 1 }; });
    let q = S.specialQuest(t2);
    assert(q && !S.mapStat(q.lv, q.letter).cleared, `抽到已經通關的關：第 ${q && q.lv} 級 ${q && q.letter}`);
    assert(q.lv !== 1, '第 1 級全部通關了卻還在第 1 級裡抽：' + q.lv);

    // 把第 1 級整級變成 100%（每個字都學會）
    S.LETTERS.forEach(L => S.bucket(1, L).forEach(i => {
      s.words[i] = Object.assign({ b: 0, due: null, s: 0, r: 0, wr: 0, fr: 0, fs: 0 }, s.words[i], { b: 3 });
    }));
    assert(S.LETTERS.every(L => !S.bucket(1, L).length || S.mapStat(1, L).full), '第 1 級沒有變成全滿');
    q = S.specialQuest(t2);
    assert(q, '第 1 級打完了就不給主打關了');
    assert(!S.mapStat(q.lv, q.letter).full, `抽到已經打完的關：第 ${q.lv} 級 ${q.letter}`);
    assert(q.lv !== 1, '第 1 級全滿了卻還在第 1 級裡抽：' + q.lv);

    // 領過的主打關要固定住：打完會讓那一關變 100%，這時候重抽會讓剛完成的任務憑空換掉
    S.day(t2).quests[q.id] = true;
    S.LETTERS.forEach(L => S.bucket(q.lv, L).forEach(i => {
      s.words[i] = Object.assign({ b: 0, due: null, s: 0, r: 0, wr: 0, fr: 0, fs: 0 }, s.words[i], { b: 3 });
    }));
    const again = S.specialQuest(t2);
    assert(again && again.id === q.id, `領過之後主打關被換掉了：${q.id} → ${again && again.id}`);
  } finally {
    s.words = snap;
    s.map = mapSnap;
    S.day(t2).quests = {};
  }
});

t('連續領獎會一路換下去（同一輪就把已達成的都發完）', () => {
  const t2 = '2026-07-29';
  const d = S.day(t2);
  d.quests = {}; d.questDone = {}; d.questLog = [];
  d.cleared = 5; d.bestCombo = 30;                 // 一次滿足很多任務
  d.log = []; d.runs = [];
  const got = S.awardQuests(t2);
  const ids = got.map(q => q.id);
  assert(new Set(ids).size === ids.length, '同一個任務被重複發獎：' + ids);
  assert(got.length >= 2, '應該一次發掉多個已達成的任務：' + ids);
  // 發完之後，看板上的挑戰任務都應該是還沒完成的（或者池子已經用完）
  const left = S.questList(t2).filter(q => ['連擊', '題型', '探索'].includes(q.tag));
  assert(left.length === 3, '挑戰任務數量應該維持 3 個');
  d.quests = {}; d.questDone = {}; d.cleared = 0; d.bestCombo = 0;
});

t('每日任務有多種類別，且每天固定不變', () => {
  const tags = new Set(S.questList('2026-07-25').map(q => q.tag));
  ['基本', '連擊', '題型', '探索'].forEach(x => assert(tags.has(x), '缺少任務類別：' + x));
  const a = S.questList('2026-08-01').map(q => q.id).join(',');
  assert(a === S.questList('2026-08-01').map(q => q.id).join(','), '同一天任務不該變動');
  const b = S.questList('2026-08-02').map(q => q.id).join(',');
  assert(a !== b || true, '不同天可以不同（允許偶爾相同）');
});

t('每週與每月任務：週鍵是週一，月鍵是 YYYY-MM', () => {
  assert(S.weekKey('2026-07-25') === 'W2026-07-20', '週鍵不對：' + S.weekKey('2026-07-25'));
  assert(S.weekKey('2026-07-20') === 'W2026-07-20', '週一自己就是週鍵');
  assert(S.monthKey('2026-07-25') === '2026-07', '月鍵不對');
  assert(S.weekDates('2026-07-25').length === 7, '一週應該 7 天');
  assert(S.weekQuestList('2026-07-25').length === 4, '每週任務應該 4 個');
  assert(S.monthQuestList('2026-07-25').length === 3, '每月任務應該 3 個');
  const w = S.periodQuestStatus('week', '2026-07-25');
  assert(w.every(q => q.period === 'week' && q.periodKey === 'W2026-07-20'), '週任務欄位不對');
});

t('任務完成會寫進紀錄，含時間與內容', () => {
  const d = S.day();
  d.quests = {}; d.questDone = {}; d.questLog = []; d.cleared = 3;
  const got = S.awardQuests();
  assert(got.length > 0, '沒發任何獎');
  const log = S.questLog();
  assert(log.length === got.length, '任務紀錄筆數不對');
  assert(log.every(x => x.at && x.name && x.xp >= 0), '任務紀錄欄位不全：' + JSON.stringify(log[0]));
  assert(S.questLog('all').length >= log.length, 'all 應該包含今天的紀錄');
});

console.log('\n--- 每日簽到軌道 ---');
t('簽到 7 天一輪，越後面越多，第 7 天給金寶箱', () => {
  const track = S.CHECKIN_TRACK;
  assert(track.length === 7, '軌道應該 7 天');
  for (let k = 1; k < track.length; k++) {
    assert(track[k].xp > track[k - 1].xp, '獎勵應該一天比一天多');
    assert(track[k].coin > track[k - 1].coin, '金幣應該一天比一天多');
  }
  assert(track[6].chest === 'gold', '第 7 天要給金寶箱');
  assert(S.checkinSlot(1).day === 1 && S.checkinSlot(8).day === 1, '第 8 天回到軌道第 1 天');
  assert(S.checkinSlot(8).cycle === 2, '第 8 天應該是第 2 輪');
  const pv = S.checkinPreview(10);
  assert(pv.days[0].xp > track[0].xp, '第 2 輪應該有加成');
  assert(pv.days.filter(x => x.state === 'past').length === 2, '前兩天應該標成已過');
});

t('簽到只有當天第一次生效，並寫進紀錄', () => {
  const p = S.profile;
  p.streak = 3; p.coins = 0; p.inventory = {};
  const d = S.day();
  delete d.checkin; d.questLog = [];
  const c = S.checkIn();
  assert(c && c.day === 3 && c.item === 'heart', '第 3 天應該附贈護心符：' + JSON.stringify(c));
  assert(S.inventory().heart === 1, '道具沒進背包');
  assert(S.checkIn() === null, '同一天不該重複簽到');
  assert(S.questLog().some(x => x.id === 'checkin'), '簽到沒寫進紀錄');
});

console.log('\n--- 商店與被動效果 ---');
t('商品變多也變貴，且分稀有度', () => {
  assert(S.SHOP.length >= 20, '商品種類太少：' + S.SHOP.length);
  ['consumable', 'auto', 'pet', 'theme', 'title'].forEach(k =>
    assert(S.SHOP.some(x => x.kind === k), '缺少類別：' + k));
  assert(S.SHOP.every(x => S.RARITY[x.rarity], '每件商品都要有稀有度'));
  // levelOnly 是升等限定的非賣品（cost 0），不算「商品」
  const forSale = S.SHOP.filter(x => !x.levelOnly);
  assert(forSale.every(x => x.cost >= 35), '有商品太便宜：' + forSale.filter(x => x.cost < 35).map(x => x.name));
  assert(Math.max(...forSale.map(x => x.cost)) >= 1000, '應該有很貴的收藏品');
});

t('被動道具與夥伴會影響倍率', () => {
  const p = S.profile;
  p.inventory = {}; p.equipped = {};
  assert(S.coinMult() === 1 && S.xpMult() === 1, '沒道具時倍率應為 1');
  p.inventory = { charm_magnet: 1, charm_luck: 1, charm_scholar: 1, pet_owl: 1 };
  p.equipped = { pet: 'pet_owl' };
  assert(S.coinMult() > 1, '金幣磁鐵沒生效');
  assert(S.xpMult() > 1, '夥伴沒生效');
  assert(S.checkinMult() > 1, '學者之心沒生效');
  assert(S.chestBoost().item > 0 && S.chestBoost().mult > 1, '幸運符沒生效');
  p.equipped = { pet: 'pet_fox' };
  assert(S.comboMult() === 1.5, '小狐狸應該讓連擊分 ×1.5');
  p.inventory = {}; p.equipped = {};
});

console.log('\n--- 成就 ---');
t('成就分五級，每個都有敘述與進度算法', () => {
  const tiers = new Set(S.BADGES.map(b => b.tier || 'common'));
  ['common', 'rare', 'epic', 'legend', 'ultra'].forEach(k => assert(tiers.has(k), '缺少等級：' + k));
  assert(S.BADGES.length >= 28, '成就數太少：' + S.BADGES.length);
  const ids = S.BADGES.map(b => b.id);
  assert(new Set(ids).size === ids.length, '成就 id 重複');
  const st = S.stats();
  S.BADGES.forEach(b => {
    assert(b.name && b.desc, b.id + ' 缺名稱或敘述');
    assert(S.BADGE_TIER[b.tier || 'common'], b.id + ' 等級不合法');
    const p = S.badgeProgress(b, st);
    assert(p.goal >= 1 && p.cur >= 0 && p.pct >= 0 && p.pct <= 1, b.id + ' 進度算錯：' + JSON.stringify(p));
  });
});

t('究極成就：全書 6012 字學會才算，少一個都不行', () => {
  const all = S.BADGES.find(b => b.id === 'allwords');
  const master = S.BADGES.find(b => b.id === 'allmaster');
  assert(all && master, '缺少究極成就');
  assert(all.tier === 'ultra' && master.tier === 'ultra', '究極成就等級不對');
  const total = V.length;
  assert(all.test({ known: total - 1, total }) === false, '少一個字就不該達成');
  assert(all.test({ known: total, total }) === true, '全部學會卻沒達成');
  assert(master.test({ mastered: total - 1, total }) === false, '少一個字就不該達成');
  assert(master.test({ mastered: total, total }) === true, '全部精熟卻沒達成');
  const p = S.badgeProgress(all, { known: 3006, total });
  assert(p.goal === total && Math.abs(p.pct - 0.5) < 0.01, '進度條算錯：' + JSON.stringify(p));
});

t('傳說成就要走完全圖／全三星，門檻跟著實際關卡數', () => {
  const allstage = S.BADGES.find(b => b.id === 'allstage');
  const allthree = S.BADGES.find(b => b.id === 'allthree');
  const st = S.stats();
  assert(st.playableStages > 100, '可玩關卡數不合理：' + st.playableStages);
  assert(allstage.test({ clearedStages: st.playableStages - 1, playableStages: st.playableStages }) === false, '少一關就不該達成');
  assert(allstage.test({ clearedStages: st.playableStages, playableStages: st.playableStages }) === true, '全通關卻沒達成');
  assert(allthree.test({ threeStars: st.playableStages, playableStages: st.playableStages }) === true, '全三星卻沒達成');
});

t('stats 提供成就要用的累積數字', () => {
  const st = S.stats();
  ['known', 'mastered', 'total', 'stars', 'clearedStages', 'threeStars', 'playableStages',
    'chests', 'gems', 'hellClears', 'ultraClears', 'exClears', 'minutes', 'gramDone', 'freeCount'].forEach(k =>
      assert(st[k] != null, '缺少欄位：' + k));
  assert(st.total === V.length, '總字數不對');
});

t('指向究極階梯的兩個成就是隱藏的 —— 寫在牆上就等於劇透有隱藏難度', () => {
  const hidden = S.BADGES.filter(b => b.hidden);
  assert(hidden.length === 2, '隱藏成就數量不對：' + hidden.map(b => b.id).join(','));
  assert(hidden.every(b => ['ultra10', 'exclear'].includes(b.id)), '隱藏的不是那兩個：' + hidden.map(b => b.id).join(','));
  // 其他成就都要看得到條件（隱藏是例外，不是常態）
  assert(S.BADGES.filter(b => !b.hidden).length === S.BADGES.length - 2, '把別的成就也藏起來了');
  // 藏歸藏，達成判定完全照常
  const ex = S.BADGES.find(b => b.id === 'exclear');
  assert(ex.test({ exClears: 1 }) === true, '隱藏成就變成拿不到了');
});

t('究極階梯的通關會被算進成就：地獄常客照算，另外有階梯專屬的兩個', () => {
  const day = S.day();
  const before = S.stats();
  day.runs = (day.runs || []).concat([
    { passed: true, diff: 'extreme' },
    { passed: true, diff: S.ultraId(2) },
    { passed: true, diff: S.ultraId(S.ULTRA_MAX) },
    { passed: false, diff: S.ultraId(S.ULTRA_MAX) },        // 沒通關的不算
  ]);
  const st = S.stats();
  assert(st.hellClears === before.hellClears + 3, '究極階梯的通關沒有算進「地獄以上」：' + st.hellClears);
  assert(st.ultraClears === before.ultraClears + 2, '階梯通關次數不對：' + st.ultraClears);
  assert(st.exClears === before.exClears + 1, '最頂階通關次數不對：' + st.exClears);

  const ex = S.BADGES.find(b => b.id === 'exclear');
  const u10 = S.BADGES.find(b => b.id === 'ultra10');
  assert(ex && ex.tier === 'ultra', '缺少最頂階成就，或等級不對');
  assert(u10 && u10.tier === 'legend', '缺少階梯常客成就，或等級不對');
  assert(ex.test({ exClears: 0 }) === false && ex.test({ exClears: 1 }) === true, '最頂階成就的條件不對');
  assert(u10.test({ ultraClears: 9 }) === false && u10.test({ ultraClears: 10 }) === true, '階梯常客的條件不對');
  day.runs = day.runs.slice(0, -4);
});

t('新成就在條件達成時會解鎖（用假的統計驗證）', () => {
  const p = S.profile;
  p.badges = [];
  const got = S.checkBadges({ known: 6012, total: 6012, mastered: 6012, streak: 100, level: 20 });
  const names = got.map(b => b.id);
  ['allwords', 'allmaster', 'streak100', 'w4000', 'lv20'].forEach(id =>
    assert(names.includes(id), '沒解鎖：' + id));
  assert(S.checkBadges({ known: 6012, total: 6012 }).every(b => b.id !== 'allwords'), '成就重複發放');
  p.badges = [];
});

t('舊存檔會補償先前被自動吃掉的道具，而且只補一次', () => {
  const p = S.profile;
  p.makeupOptIn = false; p.inventory = {}; p.coins = 0; p.xp = 500;   // 有進度＝老玩家
  const got = S.grantMakeup();
  assert(got, '老玩家應該拿到補償');
  assert(S.inventory().heart === S.MAKEUP.heart, '護心符沒補到');
  assert(S.coins() === 600, '金幣沒補到：' + S.coins());
  assert(S.grantMakeup() === null, '補償重複發放');
  const again = JSON.stringify(S.inventory());
  S.grantMakeup();
  assert(JSON.stringify(S.inventory()) === again, '重複呼叫改動了背包');
});

t('全新玩家不會拿到補償（本來就沒被燒過）', () => {
  const p = S.profile, s = S.load();
  const days = s.days;
  s.days = {};
  p.makeupOptIn = false; p.inventory = {}; p.coins = 0; p.xp = 0;
  assert(S.grantMakeup() === null, '全新玩家不該拿補償');
  assert(!Object.keys(S.inventory()).length, '不該給任何道具');
  s.days = days;
});

console.log('\n--- 商店經濟（北歐物價）---');
t('商品變多、有素材包、能買的稱號只留三個', () => {
  assert(S.SHOP.length >= 30, '商品數太少：' + S.SHOP.length);
  const titles = S.SHOP.filter(x => x.kind === 'title' && !x.levelOnly);
  assert(titles.length === 3, '能買的稱號應該只留 3 個，實際 ' + titles.length);
  S.SHOP.filter(x => x.levelOnly).forEach(x => assert(!S.buy(x.id).ok, x.id + ' 不該買得到'));
  const packs = S.SHOP.filter(x => x.kind === 'pack');
  assert(packs.length >= 4, '素材包太少：' + packs.length);
  packs.forEach(p => assert(p.give && Object.keys(p.give).length, p.id + ' 沒有內容物'));
  assert(S.SHOP.some(x => x.rarity === 'ultra'), '缺少究極稀有度商品');
});

t('價格很痛：最便宜也要 90，最貴超過 20000', () => {
  const costs = S.SHOP.filter(x => !x.levelOnly).map(x => x.cost);
  assert(Math.min(...costs) >= 90, '有商品太便宜：' + Math.min(...costs));
  assert(Math.max(...costs) >= 20000, '最貴的商品不夠貴：' + Math.max(...costs));
  // 一天認真學大約 300–600 金幣：傳說級要存好幾週才買得起
  const legend = S.SHOP.filter(x => !x.levelOnly && (x.rarity === 'legend' || x.rarity === 'ultra'));
  assert(legend.every(x => x.cost >= 3000), '傳說／究極商品應該都要 3000 以上');
});

t('素材包買了直接變素材，不佔道具欄，可以重複買', () => {
  const p = S.profile;
  p.coins = 100000; p.inventory = {}; p.materials = {};
  S.day().drops = [];
  const r1 = S.buy('pack_gem');
  assert(r1.ok && r1.pack === true, '素材包沒特別處理：' + JSON.stringify(r1));
  assert(!S.inventory().pack_gem, '素材包不該進道具欄');
  assert(S.matCount('gem_blue') === 2 && S.matCount('gem_red') === 1, '素材沒發：' + JSON.stringify(S.mats()));
  const r2 = S.buy('pack_gem');
  assert(r2.ok === true, '素材包不能重複買');
  assert(S.matCount('gem_blue') === 4, '第二次沒發素材');
  assert(S.dropLog().some(x => /商店/.test(x.from || '')), '素材包沒寫進掉落紀錄');
});

t('新的被動效果：經驗護符、素材磁鐵、獨角獸', () => {
  const p = S.profile;
  p.inventory = {}; p.equipped = {}; p.materials = {};
  const base = S.matDrop({ passed: true, lv: 1, stars: 1, combo: 0 })[0].n;
  p.inventory = { charm_gem: 1 };
  assert(S.matDrop({ passed: true, lv: 1, stars: 1, combo: 0 })[0].n === base + 1, '素材磁鐵沒生效');
  p.inventory = { charm_xp: 1 };
  assert(Math.abs(S.xpMult() - 1.1) < 1e-9, '經驗護符沒生效：' + S.xpMult());
  p.inventory = { charm_xp: 1, pet_owl: 1 };
  p.equipped = { pet: 'pet_owl' };
  assert(S.xpMult() > 1.15, '護符與夥伴應該疊加：' + S.xpMult());
  p.inventory = { pet_unicorn: 1 };
  p.equipped = { pet: 'pet_unicorn' };
  let upgraded = 0;
  for (let k = 0; k < 400; k++) { S.day().chests = []; if (S.openChest('wood').tier !== 'wood') upgraded++; }
  assert(upgraded > 40, '獨角獸的升級機率沒生效：' + upgraded);
  p.inventory = {}; p.equipped = {};
});

console.log('\n--- 背包：素材與合成 ---');
t('通關才掉素材，級別與星數決定掉什麼', () => {
  assert(S.matDrop({ passed: false, lv: 3, stars: 3 }).length === 0, '沒通關不該掉素材');
  const low = S.matDrop({ passed: true, lv: 1, stars: 1, combo: 0 });
  assert(low.some(x => x.id === 'gem_blue'), '低級關應該掉藍寶石：' + JSON.stringify(low));
  const high = S.matDrop({ passed: true, lv: 5, stars: 1, combo: 0 });
  assert(high.some(x => x.id === 'gem_red'), '高級關應該掉紅寶石');
  let sawGold = false, sawDust = false;
  for (let k = 0; k < 200; k++) {
    const d = S.matDrop({ passed: true, lv: 3, stars: 3, combo: 16 });
    if (d.some(x => x.id === 'gem_gold')) sawGold = true;
    if (d.some(x => x.id === 'stardust' && x.n === 2)) sawDust = true;
  }
  assert(sawGold, '三星應該有機會掉金鑽石');
  assert(sawDust, '高連擊應該掉星塵');
});

t('素材進背包、寫進掉落紀錄，並累計今日寶石數', () => {
  const p = S.profile;
  p.materials = {};
  S.day().drops = [];
  const got = S.grantMats([{ id: 'gem_blue', n: 2 }, { id: 'key', n: 1 }], '第 3 級 B 關');
  assert(got.length === 2, '掉落沒收下');
  assert(S.matCount('gem_blue') === 2 && S.matCount('key') === 1, '素材沒進背包');
  const log = S.dropLog();
  assert(log.length === 2 && log.every(x => x.at && x.from), '掉落紀錄不完整：' + JSON.stringify(log[0]));
  assert(S.gemsToday() === 2, '今日寶石數不對：' + S.gemsToday());
  assert(S.MAT_ORDER.every(id => S.material(id)), '素材定義不全');
});

t('合成：素材不夠不能做，做了就扣素材給道具', () => {
  const p = S.profile;
  p.materials = { gem_blue: 1 }; p.inventory = {}; p.coins = 0;
  assert(S.canCraft('r_fifty') === false, '素材不夠卻可以合成');
  assert(S.craft('r_fifty').ok === false, '素材不夠卻合成成功');
  S.addMat('gem_blue', 1);
  assert(S.canCraft('r_fifty') === true, '素材夠了卻不能合成');
  const r = S.craft('r_fifty');
  assert(r.ok === true, '合成失敗：' + r.msg);
  assert(S.inventory().fifty === 1, '道具沒進背包');
  assert(S.matCount('gem_blue') === 0, '素材沒扣掉');
  assert(S.day().crafted >= 1, '合成次數沒記（每日任務要用）');
});

t('合成需要金幣時，金幣不夠就整筆不做（不會扣素材）', () => {
  const p = S.profile;
  p.materials = { stardust: 3, gem_red: 1 }; p.coins = 0; p.inventory = {};
  const r = S.craft('r_xp2');
  assert(r.ok === false, '沒金幣卻合成成功');
  assert(S.matCount('stardust') === 3, '失敗卻扣了素材');
});

t('鑰匙可以在背包直接開一個銀寶箱', () => {
  const p = S.profile;
  p.materials = { key: 1 }; p.coins = 0;
  const r = S.useKey();
  assert(r && r.tier === 'silver', '鑰匙沒開出銀寶箱：' + JSON.stringify(r));
  // 銀寶箱本身有機率再開出鑰匙，所以扣款要扣掉這次開出的量再比對
  const keyBack = (r.drops || []).filter(d => d.mat === 'key').reduce((a, d) => a + d.n, 0);
  assert(S.matCount('key') === keyBack, `鑰匙沒消耗（剩 ${S.matCount('key')}，這次開出 ${keyBack}）`);
  p.materials = {};
  assert(S.useKey() === null, '沒鑰匙卻能開箱');
});

t('素材不能用金幣買（只能靠闖關與合成拿到）', () => {
  const ids = S.SHOP.map(x => x.id);
  S.MAT_ORDER.forEach(m => assert(!ids.includes(m), '素材出現在商店：' + m));
});

console.log('\n--- 寶箱可以先收起來 ---');
t('通關的寶箱先存進背包，可以指定開或一次全開', () => {
  const p = S.profile;
  p.chestBag = []; p.coins = 0; p.xp = 0; p.inventory = {}; p.materials = {}; p.equipped = {};
  S.day().chests = [];
  const id1 = S.addChest('wood', '第 1 級 A 關');
  const id2 = S.addChest('gold', '第 3 級 B 關');
  assert(S.chestBag().length === 2, '沒存進背包');
  const sum = S.chestBagSummary();
  assert(sum.total === 2 && sum.byTier.wood === 1 && sum.byTier.gold === 1, '統計不對：' + JSON.stringify(sum));
  const r = S.openStored(id1);
  assert(r && r.tier === 'wood', '指定開箱失敗：' + JSON.stringify(r));
  assert(S.chestBag().length === 1, '開過的箱子沒從背包移除');
  assert(S.chestBag()[0].id === id2, '移除到錯的箱子');
  assert(S.coins() === r.coin, '金幣沒入帳');
});

t('所有寶箱來源都會流進背包（通關、鑰匙、簽到第 7 天、里程碑）', () => {
  const p = S.profile;
  p.chestBag = []; p.coins = 0; p.inventory = {}; p.materials = {};
  // 簽到第 7 天：軌道上寫了金寶箱，就必須真的發出來
  p.streak = 7;
  const d = S.day();
  delete d.checkin; d.questLog = [];
  const c = S.checkIn();
  assert(c && c.chest === 'gold', '第 7 天應該有金寶箱：' + JSON.stringify(c && c.chest));
  assert(S.chestBag().length === 1, '簽到的金寶箱沒有進背包（只寫在紀錄裡不算數）');
  assert(S.chestBag()[0].tier === 'gold', '簽到給的不是金寶箱');
  assert(/簽到/.test(S.chestBag()[0].from), '沒記錄寶箱來源：' + S.chestBag()[0].from);
  // 里程碑（連續 30 天）要再給一個彩虹寶箱
  p.chestBag = []; p.streak = 30;
  delete S.day().checkin;
  const c2 = S.checkIn();
  assert(c2.milestone, '第 30 天應該有里程碑');
  assert(S.chestBag().some(x => x.tier === 'rainbow'), '里程碑的彩虹寶箱沒進背包');
  p.streak = 1;
});

t('一次全開會清空背包並回報總計', () => {
  const p = S.profile;
  p.chestBag = []; p.coins = 0; p.xp = 0; p.inventory = {}; p.materials = {};
  S.day().chests = [];
  ['wood', 'wood', 'silver', 'gold'].forEach((t2, k) => S.addChest(t2, '測試 ' + k));
  const all = S.openAllStored();
  assert(all && all.count === 4, '沒有全開：' + JSON.stringify(all && all.count));
  assert(S.chestBag().length === 0, '全開後背包沒清空');
  assert(all.total.coin > 0 && all.total.xp > 0, '總計不對');
  const sumCoin = all.results.reduce((a, x) => a + x.coin, 0);
  assert(all.total.coin === sumCoin, '總計金幣與逐箱不符');
  assert(S.coins() === all.total.coin, '金幣沒入帳');
  assert(S.chestLog().length === 4, '寶箱紀錄應該有 4 筆');
  assert(S.openAllStored() === null, '空背包不該還能全開');
});

console.log('\n--- 商店每日特價 ---');
t('每日特價每天兩件、固定不變，且真的算便宜', () => {
  const a = S.dealsToday('2026-07-25');
  assert(a.length === 2, '特價應該兩件：' + a.length);
  assert(a.map(x => x.id).join() === S.dealsToday('2026-07-25').map(x => x.id).join(), '同一天特價不該變');
  a.forEach(d => {
    assert(d.cost < d.full, '特價沒比原價便宜');
    assert(S.shopItem(d.id).cost >= 100, '特價只挑貴的商品');
  });
  const b = S.dealsToday('2026-08-15');
  assert(a.map(x => x.id).join() !== b.map(x => x.id).join() || true, '不同天可以不同');
});

t('已經擁有的單品不會再上特價', () => {
  const p = S.profile;
  p.inventory = {}; p.coins = 0;
  const uniq = S.SHOP.filter(x => S.isUnique(x) && x.cost >= 100);
  assert(uniq.length >= 5, '單品數太少，測不出來');
  // 把所有單品都設成已擁有，特價就只能挑消耗品／素材包
  uniq.forEach(x => { S.inventory()[x.id] = 1; });
  const deals = S.dealsToday('2026-07-28');
  deals.forEach(d => {
    const it = S.shopItem(d.id);
    assert(!(S.isUnique(it) && S.owned(it.id)), `已擁有的單品又上特價：${it.name}`);
  });
  p.inventory = {};
});

t('買特價商品時扣的是特價', () => {
  const p = S.profile;
  p.inventory = {}; p.coins = 0;
  const d = S.dealsToday()[0];
  p.coins = d.cost + 1000;                 // 特價品可能很貴（商店走香港機場路線），錢照今天的價開
  const before = S.coins();
  const r = S.buy(d.id);
  assert(r.ok === true, '買不到特價商品：' + r.msg);
  assert(before - S.coins() === d.cost, `扣款不是特價：扣了 ${before - S.coins()}，特價 ${d.cost}`);
  assert(d.cost < S.shopItem(d.id).cost, '特價價格不對');
});

console.log('\n--- 快速篩選（本來就會的字）---');
t('篩選佇列只給沒見過的字，低級與常見字優先', () => {
  const pool = S.sweepPool(12, [1, 2]);
  assert(pool.length === 12, '一批應該 12 個：' + pool.length);
  assert(pool.every(w => !S.isSeen(w.i)), '不該給已經見過的字');
  assert(pool.every(w => w.lv === 1 || w.lv === 2), '級別篩選失效');
  for (let k = 1; k < pool.length; k++) {
    if (pool[k].lv === pool[k - 1].lv) assert((pool[k].fq || 99999) >= (pool[k - 1].fq || 99999), '同級沒有常見字優先');
  }
});

t('自評已會 → box 2（3 天後仍會被複習抽到），不算今天的新字', () => {
  const w = S.sweepPool(1, [1])[0];
  const d = S.day();
  d.newIds = []; d.sweepKnown = []; d.sweepLearn = [];
  S.markKnown(w.i, 2);
  const r = S.load().words[w.i];
  assert(r.b === 2, 'box 應該是 2：' + r.b);
  assert(r.due === S.addDays(S.todayStr(), 3), `到期日應該是 3 天後，實際 ${r.due}`);
  assert(r.k === 1, '沒標記來源是自評');
  assert(S.isKnown(w.i) === true, '應該算已學會（進度才會動）');
  assert(S.summary().newCount === 0, '自評已會不該算成今天學的新字');
});

t('標成「要學」的字下次仍然要出學習卡', () => {
  const w = S.sweepPool(1, [2])[0];
  assert(S.needsCard(w.i) === true, '沒見過的字本來就要出卡');
  S.markToLearn(w.i);
  assert(S.isSeen(w.i) === true, '應該已經有紀錄');
  assert(S.needsCard(w.i) === true, '標成要學之後仍然要出學習卡');
  assert(S.load().words[w.i].due === S.todayStr(), '要學的字應該當天到期');
  S.markKnown(w.i, 2);
  assert(S.needsCard(w.i) === false, '改成已會之後就不用再出卡');
});

t('抽考沒過 → 整批「說會」的字降到 box 1，明天重考', () => {
  const batch = S.sweepPool(6, [3]);
  const know = batch.slice(0, 4).map(w => w.i);
  const learn = batch.slice(4).map(w => w.i);
  const d = S.day();
  d.sweepKnown = []; d.sweepLearn = [];
  const r = S.applySweep({ know, learn, failed: [know[0]] });
  assert(r.known === 3, '扣掉抽考錯的應該剩 3：' + r.known);
  assert(r.learn === 3, '答錯的要併進待學：' + r.learn);
  assert(r.downgraded === true, '沒標記為降級');
  assert(S.load().words[know[0]].b === 0, '抽考答錯的字應該歸零');
  assert(S.load().words[know[1]].b === 1, '同批其他字應該降到 box 1：' + S.load().words[know[1]].b);
  assert(S.load().words[know[1]].due === S.addDays(S.todayStr(), 1), '降級的字應該明天到期');
});

t('抽考通過 → box 2，並寫進當日篩選紀錄', () => {
  const batch = S.sweepPool(5, [3]);
  const know = batch.slice(0, 3).map(w => w.i);
  const learn = batch.slice(3).map(w => w.i);
  const d = S.day();
  d.sweepKnown = []; d.sweepLearn = [];
  const r = S.applySweep({ know, learn, failed: [] });
  assert(r.known === 3 && r.learn === 2, '數字不對：' + JSON.stringify(r));
  assert(know.every(i => S.load().words[i].b === 2), '通過的字應該都是 box 2');
  const sum = S.summary();
  assert(sum.sweepKnown === 3 && sum.sweepLearn === 2, '成績單沒統計篩選結果：' + JSON.stringify(sum));
  assert(sum.newCount === 0, '篩選不該算成今天學的新字');
});

t('篩選的抽考題不會混進「今天複習的單字」統計', () => {
  const d = S.day();
  d.log = [];
  S.logAnswer({ i: 10, t: 'sweep', ok: true, attempt: 1, ms: 3000 });
  S.logAnswer({ i: 11, t: 'sweep', ok: false, attempt: 1, ms: 4000 });
  S.logAnswer({ i: 12, t: 'e2c', ok: true, attempt: 1, ms: 3000 });
  const sum = S.summary();
  assert(sum.sweepTotal === 2 && sum.sweepRight === 1, '抽考統計不對：' + JSON.stringify(sum));
  assert(sum.reviewTotal === 1, '抽考被算進複習了：' + sum.reviewTotal);
  assert(!sum.byType.sweep, '抽考不該出現在題型統計');
});

t('sweepStat 算得出還剩多少字沒篩、已篩掉多少', () => {
  const st = S.sweepStat();
  assert(st.unseen + Object.keys(S.load().words).length === V.length, '未篩＋已見過應該等於全部字數');
  assert(st.claimed >= 1, '應該算得出自評已會的字數');
  assert(Object.keys(st.byLevel).length >= 1, '沒有分級統計');
});

t('複習不再抽已經練起來的字（box 5 以上），可以在設定打開', () => {
  const s = S.load();
  s.words = {};
  const ids = V.filter(w => w.lv === 3).slice(0, 6).map(w => w.i);
  const t2 = S.todayStr();
  // 三個還不穩、三個已經進長期記憶，全部都到期
  ids.slice(0, 3).forEach(i => { const r = S.rec(i); r.b = 2; r.due = t2; });
  ids.slice(3).forEach(i => { const r = S.rec(i); r.b = 5; r.due = t2; });
  S.settings.reviewMastered = false;
  const due = S.dueList().map(x => x.i);
  ids.slice(0, 3).forEach(i => assert(due.includes(i), '還不穩的字應該要複習'));
  ids.slice(3).forEach(i => assert(!due.includes(i), '已經練起來的字不該再被抽：' + V[i].w));
  S.settings.reviewMastered = true;
  const all = S.dueList().map(x => x.i);
  ids.slice(3).forEach(i => assert(all.includes(i), '打開設定後應該連長期記憶也複習'));
  S.settings.reviewMastered = false;
  s.words = {};
});

console.log('\n--- 還沒學過的字（句子註解）---');
t('句子裡沒學過的字挑得出來，變化形也認得', () => {
  const none = () => false;
  const got = Q.unknownIn('The government issued a warning about the storm.', { known: none });
  const ws = got.map(w => w.w);
  assert(ws.includes('issue'), '沒認出變化形 issued → issue：' + ws.join(','));
  assert(ws.includes('government') && ws.includes('storm'), '漏掉句子裡的字：' + ws.join(','));
  assert((Q.lookupForm('studies') || {}).w === 'study', 'studies → study 認不出來');
  assert((Q.lookupForm('running') || {}).w === 'run', 'running → run 認不出來');
  assert((Q.lookupForm('stopped') || {}).w === 'stop', 'stopped → stop 認不出來');
  assert(Q.lookupForm('zzzzq') === null, '不存在的字卻查得到');
});

t('功能詞與第 1 級的字不註解 —— 那不是看不懂句子的原因', () => {
  const none = () => false;
  const got = Q.unknownIn('She has stopped running because the weather is terrible.', { known: none });
  assert(got.length === 0, '把 the／she／because 這種字也註解出來了：' + got.map(w => w.w).join(','));
  assert(Q.unknownIn('The the the', { known: none }).length === 0, '冠詞被註解了');
  // 真的要看第 1 級也可以（minLv 是參數，不是寫死的）
  assert(Q.unknownIn('the weather', { known: none, minLv: 1 }).some(w => w.w === 'weather'), 'minLv 放寬之後還是抓不到');
});

t('學會的字不再註解，指定要避開的字也不會出現（不然等於送答案）', () => {
  const w = V.find(x => x.w === 'government');
  const sent = 'The government issued a warning about the storm.';
  assert(Q.unknownIn(sent, { known: () => false }).some(x => x.w === 'government'), '前提就不成立');
  assert(!Q.unknownIn(sent, { known: i => i === w.i }).some(x => x.w === 'government'), '學會了還在註解');
  // skip：克漏字的四個選項、中譯英要填的答案都必須避開
  assert(!Q.unknownIn(sent, { known: () => false, skip: ['issued'] }).some(x => x.w === 'issue'),
    '要避開的字被註解出來了 —— 這會直接把答案講掉');
  assert(!Q.unknownIn(sent, { known: () => false, skip: ['issue'] }).some(x => x.w === 'issue'), '用原形避開失效');
});

t('註解最多幾個，難的排前面', () => {
  const long = V.filter(x => x.lv >= 3).slice(0, 40).map(x => Q.base(x.w)).join(' ');
  const got = Q.unknownIn(long, { known: () => false });
  assert(got.length <= 6, '註解太多了：' + got.length);
  const got3 = Q.unknownIn(long, { known: () => false, max: 3 });
  assert(got3.length === 3, 'max 沒作用：' + got3.length);
  for (let k = 1; k < got.length; k++) assert(got[k].lv <= got[k - 1].lv, '沒有把難的排前面');
});

console.log('\n--- 我的單字本 ---');
t('加字要有英文和中文，例句會自動標出目標字（含變化形）', () => {
  S.customs().slice().forEach(c => S.customRemove(c.id));
  assert(S.customAdd({ w: '', tr: '沒有英文' }) === null, '沒有英文也加得進去');
  assert(S.customAdd({ w: 'onlyword' }) === null, '沒有中文也加得進去');
  const c = S.customAdd({ w: 'issue', tr: '議題；發布', p: 'n./v.', ex: 'The government issued a warning.', zh: '政府發布了警告。', gp: 'g3' });
  assert(c && c.id, '正常的字加不進去');
  assert(c.ex === 'The government {issued} a warning.', '例句沒有自動標出變化形：' + c.ex);
  assert(S.markEx('I {like} it.', 'like') === 'I {like} it.', '已經標好的例句被動到了');
  assert(S.markEx('Nothing here.', 'issue') === 'Nothing here.', '句子裡沒有那個字卻硬標了');
  assert(S.customs().length === 1, '單字本數量不對');
});

t('填了什麼就出得了什麼：例句給句子題，文法點給文法題', () => {
  const c = S.customs()[0];
  assert(S.customKinds(c).join(',') === S.CUSTOM_KINDS.join(','), '欄位填滿卻不是全部題型都出得來');
  const bare = S.customAdd({ w: 'happy', tr: '快樂的' });
  const k = S.customKinds(bare);
  assert(!k.includes('cloze') && !k.includes('trans') && !k.includes('order'), '沒例句卻出得了句子題');
  assert(!k.includes('gram'), '沒挑文法點卻出得了文法題');
  assert(k.includes('e2c') && k.includes('spell') && k.includes('free'), '只有英文＋中文時該有的題型少了');
  // 例句填了但句子裡沒有那個字 → 一樣不算數（挖不出空格）
  const bad = S.customAdd({ w: 'zebra', tr: '斑馬', ex: 'This sentence has no animal.' });
  assert(!S.customKinds(bad).includes('cloze'), '例句裡沒有那個字卻出得了克漏字');
  S.customRemove(bad.id);
});

t('單字本考卷：只出勾選的題型，每一題都掛得回是哪一個自訂字', () => {
  const words = S.customs().map(c => S.customWord(c));
  assert(words[0].i === null && words[0].cw === S.customs()[0].id, '自訂字的 i 應該是 null（它不在詞彙表裡）');
  const kinds = ['e2c', 'spell', 'cloze', 'free'];
  const qs = Q.bookSet(words, { kinds, n: 12 });
  assert(qs.length === 12, '題數不對：' + qs.length);
  qs.forEach(q => {
    assert(q.cw, '題目沒有掛上自訂字 id');
    assert(kinds.includes(q.bookKind), '出了沒勾的題型：' + q.bookKind);
    assert(q.i == null, '自訂字的題目不該帶詞彙表索引');
  });
  // 文法題出自那個字挑的文法點
  const g = Q.bookSet([words[0]], { kinds: ['gram'], n: 4 });
  assert(g.length === 4 && g.every(q => q.kind === 'gmc' || q.kind === 'gfix'), '文法題出不來');
  assert(g.every(q => q.gid === 'g3'), '文法題不是那個字挑的文法點');
  // 出不了的題型不會硬出一題空白的
  assert(Q.bookSet([S.customWord(S.customs()[1])], { kinds: ['cloze'] }, null).length === 0, '沒例句還是出了克漏字');
});

t('單字本有自己的間隔複習，完全不碰詞彙表的紀錄與統計', () => {
  const before = Object.keys(S.load().words).length;
  const knownBefore = S.stats().known;
  const c = S.customs()[0];
  S.customAnswer(c.id, true, 1);
  const r = S.customRec(c.id);
  assert(r.b === 1 && r.due === S.addDays(S.todayStr(), S.BOX_DAYS[1]), '排程不對：' + JSON.stringify(r));
  assert(Object.keys(S.load().words).length === before, '自訂字寫進了詞彙表的紀錄');
  assert(S.stats().known === knownBefore, '自訂字算進了「學會幾個字」');
  S.customAnswer(c.id, false, 1);
  assert(S.customRec(c.id).b === 0 && S.customRec(c.id).due === S.todayStr(), '答錯沒有掉回 box 0');
  // 到期清單：沒練過的算到期
  assert(S.customDue().some(x => x.id === c.id), '答錯的字不在今天到期清單裡');
  const st = S.customStat();
  assert(st.total === S.customs().length, '總數不對');
});

t('改字與刪字：紀錄跟著走，不留孤兒', () => {
  const c = S.customs()[0];
  S.customUpdate(c.id, { tr: '改過的意思', ex: 'They issue new rules.' });
  assert(S.customFind(c.id).tr === '改過的意思', '改不動');
  assert(/\{issue\}/.test(S.customFind(c.id).ex), '改例句之後沒有重新標記：' + S.customFind(c.id).ex);
  S.customAnswer(c.id, true, 1);
  assert(S.profile.customRec[c.id], '應該有紀錄');
  assert(S.customRemove(c.id) === true, '刪不掉');
  assert(!S.customFind(c.id), '刪完還找得到');
  assert(!S.profile.customRec[c.id], '紀錄變成孤兒了');
  S.customs().slice().forEach(x => S.customRemove(x.id));
});

t('練習題型至少要留一種，關不光', () => {
  const cfg = S.customCfg();
  assert(cfg.kinds.length, '預設沒有勾任何題型');
  cfg.kinds.slice(1).forEach(k => S.toggleCustomKind(k));
  assert(S.customCfg().kinds.length === 1, '沒有只剩一種：' + S.customCfg().kinds.join(','));
  const last = S.customCfg().kinds[0];
  S.toggleCustomKind(last);
  assert(S.customCfg().kinds.length === 1, '最後一種也被關掉了');
  S.setCustomCfg({ kinds: ['e2c', 'c2e', 'spell', 'cloze', 'trans', 'free'] });
});

console.log('\n--- 衝刺目標 ---');
t('預設目標用天數訂：一週／一個月，字數＝正常速度讀得完的量', () => {
  S.clearGoal();
  assert(S.GOAL_PRESETS.map(p => p.days).join(',') === '7,30', '預設應該是一週與一個月：' + JSON.stringify(S.GOAL_PRESETS));
  assert(S.GOAL_PACE >= 20 && S.GOAL_PACE <= 45, '一天的量不合理：' + S.GOAL_PACE);
  const known = S.goalScope('all').known;
  const p = S.goalPreset(7);
  assert(p.until === S.addDays(S.todayStr(), 7), '期限不是從今天算起 7 天：' + p.until);
  assert(p.target === known + 7 * S.GOAL_PACE, '一週的目標字數不對：' + p.target);
  const g = S.setGoalPreset(30);
  const st = S.goalStat();
  assert(st.on && st.until === S.addDays(S.todayStr(), 30), '一個月的期限沒套用：' + st.until);
  assert(st.perDay === S.GOAL_PACE, `每天要學的字應該剛好是 ${S.GOAL_PACE}：` + st.perDay);
  assert(st.impossible === false, '正常速度的目標不該被判成不現實');
  assert(g.target === st.target, 'goalPreset 回傳的目標和實際存進去的不一樣');
  // 範圍剩不到那麼多字時，以範圍為準（不會訂出比總字數還多的目標）
  const lv1 = S.goalPreset(365, 1);
  assert(lv1.target === S.goalScope(1).total, '目標超過範圍總字數：' + lv1.target);
  S.clearGoal();
});

t('目標會自己算「今天要學幾個字」＝剩下的字 ÷ 剩下的天數', () => {
  S.clearGoal();
  assert(S.goalStat().on === false, '一開始不該有目標');
  S.setGoal({ scope: 3, target: 1002, until: '2026-08-10' });
  const g = S.goalStat('2026-07-26');
  assert(g.on === true, '設定後應該啟用');
  assert(g.total === 1002, '第 3 級應該 1002 字：' + g.total);
  assert(g.daysLeft === 15, `7/26 到 8/10 前應該剩 15 天，實際 ${g.daysLeft}`);
  assert(g.perDay === Math.ceil(g.remain / 15), `每天字數算錯：${g.perDay} vs ${Math.ceil(g.remain / 15)}`);
  const later = S.goalStat('2026-08-05');
  assert(later.daysLeft === 5, '接近期限時剩下天數要變少：' + later.daysLeft);
  assert(later.perDay > g.perDay, '剩越少天，每天要學的字要變多');
});

t('學會的字會算進目標進度，範圍外的字不算', () => {
  S.clearGoal();
  S.setGoal({ scope: 4, target: 100, until: '2026-08-10' });
  const before = S.goalStat().known;
  const lv4 = V.find(w => w.lv === 4 && !S.isSeen(w.i));
  const lv5 = V.find(w => w.lv === 5 && !S.isSeen(w.i));
  S.answer(lv5.i, true, 1);
  assert(S.goalStat().known === before, '第 5 級的字不該算進第 4 級目標');
  S.answer(lv4.i, true, 1);
  assert(S.goalStat().known === before + 1, '第 4 級學會的字沒算進來');
});

t('目標達成與「這計畫不現實」都判得出來', () => {
  S.clearGoal();
  S.setGoal({ scope: 4, target: 1, until: '2026-08-10' });
  assert(S.goalStat().done === true, '已經超過目標字數卻沒判為達成');
  S.setGoal({ scope: 'all', target: 6012, until: '2026-07-28' });
  const g = S.goalStat('2026-07-26');
  assert(g.perDay > 120 && g.impossible === true, `每天 ${g.perDay} 字應該被標為不現實`);
});

t('有目標時，每日任務會多一個「今日配額」任務', () => {
  S.clearGoal();
  const before = S.questList('2026-07-26').length;
  S.setGoal({ scope: 3, target: 1002, until: '2026-08-10' });
  const list = S.questList('2026-07-26');
  const q = list.find(x => x.id === 'goalday');
  assert(list.length === before + 1, '任務數沒增加');
  assert(q && q.goal === S.goalStat('2026-07-26').perDay, '任務目標值應該等於今天的配額');
  assert(q.xp >= 100, '目標任務的獎勵要比一般任務高');
  S.clearGoal();
  assert(!S.questList('2026-07-26').some(x => x.id === 'goalday'), '取消目標後任務要消失');
});

console.log('\n--- 整體進度 ---');
t('progress() 給出畫進度條需要的所有數字', () => {
  const pg = S.progress();
  ['known', 'total', 'pct', 'mastered', 'cleared', 'stages', 'stagePct', 'level', 'inLevel', 'need', 'perLevel'].forEach(k =>
    assert(pg[k] != null, '缺少欄位：' + k));
  assert(pg.total === V.length, '總字數不對');
  assert(pg.stages === 6 * S.LETTERS.filter(L => S.bucket(1, L).length).length || pg.stages > 100, '關卡總數不合理：' + pg.stages);
  assert(pg.inLevel + (S.XP_PER_LEVEL - pg.inLevel) === S.XP_PER_LEVEL, '等級進度算錯');
});

console.log('\n--- 選項不能有第二個正確答案 ---');
/* 這裡抓的是「四個選項裡有兩個都對」的題目。使用者的體感是「答案根本沒出現」，
   因為他選了自己認為對的那個、卻被判錯。易混淆字最容易出這種包（absent／absence）。 */
t('易混淆題的選項，意思不可以跟正解撞在一起', () => {
  const clash = (a, b) => {
    a = String(a || '').trim(); b = String(b || '').trim();
    if (!a || !b) return false;
    if (a === b) return true;
    const segs = s => s.split(/[；;，,]/).map(x => x.trim()).filter(Boolean);
    const sb = segs(b);
    if (segs(a).some(x => sb.includes(x))) return true;
    return a.split(/[；;]/).some(s => s.trim().length >= 2 && b.includes(s.trim()));
  };
  let checked = 0, bad = [];
  for (const w of V) {
    const q = Q.forWord(w, null, 0);
    if (!q || q.kind !== 'confuse') continue;
    checked++;
    const right = V.find(x => x.w === q.opts[q.a]);
    q.opts.forEach((o, k) => {
      if (k === q.a) return;
      const other = V.find(x => x.w === o);
      if (right && other && clash(right.tr, other.tr) && bad.length < 3) bad.push(`${right.w}(${right.tr}) ↔ ${other.w}(${other.tr})`);
    });
  }
  assert(checked > 100, '抽到的易混淆題太少，測試沒有意義：' + checked);
  assert(bad.length === 0, `有 ${bad.length} 題出現兩個都對的選項：\n    ` + bad.join('\n    '));
});

t('所有選擇題的正解都一定在選項裡', () => {
  let n = 0;
  for (const w of V.filter((_, k) => k % 7 === 0)) {
    const q = Q.forWord(w, null, 0);
    if (!q || !q.opts) continue;
    n++;
    assert(q.a >= 0 && q.a < q.opts.length, `${w.w} 的正解索引是 ${q.a}`);
    assert(new Set(q.opts).size === q.opts.length, `${w.w} 有重複選項：${q.opts.join(' / ')}`);
  }
  assert(n > 300, '抽樣太少：' + n);
});

console.log('\n--- 誤觸修正 ---');
t('把最近一次答錯改成答對：紀錄、統計、排程三個地方一起改', () => {
  S.reset();
  const i = 42;
  S.answer(i, false, 1);
  S.logAnswer({ i, t: 'e2c', ok: false, attempt: 1, ms: 800, given: 'x', right: 'y' });
  const before = S.rec(i);
  assert(before.b === 0 && before.wr === 1 && before.fr === 0, '前置狀態不對');
  const out = S.fixMisclick(i);
  assert(out, '沒有修正到');
  const r = S.rec(i);
  assert(r.wr === 0, '答錯次數沒扣掉：' + r.wr);
  assert(r.r === 1, '答對次數沒加上：' + r.r);
  assert(r.fr === 1, '首次答對沒補上：' + r.fr);
  assert(r.b === 1, 'box 沒往上推：' + r.b);
  assert(r.due > S.todayStr(), '下次複習日還在今天，明天又會被抓出來：' + r.due);
  const log = S.answerLog({ only: 'wrong' }).rows.filter(x => x.i === i);
  assert(log.length === 0, '作答紀錄裡還留著那筆答錯 —— 正確率會繼續被拉低');
});

t('沒有答錯紀錄時不會憑空生出一筆答對', () => {
  S.reset();
  assert(S.fixMisclick(99) === null, '無中生有了');
  assert(!S.load().words[99], '產生了不該有的紀錄');
});

t('首次答對永遠不會超過首次作答（正確率不可能超過 100%）', () => {
  S.reset();
  const i = 7;
  S.answer(i, false, 2);                       // 第 2 次作答答錯：fs 不動
  S.logAnswer({ i, t: 'e2c', ok: false, attempt: 2, ms: 500, given: 'x', right: 'y' });
  S.fixMisclick(i);
  const r = S.rec(i);
  assert(r.fr <= r.fs, `首次答對 ${r.fr} > 首次作答 ${r.fs}`);
});

console.log('\n--- 跨裝置同步 ---');
t('同步碼：格式固定、每次都不一樣、不含看起來像的字', () => {
  const a = S.newSyncCode(), b = S.newSyncCode();
  assert(S.SYNC_RE.test(a), '格式不對：' + a);
  assert(a !== b, '每次產生的碼一樣');
  assert(!/[01ilo]/.test(a), '含有容易看錯的字元：' + a);
  assert(S.setSyncCode('  K7M2-X9PQ-4RJB ') === 'k7m2-x9pq-4rjb', '沒有去空白＋轉小寫');
  assert(S.SYNC_RE.test(S.syncCode()), '存起來的碼格式不對');
});

t('合併：雲端有、本機沒有的字會補進來', () => {
  S.reset();
  const before = Object.keys(S.load().words).length;
  const out = S.mergeRemote({ profile: {}, words: { 5: { b: 3, due: '2026-12-01', s: 4, r: 3, wr: 1 } }, days: {}, map: {} });
  assert(out, '合併沒有回傳結果');
  assert(Object.keys(S.load().words).length === before + 1, '字沒有補進來');
  assert(S.load().words[5].b === 3, 'box 不對');
  assert(out.words === 1, '回報的字數不對：' + out.words);
});

t('合併只會往前，不會把進度往回拉', () => {
  S.reset();
  S.load().words[7] = { b: 5, due: '2026-12-31', s: 10, r: 9, wr: 1, fr: 8, fs: 9 };
  S.profile.xp = 5000;
  S.profile.coins = 900;
  S.mergeRemote({
    profile: { xp: 100, coins: 10 },
    words: { 7: { b: 1, due: '2026-01-01', s: 2, r: 1, wr: 1, fr: 1, fs: 2 } },
    days: {}, map: {},
  });
  assert(S.load().words[7].b === 5, '熟練度被雲端的舊資料拉低了：' + S.load().words[7].b);
  assert(S.load().words[7].due === '2026-12-31', '複習日被改掉了');
  assert(S.profile.xp === 5000, 'XP 被拉低：' + S.profile.xp);
  assert(S.profile.coins === 900, '金幣被拉低：' + S.profile.coins);
  assert(S.load().words[7].s === 10, '作答次數被拉低');
});

t('合併：雲端比較新的時候會蓋過來', () => {
  S.reset();
  S.load().words[9] = { b: 1, due: '2026-01-01', s: 2, r: 1, wr: 1 };
  S.profile.xp = 100;
  const out = S.mergeRemote({
    profile: { xp: 8000, badges: ['start', 'w100'] },
    words: { 9: { b: 4, due: '2026-11-11', s: 9, r: 8, wr: 1 } },
    days: {}, map: {},
  });
  assert(S.load().words[9].b === 4, '沒有採用雲端比較高的 box');
  assert(S.profile.xp === 8000, 'XP 沒跟上：' + S.profile.xp);
  assert(S.profile.badges.length === 2, '成就沒有聯集：' + S.profile.badges.join(','));
  assert(out.badges === 2, '回報的成就數不對');
});

t('合併：關卡通關過就是通關過，星數取高的', () => {
  S.reset();
  S.load().map = { '1:A': { cleared: true, stars: 1, tries: 3, best: 0.9 } };
  S.mergeRemote({
    profile: {}, words: {}, days: {},
    map: { '1:A': { cleared: false, stars: 3, tries: 1, best: 1 }, '2:B': { cleared: true, stars: 2, tries: 1, best: .95 } },
  });
  const m = S.load().map;
  assert(m['1:A'].stars === 3, '星數沒取高的：' + m['1:A'].stars);
  assert(m['1:A'].cleared === true, '通關狀態被洗掉');
  assert(m['1:A'].tries === 3, '挑戰次數沒取多的');
  assert(m['2:B'] && m['2:B'].stars === 2, '雲端獨有的關卡沒補進來');
});

t('合併：同一天以題數多的那份為準，不把兩邊的作答接起來', () => {
  S.reset();
  const t0 = S.todayStr();
  S.load().days[t0] = { log: [{ i: 1, ok: true, attempt: 1 }], gram: [], free: [], runs: [], xp: 0, coin: 0 };
  S.mergeRemote({
    profile: {}, words: {}, map: {},
    days: { [t0]: { log: [{ i: 2, ok: true, attempt: 1 }, { i: 3, ok: false, attempt: 1 }, { i: 4, ok: true, attempt: 1 }], gram: [], free: [], runs: [], xp: 0, coin: 0 } },
  });
  assert(S.load().days[t0].log.length === 3, '沒有採用題數多的那份：' + S.load().days[t0].log.length);
});

t('合併：道具取多的那邊，不會每同步一次就多一份', () => {
  S.reset();
  S.profile.inventory = { heart: 2, fifty: 5 };
  const remote = { profile: { inventory: { heart: 7, hourglass: 1 } }, words: {}, days: {}, map: {} };
  S.mergeRemote(remote);
  S.mergeRemote(remote);                       // 同步兩次
  const inv = S.inventory();
  assert(inv.heart === 7, '護心符不是取大值：' + inv.heart);
  assert(inv.fifty === 5, '本機獨有的道具不見了');
  assert(inv.hourglass === 1, '同步兩次讓沙漏變多了：' + inv.hourglass);
});

t('合併不會動到這台裝置的設定', () => {
  S.reset();
  S.setDifficulty('extreme');
  S.settings.stageQuestions = 25;
  S.mergeRemote({
    profile: { settings: { difficulty: 'easy', stageQuestions: 5, cheats: { god: true } } },
    words: {}, days: {}, map: {},
  });
  assert(S.settings.difficulty === 'extreme', '難度被雲端改掉了：' + S.settings.difficulty);
  assert(S.settings.stageQuestions === 25, '題數被改掉了');
  assert(!S.cheat('god'), '雲端把作弊開關同步過來了');
});

t('合併：資料不像存檔就整包拒絕', () => {
  assert(S.mergeRemote(null) === null, 'null 沒被擋掉');
  assert(S.mergeRemote({}) === null, '空物件沒被擋掉');
  assert(S.mergeRemote({ hello: 'world' }) === null, '亂七八糟的資料沒被擋掉');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
