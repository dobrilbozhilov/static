/* Reconciliation на списък: стар срещу нов, по индекс или по key, с флаговете на всеки fiber. */
W.register('reconcile-keys', (el) => {
  const { h, shell, btn, note } = W;
  const body = shell(el, { title: 'Стар списък срещу нов: кой fiber се преизползва?', hint: 'Промени новия списък и превключи режима. Цветът показва флага, който получава всеки fiber.' });

  const INITIAL = ['a', 'b', 'c'];
  let next = [...INITIAL];
  let mode = 'key';
  let counter = 0;

  // Сравнението връща за всеки нов елемент откъде идва (стар fiber или нов) и кои стари fiber-и се изтриват.
  function diff(oldList, newList, byKey) {
    const result = { items: [], deleted: [], dom: 0, renders: 0 };
    if (byKey) {
      const oldSet = new Set(oldList);
      let lastPlacedIndex = 0;
      newList.forEach((k, i) => {
        const oldIndex = oldList.indexOf(k);
        if (oldIndex === -1) {
          result.items.push({ key: k, label: k, flag: 'Placement', why: `няма стар fiber с key="${k}": създава се нов и се вмъква в DOM` });
          result.dom++; result.renders++;
        } else if (oldIndex < lastPlacedIndex) {
          result.items.push({ key: k, label: k, flag: 'Placement', why: `key="${k}" е намерен, но е изпреварен от друг елемент: DOM възелът се премества (Update + Placement)` });
          result.dom++; result.renders++;
        } else {
          lastPlacedIndex = oldIndex;
          result.items.push({ key: k, label: k, flag: 'Update', why: `key="${k}" е намерен в стария списък: fiber-ът и DOM възелът се преизползват, props са същите, затова има bailout` });
        }
      });
      oldList.forEach((k) => { if (!newList.includes(k)) { result.deleted.push(k); result.dom++; } });
      result.renders += 0;
    } else {
      newList.forEach((k, i) => {
        const oldAt = oldList[i];
        if (oldAt === undefined) {
          result.items.push({ key: String(i), label: k, flag: 'Placement', why: `позиция ${i} няма стар fiber: нов fiber, нов DOM възел` });
          result.dom++; result.renders++;
        } else if (oldAt === k) {
          result.items.push({ key: String(i), label: k, flag: 'Update', why: `позиция ${i}: същият елемент "${k}", fiber-ът се преизползва без промяна` });
        } else {
          result.items.push({ key: String(i), label: k, flag: 'Update*', why: `позиция ${i}: fiber-ът за "${oldAt}" се преизползва, но получава props за "${k}": компонентът се рендерира пак и DOM текстът се пренаписва` });
          result.dom++; result.renders++;
        }
      });
      for (let i = newList.length; i < oldList.length; i++) { result.deleted.push(oldList[i]); result.dom++; }
    }
    return result;
  }

  const FLAG_CLASS = { Update: 'is-done', 'Update*': 'is-dirty', Placement: 'is-new', Deletion: 'is-deleted' };
  const oldRow = h('div', { class: 'w-flex' });
  const newRow = h('div', { class: 'w-flex' });
  const stats = h('div', { class: 'w-stats' });
  const why = h('div', { class: 'w-log' }, h('div', { class: 'w-log-title' }, 'Решението за всеки елемент'), h('div', { class: 'w-log-list' }));
  const noteEl = note('');

  function render() {
    const r = diff(INITIAL, next, mode === 'key');
    oldRow.innerHTML = '';
    INITIAL.forEach((k, i) => oldRow.append(h('span', { class: 'w-node ' + (r.deleted.includes(k) ? 'is-deleted' : '') }, mode === 'key' ? `key="${k}"` : `[${i}]`, ' ', h('b', {}, k))));
    newRow.innerHTML = '';
    r.items.forEach((it, i) => newRow.append(h('span', { class: 'w-node ' + FLAG_CLASS[it.flag], title: it.why }, mode === 'key' ? `key="${it.key}"` : `[${i}]`, ' ', h('b', {}, it.label))));
    const list = why.querySelector('.w-log-list');
    list.innerHTML = '';
    const cls = { Update: 'ok', 'Update*': 'warn', Placement: 'info', Deletion: 'bad' };
    r.items.forEach((it) => list.append(h('div', { class: 'w-log-row ' + cls[it.flag] }, h('span', { class: 'w-log-n' }, it.flag.replace('*', '')), h('span', {}, it.why))));
    r.deleted.forEach((k) => list.append(h('div', { class: 'w-log-row bad' }, h('span', { class: 'w-log-n' }, 'Deletion'), h('span', {}, mode === 'key' ? `key="${k}" го няма в новия списък: fiber-ът и DOM възелът се изтриват` : `позиция ${INITIAL.indexOf(k)} вече не съществува: fiber-ът и DOM възелът се изтриват`))));
    stats.innerHTML = '';
    stats.append(
      h('div', { class: 'w-stat ' + (r.renders ? 'c-warn' : 'c-ok') }, h('b', {}, String(r.renders)), h('span', {}, 'извиквания на компонента Item')),
      h('div', { class: 'w-stat ' + (r.dom ? 'c-warn' : 'c-ok') }, h('b', {}, String(r.dom)), h('span', {}, 'DOM операции в commit')),
      h('div', { class: 'w-stat c-ok' }, h('b', {}, String(r.items.filter((x) => x.flag === 'Update').length)), h('span', {}, 'fiber-а с bailout (нищо не се прави)')),
    );
    const same = JSON.stringify(next) === JSON.stringify(INITIAL);
    noteEl.innerHTML = same
      ? 'Списъците са еднакви: всеки fiber се преизползва, props са същият обект, затова <b>bailout</b> и нула работа. Промени новия списък с бутоните.'
      : mode === 'key'
        ? `<b>С key</b>: React търси всеки нов key в map от старите fiber-и. Намерените се преизползват заедно с DOM възлите и състоянието си, независимо от позицията. Само наистина новите се създават, само изчезналите се изтриват.`
        : `<b>По индекс</b>: React сравнява позиция с позиция. Fiber-ът на позиция 0 винаги остава fiber на позиция 0, дори ако сега показва друг елемент. Състоянието (useState, фокус, скрол) остава при позицията, не при елемента, и компонентът се рендерира пак с чужди props.`;
  }

  const modeBtns = [
    btn('С key', () => { mode = 'key'; sync(); }),
    btn('Без key (по индекс)', () => { mode = 'index'; sync(); }),
  ];
  function sync() {
    modeBtns[0].classList.toggle('active', mode === 'key');
    modeBtns[1].classList.toggle('active', mode === 'index');
    render();
  }
  const ops = h('div', { class: 'w-flex' },
    h('span', { class: 'w-label' }, 'Нов списък'),
    btn('Добави в началото', () => { next = ['x' + ++counter, ...next]; render(); }, 'primary'),
    btn('Добави в края', () => { next = [...next, 'y' + ++counter]; render(); }, 'primary'),
    btn('Премахни средния', () => { if (next.length) next.splice(Math.floor(next.length / 2), 1); render(); }),
    btn('Обърни реда', () => { next = [...next].reverse(); render(); }),
    btn('Върни началното', () => { next = [...INITIAL]; render(); }, 'small'),
  );
  const legend = h('div', { class: 'w-legend' },
    h('span', { style: { '--c': 'var(--ok)' } }, 'Update без промяна (bailout)'),
    h('span', { style: { '--c': 'var(--warn)' } }, 'Update с нови props (рендер + DOM запис)'),
    h('span', { style: { '--c': 'var(--info)' } }, 'Placement (нов или преместен)'),
    h('span', { style: { '--c': 'var(--bad)' } }, 'Deletion'),
  );

  body.append(
    h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'Режим'), ...modeBtns),
    ops,
    h('div', { class: 'w-panel' }, h('div', { class: 'w-panel-title' }, 'Стари fiber-и (current)'), oldRow),
    h('div', { class: 'w-panel' }, h('div', { class: 'w-panel-title' }, 'Нови елементи (workInProgress)'), newRow),
    legend, noteEl, stats, why,
  );
  sync();
});
