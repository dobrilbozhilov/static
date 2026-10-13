/* Дърво от fiber възли: клик върху възел показва полетата му и указателите child / sibling / return. */
W.register('fiber-node', (el) => {
  const { h, svg, shell, note } = W;
  const body = shell(el, { title: 'Fiber дървото на едно малко приложение', hint: 'Кликни възел, за да видиш полетата му и накъде сочат указателите му.' });

  const TAGS = { HostRoot: 3, FunctionComponent: 0, HostComponent: 5, HostText: 6 };
  const tree = {
    id: 'root', label: 'HostRoot', kind: 'HostRoot', type: 'null', stateNode: 'FiberRootNode (container-ът, #root)', props: '{ }', state: '{ element: <App/> }',
    children: [{
      id: 'app', label: 'App', kind: 'FunctionComponent', type: 'function App', stateNode: 'null', props: '{ }', state: 'useState: { count: 2 }',
      children: [{
        id: 'div', label: 'div', kind: 'HostComponent', type: '"div"', stateNode: 'HTMLDivElement', props: '{ className: "app", children: [...] }', state: 'null',
        children: [
          { id: 'header', label: 'Header', kind: 'FunctionComponent', type: 'function Header', stateNode: 'null', props: '{ title: "Списък" }', state: 'null',
            children: [{ id: 'h1', label: 'h1', kind: 'HostComponent', type: '"h1"', stateNode: 'HTMLHeadingElement', props: '{ children: "Списък" }', state: 'null',
              children: [{ id: 't1', label: '"Списък"', kind: 'HostText', type: 'null', stateNode: 'Text node', props: '"Списък"', state: 'null', children: [] }] }] },
          { id: 'list', label: 'List', kind: 'FunctionComponent', type: 'function List', stateNode: 'null', props: '{ items: ["a", "b"] }', state: 'useMemo: [...]',
            children: [{ id: 'ul', label: 'ul', kind: 'HostComponent', type: '"ul"', stateNode: 'HTMLUListElement', props: '{ children: [...] }', state: 'null',
              children: [
                { id: 'ia', label: 'Item key=a', key: '"a"', kind: 'FunctionComponent', type: 'function Item', stateNode: 'null', props: '{ id: "a" }', state: 'null',
                  children: [{ id: 'lia', label: 'li', kind: 'HostComponent', type: '"li"', stateNode: 'HTMLLIElement', props: '{ children: "a" }', state: 'null', children: [] }] },
                { id: 'ib', label: 'Item key=b', key: '"b"', kind: 'FunctionComponent', type: 'function Item', stateNode: 'null', props: '{ id: "b" }', state: 'null',
                  children: [{ id: 'lib', label: 'li', kind: 'HostComponent', type: '"li"', stateNode: 'HTMLLIElement', props: '{ children: "b" }', state: 'null', children: [] }] },
              ] }] },
        ],
      }],
    }],
  };

  // Подредба: листата получават поредни колони, родителят застава над средата на децата си.
  const nodes = [];
  let col = 0;
  function layout(n, depth, parent) {
    n.depth = depth; n.parent = parent;
    if (!n.children.length) n.x = col++;
    else { n.children.forEach((c, i) => { c.index = i; layout(c, depth + 1, n); }); n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2; }
    nodes.push(n);
  }
  layout(tree, 0, null);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const COLW = 118, ROWH = 64, NW = 100, NH = 32, PAD = 12;
  const px = (n) => PAD + n.x * COLW + COLW / 2;
  const py = (n) => PAD + n.depth * ROWH + NH / 2;
  const width = PAD * 2 + col * COLW, height = PAD * 2 + 7 * ROWH;

  const svgEl = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': 'Fiber дърво' });
  const marker = (id, color) => svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }));
  const defs = svg('defs', {}, marker('fn-arrow-accent', 'var(--accent)'), marker('fn-arrow-warn', 'var(--warn)'), marker('fn-arrow-bad', 'var(--bad)'));
  svgEl.append(defs);
  const edgesG = svg('g', { stroke: 'var(--line)', 'stroke-width': 1.5, fill: 'none' });
  const ptrG = svg('g', { fill: 'none', 'stroke-width': 2.2 });
  const nodesG = svg('g');
  svgEl.append(edgesG, ptrG, nodesG);
  for (const n of nodes) for (const c of n.children) edgesG.append(svg('path', { d: `M${px(n)},${py(n) + NH / 2} C${px(n)},${py(c) - 24} ${px(c)},${py(n) + 36} ${px(c)},${py(c) - NH / 2}` }));

  const rects = {};
  const KIND_COLOR = { HostRoot: 'var(--purple)', FunctionComponent: 'var(--accent)', HostComponent: 'var(--info)', HostText: 'var(--muted)' };
  for (const n of nodes) {
    const g = svg('g', { class: 'fn-node', style: { cursor: 'pointer' }, onClick: () => select(n.id) });
    const r = svg('rect', { x: px(n) - NW / 2, y: py(n) - NH / 2, width: NW, height: NH, rx: 8, fill: 'var(--surface)', stroke: KIND_COLOR[n.kind], 'stroke-width': 1.5 });
    const t = svg('text', { x: px(n), y: py(n) + 4.5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, 'font-family': 'var(--mono)' }, n.label);
    g.append(r, t);
    nodesG.append(g);
    rects[n.id] = r;
  }

  const legend = h('div', { class: 'w-legend' },
    h('span', { style: { '--c': 'var(--purple)' } }, 'HostRoot (коренът)'),
    h('span', { style: { '--c': 'var(--accent)' } }, 'FunctionComponent (твой компонент)'),
    h('span', { style: { '--c': 'var(--info)' } }, 'HostComponent (DOM елемент)'),
    h('span', { style: { '--c': 'var(--muted)' } }, 'HostText (текст)'),
  );
  const ptrLegend = h('div', { class: 'w-legend' },
    h('span', { style: { '--c': 'var(--accent)' } }, 'child: първото дете'),
    h('span', { style: { '--c': 'var(--warn)' } }, 'sibling: следващият брат'),
    h('span', { style: { '--c': 'var(--bad)' } }, 'return: родителят'),
  );

  const details = h('dl', { class: 'w-kv' });
  const explain = note('');
  const title = h('div', { class: 'w-panel-title' }, 'Полета на fiber-а');
  const panel = h('div', { class: 'w-panel' }, title, details, h('div', { style: { height: '8px' } }), explain);

  const FIELD_HELP = {
    tag: 'Какъв вид възел е това: 0 = функционален компонент, 3 = коренът, 5 = DOM елемент, 6 = текст. React гледа tag, за да знае как да обработи възела.',
    type: 'Какво рендерира: за твой компонент това е самата функция, за DOM елемент е string с името на тага.',
    key: 'Ключът от JSX. По него React намира "същия" елемент при промяна на списък.',
    stateNode: 'Връзка към истинския обект зад възела: DOM елементът, инстанцията на класа или коренът.',
    return: 'Указател към родителя. Името идва от "къде да се върна, когато свърша с този възел".',
    child: 'Указател само към първото дете. Останалите деца се стигат през sibling на първото.',
    sibling: 'Указател към следващия брат. Така децата образуват свързан списък, а не масив.',
    pendingProps: 'Новите props, с които този рендер трябва да работи.',
    memoizedProps: 'Props от последния завършен рендер. Ако pendingProps === memoizedProps, React може да прескочи работата.',
    memoizedState: 'Състоянието от последния рендер. За hooks това е свързан списък от hook обекти в реда, в който са извикани.',
    flags: 'Битова маска с отбелязани промени: Placement (вмъкни), Update (обнови), Deletion (изтрий), Passive (има useEffect). Commit фазата ги чете.',
    lanes: 'Приоритетите на чакащите обновления за този възел, като битова маска. Виж страницата Concurrent React.',
    alternate: 'Указател към "двойника" в другото дърво (current или workInProgress). Виж Double Buffering.',
  };
  let selected = null;
  function rel(n, what) {
    if (what === 'return') return n.parent ? n.parent.label : 'null';
    if (what === 'child') return n.children[0] ? n.children[0].label : 'null';
    if (what === 'sibling') { const s = n.parent && n.parent.children[n.index + 1]; return s ? s.label : 'null'; }
  }
  function select(id) {
    selected = id;
    const n = byId[id];
    for (const [k, r] of Object.entries(rects)) r.setAttribute('fill', k === id ? 'var(--accent-soft)' : 'var(--surface)');
    ptrG.innerHTML = '';
    const arrow = (from, to, color, dash, markerId) => {
      if (!to) return;
      const x1 = px(from), y1 = py(from), x2 = px(to), y2 = py(to);
      const dx = x2 - x1, dy = y2 - y1;
      // Стрелките излизат от ръба на кутията, не от центъра.
      const sx = Math.abs(dx) > Math.abs(dy) * 2 ? Math.sign(dx) * NW / 2 : 0;
      const sy = sx ? 0 : Math.sign(dy) * NH / 2;
      const d = sx ? `M${x1 + sx},${y1} C${x1 + sx + dx / 3},${y1 - 22} ${x2 - sx - dx / 3},${y2 - 22} ${x2 - sx},${y2}` : `M${x1},${y1 + sy} C${x1},${y1 + dy / 2} ${x2},${y2 - dy / 2} ${x2},${y2 - sy}`;
      ptrG.append(svg('path', { d, stroke: color, 'stroke-dasharray': dash, 'marker-end': `url(#${markerId})` }));
    };
    arrow(n, n.children[0], 'var(--accent)', null, 'fn-arrow-accent');
    arrow(n, n.parent && n.parent.children[n.index + 1], 'var(--warn)', '6 4', 'fn-arrow-warn');
    arrow(n, n.parent, 'var(--bad)', '2 4', 'fn-arrow-bad');
    const rows = [
      ['tag', `${TAGS[n.kind]} (${n.kind})`], ['type', n.type], ['key', n.key || 'null'], ['stateNode', n.stateNode],
      ['return', rel(n, 'return')], ['child', rel(n, 'child')], ['sibling', rel(n, 'sibling')],
      ['pendingProps', n.props], ['memoizedProps', n.props], ['memoizedState', n.state],
      ['flags', 'NoFlags (0)'], ['lanes', 'NoLanes (0)'], ['alternate', `fiber за ${n.label} в другото дърво`],
    ];
    details.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = h('dt', { class: 'w-field', style: { cursor: 'help' }, title: FIELD_HELP[k], onClick: () => showHelp(k) }, k);
      const ptr = ['return', 'child', 'sibling'].includes(k);
      details.append(dt, h('dd', { class: ptr ? 'hl' : '' }, v));
    }
    title.textContent = `Полета на fiber-а за ${n.label}`;
    explain.innerHTML = `<b>${n.label}</b>: ${describe(n)} Кликни върху име на поле, за да прочетеш какво значи.`;
  }
  function showHelp(k) { explain.innerHTML = `<b>${k}</b>: ${FIELD_HELP[k]}`; }
  function describe(n) {
    if (n.kind === 'HostRoot') return 'коренът на дървото. Не отговаря на никой твой компонент; неговият stateNode е FiberRootNode, който пази <code>current</code> указателя към завършеното дърво.';
    if (n.kind === 'FunctionComponent') return `fiber за твоя компонент <code>${n.label.split(' ')[0]}</code>. type е самата функция, stateNode е null, защото функциите нямат инстанция, а hooks живеят в memoizedState.`;
    if (n.kind === 'HostComponent') return `fiber за DOM елемент <code>&lt;${n.label}&gt;</code>. stateNode сочи истинския DOM възел, който commit фазата ще обнови.`;
    return 'fiber за текстов възел. Най-малкото нещо в дървото, няма деца.';
  }

  body.append(h('div', { class: 'w-stage' }, svgEl), legend, ptrLegend, panel);
  select('list');
});
