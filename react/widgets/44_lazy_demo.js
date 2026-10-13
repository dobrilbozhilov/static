/* Истински React: React.lazy + Suspense с фалшив import(), с и без startTransition при превключване. */
W.register('lazy-suspense', (el) => {
  const { h, shell, react, log, note } = W;
  const body = shell(el, { title: 'React.lazy и Suspense на живо', real: true, hint: 'Модулите "пътуват" 1500 ms. Второто показване е мигновено, защото lazy помни модула.' });
  const mount = h('div');
  const lg = log({ title: 'Лог' });
  const noteEl = note('Избери таб. Без transition React сменя съдържанието с fallback-а веднага; с transition старият таб остава видим, докато chunk-ът пристигне.');
  body.append(mount, noteEl, lg.el);
  if (!window.React) { react(mount); return; }

  const { useState, useEffect, useTransition, Suspense, lazy, createElement: e } = React;
  const t0 = performance.now();
  const stamp = () => `${((performance.now() - t0) / 1000).toFixed(2)} s`;

  function Panel({ name, color }) {
    useEffect(() => { lg.add(`${stamp()}  <${name}/> рендериран и в DOM`, 'ok'); }, [name]);
    return e('div', { className: 'w-screen-body', style: { borderLeft: `4px solid var(--${color})`, minHeight: '90px' } },
      e('b', null, name === 'Chart' ? 'Графика' : 'Таблица'), e('p', { className: 'w-small', style: { margin: '6px 0 0' } }, `Това е компонентът ${name}, дошъл от отделен chunk.`));
  }
  const Chart = (p) => e(Panel, { ...p, name: 'Chart', color: 'info' });
  const Table = (p) => e(Panel, { ...p, name: 'Table', color: 'purple' });

  // Фалшив import(): обещание, което се изпълнява след 1500 ms. React.lazy кешира резултата.
  const fakeImport = (name, Comp) => () => {
    lg.add(`${stamp()}  import("./${name}.js") извикан: браузърът иска chunk-а`, 'info');
    return new Promise((res) => setTimeout(() => { lg.add(`${stamp()}  ${name}.chunk.js пристигна (1500 ms)`, 'warn'); res({ default: Comp }); }, 1500));
  };
  const makeLazies = () => ({ Chart: lazy(fakeImport('Chart', Chart)), Table: lazy(fakeImport('Table', Table)) });

  function Demo() {
    const [gen, setGen] = useState(0);
    const [lazies, setLazies] = useState(makeLazies);
    const [tab, setTab] = useState('none');
    const [useTr, setUseTr] = useState(false);
    const [isPending, startTransition] = useTransition();
    const go = (t) => {
      lg.add(`${stamp()}  клик: покажи ${t}${useTr ? ' (в startTransition)' : ''}`, 'strong sep');
      if (useTr) startTransition(() => setTab(t)); else setTab(t);
    };
    const reset = () => { setLazies(makeLazies()); setTab('none'); setGen((g) => g + 1); lg.clear(); lg.add('нови lazy компоненти: кешът е празен', 'dim'); };
    const Current = tab === 'Chart' ? lazies.Chart : tab === 'Table' ? lazies.Table : null;
    return e('div', { style: { display: 'grid', gap: '10px' } },
      e('div', { className: 'w-flex' },
        e('button', { type: 'button', className: 'w-btn primary', onClick: () => go('Chart') }, 'Покажи графиката'),
        e('button', { type: 'button', className: 'w-btn primary', onClick: () => go('Table') }, 'Покажи таблицата'),
        e('label', { className: 'w-toggle' }, e('input', { type: 'checkbox', checked: useTr, onChange: (ev) => setUseTr(ev.target.checked) }), 'превключвай със startTransition'),
        e('button', { type: 'button', className: 'w-btn small', onClick: reset }, 'Нулирай кеша'),
      ),
      e('div', { className: 'w-screen', key: gen, style: { opacity: isPending ? 0.6 : 1, transition: 'opacity 0.2s' } },
        e('div', { className: 'w-screen-bar' }, e('i'), e('i'), e('i'), isPending ? e('span', { className: 'w-chip c-warn', style: { marginLeft: 'auto' } }, 'isPending: зареждам следващия таб') : null),
        e(Suspense, { fallback: e('div', { className: 'w-screen-body', style: { color: 'var(--warn)' } }, '⏳ Suspense fallback: Зареждам…') },
          Current ? e(Current) : e('div', { className: 'w-screen-body w-small' }, 'Нищо не е заредено. Началният bundle не съдържа Chart и Table.')),
      ),
    );
  }
  react(mount, Demo);
});
