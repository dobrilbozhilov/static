/* Истински React 18: колко рендера предизвикват няколко setState в различни контексти. */
W.register('auto-batching', (el) => {
  const { h, shell, log, react, note } = W;
  const body = shell(el, { title: 'Два setState, колко рендера?', real: true, hint: 'Натискай бутоните и брой рендерите в лога. Превключи режима, за да сравниш с React 17.' });

  const lg = log({ title: 'Лог: setState извиквания и рендери' });
  const stat = h('div', { class: 'w-stats' });
  const noteEl = note('Избери действие. Всяко действие извиква <code>setA</code> и после <code>setB</code>, въпросът е дали React ще ги събере в един рендер.');
  const mount = h('div');
  body.append(mount, stat, noteEl, lg.el);

  if (!window.React) { react(mount); return; }
  const { useState, useRef, useLayoutEffect, createElement: e } = React;
  const { flushSync } = ReactDOM;

  function Demo() {
    const [a, setA] = useState(0);
    const [b, setB] = useState(0);
    const [legacy, setLegacy] = useState(false);
    const renders = useRef(0);
    const batch = useRef({ before: 0, name: '' });
    renders.current++;
    const n = renders.current;
    // Логът се пише в layout ефект, за да не е страничен ефект в самия render.
    // Логват се само рендерите по време на действие; смяната на режима не е интересна.
    useLayoutEffect(() => { if (batch.current.name) lg.add(`рендер #${n}: a=${a}, b=${b}`, 'ok strong'); });

    // В режим "React 17" всяко setState извън event handler се прилага веднага с flushSync,
    // което е точно поведението на legacy режима: без batching извън React събития.
    const apply = (fn, label) => {
      lg.add(label, 'dim');
      if (legacy) flushSync(fn); else fn();
    };
    const begin = (name) => { batch.current = { before: renders.current, name }; lg.add(`▶ ${name}`, 'info strong sep'); };
    const end = () => setTimeout(() => {
      const count = renders.current - batch.current.before;
      const name = batch.current.name;
      batch.current.name = '';
      stat.innerHTML = '';
      stat.append(
        h('div', { class: 'w-stat ' + (count === 1 ? 'c-ok' : 'c-warn') }, h('b', {}, String(count)), h('span', {}, count === 1 ? 'рендер за това действие' : 'рендера за това действие')),
        h('div', { class: 'w-stat' }, h('b', {}, String(renders.current)), h('span', {}, 'рендера общо')),
      );
      noteEl.innerHTML = count === 1
        ? `<b>${name}</b>: двете обновления се събраха в един рендер. React ги сложи в опашка и ги приложи заедно, затова нямаше рендер с a обновено, а b още старо.`
        : `<b>${name}</b>: ${count} рендера. Всяко setState предизвика собствен рендер, потребителят за миг видя междинно състояние (a ново, b старо), а компонентът свърши двойна работа.`;
    }, 50);

    const inHandler = () => { begin('Два setState в onClick'); apply(() => setA((v) => v + 1), 'setA(a + 1)'); apply(() => setB((v) => v + 1), 'setB(b + 1)'); end(); };
    const inTimeout = () => { begin('Два setState в setTimeout'); setTimeout(() => { apply(() => setA((v) => v + 1), 'setA(a + 1)  (в setTimeout)'); apply(() => setB((v) => v + 1), 'setB(b + 1)  (в setTimeout)'); end(); }, 0); };
    const inPromise = () => { begin('Два setState след await'); Promise.resolve().then(() => { apply(() => setA((v) => v + 1), 'setA(a + 1)  (след await)'); apply(() => setB((v) => v + 1), 'setB(b + 1)  (след await)'); end(); }); };
    const withFlush = () => { begin('flushSync около всяко setState'); flushSync(() => { lg.add('flushSync(() => setA(a + 1))', 'dim'); setA((v) => v + 1); }); flushSync(() => { lg.add('flushSync(() => setB(b + 1))', 'dim'); setB((v) => v + 1); }); end(); };

    return e('div', { style: { display: 'grid', gap: '10px' } },
      e('div', { className: 'w-flex' },
        e('span', { className: 'w-label' }, 'Режим'),
        e('button', { type: 'button', className: 'w-btn ' + (!legacy ? 'active' : ''), onClick: () => setLegacy(false) }, 'React 18: automatic batching'),
        e('button', { type: 'button', className: 'w-btn ' + (legacy ? 'active' : ''), onClick: () => setLegacy(true) }, 'React 17 (емулация)'),
      ),
      e('div', { className: 'w-flex' },
        e('button', { type: 'button', className: 'w-btn primary', onClick: inHandler }, 'В onClick'),
        e('button', { type: 'button', className: 'w-btn primary', onClick: inTimeout }, 'В setTimeout'),
        e('button', { type: 'button', className: 'w-btn primary', onClick: inPromise }, 'След await'),
        e('button', { type: 'button', className: 'w-btn', onClick: withFlush }, 'С flushSync'),
        e('button', { type: 'button', className: 'w-btn small', onClick: () => { lg.clear(); stat.innerHTML = ''; } }, 'Изчисти лога'),
      ),
      e('div', { className: 'w-screen' },
        e('div', { className: 'w-screen-bar' }, e('i'), e('i'), e('i')),
        e('div', { className: 'w-screen-body w-mono' }, `a = ${a}   b = ${b}   (рендер #${n})`),
      ),
    );
  }
  react(mount, Demo);
});
