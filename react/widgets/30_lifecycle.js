/* Истински React: класов и функционален компонент логват всяко извикване на метод или hook. */
W.register('lifecycle-log', (el) => {
  const { h, shell, log, react } = W;
  const body = shell(el, { title: 'Ред на извикване: клас срещу hooks', real: true, hint: 'Натискай действията и сравнявай двата лога. Всеки ред е истинско извикване.' });

  const lgC = log({ title: 'Класов компонент' });
  const lgH = log({ title: 'Функционален компонент (hooks)' });
  const phases = ['Mount', 'Update', 'Unmount'];
  const phaseChips = phases.map((p) => h('span', { class: 'w-chip' }, p));
  const phaseEl = h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'Фаза'), ...phaseChips);
  const setPhase = (p) => phaseChips.forEach((c, i) => c.classList.toggle('c-accent', phases[i] === p));
  const noteEl = W.note('Натисни "Монтирай". Двата компонента се монтират едновременно, а логовете показват кои методи и hooks се извикват и в какъв ред.');
  const mount = h('div');
  body.append(mount, phaseEl, noteEl, h('div', { class: 'w-grid-2' }, lgC.el, lgH.el));
  if (!window.React) { react(mount); return; }

  const { useState, useRef, useEffect, useLayoutEffect, createElement: e, Component } = React;
  const C = (msg, cls = 'info') => lgC.add(msg, cls);
  const H = (msg, cls = 'purple') => lgH.add(msg, cls);
  const both = (msg, cls) => { C(msg, cls); H(msg, cls); };

  class ClassChild extends Component {
    constructor(props) {
      super(props);
      this.state = { count: 0, lastValue: props.value };
      C('constructor(props)');
    }
    static getDerivedStateFromProps(props, state) {
      C('static getDerivedStateFromProps(props, state)');
      return props.value !== state.lastValue ? { lastValue: props.value } : null;
    }
    shouldComponentUpdate() { C('shouldComponentUpdate(nextProps, nextState) → true'); return true; }
    render() {
      C('render()', 'info strong');
      return e('div', { className: 'w-screen' },
        e('div', { className: 'w-screen-bar' }, e('i'), e('i'), e('i')),
        e('div', { className: 'w-screen-body' },
          e('div', { className: 'w-mono' }, `class  value=${this.props.value}  count=${this.state.count}`),
          e('button', { type: 'button', className: 'w-btn small', style: { marginTop: '8px' }, onClick: () => { setPhase('Update'); both('▶ setState отвътре (само класът)', 'strong sep'); this.setState((s) => ({ count: s.count + 1 })); } }, 'this.setState({ count + 1 })'),
        ),
      );
    }
    componentDidMount() { C('componentDidMount()', 'ok'); }
    getSnapshotBeforeUpdate() { C('getSnapshotBeforeUpdate(prevProps, prevState) → null', 'warn'); return null; }
    componentDidUpdate() { C('componentDidUpdate(prevProps, prevState, snapshot)', 'ok'); }
    componentWillUnmount() { C('componentWillUnmount()', 'bad'); }
  }

  function HookChild({ value }) {
    const [count, setCount] = useState(() => { H('useState: инициализаторът се вика само при mount'); return 0; });
    const renders = useRef(0);
    renders.current++;
    H(`тялото на функцията (render #${renders.current})`, 'purple strong');
    useLayoutEffect(() => {
      H('useLayoutEffect', 'ok');
      return () => H('cleanup на useLayoutEffect', 'bad');
    });
    useEffect(() => {
      H('useEffect', 'ok');
      return () => H('cleanup на useEffect', 'bad');
    });
    return e('div', { className: 'w-screen' },
      e('div', { className: 'w-screen-bar' }, e('i'), e('i'), e('i')),
      e('div', { className: 'w-screen-body' },
        e('div', { className: 'w-mono' }, `hooks  value=${value}  count=${count}`),
        e('button', { type: 'button', className: 'w-btn small', style: { marginTop: '8px' }, onClick: () => { setPhase('Update'); both('▶ setState отвътре (само hooks)', 'strong sep'); setCount((c) => c + 1); } }, 'setCount(count + 1)'),
      ),
    );
  }

  function Parent() {
    const [mounted, setMounted] = useState(false);
    const [value, setValue] = useState(1);
    const [, bump] = useState(0);
    const act = (label, phase, fn, text) => () => { setPhase(phase); both('▶ ' + label, 'strong sep'); noteEl.innerHTML = text; fn(); };
    const bar = e('div', { className: 'w-flex' },
      e('button', { type: 'button', className: 'w-btn primary', disabled: mounted, onClick: act('Монтирай', 'Mount', () => setMounted(true), '<b>Mount</b>: класът минава през constructor, getDerivedStateFromProps, render, после componentDidMount. Функцията се изпълнява цялата (useState инициализаторът е вътре), след това layout ефектът и накрая useEffect.') }, 'Монтирай'),
      e('button', { type: 'button', className: 'w-btn', disabled: !mounted, onClick: act('Промени prop от родителя (value + 1)', 'Update', () => setValue((v) => v + 1), '<b>Update от нов prop</b>: класът минава през getDerivedStateFromProps, shouldComponentUpdate, render, getSnapshotBeforeUpdate (между render и DOM промяната), componentDidUpdate. При hooks: ново изпълнение на функцията, после cleanup на старите ефекти и новите ефекти.') }, 'Промени prop'),
      e('button', { type: 'button', className: 'w-btn', disabled: !mounted, onClick: act('Пререндерирай родителя със същите props', 'Update', () => bump((x) => x + 1), '<b>Родителят се рендерира, props са същите</b>: и двата компонента се рендерират пак. Класът пита shouldComponentUpdate (връща true, затова продължава), а функцията няма никаква защита: само React.memo би я спряла. Виж страницата "Кога се пререндерира".') }, 'Родител със същите props'),
      e('button', { type: 'button', className: 'w-btn danger', disabled: !mounted, onClick: act('Демонтирай', 'Unmount', () => setMounted(false), '<b>Unmount</b>: класът получава componentWillUnmount. При hooks се изпълняват cleanup функциите на всички ефекти. Няма render.') }, 'Демонтирай'),
      e('button', { type: 'button', className: 'w-btn small', onClick: () => { lgC.clear(); lgH.clear(); } }, 'Изчисти логовете'),
    );
    return e('div', { style: { display: 'grid', gap: '10px' } },
      bar,
      mounted ? e('div', { className: 'w-grid-2' }, e(ClassChild, { value }), e(HookChild, { value })) : e('p', { className: 'w-small', style: { margin: 0 } }, 'Нищо не е монтирано.'),
    );
  }
  react(mount, Parent);
});
