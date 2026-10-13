# Жизнен цикъл на компонента

Всеки компонент минава през три фази: появява се на екрана (mount), променя се (update) и изчезва (unmount). Класовите компоненти имат отделен метод за почти всеки момент от този път, а функционалните компоненти описват същото с по-малко инструменти: тялото на функцията и няколко hooks. Тази страница показва точния ред на извикване с истински лог и обяснява кое от тях се случва в render фазата и кое в commit фазата.

## Аналогия: гост на гости

Гостът идва (mount): звъни, влиза, сяда. Докато е там, разговорът се променя (update): някой му задава въпрос, той отговаря, донасят нещо ново на масата. Накрая си тръгва (unmount): става, взема си палтото, вратата се затваря. React прави същото с компонента и за всяка стъпка има "кука", на която можеш да закачиш свой код: "когато влезе, пусни музика", "когато си тръгне, изгаси лампата".

Разликата между клас и hooks е като разликата между подробен протокол ("при влизане направи X, при всяка промяна направи Y, при тръгване направи Z") и по-кратко правило ("докато гостът е тук, музиката свири"). Второто описва състояние, което React поддържа, а не моменти.

## Демо: истински лог на извикванията

<div data-widget="lifecycle-log"></div>

## Трите фази при класов компонент

| Фаза | Методи, в реда на извикване | Къде се случва |
|---|---|---|
| Mount | `constructor` → `static getDerivedStateFromProps` → `render` → `componentDidMount` | първите три в render фазата, последният в commit |
| Update | `static getDerivedStateFromProps` → `shouldComponentUpdate` → `render` → `getSnapshotBeforeUpdate` → `componentDidUpdate` | първите три в render, последните два в commit |
| Unmount | `componentWillUnmount` | commit |
| Грешка | `static getDerivedStateFromError` → `componentDidCatch` | render / commit |

`getSnapshotBeforeUpdate` се вика точно преди React да пипне DOM-а (под-фазата before mutation в [Commit Phase](Commit_Phase.md)). Там можеш да прочетеш например `scrollHeight` преди промяната и върнатата стойност стига до `componentDidUpdate` като трети аргумент.

## Трите фази при hooks

| Фаза | Какво се изпълнява, в ред | Къде се случва |
|---|---|---|
| Mount | тялото на функцията (с инициализаторите на `useState`, `useRef`, `useMemo`) → `useInsertionEffect` → `useLayoutEffect` → paint → `useEffect` | тялото в render, ефектите в commit |
| Update | тялото на функцията → cleanup на старите `useLayoutEffect` → нови `useLayoutEffect` → paint → cleanup на старите `useEffect` → нови `useEffect` | също |
| Unmount | cleanup на всички `useLayoutEffect` → cleanup на всички `useEffect` | commit |

Няма отделен "did mount" и "did update": един и същ `useEffect` се изпълнява и в двата случая, а масивът с dependencies казва кога да се пропусне. Това е нарочно. Ефектът описва синхронизация ("докато компонентът показва user X, дръж абонамент за X"), а не момент от живота. Подробно за времето на ефектите: [useLayoutEffect и useEffect](Effects_Timing.md).

## Render фаза срещу commit фаза

Това е най-важното разделение и то обяснява всички правила за "чистота":

```text
Render фаза (може да се прекъсне, да се повтори, да се изхвърли)
  constructor, getDerivedStateFromProps, shouldComponentUpdate, render
  тялото на функционалния компонент, инициализаторите на useState/useMemo/useRef

Commit фаза (синхронна, веднъж, DOM-ът е наличен)
  getSnapshotBeforeUpdate, componentDidMount, componentDidUpdate, componentWillUnmount
  useInsertionEffect, useLayoutEffect, useEffect и техните cleanup функции
```

Всичко в render фазата трябва да е чиста функция: без заявки, без таймери, без промяна на външни променливи. Причината е в [Fiber](Fiber.md): React може да извика `render` и после да изхвърли резултата, ако е дошло по-спешно обновление. Ако там си пуснал заявка, тя ще се пусне два пъти. Commit фазата е безопасна за странични ефекти, защото се изпълнява точно веднъж за всяко реално обновление.

## StrictMode: двойно извикване

В режим на разработка `<React.StrictMode>` нарочно извиква два пъти всичко от render фазата (конструктор, render, тялото на функцията, инициализаторите на `useState` и `useMemo`) и при mount пуска ефектите два пъти: mount → cleanup → mount. Целта е да хване код, който не е чист или чийто ефект няма правилен cleanup. Вторият резултат се изхвърля, а в React 18 логовете от второто извикване са по-бледи в конзолата.

Демото на тази страница ползва production build на React, затова не показва двойното извикване. В твоя проект с `npm run dev` ще видиш по два реда за всяко render извикване.

```jsx
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);  // без този ред StrictMode ще остави два интервала
}, []);
```

## Защо старите методи са махнати

`componentWillMount`, `componentWillReceiveProps` и `componentWillUpdate` се извикваха в render фазата, но хората ги ползваха за странични ефекти (заявки, абонаменти). С прекъсваемия рендер това стана опасно: методът може да се извика, а commit никога да не настъпи, или да се извика няколко пъти за едно обновление. Затова от React 16.3 са с префикс `UNSAFE_` и заместени със `static getDerivedStateFromProps` (чиста функция, връща state, не прави нищо друго) и `getSnapshotBeforeUpdate` (commit фаза, DOM-ът е наличен).

Правилото, което остава: ако нещо трябва да се случи "преди", почти винаги трябва да се случи "след" (в `componentDidUpdate` или `useEffect`), или изобщо не трябва да е в компонента.

## Капани

- `componentDidMount` и `useEffect` не са едно и също време: `componentDidMount` се изпълнява преди paint (като `useLayoutEffect`), а `useEffect` след paint. Ако мигрираш код, който мери DOM, ползвай `useLayoutEffect`.
- `shouldComponentUpdate` спира рендер само на класа; за функция еквивалентът е `React.memo`. Виж [Hooks срещу класове](Hooks_vs_Class.md).
- Няма hook за `componentDidCatch`. Error Boundary е все още само клас.
- Ефект без масив с dependencies се изпълнява след всеки рендер, което обикновено е грешка, а не "безопасен default".

## Свързани страници

- [Hooks срещу класове](Hooks_vs_Class.md): как всеки класов метод се изразява с hooks.
- [useLayoutEffect и useEffect](Effects_Timing.md): точният момент на всеки ефект спрямо paint.
- [Кога се пререндерира](Rerenders.md): какво предизвиква update фазата.
- [Commit Phase](Commit_Phase.md): под-фазите, в които живеят lifecycle методите.
