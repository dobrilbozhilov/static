# Double Buffering

React пази две fiber дървета едновременно: `current`, което съответства на това, което е на екрана, и `workInProgress`, което строи за следващия екран. Всеки fiber в едното дърво сочи към двойника си в другото през полето `alternate`. Когато новото дърво е готово, React не копира нищо: просто обръща един указател, `root.current`, към него. Старото дърво става суровина за следващото обновление.

## Аналогия: две дъски в класната стая

Представи си учител с две дъски на колела. Децата гледат предната. Учителят пише следващия урок на задната, спокойно, с грешки и поправки, докато децата преписват от предната. Когато е готов, обръща дъските: задната отива отпред, предната отива отзад и ще бъде изтрита и използвана за по-следващия урок. Нито едно дете не вижда наполовина написан урок. В компютърната графика това се нарича double buffering и е точно това, което React прави с fiber дърветата.

## Двете дървета и alternate

```js
// Опростено: как са свързани
fiberRoot.current = currentTree;          // коренът сочи към дървото на екрана
currentFiber.alternate === wipFiber;       // всеки възел знае двойника си
wipFiber.alternate === currentFiber;       // и обратно
```

Полетата на двата fiber-а за един и същ компонент могат да се различават: `memoizedState` в `current` е състоянието от последния commit, а в `workInProgress` е новото, което се изчислява. Това е единственият начин React да може да изхвърли рендер: ако нещо се обърка или дойде по-спешна работа, workInProgress се зарязва, а `current` стои недокоснат и верен на екрана.

Правилото е, че за един компонент има най-много два fiber обекта. React не създава нов обект при всеки рендер; създава го само първия път, когато `alternate` е `null`, а после ги преизползва, като ги редува. Това пести памет и garbage collection при чести обновления.

## createWorkInProgress

Когато започва рендер, React не копира цялото дърво. Клонира само по пътя до fiber-ите с чакаща работа:

```js
function createWorkInProgress(current, pendingProps) {
  let wip = current.alternate;
  if (wip === null) {
    wip = createFiber(current.tag, pendingProps, current.key);  // само при първия рендер след mount
    wip.alternate = current;
    current.alternate = wip;
  } else {
    wip.pendingProps = pendingProps;   // преизползваме обекта: само го нулираме
    wip.flags = NoFlags;
    wip.subtreeFlags = NoFlags;
    wip.deletions = null;
  }
  wip.child = current.child;           // децата се клонират по-късно, само ако трябва
  wip.memoizedProps = current.memoizedProps;
  wip.memoizedState = current.memoizedState;
  return wip;
}
```

Забележи `wip.child = current.child`: в началото WIP fiber-ът сочи към децата на `current`. Ако `beginWork` реши, че под този възел няма работа (bailout), децата така и не се клонират: двете дървета споделят едни и същи поддървета. Клонират се само клоните, по които `childLanes` показва чакащи обновления.

## Демо: едно обновление през двете дървета

<div data-widget="double-buffer"></div>

## Смяната на root.current

Единственият момент, в който "новото" става "старо", е едно присвояване в commit фазата, между mutation и layout под-фазите:

```js
// вътре в commitRoot, след mutation и преди layout
root.current = finishedWork;
```

Редът не е случаен. Преди присвояването `current` е старото дърво, за да могат cleanup функциите на ефектите и `componentWillUnmount` да виждат старите props и state. След него `current` е новото, за да могат `componentDidMount`, `componentDidUpdate` и `useLayoutEffect` да виждат новите. Виж [Commit Phase](Commit_Phase.md).

## Защо потребителят не вижда полуготово дърво

Render фазата пише само в workInProgress и в DOM възли, които още не са в документа. Екранът е свързан само с `current` през `stateNode` полетата. Докато `root.current` не се обърне, нищо от новото не е видимо, и докато не се обърне, нищо от старото не е загубено. Това дава на React три свободи:

- Може да спре по средата на рендера ([Time Slicing](Time_Slicing.md)) и да продължи по-късно.
- Може да изхвърли рендера, ако дойде по-важно обновление ([Concurrent React](Concurrent_React.md)), и да започне наново от `current`.
- Може да рендерира компонент два пъти (Strict Mode) без следа на екрана.

## Какво става при прекъснат рендер

Ако React спре рендера и реши да не го довърши, workInProgress дървото остава в полуготово състояние. Никой не го чисти веднага. При следващото обновление `createWorkInProgress` минава по пътя и нулира всеки fiber, който стига: `pendingProps`, `flags`, `deletions`, `memoizedState` се копират отново от `current`. Полуготовата работа просто се презаписва. Затова е важно обновленията на state да се натрупват в опашка на hook-а (`queue.pending`), а не да се прилагат директно върху fiber-а: при рестарт React обработва опашката отначало върху чисто копие на `current`.

## Hook state и memoizedState

За функционален компонент `memoizedState` е свързан списък от hook обекти ([Свързан списък](Linked_List.md)). При рендер React тръгва от `current.memoizedState` и за всеки hook създава нов hook обект в WIP с обновено състояние. Опашката с чакащи обновления се споделя между двата fiber-а (един и същ `queue` обект), така че `setState`, извикан по време на рендер, не се губи, независимо кое дърво накрая стане `current`.

## Капани

- `ref.current` сочи към DOM възли от `current` дървото. Ако четеш ref в render, виждаш старото.
- Сравнение по идентичност на fiber (например в DevTools) е подвеждащо: същият компонент се редува между два обекта.
- При първо монтиране няма `alternate`: всеки fiber се създава наново. Затова mount е по-скъп от update, дори при еднакъв изход.

## Свързани страници

- [Какво е Fiber](Fiber.md): полето `alternate` сред останалите.
- [Render Phase](Render_Phase.md): bailout и клониране по пътя.
- [Commit Phase](Commit_Phase.md): точният момент на смяната.
- [Concurrent React](Concurrent_React.md): кога рендер се изхвърля.
