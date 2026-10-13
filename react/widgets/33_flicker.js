/* Истински React: кутия, която се позиционира в ефект. useEffect мига, useLayoutEffect замръзва. */
W.register('layout-flicker', (el) => {
  const { h, shell, react, note, busy } = W;
  const body = shell(el, { title: 'Мигане срещу замръзване', real: true, hint: 'Кутията се рендерира в горния ляв ъгъл, после ефектът я мести в центъра. Изчислението е нарочно бавно (250 ms).' });

  const noteEl = note('Избери кой ефект да се ползва и натисни "Покажи кутията". Гледай и броячът на кадри долу: той върви с requestAnimationFrame и спира, когато главната нишка е заета.');
  const mount = h('div');
  body.append(mount, noteEl);
  if (!window.React) { react(mount); return; }

  const { useState, useEffect, useLayoutEffect, useRef, createElement: e } = React;

  function makeBox(useWhichEffect, label) {
    return function Box({ onDone }) {
      const ref = useRef(null);
      const [pos, setPos] = useState({ x: 0, y: 0, ready: false });
      useWhichEffect(() => {
        const parent = ref.current.parentElement.getBoundingClientRect();
        const me = ref.current.getBoundingClientRect();
        busy(250);   // имитира скъпо измерване или изчисление на позиция
        setPos({ x: (parent.width - me.width) / 2, y: (parent.height - me.height) / 2, ready: true });
        onDone(label);
      }, []);
      return e('div', { ref, className: 'w-node is-dirty', style: { position: 'absolute', left: pos.x + 'px', top: pos.y + 'px', padding: '10px 14px' } }, pos.ready ? 'вече в центъра' : 'в ъгъла (грешна позиция)');
    };
  }
  const EffectBox = makeBox(useEffect, 'useEffect');
  const LayoutBox = makeBox(useLayoutEffect, 'useLayoutEffect');

  function Demo() {
    const [kind, setKind] = useState('effect');
    const [shown, setShown] = useState(0);
    const frameRef = useRef(null);
    useEffect(() => {
      let id, n = 0;
      const loop = () => { n++; if (frameRef.current) frameRef.current.textContent = `кадри: ${n}`; id = requestAnimationFrame(loop); };
      id = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(id);
    }, []);
    const Box = kind === 'effect' ? EffectBox : LayoutBox;
    const done = (label) => {
      noteEl.innerHTML = label === 'useEffect'
        ? '<b>useEffect</b>: браузърът нарисува кутията в ъгъла, после ефектът я премести. Потребителят видя скок (мигане), но интерфейсът не замръзна: броячът на кадри продължи да върви.'
        : '<b>useLayoutEffect</b>: ефектът се изпълни преди paint, затова кутията се появи направо в центъра. Цената: главната нишка беше блокирана 250 ms и броячът на кадри спря за това време.';
    };
    return e('div', { style: { display: 'grid', gap: '10px' } },
      e('div', { className: 'w-flex' },
        e('span', { className: 'w-label' }, 'Ефект'),
        e('button', { type: 'button', className: 'w-btn ' + (kind === 'effect' ? 'active' : ''), onClick: () => { setKind('effect'); setShown(0); } }, 'useEffect'),
        e('button', { type: 'button', className: 'w-btn ' + (kind === 'layout' ? 'active' : ''), onClick: () => { setKind('layout'); setShown(0); } }, 'useLayoutEffect'),
        // Обновлението се пуска от setTimeout, не директно от клика: при клик (SyncLane) React 18
        // изпълнява и passive ефектите преди paint и мигането не би се видяло.
        e('button', { type: 'button', className: 'w-btn primary', onClick: () => setTimeout(() => setShown((s) => s + 1), 0) }, 'Покажи кутията'),
        e('span', { ref: frameRef, className: 'w-chip' }, 'кадри: 0'),
      ),
      e('div', { className: 'w-screen' },
        e('div', { className: 'w-screen-bar' }, e('i'), e('i'), e('i')),
        e('div', { className: 'w-screen-body', style: { position: 'relative', height: '160px' } },
          shown ? e(Box, { key: shown + kind, onDone: done }) : e('span', { className: 'w-small' }, 'Натисни "Покажи кутията".'),
        ),
      ),
    );
  }
  react(mount, Demo);
});
