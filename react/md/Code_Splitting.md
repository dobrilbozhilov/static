# Code Splitting и Lazy Loading

Code splitting означава да не пращаш целия JavaScript на приложението наведнъж, а да го разделиш на части (chunks), които браузърът тегли, когато потрябват. В React това става с три неща: динамичен `import()`, `React.lazy` и `Suspense`. Резултатът е по-малък начален bundle, по-бързо първо показване и потребители, които не плащат за екрани, които никога не отварят.

## Аналогия: куфар за екскурзия

Никой не носи целия си гардероб на еднодневна екскурзия. Взимаш каквото ти трябва за деня, а ако изненадващо завали, купуваш чадър на място. Началният bundle е куфарът: ако напъхаш в него и ските, и балната рокля, ще го влачиш навсякъде. Lazy loading е "купувам чадъра, когато завали": малко закъснение в редкия случай, в замяна на лек куфар всеки път.

## Защо размерът на bundle-а има значение

Изтеглянето е само първата част. След него браузърът трябва да парсне и изпълни кода, а това става на главната нишка и струва приблизително милисекунда на килобайт на среден телефон. 500 KB минифициран JS са около половин секунда, през която страницата не реагира, преди React изобщо да е започнал първия си рендер. Затова метриката не е "колко бързо се тегли", а "колко време минава до първия полезен екран".

## Демо: какво има в началния bundle

<div data-widget="bundle-splitter"></div>

## Динамичен import()

Обикновеният `import X from './x'` е статичен: bundler-ът (Vite, webpack, esbuild) го слива в основния файл. `import('./x')` е израз, който връща Promise. Bundler-ът го разпознава, изрязва модула и всичко, което само той ползва, в отделен файл (chunk) и генерира код, който го тегли при първото извикване:

```js
// статичен: влиза в началния bundle
import { renderChart } from './chart';

// динамичен: отделен chunk, тегли се при извикване
button.onclick = async () => {
  const { renderChart } = await import('./chart');   // chart-[hash].js
  renderChart(data);
};
```

Vite и webpack кешират резултата: вторият `import('./chart')` връща вече заредения модул без мрежова заявка.

## React.lazy и Suspense

`React.lazy` превръща динамичния import в компонент. `Suspense` казва какво да се покаже, докато компонентът пътува:

```jsx
import { lazy, Suspense } from 'react';

const Chart = lazy(() => import('./Chart'));   // Chart.jsx трябва да има export default

function Dashboard() {
  return (
    <Suspense fallback={<Spinner />}>
      <Chart data={data} />
    </Suspense>
  );
}
```

Механизмът вътре: при първия рендер `Chart` "хвърля" Promise-а на import-а. React го хваща в най-близкия `Suspense`, показва fallback и се абонира за Promise-а. Когато модулът пристигне, React рендерира отново и този път `Chart` е обикновен компонент. `lazy` помни резултата, така че при следващо показване няма нито Promise, нито fallback.

## Демо: lazy и Suspense на живо

<div data-widget="lazy-suspense"></div>

Превключвателят `startTransition` показва важна подробност: ако смяната на таба е обвита в transition, React не заменя текущото съдържание с fallback, а го оставя видимо (с `isPending`) и показва новия таб едва когато е готов. Без transition потребителят вижда "скок" до спинера. Виж [useTransition](useTransition.md).

## Разделяне по маршрути

Най-естествената граница е страницата. С react-router всеки маршрут може да е lazy:

```jsx
const Admin = lazy(() => import('./pages/Admin'));
const Settings = lazy(() => import('./pages/Settings'));

<Routes>
  <Route path="/admin" element={<Suspense fallback={<PageSkeleton />}><Admin /></Suspense>} />
  <Route path="/settings" element={<Suspense fallback={<PageSkeleton />}><Settings /></Suspense>} />
</Routes>
```

В react-router 6.4+ има и `lazy` свойство на маршрута, което зарежда loader-а и компонента заедно, което избягва "водопад" от заявки.

## Preload при намерение

Закъснението при клик се маха, ако започнеш да теглиш chunk-а по-рано, например при hover върху линка:

```jsx
const loadAdmin = () => import('./pages/Admin');
const Admin = lazy(loadAdmin);

<Link to="/admin" onMouseEnter={loadAdmin} onFocus={loadAdmin}>Admin</Link>
```

Извикването на `loadAdmin()` стартира заявката; когато потребителят кликне след 200 ms, модулът често вече е там и `Suspense` не се показва изобщо.

## Грешки при зареждане

Мрежата пада, или след деплой старият chunk с друг hash вече не съществува. Тогава Promise-ът се отхвърля и грешката стига до най-близкия Error Boundary (виж [Hooks срещу класове](Hooks_vs_Class.md)):

```jsx
const Chart = lazy(() =>
  import('./Chart').catch(() => {
    // стар chunk след деплой: един презареждащ опит
    if (!sessionStorage.getItem('reloaded')) {
      sessionStorage.setItem('reloaded', '1');
      location.reload();
    }
    return { default: () => <p>Графиката не се зареди.</p> };
  }),
);
```

## Именувани експорти

`lazy` очаква модул с `default`. За именуван експорт се прави малък адаптер:

```js
const Chart = lazy(() => import('./charts').then((m) => ({ default: m.BarChart })));
```

## SSR

При server-side rendering (Next.js, Remix) `lazy` работи заедно с streaming: сървърът праща HTML за fallback-а, после HTML за готовия компонент. Next.js предлага `next/dynamic` с опция `ssr: false` за компоненти, които изобщо не бива да се рендерират на сървъра (например такива, които четат `window`).

## Какво да не цепиш

- Малки компоненти над сгъвката (fold): закъснението и отделната заявка струват повече от спестените 5 KB.
- Всичко в по сто отделни chunk-а: всяка заявка има собствен overhead и браузърът ограничава паралелните връзки.
- Споделен код между маршрути: оставяй bundler-ът да го извлече в общ chunk, не го дублирай ръчно.

Правило: цепи по маршрути и по големи, рядко използвани функции (редактор, графики, admin). Провери резултата с визуализатор на bundle-а (`rollup-plugin-visualizer`, `webpack-bundle-analyzer`).

## Капани

- `lazy` компонентът трябва да е дефиниран извън render функцията. Ако го създаваш вътре, при всеки рендер е нов компонент и React го демонтира и зарежда отново.
- Без `Suspense` над lazy компонент React хвърля грешка.
- Fallback, който мига за 50 ms при бърза мрежа, е по-дразнещ от нищо. Transition или малко закъснение преди спинера помагат.

## Свързани страници

- [useTransition](useTransition.md): преходи без fallback.
- [Профилиране](Profiling.md): Chrome Performance показва парсването на bundle-а.
- [Виртуализация](Virtualization.md): другият начин да не рендерираш всичко наведнъж.
