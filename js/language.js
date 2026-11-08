/* Logic Lab – a tiny beginner-friendly programming language.
 *
 *   forever:                 repeat 3 times:          while car waiting west:
 *       set beacon on            wait 1                   wait 1
 *       wait 0.5
 *   if dark:                 wait until bridge clear
 *       set floodlight on
 *   else if queue > 3:       set count to 0
 *       wait 1               change count by 1
 *   else:                    if count >= 5:
 *       set floodlight off       ...
 *
 * Blocks are made by indenting (like Python). Lines starting with # are comments.
 */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});

  class LangError extends Error {
    constructor(message, line) {
      super(message);
      this.line = line || null;
    }
  }

  const RESERVED = new Set([
    'forever', 'repeat', 'times', 'time', 'while', 'if', 'else', 'otherwise', 'then', 'wait', 'until', 'set', 'to',
    'turn', 'not', 'and', 'or', 'is', 'seconds', 'second', 'loop', 'change', 'by', 'add', 'subtract', 'from',
    'increase', 'decrease', 'on', 'off', 'true', 'false',
  ]);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function cleanState(s) {
    return s.toLowerCase().replace(/[+&,]/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function sensorInfo(scn) {
    const bool = [];
    const num = [];
    for (const [k, v] of Object.entries(scn.sensors)) (v && typeof v === 'object' && v.type === 'number' ? num : bool).push(k);
    const byLen = (a, b) => b.length - a.length;
    return { bool: bool.sort(byLen), num: num.sort(byLen) };
  }

  function buildVocab(scn) {
    const devices = [];
    for (const [name, d] of Object.entries(scn.devices)) {
      const aliases = new Set([name, ...(d.aliases || [])]);
      for (const a of aliases) devices.push({ alias: a.toLowerCase(), name });
    }
    devices.sort((a, b) => b.alias.length - a.alias.length);
    const si = sensorInfo(scn);
    return { devices, sensors: si.bool, numSensors: si.num };
  }

  function matchDevice(text, vocab) {
    text = text.replace(/^the /, '');
    for (const d of vocab.devices) {
      if (text === d.alias || text.startsWith(d.alias + ' ')) return { name: d.name, rest: text.slice(d.alias.length).trim() };
    }
    return null;
  }

  function matchState(scn, dev, raw) {
    const d = scn.devices[dev];
    let s = cleanState(raw.replace(/^(to|=)\s*/, ''));
    if (d.stateAliases && d.stateAliases[s]) s = d.stateAliases[s];
    return d.states.includes(s) ? s : null;
  }

  const stateList = (scn, dev) => scn.devices[dev].states.map((s) => `"${s}"`).join(', ');

  /* ---------- expressions (numbers, variables, number sensors) ---------- */
  function parseExpr(text, P, line) {
    let s = ' ' + text.toLowerCase().trim() + ' ';
    const sens = [];
    for (const name of P.vocab.numSensors) {
      const re = new RegExp('(^|[^a-z0-9_])' + reEsc(name) + '(?=$|[^a-z0-9_])', 'g');
      s = s.replace(re, (m, pre) => {
        sens.push(name);
        return pre + ' §' + (sens.length - 1) + ' ';
      });
    }
    const toks = s.match(/\d+(?:\.\d+)?|\.\d+|§\d+|[a-z_][a-z0-9_]*|[-+*/()]|\S/g) || [];
    let i = 0;
    const err = (m) => new LangError(m, line);
    const peek = () => toks[i];
    const next = () => toks[i++];
    function expr() {
      let a = term();
      while (peek() === '+' || peek() === '-') a = { type: 'bin', op: next(), a, b: term() };
      return a;
    }
    function term() {
      let a = factor();
      while (peek() === '*' || peek() === '/') a = { type: 'bin', op: next(), a, b: factor() };
      return a;
    }
    function factor() {
      const t = next();
      if (t === undefined) throw err(`Something is missing in "${text.trim()}" – it needs a number or a variable.`);
      if (/^[\d.]/.test(t)) return { type: 'num', v: parseFloat(t) };
      if (t[0] === '§') return { type: 'nsensor', name: sens[+t.slice(1)] };
      if (t === '(') {
        const e = expr();
        if (next() !== ')') throw err('A bracket "(" is missing its closing ")".');
        return e;
      }
      if (t === '-') return { type: 'bin', op: '-', a: { type: 'num', v: 0 }, b: factor() };
      if (/^[a-z_]/.test(t)) {
        if (RESERVED.has(t)) throw err(`"${t}" can't be used as a number here.`);
        P.used.push({ name: t, line });
        return { type: 'var', name: t };
      }
      throw err(`I don't understand "${t}" in "${text.trim()}".`);
    }
    if (!text.trim()) throw err('This needs a number or a variable.');
    const e = expr();
    if (i < toks.length) throw err(`I don't understand "${toks.slice(i).join(' ')}" in "${text.trim()}".`);
    return e;
  }

  const CMP_WORDS = [
    [' is greater than or equal to ', '>='], [' is less than or equal to ', '<='], [' is greater than ', '>'], [' is more than ', '>'],
    [' is bigger than ', '>'], [' is less than ', '<'], [' is smaller than ', '<'], [' is fewer than ', '<'], [' is at least ', '>='],
    [' is at most ', '<='], [' is equal to ', '='], [' is not ', '!='], [' equals ', '='], [' is ', '='],
  ];

  function tryComparison(t, P, line) {
    const m = t.match(/^(.+?)\s*(>=|<=|!=|==|=>|=<|=|>|<)\s*(.+)$/);
    let left, op, right;
    if (m) {
      [, left, op, right] = m;
      op = { '==': '=', '=>': '>=', '=<': '<=' }[op] || op;
    } else {
      const padded = ' ' + t + ' ';
      for (const [w, o] of CMP_WORDS) {
        const k = padded.indexOf(w);
        if (k > 0) {
          left = padded.slice(0, k);
          right = padded.slice(k + w.length);
          op = o;
          break;
        }
      }
    }
    if (!op) return null;
    return { type: 'cmp', op, a: parseExpr(left, P, line), b: parseExpr(right, P, line) };
  }

  function parseCond(text, P, line) {
    const { scn, vocab } = P;
    let t = text.toLowerCase().replace(/\?/g, '').replace(/\s+/g, ' ').trim();
    if (!t) throw new LangError('This needs something to check, for example "if dark:".', line);

    const orParts = t.split(' or ');
    if (orParts.length > 1) return orParts.map((p) => parseCond(p, P, line)).reduce((a, b) => ({ type: 'or', a, b }));
    const andParts = t.split(' and ');
    if (andParts.length > 1) {
      const asState = tryDeviceState(t, scn, vocab);
      if (asState) return asState;
      return andParts.map((p) => parseCond(p, P, line)).reduce((a, b) => ({ type: 'and', a, b }));
    }
    if (t.startsWith('not ')) return { type: 'not', a: parseCond(t.slice(4), P, line) };

    t = t.replace(/^(the|a|it is|it's) /, '');
    for (const s of vocab.sensors) if (t === s || t === 'is ' + s) return { type: 'sensor', name: s };

    const ds = tryDeviceState(t, scn, vocab);
    if (ds) return ds;
    const dm = matchDevice(t, vocab);
    if (dm && !/[<>=]/.test(t)) {
      throw new LangError(
        `To check a device, write its name, "is", then a state – for example "${dm.name} is ${scn.devices[dm.name].states[0]}". States: ${stateList(scn, dm.name)}.`,
        line
      );
    }
    const cmp = tryComparison(t, P, line);
    if (cmp) return cmp;
    for (const s of vocab.numSensors) {
      if (t === s) throw new LangError(`"${s}" is a number. Compare it with something, like "if ${s} > 3:".`, line);
    }
    const all = [...vocab.sensors, ...vocab.numSensors].map((s) => `"${s}"`).join(', ');
    throw new LangError(`I don't know how to check "${t}". Things you can check here: ${all}. You can also compare numbers, like "count > 3".`, line);
  }

  function tryDeviceState(t, scn, vocab) {
    const dm = matchDevice(t, vocab);
    if (!dm || !dm.rest) return null;
    let rest = dm.rest.replace(/^(is|=+)\s*/, '');
    let neg = false;
    if (rest.startsWith('not ')) {
      neg = true;
      rest = rest.slice(4);
    }
    const st = matchState(scn, dm.name, rest);
    if (!st) return null;
    const c = { type: 'devState', device: dm.name, state: st };
    return neg ? { type: 'not', a: c } : c;
  }

  function checkVarName(name, P, line) {
    if (RESERVED.has(name)) throw new LangError(`"${name}" is a special word, so it can't be a variable name. Try another name.`, line);
    if (P.vocab.sensors.includes(name) || P.vocab.numSensors.includes(name)) {
      throw new LangError(`"${name}" is a sensor – you can read it, but not change it.`, line);
    }
  }

  /* ---------- statements ---------- */
  function parseStmt(tok, P) {
    const { scn, vocab } = P;
    const raw = tok.text;
    const hasColon = /:\s*$/.test(raw);
    const s = raw.replace(/:\s*$/, '').trim();
    const lc = s.toLowerCase().replace(/\s+/g, ' ');
    const line = tok.line;
    const base = { line, text: raw };
    let m;

    const block = (o) => ({ ...base, ...o, block: true });
    const simple = (o) => {
      if (hasColon) {
        throw new LangError(`Only lines that start a block (forever, repeat, while, if, else) end with a colon ":". Remove the colon from "${raw}".`, line);
      }
      return { ...base, ...o };
    };

    if (/^((repeat|loop|do) )?forever$/.test(lc) || lc === 'loop') return block({ type: 'forever' });
    if ((m = lc.match(/^repeat (.+?)( times?| x)$/)) || (m = lc.match(/^repeat (\d+)$/))) {
      if (/^\d+$/.test(m[1])) return block({ type: 'repeat', count: Math.min(100000, parseInt(m[1], 10)) });
      return block({ type: 'repeat', countExpr: parseExpr(m[1], P, line), countText: m[1] });
    }
    if (/^repeat\b/.test(lc)) throw new LangError('Write "repeat 3 times:" to repeat a set number of times, or "forever:" to never stop.', line);
    if ((m = lc.match(/^while (.+)$/))) return block({ type: 'while', cond: parseCond(m[1], P, line), condText: m[1].replace(/\?$/, '') });
    if ((m = lc.match(/^if (.+?)( then)?$/))) return block({ type: 'if', cond: parseCond(m[1], P, line), condText: m[1].replace(/\?$/, '') });
    if (/^(else|otherwise)\b/.test(lc)) throw new LangError('"else" must come straight after the indented steps of an "if".', line);

    if ((m = lc.match(/^wait until (.+)$/))) return simple({ type: 'waitUntil', cond: parseCond(m[1], P, line), condText: m[1].replace(/\?$/, '') });
    if ((m = lc.match(/^wait (?:for )?(\d+(?:\.\d+)?|\.\d+) ?(s|secs?|seconds?)?$/))) {
      const sec = parseFloat(m[1]);
      if (sec > 600) throw new LangError('That wait is very long! Try a number of seconds under 600.', line);
      return simple({ type: 'wait', seconds: sec });
    }
    if ((m = lc.match(/^wait (?:for )?(.+?)(?: s| secs?| seconds?)?$/))) {
      return simple({ type: 'wait', secondsExpr: parseExpr(m[1], P, line), secondsText: m[1] });
    }
    if (/^wait\b/.test(lc)) throw new LangError('"wait" needs a number of seconds, like "wait 2" – or use "wait until <something>".', line);

    // variables: change / increase / decrease / add / subtract
    if ((m = lc.match(/^(change|increase|decrease) ([a-z_][a-z0-9_]*) by (.+)$/))) {
      checkVarName(m[2], P, line);
      P.used.push({ name: m[2], line });
      return simple({ type: 'assign', name: m[2], op: m[1] === 'decrease' ? 'sub' : 'add', expr: parseExpr(m[3], P, line), exprText: m[3] });
    }
    if ((m = lc.match(/^add (.+) to ([a-z_][a-z0-9_]*)$/))) {
      checkVarName(m[2], P, line);
      P.used.push({ name: m[2], line });
      return simple({ type: 'assign', name: m[2], op: 'add', expr: parseExpr(m[1], P, line), exprText: m[1] });
    }
    if ((m = lc.match(/^subtract (.+) from ([a-z_][a-z0-9_]*)$/))) {
      checkVarName(m[2], P, line);
      P.used.push({ name: m[2], line });
      return simple({ type: 'assign', name: m[2], op: 'sub', expr: parseExpr(m[1], P, line), exprText: m[1] });
    }

    if ((m = lc.match(/^(?:set|switch|make|change) (.+)$/))) {
      const dm = matchDevice(m[1], vocab);
      if (dm) {
        if (!dm.rest) throw new LangError(`Set ${dm.name} to what? Choose one of: ${stateList(scn, dm.name)}.`, line);
        const st = matchState(scn, dm.name, dm.rest);
        if (!st) throw new LangError(`"${dm.rest}" isn't something ${dm.name} can do. Choose one of: ${stateList(scn, dm.name)}.`, line);
        return simple({ type: 'set', device: dm.name, state: st });
      }
      const vm = m[1].match(/^([a-z_][a-z0-9_]*) (?:to|=) (.+)$/) || m[1].match(/^([a-z_][a-z0-9_]*) ?= ?(.+)$/);
      if (vm) {
        checkVarName(vm[1], P, line);
        P.assigned.add(vm[1]);
        return simple({ type: 'assign', name: vm[1], op: 'set', expr: parseExpr(vm[2], P, line), exprText: vm[2] });
      }
      throw new LangError(
        `I don't know a device called "${m[1].split(' ')[0]}". You can control: ${Object.keys(scn.devices).map((d) => `"${d}"`).join(', ')}. To make a variable, write "set name to 0".`,
        line
      );
    }
    if ((m = lc.match(/^turn (on|off) (.+)$/)) || (m = lc.match(/^turn (.+) (on|off)$/))) {
      const onOff = m[1] === 'on' || m[1] === 'off' ? m[1] : m[2];
      const devText = onOff === m[1] ? m[2] : m[1];
      const dm = matchDevice(devText, vocab);
      if (!dm) throw new LangError(`I don't know a device called "${devText}".`, line);
      const st = matchState(scn, dm.name, onOff);
      if (!st) throw new LangError(`${dm.name} can't be turned ${onOff}. Use "set ${dm.name} …" with one of: ${stateList(scn, dm.name)}.`, line);
      return simple({ type: 'set', device: dm.name, state: st });
    }

    throw new LangError(`I don't understand "${s}". Lines can start with: set, change, wait, forever, repeat, while, if, else. Check the Command reference below.`, line);
  }

  function parse(src, scn) {
    const vocab = buildVocab(scn);
    const P = { scn, vocab, used: [], assigned: new Set(), empty: [] };
    const lines = src.replace(/\r/g, '').split('\n');
    const toks = [];
    lines.forEach((rawLine, i) => {
      const code = rawLine.replace(/\t/g, '    ').replace(/#.*$/, '');
      if (!code.trim()) return;
      toks.push({ indent: code.match(/^ */)[0].length, text: code.trim(), line: i + 1 });
    });

    let pos = 0;
    let id = 0;
    const all = [];

    function register(st, indent) {
      st.id = 'n' + ++id;
      st.indent = indent;
      all.push(st);
    }
    function bodyFor(t, indent, what) {
      const n = toks[pos];
      if (!n || n.indent <= indent) {
        // an empty block is allowed – it just doesn't do anything yet
        P.empty.push({ line: t.line, message: `"${what}" on line ${t.line} has no steps inside it yet. Indent the steps that belong inside it (press Tab), or add some in the flowchart.` });
        return [];
      }
      return block(n.indent);
    }
    function ifTail(st, indent) {
      const e = toks[pos];
      if (!e || e.indent !== indent) return;
      const elif = e.text.match(/^(?:else|otherwise)\s+if\s+(.+?)(?:\s+then)?\s*:?\s*$/i);
      if (elif) {
        pos++;
        const cond = parseCond(elif[1], P, e.line);
        const sub = { line: e.line, text: e.text, type: 'if', cond, condText: elif[1].replace(/\?$/, '').toLowerCase(), block: true, elseIf: true };
        register(sub, indent);
        sub.body = bodyFor(e, indent, e.text.replace(/:\s*$/, ''));
        ifTail(sub, indent);
        sub.endLine = toks[pos - 1].line;
        st.elseLine = e.line;
        st.elseBody = [sub];
        return;
      }
      if (/^(else|otherwise)\s*:?$/i.test(e.text)) {
        pos++;
        st.elseLine = e.line;
        st.elseBody = bodyFor(e, indent, 'else');
      }
    }
    function block(indent) {
      const out = [];
      while (pos < toks.length) {
        const t = toks[pos];
        if (t.indent < indent) break;
        if (t.indent > indent) {
          throw new LangError('This line is indented further than it should be. Only the steps inside a loop, "if" or "else" are indented.', t.line);
        }
        pos++;
        const st = parseStmt(t, P);
        register(st, indent);
        if (st.block) {
          st.body = bodyFor(t, indent, t.text.replace(/:\s*$/, ''));
          if (st.type === 'if') ifTail(st, indent);
        }
        st.endLine = toks[pos - 1].line;
        out.push(st);
      }
      return out;
    }

    const body = block(0);
    for (const u of P.used) {
      if (!P.assigned.has(u.name)) {
        throw new LangError(`There's no variable called "${u.name}" yet. Create it first with a line like: set ${u.name} to 0`, u.line);
      }
    }

    const warnings = P.empty.slice();
    (function findUnreachable(seq) {
      let dead = false;
      for (const st of seq) {
        if (dead) {
          warnings.push({ line: st.line, message: `Line ${st.line} will never run – the forever loop above it never ends.` });
          break;
        }
        if (st.body) findUnreachable(st.body);
        if (st.elseBody) findUnreachable(st.elseBody);
        if (st.type === 'forever') dead = true;
      }
    })(body);

    const byId = {};
    all.forEach((s) => (byId[s.id] = s));
    return { body, warnings, count: all.length, byId, vars: [...P.assigned] };
  }

  function tryParse(src, scn) {
    try {
      return { ok: true, program: parse(src, scn) };
    } catch (e) {
      if (e instanceof LangError) return { ok: false, error: e };
      throw e;
    }
  }

  /* ---------- Interpreter ----------
   * Runs the program one step at a time against simulated time.
   * api: { setDevice(name, state), getDevice(name), readSensor(name) }
   */
  const STEP = { kind: 'step' };
  const TICK = { kind: 'tick' };

  class Runner {
    constructor(program, api) {
      this.program = program;
      this.api = api;
      this.vars = {};
      this.current = null;
      this.done = false;
      this.waitLeft = 0;
      this.mode = null;
      this.gen = this._block(program.body);
    }
    *_block(stmts) {
      for (const s of stmts) yield* this._stmt(s);
    }
    *_stmt(s) {
      this.current = s;
      switch (s.type) {
        case 'set':
          this.api.setDevice(s.device, s.state);
          yield STEP;
          break;
        case 'assign': {
          const v = this.evalExpr(s.expr);
          const cur = this.vars[s.name] || 0;
          this.vars[s.name] = s.op === 'set' ? v : s.op === 'add' ? cur + v : cur - v;
          yield STEP;
          break;
        }
        case 'wait': {
          const sec = s.seconds != null ? s.seconds : Math.max(0, Math.min(600, this.evalExpr(s.secondsExpr)));
          yield { kind: 'wait', time: sec };
          break;
        }
        case 'waitUntil':
          // always let the world move on at least one moment, so loops can't freeze
          do {
            this.current = s;
            yield TICK;
          } while (!this.evalCond(s.cond));
          yield STEP;
          break;
        case 'forever':
          for (;;) {
            this.current = s;
            yield STEP;
            yield* this._block(s.body);
          }
        case 'repeat': {
          const n = s.count != null ? s.count : Math.max(0, Math.floor(this.evalExpr(s.countExpr)));
          for (let i = 0; i < n; i++) {
            this.current = s;
            yield STEP;
            yield* this._block(s.body);
          }
          this.current = s;
          yield STEP;
          break;
        }
        case 'while':
          for (;;) {
            this.current = s;
            if (!this.evalCond(s.cond)) break;
            yield STEP;
            yield* this._block(s.body);
          }
          yield STEP;
          break;
        case 'if': {
          const r = this.evalCond(s.cond);
          yield STEP;
          if (r) yield* this._block(s.body);
          else if (s.elseBody) yield* this._block(s.elseBody);
          break;
        }
      }
    }
    evalExpr(e) {
      switch (e.type) {
        case 'num':
          return e.v;
        case 'var':
          return this.vars[e.name] || 0;
        case 'nsensor':
          return Number(this.api.readSensor(e.name)) || 0;
        case 'bin': {
          const a = this.evalExpr(e.a);
          const b = this.evalExpr(e.b);
          if (e.op === '+') return a + b;
          if (e.op === '-') return a - b;
          if (e.op === '*') return a * b;
          return b === 0 ? 0 : a / b;
        }
      }
      return 0;
    }
    evalCond(c) {
      switch (c.type) {
        case 'sensor':
          return !!this.api.readSensor(c.name);
        case 'devState':
          return this.api.getDevice(c.device) === c.state;
        case 'not':
          return !this.evalCond(c.a);
        case 'and':
          return this.evalCond(c.a) && this.evalCond(c.b);
        case 'or':
          return this.evalCond(c.a) || this.evalCond(c.b);
        case 'cmp': {
          const a = this.evalExpr(c.a);
          const b = this.evalExpr(c.b);
          const eq = Math.abs(a - b) < 1e-9;
          return { '>': a > b, '<': a < b, '>=': a >= b || eq, '<=': a <= b || eq, '=': eq, '!=': !eq }[c.op];
        }
      }
      return false;
    }
    update(dt) {
      if (this.done) return;
      if (this.waitLeft > 0) {
        this.waitLeft -= dt;
        if (this.waitLeft > 0) return;
      } else if (this.mode !== 'time') {
        this.waitLeft = 0;
      }
      let steps = 0;
      for (;;) {
        const r = this.gen.next();
        if (r.done) {
          this.done = true;
          this.mode = null;
          this.current = null;
          return;
        }
        const y = r.value;
        if (y.kind === 'wait') {
          this.waitLeft += y.time;
          this.mode = 'time';
          if (this.waitLeft > 0) return;
        } else if (y.kind === 'tick') {
          this.waitLeft = 0;
          this.mode = 'until';
          return;
        } else {
          this.mode = null;
        }
        if (++steps > 5000) {
          throw new LangError('Your program ran thousands of steps without ever waiting, so the simulation froze. Put a "wait" inside your loop.', this.current && this.current.line);
        }
      }
    }
    statusText() {
      if (this.done) return 'Program finished – nothing left to do.';
      const c = this.current;
      if (!c) return 'Starting…';
      if (this.mode === 'time' && this.waitLeft > 0) return `Line ${c.line}: waiting ${Math.max(0, this.waitLeft).toFixed(1)} s`;
      if (this.mode === 'until') return `Line ${c.line}: waiting until ${c.condText}`;
      return `Line ${c.line}`;
    }
  }

  function fmtNum(n) {
    return String(Math.round(n * 100) / 100);
  }

  FL.lang = { parse, tryParse, Runner, LangError, buildVocab, sensorInfo, fmtNum };
})();
