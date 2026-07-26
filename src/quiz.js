/* 題目生成器。認字層 6 種由字庫自動生成；運用層 4 種由 sentences.js 生成；文法 2 種由 grammar.js 生成。 */
(function () {
  'use strict';

  const V = () => window.VOCAB;

  // ---------- word-form helpers ----------
  /** 'achieve(ment)' -> 'achieve'；'a/an' -> 'a'；'wood(s)' -> 'wood' */
  function base(w) { return String(w).split('/')[0].replace(/\([^)]*\)/g, '').trim(); }
  /** 'achieve(ment)' -> 'achievement'（括號展開形），沒有括號就回傳 base */
  function expanded(w) {
    const p = String(w).split('/')[0];
    return p.includes('(') ? p.replace(/[()]/g, '').trim() : base(w);
  }
  /** 拼字題可接受的答案集合（含所有斜線變體與括號展開） */
  function acceptable(w) {
    const set = new Set();
    String(w).split('/').forEach(p => {
      p = p.trim();
      if (!p) return;
      set.add(p.replace(/\([^)]*\)/g, '').trim().toLowerCase());
      set.add(p.replace(/[()]/g, '').trim().toLowerCase());
    });
    set.delete('');
    return [...set];
  }
  function posKey(p) { return String(p).replace(/[()\s]/g, '').split('/')[0]; }

  const norm = s => String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const stripEnd = s => norm(s).replace(/[.!?,;:]+$/, '');

  /* 每種題型的作答秒數上限。每一題都有時限，但額度按「這題實際要做多少事」給：
     四選一只要辨認，句子重組要點十幾個詞塊、找錯改錯要重寫整句。
     使用者可在設定頁用「時間寬鬆度」等比放大或縮小這整張表。 */
  const LIMITS = {
    e2c: 15, c2e: 15, listen: 18, confuse: 18,   // 認字：辨認
    form: 20, spell: 35,                          // 認字：要打字（拼字不給首字母，時間多一點）
    cloze: 30, trans: 45, order: 75,              // 運用：讀句子＋產出
    gmc: 40, gfix: 90,                            // 文法：選擇／重寫整句
    free: 150,                                    // 自由造句
  };
  const secsFor = kind => LIMITS[kind] || 30;

  function shuffle(a) {
    a = a.slice();
    for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
    return a;
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];

  /** 兩個中文釋義是否太像（避免出現兩個都對的選項） */
  function glossClash(a, b) {
    a = String(a || ''); b = String(b || '');
    if (!a || !b) return false;
    for (const seg of a.split(/[；;]/)) {
      const t = seg.trim();
      if (t.length >= 2 && b.includes(t)) return true;
    }
    for (let k = 0; k + 2 <= a.length; k++) {
      const g = a.slice(k, k + 2);
      if (/[一-鿿]{2}/.test(g) && b.includes(g)) return true;
    }
    return false;
  }

  /** 選出 n 個干擾字：同級優先、同詞性優先、釋義不可雷同 */
  function distractors(word, n) {
    const all = V(), out = [], used = new Set([word.i]);
    const tiers = [
      w => w.lv === word.lv && posKey(w.p) === posKey(word.p),
      w => Math.abs(w.lv - word.lv) <= 1 && posKey(w.p) === posKey(word.p),
      w => Math.abs(w.lv - word.lv) <= 1,
      () => true,
    ];
    for (const t of tiers) {
      let guard = 0;
      while (out.length < n && guard++ < 400) {
        const c = all[Math.floor(Math.random() * all.length)];
        if (used.has(c.i) || !c.tr || !t(c)) continue;
        if (glossClash(word.tr, c.tr) || out.some(o => glossClash(o.tr, c.tr))) continue;
        if (base(c.w).toLowerCase() === base(word.w).toLowerCase()) continue;
        used.add(c.i); out.push(c);
      }
      if (out.length >= n) break;
    }
    return out;
  }

  function mc(word, kind, promptObj, correctText, wrongTexts, why) {
    const opts = shuffle([correctText].concat(wrongTexts));
    return {
      kind, i: word ? word.i : null, secs: secsFor(kind),
      prompt: promptObj, opts, a: opts.indexOf(correctText), why: why || '',
    };
  }

  // ================= 認字層 =================
  function q_e2c(w) {
    const d = distractors(w, 3);
    if (d.length < 3) return null;
    return mc(w, 'e2c', { type: 'word', word: w.w, ph: w.ph, pos: w.p, lv: w.lv, speak: base(w.w) },
      w.tr, d.map(x => x.tr), w.tf || '');
  }

  function q_c2e(w) {
    const d = distractors(w, 3);
    if (d.length < 3) return null;
    return mc(w, 'c2e', { type: 'zh', zh: w.tr, pos: w.p, lv: w.lv },
      w.w, d.map(x => x.w), `${w.w} ${w.p} ${w.tr}`);
  }

  function q_listen(w) {
    // 有易混淆同伴時考「聽音辨字」，否則考「聽音辨義」
    const cf = (w.cf || []).map(j => V()[j]).filter(x => x && x.tr);
    if (cf.length >= 3) {
      return mc(w, 'listen', { type: 'listen', speak: base(w.w), lv: w.lv },
        w.w, shuffle(cf).slice(0, 3).map(x => x.w), `${w.w} = ${w.tr}`);
    }
    const d = distractors(w, 3);
    if (d.length < 3) return null;
    return mc(w, 'listen', { type: 'listen', speak: base(w.w), lv: w.lv },
      w.tr, d.map(x => x.tr), `${w.w} ${w.ph ? '/' + w.ph + '/' : ''} ${w.tr}`);
  }

  function q_spell(w) {
    const target = base(w.w);
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(target) || target.length < 3) return null;
    // 只給字數提示：每個字母一個底線，不透露任何字母（連首字母也不給）。
    // 連字號與撇號留著，因為那是拼寫結構、不是答案提示。
    const shown = target.replace(/[A-Za-z]/g, '_');
    return {
      kind: 'spell', i: w.i, secs: secsFor('spell'),
      prompt: { type: 'spell', zh: w.tr, pos: w.p, hint: shown, len: target.length, lv: w.lv, speak: target },
      accept: acceptable(w.w), answer: target,
      why: `${w.w} ${w.ph ? '/' + w.ph + '/' : ''} ${w.tr}`,
    };
  }

  const FORM_LABEL = { p: '過去式', d: '過去分詞', i: '現在分詞（V-ing）', 3: '第三人稱單數', r: '比較級', t: '最高級', s: '複數' };

  /** 產生「看起來很像但錯」的形式當干擾選項。每個 key 至少要湊出 3 個，
      所以除了規則變化外也放入常見錯誤（忘記變化、重複字尾、y/e 處理錯）。 */
  function fakeForms(stem, key) {
    const s = stem.toLowerCase();
    const last = s[s.length - 1];
    const dbl = s + last;
    const noE = s.replace(/e$/, '');
    const yToI = s.replace(/y$/, 'i');
    const cand = [s];                                  // 忘記變化 — 最常見的錯
    if (key === 'p' || key === 'd') cand.push(s + 'ed', s + 'd', dbl + 'ed', yToI + 'ed', noE + 'ed', s + 'en');
    else if (key === 'i') cand.push(s + 'ing', dbl + 'ing', noE + 'ing', s + 'eing', yToI + 'ing');
    else if (key === '3') cand.push(s + 's', s + 'es', yToI + 'es', dbl + 's', noE + 'es');
    else if (key === 's') cand.push(s + 's', s + 'es', yToI + 'es', dbl + 's', s + 'ies', noE + 'es');
    else if (key === 'r') cand.push(s + 'er', 'more ' + s, dbl + 'er', yToI + 'er', noE + 'er');
    else if (key === 't') cand.push(s + 'est', 'most ' + s, dbl + 'est', yToI + 'est', noE + 'est');
    return [...new Set(cand)].filter(Boolean);         // 呼叫端會再濾掉正解
  }

  function q_form(w) {
    const ex = w.ex || {};
    const keys = Object.keys(ex).filter(k => FORM_LABEL[k] && /^[A-Za-z][A-Za-z' -]*$/.test(ex[k]));
    if (!keys.length) return null;
    const key = pick(keys), correct = ex[key].split(/[,\s]*\|[,\s]*|,\s*/)[0].trim();
    const stem = base(w.w);
    const wrong = fakeForms(stem, key).filter(x => norm(x) !== norm(correct));
    if (wrong.length < 3) return null;
    return mc(w, 'form', { type: 'form', word: w.w, zh: w.tr, ask: FORM_LABEL[key], lv: w.lv, speak: stem },
      correct, shuffle(wrong).slice(0, 3), `${stem} → ${FORM_LABEL[key]}：${correct}`);
  }

  function q_confuse(w) {
    const cf = (w.cf || []).map(j => V()[j]).filter(Boolean);
    if (cf.length < 3) return null;
    const chosen = shuffle(cf).slice(0, 3);
    const why = [w].concat(chosen).map(x => `${base(x.w)} = ${x.tr}`).join('　｜　');
    return mc(w, 'confuse', { type: 'zh', zh: w.tr, pos: w.p, lv: w.lv, tag: '易混淆字' },
      w.w, chosen.map(x => x.w), why);
  }

  // ================= 運用層 =================
  function sent(w) { return (window.SENTENCES || {})[w.w] || null; }
  const marked = ex => (ex.match(/\{([^}]*)\}/) || [, ''])[1];
  const plainSent = ex => ex.replace(/[{}]/g, '');

  function q_cloze(w) {
    const s = sent(w);
    if (!s) return null;
    const tok = marked(s.ex);
    const d = distractors(w, 3);
    if (!tok || d.length < 3) return null;
    // 干擾選項採同樣的變化形外觀（首字母大小寫對齊）
    const cap = /^[A-Z]/.test(tok);
    const fix = x => { const b = base(x.w); return cap ? b[0].toUpperCase() + b.slice(1) : b; };
    return mc(w, 'cloze', { type: 'cloze', sentence: s.ex, zh: s.zh, lv: w.lv, speak: plainSent(s.ex) },
      tok, d.map(fix), `${plainSent(s.ex)}\n${s.zh}${s.coll ? '\n搭配：' + s.coll : ''}`);
  }

  function q_order(w) {
    const s = sent(w);
    if (!s) return null;
    const full = plainSent(s.ex);
    const toks = full.split(/\s+/).filter(Boolean);
    if (toks.length < 5 || toks.length > 14) return null;
    return {
      kind: 'order', i: w.i, secs: secsFor('order'),
      prompt: { type: 'order', zh: s.zh, tiles: shuffle(toks), lv: w.lv, speak: full },
      answer: full, compare: 'sentence',
      why: `${full}${s.gp ? '\n文法點：' + (window.GRAMMAR_TITLES[s.gp] || '') : ''}`,
    };
  }

  function q_trans(w) {
    const s = sent(w);
    if (!s) return null;
    const tok = marked(s.ex);
    if (!tok) return null;
    return {
      kind: 'trans', i: w.i, secs: secsFor('trans'),
      prompt: { type: 'trans', zh: s.zh, sentence: s.ex.replace(/\{[^}]*\}/, '____'), lv: w.lv, hint: `${w.w}（${w.tr}）`, speak: plainSent(s.ex) },
      accept: [tok], answer: tok, compare: 'token',
      why: `${plainSent(s.ex)}\n${s.zh}${s.trap ? '\n注意：' + s.trap : ''}`,
    };
  }

  function q_free(w) {
    const s = sent(w);
    return {
      kind: 'free', i: w.i, secs: secsFor('free'), noGrade: true,
      prompt: {
        type: 'free', word: w.w, zh: w.tr, pos: w.p, lv: w.lv, speak: base(w.w),
        sample: s ? plainSent(s.ex) : null, sampleZh: s ? s.zh : null,
        coll: s ? s.coll : null,
      },
      accept: acceptable(w.w),
      why: s ? `參考句：${plainSent(s.ex)}\n${s.zh}` : '',
    };
  }

  /** 自由造句的機械檢查（不判對錯，只給提示；語意與文法由 Claude Code 批改） */
  function checkFree(text, accept) {
    const t = String(text || '').trim();
    const words = t.split(/\s+/).filter(Boolean);
    const low = ' ' + t.toLowerCase().replace(/[^a-z' ]/g, ' ') + ' ';
    const usedWord = accept.some(a => low.includes(' ' + a + ' ') ||
      new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(s|es|ed|d|ing|ies|ied)?\\b').test(low));
    return {
      words: words.length,
      usedWord,
      capital: /^[A-Z"']/.test(t),
      punctuated: /[.!?]["']?$/.test(t),
      notes: [
        usedWord ? null : '句子裡好像沒有用到這個單字（或形式差太多）',
        words.length < 5 ? '句子有點短，試著寫 5 個詞以上' : null,
        /^[A-Z"']/.test(t) ? null : '句首要大寫',
        /[.!?]["']?$/.test(t) ? null : '句尾要有標點（. ? !）',
      ].filter(Boolean),
    };
  }

  // ================= 文法 =================
  function q_grammar(id, n) {
    const u = (window.GRAMMAR || {})[id];
    if (!u || !u.items[n]) return null;
    const it = u.items[n], title = window.GRAMMAR_TITLES[id] || '';
    if (it.type === 'mc') {
      const opts = shuffle(it.opts);
      return {
        kind: 'gmc', gid: id, gn: n, i: null, secs: secsFor('gmc'),
        prompt: { type: 'gmc', sentence: it.q, title: title },
        opts, a: opts.indexOf(it.opts[it.a]), why: it.why,
      };
    }
    return {
      kind: 'gfix', gid: id, gn: n, i: null, secs: secsFor('gfix'),
      prompt: { type: 'gfix', sentence: it.bad, title: title },
      accept: [it.answer], answer: it.answer, compare: 'sentence', why: it.why,
    };
  }

  // ================= 判分 =================
  function grade(q, given) {
    if (q.noGrade) return null;
    if (q.opts) return given === q.a;
    if (q.compare === 'sentence') return stripEnd(given) === stripEnd(q.answer);
    const g = norm(given).replace(/[.!?,;:]+$/, '');
    return (q.accept || [q.answer]).some(a => norm(a).replace(/[.!?,;:]+$/, '') === g);
  }

  // ================= 組卷 =================
  const RECOG = { e2c: q_e2c, c2e: q_c2e, listen: q_listen, spell: q_spell, form: q_form, confuse: q_confuse };

  /* 依熟練度給各題型權重：生疏時多考「看得懂」，熟了之後多考「寫得出」。
     權重是隨機抽樣用的，不是固定順序 — 每種題型都有機會出現。 */
  const WEIGHTS = [
    { e2c: 30, listen: 22, c2e: 20, confuse: 12, form: 10, spell: 6 },   // box 0：剛學或剛答錯
    { c2e: 26, confuse: 20, form: 18, listen: 14, spell: 12, e2c: 10 },  // box 1-2：認得了
    { spell: 30, form: 24, confuse: 18, c2e: 14, listen: 8, e2c: 6 },    // box 3+：要能產出
  ];

  /** 依權重隨機排序（Efraimidis–Spirakis）：排第一的機率正比於權重，
      但每個題型都有非零機率 — 不能像單純乘上抖動那樣讓低權重項永遠排不到前面。 */
  function weightedOrder(weights) {
    return Object.keys(weights)
      .map(k => [k, Math.pow(Math.random(), 1 / Math.max(weights[k], 1e-6))])
      .sort((a, b) => b[1] - a[1])
      .map(e => e[0]);
  }

  /** shift：難度偏移（+1 更常考「拼得出來」的題型，-1 更常考「認得出來」）。 */
  const kindOn = k => (window.Store && window.Store.kindOn) ? window.Store.kindOn(k) : true;

  /* 有例句的字才生得出「句子類」題目（克漏字／重組／中譯英）。
     這是這個專案的重點之一 —— 不只認得字，還要看得懂、寫得出句子。
     所以只要那個字有例句，就有相當高的機率直接出句子題，而不是四選一。 */
  const hasSent = w => !!(window.SENTENCES || {})[w.w];
  const APPLY_GEN = { cloze: q_cloze, trans: q_trans, order: q_order };
  const APPLY_W = [
    { cloze: 60, trans: 30, order: 10 },   // box 0：剛學，先讀懂句子
    { cloze: 40, trans: 35, order: 25 },   // box 1-2
    { cloze: 25, trans: 30, order: 45 },   // box 3+：要能自己組出句子
  ];
  const cfg = () => (window.Store && window.Store.settings) || {};
  /** 句子題比重（設定頁可調，60 = 預設）。 */
  const sentRate = () => (cfg().sentRate == null ? 60 : cfg().sentRate);
  /** 這個熟練度下，有例句的字出「句子題」的機率。 */
  function applyChance(b) {
    const base = b <= 0 ? 0.25 : b <= 2 ? 0.5 : 0.7;
    return Math.max(0, Math.min(0.95, base * (sentRate() / 60)));
  }

  function tierOf(b, sh) {
    return Math.max(0, Math.min(WEIGHTS.length - 1, (b <= 0 ? 0 : b <= 2 ? 1 : 2) + (sh || 0)));
  }

  function forWord(w, boxHint, shift) {
    const b = boxHint == null ? ((window.Store.load().words[w.i] || {}).b || 0) : boxHint;
    const sh = shift == null ? (window.Store.diff ? window.Store.diff().tierShift : 0) : shift;
    const tier = tierOf(b, sh);
    // 先賭句子題：這個字有例句就有機會直接考句子
    if (hasSent(w) && Math.random() < applyChance(b)) {
      for (const k of weightedOrder(APPLY_W[tier])) {
        if (!kindOn(k)) continue;
        const q = APPLY_GEN[k](w);
        if (q) return q;
      }
    }
    for (const k of weightedOrder(WEIGHTS[tier])) {
      if (!kindOn(k)) continue;                    // 使用者關掉的題型不出
      const q = RECOG[k](w);
      if (q) return q;
    }
    // 全部關掉或都生不出來時，至少還要有題目
    for (const k of weightedOrder(WEIGHTS[tier])) { const q = RECOG[k](w); if (q) return q; }
    return q_e2c(w) || q_c2e(w);
  }

  /** 依「錯題權重」加權抽樣（Efraimidis–Spirakis）：錯過的字更容易被抽到，
      但沒錯過的字仍然有機會 —— 不能讓錯題把整份考卷吃光。 */
  function byErrWeight(ids) {
    const W = (window.Store && window.Store.errWeight) ? window.Store.errWeight : () => 1;
    return ids
      .map(i => [i, Math.pow(Math.random(), 1 / Math.max(W(i), 1e-6))])
      .sort((a, b) => b[1] - a[1])
      .map(e => e[0]);
  }

  function reviewSet(ids, shift) {
    const out = [];
    // 同一份複習卷裡，錯題排前面（先練最弱的，體力最好的時候）
    byErrWeight(ids).forEach(i => { const q = forWord(V()[i], null, shift); if (q) out.push(q); });
    return out;
  }

  /** 新字檢核：每個新字一題（偏易），順序打散 */
  function newCheckSet(ids) {
    const out = [];
    ids.forEach(i => {
      const w = V()[i];
      const q = q_e2c(w) || q_c2e(w) || q_listen(w);
      if (q) out.push(q);
    });
    return shuffle(out);
  }

  /** 運用關：優先用「今天／最近學過且有例句」的字，不足就用任何有例句的字 */
  function applySet(n, preferIds) {
    const S = window.SENTENCES || {}, byW = new Map(V().map(w => [w.w, w]));
    const has = Object.keys(S).map(k => byW.get(k)).filter(Boolean);
    const prefer = new Set(preferIds || []);
    const pool = shuffle(has).sort((a, b) => (prefer.has(b.i) ? 1 : 0) - (prefer.has(a.i) ? 1 : 0));
    const gens = [q_cloze, q_order, q_trans].filter((g, k) => kindOn(['cloze', 'order', 'trans'][k]));
    if (!gens.length) return [];
    const out = [];
    for (const w of pool) {
      if (out.length >= n) break;
      const g = gens[out.length % gens.length];
      const q = g(w) || q_cloze(w) || q_trans(w) || q_order(w);
      if (q) out.push(q);
    }
    if (out.length && n >= 3 && kindOn('free')) {
      const fw = pool.find(w => !out.some(q => q.i === w.i)) || pool[0];
      if (fw) out.splice(Math.min(out.length, 2), 0, q_free(fw));   // 每關插入一題自由造句
    }
    return out.slice(0, n + 1);
  }

  /** 文法關：挑一個還沒精熟的文法點，出它剩下的題 */
  function grammarSet(n) {
    const st = window.Store.load(), done = {};
    for (const d in st.days) (st.days[d].gram || []).forEach(g => {
      if (g.ok && g.attempt === 1) (done[g.id] = done[g.id] || new Set()).add(g.n);
    });
    const ids = Object.keys(window.GRAMMAR || {});
    let target = ids.find(id => (done[id] || new Set()).size < window.GRAMMAR[id].items.length) || pick(ids);
    const doneSet = done[target] || new Set();
    const idxs = window.GRAMMAR[target].items.map((_, k) => k).filter(k => !doneSet.has(k));
    const use = (idxs.length ? idxs : window.GRAMMAR[target].items.map((_, k) => k)).slice(0, n);
    return { gid: target, questions: use.map(k => q_grammar(target, k)).filter(Boolean) };
  }

  /** 定位測驗：每級抽 n 題，取該級常見字（fq 小＝常見） */
  function placementSet(perLevel) {
    const out = [];
    for (let lv = 1; lv <= 6; lv++) {
      const pool = V().filter(w => w.lv === lv && w.tr && w.fq).sort((a, b) => a.fq - b.fq).slice(0, 220);
      shuffle(pool).slice(0, perLevel).forEach(w => {
        const q = q_e2c(w);
        if (q) { q.lv = lv; q.secs = Math.round(secsFor(q.kind) * 1.5); out.push(q); }
      });
    }
    return shuffle(out);
  }

  /* 有例句的字只有 150 個，字首分佈很不平均（H/J/K/Q/U/Y/Z 是 0）。
     所以「這一關的字剛好都沒例句」是常態，必須有 fallback。
     排序：0 = 這一關抽到的字、1 = 同一個字首（跨級也行，還是同一個字母關的感覺）、
           2 = 同一級的其他字首、3 = 其他。
     rank ≥ 2 的會被標成「延伸句型」，而且一關最多只放一題 —— 不然 D 關會冒出一堆 E、M。 */
  function sentRank(w, prefer, lv, letter) {
    if (prefer.has(w.i)) return 0;
    if (letter && w.w[0].toUpperCase() === String(letter).toUpperCase()) return 1;
    if (lv && w.lv === lv) return 2;
    return 3;
  }
  function sentPool(preferIds, lv, letter) {
    const SEN = window.SENTENCES || {}, byW = new Map(V().map(w => [w.w, w]));
    const pool = Object.keys(SEN).map(k => byW.get(k)).filter(Boolean);
    const prefer = new Set(preferIds || []);
    return shuffle(pool)
      .map(w => [w, sentRank(w, prefer, lv, letter)])
      .sort((a, b) => a[1] - b[1])
      .map(e => e[0]);
  }

  /** 只抽句子運用題（不塞自由造句）。maxOutside：最多幾題可以不屬於這一關（預設 1）。 */
  function applyPick(n, preferIds, lv, letter, maxOutside) {
    if (n <= 0) return [];
    const SEN = window.SENTENCES || {}, prefer = new Set(preferIds || []);
    const cap = maxOutside == null ? 1 : maxOutside;
    const ordered = sentPool(preferIds, lv, letter);
    const gens = ['cloze', 'trans', 'order'].filter(kindOn);
    if (!gens.length) return [];
    const out = [];
    let outside = 0;
    for (const w of ordered) {
      if (out.length >= n) break;
      const rank = sentRank(w, prefer, lv, letter);
      if (rank >= 2) {
        if (outside >= cap) continue;                // 延伸題有上限，寧可少出也不亂跑字母
      }
      const k = gens[out.length % gens.length];
      const q = APPLY_GEN[k](w) || q_cloze(w) || q_trans(w) || q_order(w);
      if (!q) continue;
      if (rank >= 2) { q.outside = true; outside++; }
      out.push(q);
    }
    return out;
  }

  /* 文法題也要「跟著關卡走」：
     1. 這一關的字如果有例句、而那個例句掛了文法點（sentences.js 的 gp），就直接考那個文法點
        —— 學生剛剛才看過那個句子，文法點是活的，不是憑空跳出來的。
     2. 沒有的話按級別對應文法藍圖的階段（1–2 級 → 第一階，3–4 → 第二階，依此類推），
        取那一階裡已備好題目的單元。
     3. 都對不上才退回「下一個還沒精熟的單元」。 */
  function bandForLevel(lv) {
    const road = window.GRAMMAR_ROADMAP || [];
    const stage = lv <= 2 ? 1 : lv <= 4 ? 2 : lv <= 5 ? 3 : 4;
    const hit = road.find(r => r.stage === stage);
    return hit ? hit.ids : [];
  }
  function grammarForStage(n, ids, lv) {
    if (n <= 0) return [];
    const SEN = window.SENTENCES || {}, G = window.GRAMMAR || {};
    const authored = id => !!G[id];
    // 1. 這一關的字連到的文法點
    const linked = [];
    (ids || []).forEach(i => {
      const s = SEN[V()[i].w];
      if (s && s.gp && authored(s.gp) && !linked.includes(s.gp)) linked.push({ id: s.gp, via: V()[i].w });
    });
    // 2. 級別對應的藍圖階段
    const band = bandForLevel(lv).filter(authored).map(id => ({ id, via: null }));
    const order = shuffle(linked).concat(shuffle(band));
    const st = window.Store.load(), done = {};
    for (const d in st.days) (st.days[d].gram || []).forEach(g => {
      if (g.ok && g.attempt === 1) (done[g.id] = done[g.id] || new Set()).add(g.n);
    });
    const out = [];
    for (const cand of order) {
      if (out.length >= n) break;
      const items = G[cand.id].items;
      const doneSet = done[cand.id] || new Set();
      const idxs = items.map((_, k) => k).filter(k => !doneSet.has(k));
      const use = (idxs.length ? shuffle(idxs) : shuffle(items.map((_, k) => k)));
      for (const k of use) {
        if (out.length >= n) break;
        const q = q_grammar(cand.id, k);
        if (!q) continue;
        if (out.some(x => x.gid === q.gid && x.gn === q.gn)) continue;
        if (cand.via) q.via = cand.via;                  // 顯示「這一關的 xxx 就是這個文法點」
        out.push(q);
      }
    }
    // 3. 退回原本的「下一個沒精熟的單元」
    if (out.length < n) {
      grammarSet(n - out.length).questions.forEach(q => {
        if (q && !out.some(x => x.gid === q.gid && x.gn === q.gn)) out.push(q);
      });
    }
    return out.slice(0, n);
  }

  /** 把插入題平均散在整份考卷裡（不要全部擠在最後）。 */
  function spread(base, extras) {
    if (!extras.length) return base;
    const out = base.slice();
    const gap = Math.max(1, Math.floor(out.length / (extras.length + 1)));
    extras.forEach((q, k) => {
      const at = Math.min(out.length, gap * (k + 1) + k);
      out.splice(at, 0, q);
    });
    return out;
  }

  /** 闖關地圖的一關：從該 (級別, 字首) 的字裡挑字，並保留「句子運用」與「文法」的固定名額。
      還沒練熟的優先，其中「錯過的字」再加權 —— 錯題會比沒錯過的字更常被抽到。 */
  function stageSet(lv, letter, n, shift) {
    const ids = window.Store.bucket(lv, letter);
    if (!ids.length) return [];
    const st = window.Store.load(), c = cfg();
    // 名額：句子題與文法題按比例保留，總題數不變
    const gramSlots = Math.min(c.gramPerStage == null ? 1 : c.gramPerStage, Math.floor(n / 6));
    const applySlots = Math.min(c.applyPerStage == null ? 2 : c.applyPerStage, Math.floor(n / 4));
    const wordN = Math.max(1, n - gramSlots - applySlots);
    const weak = [], strong = [];
    ids.forEach(i => ((st.words[i] && st.words[i].b >= 3) ? strong : weak).push(i));
    const ordered = byErrWeight(weak).concat(byErrWeight(strong));
    const pick_ = ordered.slice(0, wordN);
    const base = pick_.map(i => forWord(V()[i], null, shift)).filter(Boolean);

    const extras = [];
    if (applySlots > 0) {
      // 名額 ≥2 時，一半機率把其中一題換成自由造句（我要批改的材料）
      const freeOne = applySlots >= 2 && kindOn('free') && Math.random() < 0.5;
      extras.push(...applyPick(applySlots - (freeOne ? 1 : 0), pick_, lv, letter, 1));
      if (freeOne) {
        /* 自由造句只用「這一關的字」或「同字首的字」——
           絕不為了硬塞一題造句而把別的字母拉進來（那就是 D 關冒出 E、M 的原因）。
           兩者都沒有就不出自由造句，名額改考本關的單字。 */
        const prefer = new Set(pick_);
        const fw = sentPool(pick_, lv, letter).find(w => sentRank(w, prefer, lv, letter) <= 1);
        const fq = fw ? q_free(fw) : null;
        if (fq) extras.push(fq);
      }
    }
    if (gramSlots > 0) extras.push(...grammarForStage(gramSlots, pick_, lv));
    // 句子名額沒填滿（這一關與同字首都沒例句可用）→ 補這一關自己的單字題，
    // 寧可多考本關的字，也不要拉一堆別的字母進來。
    const need = n - base.length - extras.length;
    if (need > 0) {
      ordered.slice(wordN, wordN + need).forEach(i => {
        const q = forWord(V()[i], null, shift);
        if (q) base.push(q);
      });
    }
    return spread(base, extras);
  }

  /** 訂正關：只重練剛才答錯的字，不扣血、不計失敗。 */
  function fixSet(ids, shift) {
    return byErrWeight(ids).map(i => forWord(V()[i], null, shift)).filter(Boolean);
  }

  /** 錯題加強關：從錯題本抽 n 個字，錯得越兇的越前面。 */
  function wrongSet(n, shift) {
    const pool = window.Store.wrongPool(Math.max(n * 3, n));
    if (!pool.length) return [];
    return byErrWeight(pool.map(x => x.i)).slice(0, n)
      .map(i => forWord(V()[i], null, shift)).filter(Boolean);
  }

  /** 自由範圍練習 */
  function customSet(n, filter, shift) {
    const pool = V().filter(filter);
    return byErrWeight(pool.map(w => w.i)).slice(0, n)
      .map(i => forWord(V()[i], null, shift)).filter(Boolean);
  }

  window.Quiz = {
    base, expanded, acceptable, distractors, grade, checkFree,
    forWord, reviewSet, newCheckSet, applySet, grammarSet, placementSet, customSet,
    stageSet, fixSet, wrongSet, byErrWeight, applyPick, hasSent, applyChance,
    grammarForStage, bandForLevel, sentPool,
    q_free, q_grammar, plainSent, FORM_LABEL, shuffle,
    LIMITS, secsFor,
    gen: RECOG,                       // 單一題型生成器（測試與除錯用）
    apply: { cloze: q_cloze, order: q_order, trans: q_trans, free: q_free },
  };
})();
