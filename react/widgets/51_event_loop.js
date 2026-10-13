/* Event loop стъпка по стъпка: четири сценария, описани ръчно, изиграни през LoopSim. */
W.register('event-loop-sim', (el) => {
  const { h, shell, stepper, note } = W;
  const body = shell(el, { title: 'Event loop: стек, Web APIs и опашката със задачи', hint: 'Избери сценарий и мини през стъпките. Следи кога стекът е празен.' });

  // Кратки помощници за стъпки.
  const S = (line, op, label, msg, phase) => ({ line, op, label, msg, phase });
  const call = (line, label, msg) => S(line, 'push', label, msg, 'script');
  const ret = (line, msg) => S(line, 'pop', null, msg);
  const log = (line, label, msg) => S(line, 'log', label, msg);
  const main = (msg) => call(0, 'main (скриптът)', msg || 'Браузърът пуска скрипта: цялото му тяло е един голям frame в стека, докато не свърши.');
  const emptyStack = (line, msg) => S(line, 'pop', null, msg || 'Стекът е празен. Чак сега event loop има думата: първо микрозадачи, после рендер, после една задача от опашката.', 'micro');

  const scenarios = {
    classic: {
      name: 'console.log + setTimeout(0)',
      code: `console.log('A');
setTimeout(() => {
  console.log('B');
}, 0);
console.log('C');`,
      steps: [
        main(),
        call(0, 'console.log("A")', 'Извикване на функция = нов frame най-отгоре в стека.'),
        log(0, 'A', 'Печата "A" и връща.'),
        ret(0),
        call(1, 'setTimeout(cb, 0)', 'setTimeout е Web API. JavaScript само казва на браузъра "броѝ 0 ms и после ми дай този callback".'),
        S(1, 'webapi', 'таймер 0 ms → cb', 'Таймерът живее в браузъра, извън JavaScript. Скриптът не чака: setTimeout връща веднага.'),
        ret(1, 'setTimeout върна (ID на таймера). Callback-ът още не е изпълнен.'),
        call(4, 'console.log("C")'),
        log(4, 'C', 'Печата "C" преди "B", макар setTimeout да беше с 0 ms.'),
        ret(4),
        emptyStack(4),
        S(4, 'webapi-done', 'таймер 0 ms → cb', 'Таймерът е изтекъл (реално 1 до 4 ms). Браузърът не може да сложи cb в стека; само го нарежда на опашката.'),
        S(4, 'enqueueTask', 'cb от setTimeout', 'Callback-ът чака в Task Queue. Ако стекът беше зает, щеше да чака колкото трябва.'),
        S(2, 'dequeueTask', null, 'Event loop: стекът е празен, микрозадачи няма, взема първата задача.', 'task'),
        call(2, 'cb', 'Callback-ът влиза в стека като нова задача.'),
        call(2, 'console.log("B")'),
        log(2, 'B', 'Най-после "B".'),
        ret(2),
        ret(2, 'Задачата свърши.'),
        S(null, 'note', null, 'Нищо не чака. Event loop спи, докато не се появи нова задача (клик, таймер, отговор от мрежата).', 'idle'),
      ],
    },
    timers: {
      name: 'Два setTimeout: 100 ms и 0 ms',
      code: `setTimeout(() => console.log('бавен'), 100);
setTimeout(() => console.log('бърз'), 0);
console.log('край на скрипта');`,
      steps: [
        main(),
        call(0, 'setTimeout(бавен, 100)'),
        S(0, 'webapi', 'таймер 100 ms → бавен', 'Браузърът започва да брои 100 ms.'),
        ret(0),
        call(1, 'setTimeout(бърз, 0)'),
        S(1, 'webapi', 'таймер 0 ms → бърз', 'Втори таймер, брои 0 ms. Двата броят едновременно, защото не са в JavaScript нишката.'),
        ret(1),
        call(2, 'console.log(...)'),
        log(2, 'край на скрипта', 'Синхронният код винаги е първи.'),
        ret(2),
        emptyStack(2),
        S(2, 'webapi-done', 'таймер 0 ms → бърз'),
        S(2, 'enqueueTask', 'бърз', 'Краткият таймер изтича пръв и влиза в опашката.'),
        S(1, 'dequeueTask', null, null, 'task'),
        call(1, 'бърз'),
        log(1, 'бърз'),
        ret(1),
        S(null, 'note', null, 'Около 100 ms нищо не се случва. Event loop чака. Страницата е напълно отзивчива през това време.', 'idle'),
        S(0, 'webapi-done', 'таймер 100 ms → бавен'),
        S(0, 'enqueueTask', 'бавен', 'Дългият таймер изтича. Важно: 100 ms е "не по-рано от", не "точно след". Ако стекът е зает, ще чака още.'),
        S(0, 'dequeueTask', null, null, 'task'),
        call(0, 'бавен'),
        log(0, 'бавен'),
        ret(0),
        S(null, 'note', null, 'Готово. Редът зависи от това кога изтича таймерът, не от реда на извикване на setTimeout.', 'idle'),
      ],
    },
    click: {
      name: 'Клик по време на дълъг цикъл',
      code: `button.addEventListener('click', () => {
  console.log('клик!');
});

function heavy() {
  for (let i = 0; i < 1e9; i++) {}   // около 2 секунди
  console.log('heavy свърши');
}

heavy();`,
      steps: [
        main(),
        call(0, 'addEventListener(...)'),
        S(0, 'webapi', 'слушател за click', 'Слушателят се регистрира в браузъра. Той ще създава задача при всеки клик.'),
        ret(0),
        call(9, 'heavy()', 'Тежка синхронна функция. Докато е в стека, нищо друго не може да се изпълни.'),
        S(5, 'note', null, 'Цикълът върти. 0.5 секунди минаха. Браузърът не може да рисува, не може да реагира.'),
        S(5, 'enqueueTask', 'click handler', 'Потребителят натисна бутона. Браузърът създава задача, но стекът НЕ е празен: задачата чака в опашката. Потребителят вижда "замръзнала" страница.'),
        S(5, 'note', null, 'Цикълът още върти. 1.5 секунди. Задачата за клика стои и чака.'),
        call(6, 'console.log(...)'),
        log(6, 'heavy свърши'),
        ret(6),
        ret(9, 'heavy() върна. Остана само main.'),
        emptyStack(9, 'Стекът се изпразни след 2 секунди. Чак сега event loop може да вземе клика.'),
        S(1, 'dequeueTask', null, null, 'task'),
        call(1, 'click handler', 'Handler-ът се изпълнява 2 секунди след самия клик.'),
        call(1, 'console.log(...)'),
        log(1, 'клик!'),
        ret(1),
        ret(1),
        S(null, 'note', null, 'Затова React реже рендера на порции от 5 ms (виж Time Slicing): между порциите стекът е празен и кликът се обработва веднага.', 'idle'),
      ],
    },
    fetch: {
      name: 'fetch и .then',
      code: `console.log('заявка');
fetch('/api/user')
  .then((res) => res.json())
  .then((user) => console.log(user.name));
console.log('след fetch');`,
      steps: [
        main(),
        call(0, 'console.log(...)'),
        log(0, 'заявка'),
        ret(0),
        call(1, 'fetch("/api/user")', 'fetch е Web API: мрежовата заявка тръгва в браузъра, в друга нишка.'),
        S(1, 'webapi', 'HTTP GET /api/user', 'fetch връща Promise веднага, още без отговор.'),
        ret(1),
        call(2, '.then(res => res.json())', 'then не изпълнява нищо сега: само записва callback-а в Promise-а.'),
        ret(2),
        call(3, '.then(user => ...)', 'Второто then се закача за резултата на първото.'),
        ret(3),
        call(4, 'console.log(...)'),
        log(4, 'след fetch', 'Скриптът продължава, без да чака мрежата.'),
        ret(4),
        emptyStack(4),
        S(4, 'note', null, 'Мрежата е бавна: 80 ms нищо не се случва в JavaScript. Страницата е отзивчива.', 'idle'),
        S(1, 'webapi-done', 'HTTP GET /api/user'),
        S(1, 'enqueueTask', 'отговор от мрежата', 'Отговорът пристигна. Браузърът слага задача, която ще resolve-не Promise-а на fetch.'),
        S(1, 'dequeueTask', null, null, 'task'),
        call(1, 'resolve(response)', 'Promise-ът на fetch става fulfilled.'),
        S(2, 'enqueueMicro', 'then #1', 'Callback-ите на Promise не влизат в стека направо: нареждат се като микрозадачи.'),
        ret(1),
        S(2, 'dequeueMicro', null, 'Стекът е празен, значи микрозадачите се изпълняват веднага, преди всяка друга задача.', 'micro'),
        call(2, 'then #1: res.json()', 'Четенето на тялото е пак асинхронно: json() връща нов Promise.'),
        S(2, 'webapi', 'четене на body', null),
        ret(2),
        S(2, 'note', null, 'Тялото се чете и парсва. Пак се чака.', 'idle'),
        S(2, 'webapi-done', 'четене на body'),
        S(2, 'enqueueTask', 'body готово'),
        S(2, 'dequeueTask', null, null, 'task'),
        call(2, 'resolve(json)'),
        S(3, 'enqueueMicro', 'then #2', 'Второто then се нарежда като микрозадача.'),
        ret(2),
        S(3, 'dequeueMicro', null, null, 'micro'),
        call(3, 'then #2'),
        log(3, 'Иван', 'user.name е отпечатано. Между всички тези стъпки страницата нито веднъж не е замръзвала.'),
        ret(3),
        S(null, 'note', null, 'Край. Забележи: fetch и json() минават през Task Queue, а then callback-ите през Microtask Queue. Повече на страницата Микро и макро задачи.', 'idle'),
      ],
    },
  };

  const select = h('select', { class: 'w-select' }, Object.entries(scenarios).map(([k, s]) => h('option', { value: k }, s.name)));
  const noteEl = note('');
  const holder = h('div');
  let st = null;
  function load(key) {
    const sc = scenarios[key];
    const frames = LoopSim.compile(sc);
    const v = LoopSim.view(sc.code);
    holder.innerHTML = '';
    if (st) st.pause();
    st = stepper({ frames, interval: 1400, render(f) { v.update(f); noteEl.innerHTML = f.msg || '&nbsp;'; } });
    holder.append(st.el, noteEl, v.el);
  }
  select.addEventListener('change', () => load(select.value));
  body.append(h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'Сценарий'), select), holder);
  load('classic');
});
