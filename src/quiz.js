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

  function forWord(w, boxHint, shift) {
    const b = boxHint == null ? ((window.Store.load().words[w.i] || {}).b || 0) : boxHint;
    const sh = shift == null ? (window.Store.diff ? window.Store.diff().tierShift : 0) : shift;
    const tier = Math.max(0, Math.min(WEIGHTS.length - 1, (b <= 0 ? 0 : b <= 2 ? 1 : 2) + sh));
    for (const k of weightedOrder(WEIGHTS[tier])) {
      if (!kindOn(k)) continue;                    // 使用者關掉的題型不出
      const q = RECOG[k](w);
      if (q) return q;
    }
    // 全部關掉或都生不出來時，至少還要有題目
    for (const k of weightedOrder(WEIGHTS[tier])) { const q = RECOG[k](w); if (q) return q; }
    return q_e2c(w) || q_c2e(w);
  }

  function reviewSet(ids, shift) {
    const out = [];
    ids.forEach(i => { const q = forWord(V()[i], null, shift); if (q) out.push(q); });
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

  /** 闖關地圖的一關：從該 (級別, 字首) 的字裡挑 n 個，還沒學會的優先。 */
  function stageSet(lv, letter, n, shift) {
    const ids = window.Store.bucket(lv, letter);
    if (!ids.length) return [];
    const st = window.Store.load();
    const weak = [], strong = [];
    ids.forEach(i => ((st.words[i] && st.words[i].b >= 3) ? strong : weak).push(i));
    const pick_ = shuffle(weak).concat(shuffle(strong)).slice(0, n);
    return pick_.map(i => forWord(V()[i], null, shift)).filter(Boolean);
  }

  /** 訂正關：只重練剛才答錯的字，不扣血、不計失敗。 */
  function fixSet(ids, shift) {
    return shuffle(ids).map(i => forWord(V()[i], null, shift)).filter(Boolean);
  }

  /** 自由範圍練習 */
  function customSet(n, filter, shift) {
    const pool = V().filter(filter);
    return shuffle(pool).slice(0, n).map(w => forWord(w, null, shift)).filter(Boolean);
  }

  window.Quiz = {
    base, expanded, acceptable, distractors, grade, checkFree,
    forWord, reviewSet, newCheckSet, applySet, grammarSet, placementSet, customSet,
    stageSet, fixSet,
    q_free, q_grammar, plainSent, FORM_LABEL, shuffle,
    LIMITS, secsFor,
    gen: RECOG,                       // 單一題型生成器（測試與除錯用）
    apply: { cloze: q_cloze, order: q_order, trans: q_trans, free: q_free },
  };
})();
