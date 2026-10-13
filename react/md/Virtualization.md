# Виртуализация (windowing)

Виртуализация означава да рендерираш само редовете, които се виждат на екрана, плюс няколко резервни отгоре и отдолу, а не целия списък. Списък със 100 000 реда има в DOM-а около 30 елемента вместо 100 000, скролът остава истински, защото един празен елемент с пълната височина държи скролбара честен, а JavaScript пресмята при всяко движение кои редове да покаже.

## Аналогия: прозорецът на влака

От прозореца на влака виждаш няколко дървета, не цялата гора. Гората е там и минава покрай теб, но във всеки момент "рендерираш" само парчето в рамката на прозореца. Виртуализираният списък е прозорец с фиксиран размер, зад който минава дълъг списък; задачата на кода е да знае кое парче е пред прозореца в момента.

## Защо хиляди DOM възли са бавни

Всеки DOM елемент струва памет (десетки байтове за възела плюс стилове и layout данни), време за създаване и, най-лошото, участие във всяко преизчисляване на layout. Ако 20 000 реда са в документа, всяка промяна на стил, която засяга страницата, кара браузъра да провери 20 000 реда. Първият рендер струва стотици милисекунди, скролът става накъсан, а на телефон табът може да бъде убит заради памет. Вижда се ясно в Chrome Performance (виж [Профилиране](Profiling.md)): дълги жълти (scripting) и лилави (layout) блокове.

## Демо: виртуализиран списък срещу всички редове

<div data-widget="virtual-list"></div>

Опитай 100 000 реда с виртуализация, после 10 000 без. Разликата в "DOM възли" и "първи рендер" е цялата идея. Забележи и че при виртуализация обновяването при скрол отнема части от милисекундата, защото се подменят само няколко реда.

## Алгоритъмът

За редове с фиксирана височина всичко е аритметика:

```js
const ROW = 36;                                   // височина на ред в px
const total = items.length * ROW;                 // височина на spacer-а

function range(scrollTop, viewportHeight, overscan) {
  const start = Math.max(0, Math.floor(scrollTop / ROW) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / ROW) + overscan);
  return [start, end];
}
```

Структурата на DOM-а:

```html
<div class="viewport" style="height: 320px; overflow-y: auto">   <!-- слуша scroll -->
  <div class="spacer" style="height: 3600000px; position: relative"> <!-- пълната височина -->
    <div class="row" style="position: absolute; top: 36000px">Ред 1001</div>
    <div class="row" style="position: absolute; top: 36036px">Ред 1002</div>
    ...
  </div>
</div>
```

Алтернатива на `top` е един контейнер с `transform: translateY(start * ROW)` и редовете в нормален поток вътре в него. `overscan` (резервни редове извън видимото) прикрива бялото пространство при бърз скрол, с цената на малко повече DOM.

## Променлива височина

Когато редовете имат различна височина (коментари, съобщения), позицията на ред N е сумата от височините на всички преди него. Библиотеките решават това с оценка (estimateSize) и измерване след рендер: всеки показан ред измерва реалната си височина чрез `ResizeObserver` или `getBoundingClientRect`, записва я в кеш и преизчислява позициите. Скролбарът "подскача" леко, докато оценките се заменят с измервания.

## react-window

Малка библиотека за фиксирани и променливи височини:

```jsx
import { FixedSizeList } from 'react-window';

function Row({ index, style }) {            // style носи position: absolute и top
  return <div style={style}>Ред {index + 1}: {items[index].name}</div>;
}

<FixedSizeList height={320} width="100%" itemCount={items.length} itemSize={36} overscanCount={3}>
  {Row}
</FixedSizeList>
```

`VariableSizeList` приема `itemSize={(index) => heights[index]}` и има `resetAfterIndex` при промяна на височините.

## TanStack Virtual

Headless hook, който работи с всякаква разметка и измерва автоматично:

```jsx
import { useVirtualizer } from '@tanstack/react-virtual';

function List({ items }) {
  const parentRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 5,
  });
  return (
    <div ref={parentRef} style={{ height: 320, overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => (
          <div key={v.key} ref={virtualizer.measureElement} data-index={v.index}
               style={{ position: 'absolute', top: 0, transform: `translateY(${v.start}px)`, width: '100%' }}>
            {items[v.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

`measureElement` измерва реалната височина на всеки ред и коригира позициите, което решава случая с променливи височини без ръчен кеш.

## Кога не ти трябва

Под около 100 реда обикновеният `map` е по-прост и по-бърз. Между 100 и 1000 зависи от сложността на реда: таблица с 500 реда по 10 клетки вече са 5000 елемента и си заслужава. Над 1000 реда виртуализация почти винаги. Алтернативи, когато потребителят и без това не иска всичко наведнъж: пагинация, "покажи още" с инкрементално зареждане, или филтър, който намалява списъка.

## Капани

- Ctrl+F в браузъра не намира редове, които не са в DOM. За търсене трябва собствено поле.
- Четци на екран виждат само рендерираните редове. Задай `aria-rowcount` на контейнера и `aria-rowindex` на редовете.
- `key` трябва да е стабилен id на елемента, не индексът. При скрол индексите се "движат" и с index като key React ще обновява всеки ред вместо да ги мести.
- Динамичните височини без измерване дават подскачащ скролбар и грешна обща височина.
- Хоризонтален layout или grid изисква двуизмерна виртуализация (`FixedSizeGrid`, `useVirtualizer` с `horizontal`).
- Принтирането показва само видимото парче.

## Свързани страници

- [React.memo](React_memo.md): редовете на виртуализиран списък са добър кандидат за memo.
- [Профилиране](Profiling.md): как се вижда дългият рендер на голям списък.
- [Code Splitting](Code_Splitting.md): другата стратегия за "не всичко наведнъж".
