/* Visual step builder: pick a flowchart shape, fill in a small form, get a line of code. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ICON = {
    rect: (fill, stroke, inner = '') => `<svg viewBox="0 0 48 30" class="sb-ico"><rect x="3" y="5" width="42" height="20" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${inner}</svg>`,
    diamond: (inner = '', extra = '') => `<svg viewBox="0 0 48 30" class="sb-ico"><polygon points="24,2 45,15 24,28 3,15" fill="#ffe8f2" stroke="#d6336c" stroke-width="2"/>${inner}${extra}</svg>`,
    hex: () => `<svg viewBox="0 0 48 30" class="sb-ico"><polygon points="10,5 38,5 45,15 38,25 10,25 3,15" fill="#e3faf2" stroke="#0ca678" stroke-width="2"/><path d="M18 15 a6 6 0 1 1 6 6" fill="none" stroke="#0ca678" stroke-width="2"/></svg>`,
  };
  const TYPES = [
    { id: 'set', name: 'Action', desc: 'Change a light, gate, door…', icon: ICON.rect('#e9efff', '#4c6ef5', '<circle cx="12" cy="15" r="4" fill="#2fd158"/><rect x="20" y="13" width="18" height="4" rx="2" fill="#4c6ef5" opacity=".5"/>') },
    { id: 'wait', name: 'Wait', desc: 'Pause for some seconds', icon: ICON.rect('#fff3dc', '#f08c00', '<circle cx="24" cy="15" r="6" fill="none" stroke="#f08c00" stroke-width="2"/><path d="M24 11v4l3 2" stroke="#f08c00" stroke-width="2" fill="none"/>') },
    { id: 'waitUntil', name: 'Wait until', desc: 'Pause until something is true', icon: ICON.diamond('<text x="24" y="19" text-anchor="middle" font-size="10" font-weight="900" fill="#a3366a">?</text>', '<path d="M45 15 h2 v-13 h-23" fill="none" stroke="#d6336c" stroke-width="1.5"/>') },
    { id: 'if', name: 'If / else', desc: 'Make a decision', icon: ICON.diamond('<text x="24" y="19" text-anchor="middle" font-size="10" font-weight="900" fill="#a3366a">IF</text>') },
    { id: 'while', name: 'While', desc: 'Repeat while something is true', icon: ICON.diamond('<text x="24" y="19" text-anchor="middle" font-size="7.5" font-weight="900" fill="#a3366a">WHILE</text>') },
    { id: 'repeat', name: 'Repeat', desc: 'Repeat a number of times', icon: ICON.diamond('<text x="24" y="19" text-anchor="middle" font-size="10" font-weight="900" fill="#a3366a">×3</text>') },
    { id: 'forever', name: 'Forever', desc: 'Repeat for ever', icon: ICON.hex() },
    { id: 'assign', name: 'Variable', desc: 'Remember or count a number', icon: ICON.rect('#f3e8ff', '#9c36b5', '<text x="24" y="19" text-anchor="middle" font-size="10" font-weight="900" fill="#9c36b5">x = 1</text>') },
  ];
  const typeById = Object.fromEntries(TYPES.map((t) => [t.id, t]));

  /* ---------- condition builder ---------- */
  function condOptions(scn) {
    const si = FL.lang.sensorInfo(scn);
    const opts = [];
    si.bool.forEach((s) => opts.push({ v: 's:' + s, label: s, group: 'Sensors' }));
    si.num.forEach((s) => opts.push({ v: 'n:' + s, label: s + ' (number)', group: 'Numbers' }));
    for (const [d, def] of Object.entries(scn.devices)) def.states.forEach((st) => opts.push({ v: 'd:' + d + '|' + st, label: `${d} is ${st}`, group: 'Devices' }));
    opts.push({ v: 'c:', label: 'Something else (type it)…', group: 'Other' });
    return opts;
  }
  function condFromStmt(st) {
    let c = st.cond;
    let not = false;
    if (c && c.type === 'not') {
      not = true;
      c = c.a;
    }
    if (c && c.type === 'sensor') return { kind: 's:' + c.name, not };
    if (c && c.type === 'devState') return { kind: 'd:' + c.device + '|' + c.state, not };
    if (c && c.type === 'cmp' && c.a.type === 'nsensor' && c.b.type === 'num') return { kind: 'n:' + c.a.name, not, op: c.op, val: c.b.v };
    return { kind: 'c:', text: st.condText };
  }
  function condHtml(scn, pre) {
    const opts = condOptions(scn);
    pre = pre || { kind: opts[0] ? opts[0].v : 'c:' };
    const groups = [...new Set(opts.map((o) => o.group))];
    const sel = groups
      .map((g) => `<optgroup label="${g}">${opts.filter((o) => o.group === g).map((o) => `<option value="${esc(o.v)}"${o.v === pre.kind ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</optgroup>`)
      .join('');
    const ops = ['>', '<', '>=', '<=', '=', '!='];
    return `<div class="sb-cond">
      <label class="sb-label">Check</label>
      <select data-f="ckind">${sel}</select>
      <div class="sb-row sb-num ${pre.kind.startsWith('n:') ? '' : 'hidden'}">
        <select data-f="cop">${ops.map((o) => `<option${o === (pre.op || '>') ? ' selected' : ''}>${o}</option>`).join('')}</select>
        <input data-f="cval" type="number" step="1" value="${pre.val != null ? pre.val : 3}">
      </div>
      <input class="sb-custom ${pre.kind === 'c:' ? '' : 'hidden'}" data-f="ctext" placeholder="e.g. count > 3 and dark" value="${esc(pre.text || '')}">
      <label class="sb-check ${pre.kind === 'c:' ? 'hidden' : ''}" data-not><input type="checkbox" data-f="cnot"${pre.not ? ' checked' : ''}> <b>not</b> (the opposite)</label>
    </div>`;
  }
  function condText(root) {
    const kind = root.querySelector('[data-f="ckind"]').value;
    const not = root.querySelector('[data-f="cnot"]').checked;
    if (kind === 'c:') return root.querySelector('[data-f="ctext"]').value.trim();
    const body = kind.slice(2);
    if (kind.startsWith('s:')) return (not ? 'not ' : '') + body;
    if (kind.startsWith('d:')) {
      const [d, st] = body.split('|');
      return `${d} is ${not ? 'not ' : ''}${st}`;
    }
    const op = root.querySelector('[data-f="cop"]').value;
    const val = root.querySelector('[data-f="cval"]').value || '0';
    return `${not ? 'not ' : ''}${body} ${op} ${val}`;
  }

  /* ---------- forms ---------- */
  function fmt(n) {
    return String(Math.round(n * 100) / 100);
  }
  function formHtml(type, scn, pre, adding) {
    pre = pre || {};
    switch (type) {
      case 'set': {
        const devs = Object.keys(scn.devices);
        const dev = pre.device || devs[0];
        return `<label class="sb-label">Device</label>
          <select data-f="device">${devs.map((d) => `<option${d === dev ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select>
          <label class="sb-label">Set it to</label>
          <div class="sb-states" data-states>${statesHtml(scn, dev, pre.state)}</div>`;
      }
      case 'wait': {
        const v = pre.seconds != null ? fmt(pre.seconds) : pre.secondsText || '1';
        return `<label class="sb-label">Seconds</label>
          <div class="sb-row"><input data-f="seconds" value="${esc(v)}" inputmode="decimal"></div>
          <div class="sb-quick">${[0.5, 1, 2, 3, 5, 10].map((n) => `<button type="button" data-quick="seconds" data-v="${n}">${n}</button>`).join('')}</div>`;
      }
      case 'repeat': {
        const v = pre.count != null ? pre.count : pre.countText || '3';
        return `<label class="sb-label">How many times?</label>
          <div class="sb-row"><input data-f="count" value="${esc(v)}" inputmode="numeric"></div>
          <div class="sb-quick">${[2, 3, 4, 5, 10].map((n) => `<button type="button" data-quick="count" data-v="${n}">${n}</button>`).join('')}</div>`;
      }
      case 'waitUntil':
      case 'while':
        return condHtml(scn, pre.cond);
      case 'if':
        return condHtml(scn, pre.cond) + (adding ? `<label class="sb-check"><input type="checkbox" data-f="else" checked> Add an <b>else</b> branch (what to do otherwise)</label>` : '');
      case 'forever':
        return `<p class="sb-note">Everything inside this block repeats for ever. A <code>wait 1</code> step is added inside – change it to whatever you need.</p>`;
      case 'assign': {
        const mode = pre.op === 'add' ? 'change' : 'set';
        return `<label class="sb-label">Variable name</label>
          <input data-f="name" value="${esc(pre.name || 'count')}" spellcheck="false" autocomplete="off">
          <div class="sb-row">
            <select data-f="mode"><option value="set"${mode === 'set' ? ' selected' : ''}>set to</option><option value="change"${mode === 'change' ? ' selected' : ''}>change by</option></select>
            <input data-f="expr" value="${esc(pre.exprText || (mode === 'change' ? '1' : '0'))}" spellcheck="false">
          </div>
          <p class="sb-note">The value can be a number, another variable, or a sum like <code>count + 1</code>.</p>`;
      }
    }
    return '';
  }
  function statesHtml(scn, dev, cur) {
    const d = scn.devices[dev];
    const cols = d.stateColors || {};
    const sel = cur && d.states.includes(cur) ? cur : d.states[0];
    return d.states
      .map((s) => {
        const sw = s.split(' ').map((p) => cols[p] || cols[s]).filter(Boolean);
        return `<button type="button" class="sb-state${s === sel ? ' on' : ''}" data-state="${esc(s)}">${sw.map((c) => `<i style="background:${c}"></i>`).join('')}${esc(s)}</button>`;
      })
      .join('');
  }

  /* Returns the code lines (first line is the step, extra lines are the block body). */
  function buildLines(type, root, adding) {
    const v = (f) => {
      const el = root.querySelector(`[data-f="${f}"]`);
      return el ? el.value.trim() : '';
    };
    const body = adding ? ['    wait 1'] : [];
    switch (type) {
      case 'set': {
        const on = root.querySelector('.sb-state.on');
        return [`set ${v('device')} ${on ? on.dataset.state : ''}`];
      }
      case 'wait':
        return [`wait ${v('seconds') || '1'}`];
      case 'repeat':
        return [`repeat ${v('count') || '3'} times:`, ...body];
      case 'waitUntil':
        return [`wait until ${condText(root)}`];
      case 'while':
        return [`while ${condText(root)}:`, ...body];
      case 'if': {
        const lines = [`if ${condText(root)}:`, ...body];
        const el = root.querySelector('[data-f="else"]');
        if (adding && el && el.checked) lines.push('else:', '    wait 1');
        return lines;
      }
      case 'forever':
        return ['forever:', ...body];
      case 'assign': {
        const name = (v('name') || 'count').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        return v('mode') === 'change' ? [`change ${name} by ${v('expr') || '1'}`] : [`set ${name} to ${v('expr') || '0'}`];
      }
    }
    return [];
  }

  /* Wire up interactive bits of a form; onChange is called whenever the preview should refresh. */
  function bind(root, scn, onChange) {
    root.addEventListener('input', onChange);
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-f="device"]')) {
        root.querySelector('[data-states]').innerHTML = statesHtml(scn, e.target.value);
      }
      if (e.target.matches('[data-f="ckind"]')) {
        const k = e.target.value;
        root.querySelector('.sb-num').classList.toggle('hidden', !k.startsWith('n:'));
        root.querySelector('.sb-custom').classList.toggle('hidden', k !== 'c:');
        root.querySelector('[data-not]').classList.toggle('hidden', k === 'c:');
        if (k === 'c:') root.querySelector('.sb-custom').focus();
      }
      onChange();
    });
    root.addEventListener('click', (e) => {
      const s = e.target.closest('.sb-state');
      if (s) {
        root.querySelectorAll('.sb-state').forEach((b) => b.classList.toggle('on', b === s));
        onChange();
      }
      const q = e.target.closest('[data-quick]');
      if (q) {
        root.querySelector(`[data-f="${q.dataset.quick}"]`).value = q.dataset.v;
        onChange();
      }
    });
  }

  function paletteHtml() {
    return `<div class="sb-grid">${TYPES.map((t) => `<button type="button" class="sb-type" data-type="${t.id}">${t.icon}<span><b>${t.name}</b><small>${t.desc}</small></span></button>`).join('')}</div>`;
  }

  FL.stepBuilder = { TYPES, typeById, formHtml, buildLines, bind, paletteHtml, condFromStmt };
})();
