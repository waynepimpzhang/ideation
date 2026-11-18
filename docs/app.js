(() => {
  'use strict';

  const GROUPS = [
    { key: 'industry', label: '產業', param: 'industry' },
    { key: 'form', label: '形式', param: 'form' },
    { key: 'patterns', label: '手法', param: 'pattern' },
    { key: 'spec', label: '規格', param: 'spec' },
    { key: 'tone', label: '調性', param: 'tone' },
    { key: 'ai', label: 'AI 可行性', param: 'ai' },
  ];
  const AI_ORDER = ['高', '中高', '中', '低'];
  const AI_LEVEL = { '低': 1, '中': 2, '中高': 3, '高': 4 };
  const COLLAPSE_AT = 8;

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hasGsap = typeof window.gsap !== 'undefined';
  if (hasGsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  let DATA = null;
  let cards = [];
  const state = { q: '', sel: Object.fromEntries(GROUPS.map(g => [g.key, new Set()])), card: null };
  const expanded = new Set();
  const chipEls = {}; // key -> Map(value -> button)

  /* ---------- helpers ---------- */
  const valuesOf = (c, key) => {
    if (key === 'ai') return c.ai_feasibility ? [c.ai_feasibility] : [];
    const f = c.facets && c.facets[key];
    if (Array.isArray(f)) return f;
    if (key === 'patterns' && Array.isArray(c.patterns)) return c.patterns;
    return [];
  };
  const hay = c => (c.title + '\n' + (c.body_md || '') + '\n' + (c.product || '') + '\n' + (c.case || '')).toLowerCase();
  const hashOf = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) | 0; return Math.abs(h); };

  function matches(c, skip) {
    if (state.q && !c._hay.includes(state.q.toLowerCase())) return false;
    for (const g of GROUPS) {
      if (g.key === skip) continue;
      const sel = state.sel[g.key];
      if (!sel.size) continue;
      if (!valuesOf(c, g.key).some(v => sel.has(v))) return false;
    }
    return true;
  }
  const activeCount = () => GROUPS.reduce((n, g) => n + state.sel[g.key].size, 0) + (state.q ? 1 : 0);

  /* ---------- hash state ---------- */
  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    state.q = p.get('q') || '';
    for (const g of GROUPS) {
      const raw = p.get(g.param);
      state.sel[g.key] = new Set(raw ? raw.split(',').filter(Boolean) : []);
    }
    state.card = p.get('card') || null;
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    for (const g of GROUPS) if (state.sel[g.key].size) p.set(g.param, [...state.sel[g.key]].join(','));
    if (state.card) p.set('card', state.card);
    const s = p.toString();
    const url = location.pathname + location.search + (s ? '#' + s : '');
    history.replaceState(null, '', url);
  }

  /* ---------- markdown (small, safe) ---------- */
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const safeUrl = u => /^(https?:\/\/|\/|\.\/|\.\.\/|#|mailto:)/i.test(u);

  function inline(raw) {
    const stash = [];
    const hold = html => { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000'; };
    let s = raw;
    s = s.replace(/`([^`]+)`/g, (_, c) => hold('<code>' + esc(c) + '</code>'));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
      if (!safeUrl(u)) return m;
      const ext = /^https?:/i.test(u);
      return hold('<a href="' + esc(u) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + esc(t) + '</a>');
    });
    s = s.replace(/https?:\/\/[^\s<>()（）「」]+[^\s<>()（）「」.,;:!?，。；：！？、]/g, u =>
      hold('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + '</a>'));
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  }

  const splitRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');

  function markdown(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    const startsBlock = l => /^\s*$/.test(l) || /^#{1,6}\s/.test(l) || /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*>/.test(l) || /^\s*\|/.test(l) || /^\s*(-{3,}|\*{3,})\s*$/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        const lvl = Math.min(6, m[1].length + 2);
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`); i++; continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const head = splitRow(line); i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        out.push('<div class="tw"><table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>'); continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        // nested lists by indentation
        const stack = []; // {indent, tag}
        let html = '';
        while (i < lines.length && (m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
          const indent = m[1].replace(/\t/g, '  ').length;
          const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
          while (stack.length && indent < stack[stack.length - 1].indent) { html += '</li></' + stack.pop().tag + '>'; }
          if (!stack.length || indent > stack[stack.length - 1].indent) {
            html += '<' + tag + '>'; stack.push({ indent, tag });
          } else html += '</li>';
          html += '<li>' + inline(m[3]);
          i++;
        }
        while (stack.length) html += '</li></' + stack.pop().tag + '>';
        out.push(html); continue;
      }
      const buf = [];
      while (i < lines.length && (buf.length === 0 || !startsBlock(lines[i]))) { buf.push(lines[i]); i++; }
      out.push('<p>' + buf.map(inline).join('<br>') + '</p>');
    }
    return out.join('\n');
  }

  /* ---------- filters ---------- */
  function buildFilters() {
    const host = $('#filter-groups');
    host.replaceChildren();
    for (const g of GROUPS) {
      const totals = new Map();
      for (const c of cards) for (const v of valuesOf(c, g.key)) totals.set(v, (totals.get(v) || 0) + 1);
      if (!totals.size) { chipEls[g.key] = new Map(); continue; }
      let vals = [...totals.keys()];
      if (g.key === 'ai') vals.sort((a, b) => AI_ORDER.indexOf(a) - AI_ORDER.indexOf(b));
      else vals.sort((a, b) => totals.get(b) - totals.get(a) || a.localeCompare(b, 'zh-Hant'));
      const map = new Map();
      const chips = el('div', { class: 'chips', id: 'chips-' + g.key });
      vals.forEach((v, idx) => {
        const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-g': g.key, 'data-v': v },
          el('span', { text: v }), el('span', { class: 'n', text: '0' }));
        b.addEventListener('click', () => toggle(g.key, v));
        b.dataset.idx = idx;
        map.set(v, b); chips.append(b);
      });
      chipEls[g.key] = map;
      const fs = el('fieldset', { class: 'fgroup' }, el('legend', { text: g.label }), chips);
      if (vals.length > COLLAPSE_AT) {
        const more = el('button', { type: 'button', class: 'link more', 'data-more': g.key, 'aria-expanded': 'false' });
        more.addEventListener('click', () => { expanded.has(g.key) ? expanded.delete(g.key) : expanded.add(g.key); updateFilters(); });
        fs.append(more);
      }
      host.append(fs);
    }
  }

  function updateFilters() {
    for (const g of GROUPS) {
      const map = chipEls[g.key];
      if (!map || !map.size) continue;
      const counts = new Map();
      for (const c of cards) if (matches(c, g.key)) for (const v of valuesOf(c, g.key)) counts.set(v, (counts.get(v) || 0) + 1);
      const chips = [...map.values()];
      const hiddenSelected = chips.some(b => +b.dataset.idx >= COLLAPSE_AT && state.sel[g.key].has(b.dataset.v));
      const open = expanded.has(g.key) || hiddenSelected;
      for (const [v, b] of map) {
        const n = counts.get(v) || 0;
        const on = state.sel[g.key].has(v);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('zero', n === 0);
        b.lastChild.textContent = n;
        b.hidden = !open && +b.dataset.idx >= COLLAPSE_AT;
      }
      const more = $(`[data-more="${g.key}"]`);
      if (more) {
        more.textContent = open ? '收合' : `顯示全部 ${chips.length} 項`;
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    }
    const n = activeCount();
    $('#clear-all').hidden = n === 0;
    $('#filter-count').textContent = n ? String(n) : '';
  }

  function toggle(key, v) {
    const s = state.sel[key];
    s.has(v) ? s.delete(v) : s.add(v);
    refresh();
  }
  function clearAll() {
    for (const g of GROUPS) state.sel[g.key].clear();
    state.q = ''; $('#q').value = '';
    refresh();
  }

  /* ---------- grid ---------- */
  let triggers = [];
  function renderCard(c) {
    const tilt = (((hashOf(c.slug) % 7) - 3) * 0.3).toFixed(2) + 'deg';
    const lvl = AI_LEVEL[c.ai_feasibility] || 0;
    const tags = [
      ...valuesOf(c, 'form').slice(0, 2).map(v => el('span', { class: 'tag form', text: v })),
      ...valuesOf(c, 'patterns').map(v => el('span', { class: 'tag', text: v })),
    ];
    const art = el('article', { class: 'card', style: `--tilt:${tilt}`, 'data-slug': c.slug },
      el('div', { class: 'row' }, el('span', { text: valuesOf(c, 'industry').join('・') || '—' }), el('span', { text: c.date || '' })),
      el('h3', {}, el('button', { type: 'button', class: 'card-open', text: c.title, 'aria-haspopup': 'dialog' })),
      c.one_liner ? el('p', { class: 'one' }, el('mark', { text: c.one_liner })) : null,
      tags.length ? el('div', { class: 'tags' }, tags) : null,
      el('div', { class: 'foot-row' },
        el('span', { text: valuesOf(c, 'spec').join('・') }),
        c.ai_feasibility ? el('span', { class: 'ai', title: 'AI 可行性：' + c.ai_feasibility },
          el('span', { text: 'AI ' + c.ai_feasibility }),
          el('span', { class: 'dots', 'aria-hidden': 'true' }, [1, 2, 3, 4].map(k => el('i', { class: k <= lvl ? 'on' : '' })))) : null));
    art.querySelector('.card-open').addEventListener('click', () => openCard(c.slug));
    return art;
  }

  function renderGrid(animate) {
    const grid = $('#grid');
    triggers.forEach(t => t.kill()); triggers = [];
    const list = cards.filter(c => matches(c));
    grid.replaceChildren(...list.map(renderCard));
    grid.setAttribute('aria-busy', 'false');
    $('#empty').hidden = list.length > 0;
    $('#count').textContent = `顯示 ${list.length} / ${cards.length} 張`;
    if (hasGsap && !reduceMotion.matches && list.length) {
      const items = grid.querySelectorAll('.card');
      gsap.set(items, { autoAlpha: 0, y: 16 });
      if (window.ScrollTrigger) {
        triggers.push(...ScrollTrigger.batch(items, {
          start: 'top 92%', once: true,
          onEnter: b => gsap.to(b, { autoAlpha: 1, y: 0, duration: .45, ease: 'power2.out', stagger: .05, overwrite: true }),
        }));
        ScrollTrigger.refresh();
      } else gsap.to(items, { autoAlpha: 1, y: 0, duration: .45, stagger: .04 });
    }
  }

  function refresh() {
    updateFilters(); renderGrid(); renderPatternCounts(); writeHash();
  }

  /* ---------- patterns ---------- */
  let patList = [];
  function buildPatterns() {
    const known = new Map((DATA.patterns || []).map(p => [p.name, p]));
    const used = new Set(); cards.forEach(c => valuesOf(c, 'patterns').forEach(v => used.add(v)));
    patList = [...(DATA.patterns || [])];
    for (const u of used) if (!known.has(u)) patList.push({ name: u, structure: '', tone: '', apply_to: '' });
    const host = $('#plist'); host.replaceChildren();
    for (const p of patList) {
      const row = (k, v) => v ? [el('dt', { text: k }), el('dd', { text: v })] : [];
      const btn = el('button', { type: 'button', class: 'btn', 'data-pat': p.name });
      btn.addEventListener('click', () => {
        for (const g of GROUPS) state.sel[g.key].clear();
        state.q = ''; $('#q').value = '';
        state.sel.patterns.add(p.name);
        refresh();
        $('#cases').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      });
      host.append(el('article', { class: 'pat' },
        el('h3', { text: p.name }),
        el('dl', {}, row('結構', p.structure), row('調性', p.tone), row('可套用', p.apply_to)),
        btn));
    }
  }
  function renderPatternCounts() {
    for (const p of patList) {
      const n = cards.filter(c => valuesOf(c, 'patterns').includes(p.name)).length;
      const b = $(`[data-pat="${CSS.escape(p.name)}"]`);
      if (!b) continue;
      b.textContent = n ? `${n} 張案例用到` : '尚無案例';
      b.disabled = n === 0;
    }
  }

  /* ---------- detail dialog ---------- */
  const dlg = $('#dlg');
  let lastFocus = null;
  function openCard(slug, fromHash) {
    const c = cards.find(x => x.slug === slug);
    if (!c) return;
    lastFocus = document.activeElement;
    state.card = slug;
    const body = c.body_md.replace(/^\s*#\s+.*\n?/, '');
    const facts = [['產品', c.product], ['切角', c.angle], ['TA', c.ta], ['狀態', c.status]].filter(f => f[1]);
    const host = $('#dlg-body');
    host.replaceChildren(
      el('div', { class: 'd-meta' }, el('span', { text: valuesOf(c, 'industry').join('・') }), el('span', { text: c.date || '' }), el('span', { text: c.spec || '' })),
      el('h2', { id: 'dlg-title', text: c.title }),
      el('div', { class: 'd-tags' }, [
        ...valuesOf(c, 'form'), ...valuesOf(c, 'tone'), ...valuesOf(c, 'patterns').map(v => '#' + v),
        ...(c.ai_feasibility ? ['AI 可行性 ' + c.ai_feasibility] : []),
      ].map(t => el('span', { class: 'tag', text: t }))),
      facts.length ? el('dl', { class: 'facts' }, facts.flatMap(f => [el('dt', { text: f[0] }), el('dd', { text: f[1] })])) : null,
      el('div', { class: 'md', html: markdown(body) }),
      el('div', { class: 'd-foot' },
        el('span', { text: c.slug + '.md' }),
        /^https?:\/\//i.test(c.source || '') ? el('a', { class: 'src', href: c.source, target: '_blank', rel: 'noopener noreferrer', text: '看原始案例頁 ↗' }) : null));
    if (!dlg.open) dlg.showModal();
    $('#dlg-close').focus({ preventScroll: true });
    dlg.querySelector('.sheet').scrollTop = 0;
    requestAnimationFrame(() => { dlg.querySelector('.sheet').scrollTop = 0; });
    if (hasGsap && !reduceMotion.matches && !fromHash) {
      gsap.fromTo(dlg.querySelector('.sheet'), { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .25, ease: 'power2.out' });
    }
    writeHash();
  }
  function closeCard() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => {
    state.card = null; writeHash();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) closeCard(); });
  $('#dlg-close').addEventListener('click', closeCard);

  /* ---------- background ---------- */
  function initBackground() {
    if (!hasGsap) return;
    const drawables = document.querySelectorAll('#bg .d path, #bg .d rect');
    if (reduceMotion.matches) return;
    drawables.forEach(p => { p.style.strokeDasharray = '1'; });
    gsap.fromTo(drawables, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut', stagger: .08, delay: .2 });
    if (window.ScrollTrigger) {
      document.querySelectorAll('#bg .d').forEach(g => {
        gsap.to(g, { y: +g.dataset.speed || -50, ease: 'none',
          scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: .6 } });
      });
    }
    gsap.from('.hero h1, .hero .lede, .hero .meta', { y: 16, autoAlpha: 0, duration: .6, ease: 'power2.out', stagger: .08 });
  }

  /* ---------- init ---------- */
  async function init() {
    let res;
    try {
      res = await fetch('cards.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      DATA = await res.json();
    } catch (err) {
      $('#lede').textContent = '載入失敗，請稍後重試，或確認 cards.json 是否存在';
      $('#grid').setAttribute('aria-busy', 'false');
      console.error(err);
      return;
    }
    cards = (DATA.cards || []).map(c => Object.assign(c, { _hay: hay(c) }));
    $('#lede').textContent = `${cards.length} 張外部案例卡，每張拆成必講訊息、結構與可套用的手法。依產業、形式或手法篩選，挑出接得上的那幾張。`;
    $('#meta').innerHTML = `共 <b>${cards.length}</b> 張案例 · 最後更新：<b></b>`;
    $('#meta b:last-child').textContent = DATA.generated_at || '—';

    readHash();
    $('#q').value = state.q;
    buildFilters(); buildPatterns();
    refresh();
    initBackground();
    if (state.card) openCard(state.card, true);

    let t;
    $('#q').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = e.target.value.trim(); refresh(); }, 150);
    });
    $('#clear-all').addEventListener('click', clearAll);
    $('#empty-clear').addEventListener('click', clearAll);
    const ft = $('#filter-toggle');
    ft.addEventListener('click', () => {
      const open = $('#filters').classList.toggle('open');
      ft.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    window.addEventListener('hashchange', () => {
      const before = state.card;
      readHash(); $('#q').value = state.q;
      updateFilters(); renderGrid(); renderPatternCounts();
      if (state.card && state.card !== before) openCard(state.card, true);
      else if (!state.card && dlg.open) dlg.close();
    });
  }
  init();
})();
