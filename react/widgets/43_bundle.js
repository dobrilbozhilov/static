/* Симулация: кои модули влизат в началния bundle и какво става при навигация към lazy маршрут. */
W.register('bundle-splitter', (el) => {
  const { h, shell, btn, note } = W;
  const body = shell(el, { title: 'Какво има в началния bundle?', hint: 'Отбележи кои модули да се зареждат lazy, смени мрежата, после навигирай към /admin.' });

  const MODULES = [
    { id: 'react', name: 'react + react-dom', kb: 130, fixed: true, route: null },
    { id: 'shell', name: 'app shell (layout, router, начална страница)', kb: 60, fixed: true, route: null },
    { id: 'charts', name: 'charts (библиотека за графики)', kb: 310, lazy: true, route: '/dashboard' },
    { id: 'editor', name: 'rich text editor', kb: 420, lazy: false, route: '/posts/new' },
    { id: 'admin', name: 'admin panel', kb: 180, lazy: false, route: '/admin' },
    { id: 'settings', name: 'settings', kb: 40, lazy: false, route: '/settings' },
    { id: 'i18n', name: 'i18n bg (преводи)', kb: 25, lazy: false, route: null },
  ];
  const NET = { '3g': { label: 'бавен 3G', kbps: 50, rtt: 300 }, '4g': { label: '4G', kbps: 600, rtt: 80 }, 'wifi': { label: 'Wi-Fi', kbps: 3000, rtt: 20 } };
  const PARSE_MS_PER_KB = 0.8; // среден телефон: парсване + изпълнение на около 1 KB минифициран JS
  let net = '4g';
  const total = MODULES.reduce((a, m) => a + m.kb, 0);

  const list = h('div', { style: { display: 'grid', gap: '6px' } });
  const barWrap = h('div');
  const stats = h('div', { class: 'w-stats' });
  const netSel = h('select', { class: 'w-select', onChange: (ev) => { net = ev.target.value; update(); } }, Object.entries(NET).map(([k, v]) => h('option', { value: k }, `${v.label} (${v.kbps} KB/s)`)));
  netSel.value = net;
  const timeline = h('div', { class: 'w-timeline' });
  const tlNote = note('Началният bundle е всичко, което браузърът трябва да изтегли, парсне и изпълни, преди да покаже каквото и да е.');
  body.append(list, barWrap, h('div', { class: 'w-flex' }, h('span', { class: 'w-label' }, 'Мрежа'), netSel, btn('Навигирай към /admin', () => navigate('admin'), 'primary'), btn('Навигирай към /dashboard', () => navigate('charts'))), stats, tlNote, timeline);

  function initialKb() { return MODULES.filter((m) => !m.lazy).reduce((a, m) => a + m.kb, 0); }
  function update() {
    list.innerHTML = '';
    for (const m of MODULES) {
      const cb = h('input', { type: 'checkbox', checked: !!m.lazy, disabled: !!m.fixed, onChange: () => { m.lazy = cb.checked; update(); } });
      list.append(h('div', { class: 'w-flex', style: { justifyContent: 'space-between' } },
        h('label', { class: 'w-toggle' }, cb, m.lazy ? 'lazy' : 'в началния bundle', h('b', { style: { marginLeft: '6px' } }, m.name), m.fixed ? h('span', { class: 'w-chip' }, 'винаги нужен') : null),
        h('span', { class: 'w-mono w-small' }, `${m.kb} KB`)));
    }
    const kb = initialKb();
    const n = NET[net];
    const dl = n.rtt + (kb / n.kbps) * 1000;
    const parse = kb * PARSE_MS_PER_KB;
    barWrap.innerHTML = '';
    barWrap.append(
      h('div', { class: 'w-flex', style: { justifyContent: 'space-between' } }, h('span', { class: 'w-label' }, 'Начален bundle'), h('span', { class: 'w-mono w-small' }, `${kb} KB от ${total} KB общо`)),
      h('div', { class: 'w-bar', style: { height: '18px', marginTop: '4px' } }, h('i', { style: { width: (kb / total) * 100 + '%', background: kb > 400 ? 'var(--bad)' : kb > 250 ? 'var(--warn)' : 'var(--ok)' } })),
    );
    stats.innerHTML = '';
    stats.append(
      h('div', { class: 'w-stat' }, h('b', {}, `${kb} KB`), h('span', {}, 'начален JS')),
      h('div', { class: 'w-stat' }, h('b', {}, `${(dl / 1000).toFixed(1)} s`), h('span', {}, `изтегляне на ${n.label}`)),
      h('div', { class: 'w-stat' }, h('b', {}, `${Math.round(parse)} ms`), h('span', {}, 'парсване и изпълнение (среден телефон)')),
      h('div', { class: 'w-stat ' + (dl + parse > 3000 ? 'c-bad' : dl + parse > 1500 ? 'c-warn' : 'c-ok') }, h('b', {}, `${((dl + parse) / 1000).toFixed(1)} s`), h('span', {}, 'до първи рендер')),
    );
  }

  function navigate(id) {
    const m = MODULES.find((x) => x.id === id);
    const n = NET[net];
    const kb = initialKb();
    const dl0 = n.rtt + (kb / n.kbps) * 1000;
    const parse0 = kb * PARSE_MS_PER_KB;
    const shellAt = dl0 + parse0;
    const clickAt = shellAt + 600;
    const segs = { net: [], js: [], screen: [] };
    segs.net.push({ from: 0, to: dl0, label: `bundle.js ${kb} KB`, cls: 'c-info' });
    segs.js.push({ from: dl0, to: shellAt, label: 'парсване + рендер', cls: 'c-purple' });
    segs.screen.push({ from: 0, to: shellAt, label: 'бял екран', cls: 'c-dim' });
    segs.screen.push({ from: shellAt, to: clickAt, label: 'начална страница', cls: 'c-ok' });
    let end;
    if (m.lazy) {
      const dl1 = n.rtt + (m.kb / n.kbps) * 1000;
      const parse1 = m.kb * PARSE_MS_PER_KB;
      segs.net.push({ from: clickAt, to: clickAt + dl1, label: `${m.id}.chunk.js ${m.kb} KB`, cls: 'c-info' });
      segs.js.push({ from: clickAt + dl1, to: clickAt + dl1 + parse1, label: 'парсване + рендер', cls: 'c-purple' });
      segs.screen.push({ from: clickAt, to: clickAt + dl1 + parse1, label: 'Suspense fallback', cls: 'c-warn' });
      end = clickAt + dl1 + parse1 + 300;
      segs.screen.push({ from: clickAt + dl1 + parse1, to: end, label: m.route, cls: 'c-ok' });
      tlNote.innerHTML = `<b>${m.route} е lazy.</b> Началната страница се появи на ${(shellAt / 1000).toFixed(1)} s. При клика React извика <code>import()</code>, chunk-ът от ${m.kb} KB пътува ${(dl1 / 1000).toFixed(1)} s, през което време се вижда <code>Suspense</code> fallback. Потребителят плаща за модула само ако отиде там.`;
    } else {
      end = clickAt + 300;
      segs.js.push({ from: clickAt, to: clickAt + 30, label: 'рендер', cls: 'c-purple' });
      segs.screen.push({ from: clickAt, to: end, label: m.route, cls: 'c-ok' });
      tlNote.innerHTML = `<b>${m.route} е в началния bundle.</b> Навигацията е мигновена, но всеки потребител плати ${m.kb} KB изтегляне и ${Math.round(m.kb * PARSE_MS_PER_KB)} ms парсване още при отварянето, включително тези, които никога няма да отидат там. Началната страница се появи чак на ${(shellAt / 1000).toFixed(1)} s.`;
    }
    timeline.innerHTML = '';
    const track = (name, items) => h('div', { class: 'w-track' }, h('span', { class: 'w-track-name' }, name),
      h('div', { class: 'w-track-lane' }, items.map((s) => h('span', { class: 'w-track-seg ' + s.cls, title: `${s.label}: ${Math.round(s.from)} → ${Math.round(s.to)} ms`, style: { left: (s.from / end) * 100 + '%', width: Math.max(0.5, ((s.to - s.from) / end) * 100) + '%' } }, s.label))));
    timeline.append(track('Мрежа', segs.net), track('JavaScript', segs.js), track('Екран', segs.screen),
      h('div', { class: 'w-track' }, h('span', { class: 'w-track-name' }, ''), h('div', { class: 'w-small w-mono', style: { display: 'flex', justifyContent: 'space-between' } }, h('span', {}, '0 s'), h('span', {}, `клик на ${(clickAt / 1000).toFixed(1)} s`), h('span', {}, `${(end / 1000).toFixed(1)} s`))));
  }
  update();
});
