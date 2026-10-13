# Hooks срещу класове

Класовите компоненти описват живота си с методи, по един за всеки момент: "когато се появя", "когато се променя", "когато изчезвам". Hooks описват същото по друг начин: състояние, което React поддържа, и ефекти, които React синхронизира. Повечето класови методи имат точен превод, няколко имат приблизителен, а един (`componentDidCatch`) няма никакъв. Тази страница е преводач между двата свята.

## Аналогия: инструкции по време срещу инструкции по състояние

На детегледачка можеш да оставиш списък по време: "в 18:00 вечеря, в 19:00 баня, в 20:00 лягане". Или по състояние: "докато детето е будно, телевизорът е изключен; когато е гладно, яде". Първият списък е класовият компонент: `componentDidMount`, `componentDidUpdate`, `componentWillUnmount` са часове на деня. Вторият е hooks: `useEffect` казва "докато `roomId` е X, дръж връзка към стая X" и React сам решава кога да я отвори и затвори. Вторият начин е по-труден за свикване, но прави по-малко грешки, защото не можеш да забравиш "19:00".

## Демо: преводач

<div data-widget="hooks-translator"></div>

## Таблица на съответствията

| Клас | Hooks | Съответствие |
|---|---|---|
| `constructor`, `this.state = {...}` | `useState(initial)`, `useReducer` | точно |
| `componentDidMount` | `useEffect(fn, [])` или `useLayoutEffect(fn, [])` | точно, но друг момент спрямо paint |
| `componentDidUpdate` | `useEffect(fn, [deps])` | точно; "само при update" изисква ref |
| `componentWillUnmount` | cleanup функцията на `useEffect` | точно, плюс cleanup и преди повторение |
| `shouldComponentUpdate` / `PureComponent` | `React.memo(Comp, areEqual)` | точно, с обърната логика |
| `static getDerivedStateFromProps` | `setState` по време на render, или изчисление без state | частично |
| `getSnapshotBeforeUpdate` | `useLayoutEffect` + ref с предишното измерване | частично |
| `this.someField` | `useRef` | точно |
| `this.setState({ a })` (merge) | `setState((s) => ({ ...s, a }))` или `useReducer` | частично |
| `forceUpdate` | `useReducer((x) => x + 1, 0)` | частично |
| `componentDidCatch`, `getDerivedStateFromError` | няма | няма hook |
| `contextType`, `<Consumer>` | `useContext` | точно |

## Защо hooks зависят от реда

При клас състоянието живее в инстанцията: `this.state`, `this.timer`. При функция няма инстанция, затова React пази състоянието върху fiber-а като свързан списък от hook обекти (виж [Свързан списък](Linked_List.md)). При всеки рендер React тръгва от началото на списъка и при всяко извикване на `useState` или `useEffect` подава следващия обект. Това работи само ако извикванията са еднакъв брой и в еднакъв ред всеки път, откъдето идва правилото "без hooks в условия, цикли и след ранен return".

```jsx
function Profile({ user }) {
  if (!user) return null;          // грешка: при user=null useState долу не се вика
  const [open, setOpen] = useState(false);
}

function Profile({ user }) {
  const [open, setOpen] = useState(false);   // правилно: hooks първо, условия после
  if (!user) return null;
}
```

## getDerivedStateFromProps с hooks

Това е най-неочевидният превод. React позволява `setState` по време на render, но само за същия компонент. Когато го направиш, React изхвърля текущия резултат от рендера и веднага рендерира пак с новото състояние, без commit, без ефекти, без DOM промяна. Това е точно поведението на `getDerivedStateFromProps`: ново състояние, изведено от props, преди нещо да стигне до екрана.

```jsx
function List({ items }) {
  const [selection, setSelection] = useState(null);
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {       // props се смениха
    setPrevItems(items);
    setSelection(null);            // нулирай избора: React рестартира рендера веднага
  }
  // ...
}
```

Преди да посегнеш към това, провери двете по-прости решения. Ако стойността може да се изчисли от props, не я дръж в state. Ако искаш "нулирай всичко при смяна", сложи `key` върху компонента: `<List key={listId} items={items} />` монтира нова инстанция с чисто състояние.

## Error Boundaries: защо няма hook

Когато компонент хвърли грешка по време на render, reconciler-ът я хваща в `renderRootSync` / `renderRootConcurrent`, тръгва нагоре по `return` указателите на fiber-а и търси най-близкия класов компонент с `getDerivedStateFromError` или `componentDidCatch`. Намери ли го, планира обновление на неговото състояние (`getDerivedStateFromError` връща ново състояние) и рендерира поддървото наново с fallback.

За това е нужно нещо, което съществува независимо от рендера на децата и може да държи състояние "в грешка съм": инстанция. Функционален компонент няма инстанция, hooks-ът му живее на fiber-а, който в този момент може да е по средата на изхвърлян рендер. Екипът на React е казвал, че hook за това е възможен в бъдеще, но засега решението е един малък клас (или `react-error-boundary`, който е точно този клас с удобен API).

```jsx
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { log(error, info.componentStack); }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
```

Error boundary не хваща: грешки в event handler-и (там ползвай `try/catch`), в асинхронен код (`setTimeout`, промиси), в server-side rendering и в самия себе си.

## Защо hooks са "по-честни"

С класа е лесно да напишеш `componentDidMount` с абонамент и да забравиш `componentDidUpdate`, когато props се сменят. Абонаментът остава за стария `roomId`. С `useEffect` и dependency `[roomId]` React сам прави cleanup и нов абонамент при смяна. Ефектът описва "каква е връзката между този prop и външния свят", а React управлява времето. Това е и причината за ESLint правилото `exhaustive-deps`: ако пропуснеш dependency, описанието лъже.

## Капани

- Затваряния (closures): ефект или callback вижда стойностите от рендера, в който е създаден. Ако `setInterval` в `useEffect(fn, [])` чете `count`, той винаги вижда началното `count`. Решение: функционален `setCount((c) => c + 1)` или dependency.
- Ефект без масив: изпълнява се след всеки рендер. Рядко е това, което искаш.
- `useLayoutEffect` е по-точният превод на `componentDidMount` за код, който мери или мести DOM; `useEffect` за всичко останало. Виж [useLayoutEffect и useEffect](Effects_Timing.md).
- `React.memo` не е `shouldComponentUpdate` за части от компонента: за скъпи части вътре ползвай `useMemo`.

## Свързани страници

- [Жизнен цикъл](Lifecycle.md): редът на извикване с истински лог.
- [useLayoutEffect и useEffect](Effects_Timing.md): кой ефект кога.
- [React.memo](React_memo.md): как работи плиткото сравнение.
- [Свързан списък](Linked_List.md): защо hooks са списък по ред.
