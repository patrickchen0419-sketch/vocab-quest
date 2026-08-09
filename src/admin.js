/* 管理員面板（隱藏功能）。

   進入的兩種「機關」：
     ① 鍵盤密技：↑ ↑ ↓ ↓ ← → ← → B A（就是那個 Konami Code）
     ② 觸控用：連點左上角「單字闖關」標題 7 下（3 秒內）
   解鎖之後右下角會出現 🛠 浮動鈕，隨時可以再打開；面板裡可以再鎖回去。

   能改什麼：玩家數值、道具素材寶箱、闖關地圖星星與學習狀態、單字資料、
   介面上的任何一段文字、配色與自訂 CSS、以及整包存檔的原始 JSON。

   兩件要先講清楚的事：
   1) 這是「本機管理面板」，不是有權限的後台。所有資料都在這台瀏覽器的
      localStorage 裡，任何人打開 F12 都能改同樣的東西 —— PIN 只是防手滑／防小孩亂按，
      不是安全機制。網站雖然對外開放，但別人改的是他自己那份存檔，動不到你的。
   2) 設定另外存一把鑰匙（vocabQuest.admin.v1），不混進遊戲存檔，
      所以「清除所有進度」不會把管理員設定一起清掉（要清有專門的按鈕）。 */
(function () {
  'use strict';

  const KEY = 'vocabQuest.admin.v1';
  const GAME_KEY = 'vocabQuest.v1';          // 必須跟 store.js 的 KEY 一致（原始 JSON 編輯器要用）
  const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'B', 'A'];
  const TAP_NEED = 7, TAP_WINDOW = 3000;

  const S = () => window.Store;
  const A = () => window.__app || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const DEF = {
    unlocked: false,   // 解過鎖就記著，之後直接按 🛠
    pin: '',           // 選填：設了之後每次開面板要輸入
    texts: [],         // [{from, to}] 介面文字替換
    css: '',           // 自訂 CSS
    vars: {},          // {'--ac': '#34d3a6'} 配色覆蓋
    words: {},         // {索引: {w,p,lv,tr,ph}} 單字覆蓋
    added: [],         // 自己加的單字
  };

  let cfg = null;
  function load() {
    if (cfg) return cfg;
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { console.warn('管理員設定讀取失敗，改用預設', e); }
    cfg = Object.assign({}, DEF, raw);
    if (!Array.isArray(cfg.texts)) cfg.texts = [];
    if (!Array.isArray(cfg.added)) cfg.added = [];
    if (!cfg.vars || typeof cfg.vars !== 'object') cfg.vars = {};
    if (!cfg.words || typeof cfg.words !== 'object') cfg.words = {};
    return cfg;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(load())); }
    catch (e) { console.error('管理員設定寫入失敗', e); }
  }

  function toast(msg) {
    if (A().toast) return A().toast(msg);
    console.log('[管理員] ' + msg);
  }
  function reloadPage() {
    if (typeof location !== 'undefined' && location && typeof location.reload === 'function') location.reload();
  }

  // ---------------- 單字覆蓋：一定要在 app 開跑之前套用 ----------------
  /* store.js 會把「每個級別／字首有哪些字」算好之後快取起來，所以改過的字要在
     那份快取產生之前就進 window.VOCAB —— 也就是現在（本檔在 app.js 之後載入，
     而 app.js 是等 DOMContentLoaded 才開跑）。 */
  function applyWords() {
    const V = window.VOCAB;
    if (!V || !V.length) return;
    const c = load();
    for (const k in c.words) {
      const i = +k, w = V[i];
      if (!w) continue;
      Object.assign(w, c.words[k]);
      w.i = i;                       // 索引＝陣列位置，是整個存檔的主鍵，永遠不能被改掉
    }
    c.added.forEach(a => {
      if (!a || !a.w) return;
      V.push(Object.assign({ p: 'n.', lv: 1, tr: '', ph: '', tg: '', fq: 1 }, a, { i: V.length }));
    });
    const M = window.VOCAB_META;
    if (M) {
      M.total = V.length;
      M.byLevel = V.reduce((o, w) => { o[w.lv] = (o[w.lv] || 0) + 1; return o; }, {});
    }
  }

  // ---------------- 介面文字替換 ----------------
  /* 只換「標籤外面」的文字。把 HTML 依標籤切開，奇數段是標籤本身、偶數段才是看得見的字；
     不這樣分的話，把「的」換成別的字會連 class 名稱、data-* 與網址一起改掉，版面直接爛掉。 */
  function text(html) {
    const rules = load().texts;
    if (!rules.length) return html;
    return String(html).split(/(<[^>]*>)/).map((seg, k) => {
      if (k % 2) return seg;
      let out = seg;
      rules.forEach(r => { if (r && r.from) out = out.split(r.from).join(r.to == null ? '' : r.to); });
      return out;
    }).join('');
  }

  // ---------------- 配色 / 自訂 CSS ----------------
  const VARS = [
    ['--bg', '底色'], ['--bg2', '底色 2'], ['--card', '卡片'], ['--card2', '卡片 2'],
    ['--line', '框線'], ['--tx', '主要文字'], ['--tx2', '次要文字'], ['--tx3', '淡文字'],
    ['--ac', '主題色'], ['--ac2', '主題色 2'], ['--gold', '金'], ['--red', '紅'],
    ['--blue', '藍'], ['--purple', '紫'], ['--cyan', '青'], ['--pink', '粉'],
  ];
  /* 用 !important 寫在 <style> 裡，而不是設 documentElement 的 inline style ——
     因為商店的主題（app.js 的 applyTheme）就是用 inline style 設同一批變數，
     換主題時會把 inline 的清掉。樣式表裡的 !important 蓋得過 inline，才不會被洗掉。 */
  function applyStyle() {
    if (!document.head || !document.createElement) return;
    let el = document.querySelector('style.admin-style');
    if (!el) {
      el = document.createElement('style');
      el.className = 'admin-style';
      document.head.appendChild(el);
    }
    const c = load();
    const vars = Object.keys(c.vars).map(k => `${k}:${c.vars[k]} !important;`).join('');
    el.textContent = (vars ? `:root{${vars}}\n` : '') + (c.css || '');
  }

  const PANEL_CSS = `
.adminfab{position:fixed;right:14px;bottom:14px;z-index:60;width:46px;height:46px;border-radius:50%;
  border:1px solid var(--line);background:var(--card2);color:var(--tx);font-size:20px;cursor:pointer;
  box-shadow:0 6px 20px rgba(0,0,0,.45);opacity:.85}
.adminfab:hover{opacity:1}
.adminwrap{position:fixed;inset:0;z-index:70;background:rgba(4,8,18,.9);overflow:auto;padding:12px}
.adminbox{max-width:920px;margin:0 auto;background:var(--card);border:1px solid var(--line);
  border-radius:14px;padding:14px}
.adminhead{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.adminhead h2{margin:0;font-size:19px}
.admintabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.admintabs .pill{cursor:pointer}
.agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.arow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0}
.arow>label{min-width:104px;color:var(--tx2);font-size:14px}
.ain{background:var(--bg2);border:1px solid var(--line);color:var(--tx);border-radius:8px;
  padding:7px 9px;font:inherit;font-size:14px;min-width:0;flex:1}
.ain[type=color]{padding:2px;height:34px;flex:0 0 52px}
.atxt{width:100%;min-height:120px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;line-height:1.5}
.amap{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 10px}
.acell{width:44px;padding:4px 0;text-align:center;border-radius:8px;border:1px solid var(--line);
  background:var(--bg2);color:var(--tx2);font-size:12px;cursor:pointer;line-height:1.25}
.acell b{display:block;font-size:13px;color:var(--tx)}
.acell.on{border-color:var(--gold);color:var(--gold)}
.acell.auto{border-color:var(--ac)}
.aword{border:1px solid var(--line);border-radius:10px;padding:8px;margin:6px 0;background:var(--bg2)}
.adanger{border-color:var(--red)!important;color:var(--red)!important}
.anote{color:var(--tx3);font-size:12.5px;line-height:1.6;margin:6px 0}
`;
  function panelCss() {
    if (!document.head || !document.createElement) return;
    if (document.querySelector('style.admin-panel-css')) return;
    const el = document.createElement('style');
    el.className = 'admin-panel-css';
    el.textContent = PANEL_CSS;
    document.head.appendChild(el);
  }

  // ---------------- 解鎖機關 ----------------
  /* 三組密技。前面兩組是致敬（Konami Code、Doom 的 IDDQD），第三組是那種
     「破完才會出現的隱藏難度」。純好玩，所以按下去就直接生效，不再問你確不確定。

     字母一律要按「大寫」（壓著 Shift 或開 Caps Lock）才算 —— 這是刻意的：
     小寫太容易在正常打字時湊出來，大寫等於多一道「我是故意的」的門檻。 */
  const SEQS = [
    /* 只有這一組不分大小寫：前面八下是方向鍵，正常打字打不出來，
       accidental 觸發本來就不可能 —— 再要求 B、A 一定要壓 Shift 只是刁難。
       （EXTRA／IDDQD／EXTREMELY 是純字母，還是只認大寫，理由見下面。） */
    { code: CODE, name: '管理員面板', anyCase: true, run: () => enter() },
    { code: 'IDDQD'.split(''), name: '無敵', run: () => toggleCheat('god') },
    { code: 'EXTRA'.split(''), name: '究極難度', run: () => toggleSecret('EXTRA'), plus: true },
    /* 第二段階梯的入口。'EXTRA' 不是 'EXTREMELY' 的前綴（第 5 個字母一個是 A 一個是 E），
       所以兩組密技不會互相誤觸，各自數各自的進度就好。 */
    { code: 'EXTREMELY'.split(''), name: '灰燼難度', run: () => toggleSecret('EXTREMELY'), plus: true },
  ];
  /* 比對方式：留一段「最近按過的鍵」，每次按鍵就看尾巴是不是等於某一組密技。

     本來是每組各記一個進度、對不上就歸零，那個寫法有個很煩的毛病：
     多按了一下方向鍵（或按住不放連發一下），↑↑↑↓↓←→←→BA 就完全不算 ——
     可是那明明還是一組正確的密技，尾巴十下就是對的。
     使用者的體感就變成「這個密技很難開，要試個三四次」。
     改成看尾巴，重複鍵、手滑多按的鍵自然被前面吃掉，不需要任何退位規則。 */
  const MAXCODE = SEQS.reduce((a, s) => Math.max(a, s.code.length), 0);
  const recent = [];
  const keyEq = (a, b, anyCase) =>
    anyCase ? String(a).toLowerCase() === String(b).toLowerCase() : a === b;
  let taps = 0, tapAt = 0, authed = false;
  /* EXTRA 打完之後，接著的每一個「＋」都再往上一階（EXTRA++++++ ＝ 一路打到頂）。
     中間插進任何別的鍵就算斷掉，要再打一次 EXTRA 才能繼續加 ——
     不然「開著究極的時候隨手按到 +」就會偷偷升階，那是意外，不是選擇。 */
  let plusChain = false;

  /** 正在輸入框打字時不吃密技 —— 不然拼字題打到「extra」就會被當成密技。 */
  function typingNow() {
    const el = document.activeElement;
    const tag = el && el.tagName ? String(el.tagName).toUpperCase() : '';
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  /* 用捕獲階段（第三個參數 true）：app.js 的鍵盤處理是掛在 document 的冒泡階段，
     捕獲比冒泡早，所以面板開著的時候可以在這裡把事件擋下來 ——
     否則在面板的輸入框按 Enter，會穿過去按到面板底下那顆「開始闖關」。 */
  document.addEventListener('keydown', e => {
    if (panelEl) {
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      if (String(e.key) === 'Escape') { if (e.preventDefault) e.preventDefault(); close(); }
      return;                                   // 面板開著時也不再吃密技（免得在裡面打字誤觸）
    }
    if (typingNow()) return;
    const k = String((e && e.key) || '');
    if (plusChain && k === '+') { ultraUp(); return; }      // EXTRA 之後的每個加號＝再上一階
    plusChain = false;
    recent.push(k);
    if (recent.length > MAXCODE) recent.shift();
    for (const s of SEQS) {
      if (recent.length < s.code.length) continue;
      const tail = recent.slice(-s.code.length);
      // 純字母的密技只認大寫（小寫太容易在正常打字時湊出來）；方向鍵那組不分大小寫
      if (!s.code.every((c, k2) => keyEq(tail[k2], c, s.anyCase))) continue;
      recent.length = 0;                                    // 對上了就重新開始數
      // 加號鏈只在「這一次是打開」時接上；打 EXTRA 把究極關掉之後再按 + 不該又點著
      const on = s.run();
      if (s.plus) plusChain = on !== false;
      break;
    }
  }, true);

  function toggleCheat(k) {
    const on = !S().cheat(k);
    S().setCheat(k, on);
    toast(on ? `😈 ${S().CHEAT_NAMES[k]} — 開` : `${S().CHEAT_NAMES[k]} — 關`);
    redrawApp();
    if (panelEl) draw();
  }
  /* 切究極模式。每一段階梯有自己的入口密技：
       打自己這一段（或更上面）的密技 → 關掉整個究極模式
       打的是更上面那一段的密技      → 直接跳到那一段的第一階（不用從第 1 階一路加號上去）
     回傳「現在是不是開著」，加號鏈要靠它決定接不接下去。 */
  function toggleSecret(code) {
    const s = S(), at = s.ultraEntry(code || 'EXTRA'), lv = s.ultraLevel();
    if (lv >= at) {                                // 已經站在這一段或更上面 → 這一下是「關掉」
      s.setUltra(0);
      if (A().applyTheme) A().applyTheme();        // 立刻把外觀撤掉
      redrawApp();
      if (panelEl) draw();
      toast(`餘燼熄滅 —— 難度回到「${(s.DIFFICULTY[s.settings.difficulty] || {}).name || ''}」`);
      return false;
    }
    s.setUltra(at);
    if (A().applyTheme) A().applyTheme();          // 立刻把「燒起來」的外觀套上去
    redrawApp();
    if (panelEl) draw();
    ultraBurst();
    return true;
  }

  /** 面板上直接指定階數（0 ＝ 關掉）。跟打密技走同一條路，所以行為完全一樣。 */
  function setUltraTo(n) {
    const s = S(), was = s.ultraLevel();
    const lv = s.setUltra(n);
    if (A().applyTheme) A().applyTheme();
    redrawApp();
    if (panelEl) draw();
    if (!lv) return toast('餘燼熄滅 —— 究極模式關掉了');
    if (lv !== was) ultraBurst();
    return lv;
  }

  /** 再上一階。已經站在最頂就只回一句話，不再演一次。 */
  function ultraUp() {
    const s = S(), was = s.ultraLevel();
    const lv = s.ultraUp();
    if (A().applyTheme) A().applyTheme();          // data-ultra 的值就是階數，換階要重套
    redrawApp();
    if (panelEl) draw();
    if (lv === was) {
      // 加號爬到這一段的頂就停 —— 要再上去得知道下一段的入口密技
      const next = s.SECRET_DIFFS[lv] && s.DIFFICULTY[s.SECRET_DIFFS[lv]];
      return toast(next
        ? `☠ 這一段到頂了（${s.DIFFICULTY[s.ultraId(lv)].name}）—— 上面還有東西，但加號上不去`
        : `☠ 已經是最頂階「${s.DIFFICULTY[s.ultraId(lv)].name}」`);
    }
    ultraBurst();
    return lv;
  }

  /** 進究極（或再上一階）的演出：先點火，再把這一階的規矩攤開來講。 */
  function ultraBurst() {
    const s = S(), lv = s.ultraLevel() || 1, d = s.DIFFICULTY[s.ultraId(lv)];
    if (!A().overlay) return toast(`☠ ${d.name} —— 開`);
    // 點火聲：低頻鋸齒往下沉，最後補一顆高音火花。階越高，火花越尖
    if (A().beep) {
      [[190, .5], [150, .55], [115, .6]].forEach(([f, t], k) => setTimeout(() => A().beep(f, t, 'sawtooth', .05), k * 130));
      setTimeout(() => A().beep(1400 + lv * 120, .18, 'triangle', .04), 430);
    }
    const top = lv >= s.ULTRA_MAX;
    A().overlay(`<div class="ultraburst${d.ash ? ' ash' : ''}" data-lv="${lv}">
      <div class="flame">${(lv === 1 ? '究極模式' : d.name).split('').join(' ')}</div>
      <p class="muted" style="margin:10px 0 14px">${d.ash ? '灰燼' : '究極'}第 <b>${lv}</b> / ${s.ULTRA_MAX} 階　${esc(d.code)}
        <br>${d.ash ? '書已經燒完了，只剩一堆灰。沒有火光可以看，你只剩下記得的東西。' : '整本字典開始燒。燒完之前，你只有一條命。'}</p>
      <div class="rule">🔥 <b>一顆心</b>　—　錯一題就結束</div>
      <div class="rule">🧨 時間 <b>×${d.time}</b>　—　每題有一條引信，燒完就算逾時</div>
      <div class="rule">🎯 通關門檻 <b>${Math.round(d.pass * 100)}%</b>　—　${d.pass >= 1 ? '一題都不能錯' : '比平常再嚴一點'}</div>
      <div class="rule">📖 <b>新字直接考最難的</b>　—　沒有四選一可以猜</div>
      ${d.noItems ? '<div class="rule">🚫 <b>不准帶道具</b>　—　護心符、沙漏、XP 卡、復活石全部失效</div>' : ''}
      ${d.allKinds ? '<div class="rule">🧨 <b>題型開關失效</b>　—　你關掉的題型，這一階照考</div>' : ''}
      ${d.noStudy ? '<div class="rule">📕 <b>沒有學習卡</b>　—　新字直接上考場，先看一眼都不給</div>' : ''}
      ${d.noHint ? `<div class="rule">🕳 <b>拼字不給字數</b>　—　連幾個字母都不告訴你</div>
      <div class="rule">⏱ 每題秒數下限砍到 <b>${d.minSec} 秒</b>　—　時間倍率終於吃得到底</div>` : ''}
      <div class="rule">✨ XP <b>×${d.xp}</b>　・　金幣 <b>×${d.coin}</b>　—　活著走出來才拿得到</div>
      <div class="rule">🎁 寶箱保底 <b>${{ silver: '銀', gold: '金', rainbow: '彩虹' }[d.chest]}箱</b></div>
      <p class="tiny" style="margin-top:12px">
        ${top ? '這裡是最頂階，沒有更上面了。' : `再打一個 <kbd>+</kbd> 就上第 ${lv + 1} 階「${esc(s.ULTRA_NAMES[lv])}」（要接在剛才那串後面）。`}
        <br>其他難度已經鎖住。想回頭：再打一次大寫 <kbd>E</kbd><kbd>X</kbd><kbd>T</kbd><kbd>R</kbd><kbd>A</kbd>。</p>
      <div class="btnrow" style="justify-content:center;margin-top:14px">
        <button class="btn primary" data-close="ok">燒吧</button>
      </div></div>`);
  }

  document.addEventListener('click', e => {
    const t = e && e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (!t.closest('.brand')) return;
    const now = Date.now();
    if (now - tapAt > TAP_WINDOW) taps = 0;
    tapAt = now;
    if (++taps >= TAP_NEED) { taps = 0; enter(); }
  });

  function enter() {
    const c = load();
    const first = !c.unlocked;
    c.unlocked = true;
    save();
    if (first) toast('🛠 管理員模式已開啟');
    afterRender();           // 這一次不會有人重畫版面，浮動鈕要自己補上
    open();
  }

  /** 每次重畫版面之後補回浮動鈕（app.js 的 render() 會整個換掉 body）。 */
  function afterRender() {
    if (!load().unlocked || !document.body || !document.createElement) return;
    if (document.querySelector('.adminfab')) return;
    panelCss();
    const b = document.createElement('button');
    b.className = 'adminfab';
    b.textContent = '🛠';
    b.title = '管理員面板';
    b.addEventListener('click', () => open());
    document.body.appendChild(b);
  }

  // ---------------- 面板 ----------------
  let panelEl = null, tab = 'player', wordQ = '';

  function open() {
    if (panelEl) return draw();
    // 關卡進行中打開面板：先暫停，不然你在調參數的時候倒數還在跑，出來就死了
    const r = window.__run && window.__run();
    if (r && r.inStage && !r.paused && A().pauseStage) A().pauseStage();
    panelCss();
    panelEl = document.createElement('div');
    panelEl.className = 'adminwrap';
    panelEl.addEventListener('click', ev => {
      // 面板裡的點擊不要再冒泡到 app.js 的委派（避免同一下被兩邊各解讀一次）
      if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
      try { onClick(ev); } catch (err) { console.error(err); toast('⚠ ' + (err && err.message)); }
    });
    document.body.appendChild(panelEl);
    draw();
  }
  function close() {
    if (panelEl) panelEl.remove();
    panelEl = null;
  }
  function val(sel) {
    const el = panelEl && panelEl.querySelector(sel);
    return el ? String(el.value == null ? '' : el.value) : '';
  }
  const num = sel => Math.round(+val(sel) || 0);

  const TABS = [
    ['cheat', '😈 作弊選單'], ['player', '玩家數值'], ['items', '道具素材'], ['shop', '🏪 商店'],
    ['quest', '🎯 任務簽到成就'], ['map', '闖關進度'],
    ['words', '單字資料'], ['ui', '介面文字'], ['look', '配色外觀'],
    ['data', '存檔原始碼'], ['go', '跳畫面'],
  ];

  function draw() {
    if (!panelEl) return;
    const c = load();
    if (c.pin && !authed) {
      panelEl.innerHTML = `<div class="adminbox">
        <div class="adminhead"><h2>🔒 管理員面板</h2><div class="spacer"></div>
          <button class="btn sm ghost" data-a="close">關閉</button></div>
        <div class="arow"><label>PIN</label><input class="ain" type="password" data-pin value=""></div>
        <div class="btnrow"><button class="btn primary" data-a="pinOk">解鎖</button></div>
        <p class="anote">忘記了就清掉瀏覽器的 <code>${KEY}</code> 這一筆資料。</p>
      </div>`;
      return;
    }
    panelEl.innerHTML = `<div class="adminbox">
      <div class="adminhead">
        <h2>🛠 管理員面板</h2>
        <div class="spacer"></div>
        <button class="btn sm ghost" data-a="close">關閉</button>
      </div>
      <div class="admintabs">${TABS.map(([id, name]) =>
        `<button class="pill ${tab === id ? 'on' : ''}" data-atab="${id}">${esc(name)}</button>`).join('')}</div>
      ${body()}
    </div>`;
  }

  function body() {
    if (tab === 'cheat') return tabCheat();
    if (tab === 'player') return tabPlayer();
    if (tab === 'items') return tabItems();
    if (tab === 'shop') return tabShop();
    if (tab === 'quest') return tabQuest();
    if (tab === 'map') return tabMap();
    if (tab === 'words') return tabWords();
    if (tab === 'ui') return tabUi();
    if (tab === 'look') return tabLook();
    if (tab === 'data') return tabData();
    return tabGo();
  }

  // ---- 作弊選單 ----
  function tabCheat() {
    const s = S();
    const on = s.secretDiff();
    const d = s.DIFFICULTY[s.ultraId(s.ultraLevel() || 1)];
    const sw = (id, name, isOn, note) => `<div class="aword">
      <div class="arow" style="margin:0">
        <b style="flex:1">${esc(name)}</b>
        <button class="btn sm ${isOn ? 'primary' : 'ghost'}" data-acheat="${id}">${isOn ? '● 開著' : '○ 關著'}</button>
      </div>
      <p class="anote" style="margin:4px 0 0">${note}</p></div>`;
    const lv = s.ultraLevel();
    const CHESTN = { silver: '銀', gold: '金', rainbow: '彩虹' };
    // 究極階梯：爬到第幾階就有第幾階可以按，還沒爬到的只看得到名字（灰的）
    const ladder = s.SECRET_DIFFS.map((id, k) => {
      const u = s.DIFFICULTY[id], n = k + 1, reach = n <= lv, cur = n === lv;
      // 每一段階梯的第一階前面插一條分隔，看得出「這裡換密技了」
      const head = n === s.ultraEntry(u.code.replace(/\+*$/, ''))
        ? `<h3 style="margin-top:14px">${u.ash ? '🕯 灰燼段' : '🔥 究極段'}　入口密技 <kbd>${esc(u.code)}</kbd></h3>` : '';
      return head + `<div class="aword" style="${reach ? '' : 'opacity:.45'}">
        <div class="arow" style="margin:0">
          <b style="flex:1">${cur ? '▶ ' : ''}第 ${n} 階 ・ ${esc(u.name)}　<span class="anote" style="display:inline">${esc(u.code)}</span></b>
          <button class="btn sm ${cur ? 'primary' : 'ghost'}" data-aultra="${n}">${cur ? '● 現在這階' : reach ? '切到這階' : '直接跳上去'}</button>
        </div>
        <p class="anote" style="margin:4px 0 0">時間 ×${u.time} ・ 通關門檻 ${Math.round(u.pass * 100)}%
          ・ <b style="color:var(--gold)">XP ×${u.xp} ・ 金幣 ×${u.coin} ・ 寶箱保底${CHESTN[u.chest]}箱</b>
          ${u.noItems ? ' ・ 🚫 不准帶道具' : ''}${u.allKinds ? ' ・ 🧨 題型開關失效' : ''}
          ${u.noStudy ? ' ・ 📕 沒有學習卡' : ''}${u.noHint ? ` ・ 🕳 拼字不給字數 ・ ⏱ 下限 ${u.minSec} 秒` : ''}</p>
      </div>`;
    }).join('');
    return `<h3>☠ 究極階梯（${lv}/${s.ULTRA_MAX} 階）</h3>
      <div class="aword">
        <div class="arow" style="margin:0">
          <b style="flex:1">究極模式${on ? `：目前第 ${lv} 階「${esc(d.name)}」` : ''}</b>
          <button class="btn sm ${on ? 'primary' : 'ghost'}" data-a="secretDiff">${on ? '● 強制中' : '○ 關著'}</button>
        </div>
        <p class="anote" style="margin:4px 0 0">
          <b>這不是多一個選項，是一個模式：打開就強制究極</b>，公開的四檔會被鎖住按不動，
          關掉才會回到你原本玩的難度。它是正常玩法，不是作弊 —— XP 與金幣加成都實打實。<br>
          打大寫 <kbd>EXTRA</kbd> 進第 1 階、<kbd>EXTREMELY</kbd> 直接進第 ${s.ASH_FROM} 階，
          <b>後面每多打一個 <kbd>+</kbd> 就再上一階</b>（打到那一段的頂就停住）。
          再打一次自己這一段的密技就整個關掉。</p>
      </div>
      ${ladder}
      <p class="anote">公開的四檔（輕鬆／標準／挑戰／地獄）刻意做得寬鬆、獎勵也普通 ——
        那是每天都要來一趟的節奏。這條階梯才是拿來拚的：越上面越硬，XP 從 ×${s.DIFFICULTY.ultra.xp} 一路到
        ×${s.DIFFICULTY[s.ultraId(s.ULTRA_MAX)].xp}。</p>

      <h3 style="margin-top:16px">😈 外掛</h3>
      ${sw('god', '無敵', s.cheat('god'), '答錯不扣血，永遠不會 GAME OVER。血條會變成 ♥∞。<br>答錯還是算錯：一樣進複習排程、一樣寫進家長回報。')}
      ${sw('noTimer', '時間暫停', s.cheat('noTimer'), '關掉每題倒數，想幾秒就幾秒。<br>XP 照給，答得快一樣有速度分 —— 只是看不到秒數在跑。')}
      ${sw('xray', '透視', s.cheat('xray'), '選擇題直接把正解框成金色，填空題在題目下面寫出答案。<br>自由造句沒有標準答案，所以不顯示。')}

      <p class="anote"><b>外掛完全不顯示、也不留紀錄</b> —— 畫面上沒有任何「作弊中」的牌子，
        關卡紀錄、作答紀錄、成績單也都不寫。開著的時候只有你自己知道
        （要確認開了沒有，回這一頁看開關）。<br>
        記了也沒用：作弊沒背起來的字照樣會到期、照樣被抓回來考，間隔複習自己會把帳算清楚。</p>

      <h3 style="margin-top:16px">不用開面板的密技</h3>
      <p class="anote"><b>字母一定要大寫</b>（壓著 Shift，或開 Caps Lock），而且游標不能在輸入框裡：<br>
        <kbd>I</kbd><kbd>D</kbd><kbd>D</kbd><kbd>Q</kbd><kbd>D</kbd> → 切換無敵（致敬 Doom）<br>
        <kbd>E</kbd><kbd>X</kbd><kbd>T</kbd><kbd>R</kbd><kbd>A</kbd> → 究極階梯第 1 階（後面接 <kbd>+</kbd> 一階一階往上）<br>
        <kbd>E</kbd><kbd>X</kbd><kbd>T</kbd><kbd>R</kbd><kbd>E</kbd><kbd>M</kbd><kbd>E</kbd><kbd>L</kbd><kbd>Y</kbd> → 直接跳到灰燼段（第 ${S().ASH_FROM} 階，一樣可以接 <kbd>+</kbd>）<br>
        <kbd>↑</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><kbd>←</kbd><kbd>→</kbd><kbd>B</kbd><kbd>A</kbd> → 這個面板（<b>這一組不分大小寫</b>，B、A 直接按就好）<br>
        中間多按幾下也沒關係：只看最後那幾下對不對，所以按住方向鍵連發、手滑多按一下都不會白費。
        另外連點左上角標題 ${TAP_NEED} 下也會開。</p>`;
  }

  // ---- 玩家數值 ----
  function tabPlayer() {
    const s = S(), p = s.profile, st = s.stats();
    const field = (id, name, v) => `<div class="arow"><label>${esc(name)}</label>
      <input class="ain" type="number" data-f="${id}" value="${v}"></div>`;
    return `<h3>數值</h3>
      ${field('xp', 'XP', p.xp || 0)}
      ${field('coins', '金幣', s.coins())}
      ${field('streak', '連續學習天數', p.streak || 0)}
      ${field('bestStreak', '最佳連續天數', p.bestStreak || 0)}
      ${field('winStreak', '連勝', p.winStreak || 0)}
      ${field('bestCombo', '最佳連擊', p.bestCombo || 0)}
      <div class="btnrow"><button class="btn primary" data-a="savePlayer">套用</button></div>

      <h3 style="margin-top:16px">直接跳等</h3>
      <p class="anote">目前 Lv.${st.level}（每等 ${s.XP_PER_LEVEL} XP）。跳等只改 XP；
        升等獎勵預設「標記成已領」，否則下次結算會一口氣噴出幾十份獎勵蓋滿畫面。</p>
      <div class="arow"><label>跳到</label><input class="ain" type="number" data-f="level" value="${st.level}">
        <label style="min-width:auto"><input type="checkbox" data-f="claim"> 補發升等獎勵</label>
        <button class="btn" data-a="setLevel">跳過去</button></div>

      <h3 style="margin-top:16px">快速鍵</h3>
      <div class="btnrow">
        <button class="btn sm" data-a="xp1000">+1000 XP</button>
        <button class="btn sm" data-a="coin5000">+5000 🪙</button>
        <button class="btn sm" data-a="allBadges">解鎖全部成就</button>
        <button class="btn sm ghost" data-a="noBadges">清空成就</button>
      </div>
      <p class="anote">成就：目前 ${(p.badges || []).length} / ${s.BADGES.length}。</p>`;
  }

  // ---- 道具素材寶箱 ----
  function tabItems() {
    const s = S(), inv = s.inventory(), m = s.mats();
    const stepper = (kind, id, name, n) => `<div class="arow" style="margin:0">
      <label style="min-width:auto;flex:1">${esc(name)}</label>
      <button class="btn sm ghost" data-a${kind}="${id}:-1">−</button>
      <b style="min-width:34px;text-align:center">${n}</b>
      <button class="btn sm ghost" data-a${kind}="${id}:1">＋</button>
      <button class="btn sm ghost" data-a${kind}="${id}:10">+10</button></div>`;
    const bag = s.chestBagSummary();
    return `<h3>道具</h3>
      <div class="agrid">${s.SHOP.filter(it => it.kind !== 'pack')
        .map(it => stepper('item', it.id, it.name, inv[it.id] || 0)).join('')}</div>
      <h3 style="margin-top:16px">素材</h3>
      <div class="agrid">${s.MAT_ORDER.map(id => stepper('mat', id, s.MATERIALS[id].icon + ' ' + s.MATERIALS[id].name, m[id] || 0)).join('')}</div>
      <h3 style="margin-top:16px">寶箱（背包裡未開的）</h3>
      <div class="agrid">${s.CHEST_ORDER.map(t => stepper('chest', t, s.CHEST[t].name, (bag.byTier || {})[t] || 0)).join('')}</div>
      <p class="anote">主題／稱號／夥伴這類「只能有一個」的東西，數量設成 1 就等於擁有，
        要不要裝備還是去商店按。</p>`;
  }

  // ---- 商店 ----
  function tabShop() {
    const s = S(), inv = s.inventory(), deals = s.dealsToday();
    const over = s.settings.priceOverride || {};
    const auto = !Array.isArray(s.settings.dealOverride);
    const row = it => {
      const have = inv[it.id] || 0;
      const isEquip = it.kind === 'theme' || it.kind === 'title' || it.kind === 'pet';
      const on = isEquip && s.equipped(it.kind) === it.id;
      const onDeal = deals.some(d => d.id === it.id);
      return `<div class="aword" style="margin:4px 0;padding:6px 8px">
        <div class="arow" style="margin:0;gap:6px">
          <b style="flex:1;min-width:120px">${esc(it.name)}
            <span class="tiny" style="color:var(--tx3)">${esc((s.RARITY[it.rarity] || {}).name || '')}${have ? ' ・持有 ' + have : ''}</span></b>
          <button class="btn sm ghost" data-ashop="give:${it.id}">＋1</button>
          <button class="btn sm ghost" data-ashop="take:${it.id}">−1</button>
          ${isEquip ? `<button class="btn sm ${on ? 'primary' : ''}" data-ashop="equip:${it.id}">${on ? '使用中' : '直接裝備'}</button>` : ''}
          <input class="ain" type="number" style="flex:0 0 92px" data-price="${it.id}"
            value="${over[it.id] != null ? over[it.id] : it.cost}" title="定價">
          <button class="btn sm" data-ashop="price:${it.id}">改價</button>
          <button class="btn sm ghost" data-ashop="deal:${it.id}">${onDeal ? '★特價中' : '設為特價'}</button>
        </div>
        ${over[it.id] != null ? `<p class="anote" style="margin:2px 0 0">已指定價 🪙 ${over[it.id]}（原價 ${it.cost}）</p>` : ''}
      </div>`;
    };
    return `<h3>整批操作</h3>
      <div class="btnrow">
        <button class="btn" data-a="shopAll">全部商品都給我一份</button>
        <button class="btn sm" data-a="shopFree">全部免費（價格設 0）</button>
        <button class="btn sm ghost" data-a="shopReset">價格全部還原</button>
      </div>
      <h3 style="margin-top:16px">今日特價</h3>
      <p class="anote">目前：${auto ? '每天自動抽兩件' : '管理員指定'}　—
        ${deals.length ? deals.map(d => esc((s.shopItem(d.id) || {}).name || d.id) + `（🪙 ${d.cost}）`).join('、') : '今天沒有特價'}</p>
      <div class="btnrow">
        <button class="btn sm ghost" data-a="dealAuto">回到每天自動抽</button>
        <button class="btn sm ghost" data-a="dealNone">今天不要特價</button>
      </div>
      <p class="anote">按商品那排的「設為特價」可以自己指定（可以指定很多件）。</p>
      <h3 style="margin-top:16px">全部商品（${s.SHOP.length} 件）</h3>
      ${s.SHOP.map(row).join('')}`;
  }

  // ---- 任務／簽到／成就 ----
  function tabQuest() {
    const s = S(), d = s.day(), done = d.quests || {};
    const qs = s.questStatus();
    const week = s.periodQuestStatus('week') || [];
    const month = s.periodQuestStatus('month') || [];
    const line = q => `<div class="arow" style="margin:3px 0">
      <b style="flex:1">${q.done ? '✅ ' : ''}${esc(q.name)}<span class="tiny" style="color:var(--tx3)">　${q.cur}/${q.goal}　+${q.xp} XP　+${q.coin} 🪙</span></b>
      <button class="btn sm ${done[q.id] ? 'primary' : 'ghost'}" data-aquest="${q.id}">${done[q.id] ? '已標完成' : '標成完成'}</button></div>`;
    const badges = s.BADGES.map(b => {
      const got = (s.profile.badges || []).includes(b.id);
      return `<button class="btn sm ${got ? 'primary' : 'ghost'}" data-abadge="${b.id}" title="${esc(b.desc)}">${got ? '✅' : '○'} ${esc(b.name)}</button>`;
    }).join(' ');
    return `<h3>今日任務</h3>
      <p class="anote">標成完成之後，獎勵會照原本的流程在下次關卡結算時入帳。</p>
      ${qs.map(line).join('')}
      <div class="btnrow"><button class="btn sm" data-a="questAll">今日任務全部完成</button>
        <button class="btn sm ghost" data-a="questNone">全部取消</button></div>

      <h3 style="margin-top:16px">每週任務</h3>
      ${week.length ? week.map(line).join('') : '<p class="anote">這週沒有任務。</p>'}
      <h3 style="margin-top:16px">每月任務</h3>
      ${month.length ? month.map(line).join('') : '<p class="anote">這個月沒有任務。</p>'}

      <h3 style="margin-top:16px">每日簽到</h3>
      <p class="anote">${d.checkin ? `今天已簽到（+${d.checkin.xp} XP、+${d.checkin.coin} 🪙，第 ${d.checkin.day}/7 天）` : '今天還沒簽到'}</p>
      <div class="btnrow">
        <button class="btn sm" data-a="checkinNow">立刻簽到</button>
        <button class="btn sm ghost" data-a="checkinReset">清掉今天的簽到（可以重簽）</button>
      </div>

      <h3 style="margin-top:16px">成就（點一下切換）</h3>
      <p class="anote">目前 ${(s.profile.badges || []).length} / ${s.BADGES.length}。</p>
      <div class="btnrow" style="gap:5px">${badges}</div>`;
  }

  // ---- 闖關地圖 ----
  function tabMap() {
    const s = S();
    let html = `<p class="anote">點字母格會循環 ☆0 → ★1 → ★2 → ★3 → ☆0。
      綠框＝這個字母的字已經全部學會，系統本來就自動算三星，改星數也蓋不掉它（要先把學習狀態清掉）。</p>`;
    for (let lv = 1; lv <= 6; lv++) {
      const ls = s.levelStat(lv);
      html += `<h3 style="margin-top:12px">第 ${lv} 級　<span class="tiny">${ls.known}/${ls.total} 字 ・ ${ls.cleared}/${ls.playable} 關</span></h3>
        <div class="amap">${s.LETTERS.map(L => {
        const st = s.mapStat(lv, L);
        if (!st.total) return '';
        return `<button class="acell ${st.stars ? 'on' : ''} ${st.autoDone ? 'auto' : ''}" data-astar="${lv}:${L}">
          <b>${L}</b>${st.stars ? '★'.repeat(st.stars) : '☆'}</button>`;
      }).join('')}</div>
        <div class="btnrow">
          <button class="btn sm" data-alv="stars:${lv}">整級三星</button>
          <button class="btn sm ghost" data-alv="clear:${lv}">清掉星星</button>
          <button class="btn sm" data-alv="known:${lv}">整級單字設為已學會</button>
          <button class="btn sm ghost adanger" data-alv="unknown:${lv}">整級單字設為沒學過</button>
        </div>`;
    }
    return html;
  }

  // ---- 單字資料 ----
  function tabWords() {
    const V = window.VOCAB || [];
    const c = load();
    const q = wordQ.trim().toLowerCase();
    const hits = q
      ? V.filter(w => w.w.toLowerCase().includes(q) || String(w.tr || '').includes(wordQ.trim())).slice(0, 15)
      : [];
    const row = w => `<div class="aword">
      <div class="arow" style="margin:0 0 6px"><b style="flex:1">#${w.i} ${esc(w.w)}</b>
        ${c.words[w.i] ? '<span class="tiny" style="color:var(--gold)">已改過</span>' : ''}
        ${c.words[w.i] ? `<button class="btn sm ghost" data-arevert="${w.i}">還原</button>` : ''}</div>
      <div class="arow"><label>單字</label><input class="ain" data-w="w:${w.i}" value="${esc(w.w)}"></div>
      <div class="arow"><label>詞性</label><input class="ain" data-w="p:${w.i}" value="${esc(w.p || '')}"></div>
      <div class="arow"><label>級別</label><input class="ain" type="number" min="1" max="6" data-w="lv:${w.i}" value="${w.lv}"></div>
      <div class="arow"><label>中文</label><input class="ain" data-w="tr:${w.i}" value="${esc(w.tr || '')}"></div>
      <div class="arow"><label>音標</label><input class="ain" data-w="ph:${w.i}" value="${esc(w.ph || '')}"></div>
      <div class="btnrow"><button class="btn sm primary" data-asaveword="${w.i}">儲存這個字</button></div>
      ${(() => {
        const r = (S().load().words || {})[w.i];
        if (!r) return '<p class="anote" style="margin:6px 0 0">還沒學過這個字，沒有作答數值可以改。</p>';
        const f = (k, name, v) => `<div class="arow" style="margin:3px 0"><label style="min-width:88px">${name}</label>
          <input class="ain" type="number" data-r="${k}:${w.i}" value="${v}"></div>`;
        return `<p class="anote" style="margin:8px 0 2px">學習數值（改完按下面的儲存）</p>
          ${f('b', '熟練度 box', r.b || 0)}
          ${f('r', '答對次數', r.r || 0)}
          ${f('wr', '答錯次數', r.wr || 0)}
          ${f('fr', '首次答對', r.fr || 0)}
          ${f('fs', '首次作答', r.fs || 0)}
          <div class="arow" style="margin:3px 0"><label style="min-width:88px">下次複習</label>
            <input class="ain" data-r="due:${w.i}" value="${esc(r.due || '')}" placeholder="2026-08-20"></div>
          <div class="btnrow"><button class="btn sm" data-asaverec="${w.i}">儲存學習數值</button>
            <button class="btn sm ghost adanger" data-aforget="${w.i}">整個忘掉（變回沒學過）</button></div>`;
      })()}
    </div>`;
    const s = S(), wrong = s.recentWrong(12);
    return `<h3>😖 按錯了？把最近答錯的改回來</h3>
      <p class="anote">手滑點錯、或上一題的第二下點擊落在新題目上 —— 那個字會被判錯、掉回 box 0、
        明天還會被抓出來考。按一下就把那筆改成答對：<b>作答紀錄、正確率、複習排程三個地方一起修</b>，
        不會只改一半。</p>
      ${wrong.length ? wrong.map(x => {
        const ww = (window.VOCAB || [])[x.i] || {};
        return `<div class="arow" style="margin:4px 0">
          <b style="flex:1">${esc(ww.w || '#' + x.i)}<span class="tiny" style="color:var(--tx3)">　${esc(ww.tr || '')}</span></b>
          <span class="tiny">${esc(String(x.date || '').slice(5))}${x.timeout ? ' ・逾時' : ''}${x.given ? ' ・答了「' + esc(String(x.given).slice(0, 12)) + '」' : ''}</span>
          <button class="btn sm" data-afix="${x.i}">改成答對</button></div>`;
      }).join('') : '<p class="anote">最近沒有答錯的紀錄。</p>'}

      <h3 style="margin-top:18px">找字來改</h3>
      <div class="arow"><input class="ain" data-q value="${esc(wordQ)}" placeholder="輸入英文或中文">
        <button class="btn" data-a="search">搜尋</button></div>
      ${q && !hits.length ? '<p class="anote">找不到。</p>' : ''}
      ${hits.map(row).join('')}
      <h3 style="margin-top:16px">新增單字</h3>
      <p class="anote">加進去的字會排在字庫最後面，並照級別與字首自動出現在闖關地圖上。</p>
      <div class="arow"><label>單字</label><input class="ain" data-nw="w" placeholder="serendipity"></div>
      <div class="arow"><label>詞性</label><input class="ain" data-nw="p" value="n."></div>
      <div class="arow"><label>級別</label><input class="ain" type="number" min="1" max="6" data-nw="lv" value="6"></div>
      <div class="arow"><label>中文</label><input class="ain" data-nw="tr" placeholder="意外發現美好事物的能力"></div>
      <div class="btnrow"><button class="btn primary" data-a="addWord">新增</button></div>
      <h3 style="margin-top:16px">目前的修改</h3>
      <p class="anote">改過 ${Object.keys(c.words).length} 個字、新增 ${c.added.length} 個字。
        改級別或改字首要重新整理才會重排地圖（其他欄位馬上生效）。
        <b>不提供刪除單字</b> —— 索引就是存檔的主鍵，抽掉一個字會讓後面每個字的學習紀錄整排錯位。</p>
      <div class="btnrow">
        <button class="btn sm" data-a="reload">重新整理</button>
        <button class="btn sm ghost adanger" data-a="clearWords">清掉所有單字修改</button>
      </div>`;
  }

  // ---- 介面文字 ----
  function tabUi() {
    const c = load();
    return `<h3>文字替換</h3>
      <p class="anote">畫面上看得到的字，左邊填原文、右邊填要換成什麼，全站即時生效
        （包含頂端列、按鈕、結算畫面）。只動顯示的文字，不會改到程式或存檔，
        隨時刪掉規則就變回原樣。原文越短影響範圍越大，建議填長一點的整句。</p>
      ${c.texts.map((r, k) => `<div class="arow">
        <input class="ain" data-t="from:${k}" value="${esc(r.from)}">
        <span>→</span>
        <input class="ain" data-t="to:${k}" value="${esc(r.to)}">
        <button class="btn sm ghost adanger" data-adeltext="${k}">刪</button></div>`).join('')}
      ${c.texts.length ? '<div class="btnrow"><button class="btn primary" data-a="saveTexts">套用修改</button></div>' : ''}
      <h3 style="margin-top:16px">新增一條</h3>
      <div class="arow">
        <input class="ain" data-nt="from" placeholder="原本的文字，例如：闖關地圖">
        <span>→</span>
        <input class="ain" data-nt="to" placeholder="換成：大冒險地圖">
        <button class="btn" data-a="addText">加入</button></div>`;
  }

  // ---- 配色外觀 ----
  function tabLook() {
    const c = load();
    const cur = k => c.vars[k] || '';
    return `<h3>配色</h3>
      <p class="anote">留白＝用原本的顏色，按 × 可以還原單一項。這裡設的會蓋過商店買的主題。
        （純黑 #000000 會被當成「沒選」—— 真的要純黑請寫在下面的自訂 CSS。）</p>
      <div class="agrid">${VARS.map(([k, name]) => `<div class="arow" style="margin:0">
        <label style="min-width:auto;flex:1">${esc(name)} <span class="tiny">${k}</span></label>
        <input class="ain" type="color" data-v="${k}" value="${cur(k) || '#000000'}">
        <button class="btn sm ghost" data-aclearvar="${k}">×</button></div>`).join('')}</div>
      <div class="btnrow"><button class="btn primary" data-a="saveVars">套用配色</button>
        <button class="btn sm ghost" data-a="resetVars">全部還原</button></div>
      <h3 style="margin-top:16px">自訂 CSS</h3>
      <p class="anote">直接寫 CSS，可以改任何版面（字級、圓角、隱藏某個區塊…）。寫壞了按「清空」就好。</p>
      <textarea class="ain atxt" data-css>${esc(c.css)}</textarea>
      <div class="btnrow"><button class="btn primary" data-a="saveCss">套用 CSS</button>
        <button class="btn sm ghost" data-a="clearCss">清空</button></div>`;
  }

  // ---- 存檔原始碼 ----
  function tabData() {
    let raw = '';
    try { raw = JSON.stringify(S().load(), null, 2); } catch (e) { raw = '（讀不出來：' + e.message + '）'; }
    return `<h3>整包存檔（JSON）</h3>
      <p class="anote">改完按「寫回存檔」會重新整理。格式錯的話不會寫進去，會直接告訴你哪裡壞了。</p>
      <textarea class="ain atxt" style="min-height:280px" data-raw>${esc(raw)}</textarea>
      <div class="btnrow">
        <button class="btn primary" data-a="saveRaw">寫回存檔</button>
        <button class="btn sm" data-a="dlRaw">下載備份</button>
      </div>
      <h3 style="margin-top:16px">管理員設定</h3>
      <div class="arow"><label>PIN</label>
        <input class="ain" data-f="pin" value="${esc(load().pin)}" placeholder="留白＝不用密碼">
        <button class="btn sm" data-a="savePin">設定</button></div>
      <p class="anote">PIN 只是防手滑，不是安全機制 —— 資料在瀏覽器裡，開 F12 一樣看得到。</p>
      <div class="btnrow">
        <button class="btn sm ghost" data-a="lock">關閉管理員模式（收起 🛠）</button>
        <button class="btn sm ghost adanger" data-a="wipeAdmin">清掉所有管理員設定</button>
      </div>`;
  }

  // ---- 跳畫面 ----
  const SCREENS = [['home', '首頁／地圖'], ['report', '成績單'], ['shop', '商店'], ['bag', '背包'],
  ['sweep', '快速篩選'], ['practice', '自由練習'], ['browse', '字庫瀏覽'], ['badges', '成就牆'],
  ['records', '作答紀錄'], ['settings', '設定']];
  function tabGo() {
    return `<h3>直接開哪個畫面</h3>
      <div class="btnrow">${SCREENS.map(([id, name]) => `<button class="btn sm" data-ago="${id}">${esc(name)}</button>`).join('')}</div>
      <p class="anote">會關掉面板並跳過去（進行中的關卡會被中斷）。</p>`;
  }

  // ---------------- 面板事件 ----------------
  function onClick(ev) {
    const t = ev && ev.target;
    if (!t || typeof t.closest !== 'function') return;

    const tb = t.closest('[data-atab]');
    if (tb) { tab = tb.dataset.atab; return draw(); }

    const cheatBtn = t.closest('[data-acheat]');
    if (cheatBtn) return toggleCheat(cheatBtn.dataset.acheat);

    // 究極階梯：面板可以直接跳到任何一階（不用在那邊打一排加號）
    const ub = t.closest('[data-aultra]');
    if (ub) return setUltraTo(+ub.dataset.aultra);

    const star = t.closest('[data-astar]');
    if (star) return cycleStar(star.dataset.astar);
    const lvb = t.closest('[data-alv]');
    if (lvb) return levelAction(lvb.dataset.alv);

    const it = t.closest('[data-aitem]');
    if (it) return bump('item', it.dataset.aitem);
    const mt = t.closest('[data-amat]');
    if (mt) return bump('mat', mt.dataset.amat);
    const ch = t.closest('[data-achest]');
    if (ch) return bump('chest', ch.dataset.achest);

    const sh = t.closest('[data-ashop]');
    if (sh) return shopAction(sh.dataset.ashop);
    const qd = t.closest('[data-aquest]');
    if (qd) {
      const id = qd.dataset.aquest;
      const cur = (S().day().quests || {})[id];
      S().setQuestDone(id, !cur);
      return draw();
    }
    const bd = t.closest('[data-abadge]');
    if (bd) {
      const id = bd.dataset.abadge;
      S().setBadge(id, !(S().profile.badges || []).includes(id));
      return draw();
    }
    const fx = t.closest('[data-afix]');
    if (fx) {
      const i = +fx.dataset.afix;
      const out = S().fixMisclick(i);
      const ww = (window.VOCAB || [])[i] || {};
      toast(out ? `「${ww.w}」已改成答對（box ${out.box}，${out.due} 再複習）` : '找不到這個字的答錯紀錄');
      redrawApp();
      return draw();
    }
    const sr = t.closest('[data-asaverec]');
    if (sr) return saveRecord(+sr.dataset.asaverec);
    const fg = t.closest('[data-aforget]');
    if (fg) {
      const i = +fg.dataset.aforget;
      delete S().load().words[i];
      S().save(true);
      toast('已變回沒學過');
      return draw();
    }
    const sw = t.closest('[data-asaveword]');
    if (sw) return saveWord(+sw.dataset.asaveword);
    const rv = t.closest('[data-arevert]');
    if (rv) { delete load().words[rv.dataset.arevert]; save(); toast('已還原（重新整理後生效）'); return draw(); }

    const dt = t.closest('[data-adeltext]');
    if (dt) { load().texts.splice(+dt.dataset.adeltext, 1); save(); redrawApp(); return draw(); }
    const cv = t.closest('[data-aclearvar]');
    if (cv) { delete load().vars[cv.dataset.aclearvar]; save(); applyStyle(); return draw(); }

    const go = t.closest('[data-ago]');
    if (go) { const where = go.dataset.ago; close(); return A().nav ? A().nav(where) : null; }

    const a = t.closest('[data-a]');
    if (a) return act(a.dataset.a);
  }

  function bump(kind, spec) {
    const s = S();
    const cut = spec.lastIndexOf(':');
    const id = spec.slice(0, cut), n = +spec.slice(cut + 1);
    if (kind === 'item') {
      const inv = s.inventory();
      inv[id] = Math.max(0, (inv[id] || 0) + n);
      if (!inv[id]) delete inv[id];
      s.save(true);
    } else if (kind === 'mat') {
      s.addMat(id, n);
    } else {
      if (n > 0) for (let k = 0; k < n; k++) s.addChest(id, '管理員');
      else {
        const row = s.chestBag().slice().reverse().find(x => x.tier === id);
        if (row) s.takeChest(row.id);
      }
    }
    draw();
  }

  function shopAction(spec) {
    const s = S();
    const cut = spec.indexOf(':');
    const what = spec.slice(0, cut), id = spec.slice(cut + 1);
    const inv = s.inventory();
    if (what === 'give') { inv[id] = (inv[id] || 0) + 1; s.save(true); }
    if (what === 'take') {
      inv[id] = Math.max(0, (inv[id] || 0) - 1);
      if (!inv[id]) delete inv[id];
      s.save(true);
    }
    if (what === 'equip') {
      if (!inv[id]) inv[id] = 1;                 // 沒有的東西也能直接裝備：先給再裝
      s.equip(id);
      if (A().applyTheme) A().applyTheme();
    }
    if (what === 'price') s.setPrice(id, val(`[data-price="${id}"]`));
    if (what === 'deal') {
      const cur = Array.isArray(s.settings.dealOverride) ? s.settings.dealOverride.slice() : s.dealsToday().map(d => d.id);
      const k = cur.indexOf(id);
      k < 0 ? cur.push(id) : cur.splice(k, 1);
      s.setDeals(cur);
    }
    draw();
  }

  function cycleStar(spec) {
    const [lvStr, L] = spec.split(':');
    const lv = +lvStr, s = S(), root = s.load();
    root.map = root.map || {};
    const key = lv + ':' + L;
    const m = root.map[key] = root.map[key] || { cleared: false, stars: 0, tries: 0, best: 0 };
    m.stars = ((m.stars || 0) + 1) % 4;
    m.cleared = m.stars > 0;
    s.save(true);
    draw();
  }

  function levelAction(spec) {
    const [what, lvStr] = spec.split(':');
    const lv = +lvStr, s = S(), root = s.load();
    root.map = root.map || {};
    let n = 0;
    s.LETTERS.forEach(L => {
      const ids = s.bucket(lv, L);
      if (!ids.length) return;
      const key = lv + ':' + L;
      if (what === 'stars') { root.map[key] = Object.assign({ tries: 0, best: 1 }, root.map[key], { cleared: true, stars: 3 }); n++; }
      if (what === 'clear') { delete root.map[key]; n++; }
      if (what === 'known') {
        const due = s.addDays(s.todayStr(), 30);
        ids.forEach(i => {
          const r = root.words[i] || (root.words[i] = { b: 0, due: null, s: 0, r: 0, wr: 0, fr: 0, fs: 0 });
          r.b = 5; r.due = due;
          n++;
        });
      }
      if (what === 'unknown') { ids.forEach(i => { if (root.words[i]) { delete root.words[i]; n++; } }); }
    });
    s.save(true);
    toast(`第 ${lv} 級：處理了 ${n} 筆`);
    draw();
  }

  function saveWord(i) {
    const V = window.VOCAB, w = V[i];
    if (!w) return;
    const patch = {};
    ['w', 'p', 'tr', 'ph'].forEach(k => { patch[k] = val(`[data-w="${k}:${i}"]`); });
    patch.lv = Math.max(1, Math.min(6, num(`[data-w="lv:${i}"]`) || w.lv));
    if (!patch.w.trim()) return toast('單字不能空白');
    patch.w = patch.w.trim();
    load().words[i] = patch;
    save();
    Object.assign(w, patch);
    toast(`#${i} 已存（改了級別或字首要重新整理才會重排地圖）`);
    draw();
  }

  /** 直接改一個字的作答數值。首次答對不能超過首次作答，否則正確率會算出超過 100%。 */
  function saveRecord(i) {
    const r = (S().load().words || {})[i];
    if (!r) return toast('這個字還沒有紀錄');
    r.b = Math.max(0, Math.min(6, num(`[data-r="b:${i}"]`)));
    r.r = Math.max(0, num(`[data-r="r:${i}"]`));
    r.wr = Math.max(0, num(`[data-r="wr:${i}"]`));
    r.fs = Math.max(0, num(`[data-r="fs:${i}"]`));
    r.fr = Math.max(0, Math.min(r.fs, num(`[data-r="fr:${i}"]`)));
    r.s = r.r + r.wr;
    const due = val(`[data-r="due:${i}"]`).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) r.due = due;
    S().save(true);
    toast('學習數值已更新');
    draw();
  }

  function addWord() {
    const w = val('[data-nw="w"]').trim();
    if (!w) return toast('請填單字');
    const row = {
      w,
      p: val('[data-nw="p"]').trim() || 'n.',
      lv: Math.max(1, Math.min(6, num('[data-nw="lv"]') || 6)),
      tr: val('[data-nw="tr"]').trim(),
    };
    if (!/^[A-Za-z]/.test(row.w)) return toast('單字要以英文字母開頭（地圖是照字首分關的）');
    load().added.push(row);
    save();
    toast(`已新增「${row.w}」，重新整理後進入地圖`);
    draw();
  }

  function act(a) {
    const s = S(), c = load();
    if (a === 'close') return close();
    if (a === 'secretDiff') return toggleSecret();
    if (a === 'pinOk') {
      if (val('[data-pin]') !== c.pin) return toast('PIN 不對');
      authed = true;
      return draw();
    }
    if (a === 'savePlayer') {
      const p = s.profile;
      p.xp = Math.max(0, num('[data-f="xp"]'));
      p.coins = Math.max(0, num('[data-f="coins"]'));
      p.streak = Math.max(0, num('[data-f="streak"]'));
      p.bestStreak = Math.max(0, num('[data-f="bestStreak"]'));
      p.winStreak = Math.max(0, num('[data-f="winStreak"]'));
      p.bestCombo = Math.max(0, num('[data-f="bestCombo"]'));
      s.save(true);
      toast('已套用');
      redrawApp();
      return draw();
    }
    if (a === 'setLevel') {
      const lv = Math.max(1, num('[data-f="level"]'));
      const box = panelEl.querySelector('[data-f="claim"]');
      s.profile.xp = (lv - 1) * s.XP_PER_LEVEL;
      if (!(box && box.checked)) s.profile.rewardedLevel = lv;   // 不補發：直接標記成已領到這一等
      s.save(true);
      toast(`已跳到 Lv.${lv}`);
      redrawApp();
      return draw();
    }
    if (a === 'xp1000') { s.profile.xp = (s.profile.xp || 0) + 1000; s.save(true); redrawApp(); return draw(); }
    if (a === 'coin5000') { s.addCoins(5000); redrawApp(); return draw(); }
    if (a === 'allBadges') { s.profile.badges = s.BADGES.map(b => b.id); s.save(true); toast('全部成就已解鎖'); return draw(); }
    if (a === 'noBadges') { s.profile.badges = []; s.save(true); toast('成就已清空'); return draw(); }

    if (a === 'shopAll') {
      const inv = s.inventory();
      s.SHOP.forEach(it => { if (!inv[it.id]) inv[it.id] = 1; });
      s.save(true);
      toast(`${s.SHOP.length} 件商品都給你了`);
      return draw();
    }
    if (a === 'shopFree') { s.SHOP.forEach(it => s.setPrice(it.id, 0)); toast('全部商品變成 0 元'); return draw(); }
    if (a === 'shopReset') { s.clearPrices(); toast('價格已還原'); return draw(); }
    if (a === 'dealAuto') { s.setDeals(null); toast('回到每天自動抽特價'); return draw(); }
    if (a === 'dealNone') { s.setDeals([]); toast('今天沒有特價'); return draw(); }
    if (a === 'questAll') { s.questStatus().forEach(q => s.setQuestDone(q.id, true)); toast('今日任務全部標成完成'); return draw(); }
    if (a === 'questNone') { s.questStatus().forEach(q => s.setQuestDone(q.id, false)); return draw(); }
    if (a === 'checkinNow') {
      const r = s.checkIn();
      toast(r ? `已簽到：+${r.xp} XP、+${r.coin} 🪙` : '今天已經簽到過了');
      redrawApp();
      return draw();
    }
    if (a === 'checkinReset') { s.resetCheckin(); toast('今天的簽到已清掉'); return draw(); }

    if (a === 'search') { wordQ = val('[data-q]'); return draw(); }
    if (a === 'addWord') return addWord();
    if (a === 'clearWords') { c.words = {}; c.added = []; save(); toast('單字修改已清掉，重新整理後生效'); return draw(); }
    if (a === 'reload') return reloadPage();

    if (a === 'saveTexts') {
      c.texts = c.texts.map((r, k) => ({ from: val(`[data-t="from:${k}"]`), to: val(`[data-t="to:${k}"]`) }))
        .filter(r => r.from);
      save();
      redrawApp();
      toast('文字已套用');
      return draw();
    }
    if (a === 'addText') {
      const from = val('[data-nt="from"]');
      if (!from) return toast('請填原文');
      c.texts.push({ from, to: val('[data-nt="to"]') });
      save();
      redrawApp();
      return draw();
    }

    if (a === 'saveVars') {
      VARS.forEach(([k]) => {
        const el = panelEl.querySelector(`[data-v="${k}"]`);
        const v = el ? String(el.value || '') : '';
        // 沒動過的欄位是預設黑，不當成「使用者選了黑色」，否則整個介面會變成黑底黑字
        if (v && v.toLowerCase() !== '#000000') c.vars[k] = v;
      });
      save(); applyStyle(); toast('配色已套用');
      return draw();
    }
    if (a === 'resetVars') { c.vars = {}; save(); applyStyle(); return draw(); }
    if (a === 'saveCss') { c.css = val('[data-css]'); save(); applyStyle(); toast('CSS 已套用'); return draw(); }
    if (a === 'clearCss') { c.css = ''; save(); applyStyle(); return draw(); }

    if (a === 'saveRaw') {
      const raw = val('[data-raw]');
      let obj;
      try { obj = JSON.parse(raw); }
      catch (e) { return toast('JSON 格式有問題：' + e.message); }
      if (!obj || typeof obj !== 'object' || !obj.profile) return toast('這看起來不是存檔（少了 profile）');
      localStorage.setItem(GAME_KEY, JSON.stringify(obj));
      toast('已寫回，重新整理…');
      return reloadPage();
    }
    if (a === 'dlRaw') {
      const name = `vocabQuest-admin-${s.todayStr()}.json`;
      dl(name, JSON.stringify(s.load(), null, 2));
      return;
    }
    if (a === 'savePin') { c.pin = val('[data-f="pin"]').trim(); save(); authed = true; toast(c.pin ? 'PIN 已設定' : 'PIN 已取消'); return draw(); }
    if (a === 'lock') {
      c.unlocked = false; authed = false; save();
      close();
      const fabEl = document.querySelector('.adminfab');
      if (fabEl) fabEl.remove();
      return toast('已關閉管理員模式（密技或連點標題可再開）');
    }
    if (a === 'wipeAdmin') {
      try { localStorage.removeItem(KEY); } catch (e) { /* 清不掉就算了 */ }
      cfg = null; authed = false;
      applyStyle();
      close();
      return reloadPage();
    }
  }

  function dl(name, textData) {
    if (!document.createElement || typeof Blob !== 'function' || !window.URL) return;
    const url = URL.createObjectURL(new Blob([textData], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 改完數值之後把底下的畫面重畫一次（頂端列的 XP／金幣才會跟著變）。
      app.js 的 render() 是整個換掉 body，會把面板一起洗掉 —— 所以先關再重開，
      不然接下來的 draw() 會畫在一個已經離開畫面的節點上（看起來就是「按了沒反應」）。 */
  function redrawApp() {
    const app = A();
    if (!app.home) return;
    // 關卡進行中絕對不能重畫：home() 會把作答畫面整個換掉，等於把人踢出關卡
    const r = window.__run && window.__run();
    if (r && r.inStage) return;
    const was = !!panelEl;
    close();
    app.home();
    if (was) open();
  }

  // ---------------- 啟動 ----------------
  applyWords();
  applyStyle();

  window.Admin = { text, afterRender, open, close, load, applyStyle, unlocked: () => load().unlocked };
})();
