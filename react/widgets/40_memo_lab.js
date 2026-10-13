/* Истински React: кои props минават през плиткото сравнение на React.memo и кои го чупят. */
W.register('memo-lab', (el) => {
  const { h, shell, react, note } = W;
  const body = shell(el, { title: 'React.memo лаборатория: кой prop чупи мемоизацията?', real: true, hint: 'Избери какви props подава родителят, после го пререндерирай и виж дали детето се рендерира.' });
  const mount = h('div');
  const report = h('div', { class: 'w-panel' }, h('div', { class: 'w-panel-title' }, 'Сравнение на props при последния рендер на родителя'), h('p', { class: 'w-small', style: { margin: 0 } }, 'Натисни "Пререндерирай родителя".'));
  const verdict = note('Детето е увито в <code>React.memo</code>. При всеки рендер на родителя React сравнява всеки prop със стария чрез <code>Object.is</code>. Ако всички съвпадат, детето се прескача.');
  body.append(mount, verdict, report);
  if (!window.React) { react(mount); return; }

  const { useState, useRef, useCallback, useMemo, useLayoutEffect, memo, createElement: e } = React;

  // Всеки обект или функция получава номер, за да се вижда дали е същата референция.
  const ids = new WeakMap();
  let nextId = 1;
  const tag = (v) => {
    if (v === undefined) return '(няма)';
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return JSON.stringify(v);
    if (!ids.has(v)) ids.set(v, nextId++);
    const kind = typeof v === 'function' ? 'ƒ' : Array.isArray(v) ? '[ ]' : v.$$typeof ? '<елемент>' : '{ }';
    return `${kind} #${ids.get(v)}`;
  };

  const childRenders = { n: 0 };
  const Child = memo(function Child(props) {
    childRenders.n++;
    const ref = useRef(null);
    useLayoutEffect(() => {
      const node = ref.current;
      node.classList.remove('flash');
      void node.offsetWidth;
      node.classList.add('flash');
    });
    return e('div', { ref, className: 'w-node is-dirty', style: { padding: '10px 14px' } },
      `Child: рендер #${childRenders.n}`, props.label ? ` · label=${props.label}` : '', props.children ? ' · ' : null, props.children || null);
  });

  const OPTIONS = [
    ['label', 'label="x" (примитив)'],
    ['style', 'style={{ color }} (inline обект)'],
    ['onClickInline', 'onClick={() => {}} (inline функция)'],
    ['onClickCb', 'onClick={useCallback(...)}'],
    ['itemsInline', 'items={[]} (inline масив)'],
    ['itemsMemo', 'items={useMemo(...)}'],
    ['children', '<Child><b>дете</b></Child> (JSX като children)'],
  ];

  function Parent() {
    const [n, setN] = useState(0);
    const [opts, setOpts] = useState({ label: true });
    const stableCb = useCallback(() => {}, []);
    const stableItems = useMemo(() => ['a', 'b'], []);
    const props = {};
    if (opts.label) props.label = 'x';
    if (opts.style) props.style = { color: 'var(--accent)' };
    if (opts.onClickInline) props.onClick = () => {};
    else if (opts.onClickCb) props.onClick = stableCb;
    if (opts.itemsInline) props.items = [];
    else if (opts.itemsMemo) props.items = stableItems;
    const children = opts.children ? e('b', null, 'дете') : undefined;
    const prev = useRef(null);
    const before = useRef(childRenders.n);
    const full = children ? { ...props, children } : props;

    useLayoutEffect(() => {
      const rendered = childRenders.n > before.current;
      before.current = childRenders.n;
      const old = prev.current;
      prev.current = full;
      const keys = [...new Set([...Object.keys(old || {}), ...Object.keys(full)])];
      const rows = keys.map((k) => {
        const same = old ? Object.is(old[k], full[k]) : false;
        return h('tr', {}, h('td', {}, k), h('td', { class: 'w-mono' }, old ? tag(old[k]) : '(първи рендер)'), h('td', { class: 'w-mono' }, tag(full[k])),
          h('td', {}, h('span', { class: 'w-chip ' + (same ? 'c-ok' : 'c-bad') }, same ? 'true' : 'false')));
      });
      const broken = old ? keys.filter((k) => !Object.is(old[k], full[k])) : keys;
      report.innerHTML = '';
      report.append(h('div', { class: 'w-panel-title' }, `Сравнение на props при рендер #${n + 1} на родителя`),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'prop'), h('th', {}, 'стара стойност'), h('th', {}, 'нова стойност'), h('th', {}, 'Object.is'))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 4 }, 'Няма props.'))))));
      if (!old) verdict.innerHTML = '<b>Първи рендер</b>: няма стари props, детето се рендерира задължително (mount). Сега натисни "Пререндерирай родителя".';
      else if (!rendered) verdict.innerHTML = `<b>Child НЕ се рендерира.</b> Всички ${keys.length ? keys.length : 0} props минаха през <code>Object.is</code>. React.memo върна стария резултат и прескочи цялото поддърво.`;
      else verdict.innerHTML = `<b>Child се рендерира.</b> Плиткото сравнение се провали заради: <code>${broken.join('</code>, <code>')}</code>. Достатъчен е един различен prop, за да падне мемоизацията изцяло.`;
    });

    const toggle = (k) => setOpts((o) => {
      const next = { ...o, [k]: !o[k] };
      if (k === 'onClickInline' && next[k]) next.onClickCb = false;
      if (k === 'onClickCb' && next[k]) next.onClickInline = false;
      if (k === 'itemsInline' && next[k]) next.itemsMemo = false;
      if (k === 'itemsMemo' && next[k]) next.itemsInline = false;
      return next;
    });

    return e('div', { style: { display: 'grid', gap: '10px' } },
      e('div', { className: 'w-flex' }, OPTIONS.map(([k, label]) => e('label', { key: k, className: 'w-toggle' }, e('input', { type: 'checkbox', checked: !!opts[k], onChange: () => toggle(k) }), label))),
      e('div', { className: 'w-flex' },
        e('button', { type: 'button', className: 'w-btn primary', onClick: () => setN((v) => v + 1) }, 'Пререндерирай родителя'),
        e('span', { className: 'w-small' }, `Родител: рендер #${n + 1} · Child: ${childRenders.n} рендера общо`),
      ),
      e('div', { className: 'w-screen' },
        e('div', { className: 'w-screen-bar' }, e('i'), e('i'), e('i')),
        e('div', { className: 'w-screen-body' }, e('div', { className: 'w-node', style: { marginBottom: '8px' } }, `Parent (рендер #${n + 1})`), e('div', null, e(Child, props, children))),
      ),
    );
  }
  react(mount, Parent);
});
