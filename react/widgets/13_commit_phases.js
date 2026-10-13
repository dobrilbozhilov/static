/* Commit фазата стъпка по стъпка: before mutation, mutation, смяна на current, layout, paint, passive. */
W.register('commit-phases', (el) => {
  const { h, shell, stepper, log, note } = W;
  const body = shell(el, { title: 'Commit Phase: кога DOM-ът наистина се променя', hint: 'Следи фалшивия екран: той се променя само в една от стъпките.' });

  // Сценарий: Counter с <h2>, <p> и useLayoutEffect/useEffect; потребителят натиска "+1" и ново съобщение се появява.
  const PHASES = ['render', 'before', 'mutation', 'swap', 'layout', 'paint', 'passive'];
  const PHASE_LABEL = { render: 'Render готов', before: 'Before mutation', mutation: 'Mutation', swap: 'root.current', layout: 'Layout', paint: 'Paint', passive: 'Passive' };
  const PHASE_CLASS = { render: 'c-dim', before: 'c-purple', mutation: 'c-bad', swap: 'c-warn', layout: 'c-info', paint: 'c-ok', passive: 'c-purple' };

  const OLD = { count: 1, msg: null, note: 'Старият DOM: count = 1, няма съобщение.' };
  const NEW = { count: 2, msg: 'Честито, стигна 2!' };

  const frames = [
    { phase: 'render', screen: OLD, lines: [], msg: 'Render фазата свърши: workInProgress дървото е готово, върху fiber-ите има флагове: <b>Update</b> за &lt;h2&gt;, <b>Placement</b> за новия &lt;p&gt;, <b>Passive</b> за компонента с useEffect. DOM-ът е още старият. Оттук нататък React не може да бъде прекъснат.' },
    { phase: 'before', screen: OLD, lines: ['getSnapshotBeforeUpdate() (класове)', 'прочитане на DOM преди промяната: scrollHeight = 320'], msg: '<b>Before mutation</b>: последната възможност да се прочете DOM-ът такъв, какъвто е бил. Тук се вика <code>getSnapshotBeforeUpdate</code>. Също се планира passive ефектите да се изпълнят по-късно (<code>scheduleCallback</code>).' },
    { phase: 'mutation', screen: OLD, lines: ['cleanup на useLayoutEffect от предишния рендер', 'ref.current = null (откачане на стария ref)', 'commitDeletions: няма изтрити възли'], msg: '<b>Mutation, първа част</b>: cleanup функциите на старите layout ефекти се изпълняват, ref-овете се откачат, изтритите поддървета се махат от DOM. Екранът все още показва старото.' },
    { phase: 'mutation', screen: { count: 2, msg: NEW.msg, note: 'DOM е обновен: h2.textContent = "2", новият <p> е вмъкнат.' }, lines: ['h2.textContent = "Брояч: 2"  (Update)', 'section.appendChild(<p>)  (Placement)'], msg: '<b>Mutation, втора част</b>: React прилага <code>updatePayload</code> на всеки fiber с Update и вмъква възлите с Placement. <b>Точно тук DOM-ът става новият.</b> Браузърът обаче още не е рисувал: JavaScript все още тече.', changed: true },
    { phase: 'swap', screen: { count: 2, msg: NEW.msg, note: 'DOM е новият; root.current вече сочи новото дърво.' }, lines: ['root.current = finishedWork'], msg: '<b>root.current = finishedWork</b>: едно присвояване, между mutation и layout. Преди него <code>current</code> е старото дърво (за да може cleanup да вижда старите props), след него е новото (за да могат <code>componentDidMount</code> и layout ефектите да виждат новото). Виж Double Buffering.' },
    { phase: 'layout', screen: { count: 2, msg: NEW.msg, note: 'DOM е новият; layout ефектите четат размери и позиции.' }, lines: ['ref.current = <p> (прикачане на новия ref)', 'useLayoutEffect(): измерва p.getBoundingClientRect()', 'componentDidMount / componentDidUpdate (класове)'], msg: '<b>Layout</b>: ref-овете се прикачат, <code>useLayoutEffect</code> и <code>componentDidUpdate</code> се викат. DOM е актуален и може да се мери, но потребителят още не е видял нищо. Ако тук извикаш setState, React рендерира синхронно преди paint: потребителят няма да види междинното състояние.' },
    { phase: 'paint', screen: { count: 2, msg: NEW.msg, note: 'Браузърът нарисува кадъра: потребителят вижда промяната.', visible: true }, lines: ['(браузър) style → layout → paint → composite'], msg: '<b>Paint</b>: React върна контрола, браузърът изчисли стиловете, позициите и нарисува. <b>Тук потребителят вижда промяната.</b> Всичко дотук беше един непрекъснат синхронен блок JavaScript.' },
    { phase: 'passive', screen: { count: 2, msg: NEW.msg, note: 'Екранът е нарисуван; useEffect тече след него.', visible: true }, lines: ['cleanup на useEffect от предишния рендер', 'useEffect(): fetch("/api/track?count=2")'], msg: '<b>Passive</b>: <code>useEffect</code> cleanup-ите и после самите ефекти се изпълняват в отделна задача, след като кадърът е на екрана. Затова useEffect не бави рисуването, но и не бива да пипа layout: ще се види трепване.' },
  ];

  const track = h('div', { class: 'w-timeline' });
  function renderTrack(active) {
    track.innerHTML = '';
    const lane = h('div', { class: 'w-track-lane', style: { height: '28px' } });
    const widths = { render: 10, before: 10, mutation: 20, swap: 8, layout: 16, paint: 16, passive: 20 };
    let x = 0;
    for (const p of PHASES) {
      const w = widths[p];
      lane.append(h('div', { class: 'w-track-seg ' + PHASE_CLASS[p], style: { left: x + '%', width: w + '%', lineHeight: '24px', opacity: p === active ? 1 : 0.35, outline: p === active ? '2px solid var(--ink)' : 'none' } }, PHASE_LABEL[p]));
      x += w;
    }
    track.append(h('div', { class: 'w-track' }, h('span', { class: 'w-track-name' }, 'commitRoot()'), lane));
    const bar = h('div', { class: 'w-track-lane', style: { height: '18px' } });
    bar.append(h('div', { class: 'w-track-seg c-warn', style: { left: '10%', width: '70%', lineHeight: '14px' } }, 'синхронен JS: не може да се прекъсне'));
    bar.append(h('div', { class: 'w-track-seg c-ok', style: { left: '80%', width: '20%', lineHeight: '14px' } }, 'след paint'));
    track.append(h('div', { class: 'w-track' }, h('span', { class: 'w-track-name' }, 'главна нишка'), bar));
  }

  const screenBody = h('div', { class: 'w-screen-body' });
  const screenNote = h('div', { class: 'w-small', style: { marginTop: '6px' } });
  const screen = h('div', {}, h('div', { class: 'w-screen' }, h('div', { class: 'w-screen-bar' }, h('i'), h('i'), h('i'), h('span', { class: 'w-small', style: { marginLeft: '6px' } }, 'какво има в DOM')), screenBody), screenNote);
  function renderScreen(s) {
    screenBody.innerHTML = '';
    screenBody.append(
      h('h2', { style: { margin: '0 0 6px', fontSize: '18px', border: 0, padding: 0 } }, `Брояч: ${s.count}`),
      h('button', { type: 'button', class: 'w-btn small', disabled: true }, '+1'),
      s.msg ? h('p', { style: { margin: '8px 0 0', color: 'var(--ok)', fontWeight: 600 } }, s.msg) : null,
    );
    screenBody.style.outline = s.visible ? '2px solid var(--ok)' : 'none';
    screenNote.textContent = s.note;
    screenNote.style.color = s.visible ? 'var(--ok)' : 'var(--muted)';
  }

  const lg = log({ title: 'Какво вика React' });
  const noteEl = note('');
  let logged = -1;
  const st = stepper({ frames, interval: 1600, render(f, i) {
    renderTrack(f.phase);
    renderScreen(f.screen);
    noteEl.innerHTML = f.msg;
    if (i <= logged) { lg.clear(); logged = -1; }
    for (let k = logged + 1; k <= i; k++) {
      lg.add(`▶ ${PHASE_LABEL[frames[k].phase]}`, 'strong sep ' + (frames[k].phase === 'mutation' ? 'bad' : frames[k].phase === 'paint' ? 'ok' : 'info'));
      for (const l of frames[k].lines) lg.add(l, frames[k].changed ? 'warn' : '');
    }
    logged = i;
  } });

  body.append(st.el, track, noteEl, h('div', { class: 'w-grid-2' }, screen, lg.el));
});
