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
    { code: CODE, name: '管理員面板', run: () => enter() },
    { code: 'IDDQD'.split(''), name: '無敵', run: () => toggleCheat('god') },
    { code: 'EXTRA'.split(''), name: '究極難度', run: () => toggleSecret() },
  ];
  const prog = SEQS.map(() => 0);
  let taps = 0, tapAt = 0, authed = false;

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
    SEQS.forEach((s, n) => {
      // 完全比對：'B' 只認大寫 B，小寫 b 不算（方向鍵本來就是 'ArrowUp' 這種完整字串）
      if (k === s.code[prog[n]]) prog[n]++;
      else prog[n] = (k === s.code[0] ? 1 : 0);
      if (prog[n] >= s.code.length) { prog[n] = 0; s.run(); }
    });
  }, true);

  function toggleCheat(k) {
    const on = !S().cheat(k);
    S().setCheat(k, on);
    toast(on ? `😈 ${S().CHEAT_NAMES[k]} — 開` : `${S().CHEAT_NAMES[k]} — 關`);
    redrawApp();
    if (panelEl) draw();
  }
  function toggleSecret() {
    const s = S(), on = !s.secretDiff();
    s.setSecretDiff(on);
    if (A().applyTheme) A().applyTheme();          // 立刻把「燒起來」的外觀套上去／撤掉
    redrawApp();
    if (panelEl) draw();
    if (on) ultraBurst();
    else toast(`餘燼熄滅 —— 難度回到「${(s.DIFFICULTY[s.settings.difficulty] || {}).name || ''}」`);
  }

  /** 進究極模式的演出：先點火，再把規矩攤開來講。 */
  function ultraBurst() {
    const d = S().DIFFICULTY.ultra;
    if (!A().overlay) return toast('☠ 究極模式 —— 開');
    // 點火聲：低頻鋸齒往下沉，最後補一顆高音火花
    if (A().beep) {
      [[190, .5], [150, .55], [115, .6]].forEach(([f, t], k) => setTimeout(() => A().beep(f, t, 'sawtooth', .05), k * 130));
      setTimeout(() => A().beep(1400, .18, 'triangle', .04), 430);
    }
    A().overlay(`<div class="ultraburst">
      <div class="flame">究 極 模 式</div>
      <p class="muted" style="margin:10px 0 14px">整本字典開始燒。燒完之前，你只有一條命。</p>
      <div class="rule">🔥 <b>一顆心</b>　—　錯一題就結束</div>
      <div class="rule">🧨 時間 <b>×${d.time}</b>　—　每題有一條引信，燒完就算逾時</div>
      <div class="rule">📖 <b>新字直接考最難的</b>　—　沒有四選一可以猜</div>
      <div class="rule">✨ XP <b>×${d.xp}</b>　—　活著走出來才拿得到</div>
      <p class="tiny" style="margin-top:12px">其他難度已經鎖住。想回頭：再打一次大寫 <kbd>E</kbd><kbd>X</kbd><kbd>T</kbd><kbd>R</kbd><kbd>A</kbd>。</p>
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
    ['cheat', '😈 作弊選單'], ['player', '玩家數值'], ['items', '道具素材'], ['map', '闖關進度'],
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
    const d = s.DIFFICULTY.ultra;
    const on = s.secretDiff();
    const sw = (id, name, isOn, note) => `<div class="aword">
      <div class="arow" style="margin:0">
        <b style="flex:1">${esc(name)}</b>
        <button class="btn sm ${isOn ? 'primary' : 'ghost'}" data-acheat="${id}">${isOn ? '● 開著' : '○ 關著'}</button>
      </div>
      <p class="anote" style="margin:4px 0 0">${note}</p></div>`;
    return `<h3>☠ 究極模式</h3>
      <div class="aword">
        <div class="arow" style="margin:0">
          <b style="flex:1">究極（${d.hearts} 顆心 ・ 時間 ×${d.time} ・ XP ×${d.xp}）</b>
          <button class="btn sm ${on ? 'primary' : 'ghost'}" data-a="secretDiff">${on ? '● 強制中' : '○ 關著'}</button>
        </div>
        <p class="anote" style="margin:4px 0 0">${esc(d.desc)}。
          <b>這不是多一個選項，是一個模式：打開就強制究極</b>，其他四檔會被鎖住按不動，
          關掉才會回到你原本玩的難度。它是正常玩法，不是作弊 —— XP ×${d.xp} 實打實。</p>
      </div>

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
        <kbd>E</kbd><kbd>X</kbd><kbd>T</kbd><kbd>R</kbd><kbd>A</kbd> → 切換究極模式<br>
        <kbd>↑</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><kbd>←</kbd><kbd>→</kbd><kbd>B</kbd><kbd>A</kbd> → 這個面板（B、A 也要大寫）</p>`;
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
    </div>`;
    return `<h3>找字來改</h3>
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
