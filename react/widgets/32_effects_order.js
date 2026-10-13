/* Истински React: редът на insertion / layout / passive ефекти и cleanup при mount, update и unmount. */
W.register('effects-order', (el) => {
  const { h, shell, log, react, note } = W;
  const body = shell(el, { title: 'Ред на ефектите: Parent, Child A, Child B', real: true, hint: 'Времената са в ms от началото на действието. Редът "paint" е requestAnimationFrame кадър.' });

  const lg = log({ title: 'Лог' });
  const noteEl = note('Натисни "Монтирай". Гледай кои ефекти се изпълняват първи: на децата или на родителя, и къде попада кадърът на браузъра.');
  const mount = h('div');
  body.append(mount, noteEl, lg.el);
  if (!window.React) { react(mount); return; }

  const { useState, useEffect, useLayoutEffect, useInsertionEffect, createElement: e } = React;
  let t0 = 0;
  const ms = () => (performance.now() - t0).toFixed(1).padStart(6) + ' ms  ';
  const KIND = { insertion: 'purple', layout: 'warn', passive: 'ok' };

  function useLogged(name) {
    useInsertionEffect(() => { lg.add(ms() + `useInsertionEffect  ${name}`, KIND.insertion); return () => lg.add(ms() + `cleanup insertion   ${name}`, 'dim'); });
    useLayoutEffect(() => { lg.add(ms() + `useLayoutEffect     ${name}`, KIND.layout); return () => lg.add(ms() + `cleanup layout      ${name}`, 'dim'); });
    useEffect(() => { lg.add(ms() + `useEffect           ${name}`, KIND.passive); return () => lg.add(ms() + `cleanup passive     ${name}`, 'dim'); });
  }
  function Child({ name, tick }) {
    useLogged(name);
    lg.add(ms() + `render              ${name}`, 'info');
    return e('span', { className: 'w-node' }, `${name} (${tick})`);
  }
  function Parent({ tick }) {
    useLogged('Parent');
    lg.add(ms() + `render              Parent`, 'info');
    return e('div', { className: 'w-flex' }, e('span', { className: 'w-node is-current' }, `Parent (${tick})`), e(Child, { name: 'Child A', tick }), e(Child, { name: 'Child B', tick }));
  }

  function paintMarker() {
    requestAnimationFrame(() => lg.add(ms() + '🎨 кадър: браузърът рисува (requestAnimationFrame)', 'bad strong'));
  }

  function Host() {
    const [mounted, setMounted] = useState(false);
    const [tick, setTick] = useState(0);
    const begin = (label, text) => { t0 = performance.now(); lg.add('▶ ' + label, 'strong sep'); noteEl.innerHTML = text; paintMarker(); };
    return e('div', { style: { display: 'grid', gap: '10px' } },
      e('div', { className: 'w-flex' },
        e('button', { type: 'button', className: 'w-btn primary', disabled: mounted, onClick: () => { begin('Монтирай (от клик)', '<b>Mount</b>: първо render на Parent, после на децата (отгоре надолу). Ефектите вървят обратно: деца преди родител, и по вид: всички insertion, после всички layout, после всички passive. Понеже обновлението е от клик (SyncLane), React 18 изпълнява и passive ефектите синхронно, преди кадъра.'); setMounted(true); } }, 'Монтирай'),
        e('button', { type: 'button', className: 'w-btn', disabled: !mounted, onClick: () => { begin('Обнови от клик (SyncLane)', '<b>Update от клик</b>: render на всички, после cleanup на старите layout ефекти (деца първо), новите layout ефекти, после cleanup на passive и новите passive. Всичко това преди кадъра, защото обновлението е дискретно събитие.'); setTick((t) => t + 1); } }, 'Обнови от клик'),
        e('button', { type: 'button', className: 'w-btn', disabled: !mounted, onClick: () => { begin('Обнови от setTimeout (DefaultLane)', '<b>Update от setTimeout</b>: същият ред, но passive ефектите са планирани като отделна задача след commit. Обикновено кадърът на браузъра се вмъква между layout и passive ефектите. Това не е гарантирано: ако няма чакащ кадър, задачата може да мине първа.'); setTimeout(() => { paintMarker(); setTick((t) => t + 1); }, 0); } }, 'Обнови от setTimeout'),
        e('button', { type: 'button', className: 'w-btn danger', disabled: !mounted, onClick: () => { begin('Демонтирай', '<b>Unmount</b>: няма render. Cleanup на insertion и layout ефектите в mutation фазата (родител преди деца тук, защото React обхожда изтритото поддърво отгоре надолу), после cleanup на passive.'); setMounted(false); } }, 'Демонтирай'),
        e('button', { type: 'button', className: 'w-btn small', onClick: () => lg.clear() }, 'Изчисти'),
      ),
      e('div', { className: 'w-screen' }, e('div', { className: 'w-screen-bar' }, e('i'), e('i'), e('i')), e('div', { className: 'w-screen-body' }, mounted ? e(Parent, { tick }) : e('span', { className: 'w-small' }, 'Нищо не е монтирано.'))),
    );
  }
  react(mount, Host);
});
