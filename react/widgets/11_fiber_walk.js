/* Обхождане на fiber дървото с child / sibling / return, стъпка по стъпка, без рекурсия. */
W.register('fiber-walk', (el) => {
  const { h, shell, stepper, codeLines, tree, log, note } = W;
  const body = shell(el, { title: 'performUnitOfWork: обхождане без рекурсия', hint: 'Следи кой ред от кода е активен и накъде сочи nextUnitOfWork.' });

  const root = { id: 'root', label: 'HostRoot', children: [
    { id: 'app', label: 'App', children: [
      { id: 'header', label: 'Header', children: [{ id: 'h1', label: 'h1', children: [] }] },
      { id: 'list', label: 'List', children: [
        { id: 'ia', label: 'Item a', children: [{ id: 'lia', label: 'li', children: [] }] },
        { id: 'ib', label: 'Item b', children: [{ id: 'lib', label: 'li', children: [] }] },
      ] },
    ] },
  ] };
  const t = tree(root, { colWidth: 104, nodeWidth: 90 });

  const src = `function workLoop() {
  while (nextUnitOfWork !== null && !shouldYield()) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }
}

function performUnitOfWork(fiber) {
  beginWork(fiber);                      // рендерира компонента, създава децата му
  if (fiber.child !== null) {
    return fiber.child;                  // слез надолу към първото дете
  }
  let node = fiber;
  while (node !== null) {
    completeWork(node);                  // възелът и всичките му деца са готови
    if (node.sibling !== null) {
      return node.sibling;               // продължи с брата
    }
    node = node.return;                  // няма брат: качи се към родителя
  }
  return null;                           // стигнахме корена: няма повече работа
}`;
  const codeEl = codeLines(src);

  const sib = (n) => (n.parent ? n.parent.children[n.index + 1] : null) || null;
  const frames = [];
  const begun = new Set(), done = new Set();
  const snap = (o) => ({ ...o, begun: new Set(begun), done: new Set(done) });
  frames.push(snap({ node: 'root', lines: [0, 1], next: 'root', msg: 'nextUnitOfWork = HostRoot. Цикълът пита: има ли работа и има ли време?', logLine: null }));
  let fiber = t.byId.root;
  while (fiber) {
    begun.add(fiber.id);
    frames.push(snap({ node: fiber.id, lines: [7], next: fiber.id, msg: `<b>beginWork(${fiber.label})</b>: React извиква компонента (или подготвя DOM елемента), сравнява резултата с предишния и създава fiber-и за децата.`, logLine: `beginWork(${fiber.label})`, cls: 'info' }));
    if (fiber.children.length) {
      frames.push(snap({ node: fiber.id, lines: [8, 9], next: fiber.children[0].id, arrow: [fiber.id, fiber.children[0].id, 'accent'], msg: `${fiber.label} има дете: връщаме <code>fiber.child</code> = ${fiber.children[0].label}. Това е новата единица работа. <b>Тук цикълът може да спре</b> и да продължи по-късно от същата точка.` }));
      fiber = fiber.children[0];
      continue;
    }
    frames.push(snap({ node: fiber.id, lines: [8], next: fiber.id, msg: `${fiber.label} няма деца. Няма накъде надолу, значи този възел може да се довърши.` }));
    let node = fiber;
    while (node) {
      done.add(node.id);
      frames.push(snap({ node: node.id, lines: [13], next: node.id, msg: `<b>completeWork(${node.label})</b>: всичко под ${node.label} е готово. За DOM елемент тук се създава самият DOM възел (още невключен в документа) и флаговете на децата се събират в subtreeFlags.`, logLine: `completeWork(${node.label})`, cls: 'ok' }));
      const s = sib(node);
      if (s) {
        frames.push(snap({ node: node.id, lines: [14, 15], next: s.id, arrow: [node.id, s.id, 'warn', '6 4'], msg: `${node.label} има брат: връщаме <code>node.sibling</code> = ${s.label}. Братът става следващата единица работа.` }));
        fiber = s;
        break;
      }
      if (node.parent) {
        frames.push(snap({ node: node.id, lines: [17], next: node.parent.id, arrow: [node.id, node.parent.id, 'bad', '2 4'], msg: `${node.label} няма брат: <code>node = node.return</code>, качваме се към ${node.parent.label}. Родителят вече може да бъде довършен, защото всичките му деца са готови.` }));
      } else {
        frames.push(snap({ node: node.id, lines: [17, 19], next: null, msg: 'Стигнахме корена и той няма return. <code>performUnitOfWork</code> връща null, цикълът спира: render фазата е готова.' }));
      }
      node = node.parent;
    }
    if (!node) fiber = null;
  }
  frames.push(snap({ node: null, lines: [1], next: null, msg: 'nextUnitOfWork е null. React вика <code>commitRoot()</code> и прилага всички отбелязани промени към DOM наведнъж. Виж страницата Commit Phase.', logLine: 'commitRoot()', cls: 'purple strong' }));

  const lg = log({ title: 'Ред на извикване' });
  const nextEl = h('div', { class: 'w-panel' }, h('div', { class: 'w-panel-title' }, 'nextUnitOfWork'), h('div', { class: 'w-mono', style: { fontSize: '15px', fontWeight: 700 } }));
  const noteEl = note('');
  const legend = h('div', { class: 'w-legend' },
    h('span', { style: { '--c': 'var(--accent)' } }, 'текущ възел'),
    h('span', { style: { '--c': 'var(--info)' } }, 'започнат (beginWork)'),
    h('span', { style: { '--c': 'var(--ok)' } }, 'завършен (completeWork)'),
  );

  let lastLogged = -1;
  const st = stepper({ frames, interval: 1300, render(f, i) {
    t.clearStates(); t.clearArrows();
    for (const id of f.begun) t.setState(id, 'info');
    for (const id of f.done) t.setState(id, 'done');
    if (f.node) t.setState(f.node, 'current');
    if (f.arrow) t.arrow(...f.arrow);
    codeEl.setActive(f.lines);
    nextEl.lastChild.textContent = f.next ? t.byId[f.next].label : 'null';
    noteEl.innerHTML = f.msg;
    // Логът се строи наново до текущата стъпка, за да работи и "Назад".
    if (i <= lastLogged) { lg.clear(); lastLogged = -1; }
    for (let k = lastLogged + 1; k <= i; k++) if (frames[k].logLine) lg.add(frames[k].logLine, frames[k].cls || '');
    lastLogged = i;
  } });

  body.append(
    st.el,
    noteEl,
    h('div', { class: 'w-grid-2' },
      h('div', {}, h('div', { class: 'w-stage' }, t.el), h('div', { style: { height: '8px' } }), legend, h('div', { style: { height: '8px' } }), nextEl),
      h('div', { style: { display: 'grid', gap: '10px', alignContent: 'start' } }, codeEl.el, lg.el),
    ),
  );
});
