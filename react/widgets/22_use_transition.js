/* Истински React: търсене в умишлено тежък списък, с и без useTransition. Измерва се времето
   от клавиша до появата на буквата и времето до актуален списък. */
W.register('use-transition', (el) => {
  const { h, shell, react, busy } = W;
  const body = shell(el, { title: 'Търсене в тежък списък: със и без transition', real: true, hint: 'Пиши бързо в полето. Всеки ред струва ~0.06 ms нарочно, за да е пълният рендер няколкостотин ms.' });
  const mount = h('div');
  body.append(mount);
  if (!window.React) { react(mount); return; }

  const { useState, useTransition, useRef, useLayoutEffect, useMemo, useCallback, memo, createElement: e } = React;
  const WORDS = ['ябълка', 'круша', 'банан', 'череша', 'слива', 'диня', 'пъпеш', 'грозде', 'киви', 'манго', 'лимон', 'ягода', 'малина', 'смокиня', 'праскова', 'кайсия'];
  const CITIES = ['София', 'Пловдив', 'Варна', 'Бургас', 'Русе', 'Плевен', 'Габрово', 'Видин', 'Ловеч', 'Шумен'];
  const ITEMS = Array.from({ length: 5000 }, (_, i) => `${WORDS[i % WORDS.length]} от ${CITIES[(i * 7) % CITIES.length]} · партида ${1000 + i}`);

  function Row({ text }) {
    busy(0.06);
    return e('div', { className: 'cc-row' }, text);
  }
  // pending не се подава на List: смяна на prop би рендерирала 5000 реда в спешния рендер.
  const List = memo(function List({ filter, onRendered }) {
    const t0 = performance.now();
    const items = useMemo(() => (filter ? ITEMS.filter((s) => s.includes(filter.toLowerCase())) : ITEMS), [filter]);
    useLayoutEffect(() => { onRendered(filter, items.length, performance.now() - t0); });
    return e('div', { className: 'cc-list' },
      items.length ? items.map((s) => e(Row, { key: s, text: s })) : e('div', { className: 'cc-empty' }, 'Няма съвпадения'));
  });

  function Demo() {
    const [mode, setMode] = useState('transition');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('');
    const [isPending, startTransition] = useTransition();
    const [letterMs, setLetterMs] = useState(null);
    const [listMs, setListMs] = useState(null);
    const [info, setInfo] = useState({ n: ITEMS.length, ms: 0 });
    const keyT = useRef(0);
    const latest = useRef('');

    // Буквата е "показана" когато рендерът с новото query стигне до commit.
    useLayoutEffect(() => { if (keyT.current) setLetterMs(performance.now() - keyT.current); }, [query]);

    // Layout ефектът на детето тече преди този на родителя, затова keyT не се нулира тук.
    const measured = useRef('');
    const onRendered = useCallback((f, n, ms) => {
      setInfo({ n, ms });
      if (f === latest.current && f !== measured.current && keyT.current) { measured.current = f; setListMs(performance.now() - keyT.current); }
    }, []);

    const onChange = (ev) => {
      const v = ev.target.value;
      latest.current = v;
      keyT.current = performance.now();
      setQuery(v);
      if (mode === 'transition') startTransition(() => setFilter(v));
      else setFilter(v);
    };
    const switchMode = (m) => { setMode(m); setQuery(''); setFilter(''); setLetterMs(null); setListMs(null); latest.current = ''; measured.current = ''; keyT.current = 0; };

    const stat = (label, v, good) => e('div', { className: 'w-stat ' + (v == null ? '' : good ? 'c-ok' : 'c-bad') }, e('b', null, v == null ? '–' : v.toFixed(0) + ' ms'), e('span', null, label));

    return e('div', { style: { display: 'grid', gap: '10px' } },
      e('div', { className: 'w-flex' },
        e('span', { className: 'w-label' }, 'Режим'),
        e('button', { type: 'button', className: 'w-btn ' + (mode === 'sync' ? 'active' : ''), onClick: () => switchMode('sync') }, 'Без transition'),
        e('button', { type: 'button', className: 'w-btn ' + (mode === 'transition' ? 'active' : ''), onClick: () => switchMode('transition') }, 'С useTransition'),
      ),
      e('input', { className: 'w-input', style: { width: '100%' }, value: query, onChange, placeholder: 'Търси: ябълка, Варна, 1234…', autoComplete: 'off' }),
      e('div', { className: 'w-stats' },
        stat('от клавиша до буквата', letterMs, letterMs < 50),
        stat('от клавиша до актуален списък', listMs, true),
        e('div', { className: 'w-stat' }, e('b', null, String(info.n)), e('span', null, 'реда в списъка')),
        e('div', { className: 'w-stat ' + (isPending ? 'c-warn' : '') }, e('b', null, isPending ? 'да' : 'не'), e('span', null, 'isPending')),
      ),
      e('div', { className: 'w-small' }, mode === 'transition'
        ? 'setQuery е спешно (SyncLane), setFilter е в startTransition (TransitionLane). Буквата се появява веднага, списъкът догонва на порции и е полупрозрачен докато isPending е true.'
        : 'setQuery и setFilter са в една и съща лента: React рендерира полето и 5000-те реда в един синхронен рендер. Буквата чака списъка.'),
      e('div', { className: isPending ? 'cc-stale' : '' }, e(List, { filter, onRendered })),
    );
  }
  react(mount, Demo);
});
