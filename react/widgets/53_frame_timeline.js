/* Един кадър от 16.7 ms стъпка по стъпка: задача, микрозадачи, rAF, style, layout, paint, composite. */
W.register('frame-timeline', (el) => {
  const { h, shell, stepper, note } = W;
  const body = shell(el, { title: 'Какво прави браузърът в един кадър', hint: 'Опростен модел на pipeline-а: всичко трябва да се събере в 16.7 ms, иначе кадърът се пропуска.' });

  const FRAME = 16.7;
  const TRACKS = ['JS задача', 'Микрозадачи', 'rAF', 'Style / Layout', 'Paint / Composite'];
  const seg = (track, start, end, label, cls, msg, missed) => ({ track, start, end, label, cls, msg, missed });

  const scenarios = {
    light: {
      name: 'Лек кадър (всичко се събира)',
      total: FRAME * 2,
      segments: [
        seg(0, 0, 4, 'click handler', 'c-info', 'Потребителят кликна. Handler-ът е задача: 4 ms JavaScript, например setState и малко логика.'),
        seg(1, 4, 4.6, 'micro', 'c-purple', 'След задачата: микрозадачите (Promise callback-и). Кратки са.'),
        seg(2, 4.6, 5.6, 'rAF', 'c-accent', 'requestAnimationFrame callback-ите: последният шанс да промениш нещо преди рисуването. Идеални за анимация.'),
        seg(3, 5.6, 8, 'style + layout', 'c-ok', 'Браузърът пресмята кои CSS правила важат (style) и къде стои всеки елемент (layout).'),
        seg(4, 8, 11, 'paint + composite', 'c-ok', 'Рисува пикселите на слоеве (paint) и ги слепва в крайната картинка (composite). Кадърът е готов за 11 ms.'),
        seg(0, 11, FRAME, 'свободно', 'c-dim', 'Остават 5.7 ms свободни. Браузърът може да пусне idle задачи или просто да чака следващия vsync. Плавно е.'),
        seg(0, FRAME, FRAME + 3, 'следващ кадър', 'c-dim', 'На 16.7 ms идва следващият кадър и всичко започва отначало. При 60 Hz това се случва 60 пъти в секунда.'),
      ],
    },
    long: {
      name: 'Дълга задача от 80 ms',
      total: 100,
      segments: [
        seg(0, 0, 80, 'дълга JS задача 80 ms', 'c-bad', 'Една задача върти 80 ms: тежък цикъл, голям синхронен рендер, парсване на огромен JSON. Докато е в стека, браузърът не може да рисува.', [FRAME, FRAME * 2, FRAME * 3, FRAME * 4]),
        seg(1, 80, 81, 'micro', 'c-purple', 'Чак след 80 ms идват микрозадачите.'),
        seg(2, 81, 82, 'rAF', 'c-accent', 'rAF callback-ите, които чакаха от първия кадър, се изпълняват сега, всички наведнъж. Анимацията прескача.'),
        seg(3, 82, 85, 'style + layout', 'c-ok', 'Style и layout.'),
        seg(4, 85, 89, 'paint + composite', 'c-ok', 'Кадърът излиза на 89 ms вместо на 16.7 ms. Четири кадъра са пропуснати: окото вижда "засичане". Над 50 ms това се брои за long task и влошава INP.'),
      ],
    },
    react: {
      name: 'React render с time slicing',
      total: FRAME * 3,
      segments: [
        seg(0, 0, 5, 'React порция 1', 'c-accent', 'React работи върху fiber дървото 5 ms, после shouldYield() връща true. React пуска контрола с MessageChannel (макрозадача за следващата порция).'),
        seg(2, 5, 6, 'rAF', 'c-accent', 'Стекът е празен, значи браузърът може да рисува: rAF callback-ите вървят.'),
        seg(3, 6, 8, 'style + layout', 'c-ok', 'Кадър 1: style и layout.'),
        seg(4, 8, 10, 'paint + composite', 'c-ok', 'Кадър 1 излиза навреме. Анимациите не трепват.'),
        seg(0, 10, 12, 'click handler', 'c-info', 'Потребителят кликна между порциите. Кликът е задача с по-висок приоритет от React порцията и се обработва веднага.'),
        seg(0, FRAME, FRAME + 5, 'React порция 2', 'c-accent', 'React продължава от същия fiber (nextUnitOfWork). Нищо не е загубено.'),
        seg(3, FRAME + 5, FRAME + 7, 'style + layout', 'c-ok', 'Кадър 2.'),
        seg(4, FRAME + 7, FRAME + 9, 'paint + composite', 'c-ok', 'Кадър 2 е навреме.'),
        seg(0, FRAME * 2, FRAME * 2 + 5, 'React порция 3', 'c-accent', 'Последната порция: render фазата е готова.'),
        seg(0, FRAME * 2 + 5, FRAME * 2 + 7, 'commit', 'c-purple', 'Commit фазата: синхронна, 2 ms. DOM-ът се обновява наведнъж.'),
        seg(3, FRAME * 2 + 7, FRAME * 2 + 9, 'style + layout', 'c-ok', 'Кадър 3 с новия DOM.'),
        seg(4, FRAME * 2 + 9, FRAME * 2 + 11, 'paint + composite', 'c-ok', 'Потребителят вижда новото UI. Общо 17 ms работа на React, нито един пропуснат кадър.'),
      ],
    },
  };

  const select = h('select', { class: 'w-select' }, Object.entries(scenarios).map(([k, s]) => h('option', { value: k }, s.name)));
  const noteEl = note('');
  const holder = h('div');
  let st = null;

  function build(sc) {
    const lanes = TRACKS.map(() => h('div', { class: 'w-track-lane' }));
    const vsync = h('div', { class: 'ft-vsync' });
    const ticks = [];
    for (let t = 0; t <= sc.total + 0.01; t += FRAME) {
      const tick = h('div', { class: 'ft-tick', style: { left: `${(t / sc.total) * 100}%` }, dataset: { label: t === 0 ? '0 ms' : `${t.toFixed(1)}` } });
      ticks.push({ t, el: tick });
      vsync.append(tick);
    }
    const tl = h('div', { class: 'w-timeline' },
      h('div', { class: 'w-track' }, h('span', { class: 'w-track-name' }, 'vsync (кадри)'), vsync),
      TRACKS.map((name, i) => h('div', { class: 'w-track' }, h('span', { class: 'w-track-name' }, name), lanes[i])),
    );
    const stats = h('div', { class: 'w-stats' });
    function render(i) {
      lanes.forEach((l) => (l.innerHTML = ''));
      ticks.forEach((k) => { k.el.classList.remove('missed'); k.el.dataset.label = k.t === 0 ? '0 ms' : k.t.toFixed(1); });
      let missed = 0;
      sc.segments.slice(0, i + 1).forEach((s, j) => {
        const w = ((s.end - s.start) / sc.total) * 100;
        lanes[s.track].append(h('span', { class: 'w-track-seg ' + s.cls + (j === i ? ' hot' : ''), style: { left: `${(s.start / sc.total) * 100}%`, width: `${w}%` }, title: `${s.label}: ${s.start.toFixed(1)} до ${s.end.toFixed(1)} ms` }, s.label));
        for (const m of s.missed || []) {
          const k = ticks.find((x) => Math.abs(x.t - m) < 0.01);
          if (k) { k.el.classList.add('missed'); k.el.dataset.label = 'пропуснат'; missed++; }
        }
      });
      const cur = sc.segments[i];
      stats.innerHTML = '';
      stats.append(
        h('div', { class: 'w-stat' }, h('b', {}, `${cur.end.toFixed(1)} ms`), h('span', {}, 'изминало време')),
        h('div', { class: 'w-stat ' + (missed ? 'c-bad' : 'c-ok') }, h('b', {}, String(missed)), h('span', {}, 'пропуснати кадри')),
      );
    }
    return { tl, stats, render };
  }

  function load(key) {
    const sc = scenarios[key];
    const v = build(sc);
    holder.innerHTML = '';
    if (st) st.pause();
    st = stepper({ frames: sc.segments, interval: 1500, render(f, i) { v.render(i); noteEl.innerHTML = f.msg; } });
    holder.append(st.el, noteEl, v.tl, v.stats);
  }
  select.addEventListener('change', () => load(select.value));
  body.append(h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'Сценарий'), select), holder,
    h('div', { class: 'w-small' }, 'Времената са илюстративни. Реалният pipeline е по-сложен (рендерът не е строго на всеки 16.7 ms, част от работата върви в други нишки), но редът на стъпките е този.'));
  load('light');
});
