/* Две дървета: current и workInProgress. Стъпки: setState, клониране през alternate, bailout, commit и смяна на root.current. */
W.register('double-buffer', (el) => {
  const { h, shell, stepper, tree, note, log } = W;
  const body = shell(el, { title: 'current и workInProgress: едно обновление от край до край', hint: 'Номерата (#) са идентичността на обектите: следи, че не се създават нови.' });

  const make = (ids) => ({ id: 'root', label: 'HostRoot', children: [
    { id: 'app', label: 'App', children: [
      { id: 'header', label: 'Header', children: [] },
      { id: 'list', label: 'List', children: [
        { id: 'ia', label: 'Item a', children: [] },
        { id: 'ib', label: 'Item b', children: [] },
      ] },
    ] },
  ] });
  const L = tree(make(), { colWidth: 92, nodeWidth: 82, rowHeight: 56 });
  const R = tree(make(), { colWidth: 92, nodeWidth: 82, rowHeight: 56 });
  const ORDER = ['root', 'app', 'header', 'list', 'ia', 'ib'];
  const LID = Object.fromEntries(ORDER.map((id, i) => [id, '#' + (i + 1)]));
  const RID = Object.fromEntries(ORDER.map((id, i) => [id, '#' + (i + 7)]));
  ORDER.forEach((id) => { L.setBadge(id, LID[id]); R.setBadge(id, RID[id]); });

  const leftTitle = h('div', { class: 'w-panel-title' });
  const rightTitle = h('div', { class: 'w-panel-title' });
  const pointer = h('div', { class: 'w-panel' }, h('div', { class: 'w-panel-title' }, 'root.current сочи към'), h('div', { class: 'w-mono', style: { fontWeight: 700, fontSize: '15px' } }));

  // Състояние на кадър: за всяко дърво map id -> state; swapped обръща етикетите.
  const dimAll = Object.fromEntries(ORDER.map((id) => [id, 'dim']));
  const frames = [
    { left: {}, right: dimAll, swapped: false, log: null,
      msg: 'Лявото дърво е <b>current</b>: това е на екрана. Дясното са fiber обектите от предишния рендер (#7 до #12), свързани с левите през <code>alternate</code>. В момента не се ползват, но не са изхвърлени.' },
    { left: { ib: 'dirty', list: 'dirty', app: 'dirty', root: 'dirty' }, right: dimAll, swapped: false, log: ['setState в Item b', 'Item b.lanes = SyncLane', 'childLanes нагоре: List, App, HostRoot'],
      msg: 'Потребителят натиска бутон в <b>Item b</b>. Обновлението влиза в опашката на hook-а, fiber-ът получава lane, а всички родители до корена получават <code>childLanes</code>: "под мен има работа". Нищо друго не се променя.' },
    { left: { ib: 'dirty', list: 'dirty', app: 'dirty', root: 'dirty' }, right: { ...dimAll, root: 'current' }, swapped: false, log: ['createWorkInProgress(HostRoot #1)', '  wip = current.alternate  → #7, не нов обект', '  wip.pendingProps = current.pendingProps', '  wip.flags = NoFlags; wip.child = current.child'],
      msg: '<b>createWorkInProgress</b>: React взема <code>current.alternate</code> (#7) и го нулира: нови pendingProps, изчистени флагове, същите деца като current. Ако alternate го нямаше (първо обновление), щеше да създаде нов обект; при всяко следващо го преизползва.' },
    { left: { ib: 'dirty', list: 'dirty', app: 'dirty', root: 'dirty' }, right: { ...dimAll, root: 'info', app: 'current' }, swapped: false, log: ['beginWork(App #8)', '  няма собствени lanes, има childLanes', '  cloneChildFibers: Header → #9, List → #10'],
      msg: '<b>beginWork(App)</b>: App няма собствено обновление, затова компонентът не се извиква. Но <code>childLanes</code> казва, че под него има работа, затова React клонира децата му във WIP (пак през alternate: #9 и #10) и слиза надолу.' },
    { left: { ib: 'dirty', list: 'dirty', app: 'dirty', root: 'dirty' }, right: { ...dimAll, root: 'info', app: 'info', header: 'dim' }, swapped: false, log: ['beginWork(Header #9)', '  bailout: нито lanes, нито childLanes', '  wip.child = current.child (без обхождане)'],
      msg: '<b>Header: bailout.</b> Няма нищо под него за правене. WIP fiber-ът #9 просто сочи към същите деца като current #3, функцията Header не се извиква. Това е евтиният път, по който минава по-голямата част от дървото при типично обновление.' },
    { left: { ib: 'dirty', list: 'dirty', app: 'dirty', root: 'dirty' }, right: { ...dimAll, root: 'info', app: 'info', list: 'current' }, swapped: false, log: ['beginWork(List #10)', '  childLanes → cloneChildFibers: Item a → #11, Item b → #12'],
      msg: '<b>beginWork(List)</b>: същото като App: няма собствена работа, но има в поддървото. Клонира Item a и Item b през alternate.' },
    { left: { ib: 'dirty', list: 'dirty', app: 'dirty', root: 'dirty' }, right: { ...dimAll, root: 'info', app: 'info', list: 'info', ia: 'dim' }, swapped: false, log: ['beginWork(Item a #11)', '  bailout'],
      msg: '<b>Item a: bailout.</b> Нито lanes, нито childLanes. Компонентът не се извиква.' },
    { left: { ib: 'dirty', list: 'dirty', app: 'dirty', root: 'dirty' }, right: { ...dimAll, root: 'info', app: 'info', list: 'info', ib: 'dirty' }, swapped: false, log: ['beginWork(Item b #12)', '  renderWithHooks: обработва опашката на useState', '  memoizedState: count 1 → 2', '  reconcileChildren → <li> получава Update', '  wip.flags |= Update'],
      msg: '<b>beginWork(Item b)</b>: тук има истинска работа. React извиква функцията Item с новия state, сравнява резултата с current и слага флаг <b>Update</b>. Hook състоянието се пише в <code>memoizedState</code> на WIP fiber-а (#12), а current (#6) остава с count 1, докато трае рендерът.' },
    { left: { ib: 'dirty', list: 'dirty', app: 'dirty', root: 'dirty' }, right: { root: 'done', app: 'done', header: 'dim', list: 'done', ia: 'dim', ib: 'dirty' }, swapped: false, log: ['completeWork(Item b) → completeWork(List) → completeWork(App) → completeWork(HostRoot)', '  subtreeFlags се събират нагоре', 'finishedWork = #7'],
      msg: '<b>completeWork</b> нагоре по пътя. Флаговете се събират в <code>subtreeFlags</code>, за да знае commit фазата, че трябва да слезе точно по този клон. WIP дървото е готово: <code>finishedWork</code>. Екранът още показва старото.' },
    { left: dimAll, right: { root: 'done', app: 'done', header: 'dim', list: 'done', ia: 'dim', ib: 'done' }, swapped: true, log: ['commitRoot(finishedWork)', '  mutation: li.textContent = "2"', '  root.current = finishedWork  (#1 → #7)', '  layout ефекти, ref-ове'],
      msg: '<b>Commit.</b> DOM-ът се обновява и едно присвояване обръща указателя: <code>root.current = finishedWork</code>. Дясното дърво е вече <b>current</b>, а лявото е свободно. Потребителят в нито един момент не е виждал полуготово дърво.' },
    { left: dimAll, right: {}, swapped: true, log: ['следващо обновление: createWorkInProgress → взема alternate → #1, #2, ...'],
      msg: 'Следващото обновление ще клонира в обратна посока: WIP ще се строи върху #1, #2, #3... Затова за всеки компонент има най-много <b>два</b> fiber обекта, които се редуват. Ако рендер бъде прекъснат и изхвърлен, WIP просто се нулира при следващия опит, а current не е пипан.' },
  ];

  const lg = log({ title: 'Какво прави React' });
  const noteEl = note('');
  const legend = h('div', { class: 'w-legend' },
    h('span', { style: { '--c': 'var(--warn)' } }, 'чакаща работа (lanes / Update)'),
    h('span', { style: { '--c': 'var(--accent)' } }, 'текущ fiber'),
    h('span', { style: { '--c': 'var(--info)' } }, 'клониран през alternate'),
    h('span', { style: { '--c': 'var(--ok)' } }, 'завършен'),
    h('span', { style: { '--c': 'var(--line)' } }, 'bailout / неизползван'),
  );
  let logged = -1;
  const st = stepper({ frames, interval: 1800, render(f, i) {
    L.clearStates(); R.clearStates();
    for (const [id, s] of Object.entries(f.left)) L.setState(id, s);
    for (const [id, s] of Object.entries(f.right)) R.setState(id, s);
    leftTitle.textContent = f.swapped ? 'workInProgress (свободно за следващия рендер)' : 'current (това е на екрана)';
    rightTitle.textContent = f.swapped ? 'current (това е на екрана)' : 'workInProgress';
    leftTitle.style.color = f.swapped ? '' : 'var(--ok)';
    rightTitle.style.color = f.swapped ? 'var(--ok)' : '';
    pointer.lastChild.textContent = f.swapped ? 'дясното дърво (#7)' : 'лявото дърво (#1)';
    noteEl.innerHTML = f.msg;
    if (i <= logged) { lg.clear(); logged = -1; }
    for (let k = logged + 1; k <= i; k++) if (frames[k].log) frames[k].log.forEach((l, j) => lg.add(l, j === 0 ? 'strong info sep' : ''));
    logged = i;
  } });

  body.append(
    st.el, noteEl,
    h('div', { class: 'w-grid-2' },
      h('div', { class: 'w-panel' }, leftTitle, h('div', { class: 'w-stage' }, L.el)),
      h('div', { class: 'w-panel' }, rightTitle, h('div', { class: 'w-stage' }, R.el)),
    ),
    legend,
    h('div', { class: 'w-grid-2' }, pointer, lg.el),
  );
});
