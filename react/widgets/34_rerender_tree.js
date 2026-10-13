/* Симулация: кой компонент се рендерира при setState, при смяна на context и с React.memo. */
W.register('rerender-tree', (el) => {
  const { h, shell, tree, note } = W;
  const body = shell(el, { title: 'Кой се рендерира?', hint: 'Кликни компонент = setState в него. Включи memo на някои възли и пробвай отново.' });

  const root = { id: 'app', label: 'App', children: [
    { id: 'header', label: 'Header', children: [] },
    { id: 'sidebar', label: 'Sidebar', children: [{ id: 'nav', label: 'Nav', children: [] }] },
    { id: 'content', label: 'Content', children: [
      { id: 'list', label: 'List', children: [{ id: 'item1', label: 'Item 1', children: [] }, { id: 'item2', label: 'Item 2', children: [] }] },
      { id: 'footer', label: 'Footer', children: [] },
    ] },
  ] };
  const CONSUMERS = new Set(['nav', 'item2']);
  const memoable = ['sidebar', 'list', 'item1'];
  const memo = new Set();
  const t = tree(root, { colWidth: 104, nodeWidth: 88, onClick: (n) => run(n.id) });
  const all = t.nodes.map((n) => n.id);
  for (const id of CONSUMERS) t.setBadge(id, 'ctx');

  const stat = h('div', { class: 'w-stats' });
  const noteEl = note('Кликни върху възел. Footer е подаден на Content като children от App: обърни внимание какво става с него при setState в Content.');
  const legend = h('div', { class: 'w-legend' },
    h('span', { style: { '--c': 'var(--warn)' } }, 'рендерира се'),
    h('span', { style: { '--c': 'var(--ok)' } }, 'прескочен (bailout)'),
    h('span', { style: { '--c': 'var(--purple)' } }, 'с React.memo'),
    h('span', { style: { '--c': 'var(--line)' } }, 'незасегнат'),
  );
  const toggles = h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'React.memo'));
  for (const id of memoable) {
    const cb = h('input', { type: 'checkbox', onChange: () => { cb.checked ? memo.add(id) : memo.delete(id); paint(null, new Set(), new Set()); noteEl.innerHTML = `React.memo(${t.byId[id].label}) ${cb.checked ? 'включен' : 'изключен'}. Кликни възел, за да видиш ефекта.`; } });
    toggles.append(h('label', { class: 'w-toggle' }, cb, t.byId[id].label));
  }
  const ctxBtn = W.btn('Промени context стойността', () => run('ctx'), 'primary');
  const resetBtn = W.btn('↺ Изчисти', () => paint(null, new Set(), new Set()), 'small');
  body.append(h('div', { class: 'w-flex' }, ctxBtn, resetBtn), toggles, h('div', { class: 'w-stage' }, t.el), legend, stat, noteEl);

  function paint(source, rendered, bailed) {
    t.clearStates();
    for (const id of memo) t.setState(id, 'purple');
    for (const id of bailed) t.setState(id, 'done');
    for (const id of rendered) t.setState(id, 'dirty');
    if (source && source !== 'ctx') t.setState(source, 'current');
    stat.innerHTML = '';
    if (rendered.size || bailed.size) stat.append(
      h('div', { class: 'w-stat c-warn' }, h('b', {}, `${rendered.size} от ${all.length}`), h('span', {}, 'компонента се рендерираха')),
      h('div', { class: 'w-stat c-ok' }, h('b', {}, String(bailed.size)), h('span', {}, 'прескочени (bailout)')),
    );
  }

  // Правилата на beginWork, опростени: родителят се рендерира -> децата получават нови props,
  // освен ако елементът е същият обект (children от по-горе) или компонентът е memo с равни props.
  // Промяна на context стига до consumer-ите дори през memo.
  function run(source) {
    const rendered = new Set(), bailed = new Set();
    const ctx = source === 'ctx';
    const start = ctx ? 'app' : source;
    rendered.add(start);
    (function walk(n, parentRendered, insideBailed) {
      for (const c of n.children) {
        let renders = false, reason = '';
        if (insideBailed) { renders = ctx && CONSUMERS.has(c.id); reason = renders ? 'ctx' : ''; }
        else if (!parentRendered) renders = false;
        else if (c.id === 'footer' && start !== 'app') { renders = false; reason = 'same-element'; }
        else if (memo.has(c.id)) { renders = false; reason = 'memo'; }
        else renders = true;
        if (!renders && ctx && CONSUMERS.has(c.id)) { renders = true; reason = 'ctx'; }
        if (renders) rendered.add(c.id);
        else if (reason) bailed.add(c.id);
        // Под прескочен възел децата остават недокоснати, освен consumer-и при context промяна.
        walk(c, renders, insideBailed ? !renders : !renders && reason !== '');
      }
    })(t.byId[start], true, false);
    // Consumer-ите в прескочено поддърво при context промяна.
    if (ctx) for (const id of CONSUMERS) rendered.add(id);
    for (const id of rendered) bailed.delete(id);
    paint(source, rendered, bailed);
    noteEl.innerHTML = explain(source, rendered, bailed);
  }

  function explain(source, rendered, bailed) {
    const lbl = (id) => t.byId[id].label;
    if (source === 'ctx') {
      const m = [...bailed].map(lbl);
      return `<b>Context стойността се смени</b> (Provider е в App, значи App е направил setState). App и всичките му деца се рендерират${m.length ? `, освен ${m.join(', ')} с React.memo` : ''}. Consumer-ите Nav и Item 2 се рендерират при всички случаи, дори да са под memo: React обхожда и прескочените поддървета, за да намери fiber-ите, абонирани за този context.`;
    }
    const n = t.byId[source];
    const parts = [`<b>setState в ${n.label}</b>: ${n.label} се рендерира и React тръгва надолу по децата му.`];
    if (source === 'content') parts.push('Footer не се рендерира: App не е рендериран, затова елементът <code>&lt;Footer/&gt;</code> в props.children е същият обект като миналия път и beginWork прави bailout.');
    if (source === 'app') parts.push('Footer този път се рендерира: App създаде нов елемент <code>&lt;Footer/&gt;</code>, различна референция.');
    const m = [...bailed].filter((id) => memo.has(id)).map(lbl);
    if (m.length) parts.push(`${m.join(', ')}: props са плитко равни, React.memo спира рендера и цялото поддърво под тях е прескочено.`);
    if (!n.children.length) parts.push('Няма деца, значи само един компонент се рендерира. Родителите никога не се рендерират заради дете.');
    else if (!bailed.size) parts.push('Нищо не спря рендера надолу: без memo всяко дете получава "нови" props (нов обект при всеки рендер на родителя), дори стойностите да са същите.');
    return parts.join(' ');
  }
  paint(null, new Set(), new Set());
});
