/* 狀態、間隔複習排程、XP／徽章、每日紀錄。全部存在 localStorage。 */
(function () {
  'use strict';

  const KEY = 'vocabQuest.v1';
  const BOX_DAYS = [0, 1, 3, 7, 14, 30, 60];   // Leitner：box 0 當天重練，之後 1/3/7/14/30/60 天
  const MAX_BOX = BOX_DAYS.length - 1;

  const SCHEMA = 2;                 // 改動設定結構時 +1，舊存檔會走 migrate()
  /* stageQuestions：一關幾題。applyPerStage / gramPerStage：一關保留給「句子運用」與「文法」的名額。
     sentRate：有例句的字出句子題的比重（60 = 預設；調高就更常考句子而不是四選一）。 */
  const COUNT_DEFAULTS = {
    newPerDay: 6, reviewCap: 12, applyPerDay: 3, stageQuestions: 10,
    applyPerStage: 2, gramPerStage: 1, sentRate: 60,
  };
  /* 鍵盤快速鍵：主要動線都能不用滑鼠。
     值是 KeyboardEvent.key（空白鍵是 ' '），單一字母一律存大寫。 */
  const KEY_ACTS = [
    { id: 'next', name: '下一題 / 繼續', def: ' ' },
    { id: 'submit', name: '送出答案', def: 'Enter' },
    { id: 'card', name: '學習卡：記住了，下一個 / 開始闖關', def: ' ' },
    { id: 'prev', name: '學習卡：上一個', def: 'Backspace' },
    { id: 'know', name: '學習卡：這個我早就會了', def: 'Delete' },
    { id: 'speak', name: '重播發音', def: 'Shift' },
    { id: 'fifty', name: '使用刪去法', def: 'F' },
    { id: 'pause', name: '暫停 / 關閉視窗', def: 'Escape' },
    { id: 'primary', name: '結算畫面的主要按鈕（開寶箱／下一關…）', def: 'Enter' },
  ];
  const KEY_DEFAULTS = KEY_ACTS.reduce((o, a) => { o[a.id] = a.def; return o; }, {});
  function keys() {
    const c = load().profile.settings;
    c.keys = Object.assign({}, KEY_DEFAULTS, c.keys || {});
    return c.keys;
  }
  function keyOf(id) { return keys()[id] || KEY_DEFAULTS[id] || ''; }
  function setKey(id, k) {
    if (!KEY_DEFAULTS[id] || !k) return keys();
    const kk = String(k).length === 1 ? String(k).toUpperCase() : String(k);
    keys()[id] = kk;
    save(true);
    return keys();
  }
  function resetKeys() {
    load().profile.settings.keys = Object.assign({}, KEY_DEFAULTS);
    save(true);
    return keys();
  }

  /** 使用者可以關掉不想練的題型（至少要留一種）。 */
  const ALL_KINDS = ['e2c', 'c2e', 'listen', 'spell', 'form', 'confuse', 'cloze', 'order', 'trans', 'free', 'gmc', 'gfix'];
  const KIND_NAMES = {
    e2c: '英→中 四選一', c2e: '中→英 四選一', listen: '聽發音', spell: '看中文拼字',
    form: '詞形變化', confuse: '易混淆字', cloze: '例句克漏字', order: '句子重組',
    trans: '中譯英填空', free: '自由造句', gmc: '文法選擇', gfix: '找錯改錯',
  };

  const DEFAULTS = {
    v: SCHEMA,
    profile: {
      placed: false,
      mastery: {},            // {1..6: 0~1}
      levelMode: {},          // {1..6: 'learn'|'mixed'|'verify'}
      xp: 0,
      streak: 0, bestStreak: 0,
      lastStudy: null,
      badges: [],
      settings: Object.assign({}, COUNT_DEFAULTS, {
        difficulty: 'normal', timer: true, instantFeedback: false, sfx: true, tts: true, speechRate: 75,
        memes: true, keyBar: true, reviewMastered: false, sweepCheck: false, sweepBatch: 24, offKinds: [],
        secretDiff: false,                                        // 究極難度解鎖了沒
        cheats: { god: false, noTimer: false, xray: false },      // 作弊開關（管理員面板／密技切換）
      }),
    },
    words: {},
    days: {},
  };

  /* 關卡難度。和「題數」是兩個獨立旋鈕：難度管血量／時間／題型難易／XP 倍率，
     題數（newPerDay / reviewCap / applyPerDay）管一次要做多少。
     tierShift 會把出題偏向推向更難的題型（+1 → 更常考拼字與詞形變化而不是四選一）。 */
  const DIFFICULTY = {
    easy:    { id: 'easy',    name: '輕鬆', hearts: 8, time: 1.6,  tierShift: -1, xp: 0.8, desc: '血多、時間寬、以認得出來為主' },
    normal:  { id: 'normal',  name: '標準', hearts: 5, time: 1.0,  tierShift: 0,  xp: 1.0, desc: '預設節奏' },
    hard:    { id: 'hard',    name: '挑戰', hearts: 3, time: 0.75, tierShift: 1,  xp: 1.3, desc: '時間縮短、多考拼得出來' },
    extreme: { id: 'extreme', name: '地獄', hearts: 1, time: 0.55, tierShift: 1,  xp: 1.6, desc: '一顆心、時間很緊、XP 加成最高' },
    /* 隱藏難度（要解鎖才看得到）。tierShift 2 的意思是「連剛學的新字都直接考最難的題型」——
       地獄只是把時間壓短，究極是連題型都不再放水。 */
    ultra:   { id: 'ultra',   name: '究極', hearts: 1, time: 0.45, tierShift: 2,  xp: 2.5, secret: true, desc: '隱藏難度：一顆心、時間再砍一半、新字也直接考拼字與詞形變化' },
  };
  const DIFF_ORDER = ['easy', 'normal', 'hard', 'extreme'];
  const SECRET_DIFFS = ['ultra'];
  /** 難度選單：隱藏難度解鎖之後才會排在最後面。 */
  function diffList() { return secretDiff() ? DIFF_ORDER.concat(SECRET_DIFFS) : DIFF_ORDER.slice(); }
  /** 究極模式開著＝強制究極，其他難度按不動（要換就先關掉究極）。 */
  function diffForced() { return secretDiff(); }
  /** 難度的「硬度排名」：隱藏難度一律排在公開的四檔之上。 */
  function diffRank(id) {
    const k = DIFF_ORDER.indexOf(id);
    return k >= 0 ? k : (DIFFICULTY[id] ? DIFF_ORDER.length : 0);
  }
  function secretDiff() { return !!load().profile.settings.secretDiff; }
  /* 究極不是「多一個選項」，是一個模式：打開就強制究極，別的難度全部按不動。
     所以打開時要記住原本玩的是哪一檔（diffBefore），關掉才回得去 ——
     否則會變成「玩過一次究極，就再也回不到自己原本的節奏」。 */
  function setSecretDiff(on) {
    const c = load().profile.settings, was = !!c.secretDiff;
    c.secretDiff = !!on;
    if (c.secretDiff && !was) {
      c.diffBefore = c.difficulty;
      c.difficulty = 'ultra';
    } else if (!c.secretDiff && was) {
      const back = c.diffBefore;
      c.difficulty = (DIFFICULTY[back] && !DIFFICULTY[back].secret) ? back : 'normal';
      delete c.diffBefore;
    }
    save(true);
    return c.secretDiff;
  }

  /* 作弊開關。純好玩用的，所以只影響「這一關會不會死／有沒有倒數／看不看得到答案」。

     刻意**不做**的三件事：不扣 XP、不留紀錄、不在畫面上標示。
     理由是使用者自己講的 —— 作弊沒背起來的字照樣會到期、照樣被抓回來考，
     間隔複習本來就會把帳算清楚，再記一筆只是多餘。改了就是改了。
     （唯一沒變的是排程：答錯還是算錯，一樣進複習。那不是懲罰，那是這個系統的本體。） */
  const CHEAT_KEYS = ['god', 'noTimer', 'xray'];
  const CHEAT_NAMES = { god: '無敵（不會扣血）', noTimer: '時間暫停（沒有倒數）', xray: '透視（直接顯示答案）' };
  function cheats() {
    const c = load().profile.settings;
    c.cheats = Object.assign({ god: false, noTimer: false, xray: false }, c.cheats);
    return c.cheats;
  }
  function cheat(k) { return !!cheats()[k]; }
  function setCheat(k, on) {
    if (!CHEAT_KEYS.includes(k)) return cheats();
    cheats()[k] = !!on;
    save(true);
    return cheats();
  }
  function cheating() { return CHEAT_KEYS.some(k => cheats()[k]); }
  function offKinds() { const o = load().profile.settings.offKinds; return Array.isArray(o) ? o : []; }
  function kindOn(k) { return !offKinds().includes(k); }
  /** 切換題型開關；不允許把題型全部關光。 */
  function toggleKind(k) {
    const c = load().profile.settings;
    const off = new Set(offKinds());
    if (off.has(k)) off.delete(k);
    else {
      if (ALL_KINDS.filter(x => !off.has(x)).length <= 1) return false;
      off.add(k);
    }
    c.offKinds = [...off];
    save(true);
    return true;
  }

  function diff() { return DIFFICULTY[load().profile.settings.difficulty] || DIFFICULTY.normal; }
  function setDifficulty(id) {
    if (!DIFFICULTY[id]) return diff();
    if (diffForced() && id !== 'ultra') return diff();      // 究極模式強制中：換不了難度
    load().profile.settings.difficulty = id;
    save(true);
    return diff();
  }

  // ---------- date helpers (local time, not UTC — the school day is local) ----------
  function todayStr(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return todayStr(dt);
  }
  function daysBetween(a, b) {
    const p = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
    return Math.round((p(b) - p(a)) / 86400000);
  }

  // ---------- load / save ----------
  let S = null;
  function deepMerge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k in over) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object' && base[k])
        out[k] = deepMerge(base[k], over[k]);
      else out[k] = over[k];
    }
    return out;
  }
  /** 舊存檔升級。注意：deepMerge 讓存檔值蓋過預設值，所以光改 DEFAULTS
      對已經有存檔的人完全沒作用 —— 題數這種「使用者說太多了」的調整必須在這裡強制套用。 */
  function migrate(s) {
    const from = s.v || 1;
    if (from < 2) {
      const c = s.profile.settings;
      Object.assign(c, COUNT_DEFAULTS);          // 題數重設為新的（較少的）預設
      delete c.hearts;                           // 改由難度提供
      delete c.timerSec;                         // 改為分題型時限
      delete c.timeFactor;
      if (!c.difficulty) c.difficulty = 'normal';
      if (c.instantFeedback == null) c.instantFeedback = false;
    }
    s.v = SCHEMA;
    return s;
  }

  function load() {
    if (S) return S;
    try {
      const raw = localStorage.getItem(KEY);
      S = raw ? migrate(deepMerge(DEFAULTS, JSON.parse(raw))) : JSON.parse(JSON.stringify(DEFAULTS));
    } catch (e) {
      console.warn('存檔讀取失敗，改用新存檔', e);
      S = JSON.parse(JSON.stringify(DEFAULTS));
    }
    return S;
  }
  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const doIt = () => {
      try { localStorage.setItem(KEY, JSON.stringify(S)); }
      catch (e) { console.error('存檔寫入失敗（空間可能已滿）', e); }
    };
    now ? doIt() : (saveTimer = setTimeout(doIt, 400));
  }

  // ---------- per-word record ----------
  function rec(i) {
    const s = load();
    if (!s.words[i]) s.words[i] = { b: 0, due: null, s: 0, r: 0, wr: 0, fr: 0, fs: 0 };
    return s.words[i];
  }
  function isKnown(i) { const r = load().words[i]; return !!r && r.b >= 1; }
  function isSeen(i) { return !!load().words[i]; }

  /** 記錄一次作答並更新排程。attempt=1 才計入「首次作答正確率」（重來的不計）。 */
  function answer(i, ok, attempt) {
    const r = rec(i), t = todayStr();
    r.s++;
    if (ok) r.r++; else r.wr++;
    if (attempt === 1) { r.fs++; if (ok) r.fr++; }
    if (ok) {
      r.b = Math.min(MAX_BOX, r.b + 1);
      r.due = addDays(t, BOX_DAYS[r.b] || 1);
      r.lw = 0;                                  // 上一次是對的
      if (r.streakOk == null) r.streakOk = 0;
      r.streakOk++;
    } else {
      r.b = 0;                 // 答錯 → 掉回 box 0：當天重練，隔天必考
      r.due = t;
      r.lw = 1;                                  // 上一次答錯 → 之後出題機率會被拉高
      r.streakOk = 0;
      r.lwd = t;                                 // 最後一次答錯的日期
    }
    r.last = t;
    save();
    return r;
  }

  /* 出題權重：錯過的字要更常出現。
     1（基準）＋ 每次錯 ×0.8（上限 4）＋ 上一次答錯再 ×2 ＋ 三天內錯過再 +1。
     連續答對會慢慢把權重壓回來（每連對一次扣 0.4），所以練起來之後不會一直卡在同一批字。 */
  function errWeight(i) {
    const r = load().words[i];
    if (!r) return 1;
    let w = 1 + Math.min(4, (r.wr || 0) * 0.8);
    if (r.lw) w *= 2;
    if (r.lwd && daysBetween(r.lwd, todayStr()) <= 3) w += 1;
    w -= Math.min(2, (r.streakOk || 0) * 0.4);
    return Math.max(0.5, w);
  }
  /** 錯題本：錯過而且還沒練熟的字（錯得越多、box 越低的排前面）。 */
  function wrongPool(cap) {
    const s = load(), out = [];
    for (const k in s.words) {
      const r = s.words[k];
      if (!r.wr) continue;
      if (r.b >= 4) continue;                    // 已經練起來的就不算錯題了
      out.push({ i: +k, wr: r.wr, b: r.b, lw: !!r.lw, weight: errWeight(+k) });
    }
    out.sort((a, b) => (b.weight - a.weight) || (a.b - b.b) || (b.wr - a.wr));
    return cap ? out.slice(0, cap) : out;
  }
  /** 難字（魔王字）：錯 3 次以上還沒練起來，家長回報與錯題關會特別點出來。 */
  function leeches(cap) {
    return wrongPool().filter(x => x.wr >= 3).slice(0, cap || 50);
  }

  // ---------- 快速篩選：本來就會的字不用當新字學 ----------
  /* 詞彙表裡有大量小學就會的字（L1–L2 尤其多）。全部當「新字」從學習卡學一遍是浪費時間，
     所以提供「自評 + 抽查」：自己勾掉不會的，剩下的算已會但**只放到 box 2**（3 天後就會被複習抽考），
     而且同一批會隨機抽兩個真的考 —— 抽考沒過，整批降級重新排隊。這樣才不會靠嘴巴說會就跳過。 */
  function markKnown(i, box) {
    const r = rec(i), t = todayStr();
    r.b = Math.max(r.b, box == null ? 2 : box);
    r.due = addDays(t, BOX_DAYS[r.b] || 3);
    r.k = 1;                       // 來源：自評已會（不是作答學會的）
    delete r.nc;
    r.last = t;
    save();
    return r;
  }
  /** 標成「要學」：留紀錄但下次遇到仍然要出學習卡（nc = need card）。 */
  function markToLearn(i) {
    const r = rec(i), t = todayStr();
    r.b = 0; r.due = t; r.nc = 1;
    save();
    return r;
  }
  function needsCard(i) {
    const r = load().words[i];
    return !r || !!r.nc;
  }
  /** 篩選佇列：還沒見過的字，低級優先、常見字優先。 */
  function sweepPool(n, lvs) {
    const s = load(), out = [];
    for (const w of window.VOCAB) {
      if (s.words[w.i]) continue;
      if (lvs && lvs.length && !lvs.includes(w.lv)) continue;
      out.push(w);
    }
    out.sort((a, b) => (a.lv - b.lv) || ((a.fq || 99999) - (b.fq || 99999)));
    return out.slice(0, n || 12);
  }
  /** 各級還有多少字沒篩過（首頁提示與篩選畫面用）。 */
  function sweepStat() {
    const s = load(), by = {};
    let unseen = 0, known = 0, claimed = 0;
    for (const w of window.VOCAB) {
      const r = s.words[w.i];
      if (!r) { unseen++; by[w.lv] = (by[w.lv] || 0) + 1; }
      else { if (r.b >= 1) known++; if (r.k) claimed++; }
    }
    return { unseen, known, claimed, byLevel: by };
  }
  /** 收下一批篩選結果。抽考沒過 → 這批「說會」的字降到 box 1，明天就會被考。 */
  function applySweep(o) {
    const know = (o && o.know) || [], learn = (o && o.learn) || [];
    const failed = (o && o.failed) || [], checkOk = !failed.length;
    const d = day();
    d.sweepKnown = d.sweepKnown || [];
    d.sweepLearn = d.sweepLearn || [];
    learn.forEach(i => { markToLearn(i); if (!d.sweepLearn.includes(i)) d.sweepLearn.push(i); });
    know.forEach(i => {
      if (failed.includes(i)) { markToLearn(i); if (!d.sweepLearn.includes(i)) d.sweepLearn.push(i); return; }
      markKnown(i, checkOk ? 2 : 1);
      if (!d.sweepKnown.includes(i)) d.sweepKnown.push(i);
    });
    save(true);
    return { known: know.length - failed.length, learn: learn.length + failed.length, downgraded: !checkOk };
  }

  /** 定位測驗結果：算出各級掌握率與學習模式。 */
  function applyPlacement(results) {
    const s = load(), byLv = {};
    results.forEach(x => {
      (byLv[x.lv] = byLv[x.lv] || []).push(x);
      const r = rec(x.i);
      r.s++; r.fs++;
      if (x.ok) { r.fr++; r.r++; r.b = 3; r.due = addDays(todayStr(), BOX_DAYS[3]); }
      else { r.wr++; r.b = 0; r.due = todayStr(); }
    });
    for (let lv = 1; lv <= 6; lv++) {
      const a = byLv[lv] || [];
      const pct = a.length ? a.filter(x => x.ok).length / a.length : 0;
      s.profile.mastery[lv] = pct;
      s.profile.levelMode[lv] = pct >= 0.9 ? 'verify' : pct >= 0.6 ? 'mixed' : 'learn';
    }
    s.profile.placed = true;
    save(true);
    return s.profile;
  }

  /** 主力起始級數：最低一個還沒到 90% 的級別。 */
  function startLevel() {
    const s = load();
    for (let lv = 1; lv <= 6; lv++) if (s.profile.levelMode[lv] !== 'verify') return lv;
    return 6;
  }

  // ---------- queues ----------
  /* 複習清單。預設**不抽已經練起來的字**（box 5 以上＝長期記憶，間隔已經拉到 30／60 天）——
     複習時間應該花在還不穩的字上。
     代價要說清楚：完全不再抽查，久了真的忘掉也不會被發現，所以設定頁留了開關
     （reviewMastered），想連長期記憶一起複習可以打開。 */
  const MASTER_BOX = 5;
  function dueList(cap, opts) {
    const s = load(), t = todayStr(), out = [];
    const withMastered = (opts && opts.all) || !!load().profile.settings.reviewMastered;
    for (const k in s.words) {
      const r = s.words[k];
      if (!withMastered && r.b >= MASTER_BOX) continue;      // 已會的字不進複習
      if (r.due && r.due <= t) out.push({ i: +k, over: daysBetween(r.due, t), b: r.b, weight: errWeight(+k) });
    }
    // 錯題優先：先看錯的權重，再看逾期天數與 box
    out.sort((a, b) => (b.weight - a.weight) || (b.over - a.over) || (a.b - b.b));
    return cap ? out.slice(0, cap) : out;
  }

  /** 今天要學的新字。範圍 = 尚未見過 + 級別模式不是 verify，低級優先、常見字優先。 */
  function newList(n, rangeFilter) {
    const s = load(), V = window.VOCAB, pool = [];
    for (const w of V) {
      if (s.words[w.i]) continue;
      if (s.profile.levelMode[w.lv] === 'verify') continue;
      if (rangeFilter && !rangeFilter(w)) continue;
      pool.push(w);
    }
    pool.sort((a, b) => (a.lv - b.lv) || ((a.fq || 99999) - (b.fq || 99999)));
    return pool.slice(0, n).map(w => w.i);
  }

  /** 已判定「已會」級別的抽查字：驗證有沒有漏網。 */
  function verifySample(n) {
    const s = load(), V = window.VOCAB, pool = [];
    for (const w of V) {
      if (s.words[w.i]) continue;
      if (s.profile.levelMode[w.lv] === 'verify') pool.push(w.i);
    }
    const out = [];
    for (let k = 0; k < n && pool.length; k++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  }

  // ---------- daily record ----------
  function day(dstr) {
    const s = load(), t = dstr || todayStr();
    if (!s.days[t]) s.days[t] = { newIds: [], log: [], gram: [], free: [], stages: {}, xp: 0 };
    const d = s.days[t];
    if (!d.runs) d.runs = [];            // 每一關的開始／結束時間
    if (!d.questLog) d.questLog = [];    // 任務完成紀錄（時間＋內容）
    if (d.coin == null) d.coin = 0;
    return d;
  }
  /** 每筆紀錄都蓋上時間戳：作答紀錄要能按時間排序，也要看得出來是幾點做的。 */
  function stamp(e) { if (!e.at) e.at = new Date().toISOString(); return e; }
  function logAnswer(entry) { day().log.push(stamp(entry)); save(); }
  function logGrammar(entry) { day().gram.push(stamp(entry)); save(); }
  function logFree(entry) { day().free.push(stamp(entry)); save(); }
  function markNew(ids) {
    const d = day();
    ids.forEach(i => { if (!d.newIds.includes(i)) d.newIds.push(i); });
    save();
  }
  function finishStage(no, stars, retries) {
    day().stages[no] = { done: true, stars: stars, retries: retries || 0 };
    save(true);
  }

  // ---------- 每關的開始時間與使用時間 ----------
  /* 一關就是一段學習時段：開始時建一筆，結束（通關／失敗／放棄）時補上結果。
     id 用「日期#序號」而不是隨機數，重整頁面也不會撞號。 */
  function startRun(info) {
    const t = todayStr(), d = day(t);
    const r = Object.assign({
      id: t + '#' + (d.runs.length + 1),
      start: new Date().toISOString(),
      startMs: Date.now(),
      hour: new Date().getHours(),       // 本地時間的小時，早鳥任務要用
      end: null, sec: 0,
      title: '', lv: null, letter: null, kindOfRun: 'stage',
      diff: load().profile.settings.difficulty,
      planned: 0, answered: 0, right: 0, wrong: 0, acc: 0,
      passed: null, stars: 0, combo: 0, xp: 0, coin: 0, retries: 0, abandoned: false,
    }, info || {});
    d.runs.push(r);
    save();
    return r.id;
  }
  function findRun(id) {
    const s = load();
    for (const dstr in s.days) {
      const hit = (s.days[dstr].runs || []).find(r => r.id === id);
      if (hit) return hit;
    }
    return null;
  }
  /** 收尾一筆關卡紀錄。sec 用開始時間算，暫停也照算（那是真的坐在螢幕前的時間）。 */
  function endRun(id, patch) {
    const r = findRun(id);
    if (!r) return null;
    Object.assign(r, patch || {});
    r.end = new Date().toISOString();
    r.sec = Math.max(0, Math.round((Date.now() - (r.startMs || Date.now())) / 1000));
    save(true);
    return r;
  }
  /** 某天（預設今天）的關卡紀錄，最新在前。 */
  function runLog(dstr) { return (day(dstr).runs || []).slice().reverse(); }
  /** 今天實際坐在關卡裡的秒數總和。 */
  function runSeconds(dstr) { return (day(dstr).runs || []).reduce((a, r) => a + (r.sec || 0), 0); }

  // ---------- 作答紀錄（跨日、可篩選） ----------
  /** 把單字題、文法題、自由造句攤平成一份時間軸紀錄，最新在前。 */
  function answerLog(opt) {
    const o = opt || {}, s = load(), out = [];
    const days = Object.keys(s.days).sort().reverse();
    for (const dstr of days) {
      if (o.date && dstr !== o.date) continue;
      const d = s.days[dstr];
      const rows = [];
      (d.log || []).forEach((x, n) => rows.push(Object.assign({ cat: 'word', seq: n }, x)));
      (d.gram || []).forEach((x, n) => rows.push(Object.assign({ cat: 'gram', ok: x.ok, seq: n }, x)));
      (d.free || []).forEach((x, n) => rows.push(Object.assign({ cat: 'free', ok: null, seq: n }, x)));
      rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || (b.seq - a.seq));
      rows.forEach(r => { r.date = dstr; out.push(r); });
      if (o.limit && out.length >= o.limit + (o.skip || 0)) break;
    }
    let list = out;
    if (o.only === 'wrong') list = list.filter(x => x.ok === false);
    else if (o.only === 'right') list = list.filter(x => x.ok === true);
    else if (o.only === 'free') list = list.filter(x => x.cat === 'free');
    else if (o.only === 'gram') list = list.filter(x => x.cat === 'gram');
    else if (o.only === 'timeout') list = list.filter(x => x.timeout);
    const total = list.length;
    if (o.skip || o.limit) list = list.slice(o.skip || 0, (o.skip || 0) + (o.limit || total));
    return { rows: list, total };
  }
  /** 作答紀錄的總計（採計第 1 次作答）。 */
  function logTotals() {
    const s = load();
    let n = 0, ok = 0, first = 0, firstOk = 0, sec = 0, days = 0;
    for (const dstr in s.days) {
      const L = s.days[dstr].log || [];
      if (L.length) days++;
      L.forEach(x => {
        n++; if (x.ok) ok++;
        if (x.attempt === 1) { first++; if (x.ok) firstOk++; }
        sec += (x.ms || 0) / 1000;
      });
    }
    return { n, ok, first, firstOk, acc: first ? firstOk / first : 0, minutes: Math.round(sec / 60), days };
  }

  // ---------- xp / level / streak / badges ----------
  const XP_PER_LEVEL = 400;
  function xpLevel(xp) { return Math.floor(xp / XP_PER_LEVEL) + 1; }
  function xpInLevel(xp) { return xp % XP_PER_LEVEL; }
  function addXp(n) {
    const s = load(), before = xpLevel(s.profile.xp);
    s.profile.xp += n;
    day().xp += n;
    save();
    return { total: s.profile.xp, levelUp: xpLevel(s.profile.xp) > before, level: xpLevel(s.profile.xp) };
  }
  /* 升等獎勵：整張表是用等級「算」出來的，不是手寫清單，所以到 Lv.999 都有獎可發。
     結構是四層，高層蓋低層：
       每 1 等  → 金幣 + 一個消耗品（照 GIFT_CYCLE 輪，八等一輪）
       每 10 等 → 大獎：金寶箱 + 鑰匙 + 星塵 + 加碼金幣
       每 50 等 → 更大：彩虹寶箱 + 金鑽石 + 鑰匙
       每 100 等 → 里程碑：彩虹寶箱 ×3 + 大把金幣素材 + 升等限定稱號（商店買不到）
     rewardedLevel 記住已經發到第幾等，所以同一等不會重複領。 */
  const GIFT_CYCLE = ['fifty', 'heart', 'hourglass', 'xp2', 'bigheart', 'hourglass2', 'shield', 'revive'];
  const LEVEL_UNLOCK = {
    5: 'theme_forest', 8: 'title_scholar', 12: 'theme_sunset', 16: 'title_hunter',
    20: 'theme_ocean', 30: 'theme_sakura', 40: 'theme_night', 60: 'theme_aurora',
    25: 'title_lv25', 50: 'title_lv50', 75: 'title_lv75',
  };
  /* 百級稱號用中文數字現場組出來（一百級、兩百級……），所以幾百等都有新稱號。 */
  const CN_NUM = ['', '一', '兩', '三', '四', '五', '六', '七', '八', '九'];
  function hundredTitle(lv) {
    const h = lv / 100;
    const name = h <= 9 ? CN_NUM[h] + '百級' : lv + ' 級';
    const flavor = ['傳說', '神話', '不朽', '永恆', '超凡', '無雙', '至尊', '天啟', '創世'][Math.min(h - 1, 8)];
    return { id: 'title_lv' + lv, name: `稱號：${name}${flavor}`, kind: 'title', rarity: h >= 2 ? 'ultra' : 'legend', cost: 0, levelOnly: lv, desc: `升到 Lv.${lv} 才拿得到，有錢也買不到` };
  }
  function levelReward(lv) {
    const r = {
      level: lv,
      coin: 25 + lv * 5,
      item: GIFT_CYCLE[(lv - 1) % GIFT_CYCLE.length],
      unlock: LEVEL_UNLOCK[lv] || null,
      chest: null, chestN: 0, mats: null, big: null,
    };
    if (lv % 100 === 0) {
      r.big = { name: `Lv.${lv} 里程碑`, tier: 'hundred' };
      r.chest = 'rainbow'; r.chestN = 3;
      r.coin += 2000 + lv * 10;
      r.mats = { gem_gold: 5, key: 2, stardust: 10 };
      r.unlock = hundredTitle(lv).id;
    } else if (lv % 50 === 0) {
      r.big = { name: `Lv.${lv} 半百大獎`, tier: 'fifty' };
      r.chest = 'rainbow'; r.chestN = 1;
      r.coin += 500 + lv * 6;
      r.mats = { gem_gold: 3, key: 1, stardust: 5 };
    } else if (lv % 10 === 0) {
      r.big = { name: `Lv.${lv} 十級大獎`, tier: 'ten' };
      r.chest = 'gold'; r.chestN = 1;
      r.coin += 150 + lv * 5;
      r.mats = { stardust: 3, key: 1 };
    }
    return r;
  }
  /** 發放還沒領的升等獎勵，回傳這次領到的清單（沒升等就是空陣列）。 */
  function claimLevelUps() {
    const p = load().profile, cur = xpLevel(p.xp);
    const from = p.rewardedLevel || 1;
    if (cur <= from) { p.rewardedLevel = from; return []; }
    const got = [], inv = inventory();
    for (let lv = from + 1; lv <= cur; lv++) {
      const r = levelReward(lv);
      addCoins(r.coin);
      if (r.item) inv[r.item] = (inv[r.item] || 0) + 1;
      if (r.unlock && !inv[r.unlock]) inv[r.unlock] = 1;
      if (r.mats) grantMats(Object.keys(r.mats).map(k => ({ id: k, n: r.mats[k] })), `升等 Lv.${lv}`);
      for (let i = 0; i < r.chestN; i++) addChest(r.chest, `升等 Lv.${lv}`);
      got.push(r);
    }
    p.rewardedLevel = cur;
    save(true);
    return got;
  }

  /** 首頁進度條要的所有數字集中在這裡算，避免各處各算一套。 */
  function progress() {
    const s = load(), V = window.VOCAB, p = s.profile;
    let known = 0, mastered = 0, learning = 0;
    for (const k in s.words) {
      const b = s.words[k].b;
      if (b >= 5) mastered++;
      if (b >= 1) known++; else learning++;
    }
    let cleared = 0, playable = 0, stars = 0, maxStars = 0;
    for (let lv = 1; lv <= 6; lv++) {
      const ls = levelStat(lv);
      cleared += ls.cleared; playable += ls.playable;
    }
    for (const key in (s.map || {})) {
      stars += s.map[key].stars || 0;
    }
    maxStars = playable * 3;
    const lvl = xpLevel(p.xp), inLv = xpInLevel(p.xp);
    return {
      known, total: V.length, pct: V.length ? known / V.length : 0,
      mastered, learning,
      cleared, stages: playable, stagePct: playable ? cleared / playable : 0,
      stars, maxStars,
      level: lvl, inLevel: inLv, need: XP_PER_LEVEL - inLv, perLevel: XP_PER_LEVEL,
      xp: p.xp, streak: p.streak || 0,
    };
  }

  function touchStreak() {
    const s = load(), t = todayStr(), last = s.profile.lastStudy;
    if (last === t) return s.profile.streak;
    s.profile.streak = (last && daysBetween(last, t) === 1) ? s.profile.streak + 1 : 1;
    s.profile.lastStudy = t;
    s.profile.bestStreak = Math.max(s.profile.bestStreak || 0, s.profile.streak);
    save(true);
    return s.profile.streak;
  }

  /* 成就分四級：普通／稀有／史詩／傳說。
     prog 讓畫面能畫「還差多少」的進度條 —— 困難成就沒有進度看就只是裝飾。
     最上面那幾個是刻意做到「幾乎不可能」的：全書 6012 字學會、全部進長期記憶、
     150 個字母關全三星、文法 32 點全精熟、連續 100 天。 */
  const BADGES = [
    // --- 普通 ---
    { id: 'first', name: '啟程', tier: 'common', desc: '完成第一次闖關', test: st => st.daysStudied >= 1, prog: st => [Math.min(st.daysStudied, 1), 1] },
    { id: 'streak3', name: '三日不斷', tier: 'common', desc: '連續學習 3 天', test: st => st.streak >= 3, prog: st => [st.streak, 3] },
    { id: 'w100', name: '百字斬', tier: 'common', desc: '學會 100 個單字', test: st => st.known >= 100, prog: st => [st.known, 100] },
    { id: 'combo10', name: '十連擊', tier: 'common', desc: '單關連續答對 10 題', test: st => st.bestCombo >= 10, prog: st => [st.bestCombo, 10] },
    { id: 'perfect', name: '無傷通關', tier: 'common', desc: '一關沒扣血且全對', test: st => st.perfectStage, prog: st => [st.perfectStage ? 1 : 0, 1] },
    { id: 'chest10', name: '開箱人', tier: 'common', desc: '累積開 10 個寶箱', test: st => st.chests >= 10, prog: st => [st.chests, 10] },
    // --- 稀有 ---
    { id: 'streak7', name: '七日不斷', tier: 'rare', desc: '連續學習 7 天', test: st => st.streak >= 7, prog: st => [st.streak, 7] },
    { id: 'w500', name: '五百字斬', tier: 'rare', desc: '學會 500 個單字', test: st => st.known >= 500, prog: st => [st.known, 500] },
    { id: 'w1000', name: '千字斬', tier: 'rare', desc: '學會 1000 個單字', test: st => st.known >= 1000, prog: st => [st.known, 1000] },
    { id: 'combo25', name: '廿五連擊', tier: 'rare', desc: '單關連續答對 25 題', test: st => st.bestCombo >= 25, prog: st => [st.bestCombo, 25] },
    { id: 'writer', name: '造句手', tier: 'rare', desc: '累積寫下 20 句自由造句', test: st => st.freeCount >= 20, prog: st => [st.freeCount, 20] },
    { id: 'gram8', name: '文法補完・第一階', tier: 'rare', desc: '完成第一階 8 個文法點', test: st => st.gramDone >= 8, prog: st => [st.gramDone, 8] },
    { id: 'gem100', name: '礦工', tier: 'rare', desc: '累積收集 100 顆寶石', test: st => st.gems >= 100, prog: st => [st.gems, 100] },
    { id: 'stage50', name: '踏遍五十關', tier: 'rare', desc: '通過 50 個字母關', test: st => st.clearedStages >= 50, prog: st => [st.clearedStages, 50] },
    // --- 史詩 ---
    { id: 'streak30', name: '一月不輟', tier: 'epic', desc: '連續學習 30 天', test: st => st.streak >= 30, prog: st => [st.streak, 30] },
    { id: 'w2000', name: '兩千字斬', tier: 'epic', desc: '學會 2000 個單字', test: st => st.known >= 2000, prog: st => [st.known, 2000] },
    { id: 'combo50', name: '五十連擊', tier: 'epic', desc: '單關連續答對 50 題', test: st => st.bestCombo >= 50, prog: st => [st.bestCombo, 50] },
    { id: 'master1000', name: '長期記憶・千字', tier: 'epic', desc: '1000 個字進入長期記憶（box 5 以上）', test: st => st.mastered >= 1000, prog: st => [st.mastered, 1000] },
    { id: 'lv20', name: '二十級', tier: 'epic', desc: '等級達到 Lv.20', test: st => st.level >= 20, prog: st => [st.level, 20] },
    { id: 'lv50', name: '五十級', tier: 'epic', desc: '等級達到 Lv.50', test: st => st.level >= 50, prog: st => [st.level, 50] },
    { id: 'stars200', name: '星塵滿載', tier: 'epic', desc: '累積 200 顆星', test: st => st.stars >= 200, prog: st => [st.stars, 200] },
    { id: 'writer100', name: '百句作家', tier: 'epic', desc: '累積寫下 100 句自由造句', test: st => st.freeCount >= 100, prog: st => [st.freeCount, 100] },
    { id: 'hell10', name: '地獄常客', tier: 'epic', desc: '在「地獄」難度通關 10 次', test: st => st.hellClears >= 10, prog: st => [st.hellClears, 10] },
    // --- 傳說（很難）---
    { id: 'w4000', name: '四千字斬', tier: 'legend', desc: '學會 4000 個單字', test: st => st.known >= 4000, prog: st => [st.known, 4000] },
    { id: 'streak100', name: '百日不輟', tier: 'legend', desc: '連續學習 100 天', test: st => st.streak >= 100, prog: st => [st.streak, 100] },
    { id: 'gram32', name: '文法全通', tier: 'legend', desc: '32 個文法點全部精熟', test: st => st.gramDone >= 32, prog: st => [st.gramDone, 32] },
    { id: 'lv100', name: '百級傳說', tier: 'legend', desc: '等級達到 Lv.100', test: st => st.level >= 100, prog: st => [st.level, 100] },
    { id: 'allstage', name: '走完全圖', tier: 'legend', desc: '六個大關的每一個字母關都通過', test: st => st.playableStages > 0 && st.clearedStages >= st.playableStages, prog: st => [st.clearedStages, st.playableStages || 150] },
    { id: 'allthree', name: '全三星', tier: 'legend', desc: '每一個字母關都拿到三星', test: st => st.playableStages > 0 && st.threeStars >= st.playableStages, prog: st => [st.threeStars, st.playableStages || 150] },
    // --- 究極（全書）---
    {
      id: 'allwords', name: '全書背完', tier: 'ultra',
      desc: `把全書 ${'6012'} 個單字全部學會`,
      test: st => st.total > 0 && st.known >= st.total, prog: st => [st.known, st.total],
    },
    {
      id: 'allmaster', name: '全書精熟', tier: 'ultra',
      desc: '全書每一個字都進入長期記憶（box 5 以上，等於全部複習到第 30 天以上還記得）',
      test: st => st.total > 0 && st.mastered >= st.total, prog: st => [st.mastered, st.total],
    },
  ];
  const BADGE_TIER = {
    common: { name: '普通', cls: 'r-common' },
    rare: { name: '稀有', cls: 'r-rare' },
    epic: { name: '史詩', cls: 'r-epic' },
    legend: { name: '傳說', cls: 'r-legend' },
    ultra: { name: '究極', cls: 'r-ultra' },
  };

  function stats() {
    const s = load();
    let known = 0, mastered = 0;
    for (const k in s.words) { if (s.words[k].b >= 1) known++; if (s.words[k].b >= 5) mastered++; }
    let freeCount = 0, gramSet = new Set();
    for (const dstr in s.days) {
      freeCount += (s.days[dstr].free || []).length;
      (s.days[dstr].gram || []).forEach(g => { if (g.ok) gramSet.add(g.id); });
    }
    const gramDone = [...gramSet].filter(id => {
      const total = (window.GRAMMAR[id] || {}).items || [];
      let right = 0;
      for (const dstr in s.days) (s.days[dstr].gram || []).forEach(g => { if (g.id === id && g.ok && g.attempt === 1) right++; });
      return total.length && right >= total.length;
    }).length;
    /* 成就的累積數字要走 mapStat，才會把「全部學會＝自動完成三星」算進去
       （直接讀 s.map 只看得到真的打過的關）。 */
    let stars = 0, clearedStages = 0, threeStars = 0, playableStages = 0;
    for (let lv = 1; lv <= 6; lv++) {
      LETTERS.forEach(L => {
        const st = mapStat(lv, L);
        if (!st.total) return;
        playableStages++;
        stars += st.stars;
        if (st.cleared) clearedStages++;
        if (st.stars >= 3) threeStars++;
      });
    }
    let chests = 0, gems = 0, hellClears = 0, minutes = 0;
    for (const dstr in s.days) {
      const d = s.days[dstr];
      chests += (d.chests || []).length;
      gems += (d.drops || []).filter(x => /^gem_/.test(x.id)).reduce((a, x) => a + x.n, 0);
      hellClears += (d.runs || []).filter(r => r.passed && r.diff === 'extreme').length;
      minutes += Math.round((d.runs || []).reduce((a, r) => a + (r.sec || 0), 0) / 60);
    }
    return {
      known, mastered, seen: Object.keys(s.words).length, total: window.VOCAB.length,
      streak: s.profile.streak, bestStreak: s.profile.bestStreak || 0,
      daysStudied: Object.keys(s.days).filter(d => (s.days[d].log || []).length).length,
      xp: s.profile.xp, level: xpLevel(s.profile.xp),
      freeCount, gramDone,
      bestCombo: s.profile.bestCombo || 0,
      perfectStage: !!s.profile.everPerfect,
      stars, clearedStages, threeStars, playableStages,
      chests, gems, hellClears, minutes,
    };
  }
  /** 一個成就目前的進度（畫進度條用）。 */
  function badgeProgress(b, st) {
    const s = st || stats();
    const p = b.prog ? b.prog(s) : [b.test(s) ? 1 : 0, 1];
    const goal = Math.max(1, p[1] || 1);
    return { cur: Math.min(p[0] || 0, goal), goal, pct: Math.min(1, (p[0] || 0) / goal) };
  }

  function checkBadges(extra) {
    const s = load(), st = Object.assign(stats(), extra || {});
    const got = [];
    BADGES.forEach(b => {
      if (!s.profile.badges.includes(b.id) && b.test(st)) { s.profile.badges.push(b.id); got.push(b); }
    });
    if (got.length) save(true);
    return got;
  }
  function noteCombo(c) {
    const s = load();
    if (c > (s.profile.bestCombo || 0)) { s.profile.bestCombo = c; save(); }
  }
  function notePerfect() { const s = load(); s.profile.everPerfect = true; save(); }

  // ---------- 闖關地圖：6 級 × A–Z ----------
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWYZ'.split('');   // 詞彙表沒有 X 開頭的字
  const PASS_ACC = 0.90;                                   // 沒有 90% 就是沒通過

  let bucketCache = null;
  /** 每個 (級別, 字首) 的字表。只算一次。 */
  function buckets() {
    if (bucketCache) return bucketCache;
    bucketCache = {};
    for (const w of window.VOCAB) {
      const k = w.lv + ':' + w.w[0].toUpperCase();
      (bucketCache[k] = bucketCache[k] || []).push(w.i);
    }
    return bucketCache;
  }
  function bucket(lv, letter) { return buckets()[lv + ':' + letter] || []; }

  /** 一個字母關的狀態。 */
  function mapStat(lv, letter) {
    const s = load(), ids = bucket(lv, letter), key = lv + ':' + letter;
    s.map = s.map || {};
    const m = s.map[key] || {};
    let known = 0;
    ids.forEach(i2 => { if (s.words[i2] && s.words[i2].b >= 1) known++; });
    /* 這個字母的字**全部都會了**（不管是打關卡打出來的，還是快速篩選篩掉的），
       就直接算完成、直接給三星 —— 不該因為「沒有正式打過這一關」而卡著空星星。 */
    const auto = ids.length > 0 && known >= ids.length;
    return {
      lv, letter, key, total: ids.length, known,
      cleared: !!m.cleared || auto,
      stars: auto ? Math.max(3, m.stars || 0) : (m.stars || 0),
      autoDone: auto && !m.cleared,                 // 沒打過關卡、靠全部學會達成的
      tries: m.tries || 0, best: m.best || 0,
      combo: m.combo || 0,
      // full = 正確率過門檻「而且」這個字母的字 100% 都學會了 —— 只有這樣才算真正打完，
      // 可以前往下一關；否則只能繼續練這一關剩下的新字。
      pct: ids.length ? known / ids.length : 0,
      left: Math.max(0, ids.length - known),
      full: auto,                                   // 完成度 100% 就是完成
    };
  }

  /** 某一級的整體進度。 */
  function levelStat(lv) {
    let total = 0, known = 0, cleared = 0, playable = 0;
    LETTERS.forEach(L => {
      const st = mapStat(lv, L);
      total += st.total; known += st.known;
      if (st.total) playable++;
      if (st.cleared) cleared++;
    });
    return { lv, total, known, cleared, playable };
  }

  /** 下一關：同級的下一個有字的字母 → 下一級。 */
  function nextStage(lv, letter) {
    const li = LETTERS.indexOf(letter);
    for (let k = li + 1; k < LETTERS.length; k++) if (bucket(lv, LETTERS[k]).length) return { lv, letter: LETTERS[k] };
    for (let nl = lv + 1; nl <= 6; nl++) for (const L of LETTERS) if (bucket(nl, L).length) return { lv: nl, letter: L };
    return null;
  }

  function recordStage(lv, letter, passed, acc, stars, combo) {
    const s = load(), key = lv + ':' + letter;
    s.map = s.map || {};
    const m = s.map[key] = s.map[key] || { cleared: false, stars: 0, tries: 0, best: 0 };
    m.tries++;
    m.best = Math.max(m.best, acc);
    m.combo = Math.max(m.combo || 0, combo || 0);      // 這一關的最佳連擊（連擊只在關內累計）
    if (passed) {
      m.cleared = true; m.stars = Math.max(m.stars, stars);
      const d = day(); d.cleared = (d.cleared || 0) + 1;
    }
    // 連勝：通關就 +1，沒過就歸零
    const p = s.profile;
    let shielded = false;
    if (passed) {
      p.winStreak = (p.winStreak || 0) + 1;
      p.bestWinStreak = Math.max(p.bestWinStreak || 0, p.winStreak);
    } else if ((p.winStreak || 0) > 0 && consume('shield')) {
      shielded = true;                       // 護盾擋下，連勝保住
    } else p.winStreak = 0;
    save(true);
    m.shielded = shielded;
    return m;
  }

  /* 全部學完＝通關：把「這個字母的字都會了」正式記進關卡地圖。
     不只是畫面上顯示三星 —— 會記 cleared／三星、算進今日通關數，並發一個銀寶箱。
     （沒有連勝加成，因為那是打關卡打出來的。） */
  function autoClear() {
    const s = load(), out = [];
    s.map = s.map || {};
    for (let lv = 1; lv <= 6; lv++) {
      for (const L of LETTERS) {
        const ids = bucket(lv, L);
        if (!ids.length) continue;
        const key = lv + ':' + L;
        const m = s.map[key] || {};
        if (m.cleared) continue;
        let known = 0;
        ids.forEach(i => { if (s.words[i] && s.words[i].b >= 1) known++; });
        if (known < ids.length) continue;
        s.map[key] = {
          cleared: true, stars: Math.max(3, m.stars || 0), tries: m.tries || 0,
          best: Math.max(m.best || 0, 1), combo: m.combo || 0, auto: true,
        };
        day().cleared = (day().cleared || 0) + 1;
        out.push({ lv, letter: L, chestId: addChest('silver', `第 ${lv} 級 ${L} 關 全部學會`) });
      }
    }
    if (out.length) save(true);
    return out;
  }

  function winStreak() { return load().profile.winStreak || 0; }
  function bestWinStreak() { return load().profile.bestWinStreak || 0; }
  /** 連勝加成：每連勝一關 +8% XP，最多 +80%。 */
  function winStreakBonus() { return Math.min(0.8, winStreak() * 0.08); }

  // ---------- 金幣與商店 ----------
  /* 刻意不賣「跳過一題」「直接看答案」這類道具 —— 那會讓作答紀錄失真，
     而這份紀錄要拿去做家長回報與間隔複習排程。賣的是難度緩衝與外觀。 */
  /* 價格刻意訂得很痛（北歐物價）：一天認真學大概賺 300–600 金幣，
     所以護符要存好幾天、夥伴與傳說外觀要存好幾週。東西貴，拿到才有感覺。 */
  const SHOP = [
    // 消耗品：開關前自動使用（刪去法與復活石是當下手動用）
    { id: 'fifty', name: '刪去法', cost: 90, kind: 'consumable', rarity: 'common', desc: '答題時按一下，刪掉兩個錯的選項' },
    { id: 'heart', name: '護心符', cost: 120, kind: 'consumable', rarity: 'common', desc: '這一關生命值 +1' },
    { id: 'hourglass', name: '沙漏', cost: 140, kind: 'consumable', rarity: 'common', desc: '這一關每題時間 +50%' },
    { id: 'bigheart', name: '大護心符', cost: 380, kind: 'consumable', rarity: 'rare', desc: '這一關生命值 +3' },
    { id: 'hourglass2', name: '大沙漏', cost: 420, kind: 'consumable', rarity: 'rare', desc: '這一關每題時間 ×2（比小沙漏優先使用）' },
    { id: 'xp2', name: '雙倍 XP 卡', cost: 450, kind: 'consumable', rarity: 'rare', desc: '這一關結算 XP ×2' },
    { id: 'xp3', name: '三倍 XP 卡', cost: 1200, kind: 'consumable', rarity: 'epic', desc: '這一關結算 XP ×3（比雙倍卡優先使用）' },
    { id: 'revive', name: '復活石', cost: 900, kind: 'consumable', rarity: 'epic', desc: 'GAME OVER 時可以原地續命，血量回 1（每關限一次）' },
    // 素材包：買下去立刻進背包（不佔道具欄）
    { id: 'pack_dust', name: '星塵袋', cost: 700, kind: 'pack', rarity: 'rare', desc: '立刻獲得 ✨ 星塵 ×3', give: { stardust: 3 } },
    { id: 'pack_gem', name: '寶石袋', cost: 950, kind: 'pack', rarity: 'rare', desc: '立刻獲得藍／綠／紅寶石共 5 顆', give: { gem_blue: 2, gem_green: 2, gem_red: 1 } },
    { id: 'pack_scroll', name: '卷軸捆', cost: 1100, kind: 'pack', rarity: 'epic', desc: '立刻獲得 📜 古卷軸 ×3', give: { scroll: 3 } },
    { id: 'pack_key', name: '鑰匙串', cost: 1600, kind: 'pack', rarity: 'epic', desc: '立刻獲得 🔑 寶箱鑰匙 ×2（可開兩個銀寶箱）', give: { key: 2 } },
    { id: 'pack_diamond', name: '金鑽禮盒', cost: 3200, kind: 'pack', rarity: 'legend', desc: '立刻獲得 💎 金鑽石 ×3 ＋ ✨ 星塵 ×5', give: { gem_gold: 3, stardust: 5 } },
    // 被動護符：持有就生效，效果可疊加
    { id: 'shield', name: '連勝護盾', cost: 800, kind: 'auto', rarity: 'rare', desc: '闖關失敗時自動擋下，連勝不歸零（用掉一個）' },
    { id: 'charm_luck', name: '幸運符', cost: 2600, kind: 'auto', rarity: 'epic', desc: '寶箱開出道具機率 +20%，金幣與 XP ×1.15' },
    { id: 'charm_scholar', name: '學者之心', cost: 2900, kind: 'auto', rarity: 'epic', desc: '每日簽到獎勵 ×1.2' },
    { id: 'charm_magnet', name: '金幣磁鐵', cost: 3400, kind: 'auto', rarity: 'epic', desc: '通關金幣 ×1.25' },
    { id: 'charm_gem', name: '素材磁鐵', cost: 4200, kind: 'auto', rarity: 'legend', desc: '每次通關多掉 1 顆該級別的寶石' },
    { id: 'charm_xp', name: '經驗護符', cost: 5000, kind: 'auto', rarity: 'legend', desc: '答對的 XP ×1.1（可與夥伴疊加）' },
    // 夥伴：同時只能帶一隻
    { id: 'pet_owl', name: '夥伴：貓頭鷹', cost: 6000, kind: 'pet', rarity: 'legend', desc: '答對的 XP ×1.05' },
    { id: 'pet_fox', name: '夥伴：小狐狸', cost: 7000, kind: 'pet', rarity: 'legend', desc: '連擊分 ×1.5' },
    { id: 'pet_dragon', name: '夥伴：龍寶寶', cost: 8500, kind: 'pet', rarity: 'legend', desc: '寶箱金幣 ×1.15' },
    { id: 'pet_unicorn', name: '夥伴：獨角獸', cost: 15000, kind: 'pet', rarity: 'ultra', desc: '開寶箱時 25% 機率自動升一級（木→銀→金）' },
    // 外觀
    { id: 'theme_forest', name: '主題：森林', cost: 1500, kind: 'theme', rarity: 'rare', desc: '綠意配色' },
    { id: 'theme_sunset', name: '主題：夕陽', cost: 1500, kind: 'theme', rarity: 'rare', desc: '暖橘配色' },
    { id: 'theme_ocean', name: '主題：深海', cost: 2400, kind: 'theme', rarity: 'epic', desc: '深藍配色' },
    { id: 'theme_sakura', name: '主題：櫻花', cost: 2600, kind: 'theme', rarity: 'epic', desc: '粉櫻配色' },
    { id: 'theme_night', name: '主題：星空', cost: 4500, kind: 'theme', rarity: 'legend', desc: '深紫星空配色' },
    { id: 'theme_aurora', name: '主題：極光', cost: 9000, kind: 'theme', rarity: 'legend', desc: '青綠極光配色' },
    { id: 'theme_gold', name: '主題：黃金', cost: 20000, kind: 'theme', rarity: 'ultra', desc: '整站鑲金。最貴的虛榮。' },
    // 稱號：能買的只留三個，最後一個貴到誇張
    { id: 'title_scholar', name: '稱號：苦讀生', cost: 1200, kind: 'title', rarity: 'common', desc: '顯示在頂端' },
    { id: 'title_hunter', name: '稱號：獵字人', cost: 2500, kind: 'title', rarity: 'rare', desc: '顯示在頂端' },
    { id: 'title_hero', name: '稱號：六級勇者', cost: 25000, kind: 'title', rarity: 'ultra', desc: '存到這個的人，大概已經背完全書了' },
    // 升等限定稱號：cost 0 + levelOnly，商店買不到、也不會上特價，只能靠升等發下來
    { id: 'title_lv25', name: '稱號：廿五級開拓者', cost: 0, levelOnly: 25, kind: 'title', rarity: 'rare', desc: '升到 Lv.25 自動獲得，有錢也買不到' },
    { id: 'title_lv50', name: '稱號：五十級大師', cost: 0, levelOnly: 50, kind: 'title', rarity: 'epic', desc: '升到 Lv.50 自動獲得，有錢也買不到' },
    { id: 'title_lv75', name: '稱號：七十五級宗師', cost: 0, levelOnly: 75, kind: 'title', rarity: 'legend', desc: '升到 Lv.75 自動獲得，有錢也買不到' },
  ];
  const RARITY = {
    common: { name: '普通', cls: 'r-common' }, rare: { name: '稀有', cls: 'r-rare' },
    epic: { name: '史詩', cls: 'r-epic' }, legend: { name: '傳說', cls: 'r-legend' },
    ultra: { name: '究極', cls: 'r-ultra' },
  };
  /* 百級稱號（title_lv100、title_lv200……）不在 SHOP 清單裡，是照規則生出來的，
     所以這裡要能解析它們 —— 頂端顯示、裝備、升等發獎都靠這個查名字。 */
  function shopItem(id) {
    const hit = SHOP.find(x => x.id === id);
    if (hit) return hit;
    const m = /^title_lv(\d+)$/.exec(id || '');
    return (m && +m[1] >= 100 && +m[1] % 100 === 0) ? hundredTitle(+m[1]) : undefined;
  }
  /** 升等限定的百級稱號：已拿到的 + 下一個目標（商店稱號區展示用）。 */
  function levelTitles() {
    const inv = inventory(), out = [];
    for (const id in inv) {
      const m = /^title_lv(\d+)$/.exec(id);
      if (m && +m[1] % 100 === 0) out.push(hundredTitle(+m[1]));
    }
    out.sort((a, b) => a.levelOnly - b.levelOnly);
    out.push(hundredTitle((Math.floor(xpLevel(load().profile.xp) / 100) + 1) * 100));
    return out;
  }

  /* 被動效果集中在這裡算，畫面與結算都呼叫同一組函式。
     刻意沒有任何「看答案／跳過題目」的效果 —— 那會污染作答紀錄與複習排程。 */
  const petIs = id => equipped('pet') === id;
  function xpMult() { return (petIs('pet_owl') ? 1.05 : 1) * (owned('charm_xp') ? 1.1 : 1); }
  function comboMult() { return petIs('pet_fox') ? 1.5 : 1; }
  function coinMult() { return owned('charm_magnet') ? 1.25 : 1; }
  function checkinMult() { return owned('charm_scholar') ? 1.2 : 1; }
  function chestBoost() {
    return {
      item: owned('charm_luck') ? 0.2 : 0,
      mult: (owned('charm_luck') ? 1.15 : 1) * (petIs('pet_dragon') ? 1.15 : 1),
    };
  }

  /* 每日特價：用日期抽 2 件貴的商品打 75 折，每天不一樣 —— 讓商店天天有理由回來看。 */
  /** 只能擁有一個的類型（主題／稱號／夥伴／護符）——買過就不該再出現在特價。 */
  const UNIQUE_KINDS = ['theme', 'title', 'pet', 'auto'];
  const isUnique = it => UNIQUE_KINDS.includes(it.kind);

  /* 管理員可以指定今天哪幾件特價（settings.dealOverride）。
     null／undefined＝照原本的規則每天自動抽；空陣列＝今天完全沒有特價。 */
  function dealsToday(dstr) {
    const t = dstr || todayStr();
    const ov = load().profile.settings.dealOverride;
    if (Array.isArray(ov)) {
      return ov.map(id => shopItem(id)).filter(Boolean)
        .map(x => ({ id: x.id, off: 0.25, cost: Math.round(x.cost * 0.75), full: x.cost }));
    }
    // 已經擁有的單品（主題、夥伴、稱號、護符）不再上特價 —— 特價要是買得到的東西
    const pool = SHOP.filter(x => x.cost >= 100 && !(isUnique(x) && owned(x.id)));
    return pickN(pool, 2, seeded('D' + t)).map(x => ({
      id: x.id, off: 0.25, cost: Math.round(x.cost * 0.75), full: x.cost,
    }));
  }
  function dealFor(id, dstr) { return dealsToday(dstr).find(d => d.id === id) || null; }
  /** 實付價格（有特價就用特價）。 */
  function priceOf(id) {
    const it = shopItem(id);
    if (!it) return 0;
    const ov = (load().profile.settings.priceOverride || {})[id];
    if (ov != null) return Math.max(0, ov);          // 管理員指定價：連特價都蓋過去
    const d = dealFor(id);
    return d ? d.cost : it.cost;
  }

  /* ---------- 管理員專用的設定入口 ----------
     這些函式只有管理員面板會呼叫。放在 store 而不是 admin.js，是因為它們改的是遊戲狀態，
     而遊戲狀態的規則（價格怎麼算、任務怎麼算完成）本來就住在這裡。 */
  function setPrice(id, n) {
    const c = load().profile.settings;
    c.priceOverride = c.priceOverride || {};
    if (n == null || n === '') delete c.priceOverride[id];
    else c.priceOverride[id] = Math.max(0, Math.round(+n) || 0);
    save(true);
    return c.priceOverride;
  }
  function clearPrices() { load().profile.settings.priceOverride = {}; save(true); }
  /** ids = 陣列（指定特價）／null（回到每天自動抽）。 */
  function setDeals(ids) {
    const c = load().profile.settings;
    if (ids == null) delete c.dealOverride; else c.dealOverride = ids.slice(0, 6);
    save(true);
    return dealsToday();
  }
  function setBadge(id, on) {
    const p = load().profile;
    const set = new Set(p.badges || []);
    on ? set.add(id) : set.delete(id);
    p.badges = [...set];
    save(true);
    return p.badges;
  }
  /** 把某個任務直接標成完成（或取消）。獎勵照原本的流程在結算時入帳。 */
  function setQuestDone(id, on) {
    const d = day();
    d.quests = d.quests || {};
    on ? (d.quests[id] = true) : delete d.quests[id];
    save(true);
    return d.quests;
  }
  /** 清掉今天的簽到紀錄，讓簽到可以重跑一次。 */
  function resetCheckin() { const d = day(); delete d.checkin; save(true); }

  function coins() { return load().profile.coins || 0; }
  function addCoins(n) {
    const p = load().profile;
    p.coins = (p.coins || 0) + n;
    if (n > 0) day().coin += n;          // 「今天賺了多少金幣」是每日任務的條件之一
    save();
    return p.coins;
  }
  function inventory() { const p = load().profile; return (p.inventory = p.inventory || {}); }

  /* 新手包：第一次開啟時送幾個消耗品。
     不是為了發糖，是因為道具系統（要不要用、用幾個）如果手上一個都沒有，
     使用者只會看到「你沒有道具」，根本不知道那個功能存在。 */
  const STARTER = { heart: 2, hourglass: 1, fifty: 2 };
  /* 補償包：道具改成「自己選要不要用」之前，是每一關自動消耗的 ——
     等於把玩家買來的護心符、沙漏、XP 卡默默燒掉了。那是設計失誤，不該由玩家承擔，
     所以已經有進度的存檔會一次補回來（只補一次）。 */
  const MAKEUP = { heart: 3, bigheart: 1, hourglass: 2, xp2: 2, fifty: 3 };
  function grantMakeup() {
    const s = load(), p = s.profile;
    if (p.makeupOptIn) return null;
    p.makeupOptIn = true;
    const played = (p.xp || 0) > 0 || Object.keys(s.days || {}).length > 0;
    if (!played) { save(true); return null; }        // 全新玩家沒被燒過，不用補
    const inv = inventory();
    Object.keys(MAKEUP).forEach(id => { inv[id] = (inv[id] || 0) + MAKEUP[id]; });
    p.coins = (p.coins || 0) + 600;
    save(true);
    return Object.assign({ coins: 600 }, MAKEUP);
  }
  function grantStarter() {
    const p = load().profile;
    if (p.starterGiven) return null;
    p.starterGiven = true;
    const inv = inventory();
    Object.keys(STARTER).forEach(id => { inv[id] = (inv[id] || 0) + STARTER[id]; });
    p.coins = (p.coins || 0) + 150;
    save(true);
    return Object.assign({ coins: 150 }, STARTER);
  }
  function owned(id) { return (inventory()[id] || 0) > 0; }

  function buy(id) {
    const it = shopItem(id);
    if (!it) return { ok: false, msg: '沒有這個道具' };
    if (it.levelOnly) return { ok: false, msg: `這是升等限定，升到 Lv.${it.levelOnly} 才會發` };
    // 素材包可以重複買（買了直接變素材）；消耗品也可以疊；其他一件就夠
    if (it.kind !== 'consumable' && it.kind !== 'pack' && owned(id)) return { ok: false, msg: '已經有了' };
    const cost = priceOf(id);
    if (coins() < cost) return { ok: false, msg: `金幣不夠（還差 ${cost - coins()}）` };
    addCoins(-cost);
    if (it.kind === 'pack') {
      // 素材包不進道具欄，直接發素材（並寫進掉落紀錄）
      grantMats(Object.keys(it.give).map(k => ({ id: k, n: it.give[k] })), '商店：' + it.name);
      save(true);
      return { ok: true, item: it, pack: true };
    }
    const inv = inventory();
    inv[id] = (inv[id] || 0) + 1;
    save(true);
    return { ok: true, item: it };
  }

  /** 消耗一個道具，回傳有沒有成功。 */
  function consume(id) {
    const inv = inventory();
    if (!inv[id]) return false;
    inv[id]--;
    if (inv[id] <= 0) delete inv[id];
    save(true);
    return true;
  }

  function equip(id) {
    const it = shopItem(id);
    if (!it || !owned(id)) return false;
    const p = load().profile;
    p.equipped = p.equipped || {};
    p.equipped[it.kind] = (p.equipped[it.kind] === id) ? null : id;   // 再按一次取消裝備
    save(true);
    return true;
  }
  function equipped(kind) { return (load().profile.equipped || {})[kind] || null; }

  /** 過關金幣：基礎 + 星數 + 連勝，再乘上金幣磁鐵。 */
  function stageCoins(stars, streak) {
    return Math.round((8 + stars * 4 + Math.min(streak || 0, 10) * 2) * coinMult());
  }

  // ---------- 背包素材（寶石等通關掉落物）----------
  /* 素材只從「實際闖關、開箱、任務」掉出來，不能用金幣買 —— 這樣素材才代表真的練習量。
     素材的用途是合成道具與開鑰匙箱，不會直接影響判分。 */
  const MATERIALS = {
    gem_blue: { id: 'gem_blue', name: '藍寶石', icon: '🔹', tier: 1, desc: '低級關卡最常掉，合成基本道具用' },
    gem_green: { id: 'gem_green', name: '綠寶石', icon: '💚', tier: 1, desc: '中級關卡掉落' },
    gem_red: { id: 'gem_red', name: '紅寶石', icon: '❤️', tier: 2, desc: '高級關卡掉落，合成強力道具' },
    gem_gold: { id: 'gem_gold', name: '金鑽石', icon: '💎', tier: 3, desc: '三星通關才有機會掉' },
    stardust: { id: 'stardust', name: '星塵', icon: '✨', tier: 2, desc: '連擊越高掉越多' },
    scroll: { id: 'scroll', name: '古卷軸', icon: '📜', tier: 2, desc: '任務與寶箱掉落' },
    key: { id: 'key', name: '寶箱鑰匙', icon: '🔑', tier: 3, desc: '在背包裡直接開一個銀寶箱' },
  };
  const MAT_ORDER = ['gem_blue', 'gem_green', 'gem_red', 'gem_gold', 'stardust', 'scroll', 'key'];
  const material = id => MATERIALS[id];

  function mats() { const p = load().profile; return (p.materials = p.materials || {}); }
  function matCount(id) { return mats()[id] || 0; }
  function addMat(id, n) {
    if (!MATERIALS[id] || !n) return 0;
    const m = mats();
    m[id] = Math.max(0, (m[id] || 0) + n);
    if (!m[id]) delete m[id];
    save();
    return m[id] || 0;
  }
  /** 扣素材；不夠就整筆不扣（不做部分扣款）。 */
  function useMats(need) {
    for (const k in need) if (matCount(k) < need[k]) return false;
    for (const k in need) addMat(k, -need[k]);
    save(true);
    return true;
  }
  /** 通關掉落：級別決定寶石種類，星數與連擊決定量。 */
  function matDrop(o) {
    const x = o || {}, out = [];
    if (!x.passed) return out;
    const lv = x.lv || 1, stars = x.stars || 1, combo = x.combo || 0;
    const base = lv <= 2 ? 'gem_blue' : lv <= 4 ? 'gem_green' : 'gem_red';
    out.push({ id: base, n: 1 + (stars >= 2 ? 1 : 0) });
    if (owned('charm_gem')) out[0].n += 1;            // 素材磁鐵
    if (stars >= 3 && Math.random() < 0.5) out.push({ id: 'gem_gold', n: 1 });
    if (combo >= 8) out.push({ id: 'stardust', n: Math.min(3, Math.floor(combo / 8)) });
    if (Math.random() < 0.18) out.push({ id: 'scroll', n: 1 });
    if (stars >= 3 && Math.random() < 0.12) out.push({ id: 'key', n: 1 });
    return out;
  }
  /** 收下一批掉落並寫進當日紀錄（時間＋內容）。 */
  function grantMats(list, from) {
    const got = (list || []).filter(x => x && x.n > 0);
    if (!got.length) return [];
    const d = day();
    d.drops = d.drops || [];
    got.forEach(x => {
      addMat(x.id, x.n);
      d.drops.push({ id: x.id, n: x.n, name: MATERIALS[x.id].name, icon: MATERIALS[x.id].icon, from: from || '', at: new Date().toISOString() });
    });
    save(true);
    return got;
  }
  function dropLog(dstr) {
    const s = load();
    if (dstr === 'all') {
      const out = [];
      Object.keys(s.days).sort().reverse().forEach(t => (s.days[t].drops || []).slice().reverse().forEach(x => out.push(Object.assign({ date: t }, x))));
      return out;
    }
    const t = dstr || todayStr();
    return (day(t).drops || []).slice().reverse().map(x => Object.assign({ date: t }, x));
  }
  /** 今天總共收了幾顆寶石（任務條件用）。 */
  function gemsToday(dstr) {
    return (day(dstr).drops || []).filter(x => /^gem_/.test(x.id)).reduce((a, x) => a + x.n, 0);
  }

  /* 合成台：素材（＋少量金幣）換道具。刻意都是「難度緩衝」類道具，不影響紀錄誠實性。 */
  const RECIPES = [
    { id: 'r_fifty', out: 'fifty', need: { gem_blue: 2 }, coin: 0 },
    { id: 'r_heart', out: 'heart', need: { gem_green: 2, gem_blue: 1 }, coin: 0 },
    { id: 'r_hourglass', out: 'hourglass', need: { gem_blue: 3 }, coin: 0 },
    { id: 'r_bigheart', out: 'bigheart', need: { gem_green: 4, stardust: 2 }, coin: 20 },
    { id: 'r_xp2', out: 'xp2', need: { stardust: 3, gem_red: 1 }, coin: 20 },
    { id: 'r_xp3', out: 'xp3', need: { stardust: 6, gem_red: 3, gem_gold: 1 }, coin: 60 },
    { id: 'r_revive', out: 'revive', need: { gem_gold: 2, stardust: 4 }, coin: 40 },
    { id: 'r_shield', out: 'shield', need: { scroll: 2, gem_red: 2 }, coin: 30 },
    { id: 'r_key', out: 'key', kindOut: 'material', need: { gem_gold: 1, scroll: 1 }, coin: 30 },
  ];
  function canCraft(id) {
    const r = RECIPES.find(x => x.id === id);
    if (!r) return false;
    if (coins() < (r.coin || 0)) return false;
    for (const k in r.need) if (matCount(k) < r.need[k]) return false;
    return true;
  }
  function craft(id) {
    const r = RECIPES.find(x => x.id === id);
    if (!r) return { ok: false, msg: '沒有這個配方' };
    if (coins() < (r.coin || 0)) return { ok: false, msg: `金幣不夠（還差 ${r.coin - coins()}）` };
    if (!useMats(r.need)) return { ok: false, msg: '素材不夠' };
    if (r.coin) addCoins(-r.coin);
    if (r.kindOut === 'material') addMat(r.out, 1);
    else { const inv = inventory(); inv[r.out] = (inv[r.out] || 0) + 1; }
    const d = day();
    d.crafted = (d.crafted || 0) + 1;
    save(true);
    const name = r.kindOut === 'material' ? MATERIALS[r.out].name : (shopItem(r.out) || {}).name;
    return { ok: true, name };
  }
  /** 用鑰匙開一個銀寶箱（背包裡直接用）。 */
  function useKey() {
    if (matCount('key') < 1) return null;
    addMat('key', -1);
    return openChest('silver');
  }

  // ---------- 寶箱 ----------
  /* 通關給寶箱、加碼題答對可以把寶箱升級。寶箱只會給「金幣／XP／道具」，
     不會給答案或跳題 —— 獎勵不能污染作答紀錄。 */
  const CHEST = {
    wood: { id: 'wood', name: '木寶箱', icon: '📦', coin: [8, 18], xp: [20, 45], rolls: 1, cls: 'c-wood' },
    silver: { id: 'silver', name: '銀寶箱', icon: '🎁', coin: [22, 40], xp: [55, 100], rolls: 2, cls: 'c-silver' },
    gold: { id: 'gold', name: '金寶箱', icon: '💎', coin: [50, 85], xp: [120, 200], rolls: 3, cls: 'c-gold' },
    rainbow: { id: 'rainbow', name: '彩虹寶箱', icon: '🌈', coin: [130, 240], xp: [320, 520], rolls: 4, cls: 'c-rainbow' },
  };
  const CHEST_ORDER = ['wood', 'silver', 'gold', 'rainbow'];

  /* 開箱內容用加權抽獎表，每一級寶箱抽的次數與權重都不同。
     special: true 的是「驚喜」獎品（鑰匙、復活石、三倍卡、金幣大獎、神秘禮物），
     在木寶箱裡權重極低，只有金／彩虹才有像樣的機率 —— 這樣開到才會有感覺。 */
  const LOOT = [
    { id: 'm_blue', kind: 'mat', mat: 'gem_blue', n: [1, 2], w: { wood: 30, silver: 18, gold: 8, rainbow: 4 } },
    { id: 'm_green', kind: 'mat', mat: 'gem_green', n: [1, 2], w: { wood: 16, silver: 22, gold: 12, rainbow: 5 } },
    { id: 'm_red', kind: 'mat', mat: 'gem_red', n: [1, 2], w: { wood: 5, silver: 15, gold: 20, rainbow: 9 } },
    { id: 'm_dust', kind: 'mat', mat: 'stardust', n: [1, 3], w: { wood: 9, silver: 14, gold: 16, rainbow: 12 } },
    { id: 'm_scroll', kind: 'mat', mat: 'scroll', n: [1, 2], w: { wood: 4, silver: 9, gold: 12, rainbow: 12 } },
    { id: 'm_diamond', kind: 'mat', mat: 'gem_gold', n: [1, 2], w: { wood: 0.8, silver: 3.5, gold: 11, rainbow: 18 }, special: true },
    { id: 'm_key', kind: 'mat', mat: 'key', n: [1, 1], w: { wood: 0.5, silver: 2, gold: 5, rainbow: 13 }, special: true },
    { id: 'i_fifty', kind: 'item', item: 'fifty', w: { wood: 14, silver: 9, gold: 5, rainbow: 2 } },
    { id: 'i_heart', kind: 'item', item: 'heart', w: { wood: 9, silver: 10, gold: 6, rainbow: 2 } },
    { id: 'i_hour', kind: 'item', item: 'hourglass', w: { wood: 6, silver: 8, gold: 5, rainbow: 2 } },
    { id: 'i_xp2', kind: 'item', item: 'xp2', w: { wood: 1.2, silver: 5, gold: 9, rainbow: 7 } },
    { id: 'i_bigheart', kind: 'item', item: 'bigheart', w: { wood: 0.6, silver: 3, gold: 7, rainbow: 7 } },
    { id: 'i_hour2', kind: 'item', item: 'hourglass2', w: { wood: 0.4, silver: 2, gold: 5, rainbow: 6 } },
    { id: 'i_xp3', kind: 'item', item: 'xp3', w: { wood: 0.15, silver: 0.9, gold: 4, rainbow: 10 }, special: true },
    { id: 'i_revive', kind: 'item', item: 'revive', w: { wood: 0.1, silver: 0.7, gold: 3.5, rainbow: 9 }, special: true },
    { id: 'i_shield', kind: 'item', item: 'shield', w: { wood: 0.4, silver: 1.5, gold: 4, rainbow: 6 } },
    { id: 'jackpot', kind: 'coin', n: [150, 400], w: { wood: 0.25, silver: 1, gold: 3, rainbow: 9 }, special: true },
    { id: 'megaxp', kind: 'xp', n: [200, 500], w: { wood: 0.25, silver: 1, gold: 3, rainbow: 9 }, special: true },
    { id: 'mystery', kind: 'gift', w: { wood: 0.04, silver: 0.2, gold: 0.9, rainbow: 5 }, special: true },
  ];
  const LOOT_NAME = { jackpot: '金幣大獎', megaxp: 'XP 大獎', mystery: '🎀 神秘禮物' };

  /* 這一關該給哪一級寶箱。刻意收緊：全對還不夠，關卡要有份量、不能重來。
     彩虹寶箱幾乎是「表演級」條件（20 題以上全對、連擊 20、挑戰難度以上、不重來）。 */
  function chestTier(o) {
    const x = o || {};
    const stars = x.stars || 0, combo = x.combo || 0, n = x.count || x.answered || 0;
    const retries = x.retries || 0;
    const hard = x.diff === 'hard' || x.diff === 'extreme';
    if (stars >= 3 && !retries && n >= 20 && combo >= 20 && hard) return 'rainbow';
    if (stars >= 3 && !retries && n >= 10) return 'gold';
    if (stars >= 3 || (stars >= 2 && !retries) || combo >= 12) return 'silver';
    return 'wood';
  }
  /** 升一級。預設最多升到金 —— 彩虹只能靠真本事（或加碼題答對）拿到。 */
  function upgradeChest(t, allowRainbow) {
    const cap = allowRainbow ? CHEST_ORDER.length - 1 : CHEST_ORDER.indexOf('gold');
    const k = CHEST_ORDER.indexOf(t);
    return CHEST_ORDER[Math.min(cap, (k < 0 ? 0 : k) + 1)];
  }

  /** 抽一個獎品（加權隨機）。回傳的物件已經算好數量與顯示名稱，還沒入帳。 */
  function rollOne(tier) {
    const pool = LOOT.filter(x => (x.w[tier] || 0) > 0);
    let total = 0;
    pool.forEach(x => { total += x.w[tier]; });
    let r = Math.random() * total;
    const hit = pool.find(x => (r -= x.w[tier]) <= 0) || pool[0];
    const n = hit.n ? hit.n[0] + Math.floor(Math.random() * (hit.n[1] - hit.n[0] + 1)) : 1;
    return { id: hit.id, kind: hit.kind, mat: hit.mat, item: hit.item, n, special: !!hit.special };
  }
  /** 神秘禮物：從還沒擁有的史詩／傳說／究極商品裡隨機給一件；全都有了就換成大量金幣。 */
  function mysteryGift() {
    const pool = SHOP.filter(x => ['epic', 'legend', 'ultra'].includes(x.rarity)
      && x.kind !== 'pack' && x.kind !== 'consumable' && !owned(x.id));
    if (!pool.length) return { kind: 'coin', id: 'jackpot', n: 500 + Math.floor(Math.random() * 500), special: true };
    const it = pool[Math.floor(Math.random() * pool.length)];
    return { kind: 'gift', id: it.id, item: it.id, n: 1, special: true };
  }

  /** 開箱：抽獎、入帳、寫紀錄。回傳完整內容給畫面演出。 */
  function openChest(tier) {
    // 獨角獸：開箱時有機會自動升一級（最多升到金）
    let upgraded = false;
    if (petIs('pet_unicorn') && Math.random() < 0.25) {
      const up = upgradeChest(tier || 'wood');
      if (up !== tier) { tier = up; upgraded = true; }
    }
    const c = CHEST[tier] || CHEST.wood;
    const bo = chestBoost();
    const money = (a, b) => Math.round((a + Math.floor(Math.random() * (b - a + 1))) * bo.mult);
    let coin = money(c.coin[0], c.coin[1]), xp = money(c.xp[0], c.xp[1]);

    // 抽獎：幸運符讓抽獎次數有機會 +1
    const rolls = c.rolls + (Math.random() < bo.item ? 1 : 0);
    const drops = [];
    const inv = inventory();
    for (let k = 0; k < rolls; k++) {
      let d = rollOne(c.id);
      if (d.kind === 'gift') d = mysteryGift();
      if (d.kind === 'mat') { addMat(d.mat, d.n); d.label = `${MATERIALS[d.mat].icon} ${MATERIALS[d.mat].name} ×${d.n}`; }
      else if (d.kind === 'item') { inv[d.item] = (inv[d.item] || 0) + 1; d.label = `🧪 ${(shopItem(d.item) || {}).name}`; }
      else if (d.kind === 'gift') { inv[d.item] = (inv[d.item] || 0) + 1; d.label = `🎀 神秘禮物：${(shopItem(d.item) || {}).name}`; }
      else if (d.kind === 'coin') { coin += d.n; d.label = `🪙 金幣大獎 +${d.n}`; }
      else if (d.kind === 'xp') { xp += d.n; d.label = `✨ XP 大獎 +${d.n}`; }
      drops.push(d);
    }
    addXp(xp); addCoins(coin);
    const row = {
      tier: c.id, name: c.name, icon: c.icon, coin, xp,
      drops, special: drops.some(d => d.special), upgraded,
      item: (drops.find(d => d.kind === 'item' || d.kind === 'gift') || {}).item || null,   // 舊紀錄格式相容
      at: new Date().toISOString(),
    };
    const d2 = day();
    d2.chests = d2.chests || [];
    d2.chests.push(row);
    save(true);
    return row;
  }
  /** 寶箱條件說明（畫面上要讓人看得懂怎麼拿到大箱子）。 */
  const CHEST_RULES = [
    { tier: 'rainbow', text: '20 題以上全對、連擊 ≥20、挑戰難度以上、沒重來' },
    { tier: 'gold', text: '10 題以上全對且沒重來' },
    { tier: 'silver', text: '全對（小關）／二星沒重來／本關連擊 ≥12' },
    { tier: 'wood', text: '通關' },
  ];
  /* 沒開的寶箱會存進背包（而不是逼你當場開）。
     存的是「還沒抽獎的箱子」，所以之後開出來的內容一樣是即時抽的，不會被鎖死。 */
  function chestBag() {
    const p = load().profile;
    return (p.chestBag = p.chestBag || []);
  }
  function addChest(tier, from) {
    const bag = chestBag();
    const row = { id: 'c' + (load().profile.chestSeq = (load().profile.chestSeq || 0) + 1), tier, from: from || '', at: new Date().toISOString() };
    bag.push(row);
    save(true);
    return row.id;
  }
  function takeChest(id) {
    const bag = chestBag();
    const k = bag.findIndex(x => x.id === id);
    if (k < 0) return null;
    const row = bag.splice(k, 1)[0];
    save(true);
    return row;
  }
  /** 開背包裡的某一個箱子（沒指定就開最舊的）。 */
  function openStored(id) {
    const bag = chestBag();
    const row = id ? takeChest(id) : (bag.length ? takeChest(bag[0].id) : null);
    if (!row) return null;
    return openChest(row.tier);
  }
  /** 一次全開：回傳每一箱的內容與總計。 */
  function openAllStored() {
    const rows = chestBag().slice();
    if (!rows.length) return null;
    const results = [];
    rows.forEach(r => { takeChest(r.id); results.push(openChest(r.tier)); });
    const total = results.reduce((a, r) => {
      a.coin += r.coin; a.xp += r.xp;
      (r.drops || []).forEach(d => a.drops.push(d));
      if (r.special) a.special = true;
      return a;
    }, { coin: 0, xp: 0, drops: [], special: false });
    return { results, total, count: results.length };
  }
  /** 背包裡各等級各有幾箱（畫面顯示用）。 */
  function chestBagSummary() {
    const by = {};
    chestBag().forEach(c => { by[c.tier] = (by[c.tier] || 0) + 1; });
    return { total: chestBag().length, byTier: by };
  }

  function chestLog(dstr) {
    const s = load();
    if (dstr === 'all') {
      const out = [];
      Object.keys(s.days).sort().reverse().forEach(t => (s.days[t].chests || []).slice().reverse().forEach(x => out.push(Object.assign({ date: t }, x))));
      return out;
    }
    const t = dstr || todayStr();
    return (day(t).chests || []).slice().reverse().map(x => Object.assign({ date: t }, x));
  }

  // ---------- 每日簽到（7 天一輪的獎勵軌道）----------
  /* 一週一輪：獎勵一天比一天多，第 3、5 天給道具，第 7 天直接給金寶箱。
     每完成一輪，下一輪整體再加成 15%（最多 ×2），所以連得越久越划算。
     里程碑（14／30／60／100 天）另外給大獎。 */
  const CHECKIN_TRACK = [
    { day: 1, xp: 30, coin: 15 },
    { day: 2, xp: 45, coin: 22 },
    { day: 3, xp: 60, coin: 30, item: 'heart' },
    { day: 4, xp: 80, coin: 40 },
    { day: 5, xp: 100, coin: 55, item: 'fifty' },
    { day: 6, xp: 130, coin: 70 },
    { day: 7, xp: 180, coin: 110, chest: 'gold' },
  ];
  const CHECKIN_MILESTONE = {
    14: { xp: 300, coin: 200, item: 'xp2', chest: 'gold', note: '連續兩週！' },
    30: { xp: 700, coin: 500, item: 'revive', unlock: 'title_scholar', chest: 'rainbow', note: '一整個月不斷！' },
    60: { xp: 1500, coin: 1000, item: 'xp3', unlock: 'theme_night', chest: 'rainbow', note: '兩個月！' },
    100: { xp: 3000, coin: 2000, unlock: 'title_hero', chest: 'rainbow', note: '一百天，這已經是傳說了。' },
  };
  /** 這個連續天數落在軌道的第幾天／第幾輪。 */
  function checkinSlot(streak) {
    const s = Math.max(1, streak || 1);
    return { day: ((s - 1) % 7) + 1, cycle: Math.floor((s - 1) / 7) + 1 };
  }
  function checkinMultiplier(cycle) { return Math.min(2, 1 + (cycle - 1) * 0.15) * checkinMult(); }
  /** 預覽這一輪 7 天的獎勵（首頁的簽到軌道用）。 */
  function checkinPreview(streak) {
    const sl = checkinSlot(streak == null ? (load().profile.streak || 1) : streak);
    const mul = checkinMultiplier(sl.cycle);
    return {
      cycle: sl.cycle, today: sl.day,
      days: CHECKIN_TRACK.map(x => ({
        day: x.day, xp: Math.round(x.xp * mul), coin: Math.round(x.coin * mul),
        item: x.item || null, chest: x.chest || null,
        state: x.day < sl.day ? 'past' : x.day === sl.day ? 'now' : 'future',
      })),
      next: Object.keys(CHECKIN_MILESTONE).map(Number).sort((a, b) => a - b)
        .find(n => n > (load().profile.streak || 0)) || null,
    };
  }

  /** 當天第一次完成關卡時簽到。獎勵一天比一天大，第 7 天給金寶箱。 */
  function checkIn() {
    const d = day();
    if (d.checkin) return null;
    const streak = load().profile.streak || 1;
    const sl = checkinSlot(streak);
    const slot = CHECKIN_TRACK[sl.day - 1];
    const mul = checkinMultiplier(sl.cycle);
    const xp = Math.round(slot.xp * mul), coin = Math.round(slot.coin * mul);
    const inv = inventory();
    if (slot.item) inv[slot.item] = (inv[slot.item] || 0) + 1;
    // 第 7 天的金寶箱要真的發出來 —— 直接進背包，之後可以一次全開
    if (slot.chest) addChest(slot.chest, `每日簽到 第 ${sl.day} 天`);
    const ms = CHECKIN_MILESTONE[streak] || null;
    if (ms) {
      if (ms.item) inv[ms.item] = (inv[ms.item] || 0) + 1;
      if (ms.unlock && !inv[ms.unlock]) inv[ms.unlock] = 1;
      if (ms.chest) addChest(ms.chest, `連續 ${streak} 天里程碑`);
    }
    const totalXp = xp + (ms ? ms.xp : 0), totalCoin = coin + (ms ? ms.coin : 0);
    d.checkin = {
      xp: totalXp, coin: totalCoin, streak, day: sl.day, cycle: sl.cycle,
      item: slot.item || null, chest: slot.chest || null,
      milestone: ms ? Object.assign({ streak }, ms) : null,
      at: new Date().toISOString(),
    };
    addXp(totalXp); addCoins(totalCoin);
    d.questLog.push({
      id: 'checkin', tag: '簽到', xp: totalXp, coin: totalCoin, at: d.checkin.at,
      name: `每日簽到 第 ${sl.day}/7 天（連續 ${streak} 天・第 ${sl.cycle} 輪）`
        + `${slot.item ? '＋' + (shopItem(slot.item) || {}).name : ''}${slot.chest ? '＋金寶箱' : ''}${ms ? '＋里程碑大獎' : ''}`,
    });
    save(true);
    return d.checkin;
  }

  // ---------- 衝刺目標（到某個日期前學會幾個字）----------
  /* 只存「目標」與「期限」，每天要學幾個字是**算出來的**：
     (目標 - 已學會) ÷ 剩下天數。落後了數字自己會變大，不用手動改計畫。 */
  const GOAL_DEFAULT = { on: false, until: null, target: 0, scope: 'all' };
  function goalCfg() {
    const p = load().profile;
    p.goal = Object.assign({}, GOAL_DEFAULT, p.goal || {});
    return p.goal;
  }
  function setGoal(patch) {
    const g = goalCfg();
    Object.assign(g, patch || {});
    if (g.until && g.target > 0) g.on = true;
    save(true);
    return g;
  }
  function clearGoal() { load().profile.goal = Object.assign({}, GOAL_DEFAULT); save(true); }

  /** 目標的即時狀態：還剩幾天、今天該學幾個字、今天學了幾個、有沒有落後。 */
  function goalStat(dstr) {
    const g = goalCfg(), t = dstr || todayStr(), s = load();
    let known = 0, total = 0;
    for (const w of window.VOCAB) {
      if (g.scope !== 'all' && w.lv !== +g.scope) continue;
      total++;
      if (s.words[w.i] && s.words[w.i].b >= 1) known++;
    }
    const target = Math.min(g.target || total, total);
    // 含今天、到期限當天的前一天為止（「8/10 之前」＝做到 8/9）
    const daysLeft = g.until ? Math.max(0, daysBetween(t, g.until)) : null;
    const remain = Math.max(0, target - known);
    const perDay = daysLeft ? Math.ceil(remain / daysLeft) : null;
    const todayNew = summary(t).newCount;
    const planned = g.planned || null;                 // 一開始訂的每日量，用來看有沒有落後
    return {
      on: !!g.on, until: g.until, scope: g.scope,
      target, total, known, remain, daysLeft, perDay, planned,
      todayNew, todayLeft: Math.max(0, (perDay || 0) - todayNew),
      pct: target ? Math.min(1, known / target) : 0,
      done: target > 0 && known >= target,
      behind: !!(planned && perDay && perDay > planned * 1.15),
      impossible: !!(perDay && perDay > 120),           // 每天 120 字以上＝計畫不現實
    };
  }

  // ---------- 難度適配 ----------
  /** 最近幾個學習日的首次作答正確率。 */
  function recentAccuracy(nDays) {
    const s = load();
    const days = Object.keys(s.days).sort().reverse();
    let ok = 0, tot = 0, used = 0;
    for (const dstr of days) {
      const first = (s.days[dstr].log || []).filter(x => x.attempt === 1);
      if (!first.length) continue;
      first.forEach(x => { tot++; if (x.ok) ok++; });
      if (++used >= (nDays || 3)) break;
    }
    return tot >= 10 ? ok / tot : null;      // 資料太少就不下判斷
  }

  /** 依最近表現建議難度：太順就往上推，撐不住就往下調。 */
  function recommendDifficulty() {
    const acc = recentAccuracy(3);
    // 用究極難度的人，建議值就當作「地獄」——建議永遠只在看得到的四檔裡挑
    const cur = Math.min(diffRank(load().profile.settings.difficulty), DIFF_ORDER.length - 1);
    if (acc == null) return 'normal';
    if (acc >= 0.9) return DIFF_ORDER[Math.min(DIFF_ORDER.length - 1, cur + 1)];
    if (acc < 0.65) return DIFF_ORDER[Math.max(0, cur - 1)];
    return DIFF_ORDER[Math.max(0, cur)];
  }

  /** 在「建議難度或更難」的設定下完成關卡 → 拿得到適配加成。 */
  function difficultyFits() {
    return diffRank(load().profile.settings.difficulty) >= diffRank(recommendDifficulty());
  }

  // ---------- 任務系統（每日 / 每週 / 每月）----------
  /* 每個任務都給「目前數字 cur」與「目標 goal」，不只給布林值 —— 這樣畫面上每個任務
     都能畫進度條，而不是只有「未完成／完成」兩種狀態。
     一旦達成（或領過獎）就永久釘住：後面正確率掉下來、又有新字到期，都不會把它變回未完成。 */
  const okOf = (s, k) => (((s.byType || {})[k] || {}).ok || 0);
  const passedRuns = d => (d.runs || []).filter(r => r.passed);
  const bool = v => (v ? 1 : 0);
  const minFmt = (c, g) => `${Math.floor(c / 60)}/${Math.round(g / 60)} 分鐘`;

  const FIXED_QUESTS = [
    { id: 'clear1', name: '通關 1 個字母關', xp: 30, coin: 10, tag: '基本', goal: 1, cur: (s, d) => d.cleared || 0 },
    { id: 'clear3', name: '通關 3 個字母關', xp: 60, coin: 25, tag: '基本', goal: 3, cur: (s, d) => d.cleared || 0 },
    { id: 'new8', name: '學會 8 個新單字', xp: 40, coin: 15, tag: '基本', goal: 8, cur: s => s.newCount },
    { id: 'review', name: '清掉今天所有到期複習', xp: 50, coin: 20, tag: '基本', goal: 1, cur: (s, d) => bool((d.log || []).length >= 5 && dueList().length === 0) },
  ];

  /* 挑戰任務分三類，每天各抽一個 —— 這樣每天一定同時有「拚連擊」「練特定題型」
     「探索／節奏」三種不同玩法，而不會抽到三個都是連擊。 */
  const QUEST_POOL = {
    combo: [
      { id: 'combo10', name: '單關連續答對 10 題', xp: 50, coin: 15, goal: 10, cur: (s, d) => d.bestCombo || 0 },
      { id: 'combo20', name: '單關連續答對 20 題', xp: 90, coin: 30, goal: 20, cur: (s, d) => d.bestCombo || 0 },
      { id: 'acc85', name: '當日正確率 ≥ 85%（至少 10 題）', xp: 60, coin: 20, goal: 85, fmt: (c, g) => `${c}% / ${g}%`, cur: s => { const n = s.reviewTotal + s.applyTotal; return n >= 10 ? Math.round((s.reviewRight + s.applyRight) / n * 100) : 0; } },
      { id: 'flawless', name: '無傷三星通關任何一關', xp: 80, coin: 30, goal: 1, cur: (s, d) => bool(passedRuns(d).some(r => r.stars === 3 && !r.retries)) },
      { id: 'allright', name: '一整關全部答對', xp: 90, coin: 32, goal: 1, cur: (s, d) => bool(passedRuns(d).some(r => r.acc >= 1)) },
      { id: 'fast5', name: '5 題在 8 秒內答對（手速題）', xp: 55, coin: 20, goal: 5, cur: (s, d) => (d.log || []).filter(x => x.ok && x.ms && x.ms <= 8000).length },
      { id: 'fast15', name: '15 題在 8 秒內答對（閃電日）', xp: 95, coin: 35, goal: 15, cur: (s, d) => (d.log || []).filter(x => x.ok && x.ms && x.ms <= 8000).length },
      { id: 'comeback', name: '重來後翻盤通關（不服輸）', xp: 70, coin: 26, goal: 1, cur: (s, d) => bool(passedRuns(d).some(r => (r.retries || 0) > 0)) },
      { id: 'nomiss12', name: '連續 12 題不錯（單關內）', xp: 75, coin: 28, goal: 12, cur: (s, d) => d.bestCombo || 0 },
    ],
    kind: [
      { id: 'spell5', name: '拼字題答對 5 題', xp: 50, coin: 18, goal: 5, cur: s => okOf(s, 'spell') },
      { id: 'spell10', name: '拼字題答對 10 題（拼字日）', xp: 90, coin: 32, goal: 10, cur: s => okOf(s, 'spell') },
      { id: 'form5', name: '詞形變化答對 5 題', xp: 50, coin: 18, goal: 5, cur: s => okOf(s, 'form') },
      { id: 'listen5', name: '聽發音答對 5 題（耳朵日）', xp: 50, coin: 18, goal: 5, cur: s => okOf(s, 'listen') },
      { id: 'confuse4', name: '易混淆字答對 4 題', xp: 55, coin: 20, goal: 4, cur: s => okOf(s, 'confuse') },
      { id: 'cloze4', name: '例句克漏字答對 4 題', xp: 55, coin: 20, goal: 4, cur: s => okOf(s, 'cloze') },
      { id: 'order2', name: '句子重組答對 2 題', xp: 60, coin: 22, goal: 2, cur: s => okOf(s, 'order') },
      { id: 'trans3', name: '中譯英填空答對 3 題', xp: 60, coin: 22, goal: 3, cur: s => okOf(s, 'trans') },
      { id: 'gram3', name: '文法題答對 3 題', xp: 45, coin: 15, goal: 3, cur: s => s.gramRight },
      { id: 'free2', name: '寫 2 句自由造句', xp: 40, coin: 15, goal: 2, cur: s => s.free.length },
      { id: 'apply6', name: '運用題（克漏字／重組／中譯英）答對 6 題', xp: 80, coin: 30, goal: 6, cur: s => s.applyRight },
      { id: 'mix4', name: '四種不同題型各答對 1 題', xp: 65, coin: 24, goal: 4, cur: s => Object.values(s.byType || {}).filter(v => v.ok > 0).length },
    ],
    explore: [
      { id: 'letters3', name: '玩過 3 個不同的字母關', xp: 60, coin: 22, goal: 3, cur: (s, d) => new Set((d.runs || []).filter(r => r.letter).map(r => r.lv + ':' + r.letter)).size },
      { id: 'twolv', name: '在兩個不同級別各通關 1 關', xp: 80, coin: 30, goal: 2, cur: (s, d) => new Set(passedRuns(d).map(r => r.lv)).size },
      { id: 'marathon', name: '今天在關卡裡待滿 15 分鐘', xp: 70, coin: 25, goal: 900, fmt: minFmt, cur: (s, d) => (d.runs || []).reduce((a, r) => a + (r.sec || 0), 0) },
      { id: 'marathon30', name: '今天在關卡裡待滿 30 分鐘', xp: 110, coin: 40, goal: 1800, fmt: minFmt, cur: (s, d) => (d.runs || []).reduce((a, r) => a + (r.sec || 0), 0) },
      { id: 'quickstage', name: '3 分鐘內通關一關（快手）', xp: 65, coin: 24, goal: 1, cur: (s, d) => bool(passedRuns(d).some(r => r.sec && r.sec <= 180)) },
      { id: 'earlybird', name: '中午前完成一關（早鳥）', xp: 60, coin: 22, goal: 1, cur: (s, d) => bool(passedRuns(d).some(r => r.hour != null && r.hour < 12)) },
      { id: 'coin60', name: '今天賺到 60 金幣', xp: 55, coin: 20, goal: 60, cur: (s, d) => d.coin || 0 },
      { id: 'winstreak3', name: '連勝達到 3 關', xp: 85, coin: 32, goal: 3, cur: () => winStreak() },
      { id: 'fixwrong', name: '訂正過答錯的字', xp: 45, coin: 16, goal: 1, cur: (s, d) => bool((d.log || []).some(x => x.attempt > 1)) },
      { id: 'review20', name: '複習題總數達 20 題', xp: 50, coin: 18, goal: 20, cur: s => s.reviewTotal },
      { id: 'chest2', name: '開 2 個寶箱', xp: 60, coin: 22, goal: 2, cur: (s, d) => (d.chests || []).length },
      { id: 'threestage', name: '玩滿 3 關（不論成敗）', xp: 55, coin: 20, goal: 3, cur: (s, d) => (d.runs || []).length },
      { id: 'gem6', name: '收集 6 顆寶石', xp: 65, coin: 24, goal: 6, cur: (s, d) => (d.drops || []).filter(x => /^gem_/.test(x.id)).reduce((a, x) => a + x.n, 0) },
      { id: 'craft1', name: '在背包合成 1 個道具', xp: 60, coin: 22, goal: 1, cur: (s, d) => (d.crafted || 0) },
    ],
  };
  const QUEST_TAG = { combo: '連擊', kind: '題型', explore: '探索' };

  /* 每週／每月任務：獎勵大，時間長，用來撐住「持續學習」而不是單日爆衝。 */
  const WEEK_QUESTS = [
    { id: 'w_new50', name: '本週學會 50 個新單字', xp: 200, coin: 80, goal: 50, cur: p => p.newCount },
    { id: 'w_new100', name: '本週學會 100 個新單字', xp: 320, coin: 130, goal: 100, cur: p => p.newCount },
    { id: 'w_clear10', name: '本週通關 10 個字母關', xp: 250, coin: 100, goal: 10, cur: p => p.cleared },
    { id: 'w_days5', name: '本週學習 5 天', xp: 220, coin: 90, goal: 5, cur: p => p.days },
    { id: 'w_days7', name: '本週天天學習（7 天）', xp: 350, coin: 150, goal: 7, cur: p => p.days },
    { id: 'w_free10', name: '本週寫 10 句自由造句', xp: 180, coin: 70, goal: 10, cur: p => p.free },
    { id: 'w_acc80', name: '本週正確率 ≥ 80%（至少 60 題）', xp: 240, coin: 95, goal: 80, fmt: (c, g) => `${c}% / ${g}%`, cur: p => (p.total >= 60 ? Math.round(p.acc * 100) : 0) },
    { id: 'w_min90', name: '本週累積學習 90 分鐘', xp: 200, coin: 80, goal: 5400, fmt: minFmt, cur: p => p.sec },
    { id: 'w_stars20', name: '本週拿到 20 顆星', xp: 230, coin: 90, goal: 20, cur: p => p.stars },
    { id: 'w_gram15', name: '本週文法題答對 15 題', xp: 210, coin: 85, goal: 15, cur: p => p.gramRight },
    { id: 'w_chest5', name: '本週開 5 個寶箱', xp: 190, coin: 75, goal: 5, cur: p => p.chests },
    { id: 'w_gem30', name: '本週收集 30 顆寶石', xp: 260, coin: 100, goal: 30, cur: p => p.gems },
  ];
  const MONTH_QUESTS = [
    { id: 'm_new200', name: '本月學會 200 個新單字', xp: 700, coin: 280, goal: 200, cur: p => p.newCount },
    { id: 'm_clear40', name: '本月通關 40 個字母關', xp: 800, coin: 320, goal: 40, cur: p => p.cleared },
    { id: 'm_days20', name: '本月學習 20 天', xp: 750, coin: 300, goal: 20, cur: p => p.days },
    { id: 'm_free40', name: '本月寫 40 句自由造句', xp: 650, coin: 260, goal: 40, cur: p => p.free },
    { id: 'm_min600', name: '本月累積學習 10 小時', xp: 800, coin: 320, goal: 36000, fmt: (c, g) => `${(c / 3600).toFixed(1)}/${g / 3600} 小時`, cur: p => p.sec },
    { id: 'm_stars80', name: '本月拿到 80 顆星', xp: 700, coin: 280, goal: 80, cur: p => p.stars },
    { id: 'm_apply100', name: '本月運用題答對 100 題', xp: 750, coin: 300, goal: 100, cur: p => p.applyRight },
  ];

  /** 用日期當種子，讓當天的挑戰任務固定不變（重整頁面不會換一批）。 */
  function seeded(dstr) {
    let h = 2166136261;
    for (let k = 0; k < dstr.length; k++) { h ^= dstr.charCodeAt(k); h = Math.imul(h, 16777619); }
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  }
  /** 從池子裡不重複抽 n 個（種子固定 → 同一天／同一週抽到的一樣）。 */
  function pickN(pool, n, rnd) {
    const p = pool.slice(), out = [];
    for (let k = 0; k < n && p.length; k++) out.push(p.splice(Math.floor(rnd() * p.length), 1)[0]);
    return out;
  }

  /** 週期鍵：週用「該週週一的日期」，月用 YYYY-MM。 */
  function weekKey(dstr) {
    const t = dstr || todayStr();
    const [y, m, d] = t.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));    // 回到週一
    return 'W' + todayStr(dt);
  }
  function monthKey(dstr) { return (dstr || todayStr()).slice(0, 7); }
  function weekDates(dstr) {
    const mon = weekKey(dstr).slice(1);
    return Array.from({ length: 7 }, (_, k) => addDays(mon, k));
  }
  function monthDates(dstr) {
    const s = load(), mk = monthKey(dstr);
    return Object.keys(s.days).filter(d => d.slice(0, 7) === mk);
  }

  /** 一段日期範圍的合計（每週／每月任務用）。 */
  function periodStats(dates) {
    const s = load();
    const o = { newCount: 0, cleared: 0, days: 0, free: 0, stars: 0, sec: 0, gramRight: 0, applyRight: 0, chests: 0, gems: 0, right: 0, total: 0, xp: 0, runs: 0 };
    dates.forEach(t => {
      const d = s.days[t];
      if (!d) return;
      const sum = summary(t);
      if ((d.log || []).length) o.days++;
      o.newCount += sum.newCount;
      o.cleared += d.cleared || 0;
      o.free += sum.free.length;
      o.stars += sum.stars;
      o.gramRight += sum.gramRight;
      o.applyRight += sum.applyRight;
      o.chests += (d.chests || []).length;
      o.gems += (d.drops || []).filter(x => /^gem_/.test(x.id)).reduce((a, x) => a + x.n, 0);
      o.sec += (d.runs || []).reduce((a, r) => a + (r.sec || 0), 0);
      o.runs += (d.runs || []).length;
      o.xp += sum.xp;
      o.right += sum.reviewRight + sum.applyRight;
      o.total += sum.reviewTotal + sum.applyTotal;
    });
    o.acc = o.total ? o.right / o.total : 0;
    return o;
  }

  /** 今日主打關：抽一個字母關，通關給大獎。給每天一個「今天要去哪」的目標。 */
  function specialQuest(dstr) {
    const t = dstr || todayStr(), rnd = seeded('S' + t), lv = startLevel();
    const pool = LETTERS.filter(L => bucket(lv, L).length);
    if (!pool.length) return null;
    const L = pool[Math.floor(rnd() * pool.length)];
    return {
      id: `special:${lv}${L}`, tag: '主打', xp: 120, coin: 45, goal: 1,
      name: `今日主打關：第 ${lv} 級 ・ ${L} 關通關`,
      lv, letter: L,
      cur: (s, d) => bool(passedRuns(d).some(r => r.lv === lv && r.letter === L)),
    };
  }

  /* 挑戰任務「領完就換下一個」：
     每個類別（連擊／題型／探索）有一份當天固定的洗牌順序，
     已經領過幾個，就往後推幾個 —— 所以看板上不會一直掛著已經做完的任務。
     固定任務與今日主打關不換（那是當天的骨幹），完成的會被收到看板下方。 */
  function questList(dstr) {
    const t = dstr || todayStr(), rnd = seeded(t);
    const claimed = day(t).quests || {};
    const picked = ['combo', 'kind', 'explore'].map(cat => {
      const pool = QUEST_POOL[cat];
      const order = pickN(pool, pool.length, rnd);          // 同一天的順序固定
      const doneN = order.filter(q => claimed[q.id]).length;
      const cur = order[Math.min(doneN, order.length - 1)];
      return Object.assign({ tag: QUEST_TAG[cat] }, cur);
    });
    const sp = specialQuest(t);
    // 有訂衝刺目標的話，「今天的配額」本身就是一個任務（獎勵比一般任務高）
    const gs = goalStat(t);
    const goalQuest = gs.on && gs.perDay ? [{
      id: 'goalday', tag: '目標', xp: 100, coin: 40, goal: gs.perDay,
      name: `達成今日目標：學會 ${gs.perDay} 個新單字`,
      cur: s => s.newCount,
    }] : [];
    return FIXED_QUESTS.concat(goalQuest, picked, sp ? [sp] : []);
  }
  /** 本週任務（抽 4 個）／本月任務（抽 3 個）。 */
  function weekQuestList(dstr) {
    return pickN(WEEK_QUESTS, 4, seeded(weekKey(dstr))).map(q => Object.assign({ tag: '每週', period: 'week' }, q));
  }
  function monthQuestList(dstr) {
    return pickN(MONTH_QUESTS, 3, seeded(monthKey(dstr))).map(q => Object.assign({ tag: '每月', period: 'month' }, q));
  }

  /** 週期任務的領獎紀錄放在 profile，不放在某一天。 */
  function periodClaims(key) {
    const p = load().profile;
    p.periodQuests = p.periodQuests || {};
    return (p.periodQuests[key] = p.periodQuests[key] || {});
  }

  /** 把一個任務定義算成畫面用的狀態。達成過就永久釘住（done / doneAt 存在 day 或 profile）。 */
  function questView(q, cur, claimed, doneMark) {
    const goal = q.goal || 1;
    const reached = cur >= goal;
    const done = !!doneMark || claimed || reached;
    return {
      id: q.id, name: q.name, xp: q.xp, coin: q.coin || 0, tag: q.tag || '',
      lv: q.lv, letter: q.letter, period: q.period || 'day',
      goal, cur: done ? Math.max(cur, goal) : cur,
      note: q.fmt ? q.fmt(done ? Math.max(cur, goal) : cur, goal) : `${Math.min(done ? goal : cur, goal)}/${goal}`,
      done, claimed,
      at: doneMark && doneMark.at ? doneMark.at : null,
    };
  }

  /** 目前每日任務狀態（含進度、是否已領獎、達成時間）。 */
  function questStatus(dstr) {
    const t = dstr || todayStr();
    const d = day(t), s = summary(t);
    d.quests = d.quests || {};
    d.questDone = d.questDone || {};
    return questList(t).map(q => {
      const cur = q.cur(s, d);
      if (cur >= (q.goal || 1) && !d.questDone[q.id]) {
        d.questDone[q.id] = { at: new Date().toISOString() };    // 達成的瞬間就釘住，之後條件變了也不會退回去
        save();
      }
      return questView(q, cur, !!d.quests[q.id], d.questDone[q.id]);
    });
  }

  /** 每週／每月任務狀態。period = 'week' | 'month'。 */
  function periodQuestStatus(period, dstr) {
    const isWeek = period === 'week';
    const key = isWeek ? weekKey(dstr) : monthKey(dstr);
    const list = isWeek ? weekQuestList(dstr) : monthQuestList(dstr);
    const st = periodStats(isWeek ? weekDates(dstr) : monthDates(dstr));
    const claims = periodClaims(key);
    const p = load().profile;
    p.periodDone = p.periodDone || {};
    const doneMap = (p.periodDone[key] = p.periodDone[key] || {});
    return list.map(q => {
      const cur = q.cur(st);
      if (cur >= (q.goal || 1) && !doneMap[q.id]) { doneMap[q.id] = { at: new Date().toISOString() }; save(); }
      return Object.assign(questView(q, cur, !!claims[q.id], doneMap[q.id]), { periodKey: key });
    });
  }

  /** 發放剛完成、還沒領的任務獎勵（每日＋每週＋每月），並寫進任務完成紀錄。 */
  function awardQuests(dstr) {
    const t = dstr || todayStr(), d = day(t);
    d.quests = d.quests || {};
    const got = [];
    const give = (q, markClaimed) => {
      markClaimed();
      addXp(q.xp); addCoins(q.coin || 0);
      const row = { id: q.id, name: q.name, tag: q.tag || '', period: q.period || 'day', xp: q.xp, coin: q.coin || 0, at: new Date().toISOString() };
      d.questLog.push(row);
      got.push(Object.assign({}, q, { at: row.at }));
    };
    /* 領完一個挑戰任務會馬上換上下一個；如果下一個剛好也已經達成（例如連擊 10 與 20
       同時滿足），就繼續發下去。最多跑 4 輪，避免任何意外的無限迴圈。 */
    for (let round = 0; round < 4; round++) {
      const pend = questStatus(t).filter(q => q.done && !q.claimed);
      if (!pend.length) break;
      pend.forEach(q => give(q, () => { d.quests[q.id] = true; }));
    }
    ['week', 'month'].forEach(period => {
      periodQuestStatus(period, t).forEach(q => {
        if (q.done && !q.claimed) give(q, () => { periodClaims(q.periodKey)[q.id] = true; });
      });
    });
    if (got.length) save(true);
    return got;
  }

  /** 任務完成紀錄（預設今天，最新在前）；帶 all 就回傳全部歷史。 */
  function questLog(dstr) {
    const s = load();
    if (dstr === 'all') {
      const out = [];
      Object.keys(s.days).sort().reverse().forEach(t => (s.days[t].questLog || []).slice().reverse().forEach(x => out.push(Object.assign({ date: t }, x))));
      return out;
    }
    const t = dstr || todayStr();
    return (day(t).questLog || []).slice().reverse().map(x => Object.assign({ date: t }, x));
  }

  function noteDayCombo(c) {
    const d = day();
    if (c > (d.bestCombo || 0)) { d.bestCombo = c; save(); }
  }

  // ---------- today's summary (成績單用) ----------
  function summary(dstr) {
    const t = dstr || todayStr(), s = load(), d = s.days[t];
    const empty = {
      date: t, newCount: 0, newIds: [], reviewTotal: 0, reviewRight: 0, reviewWrong: 0,
      applyTotal: 0, applyRight: 0, gramTotal: 0, gramRight: 0,
      sweepTotal: 0, sweepRight: 0, sweepKnown: 0, sweepLearn: 0,
      wrongWords: [], byType: {}, free: [], retries: 0, stars: 0, xp: 0, minutes: 0,
    };
    if (!d) return empty;
    const first = (d.log || []).filter(x => x.attempt === 1);
    const APPLY = new Set(['cloze', 'order', 'trans']);
    const o = Object.assign({}, empty, {
      newIds: d.newIds || [], newCount: (d.newIds || []).length,
      free: d.free || [], xp: d.xp || 0,
      sweepKnown: (d.sweepKnown || []).length, sweepLearn: (d.sweepLearn || []).length,
    });
    const wrongSet = new Map();
    first.forEach(x => {
      const isApply = APPLY.has(x.t);
      // 快速篩選的抽考另外統計，不混進「今天複習的單字」
      if (x.t === 'sweep') { o.sweepTotal++; if (x.ok) o.sweepRight++; return; }
      if (isApply) { o.applyTotal++; if (x.ok) o.applyRight++; }
      else { o.reviewTotal++; if (x.ok) o.reviewRight++; else o.reviewWrong++; }
      const bt = o.byType[x.t] = o.byType[x.t] || { n: 0, ok: 0 };
      bt.n++; if (x.ok) bt.ok++;
      if (!x.ok && x.i != null) wrongSet.set(x.i, (wrongSet.get(x.i) || 0) + 1);
    });
    (d.gram || []).filter(g => g.attempt === 1).forEach(g => { o.gramTotal++; if (g.ok) o.gramRight++; });
    o.wrongWords = [...wrongSet.keys()];
    o.retries = Object.values(d.stages || {}).reduce((a, x) => a + (x.retries || 0), 0);
    o.stars = Object.values(d.stages || {}).reduce((a, x) => a + (x.stars || 0), 0);
    const ms = (d.log || []).reduce((a, x) => a + (x.ms || 0), 0);
    o.minutes = Math.round(ms / 60000);
    return o;
  }

  function history(n) {
    const s = load();
    return Object.keys(s.days).sort().slice(-(n || 30)).map(d => summary(d));
  }

  function reset() { localStorage.removeItem(KEY); S = null; }

  /* 誤觸修正：把某個字「最近一次答錯」整個當成沒發生過，改判成答對。

     為什麼要有這個：手指滑到、或上一題的第二下點擊落在新題目上，
     那個字會被判錯 → box 直接掉回 0、當天重練、首次正確率被拉低、還會被排進複習。
     那不是「不會」，是「按錯」，讓它留在紀錄裡只會讓數字說謊、讓複習排程去追一個假的弱點。

     三個地方要一起改，少改一個就會前後不一致：
       1. 作答紀錄（days[].log）—— 成績單與正確率都是從這裡算的
       2. 單字的統計（words[i] 的答對／答錯／首次正確）
       3. 排程（box 與下次複習日）—— 照「答對」重算，才不會明天又被抓出來
     只改最近一次，而且找不到就回 null（不會憑空生出一筆答對）。 */
  function fixMisclick(i) {
    const s = load();
    const days = Object.keys(s.days).sort().reverse();
    for (const t of days) {
      const log = s.days[t].log || [];
      for (let k = log.length - 1; k >= 0; k--) {
        const row = log[k];
        if (row.i !== i || row.ok !== false) continue;
        row.ok = true;
        row.fixed = true;                       // 標記這一筆是修正過的（避免重複修同一筆）
        const r = rec(i);
        r.wr = Math.max(0, (r.wr || 0) - 1);
        r.r = (r.r || 0) + 1;
        if (row.attempt === 1) r.fr = Math.min(r.fs || 0, (r.fr || 0) + 1);
        // 照「答對」重新排程：box 往上推一級，下次複習日跟著走
        r.b = Math.min(MAX_BOX, (r.b || 0) + 1);
        r.due = addDays(todayStr(), BOX_DAYS[r.b] || 1);
        r.lw = 0;
        delete r.lwd;
        save(true);
        return { date: t, attempt: row.attempt, box: r.b, due: r.due };
      }
    }
    return null;
  }

  /** 最近答錯的字（誤觸修正用的清單）。 */
  function recentWrong(n) {
    return answerLog({ only: 'wrong', limit: n || 12 }).rows.filter(x => x.cat === 'word' && x.i != null);
  }

  // ---------- 跨裝置同步 ----------
  /* 同步碼＝密碼。去掉 0O1lI 這些看起來像的字，因為這組碼要在手機上手打。 */
  const SYNC_ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
  const SYNC_RE = /^[2-9a-hjkm-np-z]{4}-[2-9a-hjkm-np-z]{4}-[2-9a-hjkm-np-z]{4}$/;
  function newSyncCode() {
    let out = '';
    for (let i = 0; i < 12; i++) {
      out += SYNC_ALPHA[Math.floor(Math.random() * SYNC_ALPHA.length)];
      if (i % 4 === 3 && i < 11) out += '-';
    }
    return out;
  }
  function syncCode() { return load().profile.settings.syncCode || ''; }
  function setSyncCode(c) {
    const v = String(c || '').trim().toLowerCase();
    load().profile.settings.syncCode = v;
    save(true);
    return v;
  }
  function syncAt(t) {
    const c = load().profile.settings;
    if (t !== undefined) { c.syncAt = t; save(true); }
    return c.syncAt || '';
  }

  /* 把雲端那一份合併進來。原則只有一條：**永遠取比較有進度的那一邊，絕不因為同步而倒退。**

     為什麼不是「後寫入的贏」：兩台裝置都在學的時候，後同步的那台會把另一台的進度整包蓋掉——
     那是最容易發生、也最傷的資料遺失，而且發生的當下完全沒有感覺。
     取大值雖然理論上會讓「同一天在兩台各學 5 個字」算成 5 個而不是 10 個，
     但那是少算，不是弄丟；反過來的錯誤是把整天的努力清掉。

     設定（難度、按鍵、題數、外掛開關、同步碼本身）一律不合併：
     那是「這台裝置怎麼玩」，不是進度。手機想用輕鬆模式，不該把電腦的地獄模式改掉。 */
  function mergeRemote(remote) {
    if (!remote || typeof remote !== 'object' || !remote.profile) return null;
    const s = load(), p = s.profile, rp = remote.profile;
    const out = { words: 0, days: 0, map: 0, badges: 0, xpBefore: p.xp || 0 };
    const maxOf = (a, b) => Math.max(a || 0, b || 0);

    ['xp', 'coins', 'streak', 'bestStreak', 'winStreak', 'bestWinStreak', 'bestCombo', 'rewardedLevel', 'chestSeq']
      .forEach(k => { p[k] = maxOf(p[k], rp[k]); });
    ['everPerfect', 'starterGiven', 'makeupOptIn', 'placed'].forEach(k => { p[k] = !!(p[k] || rp[k]); });

    const got = new Set(p.badges || []);
    (rp.badges || []).forEach(b => { if (!got.has(b)) { got.add(b); out.badges++; } });
    p.badges = [...got];

    // 道具與素材：每一項各自取多的那邊（相加會讓每同步一次就多一份）
    ['inventory', 'materials'].forEach(k => {
      const mine = p[k] = p[k] || {}, theirs = rp[k] || {};
      for (const id in theirs) mine[id] = maxOf(mine[id], theirs[id]);
    });
    // 沒開的寶箱是一個個獨立的箱子，合併會憑空生出箱子 —— 取比較多的那一份就好
    if ((rp.chestBag || []).length > (p.chestBag || []).length) p.chestBag = rp.chestBag;

    // 熟練度：box 高的贏；一樣高就取複習日排得比較晚的（代表比較新）；作答次數取大值
    const rw = remote.words || {};
    for (const i in rw) {
      const theirs = rw[i], mine = s.words[i];
      if (!mine) { s.words[i] = theirs; out.words++; continue; }
      const better = (theirs.b || 0) > (mine.b || 0)
        || ((theirs.b || 0) === (mine.b || 0) && String(theirs.due || '') > String(mine.due || ''));
      const merged = better ? Object.assign({}, mine, theirs) : Object.assign({}, theirs, mine);
      ['s', 'r', 'wr', 'fr', 'fs'].forEach(k => { merged[k] = maxOf(mine[k], theirs[k]); });
      if (better) out.words++;
      s.words[i] = merged;
    }

    /* 每日紀錄：同一天以「題數比較多」的那一份為準。
       不把兩邊的 log 接起來，是因為同一題會被算兩次 —— 正確率、任務進度全部會被灌水。 */
    const rd = remote.days || {};
    for (const t in rd) {
      const mine = s.days[t];
      if (!mine) { s.days[t] = rd[t]; out.days++; continue; }
      if ((rd[t].log || []).length > (mine.log || []).length) { s.days[t] = rd[t]; out.days++; }
    }

    // 闖關地圖：通關過就是通關過，星數取高的
    const rm = remote.map || {};
    s.map = s.map || {};
    for (const k in rm) {
      const mine = s.map[k] || {}, theirs = rm[k] || {};
      const next = {
        cleared: !!(mine.cleared || theirs.cleared),
        stars: maxOf(mine.stars, theirs.stars),
        tries: maxOf(mine.tries, theirs.tries),
        best: Math.max(mine.best || 0, theirs.best || 0),
        combo: maxOf(mine.combo, theirs.combo),
      };
      if (next.stars > (mine.stars || 0) || (next.cleared && !mine.cleared)) out.map++;
      s.map[k] = next;
    }

    out.xpAfter = p.xp || 0;
    save(true);
    return out;
  }

  /** 把一個字母關整個恢復成「從來沒學過」。
     刪掉的是這些字的排程紀錄（box／到期日／自評已會）與這一關的通關紀錄，
     所以：進度歸零、星星消失、下次進來會重新出學習卡、也會重新出現在快速篩選清單裡。
     **不動**作答歷史（每日紀錄、成績單、金幣、XP、徽章）—— 以前考過什麼還是查得到。 */
  function resetStage(lv, letter) {
    const s = load(), ids = bucket(lv, letter), key = lv + ':' + letter;
    let n = 0;
    ids.forEach(i => { if (s.words[i]) { delete s.words[i]; n++; } });
    const had = !!(s.map && s.map[key]);
    if (had) delete s.map[key];
    save(true);
    return { lv, letter, words: n, total: ids.length, hadRecord: had };
  }

  window.Store = {
    load, save, todayStr, addDays, daysBetween,
    rec, isKnown, isSeen, answer, errWeight, wrongPool, leeches,
    applyPlacement, startLevel, dueList, newList, verifySample,
    markKnown, markToLearn, needsCard, sweepPool, sweepStat, applySweep,
    day, logAnswer, logGrammar, logFree, markNew, finishStage,
    startRun, endRun, findRun, runLog, runSeconds,
    answerLog, logTotals, progress,
    levelReward, claimLevelUps, levelTitles,
    addXp, xpLevel, xpInLevel, XP_PER_LEVEL, touchStreak,
    BADGES, BADGE_TIER, badgeProgress, BOX_DAYS, stats, checkBadges, noteCombo, notePerfect,
    summary, history, reset, resetStage,
    SYNC_RE, newSyncCode, syncCode, setSyncCode, syncAt, mergeRemote,
    fixMisclick, recentWrong,
    DIFFICULTY, DIFF_ORDER, diff, setDifficulty,
    SECRET_DIFFS, diffList, diffRank, diffForced, secretDiff, setSecretDiff,
    CHEAT_KEYS, CHEAT_NAMES, cheats, cheat, setCheat, cheating,
    ALL_KINDS, KIND_NAMES, offKinds, kindOn, toggleKind,
    KEY_ACTS, KEY_DEFAULTS, keys, keyOf, setKey, resetKeys,
    goalCfg, setGoal, clearGoal, goalStat,
    checkIn, checkinPreview, checkinSlot, CHECKIN_TRACK, CHECKIN_MILESTONE,
    recentAccuracy, recommendDifficulty, difficultyFits,
    RARITY, xpMult, comboMult, coinMult, checkinMult, chestBoost,
    questList, questStatus, awardQuests, questLog, specialQuest, noteDayCombo,
    weekKey, monthKey, weekDates, monthDates, periodStats, periodQuestStatus,
    weekQuestList, monthQuestList,
    LETTERS, PASS_ACC, bucket, mapStat, levelStat, nextStage, recordStage, autoClear,
    winStreak, bestWinStreak, winStreakBonus,
    SHOP, shopItem, coins, addCoins, inventory, owned, buy, consume, equip, equipped, stageCoins,
    STARTER, grantStarter, MAKEUP, grantMakeup,
    UNIQUE_KINDS, isUnique,
    CHEST, CHEST_ORDER, CHEST_RULES, LOOT, chestTier, upgradeChest, openChest, chestLog, rollOne,
    chestBag, addChest, takeChest, openStored, openAllStored, chestBagSummary,
    MATERIALS, MAT_ORDER, material, mats, matCount, addMat, useMats,
    matDrop, grantMats, dropLog, gemsToday, RECIPES, canCraft, craft, useKey,
    dealsToday, dealFor, priceOf,
    setPrice, clearPrices, setDeals, setBadge, setQuestDone, resetCheckin,
    get settings() { return load().profile.settings; },
    get profile() { return load().profile; },
  };
})();
