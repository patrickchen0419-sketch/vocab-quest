/* 畫面、闖關流程、成績單。 */
(function () {
  'use strict';
  const S = window.Store, Q = window.Quiz;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const V = () => window.VOCAB;
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
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
  function say(text) {
    if (!S.settings.tts || !window.speechSynthesis || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const en = voices.filter(v => /^en/i.test(v.lang));
      u.voice = en.find(v => /US|United States/i.test(v.name + v.lang)) || en[0] || null;
      u.lang = (u.voice && u.voice.lang) || 'en-US';
      // 預設放慢：學生要聽清楚每個音節，不是聽母語者的正常語速
      // 設定頁的滑桿存的是百分比（75 = 0.75 倍速）
      const raw = S.settings.speechRate;
      u.rate = Math.max(0.5, Math.min(1.2, (raw > 2 ? raw / 100 : raw) || 0.75));
      speechSynthesis.speak(u);
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
    o.innerHTML = `<div class="box card">${html}</div>`;
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
  function render(html, isHome) {
    atHome = !!isHome;
    if (isHome) backStack = [];
    document.body.innerHTML = topbar() + `<div class="wrap">${html}</div>`;
    if (!isHome) ensureWayOut();
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
    const cur = S.settings.difficulty, rec = S.recommendDifficulty();
    return S.DIFF_ORDER.map(id => {
      const d = S.DIFFICULTY[id];
      return `<button class="pill ${cur === id ? 'on' : ''}" data-diff="${id}" title="${esc(d.desc)}">${esc(d.name)}${id === rec ? ' ⭐' : ''}</button>`;
    }).join('');
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

  /** 衝刺目標卡：倒數幾天、今天該學幾個字、落後多少。沒訂目標時給快速設定鈕。 */
  function goalCard() {
    const g = S.goalStat();
    if (!g.on) {
      return `<div class="card goalcard off">
        <h2>🎯 還沒訂衝刺目標</h2>
        <p class="muted">訂一個「哪天之前學會幾個字」，網站每天會自己算出今天要學幾個 —— 落後了數字會變大，不用手動改計畫。</p>
        <div class="btnrow">
          <button class="btn primary" data-goalpreset="lv3">第 3 級 1002 字（建議）</button>
          <button class="btn" data-goalpreset="lv4">第 4 級 1002 字</button>
          <button class="btn" data-goalpreset="all">全書 6012 字</button>
          <button class="btn ghost" data-go="settings">自己設</button>
        </div>
        <p class="tiny">期限預設 8/10，可以在設定頁改。</p>
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
    return `<div class="card">
      <h2>任務看板 <span class="tiny">${done}/${list.length} 達成</span></h2>
      <div class="pills">${tabs}</div>
      ${bar('本頁任務達成度', done, list.length, `${done}/${list.length}`, 'g-gold')}
      <div class="quests">${list.map(questRow).join('')}</div>
      ${sp && !sp.done ? `<div class="btnrow"><button class="btn gold" data-mapletter="${sp.lv}:${sp.letter}">🎯 直接去主打關（第 ${sp.lv} 級 ${sp.letter}）</button></div>` : ''}
      <p class="tiny">任務一旦達成就永久記住（時間會記在紀錄裡），不會因為之後數字變動而退回未完成。獎勵在關卡結算時自動入帳。</p>
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

      ${goalCard()}

      ${(() => {
        const st = S.sweepStat();
        const easy = (st.byLevel[1] || 0) + (st.byLevel[2] || 0);
        if (!st.unseen) return '';
        return `<div class="card sweepcard">
          <h2>⚡ 先把「本來就會的字」篩掉</h2>
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
        ${bar('今天已完成的複習題', sum.reviewTotal, Math.max(due, sum.reviewTotal || 1), `${sum.reviewTotal} 題`, 'g-red')}
        <div class="btnrow"><button class="btn primary" data-act="startReview">開始複習（${Math.min(due, 15)} 題）</button></div>
      </div>` : `<div class="card act-review"><h2>今天沒有到期的複習 ✅</h2>
        <p class="muted">直接去闖關地圖推進度吧。</p></div>`}

      <div class="card">
        <h2>闖關地圖</h2>
        <p class="muted">6 個大關（級別 1～6），每個大關有 A–Z 的字母小關。正確率 <b style="color:var(--gold)">${Math.round(S.PASS_ACC * 100)}%</b> 以上才算通關，通關就有寶箱。</p>
        <div class="stages" style="margin-top:10px">${lvRows}</div>
      </div>

      ${(() => {
        const wp = S.wrongPool(), lc = S.leeches();
        if (!wp.length) return '';
        const names = wp.slice(0, 8).map(x => V()[x.i].w);
        return `<div class="card wrongcard">
          <h2>🔁 錯題加強 <span class="tiny">${wp.length} 個字還沒練起來</span></h2>
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
      xpCard: cfg.xpCard || 1, timeMul: cfg.timeMul || 1,
      retries: cfg.retries || 0, t0: Date.now(), qt0: Date.now(), timer: null, locked: false,
    };
    if (!run.qs.length) { toast('這一關沒有題目，先做別的吧'); return home(); }
    // 每一關都記一筆：開始時間、用了多少時間、結果。重來會另外記一筆。
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

  /** 升等獎勵：金幣、道具、外觀解鎖。結算畫面畫完後才蓋上去。 */
  function showLevelUps(gifts) {
    if (!gifts || !gifts.length) return;
    sfx.lvl();
    const rows = gifts.map(g => {
      const it = g.item && S.shopItem(g.item);
      const un = g.unlock && S.shopItem(g.unlock);
      return `<div style="border-top:1px solid var(--line);padding:10px 0">
        <b style="color:var(--purple)">Lv.${g.level}</b>
        <div class="tiny">🪙 +${g.coin} 金幣${it ? `　🧪 ${esc(it.name)} ×1` : ''}${un ? `　🎁 解鎖「${esc(un.name)}」` : ''}</div>
      </div>`;
    }).join('');
    const last = gifts[gifts.length - 1];
    overlay(`<div class="big" style="color:var(--purple)">⬆ 升級！Lv.${last.level}</div>
      <p class="muted">升等獎勵已經放進你的背包了。</p>
      ${rows}
      <p class="tiny" style="margin-top:8px">消耗品會在下一關開始時自動使用；外觀與稱號到商店裡「使用」。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        <button class="btn primary" data-close="ok">收下</button>
      </div>`);
  }

  function restartStage() {
    const c = run.cfg;
    runStage(Object.assign({}, c, { attempt: run.attempt + 1, retries: run.retries + 1 }));
  }

  function hearts() {
    if (!run.maxHearts) return '';
    const alive = Math.max(0, Math.min(run.hearts, run.maxHearts));
    return `<span class="hearts">${'♥'.repeat(alive)}<span class="off">${'♥'.repeat(run.maxHearts - alive)}</span></span>`;
  }

  function drawQuestion() {
    clearInterval(run.timer);
    const q = run.qs[run.idx];
    if (!q) return finishStage();
    run.locked = false; run.qt0 = Date.now();
    const p = q.prompt;
    const useTimer = S.settings.timer && limitOf(q) > 0;
    let body = '';

    const speakBtn = p.speak ? `<button class="speak" data-say="${esc(p.speak)}" title="播放發音">🔊</button>` : '';
    const redoTag = q.redo ? '<div class="redotag">🔁 剛才錯過的字，再練一次</div>' : '';
    // 句子題如果不是這一關的字（本關的字沒有例句），要標清楚，不然會像「D 關怎麼跑出 E 開頭」
    const outTag = q.outside && q.i != null
      ? `<div class="outtag">📎 延伸句型練習 ・ <b>${esc(V()[q.i].w)}</b>（第 ${V()[q.i].lv} 級 ・ ${esc(V()[q.i].w[0].toUpperCase())} 開頭）不屬於這一關</div>`
      : '';
    const lvTag = p.lv ? `<div class="qtag">${p.tag ? esc(p.tag) + ' ・ ' : ''}第 ${p.lv} 級 ${p.pos ? '・ ' + esc(p.pos) : ''}</div>` : '';

    if (p.type === 'word') {
      body = `${lvTag}<div class="qword">${esc(p.word)} ${speakBtn}</div>
        ${p.ph ? `<div class="qph">/${esc(p.ph)}/</div>` : ''}<p class="muted" style="margin-top:10px">選出正確的中文意思</p>`;
    } else if (p.type === 'zh') {
      body = `${lvTag}<div class="qword zh">${esc(p.zh)}</div><p class="muted" style="margin-top:10px">選出正確的英文單字</p>`;
    } else if (p.type === 'listen') {
      body = `${lvTag}<div style="font-size:52px">🔊</div>
        <button class="btn" data-say="${esc(p.speak)}" style="margin-top:8px">再聽一次</button>
        <p class="muted" style="margin-top:12px">聽發音，選出正確答案</p>`;
      setTimeout(() => say(p.speak), 250);
    } else if (p.type === 'spell') {
      body = `${lvTag}<div class="qword zh">${esc(p.zh)}</div>
        <div class="qph" style="letter-spacing:5px;font-size:22px;margin-top:10px">${esc(p.hint)}</div>
        <p class="muted" style="margin-top:8px">拼出這個英文單字（只給字數：${p.len} 個字母，不給任何字母）</p>
        <input class="txt" id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入拼字">`;
    } else if (p.type === 'form') {
      body = `${lvTag}<div class="qword">${esc(p.word)} ${speakBtn}</div>
        <div class="qph">${esc(p.zh)}</div>
        <p class="muted" style="margin-top:12px">請選出它的 <b style="color:var(--gold)">${esc(p.ask)}</b></p>`;
    } else if (p.type === 'cloze') {
      body = `${lvTag}<div class="qsent">${esc(p.sentence).replace(/\{[^}]*\}/, '<span class="gap">?</span>')}</div>
        <div class="qzh">${esc(p.zh)}</div><p class="muted" style="margin-top:10px">選出最適合填入的字</p>`;
    } else if (p.type === 'order') {
      body = `${lvTag}<p class="muted">把下面的詞塊排成正確的英文句子</p>
        <div class="qzh" style="font-size:17px;color:var(--tx)">${esc(p.zh)}</div>
        <div class="slot" id="slot"></div>
        <div class="tiles" id="tiles">${p.tiles.map((t, k) => `<button class="tile" data-tile="${k}">${esc(t)}</button>`).join('')}</div>`;
    } else if (p.type === 'trans') {
      body = `${lvTag}<div class="qzh" style="font-size:17px;color:var(--tx)">${esc(p.zh)}</div>
        <div class="qsent" style="margin-top:10px">${esc(p.sentence).replace('____', '<span class="gap">?</span>')}</div>
        <p class="muted" style="margin-top:10px">填入正確的字（提示：${esc(p.hint)}）</p>
        <input class="txt" id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入單字">`;
    } else if (p.type === 'free') {
      body = `${lvTag}<div class="qword">${esc(p.word)} ${speakBtn}</div>
        <div class="qph">${esc(p.zh)}</div>
        <p class="muted" style="margin-top:12px">用這個字寫一句英文（自己造句）</p>
        ${p.coll ? `<p class="tiny">常用搭配：${esc(p.coll)}</p>` : ''}
        <textarea class="txt" id="ans" placeholder="例如：I decided to ..."></textarea>
        <p class="tiny">這題不判對錯。寫完之後下載今日紀錄，Claude Code 會逐句批改。</p>`;
    } else if (p.type === 'gmc') {
      body = `<div class="qtag">文法 ・ ${esc(p.title)}${q.via ? ` ・ 來自這一關的 ${esc(q.via)}` : ''}</div>
        <div class="qsent">${esc(p.sentence).replace(/_{2,}/, '<span class="gap">?</span>')}</div>`;
    } else if (p.type === 'gfix') {
      body = `<div class="qtag">找錯改錯 ・ ${esc(p.title)}${q.via ? ` ・ 來自這一關的 ${esc(q.via)}` : ''}</div>
        <p class="muted">下面這句有一個錯，把<b>整句</b>改對重寫一次</p>
        <div class="qsent" style="color:var(--red)">${esc(p.sentence)}</div>
        <textarea class="txt" id="ans" placeholder="寫出改正後的整句"></textarea>`;
    }

    const optsHtml = q.opts ? `<div class="opts" id="opts">${q.opts.map((o, k) =>
      `<button class="opt" data-opt="${k}"><span class="k">${'ABCD'[k]}</span><span>${esc(o)}</span></button>`).join('')}</div>` : '';
    const submitHtml = q.opts ? '' :
      `<div class="btnrow" style="margin-top:14px;justify-content:center">
         <button class="btn primary" data-act="submit">${p.type === 'free' ? '寫好了，下一題' : '送出'}</button>
         ${p.type === 'order' ? '<button class="btn ghost" data-act="clearSlot">清空</button>' : ''}
       </div>`;

    render(`
      <div class="hud">
        <b>${esc(run.cfg.title)}</b>
        <button class="btn sm ghost gear" data-act="gear" style="order:99">⚙</button>
        ${hearts()}
        <span class="combo">${run.combo >= 2 ? '本關連擊 ×' + run.combo + ' ✨' : ''}</span>
        <div class="progressline"><i style="width:${run.idx / run.qs.length * 100}%"></i></div>
        <span class="tiny">${run.idx + 1}/${run.qs.length}</span>
        ${useTimer ? '<span class="timer" id="timer"></span>' : ''}
        ${q.opts && S.owned('fifty') ? `<button class="btn sm gold" data-act="fifty">刪去法 ×${S.inventory().fifty}</button>` : ''}
      </div>
      <div class="card qcard ${q.redo ? 'redo' : ''} ${q.outside ? 'outside' : ''}" id="qcard">${redoTag}${outTag}${body}${optsHtml}${submitHtml}</div>
      <div id="fb"></div>
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

  /** 這一題的實際秒數 = 題型基準 × 使用者的時間寬鬆度。 */
  function limitOf(q) {
    const base = q.secs || Q.secsFor(q.kind);
    return Math.max(5, Math.round(base * S.diff().time * ((run && run.timeMul) || 1)));
  }

  function startTimer(q, resumeFrom) {
    const total = limitOf(q);
    run.left = resumeFrom == null ? total : resumeFrom;
    const warnAt = Math.max(5, Math.round(total * 0.25));
    const el = $('#timer');
    const tick = () => {
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
    const q = run.qs[run.idx];
    if (q && !run.locked && S.settings.timer && limitOf(q) > 0) startTimer(q, Math.max(1, run.left));
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

  function answerQ(q, given, timeout) {
    if (run.locked) return;
    run.locked = true;
    clearInterval(run.timer);
    const ms = Date.now() - run.qt0;
    const isFree = !!q.noGrade;
    // 逾時但已經打了字 → 照打的內容判分（不因為沒按送出就白扣）；完全空白才算沒作答
    const ok = isFree ? null : (given == null || given === '' ? false : Q.grade(q, given));

    // ---- 記錄 ----
    if (isFree) {
      S.logFree({
        i: q.i, w: V()[q.i].w, text: given || '',
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
      S.answer(q.i, ok, att);
      // given / right 一起存下來：作答紀錄要看得出「當時寫了什麼」，事後無法重建
      S.logAnswer({
        i: q.i, t: q.kind, ok, attempt: att, ms, timeout: !!timeout, redo: !!q.redo,
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
      if (milestone) toast(`🔥 ${run.combo} 連擊 BONUS +${Math.round(milestone * S.diff().xp)} XP`);
      sfx.ok();
    } else if (ok === false) {
      run.combo = 0;
      if (run.maxHearts) run.hearts--;
      sfx.no();
    } else {
      gained = Math.round(8 * S.diff().xp);   // 自由造句給參與分
    }
    run.pendingXp += gained;
    Object.assign(run.answers[run.answers.length - 1], { gained, speed, comboBonus, milestone, ms });

    // 血量歸零：立刻標記死亡，這樣就算使用者搶著按「下一題」也不會溜過去
    if (ok === false && run.maxHearts && run.hearts <= 0) {
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
    if (!run || q.i == null || q.noGrade) return;
    if (run.cfg.bonus) return;                       // 加碼題只有一題，不補考
    run.redo = run.redo || {};
    const n = run.redo[q.i] || 0;
    if (n >= REDO_MAX) return;
    if (run.qs.length > 60) return;                  // 別讓一關無限長
    const w = V()[q.i];
    const b = (S.load().words[q.i] || {}).b || 0;
    const nq = Q.forWord(w, b, (run.cfg.map ? S.diff().tierShift : 0));
    if (!nq) return;
    nq.redo = true;
    run.redo[q.i] = n + 1;
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
    const inp = $('#ans'); if (inp) inp.disabled = true;
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
    const inp = $('#ans'); if (inp) inp.disabled = true;
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
      head = `<b>✓ 答對了！</b>　+${gained} XP　<span style="color:var(--gold)">${esc(sp.tag)} ${sp.sec}s</span>
        <span class="hint">底分 ${BASE_XP}${a.speed ? `　速度 +${a.speed}` : ''}${a.comboBonus ? `　連擊 +${a.comboBonus}` : ''}${a.milestone ? `　里程碑 +${a.milestone}` : ''}${S.diff().xp !== 1 ? `　難度 ×${S.diff().xp}` : ''}</span>
        ${run.combo >= 3 ? `<span class="hint">本關連擊 ×${run.combo}（換關或答錯就歸零）</span>` : ''}`;
    } else {
      const ansTxt = q.opts ? q.opts[q.a] : q.answer;
      head = `<b>✗ ${timeout ? '時間到' : '答錯了'}</b>　正確答案：<b style="color:var(--ac)">${esc(ansTxt)}</b>
        ${run.maxHearts ? `<span class="hint">扣一顆心，剩 ${run.hearts} 顆</span>` : ''}`;
    }
    const w = q.i != null ? V()[q.i] : null;
    const extra = [];
    if (q.why) extra.push(esc(q.why).replace(/\n/g, '<br>'));
    if (w && (window.SENTENCES[w.w] || {}).trap && ok === false) extra.push('⚠ ' + esc(window.SENTENCES[w.w].trap));
    $('#fb').innerHTML = `<div class="feedback ${ok === false ? 'no' : 'ok'}">${head}
      ${extra.length ? `<div style="margin-top:8px;color:var(--tx2);font-size:13.5px">${extra.join('<br>')}</div>` : ''}</div>
      <div class="btnrow" style="margin-top:12px"><button class="btn primary" data-act="next">${run.dead ? '血量用完了…' : run.idx + 1 >= run.qs.length ? '完成這一關' : '下一題'}</button>
      ${w ? `<button class="btn ghost" data-say="${esc(Q.base(w.w))}">🔊 ${esc(Q.base(w.w))}</button>` : ''}</div>`;
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
    const canRevive = S.owned('revive') && !run.revived;
    if (!canRevive) recordFail();
    sfx.dead();
    overlay(`<div class="big" style="color:var(--red)">GAME OVER</div>
      <p class="muted">血量用完了。這一關累積的 <b>${run.pendingXp} XP 全部作廢</b>，星數不給、連擊歸零，要重新挑戰。</p>
      <p class="tiny">別擔心 — 你剛才答錯的字<b>都已經記錄下來</b>，會排進間隔複習，也會出現在今天的家長回報裡。正確率只採計第 1 次作答，重來不會虛胖。</p>
      <div class="btnrow" style="justify-content:center;margin-top:12px">
        ${canRevive ? `<button class="btn purple big-btn" data-close="revive">💎 用復活石續命（持有 ${S.inventory().revive}）</button>` : ''}
        <button class="btn primary" data-close="retry">重新挑戰這一關</button>
        ${run.cfg.map ? '<button class="btn gold" data-close="fix">訂正錯的字</button>' : ''}
        <button class="btn ghost" data-close="home">先回首頁</button>
      </div>
      ${canRevive ? '<p class="tiny">復活石：血量回 1 顆，從下一題接著打，累積的 XP 保留。每關只能用一次。</p>' : ''}`, act => {
        if (act === 'revive') return reviveStage();
        recordFail();                            // 不復活 → 這一關正式算失敗
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
    if (!run || !S.consume('revive')) return home();
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
    // 通關門檻是 95%，星數就在 95% 以上再分級：全對 3 星、只錯一點 2 星
    const stars = acc >= 1 ? 3 : acc >= .97 ? 2 : 1;
    const passed = acc >= S.PASS_ACC;

    const streakBefore = S.winStreak();
    const m = S.recordStage(lv, letter, passed, acc, stars, run.bestCombo);
    const wrongIds = run.answers.filter(a => a.ok === false && a.q.i != null).map(a => a.q.i);
    window.__lastMap = { lv, letter, count: cfg.map.count };
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
    window.__chest = passed ? { tier, lv, letter, ids: [...new Set(run.answers.map(a => a.q.i).filter(i => i != null))], opened: false, bonusUsed: false } : null;

    const head = passed
      ? `<div class="stars" style="font-size:40px">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
         <h2 style="color:var(--ac)">通關！第 ${lv} 級 ・ ${letter} 關</h2>`
      : `<div class="big" style="color:var(--red)">未通關</div>
         <p class="muted">正確率 ${Math.round(acc * 100)}%，沒到 <b>${Math.round(S.PASS_ACC * 100)}%</b> 的通關門檻。這一關的 XP 與金幣都不算，要再挑戰一次。</p>
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
        ${checkin ? `<p class="tiny">每日簽到 +${checkin.xp} XP　+${checkin.coin} 🪙</p>` : ''}` : ''}
      ${drops.length ? `<div class="lootrow">${drops.map(x => {
        const m = S.material(x.id);
        return `<span class="loot item">${m.icon} ${esc(m.name)} ×${x.n}</span>`;
      }).join('')}</div><p class="tiny">素材已放進背包，可以拿去合成道具。</p>` : ''}
      ${quests.length ? `<div class="badges" style="justify-content:center">${quests.map(q => `<span class="badge got">✅ ${esc(q.name)} +${q.xp}XP +${q.coin}🪙</span>`).join('')}</div>` : ''}
      ${got.length ? `<div class="badges" style="justify-content:center">${got.map(b => `<span class="badge got">🏅 ${esc(b.name)}</span>`).join('')}</div>` : ''}
      <div class="btnrow" style="justify-content:center;margin-top:16px">
        ${passed && window.__nextStage ? `<button class="btn primary" data-act="nextMapStage">下一關 ・ ${window.__nextStage.lv} 級 ${window.__nextStage.letter} →</button>` : ''}
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
        ${c.bonusUsed ? '' : `<button class="btn purple" data-act="bonusRound">🎲 加碼題 ${bonusCount(c)} 題（答錯不倒扣）</button>`}
      </div>
      <p class="tiny">加碼題題數跟著這一關的規模（一關的 ⅓，3～8 題）。全對升兩級、答對六成以上升一級，金寶箱還能升到 🌈 彩虹。</p>
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
      <p class="tiny" style="text-align:center;margin-top:18px">稀有獎品：💎 金鑽石、🔑 寶箱鑰匙、復活石、三倍 XP 卡、🪙 金幣大獎、🎀 神秘禮物（機率很低）</p>
    </div>`);
  }

  /** 全螢幕開箱演出：箱子放大 → 一項一項亮出獎品。 */
  function revealChest(pick) {
    const c = window.__chest;
    if (!c || c.opened) return;
    const r = S.openChest(c.tier);
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
  /** 加碼題：從這一關的字裡抽題。答對越多，寶箱升越多級。答錯不倒扣。 */
  function bonusRound() {
    const c = window.__chest;
    if (!c || c.bonusUsed) return;
    const pool = (c.ids || []).filter(i => i != null);
    if (!pool.length) return toast('這一關沒有可以加碼的字');
    const want = bonusCount(c);
    const shift = (S.diff().tierShift || 0) + 1;      // 加碼題刻意出難一點的題型
    const ids = Q.shuffle(pool);
    const qs = [];
    for (let k = 0; qs.length < want && k < want * 5; k++) {
      const q = Q.forWord(V()[ids[k % ids.length]], null, shift);
      if (q && !q.noGrade) qs.push(q);               // 自由造句沒對錯，不能當加碼題
    }
    if (!qs.length) return toast('抽不到加碼題，直接開箱吧');
    c.bonusUsed = true;
    runStage({ title: `🎲 加碼題（${qs.length} 題）`, questions: qs, hearts: 0, bonus: true });
  }

  function finishBonus() {
    const c = window.__chest;
    const graded = run.answers.filter(a => a.ok !== null);
    const right = run.right, total = graded.length;
    // 全對升兩級（金 → 彩虹）、過半升一級、其餘不升但不倒扣
    const ups = total && right === total ? 2 : right >= Math.ceil(total * 0.6) ? 1 : 0;
    let tier = c ? c.tier : null;
    for (let k = 0; k < ups && c; k++) tier = S.upgradeChest(tier, true);
    if (c) c.tier = tier;
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

  /** 關卡結算：逐題檢討清單（答錯的排前面，附正確答案與說明）。 */
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
          <div><b style="color:${color}">${mark}</b> ${w ? `<b>${esc(w.w)}</b> <span class="tiny">${esc(w.p)} L${w.lv}</span>` : `<b>${esc(window.GRAMMAR_TITLES[q.gid] || '文法')}</b>`}
            ${a.gained ? `<span class="tiny" style="color:var(--ac);float:right">+${a.gained} XP</span>` : ''}</div>
          ${a.ok === false ? `<div class="tiny">你的答案：<span style="color:var(--red)">${esc(yours)}</span>　正確：<span style="color:var(--ac)">${esc(right)}</span></div>` : ''}
          ${a.ok === null ? `<div class="tiny">你寫的：${esc(yours)}</div>` : ''}
          ${a.ok === false && why ? `<div class="tiny" style="color:var(--tx2);margin-top:4px">${why}</div>` : ''}
          ${a.ok === false && trap ? `<div class="tiny" style="color:var(--gold)">⚠ ${esc(trap)}</div>` : ''}
        </div>`,
      };
    });
    rows.sort((a, b) => (a.ok === false ? 0 : a.ok === null ? 1 : 2) - (b.ok === false ? 0 : b.ok === null ? 1 : 2));
    return rows.map(r => r.html).join('');
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
    runStage({ title: '複習到期單字', questions: qs, hearts: S.diff().hearts, review: true });
  }

  // ---------------- 成績單 / 家長回報 ----------------
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
      return `<tr><td class="w">${esc(w.w)}</td><td class="muted">${esc(w.p)} L${w.lv}</td><td>${esc(w.tr)}</td></tr>`;
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
        ${k > 0 ? '<button class="btn ghost" data-act="prevCard">← 上一個</button>' : ''}
        <button class="btn primary" data-act="nextCard">${k + 1 >= ids.length ? '開始闖關 →' : '記住了，下一個 →'}</button>
        <button class="btn ghost" data-act="knowCard">這個我早就會了 ⏭</button>
      </div>
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
      const title = `${st.total} 字・已學會 ${st.known}${st.tries ? `・挑戰 ${st.tries} 次` : ''}${st.combo ? `・最佳連擊 ×${st.combo}` : ''}`;
      const pct = Math.round(st.known / st.total * 100);
      const stars = st.cleared ? '★'.repeat(st.stars) + '☆'.repeat(3 - st.stars) : `${pct}%`;
      return `<button class="pill az ${st.cleared ? 'on' : ''}" data-mapletter="${lv}:${L}" title="${esc(title)}">${L}<br><span style="font-size:10px;opacity:.8">${stars}</span></button>`;
    }).join('');
    const st = S.levelStat(lv);
    render(`<div class="card">
      ${pageHead(`第 ${lv} 級　<span class="tiny">${st.cleared}/${st.playable} 個字母關通過</span>`, { back: true })}
      <p class="muted">選一個字母開始。還沒通關的磚顯示「已學會比例」，通關的顯示星數。</p>
      ${bar('這一級的單字進度', st.known, st.total, `${st.known}/${st.total} 字`, 'g-lv' + lv)}
      ${bar('這一級的通關進度', st.cleared, st.playable, `${st.cleared}/${st.playable} 關`, 'g-gold')}
      <div class="pills" style="margin-top:10px">${tiles}</div>
      <p class="tiny" style="margin-top:10px">灰色＝這個字母在這一級沒有字</p>
    </div>`);
  }

  /** 進到字母關之後，先選這一次要練幾個字。 */
  function letterSetup(lv, letter) {
    setBack([home, () => mapLetters(lv)]);
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
      ${bar('這一關的單字進度', st.known, st.total, `${st.known}/${st.total} 字`, 'g-lv' + lv)}
      ${(() => {
        const own = ids.filter(i => Q.hasSent(V()[i])).length;
        const c = S.settings;
        const slots = Math.min(c.applyPerStage, Math.floor((S.settings.stageQuestions || 10) / 4));
        if (!slots) return '';
        return `<p class="tiny">句子運用題會優先用這一關的字（這裡有 <b>${own}</b> 個字有例句）。
          不夠時最多補一題其他字的「延伸句型」，題面上會標出來，其餘名額改考本關的字。</p>`;
      })()}
      <p class="tiny" style="margin-top:10px">會優先出你還沒學會的字。<b style="color:var(--gold)">正確率 ${Math.round(S.PASS_ACC * 100)}% 以上才算通關</b>，通關就有寶箱（表現越好箱子越好）。</p>
      ${st.cleared ? `<p class="tiny" style="color:var(--ac)">這一關已通過 ${'★'.repeat(st.stars)}${'☆'.repeat(3 - st.stars)}${st.combo ? `　最佳連擊 ×${st.combo}` : ''}　挑戰過 ${st.tries} 次</p>`
      : st.tries ? `<p class="tiny">挑戰過 ${st.tries} 次，最佳正確率 ${Math.round(st.best * 100)}%${st.combo ? `　最佳連擊 ×${st.combo}` : ''}</p>` : ''}
    </div>`);
  }

  function startMapStage(lv, letter, count) {
    const ids = S.bucket(lv, letter);
    const n = Math.max(3, Math.min(count || 10, ids.length));
    const qs = Q.stageSet(lv, letter, n, S.diff().tierShift);
    if (!qs.length) { toast('這一關沒有字'); return letterSetup(lv, letter); }
    // 開關前自動用掉身上的加成道具
    const used = [];
    let hearts = S.diff().hearts, timeMul = 1, xpCard = 1;
    if (S.owned('bigheart') && S.consume('bigheart')) { hearts += 3; used.push('大護心符 ♥+3'); }
    else if (S.owned('heart') && S.consume('heart')) { hearts += 1; used.push('護心符 ♥+1'); }
    if (S.owned('hourglass2') && S.consume('hourglass2')) { timeMul = 2; used.push('大沙漏 時間×2'); }
    else if (S.owned('hourglass') && S.consume('hourglass')) { timeMul = 1.5; used.push('沙漏 時間+50%'); }
    if (S.owned('xp3') && S.consume('xp3')) { xpCard = 3; used.push('三倍 XP 卡'); }
    else if (S.owned('xp2') && S.consume('xp2')) { xpCard = 2; used.push('雙倍 XP 卡'); }
    if (used.length) toast('已使用：' + used.join('、'));
    const go = () => runStage({
      title: `第 ${lv} 級 ・ ${letter} 關`,
      questions: qs, hearts,
      map: { lv, letter, count: n }, timeMul, xpCard,
    });
    const fresh = [...new Set(qs.map(q => q.i).filter(i => i != null && !S.isSeen(i)))];
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
    runStage({ title: '訂正剛才答錯的字', questions: qs, hearts: 0, fix: true, backTo: back });
  }

  /** 刪去法道具：把兩個錯誤選項變灰不可選。 */
  function useFifty() {
    const q = run && run.qs[run.idx];
    if (!q || !q.opts || run.locked) return;
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
      : `<button class="btn sm ${afford ? 'gold' : ''}" data-buy="${it.id}" ${afford ? '' : 'disabled'}>🪙 ${price}</button>`;
    return `<div class="item ${r.cls} ${on ? 'equipped' : ''} ${deal ? 'ondeal' : ''}">
      ${deal ? '<span class="dealtag">-25%</span>' : ''}
      <div class="ihead"><span class="iicon">${KIND_ICON[it.kind] || '·'}</span><span class="rtag">${r.name}</span></div>
      <b>${esc(it.name)}</b>
      <span class="tiny">${esc(it.desc)}</span>
      <div class="ifoot">
        ${have ? `<span class="tiny" style="color:var(--ac)">持有 ${have}</span>`
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
      const items = S.SHOP.filter(x => x.kind === kind);
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
    ${group('title', '🏷 稱號', '顯示在左上角品牌名旁邊。')}
    `);
  }

  // ---------------- 快速篩選（本來就會的字不用當新字學）----------------
  /* 流程：一次 12 個字 → 自己點掉「不會的」→ 從沒點的字裡隨機抽 2 個真的考 →
     抽考過就把整批當已會（box 2，3 天後還是會被複習抽到）；抽考沒過整批降級。 */
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
      <p class="tiny">為了不讓數字虛胖：每批會從你「說會」的字裡<b>隨機抽 2 個真的考</b>；抽考沒過，整批降級明天重考。
        算已會的字也只放到 box 2，<b>3 天後照樣會出現在複習裡</b>。</p>
      <h3 style="margin-top:14px">要篩哪幾級？</h3>
      <div class="pills">${lvBtns}</div>
      <p class="muted" style="margin-top:10px">還沒篩過的字：<b style="color:var(--ac)">${st.unseen}</b> 個
        ・已篩掉（本來就會）<b style="color:var(--blue)">${st.claimed}</b> 個</p>
      <div class="btnrow">
        <button class="btn primary big-btn" data-act="sweepGo" ${pool ? '' : 'disabled'}>開始篩（一批 12 字）</button>
      </div>
      <p class="tiny">一批大約 20–40 秒。L1＋L2 共 2004 字，全部篩完約 1.5–2 小時，之後就再也不會被當新字考。</p>
    </div>`);
  }

  function sweepBatch() {
    sw.batch = S.sweepPool(12, sw.lvs);
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
          <button class="btn ghost" data-act="sweepAllNo">全部都不會</button>
          <button class="btn ghost" data-act="sweepEnd">先停</button>
        </div>
        <p class="tiny" style="margin-top:8px">點掉的字會排進學習隊列（照樣出學習卡與完整題型）；沒點的字接著會被抽考。</p>
      </div>`);
  }

  /** 從「說會」的字裡抽 2 個真的考（英→中 四選一，10 秒）。 */
  function sweepCheck() {
    const claim = sw.batch.filter((w, k) => !sw.off.has(k));
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

  function sweepApply(failed) {
    const know = sw.batch.filter((w, k) => !sw.off.has(k)).map(w => w.i);
    const learn = sw.batch.filter((w, k) => sw.off.has(k)).map(w => w.i);
    const r = S.applySweep({ know, learn, failed: failed || [] });
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
    const collect = S.SHOP.filter(x => (x.kind === 'theme' || x.kind === 'title' || x.kind === 'pet' || x.kind === 'auto') && inv[x.id]);

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
    render(`<div class="card">
      ${pageHead(`背包　<span class="chip coin">🪙 ${S.coins()}</span>`, { back: true })}
      <p class="muted">通關會掉寶石與素材（級別越高、星數越高掉得越好），拿到合成台換道具。</p>
    </div>

    <div class="card">
      <h3>💠 素材</h3>
      <div class="mats">${matCards}</div>
      ${keys ? `<div class="btnrow" style="margin-top:10px">
        <button class="btn gold big-btn" data-act="useKey">🔑 用鑰匙開一個銀寶箱（持有 ${keys}）</button></div>`
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
          <div class="ifoot"><span class="tiny">${x.kind === 'auto' ? '被動生效' : ''}</span>
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
      return `<tr><td class="w">${esc(w.w)} <button class="speak" data-say="${esc(Q.base(w.w))}">🔊</button></td>
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
      const what = x.cat === 'gram' ? esc(x.title || (window.GRAMMAR_TITLES || {})[x.id] || '文法題')
        : w ? `<b>${esc(w.w)}</b> <span class="tiny">${esc(w.p)} L${w.lv}</span>` : '—';
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
      <div class="pills">
        ${['all', 1, 2, 3, 4, 5, 6].map(v =>
      `<button class="pill ${String(g.scope) === String(v) ? 'on' : ''}" data-goalscope="${v}">${v === 'all' ? '全書' : '第 ' + v + ' 級'}</button>`).join('')}
      </div>
      <label class="slider">目標字數：<b>${g.target || 0}</b> 字（範圍內共 ${g.total} 字）
        <input type="range" min="0" max="${g.total}" step="${g.total > 1200 ? 100 : 50}" value="${g.target || 0}" data-goaltarget></label>
      <label class="row">期限：<input type="date" class="txt" style="font-size:15px;letter-spacing:0;width:auto;margin:0;text-align:left" value="${g.until || '2026-08-10'}" data-goaluntil></label>
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
      <p class="tiny">難度決定血量、作答時間、題型難易與 XP 加成；題數是另外一組設定，兩者互不影響。</p>
      <h3 style="margin-top:16px">要練哪些題型</h3>
      <p class="tiny">關掉的題型就不會再出現。至少要留一種。</p>
      <div class="pills">${S.ALL_KINDS.map(k =>
        `<button class="pill ${S.kindOn(k) ? 'on' : ''}" data-kind="${k}">${esc(S.KIND_NAMES[k])}</button>`).join('')}</div>
      <h3 style="margin-top:16px">其他</h3>
      <label class="row"><input type="checkbox" ${c.timer ? 'checked' : ''} data-chk="timer">每題倒數計時</label>
      <label class="row"><input type="checkbox" ${c.instantFeedback ? 'checked' : ''} data-chk="instantFeedback">每題答完立刻對答案（預設關閉：整關結束才一次結算）</label>
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
    const mback = t.closest('[data-mapback]');
    if (mback) return mapLetters(+mback.dataset.mapback);
    const mst = t.closest('[data-mapstage]');
    if (mst) { const [lv, L, c] = mst.dataset.mapstage.split(':'); return startMapStage(+lv, L, +c); }
    const sayEl = t.closest('[data-say]');
    if (sayEl) return say(sayEl.dataset.say);
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
      const v = gp.dataset.goalpreset;
      const scope = v === 'all' ? 'all' : +v.replace('lv', '');
      const total = scope === 'all' ? V().length : 1002;
      const g = S.setGoal({ scope, target: total, until: '2026-08-10', on: true });
      const st = S.goalStat();
      S.setGoal({ planned: st.perDay });               // 記下一開始的每日量，之後才看得出落後
      toast(`目標：${scope === 'all' ? '全書' : '第 ' + scope + ' 級'} ${total} 字，${g.until} 前 → 每天 ${st.perDay} 字`);
      return home();
    }
    const oc = t.closest('[data-openchest]');
    if (oc) return revealChest(+oc.dataset.openchest);
    const swl = t.closest('[data-swlv]');
    if (swl) {
      const l = +swl.dataset.swlv;
      sw.lvs.includes(l) ? sw.lvs = sw.lvs.filter(x => x !== l) : sw.lvs.push(l);
      if (!sw.lvs.length) sw.lvs = [l];
      return sweepStart();
    }
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
    const gt = e.target.closest('[data-goaltarget]');
    if (gt) {
      S.setGoal({ target: +gt.value });
      gt.closest('label').querySelector('b').textContent = gt.value;
      clearTimeout(window.__goalT);
      window.__goalT = setTimeout(() => { const st = S.goalStat(); S.setGoal({ planned: st.perDay }); settings(); }, 500);
    }
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
  document.addEventListener('keydown', e => {
    if (!run || run.locked === undefined) return;
    const q = run.qs && run.qs[run.idx];
    if (!q) return;
    if ($('#fb') && $('#fb').innerHTML && (e.key === 'Enter' || e.key === ' ')) {
      const nb = document.querySelector('[data-act="next"]');
      if (nb) { e.preventDefault(); return next(); }
    }
    if (q.opts && !run.locked && /^[1-4]$/.test(e.key)) {
      const b = document.querySelector(`[data-opt="${+e.key - 1}"]`);
      if (b) { e.preventDefault(); answerQ(q, +e.key - 1); }
    }
    if (e.key === 'Enter' && e.ctrlKey) { const s = document.querySelector('[data-act="submit"]'); if (s) submit(); }
  });

  function doAct(a) {
    if (a === 'back') return goBack();
    if (a === 'gear') {
      if (run && run.inStage) {
        if (!run.paused) { run.paused = true; clearInterval(run.timer); }
        return overlay(`<h2>⏸ 已暫停</h2>
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
    if (a === 'retryMapStage') {
      const c = window.__lastMap;
      return c ? startMapStage(c.lv, c.letter, c.count) : home();
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
    if (a === 'clearGoal') { S.clearGoal(); toast('已取消衝刺目標'); return settings(); }
    if (a === 'cardPause') return pauseCards();
    if (a === 'useKey') {
      if (S.matCount('key') < 1) return toast('沒有鑰匙');
      // 鑰匙箱走同一套全螢幕演出，收下後回背包
      window.__chest = { tier: 'silver', opened: false, bonusUsed: true, fromKey: true };
      window.__resultHtml = null;
      S.addMat('key', -1);
      return openChestFlow();
    }
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
      return runStage({ title: '🔁 錯題加強', questions: qs, hearts: 0, review: true });
    }
    if (a === 'startLeech') {
      const ids = S.leeches(10).map(x => x.i);
      const qs = Q.fixSet(ids, S.diff().tierShift);
      if (!qs.length) { toast('目前沒有難字'); return home(); }
      return runStage({ title: '⚠ 難字特訓', questions: qs, hearts: 0, review: true });
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
      return runStage({ title: '自訂範圍練習', questions: Q.reviewSet(ids), hearts: S.diff().hearts });
    }
    if (a === 'exportAll') {
      download(`vocabQuest-backup-${S.todayStr()}.json`, JSON.stringify(S.load(), null, 2), 'application/json');
      return toast('已匯出備份');
    }
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

  function nav(where) {
    clearInterval(run && run.timer);
    if (where === 'home') return home();
    if (where === 'report') return report();
    if (where === 'map') return home();
    if (where === 'shop') return shop();
    if (where === 'bag') return bag();
    if (where === 'sweep') return sweepStart();
    if (where === 'practice') return practice();
    if (where === 'browse') return browse();
    if (where === 'badges') return badges();
    if (where === 'records') return records();
    if (where === 'settings') return settings();
    home();
  }

  window.__run = () => run;          // 測試接縫：讓 test-ui.js 能檢查目前關卡狀態

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
    home();
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
