/* Истинско демо: CSS анимация срещу rAF анимация при блокиран main thread, и setTimeout срещу MessageChannel. */
W.register('long-task-demo', (el) => {
  const { h, shell, note, busy } = W;
  const body = shell(el, { title: 'Блокирай главната нишка и виж кой спира', hint: 'Двата квадрата се въртят. Единият с CSS, другият с JavaScript.' });

  const cssBox = h('div', { class: 'lt-spin css' });
  const jsBox = h('div', { class: 'lt-spin js' });
  const jsStatus = h('span', { class: 'w-small' }, 'rAF: върви');
  const cssStatus = h('span', { class: 'w-small' }, 'CSS: върви');
  const noteEl = note('Натисни бутона. Докато <code>busy(2000)</code> върти, стекът не е празен: requestAnimationFrame не се вика и JS квадратът замръзва. CSS анимацията на transform често продължава, защото compositor thread-ът я движи сам.');

  // JS анимация: ъгълът се сменя при всеки кадър; ако кадри няма, квадратът стои.
  let angle = 0, last = performance.now(), gaps = [];
  (function tick(now) {
    const dt = now - last; last = now;
    gaps.push(dt); if (gaps.length > 300) gaps.shift();
    angle = (angle + dt * 0.26) % 360;
    jsBox.style.transform = `rotate(${angle}deg)`;
    requestAnimationFrame(tick);
  })(performance.now());

  const blockBtn = W.btn('Блокирай main thread за 2 s', () => {
    jsStatus.textContent = 'rAF: блокиран...'; jsStatus.classList.add('lt-frozen');
    gaps = [];
    // Малко закъснение, за да се нарисува надписът преди блокирането.
    setTimeout(() => {
      busy(2000);
      setTimeout(() => {
        const worst = Math.max(...gaps);
        jsStatus.textContent = `rAF: върви (най-дългата пауза между кадри: ${worst.toFixed(0)} ms)`;
        jsStatus.classList.remove('lt-frozen');
        stats.innerHTML = '';
        stats.append(h('div', { class: 'w-stat c-bad' }, h('b', {}, `${worst.toFixed(0)} ms`), h('span', {}, 'без нито един кадър от JavaScript')),
          h('div', { class: 'w-stat' }, h('b', {}, `${Math.round(worst / 16.7)}`), h('span', {}, 'пропуснати кадъра при 60 Hz')));
      }, 50);
    }, 60);
  }, 'primary danger');
  const stats = h('div', { class: 'w-stats' });

  // Измерване: 6 вложени setTimeout(0) срещу 6 вложени MessageChannel съобщения.
  const measureStats = h('div', { class: 'w-stats' });
  const measureNote = note('setTimeout(fn, 0) е "не по-рано от 0 ms", а браузърът добавя минимум 4 ms, щом вложението мине 4-5 нива. MessageChannel няма такъв праг: следващото съобщение е веднага след текущата задача, но пак пуска рендер между тях. Затова React scheduler ползва MessageChannel.');
  function measureTimeout() {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let n = 0;
      (function step() { if (++n >= 6) return resolve(performance.now() - t0); setTimeout(step, 0); })();
    });
  }
  function measureChannel() {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const t0 = performance.now();
      let n = 0;
      ch.port1.onmessage = () => { if (++n >= 6) return resolve(performance.now() - t0); ch.port2.postMessage(null); };
      ch.port2.postMessage(null);
    });
  }
  const measureBtn = W.btn('Измери', async () => {
    measureBtn.disabled = true;
    const a = await measureTimeout();
    const b = await measureChannel();
    measureStats.innerHTML = '';
    measureStats.append(
      h('div', { class: 'w-stat c-warn' }, h('b', {}, `${a.toFixed(1)} ms`), h('span', {}, '6 вложени setTimeout(0)')),
      h('div', { class: 'w-stat c-ok' }, h('b', {}, `${b.toFixed(1)} ms`), h('span', {}, '6 вложени MessageChannel')),
      h('div', { class: 'w-stat' }, h('b', {}, `${(a / 6).toFixed(1)} ms`), h('span', {}, 'средно на setTimeout ниво')),
    );
    measureBtn.disabled = false;
  }, 'primary');

  body.append(
    h('div', { class: 'w-grid-2' },
      h('div', { class: 'w-panel lt-box' }, h('div', { class: 'w-panel-title' }, 'CSS animation (transform)'), cssBox, cssStatus),
      h('div', { class: 'w-panel lt-box' }, h('div', { class: 'w-panel-title' }, 'requestAnimationFrame (JS)'), jsBox, jsStatus),
    ),
    h('div', { class: 'w-toolbar' }, blockBtn),
    stats,
    noteEl,
    h('div', { class: 'w-panel-title', style: { marginTop: '8px' } }, 'Защо React планира с MessageChannel, а не със setTimeout'),
    h('div', { class: 'w-toolbar' }, measureBtn),
    measureStats,
    measureNote,
  );
});
