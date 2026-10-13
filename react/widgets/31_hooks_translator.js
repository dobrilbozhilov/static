/* Преводач: класова концепция -> еквивалент с hooks, с код, нюанси и степен на съответствие. */
W.register('hooks-translator', (el) => {
  const { h, shell, code } = W;
  const body = shell(el, { title: 'Преводач: клас → hooks', hint: 'Избери класов метод и виж как се изразява с hooks и къде преводът не е точен.' });

  const items = [
    {
      name: 'componentDidMount', status: 'exact', label: 'има точен еквивалент',
      cls: `class Timer extends React.Component {
  componentDidMount() {
    this.id = setInterval(this.tick, 1000);
  }
}`,
      hook: `function Timer() {
  useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);   // празен масив: само при mount
}`,
      note: 'Разлика във времето: componentDidMount се изпълнява преди браузърът да нарисува кадъра (като useLayoutEffect), useEffect се изпълнява след това. За заявки и абонаменти това няма значение. В StrictMode (dev) ефектът се пуска, чисти и пуска пак, затова cleanup функцията е задължителна.',
    },
    {
      name: 'componentDidUpdate', status: 'exact', label: 'има точен еквивалент',
      cls: `componentDidUpdate(prevProps) {
  if (prevProps.userId !== this.props.userId) {
    this.load(this.props.userId);
  }
}`,
      hook: `useEffect(() => {
  load(userId);
}, [userId]);   // при mount И при всяка промяна на userId

// Само при update, без първия рендер:
const first = useRef(true);
useEffect(() => {
  if (first.current) { first.current = false; return; }
  load(userId);
}, [userId]);`,
      note: 'useEffect с dependencies покрива "didMount + didUpdate за тези props". Ако наистина ти трябва "само при update", ползваш ref като флаг, но обикновено това е знак, че ефектът описва момент, а не синхронизация.',
    },
    {
      name: 'componentWillUnmount', status: 'exact', label: 'има точен еквивалент',
      cls: `componentWillUnmount() {
  this.socket.close();
}`,
      hook: `useEffect(() => {
  const socket = connect(roomId);
  return () => socket.close();   // cleanup: при unmount и преди всяко ново изпълнение
}, [roomId]);`,
      note: 'Cleanup функцията се изпълнява не само при unmount, а и преди ефектът да се изпълни отново (когато roomId се смени). Така никога нямаш два отворени сокета, нещо, което с класа трябва да правиш ръчно в componentDidUpdate.',
    },
    {
      name: 'getDerivedStateFromProps', status: 'partial', label: 'частичен еквивалент',
      cls: `static getDerivedStateFromProps(props, state) {
  if (props.selectedId !== state.prevSelectedId) {
    return { prevSelectedId: props.selectedId, draft: '' };
  }
  return null;
}`,
      hook: `function Editor({ selectedId }) {
  const [draft, setDraft] = useState('');
  const [prevId, setPrevId] = useState(selectedId);
  if (selectedId !== prevId) {       // setState по време на render
    setPrevId(selectedId);           // React веднага рестартира рендера
    setDraft('');                    // без commit на междинното
  }
  // ...
}`,
      note: 'React позволява setState по време на render на същия компонент: изхвърля текущия резултат и рендерира пак с новото състояние, преди да пипне DOM и без да изпълнява ефекти. Това е точният механизъм на getDerivedStateFromProps. Най-често обаче изобщо не ти трябва state: ако стойността може да се изчисли от props, изчисли я в render (или с useMemo). Ако трябва "нулирай при смяна", по-чисто е key={selectedId} върху компонента.',
    },
    {
      name: 'shouldComponentUpdate', status: 'exact', label: 'има точен еквивалент',
      cls: `shouldComponentUpdate(nextProps) {
  return nextProps.user.id !== this.props.user.id;
}`,
      hook: `const Profile = React.memo(function Profile({ user }) {
  // ...
}, (prev, next) => prev.user.id === next.user.id);
// второ arg: "равни ли са" (обратното на shouldComponentUpdate)

// За скъпа част вътре в компонента:
const rows = useMemo(() => buildRows(data), [data]);`,
      note: 'React.memo без второ arg е PureComponent: плитко сравнение на всички props. С второ arg е shouldComponentUpdate, но обърнато: връщаш true, когато НЕ трябва да се рендерира. Виж страницата React.memo за това кога inline обекти и функции чупят сравнението.',
    },
    {
      name: 'componentDidCatch', status: 'none', label: 'няма hook',
      cls: `class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };                 // render фаза: покажи fallback
  }
  componentDidCatch(error, info) {
    reportError(error, info.componentStack);  // commit фаза: логвай
  }
  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}`,
      hook: `// Няма useErrorBoundary в React. Библиотеката react-error-boundary
// опакова същия клас в удобен API:
import { ErrorBoundary } from 'react-error-boundary';

<ErrorBoundary fallback={<p>Нещо се счупи</p>} onError={reportError}>
  <Profile />
</ErrorBoundary>`,
      note: 'Грешката се хваща в reconciler-а по време на render на децата: React търси нагоре по return указателите най-близкия fiber с getDerivedStateFromError и го рендерира наново с ново състояние. За това е нужна инстанция със state, която съществува независимо от рендера на децата, затова засега само клас. Error boundary не хваща грешки в event handler-и, в async код и в самия себе си.',
    },
    {
      name: 'this.timer (instance поле)', status: 'exact', label: 'има точен еквивалент',
      cls: `componentDidMount() {
  this.timer = setTimeout(this.hide, 3000);
}
componentWillUnmount() {
  clearTimeout(this.timer);
}`,
      hook: `const timer = useRef(null);   // стойност, която живее между рендерите
useEffect(() => {
  timer.current = setTimeout(hide, 3000);
  return () => clearTimeout(timer.current);
}, []);`,
      note: 'useRef е "кутия" върху fiber-а: промяната на .current не предизвиква рендер, също както this.timer. Ползвай го за таймери, DOM елементи, предишни стойности, не за данни, които се показват на екрана.',
    },
    {
      name: 'this.setState (merge)', status: 'partial', label: 'частичен еквивалент',
      cls: `this.state = { name: '', age: 0 };
this.setState({ age: 5 });   // name се запазва: плитък merge`,
      hook: `const [form, setForm] = useState({ name: '', age: 0 });
setForm({ age: 5 });                     // name изчезва! няма merge
setForm((f) => ({ ...f, age: 5 }));      // ръчен merge

// Или useReducer за свързано състояние:
const [form, dispatch] = useReducer(reducer, initial);
dispatch({ type: 'setAge', age: 5 });`,
      note: 'useState замества цялата стойност. Съветът на React е да държиш отделни useState за независими неща и useReducer, когато няколко полета се променят заедно.',
    },
    {
      name: 'getSnapshotBeforeUpdate', status: 'partial', label: 'частичен еквивалент',
      cls: `getSnapshotBeforeUpdate(prevProps) {
  if (prevProps.list.length < this.props.list.length) {
    return this.listRef.scrollHeight;   // преди DOM промяната
  }
  return null;
}
componentDidUpdate(prevProps, prevState, snapshot) {
  if (snapshot !== null) {
    this.listRef.scrollTop += this.listRef.scrollHeight - snapshot;
  }
}`,
      hook: `const listRef = useRef(null);
const prevHeight = useRef(0);
useLayoutEffect(() => {
  const el = listRef.current;
  if (prevHeight.current) {
    el.scrollTop += el.scrollHeight - prevHeight.current;
  }
  prevHeight.current = el.scrollHeight;   // запазваме за следващия път
}, [list]);`,
      note: 'Няма hook, който се изпълнява между render и DOM mutation. Приближението е да запазиш измерването от предишния layout ефект в ref. Работи за повечето случаи (чат, който държи позицията при нови съобщения), но не е същият момент.',
    },
    {
      name: 'forceUpdate', status: 'partial', label: 'частичен еквивалент',
      cls: `this.forceUpdate();   // рендерирай, дори state и props да са същите`,
      hook: `const [, forceUpdate] = useReducer((x) => x + 1, 0);
forceUpdate();   // нова стойност => нов рендер`,
      note: 'Работи, но е знак за проблем: ако трябва да форсираш рендер, значи някакво състояние живее извън React. По-добре е да го сложиш в state или да ползваш useSyncExternalStore.',
    },
  ];

  const STATUS = { exact: 'c-ok', partial: 'c-warn', none: 'c-bad' };
  const tabs = h('div', { class: 'w-tabs' });
  const panel = h('div', { class: 'w-grid-2' });
  const noteEl = W.note('');
  const chip = h('span', { class: 'w-chip' });
  const head = h('div', { class: 'w-flex' }, h('strong', {}, ''), chip);
  body.append(tabs, head, panel, noteEl);

  let active = 0;
  function show(i) {
    active = i;
    const it = items[i];
    tabs.querySelectorAll('.w-tab').forEach((t, k) => t.classList.toggle('active', k === i));
    head.firstChild.textContent = it.name;
    chip.className = 'w-chip ' + STATUS[it.status];
    chip.textContent = it.label;
    panel.innerHTML = '';
    panel.append(
      h('div', {}, h('div', { class: 'w-panel-title' }, 'Клас'), code(it.cls, 'javascript')),
      h('div', {}, h('div', { class: 'w-panel-title' }, 'Hooks'), code(it.hook, 'javascript')),
    );
    noteEl.textContent = it.note;
  }
  items.forEach((it, i) => tabs.append(h('button', { type: 'button', class: 'w-tab', onClick: () => show(i) }, it.name)));
  show(0);
});
