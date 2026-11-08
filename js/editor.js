/* Code editor: a textarea layered over a syntax-highlighted copy of the text. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const KEYWORDS = new Set([
    'forever', 'repeat', 'times', 'time', 'while', 'if', 'else', 'otherwise', 'then', 'wait', 'until',
    'set', 'to', 'turn', 'not', 'and', 'or', 'is', 'seconds', 'second', 'loop', 'change', 'by', 'add', 'subtract',
    'from', 'increase', 'decrease',
  ]);
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  class CodeEditor {
    constructor(root, { onChange } = {}) {
      this.root = root;
      this.onChange = onChange || (() => {});
      this.vocab = { phrases: [] };
      this.errorLine = null;
      this.activeLine = null;
      this.readOnly = false;
      root.classList.add('editor');
      root.innerHTML = `
        <div class="ed-gutter"><div class="ed-gutter-inner"></div></div>
        <div class="ed-main">
          <pre class="ed-hl" aria-hidden="true"></pre>
          <textarea class="ed-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Program code"></textarea>
        </div>
        <div class="ed-lock hidden">🔒 Stop the simulation to edit your program</div>`;
      this.ta = root.querySelector('textarea');
      this.hl = root.querySelector('.ed-hl');
      this.gut = root.querySelector('.ed-gutter-inner');
      this.lock = root.querySelector('.ed-lock');
      this.ta.addEventListener('input', () => {
        this.render();
        this.onChange(this.ta.value);
      });
      this.ta.addEventListener('scroll', () => this.syncScroll());
      this.ta.addEventListener('keydown', (e) => this.onKey(e));
      this.ta.addEventListener('focus', () => (this._hadFocus = true));
    }

    /* phrases: [{words:'car waiting west', cls:'sens'}, ...] */
    setVocab(scn) {
      const phrases = [];
      for (const [name, d] of Object.entries(scn.devices)) {
        new Set([name, ...(d.aliases || [])]).forEach((a) => phrases.push({ text: a, cls: 'dev' }));
        d.states.forEach((s) => phrases.push({ text: s, cls: 'st' }));
        Object.keys(d.stateAliases || {}).forEach((s) => phrases.push({ text: s, cls: 'st' }));
      }
      Object.keys(scn.sensors).forEach((s) => phrases.push({ text: s, cls: 'sens' }));
      const seen = new Set();
      this.vocab.phrases = phrases
        .filter((p) => (seen.has(p.text) ? false : seen.add(p.text)))
        .map((p) => ({ ...p, words: p.text.toLowerCase().split(' ') }))
        .sort((a, b) => b.words.length - a.words.length);
    }

    setVars(names) {
      const key = (names || []).slice().sort().join(',');
      if (key === this._varKey) return;
      this._varKey = key;
      this.varSet = new Set(names || []);
      this.render();
    }

    highlightLine(line) {
      const ci = line.indexOf('#');
      const code = ci >= 0 ? line.slice(0, ci) : line;
      const comment = ci >= 0 ? line.slice(ci) : '';
      const toks = code.match(/\s+|\d+(?:\.\d+)?|[A-Za-z_]+|./g) || [];
      let out = '';
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (/^[A-Za-z_]+$/.test(t)) {
          let matched = null;
          for (const p of this.vocab.phrases) {
            let ok = true;
            let j = i;
            for (let w = 0; w < p.words.length; w++) {
              if (w > 0) {
                if (!toks[j + 1] || !/^\s+$/.test(toks[j + 1])) { ok = false; break; }
                j += 2;
              }
              if (!toks[j] || toks[j].toLowerCase() !== p.words[w]) { ok = false; break; }
            }
            if (ok) { matched = { p, end: j }; break; }
          }
          if (matched) {
            out += `<span class="tk-${matched.p.cls}">${esc(toks.slice(i, matched.end + 1).join(''))}</span>`;
            i = matched.end;
            continue;
          }
          if (KEYWORDS.has(t.toLowerCase())) { out += `<span class="tk-kw">${esc(t)}</span>`; continue; }
          if (this.varSet && this.varSet.has(t.toLowerCase())) { out += `<span class="tk-var">${esc(t)}</span>`; continue; }
          out += esc(t);
        } else if (/^\d/.test(t)) out += `<span class="tk-num">${t}</span>`;
        else if (t === ':') out += `<span class="tk-punct">:</span>`;
        else out += esc(t);
      }
      if (comment) out += `<span class="tk-comment">${esc(comment)}</span>`;
      return out;
    }

    render() {
      const lines = this.ta.value.split('\n');
      let hl = '';
      let gut = '';
      lines.forEach((l, i) => {
        const n = i + 1;
        const cls = (n === this.errorLine ? ' err' : '') + (n === this.activeLine ? ' active' : '');
        hl += `<div class="hl-line${cls}">${this.highlightLine(l) || ' '}</div>`;
        gut += `<div class="g-line${cls}">${n}</div>`;
      });
      this.hl.innerHTML = hl;
      this.gut.innerHTML = gut;
      this.syncScroll();
    }

    syncScroll() {
      const { scrollTop, scrollLeft } = this.ta;
      this.hl.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
      this.gut.style.transform = `translateY(${-scrollTop}px)`;
    }

    getValue() { return this.ta.value; }
    setValue(v) {
      this.ta.value = v;
      this._hadFocus = false;
      this.render();
    }
    setErrorLine(n) {
      if (this.errorLine === n) return;
      this.errorLine = n;
      this.render();
    }
    setActiveLine(n) {
      if (this.activeLine === n) return;
      this.activeLine = n;
      this.render();
      if (n) this.scrollToLine(n, true);
    }
    setReadOnly(b) {
      this.readOnly = b;
      this.ta.readOnly = b;
      this.lock.classList.toggle('hidden', !b);
      this.root.classList.toggle('readonly', b);
    }
    lineHeight() {
      return parseFloat(getComputedStyle(this.ta).lineHeight) || 21;
    }
    scrollToLine(n, onlyIfHidden) {
      const lh = this.lineHeight();
      const top = (n - 1) * lh;
      const h = this.ta.clientHeight;
      if (onlyIfHidden && top >= this.ta.scrollTop + lh && top <= this.ta.scrollTop + h - lh * 2) return;
      this.ta.scrollTop = Math.max(0, top - h / 3);
      this.syncScroll();
    }
    focusLine(n) {
      const lines = this.ta.value.split('\n');
      let start = 0;
      for (let i = 0; i < n - 1 && i < lines.length; i++) start += lines[i].length + 1;
      const end = start + (lines[n - 1] || '').length;
      this.ta.focus();
      this.ta.setSelectionRange(start + ((lines[n - 1] || '').match(/^ */)[0].length), end);
      this.scrollToLine(n);
    }

    cursorLine() {
      const v = this.ta.value;
      const p = this.ta.selectionStart;
      const s = v.lastIndexOf('\n', p - 1) + 1;
      let e = v.indexOf('\n', p);
      if (e < 0) e = v.length;
      return { start: s, end: e, line: v.slice(s, e) };
    }

    insert(text) {
      this.ta.focus();
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (!ok) {
        this.ta.setRangeText(text, this.ta.selectionStart, this.ta.selectionEnd, 'end');
        this.ta.dispatchEvent(new Event('input'));
      }
    }

    onKey(e) {
      if (this.readOnly) return;
      const ta = this.ta;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) this.dedent();
        else this.insert('    ');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const { line, start } = this.cursorLine();
        const before = line.slice(0, ta.selectionStart - start);
        const indent = line.match(/^ */)[0];
        const extra = /:\s*(#.*)?$/.test(before) ? '    ' : '';
        this.insert('\n' + indent.slice(0, Math.min(indent.length, before.length)) + extra);
      } else if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
        const { line, start } = this.cursorLine();
        const before = line.slice(0, ta.selectionStart - start);
        if (before.length >= 4 && /^ +$/.test(before)) {
          e.preventDefault();
          const n = before.length % 4 || 4;
          ta.setSelectionRange(ta.selectionStart - n, ta.selectionStart);
          this.insert('');
        }
      }
    }

    dedent() {
      const { start, line } = this.cursorLine();
      const n = Math.min(4, line.match(/^ */)[0].length);
      if (!n) return;
      const caret = this.ta.selectionStart;
      this.ta.setSelectionRange(start, start + n);
      this.insert('');
      this.ta.setSelectionRange(Math.max(start, caret - n), Math.max(start, caret - n));
    }

    /* Insert a (possibly multi-line) snippet on a new line below the cursor, matching indentation. */
    insertSnippet(snippet) {
      if (this.readOnly) return;
      const ta = this.ta;
      if (document.activeElement !== ta && !this._hadFocus) {
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
      const { start, end, line } = this.cursorLine();
      const blank = line.trim() === '';
      const indent = line.match(/^ */)[0];
      const ind = blank ? indent : indent + (/:\s*(#.*)?$/.test(line) ? '    ' : '');
      const body = snippet
        .split('\n')
        .map((l) => ind + l)
        .join('\n');
      ta.focus();
      if (blank) {
        ta.setSelectionRange(start, end);
        this.insert(body);
      } else {
        ta.setSelectionRange(end, end);
        this.insert('\n' + body);
      }
      // place caret at end of first inserted line
      const firstLen = (ind + snippet.split('\n')[0]).length;
      const lineStart = blank ? start : end + 1;
      ta.setSelectionRange(lineStart + firstLen, lineStart + firstLen);
    }
  }

  FL.CodeEditor = CodeEditor;
})();
