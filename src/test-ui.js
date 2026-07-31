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
  // 瀏覽器的元素有 tagName（大寫）。app.js 用它判斷「焦點是不是在輸入框」與
  // 「要不要綁 Enter 送出」，少了它這兩條路在測試裡等於沒被驗到。
  get tagName() { return String(this.tag).toUpperCase(); }
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
  /* app.js 會用 el.outerHTML = '...' 就地換掉一個節點（例如開完箱把寶箱卡換成已開啟）。
     少了這個 setter，那行在測試裡會變成「設一個沒人看的屬性」，等於測不到真實行為。 */
  get outerHTML() {
    return `<${this.tag}${Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${serialize(this)}</${this.tag}>`;
  }
  set outerHTML(html) {
    const p = this.parent;
    if (!p) { this.innerHTML = html; return; }
    const tmp = new El('div');
    tmp.innerHTML = String(html);
    const kids = tmp.children.map(c => { if (c instanceof El) c.parent = p; return c; });
    const idx = p.children.indexOf(this);
    if (idx < 0) return;
    p.children.splice(idx, 1, ...kids);
  }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  addEventListener(t, fn) { (this._ev = this._ev || {})[t] = (this._ev[t] || []).concat(fn); }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = null; }
  select() { }
  /* 真的瀏覽器裡 el.click() 會派送一個會冒泡的 click 事件；app.js 的鍵盤快速鍵就是靠這個
     去按覆蓋層（暫停／GAME OVER／選寶箱）的按鈕。少了它，鍵盤操作等於測不到。 */
  click() { fire('click', this); }
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
/* 真的瀏覽器在整頁換掉之後，焦點會回到 body（activeElement 不會留在舊的輸入框）。
   鍵盤快速鍵會用 activeElement 判斷「是不是正在打字」，所以這裡必須模擬同樣的行為。 */
const _setBodyHTML = Object.getOwnPropertyDescriptor(El.prototype, 'innerHTML').set;
Object.defineProperty(doc.body, 'innerHTML', {
  get() { return serialize(this); },
  set(v) { doc.activeElement = null; _setBodyHTML.call(this, v); },
});
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

for (const f of ['data/words.js', 'data/grammar.js', 'data/sentences.js', 'data/memes.js',
  'src/store.js', 'src/quiz.js', 'src/app.js']) {
  new Function(fs.readFileSync(path.join(root, f), 'utf8')).call(global);
}
const S = window.Store, Q = window.Quiz, V = window.VOCAB;
// 測試是同步跑的（幾毫秒內就答完一整關），所以預設關掉「換題後防誤觸」的等待；
// 另有專門的測試把它打開來驗證保護本身有效。
window.__guardMs = 0;

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
  // 一個測試失敗時常常會把 app 留在「關卡進行中」，之後每次導覽都會被攔成「確認放棄」，
  // 於是後面幾十個測試全部連坐。先強制解除關卡狀態，讓每個測試彼此獨立。
  const r = window.__run && window.__run();
  if (r) { r.inStage = false; r.paused = false; }
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
function press(key, opts) {
  const ev = Object.assign({ key, target: doc.activeElement || doc.body, preventDefault() { }, ctrlKey: false, altKey: false }, opts || {});
  (doc._ev.keydown || []).forEach(fn => fn(ev));
}

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
  // 題目可能是四選一（.opt）、要打字（#ans）或句子重組（詞塊）—— 三種都算已經開始出題
  assert(doc.querySelector('.opt') || doc.querySelector('#ans') || doc.querySelector('[data-tile]'),
    '沒開始出題：' + txt().slice(0, 200));
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

t('全部答對 → 這一輪通過，並給 XP 與金幣', () => {
  const coinsBefore = S.coins();
  const r = walkStage({ correct: true });
  assert(r.end === 'cleared', '沒通關：' + r.end);
  assert(has('通過') || has('完成'), '沒顯示通過：' + txt().slice(0, 250));
  assert(has('完成度'), '沒顯示這一關的完成度');
  assert(has('XP') && has('🪙'), '沒給 XP 或金幣');
  assert(S.coins() > coinsBefore, `金幣沒增加：${coinsBefore} → ${S.coins()}`);
  assert(S.mapStat(3, 'B').cleared === true, '字母關沒記為通過');
});

t('完成度沒到 100% 時只給「繼續練習（新單字）」，不給下一關', () => {
  const st = S.mapStat(3, 'B');
  assert(st.total > 5, 'B 關字太少，測不到這個規則');
  assert(st.full === false, '這一輪只練了幾個字，不該算 100% 完成');
  assert(!doc.querySelector('[data-act="nextMapStage"]'), '完成度沒到 100% 卻出現下一關');
  assert(doc.querySelector('[data-act="continueLetter"]'), '沒有「繼續練習（新單字）」');
  assert(has('繼續練習'), '按鈕文字不對：' + txt().slice(0, 300));
  assert(has('沒學會'), '沒說明還差幾個字');
  assert(doc.querySelector('[data-act="backToMap"]'), '沒有回地圖');
});

t('按「繼續練習」會用同一個字母的新字再開一關', () => {
  const before = S.mapStat(3, 'B').known;
  click('[data-act="continueLetter"]');
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  const r = window.__run();
  assert(r, '沒開始新的一關');
  assert(r.cfg.map && r.cfg.map.lv === 3 && r.cfg.map.letter === 'B', '跑到別的關了：' + JSON.stringify(r.cfg.map));
  const ids = r.qs.filter(q => q.i != null).map(q => q.i);
  assert(ids.every(i => V[i].lv === 3 && V[i].w[0].toUpperCase() === 'B'), '混進別的字母');
  walkStage({ correct: true });
  assert(S.mapStat(3, 'B').known > before, '練完之後完成度沒往上');
});


t('連勝會累加並顯示在頂端', () => {
  assert(S.winStreak() >= 1, '連勝沒累加');
  click('[data-act="backToMap"]');
  assert(has('第 3 級'), '沒回到地圖');
});

t('用快速篩選把一個字母篩完，字母磚直接顯示 ★★★', () => {
  const s = S.load();
  s.words = {}; s.map = {};
  S.bucket(1, 'K').forEach(i => S.markKnown(i, 2));      // 全部篩掉（沒打過關卡）
  goHome();
  click('[data-maplv="1"]');
  const tile = doc.querySelector('[data-mapletter="1:K"]');
  assert(tile, '找不到 K 關');
  assert(tile.className.includes('on'), '篩完的字母磚沒有標成完成');
  assert(tile.innerHTML.includes('★★★'), '沒有直接顯示三星：' + tile.innerHTML);
  click('[data-mapletter="1:K"]');
  assert(has('已 100% 完成'), '選字數頁沒標成完成：' + txt().slice(0, 300));
  assert(has('自動完成'), '沒說明是靠全部學會達成的');
  s.words = {}; s.map = {};
});

t('在關卡頁按「重設這一關」，確認後那個字母整個回到未學習', () => {
  const s = S.load();
  s.words = {}; s.map = {};
  S.bucket(2, 'I').forEach(i => S.markKnown(i, 3));
  goHome();
  click('[data-maplv="2"]');
  click('[data-mapletter="2:I"]');
  assert(has('已 100% 完成'), '前置條件：I 關應該是完成的');
  click('[data-resetstage="2:I"]');
  assert(has('重設'), '沒跳出確認視窗：' + txt().slice(0, 300));
  click('[data-close="yes"]');
  assert(S.mapStat(2, 'I').known === 0, 'I 關的字沒有回到未學習');
  assert(!has('已 100% 完成'), '重設後還顯示已完成');
  assert(!doc.querySelector('[data-resetstage="2:I"]'), '沒進度了就不該再出現重設鈕');
  s.words = {}; s.map = {};
});

t('重設的確認視窗按取消，什麼都不會動', () => {
  const s = S.load();
  s.words = {}; s.map = {};
  S.bucket(2, 'I').forEach(i => S.markKnown(i, 3));
  goHome();
  click('[data-maplv="2"]');
  click('[data-mapletter="2:I"]');
  click('[data-resetstage="2:I"]');
  click('[data-close="no"]');
  assert(S.mapStat(2, 'I').known === S.bucket(2, 'I').length, '按取消卻把進度清掉了');
  assert(has('已 100% 完成'), '按取消後沒回到原本的關卡頁');
  s.words = {}; s.map = {};
});

t('100% 完成後才顯示星星，字母磚也會標成完成', () => {
  // 把 B 關剩下的字全部標成已學會，模擬完成度 100%
  S.bucket(3, 'B').forEach(i => S.markKnown(i, 2));
  const st = S.mapStat(3, 'B');
  assert(st.known === st.total, '沒有全部學會');
  assert(st.full === true, '全部學會後應該算 100% 完成');
  goHome();
  click('[data-maplv="3"]');
  const tile = doc.querySelector('[data-mapletter="3:B"]');
  assert(tile && tile.className.includes('on'), '完成的字母磚沒標成完成');
  assert(has('100% 完成'), '級別頁沒顯示完成數');
  click('[data-mapletter="3:B"]');
  assert(has('已 100% 完成'), '選字數頁沒標出已完成：' + txt().slice(0, 300));
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
  S.addCoins(S.priceOf("heart") + 200);
  goHome(); click('[data-go="shop"]');
  click('[data-buy="heart"]');
  assert(S.inventory().heart === 1, '沒買到：' + JSON.stringify(S.inventory()));
  assert(has('持有 1'), '商店沒顯示持有數');
});

t('買了主題可以裝備，再按一次取消', () => {
  S.addCoins(S.priceOf('theme_forest') + 100);      // 北歐物價，得先有錢
  goHome(); click('[data-go="shop"]');
  click('[data-buy="theme_forest"]');
  click('[data-equip="theme_forest"]');
  assert(S.equipped('theme') === 'theme_forest', '沒裝備');
  click('[data-equip="theme_forest"]');
  assert(S.equipped('theme') === null, '沒取消裝備');
});

t('道具預設不使用：沒勾就不會被吃掉', () => {
  S.profile.inventory = { heart: 1, hourglass: 1, xp2: 1 };
  S.setDifficulty('normal');
  const baseHearts = S.diff().hearts;
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  assert(has('這一關要用道具嗎'), '選字數畫面沒有道具勾選區：' + txt().slice(0, 300));
  assert(doc.querySelector('[data-useitem="heart:1"]'), '沒有護心符的勾選鈕');
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  assert(S.inventory().heart === 1, '沒勾卻被消耗了');
  const r = window.__run();
  assert(r.maxHearts === baseHearts, `沒勾道具血量不該改變：${r.maxHearts} vs ${baseHearts}`);
  r.inStage = false;
});

t('沒有道具時也要說明白「哪裡拿、怎麼用」', () => {
  S.profile.inventory = {};
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  assert(has('這一關要用道具嗎'), '沒有道具區塊');
  assert(has('這一關要用幾個'), '沒有說明可以選數量');
  assert(doc.querySelectorAll('.itemrow.empty').length >= 4, '沒有把選擇器畫出來（灰的）');
  assert(doc.querySelector('[data-go="shop"]') && doc.querySelector('[data-go="bag"]'), '沒有去商店／合成台的入口');
});

t('用了道具時，關卡上方會顯示用了什麼', () => {
  S.profile.inventory = { heart: 1 };
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  click('[data-useitem="heart:1"]');
  assert(doc.querySelector('.itemrow.on'), '勾選後沒有標示已選：' + txt().slice(0, 400));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 60) press(' ');
  assert(has('🧪 護心符'), '關卡上方沒顯示使用中的道具：' + txt().slice(0, 400));
  const r = window.__run(); if (r) r.inStage = false;
});

t('道具可以選「用幾個」，效果會疊加', () => {
  S.profile.inventory = { heart: 3, hourglass: 2, xp2: 2 };
  S.setDifficulty('normal');
  const base = S.diff().hearts;
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  assert(doc.querySelector('[data-useitem="heart:1"]'), '沒有加號按鈕');
  assert(doc.querySelector('[data-useitem="heart:-1"]'), '沒有減號按鈕');
  click('[data-useitem="heart:1"]');
  click('[data-useitem="heart:1"]');                    // 用 2 個護心符
  assert(has('♥' + (base + 2)), `血量預覽沒有疊加到 ${base + 2}：` + txt().slice(0, 500));
  click('[data-useitem="hourglass:1"]');
  click('[data-useitem="hourglass:1"]');                // 兩個沙漏 = 時間 ×2
  assert(has('×2'), '時間沒有疊加：' + txt().slice(0, 500));
  click('[data-useitem="heart:-1"]');                   // 減一個回來
  assert(has('♥' + (base + 1)), '減號沒生效');
  // 持有數是上限
  for (let k = 0; k < 6; k++) click('[data-useitem="heart:1"]');
  assert(has('♥' + (base + 3)), '不該超過持有數：' + txt().slice(0, 500));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 60) press(' ');
  const r = window.__run();
  assert(r.maxHearts === base + 3, `血量沒吃到 3 個護心符：${r.maxHearts}`);
  assert(r.timeMul === 2, '兩個沙漏應該是時間 ×2：' + r.timeMul);
  assert(!S.inventory().heart, '護心符沒有全部消耗');
  assert(!S.inventory().hourglass, '沙漏沒有全部消耗');
  assert(S.inventory().xp2 === 2, '沒選的 XP 卡不該被消耗');
  assert(has('護心符 ×3'), '關卡上方沒顯示用了幾個：' + txt().slice(0, 400));
  r.inStage = false;
});

t('「全部用滿」與「全部取消」', () => {
  S.profile.inventory = { heart: 2, xp2: 1 };
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  click('[data-act="maxItems"]');
  const base = S.diff().hearts;
  assert(has('♥' + (base + 2)), '全部用滿沒生效：' + txt().slice(0, 500));
  assert(has('XP <b style="color:var(--gold)">×2') || has('×2'), 'XP 卡沒算進去');
  click('[data-act="clearItems"]');
  assert(has('目前不使用任何道具'), '全部取消沒生效：' + txt().slice(0, 500));
});

t('勾了才用：血量／時間／XP 倍率照勾選生效，用完就清空', () => {
  S.profile.inventory = { heart: 1, hourglass: 1, xp2: 1 };
  const baseHearts = S.diff().hearts;
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  click('[data-useitem="heart:1"]');
  click('[data-useitem="hourglass:1"]');
  assert(has('♥' + (baseHearts + 1)), '沒有即時預覽血量變化：' + txt().slice(0, 400));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 40) click('[data-act="nextCard"]');
  const r = window.__run();
  assert(!S.inventory().heart, '勾了卻沒消耗護心符');
  assert(!S.inventory().hourglass, '勾了卻沒消耗沙漏');
  assert(S.inventory().xp2 === 1, '沒勾的 XP 卡不該被消耗');
  assert(r.maxHearts === baseHearts + 1, `血量沒 +1：${r.maxHearts}`);
  assert(r.timeMul === 1.5, '沙漏沒生效：' + r.timeMul);
  walkStage({ correct: true });
  // 勾選狀態用完要清空，下一關不會偷吃
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  assert(!has('目前不使用任何道具') === false, '勾選狀態沒有清空');
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

t('成就頁分等級列出，未達成的顯示進度條', () => {
  goHome();
  click('[data-go="badges"]');
  assert(has('成就'), '沒進成就頁：' + txt().slice(0, 200));
  ['普通', '稀有', '史詩', '傳說', '究極'].forEach(n => assert(has(n), '缺少等級分類：' + n));
  assert(doc.querySelectorAll('.ach').length === S.BADGES.length, '成就數不對：' + doc.querySelectorAll('.ach').length);
  assert(doc.querySelectorAll('.ach .qbar').length >= 1, '未達成的成就沒有進度條');
  assert(has('全書背完') && has('全書精熟'), '沒有究極成就');
  assert(has('成就收集度'), '沒有整體收集度進度條');
});

t('徽章與文法進度頁列出 32 個文法點', () => {
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

t('看板把沒完成的排前面，完成的收到下面', () => {
  const d = S.day();
  d.quests = {}; d.questDone = {}; d.cleared = 1;
  S.questStatus();                                  // 讓 clear1 達成
  goHome();
  assert(has('已完成'), '沒有把完成的任務收到「已完成」區：' + txt().slice(0, 400));
  const html = txt();
  const doneIdx = html.indexOf('已完成');
  const clear1Idx = html.indexOf('通關 1 個字母關');
  assert(clear1Idx > doneIdx, '完成的任務應該排在「已完成」標題後面');
  assert(doc.querySelector('.quests.done-list'), '沒有已完成清單的樣式');
  d.cleared = 0; d.quests = {}; d.questDone = {};
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

t('結算畫面看得到寶箱與它的條件', () => {
  const t2 = S.CHEST[window.__chest.tier];
  assert(has(t2.name), '沒顯示寶箱名稱：' + txt().slice(0, 300));
  assert(has('抽 ' + t2.rolls + ' 次獎品'), '沒說明抽幾次獎');
  assert(has('鑰匙') && has('神秘禮物'), '沒提到稀有獎品');
  assert(doc.querySelector('.chesticon'), '沒有寶箱圖示');
});

t('加碼題題數跟著關卡規模（3～8 題），全對讓寶箱升兩級', () => {
  const tierBefore = window.__chest.tier;
  const stageN = window.__chest.count || S.settings.stageQuestions;
  const want = Math.max(3, Math.min(8, Math.round(stageN / 3)));
  assert(has(`加碼題 ${want} 題`), `按鈕沒顯示正確題數（預期 ${want}）：` + txt().slice(0, 400));
  click('[data-act="bonusRound"]');
  assert(has('加碼題'), '沒進加碼題：' + txt().slice(0, 200));
  const rr = window.__run();
  assert(rr.qs.length === want, `加碼題應該 ${want} 題（關卡 ${stageN} 題的 ⅓），實際 ${rr.qs.length}`);
  assert(rr.qs.length >= 3 && rr.qs.length <= 8, '加碼題數應該在 3～8 之間');
  assert(rr.maxHearts === 0, '加碼題不該扣血');
  assert(rr.qs.every(q => !q.noGrade), '加碼題不該有不判分的題目');
  walkStage({ correct: true });
  assert(has('全部答對'), '全對卻沒顯示：' + txt().slice(0, 250));
  const order = S.CHEST_ORDER;
  const up = order.indexOf(window.__chest.tier) - order.indexOf(tierBefore);
  assert(up === 2 || window.__chest.tier === 'rainbow', `全對應該升兩級：${tierBefore} → ${window.__chest.tier}`);
  assert(has('加碼題答對') && has(`${want}/${want}`), '沒顯示答對題數');
});

t('加碼題出的是完全不同的單字（同關範圍內、剛剛沒考過的）', () => {
  // 用一個字多的關卡：先打完一關，再看加碼題抽到什麼
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="3"]');
  fire('click', doc.querySelector('[data-mapletter="3:C"]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  const res = walkStage({ correct: true });
  assert(res.end === 'cleared', '沒通關：' + res.end);
  const c = window.__chest;
  assert(c && c.asked && c.asked.length, '沒記下剛剛考過什麼');
  const stageIds = c.ids.slice();
  assert(has('剛剛沒考過的字'), '按鈕說明沒寫清楚加碼題的取字範圍');
  click('[data-act="bonusRound"]');
  const bq = window.__run().qs;
  // 每一題都必須是剛剛「沒考過」的字
  bq.forEach(q => assert(!stageIds.includes(q.i),
    `加碼題又考了剛剛考過的字：${V[q.i].w}`));
  // 同一個字在加碼題裡不會出現兩次
  const ids = bq.map(q => q.i);
  assert(new Set(ids).size === ids.length, '加碼題重複同一個字：' + ids);
  // 仍然只在同一級、同一個字母的範圍內
  assert(bq.every(q => V[q.i].w[0].toUpperCase() === 'C' && V[q.i].lv === 3), '加碼題跑出別的字母或級別');
  walkStage({ correct: true });
});

t('加碼題結算畫面一定有出路（不會卡死）', () => {
  assert(doc.querySelector('[data-act="backToMap"]'), '沒有回關卡地圖');
  assert(doc.querySelector('[data-go="home"]'), '沒有回首頁');
  assert(doc.querySelector('[data-act="openChest"]'), '沒有開寶箱');
});

t('開寶箱是全螢幕畫面：先選箱，再一項一項亮出獎品', () => {
  const coinsBefore = S.coins(), logBefore = S.chestLog().length;
  click('[data-act="openChest"]');
  assert(doc.querySelector('.chestscene'), '沒有進到全螢幕開箱畫面');
  assert(has('選一個箱子打開'), '沒有選箱提示：' + txt().slice(0, 200));
  assert(doc.querySelectorAll('[data-openchest]').length === 3, '不是三個箱子');
  assert(has('神秘禮物'), '沒說明稀有獎品');
  click('[data-openchest="1"]');
  assert(doc.querySelector('.chestscene.open'), '沒有進到開箱結果畫面');
  assert(doc.querySelectorAll('.loot.big').length >= 3, '獎品沒有一項一項列出');
  assert(S.coins() > coinsBefore, '金幣沒入帳');
  assert(S.chestLog().length === logBefore + 1, '寶箱紀錄沒寫');
  const r = S.chestLog()[0];
  assert(r.drops && r.drops.length >= 1, '紀錄沒存獎品明細');
  click('[data-act="chestDone"]');
  // 回到開箱前的那個畫面（這裡是加碼題結算），而且「開寶箱」鈕要換成已開箱，不留死按鈕
  assert(has('檢討'), '收下後沒回到原本的畫面：' + txt().slice(600, 900));
  assert(!doc.querySelector('[data-act="openChest"]'), '開完箱還留著開寶箱按鈕');
  assert(has('已開箱') || doc.querySelector('.chestcard.opened'), '沒顯示已開箱的結果');
  // 最重要：開完箱之後畫面仍然有出路，不能卡死
  assert(doc.querySelector('[data-go="home"]') || doc.querySelector('[data-act="backToMap"]'),
    '開完箱之後沒有任何離開的路（卡死）');
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

console.log('\n--- 句子與文法真的會出現 ---');
t('闖一關會遇到句子運用題與文法題，並計入成績單', () => {
  const c = S.settings;
  c.applyPerStage = 3; c.gramPerStage = 2; c.sentRate = 100;
  const d = S.day();
  d.log = []; d.gram = []; d.free = [];
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="3"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  // 選最多題數的那一關，名額才放得下
  const btns = doc.querySelectorAll('[data-startstage]');
  fire('click', btns[btns.length - 1]);
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  const r = window.__run();
  const kinds = r.qs.map(q => q.kind);
  assert(kinds.some(k => ['cloze', 'trans', 'order', 'free'].includes(k)), '這一關沒有句子題：' + kinds.join(','));
  assert(kinds.some(k => k === 'gmc' || k === 'gfix'), '這一關沒有文法題：' + kinds.join(','));
  const res = walkStage({ correct: true });
  assert(res.end === 'cleared', '沒走完：' + res.end);
  const sum = S.summary();
  assert(sum.applyTotal >= 1, '成績單沒統計到句子運用題：' + JSON.stringify(sum));
  assert(sum.gramTotal >= 1, '成績單沒統計到文法題');
  c.applyPerStage = 2; c.gramPerStage = 1; c.sentRate = 60;
});

t('設定頁可以調句子題與文法題名額，並顯示實際組成', () => {
  goHome();
  click('[data-go="settings"]');
  assert(has('題型組成'), '沒有題型組成區');
  assert(doc.querySelector('[data-set="applyPerStage"]'), '沒有句子題名額滑桿');
  assert(doc.querySelector('[data-set="gramPerStage"]'), '沒有文法題名額滑桿');
  assert(doc.querySelector('[data-set="sentRate"]'), '沒有句子比重滑桿');
  assert(has('題句子運用') && has('題文法'), '沒顯示實際組成');
  assert(has('有例句的字共'), '沒顯示例句覆蓋數');
});

console.log('\n--- 錯題加強 ---');
t('答錯的字會在同一關內被插入補考題', () => {
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="4"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 60) click('[data-act="nextCard"]');
  const r = window.__run();
  const before = r.qs.length;
  const q = curQ();
  assert(q, '沒有題目');
  // 故意答錯
  const opts = doc.querySelectorAll('.opt');
  if (opts.length) fire('click', opts[q.a === 0 ? 1 : 0]);
  else { doc.querySelector('#ans').value = '###wrong###'; click('[data-act="submit"]'); }
  const r2 = window.__run();
  assert(r2.qs.length === before + 1, `沒有插入補考題：${before} → ${r2.qs.length}`);
  const redo = r2.qs.filter(x => x.redo);
  assert(redo.length === 1 && redo[0].i === q.i, '補考的不是剛才答錯的字');
  assert(r2.redo[q.i] === 1, '補考次數沒記');
  r2.inStage = false;
});

t('補考記成第 2 次作答，不會洗掉首次正確率', () => {
  const d = S.day();
  d.log = [];
  const w = V.find(x => x.lv === 3);
  S.logAnswer({ i: w.i, t: 'e2c', ok: false, attempt: 1, ms: 3000 });
  S.logAnswer({ i: w.i, t: 'spell', ok: true, attempt: 2, ms: 4000, redo: true });
  const sum = S.summary();
  assert(sum.reviewTotal === 1, '補考被算進題數了：' + sum.reviewTotal);
  assert(sum.reviewWrong === 1 && sum.reviewRight === 0, '首次答錯卻被補考洗成對');
  assert(S.answerLog({}).rows.some(x => x.redo), '作答紀錄沒標記補考');
});

t('首頁有錯題加強卡，可以直接打錯題關與難字關', () => {
  const s = S.load();
  s.words = {};
  const ids = V.filter(x => x.lv === 3).slice(0, 4).map(x => x.i);
  ids.forEach(i => S.answer(i, false, 1));
  ids.slice(0, 2).forEach(i => { S.answer(i, false, 1); S.answer(i, false, 1); });
  goHome();
  assert(has('錯題加強'), '沒有錯題加強卡：' + txt().slice(0, 200));
  assert(has('難字'), '沒有難字提示');
  assert(doc.querySelector('[data-act="startWrong"]'), '沒有錯題關按鈕');
  click('[data-act="startWrong"]');
  assert(has('錯題加強'), '沒進錯題關：' + txt().slice(0, 200));
  const r = window.__run();
  assert(r.qs.length >= 1, '錯題關沒題目');
  assert(r.qs.every(q => S.load().words[q.i].wr > 0), '錯題關混進沒錯過的字');
  assert(r.maxHearts === 0, '錯題關不該扣血');
  r.inStage = false;
  goHome();
  click('[data-act="startLeech"]');
  assert(has('難字特訓'), '沒進難字關：' + txt().slice(0, 200));
  const r2 = window.__run();
  assert(r2.qs.every(q => S.load().words[q.i].wr >= 3), '難字關混進非難字');
  r2.inStage = false;
});

t('家長回報會列出反覆答錯的難字', () => {
  goHome();
  click('[data-go="report"]');
  assert(has('難字'), '成績單沒有難字資訊：' + txt().slice(0, 300));
  assert(has('出題機率已自動調高'), '沒有說明加強機制');
});

console.log('\n--- 快速篩選 ---');
t('首頁有快速篩選入口，並顯示還有多少字沒篩', () => {
  goHome();
  assert(has('本來就會的字'), '首頁沒有篩選提示卡：' + txt().slice(0, 200));
  assert(doc.querySelector('[data-go="sweep"]'), '沒有篩選入口');
  click('[data-go="sweep"]');
  assert(has('快速篩選') && has('只要點掉不會的'), '篩選頁不對：' + txt().slice(0, 250));
  assert(doc.querySelectorAll('[data-swlv]').length === 6, '沒有六個級別可選');
  assert(has('直接通過，不用考'), '沒有說明「說會就直接過」：' + txt().slice(0, 400));
  // 一批要看幾個字，可以自己選
  assert(doc.querySelectorAll('[data-swsize]').length >= 4, '沒有批次大小的選項');
  click('[data-swsize="40"]');
  assert(S.settings.sweepBatch === 40, '批次大小沒存起來');
  assert(has('開始篩（一批 40 字）'), '按鈕沒跟著批次大小改');
  click('[data-swsize="24"]');
});

t('一批的字數照設定，可以點掉不會的', () => {
  click('[data-act="sweepGo"]');
  const cards = doc.querySelectorAll('[data-swpick]');
  assert(cards.length === (S.settings.sweepBatch || 24), '一批的字數跟設定不符：' + cards.length);
  assert(has('✓ 會'), '預設應該是「會」');
  fire('click', cards[0]);
  assert(doc.querySelectorAll('.swcard.no').length === 1, '點了卻沒標成不會');
  assert(has('✗ 不會'), '沒顯示不會的標記');
  fire('click', doc.querySelectorAll('[data-swpick]')[0]);
  assert(doc.querySelectorAll('.swcard.no').length === 0, '再點一次應該取消');
});

t('送出後直接通過，不用抽考（預設）', () => {
  const d = S.day();
  d.newIds = []; d.sweepKnown = []; d.sweepLearn = []; d.log = [];
  const size = doc.querySelectorAll('[data-swpick]').length;
  // 點掉兩個當作「不會」
  const cards = doc.querySelectorAll('[data-swpick]');
  fire('click', cards[0]); fire('click', cards[1]);
  click('[data-act="sweepSubmit"]');
  assert(!doc.querySelector('[data-swopt]'), '預設不該還有抽考題：' + txt().slice(0, 200));
  assert(has('確認已會'), '沒有直接進結算：' + txt().slice(0, 250));
  const sum = S.summary();
  assert(sum.sweepKnown + sum.sweepLearn === size, `${size} 個字應該全部有歸屬：已會 ${sum.sweepKnown} + 待學 ${sum.sweepLearn}`);
  assert(sum.sweepLearn >= 2, '點掉的兩個字應該進待學');
  assert(sum.newCount === 0, '篩選不該算成今天學的新字');
  assert(sum.sweepTotal === 0, '預設不抽考就不該有抽考題數');
});

t('想更嚴格的話，設定可以打開「篩選時抽考 2 題」', () => {
  S.settings.sweepCheck = true;
  click('[data-act="sweepNext"]');
  const cards = doc.querySelectorAll('[data-swpick]');
  assert(cards.length >= 4, '沒有新的一批');
  fire('click', cards[0]);
  click('[data-act="sweepSubmit"]');
  assert(has('抽考'), '打開設定後應該要抽考：' + txt().slice(0, 200));
  let guard = 0;
  while (doc.querySelector('[data-swopt]') && guard++ < 5) fire('click', doc.querySelectorAll('[data-swopt]')[0]);
  assert(has('確認已會') || has('抽考沒過'), '抽考後沒有結算');
  assert(S.summary().sweepTotal >= 1, '抽考題數沒記錄');
  S.settings.sweepCheck = false;
});

t('結算後可以再篩下一批，或先停', () => {
  assert(doc.querySelector('[data-act="sweepNext"]'), '沒有「再篩下一批」');
  click('[data-act="sweepNext"]');
  assert(doc.querySelectorAll('[data-swpick]').length >= 1, '沒有進到下一批');
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

console.log('\n--- 成績單的目前進度 ---');
t('成績單寫出每一級的進度（完成哪些字母、剩下沒完成）', () => {
  const s = S.load();
  s.words = {}; s.map = {};
  // 第 1 級全部學會 → 整級完成；第 3 級只把 A、B、C 學完
  S.LETTERS.forEach(L => S.bucket(1, L).forEach(i => S.markKnown(i, 2)));
  ['A', 'B', 'C'].forEach(L => S.bucket(3, L).forEach(i => S.markKnown(i, 2)));
  S.autoClear();
  goHome();
  click('[data-go="report"]');
  assert(has('目前進度'), '成績單沒有目前進度區：' + txt().slice(0, 300));
  assert(has('第 1 級') && has('全部完成'), '沒寫出第 1 級全部完成');
  assert(has('A–C 完成'), '沒把連續字母壓成範圍（預期 A–C）：' + txt().slice(txt().indexOf('第 3 級'), txt().indexOf('第 3 級') + 200));
  assert(has('其餘未完成'), '沒寫出剩下沒完成');
  // 家長回報文字裡也要有
  const rep = doc.querySelector('#rep').textContent;
  assert(/【目前進度】/.test(rep), '家長回報沒有進度段落');
  assert(/第 1 級：✅ 全部完成/.test(rep), '家長回報沒寫第 1 級完成：' + rep.slice(0, 400));
  assert(/第 3 級：A–C 完成/.test(rep), '家長回報沒寫第 3 級的字母範圍');
  assert(/關卡總進度：\d+\/\d+/.test(rep), '沒有關卡總進度');
  s.words = {}; s.map = {};
});

console.log('\n--- 新手包與字典連結 ---');
t('第一次開啟會拿到新手包（道具功能才有東西可玩）', () => {
  const p = S.profile;
  assert(p.starterGiven === true, '沒有發新手包');
  // 直接驗 store 的行為：不會重複發
  const before = JSON.stringify(S.inventory());
  assert(S.grantStarter() === null, '新手包不該重複發');
  assert(JSON.stringify(S.inventory()) === before, '重複呼叫改動了背包');
  assert(Object.keys(S.STARTER).length >= 3, '新手包內容太少');
});

t('每個單字都能一鍵查 Yahoo 奇摩字典', () => {
  goHome();
  click('[data-go="browse"]');
  const a = doc.querySelector('a.dictmini');
  assert(a, '瀏覽字庫沒有查字典的連結');
  assert(/tw\.dictionary\.search\.yahoo\.com/.test(a.attrs.href), '連結不是 Yahoo 字典：' + a.attrs.href);
  assert(/[?&]p=/.test(a.attrs.href), '沒有帶查詢字：' + a.attrs.href);
  assert(a.attrs.target === '_blank', '應該開新分頁');
});

console.log('\n--- 出題順序 ---');
t('考題順序不會跟學習卡的順序一樣', () => {
  const s = S.load();
  let same = 0, rounds = 0;
  for (let k = 0; k < 12; k++) {
    s.words = {};                                   // 每輪都當成全新的字，才會出學習卡
    S.setDifficulty('easy');
    goHome();
    click('[data-maplv="4"]');
    fire('click', doc.querySelector('[data-mapletter]'));
    const btns = doc.querySelectorAll('[data-startstage]');
    fire('click', btns[Math.min(1, btns.length - 1)]);   // 挑題數多一點的
    if (!has('先認識新單字')) continue;
    const cards = window.__cards.ids.slice();
    let guard = 0;
    while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) press(' ');
    const r = window.__run();
    if (!r || !r.qs) continue;
    // 考題裡「單字第一次出現」的順序
    const seen = [], asked = [];
    r.qs.forEach(q => { if (q.i != null && !seen.includes(q.i)) { seen.push(q.i); asked.push(q.i); } });
    if (cards.length >= 4 && asked.length >= 4) {
      rounds++;
      if (cards.slice(0, 4).join() === asked.slice(0, 4).join()) same++;
    }
    r.inStage = false;
  }
  assert(rounds >= 5, '樣本太少：' + rounds);
  assert(same <= 1, `${rounds} 輪裡有 ${same} 輪的考題順序跟學習卡完全一樣`);
  s.words = {};
});

console.log('\n--- 題目要求要夠明顯 ---');
t('每一種題型都有醒目的「這題要做什麼」橫幅', () => {
  // 直接生題目、走 drawQuestion 的渲染路徑，逐一檢查
  const want = {
    e2c: '中文意思', c2e: '英文單字', listen: '聽發音', spell: '拼出',
    form: '請選出它的', cloze: '填進空格', order: '排成正確的英文句子', trans: '填入',
  };
  const w = V.find(x => x.w === 'issue');
  Object.keys(want).forEach(kind => {
    let q = null;
    for (let k = 0; k < 200 && !q; k++) {
      const cand = Q.gen[kind] ? Q.gen[kind](w) : (Q.apply[kind] ? Q.apply[kind](w) : null);
      if (cand) q = cand;
    }
    if (!q) return;                       // 這個字生不出這種題型就跳過
    window.__run().qs = [q];
    window.__run().idx = 0;
    window.__drawQuestion();
    assert(doc.querySelector('.qask'), `${kind} 沒有題目要求橫幅`);
    assert(has(want[kind]), `${kind} 的要求文字不對：` + txt().slice(0, 300));
  });
});

t('詞形變化題把「要哪一種變化」做得最大', () => {
  const w = V.find(x => x.ex && x.ex.s) || V.find(x => x.ex && Object.keys(x.ex).length);
  let q = null;
  for (let k = 0; k < 200 && !q; k++) q = Q.gen.form(w);
  assert(q, '生不出詞形變化題');
  window.__run().qs = [q];
  window.__run().idx = 0;
  window.__drawQuestion();
  assert(has('請選出它的'), '沒有要求文字');
  assert(doc.querySelector('.qask b'), '要求裡沒有強調的部分');
  assert(txt().includes('hot'), '要問的形式沒有用最醒目的樣式');
  assert(has(q.prompt.ask), '沒顯示要選哪一種變化：' + q.prompt.ask);
  window.__run().inStage = false;
});

console.log('\n--- 誤觸保護與檢討畫面 ---');
t('換題後的極短時間內不接受作答（避免上一題的連點誤答新題）', () => {
  window.__guardMs = 250;                       // 打開保護來驗證
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  const r = window.__run();
  const q = curQ();
  assert(q, '沒有題目');
  const idx0 = r.idx, ansBefore = r.answers.length;
  // 題目剛畫出來就馬上點 → 應該被忽略
  if (q.opts) fire('click', doc.querySelectorAll('.opt')[q.a]);
  else { doc.querySelector('#ans').value = q.answer || 'x'; click('[data-act="submit"]'); }
  assert(r.answers.length === ansBefore, '換題後的瞬間點擊竟然被當成作答');
  assert(r.idx === idx0, '不該換題');
  // 過了保護時間就正常作答
  r.drawnAt = Date.now() - 1000;
  if (q.opts) fire('click', doc.querySelectorAll('.opt')[q.a]);
  else click('[data-act="submit"]');
  assert(r.answers.length === ansBefore + 1, '保護時間過後應該可以正常作答');
  window.__guardMs = 0;
  r.inStage = false;
});

t('GAME OVER 也看得到逐題檢討，答案預設蓋住', () => {
  window.__guardMs = 0;
  S.setDifficulty('extreme');                   // 一顆心，錯一題就結束
  S.profile.inventory = {};                     // 沒有復活石
  goHome();
  click('[data-maplv="3"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  const r = walkStage({ correct: false });
  if (r.end !== 'dead') { S.setDifficulty('easy'); return; }   // 剛好沒死就跳過
  assert(has('GAME OVER'), '沒有 GAME OVER');
  assert(doc.querySelector('[data-close="review"]'), '沒有「看逐題檢討」選項');
  click('[data-close="review"]');
  assert(has('逐題檢討'), '關掉視窗後沒有檢討清單：' + txt().slice(0, 300));
  assert(doc.querySelector('[data-reveal]'), '答案沒有蓋起來');
  assert(!has('正確：<span'), '答案不該直接顯示');
  const btn = doc.querySelector('[data-reveal]');
  const ans = btn.dataset.ans;
  fire('click', btn);
  assert(has(ans), '按了「看答案」卻沒顯示：' + ans);
  S.setDifficulty('easy');
});

t('「全部顯示答案」一次掀開所有答案', () => {
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  walkStage({ correct: true });
  assert(doc.querySelectorAll('[data-reveal]').length >= 1, '結算的檢討沒有蓋住答案');
  click('[data-act="revealAll"]');
  assert(doc.querySelectorAll('[data-reveal]').length === 0, '全部顯示後不該還有蓋住的答案');
  assert(doc.querySelectorAll('.revealed').length >= 1, '沒有顯示出答案');
});

console.log('\n--- 鍵盤快速鍵 ---');
t('學習卡可以純鍵盤操作：下一個／上一個／早就會了', () => {
  S.resetKeys();
  S.settings.memes = true;
  S.setDifficulty('easy');
  const s = S.load();
  s.words = {};                                   // 清空才會有新字出學習卡
  goHome();
  click('[data-maplv="4"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  assert(has('先認識新單字'), '沒進學習卡：' + txt().slice(0, 200));
  assert(has('<kbd>'), '按鈕上沒有顯示快速鍵');
  const at = () => (window.__cards || {}).k;
  const k0 = at();
  press(' ');                                     // 預設：空白鍵 = 下一個
  assert(at() === k0 + 1, `空白鍵沒有前進：${k0} → ${at()}`);
  press('Backspace');                             // 預設：⌫ = 上一個
  assert(at() === k0, `Backspace 沒有後退：${at()}`);
  const id = window.__cards.ids[at()];
  press('Delete');                                // 預設：Del = 早就會了
  assert(S.load().words[id] && S.load().words[id].k === 1, 'Delete 沒有標記為早就會了');
  assert(at() === k0 + 1, 'Delete 之後沒有換下一張');
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) press(' ');
  assert(!has('先認識新單字'), '空白鍵沒把學習卡走完');
});

t('作答可以純鍵盤：數字選答案、送出、空白鍵下一題', () => {
  S.settings.instantFeedback = true;
  const q = curQ();
  assert(q, '沒有題目');
  if (q.opts) {
    press(String(q.a + 1));
    assert(has('答對了'), '數字鍵沒選到正確答案：' + txt().slice(0, 200));
  } else {
    const inp = doc.querySelector('#ans');
    assert(inp, '沒有輸入框');
    inp.value = q.answer || (q.accept && q.accept[0]) || 'x';
    doc.activeElement = inp;
    press('Enter');                               // 預設：Enter = 送出
    assert(has('答對了') || has('答錯'), 'Enter 沒有送出：' + txt().slice(0, 200));
  }
  const idx0 = window.__run().idx;
  press(' ');                                     // 預設：空白鍵 = 下一題
  assert(window.__run().idx === idx0 + 1, '空白鍵沒有換下一題');
  S.settings.instantFeedback = false;
  window.__run().inStage = false;
});

t('在文字框裡打空白不會被當成「下一題」', () => {
  S.settings.instantFeedback = true;
  goHome();
  click('[data-maplv="3"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) press(' ');
  // 找到需要打字的題目
  let hops = 0;
  while (!doc.querySelector('#ans') && hops++ < 20) {
    const q = curQ();
    if (!q) break;
    if (q.opts) { press(String(q.a + 1)); press(' '); }
  }
  const inp = doc.querySelector('#ans');
  if (!inp) { window.__run().inStage = false; S.settings.instantFeedback = false; return; }
  doc.activeElement = inp;
  const idx0 = window.__run().idx;
  press(' ');
  assert(window.__run().idx === idx0, '在輸入框打空白卻跳到下一題了');
  S.settings.instantFeedback = false;
  window.__run().inStage = false;
});

t('設定頁可以改鍵，改完立刻生效', () => {
  goHome();
  click('[data-go="settings"]');
  assert(has('鍵盤快速鍵'), '設定頁沒有鍵盤區');
  assert(doc.querySelectorAll('[data-keyset]').length === S.KEY_ACTS.length, '改鍵按鈕數不對');
  // 用「早就會了」來驗證改鍵（它不屬於前進那一族，測起來最乾淨）
  click('[data-keyset="know"]');
  assert(has('請按一個鍵'), '沒進入等待按鍵狀態');
  press('K');                                      // 把「早就會了」從 Delete 改成 K
  assert(S.keyOf('know') === 'K', '沒改成 K：' + S.keyOf('know'));
  assert(has('K'), '設定頁沒顯示新的鍵');
  const s = S.load();
  s.words = {};
  goHome();
  click('[data-maplv="5"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  if (has('先認識新單字')) {
    const id0 = window.__cards.ids[window.__cards.k];
    press('Delete');                               // 舊的鍵應該失效
    assert(!S.load().words[id0], '改鍵之後 Delete 不該再生效');
    press('K');
    assert(S.load().words[id0] && S.load().words[id0].k === 1, '新的鍵 K 沒生效');
  }
  const r = window.__run(); if (r) r.inStage = false;
  goHome();
  click('[data-go="settings"]');
  click('[data-act="resetKeys"]');
  assert(S.keyOf('know') === 'Delete', '還原預設失敗：' + JSON.stringify(S.keyOf('know')));
});

t('結算畫面按主鍵就能繼續（不用找滑鼠）', () => {
  S.resetKeys();
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) press(' ');
  const r = walkStage({ correct: true });
  assert(r.end === 'cleared', '沒通關：' + r.end);
  const before = txt();
  press('Enter');                                  // 預設：Enter = 主要按鈕
  assert(txt() !== before, 'Enter 沒有觸發結算畫面的主要按鈕');
});

console.log('\n--- 迷因台詞 ---');
t('首頁有「今日廢話」，同一天不會變', () => {
  S.settings.memes = true;
  goHome();
  assert(has('今日廢話'), '首頁沒有每日一句：' + txt().slice(0, 300));
  const grab = () => {
    const m = txt().match(/今日廢話：([^<]+)</);
    return m && m[1];
  };
  const a = grab();
  assert(a, '抓不到每日一句');
  goHome();
  assert(grab() === a, '同一天的每日一句不該變');
  assert((window.MEMES.daily || []).includes(a), '每日一句不在台詞庫裡');
});

t('答對／答錯的回饋會帶一句吐槽', () => {
  S.settings.instantFeedback = true;
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  const q = curQ();
  const opts = doc.querySelectorAll('.opt');
  if (opts.length) fire('click', opts[q.a]);
  else { doc.querySelector('#ans').value = q.answer || (q.accept && q.accept[0]) || 'x'; click('[data-act="submit"]'); }
  assert(doc.querySelector('.meme'), '回饋沒有迷因台詞：' + txt().slice(0, 400));
  const lines = (window.MEMES.ok || []).concat(window.MEMES.fast || []);
  assert(lines.some(x => has(x)), '台詞不在 ok/fast 清單裡');
  S.settings.instantFeedback = false;
  const r = window.__run(); if (r) r.inStage = false;
});

t('設定頁可以關掉迷因，關掉後畫面就不出現', () => {
  goHome();
  click('[data-go="settings"]');
  assert(doc.querySelector('[data-chk="memes"]'), '設定頁沒有迷因開關');
  S.settings.memes = false;
  goHome();
  assert(!has('今日廢話'), '關掉後首頁還有每日一句');
  assert(!doc.querySelector('.meme'), '關掉後還有迷因元素');
  S.settings.memes = true;
});

t('暫停時會出現 ZA WARUDO 那類台詞，繼續時也有一句', () => {
  S.settings.memes = true;
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="2"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  click('[data-act="gear"]');
  assert(has('已暫停'), '沒暫停');
  assert(doc.querySelector('.meme'), '暫停視窗沒有台詞：' + txt().slice(0, 400));
  assert((window.MEMES.pause || []).some(x => has(x)), '台詞不在 pause 清單裡');
  assert(window.MEMES.pause.some(x => x.includes('ZA WARUDO')), '台詞庫裡沒有 ZA WARUDO');
  click('[data-close="resume"]');
  const r = window.__run(); if (r) r.inStage = false;
});

t('台詞用洗牌袋：輪完一遍才重複，而且不會連續兩次同一句', () => {
  S.settings.memes = true;
  ['ok', 'wrong', 'clear', 'pause', 'combo'].forEach(key => {
    const list = window.MEMES[key];
    const pulls = [];
    for (let k = 0; k < list.length * 3; k++) pulls.push(window.__meme(key));
    // 每一句都必須來自清單
    pulls.forEach(x => assert(list.includes(x), `${key} 抽到清單外的台詞：${x}`));
    // 不會連續兩次同一句（換袋子的交界也要守住）
    for (let k = 1; k < pulls.length; k++) {
      assert(pulls[k] !== pulls[k - 1], `${key} 連續兩次同一句：${pulls[k]}（第 ${k} 次）`);
    }
    // 三輪之內每一句都要出現過（洗牌袋才有意義；純隨機幾乎不可能達成）
    assert(new Set(pulls).size === list.length, `${key} 有台詞從沒出現：${new Set(pulls).size}/${list.length}`);
    // 每一句出現的次數要平均（洗牌袋 ≈ 3 次；純隨機會有人 0 次有人 8 次）
    const count = {};
    pulls.forEach(x => { count[x] = (count[x] || 0) + 1; });
    const times = Object.values(count);
    assert(Math.max(...times) - Math.min(...times) <= 2,
      `${key} 出現次數太不平均：${Math.min(...times)}～${Math.max(...times)}`);
  });
  assert(window.MEMES.ok.length >= 20, 'ok 類台詞太少：' + window.MEMES.ok.length);
  assert(window.MEMES.pause.some(x => x.includes('ZA WARUDO')), '台詞庫裡沒有 ZA WARUDO');
  assert(window.MEMES.clear.some(x => x.includes('ハイ')), '通關沒有「最高にハイってやつだ」');
});

t('台詞庫的內容有守規矩（長度、不吐槽學生）', () => {
  const M = window.MEMES;
  const all = Object.keys(M).flatMap(k => (Array.isArray(M[k]) ? M[k] : Object.values(M[k]).flat()));
  assert(all.length >= 80, '台詞太少：' + all.length);
  all.forEach(x => assert(x.length <= 32, '台詞過長：' + x));
  // 不要出現貶低學生的字眼
  ['笨', '蠢', '廢物', '沒救'].forEach(w =>
    assert(!all.some(x => x.includes(w)), `台詞出現不該有的字眼「${w}」`));
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

t('通關的寶箱可以先收起來，之後在背包一次全開', () => {
  S.profile.chestBag = [];
  S.setDifficulty('easy');
  goHome();
  click('[data-maplv="1"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  let guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  const r = walkStage({ correct: true });
  assert(r.end === 'cleared', '沒通關：' + r.end);
  assert(S.chestBag().length === 1, '通關的寶箱沒先存進背包：' + S.chestBag().length);
  assert(has('已經收進背包'), '沒告訴使用者寶箱已收起來');
  // 進到全螢幕選箱畫面，選擇「先收進背包」
  click('[data-act="openChest"]');
  assert(doc.querySelector('[data-act="chestLater"]'), '選箱畫面沒有「先收進背包」');
  click('[data-act="chestLater"]');
  assert(S.chestBag().length === 1, '按了先收起來卻把箱子開掉了');
  // 再打一關，累積第二箱
  goHome();
  click('[data-maplv="1"]');
  fire('click', doc.querySelector('[data-mapletter]'));
  fire('click', doc.querySelector('[data-startstage]'));
  guard = 0;
  while (doc.querySelector('[data-act="nextCard"]') && guard++ < 80) click('[data-act="nextCard"]');
  walkStage({ correct: true });
  assert(S.chestBag().length === 2, '第二箱沒存起來：' + S.chestBag().length);
  // 背包一次全開
  goHome();
  click('[data-go="bag"]');
  assert(has('還沒開的寶箱') && has('一次全開'), '背包沒有未開寶箱區：' + txt().slice(0, 300));
  const coinsBefore = S.coins();
  click('[data-act="openAllChests"]');
  assert(has('開了 2 箱'), '沒有全開演出：' + txt().slice(0, 300));
  assert(S.chestBag().length === 0, '全開後背包沒清空');
  assert(S.coins() > coinsBefore, '金幣沒入帳');
  click('[data-go="bag"]');
  assert(has('目前沒有存起來的寶箱'), '清空後的提示不對');
});

t('首頁與頂端都會提醒「背包裡有幾個沒開的寶箱」', () => {
  S.profile.chestBag = [];
  S.addChest('gold', '測試');
  S.addChest('wood', '測試');
  goHome();
  assert(has('背包裡有 2 個沒開的寶箱'), '首頁沒有提醒：' + txt().slice(0, 400));
  assert(has('🎁 2'), '頂端沒有寶箱數量：' + txt().slice(0, 300));
  assert(doc.querySelector('[data-act="openAllChests"]'), '首頁沒有一次全開的按鈕');
  click('[data-act="openAllChests"]');
  assert(has('開了 2 箱'), '首頁的一次全開沒生效：' + txt().slice(0, 300));
  assert(S.chestBag().length === 0, '全開後背包沒清空');
  click('[data-go="bag"]');
  goHome();
  assert(!has('個沒開的寶箱'), '清空後首頁不該還有提醒');
});

t('鑰匙可以一次全用：N 把 → N 箱 → 一次全開', () => {
  S.profile.materials = { key: 3 };
  S.profile.chestBag = [];
  goHome(); click('[data-go="bag"]');
  assert(has('一次用掉全部鑰匙'), '背包沒有一次全用的按鈕：' + txt().slice(0, 400));
  assert(has('3 把'), '沒顯示鑰匙數量');
  const coinsBefore = S.coins(), logBefore = S.chestLog().length;
  click('[data-act="useAllKeys"]');
  assert(has('開了 3 箱'), '沒有一次開 3 箱：' + txt().slice(0, 300));
  assert(S.chestLog().length === logBefore + 3, '寶箱紀錄應該多 3 筆');
  assert(S.coins() > coinsBefore, '金幣沒入帳');
  // 鑰匙本身可能又開出鑰匙，所以只檢查「至少用掉了」
  const back = S.chestLog().slice(0, 3).reduce((a, r) => a + (r.drops || []).filter(d => d.mat === 'key').reduce((b, d) => b + d.n, 0), 0);
  assert(S.matCount('key') === back, `鑰匙沒全部用掉（剩 ${S.matCount('key')}，這次開出 ${back}）`);
  assert(S.chestBag().length === 0, '換來的箱子應該都開完了');
});

t('背包可以用鑰匙開箱，同樣走全螢幕演出', () => {
  S.profile.materials = { key: 1 };
  goHome(); click('[data-go="bag"]');
  const coinsBefore = S.coins();
  click('[data-act="useKey"]');
  assert(doc.querySelector('.chestscene'), '沒進全螢幕開箱畫面');
  click('[data-openchest="0"]');
  assert(doc.querySelector('.chestscene.open'), '沒有開箱結果');
  assert(S.coins() > coinsBefore, '金幣沒入帳');
  // 銀寶箱本身有機率再開出鑰匙，所以要扣掉這次開出的量再比對
  const back = (S.chestLog()[0].drops || []).filter(d => d.mat === 'key').reduce((a, d) => a + d.n, 0);
  assert(S.matCount('key') === back, `鑰匙沒消耗（剩 ${S.matCount('key')}，這次開出 ${back}）`);
  click('[data-act="chestDone"]');
  assert(has('背包'), '收下後應該回到背包');
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
  assert(items.length >= 30, '商品數不足：' + items.length);
  ['r-common', 'r-rare', 'r-epic', 'r-legend', 'r-ultra'].forEach(c =>
    assert(txt().includes(c), '缺少稀有度樣式：' + c));
  assert(doc.querySelectorAll('.iicon').length >= 30, '商品沒有圖示');
  assert(has('素材包'), '沒有素材包分區');
  assert(has('稱號：六級勇者') && !has('稱號：拼字達人'), '稱號沒精簡到三個');
});

t('素材包買下去直接進背包', () => {
  S.profile.coins = 100000;
  S.profile.materials = {};
  goHome(); click('[data-go="shop"]');
  click('[data-buy="pack_dust"]');
  assert(S.matCount('stardust') === 3, '星塵沒進背包：' + S.matCount('stardust'));
  assert(!S.inventory().pack_dust, '素材包不該佔道具欄');
  click('[data-go="bag"]');
  assert(has('星塵') && has('×3'), '背包沒顯示素材：' + txt().slice(0, 300));
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
