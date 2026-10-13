/* Симулация: дълъг transition рендер, прекъснат от клик (SyncLane). WIP се изхвърля, sync обновлението
   се рендерира и commit-ва, после transition-ът започва отначало. */
W.register('concurrent-lanes', (el) => {
  const { h, shell, stepper, note, log } = W;
  const body = shell(el, { title: 'Прекъсване на рендер с по-висок приоритет', hint: 'Избери на коя единица работа идва кликът и мини стъпка по стъпка.' });

  const LANES = [
    { id: 'sync', name: 'SyncLane', cls: 'c-bad' },
    { id: 'input', name: 'InputContinuous', cls: 'c-warn' },
    { id: 'default', name: 'DefaultLane', cls: 'c-info' },
    { id: 'transition', name: 'TransitionLane', cls: 'c-purple' },
  ];
  const LONG = 12, SHORT = 2;

  function build(clickAt) {
    const frames = [];
    const segs = [];
    let t = 0;
    const snap = (o) => frames.push({ ...o, t, segs: segs.map((s) => ({ ...s })) });
    snap({ wip: 0, wipLane: null, msg: 'Потребителят пише във филтър. <code>startTransition(() => setFilter(q))</code> слага обновление в <b>TransitionLane</b>: нисък приоритет, може да се прекъсва.', logLine: 'startTransition(setFilter): TransitionLane', cls: 'purple' });
    let seg = { lane: 'transition', start: t, end: t, label: 'render (WIP)', cls: 'c-purple' };
    segs.push(seg);
    for (let i = 1; i <= clickAt; i++) {
      t++; seg.end = t;
      snap({ wip: i, wipLane: 'transition', msg: `Render фазата върви на порции: единица ${i} от ${LONG}. След всяка порция <code>shouldYield()</code> проверява дали има нещо по-спешно.`, logLine: i === 1 ? 'workLoop: performUnitOfWork × ' + LONG : null, cls: 'dim' });
    }
    snap({ wip: clickAt, wipLane: 'transition', click: true, msg: 'Потребителят <b>кликва</b> бутон. Event handler-ът вика <code>setOpen(true)</code>: това е <b>SyncLane</b>, най-високият приоритет. Scheduler-ът вижда, че чака по-важна лента.', logLine: 'click → setOpen(true): SyncLane', cls: 'bad strong' });
    seg.label = 'прекъснат'; seg.cls = 'c-dim';
    snap({ wip: 0, wipLane: null, discarded: true, msg: 'React <b>изхвърля</b> недовършеното workInProgress дърво. Нищо не е стигало до екрана, затова няма какво да се развали. Загубата е само изчислението дотук.', logLine: 'прекъсване: WIP изхвърлен (' + clickAt + ' единици загубени)', cls: 'warn' });
    seg = { lane: 'sync', start: t, end: t, label: 'render', cls: 'c-bad' };
    segs.push(seg);
    for (let i = 1; i <= SHORT; i++) {
      t++; seg.end = t;
      snap({ wip: i, wipLane: 'sync', total: SHORT, msg: `Рендер на sync обновлението (${i}/${SHORT}). SyncLane не се нарязва и не се прекъсва: потребителят чака точно него.`, logLine: i === 1 ? 'render SyncLane (без прекъсване)' : null, cls: 'dim' });
    }
    t++;
    segs.push({ lane: 'sync', start: t - 1, end: t, label: 'commit', cls: 'c-ok' });
    snap({ wip: 0, wipLane: null, committed: 'sync', msg: '<b>Commit</b>: DOM-ът получава отворения панел. От клика до екрана минаха само няколко милисекунди, въпреки че по средата течеше голям рендер.', logLine: 'commit SyncLane → екранът показва панела', cls: 'ok strong' });
    snap({ wip: 0, wipLane: null, msg: 'Transition обновлението още чака в лентата си. Старото WIP дърво е безполезно, защото current дървото вече е друго (панелът е отворен). React започва <b>отначало</b>.', logLine: 'TransitionLane все още чака: рестарт от 0', cls: 'purple' });
    seg = { lane: 'transition', start: t, end: t, label: 'render (отначало)', cls: 'c-purple' };
    segs.push(seg);
    for (let i = 1; i <= LONG; i++) {
      t++; seg.end = t;
      snap({ wip: i, wipLane: 'transition', msg: `Transition рендер отначало: единица ${i} от ${LONG}. Ако дойде нов клик, цикълът се повтаря. Ако не, стига до края.`, logLine: i === 1 ? 'workLoop: performUnitOfWork × ' + LONG + ' (втори опит)' : null, cls: 'dim' });
    }
    t++;
    segs.push({ lane: 'transition', start: t - 1, end: t, label: 'commit', cls: 'c-ok' });
    snap({ wip: 0, wipLane: null, committed: 'transition', msg: '<b>Commit</b> на transition-а: филтрираният списък се появява. Общо: кликът беше обслужен веднага, бавното обновление стигна до екрана по-късно, но потребителят през цялото време видя консистентен екран.', logLine: 'commit TransitionLane → списъкът е филтриран', cls: 'ok strong' });
    return frames;
  }

  const timeline = h('div', { class: 'w-timeline' });
  const tracks = {};
  for (const l of LANES) {
    const lane = h('div', { class: 'w-track-lane' });
    tracks[l.id] = lane;
    timeline.append(h('div', { class: 'w-track' }, h('span', { class: 'w-track-name' }, l.name), lane));
  }
  const wipBar = h('div', { class: 'w-bar' }, h('i', { style: { width: '0%' } }));
  const wipLabel = h('div', { class: 'w-small w-mono' }, 'workInProgress: празен');
  const screen = h('div', { class: 'w-screen-body' });
  const screenEl = h('div', { class: 'w-screen' }, h('div', { class: 'w-screen-bar' }, h('i'), h('i'), h('i')), screen);
  const noteEl = note('');
  const lg = log({ title: 'Какво прави scheduler-ът' });

  let open = false, filtered = false;
  function drawScreen() {
    screen.innerHTML = '';
    screen.append(
      h('div', { class: 'w-flex' }, h('span', { class: 'w-chip ' + (filtered ? 'c-purple' : '') }, filtered ? 'списък: филтриран' : 'списък: пълен (стар)'), h('span', { class: 'w-chip ' + (open ? 'c-ok' : '') }, open ? 'панел: отворен' : 'панел: затворен')),
    );
  }

  let lastLogged = -1;
  let frames = build(5);
  const total = () => frames[frames.length - 1].t;
  const st = stepper({ frames, interval: 900, render(f, i) {
    for (const l of LANES) tracks[l.id].innerHTML = '';
    const T = total();
    for (const s of f.segs) {
      const end = Math.min(s.end, f.t);
      if (end <= s.start) continue;
      tracks[s.lane].append(h('div', { class: 'w-track-seg ' + s.cls, style: { left: (s.start / T * 100) + '%', width: ((end - s.start) / T * 100) + '%' } }, s.label));
    }
    if (f.click) tracks.sync.append(h('div', { class: 'w-track-seg c-bad', style: { left: (f.t / T * 100) + '%', width: '3px' }, title: 'клик' }));
    const tot = f.wipLane === 'sync' ? SHORT : LONG;
    wipBar.firstChild.style.width = f.wipLane ? (f.wip / tot * 100) + '%' : '0%';
    wipBar.firstChild.style.background = f.wipLane === 'sync' ? 'var(--bad)' : 'var(--purple)';
    wipLabel.textContent = f.wipLane ? `workInProgress (${f.wipLane === 'sync' ? 'SyncLane' : 'TransitionLane'}): ${f.wip} / ${tot} единици` : f.discarded ? 'workInProgress: изхвърлен' : 'workInProgress: празен';
    if (i === 0) { open = false; filtered = false; }
    // Екранът се сменя само при commit; при "Назад" се преизчислява от кадрите дотук.
    open = frames.slice(0, i + 1).some((x) => x.committed === 'sync');
    filtered = frames.slice(0, i + 1).some((x) => x.committed === 'transition');
    drawScreen();
    noteEl.innerHTML = f.msg;
    if (i <= lastLogged) { lg.clear(); lastLogged = -1; }
    for (let k = lastLogged + 1; k <= i; k++) if (frames[k].logLine) lg.add(frames[k].logLine, frames[k].cls || '');
    lastLogged = i;
  } });

  const sel = h('select', { class: 'w-select', onChange: () => { frames = build(Number(sel.value)); lastLogged = -1; st.setFrames(frames); } },
    [3, 5, 9].map((n) => h('option', { value: String(n), selected: n === 5 }, `кликът идва на единица ${n}`)));

  body.append(
    h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'Сценарий'), sel),
    st.el,
    noteEl,
    h('div', { class: 'w-panel' }, h('div', { class: 'w-panel-title' }, 'Времева лента по lanes (вляво е по-рано)'), timeline),
    h('div', { class: 'w-grid-2' },
      h('div', { style: { display: 'grid', gap: '8px', alignContent: 'start' } }, h('div', { class: 'w-label' }, 'Напредък на workInProgress'), wipBar, wipLabel, h('div', { class: 'w-label', style: { marginTop: '8px' } }, 'Екранът (current дървото)'), screenEl),
      lg.el,
    ),
  );
});
