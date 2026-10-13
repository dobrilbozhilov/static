/*
  Симулатор на event loop. Не интерпретира JavaScript: всеки сценарий е код като текст плюс
  ръчно описани стъпки, за да е редът точен. compile() превръща стъпките в кадри за W.stepper,
  view() рисува панелите (код, стек, Web APIs, опашки, конзола) и ги обновява по кадър.

  Стъпка: { line, op, label, msg, phase }
    op: push | pop | webapi | webapi-done | enqueueTask | enqueueMicro | dequeueTask | dequeueMicro | log | render | note
    phase: script | micro | render | task | idle  (фазата на event loop, остава до следваща смяна)
*/
window.LoopSim = (() => {
  const { h, codeLines } = W;

  const PHASES = [
    ['script', 'Изпълнява стека'],
    ['micro', 'Изпразва микрозадачите'],
    ['render', 'Рисува кадър'],
    ['task', 'Взема следваща задача'],
    ['idle', 'Чака'],
  ];

  // Стъпки без собствен текст получават кратко обяснение според операцията.
  function defaultMsg(s) {
    const l = s.label ? `<code>${s.label}</code>` : 'функцията';
    switch (s.op) {
      case 'push': return `${l} влиза в стека като нов frame най-отгоре. Изпълнява се, докато не върне.`;
      case 'pop': return `${l} върна и излезе от стека. Продължава този под нея.`;
      case 'webapi': return `${l} се предава на браузъра. JavaScript не чака, продължава нататък.`;
      case 'webapi-done': return `Браузърът приключи с ${l}.`;
      case 'enqueueTask': return `${l} се нарежда в Task Queue. Ще се изпълни чак когато стекът е празен и микрозадачите са свършили.`;
      case 'enqueueMicro': return `${l} се нарежда в Microtask Queue. Ще се изпълни веднага щом стекът се изпразни, преди всяка задача и преди рендер.`;
      case 'dequeueTask': return `Event loop взема ${l} от Task Queue и я слага в стека.`;
      case 'dequeueMicro': return `Event loop взема ${l} от Microtask Queue и я слага в стека.`;
      case 'log': return `В конзолата излиза ${l}.`;
      case 'render': return 'Браузърът рисува кадър: стекът е празен и микрозадачите са свършили.';
      default: return '';
    }
  }

  function compile(scenario) {
    const st = { stack: [], webapis: [], tasks: [], micros: [], console: [], phase: 'script', line: null, msg: '' };
    const frames = [];
    for (const s of scenario.steps) {
      if (s.line != null) st.line = s.line;
      if (s.phase) st.phase = s.phase;
      st.msg = s.msg || (() => { const m = defaultMsg(s); return m.charAt(0).toUpperCase() + m.slice(1); })();
      switch (s.op) {
        case 'push': st.stack.push(s.label); break;
        case 'pop': st.stack.pop(); break;
        case 'webapi': st.webapis.push(s.label); break;
        case 'webapi-done': { const i = st.webapis.indexOf(s.label); if (i >= 0) st.webapis.splice(i, 1); break; }
        case 'enqueueTask': st.tasks.push(s.label); break;
        case 'enqueueMicro': st.micros.push(s.label); break;
        case 'dequeueTask': st.tasks.shift(); break;
        case 'dequeueMicro': st.micros.shift(); break;
        case 'log': st.console.push(s.label); break;
        default: break;
      }
      frames.push({
        op: s.op, label: s.label, line: st.line, phase: st.phase, msg: st.msg,
        stack: [...st.stack], webapis: [...st.webapis], tasks: [...st.tasks], micros: [...st.micros], console: [...st.console],
      });
    }
    return frames;
  }

  // Рисува панелите за даден код; update(frame) ги обновява.
  function view(code) {
    const codeEl = codeLines(code);
    const phaseEl = h('div', { class: 'ls-phases' }, PHASES.map(([id, name]) => h('span', { class: 'ls-phase', dataset: { phase: id } }, name)));
    const stack = h('div', { class: 'ls-stack' });
    const webapis = h('div', { class: 'ls-list' });
    const micros = h('div', { class: 'ls-queue' });
    const tasks = h('div', { class: 'ls-queue' });
    const cons = h('div', { class: 'ls-console' });
    const panel = (title, child, cls = '') => h('div', { class: 'w-panel ls-panel ' + cls }, h('div', { class: 'w-panel-title' }, title), child);
    const el = h('div', { class: 'ls' },
      h('div', { class: 'w-grid-2 ls-top' },
        codeEl.el,
        h('div', { class: 'ls-right' },
          phaseEl,
          h('div', { class: 'w-grid-2' }, panel('Call Stack', stack, 'ls-stack-panel'), panel('Web APIs (браузърът)', webapis)),
        ),
      ),
      h('div', { class: 'w-grid-3 ls-bottom' },
        panel('Microtask Queue', micros, 'ls-micro'),
        panel('Task Queue (макрозадачи)', tasks, 'ls-task'),
        panel('Console', cons),
      ),
    );
    const empty = (text) => h('span', { class: 'ls-empty' }, text);
    const fill = (box, items, cls, emptyText, highlightLast) => {
      box.innerHTML = '';
      if (!items.length) { box.append(empty(emptyText)); return; }
      items.forEach((it, i) => box.append(h('span', { class: 'ls-item ' + cls + (highlightLast && i === items.length - 1 ? ' top' : '') }, it)));
    };
    let prevConsole = 0;
    function update(f) {
      codeEl.setActive(f.line);
      for (const p of phaseEl.children) p.classList.toggle('active', p.dataset.phase === f.phase);
      fill(stack, f.stack, 'ls-frame', 'празен', true);
      fill(webapis, f.webapis, 'ls-api', 'нищо не чака');
      fill(micros, f.micros, 'ls-m', 'празна');
      fill(tasks, f.tasks, 'ls-t', 'празна');
      cons.innerHTML = '';
      if (!f.console.length) cons.append(empty('(нищо)'));
      f.console.forEach((line, i) => cons.append(h('div', { class: 'ls-out' + (i === f.console.length - 1 && f.console.length !== prevConsole ? ' fresh' : '') }, '> ' + line)));
      prevConsole = f.console.length;
      // Подсветка на панела, в който стъпката е направила нещо.
      el.querySelectorAll('.ls-panel').forEach((p) => p.classList.remove('hot'));
      const hot = { push: '.ls-stack-panel', pop: '.ls-stack-panel', enqueueMicro: '.ls-micro', dequeueMicro: '.ls-micro', enqueueTask: '.ls-task', dequeueTask: '.ls-task' }[f.op];
      if (hot) el.querySelector(hot).classList.add('hot');
    }
    return { el, update };
  }

  return { compile, view, PHASES };
})();
