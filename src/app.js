/* 畫面、闖關流程、成績單。 */
(function () {
  'use strict';
  const S = window.Store, Q = window.Quiz;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const V = () => window.VOCAB;
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  /* Yahoo 奇摩字典的查詢連結。
     為什麼是「連過去」而不是「把翻譯抄進來」：那些詞義是 Yahoo 向字典商（譯典通）
     授權的內容，整批抓下來放進公開 repo 等於重新散布別人的授權資料。
     連過去則是完全乾淨的做法，而且永遠是最新、最完整的（含例句與詞性分類）。 */
  const dictUrl = w => 'https://tw.dictionary.search.yahoo.com/search?p=' + encodeURIComponent(Q.base(String(w || '')));
  const dictLink = (w, cls) => `<a class="${cls || 'btn sm ghost'} dict" href="${esc(dictUrl(w))}" target="_blank" rel="noopener">🔍 Yahoo 字典</a>`;
  const dictMini = w => `<a class="dictmini" href="${esc(dictUrl(w))}" target="_blank" rel="noopener" title="查 Yahoo 奇摩字典">🔍</a>`;

  /** 秒數 → 「3 分 12 秒」。關卡使用時間、作答紀錄都用這個格式。 */
  const fmtSec = s => {
    s = Math.max(0, Math.round(s || 0));
    return s >= 60 ? `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒` : `${s} 秒`;
  };
  /** ISO 時間 → 本地 HH:MM。 */
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  /* 迷因台詞：讀久了會累，在結算／回饋／開箱這些抬頭喘口氣的地方放一句。
     設定頁可以關掉；關掉之後所有呼叫都回空字串，不影響版面。 */
  /* 洗牌袋：同一個情境的台詞會全部輪過一遍才可能重複，
     不然隨機抽很容易連續看到同一句（那就不好笑了）。 */
  const memeBag = {}, memeLast = {};
  function memeLine(key, sub) {
    if (!S.settings.memes) return '';
    const M = window.MEMES || {};
    let list = M[key];
    if (sub && list && !Array.isArray(list)) list = list[sub];
    if (!Array.isArray(list) || !list.length) return '';
    const id = key + (sub ? ':' + sub : '');
    let bag = memeBag[id];
    if (!bag || !bag.length || bag.total !== list.length) {
      bag = Q.shuffle(list.map((_, k) => k));
      bag.total = list.length;
      // 換新袋子時，別讓「上一句」剛好排在最前面 —— 否則會出現連續兩次同一句
      if (list.length > 1 && bag[bag.length - 1] === memeLast[id]) {
        const j = Math.floor(Math.random() * (bag.length - 1));
        [bag[bag.length - 1], bag[j]] = [bag[j], bag[bag.length - 1]];
      }
      memeBag[id] = bag;
    }
    const idx = bag.pop();
    memeLast[id] = idx;
    return list[idx];
  }
  /** 首頁每日一句：用日期當種子，一天固定一句（重整不會換）。 */
  function memeDaily() {
    if (!S.settings.memes) return '';
    const list = (window.MEMES || {}).daily || [];
    if (!list.length) return '';
    const t = S.todayStr();
    let h = 0;
    for (let k = 0; k < t.length; k++) h = (h * 31 + t.charCodeAt(k)) >>> 0;
    return list[h % list.length];
  }
  const memeTag = (key, sub) => {
    const m = memeLine(key, sub);
    return m ? `<div class="meme">${esc(m)}</div>` : '';
  };

  /** 進度條：一行標題＋數字＋條。首頁與紀錄頁共用。 */
  function bar(label, cur, max, note, cls) {
    const pct = max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0;
    return `<div class="prow">
      <div class="ptop"><span>${label}</span><b>${note == null ? `${cur}/${max}` : note}</b></div>
      <div class="xpbar${cls ? ' ' + cls : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>
    </div>`;
  }

  // ---------------- 音效 / 發音 ----------------
  let actx = null;
  function beep(freq, dur, type, vol) {
    if (!S.settings.sfx) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = vol == null ? 0.06 : vol;
      o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (e) { /* 音效失敗不影響學習 */ }
  }
  const sfx = {
    ok() { beep(880, .12); setTimeout(() => beep(1320, .12), 90); },
    no() { beep(200, .22, 'sawtooth', .05); },
    lvl() { [660, 880, 1100, 1320].forEach((f, k) => setTimeout(() => beep(f, .16), k * 90)); },
    dead() { [400, 300, 200, 130].forEach((f, k) => setTimeout(() => beep(f, .28, 'sawtooth', .05), k * 130)); },
    clear() { [523, 659, 784, 1047].forEach((f, k) => setTimeout(() => beep(f, .2), k * 110)); },
  };
  let voices = [];
  function loadVoices() { voices = (window.speechSynthesis && speechSynthesis.getVoices()) || []; }
  if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  /** 挑最好的英語聲音：優先 Windows 11 的 Natural／Neural 語音，再來才是一般 en-US。 */
  function pickVoice() {
    const en = voices.filter(v => /^en/i.test(v.lang));
    if (!en.length) return null;
    const score = v => {
      const n = (v.name || '') + ' ' + (v.lang || '');
      let s = 0;
      if (/natural|neural|online/i.test(n)) s += 6;      // 音質明顯較好
      if (/US|United States/i.test(n)) s += 3;
      if (/Aria|Jenny|Guy|Michelle|Zira|David/i.test(n)) s += 2;
      if (/eSpeak|Compact/i.test(n)) s -= 4;             // 機械音，rice/raise 這種真的分不出來
      return s;
    };
    return en.slice().sort((a, b) => score(b) - score(a))[0];
  }

  function say(text, opt) {
    if (!S.settings.tts || !window.speechSynthesis || !text) return;
    const o = opt || {};
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = pickVoice();
      u.lang = (u.voice && u.voice.lang) || 'en-US';
      // 預設放慢：學生要聽清楚每個音節，不是聽母語者的正常語速
      // 設定頁的滑桿存的是百分比（75 = 0.75 倍速）
      const raw = S.settings.speechRate;
      const base = Math.max(0.5, Math.min(1.2, (raw > 2 ? raw / 100 : raw) || 0.75));
      u.rate = Math.max(0.3, o.rate ? o.rate : base);
      u.pitch = 1; u.volume = 1;
      speechSynthesis.speak(u);
      // 聽力題可以自動再唸一次（rice / raise 這種只聽一次真的分不出來）
      if (o.twice) {
        const u2 = new SpeechSynthesisUtterance(text);
        u2.voice = u.voice; u2.lang = u.lang; u2.rate = u.rate; u2.pitch = 1; u2.volume = 1;
        setTimeout(() => { try { speechSynthesis.speak(u2); } catch (e) { /* 忽略 */ } }, 900);
      }
    } catch (e) { /* 沒有語音引擎就安靜略過 */ }
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2100);
  }
  function overlay(html, onClose) {
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = adminText(`<div class="box card">${html}</div>`);
    o.addEventListener('click', e => {
      const act = e.target.closest('[data-close]');
      if (act) { o.remove(); if (onClose) onClose(act.dataset.close); }
    });
    document.body.appendChild(o);
    return o;
  }

  // ---------------- 版面 ----------------
  let atHome = false;
  let backStack = [];                 // 左上角「返回」用：記住上一層畫面
  function setBack(list) { backStack = list || []; }
  function goBack() {
    const fn = backStack.pop();
    if (typeof fn === 'function') return fn();
    home();
  }
  function topbar() {
    const p = S.profile, st = S.stats();
    const inLv = S.xpInLevel(p.xp), pct = Math.round(inLv / S.XP_PER_LEVEL * 100);
    const ws = S.winStreak();
    return `<div class="topbar"><div class="topbar-in">
      <div class="brand">單字<span>闖關</span>${(() => { const ti = S.equipped('title'); const it = ti && S.shopItem(ti); return it ? ` <span class="tiny" style="color:var(--gold)">${esc(it.name.replace('稱號：', ''))}</span>` : ''; })()}</div>
      <div class="spacer"></div>
      <span class="chip streak">🔥 ${p.streak} 天</span>
      ${ws >= 2 ? `<span class="chip win">⚡ ${ws} 連勝</span>` : ''}
      <span class="chip lvl">Lv.${st.level}</span>
      <span class="chip xp">${p.xp} XP</span>
      <span class="chip coin">🪙 ${S.coins()}</span>
      ${(() => { const n = S.chestBagSummary().total; return n ? `<span class="chip" style="color:var(--gold)">🎁 ${n}</span>` : ''; })()}
    </div><div class="topbar-in"><div class="xpbar" style="flex:1"><i style="width:${pct}%"></i></div></div></div>`;
  }
  /** 頁首：返回鈕貼在標題旁邊，右上角是設定齒輪（關卡中用來暫停／離開）。 */
  function pageHead(title, opts) {
    const o = opts || {};
    return `<div class="phead">
      ${o.back ? '<button class="btn sm ghost" data-act="back">←</button>' : ''}
      <h2>${title}</h2>
      <div class="spacer"></div>
      ${o.gear ? '<button class="btn sm ghost gear" data-act="gear">⚙</button>' : ''}
    </div>`;
  }

  /* 每個畫面至少要有一個出路。曾經因為結算畫面只放一顆「開寶箱」，
     箱子開完那顆鈕被換掉之後整個畫面沒有任何按鈕 —— 直接卡死。
     這個保險絲會在偵測到沒有任何可操作元素時補上「回首頁」。 */
  const WAYS_OUT = '[data-go],[data-act],[data-close],[data-openchest],[data-maplv],[data-mapletter],[data-startstage],[data-craft],[data-buy],[data-equip],[data-opt],[data-tile],[data-swpick],[data-swopt],[data-goalpreset],input,textarea';
  /* 管理員面板（src/admin.js，隱藏功能）掛在這裡：
     Admin.text() 套用「介面文字替換」，afterRender() 補回右下角的 🛠 浮動鈕
     —— 因為這一行會把整個 body 換掉，浮動鈕每次都會被洗掉。
     沒有載入 admin.js 時整段就當作不存在。 */
  const adminText = html => (window.Admin ? window.Admin.text(html) : html);
  function render(html, isHome) {
    atHome = !!isHome;
    if (isHome) backStack = [];
    document.body.innerHTML = adminText(topbar() + `<div class="wrap">${html}</div>`);
    if (!isHome) ensureWayOut();
    if (window.Admin) window.Admin.afterRender();
  }
  function ensureWayOut() {
    const wrap = document.querySelector('.wrap');
    if (!wrap || wrap.querySelector(WAYS_OUT)) return;
    const box = document.createElement('div');
    box.className = 'card';
    box.innerHTML = '<p class="muted">這個畫面沒有其他動作了。</p><div class="btnrow"><button class="btn primary" data-go="home">回首頁</button></div>';
    wrap.appendChild(box);
  }

  // ---------------- 首頁 ----------------
  /** 難度選擇鈕；建議難度會標出來，選到建議或更高才有 XP 適配加成。 */
  function diffPills() {
    const cur = S.settings.difficulty, rec = S.recommendDifficulty(), forced = S.diffForced();
    const lv = S.ultraLevel();
    const pills = S.diffList().map(id => {
      const d = S.DIFFICULTY[id];
      const off = forced && !d.secret;        // 究極模式強制中：其他四檔留在畫面上但按不動
      return `<button class="pill ${cur === id ? 'on' : ''}${d.secret ? ' secret' : ''}" data-diff="${id}"${off ? ' disabled' : ''}
        title="${esc(off ? '究極模式強制中 —— 要換難度請先關掉究極（再打一次 EXTRA）' : d.desc)}">${d.secret ? '☠ ' : ''}${esc(d.name)}${id === rec && !forced ? ' ⭐' : ''}</button>`;
    }).join('');
    if (!forced) return pills;
    // 究極階梯：站在第幾階、下一階怎麼上去（加號只爬得到這一段的頂），全部寫在同一行
    const d = S.diff();
    const next = lv < S.ultraSegEnd(lv)
      ? `　再打一個 <kbd>+</kbd> 上第 ${lv + 1} 階「${esc(S.ULTRA_NAMES[lv])}」`
      : lv < S.ULTRA_MAX ? '　這一段到頂了 —— 上面還有，但加號上不去' : '　已經站在最頂階';
    return pills + `<span class="tiny" style="align-self:center;color:var(--red)">☠ ${d.ash ? '灰燼' : '究極'}第 ${lv}/${S.ULTRA_MAX} 階（再打一次 ${esc(d.code.replace(/\+*$/, ''))} 解除）${next}</span>`;
  }

  /** 任務標籤的顏色類別（每種任務一個顏色，一眼看得出今天有哪幾種玩法）。 */
  const TAGC = { 基本: 'b-blue', 連擊: 'b-red', 題型: 'b-purple', 探索: 'b-green', 主打: 'b-gold', 每週: 'b-cyan', 每月: 'b-pink', 簽到: 'b-gold' };

  /** 一列任務：標籤＋名稱＋進度條＋獎勵。達成過就永久打勾，不會退回未完成。 */
  function questRow(q) {
    const pct = Math.max(0, Math.min(100, q.cur / q.goal * 100));
    return `<div class="quest ${q.done ? 'done' : ''}">
      <span class="qtagb ${TAGC[q.tag] || 'b-blue'}">${esc(q.tag || '任務')}</span>
      <div class="qmain">
        <b>${q.done ? '✓ ' : ''}${esc(q.name)}</b>
        <div class="qbar"><i style="width:${pct.toFixed(0)}%"></i></div>
        <span class="tiny">${esc(q.note)}${q.at ? `　・ ${fmtTime(q.at)} 達成` : ''}${q.claimed ? '　・ 已領獎' : q.done ? '　・ 下次結算入帳' : ''}</span>
      </div>
      <div class="qrew"><b>+${q.xp}</b><span>XP</span>${q.coin ? `<i>+${q.coin} 🪙</i>` : ''}</div>
    </div>`;
  }

  /* 衝刺目標的預設鈕：用「幾天」訂，不是用「這個範圍總共幾個字」訂 ——
     一個月 900 字是讀得完的，「明天之前背完全書」只會讓人第一天就放棄。 */
  function goalPresetBtns(primaryFirst) {
    return S.GOAL_PRESETS.map((p, k) => {
      const g = S.goalPreset(p.days);
      const add = Math.max(0, g.target - S.goalScope(g.scope).known);
      return `<button class="btn ${primaryFirst && !k ? 'primary' : ''}" data-goalpreset="${p.days}">📅 ${esc(p.name)}衝刺（再 ${add} 字）</button>`;
    }).join('');
  }

  /** 衝刺目標卡：倒數幾天、今天該學幾個字、落後多少。沒訂目標時給快速設定鈕。 */
  function goalCard() {
    const g = S.goalStat();
    if (!g.on) {
      return `<div class="card goalcard off">
        <h2>🎯 還沒訂衝刺目標</h2>
        <p class="muted">訂一個「哪天之前學會幾個字」，網站每天會自己算出今天要學幾個 —— 落後了數字會變大，不用手動改計畫。</p>
        <div class="btnrow">${goalPresetBtns(true)}
          <button class="btn ghost" data-go="settings">自己設</button>
        </div>
        <p class="tiny">預設是「正常速度讀得完」的量（一天 ${S.GOAL_PACE} 個新字，含複習大約 ${S.GOAL_PACE}–${Math.round(S.GOAL_PACE * 1.4)} 分鐘）。範圍、字數、期限都能在設定頁改。</p>
      </div>`;
    }
    const scopeName = g.scope === 'all' ? '全書' : `第 ${g.scope} 級`;
    const ok = g.todayNew >= (g.perDay || 0);
    return `<div class="card goalcard ${g.done ? 'done' : ok ? 'ontrack' : 'todo'}">
      <h2>🎯 衝刺目標 <span class="tiny">${scopeName} ${g.target} 字 ・ ${g.until} 前</span></h2>
      ${g.done ? `<p class="muted" style="color:var(--ac)">🏆 目標達成！${scopeName} ${g.target} 字已經全部學會。</p>` : `
      <div class="goalrow">
        <div class="gbig ${ok ? 'ok' : ''}">
          <b>${ok ? '✓' : g.todayLeft}</b>
          <span>${ok ? '今天的量做完了' : '今天還要學幾個字'}</span>
        </div>
        <div class="gside">
          <div class="tiny">今天目標 <b style="color:var(--gold)">${g.perDay}</b> 字　已學 <b style="color:var(--ac)">${g.todayNew}</b> 字</div>
          <div class="tiny">剩 <b style="color:var(--blue)">${g.daysLeft}</b> 天　還差 <b>${g.remain}</b> 字</div>
          <div class="tiny">≈ 每天 ${g.perDay} 字 = ${Math.ceil(g.perDay / 10)} 關，約 ${Math.round(g.perDay * 1.05)}–${Math.round(g.perDay * 1.6)} 分鐘</div>
        </div>
      </div>
      ${bar('今天的配額', Math.min(g.todayNew, g.perDay), g.perDay, `${g.todayNew}/${g.perDay} 字`, ok ? 'g-green' : 'g-red')}`}
      ${bar(`${scopeName}總進度`, g.known, g.target, `${g.known}/${g.target} 字　${Math.round(g.pct * 100)}%`, 'g-gold')}
      ${g.impossible ? `<p class="tiny" style="color:var(--red)">⚠ 目前的計畫要每天 ${g.perDay} 字（含複習大約 ${Math.round(g.perDay * 2.2)} 題、${Math.round(g.perDay / 60 * 1.3 * 60)} 分鐘以上）。
        這個量學不進去 —— 建議把期限往後延，或把範圍縮小成一個級別。</p>`
      : g.behind ? `<p class="tiny" style="color:var(--gold)">進度落後了：原訂每天 ${g.planned} 字，現在要每天 ${g.perDay} 字才追得上。</p>` : ''}
      <div class="btnrow"><button class="btn sm ghost" data-go="settings">改目標</button></div>
    </div>`;
  }

  /** 每日簽到軌道：7 天一輪，一天比一天多，第 7 天金寶箱。看得到後面有什麼才想連下去。 */
  function checkinCard(checkin, pg) {
    // 還沒簽到時，預覽的是「今天簽到會拿到什麼」＝連續天數 +1 的位置
    const streakIfCheck = checkin ? pg.streak : (pg.streak || 0) + 1;
    const pv = S.checkinPreview(streakIfCheck);
    const cells = pv.days.map(x => {
      const state = checkin && x.day === pv.today ? 'got' : x.state;
      const it = x.item && S.shopItem(x.item);
      return `<div class="ci ${state}">
        <span class="ciday">第 ${x.day} 天</span>
        <span class="ciicon">${x.chest ? '💎' : it ? '🧪' : state === 'got' ? '✅' : '✨'}</span>
        <span class="tiny">+${x.xp} XP</span>
        <span class="tiny gold">+${x.coin} 🪙</span>
        ${it ? `<span class="tiny">${esc(it.name)}</span>` : ''}
        ${x.chest ? '<span class="tiny gold">金寶箱</span>' : ''}
      </div>`;
    }).join('');
    return `<div class="card">
      <h2>每日簽到 <span class="tiny">第 ${pv.cycle} 輪 ・ 今天是第 ${pv.today}/7 天</span></h2>
      <p class="muted">${checkin
      ? `✅ 今日已簽到 <b style="color:var(--ac)">+${checkin.xp} XP　+${checkin.coin} 🪙</b>${checkin.item ? `　🧪 ${esc((S.shopItem(checkin.item) || {}).name || '')}` : ''}${checkin.chest ? '　💎 金寶箱' : ''}（${fmtTime(checkin.at)}）`
      : '通關任何一關就會自動簽到。同一輪裡一天比一天多，第 7 天直接給金寶箱。'}</p>
      ${checkin ? memeTag('checkin') : ''}
      <div class="citrack">${cells}</div>
      ${bar('本輪進度', pv.today, 7, `${pv.today}/7 天`, 'g-orange')}
      <p class="tiny">連續天數不中斷 → 進入下一輪，整輪獎勵再 ×1.15（最多 ×2）。
        ${pv.next ? `下一個里程碑：連續 <b style="color:var(--gold)">${pv.next}</b> 天（大量金幣＋道具＋外觀解鎖）` : ''}
        ${checkin && checkin.milestone ? `<br><b style="color:var(--purple)">🎉 里程碑達成：${esc(checkin.milestone.note)} +${checkin.milestone.xp} XP　+${checkin.milestone.coin} 🪙</b>` : ''}</p>
    </div>`;
  }

  let qtab = 'day';                    // 任務看板目前的分頁
  function questBoard(t) {
    const list = qtab === 'day' ? S.questStatus(t)
      : qtab === 'week' ? S.periodQuestStatus('week', t) : S.periodQuestStatus('month', t);
    const done = list.filter(q => q.done).length;
    const tabs = [['day', '每日'], ['week', '每週'], ['month', '每月']].map(([k, n]) => {
      const l = k === 'day' ? S.questStatus(t) : S.periodQuestStatus(k, t);
      return `<button class="pill ${qtab === k ? 'on' : ''}" data-qtab="${k}">${n} ${l.filter(q => q.done).length}/${l.length}</button>`;
    }).join('');
    const sp = list.find(q => q.tag === '主打');
    // 沒完成的排前面；完成的收到下面（挑戰任務領完會自動換新的，不會一直掛在那）
    const todo = list.filter(q => !q.done);
    const finished = list.filter(q => q.done);
    return `<div class="card">
      <h2>任務看板 <span class="tiny">${done}/${list.length} 達成</span></h2>
      <div class="pills">${tabs}</div>
      ${bar('本頁任務達成度', done, list.length, `${done}/${list.length}`, 'g-gold')}
      ${todo.length ? `<div class="quests">${todo.map(questRow).join('')}</div>`
      : '<p class="muted" style="margin-top:10px">🎉 這一頁的任務都完成了！</p>'}
      ${finished.length ? `<h3 style="margin-top:14px">✅ 已完成 ${finished.length} 項</h3>
        <div class="quests done-list">${finished.map(questRow).join('')}</div>` : ''}
      ${sp && !sp.done ? `<div class="btnrow"><button class="btn gold" data-mapletter="${sp.lv}:${sp.letter}">🎯 直接去主打關（第 ${sp.lv} 級 ${sp.letter}）</button></div>` : ''}
      <p class="tiny">達成就永久記住（時間記在紀錄裡），不會因為之後數字變動而退回未完成。獎勵在關卡結算時自動入帳。
        <b>挑戰任務（連擊／題型／探索）領獎後會自動換上下一個</b>，看板不會一直掛著做完的東西。</p>
    </div>`;
  }

  function home() {
    const p = S.profile, st = S.stats(), t = S.todayStr();
    const d = S.day(t);
    const due = S.dueList().length;
    const dd = S.diff(), rec = S.recommendDifficulty(), acc = S.recentAccuracy(3);
    const pg = S.progress();
    const dayQ = S.questStatus(t);
    const checkin = d.checkin;
    const sum = S.summary(t);
    const todaySec = S.runSeconds(t);

    const lvRows = [1, 2, 3, 4, 5, 6].map(lv => {
      const ls = S.levelStat(lv);
      const pct = ls.total ? Math.round(ls.known / ls.total * 100) : 0;
      const crown = ls.cleared === ls.playable && ls.playable;
      return `<div class="stage lv${lv} ${crown ? 'crowned' : ''}" data-maplv="${lv}">
        <div class="hex">${lv}</div>
        <div class="t"><b>第 ${lv} 級大關 ${crown ? '👑' : ''}</b>
          <span class="tiny">${ls.cleared}/${ls.playable} 個字母關通過　・　已學會 ${ls.known}/${ls.total} 字</span>
          <div class="xpbar g-lv${lv}" style="margin-top:6px"><i style="width:${pct}%"></i></div></div>
        <div class="stars">${pct}%</div>
      </div>`;
    }).join('');

    render(`
      <div class="card hero">
        <h2>冒險進度 <span class="tiny">${t}（${WD[new Date().getDay()]}）</span></h2>
        ${(() => { const dm = memeDaily(); return dm ? `<div class="meme daily">今日廢話：${esc(dm)}</div>` : ''; })()}
        <div class="grid2">
          <div class="stat ok"><b>${pg.known}</b><span>已學會的字</span></div>
          <div class="stat blue"><b>${pg.mastered}</b><span>進長期記憶</span></div>
          <div class="stat gold"><b>${pg.cleared}/${pg.stages}</b><span>字母關通過</span></div>
          <div class="stat purple"><b>${pg.stars}</b><span>累積星星</span></div>
        </div>
        <div class="bars">
          ${bar('📚 單字總進度', pg.known, pg.total, `${pg.known}/${pg.total}　${(pg.pct * 100).toFixed(1)}%`, 'g-green')}
          ${bar('🗺 關卡通關進度', pg.cleared, pg.stages, `${pg.cleared}/${pg.stages}　${Math.round(pg.stagePct * 100)}%`, 'g-gold')}
          ${bar(`⭐ 等級 Lv.${pg.level} → Lv.${pg.level + 1}`, pg.inLevel, pg.perLevel, `還差 ${pg.need} XP`, 'g-purple')}
          ${bar('🎯 今日任務', dayQ.filter(q => q.done).length, dayQ.length, `${dayQ.filter(q => q.done).length}/${dayQ.length} 達成`, 'g-cyan')}
        </div>
        <p class="tiny">🔥 連續學習 ${pg.streak} 天　⚡ ${S.winStreak()} 連勝（最佳 ${S.bestWinStreak()}）　⏱ 今天已學 ${fmtSec(todaySec)}　✍ 今日 ${sum.reviewTotal + sum.applyTotal} 題</p>
      </div>

      ${(() => {
        const cb = S.chestBagSummary();
        if (!cb.total) return '';
        return `<div class="card chestcard">
          <h2>🎁 背包裡有 ${cb.total} 個沒開的寶箱</h2>
          <div class="chestrow" style="flex-wrap:wrap">
            ${S.CHEST_ORDER.filter(t => cb.byTier[t]).map(t =>
          `<span class="loot item">${S.CHEST[t].icon} ${esc(S.CHEST[t].name)} ×${cb.byTier[t]}</span>`).join('')}
          </div>
          <div class="btnrow" style="margin-top:10px">
            <button class="btn gold big-btn" data-act="openAllChests">🎉 一次全開</button>
            <button class="btn" data-go="bag">去背包看看</button>
          </div>
          <p class="tiny">寶箱不會過期。想累積成就感就先存著，之後一次開完。</p>
        </div>`;
      })()}

      ${goalCard()}

      ${(() => {
        const st = S.sweepStat();
        const easy = (st.byLevel[1] || 0) + (st.byLevel[2] || 0);
        if (!st.unseen) return '';
        return `<div class="card sweepcard">
          <h2>⚡ 先把「本來就會的字」篩掉</h2>
          ${memeTag('sweep')}
          <p class="muted">詞彙表裡很多字你小學就會了，不需要當新字學。一次看 12 個字、<b>只點掉不會的</b>，
            剩下的直接算已會（會抽考 2 個確認，之後也照樣進複習抽查）。</p>
          ${easy ? bar('第 1–2 級待篩（最可能已經會的）', 2004 - easy, 2004, `還有 ${easy} 字沒篩`, 'g-cyan') : ''}
          <p class="tiny">全部待篩：${st.unseen} 字　・　已篩掉（本來就會）：${st.claimed} 字　・　一批約 20–40 秒</p>
          <div class="btnrow"><button class="btn primary" data-go="sweep">開始快速篩選</button></div>
        </div>`;
      })()}

      ${due ? `<div class="card act-review">
        <h2>今天有 ${due} 個字到期要複習</h2>
        <p class="muted">這些是之前學過、時間到了該回顧的字。清掉它們才不會忘記。</p>
        ${memeTag('review')}
        ${bar('今天已完成的複習題', sum.reviewTotal, Math.max(due, sum.reviewTotal || 1), `${sum.reviewTotal} 題`, 'g-red')}
        <div class="btnrow"><button class="btn primary" data-act="startReview">開始複習（${Math.min(due, 15)} 題）</button></div>
      </div>` : `<div class="card act-review"><h2>今天沒有到期的複習 ✅</h2>
        <p class="muted">直接去闖關地圖推進度吧。</p></div>`}

      <div class="card">
        <h2>闖關地圖</h2>
        <p class="muted">6 個大關（級別 1～6），每個大關有 A–Z 的字母小關。正確率 <b style="color:var(--gold)">${Math.round(S.passAcc() * 100)}%</b> 以上才算通關，通關就有寶箱。</p>
        <div class="stages" style="margin-top:10px">${lvRows}</div>
      </div>

      ${(() => {
        const wp = S.wrongPool(), lc = S.leeches();
        if (!wp.length) return '';
        const names = wp.slice(0, 8).map(x => V()[x.i].w);
        return `<div class="card wrongcard">
          <h2>🔁 錯題加強 <span class="tiny">${wp.length} 個字還沒練起來</span></h2>
          ${memeTag('wrongStage')}
          <p class="muted">錯過的字出題機率已經自動調高（錯越多次、越常出現），同一關裡答錯還會<b>當場補考一次</b>。
            想集中火力就直接打錯題關。</p>
          ${lc.length ? `<p class="tiny" style="color:var(--red)">⚠ 難字（錯 3 次以上）${lc.length} 個：${esc(lc.slice(0, 6).map(x => V()[x.i].w).join('、'))}${lc.length > 6 ? '…' : ''}</p>` : ''}
          <p class="tiny">最需要練的：${esc(names.join('、'))}${wp.length > 8 ? '…' : ''}</p>
          <div class="btnrow">
            <button class="btn primary" data-act="startWrong">錯題關（${Math.min(wp.length, 15)} 題）</button>
            ${lc.length ? `<button class="btn gold" data-act="startLeech">只練難字（${Math.min(lc.length, 10)} 題）</button>` : ''}
          </div>
        </div>`;
      })()}

      ${questBoard(t)}

      ${checkinCard(checkin, pg)}

      <div class="card">
        <h2>關卡難度</h2>
        <div class="pills">${diffPills()}</div>
        <p class="muted" style="margin-top:8px">目前：<b>${esc(dd.name)}</b>　♥${dd.hearts}　時間 ×${dd.time}　XP ×${dd.xp}</p>
        <p class="tiny">${esc(dd.desc)}　${acc == null ? '再多練幾關就會依你的表現推薦難度。'
        : `最近三天正確率 ${Math.round(acc * 100)}%，建議「${esc(S.DIFFICULTY[rec].name)}」⭐`}</p>
        <p class="tiny" style="color:var(--gold)">選建議難度或更難，過關 XP 有 ×1.2 適配加成。每題還有速度分：越快答對分數越高。</p>
      </div>

      <div class="card">
        <h3>其他</h3>
        <div class="btnrow">
          <button class="btn" data-go="shop">🏪 商店（🪙 ${S.coins()}）</button>
          <button class="btn" data-go="bag">🎒 背包${(() => { const n = S.MAT_ORDER.reduce((a, id) => a + S.matCount(id), 0); return n ? `（素材 ${n}）` : ''; })()}</button>
          <button class="btn" data-go="records">📜 作答紀錄</button>
          <button class="btn" data-go="sweep">⚡ 快速篩選已會的字</button>
          <button class="btn" data-go="practice">🎯 自訂範圍練習</button>
          <button class="btn" data-go="book">📓 我的單字本${(() => { const st = S.customStat(); return st.total ? `（${st.total} 字${st.due ? ' ・ 到期 ' + st.due : ''}）` : ''; })()}</button>
          <button class="btn" data-go="browse">📖 瀏覽字庫</button>
          <button class="btn" data-go="badges">🏅 成就（${S.profile.badges.length}/${S.BADGES.length}）與文法進度</button>
          <button class="btn" data-go="report">📋 成績單／家長回報</button>
          <button class="btn" data-go="settings">⚙ 設定</button>
        </div>
      </div>
    `, true);
  }

  // ---------------- 闖關 ----------------
  let run = null;
  function runStage(cfg) {
    run = {
      cfg, qs: cfg.questions, idx: 0, hearts: cfg.hearts, maxHearts: cfg.hearts,
      combo: 0, bestCombo: 0, right: 0, pendingXp: 0, answers: [], attempt: (cfg.attempt || 1), inStage: true, paused: false,
      xpCard: cfg.xpCard || 1, timeMul: cfg.timeMul || 1, itemNote: cfg.itemNote || '',
      retries: cfg.retries || 0, t0: Date.now(), qt0: Date.now(), timer: null, locked: false,
    };
    if (!run.qs.length) { toast('這一關沒有題目，先做別的吧'); return home(); }
    // 每一關都記一筆：開始時間、用了多少時間、結果。重來會另外記一筆。
    /* 作弊不留任何紀錄。理由不是「懶得記」，是記了也沒用：
       作弊沒背起來的字照樣會到期、照樣被抓回來考，間隔複習本來就會把帳算清楚。
       頂端那個「🛠 作弊中」的牌子是當下的狀態提示，不是紀錄。 */
    run.runId = S.startRun({
      title: cfg.title,
      lv: cfg.map ? cfg.map.lv : null,
      letter: cfg.map ? cfg.map.letter : null,
      kindOfRun: cfg.map ? 'map' : cfg.fix ? 'fix' : cfg.review ? 'review' : 'practice',
      planned: run.qs.length,
      retries: run.retries,
    });
    drawQuestion();
  }

  /** 收尾這一關的紀錄（通關／失敗／放棄都要呼叫，只會生效一次）。 */
  function closeRun(extra) {
    if (!run || !run.runId || run.closed) return null;
    run.closed = true;
    const graded = run.answers.filter(a => a.ok !== null);
    return S.endRun(run.runId, Object.assign({
      answered: run.answers.length,
      right: run.right,
      wrong: graded.length - run.right,
      acc: graded.length ? run.right / graded.length : 0,
      combo: run.bestCombo,
      retries: run.retries,
    }, extra || {}));
  }

  /** 升等獎勵：金幣、道具、寶箱、素材、外觀解鎖。結算畫面畫完後才蓋上去。 */
  function showLevelUps(gifts) {
    if (!gifts || !gifts.length) return;
    sfx.lvl();
    const rows = gifts.map(g => {
      const it = g.item && S.shopItem(g.item);
      const un = g.unlock && S.shopItem(g.unlock);
      const chest = g.chest && S.CHEST[g.chest];
      const mats = g.mats ? Object.keys(g.mats).map(k => `${S.material(k).icon} ${esc(S.material(k).name)} ×${g.mats[k]}`).join('　') : '';
      return `<div style="border-top:1px solid var(--line);padding:10px 0">
        <b style="color:var(--purple)">Lv.${g.level}</b>${g.big ? ` <span class="chip gold">🎉 ${esc(g.big.name)}</span>` : ''}
        <div class="tiny">🪙 +${g.coin} 金幣${it ? `　🧪 ${esc(it.name)} ×1` : ''}${un ? `　🎁 解鎖「${esc(un.name)}」` : ''}</div>
        ${chest ? `<div class="tiny">${chest.icon} ${esc(chest.name)} ×${g.chestN}（放進背包，想開再開）</div>` : ''}
        ${mats ? `<div class="tiny">${mats}</div>` : ''}
      </div>`;
    }).join('');
    const last = gifts[gifts.length - 1];
    const hitBig = gifts.some(g => g.big);
    overlay(`<div class="big" style="color:var(--purple)">${hitBig ? '🎆 里程碑達成！' : '⬆ 升級！'}Lv.${last.level}</div>
      <p class="muted">升等獎勵已經放進你的背包了。${hitBig ? '寶箱收在背包裡，隨時可以開。' : ''}</p>
      ${memeTag('levelup')}
      ${rows}
      <p class="tiny" style="margin-top:8px">每 10 等有大獎、每 50 等更大、每 100 等有限定稱號。消耗品在開關前選用；外觀與稱號到商店裡「使用」。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        <button class="btn primary" data-close="ok">收下</button>
      </div>`);
  }

  /** 這一輪考了什麼：答錯的字、答對的字、每個字用過的題型。重新挑戰時用來換題。 */
  function attemptInfo() {
    const wrong = [], right = [], avoidKinds = {}, book = {};
    (run ? run.answers : []).forEach(a => {
      // 我的單字本的字不在詞彙表裡（i 是 null），用自己的 id 記「剛剛考過哪些題型」
      if (a.q.cw) { (book[a.q.cw] = book[a.q.cw] || []).push(a.q.bookKind || a.q.kind); return; }
      const i = a.q.i;
      if (i == null) return;
      (avoidKinds[i] = avoidKinds[i] || []).push(a.q.kind);
      if (a.ok === false && !wrong.includes(i)) wrong.push(i);
      if (a.ok === true && !right.includes(i)) right.push(i);
    });
    return { keep: wrong, drop: right, avoidKinds, book };
  }

  /* 重新挑戰不是「同一份考卷再來一次」：
     剛剛答錯的字一定再考（但換一種題型），剛剛答對的字換成別的字。
     cfg.regen 由各關卡自己提供（闖關、複習、錯題關都有）。 */
  function restartStage() {
    const c = run.cfg, info = attemptInfo();
    let qs = null;
    try { qs = c.regen ? c.regen(info) : null; } catch (e) { console.warn('重新出題失敗，改用原本的題目', e); }
    runStage(Object.assign({}, c, {
      questions: (qs && qs.length) ? qs : c.questions,
      attempt: run.attempt + 1, retries: run.retries + 1,
    }));
  }

  function hearts() {
    if (!run.maxHearts) return '';
    if (S.cheat('god')) return '<span class="hearts god" title="不會扣血">♥∞</span>';
    const alive = Math.max(0, Math.min(run.hearts, run.maxHearts));
    // 究極模式只有一顆心，畫成一朵還在燒的火 —— 熄了就是結束
    if (S.secretDiff()) return `<span class="hearts fire" title="${esc(S.diff().name)}：一顆心">${alive ? '🔥' : '🕯'}</span>`;
    return `<span class="hearts">${'♥'.repeat(alive)}<span class="off">${'♥'.repeat(run.maxHearts - alive)}</span></span>`;
  }

  /* 句子底下的「還沒學過的字」註解。
     文法題與造句／句子題的句子不是為了考單字寫的 —— 裡面出現一個沒學過的字，
     卡住的是單字，那一題就白考了。所以先把不認得的字講出來，讓他考的是文法與造句。
     skip：不可以註解的字（例如四個選項、要填的答案），否則等於直接把答案講出來。 */
  function glossNote(text, skip) {
    if (!text) return '';
    const list = Q.unknownIn(text, { known: i => S.isKnown(i), skip: skip || [], max: 6 });
    if (!list.length) return '';
    return `<div class="glossbox"><b>還沒學過的字</b>${list.map(w =>
      `<span class="gl"><b>${esc(Q.base(w.w))}</b> ${esc(w.tr)}</span>`).join('')}</div>`;
  }

  function drawQuestion() {
    clearInterval(run.timer);
    const q = run.qs[run.idx];
    if (!q) return finishStage();
    run.locked = false; run.qt0 = Date.now();
    /* 新題目剛畫出來的前 250 毫秒不接受作答。
       原因：上一題答完會在 260ms 後自動換題，手速快的人第二下點擊會落在新題目上，
       等於「還沒看到題目就被算答錯」——使用者的體感就是「我明明選了正確答案卻給我錯」。 */
    run.drawnAt = Date.now();
    const p = q.prompt;
    // 每一題都計時，這不是設定 —— 只有作弊選單的「時間暫停」關得掉
    const useTimer = limitOf(q) > 0 && !S.cheat('noTimer');
    let body = '';

    const speakBtn = p.speak ? `<button class="speak" data-say="${esc(p.speak)}" title="播放發音">🔊</button>` : '';
    /* 題目要求要比單字本身更顯眼 —— 不然會出現「字超大、但沒看到是要選複數」的情況。
       所有題型都用同一條橫幅，位置固定在最上面。 */
    const qask = html => `<div class="qask">${html}</div>`;
    const redoTag = q.redo ? '<div class="redotag">🔁 剛才錯過的字，再練一次</div>' : '';
    // 句子題如果不是這一關的字（本關的字沒有例句），要標清楚，不然會像「D 關怎麼跑出 E 開頭」
    const outTag = q.outside && q.i != null
      ? `<div class="outtag">📎 延伸句型練習 ・ <b>${esc(V()[q.i].w)}</b>（第 ${V()[q.i].lv} 級 ・ ${esc(V()[q.i].w[0].toUpperCase())} 開頭）不屬於這一關</div>`
      : '';
    const lvTag = p.lv ? `<div class="qtag">${p.tag ? esc(p.tag) + ' ・ ' : ''}第 ${p.lv} 級 ${p.pos ? '・ ' + esc(p.pos) : ''}</div>` : '';

    if (p.type === 'word') {
      body = `${lvTag}${qask('選出正確的<b>中文意思</b>')}
        <div class="qword">${esc(p.word)} ${speakBtn}</div>
        ${p.ph ? `<div class="qph">/${esc(p.ph)}/</div>` : ''}`;
    } else if (p.type === 'zh') {
      body = `${lvTag}${qask('選出正確的<b>英文單字</b>')}
        <div class="qword zh">${esc(p.zh)}</div>`;
    } else if (p.type === 'listen') {
      /* 聽力題最容易吵架的地方：TTS 把 rice / raise 唸得幾乎一樣。
         對策：自動唸兩次、提供「更慢」按鈕、真的聽不出來還能看音標（音標不會直接告訴你意思）。 */
      body = `${lvTag}${qask('<b>聽發音</b>，選出正確答案　<span class="qasksub">會自動唸兩次</span>')}
        <div style="font-size:52px">🔊</div>
        <div class="btnrow" style="justify-content:center;margin-top:8px">
          <button class="btn" data-say="${esc(p.speak)}">🔊 再聽一次</button>
          <button class="btn" data-slow="${esc(p.speak)}">🐢 慢速播放</button>
          ${p.ph ? `<button class="btn ghost" data-act="showPh">看音標</button>` : ''}
        </div>
        <div class="qph" id="phhint" style="margin-top:10px;visibility:hidden">/${esc(p.ph || '')}/</div>
        <p class="tiny" style="margin-top:8px">聽不清楚可以按「慢速播放」或「看音標」。</p>`;
      setTimeout(() => say(p.speak, { twice: true }), 250);
    } else if (p.type === 'spell') {
      // 灰燼段連「幾個字母」都不給：底線與字數一起收掉，只剩中文
      const bare = S.diff().noHint;
      body = `${lvTag}${qask(`<b>拼出</b>這個英文單字${bare ? '' : `（${p.len} 個字母）`}`)}
        <div class="qword zh">${esc(p.zh)}</div>
        ${bare ? '' : `<div class="qph" style="letter-spacing:5px;font-size:22px;margin-top:10px">${esc(p.hint)}</div>`}
        <p class="tiny" style="margin-top:6px">${bare ? '☠ 這一階連字數都不給。' : '只給字數，不給任何字母。'}</p>
        <input class="txt" id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入拼字">`;
    } else if (p.type === 'form') {
      body = `${lvTag}${qask(`請選出它的 <b class="hot">${esc(p.ask)}</b>`)}
        <div class="qword">${esc(p.word)} ${speakBtn}</div>
        <div class="qph">${esc(p.zh)}</div>`;
    } else if (p.type === 'cloze') {
      // 註解要避開四個選項，不然等於把答案講出來
      body = `${lvTag}${qask('選出最適合<b>填進空格</b>的字')}
        <div class="qsent">${esc(p.sentence).replace(/\{[^}]*\}/, '<span class="gap">?</span>')}</div>
        <div class="qzh">${esc(p.zh)}</div>
        ${glossNote(p.sentence, q.opts)}`;
    } else if (p.type === 'order') {
      body = `${lvTag}${qask('把詞塊<b>排成正確的英文句子</b>')}
        <div class="qzh" style="font-size:17px;color:var(--tx)">${esc(p.zh)}</div>
        <div class="slot" id="slot"></div>
        <div class="tiles" id="tiles">${p.tiles.map((t, k) => `<button class="tile" data-tile="${k}">${esc(t)}</button>`).join('')}</div>
        ${glossNote(p.tiles.join(' '))}`;
    } else if (p.type === 'trans') {
      body = `${lvTag}${qask('<b>填入</b>正確的字')}
        <div class="qzh" style="font-size:17px;color:var(--tx)">${esc(p.zh)}</div>
        <div class="qsent" style="margin-top:10px">${esc(p.sentence).replace('____', '<span class="gap">?</span>')}</div>
        <p class="tiny" style="margin-top:8px">提示：${esc(p.hint)}</p>
        ${glossNote(p.sentence, [q.answer])}
        <input class="txt" id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入單字">`;
    } else if (p.type === 'free') {
      body = `${lvTag}${qask('用這個字<b>寫一句英文</b>')}
        <div class="qword">${esc(p.word)} ${speakBtn}</div>
        <div class="qph">${esc(p.zh)}</div>
        ${p.coll ? `<p class="tiny">常用搭配：${esc(p.coll)}</p>` : ''}
        ${glossNote(p.coll, [p.word])}
        <textarea class="txt" id="ans" placeholder="例如：I decided to ..."></textarea>
        <p class="tiny">這題不判對錯。寫完之後下載今日紀錄，Claude Code 會逐句批改。</p>`;
    } else if (p.type === 'gmc') {
      body = `<div class="qtag">文法 ・ ${esc(p.title)}${q.via ? ` ・ 來自這一關的 ${esc(q.via)}` : ''}</div>
        ${qask('選出<b>文法正確</b>的答案')}
        <div class="qsent">${esc(p.sentence).replace(/_{2,}/, '<span class="gap">?</span>')}</div>
        ${glossNote(p.sentence)}`;
    } else if (p.type === 'gfix') {
      body = `<div class="qtag">找錯改錯 ・ ${esc(p.title)}${q.via ? ` ・ 來自這一關的 ${esc(q.via)}` : ''}</div>
        ${qask('這句有<b>一個錯</b>，把<b>整句</b>改對重寫')}
        <div class="qsent" style="color:var(--red)">${esc(p.sentence)}</div>
        ${glossNote(p.sentence)}
        <textarea class="txt" id="ans" placeholder="寫出改正後的整句"></textarea>`;
    }

    /* 透視（作弊選單）：直接把正解標出來。選擇題標在選項上，其他題型在題目下面補一行 ——
       自由造句沒有標準答案，所以那一種就什麼都不顯示。 */
    const xray = S.cheat('xray');
    const optsHtml = q.opts ? `<div class="opts" id="opts">${q.opts.map((o, k) =>
      `<button class="opt${xray && k === q.a ? ' xray' : ''}" data-opt="${k}"><span class="k">${'ABCD'[k]}</span><span>${esc(o)}</span></button>`).join('')}</div>` : '';
    const xrayAns = xray && !q.opts && !q.noGrade ? (q.answer || (q.accept && q.accept[0]) || '') : '';
    const xrayHtml = xrayAns ? `<div class="xray">👁 正解：${esc(xrayAns)}</div>` : '';
    const submitHtml = q.opts ? '' :
      `<div class="btnrow" style="margin-top:14px;justify-content:center">
         <button class="btn primary" data-act="submit">${p.type === 'free' ? '寫好了，下一題' : '送出'} ${kbd('submit')}</button>
         ${p.type === 'order' ? '<button class="btn ghost" data-act="clearSlot">清空</button>' : ''}
       </div>`;

    render(`
      <div class="hud">
        <b>${esc(run.cfg.title)}</b>
        ${run.itemNote ? `<span class="chip" style="color:var(--gold)">🧪 ${esc(run.itemNote)}</span>` : ''}
        <button class="btn sm ghost gear" data-act="gear" style="order:99">⚙</button>
        ${hearts()}
        <span class="combo">${run.combo >= 2 ? '本關連擊 ×' + run.combo + ' ✨' : ''}</span>
        <div class="progressline"><i style="width:${run.idx / run.qs.length * 100}%"></i></div>
        <span class="tiny">${run.idx + 1}/${run.qs.length}</span>
        ${useTimer ? '<span class="timer" id="timer"></span>' : ''}
        ${useTimer && S.secretDiff() ? '<div class="fuse" id="fuse"><i></i></div>' : ''}
        ${q.opts && S.owned('fifty') && S.itemsAllowed() ? `<button class="btn sm gold" data-act="fifty">刪去法 ×${S.inventory().fifty} ${kbd('fifty')}</button>` : ''}
      </div>
      <div class="card qcard ${q.redo ? 'redo' : ''} ${q.outside ? 'outside' : ''}" id="qcard">${redoTag}${outTag}${body}${optsHtml}${xrayHtml}${submitHtml}</div>
      <div id="fb"></div>
      ${keyBar(q.opts
      ? [['next', '下一題'], ['speak', '發音'], ['pause', '暫停']]
      : [['submit', '送出'], ['next', '下一題'], ['speak', '發音'], ['pause', '暫停']])}
      ${q.opts ? '<p class="tiny" style="text-align:center">也可以直接按 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> 選答案</p>' : ''}
      ${run.attempt > 1 ? `<p class="tiny">第 ${run.attempt} 次挑戰這一關（前面的作答紀錄都有保留，正確率只採計第 1 次）</p>` : ''}
    `);

    const inp = $('#ans');
    if (inp) {
      inp.focus();
      if (inp.tagName === 'INPUT') inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    }
    if (p.type === 'order') wireOrder(p);
    if (useTimer) startTimer(q);
  }

  const BASE_XP = 10;                          // 答對的底分
  const COMBO_MILESTONES = [5, 10, 15, 20, 30, 40, 50];

  /* 速度分：越快答對，分數越高。用「這題還剩多少時間」算比例，
     所以句子重組（75 秒）和四選一（15 秒）用同一套標準都公平 —— 比的是自己這題的時間。 */
  function speedOf(q, ms) {
    const lim = limitOf(q) * 1000;
    const frac = lim > 0 ? Math.max(0, Math.min(1, 1 - ms / lim)) : 0;
    const tag = frac >= 0.8 ? '⚡ 神速' : frac >= 0.6 ? '很快' : frac >= 0.35 ? '穩定' : frac > 0 ? '有點慢' : '差點超時';
    return { frac, tag, sec: Math.round(ms / 100) / 10 };
  }

  /** 這一題的實際秒數 = 題型基準 × 使用者的時間寬鬆度。
      下限預設 5 秒（再快也要看得完題目）；灰燼段把下限降到 3 秒，
      否則時間倍率砍到 ×0.11 也全被下限吃掉，那一段就不會更難。 */
  function limitOf(q) {
    const base = q.secs || Q.secsFor(q.kind);
    return Math.max(S.diff().minSec || 5, Math.round(base * S.diff().time * ((run && run.timeMul) || 1)));
  }

  function startTimer(q, resumeFrom) {
    const total = limitOf(q);
    run.left = resumeFrom == null ? total : resumeFrom;
    const warnAt = Math.max(5, Math.round(total * 0.25));
    const el = $('#timer');
    // 究極模式的引信：剩下的時間就是還沒燒到的那一截
    const fuse = $('#fuse');
    const tick = () => {
      if (fuse) {
        fuse.className = 'fuse' + (run.left <= warnAt ? ' warn' : '');
        const bar = fuse.firstChild || fuse.querySelector('i');
        if (bar && bar.style) bar.style.width = Math.max(0, Math.min(100, run.left / total * 100)) + '%';
      }
      if (!el) return;
      el.textContent = run.left + 's';
      el.className = 'timer' + (run.left <= warnAt ? ' warn' : '');
      if (run.left <= 0) {
        clearInterval(run.timer);
        if (!run.locked) {
          // 逾時不丟掉已經打進去的字：有寫就照寫的內容判分，空白才算沒作答
          const inp = $('#ans');
          const typed = inp ? String(inp.value || '').trim() : '';
          answerQ(q, typed || null, true);
        }
      }
      run.left--;
    };
    tick();
    run.timer = setInterval(tick, 1000);
  }

  // ---------------- 暫停 / 放棄 ----------------
  function pauseStage() {
    if (!run || !run.inStage || run.paused) return;
    run.paused = true;
    clearInterval(run.timer);
    overlay(`<h2>⏸ 已暫停</h2>
      ${memeTag('pause')}
      <p class="muted">計時停住了，慢慢來。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        <button class="btn primary" data-close="resume">繼續作答</button>
      </div>`, () => resumeStage());
  }

  /** 關卡進行中想離開：先警告「離開＝放棄」，確認了才真的放棄。 */
  function confirmLeave() {
    if (!run || !run.inStage) return;
    if (!run.paused) { run.paused = true; clearInterval(run.timer); }
    overlay(`<h2 style="color:var(--red)">離開就是放棄這一關</h2>
      <p class="muted">這一關不算通過、連勝歸零，累積的 <b>${run.pendingXp} XP</b> 與金幣都不會入帳。</p>
      <p class="tiny">已經作答的紀錄仍然保留，答錯的字照樣會排進複習與家長回報。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        <button class="btn primary" data-close="stay">繼續作答</button>
        <button class="btn ghost" data-close="quit" style="color:var(--red)">放棄並離開</button>
      </div>`, act => act === 'quit' ? abandonStage() : resumeStage());
  }

  function resumeStage() {
    if (!run || !run.paused) return;
    run.paused = false;
    const rm = memeLine('resume');
    if (rm) toast(rm);
    const q = run.qs[run.idx];
    if (q && !run.locked && limitOf(q) > 0 && !S.cheat('noTimer')) startTimer(q, Math.max(1, run.left));
  }

  /** 放棄＝視同沒通過：不給星、連勝歸零、XP 作廢（作答紀錄不動）。 */
  function abandonStage() {
    if (!run) return home();
    clearInterval(run.timer);
    run.inStage = false;
    run.paused = false;
    const cfg = run.cfg;
    if (cfg.map) {
      const graded = run.answers.filter(a => a.ok !== null);
      const acc = graded.length ? run.right / graded.length : 0;
      S.recordStage(cfg.map.lv, cfg.map.letter, false, acc, 0, run.bestCombo);
      closeRun({ passed: false, abandoned: true, xp: 0 });
      toast('已放棄這一關，連勝歸零');
      return letterSetup(cfg.map.lv, cfg.map.letter);
    }
    closeRun({ passed: false, abandoned: true, xp: 0 });
    toast('已離開這一關，本關 XP 未入帳');
    home();
  }


  function wireOrder(p) {
    const slot = $('#slot');
    slot.addEventListener('click', e => {
      const b = e.target.closest('[data-back]');
      if (!b) return;
      $(`[data-tile="${b.dataset.back}"]`).classList.remove('used');
      b.remove();
    });
  }

  function slotText() {
    return [...document.querySelectorAll('#slot [data-back]')].map(b => b.textContent).join(' ');
  }

  function submit() {
    if (run.locked) return;
    const q = run.qs[run.idx];
    if (q.prompt.type === 'order') return answerQ(q, slotText());
    const el = $('#ans');
    const val = el ? el.value.trim() : '';
    if (!val) { toast(q.prompt.type === 'free' ? '寫一句再繼續吧' : '先填答案'); return; }
    answerQ(q, val);
  }

  // 換題後的防誤觸時間；測試會把它設成 0（另有專門測試驗證這個保護真的有效）
  const guardMs = () => (window.__guardMs != null ? window.__guardMs : 250);
  function tooSoon() { return run && run.drawnAt && (Date.now() - run.drawnAt) < guardMs(); }

  function answerQ(q, given, timeout) {
    if (run.locked) return;
    // 防止「上一題的第二下點擊」誤答新題（逾時判定不受影響）
    if (!timeout && tooSoon()) return;
    run.locked = true;
    clearInterval(run.timer);
    const ms = Date.now() - run.qt0;
    const isFree = !!q.noGrade;
    // 逾時但已經打了字 → 照打的內容判分（不因為沒按送出就白扣）；完全空白才算沒作答
    const ok = isFree ? null : (given == null || given === '' ? false : Q.grade(q, given));

    // ---- 記錄 ----
    if (isFree) {
      // 自訂字不在詞彙表裡（i 是 null），字面要從題目本身拿
      S.logFree({
        i: q.i, cw: q.cw || null,
        w: (q.i != null && V()[q.i]) ? V()[q.i].w : ((q.prompt && q.prompt.word) || ''),
        text: given || '',
        unfinished: !given, timeout: !!timeout, at: new Date().toISOString(),
      });
    } else if (q.kind === 'gmc' || q.kind === 'gfix') {
      S.logGrammar({
        id: q.gid, n: q.gn, ok, attempt: run.attempt, ms, timeout: !!timeout,
        given: answerText(q, given), right: answerText(q, q.opts ? q.a : null) || q.answer || '',
        title: (window.GRAMMAR_TITLES || {})[q.gid] || '',
      });
    } else {
      // 補考題（同一關內再考一次答錯的字）算第 2 次作答：正確率只採計第 1 次，才不會被補考洗白
      const att = q.redo ? Math.max(2, run.attempt) : run.attempt;
      // 我的單字本走自己那一份間隔複習紀錄，不碰詞彙表的（i 是 null）
      if (q.cw) S.customAnswer(q.cw, ok, att);
      else S.answer(q.i, ok, att);
      // given / right 一起存下來：作答紀錄要看得出「當時寫了什麼」，事後無法重建
      S.logAnswer({
        i: q.i, cw: q.cw || null, w: q.cw ? (S.customFind(q.cw) || {}).w : undefined,
        t: q.kind, ok, attempt: att, ms, timeout: !!timeout, redo: !!q.redo,
        given: answerText(q, given), right: answerText(q, q.opts ? q.a : null) || q.answer || '',
        runId: run.runId,
      });
    }
    if (ok === false) queueRedo(q);
    run.answers.push({ q, given, ok });

    // ---- 分數 / 連擊 / 血量 ----
    // XP 只先累積在 run.pendingXp，等整關結算才真的入帳 —— 這樣 GAME OVER 才是真的作廢。
    let gained = 0, speed = 0, comboBonus = 0, milestone = 0;
    if (ok) {
      run.right++; run.combo++; run.bestCombo = Math.max(run.bestCombo, run.combo);
      S.noteCombo(run.bestCombo); S.noteDayCombo(run.bestCombo);
      const sp = speedOf(q, ms);
      speed = Math.round(BASE_XP * sp.frac);            // 越快分數越高：最快多一倍，用完時間就沒有速度分
      comboBonus = Math.round(Math.floor(run.combo / 5) * 2 * S.comboMult());   // 連擊分（只在這一關內累計）
      milestone = COMBO_MILESTONES.includes(run.combo) ? run.combo * 3 : 0;
      gained = Math.round((BASE_XP + speed + comboBonus + milestone) * S.diff().xp * S.xpMult());
      run.lastSpeed = sp;
      if (milestone) {
        const mm = memeLine('combo');
        toast(`🔥 ${run.combo} 連擊 BONUS +${Math.round(milestone * S.diff().xp)} XP${mm ? '　' + mm : ''}`);
      }
      sfx.ok();
    } else if (ok === false) {
      run.combo = 0;
      if (run.maxHearts && !S.cheat('god')) run.hearts--;   // 無敵：照樣算錯、照樣進複習，只是不扣血
      sfx.no();
    } else {
      gained = Math.round(8 * S.diff().xp);   // 自由造句給參與分
    }
    run.pendingXp += gained;
    Object.assign(run.answers[run.answers.length - 1], { gained, speed, comboBonus, milestone, ms });

    // 血量歸零：立刻標記死亡，這樣就算使用者搶著按「下一題」也不會溜過去
    if (ok === false && run.maxHearts && !S.cheat('god') && run.hearts <= 0) {
      run.hearts = 0;
      run.dead = true;
    }

    if (S.settings.instantFeedback || run.cfg.fix) {
      showFeedback(q, given, ok, gained, timeout);
      if (run.dead) setTimeout(gameOver, 700);
      return;
    }
    // 預設：當下不結算，只給一個中性的「已作答」提示就換下一題，全部留到關卡結算再看
    markPicked(q, given);
    if (run.dead) return setTimeout(gameOver, 450);
    setTimeout(() => { run.locked = false; next(); }, 260);
  }

  /* 答錯的字不能只是「掉回 box 0、明天再說」——當下就要再遇到一次。
     所以答錯後在這一關的後面插一題同一個字的補考（換一種題型），每個字最多補考 2 次。
     補考記成第 2 次作答，不影響「首次正確率」，也不會被拿來洗成績。 */
  const REDO_MAX = 2;                 // 同一個字在一關內最多補考幾次
  const REDO_GAP = 3;                 // 至少隔幾題才再考（不要馬上重複同一題）
  function queueRedo(q) {
    if (!run || q.noGrade) return;
    if (q.i == null && !q.cw) return;                // 文法題不屬於某個字，不補考
    if (run.cfg.bonus) return;                       // 加碼題只有一題，不補考
    run.redo = run.redo || {};
    const key = q.cw || q.i;
    const n = run.redo[key] || 0;
    if (n >= REDO_MAX) return;
    if (run.qs.length > 60) return;                  // 別讓一關無限長
    let nq;
    if (q.cw) {
      // 我的單字本：換一種題型再考一次（避開剛剛那一種）
      const avoid = {}; avoid[q.cw] = [q.bookKind || q.kind];
      nq = Q.bookSet([S.customWord(q.cw)], { kinds: S.customCfg().kinds, n: 1 }, avoid)[0];
    } else {
      const b = (S.load().words[q.i] || {}).b || 0;
      nq = Q.forWord(V()[q.i], b, (run.cfg.map ? S.diff().tierShift : 0));
    }
    if (!nq) return;
    nq.redo = true;
    run.redo[key] = n + 1;
    const at = Math.min(run.qs.length, run.idx + 1 + REDO_GAP);
    run.qs.splice(at, 0, nq);
    run.redoAdded = (run.redoAdded || 0) + 1;
  }

  /** 把答案（選項索引或輸入的字）轉成人看得懂的文字，給紀錄與檢討用。 */
  function answerText(q, given) {
    if (given == null || given === '') return '';
    if (q.opts) { const n = +given; return q.opts[n] == null ? String(given) : q.opts[n]; }
    return String(given);
  }

  /** 不透露對錯，只標示「你選了這個」，讓作答有回饋但不提前結算。 */
  function markPicked(q, given) {
    document.querySelectorAll('.opt').forEach((b, k) => {
      b.disabled = true;
      if (q.opts && String(k) === String(given)) b.classList.add('picked');
    });
    // 鎖住這一題：順便讓輸入框失焦，否則空白鍵還會被當成「正在打字」而不是「下一題」
    const inp = $("#ans"); if (inp) { inp.disabled = true; if (inp.blur) inp.blur(); }
    document.querySelectorAll('.tile').forEach(b => { b.disabled = true; });
  }

  function showFeedback(q, given, ok, gained, timeout) {
    document.querySelectorAll('.opt').forEach((b, k) => {
      b.disabled = true;
      if (q.opts) {
        if (k === q.a) b.classList.add('ok');
        else if (String(k) === String(given)) b.classList.add('no');
      }
    });
    // 鎖住這一題：順便讓輸入框失焦，否則空白鍵還會被當成「正在打字」而不是「下一題」
    const inp = $("#ans"); if (inp) { inp.disabled = true; if (inp.blur) inp.blur(); }
    document.querySelectorAll('.tile,[data-act="clearSlot"]').forEach(b => b.disabled = true);

    let head;
    if (ok === null) {
      const chk = Q.checkFree(given, q.accept || []);
      head = `<b>已記錄你的句子</b>　+${gained} XP
        <div style="margin-top:6px">${esc(given)}</div>
        ${chk.notes.length ? `<span class="hint">機械檢查提醒：${chk.notes.map(esc).join('；')}</span>` : '<span class="hint">格式檢查通過。語意與文法會由 Claude Code 批改。</span>'}`;
    } else if (ok) {
      const a = run.answers[run.answers.length - 1] || {};
      const sp = run.lastSpeed || { tag: '', sec: 0 };
      const mm = memeLine(sp.frac >= 0.8 ? 'fast' : 'ok');
      head = `<b>✓ 答對了！</b>　+${gained} XP　<span style="color:var(--gold)">${esc(sp.tag)} ${sp.sec}s</span>
        ${mm ? `<span class="meme inline">${esc(mm)}</span>` : ''}
        <span class="hint">底分 ${BASE_XP}${a.speed ? `　速度 +${a.speed}` : ''}${a.comboBonus ? `　連擊 +${a.comboBonus}` : ''}${a.milestone ? `　里程碑 +${a.milestone}` : ''}${S.diff().xp !== 1 ? `　難度 ×${S.diff().xp}` : ''}</span>
        ${run.combo >= 3 ? `<span class="hint">本關連擊 ×${run.combo}（換關或答錯就歸零）</span>` : ''}`;
    } else {
      const ansTxt = q.opts ? q.opts[q.a] : q.answer;
      const mm = memeLine(timeout ? 'timeout' : 'wrong');
      head = `<b>✗ ${timeout ? '時間到' : '答錯了'}</b>　正確答案：<b style="color:var(--ac)">${esc(ansTxt)}</b>
        ${run.maxHearts ? `<span class="hint">扣一顆心，剩 ${run.hearts} 顆</span>` : ''}
        ${mm ? `<span class="meme inline">${esc(mm)}</span>` : ''}`;
    }
    const w = q.i != null ? V()[q.i] : null;
    const extra = [];
    if (q.why) extra.push(esc(q.why).replace(/\n/g, '<br>'));
    if (w && (window.SENTENCES[w.w] || {}).trap && ok === false) extra.push('⚠ ' + esc(window.SENTENCES[w.w].trap));
    $('#fb').innerHTML = `<div class="feedback ${ok === false ? 'no' : 'ok'}">${head}
      ${extra.length ? `<div style="margin-top:8px;color:var(--tx2);font-size:13.5px">${extra.join('<br>')}</div>` : ''}</div>
      <div class="btnrow" style="margin-top:12px"><button class="btn primary" data-act="next">${run.dead ? '血量用完了…' : run.idx + 1 >= run.qs.length ? '完成這一關' : '下一題'} ${kbd('next')}</button>
      ${w ? `<button class="btn ghost" data-say="${esc(Q.base(w.w))}">🔊 ${esc(Q.base(w.w))}</button>` : ''}
      ${w ? dictLink(w.w) : ''}</div>`;
    if (ok) $('#qcard').classList.add('flash-ok');
    if (ok === false) $('#qcard').classList.add('gameover');
  }

  function next() {
    if (run.dead) return gameOver();          // 死了就不能靠按快一點繼續闖
    run.idx++;
    if (run.idx >= run.qs.length) finishStage(); else drawQuestion();
  }

  function gameOver() {
    if (run.overShown) return;                // setTimeout 與手動點擊可能同時觸發
    run.overShown = true;
    run.inStage = false;                      // 一定要解除，否則之後每次導覽都會被當成「想放棄關卡」
    run.paused = false;
    clearInterval(run.timer);
    // 失敗還沒定案：可能會用復活石。等使用者選了「不復活」才寫入失敗紀錄。
    const canRevive = S.owned('revive') && !run.revived && S.itemsAllowed();
    if (!canRevive) recordFail();
    sfx.dead();
    /* 掛掉也要看得到哪裡錯 —— 先把逐題檢討畫在後面，覆蓋層關掉就看得到，
       不然血量歸零等於「錯了什麼都不知道」，那才是最虧的。 */
    const graded = run.answers.filter(a => a.ok !== null);
    render(`<div class="card sheet" style="text-align:center">
      <div class="big" style="color:var(--red)">GAME OVER</div>
      <div class="grid2" style="margin-top:12px">
        <div class="stat ok"><b>${run.right}</b><span>答對</span></div>
        <div class="stat no"><b>${graded.length - run.right}</b><span>答錯</span></div>
        <div class="stat gold"><b>×${run.bestCombo}</b><span>本關最高連擊</span></div>
        <div class="stat"><b>${run.idx + 1}/${run.qs.length}</b><span>打到第幾題</span></div>
      </div>
      <p class="tiny">這一關的 XP 與星數不算，但<b>作答紀錄都留著</b>，答錯的字已排進複習。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        <button class="btn primary" data-act="retryMapStage">再挑戰一次</button>
        ${run.cfg.map ? '<button class="btn gold" data-act="fixWrong">✏ 訂正錯的字</button>' : ''}
        <button class="btn ghost" data-act="backToMap">回關卡地圖</button>
        <button class="btn ghost" data-go="home">回首頁</button>
      </div>
    </div>
    <div class="card"><h3>逐題檢討（答錯的排前面）</h3>${reviewList()}</div>`);
    // 訂正／再挑戰要用到的資料（跟通關結算同一套）
    window.__lastMap = run.cfg.map ? { lv: run.cfg.map.lv, letter: run.cfg.map.letter, count: run.cfg.map.count } : window.__lastMap;
    window.__lastAttempt = attemptInfo();
    window.__wrongIds = [...new Set(run.answers.filter(a => a.ok === false && a.q.i != null).map(a => a.q.i))];
    overlay(`<div class="big" style="color:var(--red)">GAME OVER</div>
      ${memeTag('gameover')}
      <p class="muted">血量用完了。這一關累積的 <b>${run.pendingXp} XP 全部作廢</b>，星數不給、連擊歸零，要重新挑戰。</p>
      <p class="tiny">別擔心 — 你剛才答錯的字<b>都已經記錄下來</b>，會排進間隔複習，也會出現在今天的家長回報裡。正確率只採計第 1 次作答，重來不會虛胖。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        ${canRevive ? `<button class="btn purple big-btn" data-close="revive">💎 用復活石續命（持有 ${S.inventory().revive}）</button>` : ''}
        <button class="btn primary" data-close="retry">重新挑戰這一關</button>
        ${run.cfg.map ? '<button class="btn gold" data-close="fix">訂正錯的字</button>' : ''}
        <button class="btn" data-close="review">看逐題檢討</button>
        <button class="btn ghost" data-close="home">先回首頁</button>
      </div>
      ${canRevive ? '<p class="tiny">復活石：血量回 1 顆，從下一題接著打，累積的 XP 保留。每關只能用一次。</p>' : ''}`, act => {
        if (act === 'revive') return reviveStage();
        recordFail();                            // 不復活 → 這一關正式算失敗
        if (act === 'review') return;            // 關掉視窗，後面就是逐題檢討
        if (act === 'retry') return restartStage();
        if (act === 'fix') {
          const ids = [...new Set(run.answers.filter(a2 => a2.ok === false && a2.q.i != null).map(a2 => a2.q.i))];
          const m = run.cfg.map;
          return startFixStage(ids, () => (m ? letterSetup(m.lv, m.letter) : home()));
        }
        home();
      });
  }

  /** 血量歸零且不復活 → 正式登記失敗（連勝歸零、關卡紀錄收尾）。只會生效一次。 */
  function recordFail() {
    if (!run || run.recordedFail) return;
    run.recordedFail = true;
    if (run.cfg.map) {
      const g = run.answers.filter(a => a.ok !== null);
      S.recordStage(run.cfg.map.lv, run.cfg.map.letter, false,
        g.length ? run.right / g.length : 0, 0, run.bestCombo);
    }
    closeRun({ passed: false, xp: 0, coin: 0 });
  }

  /** 復活石：血量回 1，從下一題繼續。因為失敗還沒登記，這一關仍然可以通關。 */
  function reviveStage() {
    if (!run || !S.itemsAllowed() || !S.consume('revive')) return home();
    run.revived = true;
    run.dead = false;
    run.overShown = false;
    run.inStage = true;
    run.hearts = 1;
    run.locked = false;
    toast('💎 復活！血量回 1 顆，撐住');
    sfx.lvl();
    run.idx++;
    if (run.idx >= run.qs.length) return finishStage();
    drawQuestion();
  }

  /** 闖關地圖的關卡結算：正確率不到門檻就不給過。 */
  function finishMapStage() {
    const cfg = run.cfg, { lv, letter } = cfg.map;
    const graded = run.answers.filter(a => a.ok !== null);
    const acc = graded.length ? run.right / graded.length : 0;
    // 通關門檻是 90%，星數就在 90% 以上再分級：全對 3 星、95% 以上 2 星
    const stars = acc >= 1 ? 3 : acc >= .95 ? 2 : 1;
    const passed = acc >= S.passAcc();

    const streakBefore = S.winStreak();
    const m = S.recordStage(lv, letter, passed, acc, stars, run.bestCombo);
    const wrongIds = run.answers.filter(a => a.ok === false && a.q.i != null).map(a => a.q.i);
    window.__lastMap = { lv, letter, count: cfg.map.count };
    window.__lastAttempt = attemptInfo();          // 再挑戰一次時用來換題
    window.__wrongIds = [...new Set(wrongIds)];
    window.__nextStage = S.nextStage(lv, letter);

    let coinGain = 0, xpGain = 0, bonusNote = '';
    if (passed) {
      const wsBonus = Math.round(run.pendingXp * S.winStreakBonus());
      const fitBonus = S.difficultyFits() ? Math.round(run.pendingXp * 0.2) : 0;
      // XP 卡是「總結算乘上倍率」：底分＋連勝＋難度適配都算進去再乘
      const sub = run.pendingXp + wsBonus + fitBonus;
      const dbl = Math.round(sub * ((run.xpCard || 1) - 1));
      xpGain = sub + dbl;
      coinGain = S.stageCoins(stars, S.winStreak());
      S.addXp(xpGain); S.addCoins(coinGain);
      S.touchStreak();
      bonusNote = [
        `答題 ${run.pendingXp}`,
        wsBonus ? `連勝 +${wsBonus}` : '',
        fitBonus ? `難度適配 +${fitBonus}` : '',
        dbl ? `${run.xpCard} 倍卡 +${dbl}` : '',
      ].filter(Boolean).join('　');
      sfx.clear();
    } else {
      sfx.no();
    }
    if (passed) S.autoClear();                 // 這一關可能剛好把這個字母的字補滿
    const quests = S.awardQuests();
    const checkin = passed ? S.checkIn() : null;
    const got = S.checkBadges({ bestCombo: run.bestCombo });
    const gifts = S.claimLevelUps();
    const rec = closeRun({ passed, stars, xp: xpGain, coin: coinGain });
    const used = rec ? rec.sec : 0;
    // 通關掉落素材（寶石／星塵／鑰匙）→ 進背包，可以拿去合成
    const drops = passed ? S.grantMats(S.matDrop({ passed, lv, stars, combo: run.bestCombo }), `第 ${lv} 級 ${letter} 關`) : [];
    // 通關寶箱：表現越好箱子越好。金寶箱要 10 題以上全對不重來，彩虹要 20 題全對＋連擊 20＋挑戰難度以上
    const tier = passed ? S.chestTier({
      stars, combo: run.bestCombo, retries: run.retries,
      count: graded.length, diff: S.diff().id,
    }) : null;
    // 寶箱先存進背包：當場不想開也沒關係，之後可以在背包一次全開
    const chestId = passed ? S.addChest(tier, `第 ${lv} 級 ${letter} 關`) : null;
    window.__chest = passed ? {
      id: chestId, tier, lv, letter, count: graded.length,
      ids: [...new Set(run.answers.map(a => a.q.i).filter(i => i != null))],
      // 剛剛考過什麼（字 + 題型），加碼題要避開這些組合，不要重複考一樣的東西
      asked: run.answers.filter(a => a.q.i != null).map(a => ({ i: a.q.i, kind: a.q.kind })),
      opened: false, bonusUsed: false,
    } : null;

    // 完成度：這個字母的字要 100% 都學會，才算真正打完、才能前往下一關
    const after = S.mapStat(lv, letter);
    window.__letterFull = after.full;
    const head = passed
      ? `<div class="stars" style="font-size:40px">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
         <h2 style="color:var(--ac)">${after.full ? `完成！第 ${lv} 級 ・ ${letter} 關 100% 打完` : `這一輪通過！第 ${lv} 級 ・ ${letter} 關`}</h2>
         ${bar(`${letter} 關完成度`, after.known, after.total, `${after.known}/${after.total} 字　${Math.round(after.pct * 100)}%`, after.full ? 'g-gold' : 'g-green')}
         ${after.full ? '' : `<p class="tiny">還有 <b style="color:var(--gold)">${after.left}</b> 個字沒學會 —— 完成度 100% 才會開放下一關。</p>`}
         ${memeTag('clear')}`
      : `<div class="big" style="color:var(--red)">未通關</div>
         <p class="muted">正確率 ${Math.round(acc * 100)}%，沒到 <b>${Math.round(S.passAcc() * 100)}%</b> 的通關門檻。這一關的 XP 與金幣都不算，要再挑戰一次。</p>
         ${memeTag('fail')}
         ${m.shielded ? '<p style="color:var(--blue)">🛡 連勝護盾擋下了，連勝保住！</p>' : (streakBefore ? '<p class="tiny">連勝歸零。</p>' : '')}`;

    render(`<div class="card sheet" style="text-align:center">
      ${head}
      <div class="grid2" style="margin-top:14px">
        <div class="stat ok"><b>${run.right}</b><span>答對</span></div>
        <div class="stat no"><b>${graded.length - run.right}</b><span>答錯</span></div>
        <div class="stat"><b>${Math.round(acc * 100)}%</b><span>正確率</span></div>
        <div class="stat gold"><b>×${run.bestCombo}</b><span>本關最高連擊</span></div>
        <div class="stat blue"><b>${fmtSec(used)}</b><span>本關用時</span></div>
        <div class="stat purple"><b>${graded.length ? fmtSec(used / graded.length) : '—'}</b><span>平均每題</span></div>
      </div>
      ${passed ? `<div class="big" style="color:var(--ac);margin-top:14px">+${xpGain} XP　<span style="color:var(--gold)">+${coinGain} 🪙</span></div>
        <div class="tiny">${bonusNote}</div>
        ${S.winStreak() >= 2 ? `<p class="tiny" style="color:var(--blue)">⚡ ${S.winStreak()} 連勝　下一關 XP +${Math.round(S.winStreakBonus() * 100)}%</p>` : ''}
        ${checkin ? `<p class="tiny">每日簽到 +${checkin.xp} XP　+${checkin.coin} 🪙${checkin.chest ? `　💎 金寶箱（已放進背包）` : ''}</p>` : ''}` : ''}
      ${drops.length ? `<div class="lootrow">${drops.map(x => {
        const m = S.material(x.id);
        return `<span class="loot item">${m.icon} ${esc(m.name)} ×${x.n}</span>`;
      }).join('')}</div><p class="tiny">素材已放進背包，可以拿去合成道具。</p>` : ''}
      ${quests.length ? `<div class="badges" style="justify-content:center">${quests.map(q => `<span class="badge got">✅ ${esc(q.name)} +${q.xp}XP +${q.coin}🪙</span>`).join('')}</div>` : ''}
      ${got.length ? `<div class="badges" style="justify-content:center">${got.map(b => `<span class="badge got">🏅 ${esc(b.name)}</span>`).join('')}</div>` : ''}
      <div class="btnrow" style="justify-content:center;margin-top:16px">
        ${passed && after.full && window.__nextStage
        ? `<button class="btn primary big-btn" data-act="nextMapStage">下一關 ・ ${window.__nextStage.lv} 級 ${window.__nextStage.letter} →</button>` : ''}
        ${passed && !after.full
        ? `<button class="btn primary big-btn" data-act="continueLetter">繼續練習（新單字 ${Math.min(after.left, S.settings.stageQuestions || 10)} 個）→</button>` : ''}
        ${!passed ? '<button class="btn primary" data-act="retryMapStage">再挑戰一次</button>' : ''}
        ${window.__wrongIds.length ? `<button class="btn gold" data-act="fixWrong">✏ 訂正錯的 ${window.__wrongIds.length} 個字</button>` : ''}
        <button class="btn ghost" data-act="backToMap">回關卡地圖</button>
      </div>
    </div>
    ${passed ? chestCard() : ''}
    <div class="card"><h3>逐題檢討（答錯的排前面）</h3>${reviewList()}</div>`);
    showLevelUps(gifts);
  }

  // ---------------- 寶箱與加碼題 ----------------
  /** 通關後的獎勵區：一個寶箱 ＋ 一次加碼題機會（答錯不倒扣）。 */
  function chestCard() {
    const c = window.__chest;
    if (!c) return '';
    const t = S.CHEST[c.tier];
    if (c.opened) {
      const r = c.reward || {};
      return `<div class="card chestcard opened">
        <div class="chestrow"><div class="chesticon pop ${t.cls}">${t.icon}</div>
          <div><b>${esc(t.name)}已開啟</b>
            <div class="tiny">🪙 +${r.coin}　✨ +${r.xp} XP</div>
            <div class="tiny">${(r.drops || []).map(d => esc(d.label)).join('　')}</div></div></div>
      </div>`;
    }
    return `<div class="card chestcard ${t.cls}">
      <h3>🎉 通關獎勵</h3>
      <div class="chestrow">
        <div class="chesticon shake ${t.cls}">${t.icon}</div>
        <div><b>你獲得一個 ${esc(t.name)}</b>
          <div class="tiny">抽 ${t.rolls} 次獎品：金幣、XP、素材、道具，稀有的還有鑰匙、復活石、神秘禮物。</div></div>
      </div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn gold big-btn" data-act="openChest">🎁 打開寶箱</button>
        ${(() => {
        if (c.bonusUsed) return '';
        const left = bonusPool(c).length;
        if (!left) return '<span class="tiny">這一關的字都考過了，沒有加碼題可以出。</span>';
        return `<button class="btn purple" data-act="bonusRound">🎲 加碼題 ${Math.min(bonusCount(c), left)} 題（答錯不倒扣）</button>`;
      })()}
      </div>
      ${c.bonusUsed ? '' : memeTag('bonus')}
      <p class="tiny">不想現在開也可以 —— 寶箱<b>已經收進背包</b>了，之後可以在背包一次全開（🎒 目前存了 ${S.chestBagSummary().total} 箱）。</p>
      <p class="tiny">加碼題只出<b>這一關範圍內、剛剛沒考過的字</b>（沒學過的優先），題數是這一關的 ⅓（3～8 題）。
        全對升兩級、答對六成以上升一級，金寶箱還能升到 🌈 彩虹。</p>
    </div>`;
  }

  /** 進全螢幕寶箱前，先把結算畫面存起來，開完箱才能原封不動回去。 */
  function saveResultScreen() {
    const wrap = document.querySelector('.wrap');
    if (wrap) window.__resultHtml = wrap.innerHTML;
  }
  function backFromChest() {
    if (window.__chest && window.__chest.fromKey) return bag();
    if (window.__resultHtml) {
      render(window.__resultHtml);
      const el = document.querySelector('.chestcard');
      if (el) { el.outerHTML = chestCard(); return; }
      // 加碼題結算那類畫面沒有寶箱卡，就把「開寶箱」鈕換成已開啟的結果，不留死按鈕
      const btn = document.querySelector('[data-act="openChest"]');
      if (btn) {
        const r = (window.__chest || {}).reward || {};
        btn.outerHTML = `<span class="loot coin">${S.CHEST[r.tier] ? S.CHEST[r.tier].icon : '📦'} 已開箱　🪙 +${r.coin || 0}　✨ +${r.xp || 0} XP</span>`;
      }
      return;
    }
    const c = window.__lastMap;
    return c ? letterSetup(c.lv, c.letter) : home();
  }

  /** 全螢幕選箱：三個箱子擺滿整個畫面，自己挑一個。 */
  function openChestFlow() {
    const c = window.__chest;
    if (!c || c.opened) return;
    saveResultScreen();
    const t = S.CHEST[c.tier];
    render(`<div class="chestscene ${t.cls}">
      <div class="csglow"></div>
      <div class="cshead">
        <div class="cstier">${t.icon} ${esc(t.name)}</div>
        <h2>選一個箱子打開</h2>
        <p class="muted">三個都是同一級的寶箱，抽 ${t.rolls} 次獎品。挑一個順眼的。</p>
      </div>
      <div class="chestpick big">${[0, 1, 2].map(k =>
      `<button class="chestbtn ${t.cls}" data-openchest="${k}">
          <span class="cbicon">${t.icon}</span><span class="cbnum">箱 ${k + 1}</span></button>`).join('')}</div>
      <div class="btnrow" style="justify-content:center;margin-top:8px">
        <button class="btn ghost" data-act="chestLater">先收進背包，之後再開</button>
      </div>
      <p class="tiny" style="text-align:center;margin-top:18px">稀有獎品：💎 金鑽石、🔑 寶箱鑰匙、復活石、三倍 XP 卡、🪙 金幣大獎、🎀 神秘禮物（機率很低）</p>
    </div>`);
  }

  /** 一次全開：全螢幕演出，先給總計，再列出每一箱開到什麼。 */
  function openAllChests() {
    const r = S.openAllStored();
    if (!r) return toast('背包裡沒有寶箱');
    sfx.clear();
    if (r.total.special) setTimeout(() => sfx.lvl(), 350);
    const gifts = S.claimLevelUps();
    // 同樣的獎品合併顯示，不然開 20 箱會洗版
    const merged = {};
    r.total.drops.forEach(d => { merged[d.label] = (merged[d.label] || 0) + 1; });
    render(`<div class="chestscene open c-gold">
      <div class="csglow big"></div>
      <div class="cshead">
        <div class="chesticon huge pop">🎉</div>
        <div class="big" style="margin-top:4px">開了 ${r.count} 箱</div>
        ${r.total.special ? '<p class="tiny" style="color:var(--gold)">✨ 其中有稀有獎品！</p>' : ''}
        ${memeTag('chest', 'gold')}
      </div>
      <div class="lootbig">
        <div class="loot coin big">🪙 +${r.total.coin}</div>
        <div class="loot xp big">✨ +${r.total.xp} XP</div>
        ${Object.keys(merged).map((label, k) =>
      `<div class="loot item big" style="animation-delay:${0.08 * (k + 1)}s">${esc(label)}${merged[label] > 1 ? ` ×${merged[label]}` : ''}</div>`).join('')}
      </div>
      <div class="tblwrap" style="max-width:520px;margin:18px auto 0">
        <table class="rep log"><tr><th>寶箱</th><th>金幣</th><th>XP</th><th>獎品</th></tr>
        ${r.results.map(x => `<tr><td>${S.CHEST[x.tier].icon} ${esc(x.name)}</td><td>+${x.coin}</td><td>+${x.xp}</td>
          <td class="tiny">${(x.drops || []).map(d => esc(d.label)).join('、')}</td></tr>`).join('')}
        </table>
      </div>
      <div class="btnrow" style="justify-content:center;margin-top:20px">
        <button class="btn primary big-btn" data-go="bag">收下獎品</button>
      </div>
    </div>`);
    showLevelUps(gifts);
  }

  /** 全螢幕開箱演出：箱子放大 → 一項一項亮出獎品。 */
  function revealChest(pick) {
    const c = window.__chest;
    if (!c || c.opened) return;
    const r = c.id ? (S.openStored(c.id) || S.openChest(c.tier)) : S.openChest(c.tier);
    c.opened = true; c.reward = r; c.tier = r.tier;
    const t = S.CHEST[r.tier];
    sfx.clear();
    if (r.special) setTimeout(() => sfx.lvl(), 350);
    const gifts = S.claimLevelUps();
    render(`<div class="chestscene open ${t.cls}">
      <div class="csglow big"></div>
      <div class="cshead">
        <div class="chesticon huge pop ${t.cls}">${t.icon}</div>
        <div class="big" style="margin-top:4px">${esc(r.name)}</div>
        ${r.upgraded ? '<p class="tiny" style="color:var(--purple)">🦄 獨角獸讓這個箱子升了一級！</p>' : ''}
        ${r.special ? '<p class="tiny" style="color:var(--gold)">✨ 開出稀有獎品！</p>' : ''}
        ${memeTag('chest', r.tier)}
      </div>
      <div class="lootbig">
        <div class="loot coin big">🪙 +${r.coin}</div>
        <div class="loot xp big">✨ +${r.xp} XP</div>
        ${(r.drops || []).map((d, k) => `<div class="loot ${d.special ? 'rare' : 'item'} big" style="animation-delay:${0.12 * (k + 1)}s">${esc(d.label)}</div>`).join('')}
      </div>
      <div class="btnrow" style="justify-content:center;margin-top:22px">
        <button class="btn primary big-btn" data-act="chestDone">收下獎品</button>
      </div>
      <p class="tiny" style="text-align:center;margin-top:10px">素材放進背包（合成台可以換道具），金幣與 XP 已入帳。</p>
    </div>`);
    window.__chestGifts = gifts;
  }

  /** 加碼題數：跟著這一關的規模走（一關的三分之一，3～8 題），不是固定 5 題。 */
  function bonusCount(c) {
    const stageN = (c && c.count) || (S.settings.stageQuestions || 10);
    return Math.max(3, Math.min(8, Math.round(stageN / 3)));
  }
  /** 這一關（同級同字母）還沒考到的字 —— 加碼題只能用這些。 */
  function bonusPool(c) {
    if (!c || !c.lv || !c.letter) return [];
    const used = new Set((c.ids || []).filter(i => i != null));
    return S.bucket(c.lv, c.letter).filter(i => !used.has(i));
  }

  /* 加碼題只出「這一關範圍內、但剛剛沒考過的字」。
     沒學過的排前面（跟一般出題一致），出題型難一階（拚寶箱升級）。
     這個字母已經全部考完就不給加碼題 —— 寧可不給，也不重複考一樣的字。 */
  function bonusRound() {
    const c = window.__chest;
    if (!c || c.bonusUsed) return;
    const pool = bonusPool(c);
    if (!pool.length) return toast('這一關的字都考過了，加碼題沒有新字可出');
    const want = Math.min(bonusCount(c), pool.length);
    const shift = (S.diff().tierShift || 0) + 1;
    const fresh = pool.filter(i => !S.isSeen(i));      // 沒學過的優先
    const rest = Q.byErrWeight(pool.filter(i => S.isSeen(i)));
    const order = Q.shuffle(fresh).concat(rest);
    const qs = [];
    for (const i of order) {
      if (qs.length >= want) break;
      if (qs.some(q => q.i === i)) continue;           // 一個字最多一題
      const q = Q.forWord(V()[i], null, shift);
      if (q && !q.noGrade) qs.push(q);                 // 自由造句沒對錯，不能當加碼題
    }
    if (!qs.length) return toast('抽不到加碼題，直接開箱吧');
    c.bonusUsed = true;
    runStage({
      title: `🎲 加碼題（${qs.length} 題・全部是這一關沒考過的字）`,
      questions: qs, hearts: 0, bonus: true,
      regen: info => Q.byErrWeight(pool).slice(0, want)
        .map(i => Q.forWord(V()[i], null, shift, info.avoidKinds[i]))
        .filter(q => q && !q.noGrade),
    });
  }

  function finishBonus() {
    const c = window.__chest;
    const graded = run.answers.filter(a => a.ok !== null);
    const right = run.right, total = graded.length;
    // 全對升兩級（金 → 彩虹）、過半升一級、其餘不升但不倒扣
    const ups = total && right === total ? 2 : right >= Math.ceil(total * 0.6) ? 1 : 0;
    let tier = c ? c.tier : null;
    for (let k = 0; k < ups && c; k++) tier = S.upgradeChest(tier, true);
    if (c) {
      c.tier = tier;
      const row = S.chestBag().find(x => x.id === c.id);   // 背包裡那一箱同步升級
      if (row) { row.tier = tier; S.save(true); }
    }
    const bonusXp = run.pendingXp + (ups === 2 ? 60 : ups === 1 ? 25 : 0);
    closeRun({ passed: ups > 0, xp: bonusXp });
    S.addXp(bonusXp);
    const gifts = S.claimLevelUps();
    ups ? sfx.clear() : sfx.no();
    const nx = window.__nextStage, lm = window.__lastMap;
    render(`<div class="card sheet" style="text-align:center">
      <div class="big" style="color:${ups ? 'var(--gold)' : 'var(--tx2)'}">
        ${ups === 2 ? '🎲 全部答對！' : ups === 1 ? '🎲 加碼成功！' : '🎲 這次沒中'}</div>
      <div class="grid2" style="margin-top:12px">
        <div class="stat ok"><b>${right}/${total}</b><span>加碼題答對</span></div>
        <div class="stat gold"><b>${ups ? '+' + ups + ' 級' : '—'}</b><span>寶箱升級</span></div>
        <div class="stat"><b>+${bonusXp}</b><span>XP</span></div>
      </div>
      <p class="muted" style="margin-top:10px">${ups
      ? `寶箱變成 <b>${S.CHEST[c.tier].icon} ${esc(S.CHEST[c.tier].name)}</b>${ups === 2 ? '（全對加兩級）' : ''}`
      : '加碼題答錯不倒扣，原本的寶箱還在。'}</p>
      <p class="tiny">全對升兩級 ・ 答對 ${Math.ceil(total * 0.6)} 題以上升一級 ・ 沒到就維持原本的箱子</p>
      <div class="btnrow" style="justify-content:center;margin-top:14px">
        ${c && !c.opened ? `<button class="btn gold big-btn" data-act="openChest">🎁 打開${esc(S.CHEST[c.tier].name)}</button>` : ''}
        ${nx ? `<button class="btn primary" data-act="nextMapStage">下一關 ・ ${nx.lv} 級 ${nx.letter} →</button>` : ''}
        ${(window.__wrongIds || []).length ? `<button class="btn" data-act="fixWrong">✏ 訂正錯的字</button>` : ''}
        <button class="btn ghost" data-act="backToMap">回關卡地圖</button>
        <button class="btn ghost" data-go="home">回首頁</button>
      </div>
    </div>
    <div class="card"><h3>加碼題檢討</h3>${reviewList()}</div>`);
    showLevelUps(gifts);
  }

  /** 訂正關結束：不判成敗，回到原本的地方。 */
  function finishFixStage() {
    const cfg = run.cfg;
    const graded = run.answers.filter(a => a.ok !== null);
    const acc = graded.length ? run.right / graded.length : 1;
    S.addXp(run.pendingXp);
    const gifts = S.claimLevelUps();
    const rec = closeRun({ passed: null, xp: run.pendingXp });
    sfx.clear();
    render(`<div class="card sheet" style="text-align:center">
      <h2>訂正完成</h2>
      <p class="muted">這輪訂正答對 ${run.right}/${graded.length}（${Math.round(acc * 100)}%）　+${run.pendingXp} XP　用時 ${fmtSec(rec ? rec.sec : 0)}</p>
      <p class="tiny">訂正不影響關卡成敗，但答對會把這些字往後排、答錯會留在明天的複習裡。</p>
      <div class="btnrow" style="justify-content:center;margin-top:14px">
        <button class="btn primary" data-act="backToMap">回關卡地圖</button>
      </div>
    </div>
    <div class="card"><h3>逐題檢討</h3>${reviewList()}</div>`);
    showLevelUps(gifts);
  }

  /* 逐題檢討：答案預設「蓋住」，按了才顯示。
     這樣可以先自己想一次（回想才會記住），而不是一眼看到答案就滑過去。 */
  const hide = (text, key) => `<button class="revealbtn" data-reveal="${esc(key)}" data-ans="${esc(text)}">看答案</button>`;

  function reviewList() {
    const rows = run.answers.map((a, n) => {
      const q = a.q, w = q.i != null ? V()[q.i] : null;
      const yours = q.opts ? (q.opts[a.given] != null ? q.opts[a.given] : '（未作答）') : (a.given || '（未作答）');
      const right = q.opts ? q.opts[q.a] : (q.answer || '');
      const mark = a.ok === null ? '📝' : a.ok ? '✓' : '✗';
      const color = a.ok === null ? 'var(--tx2)' : a.ok ? 'var(--ac)' : 'var(--red)';
      const why = q.why ? esc(q.why).replace(/\n/g, '<br>') : '';
      const trap = w && (window.SENTENCES[w.w] || {}).trap;
      return {
        ok: a.ok,
        html: `<div style="border-bottom:1px solid var(--line);padding:10px 0">
          <div><b style="color:${color}">${mark}</b> ${w ? `<b>${esc(w.w)}</b> ${dictMini(w.w)} <span class="tiny">${esc(w.p)} L${w.lv}</span>` : `<b>${esc(window.GRAMMAR_TITLES[q.gid] || '文法')}</b>`}
            ${a.gained ? `<span class="tiny" style="color:var(--ac);float:right">+${a.gained} XP</span>` : ''}</div>
          ${a.ok === false ? `<div class="tiny">你的答案：<span style="color:var(--red)">${esc(yours)}</span>　正確：${hide(right, 'r' + n)}</div>` : ''}
          ${a.ok === true ? `<div class="tiny">正確答案：${hide(right, 'r' + n)}</div>` : ''}
          ${a.ok === null ? `<div class="tiny">你寫的：${esc(yours)}</div>` : ''}
          ${a.ok === false && why ? `<div class="tiny" style="color:var(--tx2);margin-top:4px">${why}</div>` : ''}
          ${a.ok === false && trap ? `<div class="tiny" style="color:var(--gold)">⚠ ${esc(trap)}</div>` : ''}
        </div>`,
      };
    });
    rows.sort((a, b) => (a.ok === false ? 0 : a.ok === null ? 1 : 2) - (b.ok === false ? 0 : b.ok === null ? 1 : 2));
    return `<div class="btnrow" style="margin-bottom:6px">
        <button class="btn sm ghost" data-act="revealAll">👁 全部顯示答案</button>
        <span class="tiny">答案預設蓋住 —— 先自己回想一次，記得比較牢。</span>
      </div>${rows.map(r => r.html).join('')}`;
  }

  function finishStage() {
    clearInterval(run.timer);
    run.inStage = false;
    const cfg = run.cfg;
    if (cfg.map) return finishMapStage();
    if (cfg.bonus) return finishBonus();
    if (cfg.fix) return finishFixStage();

    const graded = run.answers.filter(a => a.ok !== null);
    const acc = graded.length ? run.right / graded.length : 1;
    const stars = acc >= .9 ? 3 : acc >= .7 ? 2 : 1;
    const perfect = run.maxHearts > 0 && run.hearts === run.maxHearts && acc === 1;
    if (perfect) S.notePerfect();
    S.touchStreak();
    sfx.clear();

    // ---- 這裡才是真正的結算：XP 入帳、簽到、難度加成、每日任務、徽章 ----
    const fits = S.difficultyFits();
    const fitBonus = fits ? Math.round(run.pendingXp * 0.2) : 0;
    const before = S.stats().level;
    S.addXp(run.pendingXp + fitBonus);
    const checkin = S.checkIn();
    const quests = S.awardQuests();
    const after = S.stats().level;
    const got = S.checkBadges({ bestCombo: run.bestCombo, perfectStage: perfect });
    const gifts = S.claimLevelUps();
    const rec = closeRun({ passed: true, stars, xp: run.pendingXp + fitBonus });
    const used = rec ? rec.sec : 0;

    const earned = run.pendingXp + fitBonus + (checkin ? checkin.xp : 0) + quests.reduce((a, q) => a + q.xp, 0);

    render(`<div class="card sheet" style="text-align:center">
      <div class="qtag">${esc(cfg.title)} 完成</div>
      <div class="stars" style="font-size:40px">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
      <div class="grid2" style="margin-top:14px">
        <div class="stat ok"><b>${run.right}</b><span>答對</span></div>
        <div class="stat no"><b>${graded.length - run.right}</b><span>答錯</span></div>
        <div class="stat"><b>${Math.round(acc * 100)}%</b><span>正確率（本次）</span></div>
        <div class="stat gold"><b>×${run.bestCombo}</b><span>本關最高連擊</span></div>
        <div class="stat blue"><b>${fmtSec(used)}</b><span>本關用時</span></div>
        <div class="stat purple"><b>${graded.length ? fmtSec(used / graded.length) : '—'}</b><span>平均每題</span></div>
      </div>
      <div class="big" style="color:var(--ac);margin-top:14px">+${earned} XP</div>
      <div class="tiny">答題 ${run.pendingXp}${fitBonus ? `　難度適配加成 +${fitBonus}` : ''}${checkin ? `　每日簽到 +${checkin.xp}` : ''}${quests.length ? `　任務獎勵 +${quests.reduce((a, q) => a + q.xp, 0)}` : ''}</div>
      ${fits ? `<p class="tiny" style="color:var(--gold)">🎯 目前難度「${esc(S.diff().name)}」符合你的程度，XP ×1.2 加成</p>`
        : `<p class="tiny">目前難度低於建議的「${esc(S.DIFFICULTY[S.recommendDifficulty()].name)}」，沒有適配加成。</p>`}
      ${after > before ? `<p style="color:var(--purple)">⬆ 升級！Lv.${after}</p>` : ''}
      ${perfect ? '<p style="color:var(--gold)">🏆 無傷全對通關！</p>' : ''}
      ${run.retries ? `<p class="tiny">重來了 ${run.retries} 次（正確率只採計第 1 次作答）</p>` : ''}
      ${quests.length ? `<div class="badges" style="justify-content:center">${quests.map(q => `<span class="badge got">✅ ${esc(q.name)} +${q.xp}</span>`).join('')}</div>` : ''}
      ${got.length ? `<div class="badges" style="justify-content:center">${got.map(b => `<span class="badge got">🏅 ${esc(b.name)}</span>`).join('')}</div><p class="tiny">解鎖新徽章！</p>` : ''}
      <div class="btnrow" style="justify-content:center;margin-top:14px">
        <button class="btn gold" data-go="report">看今日成績單</button>
        <button class="btn" data-go="records">📜 作答紀錄</button>
      </div>
    </div>
    <div class="card">
      <h3>逐題檢討（答錯的排前面）</h3>
      ${reviewList()}
      <p class="tiny" style="margin-top:10px">答錯的字已經排進複習，明天會再出現。</p>
    </div>`);
    showLevelUps(gifts);
  }

  // ---------------- 三個關卡 ----------------
  function startReview() {
    const ids = S.dueList(15).map(x => x.i);
    if (!ids.length) { toast('今天沒有到期的字'); return home(); }
    const qs = Q.reviewSet(ids, S.diff().tierShift);
    // 複習關也放一題文法（文法要靠反覆碰到才會變成直覺）
    const g = (S.settings.gramPerStage || 0) > 0 ? Q.grammarSet(1).questions : [];
    if (g.length) qs.splice(Math.floor(qs.length / 2), 0, g[0]);
    runStage({
      title: '複習到期單字', questions: qs, hearts: S.diff().hearts, review: true,
      regen: info => Q.reviewSet(ids, S.diff().tierShift, info.avoidKinds),
    });
  }

  // ---------------- 成績單 / 家長回報 ----------------
  /** 把連續的字母壓成範圍：A B C D F → 「A–D、F」。 */
  function letterRanges(list) {
    const order = S.LETTERS;
    const idx = list.map(L => order.indexOf(L)).sort((a, b) => a - b);
    const out = [];
    let start = null, prev = null;
    idx.forEach(i => {
      if (start === null) { start = prev = i; return; }
      if (i === prev + 1) { prev = i; return; }
      out.push([start, prev]); start = prev = i;
    });
    if (start !== null) out.push([start, prev]);
    return out.map(([a, b]) => (a === b ? order[a] : `${order[a]}–${order[b]}`)).join('、');
  }

  /** 每一級的進度：完成了哪些字母關、還剩幾關、學會幾個字。 */
  function levelProgress() {
    return [1, 2, 3, 4, 5, 6].map(lv => {
      const playable = S.LETTERS.filter(L => S.bucket(lv, L).length);
      const done = playable.filter(L => S.mapStat(lv, L).full);
      const ls = S.levelStat(lv);
      const base = { lv, total: playable.length, done: done.length, known: ls.known, words: ls.total };
      if (!playable.length) return Object.assign(base, { text: `第 ${lv} 級：沒有可玩的關卡` });
      if (done.length === playable.length) {
        return Object.assign(base, { all: true, text: `第 ${lv} 級：✅ 全部完成（${playable.length} 關、${ls.total} 字）` });
      }
      if (!done.length) {
        return Object.assign(base, { text: `第 ${lv} 級：尚未完成任何字母關（已學會 ${ls.known}/${ls.total} 字）` });
      }
      return Object.assign(base, {
        text: `第 ${lv} 級：${letterRanges(done)} 完成（${done.length}/${playable.length} 關），其餘未完成（已學會 ${ls.known}/${ls.total} 字）`,
      });
    });
  }

  function reportText(sum) {
    const st = S.stats(), d = sum.date.split('-');
    const wd = WD[new Date(+d[0], +d[1] - 1, +d[2]).getDay()];
    const wrong = sum.wrongWords.map(i => V()[i].w);
    const lvOf = sum.newIds.map(i => V()[i].lv);
    const lvMain = lvOf.length ? 'L' + [...new Set(lvOf)].sort().join('/L') : '—';
    const gramNames = [...new Set((S.day(sum.date).gram || []).map(g => window.GRAMMAR_TITLES[g.id]))].filter(Boolean);
    const pct = n => sum.reviewTotal ? Math.round(sum.reviewRight / sum.reviewTotal * 100) : 0;
    return [
      `【英文學習回報】${d[0]}/${d[1]}/${d[2]}（${wd}）`,
      ``,
      `■ 今天學了幾個新單字：${sum.newCount} 個（${lvMain}）`,
      `■ 今天複習的單字：共 ${sum.reviewTotal} 題 → 對 ${sum.reviewRight} 個、錯 ${sum.reviewWrong} 個（正確率 ${pct()}%）`,
      `■ 造句運用：${sum.applyTotal} 題 → 對 ${sum.applyRight} 個`,
      `■ 文法練習：${sum.gramTotal} 題 → 對 ${sum.gramRight} 個${gramNames.length ? `（${gramNames.join('、')}）` : ''}`,
      sum.free.length ? `■ 自己造句：寫了 ${sum.free.length} 句（待老師批改）` : null,
      sum.sweepKnown || sum.sweepLearn
        ? `■ 快速篩選：確認「本來就會」${sum.sweepKnown} 字（不列入新學）、挑出 ${sum.sweepLearn} 字要學`
        + (sum.sweepTotal ? `；抽考 ${sum.sweepTotal} 題對 ${sum.sweepRight} 題` : '')
        : null,
      ``,
      `■ 今天實際練習時間：${fmtSec(S.runSeconds(sum.date))}（共闖 ${S.runLog(sum.date).length} 關，通關 ${S.day(sum.date).cleared || 0} 關）`,
      `■ 今天完成的任務：${(S.questLog(sum.date) || []).length} 項`,
      ``,
      `【目前進度】`,
      ...levelProgress().map(x => '　' + x.text),
      `　關卡總進度：${st.clearedStages}/${st.playableStages} 個字母關完成`,
      ``,
      `累積已學會 ${st.known} 字 ／ 全書 ${V().length} 字（${(st.known / V().length * 100).toFixed(1)}%）`,
      `連續學習 ${st.streak} 天 ・ 今日獲得 ${sum.xp} XP ・ 等級 Lv.${st.level}`,
      sum.retries ? `本日闖關重來 ${sum.retries} 次（正確率只採計第 1 次作答）` : null,
      ``,
      wrong.length ? `今天答錯、需要加強的字（${wrong.length}）：\n${wrong.join('、')}` : `今天全部答對，沒有需要加強的字 👍`,
      (() => {
        const lc = S.leeches(12);
        return lc.length ? `\n反覆答錯 3 次以上的難字（${S.leeches().length}）：\n${lc.map(x => V()[x.i].w).join('、')}\n（這些字的出題機率已自動調高，答錯還會當場補考）` : null;
      })(),
      ``,
      `— 出自大學入學考試中心《高中英文參考詞彙表》（111 學年度起適用）`,
    ].filter(x => x !== null).join('\n');
  }

  function report() {
    const t = S.todayStr(), sum = S.summary(t), st = S.stats();
    const txt = reportText(sum);
    const hist = S.history(14).filter(h => h.reviewTotal || h.newCount);
    const typeName = { e2c: '英→中', c2e: '中→英', listen: '聽發音', spell: '拼字', form: '詞形變化', confuse: '易混淆字', cloze: '例句克漏字', order: '句子重組', trans: '中譯英填空' };
    const typeRows = Object.entries(sum.byType).map(([k, v]) =>
      `<tr><td class="w">${esc(typeName[k] || k)}</td><td>${v.n}</td><td style="color:var(--ac)">${v.ok}</td><td style="color:var(--red)">${v.n - v.ok}</td><td>${Math.round(v.ok / v.n * 100)}%</td></tr>`).join('');
    const wrongRows = sum.wrongWords.map(i => {
      const w = V()[i];
      return `<tr><td class="w">${esc(w.w)} ${dictMini(w.w)}</td><td class="muted">${esc(w.p)} L${w.lv}</td><td>${esc(w.tr)}</td></tr>`;
    }).join('');
    const histRows = hist.map(h => `<tr><td>${h.date.slice(5)}</td><td>${h.newCount}</td><td>${h.reviewTotal}</td>
      <td style="color:var(--ac)">${h.reviewRight}</td><td style="color:var(--red)">${h.reviewWrong}</td>
      <td>${h.reviewTotal ? Math.round(h.reviewRight / h.reviewTotal * 100) + '%' : '—'}</td></tr>`).join('');

    render(`
      <div class="card">
        ${pageHead(`今日成績單 <span class="tiny">${t}</span>`, { back: true })}
        <div class="grid2">
          <div class="stat ok"><b>${sum.newCount}</b><span>今天學的新單字</span></div>
          <div class="stat"><b>${sum.reviewTotal}</b><span>複習題數</span></div>
          <div class="stat ok"><b>${sum.reviewRight}</b><span>複習答對</span></div>
          <div class="stat no"><b>${sum.reviewWrong}</b><span>複習答錯</span></div>
          <div class="stat gold"><b>${sum.applyRight}/${sum.applyTotal}</b><span>造句運用</span></div>
          <div class="stat gold"><b>${sum.gramRight}/${sum.gramTotal}</b><span>文法</span></div>
          <div class="stat"><b>${sum.stars}</b><span>今日星數</span></div>
          <div class="stat"><b>${sum.xp}</b><span>今日 XP</span></div>
        </div>
      </div>

      <div class="card">
        <h3>目前進度</h3>
        ${levelProgress().map(x => `<div class="prow">
          <div class="ptop"><span>${x.all ? '✅ ' : ''}${esc(x.text.replace(/^第 \d+ 級：/, `第 ${x.lv} 級 　`))}</span><b>${x.done}/${x.total} 關</b></div>
          <div class="xpbar g-lv${x.lv}"><i style="width:${x.total ? (x.done / x.total * 100).toFixed(1) : 0}%"></i></div>
        </div>`).join('')}
        <p class="tiny" style="margin-top:8px">關卡總進度 ${st.clearedStages}/${st.playableStages} 關　・
          累積已學會 ${st.known}/${V().length} 字（${(st.known / V().length * 100).toFixed(1)}%）</p>
      </div>

      ${typeRows ? `<div class="card"><h3>各題型表現（採計第 1 次作答）</h3><div class="tblwrap"><table class="rep">
        <tr><th>題型</th><th>題數</th><th>對</th><th>錯</th><th>正確率</th></tr>${typeRows}</table></div></div>` : ''}

      ${wrongRows ? `<div class="card"><h3>今天答錯、要加強的字（${sum.wrongWords.length}）</h3><div class="tblwrap"><table class="rep">
        <tr><th>單字</th><th>級別</th><th>意思</th></tr>${wrongRows}</table></div>
        <p class="tiny">這些字已經排進明天的複習。</p></div>` : ''}

      ${sum.free.length ? `<div class="card"><h3>今天的自由造句（${sum.free.length} 句・待批改）</h3>
        ${sum.free.map(f => `<p style="margin:8px 0"><b>${esc(f.w)}</b>：${esc(f.text)}</p>`).join('')}
        <p class="tiny">下載今日紀錄後，跟 Claude Code 說「批改今天的造句並出分析報告」。</p></div>` : ''}

      <div class="card">
        <h3>給家長的回報（可直接貼到 LINE）</h3>
        <pre class="report" id="rep">${esc(txt)}</pre>
        <div class="btnrow noprint">
          <button class="btn primary" data-act="copyReport">📋 複製給家長</button>
          <button class="btn" data-act="printReport">🖨 列印／存 PDF</button>
          <button class="btn" data-act="dlJson">⬇ 下載今日紀錄（給 Claude Code 批改）</button>
          <button class="btn" data-act="dlHtml">⬇ 下載成績單存檔</button>
        </div>
        <p class="tiny">下載的檔案請存到 <code>myLearning/progress/</code>，我讀那個資料夾就能出深度分析報告。</p>
      </div>

      ${histRows ? `<div class="card"><h3>最近 14 天</h3><div class="tblwrap"><table class="rep">
        <tr><th>日期</th><th>新字</th><th>複習</th><th>對</th><th>錯</th><th>正確率</th></tr>${histRows}</table></div></div>` : ''}

      <div class="btnrow noprint"></div>
    `);
  }

  function download(name, text, mime) {
    const b = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function dlJson() {
    const t = S.todayStr(), sum = S.summary(t), d = S.day(t), st = S.stats();
    const detail = (d.log || []).map(x => Object.assign({}, x, {
      word: x.i != null ? V()[x.i].w : null,
      gloss: x.i != null ? V()[x.i].tr : null,
      level: x.i != null ? V()[x.i].lv : null,
    }));
    const gram = (d.gram || []).map(g => Object.assign({}, g, { title: window.GRAMMAR_TITLES[g.id] }));
    const payload = {
      date: t, source: window.VOCAB_META.source,
      student: { level: st.level, xp: st.xp, streak: st.streak, knownWords: st.known, totalWords: V().length },
      map: { winStreak: S.winStreak(), bestWinStreak: S.bestWinStreak(), coins: S.coins(), difficulty: S.diff().id },
      summary: sum,
      newWords: (d.newIds || []).map(i => ({ w: V()[i].w, pos: V()[i].p, lv: V()[i].lv, tr: V()[i].tr })),
      answers: detail, grammar: gram, freeSentences: d.free || [],
      // 每一關的開始／結束時間與用時，讓我看得出「什麼時候學、學多久、哪一關卡住」
      runs: S.runLog(t), secondsInStages: S.runSeconds(t),
      quests: S.questLog(t), questStatus: S.questStatus(t),
      weekQuests: S.periodQuestStatus('week', t), monthQuests: S.periodQuestStatus('month', t),
      chests: S.chestLog(t), checkin: d.checkin || null,
      drops: S.dropLog(t), materials: S.mats(), inventory: S.inventory(),
      note: '請批改 freeSentences（逐句：文法／用字／自然度／改寫建議），並依 answers 的錯誤型態給明日重點。正確率請只採計 attempt===1。',
    };
    download(`${t}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('已下載，請存到 myLearning/progress/');
  }

  function dlHtml() {
    const t = S.todayStr(), sum = S.summary(t);
    const css = 'body{font-family:"Noto Sans TC",system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 18px;color:#1a2233;line-height:1.75}h1{font-size:21px}table{border-collapse:collapse;width:100%;margin:10px 0}td,th{border:1px solid #ccd;padding:6px 9px;text-align:left;font-size:14px}th{background:#f0f3f9}pre{background:#f6f8fc;border:1px solid #ccd;padding:14px;white-space:pre-wrap;font-size:13px;border-radius:8px}.k{display:inline-block;border:1px solid #ccd;border-radius:8px;padding:8px 12px;margin:4px 6px 4px 0;font-size:14px}';
    const wrong = sum.wrongWords.map(i => V()[i]);
    const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>英文學習成績單 ${t}</title>
<style>${css}</style><h1>英文學習成績單　${t}</h1>
<p><span class="k">新單字 ${sum.newCount}</span><span class="k">複習 ${sum.reviewTotal} 題</span>
<span class="k">對 ${sum.reviewRight}</span><span class="k">錯 ${sum.reviewWrong}</span>
<span class="k">造句 ${sum.applyRight}/${sum.applyTotal}</span><span class="k">文法 ${sum.gramRight}/${sum.gramTotal}</span></p>
<h2>目前進度</h2><ul>${levelProgress().map(x => `<li>${esc(x.text)}</li>`).join('')}</ul>
${wrong.length ? `<h2>要加強的字</h2><table><tr><th>單字</th><th>級別</th><th>意思</th></tr>${wrong.map(w => `<tr><td>${esc(w.w)}</td><td>L${w.lv} ${esc(w.p)}</td><td>${esc(w.tr)}</td></tr>`).join('')}</table>` : '<p>今天全部答對。</p>'}
${sum.free.length ? `<h2>自由造句</h2>${sum.free.map(f => `<p><b>${esc(f.w)}</b>：${esc(f.text)}</p>`).join('')}` : ''}
<h2>家長回報</h2><pre>${esc(reportText(sum))}</pre>
<p style="color:#667;font-size:12px">單字闖關 ・ ${esc(window.VOCAB_META.source)}</p></html>`;
    download(`${t}.html`, html, 'text/html');
    toast('成績單已下載');
  }

  async function copyReport() {
    const txt = $('#rep').textContent;
    try {
      await navigator.clipboard.writeText(txt);
      toast('已複製，可直接貼到 LINE');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? '已複製，可直接貼到 LINE' : '複製失敗，請手動選取上面的文字');
    }
  }

  // ---------------- 新字學習卡 ----------------
  /** 闖關前先把沒見過的字一張一張看過。看完呼叫 window.__cards.then()。 */
  function studyCards(ids, k) {
    if (k >= ids.length) {
      // 按過「早就會了」的字不算今天的新字（那不是今天學的）
      const skip = (window.__cards && window.__cards.skip) || [];
      S.markNew(ids.filter(i => !skip.includes(i)));
      announceAutoClear();
      return (window.__cards && window.__cards.then) ? window.__cards.then() : home();
    }
    const w = V()[ids[k]];
    const ex = w.ex || {};
    const forms = Object.keys(ex).map(key => `<span><i>${esc(Q.FORM_LABEL[key] || key)}</i>${esc(ex[key].split(/[,|]/)[0])}</span>`).join('');
    const sen = (window.SENTENCES || {})[w.w];
    render(`
      <div class="hud"><b>先認識新單字</b>
        <button class="btn sm ghost gear" data-act="cardPause" style="order:99">⚙</button>
        <div class="progressline"><i style="width:${k / ids.length * 100}%"></i></div>
        <span class="tiny">${k + 1}/${ids.length}</span></div>
      <div class="card study">
        <span class="lv">第 ${w.lv} 級 ・ ${esc(w.p)}</span>
        <div class="w">${esc(w.w)} <button class="speak" data-say="${esc(Q.base(w.w))}">🔊</button></div>
        ${w.ph ? `<div class="qph">/${esc(w.ph)}/</div>` : ''}
        <div class="tr">${esc(w.tr)}</div>
        ${w.tf && w.tf !== w.tr ? `<div class="tf">${esc(w.tf)}</div>` : ''}
        ${forms ? `<div class="exrow">${forms}</div>` : ''}
        ${sen ? `<div class="qsent" style="margin-top:16px;font-size:17px;text-align:center">${esc(Q.plainSent(sen.ex))}</div>
                 <div class="tiny">${esc(sen.zh)}</div>` : ''}
        ${sen && sen.trap ? `<p class="tiny" style="color:var(--gold);margin-top:8px">⚠ ${esc(sen.trap)}</p>` : ''}
      </div>
      <div class="btnrow" style="justify-content:center">
        ${dictLink(w.w)}
        ${k > 0 ? `<button class="btn ghost" data-act="prevCard">← 上一個 ${kbd('prev')}</button>` : ''}
        <button class="btn primary" data-act="nextCard">${k + 1 >= ids.length ? '開始闖關 →' : '記住了，下一個 →'} ${kbd('card')}</button>
        <button class="btn ghost" data-act="knowCard">這個我早就會了 ⏭ ${kbd('know')}</button>
      </div>
      ${memeTag('cards')}
      ${keyBar([['card', k + 1 >= ids.length ? '開始闖關' : '下一個'], ['prev', '上一個'], ['know', '早就會了'], ['speak', '發音']])}
      <p class="tiny" style="text-align:center">看完這 ${ids.length} 個新字就開始闖關。
        按「早就會了」會把它當已會（不算今天的新字），但 3 天後複習還是會抽考它。</p>
    `);
    window.__cards = {
      ids, k,
      then: (window.__cards && window.__cards.then) || null,
      back: (window.__cards && window.__cards.back) || null,
      skip: (window.__cards && window.__cards.skip) || [],
    };
    if (S.settings.tts) setTimeout(() => say(Q.base(w.w)), 200);
  }

  /** 學習卡也可以暫停：卡片階段還沒開始計時，所以「暫停」＝休息一下，也可以先離開。 */
  function pauseCards() {
    const c = window.__cards;
    if (!c) return;
    if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) { /* 沒語音引擎 */ } }
    overlay(`<h2>⏸ 已暫停</h2>
      ${memeTag('pause')}
      <p class="muted">看到第 ${c.k + 1}/${c.ids.length} 張，慢慢來。這個階段還沒開始計時。</p>
      <p class="tiny">先離開的話這一關不算失敗（還沒開始作答），下次進來會重新看卡片。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        <button class="btn primary" data-close="resume">繼續看卡片</button>
        <button class="btn ghost" data-close="leave">先離開</button>
      </div>`, act => {
        if (act !== 'leave') return studyCards(c.ids, c.k);
        return c.back ? c.back() : home();
      });
  }

  // ---------------- 闖關地圖：6 級 × A–Z ----------------
  function mapLetters(lv) {
    setBack([home]);
    const tiles = S.LETTERS.map(L => {
      const st = S.mapStat(lv, L);
      if (!st.total) return `<button class="pill az" disabled style="opacity:.25">${L}</button>`;
      const pct = Math.round(st.pct * 100);
      const title = `${st.total} 字・已學會 ${st.known}（完成度 ${pct}%）${st.tries ? `・挑戰 ${st.tries} 次` : ''}${st.combo ? `・最佳連擊 ×${st.combo}` : ''}${st.full ? (st.autoDone ? '・全部學會，自動完成 ★★★' : '・已 100% 完成') : ''}`;
      // 100% 完成才給星星；只是某一輪通過就顯示完成度
      const label = st.full ? '★'.repeat(st.stars) + '☆'.repeat(3 - st.stars) : `${pct}%`;
      return `<button class="pill az ${st.full ? 'on' : st.cleared ? 'part' : ''}" data-mapletter="${lv}:${L}" title="${esc(title)}">${L}<br><span style="font-size:10px;opacity:.8">${label}</span></button>`;
    }).join('');
    const st = S.levelStat(lv);
    const fullN = S.LETTERS.filter(L => S.mapStat(lv, L).full).length;
    render(`<div class="card">
      ${pageHead(`第 ${lv} 級　<span class="tiny">${fullN}/${st.playable} 個字母關 100% 完成</span>`, { back: true })}
      <p class="muted">磚上是<b>完成度</b>（這個字母的字學會幾成）。<b style="color:var(--gold)">100% 就直接算完成、直接給 ★★★</b> ——
        不管是打關卡打出來的，還是用快速篩選篩掉的都算。沒到 100% 的話，通關後會給「繼續練習（新單字）」。</p>
      ${bar('這一級的單字進度', st.known, st.total, `${st.known}/${st.total} 字`, 'g-lv' + lv)}
      ${bar('這一級的通關進度', st.cleared, st.playable, `${st.cleared}/${st.playable} 關`, 'g-gold')}
      <div class="pills" style="margin-top:10px">${tiles}</div>
      <p class="tiny" style="margin-top:10px">灰色＝這個字母在這一級沒有字</p>
    </div>`);
  }

  /* 開關前可以選用的消耗品（刪去法與復活石是關卡中手動用，不在這裡）。
     預設一個都不用 —— 道具很貴，不該因為「持有」就被自動吃掉。 */
  /* 每種道具都可以選「用幾個」：
     血量是相加（護心符 +1、大護心符 +3），時間是相加倍率（沙漏 +50%、大沙漏 +100%），
     XP 卡是相乘但封頂 ×5（免得一次燒十張變成刷分）。 */
  const PRE_ITEMS = [
    { id: 'bigheart', short: '大護心符', eff: '♥+3', hearts: 3 },
    { id: 'heart', short: '護心符', eff: '♥+1', hearts: 1 },
    { id: 'hourglass2', short: '大沙漏', eff: '時間+100%', timeAdd: 1 },
    { id: 'hourglass', short: '沙漏', eff: '時間+50%', timeAdd: 0.5 },
    { id: 'xp3', short: '三倍 XP 卡', eff: 'XP ×3', xpMul: 3 },
    { id: 'xp2', short: '雙倍 XP 卡', eff: 'XP ×2', xpMul: 2 },
  ];
  const XP_CAP = 5;                  // XP 卡疊加的上限
  let useItems = {};                 // 這一關各用幾個：{ heart: 2, hourglass: 1 }

  /** 依目前的選擇算出這一關的血量／時間／XP 倍率。 */
  function itemEffect() {
    let hearts = S.diff().hearts, timeMul = 1, xpCard = 1;
    PRE_ITEMS.forEach(it => {
      const n = Math.min(useItems[it.id] || 0, S.inventory()[it.id] || 0);
      if (!n) return;
      if (it.hearts) hearts += it.hearts * n;
      if (it.timeAdd) timeMul += it.timeAdd * n;
      if (it.xpMul) xpCard = Math.min(XP_CAP, xpCard * Math.pow(it.xpMul, n));
    });
    return { hearts, timeMul: Math.round(timeMul * 100) / 100, xpCard: Math.round(xpCard * 100) / 100 };
  }

  /** 選字數畫面上的道具勾選區；沒有任何消耗品就不顯示。 */
  function itemPicker() {
    // 究極高階整個機制關掉：不是「沒得選」，是規則明講不准帶 —— 所以還是要畫出來說明
    if (!S.itemsAllowed()) {
      return `<div class="card itemcard" style="margin-top:14px">
        <h3>🚫 這一階不准帶道具</h3>
        <p class="tiny">「${esc(S.diff().name)}」開始禁道具：護心符、沙漏、XP 卡、刪去法都不能用，
          GAME OVER 也不能用復活石續命。身上的道具不會消失，回到下面的階數就能用。</p>
      </div>`;
    }
    // 一個都沒有時也要把整個機制畫出來（灰的），不然使用者會以為這個功能不存在
    const own = PRE_ITEMS.filter(it => S.owned(it.id));
    if (!own.length) {
      const rows = PRE_ITEMS.map(it => `<div class="itemrow empty">
        <div class="iname"><b>${esc(it.short)}</b><span class="tiny">${esc(it.eff)}　持有 0</span></div>
        <div class="stepper"><button class="btn sm" disabled>−</button><b class="num">0</b><button class="btn sm" disabled>＋</button></div>
      </div>`).join('');
      return `<div class="card itemcard" style="margin-top:14px">
        <h3>🧪 這一關要用道具嗎？<span class="tiny">目前一個都沒有</span></h3>
        <div class="itemlist">${rows}</div>
        <p class="tiny">有道具的時候，這裡就能選<b>這一關要用幾個</b>（− 數字 ＋），血量與時間會即時算給你看。</p>
        <div class="btnrow">
          <button class="btn sm" data-go="shop">🏪 去商店買</button>
          <button class="btn sm" data-go="bag">⚒ 去合成台做</button>
        </div>
      </div>`;
    }
    const eff = itemEffect();
    const any = own.some(it => useItems[it.id]);
    const rows = own.map(it => {
      const have = S.inventory()[it.id] || 0;
      const n2 = Math.min(useItems[it.id] || 0, have);
      return `<div class="itemrow ${n2 ? 'on' : ''}">
        <div class="iname"><b>${esc(it.short)}</b><span class="tiny">${esc(it.eff)}　持有 ${have}</span></div>
        <div class="stepper">
          <button class="btn sm" data-useitem="${it.id}:-1" ${n2 ? '' : 'disabled'}>−</button>
          <b class="num">${n2}</b>
          <button class="btn sm" data-useitem="${it.id}:1" ${n2 < have ? '' : 'disabled'}>＋</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="card itemcard" style="margin-top:14px">
      <h3>🧪 這一關要用道具嗎？<span class="tiny">${any ? '已選好，開始就會消耗' : '預設不用，按 ＋ 才會用'}</span></h3>
      <div class="itemlist">${rows}</div>
      <p class="muted" style="margin-top:10px">這一關會是：<b style="color:var(--red)">♥${eff.hearts}</b>　時間 <b style="color:var(--blue)">×${eff.timeMul}</b>　XP <b style="color:var(--gold)">×${eff.xpCard}</b>
        ${any ? '' : '（目前不使用任何道具）'}</p>
      <div class="btnrow">
        ${own.length ? '<button class="btn sm" data-act="maxItems">全部用滿</button>' : ''}
        ${any ? '<button class="btn sm ghost" data-act="clearItems">全部取消</button>' : ''}
      </div>
      <p class="tiny">可以選要用幾個：血量與時間相加，XP 卡相乘（最多 ×${XP_CAP}）。這一關結束就自動歸零。</p>
    </div>`;
  }

  /** 進到字母關之後，先選這一次要練幾個字。 */
  function letterSetup(lv, letter) {
    setBack([home, () => mapLetters(lv)]);
    window.__lastLetter = { lv, letter };          // 勾選道具後要重繪這個畫面
    const ids = S.bucket(lv, letter);
    const st = S.mapStat(lv, letter);
    const opts = [5, 10, 15, 20, 30].filter(n => n < ids.length).concat([ids.length]);
    const btns = [...new Set(opts)].map(n =>
      `<button class="btn ${n === 10 ? 'primary' : ''}" data-startstage="${lv}:${letter}:${n}">${n === ids.length ? `全部 ${n} 字` : `${n} 字`}</button>`).join('');
    render(`<div class="card">
      ${pageHead(`第 ${lv} 級 ・ ${letter}`, { back: true })}
      <p class="muted">這個字母在第 ${lv} 級共有 <b>${ids.length}</b> 個字，你已經學會 <b style="color:var(--ac)">${st.known}</b> 個。</p>
      <h3 style="margin-top:14px">這一次要練幾個字？</h3>
      <div class="btnrow">${btns}</div>
      ${itemPicker()}
      ${bar('這一關的單字進度', st.known, st.total, `${st.known}/${st.total} 字`, 'g-lv' + lv)}
      ${(() => {
        const own = ids.filter(i => Q.hasSent(V()[i])).length;
        const c = S.settings;
        const slots = Math.min(c.applyPerStage, Math.floor((S.settings.stageQuestions || 10) / 4));
        if (!slots) return '';
        return own
          ? `<p class="tiny">這一關有 <b style="color:var(--ac)">${own}</b> 個字有例句，會出成句子運用題（克漏字／中譯英／重組／造句）。</p>`
          : `<p class="tiny">這一關的字目前都還沒有例句，所以<b>不會出句子題</b>（絕不拉別的字母的字進來湊），
             名額改成多考這一關的單字。</p>`;
      })()}
      <p class="tiny" style="margin-top:10px">會優先出你還沒學會的字。<b style="color:var(--gold)">正確率 ${Math.round(S.passAcc() * 100)}% 以上才算通關</b>，通關就有寶箱（表現越好箱子越好）。</p>
      ${st.full ? `<p class="tiny" style="color:var(--gold)">🏆 這一關已 100% 完成 ${'★'.repeat(st.stars)}${'☆'.repeat(3 - st.stars)}${st.autoDone ? '（所有字都會了，自動完成）' : ''}${st.combo ? `　最佳連擊 ×${st.combo}` : ''}${st.tries ? `　挑戰過 ${st.tries} 次` : ''}</p>`
      : st.cleared ? `<p class="tiny" style="color:var(--ac)">曾經通過，但完成度 ${Math.round(st.pct * 100)}%（還有 ${st.left} 個字沒學會）—— 練完才會開放下一關</p>`
        : st.tries ? `<p class="tiny">挑戰過 ${st.tries} 次，最佳正確率 ${Math.round(st.best * 100)}%${st.combo ? `　最佳連擊 ×${st.combo}` : ''}</p>` : ''}
      ${st.known || st.tries || st.cleared ? `<div class="btnrow" style="margin-top:14px">
        <button class="btn sm ghost" data-resetstage="${lv}:${letter}" style="color:var(--red)">↺ 重設這一關（當成沒學過）</button>
      </div>` : ''}
    </div>`);
  }

  function startMapStage(lv, letter, count, opts) {
    const ids = S.bucket(lv, letter);
    const n = Math.max(3, Math.min(count || 10, ids.length));
    const shift = S.diff().tierShift;
    const qs = Q.stageSet(lv, letter, n, shift, opts);
    if (!qs.length) { toast('這一關沒有字'); return letterSetup(lv, letter); }
    // 開關前自動用掉身上的加成道具
    // 道具改成「這一關要不要用」自己勾（在選字數畫面勾選），不再自動吃掉
    const used = [];
    let hearts = S.diff().hearts, timeMul = 1, xpCard = 1;
    if (!S.itemsAllowed()) useItems = {};              // 究極高階：勾了也不算，道具留在背包裡
    PRE_ITEMS.forEach(it => {
      const want = Math.min(useItems[it.id] || 0, S.inventory()[it.id] || 0);
      let got = 0;
      for (let k = 0; k < want; k++) { if (S.consume(it.id)) got++; }
      if (!got) return;
      if (it.hearts) hearts += it.hearts * got;
      if (it.timeAdd) timeMul += it.timeAdd * got;
      if (it.xpMul) xpCard = Math.min(XP_CAP, xpCard * Math.pow(it.xpMul, got));
      used.push(`${it.short}${got > 1 ? ' ×' + got : ''}`);
    });
    timeMul = Math.round(timeMul * 100) / 100;
    xpCard = Math.round(xpCard * 100) / 100;
    useItems = {};                                   // 用過就清空，不會被下一關偷吃
    if (used.length) toast('這一關使用：' + used.join('、'));
    const go = () => runStage({
      title: `第 ${lv} 級 ・ ${letter} 關`,
      itemNote: used.join('、'),                     // 關卡上方顯示這一關用了什麼道具
      questions: qs, hearts,
      map: { lv, letter, count: n }, timeMul, xpCard,
      // 重新挑戰時重新出題：答錯的字換題型再考，答對的字換掉
      regen: info => Q.stageSet(lv, letter, n, shift, info),
    });
    // 學習卡另外打散：卡片順序和考題順序不一樣，才不會變成「照順序背」
    // 灰燼段沒有學習卡：新字直接上考場，先看一眼的機會都不給
    const fresh = S.diff().noStudy ? []
      : Q.shuffle([...new Set(qs.map(q => q.i).filter(i => i != null && !S.isSeen(i)))]);
    if (fresh.length) {
      // back：學習卡階段按「先離開」要回到這個字母關的選單，而不是首頁
      window.__cards = { then: go, back: () => letterSetup(lv, letter) };
      return studyCards(fresh, 0);
    }
    go();
  }

  /** 訂正關：只練剛才錯的字，不扣血、不判失敗、逐題立即講解。 */
  function startFixStage(ids, back) {
    const qs = Q.fixSet(ids, S.diff().tierShift);
    if (!qs.length) return back();
    runStage({
      title: '訂正剛才答錯的字', questions: qs, hearts: 0, fix: true, backTo: back,
      regen: info => Q.fixSet(ids, S.diff().tierShift, info.avoidKinds),
    });
  }

  /** 刪去法道具：把兩個錯誤選項變灰不可選。 */
  function useFifty() {
    const q = run && run.qs[run.idx];
    if (!q || !q.opts || run.locked) return;
    if (!S.itemsAllowed()) return toast(`☠「${S.diff().name}」不准用道具`);
    if (!S.owned('fifty')) return toast('沒有「刪去法」了，去商店買');
    if (run.fiftyUsedOn === run.idx) return toast('這題已經用過了');
    if (!S.consume('fifty')) return;
    run.fiftyUsedOn = run.idx;
    const wrong = q.opts.map((_, k) => k).filter(k => k !== q.a);
    Q.shuffle(wrong).slice(0, 2).forEach(k => {
      const b = document.querySelector(`[data-opt="${k}"]`);
      if (b) { b.disabled = true; b.style.opacity = '.25'; }
    });
    const btn = document.querySelector('[data-act="fifty"]');
    if (btn) btn.disabled = true;
    toast('刪掉兩個錯的選項');
  }

  /** 套用購買的外觀主題。 */
  function applyTheme() {
    const t = S.equipped('theme');
    const root = document.documentElement;
    if (!root || !root.style) return;
    const themes = {
      theme_forest: { '--ac': '#5fd68a', '--ac2': '#3aa869', '--bg': '#0d1a14', '--bg2': '#132318', '--card': '#17301f', '--card2': '#1e3d29', '--line': '#2b5138' },
      theme_sunset: { '--ac': '#ffab5e', '--ac2': '#e8843a', '--bg': '#1c1220', '--bg2': '#271729', '--card': '#2e1c30', '--card2': '#3d243d', '--line': '#573554' },
      theme_ocean: { '--ac': '#4fd6ff', '--ac2': '#2b9fd0', '--bg': '#07131f', '--bg2': '#0c1e2e', '--card': '#102a3d', '--card2': '#16374e', '--line': '#20506e' },
      theme_sakura: { '--ac': '#ff9ec4', '--ac2': '#e86da3', '--bg': '#1d1218', '--bg2': '#2a1922', '--card': '#33202b', '--card2': '#432a37', '--line': '#5e3a4c' },
      theme_night: { '--ac': '#b79cff', '--ac2': '#8b6bf0', '--bg': '#0a0a1c', '--bg2': '#101029', '--card': '#171736', '--card2': '#212048', '--line': '#332f63' },
      theme_aurora: { '--ac': '#5cf2c8', '--ac2': '#2ec9a5', '--bg': '#04161a', '--bg2': '#082227', '--card': '#0d3038', '--card2': '#124149', '--line': '#1d6b71' },
      theme_gold: { '--ac': '#ffd76a', '--ac2': '#d9a01c', '--bg': '#171208', '--bg2': '#221a0c', '--card': '#2e2411', '--card2': '#3f3117', '--line': '#5f4a1f' },
    };
    ['--ac', '--ac2', '--bg', '--bg2', '--card', '--card2', '--line'].forEach(k => root.style.removeProperty(k));
    if (themes[t]) for (const k in themes[t]) root.style.setProperty(k, themes[t][k]);
    applyUltra();
  }

  /* 究極模式的外觀全部掛在 <html data-ultra> 上（樣式表裡那一大段「燒起來」）。
     放在 documentElement 而不是 body：render() 會整個換掉 body 的內容，
     但屬性在 <html> 上，重畫幾次都洗不掉。
     商店主題是用 inline style 設變數，究極用的是樣式表 —— 究極開著時蓋過主題，關掉就自己還原。 */
  function applyUltra() {
    const root = document.documentElement;
    if (!root || !root.setAttribute) return;
    // data-ultra 的值就是階數：樣式表用它一階一階加溫（[data-ultra="5"] 之後開始泛白）
    if (S.secretDiff()) root.setAttribute('data-ultra', String(S.ultraLevel()));
    else if (root.removeAttribute) root.removeAttribute('data-ultra');
  }

  // ---------------- 商店 ----------------
  const KIND_ICON = { consumable: '🧪', auto: '🛡', pet: '🐾', theme: '🎨', title: '🏷', pack: '📦' };
  /** 每件商品長一樣的卡：稀有度邊框、圖示、價格（有特價就劃掉原價）。 */
  function shopItemCard(it, inv, coins) {
    const have = inv[it.id] || 0;
    const isEquip = it.kind === 'theme' || it.kind === 'title' || it.kind === 'pet';
    const on = isEquip && S.equipped(it.kind) === it.id;
    const deal = S.dealFor(it.id);
    const price = S.priceOf(it.id);
    const afford = coins >= price;
    const r = S.RARITY[it.rarity] || S.RARITY.common;
    const btn = isEquip && have
      ? `<button class="btn sm ${on ? 'primary' : ''}" data-equip="${it.id}">${on ? '使用中' : '使用'}</button>`
      : it.levelOnly
        ? `<button class="btn sm" disabled>🔒 Lv.${it.levelOnly} 解鎖</button>`
        : `<button class="btn sm ${afford ? 'gold' : ''}" data-buy="${it.id}" ${afford ? '' : 'disabled'}>🪙 ${price}</button>`;
    return `<div class="item ${r.cls} ${on ? 'equipped' : ''} ${deal ? 'ondeal' : ''}">
      ${deal ? '<span class="dealtag">-25%</span>' : ''}
      <div class="ihead"><span class="iicon">${KIND_ICON[it.kind] || '·'}</span><span class="rtag">${r.name}</span></div>
      <b>${esc(it.name)}</b>
      <span class="tiny">${esc(it.desc)}</span>
      <div class="ifoot">
        ${/* 只能有一個的東西（主題／稱號／夥伴／護符）只顯示「已擁有」，不顯示數量 */''}
        ${have ? `<span class="tiny" style="color:var(--ac)">${S.isUnique(it) ? '已擁有' : `持有 ${have}`}</span>`
        : deal ? `<span class="tiny" style="text-decoration:line-through;color:var(--tx3)">🪙 ${it.cost}</span>` : '<span></span>'}
        ${btn}
      </div>
    </div>`;
  }

  function shop() {
    setBack([home]);
    const inv = S.inventory(), coins = S.coins();
    const deals = S.dealsToday();
    const group = (kind, title, note) => {
      let items = S.SHOP.filter(x => x.kind === kind);
      // 稱號區加上升等限定的百級稱號（已拿到的＋下一個目標），當成收集目標展示
      if (kind === 'title') items = items.concat(S.levelTitles());
      if (!items.length) return '';
      return `<div class="card"><h3>${title}</h3>${note ? `<p class="tiny">${note}</p>` : ''}
        <div class="shelf">${items.map(it => shopItemCard(it, inv, coins)).join('')}</div></div>`;
    };
    render(`<div class="card">
      ${pageHead(`商店　<span class="chip coin">🪙 ${coins}</span>`, { back: true })}
      <p class="muted">金幣來自通關（星數越高越多）、寶箱、每日任務、簽到與升等。好東西不便宜，要存。</p>
      <p class="tiny">這裡刻意不賣「跳過一題」或「直接看答案」——那會讓作答紀錄失真，而那份紀錄要拿去排複習和做家長回報。</p>
      <div class="btnrow" style="margin-top:10px"><button class="btn" data-go="bag">🎒 打開背包（素材與合成）</button></div>
    </div>

    <div class="card deals">
      <h3>🔥 今日特價 <span class="tiny">${S.todayStr()} ・ 每天換兩件</span></h3>
      <div class="shelf">${deals.map(d => shopItemCard(S.shopItem(d.id), inv, coins)).join('')}</div>
      <p class="tiny">特價每天零點換一批（用日期抽選，不是隨機重整）。</p>
    </div>

    ${group('consumable', '🧪 消耗品', '開關前自動使用；刪去法在答題時按按鈕、復活石在 GAME OVER 時使用。')}
    ${group('pack', '📦 素材包', '買下去立刻變成背包裡的素材（可以重複買），拿去合成台換道具。')}
    ${group('auto', '🛡 護符（被動）', '持有就自動生效，效果可以疊加。價格很痛，但一次買終身有效。')}
    ${group('pet', '🐾 夥伴', '同時只能帶一隻，效果永久生效。')}
    ${group('theme', '🎨 外觀主題', '買了到背包或這裡按「使用」就會換整站配色。')}
    ${group('title', '🏷 稱號', '顯示在左上角品牌名旁邊。🔒 的是升等限定：Lv.25／50／75 各一個，之後每 100 等再一個，商店買不到。')}
    `);
  }

  // ---------------- 快速篩選（本來就會的字不用當新字學）----------------
  /* 流程：一次 12 個字 → 自己點掉「不會的」→ 剩下的直接當已會（box 2）。
     預設不抽考（使用者要求：篩選就是要快）；box 2 表示 3 天後仍會出現在複習裡，
     所以就算自己評太寬，也會在複習時被抓出來。設定可以打開「篩選時抽考 2 題」。 */
  let sw = { lvs: [1, 2], batch: [], off: new Set(), phase: 'pick', check: [], ci: 0, wrong: [], stat: null };

  function sweepStart() {
    setBack([home]);
    const st = S.sweepStat();
    const lvBtns = [1, 2, 3, 4, 5, 6].map(l =>
      `<button class="pill ${sw.lvs.includes(l) ? 'on' : ''}" data-swlv="${l}">${l} 級<br><span style="font-size:10px;opacity:.8">${st.byLevel[l] || 0} 字待篩</span></button>`).join('');
    const pool = S.sweepPool(1, sw.lvs).length;
    render(`<div class="card">
      ${pageHead('⚡ 快速篩選', { back: true })}
      <p class="muted">詞彙表裡有很多你小學就會的字。這裡一次看 12 個字，<b>只要點掉不會的</b>，
        剩下的就直接算已會 —— 不用走學習卡、不算新字。</p>
      <p class="tiny">說「會」的字<b>直接通過，不用考</b>。不過它們只會放到 box 2 —— <b>3 天後照樣會出現在複習裡</b>，
        真的忘了就會被抓出來，所以不必怕自己太寬鬆。（想更嚴格可以在設定打開「篩選時抽考 2 題」）</p>
      <h3 style="margin-top:14px">要篩哪幾級？</h3>
      <div class="pills">${lvBtns}</div>
      <h3 style="margin-top:14px">一批要看幾個字？</h3>
      <div class="pills">${[12, 24, 40, 60, 100].map(n =>
      `<button class="pill ${(S.settings.sweepBatch || 24) === n ? 'on' : ''}" data-swsize="${n}">${n} 字</button>`).join('')}</div>
      <p class="tiny">一次看多一點比較快 —— 反正只要點掉不會的，其他直接過。</p>
      <p class="muted" style="margin-top:10px">還沒篩過的字：<b style="color:var(--ac)">${st.unseen}</b> 個
        ・已篩掉（本來就會）<b style="color:var(--blue)">${st.claimed}</b> 個</p>
      <div class="btnrow">
        <button class="btn primary big-btn" data-act="sweepGo" ${pool ? '' : 'disabled'}>開始篩（一批 ${S.settings.sweepBatch || 24} 字）</button>
      </div>
      <p class="tiny">一批大約 20–40 秒。L1＋L2 共 2004 字，全部篩完約 1.5–2 小時，之後就再也不會被當新字考。</p>
    </div>`);
  }

  function sweepBatch() {
    sw.batch = S.sweepPool(S.settings.sweepBatch || 24, sw.lvs);
    sw.off = new Set();
    sw.phase = 'pick';
    if (!sw.batch.length) return sweepDone();
    sweepDrawPick();
  }

  function sweepDrawPick() {
    const st = S.sweepStat();
    const cards = sw.batch.map((w, k) => `<button class="swcard ${sw.off.has(k) ? 'no' : ''}" data-swpick="${k}">
      <span class="sww">${esc(w.w)}</span>
      <span class="tiny">${esc(w.p)} ・ L${w.lv}</span>
      <span class="swmark">${sw.off.has(k) ? '✗ 不會' : '✓ 會'}</span>
    </button>`).join('');
    render(`<div class="hud"><b>⚡ 快速篩選</b>
      <div class="progressline"><i style="width:${Math.min(100, (st.claimed) / Math.max(1, st.claimed + st.unseen) * 100)}%"></i></div>
      <span class="tiny">剩 ${st.unseen} 字待篩</span></div>
      <div class="card">
        <h3>點掉<b style="color:var(--red)">不會</b>的字（不確定意思的也點掉）</h3>
        <div class="swgrid">${cards}</div>
        <div class="btnrow" style="margin-top:14px;justify-content:center">
          <button class="btn primary big-btn" data-act="sweepSubmit">這批處理完（${sw.batch.length - sw.off.size} 個會 / ${sw.off.size} 個不會）</button>
          <button class="btn ghost" data-act="sweepAllNo">這批我都不會</button>
          <button class="btn ghost" data-act="sweepEnd">先停</button>
        </div>
        <p class="tiny" style="margin-top:8px">點掉的字會排進學習隊列（照樣出學習卡與完整題型）；沒點的字<b>直接算已會，不用考</b>。</p>
      </div>`);
  }

  /** 從「說會」的字裡抽 2 個真的考（英→中 四選一，10 秒）。預設關閉：說會就直接通過。 */
  function sweepCheck() {
    const claim = sw.batch.filter((w, k) => !sw.off.has(k));
    if (!S.settings.sweepCheck) return sweepApply([]);      // 不抽考，直接放行
    if (!claim.length) return sweepApply([]);
    sw.check = Q.shuffle(claim).slice(0, Math.min(2, claim.length))
      .map(w => Q.gen.e2c(w) || Q.gen.c2e(w)).filter(Boolean);
    sw.check.forEach(q => { q.kind = 'sweep'; q.secs = 10; });
    sw.ci = 0; sw.wrong = []; sw.phase = 'check';
    if (!sw.check.length) return sweepApply([]);
    sweepDrawCheck();
  }

  function sweepDrawCheck() {
    const q = sw.check[sw.ci];
    if (!q) return sweepApply(sw.wrong);
    const p = q.prompt;
    render(`<div class="hud"><b>抽考</b>
      <div class="progressline"><i style="width:${sw.ci / sw.check.length * 100}%"></i></div>
      <span class="tiny">${sw.ci + 1}/${sw.check.length}</span>
      <span class="timer" id="timer"></span></div>
      <div class="card qcard">
        <div class="qtag">確認一下 ・ 第 ${p.lv} 級</div>
        <div class="qword">${esc(p.word || p.zh)}</div>
        <p class="muted" style="margin-top:10px">選出正確的中文意思</p>
        <div class="opts">${q.opts.map((o, k) =>
      `<button class="opt" data-swopt="${k}"><span class="k">${'ABCD'[k]}</span><span>${esc(o)}</span></button>`).join('')}</div>
      </div>
      <p class="tiny" style="text-align:center">抽考只考你剛剛說「會」的字。答錯不扣血，但這批會重新排進學習隊列。</p>`);
    let left = 10;
    clearInterval(window.__swTimer);
    const tick = () => {
      const el = $('#timer');
      if (!el) return clearInterval(window.__swTimer);
      el.textContent = left + 's';
      el.className = 'timer' + (left <= 3 ? ' warn' : '');
      if (left <= 0) { clearInterval(window.__swTimer); sweepAnswer(null); }
      left--;
    };
    tick();
    window.__swTimer = setInterval(tick, 1000);
  }

  function sweepAnswer(pick) {
    clearInterval(window.__swTimer);
    const q = sw.check[sw.ci];
    if (!q) return;
    const ok = pick != null && Q.grade(q, pick);
    S.answer(q.i, ok, 1);
    S.logAnswer({ i: q.i, t: 'sweep', ok, attempt: 1, ms: 0, given: answerText(q, pick), right: q.opts[q.a] });
    if (!ok) sw.wrong.push(q.i);
    ok ? sfx.ok() : sfx.no();
    sw.ci++;
    if (sw.ci >= sw.check.length) return sweepApply(sw.wrong);
    sweepDrawCheck();
  }

  /** 檢查有沒有字母關因為「字全部學會」而完成；有的話提示並給寶箱。 */
  function announceAutoClear() {
    const done = S.autoClear();
    if (!done.length) return done;
    sfx.clear();
    const names = done.slice(0, 4).map(x => `第 ${x.lv} 級 ${x.letter}`).join('、');
    toast(`🏆 ${names}${done.length > 4 ? ` 等 ${done.length} 關` : ''} 全部學會，直接通關！寶箱已進背包`);
    return done;
  }

  function sweepApply(failed) {
    const know = sw.batch.filter((w, k) => !sw.off.has(k)).map(w => w.i);
    const learn = sw.batch.filter((w, k) => sw.off.has(k)).map(w => w.i);
    const r = S.applySweep({ know, learn, failed: failed || [] });
    const auto = announceAutoClear();          // 篩完可能直接把某些字母關填滿
    const st = S.sweepStat();
    // 篩選也算學習：給少量 XP，避免「有做事卻沒回饋」
    const xp = Math.round(know.length * 2 + learn.length);
    S.addXp(xp);
    const gifts = S.claimLevelUps();
    render(`<div class="card sheet" style="text-align:center">
      <h2>${r.downgraded ? '⚠ 抽考沒過' : '✅ 這批處理完了'}</h2>
      <div class="grid2" style="margin-top:12px">
        <div class="stat ok"><b>${r.known}</b><span>確認已會（跳過）</span></div>
        <div class="stat no"><b>${r.learn}</b><span>排進學習隊列</span></div>
        <div class="stat blue"><b>${st.unseen}</b><span>還沒篩的字</span></div>
        <div class="stat gold"><b>+${xp}</b><span>XP</span></div>
      </div>
      ${auto.length ? `<p class="tiny" style="color:var(--gold)">🏆 這批篩完之後，${auto.map(x => `第 ${x.lv} 級 ${x.letter}`).join('、')} 的字已經全部學會 —— 直接通關，寶箱已進背包。</p>` : ''}
      ${r.downgraded ? `<p class="tiny" style="color:var(--gold)">抽考答錯了，所以這批「說會」的字只放到 box 1，明天會再考一次確認。</p>`
      : '<p class="tiny">確認已會的字放在 box 2：3 天後仍會出現在複習裡抽考，真的忘了就會被抓出來。</p>'}
      <div class="btnrow" style="justify-content:center;margin-top:14px">
        <button class="btn primary big-btn" data-act="sweepNext" ${st.unseen ? '' : 'disabled'}>再篩下一批 →</button>
        <button class="btn ghost" data-act="sweepEnd">先停在這裡</button>
      </div>
    </div>`);
    showLevelUps(gifts);
  }

  function sweepDone() {
    const st = S.sweepStat();
    render(`<div class="card sheet" style="text-align:center">
      <h2>🎉 這幾級都篩完了</h2>
      <p class="muted">選的級別裡已經沒有沒見過的字。確認已會 ${st.claimed} 字，剩下的都在學習與複習排程裡。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        <button class="btn primary" data-act="sweepPick">換別的級別繼續篩</button>
        <button class="btn ghost" data-go="home">回首頁</button>
      </div>
    </div>`);
  }

  // ---------------- 背包 ----------------
  /** 背包：素材（寶石之類的通關掉落）、道具存量、合成台、收藏品。 */
  function bag() {
    setBack([home]);
    const inv = S.inventory();
    const matCards = S.MAT_ORDER.map(id => {
      const m = S.material(id), n = S.matCount(id);
      return `<div class="mat t${m.tier} ${n ? '' : 'empty'}">
        <span class="micon">${m.icon}</span>
        <b>${esc(m.name)}</b>
        <span class="mnum">×${n}</span>
        <span class="tiny">${esc(m.desc)}</span>
      </div>`;
    }).join('');

    const consum = S.SHOP.filter(x => x.kind === 'consumable' && inv[x.id]);
    const collect = S.SHOP.filter(x => (x.kind === 'theme' || x.kind === 'title' || x.kind === 'pet' || x.kind === 'auto') && inv[x.id])
      .concat(S.levelTitles().filter(t => inv[t.id]));   // 百級稱號不在 SHOP 清單裡，另外補進收藏

    const recipes = S.RECIPES.map(r => {
      const outName = r.kindOut === 'material' ? S.material(r.out).name : (S.shopItem(r.out) || {}).name;
      const outIcon = r.kindOut === 'material' ? S.material(r.out).icon : (KIND_ICON[(S.shopItem(r.out) || {}).kind] || '🧪');
      const ok = S.canCraft(r.id);
      const needs = Object.keys(r.need).map(k => {
        const m = S.material(k), have = S.matCount(k);
        return `<span class="need ${have >= r.need[k] ? 'ok' : 'no'}">${m.icon} ${have}/${r.need[k]}</span>`;
      }).join('');
      return `<div class="recipe ${ok ? 'ready' : ''}">
        <span class="ricon">${outIcon}</span>
        <div class="rmain"><b>${esc(outName)}</b><div class="needs">${needs}${r.coin ? `<span class="need ${S.coins() >= r.coin ? 'ok' : 'no'}">🪙 ${r.coin}</span>` : ''}</div></div>
        <button class="btn sm ${ok ? 'gold' : ''}" data-craft="${r.id}" ${ok ? '' : 'disabled'}>合成</button>
      </div>`;
    }).join('');

    const keys = S.matCount('key');
    const cb = S.chestBagSummary();
    render(`<div class="card">
      ${pageHead(`背包　<span class="chip coin">🪙 ${S.coins()}</span>`, { back: true })}
      <p class="muted">通關會掉寶石與素材（級別越高、星數越高掉得越好），拿到合成台換道具。</p>
    </div>

    ${cb.total ? `<div class="card chestcard">
      <h3>🎁 還沒開的寶箱 <span class="tiny">${cb.total} 箱</span></h3>
      <div class="chestrow" style="flex-wrap:wrap">
        ${S.CHEST_ORDER.filter(t => cb.byTier[t]).map(t =>
      `<div class="matbox"><span class="chesticon ${S.CHEST[t].cls}" style="font-size:34px">${S.CHEST[t].icon}</span>
           <b>${esc(S.CHEST[t].name)}</b><span class="mnum">×${cb.byTier[t]}</span></div>`).join('')}
      </div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn gold big-btn" data-act="openAllChests">🎉 一次全開（${cb.total} 箱）</button>
        <button class="btn" data-act="openOneChest">開一箱（最舊的）</button>
      </div>
      <p class="tiny">通關時不想馬上開的寶箱都會存到這裡，不會消失也不會過期。</p>
    </div>` : `<div class="card">
      <h3>🎁 還沒開的寶箱</h3>
      <p class="tiny">目前沒有存起來的寶箱。通關拿到寶箱時可以選「先收進背包」，之後在這裡一次全開。</p>
    </div>`}

    <div class="card">
      <h3>💠 素材</h3>
      <div class="mats">${matCards}</div>
      ${keys ? `<div class="btnrow" style="margin-top:10px">
        <button class="btn gold big-btn" data-act="useAllKeys">🔑 一次用掉全部鑰匙（${keys} 把 → ${keys} 箱）</button>
        <button class="btn" data-act="useKey">只用一把</button></div>`
      : '<p class="tiny">🔑 寶箱鑰匙：三星通關有機會掉，或用金鑽石＋古卷軸合成，可以在這裡直接開一個銀寶箱。</p>'}
    </div>

    <div class="card">
      <h3>⚒ 合成台</h3>
      <p class="tiny">素材換道具。合成出來的道具一樣是「難度緩衝」類，不會幫你作答。</p>
      <div class="recipes">${recipes}</div>
    </div>

    <div class="card">
      <h3>🧪 道具存量</h3>
      ${consum.length ? `<div class="mats">${consum.map(x =>
      `<div class="mat t2"><span class="micon">${KIND_ICON[x.kind]}</span><b>${esc(x.name)}</b>
        <span class="mnum">×${inv[x.id]}</span><span class="tiny">${esc(x.desc)}</span></div>`).join('')}</div>`
      : '<p class="tiny">還沒有消耗品。去商店買、開寶箱，或在合成台做。</p>'}
    </div>

    <div class="card">
      <h3>🏆 收藏與裝備</h3>
      ${collect.length ? `<div class="shelf">${collect.map(x => {
        const r = S.RARITY[x.rarity] || S.RARITY.common;
        const equipable = x.kind !== 'auto';
        const on = equipable && S.equipped(x.kind) === x.id;
        return `<div class="item ${r.cls} ${on ? 'equipped' : ''}">
          <div class="ihead"><span class="iicon">${KIND_ICON[x.kind]}</span><span class="rtag">${r.name}</span></div>
          <b>${esc(x.name)}</b><span class="tiny">${esc(x.desc)}</span>
          <div class="ifoot"><span class="tiny">${x.kind === 'auto' ? '已擁有・被動生效' : '已擁有'}</span>
            ${equipable ? `<button class="btn sm ${on ? 'primary' : ''}" data-equip="${x.id}">${on ? '使用中' : '使用'}</button>` : ''}</div>
        </div>`;
      }).join('')}</div>` : '<p class="tiny">還沒有收藏品。商店的主題、稱號、夥伴會收在這裡。</p>'}
    </div>

    <div class="card">
      <h3>📥 今天收到的素材</h3>
      ${(() => {
        const rows = S.dropLog().map(x => `<tr><td class="tiny nowrap">${fmtTime(x.at)}</td>
          <td>${x.icon} ${esc(x.name)} ×${x.n}</td><td class="tiny">${esc(x.from || '')}</td></tr>`).join('');
        return rows ? `<div class="tblwrap"><table class="rep log"><tr><th>時間</th><th>素材</th><th>來源</th></tr>${rows}</table></div>`
          : '<p class="tiny">今天還沒有掉落。去闖一關。</p>';
      })()}
    </div>`);
  }

  // ---------------- 自訂範圍練習 ----------------
  let pr = { lv: new Set([3, 4]), az: new Set(), only: 'all', n: 20 };
  function practice() {
    setBack([home]);
    const azBtns = 'ABCDEFGHIJKLMNOPQRSTUVWYZ'.split('').map(c =>
      `<button class="pill az ${pr.az.has(c) ? 'on' : ''}" data-az="${c}">${c}</button>`).join('');
    const lvBtns = [1, 2, 3, 4, 5, 6].map(l =>
      `<button class="pill ${pr.lv.has(l) ? 'on' : ''}" data-lv="${l}">${l} 級</button>`).join('');
    const onlyBtns = [['all', '全部'], ['new', '沒學過的'], ['wrong', '曾答錯的'], ['due', '今天到期']].map(([v, n]) =>
      `<button class="pill ${pr.only === v ? 'on' : ''}" data-only="${v}">${n}</button>`).join('');
    const count = poolOf().length;
    render(`<div class="card">
      ${pageHead(`自訂範圍練習`, { back: true })}
      <h3>級別（可多選）</h3><div class="pills">${lvBtns}</div>
      <h3 style="margin-top:14px">字母（不選＝全部 A–Z）</h3><div class="pills">${azBtns}</div>
      <h3 style="margin-top:14px">篩選</h3><div class="pills">${onlyBtns}</div>
      <label class="slider">題數：<b>${pr.n}</b> 題<input type="range" min="5" max="60" step="5" value="${pr.n}" data-n></label>
      <p class="muted">符合條件的字：<b style="color:var(--ac)">${count}</b> 個</p>
      <div class="btnrow">
        <button class="btn primary" data-act="startPractice" ${count ? '' : 'disabled'}>開始練習</button>
      </div>
      <p class="tiny">自訂練習同樣會更新間隔複習與今日成績單（會計入複習題數）。</p>
    </div>`);
  }
  function poolOf() {
    const st = S.load();
    return V().filter(w => {
      if (pr.lv.size && !pr.lv.has(w.lv)) return false;
      if (pr.az.size && !pr.az.has(w.w[0].toUpperCase())) return false;
      const r = st.words[w.i];
      if (pr.only === 'new') return !r;
      if (pr.only === 'wrong') return r && r.wr > 0;
      if (pr.only === 'due') return r && r.due && r.due <= S.todayStr();
      return true;
    });
  }

  // ---------------- 我的單字本（自己輸入的字）----------------
  /* 一個表單就把「練單字／練文法／練造句」全部涵蓋，靠的是欄位而不是三個模式：
       只填英文＋中文 → 出得了 英→中／中→英／拼字／聽發音
       再填一句例句   → 多出 克漏字／中譯英填空／句子重組／自由造句
       再挑一個文法點 → 多出 文法題（題目來自內建的 32 個文法點）
     所以畫面上每個題型旁邊都標它「需要什麼」，沒填就是灰的 —— 使用者一眼看得出要補什麼。 */
  let bk = { edit: null };

  function bookFormVals() {
    const g = sel => { const el = $(sel); return el ? String(el.value || '').trim() : ''; };
    return { w: g('#bkw'), tr: g('#bktr'), p: g('#bkp'), ph: g('#bkph'), ex: g('#bkex'), zh: g('#bkzh'), gp: g('#bkgp') };
  }

  function book() {
    setBack([home]);
    const list = S.customs(), cfg = S.customCfg(), st = S.customStat();
    const ed = bk.edit ? S.customFind(bk.edit) : null;
    const gtitles = window.GRAMMAR_TITLES || {};
    const gopts = ['<option value="">（不指定文法點）</option>'].concat(
      Object.keys(window.GRAMMAR || {}).map(id =>
        `<option value="${esc(id)}"${ed && ed.gp === id ? ' selected' : ''}>${esc(id)} ${esc(gtitles[id] || '')}</option>`)).join('');

    const rows = list.map(c => {
      const kinds = S.customKinds(c), r = S.customRec(c.id);
      const due = !r.due || r.due <= S.todayStr();
      return `<div class="bkrow${bk.edit === c.id ? ' on' : ''}">
        <div class="bkmain">
          <b>${esc(c.w)}</b> <span class="tiny">${esc(c.p || '')}</span>
          <div class="tiny">${esc(c.tr)}</div>
          ${c.ex ? `<div class="tiny bkex">${esc(S.markEx(c.ex, c.w).replace(/[{}]/g, ''))}${c.zh ? '　' + esc(c.zh) : ''}</div>` : ''}
          <div class="tiny">${kinds.map(k => esc(S.CUSTOM_KIND_NAMES[k])).join('・')}
            ${c.gp ? `　<span style="color:var(--purple)">文法 ${esc(c.gp)}</span>` : ''}
            　<span style="color:${due ? 'var(--gold)' : 'var(--tx3)'}">box ${r.b}${due ? ' ・ 今天到期' : ' ・ ' + esc(r.due)}</span></div>
        </div>
        <div class="btnrow">
          <button class="btn sm ghost" data-bkedit="${esc(c.id)}">✎ 改</button>
          <button class="btn sm ghost" data-bkdel="${esc(c.id)}" style="color:var(--red)">🗑</button>
        </div>
      </div>`;
    }).join('');

    const kindPills = S.CUSTOM_KINDS.map(k => {
      const need = S.CUSTOM_NEEDS[k];
      const can = list.some(c => S.customKinds(c).includes(k));
      const note = need === 'ex' ? '需要例句' : need === 'gp' ? '需要文法點' : '';
      return `<button class="pill ${cfg.kinds.includes(k) ? 'on' : ''}" data-bkkind="${k}"
        title="${esc(note ? note + (can ? '' : '（目前沒有一筆字填了）') : '只要英文＋中文就出得來')}"
        ${can ? '' : 'style="opacity:.45"'}>${esc(S.CUSTOM_KIND_NAMES[k])}</button>`;
    }).join('');

    render(`<div class="card">
      ${pageHead('📓 我的單字本', { back: true })}
      <p class="muted">自己輸入要練的字。這些字<b>完全獨立</b>：有自己的間隔複習，不會混進關卡地圖，
        也不會算進「學會幾個字」那類詞彙表的統計。</p>
      ${list.length ? `<div class="grid2" style="margin-top:12px">
        <div class="stat"><b>${st.total}</b><span>單字本字數</span></div>
        <div class="stat ok"><b>${st.known}</b><span>學會（box 1+）</span></div>
        <div class="stat purple"><b>${st.mastered}</b><span>長期記憶（box 5+）</span></div>
        <div class="stat gold"><b>${st.due}</b><span>今天到期</span></div>
      </div>` : ''}

      <h3 style="margin-top:16px">${ed ? `✎ 修改「${esc(ed.w)}」` : '➕ 加一個字'}</h3>
      <div class="bkform">
        <label class="row">英文 <input class="txt bkin" id="bkw" value="${esc(ed ? ed.w : '')}" placeholder="例如：issue"></label>
        <label class="row">中文 <input class="txt bkin" id="bktr" value="${esc(ed ? ed.tr : '')}" placeholder="例如：議題；發布"></label>
        <label class="row">詞性 <input class="txt bkin" id="bkp" value="${esc(ed ? ed.p : '')}" placeholder="n./v.（可留白）"></label>
        <label class="row">音標 <input class="txt bkin" id="bkph" value="${esc(ed ? ed.ph : '')}" placeholder="ˈɪʃu（可留白）"></label>
        <label class="row">例句 <input class="txt bkin" id="bkex" value="${esc(ed ? ed.ex : '')}" placeholder="The government issued a warning."></label>
        <label class="row">例句中譯 <input class="txt bkin" id="bkzh" value="${esc(ed ? ed.zh : '')}" placeholder="政府發布了警告。"></label>
        <label class="row">文法點 <select class="txt bkin" id="bkgp">${gopts}</select></label>
        <p class="tiny">例句<b>不用自己標</b>目標字，存的時候會自動找出來（找不到就不會出克漏字那幾種題型）。
          填了例句才有克漏字／中譯英／句子重組／自由造句；挑了文法點才有文法題。</p>
        <div class="btnrow">
          <button class="btn primary" data-act="${ed ? 'bkSave' : 'bkAdd'}">${ed ? '儲存修改' : '加進單字本'}</button>
          ${ed ? '<button class="btn ghost" data-act="bkCancel">取消</button>' : ''}
        </div>
      </div>

      <h3 style="margin-top:18px">要練哪些題型</h3>
      <p class="tiny">灰掉的表示「目前沒有一筆字填得出這種題」—— 補上例句或文法點就會亮起來。至少要留一種。</p>
      <div class="pills">${kindPills}</div>
      <label class="slider">一次練幾題：<b>${cfg.n}</b> 題
        <input type="range" min="5" max="40" step="5" value="${cfg.n}" data-bkn></label>
      <div class="btnrow">
        <button class="btn primary big-btn" data-act="bkStart" ${list.length ? '' : 'disabled'}>開始練習</button>
        <button class="btn" data-act="bkStartDue" ${st.due ? '' : 'disabled'}>只練今天到期的（${st.due}）</button>
      </div>
      <p class="tiny">練習會用你目前的難度（血量、時間、XP 倍率都照算），也會寫進今天的作答紀錄。</p>
    </div>
    ${list.length ? `<div class="card"><h3>單字本（${list.length}）</h3>${rows}</div>`
      : '<div class="card"><p class="muted">單字本還是空的。上面填一個字就會出現在這裡。</p></div>'}`);
  }

  /** 開始練單字本。due=true 只練今天到期的。 */
  function bookStart(due) {
    const list = due ? S.customDue() : S.customs();
    if (!list.length) return toast('單字本裡沒有可以練的字');
    const cfg = S.customCfg();
    const words = list.map(c => S.customWord(c));
    const make = avoid => Q.bookSet(words, cfg, avoid);
    const qs = make();
    if (!qs.length) return toast('這些字目前出不了你勾選的題型 —— 補一句例句，或多勾幾種題型');
    runStage({
      title: due ? '單字本 ・ 今天到期' : '我的單字本',
      questions: qs, hearts: S.diff().hearts, backTo: book,
      // 重來時換題型再考一次（同一批字，不同考法）
      regen: info => make(info && info.book),
    });
  }

  // ---------------- 字庫瀏覽 ----------------
  let bq = { q: '', lv: 0, page: 0 };
  function browse() {
    setBack([home]);
    const st = S.load();
    let list = V().filter(w => {
      if (bq.lv && w.lv !== bq.lv) return false;
      if (bq.q) { const s = bq.q.toLowerCase(); return w.w.toLowerCase().includes(s) || (w.tr || '').includes(bq.q); }
      return true;
    });
    const total = list.length, per = 60;
    const pages = Math.max(1, Math.ceil(total / per));
    bq.page = Math.min(bq.page, pages - 1);
    const rows = list.slice(bq.page * per, bq.page * per + per).map(w => {
      const r = st.words[w.i];
      const badge = !r ? '<span class="tiny">未學</span>'
        : r.b >= 5 ? '<span class="tiny" style="color:var(--ac)">長期記憶</span>'
          : `<span class="tiny" style="color:var(--blue)">box ${r.b}</span>`;
      return `<tr><td class="w">${esc(w.w)} <button class="speak" data-say="${esc(Q.base(w.w))}">🔊</button> ${dictMini(w.w)}</td>
        <td class="muted">${esc(w.p)} L${w.lv}</td><td>${esc(w.tr)}</td><td>${badge}</td></tr>`;
    }).join('');
    render(`<div class="card">
      ${pageHead(`瀏覽字庫 <span class="tiny">${window.VOCAB_META.total} 字</span>`, { back: true })}
      <input class="txt" style="font-size:16px;text-align:left;letter-spacing:0" id="bq" placeholder="搜尋英文或中文…" value="${esc(bq.q)}">
      <div class="pills" style="margin-top:10px">
        <button class="pill ${bq.lv === 0 ? 'on' : ''}" data-blv="0">全部</button>
        ${[1, 2, 3, 4, 5, 6].map(l => `<button class="pill ${bq.lv === l ? 'on' : ''}" data-blv="${l}">${l} 級</button>`).join('')}
      </div>
      <p class="muted">${total} 筆　第 ${bq.page + 1}/${pages} 頁</p>
      <div class="tblwrap"><table class="rep"><tr><th>單字</th><th>詞性/級</th><th>意思</th><th>狀態</th></tr>${rows}</table></div>
      <div class="btnrow" style="margin-top:12px">
        <button class="btn sm" data-bpage="-1" ${bq.page ? '' : 'disabled'}>← 上一頁</button>
        <button class="btn sm" data-bpage="1" ${bq.page + 1 < pages ? '' : 'disabled'}>下一頁 →</button>
      </div>
    </div>`);
    const el = $('#bq');
    el.addEventListener('input', () => { bq.q = el.value; bq.page = 0; clearTimeout(el._t); el._t = setTimeout(browse, 300); });
  }

  // ---------------- 作答紀錄 ----------------
  let rq = { tab: 'ans', only: 'all', page: 0 };
  const PER = 50;

  function records() {
    setBack([home]);
    const tabs = [['ans', '📝 作答紀錄'], ['runs', '🗺 關卡紀錄'], ['quests', '🏆 任務紀錄'], ['chests', '📦 寶箱紀錄']]
      .map(([k, n]) => `<button class="pill ${rq.tab === k ? 'on' : ''}" data-rtab="${k}">${n}</button>`).join('');
    const tot = S.logTotals();
    const body = rq.tab === 'ans' ? ansTab() : rq.tab === 'runs' ? runsTab() : rq.tab === 'quests' ? questsTab() : chestsTab();
    render(`<div class="card">
      ${pageHead('紀錄', { back: true })}
      <div class="grid2">
        <div class="stat"><b>${tot.n}</b><span>累積作答題數</span></div>
        <div class="stat ok"><b>${Math.round(tot.acc * 100)}%</b><span>首次作答正確率</span></div>
        <div class="stat blue"><b>${tot.minutes}</b><span>累積作答分鐘</span></div>
        <div class="stat purple"><b>${tot.days}</b><span>學習天數</span></div>
      </div>
      ${bar('首次作答正確率', tot.firstOk, Math.max(tot.first, 1), `${tot.firstOk}/${tot.first} 題`, 'g-green')}
      <div class="pills" style="margin-top:10px">${tabs}</div>
    </div>
    ${body}`);
  }

  function ansTab() {
    const filters = [['all', '全部'], ['wrong', '只看答錯'], ['right', '只看答對'], ['timeout', '逾時'], ['free', '自由造句'], ['gram', '文法']]
      .map(([k, n]) => `<button class="pill ${rq.only === k ? 'on' : ''}" data-ronly="${k}">${n}</button>`).join('');
    const res = S.answerLog({ only: rq.only, skip: rq.page * PER, limit: PER });
    const pages = Math.max(1, Math.ceil(res.total / PER));
    const rows = res.rows.map(x => {
      const w = x.i != null && V()[x.i] ? V()[x.i] : null;
      const mark = x.ok === null ? '<span style="color:var(--tx2)">📝</span>' : x.ok ? '<span style="color:var(--ac)">✓</span>' : '<span style="color:var(--red)">✗</span>';
      // 自訂字不在詞彙表裡，字面是當初寫進紀錄裡的（那個字之後被刪掉也還看得到）
      const cw = x.cw ? (x.w || (S.customFind(x.cw) || {}).w || '') : '';
      const what = x.cat === 'gram' ? esc(x.title || (window.GRAMMAR_TITLES || {})[x.id] || '文法題')
        : w ? `<b>${esc(w.w)}</b> ${dictMini(w.w)} <span class="tiny">${esc(w.p)} L${w.lv}</span>`
          : cw ? `<b>${esc(cw)}</b> ${dictMini(cw)} <span class="tiny">📓 我的單字本</span>` : '—';
      const kind = x.cat === 'free' ? '自由造句' : esc(S.KIND_NAMES[x.t] || x.t || (x.cat === 'gram' ? '文法' : ''));
      const yours = x.cat === 'free' ? esc(x.text || '') : esc(x.given || '（未作答）');
      const right = x.ok === false ? `<div class="tiny" style="color:var(--ac)">正解：${esc(x.right || '')}</div>` : '';
      return `<tr class="${x.ok === false ? 'rowno' : x.ok ? 'rowok' : 'rowfree'}">
        <td class="tiny nowrap">${x.date.slice(5)}<br>${fmtTime(x.at)}</td>
        <td>${what}<div class="tiny">${kind}${x.attempt > 1 ? `　第 ${x.attempt} 次` : ''}${x.timeout ? '　⏰逾時' : ''}</div></td>
        <td>${yours}${right}</td>
        <td class="tiny nowrap">${x.ms ? (x.ms / 1000).toFixed(1) + 's' : ''}</td>
        <td>${mark}</td></tr>`;
    }).join('');
    return `<div class="card">
      <h3>作答紀錄 <span class="tiny">${res.total} 筆</span></h3>
      <div class="pills">${filters}</div>
      <div class="tblwrap"><table class="rep log">
        <tr><th>日期時間</th><th>題目</th><th>你的答案</th><th>用時</th><th></th></tr>${rows || '<tr><td colspan="5" class="muted">還沒有紀錄</td></tr>'}
      </table></div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn sm" data-rpage="-1" ${rq.page ? '' : 'disabled'}>← 上一頁</button>
        <span class="tiny">第 ${rq.page + 1}/${pages} 頁</span>
        <button class="btn sm" data-rpage="1" ${rq.page + 1 < pages ? '' : 'disabled'}>下一頁 →</button>
        <button class="btn gold" data-act="dlCsv">⬇ 下載全部紀錄 CSV</button>
      </div>
      <p class="tiny">每一題都留著：作答時間、你寫的答案、正確答案、花了幾秒。正確率只採計第 1 次作答。</p>
    </div>`;
  }

  function runsTab() {
    const s = S.load();
    const days = Object.keys(s.days).sort().reverse().slice(0, 14);
    const cards = days.map(t => {
      const runs = S.runLog(t);
      if (!runs.length) return '';
      const rows = runs.map(r => {
        const result = r.abandoned ? '<span style="color:var(--red)">放棄</span>'
          : r.passed === true ? `<span style="color:var(--ac)">通關 ${'★'.repeat(r.stars || 0)}</span>`
            : r.passed === false ? '<span style="color:var(--red)">未通關</span>'
              : !r.end ? '<span class="tiny">未完成</span>'          // 中途關掉分頁
                : '<span class="tiny">練習</span>';
        const where = r.lv ? `第 ${r.lv} 級 ・ ${r.letter}` : esc(r.title || '練習');
        return `<tr>
          <td class="tiny nowrap">${fmtTime(r.start)}${r.end ? `<br>↓ ${fmtTime(r.end)}` : ''}</td>
          <td>${where}<div class="tiny">${esc((S.DIFFICULTY[r.diff] || {}).name || r.diff || '')}${r.retries ? `　第 ${r.retries + 1} 次挑戰` : ''}</div></td>
          <td class="tiny nowrap">${fmtSec(r.sec)}</td>
          <td class="tiny">${r.right}/${r.answered}　${Math.round((r.acc || 0) * 100)}%<div class="tiny">連擊 ×${r.combo || 0}</div></td>
          <td class="tiny nowrap">${r.xp ? `+${r.xp} XP` : '—'}${r.coin ? `<br>+${r.coin} 🪙` : ''}</td>
          <td>${result}</td></tr>`;
      }).join('');
      return `<div class="card">
        <h3>${t} <span class="tiny">${runs.length} 關 ・ 共 ${fmtSec(S.runSeconds(t))}</span></h3>
        <div class="tblwrap"><table class="rep log">
          <tr><th>開始／結束</th><th>關卡</th><th>用時</th><th>成績</th><th>獎勵</th><th>結果</th></tr>${rows}
        </table></div></div>`;
    }).join('');
    return cards || '<div class="card"><p class="muted">還沒有關卡紀錄。去闖一關吧。</p></div>';
  }

  function questsTab() {
    const rows = S.questLog('all').map(q => `<tr>
      <td class="tiny nowrap">${q.date.slice(5)}<br>${fmtTime(q.at)}</td>
      <td><span class="qtagb ${TAGC[q.tag] || 'b-blue'}">${esc(q.tag || '任務')}</span> ${esc(q.name)}</td>
      <td class="tiny nowrap">+${q.xp} XP${q.coin ? `<br>+${q.coin} 🪙</br>` : ''}</td></tr>`).join('');
    const today = S.questStatus();
    return `<div class="card">
      <h3>今天的任務進度</h3>
      <div class="quests">${today.map(questRow).join('')}</div>
    </div>
    <div class="card">
      <h3>任務完成紀錄 <span class="tiny">含時間與內容</span></h3>
      <div class="tblwrap"><table class="rep log">
        <tr><th>日期時間</th><th>完成的任務</th><th>獎勵</th></tr>
        ${rows || '<tr><td colspan="3" class="muted">還沒有完成任何任務</td></tr>'}
      </table></div></div>`;
  }

  function chestsTab() {
    const rows = S.chestLog('all').map(c => {
      const it = c.item && S.shopItem(c.item);
      return `<tr><td class="tiny nowrap">${c.date.slice(5)}<br>${fmtTime(c.at)}</td>
        <td>${c.icon} ${esc(c.name)}</td>
        <td class="tiny">🪙 +${c.coin}　✨ +${c.xp} XP${it ? `　🧪 ${esc(it.name)}` : ''}</td></tr>`;
    }).join('');
    return `<div class="card">
      <h3>寶箱紀錄</h3>
      <div class="tblwrap"><table class="rep log">
        <tr><th>日期時間</th><th>寶箱</th><th>開出的東西</th></tr>
        ${rows || '<tr><td colspan="3" class="muted">還沒開過寶箱。通關就有。</td></tr>'}
      </table></div>
      <h3 style="margin-top:14px">怎麼拿到大寶箱</h3>
      <div class="tblwrap"><table class="rep">
        <tr><th>寶箱</th><th>條件</th><th>抽獎</th></tr>
        ${S.CHEST_RULES.map(r => `<tr><td class="w">${S.CHEST[r.tier].icon} ${esc(S.CHEST[r.tier].name)}</td>
          <td>${esc(r.text)}</td><td>${S.CHEST[r.tier].rolls} 次</td></tr>`).join('')}
      </table></div>
      <p class="tiny">稀有獎品（🔑 鑰匙、復活石、三倍 XP 卡、🪙 金幣大獎、🎀 神秘禮物）機率很低，箱子等級越高才越有機會。
        加碼題答對可以升一級，金寶箱還能升到 🌈 彩虹。</p>
    </div>
    <div class="card">
      <h3>素材掉落紀錄</h3>
      <div class="tblwrap"><table class="rep log">
        <tr><th>日期時間</th><th>素材</th><th>來源</th></tr>
        ${S.dropLog('all').map(x => `<tr><td class="tiny nowrap">${x.date.slice(5)}<br>${fmtTime(x.at)}</td>
          <td>${x.icon} ${esc(x.name)} ×${x.n}</td><td class="tiny">${esc(x.from || '')}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">還沒有素材掉落。通關就會掉。</td></tr>'}
      </table></div>
      <div class="btnrow"><button class="btn" data-go="bag">🎒 去背包合成</button></div>
    </div>`;
  }

  /** 全部作答紀錄輸出 CSV，方便家長或我拿去做分析。 */
  function dlCsv() {
    const res = S.answerLog({});
    const head = ['日期', '時間', '類別', '單字/題目', '題型', '你的答案', '正確答案', '對錯', '秒數', '第幾次作答', '逾時'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [head.join(',')];
    res.rows.forEach(x => {
      const w = x.i != null && V()[x.i] ? V()[x.i] : null;
      lines.push([
        x.date, fmtTime(x.at), x.cat === 'free' ? '自由造句' : x.cat === 'gram' ? '文法' : '單字',
        w ? w.w : (x.title || x.id || ''), S.KIND_NAMES[x.t] || x.t || '',
        x.cat === 'free' ? (x.text || '') : (x.given || ''), x.right || '',
        x.ok === null ? '待批改' : x.ok ? '對' : '錯',
        x.ms ? (x.ms / 1000).toFixed(1) : '', x.attempt || '', x.timeout ? '是' : '',
      ].map(q).join(','));
    });
    download(`作答紀錄-${S.todayStr()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
    toast('已下載 CSV');
  }

  // ---------------- 徽章 / 文法進度 ----------------
  function badges() {
    setBack([home]);
    const p = S.profile, st = S.stats();
    const tiers = ['common', 'rare', 'epic', 'legend', 'ultra'];
    const got = S.BADGES.filter(b => p.badges.includes(b.id)).length;
    const bs = tiers.map(tk => {
      const list = S.BADGES.filter(b => (b.tier || 'common') === tk);
      if (!list.length) return '';
      const T = S.BADGE_TIER[tk];
      return `<h3 style="margin-top:14px">${esc(T.name)} <span class="tiny">${list.filter(b => p.badges.includes(b.id)).length}/${list.length}</span></h3>
        <div class="achs">${list.map(b => {
        const has_ = p.badges.includes(b.id);
        const pr = S.badgeProgress(b, st);
        return `<div class="ach ${T.cls} ${has_ ? 'got' : ''}">
            <div class="ahead"><span class="aicon">${has_ ? '🏅' : '🔒'}</span><span class="rtag">${esc(T.name)}</span></div>
            <b>${esc(b.name)}</b>
            <span class="tiny">${esc(b.desc)}</span>
            ${has_ ? '<span class="tiny" style="color:var(--gold)">已達成</span>'
            : `<div class="qbar"><i style="width:${(pr.pct * 100).toFixed(1)}%"></i></div>
               <span class="tiny">${pr.cur}/${pr.goal}（${Math.round(pr.pct * 100)}%）</span>`}
          </div>`;
      }).join('')}</div>`;
    }).join('');
    const road = window.GRAMMAR_ROADMAP.map(s => {
      const items = s.ids.map(id => {
        const authored = !!window.GRAMMAR[id];
        let right = 0, total = (window.GRAMMAR[id] || {}).items ? window.GRAMMAR[id].items.length : 0;
        const stt = S.load();
        for (const d in stt.days) (stt.days[d].gram || []).forEach(g => { if (g.id === id && g.ok && g.attempt === 1) right++; });
        const doneAll = total && right >= total;
        return `<tr><td class="w">${esc(window.GRAMMAR_TITLES[id])}</td>
          <td>${authored ? (doneAll ? '<span style="color:var(--ac)">已精熟</span>' : `${Math.min(right, total)}/${total}`) : '<span class="tiny">內容待補</span>'}</td></tr>`;
      }).join('');
      return `<h3 style="margin-top:14px">${esc(s.name)}</h3><div class="tblwrap"><table class="rep">${items}</table></div>`;
    }).join('');
    render(`<div class="card">
      ${pageHead(`成就 <span class="tiny">${got}/${S.BADGES.length}</span>`, { back: true })}
      ${bar('成就收集度', got, S.BADGES.length, `${got}/${S.BADGES.length}`, 'g-gold')}
      <div class="grid2" style="margin-top:12px">
        <div class="stat ok"><b>${st.known}/${st.total}</b><span>已學會</span></div>
        <div class="stat blue"><b>${st.mastered}</b><span>長期記憶</span></div>
        <div class="stat gold"><b>${st.clearedStages}/${st.playableStages}</b><span>通關字母關</span></div>
        <div class="stat purple"><b>${st.threeStars}</b><span>三星關</span></div>
        <div class="stat"><b>×${st.bestCombo}</b><span>最高連擊</span></div>
        <div class="stat cyan"><b>${st.gems}</b><span>累積寶石</span></div>
      </div>
      ${bs}
      <p class="tiny" style="margin-top:12px">「究極」兩個成就要把全書 6012 字全部學會、甚至全部推進長期記憶（box 5 以上）。
        以每天 60 字計算，第一個大約要 100 天，第二個還要再加上完整的複習週期。</p></div>
      <div class="card"><h2>文法 32 點進度</h2>
      <p class="muted">目前已備好教學與題目的是第一階 8 點；其餘會隨你的進度陸續補上。</p>${road}</div>
      `);
  }

  // ---------------- 設定 ----------------
  /** 目前難度下，各題型實際的作答秒數（設定頁用，讓時間規則透明可見）。 */
  function timeTable() {
    const f = S.diff().time, name = {
      e2c: '英→中', c2e: '中→英', listen: '聽發音', confuse: '易混淆字',
      form: '詞形變化', spell: '拼字', cloze: '例句克漏字', trans: '中譯英填空',
      order: '句子重組', gmc: '文法選擇', gfix: '找錯改錯', free: '自由造句',
    };
    return Object.keys(Q.LIMITS).map(k =>
      `<tr><td class="w">${name[k] || k}</td><td>${Math.max(5, Math.round(Q.LIMITS[k] * f))} 秒</td></tr>`).join('');
  }

  function settings() {
    setBack([home]);
    const c = S.settings;
    const g = S.goalStat();
    render(`<div class="card">
      ${pageHead(`設定`, { back: true })}
      <h3>🎯 衝刺目標</h3>
      <p class="tiny">訂「哪天之前學會幾個字」，首頁會自動算今天要學幾個。範圍選一個級別最實際。</p>
      <div class="goalbox">
        <p class="tiny">最快的訂法：按一個天數，字數自己算 —— 一天 ${S.GOAL_PACE} 個新字，那是正常速度讀得完的量。</p>
        <div class="btnrow">${goalPresetBtns(false)}</div>
      </div>
      <div class="pills">
        ${['all', 1, 2, 3, 4, 5, 6].map(v =>
      `<button class="pill ${String(g.scope) === String(v) ? 'on' : ''}" data-goalscope="${v}">${v === 'all' ? '全書' : '第 ' + v + ' 級'}</button>`).join('')}
      </div>
      <label class="slider">目標字數：<b>${g.target || 0}</b> 字（範圍內共 ${g.total} 字）
        <input type="range" min="0" max="${g.total}" step="${g.total > 1200 ? 100 : 50}" value="${g.target || 0}" data-goaltarget></label>
      <label class="row">期限：<input type="date" class="txt" style="font-size:15px;letter-spacing:0;width:auto;margin:0;text-align:left" value="${g.until || S.goalPreset(30).until}" data-goaluntil></label>
      <p class="tiny">${g.on
      ? `目前：${g.scope === 'all' ? '全書' : '第 ' + g.scope + ' 級'} ${g.target} 字 ・ ${g.until} 前 → 剩 ${g.daysLeft} 天，每天要 <b style="color:var(--gold)">${g.perDay}</b> 字`
      : '還沒啟用（字數與期限都填好就會自動啟用）'}</p>
      <div class="btnrow"><button class="btn sm ghost" data-act="clearGoal" style="color:var(--red)">取消目標</button></div>

      <h3 style="margin-top:18px">每關題數與題型組成</h3>
      <label class="slider">一個字母關幾題：<b>${c.stageQuestions}</b> 題<input type="range" min="5" max="30" step="1" value="${c.stageQuestions}" data-set="stageQuestions"></label>
      <label class="slider">其中句子運用題（克漏字／中譯英／重組／自由造句）：<b>${c.applyPerStage}</b> 題
        <input type="range" min="0" max="6" step="1" value="${c.applyPerStage}" data-set="applyPerStage"></label>
      <label class="slider">其中文法題：<b>${c.gramPerStage}</b> 題
        <input type="range" min="0" max="4" step="1" value="${c.gramPerStage}" data-set="gramPerStage"></label>
      <label class="slider">有例句的字，考句子的比重：<b>${c.sentRate}</b>
        <input type="range" min="0" max="100" step="10" value="${c.sentRate}" data-set="sentRate"></label>
      <p class="tiny">目前設定下，一關 ${c.stageQuestions} 題裡固定有
        <b style="color:var(--ac)">${Math.min(c.applyPerStage, Math.floor(c.stageQuestions / 4))}</b> 題句子運用、
        <b style="color:var(--gold)">${Math.min(c.gramPerStage, Math.floor(c.stageQuestions / 6))}</b> 題文法；
        剩下的單字題裡，有例句的字約有 ${Math.round(Q.applyChance(2) * 100)}% 機率也考句子（而不是四選一）。
        目前有例句的字共 ${Object.keys(window.SENTENCES || {}).length} 個。</p>
      <p class="tiny">新單字會在闖關前自動出現學習卡，不用另外設定數量。</p>
      <h3 style="margin-top:16px">關卡難度</h3>
      <div class="pills">${diffPills()}</div>
      <p class="tiny">難度決定血量、作答時間、題型難易、通關門檻與 XP／金幣加成；題數是另外一組設定，兩者互不影響。
        公開的四檔都很寬鬆、獎勵也普通 —— 想要大獎勵要爬究極階梯。</p>
      <h3 style="margin-top:16px">要練哪些題型</h3>
      <p class="tiny">關掉的題型就不會再出現。至少要留一種。</p>
      ${S.diff().allKinds ? `<p class="tiny" style="color:var(--red)">☠「${esc(S.diff().name)}」把這組開關整個蓋掉：你關掉的題型在這一階照樣會考。下面顯示的是你原本的設定，回到低階就會生效。</p>` : ''}
      <div class="pills">${S.ALL_KINDS.map(k =>
        `<button class="pill ${S.offKinds().includes(k) ? '' : 'on'}" data-kind="${k}">${esc(S.KIND_NAMES[k])}</button>`).join('')}</div>
      <h3 style="margin-top:16px">⌨ 鍵盤快速鍵</h3>
      <p class="tiny">整條動線都可以不用滑鼠。點「改鍵」之後直接按你要的鍵（Shift、Enter、Delete、空白鍵都可以）。
        同一個鍵可以綁在不同動作上，系統會依當下畫面決定要做什麼。</p>
      <div class="keys">${S.KEY_ACTS.map(a => `<div class="keyrow">
        <span class="kname">${esc(a.name)}</span>
        <kbd>${esc(keyLabel(S.keyOf(a.id)))}</kbd>
        <button class="btn sm ${keyCapture === a.id ? 'primary' : ''}" data-keyset="${a.id}">${keyCapture === a.id ? '請按一個鍵…' : '改鍵'}</button>
      </div>`).join('')}</div>
      <div class="btnrow"><button class="btn sm ghost" data-act="resetKeys">還原成預設鍵</button></div>

      <h3 style="margin-top:16px">其他</h3>
      <label class="row"><input type="checkbox" ${c.instantFeedback ? 'checked' : ''} data-chk="instantFeedback">每題答完立刻對答案（預設關閉：整關結束才一次結算）</label>
      <label class="row"><input type="checkbox" ${c.sweepCheck ? 'checked' : ''} data-chk="sweepCheck">快速篩選時抽考 2 題確認（預設關：說會就直接通過）</label>
      <label class="row"><input type="checkbox" ${c.reviewMastered ? 'checked' : ''} data-chk="reviewMastered">複習時也抽已經練起來的字（box 5 以上・預設關）</label>
      <p class="tiny">預設只複習還不穩的字。打開的話，長期記憶的字到期時也會被抽考 ——
        比較花時間，但可以確認自己是不是真的還記得。</p>
      <label class="row"><input type="checkbox" ${c.keyBar ? 'checked' : ''} data-chk="keyBar">在作答畫面顯示快速鍵提示條</label>
      <label class="row"><input type="checkbox" ${c.memes ? 'checked' : ''} data-chk="memes">顯示迷因台詞（讀累了看一句廢話，可關）</label>
      <label class="row"><input type="checkbox" ${c.sfx ? 'checked' : ''} data-chk="sfx">音效</label>
      <label class="row"><input type="checkbox" ${c.tts ? 'checked' : ''} data-chk="tts">單字發音</label>
      <label class="slider">發音速度：<b>${c.speechRate || 75}</b>%<input type="range" min="50" max="110" step="5" value="${c.speechRate || 75}" data-set="speechRate"></label>
      <div class="btnrow" style="margin-top:6px">
        <button class="btn sm" data-say="communication">🔊 試聽 communication</button>
        <button class="btn sm" data-say="She has already finished her homework.">🔊 試聽句子</button>
      </div>
      <p class="tiny">預設 75%：比母語者慢，聽得清楚每個音節。想練聽力再往上調。</p>
      <div class="btnrow" style="margin-top:14px"></div>
    </div>
    <div class="card">
      <h3>目前難度下，每題可用的時間</h3>
      <div class="tblwrap"><table class="rep"><tr><th>題型</th><th>時間</th></tr>${timeTable()}</table></div>
      <p class="tiny">每一題都有時限，但額度按「這題要做多少事」給：四選一只要辨認，句子重組要點十幾個詞塊。逾時若已經打了字，仍會照打的內容判分。</p>
    </div>
    <div class="card">
      <h3>☁ 跨裝置同步</h3>
      <p class="tiny">在每台裝置輸入<b>同一組同步碼</b>，進度就搬得過去。
        下載是<b>合併不是覆蓋</b>：同一個字取熟練度高的那邊、關卡取星數高的、XP 取大的 ——
        所以兩台都有練也不會互相蓋掉，按下去不會弄丟東西。</p>
      <label class="row">同步碼：<input class="txt" style="font-size:16px;letter-spacing:1px;width:auto;margin:0;text-align:left"
        value="${esc(S.syncCode())}" data-synccode placeholder="k7m2-x9pq-4rjb" spellcheck="false"></label>
      <div class="btnrow">
        <button class="btn sm ghost" data-act="syncNew">🎲 產生新的同步碼</button>
        <button class="btn" data-act="syncUp">⬆ 上傳這台的進度</button>
        <button class="btn primary" data-act="syncDown">⬇ 下載並合併</button>
      </div>
      <p class="tiny">${S.syncAt() ? `上次同步：${esc(String(S.syncAt()).slice(0, 16).replace('T', ' '))}` : '這台還沒同步過'}</p>
      <p class="tiny">⚠ <b>同步碼等於密碼</b> —— 網站是公開的，誰拿到碼誰就能讀寫這份進度，不要外流。<br>
        設定（難度、按鍵、每關題數、隱藏功能開關）<b>不會同步</b>，那是每台裝置自己的事。</p>
    </div>
    <div class="card">
      <h3>資料</h3>
      <div class="btnrow">
        <button class="btn" data-act="exportAll">⬇ 匯出全部學習資料</button>
        <button class="btn" data-act="importAll">⬆ 匯入備份</button>
        <button class="btn ghost" data-act="wipe" style="color:var(--red)">⚠ 清除所有進度</button>
      </div>
      <p class="tiny">進度存在這台電腦的瀏覽器裡（localStorage）。換電腦或清瀏覽資料前，記得先匯出備份。</p>
    </div>`);
  }

  // ---------------- 事件 ----------------
  document.addEventListener('click', e => {
    try { handleClick(e); } catch (err) { console.error(err); showError(err); }
  });

  function handleClick(e) {
    const t = e.target;
    const go = t.closest('[data-go]');
    if (go) {
      if (run && run.inStage) return confirmLeave();  // 進行中不能直接離開，要先確認放棄
      return nav(go.dataset.go);
    }
    const buy = t.closest('[data-buy]');
    if (buy) {
      const r = S.buy(buy.dataset.buy);
      toast(r.ok ? (r.pack ? `「${r.item.name}」裡的素材已放進背包` : `買了「${r.item.name}」`) : r.msg);
      if (r.ok) sfx.ok();
      return shop();
    }
    const eq = t.closest('[data-equip]');
    if (eq) {
      const inBag = !!t.closest('.recipes, .mats') || document.body.innerHTML.includes('合成台');
      S.equip(eq.dataset.equip); applyTheme();
      return inBag ? bag() : shop();
    }
    const rv = t.closest('[data-reveal]');
    if (rv) { rv.outerHTML = `<span class="revealed">${rv.dataset.ans}</span>`; return; }
    const ui = t.closest('[data-useitem]');
    if (ui) {
      const [id, deltaStr] = String(ui.dataset.useitem).split(':');
      const delta = +(deltaStr || 1);
      const have = S.inventory()[id] || 0;
      const cur = Math.min(useItems[id] || 0, have);
      const next = Math.max(0, Math.min(have, cur + delta));
      next ? (useItems[id] = next) : delete useItems[id];
      const m = window.__lastLetter;
      return m ? letterSetup(m.lv, m.letter) : home();
    }
    const ks = t.closest('[data-keyset]');
    if (ks) { keyCapture = ks.dataset.keyset; return settings(); }
    const cr = t.closest('[data-craft]');
    if (cr) {
      const r = S.craft(cr.dataset.craft);
      toast(r.ok ? `合成出「${r.name}」` : r.msg);
      if (r.ok) sfx.clear();
      return bag();
    }
    const fifty = t.closest('[data-act="fifty"]');
    if (fifty) return useFifty();
    const mlv = t.closest('[data-maplv]');
    if (mlv) return mapLetters(+mlv.dataset.maplv);
    const sst = t.closest('[data-startstage]');
    if (sst) { const [lv, L, n] = sst.dataset.startstage.split(':'); return startMapStage(+lv, L, +n); }
    const mlt = t.closest('[data-mapletter]');
    if (mlt) { const [lv, L] = mlt.dataset.mapletter.split(':'); return letterSetup(+lv, L); }
    const rst = t.closest('[data-resetstage]');
    if (rst) {
      const [lv, L] = rst.dataset.resetstage.split(':');
      const st = S.mapStat(+lv, L);
      return overlay(`<h2 style="color:var(--red)">把第 ${lv} 級 ・ ${L} 關重設？</h2>
        <p class="muted">這一關的 <b>${st.total}</b> 個字會全部變回「沒學過」（目前已學會 ${st.known} 個），
          星星與通關紀錄也會清掉，下次進來會重新出學習卡。</p>
        <p class="tiny">作答歷史、金幣、XP、徽章都不會動；成績單裡以前的紀錄還在。<b>無法復原</b>。</p>
        <div class="btnrow" style="justify-content:center;margin-top:12px">
          <button class="btn ghost" data-close="yes" style="color:var(--red)">確定重設</button>
          <button class="btn primary" data-close="no">取消</button></div>`,
        r => {
          if (r !== 'yes') return letterSetup(+lv, L);
          const out = S.resetStage(+lv, L);
          toast(`第 ${lv} 級 ・ ${L} 關已重設（${out.words} 個字回到未學習）`);
          letterSetup(+lv, L);
        });
    }
    const mback = t.closest('[data-mapback]');
    if (mback) return mapLetters(+mback.dataset.mapback);
    const mst = t.closest('[data-mapstage]');
    if (mst) { const [lv, L, c] = mst.dataset.mapstage.split(':'); return startMapStage(+lv, L, +c); }
    const sayEl = t.closest('[data-say]');
    if (sayEl) return say(sayEl.dataset.say);
    const slowEl = t.closest('[data-slow]');
    if (slowEl) return say(slowEl.dataset.slow, { rate: 0.45, twice: true });   // 慢速再唸兩次
    const opt = t.closest('[data-opt]');
    if (opt && !opt.disabled) return answerQ(run.qs[run.idx], +opt.dataset.opt);
    const tile = t.closest('[data-tile]');
    if (tile && !tile.classList.contains('used') && !tile.disabled) {
      tile.classList.add('used');
      const s = $('#slot');
      const b = document.createElement('button');
      b.className = 'tile'; b.dataset.back = tile.dataset.tile; b.textContent = tile.textContent;
      s.appendChild(b);
      return;
    }
    const az = t.closest('[data-az]');
    if (az) { const c = az.dataset.az; pr.az.has(c) ? pr.az.delete(c) : pr.az.add(c); return practice(); }
    const lv = t.closest('[data-lv]');
    if (lv) { const l = +lv.dataset.lv; pr.lv.has(l) ? pr.lv.delete(l) : pr.lv.add(l); return practice(); }
    const kd = t.closest('[data-kind]');
    if (kd) {
      if (!S.toggleKind(kd.dataset.kind)) toast('至少要留一種題型');
      return settings();
    }
    const dif = t.closest('[data-diff]');
    if (dif) { S.setDifficulty(dif.dataset.diff); return atHome ? home() : settings(); }
    const qt = t.closest('[data-qtab]');
    if (qt) { qtab = qt.dataset.qtab; return home(); }
    const rt = t.closest('[data-rtab]');
    if (rt) { rq.tab = rt.dataset.rtab; rq.page = 0; return records(); }
    const ro = t.closest('[data-ronly]');
    if (ro) { rq.only = ro.dataset.ronly; rq.page = 0; return records(); }
    const rp = t.closest('[data-rpage]');
    if (rp) { rq.page = Math.max(0, rq.page + +rp.dataset.rpage); return records(); }
    const gp = t.closest('[data-goalpreset]');
    if (gp) {
      const p = S.setGoalPreset(+gp.dataset.goalpreset);
      const st = S.goalStat();
      toast(`目標：${p.scope === 'all' ? '全書' : '第 ' + p.scope + ' 級'} ${p.target} 字，${p.until} 前 → 每天 ${st.perDay} 字`);
      return gp.closest('.goalbox') ? settings() : home();
    }
    // ---- 我的單字本 ----
    const bke = t.closest('[data-bkedit]');
    if (bke) { bk.edit = bke.dataset.bkedit; return book(); }
    const bkd = t.closest('[data-bkdel]');
    if (bkd) {
      const c = S.customFind(bkd.dataset.bkdel);
      if (c && S.customRemove(c.id)) {
        if (bk.edit === c.id) bk.edit = null;
        toast(`已刪除「${c.w}」`);
      }
      return book();
    }
    const bkk = t.closest('[data-bkkind]');
    if (bkk) { S.toggleCustomKind(bkk.dataset.bkkind); return book(); }

    const oc = t.closest('[data-openchest]');
    if (oc) return revealChest(+oc.dataset.openchest);
    const swl = t.closest('[data-swlv]');
    if (swl) {
      const l = +swl.dataset.swlv;
      sw.lvs.includes(l) ? sw.lvs = sw.lvs.filter(x => x !== l) : sw.lvs.push(l);
      if (!sw.lvs.length) sw.lvs = [l];
      return sweepStart();
    }
    const sws = t.closest('[data-swsize]');
    if (sws) { S.settings.sweepBatch = +sws.dataset.swsize; S.save(true); return sweepStart(); }
    const swp = t.closest('[data-swpick]');
    if (swp) {
      const k = +swp.dataset.swpick;
      sw.off.has(k) ? sw.off.delete(k) : sw.off.add(k);
      return sweepDrawPick();
    }
    const swo = t.closest('[data-swopt]');
    if (swo && !swo.disabled) return sweepAnswer(+swo.dataset.swopt);
    const gsc = t.closest('[data-goalscope]');
    if (gsc) {
      const v = gsc.dataset.goalscope;
      const scope = v === 'all' ? 'all' : +v;
      S.setGoal({ scope, target: scope === 'all' ? V().length : 1002 });
      const st = S.goalStat();
      S.setGoal({ planned: st.perDay });
      return settings();
    }
    const pre = t.closest('[data-preset]');
    if (pre) {
      const P = { light: [5, 15, 3], normal: [8, 20, 4], heavy: [15, 45, 6] }[pre.dataset.preset];
      S.settings.newPerDay = P[0]; S.settings.reviewCap = P[1]; S.settings.applyPerDay = P[2];
      S.save(true);
      return home();
    }
    const only = t.closest('[data-only]');
    if (only) { pr.only = only.dataset.only; return practice(); }
    const blv = t.closest('[data-blv]');
    if (blv) { bq.lv = +blv.dataset.blv; bq.page = 0; return browse(); }
    const bp = t.closest('[data-bpage]');
    if (bp) { bq.page += +bp.dataset.bpage; return browse(); }
    const act = t.closest('[data-act]');
    if (act) return doAct(act.dataset.act);
  };

  document.addEventListener('input', e => {
    const set = e.target.closest('[data-set]');
    if (set) {
      S.settings[set.dataset.set] = +set.value; S.save(true);
      set.closest('label').querySelector('b').textContent = set.value;
      if (set.attrs ? 'data-rehome' in set.attrs : set.hasAttribute('data-rehome')) {
        clearTimeout(window.__rehome);
        window.__rehome = setTimeout(home, 450);      // 拖完才重繪首頁的題數摘要
      }
    }
    const n = e.target.closest('[data-n]');
    if (n) { pr.n = +n.value; n.closest('label').querySelector('b').textContent = n.value; }
    const bn = e.target.closest('[data-bkn]');
    if (bn) { S.setCustomCfg({ n: +bn.value }); bn.closest('label').querySelector('b').textContent = bn.value; }
    const gt = e.target.closest('[data-goaltarget]');
    if (gt) {
      S.setGoal({ target: +gt.value });
      gt.closest('label').querySelector('b').textContent = gt.value;
      clearTimeout(window.__goalT);
      window.__goalT = setTimeout(() => { const st = S.goalStat(); S.setGoal({ planned: st.perDay }); settings(); }, 500);
    }
    const sc = e.target.closest('[data-synccode]');
    if (sc) S.setSyncCode(sc.value);        // 邊打邊存，換裝置輸入完就不用再按確定
    const gu = e.target.closest('[data-goaluntil]');
    if (gu && gu.value) {
      S.setGoal({ until: gu.value });
      const st = S.goalStat();
      S.setGoal({ planned: st.perDay });
      clearTimeout(window.__goalT);
      window.__goalT = setTimeout(settings, 300);
    }
  });
  document.addEventListener('change', e => {
    const chk = e.target.closest('[data-chk]');
    if (chk) { S.settings[chk.dataset.chk] = chk.checked; S.save(true); }
  });
  /* ---------------- 鍵盤操作 ----------------
     目標：整條動線（看卡片 → 作答 → 看檢討 → 下一題 → 結算 → 開寶箱）都不用碰滑鼠。
     同一個鍵可以綁在不同動作上（例如空白鍵同時是「下一題」與「學習卡下一個」），
     因為當下畫面只會有一種情境；下面依情境決定要做什麼。 */
  const KEY_LABEL = {
    ' ': 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Shift: 'Shift',
    Tab: 'Tab', Control: 'Ctrl', Alt: 'Alt', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  };
  const keyLabel = k => KEY_LABEL[k] || String(k || '').toUpperCase();
  const kbd = id => `<kbd>${esc(keyLabel(S.keyOf(id)))}</kbd>`;
  /** 螢幕下方的快速鍵提示條：把「現在這個畫面可以按哪些鍵」直接寫出來。 */
  function keyBar(items) {
    if (!S.settings.keyBar) return '';
    return `<div class="keybar">${items.map(x => `<span>${kbd(x[0])} ${esc(x[1])}</span>`).join('')}
      <span class="tiny">鍵可以在設定頁改</span></div>`;
  }
  let keyCapture = null;                 // 設定頁「改鍵」時，正在等哪個動作的按鍵
  const sameKey = (ev, id) => {
    const want = S.keyOf(id);
    if (!want) return false;
    if (want.length === 1) return String(ev.key).toUpperCase() === want;
    return ev.key === want;
  };
  /** 正在打字（輸入框／文字區）時，只有非文字鍵能當快速鍵，否則會打不出字。 */
  function typingNow() {
    const el = document.activeElement;
    if (!el || !el.tagName) return false;
    const t = String(el.tagName).toUpperCase();
    return t === 'INPUT' || t === 'TEXTAREA';
  }
  const PRINTABLE = k => String(k).length === 1 || k === ' ';

  document.addEventListener('keydown', e => {
    try { handleKey(e); } catch (err) { console.error(err); showError(err); }
  });

  function handleKey(e) {
    // 設定頁正在等你按鍵：這一下就是要設定的鍵，不執行任何動作
    if (keyCapture) {
      if (e.key === 'Tab') return;                        // 留給無障礙的焦點切換
      e.preventDefault();
      const id = keyCapture;
      keyCapture = null;
      S.setKey(id, e.key);
      toast(`「${(S.KEY_ACTS.find(a => a.id === id) || {}).name}」改成 ${keyLabel(S.keyOf(id))}`);
      return settings();
    }
    if (e.ctrlKey && e.key === 'Enter') {                 // Ctrl+Enter 一律送出（寫作文時用）
      const s = document.querySelector('[data-act="submit"]');
      if (s) { e.preventDefault(); return submit(); }
    }
    const typing = typingNow();
    if (typing && PRINTABLE(e.key) && !e.ctrlKey && !e.altKey) {
      // 打字中：只讓 Enter 這種非文字鍵通過（單行輸入框才用 Enter 送出）
      if (e.key !== 'Enter') return;
    }
    const overlay = document.querySelector('.overlay');
    // 1) 有蓋版視窗（暫停／GAME OVER／選寶箱）：主鍵按主要按鈕，Esc 按「繼續／取消」
    if (overlay) {
      if (sameKey(e, 'pause')) {
        const stay = overlay.querySelector('[data-close="resume"], [data-close="stay"], [data-close="no"]');
        if (stay) { e.preventDefault(); return fire(stay); }
      }
      if (sameKey(e, 'primary') || sameKey(e, 'next')) {
        const go = overlay.querySelector('.btn.primary[data-close]') || overlay.querySelector('[data-close]');
        if (go) { e.preventDefault(); return fire(go); }
      }
      return;
    }
    /* 「前進」這一族的鍵（下一題／學習卡下一個／結算主按鈕）互通：
       按 Enter 或空白鍵都要能往前走。原本學習卡只吃空白鍵，按 Enter 沒反應，
       那就會讓人覺得「快速鍵根本沒做」。 */
    const advance = ev => sameKey(ev, 'card') || sameKey(ev, 'next') || sameKey(ev, 'primary');
    // 2) 學習卡
    if (document.querySelector('[data-act="nextCard"]')) {
      if (advance(e)) { e.preventDefault(); return fire(document.querySelector('[data-act="nextCard"]')); }
      if (sameKey(e, 'prev')) { const b = document.querySelector('[data-act="prevCard"]'); if (b) { e.preventDefault(); return fire(b); } }
      if (sameKey(e, 'know')) { const b = document.querySelector('[data-act="knowCard"]'); if (b) { e.preventDefault(); return fire(b); } }
      if (sameKey(e, 'speak')) { const b = document.querySelector('[data-say]'); if (b) { e.preventDefault(); return say(b.dataset.say); } }
      if (sameKey(e, 'pause')) { const b = document.querySelector('[data-act="cardPause"]'); if (b) { e.preventDefault(); return fire(b); } }
      return;
    }
    // 3) 作答中／看檢討
    const inStage = run && run.qs && run.qs[run.idx];
    if (inStage) {
      const q = run.qs[run.idx];
      const fb = $('#fb');
      if (fb && fb.innerHTML && advance(e)) {
        const nb = document.querySelector('[data-act="next"]');
        if (nb) { e.preventDefault(); return next(); }
      }
      if (!run.locked) {
        if (q.opts && /^[1-4]$/.test(e.key)) {
          const b = document.querySelector(`[data-opt="${+e.key - 1}"]`);
          if (b) { e.preventDefault(); return answerQ(q, +e.key - 1); }
        }
        if (sameKey(e, 'submit') && document.querySelector('[data-act="submit"]')) { e.preventDefault(); return submit(); }
        if (sameKey(e, 'fifty') && document.querySelector('[data-act="fifty"]')) { e.preventDefault(); return useFifty(); }
        if (sameKey(e, 'speak')) { const b = document.querySelector('[data-say]'); if (b) { e.preventDefault(); return say(b.dataset.say); } }
        if (sameKey(e, 'pause') && document.querySelector('[data-act="gear"]')) { e.preventDefault(); return doAct('gear'); }
      }
      return;
    }
    // 4) 其他畫面（結算、地圖、首頁…）：主鍵＝畫面上第一顆主要按鈕
    if (advance(e)) {
      const b = document.querySelector('.wrap .btn.primary') || document.querySelector('.wrap .btn.gold');
      if (b && !b.disabled) { e.preventDefault(); return fire(b); }
    }
  }
  /** 用程式觸發點擊（走同一條事件委派，行為跟真的按下去一樣）。 */
  function fire(el) {
    if (!el) return;
    if (typeof el.click === 'function') return el.click();   // 真的派送一次點擊（會冒泡）
    handleClick({ target: el, preventDefault() { } });
  }

  function doAct(a) {
    if (a === 'back') return goBack();
    if (a === 'gear') {
      if (run && run.inStage) {
        if (!run.paused) { run.paused = true; clearInterval(run.timer); }
        return overlay(`<h2>⏸ 已暫停</h2>
          ${memeTag('pause')}
          <p class="muted">計時停住了，慢慢來。</p>
          <p class="tiny">離開＝放棄這一關：不算通過、連勝歸零、累積的 ${run.pendingXp} XP 不入帳。作答紀錄仍會保留。</p>
          <div class="btnrow" style="justify-content:center;margin-top:12px">
            <button class="btn primary" data-close="resume">繼續作答</button>
            <button class="btn ghost" data-close="quit" style="color:var(--red)">離開（放棄這一關）</button>
          </div>`, act => act === 'quit' ? abandonStage() : resumeStage());
      }
      return settings();
    }
    if (a === 'pause') return pauseStage();
    if (a === 'nextMapStage') {
      const n = window.__nextStage;
      return n ? letterSetup(n.lv, n.letter) : home();
    }
    if (a === 'continueLetter') {
      // 同一個字母繼續練沒學過的字（完成度沒到 100% 就不放你走）
      const c = window.__lastMap;
      if (!c) return home();
      const st = S.mapStat(c.lv, c.letter);
      const n = Math.max(3, Math.min(st.left, S.settings.stageQuestions || 10));
      return startMapStage(c.lv, c.letter, n);
    }
    if (a === 'retryMapStage') {
      const c = window.__lastMap;
      // 帶著上一輪的結果重新出題（答錯的換題型再考、答對的換掉）
      return c ? startMapStage(c.lv, c.letter, c.count, window.__lastAttempt || null) : home();
    }
    if (a === 'fixWrong') {
      const c = window.__lastMap, ids = window.__wrongIds || [];
      return startFixStage(ids, () => (c ? mapLetters(c.lv) : home()));
    }
    if (a === 'backToMap') {
      const c = window.__lastMap;
      return c ? letterSetup(c.lv, c.letter) : home();
    }
    if (a === 'sweepGo' || a === 'sweepNext') return sweepBatch();
    if (a === 'sweepPick') return sweepStart();
    if (a === 'sweepSubmit') return sweepCheck();
    if (a === 'sweepAllNo') { sw.batch.forEach((w, k) => sw.off.add(k)); return sweepCheck(); }
    if (a === 'sweepEnd') { clearInterval(window.__swTimer); return home(); }
    if (a === 'showPh') {                       // 聽力題：真的聽不出來就看音標（不會直接告訴你意思）
      const el = $('#phhint');
      if (el) { el.style.visibility = 'visible'; el.style.color = 'var(--gold)'; }
      return;
    }
    if (a === 'revealAll') {
      document.querySelectorAll('[data-reveal]').forEach(b => {
        b.outerHTML = `<span class="revealed">${b.dataset.ans}</span>`;
      });
      return;
    }
    if (a === 'maxItems') {
      PRE_ITEMS.forEach(it => { const n2 = S.inventory()[it.id] || 0; if (n2) useItems[it.id] = n2; });
      const m = window.__lastLetter;
      return m ? letterSetup(m.lv, m.letter) : home();
    }
    if (a === 'clearItems') {
      useItems = {};
      const m = window.__lastLetter;
      return m ? letterSetup(m.lv, m.letter) : home();
    }
    if (a === 'resetKeys') { S.resetKeys(); keyCapture = null; toast('快速鍵已還原成預設'); return settings(); }
    if (a === 'clearGoal') { S.clearGoal(); toast('已取消衝刺目標'); return settings(); }
    if (a === 'cardPause') return pauseCards();
    if (a === 'useKey') {
      if (S.matCount('key') < 1) return toast('沒有鑰匙');
      // 鑰匙箱走同一套全螢幕演出，收下後回背包
      S.addMat('key', -1);
      window.__chest = { id: S.addChest('silver', '寶箱鑰匙'), tier: 'silver', opened: false, bonusUsed: true, fromKey: true };
      window.__resultHtml = null;
      return openChestFlow();
    }
    if (a === 'chestLater') {                       // 全螢幕選箱畫面：先收起來
      toast('寶箱已收進背包，之後可以一次全開');
      return backFromChest();
    }
    if (a === 'useAllKeys') {
      const keys = S.matCount('key');
      if (!keys) return toast('沒有鑰匙');
      for (let k = 0; k < keys; k++) { S.addMat('key', -1); S.addChest('silver', '寶箱鑰匙'); }
      toast(`用掉 ${keys} 把鑰匙，換到 ${keys} 個銀寶箱`);
      return openAllChests();
    }
    if (a === 'openOneChest') {
      const bag = S.chestBag();
      if (!bag.length) return toast('背包裡沒有寶箱');
      window.__chest = { id: bag[0].id, tier: bag[0].tier, opened: false, bonusUsed: true, fromKey: true };
      window.__resultHtml = null;
      return openChestFlow();
    }
    if (a === 'openAllChests') return openAllChests();
    if (a === 'openChest') return openChestFlow();
    if (a === 'chestDone') {
      const g = window.__chestGifts || [];
      window.__chestGifts = null;
      backFromChest();
      return showLevelUps(g);
    }
    if (a === 'bonusRound') return bonusRound();
    if (a === 'dlCsv') return dlCsv();
    if (a === 'startWrong') {
      const qs = Q.wrongSet(15, S.diff().tierShift);
      if (!qs.length) { toast('目前沒有錯題，很好'); return home(); }
      return runStage({
        title: '🔁 錯題加強', questions: qs, hearts: 0, review: true,
        regen: () => Q.wrongSet(15, S.diff().tierShift),
      });
    }
    if (a === 'startLeech') {
      const ids = S.leeches(10).map(x => x.i);
      const qs = Q.fixSet(ids, S.diff().tierShift);
      if (!qs.length) { toast('目前沒有難字'); return home(); }
      return runStage({
        title: '⚠ 難字特訓', questions: qs, hearts: 0, review: true,
        regen: info => Q.fixSet(ids, S.diff().tierShift, info.avoidKinds),
      });
    }
    if (a === 'startReview') return startReview();
    if (a === 'next') return next();
    if (a === 'submit') return submit();
    if (a === 'clearSlot') { $('#slot').innerHTML = ''; document.querySelectorAll('.tile').forEach(x => x.classList.remove('used')); return; }
    if (a === 'knowCard') {
      const c = window.__cards;
      const id = c.ids[c.k];
      S.markKnown(id, 2);
      c.skip = (c.skip || []).concat(id);
      toast('標記為「早就會了」，3 天後複習會抽考它');
      return studyCards(c.ids, c.k + 1);
    }
    if (a === 'nextCard') { const c = window.__cards; return studyCards(c.ids, c.k + 1); }
    if (a === 'prevCard') { const c = window.__cards; return studyCards(c.ids, c.k - 1); }
    if (a === 'copyReport') return copyReport();
    if (a === 'printReport') return window.print();
    if (a === 'dlJson') return dlJson();
    if (a === 'dlHtml') return dlHtml();
    if (a === 'startPractice') {
      const ids = Q.shuffle(poolOf()).slice(0, pr.n).map(w => w.i);
      return runStage({
        title: '自訂範圍練習', questions: Q.reviewSet(ids), hearts: S.diff().hearts,
        // 重來時整批重抽（自訂練習的池子通常很大）
        regen: () => Q.reviewSet(Q.shuffle(poolOf()).slice(0, pr.n).map(w => w.i), S.diff().tierShift),
      });
    }
    // ---- 我的單字本 ----
    if (a === 'bkAdd' || a === 'bkSave') {
      const v = bookFormVals();
      if (!v.w || !v.tr) return toast('英文和中文都要填 —— 少一個就出不了題');
      if (a === 'bkSave' && bk.edit) {
        S.customUpdate(bk.edit, v);
        bk.edit = null;
        toast(`已更新「${v.w}」`);
      } else {
        const c = S.customAdd(v);
        if (!c) return toast('加不進去，檢查一下英文和中文');
        const kinds = S.customKinds(c).map(k => S.CUSTOM_KIND_NAMES[k]);
        toast(`已加入「${c.w}」—— 出得了：${kinds.join('、')}`);
      }
      return book();
    }
    if (a === 'bkCancel') { bk.edit = null; return book(); }
    if (a === 'bkStart') return bookStart(false);
    if (a === 'bkStartDue') return bookStart(true);
    if (a === 'exportAll') {
      download(`vocabQuest-backup-${S.todayStr()}.json`, JSON.stringify(S.load(), null, 2), 'application/json');
      return toast('已匯出備份');
    }
    if (a === 'syncNew') {
      const c = S.setSyncCode(S.newSyncCode());
      toast(`新的同步碼：${c}　（其他裝置輸入同一組）`);
      return settings();
    }
    if (a === 'syncUp') return syncUp();
    if (a === 'syncDown') return syncDown();
    if (a === 'importAll') {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const data = JSON.parse(rd.result);
            if (!data || !data.profile || !data.words) throw new Error('格式不符');
            localStorage.setItem('vocabQuest.v1', JSON.stringify(data));
            location.reload();
          } catch (err) { toast('匯入失敗：' + err.message); }
        };
        rd.readAsText(f);
      };
      inp.click();
      return;
    }
    if (a === 'wipe') {
      return overlay(`<h2 style="color:var(--red)">清除所有進度？</h2>
        <p class="muted">連續天數、XP、徽章、所有單字排程都會刪除，<b>無法復原</b>。建議先匯出備份。</p>
        <div class="btnrow" style="justify-content:center">
          <button class="btn" data-close="backup">先匯出備份</button>
          <button class="btn ghost" data-close="yes" style="color:var(--red)">確定清除</button>
          <button class="btn ghost" data-close="no">取消</button></div>`,
        r => {
          if (r === 'backup') { download(`vocabQuest-backup-${S.todayStr()}.json`, JSON.stringify(S.load(), null, 2), 'application/json'); toast('已備份，再按一次清除'); }
          if (r === 'yes') { S.reset(); location.reload(); }
        });
    }
  }

  // ---------------- 跨裝置同步 ----------------
  /* API 位址：雲端版走同源；本機版（雙擊 index.html 的 file://、或 127.0.0.1:8788）
     打回線上那一份 —— 否則「在自己電腦上直接開檔案玩」的那一份會變成永遠同步不到的孤島。 */
  const SYNC_HOME = 'https://english.dave0629.com';
  function syncUrl() {
    try {
      const h = (location && location.hostname) || '';
      const local = !h || h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:';
      return (local ? SYNC_HOME : '') + '/api/sync';
    } catch (e) { return '/api/sync'; }
  }
  /** 送出前的共同檢查：同步碼格式、這個環境能不能連線。 */
  function syncReady() {
    const code = S.syncCode();
    if (!S.SYNC_RE.test(code)) { toast('同步碼格式不對，按「產生新的同步碼」'); return null; }
    if (typeof fetch !== 'function') { toast('這個環境不能連線'); return null; }
    return code;
  }
  function syncUp() {
    const code = syncReady();
    if (!code) return;
    toast('上傳中…');
    fetch(syncUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, data: S.load() }),
    })
      .then(r => r.json())
      .then(j => {
        if (!j || !j.ok) throw new Error((j && j.error) || '上傳失敗');
        S.syncAt(j.at);
        sfx.ok();
        toast('✅ 已上傳，其他裝置輸入同一組碼就抓得到');
        settings();
      })
      .catch(e => toast('⚠ 上傳失敗：' + e.message));
  }
  function syncDown() {
    const code = syncReady();
    if (!code) return;
    toast('下載中…');
    fetch(syncUrl() + '?code=' + encodeURIComponent(code))
      .then(r => r.json())
      .then(j => {
        if (!j || !j.ok) throw new Error((j && j.error) || '下載失敗');
        const out = S.mergeRemote(j.data);
        if (!out) throw new Error('雲端那份資料看起來不對');
        S.syncAt(j.at);
        sfx.clear();
        const gained = out.xpAfter - out.xpBefore;
        toast(`✅ 已合併：單字 ${out.words}、關卡 ${out.map}、天數 ${out.days}${gained ? `、XP +${gained}` : ''}`);
        home();
      })
      .catch(e => toast('⚠ 下載失敗：' + e.message));
  }

  function nav(where) {
    clearInterval(run && run.timer);
    if (where === 'home') return home();
    if (where === 'report') return report();
    if (where === 'map') return home();
    if (where === 'shop') return shop();
    if (where === 'bag') return bag();
    if (where === 'sweep') return sweepStart();
    if (where === 'practice') return practice();
    if (where === 'book') return book();
    if (where === 'browse') return browse();
    if (where === 'badges') return badges();
    if (where === 'records') return records();
    if (where === 'settings') return settings();
    home();
  }

  /* 給 src/admin.js（管理員面板）用的接口：它是獨立檔案，進不到這個 IIFE 裡面。
     只開放「跳畫面」與「重畫」這幾件事，其餘一律照原本的流程走。 */
  window.__app = { nav, home, render, overlay, toast, applyTheme, pauseStage, beep };

  window.__run = () => run;          // 測試接縫：讓 test-ui.js 能檢查目前關卡狀態
  window.__meme = (key, sub) => memeLine(key, sub);   // 測試接縫：驗證台詞不會連續重複
  window.__drawQuestion = () => drawQuestion();       // 測試接縫：直接渲染指定題目來檢查版面

  // ---------------- 錯誤攔截 ----------------
  /* 事件處理器一旦拋錯，畫面會停在原地、按鈕像是「壞掉沒反應」。
     把錯誤直接顯示出來，才有辦法回報與修。 */
  function showError(err) {
    const msg = (err && (err.stack || err.message)) || String(err);
    const box = document.createElement('div');
    box.className = 'toast';
    box.style.maxWidth = '92vw';
    box.style.whiteSpace = 'pre-wrap';
    box.style.borderColor = 'var(--red)';
    box.textContent = '⚠ 發生錯誤：' + msg.slice(0, 400);
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 12000);
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('error', e => showError(e.error || e.message));
    window.addEventListener('unhandledrejection', e => showError(e.reason));
  }

  // ---------------- 啟動 ----------------
  function boot() {
    if (!window.VOCAB || !window.VOCAB.length) {
      document.body.innerHTML = `<div class="wrap"><div class="card"><h2>字庫載入失敗</h2>
        <p class="muted">找不到 <code>data/words.js</code>。請確認 index.html 和 data 資料夾在同一層。</p></div></div>`;
      return;
    }
    applyTheme();
    const starter = S.grantStarter();          // 第一次開啟送新手包，道具功能才有東西可以玩
    const makeup = S.grantMakeup();            // 舊存檔：補償先前被自動吃掉的道具
    home();
    if (makeup) {
      overlay(`<div class="big" style="color:var(--gold)">🎁 道具補償</div>
        <p class="muted">道具改成「這一關要不要用、用幾個」<b>之前</b>，每一關都會自動吃掉你的道具 ——
          那是我的設計失誤，先補回來給你。</p>
        <div class="lootrow">
          <span class="loot item">🧪 護心符 ×${makeup.heart}</span>
          <span class="loot item">🧪 大護心符 ×${makeup.bigheart}</span>
          <span class="loot item">🧪 沙漏 ×${makeup.hourglass}</span>
          <span class="loot item">🧪 雙倍 XP 卡 ×${makeup.xp2}</span>
          <span class="loot item">🧪 刪去法 ×${makeup.fifty}</span>
          <span class="loot coin">🪙 +${makeup.coins}</span>
        </div>
        <p class="tiny">現在道具只有你自己在「選幾個字」畫面選了才會消耗，關卡上方也會顯示這關用了什麼。</p>
        <div class="btnrow" style="justify-content:center;margin-top:12px">
          <button class="btn primary" data-close="ok">收下</button>
        </div>`);
    }
    if (starter) {
      overlay(`<div class="big" style="color:var(--gold)">🎁 新手包</div>
        <p class="muted">先給你一些道具，這樣才玩得到「這一關要用哪些道具」。</p>
        <div class="lootrow">
          <span class="loot item">🧪 護心符 ×${starter.heart}</span>
          <span class="loot item">🧪 沙漏 ×${starter.hourglass}</span>
          <span class="loot item">🧪 刪去法 ×${starter.fifty}</span>
          <span class="loot coin">🪙 +${starter.coins}</span>
        </div>
        <p class="tiny">進字母關選完字數後，下面的紫色卡片就可以選這一關要用幾個。</p>
        <div class="btnrow" style="justify-content:center;margin-top:12px">
          <button class="btn primary" data-close="ok">知道了</button>
        </div>`);
    }
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
