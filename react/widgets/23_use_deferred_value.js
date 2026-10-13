/* Истински React: един и същ тежък списък, захранван директно, през useDeferredValue или през debounce.
   Брои рендерите на списъка и мери кога той догонва полето. */
W.register('use-deferred-value', (el) => {
  const { h, shell, react, busy } = W;
  const body = shell(el, { title: 'Стойност, която изостава нарочно', real: true, hint: 'Пиши бързо. Чипът "изостава" свети, докато списъкът показва стара стойност.' });
  const mount = h('div');
  body.append(mount);
  if (!window.React) { react(mount); return; }

  const { useState, useDeferredValue, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo, createElement: e } = React;
  const WORDS = ['ябълка', 'круша', 'банан', 'череша', 'слива', 'диня', 'пъпеш', 'грозде', 'киви', 'манго', 'лимон', 'ягода'];
  const ITEMS = Array.from({ length: 3000 }, (_, i) => `${WORDS[i % WORDS.length]} ${WORDS[(i * 5) % WORDS.length]} · ред ${i + 1}`);

  function Row({ text }) {
    busy(0.08);
    return e('div', { className: 'cc-row' }, text);
  }
  // React.memo е задължително: иначе родителят би рендерирал списъка и при спешния рендер.
  const List = memo(function List({ filter, onRendered }) {
    const items = useMemo(() => (filter ? ITEMS.filter((s) => s.includes(filter.toLowerCase())) : ITEMS), [filter]);
    useLayoutEffect(() => { onRendered(filter); });
    return e('div', { className: 'cc-list' },
      items.length ? items.map((s) => e(Row, { key: s, text: s })) : e('div', { className: 'cc-empty' }, 'Няма съвпадения'));
  });

  function Demo() {
    const [mode, setMode] = useState('deferred');
    const [value, setValue] = useState('');
    const deferred = useDeferredValue(value);
    const [debounced, setDebounced] = useState('');
    const [letterMs, setLetterMs] = useState(null);
    const [catchUpMs, setCatchUpMs] = useState(null);
    const [listRenders, setListRenders] = useState(0);
    const keyT = useRef(0);
    const latest = useRef('');
    const measured = useRef('');

    useEffect(() => {
      if (mode !== 'debounce') return;
      const id = setTimeout(() => setDebounced(value), 300);
      return () => clearTimeout(id);
    }, [value, mode]);

    const filter = mode === 'deferred' ? deferred : mode === 'debounce' ? debounced : value;
    const stale = filter !== value;

    useLayoutEffect(() => { if (keyT.current) setLetterMs(performance.now() - keyT.current); }, [value]);
    const onRendered = useCallback((f) => {
      setListRenders((n) => n + 1);
      if (f === latest.current && f !== measured.current && keyT.current) { measured.current = f; setCatchUpMs(performance.now() - keyT.current); }
    }, []);

    const onChange = (ev) => { latest.current = ev.target.value; keyT.current = performance.now(); setValue(ev.target.value); };
    const switchMode = (m) => { setMode(m); setValue(''); setDebounced(''); setLetterMs(null); setCatchUpMs(null); setListRenders(0); latest.current = ''; measured.current = ''; keyT.current = 0; };

    const stat = (label, v, good) => e('div', { className: 'w-stat ' + (v == null ? '' : good ? 'c-ok' : 'c-bad') }, e('b', null, v == null ? '–' : v.toFixed(0) + ' ms'), e('span', null, label));
    const EXPLAIN = {
      direct: 'Списъкът получава стойността директно: всяка буква е спешен рендер на 3000 реда. Полето чака.',
      deferred: 'useDeferredValue връща старата стойност в спешния рендер (списъкът не се пипа заради React.memo), после планира transition рендер с новата. Догонва веднага щом има свободно време.',
      debounce: 'Debounce чака фиксирани 300 ms тишина и чак тогава сменя стойността. Рендерът след това е спешен и блокира, а на бърза машина чакането е излишно.',
    };

    return e('div', { style: { display: 'grid', gap: '10px' } },
      e('div', { className: 'w-flex' },
        e('span', { className: 'w-label' }, 'Списъкът получава'),
        ['direct', 'deferred', 'debounce'].map((m) => e('button', { key: m, type: 'button', className: 'w-btn ' + (mode === m ? 'active' : ''), onClick: () => switchMode(m) }, m === 'direct' ? 'стойността директно' : m === 'deferred' ? 'useDeferredValue(value)' : 'debounce 300 ms')),
      ),
      e('input', { className: 'w-input', style: { width: '100%' }, value, onChange, placeholder: 'Търси: ябълка, киви, ред 25…', autoComplete: 'off' }),
      e('div', { className: 'w-flex' },
        e('span', { className: 'w-chip' }, 'value = "' + value + '"'),
        e('span', { className: 'w-chip ' + (stale ? 'c-warn' : 'c-ok') }, stale ? 'списъкът изостава: filter = "' + filter + '"' : 'списъкът е актуален'),
      ),
      e('div', { className: 'w-stats' },
        stat('от клавиша до буквата', letterMs, letterMs < 50),
        stat('от клавиша до актуален списък', catchUpMs, true),
        e('div', { className: 'w-stat' }, e('b', null, String(listRenders)), e('span', null, 'рендера на списъка')),
      ),
      e('div', { className: 'w-small' }, EXPLAIN[mode]),
      e('div', { className: stale ? 'cc-stale' : '' }, e(List, { filter, onRendered })),
    );
  }
  react(mount, Demo);
});
