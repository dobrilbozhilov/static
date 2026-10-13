/* Истинска виртуализация (windowing) на ванилен JavaScript: само видимите редове са в DOM. */
W.register('virtual-list', (el) => {
  const { h, shell, note } = W;
  const body = shell(el, { title: 'Виртуализиран списък срещу всички редове в DOM', hint: 'Смени броя редове и режима, после скролирай и гледай броя DOM възли и времената.' });

  const ROW = 36, HEIGHT = 320, ALL_CAP = 20000;
  let count = 10000, overscan = 3, mode = 'virtual';

  const countSel = h('select', { class: 'w-select', onChange: (ev) => { count = +ev.target.value; render(true); } }, [1000, 10000, 100000].map((n) => h('option', { value: n }, n.toLocaleString('bg-BG') + ' реда')));
  countSel.value = String(count);
  const overSel = h('select', { class: 'w-select', onChange: (ev) => { overscan = +ev.target.value; render(true); } }, [0, 3, 10].map((n) => h('option', { value: n }, `overscan ${n}`)));
  overSel.value = String(overscan);
  const modeBtns = {};
  const setMode = (m) => { mode = m; for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle('active', k === m); render(true); };
  modeBtns.virtual = h('button', { type: 'button', class: 'w-btn', onClick: () => setMode('virtual') }, 'Виртуализация');
  modeBtns.all = h('button', { type: 'button', class: 'w-btn', onClick: () => setMode('all') }, 'Всички редове в DOM');

  const viewport = h('div', { class: 'vl-viewport', style: { height: HEIGHT + 'px' } });
  const inner = h('div', { class: 'vl-inner' });
  viewport.append(inner);
  const stats = h('div', { class: 'w-stats' });
  const map = h('div', { class: 'vl-map' }, h('i'));
  const noteEl = note('');
  body.append(h('div', { class: 'w-toolbar' }, modeBtns.virtual, modeBtns.all, countSel, overSel), viewport, h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'Къде е прозорецът в целия списък'), map), stats, noteEl);

  const rowEl = (i) => h('div', { class: 'vl-row', style: { top: i * ROW + 'px' } }, h('span', { class: 'vl-idx' }, '#' + (i + 1)), h('span', {}, `Ред ${i + 1}: ${['ябълка', 'круша', 'слива', 'череша', 'дюля'][i % 5]} · ${(i * 7919) % 1000} бр.`));

  let lastRange = [-1, -1];
  let firstMs = 0, scrollMs = 0;
  function render(full) {
    const t0 = performance.now();
    const n = mode === 'all' ? Math.min(count, ALL_CAP) : count;
    inner.style.height = n * ROW + 'px';
    const scrollTop = viewport.scrollTop;
    let start = 0, end = n;
    if (mode === 'virtual') {
      start = Math.max(0, Math.floor(scrollTop / ROW) - overscan);
      end = Math.min(n, Math.ceil((scrollTop + HEIGHT) / ROW) + overscan);
      if (!full && start === lastRange[0] && end === lastRange[1]) return;
    } else if (!full) return;
    lastRange = [start, end];
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) frag.append(rowEl(i));
    inner.replaceChildren(frag);
    void inner.offsetHeight; // принудителен layout, за да влезе в измерването
    const ms = performance.now() - t0;
    if (full) { firstMs = ms; scrollMs = 0; } else scrollMs = ms;
    const domNodes = inner.querySelectorAll('*').length;
    stats.innerHTML = '';
    stats.append(
      h('div', { class: 'w-stat ' + (domNodes > 3000 ? 'c-bad' : 'c-ok') }, h('b', {}, domNodes.toLocaleString('bg-BG')), h('span', {}, `DOM възли (${end - start} реда в DOM от ${n.toLocaleString('bg-BG')})`)),
      h('div', { class: 'w-stat ' + (firstMs > 100 ? 'c-bad' : firstMs > 20 ? 'c-warn' : 'c-ok') }, h('b', {}, firstMs.toFixed(1) + ' ms'), h('span', {}, 'първи рендер (DOM + layout)')),
      h('div', { class: 'w-stat' }, h('b', {}, scrollMs ? scrollMs.toFixed(2) + ' ms' : '–'), h('span', {}, 'последно обновяване при скрол')),
    );
    const visStart = Math.floor(scrollTop / ROW), visEnd = Math.min(n, Math.ceil((scrollTop + HEIGHT) / ROW));
    map.firstChild.style.left = (start / n) * 100 + '%';
    map.firstChild.style.width = Math.max(0.6, ((end - start) / n) * 100) + '%';
    noteEl.innerHTML = mode === 'virtual'
      ? `<b>Виртуализация.</b> Виждат се редове ${visStart + 1} до ${visEnd}, в DOM са ${start + 1} до ${end} (с overscan ${overscan} отгоре и отдолу). Spacer с височина ${(n * ROW).toLocaleString('bg-BG')} px пази скролбара честен, а всеки ред е позициониран на top = index × ${ROW} px.`
      : `<b>Всички редове в DOM.</b> ${count > ALL_CAP ? `Ограничено до ${ALL_CAP.toLocaleString('bg-BG')} реда, иначе табът може да замръзне за секунди. ` : ''}Браузърът създаде ${domNodes.toLocaleString('bg-BG')} възела и направи layout на всичките, макар че се виждат само ${visEnd - visStart}. Скролът не струва JavaScript, но първият рендер и паметта плащат за всичко.`;
  }
  viewport.addEventListener('scroll', () => render(false), { passive: true });
  setMode('virtual');
});
