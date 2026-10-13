/* Data-driven flow player: SPEC describes the diagram and the steps, TIMELINE (from the narration) gives every cue a start time.
   render(t) is a pure function of time so seeking, scrubbing and frame capture all work the same way. */
(() => {
  const SPEC = window.SPEC, TL = window.TIMELINE;
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeIO = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const backOut = (p) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  const COL = { sync: '#f2a33a', async: '#a08cff', read: '#2ec9b8', bad: '#ff5f5f', good: '#41d98a', idle: '#3a4152' };
  const TINT = { sync: '#2a2115', async: '#201b36', read: '#112a2a', bad: '#2b1414', good: '#11261b' };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const stage = document.getElementById('stage');

  /* ---------- geometry ---------- */
  // Node centers and via points are stage pixels inside the diagram area (x 60..1250, y 190..890).
  const nodes = {};
  for (const n of SPEC.nodes) {
    const lines = n.label.split('\n');
    const w = n.w || Math.max(140, 28 + 11.6 * Math.max(...lines.map((l) => l.length)), 24 + 8.4 * (n.sub || '').length);
    const h = n.h || 22 * lines.length + (n.sub ? 20 : 0) + 30;
    nodes[n.id] = { ...n, cx: n.x, cy: n.y, w, h, lines };
  }
  // Point on the node's bounding box in direction (dx, dy), plus a small gap for the arrowhead.
  function anchor(n, dx, dy, gap = 6) {
    const hw = n.w / 2 + gap, hh = n.h / 2 + gap;
    const t = Math.min(dx ? hw / Math.abs(dx) : 1e9, dy ? hh / Math.abs(dy) : 1e9);
    return [n.cx + dx * t, n.cy + dy * t];
  }
  const edges = {};
  for (const e of SPEC.edges) {
    const a = nodes[e.from], b = nodes[e.to];
    if (!a || !b) throw new Error('edge ' + e.id + ' references unknown node');
    const via = e.via || [];
    const p1 = via[0] || [b.cx, b.cy], pn = via[via.length - 1] || [a.cx, a.cy];
    const start = anchor(a, p1[0] - a.cx, p1[1] - a.cy, 4);
    const end = anchor(b, pn[0] - b.cx, pn[1] - b.cy, 10);
    const pts = [start, ...via, end];
    edges[e.id] = { ...e, kind: e.kind || (e.dash ? 'async' : 'sync'), d: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') };
  }

  /* ---------- svg defs ---------- */
  const defs = el('defs', {}, el('svg', { width: 0, height: 0, style: 'position:absolute' }, document.body));
  for (const k of ['idle', 'sync', 'async', 'read', 'bad', 'good']) {
    const m = el('marker', { id: 'm-' + k, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5.5, markerHeight: 5.5, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: COL[k] }, m);
  }

  /* ---------- shapes ---------- */
  function shape(type, w, h, g, cls) {
    const x = -w / 2, y = -h / 2;
    if (type === 'store') {
      const ry = 9;
      el('path', { class: cls, d: `M${x},${y + ry} a${w / 2},${ry} 0 0 0 ${w},0 v${h - 2 * ry} a${w / 2},${ry} 0 0 1 ${-w},0 z` }, g);
      el('ellipse', { class: cls, cx: 0, cy: y + ry, rx: w / 2, ry }, g);
      return;
    }
    if (type === 'broker') { el('rect', { class: cls, x, y, width: w, height: h, rx: h / 2 }, g); return; }
    if (type === 'external') {
      el('rect', { class: cls, x, y, width: w, height: h, rx: 10 }, g);
      if (cls === 'shape') el('rect', { class: 'shape', x: x + 6, y: y + 6, width: w - 12, height: h - 12, rx: 6, style: 'fill:none;stroke-width:1.5' }, g);
      return;
    }
    if (type === 'client') { el('rect', { class: cls, x, y, width: w, height: h, rx: 30 }, g); return; }
    el('rect', { class: cls, x, y, width: w, height: h, rx: 16 }, g);
  }

  function buildDiagram(svg, show) {
    const set = show ? new Set(show) : null;
    const vis = (id) => !set || set.has(id);
    const E = {}, N = {}, M = {};
    for (const id in edges) {
      const e = edges[id];
      if (!vis(e.from) || !vis(e.to)) continue;
      const p = el('path', { class: 'edge' + (e.dash ? ' dash' : ''), d: e.d, 'marker-end': 'url(#m-idle)' }, svg);
      const L = p.getTotalLength();
      let lab = null;
      if (e.label) {
        const at = p.getPointAtLength(L * (e.at ?? 0.5));
        lab = el('g', { class: 'elabel', transform: `translate(${at.x + (e.dx || 0)},${at.y + (e.dy || 0)})` }, svg);
        const lines = e.label.split('\n'), tw = Math.max(...lines.map((s) => s.length)) * 8.6 + 14, th = lines.length * 18 + 6;
        el('rect', { x: -tw / 2, y: -th / 2, width: tw, height: th, rx: 5 }, lab);
        lines.forEach((s, i) => { const t = el('text', { x: 0, y: -th / 2 + 16 + i * 18 }, lab); t.textContent = s; });
      }
      const dots = [el('circle', { r: 14, opacity: 0 }, svg), el('circle', { r: 7, opacity: 0 }, svg)];
      E[id] = { e, p, L, lab, dots };
    }
    for (const id in nodes) {
      if (!vis(id)) continue;
      const n = nodes[id];
      const g = el('g', { class: 'node', transform: `translate(${n.cx},${n.cy})` }, svg);
      shape(n.type, n.w + 8, n.h + 8, g, 'glow');
      shape(n.type, n.w, n.h, g, 'shape');
      const top = -(22 * n.lines.length + (n.sub ? 20 : 0)) / 2;
      n.lines.forEach((line, i) => { const t = el('text', { class: 't', x: 0, y: top + 17 + i * 22 }, g); t.textContent = line; });
      if (n.sub) { const s = el('text', { class: 's', x: 0, y: top + 22 * n.lines.length + 15 }, g); s.textContent = n.sub; }
      const mark = el('g', { class: 'mark', opacity: 0 }, svg);
      const mr = el('rect', { height: 26, y: n.cy + n.h / 2 - 13 }, mark);
      const mt = el('text', { y: n.cy + n.h / 2 + 5 }, mark);
      N[id] = { n, g, shapes: [...g.querySelectorAll('.shape')], glow: g.querySelector('.glow'), mark, mr, mt, markText: '' };
    }
    for (const l of SPEC.lanes || []) {
      const t = el('text', { class: 'lane', x: l.x, y: l.y, fill: COL[l.kind] || COL.idle, 'text-anchor': l.anchor || 'start' }, svg);
      t.textContent = l.text;
    }
    return { E, N };
  }

  /* ---------- parse steps ---------- */
  function refs(list) {
    return (list || []).map((r) => {
      if (typeof r !== 'string') return r;
      const rev = r[0] === '-', bad = r.endsWith('!');
      const id = r.replace(/^-/, '').replace(/!$/, '');
      if (!edges[id]) throw new Error('unknown edge ' + id);
      return { id, rev, tone: bad ? 'bad' : null };
    });
  }
  function hl(code) {
    return esc(code)
      .replace(/(--.*|#.*|\/\/.*)$/gm, '<span class="c">$1</span>')
      .replace(/('[^']*')/g, '<span class="s">$1</span>')
      .replace(/\b(SET|GET|NX|EX|PX|INCR|HSET|HGETALL|PUBLISH|SUBSCRIBE|GEOADD|GEOSEARCH|ZREM|DEL|UPDATE|INSERT|INTO|SELECT|WHERE|AND|OR|RETURNING|VALUES|ON CONFLICT|DO NOTHING|BEGIN|COMMIT|FROM|LIMIT|POST|PUT|PATCH|DELETE|GRPC|gRPC|HTTPS|WSS|produce|consume|publish|request|reply|subscribe|acks=all|EVAL|SETNX|ZADD|ZRANGEBYSCORE|TTL)\b/g, '<span class="k">$1</span>')
      .replace(/\b(\d[\d.,]*\s?(?:ms|s|min|k|MB|GB|%|RPS|EUR)?)\b/g, '<span class="n">$1</span>');
  }

  /* ---------- scenes ---------- */
  const order = [{ id: 'intro', ...SPEC.intro, type: 'intro' }, ...SPEC.scenes.map((s) => ({ ...s, type: 'flow' })), { id: 'recap', ...SPEC.recap, type: 'recap' }];
  const chapEl = document.getElementById('chap');
  const capIn = document.getElementById('cap-in');
  const capOut = document.getElementById('cap');
  const barI = document.querySelector('#bar i');

  const scenes = order.map((s) => {
    const tl = TL.scenes.find((x) => x.id === s.id);
    if (!tl) throw new Error('timeline has no scene ' + s.id);
    const root = document.createElement('section');
    root.className = 'scene'; root.dataset.id = s.id; stage.appendChild(root);
    const cues = tl.cues.map((c) => ({ ...c, ls: c.start - tl.start }));
    const sc = { ...s, start: tl.start, end: tl.end, cues, root };
    if (s.type === 'intro') {
      root.innerHTML =
        `<div class="intro-wrap"><div class="kicker">${esc(s.kicker || 'System Design · Flow walkthrough')}</div>` +
        `<h1 class="big">${s.title}</h1><div class="sub">${esc(s.subtitle || '')}</div>` +
        `<div class="chips">${(s.chips || []).map((c) => `<span class="chip ${c.kind || ''}">${esc(c.text)}</span>`).join('')}</div></div>`;
      sc.parts = [root.querySelector('.kicker'), root.querySelector('.big'), root.querySelector('.sub'), ...root.querySelectorAll('.chip')];
    } else if (s.type === 'recap') {
      root.innerHTML =
        `<div class="sh"><div class="kicker">Recap</div><h2>${esc(s.title || 'What to say in the interview')}</h2></div>` +
        `<div class="recap-list">${s.items.map((it, i) => `<div class="check"><i style="background:${COL[it.kind || 'sync']}">${i + 1}</i><span>${it.text}</span></div>`).join('')}</div>` +
        `<div class="closing">${s.closing || ''}</div>`;
      sc.checks = [...root.querySelectorAll('.check')];
      sc.closing = root.querySelector('.closing');
    } else {
      root.innerHTML = `<div class="sh"><div class="kicker">${esc(s.kicker || '')}</div><h2>${esc(s.title)}</h2></div>`;
      const svg = el('svg', { style: 'position:absolute;left:0;top:0', width: 1920, height: 1080, viewBox: '0 0 1920 1080' }, root);
      sc.dg = buildDiagram(svg, s.show);
      const panel = document.createElement('div'); panel.id = 'panel'; root.appendChild(panel);
      sc.panel = panel; sc.panelKey = -1;
      sc.steps = s.steps.map((st, i) => {
        const E = refs(st.edges);
        const c = cues[i];
        const n = E.length, sp = n > 1 ? Math.min(0.85, (c.dur - 1.4) / (n - 1)) : 0;
        const travel = 0.8;
        E.forEach((r, k) => { r.at = 0.2 + k * sp; r.dur = travel; });
        const focus = new Set(st.focus || []);
        E.forEach((r) => { focus.add(edges[r.id].from); focus.add(edges[r.id].to); });
        const first = E[0] && edges[E[0].id];
        const title = st.title || (first ? `${nodes[E[0].rev ? first.to : first.from].label} → ${nodes[E[0].rev ? first.from : first.to].label}` : '');
        const marks = (st.marks || (st.mark ? [st.mark] : [])).map((m) => ({ ...m, at: m.at ?? (n ? 0.2 + (n - 1) * sp + travel + 0.1 : 0.6) }));
        return { ...st, E, focus: [...focus], title, marks, tone: st.tone || null };
      });
    }
    return sc;
  });
  const allCues = scenes.flatMap((s) => s.cues);

  /* ---------- per-scene rendering ---------- */
  function fadeIn(node, lt, at, mode, dur = 0.6) {
    const raw = clamp((lt - at) / dur), p = easeOut(raw), st = node.style;
    if (mode === 'pop') { st.opacity = clamp(raw * 2); st.transform = `scale(${raw === 0 ? 0.6 : 0.6 + 0.4 * backOut(raw)})`; }
    else if (mode === 'left') { st.opacity = p; st.transform = `translateX(${(1 - p) * -50}px)`; }
    else { st.opacity = p; st.transform = `translateY(${(1 - p) * 30}px)`; }
  }

  function renderIntro(s, lt) {
    s.parts.forEach((n, i) => fadeIn(n, lt, i < 3 ? 0.1 + i * 0.3 : (s.cues[1] ? s.cues[1].ls : 1.5) + (i - 3) * 0.28, i < 3 ? 'up' : 'pop'));
  }

  function renderRecap(s, lt) {
    s.checks.forEach((n, i) => fadeIn(n, lt, (s.cues[i] || s.cues[s.cues.length - 1]).ls + 0.1, 'left'));
    const last = s.cues[s.cues.length - 1];
    fadeIn(s.closing, lt, s.closingAt != null ? s.closingAt : last.ls + 0.3, 'up', 0.8);
  }

  function setNode(N, state, tone) {
    const { g, shapes, glow } = N;
    g.classList.toggle('visited', state !== 'idle');
    g.classList.toggle('focus', state === 'focus');
    const col = COL[tone] || COL.sync;
    for (const sh of shapes) {
      sh.style.stroke = state === 'idle' ? '' : col;
      sh.style.fill = state === 'focus' ? TINT[tone] || TINT.sync : state === 'visited' ? '#1a1f2a' : '';
      sh.style.strokeOpacity = state === 'visited' ? 0.6 : 1;
    }
    glow.style.stroke = col;
  }

  function renderFlow(s, lt, ci) {
    const { E, N } = s.dg;
    const nodeState = {}, edgeState = {}, markState = {};
    for (const id in N) nodeState[id] = { state: 'idle', tone: 'sync' };
    for (const id in E) edgeState[id] = { state: 'idle', tone: E[id].e.kind };
    for (let k = 0; k <= ci && k < s.steps.length; k++) {
      const st = s.steps[k], cur = k === ci, cl = lt - s.cues[k].ls;
      for (const r of st.E) {
        const ed = E[r.id]; if (!ed) continue;
        const tone = r.tone || st.tone || ed.e.kind;
        const from = r.rev ? ed.e.to : ed.e.from, to = r.rev ? ed.e.from : ed.e.to;
        const u = cur ? (cl - r.at) / r.dur : 2;
        if (u <= 0) continue;
        edgeState[r.id] = { state: cur && u < 1.3 ? 'active' : 'visited', tone, u: cur ? u : 2, rev: r.rev };
        if (nodeState[from]) nodeState[from] = { state: cur ? 'focus' : 'visited', tone };
        if (u >= 1 && nodeState[to]) nodeState[to] = { state: cur ? 'focus' : 'visited', tone, pop: cur ? u - 1 : 9 };
      }
      for (const id of st.focus || []) {
        if (!nodeState[id] || st.E.some((r) => r.id && (edges[r.id].from === id || edges[r.id].to === id))) continue;
        if (!cur || cl >= 0.2) nodeState[id] = { state: cur ? 'focus' : 'visited', tone: st.tone || 'sync', pop: cur ? cl - 0.2 : 9 };
      }
      for (const m of st.marks) if (!cur || cl >= m.at) markState[m.node] = { ...m, p: cur ? clamp((cl - m.at) / 0.4) : 1 };
    }
    for (const id in N) {
      const ns = nodeState[id]; setNode(N[id], ns.state, ns.tone);
      const pop = ns.pop != null && ns.pop < 0.5 ? Math.sin(clamp(ns.pop / 0.5) * Math.PI) : 0;
      N[id].g.setAttribute('transform', `translate(${N[id].n.cx},${N[id].n.cy}) scale(${1 + pop * 0.05})`);
      N[id].glow.style.opacity = ns.state === 'focus' ? 0.3 + pop * 0.3 : 0;
      const mk = markState[id];
      if (mk) {
        if (N[id].markText !== mk.text) {
          N[id].markText = mk.text; N[id].mt.textContent = mk.text;
          const w = mk.text.length * 9.2 + 20; N[id].mr.setAttribute('width', w); N[id].mr.setAttribute('x', N[id].n.cx + N[id].n.w / 2 - w + 8); N[id].mt.setAttribute('x', N[id].n.cx + N[id].n.w / 2 - w / 2 + 8);
          N[id].mr.setAttribute('fill', COL[mk.kind || 'good']);
        }
        N[id].mark.setAttribute('opacity', mk.p); N[id].mark.setAttribute('transform', `translate(0,${(1 - mk.p) * 8})`);
      } else { N[id].mark.setAttribute('opacity', 0); N[id].markText = ''; }
    }
    for (const id in E) {
      const es = edgeState[id], ed = E[id], col = es.state === 'idle' ? COL.idle : COL[es.tone];
      ed.p.style.stroke = col; ed.p.style.strokeOpacity = es.state === 'visited' ? 0.55 : 1; ed.p.style.strokeWidth = es.state === 'active' ? 4 : es.state === 'visited' ? 3 : 2.5;
      ed.p.setAttribute('marker-end', `url(#m-${es.state === 'idle' ? 'idle' : es.tone})`);
      if (ed.lab) { ed.lab.classList.toggle('visited', es.state !== 'idle'); ed.lab.classList.toggle('active', es.state === 'active'); ed.lab.querySelector('text').style.fill = es.state === 'active' ? col : ''; }
      const u = es.u;
      if (es.state === 'active' && u > 0 && u < 1) {
        const pt = ed.p.getPointAtLength((es.rev ? 1 - easeIO(u) : easeIO(u)) * ed.L);
        ed.dots.forEach((d, j) => { d.setAttribute('cx', pt.x); d.setAttribute('cy', pt.y); d.setAttribute('fill', col); d.setAttribute('opacity', j ? 1 : 0.25); });
      } else ed.dots.forEach((d) => d.setAttribute('opacity', 0));
    }
    // panel
    const st = s.steps[Math.max(0, Math.min(ci, s.steps.length - 1))];
    const key = Math.max(0, ci);
    if (s.panelKey !== key) {
      s.panelKey = key;
      const chips = (st.proto || (st.E[0] && edges[st.E[0].id].label ? [edges[st.E[0].id].label.replace(/\n/g, ' ')] : [])).map((p) => `<span style="color:${COL[st.tone || (st.E[0] ? (st.E[0].tone || edges[st.E[0].id].kind) : 'sync')]}">${esc(p)}</span>`).join('');
      s.panel.innerHTML =
        `<div class="pno">Step ${key + 1} / ${s.steps.length}</div><h3 class="pt">${esc(st.title)}</h3>` +
        (chips ? `<div class="pp">${chips}</div>` : '') +
        (st.code ? `<div class="pc">${hl(st.code)}</div>` : '') +
        (st.note ? `<div class="pn">${st.note}</div>` : '');
    }
    const pp = easeOut(clamp((lt - (s.cues[key] ? s.cues[key].ls : 0)) / 0.45));
    s.panel.style.opacity = pp; s.panel.style.transform = `translateY(${(1 - pp) * 18}px)`;
  }

  function render(t) {
    for (const s of scenes) {
      const lt = t - s.start, len = s.end - s.start, last = s === scenes[scenes.length - 1];
      if (lt < 0 || (lt >= len && !last)) { s.root.style.display = 'none'; continue; }
      s.root.style.display = 'block';
      const fin = clamp(lt / 0.5), fout = last ? 1 : clamp((len - lt) / 0.45);
      s.root.style.opacity = Math.min(fin, fout);
      let ci = -1; s.cues.forEach((c, i) => { if (lt >= c.ls - 0.001) ci = i; });
      if (s.type === 'intro') renderIntro(s, lt, ci);
      else if (s.type === 'recap') renderRecap(s, lt, ci);
      else renderFlow(s, lt, ci);
      chapEl.textContent = s.chapter;
    }
    const c = allCues.find((c) => t >= c.start - 0.15 && t < c.start + c.dur + 0.3);
    const op = c ? clamp(Math.min(t - c.start + 0.15, c.start + c.dur + 0.3 - t) / 0.15) : 0;
    for (const capEl of [capIn, capOut]) {
      if (c && capEl.textContent !== c.cap) capEl.textContent = c.cap;
      capEl.style.opacity = op;
    }
    barI.style.width = (100 * t) / TL.total + '%';
  }
  window.render = render;

  /* ---------- playback ---------- */
  const capture = new URLSearchParams(location.search).has('capture');
  if (capture) document.body.classList.add('capture');
  const CTRL = 44;
  function fit() {
    if (capture) return;
    const k = Math.min(innerWidth / 1920, (innerHeight - CTRL) / 1080);
    stage.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px, ${(innerHeight - CTRL - 1080 * k) / 2}px) scale(${k})`;
  }
  addEventListener('resize', fit); fit();
  render(0.01);
  if (capture) return;

  const audio = document.getElementById('audio'), ctrl = document.getElementById('ctrl'), play = document.getElementById('play'), bar = document.getElementById('bar');
  const playBtn = document.createElement('button'); playBtn.className = 'icon'; playBtn.textContent = '▶'; playBtn.title = 'Play / pause'; ctrl.appendChild(playBtn);
  const btns = scenes.map((s) => {
    const b = document.createElement('button'); b.textContent = s.chapter; ctrl.appendChild(b);
    b.onclick = () => { seek(s.start + 0.01).then(start); };
    return { b, s };
  });
  if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
    const fs = document.createElement('button'); fs.className = 'icon fs'; fs.textContent = '⛶'; fs.title = 'Fullscreen'; ctrl.appendChild(fs);
    fs.onclick = () => {
      const d = document.documentElement;
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (d.requestFullscreen || d.webkitRequestFullscreen).call(d);
    };
  }
  let ended = false, metaReady = null;
  // Nothing is fetched before the first click. The narration is then loaded as a blob, so seeking works even
  // on hosts without HTTP Range support (python -m http.server, some CDNs with a stale cache).
  function ensureMeta() {
    if (metaReady) return metaReady;
    const onMeta = () => new Promise((res) => { if (audio.readyState >= 1) res(); else { audio.addEventListener('loadedmetadata', res, { once: true }); audio.load(); } });
    metaReady = fetch(audio.getAttribute('src'))
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then((b) => { audio.src = URL.createObjectURL(b); return onMeta(); })
      .catch(onMeta);
    return metaReady;
  }
  function seek(t) { const target = clamp(t, 0, TL.total - 0.05); ended = false; render(target); return ensureMeta().then(() => { audio.currentTime = target; }); }
  function start() { play.style.display = 'none'; ensureMeta().then(() => audio.play()); }
  function toggle() { if (audio.paused) { if (ended) seek(0).then(start); else start(); } else audio.pause(); }
  play.onclick = toggle; playBtn.onclick = toggle;
  stage.onclick = () => { if (play.style.display === 'none') toggle(); };
  bar.onclick = (e) => { const r = bar.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * TL.total).then(start); };
  audio.onended = () => { ended = true; play.style.display = 'grid'; play.querySelector('div').firstChild.textContent = '↻ Play again'; };
  audio.onplay = () => { playBtn.textContent = '❚❚'; };
  audio.onpause = () => { playBtn.textContent = '▶'; };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { toggle(); e.preventDefault(); }
    if (e.code === 'ArrowRight') seek(audio.currentTime + 5);
    if (e.code === 'ArrowLeft') seek(audio.currentTime - 5);
  });
  // The handbook pauses the player when the reader navigates to another page.
  addEventListener('message', (e) => { if (e.data === 'pause' && !audio.paused) audio.pause(); });
  // Before the first play the title frame serves as the poster, without a caption.
  const POSTER = TL.scenes[0].cues[0].start + 1.6;
  (function loop() {
    const idle = audio.paused && !audio.currentTime;
    const t = idle ? POSTER : audio.currentTime;
    render(t);
    if (idle) capOut.style.opacity = 0;
    btns.forEach(({ b, s }) => b.classList.toggle('cur', t >= s.start && t < s.end));
    requestAnimationFrame(loop);
  })();
})();
