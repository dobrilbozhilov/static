/* Истинско демо: една и съща работа, веднъж на един дъх и веднъж на порции по 5 ms с MessageChannel.
   Квадратът се анимира с requestAnimationFrame и интервалите между кадрите се измерват. */
W.register('time-slicing', (el) => {
  const { h, btn, shell, note, busy } = W;
  const body = shell(el, { title: 'Същата работа: наведнъж или на порции', hint: '600 единици по 2 ms (общо ~1.2 s). Пиши в полето и гледай квадрата, докато тече.' });

  const UNITS = 600, UNIT_MS = 2, SLICE_MS = 5;
  const FRAME_MS = 1000 / 60;

  const input = h('input', { class: 'w-input', placeholder: 'Пиши тук, докато работата тече…', style: { width: '100%' } });
  const echo = h('div', { class: 'w-small w-mono' }, 'Написано: (нищо)');
  input.addEventListener('input', () => { echo.textContent = 'Написано: ' + (input.value || '(нищо)'); });

  const box = h('div', { style: { position: 'absolute', top: '8px', left: '0', width: '28px', height: '28px', borderRadius: '6px', background: 'var(--accent)' } });
  const track = h('div', { style: { position: 'relative', height: '44px', border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--bg)', overflow: 'hidden' } }, box);

  const bar = h('div', { class: 'w-bar' }, h('i', { style: { width: '0%' } }));
  const barLabel = h('div', { class: 'w-small w-mono' }, 'Работа: 0 / ' + UNITS);
  const stats = h('div', { class: 'w-stats' });
  const chart = h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '1px', height: '90px', border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--bg)', padding: '4px', overflow: 'hidden' } });
  const chartTitle = h('div', { class: 'w-panel-title' }, 'Интервали между кадрите (всяка лента е един кадър, червено = над 20 ms)');
  const noteEl = note('Избери режим. И в двата случая работата е еднаква: 600 единици по 2 ms. Разликата е само дали между единиците браузърът получава контрол.');

  // Постоянна анимация: докато записваме, пазим интервалите между кадрите.
  let recording = false, frames = [], lastT = 0, x = 0, dir = 1;
  function loop(t) {
    if (lastT) {
      const dt = t - lastT;
      if (recording) frames.push(dt);
      x += dir * dt * 0.25;
      const max = track.clientWidth - 28;
      if (x > max) { x = max; dir = -1; } else if (x < 0) { x = 0; dir = 1; }
      box.style.transform = `translateX(${x}px)`;
    }
    lastT = t;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  let running = false;
  const buttons = [];
  function setProgress(n) {
    bar.firstChild.style.width = (n / UNITS * 100) + '%';
    barLabel.textContent = `Работа: ${n} / ${UNITS}`;
  }
  function start(mode) {
    if (running) return;
    running = true;
    buttons.forEach((b) => (b.disabled = true));
    frames = [];
    recording = true;
    chart.innerHTML = '';
    stats.innerHTML = '';
    setProgress(0);
    noteEl.innerHTML = mode === 'sync' ? 'Работи синхронно: нищо друго не може да се случи, докато цикълът не свърши. Опитай да пишеш.' : 'Работи на порции: след всеки ~5 ms React връща контрола и браузърът рисува кадър и обработва клавишите.';
    const t0 = performance.now();
    // Записът продължава малко след края, за да се види и първият кадър след блокирането.
    const finish = () => setTimeout(() => { recording = false; running = false; buttons.forEach((b) => (b.disabled = false)); report(mode, performance.now() - t0); }, 250);
    if (mode === 'sync') {
      // Даваме на браузъра един кадър да покаже бележката, после блокираме.
      setTimeout(() => { for (let i = 1; i <= UNITS; i++) { busy(UNIT_MS); if (i % 50 === 0) setProgress(i); } setProgress(UNITS); finish(); }, 60);
    } else {
      let i = 0;
      const ch = new MessageChannel();
      ch.port1.onmessage = workLoop;
      function workLoop() {
        const sliceStart = performance.now();
        while (i < UNITS && performance.now() - sliceStart < SLICE_MS) { busy(UNIT_MS); i++; }   // shouldYield()
        setProgress(i);
        if (i < UNITS) ch.port2.postMessage(null); else finish();
      }
      ch.port2.postMessage(null);
    }
  }
  function report(mode, total) {
    const longest = Math.max(...frames, 0);
    const dropped = frames.reduce((a, d) => a + Math.max(0, Math.round(d / FRAME_MS) - 1), 0);
    const slow = frames.filter((d) => d > 20).length;
    stats.append(
      h('div', { class: 'w-stat ' + (longest > 50 ? 'c-bad' : 'c-ok') }, h('b', {}, longest.toFixed(0) + ' ms'), h('span', {}, 'най-дълъг кадър')),
      h('div', { class: 'w-stat ' + (dropped > 5 ? 'c-bad' : 'c-ok') }, h('b', {}, String(dropped)), h('span', {}, 'пропуснати кадри')),
      h('div', { class: 'w-stat' }, h('b', {}, String(frames.length)), h('span', {}, 'нарисувани кадри')),
      h('div', { class: 'w-stat' }, h('b', {}, total.toFixed(0) + ' ms'), h('span', {}, 'общо време')),
    );
    const cap = 120;
    for (const d of frames) {
      const hgt = Math.min(1, d / cap) * 100;
      chart.append(h('div', { title: d.toFixed(1) + ' ms', style: { flex: '1 1 0', minWidth: '1px', height: hgt + '%', background: d > 20 ? 'var(--bad)' : 'var(--ok)', borderRadius: '2px 2px 0 0' } }));
    }
    noteEl.innerHTML = mode === 'sync'
      ? `<b>Синхронно</b>: един кадър продължи ${longest.toFixed(0)} ms вместо 16.7. Квадратът замръзна, написаното се появи накуп след края. Браузърът не е "бавен", просто никой не му даде ред.`
      : `<b>Time slicing</b>: най-дългият кадър е ${longest.toFixed(0)} ms, ${slow} от ${frames.length} кадъра са над 20 ms. Работата отне общо ${total.toFixed(0)} ms (малко повече заради паузите), но квадратът се движеше и буквите се появяваха веднага.`;
  }

  const bSync = btn('Пусни синхронно', () => start('sync'), 'danger');
  const bSlice = btn('Пусни с time slicing', () => start('slice'), 'primary');
  buttons.push(bSync, bSlice);

  body.append(
    h('div', { class: 'w-toolbar' }, bSync, bSlice),
    noteEl,
    h('div', { class: 'w-grid-2' },
      h('div', { style: { display: 'grid', gap: '8px' } }, h('div', { class: 'w-label' }, 'Анимация с requestAnimationFrame'), track, input, echo),
      h('div', { style: { display: 'grid', gap: '8px', alignContent: 'start' } }, h('div', { class: 'w-label' }, 'Напредък на работата'), bar, barLabel),
    ),
    stats,
    chartTitle, chart,
  );
});
