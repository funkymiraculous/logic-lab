(function () {
  const FL = globalThis.FL;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  const S = {
    scn: null, sim: null, runner: null, parsed: null, lastGood: null,
    running: false, paused: false, finished: false, speed: 1, crashTimer: 0,
    view: 'code', zoom: 1, autoFit: true, activeId: null, hintIndex: 0, last: 0, lastUi: 0,
  };

  let editor;
  const canvas = $('#sim-canvas');
  const ctx = canvas.getContext('2d');

  /* ================= HOME ================= */
  function renderHome() {
    const done = JSON.parse(store.get('logiclab.done') || '{}');
    const levels = ['Beginner', 'Intermediate', 'Advanced'];
    const card = (s) => `
      <button class="card" data-id="${s.id}">
        <span class="thumb">${s.thumb}</span>
        <span class="card-body">
          <span class="card-top"><span class="badge level-${s.difficulty.toLowerCase()}">${s.difficulty}</span>${done[s.id] ? `<span class="done-badge">✓ Completed${done[s.id] === 'bonus' ? ' + bonus ⭐' : ''}</span>` : ''}</span>
          <h2>${esc(s.title)}</h2>
          <p>${esc(s.tagline)}</p>
          <span class="chips">${s.concepts.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</span>
        </span>
      </button>`;
    const total = FL.scenarios.length;
    const doneCount = FL.scenarios.filter((s) => done[s.id]).length;
    $('#scenario-cards').innerHTML =
      `<div class="progress-line">${doneCount} of ${total} missions complete</div>` +
      levels
        .map((lvl) => {
          const list = FL.scenarios.filter((s) => s.difficulty === lvl).sort((a, b) => (a.order || 0) - (b.order || 0));
          if (!list.length) return '';
          return `<h2 class="level-head level-${lvl.toLowerCase()}">${lvl}</h2><div class="cards">${list.map(card).join('')}</div>`;
        })
        .join('');
    $$('#scenario-cards .card[data-id]').forEach((el) => el.addEventListener('click', () => openScenario(el.dataset.id)));
  }

  function showScreen(id) {
    $('#home').classList.toggle('hidden', id !== 'home');
    $('#workspace').classList.toggle('hidden', id !== 'workspace');
  }

  /* ================= WORKSPACE ================= */
  function openScenario(id) {
    const scn = FL.scenarios.find((s) => s.id === id);
    if (!scn) return;
    S.scn = scn;
    S.sim = scn.create();
    S.hintIndex = 0;
    S.lastGood = null;
    S.autoFit = true;
    stopRun();
    $('#ws-title').textContent = scn.title;
    $('#ws-level').textContent = scn.difficulty;
    $('#ws-level').className = 'badge level-' + scn.difficulty.toLowerCase();
    editor.setVocab(scn);
    editor.setValue(store.get('logiclab.code.' + id) || scn.starter);
    resetHistory();
    buildSnippets();
    buildReference();
    showScreen('workspace');
    setView(store.get('logiclab.view') || 'code');
    reparse();
    resizeCanvas();
    updateUi();
    showMission();
    history.replaceState(null, '', '#' + id);
  }

  function goHome() {
    stopRun();
    S.scn = null;
    showScreen('home');
    renderHome();
    history.replaceState(null, '', location.pathname);
  }

  function setView(v) {
    S.view = v;
    store.set('logiclab.view', v);
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    $('#code-view').classList.toggle('hidden', v !== 'code');
    $('#flow-view').classList.toggle('hidden', v !== 'flow');
    closePop();
    if (v === 'flow') {
      renderFlow();
    }
  }

  /* ---------- undo / redo ----------
   * A list of earlier versions of the program. Typing is grouped into one step
   * after a short pause; every flowchart change is its own step. */
  const HIST = { undo: [], redo: [], last: null, timer: null };
  function resetHistory() {
    HIST.undo = [];
    HIST.redo = [];
    HIST.last = editor.getValue();
    clearTimeout(HIST.timer);
    updateUndoButtons();
  }
  function recordNow() {
    clearTimeout(HIST.timer);
    const v = editor.getValue();
    if (HIST.last !== null && v !== HIST.last) {
      HIST.undo.push(HIST.last);
      if (HIST.undo.length > 200) HIST.undo.shift();
      HIST.redo = [];
    }
    HIST.last = v;
    updateUndoButtons();
  }
  const snapshotBefore = recordNow;
  function restoreVersion(v) {
    HIST.last = v;
    editor.setValue(v);
    if (S.scn) store.set('logiclab.code.' + S.scn.id, v);
    clearTimeout(parseTimer);
    closePop();
    reparse();
  }
  function undo() {
    if (S.running) return;
    recordNow();
    if (!HIST.undo.length) return;
    HIST.redo.push(editor.getValue());
    restoreVersion(HIST.undo.pop());
    updateUndoButtons();
  }
  function redo() {
    if (S.running) return;
    recordNow();
    if (!HIST.redo.length) return;
    HIST.undo.push(editor.getValue());
    restoreVersion(HIST.redo.pop());
    updateUndoButtons();
  }
  function updateUndoButtons() {
    const u = $('#btn-undo');
    const r = $('#btn-redo');
    if (!u || !editor) return;
    const typingPending = HIST.last !== null && editor.getValue() !== HIST.last;
    u.disabled = S.running || !(HIST.undo.length || typingPending);
    r.disabled = S.running || !HIST.redo.length;
  }

  /* ---------- parsing & messages ---------- */
  let parseTimer = null;
  function onCodeChange(code) {
    if (S.scn) store.set('logiclab.code.' + S.scn.id, code);
    clearTimeout(HIST.timer);
    HIST.timer = setTimeout(recordNow, 700);
    updateUndoButtons();
    clearTimeout(parseTimer);
    parseTimer = setTimeout(reparse, 180);
  }

  function reparse() {
    if (!S.scn) return;
    const res = FL.lang.tryParse(editor.getValue(), S.scn);
    S.parsed = res;
    const bar = $('#msg-bar');
    if (res.ok) {
      S.lastGood = res.program;
      editor.setVars(res.program.vars);
      editor.setErrorLine(null);
      const w = res.program.warnings[0];
      if (w) {
        bar.className = 'msg-bar warn';
        bar.innerHTML = `⚠️ <span>${esc(w.message)} <a data-line="${w.line}">Show me</a></span>`;
      } else if (!res.program.count) {
        bar.className = 'msg-bar warn';
        bar.innerHTML = `✏️ <span>Your program is empty. Type some commands, or click the buttons above to add them.</span>`;
      } else {
        bar.className = 'msg-bar ok';
        bar.innerHTML = `✓ <span>Program looks good – ${res.program.count} step${res.program.count === 1 ? '' : 's'}. Press Run to try it!</span>`;
      }
    } else {
      editor.setErrorLine(res.error.line);
      bar.className = 'msg-bar error';
      bar.innerHTML = `✗ <span>${res.error.line ? `<a data-line="${res.error.line}">Line ${res.error.line}</a>: ` : ''}${esc(res.error.message)}</span>`;
    }
    if (S.view === 'flow') renderFlow();
  }

  /* ---------- flowchart ---------- */
  function renderFlow() {
    const prog = S.parsed && S.parsed.ok ? S.parsed.program : S.lastGood;
    const stale = !(S.parsed && S.parsed.ok);
    $('#flow-stale').classList.toggle('hidden', !stale || !S.lastGood);
    const fc = $('#flow-canvas');
    fc.classList.toggle('stale', stale);
    if (!prog) {
      fc.innerHTML = '<p class="muted">Fix the error in your code to see the flowchart.</p>';
      return;
    }
    const out = FL.flowchart.render(prog, S.scn);
    fc.innerHTML = out.svg;
    fc.dataset.w = out.width;
    fc.dataset.h = out.height;
    if (S.autoFit) fitZoom();
    else applyZoom();
    highlightActive(true);
  }
  function applyZoom() {
    const fc = $('#flow-canvas');
    const svg = fc.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('width', (+fc.dataset.w * S.zoom).toFixed(0));
    svg.setAttribute('height', (+fc.dataset.h * S.zoom).toFixed(0));
  }
  function fitZoom() {
    const fc = $('#flow-canvas');
    const box = $('#flow-scroll');
    const w = +fc.dataset.w;
    if (!w || !box.clientWidth) return;
    S.zoom = Math.max(0.4, Math.min(1.15, (box.clientWidth - 40) / w));
    applyZoom();
  }

  /* Flowchart editing: every node maps to a line of code.
   * New steps are added by picking a shape from a palette and filling in a small form. */
  const SB = () => FL.stepBuilder;
  let popFor = null;
  const pad = (n) => ' '.repeat(n);
  function closePop() {
    $('#pop').classList.add('hidden');
    $$('.fc-node.selected, .fc-plus.selected').forEach((n) => n.classList.remove('selected'));
    popFor = null;
  }
  function placePop(anchorEl) {
    const pop = $('#pop');
    const view = $('#flow-view').getBoundingClientRect();
    const r = anchorEl.getBoundingClientRect();
    pop.classList.remove('hidden');
    pop.scrollTop = 0;
    let left = r.left - view.left + r.width / 2 - 170;
    left = Math.max(8, Math.min(view.width - 348, left));
    let top = r.bottom - view.top + 8;
    if (top + pop.offsetHeight > view.height - 8) top = Math.max(8, r.top - view.top - pop.offsetHeight - 8);
    if (top + pop.offsetHeight > view.height - 8) top = 8;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function currentProgram() {
    return S.parsed && S.parsed.ok ? S.parsed.program : null;
  }
  function insertionPoint(ctx) {
    const lines = editor.getValue().split('\n');
    const st = ctx.st;
    if (ctx.kind === 'top') {
      let i = 0;
      while (i < lines.length && (/^\s*#/.test(lines[i]) || !lines[i].trim())) i++;
      return { index: i, indent: 0 };
    }
    if (ctx.kind === 'bottom') {
      let n = lines.length;
      while (n > 0 && !lines[n - 1].trim()) n--;
      return { index: n, indent: 0 };
    }
    if (ctx.kind === 'after') return { index: st.endLine, indent: st.indent };
    if (ctx.kind === 'newelse') return { index: st.endLine, indent: st.indent, newElse: true };
    if (ctx.kind === 'inside') return { index: st.line, indent: st.body && st.body[0] ? st.body[0].indent : st.indent + 4 };
    return { index: st.elseLine, indent: st.elseBody && st.elseBody[0] ? st.elseBody[0].indent : st.indent + 4 };
  }
  function whereText(ctx) {
    if (ctx.kind === 'top') return 'at the start';
    if (ctx.kind === 'bottom') return 'at the end';
    if (ctx.kind === 'after') return `after line ${ctx.st.endLine}`;
    if (ctx.kind === 'inside') return `inside line ${ctx.st.line}`;
    if (ctx.kind === 'newelse') return `in a new “else” for line ${ctx.st.line}`;
    return `in the “else” of line ${ctx.st.line}`;
  }
  function guardRunning() {
    if (S.running) {
      flashMsg('Stop the simulation to edit your program.');
      return true;
    }
    return false;
  }

  /* Step 1: choose a shape */
  function openPicker(anchorEl, ctx) {
    if (guardRunning()) return;
    const pop = $('#pop');
    pop.innerHTML = `<div class="pop-title">Add a step ${esc(whereText(ctx))}<button data-a="close" title="Close">×</button></div>${SB().paletteHtml()}`;
    placePop(anchorEl);
    pop.onclick = (e) => {
      if (e.target.closest('[data-a="close"]')) return closePop();
      const t = e.target.closest('[data-type]');
      if (t) openForm(anchorEl, { mode: 'add', ctx, type: t.dataset.type });
    };
  }

  /* Step 2: fill in the details (also used to edit an existing step) */
  function openForm(anchorEl, o) {
    const pop = $('#pop');
    const T = SB().typeById[o.type];
    const adding = o.mode === 'add';
    let pre = null;
    if (o.st) {
      pre = { ...o.st, cond: o.st.cond ? SB().condFromStmt(o.st) : undefined };
      if (o.st.type === 'assign' && o.st.op === 'sub') pre = { ...pre, op: 'add', exprText: '-' + o.st.exprText };
    }
    pop.innerHTML = `<div class="pop-title"><span class="sb-head">${T.icon}${adding ? 'New' : 'Edit'} ${esc(T.name.toLowerCase())} step${o.st ? ` · line ${o.st.line}` : ''}</span><button data-a="close" title="Close">×</button></div>
      <form class="sb-form" id="sb-form" autocomplete="off">${SB().formHtml(o.type, S.scn, pre, adding, { canWrap: adding && canWrap(o.ctx) })}</form>
      <div class="sb-preview-label">Code</div><pre class="sb-preview" id="sb-preview"></pre>
      <div class="pop-btns">
        <button class="btn small primary" data-a="commit">${adding ? '+ Add step' : 'Save'}</button>
        ${adding
          ? '<button class="btn small ghost" data-a="back">← Other shapes</button>'
          : `<button class="btn small" data-a="after">+ Step below</button>
             ${o.st.block ? '<button class="btn small" data-a="inside">+ Step inside</button>' : ''}
             <button class="btn small" data-a="delete">🗑 Delete</button>
             <button class="btn small ghost" data-a="text">Edit as text</button>`}
      </div>`;
    const form = $('#sb-form');
    const wrapping = () => {
      const w = form.querySelector('[data-f="wrap"]');
      return !!(w && w.checked);
    };
    const refresh = () => {
      const lines = SB().buildLines(o.type, form, adding);
      if (wrapping()) lines.splice(1, 0, '    # …the steps after this move in here');
      else if (adding && SB().BLOCKS.has(o.type)) lines.splice(1, 0, '    # (empty – add steps inside later)');
      $('#sb-preview').textContent = lines.join('\n');
    };
    SB().bind(form, S.scn, refresh);
    refresh();
    placePop(anchorEl);
    const first = form.querySelector('input:not([type=checkbox])');
    if (first) {
      first.focus();
      first.select();
    }
    const commit = () => {
      const lines = SB().buildLines(o.type, form, adding);
      if (adding) applyInsert(o.ctx, lines, wrapping());
      else applyReplace(o.st, lines[0]);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      commit();
    };
    pop.onclick = (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'close') closePop();
      else if (a === 'commit') commit();
      else if (a === 'back') openPicker(anchorEl, o.ctx);
      else if (a === 'after') openPicker(anchorEl, { kind: 'after', st: o.st });
      else if (a === 'inside') openPicker(anchorEl, { kind: 'inside', st: o.st });
      else if (a === 'delete') applyDelete(o.st);
      else if (a === 'text') openTextEdit(anchorEl, o.st);
    };
  }

  /* Plain text editing of one line, for anything the forms don't cover */
  function openTextEdit(anchorEl, st) {
    const pop = $('#pop');
    const lineText = editor.getValue().split('\n')[st.line - 1].trim();
    pop.innerHTML = `<div class="pop-title">Edit line ${st.line} as text<button data-a="close" title="Close">×</button></div>
      <input id="pop-input" value="${esc(lineText)}" spellcheck="false" autocomplete="off">
      <div class="pop-btns">
        <button class="btn small primary" data-a="save">Save</button>
        <button class="btn small" data-a="after">+ Step below</button>
        ${st.block ? '<button class="btn small" data-a="inside">+ Step inside</button>' : ''}
        <button class="btn small" data-a="delete">🗑 Delete</button>
        <button class="btn small ghost" data-a="code">Show in code</button>
      </div>`;
    placePop(anchorEl);
    const inp = $('#pop-input');
    inp.focus();
    inp.select();
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyReplace(st, inp.value.trim());
      if (e.key === 'Escape') closePop();
    });
    pop.onclick = (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'close') closePop();
      else if (a === 'save') applyReplace(st, inp.value.trim());
      else if (a === 'after') openPicker(anchorEl, { kind: 'after', st });
      else if (a === 'inside') openPicker(anchorEl, { kind: 'inside', st });
      else if (a === 'delete') applyDelete(st);
      else if (a === 'code') {
        setView('code');
        editor.focusLine(st.line);
      }
    };
  }

  /* Clicking a node in the flowchart */
  function openPop(nodeEl) {
    if (guardRunning()) return;
    const prog = currentProgram();
    if (!prog) return;
    closePop();
    const id = nodeEl.dataset.id;
    nodeEl.classList.add('selected');
    popFor = id;
    if (id === 'start') return openPicker(nodeEl, { kind: 'top' });
    if (id === 'end') return openPicker(nodeEl, { kind: 'bottom' });
    const st = prog.byId[id];
    if (!st) return;
    if (st.elseIf || !SB().typeById[st.type]) return openTextEdit(nodeEl, st);
    openForm(nodeEl, { mode: 'edit', st, type: st.type });
  }

  /* ---- applying changes to the code ---- */
  function commitLines(lines, focusLine) {
    snapshotBefore();
    editor.setValue(lines.join('\n'));
    onCodeChange(editor.getValue());
    recordNow();
    clearTimeout(parseTimer);
    reparse();
    closePop();
    if (!S.parsed.ok) {
      flashMsg('That change made an error – press ↶ Undo to go back, or switch to Code view to fix it.');
      return;
    }
    if (focusLine) {
      const node = [...$$('#flow-canvas .fc-node')].find((n) => +n.dataset.line === focusLine);
      if (node) {
        node.classList.add('flash');
        setTimeout(() => node.classList.remove('flash'), 1300);
      }
    }
  }
  const indentOf = (line) => line.replace(/\t/g, '    ').match(/^ */)[0].length;
  /* Where the run of steps that follows `index` (at this indent) ends. */
  function endOfRun(lines, index, indent) {
    let i = index;
    let end = index;
    while (i < lines.length) {
      const ln = lines[i];
      const code = ln.replace(/#.*$/, '');
      if (!code.trim()) {
        i++;
        continue;
      }
      const ind = indentOf(ln);
      if (ind < indent) break;
      if (ind === indent && /^\s*(else|otherwise)\b/i.test(code)) break;
      i++;
      end = i;
    }
    return end;
  }
  function canWrap(ctx) {
    if (!ctx) return false;
    const ip = insertionPoint(ctx);
    if (ip.newElse) return false;
    const lines = editor.getValue().split('\n');
    return endOfRun(lines, ip.index, ip.indent) > ip.index;
  }
  function applyInsert(ctx, newLines, wrap) {
    const lines = editor.getValue().split('\n');
    const { index, indent, newElse } = insertionPoint(ctx);
    if (newElse) {
      lines.splice(index, 0, pad(indent) + 'else:', ...newLines.map((l) => pad(indent + 4) + l));
      commitLines(lines, index + 2);
      return;
    }
    const end = wrap ? endOfRun(lines, index, indent) : index;
    const moved = lines.slice(index, end).map((l) => (l.trim() ? '    ' + l : l));
    const [head, ...tail] = newLines;
    lines.splice(index, end - index, pad(indent) + head, ...moved, ...tail.map((l) => pad(indent) + l));
    commitLines(lines, index + 1);
  }
  function applyReplace(st, text) {
    if (!text) return applyDelete(st);
    const lines = editor.getValue().split('\n');
    if (st.block && !/:\s*$/.test(text)) text += ':';
    lines[st.line - 1] = pad(st.indent) + text;
    commitLines(lines, st.line);
  }
  function applyDelete(st) {
    const lines = editor.getValue().split('\n');
    lines.splice(st.line - 1, st.endLine - st.line + 1);
    commitLines(lines, null);
  }

  function flashMsg(text) {
    const bar = $('#msg-bar');
    bar.className = 'msg-bar warn';
    bar.innerHTML = `⚠️ <span>${esc(text)}</span>`;
    clearTimeout(flashMsg.t);
    flashMsg.t = setTimeout(reparse, 3500);
  }

  /* ---------- snippets & reference ---------- */
  function buildSnippets() {
    const sn = S.scn.snippets;
    const items = [
      ['set', sn.set],
      ['wait', 'wait 1'],
      ['forever', 'forever:\n    wait 1'],
      ['repeat', 'repeat 3 times:\n    wait 1'],
      ['if / else', `if ${sn.sensor}:\n    wait 1\nelse:\n    wait 1`],
      ['while', `while ${sn.sensor}:\n    wait 1`],
      ['wait until', `wait until ${sn.sensor}`],
      ['variable', 'set count to 0'],
      ['change', 'change count by 1'],
      ['# note', '# '],
    ];
    $('#snippets').innerHTML =
      `<span class="label">Add:</span>` +
      items.map(([l, code], i) => `<button class="snip" data-i="${i}" title="${esc(code)}">${esc(l)}</button>`).join('');
    $$('#snippets .snip').forEach((b) =>
      b.addEventListener('click', () => {
        editor.insertSnippet(items[+b.dataset.i][1]);
      })
    );
  }

  function buildReference() {
    const scn = S.scn;
    const dev = Object.keys(scn.devices)[0];
    const d0 = scn.devices[dev];
    const sinfo = FL.lang.sensorInfo(scn);
    const sens = sinfo.bool[0] || S.scn.snippets.sensor;
    const desc = (v) => (typeof v === 'string' ? v : v.desc);
    const cmds = [
      [`set ${dev} ${d0.states[0]}`, `Change something in the world. Each device has its own states (see below).`],
      ['wait 2', 'Pause for a number of seconds (decimals like 0.5 are fine).'],
      [`wait until ${sens}`, 'Pause until something becomes true.'],
      ['forever:\n    …', 'Repeat the indented steps over and over, forever.'],
      ['repeat 3 times:\n    …', 'Repeat the indented steps a set number of times.'],
      [`while ${sens}:\n    …`, 'Keep repeating the indented steps while something is true.'],
      [`if ${sens}:\n    …\nelse:\n    …`, 'Make a decision. "else" is optional.'],
      ['set count to 0', 'Make a variable (a named box that holds a number) or give it a new value.'],
      ['change count by 1', 'Add to a variable (use a minus number to take away).'],
      ['if count > 3:\n    …', 'Compare numbers with  >  <  >=  <=  =  !='],
      ['# a note', 'Comments are ignored by the computer – use them for notes.'],
    ];
    $('#ref-body').innerHTML = `
      <div class="ref-section"><h4>Commands</h4><table class="ref-table">${cmds.map(([c, t]) => `<tr><td><pre>${esc(c)}</pre></td><td>${esc(t)}</td></tr>`).join('')}</table>
      <p class="muted">Indent with <b>Tab</b> (4 spaces). Lines ending in <code>:</code> start a block. You can also write <code>not</code>, <code>and</code>, <code>or</code> in conditions.</p></div>
      <div class="ref-section"><h4>Things you can control</h4><table class="ref-table">${Object.entries(scn.devices)
        .map(([n, d]) => `<tr><td><pre>${esc(n)}</pre></td><td>${esc(d.describe || '')}<br><span class="muted">States: ${d.states.map((s) => `<code>${esc(s)}</code>`).join(' ')}</span></td></tr>`)
        .join('')}</table></div>
      <div class="ref-section"><h4>Things you can check</h4><table class="ref-table">${Object.entries(scn.sensors)
        .map(([n, t]) => `<tr><td><pre>${esc(n)}</pre></td><td>${esc(desc(t))}${typeof t === 'object' && t.type === 'number' ? ' <span class="muted">(a number)</span>' : ''}</td></tr>`)
        .join('')}
        ${Object.keys(scn.devices).length ? `<tr><td><pre>${esc(dev)} is ${esc(d0.states[0])}</pre></td><td>Check what state a device is in.</td></tr>` : ''}</table></div>`;
  }

  /* ---------- modals ---------- */
  function openModal(html) {
    $('#modal-body').innerHTML = html;
    $('#modal').classList.remove('hidden');
    $('#modal-body').onclick = (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const a = b.dataset.m;
      if (a === 'close') closeModal();
      if (a === 'next-hint') showHint(true);
      if (a === 'use-solution') {
        snapshotBefore();
        editor.setValue(S.scn.solution);
        onCodeChange(S.scn.solution);
        recordNow();
        clearTimeout(parseTimer);
        reparse();
        closeModal();
      }
    };
  }
  function closeModal() {
    $('#modal').classList.add('hidden');
  }
  function showMission() {
    const scn = S.scn;
    const goals = S.sim.goals();
    S.sim.ended = false;
    openModal(`
      <div class="modal-head"><div class="eyebrow">Mission · ${esc(scn.difficulty)}</div><h2>${esc(scn.title)}</h2></div>
      <div class="modal-content">${scn.briefing}
        <h3>Goals</h3>
        <ul class="goals">${goals.map((g) => `<li class="${g.required === false ? 'bonus' : ''}"><span class="gi">${g.required === false ? '⭐' : '•'}</span><span class="gt">${esc(g.text)}</span></li>`).join('')}</ul>
      </div>
      <div class="modal-foot"><button class="btn primary" data-m="close">Let’s go!</button></div>`);
  }
  function showHint(next) {
    const hints = S.scn.hints;
    if (next) S.hintIndex = Math.min(hints.length - 1, S.hintIndex + 1);
    const i = S.hintIndex;
    openModal(`
      <div class="modal-head"><div class="eyebrow">Hint ${i + 1} of ${hints.length}</div><h2>💡 Need a nudge?</h2></div>
      <div class="modal-content"><div class="hint-box">${esc(hints[i])}</div></div>
      <div class="modal-foot">${i < hints.length - 1 ? '<button class="btn" data-m="next-hint">Another hint</button>' : ''}<button class="btn primary" data-m="close">Got it</button></div>`);
  }
  function showSolution() {
    openModal(`
      <div class="modal-head"><div class="eyebrow">One possible answer</div><h2>👀 Solution</h2></div>
      <div class="modal-content"><p>There’s more than one right answer! Here’s one that works. Using it will replace your current program.</p>
        <div class="solution-code">${esc(S.scn.solution)}</div></div>
      <div class="modal-foot"><button class="btn" data-m="close">Keep my program</button><button class="btn primary" data-m="use-solution">Use this program</button></div>`);
  }

  /* ================= SIMULATION ================= */
  function resizeCanvas() {
    const stage = $('#sim-stage');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    S.dpr = dpr;
  }

  function drawSim() {
    if (!S.sim || !canvas.width) return;
    const sim = S.sim;
    const cw = canvas.width;
    const ch = canvas.height;
    const scale = Math.min(cw / sim.W, ch / sim.H);
    const ox = (cw - sim.W * scale) / 2;
    const oy = (ch - sim.H * scale) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#26331f';
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, sim.W, sim.H);
    ctx.clip();
    sim.draw(ctx);
    ctx.restore();
  }

  function startRun() {
    if (S.running && S.paused) {
      S.paused = false;
      updateButtons();
      return;
    }
    clearTimeout(parseTimer);
    reparse();
    if (!S.parsed.ok) {
      setView('code');
      editor.focusLine(S.parsed.error.line || 1);
      return;
    }
    if (!S.parsed.program.count) {
      flashMsg('Your program is empty – add some steps first.');
      return;
    }
    closePop();
    S.sim.reset();
    S.runner = new FL.lang.Runner(S.parsed.program, S.sim);
    S.running = true;
    S.paused = false;
    S.finished = false;
    S.crashTimer = 0;
    S.activeId = null;
    editor.setReadOnly(true);
    $('#flow-canvas').classList.add('running');
    $('#sim-overlay').classList.add('hidden');
    $('#stage-hint').classList.add('hidden');
    $$('.snip').forEach((b) => (b.disabled = true));
    updateButtons();
  }

  function stopRun() {
    S.running = false;
    S.paused = false;
    S.finished = false;
    S.runner = null;
    if (S.sim) S.sim.reset();
    if (editor) editor.setReadOnly(false);
    $('#flow-canvas').classList.remove('running');
    $('#sim-overlay').classList.add('hidden');
    $('#stage-hint').classList.remove('hidden');
    $$('.snip').forEach((b) => (b.disabled = false));
    setActive(null);
    updateButtons();
    updateUi();
  }

  function endRun(kind, err) {
    S.running = false;
    S.finished = true;
    S.sim.finish();
    editor.setReadOnly(false);
    $('#flow-canvas').classList.remove('running');
    $$('.snip').forEach((b) => (b.disabled = false));
    updateButtons();
    updateUi();
    const goals = S.sim.goals();
    const required = goals.filter((g) => g.required !== false);
    const bonus = goals.filter((g) => g.required === false);
    const goalHtml = `<ul class="goals">${goals.map(goalLi).join('')}</ul>`;
    let html;
    if (kind === 'crash') {
      const r = S.sim.crash.reason;
      html = `<div class="result crash"><div class="big">${r.icon || '💥'}</div><h2>${esc(r.title)}</h2><p>${esc(r.text)}</p><div class="tip">💡 ${esc(r.tip)}</div>
        <div class="btns"><button class="btn" data-r="edit">✏️ Edit my program</button><button class="btn primary" data-r="retry">↻ Run again</button></div></div>`;
    } else if (kind === 'error') {
      html = `<div class="result crash"><div class="big">🧊</div><h2>The program froze</h2><p>${esc(err.message)}</p>
        <div class="btns"><button class="btn primary" data-r="edit">✏️ Fix my program</button></div></div>`;
      if (err.line) editor.setErrorLine(err.line);
    } else {
      const win = required.every((g) => g.status === 'pass');
      const star = win && bonus.every((g) => g.status === 'pass');
      if (win) {
        const done = JSON.parse(store.get('logiclab.done') || '{}');
        if (star || done[S.scn.id] !== 'bonus') done[S.scn.id] = star ? 'bonus' : 'done';
        store.set('logiclab.done', JSON.stringify(done));
      }
      html = win
        ? `<div class="result win"><div class="big">${star ? '🏆' : '🎉'}</div><h2>Mission complete!</h2><p>${star ? 'Perfect – you even got the bonus goal!' : 'Brilliant – everything ran safely. Can you get the bonus goal too?'}</p>${goalHtml}
          <div class="btns"><button class="btn" data-r="home">Back to scenarios</button><button class="btn primary" data-r="retry">↻ Run again</button></div></div>`
        : `<div class="result"><div class="big">⏱</div><h2>Time’s up – not quite there</h2><p>Nothing crashed, but some goals weren’t met.</p>${goalHtml}
          <div class="btns"><button class="btn" data-r="edit">✏️ Edit my program</button><button class="btn primary" data-r="retry">↻ Run again</button></div></div>`;
    }
    const ov = $('#sim-overlay');
    ov.innerHTML = html;
    ov.classList.remove('hidden');
    ov.onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const a = b.dataset.r;
      if (a === 'retry') startRun();
      if (a === 'edit') {
        stopRun();
        if (S.view === 'code') editor.focusLine((S.parsed.ok && err && err.line) || 1);
      }
      if (a === 'home') goHome();
    };
  }

  function stepSim(h) {
    try {
      S.runner.update(h);
    } catch (e) {
      if (e instanceof FL.lang.LangError) {
        endRun('error', e);
        return;
      }
      throw e;
    }
    S.sim.update(h);
    if (!S.sim.crash && S.sim.t >= S.sim.duration) endRun('time');
  }

  function loop(ts) {
    const dt = Math.min(0.05, (ts - (S.last || ts)) / 1000);
    S.last = ts;
    if (S.scn) {
      if (S.running && !S.paused) {
        if (S.sim.crash) {
          S.sim.update(dt);
          S.crashTimer += dt;
          if (S.crashTimer > 1.5) endRun('crash');
        } else {
          let rem = dt * S.speed;
          while (rem > 1e-6 && S.running && !S.sim.crash) {
            const h = Math.min(rem, 1 / 120);
            stepSim(h);
            rem -= h;
          }
        }
      }
      drawSim();
      if (ts - S.lastUi > 90) {
        updateUi();
        S.lastUi = ts;
      }
    }
    requestAnimationFrame(loop);
  }

  /* ---------- live UI ---------- */
  function goalLi(g) {
    const icon = g.status === 'pass' ? '✓' : g.status === 'fail' ? '✗' : g.required === false ? '⭐' : '•';
    return `<li class="${g.status} ${g.required === false ? 'bonus' : ''}"><span class="gi">${icon}</span><span class="gt">${esc(g.text)}${g.detail ? `<span class="gd">${esc(g.detail)}</span>` : ''}</span></li>`;
  }

  function updateUi() {
    if (!S.sim) return;
    const sim = S.sim;
    $('#sim-clock').textContent = `${Math.min(sim.t, sim.duration).toFixed(1)} s / ${sim.duration} s`;
    $('#clock-fill').style.width = `${Math.min(100, (sim.t / sim.duration) * 100)}%`;
    const gl = sim.goals().map(goalLi).join('');
    if ($('#goal-list').innerHTML !== gl) $('#goal-list').innerHTML = gl;
    const rows = sim.status();
    if (S.runner && (S.running || S.finished)) {
      for (const [k, v] of Object.entries(S.runner.vars)) rows.push({ label: '📦 ' + k, value: FL.lang.fmtNum(v), isVar: true });
    }
    $('#live-status').innerHTML = rows
      .map((s) => {
        const sw = (s.swatches || (s.swatch ? [s.swatch] : [])).map((c) => `<i class="sw" style="background:${c}"></i>`).join('');
        return `<div class="sl${s.isVar ? ' var' : ''}">${esc(s.label)}</div><div class="sv">${sw}${esc(s.value)}${s.note ? `<span class="sn">${esc(s.note)}</span>` : ''}</div>`;
      })
      .join('');
    const ps = $('#prog-status');
    if (S.runner && (S.running || S.finished)) {
      ps.innerHTML = `${S.paused ? '⏸ Paused · ' : S.running ? '▶ ' : '■ '}<b>${esc(S.runner.statusText())}</b>${S.runner.current ? ` &nbsp;›&nbsp; ${esc(S.runner.current.text)}` : ''}`;
      setActive(S.running ? S.runner.current : null);
    } else {
      ps.textContent = 'Program not running';
    }
  }

  function setActive(stmt) {
    const id = stmt ? stmt.id : null;
    if (id === S.activeId) return;
    S.activeId = id;
    editor.setActiveLine(stmt ? stmt.line : null);
    highlightActive();
  }
  function highlightActive(fromRender) {
    $$('#flow-canvas .fc-node.active').forEach((n) => n.classList.remove('active'));
    if (!S.activeId) return;
    const node = $(`#flow-canvas .fc-node[data-id="${S.activeId}"]`);
    if (node) {
      node.classList.add('active');
      if (!fromRender && S.view === 'flow') {
        const box = $('#flow-scroll');
        const r = node.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (r.top < b.top + 20 || r.bottom > b.bottom - 20) box.scrollTop += r.top - b.top - b.height / 3;
      }
    }
  }

  function updateButtons() {
    updateUndoButtons();
    const run = $('#btn-run');
    run.textContent = S.running && S.paused ? '▶ Resume' : S.running ? '▶ Running…' : '▶ Run';
    run.disabled = S.running && !S.paused;
    $('#btn-pause').disabled = !S.running || S.paused;
    $('#btn-stop').disabled = !S.running && !S.finished;
    $('#btn-reset-code').disabled = S.running;
    $('#btn-solution').disabled = S.running;
  }

  /* ================= WIRING ================= */
  function init() {
    editor = new FL.CodeEditor($('#editor'), { onChange: onCodeChange });
    renderHome();

    $('#btn-back').addEventListener('click', goHome);
    $('#btn-mission').addEventListener('click', showMission);
    $('#btn-hint').addEventListener('click', () => showHint(false));
    $('#btn-solution').addEventListener('click', showSolution);
    $('#btn-reset-code').addEventListener('click', () => {
      openModal(`<div class="modal-head"><h2>Start over?</h2></div><div class="modal-content"><p>This replaces your program with the starting program for this scenario.</p></div>
        <div class="modal-foot"><button class="btn" data-m="close">Cancel</button><button class="btn primary" id="confirm-reset">Start over</button></div>`);
      $('#confirm-reset').addEventListener('click', () => {
        snapshotBefore();
        editor.setValue(S.scn.starter);
        onCodeChange(S.scn.starter);
        recordNow();
        clearTimeout(parseTimer);
        reparse();
        closeModal();
      });
    });
    $('#modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-redo').addEventListener('click', redo);
    document.addEventListener('keydown', (e) => {
      // Cmd/Ctrl+Z to undo, with Shift (or Ctrl+Y) to redo – except while typing in a box,
      // where the box's own undo works
      const k = (e.key || '').toLowerCase();
      if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'y') && S.scn && !$('#workspace').classList.contains('hidden')) {
        const t = e.target;
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
        e.preventDefault();
        if (k === 'y' || e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === 'Escape') {
        closeModal();
        closePop();
      }
    });

    $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
    $('#msg-bar').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-line]');
      if (!a) return;
      setView('code');
      editor.focusLine(+a.dataset.line);
    });

    $('#flow-canvas').addEventListener('click', (e) => {
      const pl = e.target.closest('.fc-plus');
      if (pl) {
        const prog = currentProgram();
        if (!prog) return;
        closePop();
        pl.classList.add('selected');
        const [kind, id] = pl.dataset.ins.split(':');
        openPicker(pl, { kind, st: id ? prog.byId[id] : null });
        return;
      }
      const n = e.target.closest('.fc-node');
      if (n) openPop(n);
      else closePop();
    });
    $('#flow-canvas').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.closest('.fc-node')) openPop(e.target.closest('.fc-node'));
      if (e.key === 'Enter' && e.target.closest('.fc-plus')) e.target.closest('.fc-plus').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    $$('[data-zoom]').forEach((b) =>
      b.addEventListener('click', () => {
        const z = +b.dataset.zoom;
        if (z === 0) {
          S.autoFit = true;
          fitZoom();
        } else {
          S.autoFit = false;
          S.zoom = Math.max(0.3, Math.min(2.5, S.zoom * (z > 0 ? 1.2 : 1 / 1.2)));
          applyZoom();
        }
        closePop();
      })
    );

    $('#btn-run').addEventListener('click', startRun);
    $('#btn-pause').addEventListener('click', () => {
      S.paused = true;
      updateButtons();
      updateUi();
    });
    $('#btn-stop').addEventListener('click', stopRun);
    $$('#speed button').forEach((b) =>
      b.addEventListener('click', () => {
        S.speed = +b.dataset.speed;
        $$('#speed button').forEach((x) => x.classList.toggle('active', x === b));
      })
    );

    // resizable split
    const divider = $('#divider');
    divider.addEventListener('pointerdown', (e) => {
      if (window.innerWidth <= 900) return;
      divider.setPointerCapture(e.pointerId);
      divider.classList.add('drag');
      const split = $('#split').getBoundingClientRect();
      const move = (ev) => {
        const pct = Math.max(25, Math.min(70, ((ev.clientX - split.left) / split.width) * 100));
        $('#prog-panel').style.flexBasis = pct + '%';
      };
      const up = () => {
        divider.classList.remove('drag');
        divider.removeEventListener('pointermove', move);
        divider.removeEventListener('pointerup', up);
        if (S.autoFit && S.view === 'flow') fitZoom();
      };
      divider.addEventListener('pointermove', move);
      divider.addEventListener('pointerup', up);
    });

    new ResizeObserver(() => resizeCanvas()).observe($('#sim-stage'));
    window.addEventListener('resize', () => {
      if (S.autoFit && S.view === 'flow') fitZoom();
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (S.view === 'flow' && S.scn) renderFlow();
      });
    }

    const hash = location.hash.slice(1);
    if (hash && FL.scenarios.some((s) => s.id === hash)) openScenario(hash);
    requestAnimationFrame(loop);
  }

  init();
})();
