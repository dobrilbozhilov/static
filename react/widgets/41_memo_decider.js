/* Решавач: трябва ли ми useMemo / useCallback? Въпрос по въпрос до извод с код. */
W.register('memo-decider', (el) => {
  const { h, shell, btn, code } = W;
  const body = shell(el, { title: 'Трябва ли ми useMemo или useCallback?', hint: 'Отговаряй с Да или Не. Пътеката показва как стигна до извода.' });

  const TREE = {
    q1: { q: 'Стойността подава ли се като prop на компонент с React.memo, или е dependency на useEffect / useMemo / useCallback?', yes: 'q2', no: 'q4' },
    q2: { q: 'Стойността обект, масив или функция ли е (референтен тип)?', yes: 'q3', no: 'C' },
    q3: { q: 'Създава ли се наново при всеки рендер (inline литерал, inline функция, .map(), .filter())?', yes: 'A', no: 'B' },
    q4: { q: 'Изчислението отнема ли повече от около 1 ms? (измерено с Profiler или performance.now, не на око)', yes: 'q5', no: 'F' },
    q5: { q: 'Входовете му (бъдещите deps) променят ли се по-рядко, отколкото компонентът се рендерира?', yes: 'D', no: 'E' },
    A: { ok: true, title: 'Да: трябва ти референтна стабилност', text: 'Без мемоизация всеки рендер създава нов обект или функция, React.memo вижда нов prop и детето се рендерира, а ефектът с този dependency се пуска всеки път. useMemo за обекти и масиви, useCallback за функции.', code: `const options = useMemo(() => ({ page, size }), [page, size]);
const onSelect = useCallback((id) => setSelected(id), []);

<HeavyList options={options} onSelect={onSelect} />  // HeavyList е memo()` },
    B: { ok: false, title: 'Не: референцията вече е стабилна', text: 'State от useState, props от родителя, стойност от useRef или константа извън компонента не се пресъздават при рендер. Мемоизирането им добавя сравнение на deps без никаква полза.', code: `const ITEMS = ['a', 'b'];           // модулна константа: винаги същата
function List({ onSelect }) {        // onSelect идва отгоре: родителят отговаря за стабилността
  const [query, setQuery] = useState('');  // setQuery е стабилна по гаранция на React
  ...
}` },
    C: { ok: false, title: 'Не: примитивите се сравняват по стойност', text: 'Числа, низове и булеви стойности минават през Object.is правилно без помощ: 5 е 5 и "abc" е "abc" при всеки рендер. useMemo върху примитив само добавя работа.', code: `// излишно
const total = useMemo(() => price * qty, [price, qty]);
// достатъчно
const total = price * qty;` },
    D: { ok: true, title: 'Да: useMemo за скъпото изчисление', text: 'Изчислението е бавно и входовете му се менят рядко, значи кешът ще се използва често. Това е класическият случай за useMemo. Запиши в коментар измерването, за да знае следващият защо е там.', code: `// измерено: 8 ms при 5 000 реда
const sorted = useMemo(
  () => [...rows].sort(compare),
  [rows, compare],
);` },
    E: { ok: false, title: 'Не помага: кешът никога няма да улучи', text: 'Ако deps се променят при всеки рендер, useMemo прави изчислението всеки път плюс сравнението на deps. Решението е другаде: по-малко рендери (виж Кога се пререндерира), изчисление извън компонента, web worker или виртуализация.', code: `// deps се сменят всеки рендер: useMemo е само overhead
const result = useMemo(() => heavy(data, Date.now()), [data, Date.now()]);

// по-добре: намали рендерите или премести работата
const result = heavy(data);   // и React.memo на родителя, или useDeferredValue` },
    F: { ok: false, title: 'Не: това е преоптимизация', text: 'Изчислението е евтино и стойността не минава през мемоизирана граница. Най-добрият код е най-простият. Ако по-късно профилирането покаже проблем, ще го добавиш с измерване.', code: `// просто и четимо
const label = \`\${first} \${last}\`;
const visible = items.filter((i) => !i.hidden);` },
  };

  const path = h('div', { class: 'w-flex' });
  const qBox = h('div', { class: 'w-panel' });
  const out = h('div');
  const toolbar = h('div', { class: 'w-toolbar' }, btn('↺ Отначало', () => start()));
  body.append(path, qBox, out, toolbar);

  let trail = [];
  function render(id) {
    const node = TREE[id];
    qBox.innerHTML = '';
    out.innerHTML = '';
    path.innerHTML = '';
    trail.forEach((t, i) => path.append(h('span', { class: 'w-chip ' + (t.a ? 'c-ok' : 'c-bad') }, `${i + 1}. ${t.a ? 'Да' : 'Не'}: ${t.short}`)));
    if (node.q) {
      qBox.append(h('div', { class: 'w-panel-title' }, `Въпрос ${trail.length + 1}`), h('p', { style: { margin: '0 0 10px', fontSize: '15px', fontWeight: 600 } }, node.q),
        h('div', { class: 'w-flex' },
          btn('Да', () => { trail.push({ a: true, short: node.q.split(' ').slice(0, 4).join(' ') + '…' }); render(node.yes); }, 'primary'),
          btn('Не', () => { trail.push({ a: false, short: node.q.split(' ').slice(0, 4).join(' ') + '…' }); render(node.no); })));
    } else {
      qBox.append(h('div', { class: 'w-panel-title' }, 'Извод'),
        h('div', { class: 'w-flex' }, h('span', { class: 'w-chip ' + (node.ok ? 'c-ok' : 'c-warn') }, node.ok ? 'мемоизирай' : 'не мемоизирай'), h('b', { style: { fontSize: '15px' } }, node.title)),
        h('p', { style: { margin: '8px 0 0', fontSize: '14px' } }, node.text));
      out.append(code(node.code, 'javascript'));
    }
  }
  function start() { trail = []; render('q1'); }
  start();
});
