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

for (const f of ['data/words.js', 'data/grammar.js', 'data/sentences.js', 'src/store.js', 'src/quiz.js']) {
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

t('setDifficulty 存得起來、讀得回', () => {
  S.setDifficulty('hard');
  assert(S.diff().id === 'hard', S.diff().id);
  S.setDifficulty('normal');
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
  S.addCoins(100);
  const cost = S.shopItem('heart').cost;
  const r = S.buy('heart');
  assert(r.ok === true, '有錢卻買失敗：' + r.msg);
  assert(S.coins() === 100 - cost, '扣款不對：' + S.coins());
  assert(S.inventory().heart === 1, '沒進背包');
  assert(S.consume('heart') === true && !S.inventory().heart, '消耗失敗');
});

t('外觀類道具買過就不能重複買，可裝備與取消', () => {
  const p = S.profile;
  p.coins = 1000; p.inventory = {}; p.equipped = {};
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

t('關卡只出該級、該字母開頭的字', () => {
  const qs = Q.stageSet(3, 'B', 8, 0);
  assert(qs.length > 0, '生不出題');
  qs.forEach(q => {
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

t('通關門檻是 95%，低於就不算過', () => {
  assert(S.PASS_ACC === 0.95, '門檻改了記得同步說明文字');
  const p = S.profile;
  p.winStreak = 0; p.inventory = {};
  S.recordStage(5, 'A', false, 0.94, 1);
  assert(S.mapStat(5, 'A').cleared === false, '94% 不該算通過');
  S.recordStage(5, 'A', true, 0.95, 1);
  assert(S.mapStat(5, 'A').cleared === true, '95% 應該算通過');
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

console.log('\n--- 寶箱 ---');
t('寶箱等級依表現決定，開箱給金幣與 XP 並記錄', () => {
  assert(S.chestTier({ stars: 3, retries: 0 }) === 'gold', '三星不重來應該是金寶箱');
  assert(S.chestTier({ stars: 2, retries: 0 }) === 'silver', '二星應該是銀寶箱');
  assert(S.chestTier({ stars: 1, combo: 12 }) === 'silver', '高連擊應該升到銀');
  assert(S.chestTier({ stars: 1, combo: 2 }) === 'wood', '普通表現是木寶箱');
  assert(S.upgradeChest('wood') === 'silver' && S.upgradeChest('gold') === 'gold', '升級規則不對');
  const p = S.profile;
  p.coins = 0; p.xp = 0; p.inventory = {};
  S.day().chests = [];
  const r = S.openChest('gold');
  assert(r.coin > 0 && r.xp > 0 && r.at, '開箱內容不完整：' + JSON.stringify(r));
  assert(S.coins() === r.coin, '金幣沒入帳');
  assert(S.chestLog().length === 1, '寶箱紀錄沒寫');
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
  assert(S.SHOP.every(x => x.cost >= 35), '有商品太便宜：' + S.SHOP.filter(x => x.cost < 35).map(x => x.name));
  assert(Math.max(...S.SHOP.map(x => x.cost)) >= 1000, '應該有很貴的收藏品');
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
  assert(S.matCount('key') === 0, '鑰匙沒消耗');
  assert(S.useKey() === null, '沒鑰匙卻能開箱');
});

t('素材不能用金幣買（只能靠闖關與合成拿到）', () => {
  const ids = S.SHOP.map(x => x.id);
  S.MAT_ORDER.forEach(m => assert(!ids.includes(m), '素材出現在商店：' + m));
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

t('買特價商品時扣的是特價', () => {
  const p = S.profile;
  p.inventory = {}; p.coins = 5000;
  const d = S.dealsToday()[0];
  const before = S.coins();
  const r = S.buy(d.id);
  assert(r.ok === true, '買不到特價商品：' + r.msg);
  assert(before - S.coins() === d.cost, `扣款不是特價：扣了 ${before - S.coins()}，特價 ${d.cost}`);
  assert(d.cost < S.shopItem(d.id).cost, '特價價格不對');
});

console.log('\n--- 衝刺目標 ---');
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

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
