/* Интерактивен модел на React DevTools Profiler: commit-ове, flamegraph, ranked и "защо се рендерира". */
W.register('profiler-flame', (el) => {
  const { h, svg, shell, note } = W;
  const body = shell(el, { title: 'React DevTools Profiler (модел)', hint: 'Избери commit отгоре, превключи Flamegraph / Ranked, кликни компонент за "Why did this render?".' });

  const TREE = { n: 'App', c: [
    { n: 'Header', c: [] },
    { n: 'Dashboard', c: [
      { n: 'Chart', c: [] },
      { n: 'Table', c: [{ n: 'Row 1', c: [] }, { n: 'Row 2', c: [] }, { n: 'Row 3', c: [] }, { n: 'Row 4', c: [] }, { n: 'Row 5', c: [] }] },
    ] },
    { n: 'Sidebar', c: [] },
  ] };
  const BASE = { App: 1, Header: 1, Dashboard: 2, Chart: 30, Table: 1, 'Row 1': 1, 'Row 2': 1, 'Row 3': 1, 'Row 4': 1, 'Row 5': 1, Sidebar: 2 };
  const rows = (ms, why) => Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`Row ${i}`, { ms, why }]));
  const all = (why) => Object.fromEntries(Object.keys(BASE).map((k) => [k, { ms: BASE[k], why }]));
  const COMMITS = [
    { label: 'Mount', desc: 'Първи рендер на приложението. Всички компоненти се рендерират за първи път, Chart е най-скъпият с 30 ms.', d: all(['Първи рендер (mount)']) },
    { label: 'Писане в търсачката', desc: 'Потребителят пише буква в Header. setState живее в App, значи App се рендерира, а с него и всяко дете, което не е мемоизирано. Chart плаща 29 ms за всяка буква, въпреки че props му не са се променили.',
      d: { App: { ms: 1, why: ['Hook 1 changed (useState: query)'] }, Header: { ms: 1, why: ['The parent component rendered'] }, Dashboard: { ms: 2, why: ['The parent component rendered'] }, Chart: { ms: 29, why: ['The parent component rendered', 'Props не са променени'] }, Table: { ms: 1, why: ['The parent component rendered'] }, ...rows(1, ['The parent component rendered']), Sidebar: { ms: 2, why: ['The parent component rendered'] } } },
    { label: 'Същото след memo(Chart)', desc: 'Същата буква, но Chart вече е увит в React.memo. Props са същите, Chart е сив (не е рендериран) и commit-ът пада от 41 ms на 11 ms.',
      d: { App: { ms: 1, why: ['Hook 1 changed (useState: query)'] }, Header: { ms: 1, why: ['The parent component rendered'] }, Dashboard: { ms: 2, why: ['The parent component rendered'] }, Chart: null, Table: { ms: 1, why: ['The parent component rendered'] }, ...rows(1, ['The parent component rendered']), Sidebar: { ms: 2, why: ['The parent component rendered'] } } },
    { label: 'Нови данни в Dashboard', desc: 'fetch върна нови данни и setState е в Dashboard. App, Header и Sidebar не се рендерират. Chart се рендерира, защото prop data наистина е нов. Това е "честен" скъп commit.',
      d: { App: null, Header: null, Dashboard: { ms: 2, why: ['Hook 2 changed (useState: data)'] }, Chart: { ms: 30, why: ['Props changed: (data)'] }, Table: { ms: 1, why: ['Props changed: (rows)'] }, ...rows(1, ['Props changed: (row)']), Sidebar: null } },
    { label: 'Hover върху ред', desc: 'Мишката минава над Row 3, който има собствен hover state. Само той се рендерира, 0.4 ms. Така трябва да изглежда евтино обновление.',
      d: { App: null, Header: null, Dashboard: null, Chart: null, Table: null, 'Row 1': null, 'Row 2': null, 'Row 3': { ms: 0.4, why: ['Hook 1 changed (useState: hovered)'] }, 'Row 4': null, 'Row 5': null, Sidebar: null } },
    { label: 'Смяна на тема (context)', desc: 'ThemeProvider в App сменя стойността си. Всеки consumer се рендерира дори през memo: Sidebar и редовете четат темата с useContext. Chart не я чете и остава сив.',
      d: { App: { ms: 1, why: ['Hook 3 changed (useState: theme)'] }, Header: { ms: 1, why: ['The parent component rendered'] }, Dashboard: { ms: 2, why: ['The parent component rendered'] }, Chart: null, Table: { ms: 1, why: ['The parent component rendered'] }, ...rows(0.5, ['Context changed']), Sidebar: { ms: 2, why: ['Context changed'] } } },
  ];
  const nodes = [];
  (function walk(n, depth, parent) { n.depth = depth; n.parent = parent; nodes.push(n); n.c.forEach((c) => walk(c, depth + 1, n)); })(TREE, 0, null);
  const byName = Object.fromEntries(nodes.map((n) => [n.n, n]));
  const commitTotal = (c) => Object.values(c.d).reduce((a, v) => a + (v ? v.ms : 0), 0);

  let commit = 1, view = 'flame', selected = 'Chart';
  const commitBar = h('div', { class: 'pf-commits' });
  const tabs = h('div', { class: 'w-tabs' });
  const stage = h('div', { class: 'w-stage' });
  const desc = note('');
  const panel = h('div', { class: 'w-panel' });
  body.append(h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'Commits'), commitBar), desc, tabs, stage, panel);

  const maxTotal = Math.max(...COMMITS.map(commitTotal));
  function renderCommits() {
    commitBar.innerHTML = '';
    COMMITS.forEach((c, i) => {
      const t = commitTotal(c);
      commitBar.append(h('button', { type: 'button', class: 'pf-commit' + (i === commit ? ' active' : ''), title: `${c.label}: ${t.toFixed(1)} ms`, onClick: () => { commit = i; renderAll(); } },
        h('i', { style: { height: Math.max(4, (t / maxTotal) * 40) + 'px', background: t > 30 ? 'var(--bad)' : t > 10 ? 'var(--warn)' : 'var(--ok)' } }), h('span', {}, String(i + 1))));
    });
  }
  const tab = (id, label) => h('button', { type: 'button', class: 'w-tab' + (view === id ? ' active' : ''), onClick: () => { view = id; renderAll(); } }, label);

  // Ефективна продължителност: рендерирани възли с измереното време, сивите с последното известно.
  function total(n, c) { const self = c.d[n.n] ? c.d[n.n].ms : BASE[n.n]; return self + n.c.reduce((a, k) => a + total(k, c), 0); }
  const fill = (ratio) => `color-mix(in srgb, var(--warn) ${Math.round(25 + ratio * 75)}%, var(--surface))`;

  function renderFlame(c) {
    const Wd = 760, RH = 26, PADY = 4;
    const depth = Math.max(...nodes.map((n) => n.depth)) + 1;
    const s = svg('svg', { viewBox: `0 0 ${Wd} ${depth * RH + PADY}`, width: Wd, height: depth * RH + PADY, class: 'pf-svg' });
    const rootTotal = total(TREE, c);
    const maxSelf = Math.max(...Object.values(c.d).map((v) => (v ? v.ms : 0)), 0.1);
    (function draw(n, x0) {
      const w = (total(n, c) / rootTotal) * Wd;
      const d = c.d[n.n];
      const g = svg('g', { class: 'pf-node' + (selected === n.n ? ' selected' : ''), style: { cursor: 'pointer' }, onClick: () => { selected = n.n; renderAll(); } });
      g.append(svg('title', {}, d ? `${n.n}: ${d.ms} ms (self) · ${total(n, c).toFixed(1)} ms общо` : `${n.n}: не е рендериран в този commit`));
      g.append(svg('rect', { x: x0 + 1, y: n.depth * RH + PADY, width: Math.max(1, w - 2), height: RH - 4, rx: 3, fill: d ? fill(d.ms / maxSelf) : 'var(--surface-2)', stroke: selected === n.n ? 'var(--accent)' : 'var(--line)', 'stroke-width': selected === n.n ? 2 : 1 }));
      if (w > 34) g.append(svg('text', { x: x0 + 7, y: n.depth * RH + PADY + 15.5, 'font-size': 11.5, 'font-weight': 600, 'font-family': 'var(--mono)', fill: d ? 'var(--ink)' : 'var(--muted)' }, w > 90 ? `${n.n} (${d ? d.ms + ' ms' : 'не'})` : n.n));
      s.append(g);
      let x = x0;
      for (const k of n.c) { draw(k, x); x += (total(k, c) / rootTotal) * Wd; }
    })(TREE, 0);
    return s;
  }
  function renderRanked(c) {
    const list = nodes.filter((n) => c.d[n.n]).sort((a, b) => c.d[b.n].ms - c.d[a.n].ms);
    const max = list.length ? c.d[list[0].n].ms : 1;
    const wrap = h('div', { class: 'pf-ranked' });
    if (!list.length) wrap.append(h('p', { class: 'w-small' }, 'Нищо не е рендерирано.'));
    for (const n of list) {
      const d = c.d[n.n];
      wrap.append(h('div', { class: 'pf-rank' + (selected === n.n ? ' selected' : ''), onClick: () => { selected = n.n; renderAll(); } },
        h('i', { style: { width: Math.max(2, (d.ms / max) * 100) + '%', background: fill(d.ms / max) } }), h('span', {}, `${n.n}  ${d.ms} ms`)));
    }
    return wrap;
  }
  function renderPanel(c) {
    const n = byName[selected];
    const d = c.d[selected];
    panel.innerHTML = '';
    panel.append(h('div', { class: 'w-panel-title' }, `${selected} · commit ${commit + 1}`));
    if (!d) {
      panel.append(h('div', { class: 'w-flex' }, h('span', { class: 'w-chip' }, 'Did not render'), h('span', { class: 'w-small' }, 'Компонентът не е рендериран в този commit (сив в flamegraph-а). React го е прескочил: няма setState, родителят не е рендериран или memo е спрял същите props.')));
      return;
    }
    panel.append(
      h('div', { class: 'w-stats' },
        h('div', { class: 'w-stat' }, h('b', {}, d.ms + ' ms'), h('span', {}, 'self: само тялото на този компонент')),
        h('div', { class: 'w-stat' }, h('b', {}, total(n, c).toFixed(1) + ' ms'), h('span', {}, 'общо с децата')),
        h('div', { class: 'w-stat' }, h('b', {}, commitTotal(c).toFixed(1) + ' ms'), h('span', {}, 'целият commit'))),
      h('div', { style: { marginTop: '10px' } }, h('div', { class: 'w-panel-title' }, 'Why did this render?'), h('ul', { style: { margin: 0, paddingLeft: '20px', fontSize: '14px' } }, d.why.map((w) => h('li', {}, w)))),
    );
  }
  function renderAll() {
    const c = COMMITS[commit];
    renderCommits();
    tabs.innerHTML = '';
    tabs.append(tab('flame', 'Flamegraph'), tab('ranked', 'Ranked'));
    desc.innerHTML = `<b>Commit ${commit + 1}: ${c.label}</b> · ${commitTotal(c).toFixed(1)} ms. ${c.desc}`;
    stage.innerHTML = '';
    stage.append(view === 'flame' ? renderFlame(c) : renderRanked(c));
    renderPanel(c);
  }
  renderAll();
});
