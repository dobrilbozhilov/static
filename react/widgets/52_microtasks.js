/* Викторина: предскажи реда на изхода, провери, после го виж стъпка по стъпка през LoopSim. */
W.register('microtask-quiz', (el) => {
  const { h, shell, stepper, note, code } = W;
  const body = shell(el, { title: 'Предскажи реда на изхода', hint: 'Натискай редовете в реда, в който мислиш, че ще се отпечатат. После провери.' });

  const S = (line, op, label, msg, phase) => ({ line, op, label, msg, phase });
  const call = (line, label, msg) => S(line, 'push', label, msg, 'script');
  const ret = (line, msg) => S(line, 'pop', null, msg);
  const log = (line, label, msg) => S(line, 'log', label, msg);
  const main = () => call(0, 'main (скриптът)', 'Скриптът започва. Всичко синхронно ще мине първо.');
  const drain = (line) => S(line, 'pop', null, 'Стекът е празен. Правило: преди каквато и да е задача, микроопашката се изпразва докрай.', 'micro');

  const tasks = [
    {
      title: '1. Promise срещу setTimeout',
      code: `console.log('1');
Promise.resolve().then(() => console.log('2'));
setTimeout(() => console.log('3'), 0);
console.log('4');`,
      order: ['1', '4', '2', '3'],
      why: 'Синхронният код първо (1, 4). После микрозадачите (2), чак после задачата от setTimeout (3), макар и с 0 ms.',
      steps: [
        main(),
        call(0, 'console.log'), log(0, '1'), ret(0),
        S(1, 'enqueueMicro', 'then → "2"', 'Promise.resolve() е вече fulfilled, затова then веднага нарежда callback-а като микрозадача.'),
        call(2, 'setTimeout'), S(2, 'webapi', 'таймер 0 ms → "3"', 'Таймерът отива при браузъра.'), ret(2),
        call(3, 'console.log'), log(3, '4'), ret(3),
        drain(3),
        S(3, 'webapi-done', 'таймер 0 ms → "3"'), S(3, 'enqueueTask', 'cb → "3"', 'Таймерът изтече, но callback-ът е макрозадача: чака реда си след микрозадачите.'),
        S(1, 'dequeueMicro', null, 'Микрозадачата е първа.', 'micro'), call(1, 'then → "2"'), log(1, '2'), ret(1),
        S(2, 'dequeueTask', null, 'Микроопашката е празна. Сега една макрозадача.', 'task'), call(2, 'cb → "3"'), log(2, '3'), ret(2),
        S(null, 'note', null, 'Край: 1, 4, 2, 3.', 'idle'),
      ],
    },
    {
      title: '2. Две then вериги',
      code: `setTimeout(() => console.log('A'), 0);
Promise.resolve()
  .then(() => console.log('B'))
  .then(() => console.log('C'));
Promise.resolve().then(() => console.log('D'));
console.log('E');`,
      order: ['E', 'B', 'D', 'C', 'A'],
      why: 'C се нарежда чак когато B свърши, а дотогава D вече чака в опашката. Затова D е преди C. A е макрозадача и е последна.',
      steps: [
        main(),
        call(0, 'setTimeout'), S(0, 'webapi', 'таймер 0 ms → "A"'), ret(0),
        S(2, 'enqueueMicro', 'then → "B"', 'Promise-ът е готов: първото then се нарежда веднага.'),
        S(3, 'note', null, 'Второто then (C) се закача за резултата на B. Не се нарежда сега: B още не е изпълнено.'),
        S(4, 'enqueueMicro', 'then → "D"', 'Друг готов Promise: D се нарежда след B.'),
        call(5, 'console.log'), log(5, 'E'), ret(5),
        drain(5),
        S(0, 'webapi-done', 'таймер 0 ms → "A"'), S(0, 'enqueueTask', 'cb → "A"', 'Таймерът изтече, A чака като макрозадача.'),
        S(2, 'dequeueMicro', null, null, 'micro'), call(2, 'then → "B"'), log(2, 'B'),
        S(3, 'enqueueMicro', 'then → "C"', 'B върна: Promise-ът на веригата се resolve-ва и C се нарежда. Но D вече е пред него.'),
        ret(2),
        S(4, 'dequeueMicro', null), call(4, 'then → "D"'), log(4, 'D'), ret(4),
        S(3, 'dequeueMicro', null, 'Опашката се изпразва докрай, включително новодобавените.'), call(3, 'then → "C"'), log(3, 'C'), ret(3),
        S(0, 'dequeueTask', null, null, 'task'), call(0, 'cb → "A"'), log(0, 'A'), ret(0),
        S(null, 'note', null, 'Край: E, B, D, C, A.', 'idle'),
      ],
    },
    {
      title: '3. async / await',
      code: `async function f() {
  console.log('f start');
  await null;
  console.log('f след await');
}
console.log('start');
f();
console.log('end');`,
      order: ['start', 'f start', 'end', 'f след await'],
      why: 'await не спира света. Кодът до await е синхронен, а остатъкът от функцията става микрозадача и се изпълнява, когато стекът се изпразни.',
      steps: [
        main(),
        call(5, 'console.log'), log(5, 'start'), ret(5),
        call(6, 'f()', 'async функция се изпълнява синхронно до първото await.'),
        call(1, 'console.log'), log(1, 'f start'), ret(1),
        S(2, 'enqueueMicro', 'продължение на f', 'await: остатъкът от f (всичко след await) се опакова като микрозадача. f връща Promise и излиза от стека.'),
        ret(2, 'f върна Promise. Скриптът продължава.'),
        call(7, 'console.log'), log(7, 'end'), ret(7),
        drain(7),
        S(3, 'dequeueMicro', null, null, 'micro'), call(3, 'f (след await)', 'Функцията продължава от там, където await я спря.'), log(3, 'f след await'), ret(3),
        S(null, 'note', null, 'Край: start, f start, end, f след await. Дори await на не-Promise (null) минава през микроопашката.', 'idle'),
      ],
    },
    {
      title: '4. Микрозадача, която добавя микрозадача',
      code: `setTimeout(() => console.log('timeout'), 0);
queueMicrotask(() => {
  console.log('micro 1');
  queueMicrotask(() => console.log('micro 2'));
});
console.log('sync');`,
      order: ['sync', 'micro 1', 'micro 2', 'timeout'],
      why: 'Микроопашката се изпразва докрай преди следващата макрозадача, включително микрозадачите, добавени междувременно. Затова micro 2 е преди timeout.',
      steps: [
        main(),
        call(0, 'setTimeout'), S(0, 'webapi', 'таймер 0 ms → "timeout"'), ret(0),
        call(1, 'queueMicrotask'), S(1, 'enqueueMicro', 'micro 1', 'Директно нареждане на микрозадача, без Promise.'), ret(1),
        call(5, 'console.log'), log(5, 'sync'), ret(5),
        drain(5),
        S(0, 'webapi-done', 'таймер 0 ms → "timeout"'), S(0, 'enqueueTask', 'cb → "timeout"', 'Таймерът вече е изтекъл и чака като макрозадача.'),
        S(2, 'dequeueMicro', null, null, 'micro'), call(2, 'micro 1'), log(2, 'micro 1'),
        call(3, 'queueMicrotask'), S(3, 'enqueueMicro', 'micro 2', 'Нова микрозадача по време на изпразването. Event loop не минава към задачите, докато има микрозадачи.'), ret(3),
        ret(2),
        S(3, 'dequeueMicro', null), call(3, 'micro 2'), log(3, 'micro 2'), ret(3),
        S(0, 'dequeueTask', null, 'Чак сега макрозадачата.', 'task'), call(0, 'cb → "timeout"'), log(0, 'timeout'), ret(0),
        S(null, 'note', null, 'Край: sync, micro 1, micro 2, timeout. Ако micro 1 добавяше микрозадача безкрайно, timeout никога нямаше да се изпълни и страницата щеше да замръзне.', 'idle'),
      ],
    },
    {
      title: '5. setTimeout в then и then в setTimeout',
      code: `setTimeout(() => {
  console.log('T1');
  Promise.resolve().then(() => console.log('P в T1'));
}, 0);
Promise.resolve().then(() => {
  console.log('P1');
  setTimeout(() => console.log('T в P1'), 0);
});
console.log('sync');`,
      order: ['sync', 'P1', 'T1', 'P в T1', 'T в P1'],
      why: 'След всяка макрозадача микроопашката се изпразва преди следващата макрозадача. Затова "P в T1" излиза веднага след T1, преди втория таймер.',
      steps: [
        main(),
        call(0, 'setTimeout'), S(0, 'webapi', 'таймер 0 ms → T1'), ret(0),
        S(4, 'enqueueMicro', 'then → P1', 'Готов Promise: callback-ът се нарежда веднага.'),
        call(8, 'console.log'), log(8, 'sync'), ret(8),
        drain(8),
        S(0, 'webapi-done', 'таймер 0 ms → T1'), S(0, 'enqueueTask', 'cb → T1', 'Първият таймер изтече, чака като макрозадача.'),
        S(4, 'dequeueMicro', null, null, 'micro'), call(4, 'then → P1'), log(5, 'P1'),
        call(6, 'setTimeout'), S(6, 'webapi', 'таймер 0 ms → T в P1', 'Нов таймер, пуснат от микрозадача. Той ще застане в опашката след T1.'), ret(6),
        ret(4),
        S(6, 'webapi-done', 'таймер 0 ms → T в P1'), S(6, 'enqueueTask', 'cb → T в P1'),
        S(0, 'dequeueTask', null, 'Първата макрозадача.', 'task'), call(0, 'cb → T1'), log(1, 'T1'),
        S(2, 'enqueueMicro', 'then → P в T1', 'Микрозадача, създадена по време на задача.'),
        ret(2, 'Задачата T1 свърши.'),
        S(2, 'dequeueMicro', null, 'Между две макрозадачи микроопашката се изпразва. "P в T1" изпреварва втория таймер.', 'micro'), call(2, 'then → P в T1'), log(2, 'P в T1'), ret(2),
        S(6, 'dequeueTask', null, null, 'task'), call(6, 'cb → T в P1'), log(6, 'T в P1'), ret(6),
        S(null, 'note', null, 'Край: sync, P1, T1, P в T1, T в P1.', 'idle'),
      ],
    },
  ];

  const tabs = h('div', { class: 'w-tabs' });
  const codeHolder = h('div');
  const choices = h('div', { class: 'mq-choices' });
  const answer = h('div', { class: 'mq-answer' });
  const checkBtn = W.btn('Провери', check, 'primary');
  const resetBtn = W.btn('↺ Отначало', () => load(cur));
  const stepBtn = W.btn('Виж стъпка по стъпка', showSteps);
  const result = note('Избери реда, в който ще се отпечатат редовете.');
  const simHolder = h('div');
  const score = h('span', { class: 'w-chip' });
  let cur = 0, picked = [], checked = false, solved = new Set();

  function load(i) {
    cur = i; picked = []; checked = false;
    for (const t of tabs.children) t.classList.toggle('active', Number(t.dataset.i) === i);
    const t = tasks[i];
    codeHolder.innerHTML = ''; codeHolder.append(code(t.code));
    simHolder.innerHTML = '';
    result.innerHTML = 'Избери реда, в който ще се отпечатат редовете. Подсказка: първо синхронно, после микро, после макро.';
    stepBtn.disabled = true;
    draw();
  }
  function draw() {
    const t = tasks[cur];
    choices.innerHTML = '';
    for (const label of t.order.slice().sort()) {
      const used = picked.includes(label);
      choices.append(h('button', { type: 'button', class: 'w-btn small', disabled: used || checked, onClick: () => { picked.push(label); draw(); } }, label));
    }
    answer.innerHTML = '';
    if (!picked.length) answer.append(h('span', { class: 'mq-slot' }, 'твоят ред: (празно)'));
    picked.forEach((label, i) => {
      const cls = checked ? (t.order[i] === label ? ' right' : ' wrong') : '';
      answer.append(h('span', { class: 'ls-item' + cls, title: 'махни', onClick: () => { if (checked) return; picked.splice(i, 1); draw(); } }, `${i + 1}. ${label}`));
    });
    checkBtn.disabled = checked || picked.length !== t.order.length;
  }
  function check() {
    const t = tasks[cur];
    checked = true;
    const ok = picked.every((l, i) => l === t.order[i]);
    if (ok) solved.add(cur);
    score.textContent = `решени: ${solved.size} / ${tasks.length}`;
    result.innerHTML = (ok ? '<b>Вярно.</b> ' : `<b>Не съвсем.</b> Верният ред е: ${t.order.join(' → ')}. `) + t.why + ' Натисни "Виж стъпка по стъпка", за да видиш защо.';
    stepBtn.disabled = false;
    draw();
  }
  function showSteps() {
    const t = tasks[cur];
    const frames = LoopSim.compile(t);
    const v = LoopSim.view(t.code);
    const n = note('');
    simHolder.innerHTML = '';
    const st = stepper({ frames, interval: 1400, render(f) { v.update(f); n.innerHTML = f.msg || '&nbsp;'; } });
    simHolder.append(st.el, n, v.el);
  }

  tasks.forEach((t, i) => tabs.append(h('button', { type: 'button', class: 'w-tab', dataset: { i: String(i) }, onClick: () => load(i) }, t.title)));
  body.append(
    h('div', { class: 'w-flex' }, tabs, score),
    codeHolder,
    h('div', { class: 'w-panel' }, h('div', { class: 'w-panel-title' }, 'Какво ще се отпечата (натисни по ред)'), choices, h('div', { style: { height: '8px' } }), answer),
    h('div', { class: 'w-toolbar' }, checkBtn, resetBtn, stepBtn),
    result,
    simHolder,
  );
  load(0);
});
