# React наръчник

Документите в `md/` са източникът на истината, а интерактивните дема живеят в `widgets/`. Билдът събира
всичко в една HTML обвивка с меню, по една страница на документ, плюс `widgets.js` и `widgets.css`.

```bash
cd react
npm install
npm run build        # създава dist/index.html, dist/pages/*.html, dist/widgets.js, dist/widgets.css
make run             # сървър на http://localhost:8084 с rebuild при промяна
```

Редът на страниците и групите са в `manifest.json`. Всеки документ е на български: аналогия от живота,
технически секции, едно или повече дема и "Свързани страници".

## Дема

Демо се поставя в markdown с `<div data-widget="име"></div>`. Всеки файл `widgets/NN_име.js` се
регистрира с `W.register('име', (el) => { ... })`; файловете се конкатенират по име, затова `00_core.js`
е първи и дава общия API: `W.h` (DOM builder), `W.svg`, `W.shell` (заглавна лента), `W.stepper`
(плейър по кадри), `W.tree` (SVG дърво), `W.code` и `W.codeLines` (код с highlight и активен ред),
`W.log`, `W.note`, `W.react` (рендер с истински React 18 от CDN).

Демата, маркирани "истински React", работят с React 18 production UMD build, зареден в `template.html`,
и показват реалното поведение на библиотеката. Останалите са симулации на вътрешните механизми
(fiber дървото, lanes, event loop), които не могат да се наблюдават отвън.
