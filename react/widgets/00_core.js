/*
  Общ API за интерактивните дема. Всеки widgets/*.js файл вика W.register(name, init);
  в markdown страницата демото се поставя с <div data-widget="name"></div>.
  init(el, dataset) получава празния контейнер и го пълни.
*/
window.W = (() => {
  const registry = Object.create(null);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'indeterminate', 'textContent']);

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function apply(el, attrs, isSvg) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (!isSvg && PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); apply(el, attrs, false); append(el, kids); return el; };
  const svg = (tag, attrs, ...kids) => { const el = document.createElementNS(SVG_NS, tag); apply(el, attrs, true); append(el, kids); return el; };

  const btn = (label, onClick, cls = '') => h('button', { type: 'button', class: 'w-btn ' + cls, onClick }, label);

  // Заглавна лента на демото; връща тялото, в което widget-ът рисува.
  function shell(el, { title, hint, real = false } = {}) {
    el.innerHTML = '';
    const head = h('div', { class: 'w-head' },
      h('span', { class: 'w-title' }, title || 'Демо'),
      real ? h('span', { class: 'w-chip c-info', title: 'Демото работи с истинската библиотека React 18, не със симулация' }, 'истински React') : null,
      hint ? h('span', { class: 'w-hint' }, hint) : null,
    );
    const body = h('div', { class: 'w-body' });
    el.append(head, body);
    return body;
  }

  // Стъпков плейър над масив от кадри. render(frame, index) се вика при всяка смяна.
  function stepper({ frames, render, interval = 1000 }) {
    let i = -1;
    let timer = null;
    const counter = h('span', { class: 'w-step' });
    const prev = btn('◀ Назад', () => go(i - 1));
    const next = btn('Напред ▶', () => go(i + 1), 'primary');
    const playBtn = btn('▶ Пусни', () => (timer ? pause() : play()));
    const reset = btn('↺ Отначало', () => { pause(); go(0); });
    const el = h('div', { class: 'w-toolbar' }, prev, next, playBtn, reset, counter);
    function go(n) {
      n = Math.max(0, Math.min(frames.length - 1, n));
      i = n;
      counter.textContent = `Стъпка ${i + 1} / ${frames.length}`;
      prev.disabled = i === 0;
      next.disabled = i === frames.length - 1;
      render(frames[i], i);
      if (i === frames.length - 1) pause();
    }
    function play() {
      if (i >= frames.length - 1) go(0);
      playBtn.textContent = '❚❚ Пауза';
      timer = setInterval(() => (i >= frames.length - 1 ? pause() : go(i + 1)), interval);
    }
    function pause() {
      if (timer) clearInterval(timer);
      timer = null;
      playBtn.textContent = '▶ Пусни';
    }
    function setFrames(f) { pause(); frames = f; go(0); }
    go(0);
    return { el, go, play, pause, setFrames, get index() { return i; }, get frames() { return frames; } };
  }

  function highlight(el) {
    if (typeof window.hljs === 'undefined') return;
    for (const c of el.querySelectorAll('pre.code code:not(.nohighlight):not(.hljs)')) {
      try { window.hljs.highlightElement(c); } catch (e) {}
    }
  }

  // Блок код с highlight.
  function code(text, lang = 'javascript', path) {
    const pre = h('pre', { class: 'code' }, h('code', { class: 'language-' + lang }, text));
    const wrap = h('div', { class: 'code-block' + (path ? ' has-path' : '') }, path ? h('div', { class: 'code-path' }, path) : null, pre);
    highlight(wrap);
    return wrap;
  }

  // Код по редове с възможност за маркиране на активен ред; всеки ред се оцветява отделно,
  // за да не се чупи markup-ът при токени, минаващи през няколко реда.
  function codeLines(text, lang = 'javascript') {
    const lines = text.replace(/\n$/, '').split('\n');
    const hl = (line) => {
      if (typeof window.hljs === 'undefined' || !line.trim()) return esc(line);
      try { return window.hljs.highlight(line, { language: lang, ignoreIllegals: true }).value; } catch (e) { return esc(line); }
    };
    const rows = lines.map((l, n) => h('span', { class: 'w-line', dataset: { n: String(n) }, html: `<span class="w-ln">${n + 1}</span><span class="w-lc hljs">${hl(l) || ' '}</span>` }));
    const pre = h('pre', { class: 'code w-code-lines' }, rows);
    return {
      el: pre,
      setActive(ns) {
        const set = new Set([].concat(ns == null ? [] : ns));
        rows.forEach((r, n) => r.classList.toggle('active', set.has(n)));
        const first = rows.find((r) => r.classList.contains('active'));
        if (first && pre.scrollHeight > pre.clientHeight) first.scrollIntoView({ block: 'nearest' });
      },
    };
  }

  // Лог панел (console, ред на извикване и т.н.).
  function log({ title, max = 400 } = {}) {
    const list = h('div', { class: 'w-log-list' });
    const el = h('div', { class: 'w-log' }, title ? h('div', { class: 'w-log-title' }, title) : null, list);
    let n = 0;
    return {
      el,
      add(text, cls = '') {
        const row = h('div', { class: 'w-log-row ' + cls }, h('span', { class: 'w-log-n' }, String(++n)), h('span', {}, text));
        list.append(row);
        while (list.children.length > max) list.firstChild.remove();
        list.scrollTop = list.scrollHeight;
        return row;
      },
      clear() { list.innerHTML = ''; n = 0; },
      get count() { return n; },
    };
  }

  // Бележките са статичен текст от самите дема, затова може да съдържат HTML.
  const note = (text) => h('div', { class: 'w-note', html: text });

  function busy(ms) {
    const end = performance.now() + ms;
    let x = 0;
    while (performance.now() < end) x = (x + 1) % 1000;
    return x;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Истински React: рендерира компонент в контейнера. React 18 UMD се зарежда в template.html.
  function react(container, Component, props) {
    if (typeof window.React === 'undefined' || typeof window.ReactDOM === 'undefined') {
      container.append(h('p', { class: 'w-missing' }, 'React не се зареди от CDN; демото изисква интернет.'));
      return null;
    }
    const root = window.ReactDOM.createRoot(container);
    root.render(window.React.createElement(Component, props));
    return root;
  }

  // Дърво в SVG: root = { id, label, children: [...] }. Връща svg елемент и методи за оцветяване и стрелки.
  // Състояния (setState): current, done, dirty, new, deleted, dim, purple, info или null.
  function tree(root, { nodeWidth = 96, nodeHeight = 32, colWidth = 112, rowHeight = 62, onClick, pad = 12 } = {}) {
    const nodes = [];
    let col = 0, depthMax = 0;
    (function layout(n, depth, parent, index) {
      n.depth = depth; n.parent = parent; n.index = index; n.children = n.children || [];
      depthMax = Math.max(depthMax, depth);
      if (!n.children.length) n.x = col++;
      else { n.children.forEach((c, i) => layout(c, depth + 1, n, i)); n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2; }
      nodes.push(n);
    })(root, 0, null, 0);
    const px = (n) => pad + n.x * colWidth + colWidth / 2;
    const py = (n) => pad + n.depth * rowHeight + nodeHeight / 2;
    const width = pad * 2 + col * colWidth, height = pad * 2 + depthMax * rowHeight + nodeHeight;
    const el = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'w-tree' });
    const mk = (id, color) => svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }));
    const uid = 'wt' + Math.random().toString(36).slice(2, 7);
    el.append(svg('defs', {}, mk(uid + '-accent', 'var(--accent)'), mk(uid + '-warn', 'var(--warn)'), mk(uid + '-bad', 'var(--bad)'), mk(uid + '-info', 'var(--info)'), mk(uid + '-ok', 'var(--ok)'), mk(uid + '-purple', 'var(--purple)'), mk(uid + '-muted', 'var(--muted)')));
    const edges = svg('g', { class: 'w-tree-edges' });
    const arrows = svg('g', { class: 'w-tree-arrows' });
    const g = svg('g');
    el.append(edges, arrows, g);
    const byId = {};
    const groups = {};
    for (const n of nodes) {
      byId[n.id] = n;
      for (const c of n.children) edges.append(svg('path', { d: `M${px(n)},${py(n) + nodeHeight / 2} C${px(n)},${py(c) - 22} ${px(c)},${py(n) + 34} ${px(c)},${py(c) - nodeHeight / 2}` }));
    }
    for (const n of nodes) {
      const node = svg('g', { class: 'w-tnode', dataset: { id: n.id }, onClick: onClick ? () => onClick(n) : null, style: onClick ? { cursor: 'pointer' } : null });
      node.append(
        svg('rect', { x: px(n) - nodeWidth / 2, y: py(n) - nodeHeight / 2, width: nodeWidth, height: nodeHeight, rx: 8 }),
        svg('text', { x: px(n), y: py(n) + 4.5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, 'font-family': 'var(--mono)' }, n.label),
        svg('text', { class: 'w-tbadge', x: px(n) + nodeWidth / 2 - 4, y: py(n) - nodeHeight / 2 + 4, 'text-anchor': 'end', 'font-size': 10, 'font-weight': 700, 'font-family': 'var(--mono)' }),
      );
      g.append(node);
      groups[n.id] = node;
    }
    const api = {
      el, nodes, byId, px, py, width, height,
      setState(id, state) { const n = groups[id]; if (!n) return; if (state) n.dataset.state = state; else delete n.dataset.state; },
      clearStates() { for (const n of Object.values(groups)) delete n.dataset.state; },
      setLabel(id, label) { groups[id].querySelector('text').textContent = label; },
      setBadge(id, text) { groups[id].querySelector('.w-tbadge').textContent = text || ''; },
      clearBadges() { for (const n of Object.values(groups)) n.querySelector('.w-tbadge').textContent = ''; },
      // Стрелка между два възела за указатели; color: accent, warn, bad, info, ok, purple, muted.
      arrow(fromId, toId, color = 'accent', dash) {
        const a = byId[fromId], b = byId[toId];
        if (!a || !b) return;
        const x1 = px(a), y1 = py(a), x2 = px(b), y2 = py(b);
        const dx = x2 - x1, dy = y2 - y1;
        const side = Math.abs(dx) > Math.abs(dy) * 2;
        const sx = side ? Math.sign(dx) * nodeWidth / 2 : 0;
        const sy = side ? 0 : Math.sign(dy) * nodeHeight / 2;
        const d = side ? `M${x1 + sx},${y1} C${x1 + sx + dx / 3},${y1 - 22} ${x2 - sx - dx / 3},${y2 - 22} ${x2 - sx},${y2}` : `M${x1},${y1 + sy} C${x1},${y1 + dy / 2} ${x2},${y2 - dy / 2} ${x2},${y2 - sy}`;
        arrows.append(svg('path', { d, stroke: `var(--${color})`, 'stroke-dasharray': dash || null, 'marker-end': `url(#${uid}-${color})` }));
      },
      clearArrows() { arrows.innerHTML = ''; },
    };
    return api;
  }

  function mount(root) {
    for (const el of root.querySelectorAll('[data-widget]')) {
      if (el.dataset.mounted) continue;
      el.dataset.mounted = '1';
      el.classList.add('w');
      const name = el.dataset.widget;
      const init = registry[name];
      if (!init) { el.innerHTML = `<p class="w-missing">Липсва демо "${esc(name)}".</p>`; continue; }
      try { init(el, el.dataset); } catch (err) {
        console.error('[widget]', name, err);
        el.innerHTML = `<p class="w-missing">Грешка в демото "${esc(name)}": ${esc(err && err.message)}</p>`;
      }
    }
  }

  const register = (name, init) => { registry[name] = init; };

  return { register, mount, h, svg, btn, shell, stepper, code, codeLines, highlight, log, note, busy, sleep, react, esc, tree };
})();
