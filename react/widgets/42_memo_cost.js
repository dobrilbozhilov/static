/* Истински React: измерва цената на useMemo / useCallback върху тривиални стойности. */
W.register('memo-cost', (el) => {
  const { h, shell, react, note, btn } = W;
  const body = shell(el, { title: 'Колко струва мемоизацията на тривиални стойности?', real: true, hint: 'Два еднакви компонента, единият с 10 useMemo и 10 useCallback за евтини стойности, другият без. По 2000 рендера всеки, измерено на твоята машина.' });
  const stats = h('div', { class: 'w-stats' });
  const tbl = h('div');
  const verdict = note('Натисни "Измери". Браузърът ще блокира за около секунда, докато минат 4000 рендера.');
  const hidden = h('div', { style: { position: 'absolute', left: '-9999px', width: '300px' }, 'aria-hidden': 'true' });
  const plainMount = h('div');
  const memoMount = h('div');
  hidden.append(plainMount, memoMount);
  const toolbar = h('div', { class: 'w-toolbar' });
  body.append(toolbar, stats, verdict, tbl, hidden);
  if (!window.React) { react(plainMount); return; }

  const { useState, useMemo, useCallback, createElement: e } = React;
  const { flushSync } = ReactDOM;
  const N = 2000;
  const K = 10;

  // Двата компонента правят еднаква работа; разликата е само в hook-овете.
  const plainSetter = {};
  function Plain() {
    const [x, setX] = useState(0);
    plainSetter.set = setX;
    const values = [];
    const fns = [];
    for (let i = 0; i < K; i++) { values.push({ v: x + i }); fns.push(() => x + i); }
    return e('div', null, values.map((v, i) => e('span', { key: i, onClick: fns[i] }, v.v)));
  }
  const memoSetter = {};
  function Memoized() {
    const [x, setX] = useState(0);
    memoSetter.set = setX;
    // Нарочно "разгънати" hook-ове: правилото за константен брой hooks не позволява цикъл.
    const v0 = useMemo(() => ({ v: x + 0 }), [x]); const f0 = useCallback(() => x + 0, [x]);
    const v1 = useMemo(() => ({ v: x + 1 }), [x]); const f1 = useCallback(() => x + 1, [x]);
    const v2 = useMemo(() => ({ v: x + 2 }), [x]); const f2 = useCallback(() => x + 2, [x]);
    const v3 = useMemo(() => ({ v: x + 3 }), [x]); const f3 = useCallback(() => x + 3, [x]);
    const v4 = useMemo(() => ({ v: x + 4 }), [x]); const f4 = useCallback(() => x + 4, [x]);
    const v5 = useMemo(() => ({ v: x + 5 }), [x]); const f5 = useCallback(() => x + 5, [x]);
    const v6 = useMemo(() => ({ v: x + 6 }), [x]); const f6 = useCallback(() => x + 6, [x]);
    const v7 = useMemo(() => ({ v: x + 7 }), [x]); const f7 = useCallback(() => x + 7, [x]);
    const v8 = useMemo(() => ({ v: x + 8 }), [x]); const f8 = useCallback(() => x + 8, [x]);
    const v9 = useMemo(() => ({ v: x + 9 }), [x]); const f9 = useCallback(() => x + 9, [x]);
    const values = [v0, v1, v2, v3, v4, v5, v6, v7, v8, v9];
    const fns = [f0, f1, f2, f3, f4, f5, f6, f7, f8, f9];
    return e('div', null, values.map((v, i) => e('span', { key: i, onClick: fns[i] }, v.v)));
  }
  react(plainMount, Plain);
  react(memoMount, Memoized);

  function bench(setter, changing) {
    const t0 = performance.now();
    for (let i = 1; i <= N; i++) flushSync(() => setter.set(changing ? i : 0));
    return performance.now() - t0;
  }
  const runs = [];
  const fmt = (ms) => ms.toFixed(1) + ' ms';
  function run() {
    verdict.innerHTML = 'Измервам…';
    setTimeout(() => {
      // Загрявка, после по два редуващи се прохода, за да не печели винаги вторият от JIT-а.
      bench(plainSetter, true); bench(memoSetter, true);
      const p1 = bench(plainSetter, true), m1 = bench(memoSetter, true);
      const m2 = bench(memoSetter, true), p2 = bench(plainSetter, true);
      const p3 = bench(plainSetter, false), m3 = bench(memoSetter, false);
      const plain = (p1 + p2) / 2, memo = (m1 + m2) / 2;
      runs.push({ plain, memo, plainSame: p3, memoSame: m3 });
      const diff = memo - plain;
      const pct = (diff / plain) * 100;
      stats.innerHTML = '';
      stats.append(
        h('div', { class: 'w-stat' }, h('b', {}, fmt(plain)), h('span', {}, `без мемоизация, ${N} рендера с променящ се x`)),
        h('div', { class: 'w-stat ' + (diff > 0 ? 'c-warn' : 'c-ok') }, h('b', {}, fmt(memo)), h('span', {}, `с ${K} useMemo + ${K} useCallback`)),
        h('div', { class: 'w-stat' }, h('b', {}, (diff >= 0 ? '+' : '') + fmt(diff)), h('span', {}, `разлика (${pct >= 0 ? '+' : ''}${pct.toFixed(0)} %), ${(diff * 1000 / N).toFixed(1)} µs на рендер`)),
        h('div', { class: 'w-stat' }, h('b', {}, fmt(m3)), h('span', {}, `с мемоизация, x не се променя (deps съвпадат); без: ${fmt(p3)}`)),
      );
      verdict.innerHTML = diff > 0
        ? `<b>Измерено:</b> мемоизираната версия е с ${fmt(diff)} по-бавна за ${N} рендера, тоест около ${(diff * 1000 / N).toFixed(1)} µs на рендер за ${K * 2} hook-а. Малко е, но е чиста загуба: deps се сравняват с Object.is при всеки рендер и старите стойности остават в паметта, а полза няма, защото стойностите са евтини. Колоната "x не се променя" показва, че и когато кешът улучва, печалбата при тривиални стойности е незначителна.`
        : `<b>Измерено:</b> този път мемоизираната версия излезе с ${fmt(-diff)} по-бърза. При толкова евтини стойности разликата е в рамките на шума (JIT, GC, други табове). Пусни още веднъж. Изводът остава: за тривиални стойности мемоизацията не носи измерима полза, а добавя код и памет.`;
      tbl.innerHTML = '';
      tbl.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'без memo'), h('th', {}, 'с memo'), h('th', {}, 'разлика'), h('th', {}, 'без memo, x същото'), h('th', {}, 'с memo, x същото'))),
        h('tbody', {}, runs.map((r, i) => h('tr', {}, h('td', {}, String(i + 1)), h('td', {}, fmt(r.plain)), h('td', {}, fmt(r.memo)), h('td', {}, (r.memo - r.plain >= 0 ? '+' : '') + fmt(r.memo - r.plain)), h('td', {}, fmt(r.plainSame)), h('td', {}, fmt(r.memoSame))))))));
    }, 30);
  }
  toolbar.append(btn('Измери', run, 'primary'), btn('Изчисти', () => { runs.length = 0; stats.innerHTML = ''; tbl.innerHTML = ''; }, 'small'));
});
