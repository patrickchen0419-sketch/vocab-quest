/* UI 煙霧測試：用一個極簡 DOM 模擬層真正跑過每個畫面與一整場闖關。
   用法：node src/test-ui.js
   涵蓋範圍：畫面渲染不拋錯、事件委派接得到、闖關流程（含 GAME OVER 與重來）、
             成績單數字與家長回報文字。不涵蓋：實際版面外觀、動畫、真實語音。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// ================= 極簡 DOM =================
const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'source']);

class El {
  constructor(tag) {
    this.tag = String(tag).toLowerCase();
    this.attrs = {}; this.children = []; this.parent = null;
    this._text = ''; this.value = ''; this.disabled = false;
    this.style = {};
    // dataset 必須雙向連動屬性：app.js 會用 el.dataset.back = x，而選擇器查的是 [data-back]
    const attrs = this.attrs;
    const dashed = k => 'data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    this.dataset = new Proxy({}, {
      get: (_, k) => attrs[dashed(k)],
      set: (_, k, v) => { attrs[dashed(k)] = String(v); return true; },
      has: (_, k) => dashed(k) in attrs,
      ownKeys: () => Object.keys(attrs).filter(a => a.startsWith('data-'))
        .map(a => a.slice(5).replace(/-([a-z])/g, (s, c) => c.toUpperCase())),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
  }
  get id() { return this.attrs.id || ''; }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; }
  get classList() {
    const self = this;
    const list = () => (self.attrs.class || '').split(/\s+/).filter(Boolean);
    return {
      add(...c) { const s = new Set(list()); c.forEach(x => s.add(x)); self.attrs.class = [...s].join(' '); },
      remove(...c) { const s = new Set(list()); c.forEach(x => s.delete(x)); self.attrs.class = [...s].join(' '); },
      contains(c) { return list().includes(c); },
    };
  }
  get textContent() {
    if (this.children.length) return this.children.map(c => (c instanceof El ? c.textContent : c)).join('');
    return this._text;
  }
  set textContent(v) { this.children = []; this._text = String(v); }
  set innerHTML(html) { this.children = parseInto(this, String(html)); }
  get innerHTML() { return serialize(this); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  addEventListener(t, fn) { (this._ev = this._ev || {})[t] = (this._ev[t] || []).concat(fn); }
  focus() { doc.activeElement = this; }
  select() { }
  closest(sel) { let n = this; while (n) { if (n instanceof El && matches(n, sel)) return n; n = n.parent; } return null; }
  querySelector(sel) { return query(this, sel)[0] || null; }
  querySelectorAll(sel) { return query(this, sel); }
}

function serialize(el) {
  return el.children.map(c => c instanceof El
    ? `<${c.tag}${Object.entries(c.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${serialize(c)}</${c.tag}>`
    : c).join('');
}

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*"|='[^']*'|[^\s>]*)?)*)\s*\/?>/g;
function parseInto(parent, html) {
  const stack = [parent];
  parent.children = [];
  let last = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))) {
    const text = html.slice(last, m.index);
    if (text.trim()) stack[stack.length - 1].children.push(text);
    last = m.index + m[0].length;
    const tag = m[1].toLowerCase(), closing = m[0][1] === '/';
    if (closing) { if (stack.length > 1 && stack[stack.length - 1].tag === tag) stack.pop(); continue; }
    const el = new El(tag);
    for (const a of m[2].matchAll(/([a-zA-Z-]+)(?:="([^"]*)"|='([^']*)')?/g)) {
      const name = a[1].toLowerCase(), val = a[2] != null ? a[2] : (a[3] != null ? a[3] : '');
      el.attrs[name] = val;
      if (name.startsWith('data-')) el.dataset[name.slice(5).replace(/-([a-z])/g, (s, c) => c.toUpperCase())] = val;
      if (name === 'disabled') el.disabled = true;
      if (name === 'value') el.value = val;
    }
    const p = stack[stack.length - 1];
    el.parent = p; p.children.push(el);
    if (!VOID.has(tag) && !m[0].endsWith('/>')) stack.push(el);
  }
  const tail = html.slice(last);
  if (tail.trim()) stack[stack.length - 1].children.push(tail);
  return parent.children;
}

/* 選擇器：支援 #id / .class / tag / [attr] / [attr="v"] / 後代組合 / 逗號並列 */
function matchSimple(el, s) {
  const parts = s.match(/(^[a-zA-Z][a-zA-Z0-9]*)|(#[^.#\[\s]+)|(\.[^.#\[\s]+)|(\[[^\]]+\])/g) || [];
  for (const p of parts) {
    if (p[0] === '#') { if (el.attrs.id !== p.slice(1)) return false; }
    else if (p[0] === '.') { if (!el.classList.contains(p.slice(1))) return false; }
    else if (p[0] === '[') {
      const mm = p.slice(1, -1).match(/^([a-zA-Z-]+)(?:=["']?([^"'\]]*)["']?)?$/);
      if (!mm) return false;
      const v = el.attrs[mm[1]];
      if (v === undefined) return false;
      if (mm[2] !== undefined && String(v) !== mm[2]) return false;
    } else if (el.tag !== p.toLowerCase()) return false;
  }
  return parts.length > 0;
}
function matches(el, sel) {
  return sel.split(',').some(one => {
    const chain = one.trim().split(/\s+/);
    if (!matchSimple(el, chain[chain.length - 1])) return false;
    let n = el.parent;
    for (let k = chain.length - 2; k >= 0; k--) {
      while (n && !matchSimple(n, chain[k])) n = n.parent;
      if (!n) return false;
      n = n.parent;
    }
    return true;
  });
}
function walk(el, out) { for (const c of el.children) if (c instanceof El) { out.push(c); walk(c, out); } return out; }
function query(rootEl, sel) { return walk(rootEl, []).filter(e => matches(e, sel)); }

const doc = {
  body: new El('body'),
  activeElement: null,
  _ev: {},
  createElement: t => new El(t),
  querySelector: s => query(doc.body, s)[0] || null,
  querySelectorAll: s => query(doc.body, s),
  addEventListener(t, fn) { (doc._ev[t] = doc._ev[t] || []).push(fn); },
  readyState: 'complete',
  set innerHTML(v) { doc.body.innerHTML = v; },
};
Object.defineProperty(doc.body, 'ownerDocument', { value: doc });

// ================= 全域環境 =================
const ls = {};
global.localStorage = {
  getItem: k => (k in ls ? ls[k] : null),
  setItem: (k, v) => { ls[k] = String(v); },
  removeItem: k => { delete ls[k]; },
};
global.window = global;
global.document = doc;
global.navigator = { clipboard: { writeText: async () => { throw new Error('no clipboard in test'); } } };
global.Blob = class { constructor(p) { this.parts = p; } };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => { } };
// app.js 用短 setTimeout 串接「答完 → 下一題」與 GAME OVER。測試是同步跑的，
// 所以把短計時器改成立即執行；長的（toast 消失之類）直接忽略。
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => {
  if (typeof fn === 'function' && (ms || 0) <= 800) { fn(); return 0; }
  return 0;
};
global.setInterval = () => 0;          // 倒數計時在測試裡不自動跑
global.clearInterval = () => { };
global.speechSynthesis = null;
global.AudioContext = null;
global.print = () => { printed++; };
let printed = 0;
const downloads = [];
global.__downloads = downloads;

for (const f of ['data/words.js', 'data/grammar.js', 'data/sentences.js',
  'src/store.js', 'src/quiz.js', 'src/app.js']) {
  new Function(fs.readFileSync(path.join(root, f), 'utf8')).call(global);
}
const S = window.Store, Q = window.Quiz, V = window.VOCAB;

// 攔截下載（app.js 用 a.click() 觸發）
const realCreate = doc.createElement;
doc.createElement = function (t) {
  const el = realCreate(t);
  if (t === 'a') el.click = function () { downloads.push({ name: this.download, href: this.href }); };
  if (t === 'input') el.click = function () { };
  return el;
};

// ================= 測試工具 =================
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + (e && e.message)); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
/** 回首頁：已經在首頁時首頁鈕本來就不存在，所以要容許沒有按鈕。 */
function goHome() {
  if (has('任務看板')) return;                       // 已經在首頁
  let guard = 0;
  while (doc.querySelector('[data-act="back"]') && guard++ < 6) click('[data-act="back"]');
  if (!has('任務看板')) (doc._ev.click || []).forEach(fn => fn({
    type: 'click', preventDefault() { },
    target: { closest: sel => (sel === '[data-go]' ? { dataset: { go: 'home' } } : null) },
  }));
}
/** 派送事件並「冒泡」：先跑元素自己與祖先的監聽器，最後才是 document 層的委派。
    覆蓋層（GAME OVER、確認視窗）的按鈕靠的是元素層監聽器，少了冒泡就等於沒點到。 */
function fire(type, el) {
  const ev = { type, target: el, key: el && el.key, preventDefault() { }, ctrlKey: false };
  let n = el;
  while (n) {
    if (n._ev && n._ev[type]) n._ev[type].forEach(fn => fn.call(n, ev));
    n = n.parent;
  }
  (doc._ev[type] || []).forEach(fn => fn(ev));
}
function click(sel) {
  const el = doc.querySelector(sel);
  assert(el, `找不到可點擊的元素：${sel}`);
  fire('click', el);
  return el;
}
function has(text) { return doc.body.innerHTML.includes(text); }
function txt() { return doc.body.innerHTML; }
function press(key) { (doc._ev.keydown || []).forEach(fn => fn({ key, target: doc.body, preventDefault() { }, ctrlKey: false })); }

/** 目前題目（透過 app.js 的測試接縫取得）。 */
function curQ() {
  const r = window.__run && window.__run();
  return r && r.qs ? r.qs[r.idx] : null;
}

/** 一路作答走完目前這一關。correct=true 時一律答對。 */
function walkStage(opts_) {
  const o = opts_ || {};
  const correct = o.correct !== false;
  const seen = { order: 0, free: 0, gram: 0, card: 0, typed: 0, mc: 0 };
  let guard = 0;
  while (guard++ < (o.maxSteps || 200)) {
    if (has('★') || has('☆')) return { end: 'cleared', seen };
    if (has('GAME OVER')) return { end: 'dead', seen };
    const card = doc.querySelector('[data-act="nextCard"]');
    if (card) { seen.card++; fire('click', card); continue; }
    const q = curQ();
    const opts = doc.querySelectorAll('.opt');
    const tiles = doc.querySelectorAll('[data-tile]');
    const inp = doc.querySelector('#ans');
    const submit = doc.querySelector('[data-act="submit"]');
    if (q && (q.kind === 'gmc' || q.kind === 'gfix')) seen.gram++;
    if (q && q.kind === 'order') seen.order++;
    if (q && q.kind === 'free') seen.free++;

    if (opts.length) {
      seen.mc++;
      const idx = correct && q ? q.a : (q && q.a === 0 ? 1 : 0);
      fire('click', opts[idx]);
    } else if (tiles.length && submit) {
      if (correct && q) {
        // 依正解順序點詞塊
        const want = q.answer.split(/\s+/);
        const pool = [...tiles];
        for (const wtok of want) {
          const hit = pool.find(tl => !tl.classList.contains('used') && tl.textContent === wtok);
          if (hit) fire('click', hit);
        }
      } else tiles.forEach(tl => fire('click', tl));
      fire('click', submit);
    } else if (inp && submit) {
      seen.typed++;
      if (q && q.kind === 'free') inp.value = 'I decided to issue a new plan today.';
      else if (correct && q) inp.value = q.answer || (q.accept && q.accept[0]) || 'x';
      else inp.value = '###wrong###';
      fire('click', submit);
    } else return { end: 'stuck: ' + txt().slice(0, 180), seen };

    const nx = doc.querySelector('[data-act="next"]');
    if (nx) fire('click', nx);
  }
  return { end: 'timeout', seen };
}

// ================= 測試 =================
console.log('\n--- 啟動 ---');
t('第一次開啟直接進闖關地圖，沒有初次測驗', () => {
  assert(!has('定位測驗'), '不該還有定位測驗');
  assert(has('闖關地圖'), '沒看到闖關地圖：' + txt().slice(0, 200));
  assert(has('第 1 級大關') && has('第 6 級大關'), '六個大關沒列出來');
  assert(doc.querySelectorAll('[data-maplv]').length === 6, '大關入口數不對');
});

t('首頁不顯示「首頁」按鈕', () => {
  assert(!doc.querySelector('[data-go="home"]'), '首頁不該有回首頁按鈕');
});

t('首頁沒有每日配額的選擇（新字數／造句數）', () => {
  assert(!has('每日新字'), '還有每日新字設定');
  assert(!has('造句／文法題數'), '還有造句題數設定');
  assert(!doc.querySelector('[data-set="newPerDay"]'), '還有新字量滑桿');
});

console.log('\n--- 闖關地圖 ---');
t('點大關進入 A–Z 小關，字數與可玩狀態正確', () => {
  click('[data-maplv="3"]');
  assert(has('第 3 級'), '沒進入第 3 級：' + txt().slice(0, 150));
  const tiles = doc.querySelectorAll('[data-mapletter]');
  assert(tiles.length >= 20, `可玩字母關只有 ${tiles.length} 個`);
  assert(!doc.querySelector('[data-mapletter="3:X"]'), 'X 開頭沒有字，不該可點');
  assert(doc.querySelector('.phead [data-act="back"]'), '返回鈕沒有貼在標題旁');
});

t('進字母關後可以選這次要練幾個字', () => {
  click('[data-mapletter="3:B"]');
  assert(has('這一次要練幾個字'), '沒有選字數畫面：' + txt().slice(0, 200));
  const choices = doc.querySelectorAll('[data-startstage]');
  assert(choices.length >= 3, `選項太少：${choices.length}`);
  assert(doc.querySelector('[data-startstage="3:B:10"]'), '沒有 10 字選項');
  assert(has('全部'), '沒有全部字數的選項');
});

t('選好字數後開始；有沒學過的字會先出學習卡', () => {
  click('[data-startstage="3:B:5"]');
  const learning = has('先認識新單字');
  assert(learning || has('第 3 級'), '沒進入關卡：' + txt().slice(0, 200));
  if (learning) {
    assert(doc.querySelector('.study'), '沒有學習卡版面');
    let guard = 0;
    while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  }
  assert(doc.querySelector('.opt') || doc.querySelector('#ans'), '沒開始出題：' + txt().slice(0, 200));
});

t('關卡進行中沒有任何返回鈕，只有右上角齒輪', () => {
  assert(!doc.querySelector('[data-go="home"]'), '進行中不該有首頁鈕');
  assert(!doc.querySelector('[data-act="back"]'), '進行中不該有返回鈕');
  assert(doc.querySelector('[data-act="gear"]'), '沒有右上角齒輪');
});

t('齒輪＝暫停，裡面才有離開（放棄）', () => {
  click('[data-act="gear"]');
  assert(has('已暫停'), '沒暫停：' + txt().slice(0, 150));
  assert(has('離開（放棄這一關）'), '齒輪選單裡沒有離開');
  click('[data-close="resume"]');
  assert(!has('已暫停'), '沒有恢復');
});

t('全部答對 → 通關，並給 XP 與金幣', () => {
  const coinsBefore = S.coins();
  const r = walkStage({ correct: true });
  assert(r.end === 'cleared', '沒通關：' + r.end);
  assert(has('通關！'), '沒顯示通關：' + txt().slice(0, 250));
  assert(has('XP') && has('🪙'), '沒給 XP 或金幣');
  assert(S.coins() > coinsBefore, `金幣沒增加：${coinsBefore} → ${S.coins()}`);
  assert(S.mapStat(3, 'B').cleared === true, '字母關沒記為通過');
});

t('通關後有「下一關 / 訂正 / 回地圖」', () => {
  assert(doc.querySelector('[data-act="nextMapStage"]'), '沒有下一關');
  assert(doc.querySelector('[data-act="backToMap"]'), '沒有回地圖');
});

t('連勝會累加並顯示在頂端', () => {
  assert(S.winStreak() >= 1, '連勝沒累加');
  click('[data-act="backToMap"]');
  assert(has('第 3 級'), '沒回到地圖');
});

t('錯太多 → 不通關，連勝歸零，XP 不入帳', () => {
  // 先把今天的每日任務都標成已領，這樣 XP 變化就只會來自這一關本身
  const d0 = S.day();
  d0.quests = {}; S.questStatus().forEach(q => { d0.quests[q.id] = true; });
  const xpBefore = S.profile.xp, coinBefore = S.coins();
  S.setDifficulty('easy');            // 血多才不會先 GAME OVER
  goHome();
  click('[data-maplv="3"]');
  click('[data-mapletter="3:C"]');
  click('[data-startstage="3:C:5"]');
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  const r = walkStage({ correct: false });
  if (r.end === 'dead') { assert(has('GAME OVER'), ''); return; }
  assert(has('未通關'), '沒顯示未通關：' + txt().slice(0, 250));
  assert(S.winStreak() === 0, '連勝沒歸零');
  assert(S.profile.xp === xpBefore, `XP 不該入帳：${xpBefore} → ${S.profile.xp}`);
  assert(S.coins() === coinBefore, '金幣不該入帳');
  assert(doc.querySelector('[data-act="retryMapStage"]'), '沒有再挑戰按鈕');
});

t('未通關時可以訂正剛才錯的字', () => {
  const fix = doc.querySelector('[data-act="fixWrong"]');
  if (!fix) return;                    // 剛好全對就沒有錯的可訂正
  fire('click', fix);
  assert(has('訂正剛才答錯的字'), '沒進訂正關：' + txt().slice(0, 200));
  assert(!has('♥'), '訂正關不該扣血');
  const r = walkStage({ correct: true });
  assert(r.end === 'cleared' || has('訂正完成'), '訂正沒走完：' + r.end);
});

console.log('\n--- 離開＝放棄 ---');
t('關卡中點導覽會警告「離開就是放棄」，可以選擇留下', () => {
  S.setDifficulty('normal');
  goHome();
  click('[data-maplv="4"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  const q = curQ();
  if (!q) return;
  fire('click', doc.querySelector('[data-act="gear"]'));   // 先確認齒輪可用
  click('[data-close="resume"]');
  // 模擬按下頂端以外的導覽（結算頁的 data-go）
  const before = S.winStreak();
  window.__run().inStage = true;
  const nav = { closest: sel => (sel === '[data-go]' ? { dataset: { go: 'home' } } : null) };
  (doc._ev.click || []).forEach(fn => fn({ type: 'click', target: nav, preventDefault() { } }));
  assert(has('離開就是放棄'), '沒有警告：' + txt().slice(0, 200));
  click('[data-close="stay"]');
  assert(!has('離開就是放棄'), '選擇留下後視窗沒關');
  assert(S.winStreak() === before, '只是取消卻動到連勝');
});

t('確認放棄後，關卡不算通過且連勝歸零', () => {
  if (!window.__run() || !window.__run().inStage) return;
  const nav = { closest: sel => (sel === '[data-go]' ? { dataset: { go: 'home' } } : null) };
  (doc._ev.click || []).forEach(fn => fn({ type: 'click', target: nav, preventDefault() { } }));
  click('[data-close="quit"]');
  assert(S.winStreak() === 0, '放棄後連勝沒歸零');
  assert(has('第 4 級') || has('闖關地圖'), '沒回到地圖：' + txt().slice(0, 150));
});

console.log('\n--- 每日獎勵 ---');
t('首頁列出每日任務，含 XP 與金幣', () => {
  goHome();
  assert(has('任務看板'), '沒有任務看板');
  assert(has('通關 1 個字母關'), '沒有通關任務');
  assert(has('🪙'), '任務沒顯示金幣');
  assert(!has('沒有一題逾時'), '逾時任務應已移除');
});

t('通關會自動簽到', () => {
  const d = S.day();
  assert(d.checkin, '沒有簽到紀錄');
  assert(d.checkin.xp > 0 && d.checkin.coin > 0, '簽到沒給獎勵');
  assert(has('今日已簽到'), '首頁沒顯示簽到狀態');
});

console.log('\n--- 商店 ---');
t('商店列出道具與金幣，且不賣會污染紀錄的東西', () => {
  click('[data-go="shop"]');
  assert(has('商店'), '沒進商店');
  assert(has('護心符') && has('沙漏') && has('刪去法'), '消耗品沒列全');
  assert(has('連勝護盾'), '被動道具沒列出');
  assert(has('主題：森林') && has('稱號：'), '外觀類沒列出');
  assert(!S.SHOP.some(x => /跳過|看答案/.test(x.name)), '不該賣跳題道具');
});

t('金幣不夠時買不下去，夠了就買得到', () => {
  S.profile.coins = 0; S.profile.inventory = {};
  goHome(); click('[data-go="shop"]');
  const btn = doc.querySelector('[data-buy="heart"]');
  assert(btn && btn.disabled, '沒錢時按鈕應停用');
  S.addCoins(500);
  goHome(); click('[data-go="shop"]');
  click('[data-buy="heart"]');
  assert(S.inventory().heart === 1, '沒買到：' + JSON.stringify(S.inventory()));
  assert(has('持有 1'), '商店沒顯示持有數');
});

t('買了主題可以裝備，再按一次取消', () => {
  S.addCoins(500);
  click('[data-buy="theme_forest"]');
  click('[data-equip="theme_forest"]');
  assert(S.equipped('theme') === 'theme_forest', '沒裝備');
  click('[data-equip="theme_forest"]');
  assert(S.equipped('theme') === null, '沒取消裝備');
});

t('護心符會在開關時自動使用，讓血量 +1', () => {
  S.profile.inventory = { heart: 1 };
  S.setDifficulty('normal');
  const baseHearts = S.diff().hearts;
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  assert(!S.inventory().heart, '護心符沒被消耗');
  const r = window.__run();
  assert(r.maxHearts === baseHearts + 1, `血量沒 +1：${r.maxHearts} vs ${baseHearts}`);
  walkStage({ correct: true });
});

console.log('\n--- 每題不即時結算 ---');
t('預設每題答完不揭曉答案，直接進下一題', () => {
  S.settings.instantFeedback = false;
  S.settings.stageQuestions = 5;
  goHome();
  click('[data-maplv="5"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  const opts = doc.querySelectorAll('.opt');
  if (!opts.length) return;
  const before = window.__run().idx;
  fire('click', opts[0]);
  const fb = doc.querySelector('#fb');
  assert(!fb || !fb.innerHTML.trim(), '不該當下顯示對錯講解：' + (fb ? fb.innerHTML.slice(0, 120) : ''));
  assert(!doc.querySelector('.opt.ok') && !doc.querySelector('.opt.no'), '不該把正解標成綠色／錯的標紅色');
  const advanced = window.__run().idx === before + 1;
  assert(advanced || has('★') || has('未通關'), '沒有自動進下一題');
});

t('關卡結算才出現逐題檢討與正確答案', () => {
  const r = window.__run() && window.__run().inStage ? walkStage({ correct: true }) : { end: 'cleared' };
  if (r.end === 'dead') { click('[data-close="home"]'); return; }   // 血空走 GAME OVER，另一條路徑
  assert(has('逐題檢討'), '沒有逐題檢討：' + txt().slice(0, 200));
  assert(has('通關') || has('未通關'), '結算沒說通關與否');
});

t('GAME OVER 也不會讓人卡住，可以重新挑戰或離開', () => {
  S.setDifficulty('extreme');            // 一顆心，一定會死
  goHome();
  click('[data-maplv="1"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 60) click('[data-act="nextCard"]');
  const r = walkStage({ correct: false });
  if (r.end !== 'dead') { S.setDifficulty('normal'); return; }
  assert(has('GAME OVER'), '沒有 GAME OVER');
  assert(has('作廢'), '沒說明 XP 作廢');
  assert(doc.querySelector('[data-close="retry"]'), '沒有重新挑戰');
  click('[data-close="home"]');
  assert(has('闖關地圖') || has('第 1 級'), '離開後沒回到可用畫面');
  S.setDifficulty('normal');
});

console.log('\n--- 成績單 ---');
t('成績單有新字數、複習對錯數與家長回報文字', () => {
  goHome();
  click('[data-go="report"]');
  assert(has('今日成績單'), '沒進成績單');
  const rep = doc.querySelector('#rep');
  assert(rep, '沒有回報文字');
  const s2 = rep.textContent;
  assert(/今天學了幾個新單字：\d+ 個/.test(s2), '缺新單字數');
  assert(/對 \d+ 個、錯 \d+ 個/.test(s2), '缺複習對錯數');
});

t('可下載今日紀錄與成績單', () => {
  const before = downloads.length;
  click('[data-act="dlJson"]');
  click('[data-act="dlHtml"]');
  assert(downloads.length === before + 2, '下載沒觸發');
});

console.log('\n--- 其他畫面 ---');
t('全站沒有右上角首頁鈕，每個子畫面靠標題旁的返回', () => {
  ['practice', 'browse', 'badges', 'settings', 'shop', 'report'].forEach(scr => {
    goHome();
    click(`[data-go="${scr}"]`);
    assert(doc.querySelectorAll('[data-go="home"]').length === 0, `${scr} 頁不該有首頁鈕`);
    assert(doc.querySelector('.phead [data-act="back"]'), `${scr} 頁沒有標題旁的返回鈕`);
  });
  goHome();
});

t('級別／字母關內沒有多餘的離開按鈕，返回貼在標題旁', () => {
  goHome();
  click('[data-maplv="3"]');
  assert(doc.querySelector('.phead [data-act="back"]'), '返回沒貼在標題旁');
  assert(doc.querySelectorAll('.wrap [data-go]').length === 0, '級別頁不該有其他離開按鈕');
  click('[data-mapletter="3:B"]');
  assert(doc.querySelector('.phead [data-act="back"]'), '選字數頁沒有返回');
  assert(doc.querySelectorAll('.wrap [data-go]').length === 0, '選字數頁不該有其他離開按鈕');
});

t('返回會一層一層退：選字數 → 字母表 → 首頁', () => {
  click('[data-act="back"]');
  assert(doc.querySelector('[data-mapletter]'), '沒退回字母表：' + txt().slice(0, 150));
  click('[data-act="back"]');
  assert(has('任務看板') && doc.querySelector('[data-maplv]'), '沒退回首頁');
});

t('首頁只有一個闖關地圖入口，沒有重複', () => {
  goHome();
  const n = (txt().match(/闖關地圖/g) || []).length;
  assert(n === 1, `首頁出現 ${n} 次「闖關地圖」`);
});

t('瀏覽字庫可用', () => {
  goHome();
  click('[data-go="browse"]');
  assert(has('瀏覽字庫') && has('6012'), '字庫頁不對');
  click('[data-blv="4"]');
  assert(has('1002 筆'), '級別篩選錯');
});

t('設定頁改為每關題數，且有難度選擇', () => {
  goHome();
  click('[data-go="settings"]');
  assert(has('每關題數'), '沒有每關題數');
  assert(has('一個字母關幾題'), '沒有每關題數滑桿');
  assert(has('關卡難度'), '沒有難度選擇');
  assert(has('每題可用的時間'), '沒有時間表');
  assert(!has('重做定位測驗'), '不該還有重測按鈕');
});

t('設定頁的時間表列出每一種題型', () => {
  ['英→中', '拼字', '句子重組', '找錯改錯', '自由造句'].forEach(n =>
    assert(has(n), `時間表缺少 ${n}`));
});

t('徽章與文法進度頁列出 32 個文法點', () => {
  goHome();
  click('[data-go="badges"]');
  assert(has('文法 32 點進度') && has('現在完成式') && has('倒裝'), '文法進度不完整');
});

t('設定可以關掉不想練的題型，關掉後就不再出現', () => {
  goHome();
  click('[data-go="settings"]');
  assert(has('要練哪些題型'), '沒有題型開關');
  assert(doc.querySelectorAll('[data-kind]').length === S.ALL_KINDS.length, '題型數不對');
  click('[data-kind="spell"]');
  assert(S.kindOn('spell') === false, '沒關掉拼字題');
  const w = V.find(x => x.w === 'academy');
  let sawSpell = false;
  for (let k = 0; k < 400; k++) if (Q.forWord(w, 5).kind === 'spell') sawSpell = true;
  assert(!sawSpell, '關掉後仍然出現拼字題');
  click('[data-kind="spell"]');
  assert(S.kindOn('spell') === true, '沒有重新開啟');
});

t('不能把題型全部關光', () => {
  S.ALL_KINDS.forEach(k => { if (k !== 'e2c') S.toggleKind(k); });
  const before = S.offKinds().length;
  const ok = S.toggleKind('e2c');
  assert(ok === false, '最後一種題型竟然可以關掉');
  assert(S.offKinds().length === before, '狀態被動到了');
  S.load().profile.settings.offKinds = [];
});

console.log('\n--- 進度與進度條 ---');
t('首頁有整體完成進度與四條進度條', () => {
  goHome();
  assert(has('冒險進度'), '沒有進度卡');
  assert(has('單字總進度') && has('關卡通關進度') && has('等級 Lv.') && has('今日任務'), '進度條沒列全');
  const bars = doc.querySelectorAll('.prow .xpbar');
  assert(bars.length >= 4, `進度條只有 ${bars.length} 條`);
  assert(has(`/${V.length}`), '沒顯示總字數');
  assert(has('已學會的字') && has('進長期記憶') && has('字母關通過') && has('累積星星'), '進度數字磚不完整');
});

t('每個大關都有自己的進度條與百分比', () => {
  const rows = doc.querySelectorAll('[data-maplv]');
  assert(rows.length === 6, '大關數不對');
  assert(doc.querySelectorAll('[data-maplv] .xpbar').length === 6, '大關進度條數不對');
  assert(doc.querySelectorAll('[data-maplv] .hex').length === 6, '大關沒有六角形磚');
});

console.log('\n--- 任務看板：每日／每週／每月 ---');
t('任務看板有三個分頁，每個任務都有進度條', () => {
  goHome();
  ['day', 'week', 'month'].forEach(k => assert(doc.querySelector(`[data-qtab="${k}"]`), '缺少分頁：' + k));
  assert(doc.querySelectorAll('.quest .qbar').length >= 5, '任務沒有進度條');
  assert(doc.querySelectorAll('.qtagb').length >= 5, '任務沒有類別標籤');
  click('[data-qtab="week"]');
  assert(has('本週'), '沒切到每週任務：' + txt().slice(0, 200));
  click('[data-qtab="month"]');
  assert(has('本月'), '沒切到每月任務');
  click('[data-qtab="day"]');
  assert(has('通關 1 個字母關'), '沒切回每日任務');
});

t('達成過的任務在畫面上維持已完成，不會退回', () => {
  const d = S.day();
  d.questDone = d.questDone || {}; d.cleared = 1;
  S.questStatus();                       // 觸發釘住
  d.cleared = 0;
  goHome();
  const q = S.questStatus().find(x => x.id === 'clear1');
  assert(q.done === true, '任務退回未完成了');
  assert(has('✓ 通關 1 個字母關'), '畫面上沒有打勾：' + txt().slice(txt().indexOf('通關 1 個字母關') - 60, txt().indexOf('通關 1 個字母關') + 20));
});

console.log('\n--- 每日簽到軌道 ---');
t('首頁畫出 7 天簽到軌道，看得到後面的獎勵', () => {
  goHome();
  assert(has('每日簽到'), '沒有簽到卡');
  assert(doc.querySelectorAll('.citrack .ci').length === 7, '簽到軌道不是 7 格');
  assert(has('金寶箱'), '第 7 天沒顯示金寶箱');
  assert(has('本輪進度'), '沒有本輪進度條');
});

console.log('\n--- 通關寶箱與加碼題 ---');
t('通關後給寶箱，可以開，也可以先挑戰加碼題', () => {
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="5"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  const r = walkStage({ correct: true });
  assert(r.end === 'cleared', '沒通關：' + r.end);
  assert(has('通關獎勵'), '沒有寶箱區：' + txt().slice(0, 200));
  assert(doc.querySelector('[data-act="openChest"]'), '沒有開寶箱按鈕');
  assert(doc.querySelector('[data-act="bonusRound"]'), '沒有加碼題按鈕');
  assert(has('本關用時'), '沒有顯示本關用時');
  assert(has('本關最高連擊'), '沒有顯示本關連擊');
});

t('加碼題只有一題，答對讓寶箱升級', () => {
  const tierBefore = window.__chest.tier;
  click('[data-act="bonusRound"]');
  assert(has('加碼題'), '沒進加碼題：' + txt().slice(0, 200));
  const rr = window.__run();
  assert(rr.qs.length === 1, '加碼題不該超過一題');
  assert(rr.maxHearts === 0, '加碼題不該扣血');
  walkStage({ correct: true });
  assert(has('加碼成功'), '答對卻沒成功：' + txt().slice(0, 200));
  const order = S.CHEST_ORDER;
  assert(order.indexOf(window.__chest.tier) > order.indexOf(tierBefore) || tierBefore === 'gold', '寶箱沒升級');
});

t('開寶箱會拿到金幣與 XP，並寫進紀錄', () => {
  const coinsBefore = S.coins(), logBefore = S.chestLog().length;
  click('[data-act="openChest"]');
  assert(has('選一個箱子'), '沒有選箱畫面：' + txt().slice(0, 200));
  click('[data-close="0"]');
  assert(has('+') && (has('🪙') || has('XP')), '沒顯示開出的東西');
  assert(S.coins() > coinsBefore, '金幣沒入帳');
  assert(S.chestLog().length === logBefore + 1, '寶箱紀錄沒寫');
  click('[data-close="ok"]');
});

console.log('\n--- 速度分與連擊 ---');
t('答對的回饋會顯示速度與分數組成', () => {
  S.settings.instantFeedback = true;
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  const q = curQ();
  const opts = doc.querySelectorAll('.opt');
  if (opts.length) fire('click', opts[q.a]);
  else { doc.querySelector('#ans').value = q.answer; click('[data-act="submit"]'); }
  assert(has('答對了'), '沒顯示答對：' + txt().slice(0, 200));
  assert(has('底分'), '沒顯示分數組成');
  assert(has('速度') || has('神速') || has('很快') || has('穩定'), '沒顯示速度評價');
  const a = window.__run().answers[0];
  assert(a.gained > 0 && a.speed >= 0, '速度分沒算：' + JSON.stringify(a));
  S.settings.instantFeedback = false;
  window.__run().inStage = false;
});

t('連擊是關卡連擊：新的一關從 0 開始', () => {
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  assert(window.__run().combo === 0, '新關卡的連擊沒歸零');
  const q = curQ();
  const opts = doc.querySelectorAll('.opt');
  if (opts.length) fire('click', opts[q.a]); else { doc.querySelector('#ans').value = q.answer; click('[data-act="submit"]'); }
  assert(window.__run().combo === 1, '答對後連擊沒累加');
  window.__run().inStage = false;
});

console.log('\n--- 作答紀錄頁 ---');
t('作答紀錄頁有四個分頁與統計', () => {
  goHome();
  click('[data-go="records"]');
  assert(has('作答紀錄'), '沒進紀錄頁：' + txt().slice(0, 200));
  ['ans', 'runs', 'quests', 'chests'].forEach(k => assert(doc.querySelector(`[data-rtab="${k}"]`), '缺少分頁：' + k));
  assert(has('累積作答題數') && has('首次作答正確率'), '沒有統計數字');
});

t('作答紀錄逐題列出時間、答案與用時，可以篩選只看答錯', () => {
  assert(has('你的答案'), '沒有答案欄');
  assert(has('用時'), '沒有用時欄');
  assert(doc.querySelectorAll('table.log tr').length > 1, '沒有任何紀錄列');
  click('[data-ronly="wrong"]');
  assert(has('只看答錯'), '篩選鈕不見了');
  const rows = doc.querySelectorAll('table.log tr.rowok');
  assert(rows.length === 0, '篩選答錯卻出現答對的列');
  click('[data-ronly="all"]');
});

t('關卡紀錄列出每關的開始時間與用時', () => {
  click('[data-rtab="runs"]');
  assert(has('開始／結束') && has('用時'), '關卡紀錄欄位不全：' + txt().slice(0, 300));
  assert(/\d\d:\d\d/.test(txt()), '沒有時間格式');
  assert(S.runLog().length > 0, '沒有關卡紀錄資料');
});

t('任務紀錄列出完成時間與內容', () => {
  click('[data-rtab="quests"]');
  assert(has('任務完成紀錄'), '沒有任務紀錄區');
  assert(has('每日簽到') || has('通關'), '任務紀錄沒有內容');
});

t('寶箱紀錄列出開出的東西', () => {
  click('[data-rtab="chests"]');
  assert(has('寶箱紀錄'), '沒有寶箱紀錄區');
  assert(has('寶箱'), '沒有寶箱資料');
});

console.log('\n--- 拼字題與發音 ---');
t('拼字題只給底線，不給任何字母', () => {
  const w = V.find(x => Q.base(x.w) === 'academy');
  const q = Q.gen.spell(w);
  assert(!/[A-Za-z]/.test(q.prompt.hint), '提示出現了字母：' + q.prompt.hint);
  assert(q.prompt.hint === '_'.repeat(q.prompt.len), '底線數不對：' + q.prompt.hint);
});

t('設定頁可以調發音速度，預設放慢', () => {
  goHome();
  click('[data-go="settings"]');
  assert(has('發音速度'), '沒有發音速度設定');
  assert(doc.querySelector('[data-set="speechRate"]'), '沒有速度滑桿');
  assert((S.settings.speechRate || 75) <= 80, '預設語速應該放慢');
});

t('商店賣的東西變多、變貴，且分稀有度', () => {
  goHome();
  click('[data-go="shop"]');
  assert(has('夥伴') && has('護符'), '沒有新的商品類別');
  assert(has('傳說') && has('史詩'), '沒有稀有度標示');
  assert(doc.querySelectorAll('.item').length >= 20, '商品數不足');
  assert(has('復活石') && has('主題：星空'), '新商品沒上架');
});

console.log('\n--- 快速篩選 ---');
t('首頁有快速篩選入口，並顯示還有多少字沒篩', () => {
  goHome();
  assert(has('本來就會的字'), '首頁沒有篩選提示卡：' + txt().slice(0, 200));
  assert(doc.querySelector('[data-go="sweep"]'), '沒有篩選入口');
  click('[data-go="sweep"]');
  assert(has('快速篩選') && has('只要點掉不會的'), '篩選頁不對：' + txt().slice(0, 250));
  assert(doc.querySelectorAll('[data-swlv]').length === 6, '沒有六個級別可選');
  assert(has('隨機抽 2 個真的考'), '沒有說明抽考機制');
});

t('一批 12 個字，可以點掉不會的', () => {
  click('[data-act="sweepGo"]');
  const cards = doc.querySelectorAll('[data-swpick]');
  assert(cards.length === 12, '一批不是 12 個：' + cards.length);
  assert(has('✓ 會'), '預設應該是「會」');
  fire('click', cards[0]);
  assert(doc.querySelectorAll('.swcard.no').length === 1, '點了卻沒標成不會');
  assert(has('✗ 不會'), '沒顯示不會的標記');
  fire('click', doc.querySelectorAll('[data-swpick]')[0]);
  assert(doc.querySelectorAll('.swcard.no').length === 0, '再點一次應該取消');
});

t('送出後抽考 2 題，答對就把整批算已會（不算新字）', () => {
  const d = S.day();
  d.newIds = []; d.sweepKnown = []; d.sweepLearn = []; d.log = [];
  // 點掉兩個當作「不會」
  const cards = doc.querySelectorAll('[data-swpick]');
  fire('click', cards[0]); fire('click', cards[1]);
  click('[data-act="sweepSubmit"]');
  assert(has('抽考'), '沒進抽考：' + txt().slice(0, 200));
  let guard = 0;
  while (doc.querySelector('[data-swopt]') && guard++ < 5) {
    const r = window.__run;   // 抽考不走 runStage，直接讀畫面的正解
    const opts = doc.querySelectorAll('[data-swopt]');
    // 從畫面找不到正解，就全部按第一個；正確與否兩種結果都要能收尾
    fire('click', opts[0]);
  }
  assert(has('確認已會') || has('抽考沒過'), '抽考後沒有結算畫面：' + txt().slice(0, 250));
  const sum = S.summary();
  assert(sum.sweepKnown + sum.sweepLearn === 12, `12 個字應該全部有歸屬：已會 ${sum.sweepKnown} + 待學 ${sum.sweepLearn}`);
  assert(sum.sweepLearn >= 2, '點掉的兩個字應該進待學');
  assert(sum.newCount === 0, '篩選不該算成今天學的新字');
  assert(sum.sweepTotal >= 1, '抽考題數沒記錄');
});

t('結算後可以再篩下一批，或先停', () => {
  assert(doc.querySelector('[data-act="sweepNext"]'), '沒有「再篩下一批」');
  click('[data-act="sweepNext"]');
  assert(doc.querySelectorAll('[data-swpick]').length === 12, '沒有進到下一批');
  click('[data-act="sweepEnd"]');
  assert(has('闖關地圖'), '沒回到首頁');
});

t('學習卡上可以按「這個我早就會了」，不算今天的新字', () => {
  const d = S.day();
  d.newIds = [];
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="5"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  if (!has('先認識新單字')) return;               // 這一關剛好沒有新字
  assert(doc.querySelector('[data-act="knowCard"]'), '學習卡沒有「早就會了」鈕');
  const c = window.__cards;
  const id = c.ids[c.k];
  const n = c.ids.length;
  click('[data-act="knowCard"]');
  assert(S.load().words[id].b === 2, '沒有標成已會');
  assert(S.load().words[id].k === 1, '沒標記來源是自評');
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 60) click('[data-act="nextCard"]');
  assert(!S.day().newIds.includes(id), '按過「早就會了」的字不該算成今天的新字');
  assert(S.day().newIds.length === n - 1, `新字數應該是 ${n - 1}，實際 ${S.day().newIds.length}`);
  const r = window.__run && window.__run();
  if (r) r.inStage = false;
});

console.log('\n--- 衝刺目標 ---');
t('沒訂目標時首頁給快速設定鈕', () => {
  S.clearGoal();
  goHome();
  assert(has('還沒訂衝刺目標'), '沒有目標提示卡：' + txt().slice(0, 200));
  assert(doc.querySelector('[data-goalpreset="lv3"]'), '沒有第 3 級預設鈕');
  assert(doc.querySelector('[data-goalpreset="all"]'), '沒有全書預設鈕');
});

t('按下預設鈕就訂好目標，首頁顯示今天要學幾個字', () => {
  click('[data-goalpreset="lv3"]');
  const g = S.goalStat();
  assert(g.on && g.scope === 3 && g.target === 1002, '目標沒設定好：' + JSON.stringify(g));
  assert(g.until === '2026-08-10', '期限不對：' + g.until);
  assert(has('衝刺目標'), '首頁沒有目標卡');
  assert(has('今天還要學幾個字') || has('今天的量做完了'), '沒顯示今天的配額：' + txt().slice(0, 300));
  assert(has('剩') && has('天'), '沒顯示倒數天數');
  assert(doc.querySelectorAll('.goalcard .xpbar').length >= 2, '目標卡沒有兩條進度條');
});

t('今日配額成為每日任務，會出現在任務看板', () => {
  const q = S.questStatus().find(x => x.id === 'goalday');
  assert(q, '任務看板沒有今日目標任務');
  assert(has('達成今日目標'), '首頁任務看板沒列出目標任務');
  assert(q.goal === S.goalStat().perDay, '任務目標值不等於今天的配額');
});

t('設定頁可以改範圍、字數與期限，也可以取消', () => {
  goHome();
  click('[data-go="settings"]');
  assert(has('衝刺目標'), '設定頁沒有目標區');
  assert(doc.querySelector('[data-goaltarget]'), '沒有目標字數滑桿');
  assert(doc.querySelector('[data-goaluntil]'), '沒有期限欄');
  click('[data-goalscope="4"]');
  assert(S.goalStat().scope === 4, '範圍沒改成第 4 級');
  click('[data-act="clearGoal"]');
  assert(S.goalStat().on === false, '沒有取消目標');
  goHome();
  assert(has('還沒訂衝刺目標'), '取消後首頁應該回到未設定狀態');
});

console.log('\n--- 背包 ---');
t('背包列出素材、合成台、道具存量與收藏', () => {
  const p = S.profile;
  p.materials = { gem_blue: 4, gem_green: 2, stardust: 3, key: 1 };
  goHome();
  assert(doc.querySelector('[data-go="bag"]'), '首頁沒有背包入口');
  click('[data-go="bag"]');
  assert(has('背包'), '沒進背包：' + txt().slice(0, 200));
  assert(has('素材') && has('藍寶石') && has('寶箱鑰匙'), '素材沒列全');
  assert(doc.querySelectorAll('.mat').length >= S.MAT_ORDER.length, '素材格數不對');
  assert(has('合成台'), '沒有合成台');
  assert(doc.querySelectorAll('[data-craft]').length === S.RECIPES.length, '配方數不對');
});

t('素材夠才能按合成，按了會拿到道具', () => {
  const btn = doc.querySelector('[data-craft="r_fifty"]');
  assert(btn && !btn.disabled, '素材夠卻不能合成');
  const before = (S.inventory().fifty || 0);
  fire('click', btn);
  assert((S.inventory().fifty || 0) === before + 1, '合成沒拿到道具');
  assert(has('背包'), '合成後應該留在背包');
  const hard = doc.querySelector('[data-craft="r_xp3"]');
  assert(hard && hard.disabled, '素材不夠的配方應該停用');
});

t('背包可以用鑰匙開箱', () => {
  const coinsBefore = S.coins();
  click('[data-act="useKey"]');
  assert(has('+') && has('XP'), '沒顯示開箱結果：' + txt().slice(0, 200));
  assert(S.coins() > coinsBefore, '金幣沒入帳');
  assert(S.matCount('key') === 0, '鑰匙沒消耗');
  click('[data-close="ok"]');
  assert(has('背包'), '關掉後應該回到背包');
});

t('通關會掉素材並顯示在結算畫面', () => {
  const p = S.profile;
  p.materials = {};
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="1"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 60) click('[data-act="nextCard"]');
  const r = walkStage({ correct: true });
  assert(r.end === 'cleared', '沒通關：' + r.end);
  const total = S.MAT_ORDER.reduce((a, id) => a + S.matCount(id), 0);
  assert(total > 0, '通關卻沒掉素材');
  assert(has('素材已放進背包'), '結算畫面沒顯示掉落：' + txt().slice(0, 300));
  assert(S.dropLog().length > 0, '掉落紀錄沒寫');
});

console.log('\n--- 學習卡暫停 ---');
t('背單字卡時可以暫停，也可以先離開', () => {
  goHome();
  click('[data-maplv="6"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  assert(has('先認識新單字'), '沒進學習卡：' + txt().slice(0, 200));
  assert(doc.querySelector('[data-act="cardPause"]'), '學習卡沒有暫停鈕');
  click('[data-act="cardPause"]');
  assert(has('已暫停') && has('還沒開始計時'), '沒有暫停視窗：' + txt().slice(0, 250));
  click('[data-close="resume"]');
  assert(has('先認識新單字'), '沒回到學習卡');
  click('[data-act="cardPause"]');
  click('[data-close="leave"]');
  assert(has('這一次要練幾個字'), '離開後應該回到字母關選單：' + txt().slice(0, 200));
});

console.log('\n--- 商店更新與外觀 ---');
t('商店有今日特價區，價格劃掉原價', () => {
  goHome();
  click('[data-go="shop"]');
  assert(has('今日特價'), '沒有特價區');
  assert(doc.querySelectorAll('.deals .item').length === 2, '特價商品不是兩件');
  assert(has('-25%'), '沒有折扣標籤');
  assert(has('line-through') || has('持有'), '沒有劃掉原價');
  assert(doc.querySelector('[data-go="bag"]'), '商店沒有背包入口');
});

t('商店每一件商品都有稀有度邊框與圖示', () => {
  const items = doc.querySelectorAll('.item');
  assert(items.length >= 24, '商品數不足：' + items.length);
  ['r-common', 'r-rare', 'r-epic', 'r-legend'].forEach(c =>
    assert(txt().includes(c), '缺少稀有度樣式：' + c));
  assert(doc.querySelectorAll('.iicon').length >= 24, '商品沒有圖示');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
