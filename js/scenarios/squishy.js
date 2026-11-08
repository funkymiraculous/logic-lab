/* Squish Tester: a squishy-factory quality-control press. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const BELT_Y = 372; // top of the belt (squishies sit on it)
  const STATION = 450;
  const SPACING = 210;
  const BELT_V = 120;
  const PRESS_T = 0.4; // seconds for the press to move fully up or down
  const PLATE_UP = 150; // plate bottom y when up
  const DURATION = 90;
  const TARGET = 5;
  const BONUS = 8;
  const NEED = 2; // squishes per squishy
  const MIN_HOLD = 0.5;
  const TYPES = [
    { name: 'strawberry', body: '#ff6b81', dark: '#e8465e' },
    { name: 'cat', body: '#fff4e6', dark: '#f1c9a5' },
    { name: 'donut', body: '#f4c27a', dark: '#d9a050' },
    { name: 'avocado', body: '#9bd16f', dark: '#6aa84f' },
    { name: 'peach', body: '#ffb38a', dark: '#ff8f66' },
    { name: 'bunny', body: '#e5dbff', dark: '#b197fc' },
  ];

  class SquishySim extends K.BaseSim {
    get seed() {
      return 2468;
    }
    initialDevices() {
      return { press: 'up', belt: 'off' };
    }
    init() {
      this.duration = DURATION;
      this.p = 0; // 0 = up, 1 = fully down
      this.items = [];
      this.passed = 0;
      this.beltPhase = 0;
      this.holdT = 0;
      this.notes = [];
      for (let k = 1; k <= 4; k++) this.items.push(this.newSquishy(STATION - SPACING * k + 30));
      this.sensorFns = {
        'squishy ready': () => { const q = this.atStation(); return !!q && q.squishes < NEED; },
        'squishy risen': () => {
          const s = this.atStation();
          return !!s && s.h >= 0.995 && this.p === 0;
        },
        'squishy flat': () => {
          const s = this.atStation();
          return !!s && s.h < 0.5;
        },
      };
    }
    newSquishy(x) {
      const t = TYPES[Math.floor(this.rng() * TYPES.length)];
      return { x, h: 1, type: t, squishes: 0, rise: 2.4 + this.rng() * 1.2, wob: 0, id: ++this.nid };
    }
    atStation() {
      return this.items.find((s) => Math.abs(s.x - STATION) < 7);
    }
    under() {
      return this.items.find((s) => Math.abs(s.x - STATION) < 55);
    }
    note(text, color) {
      this.notes.push({ text, color, x: STATION, y: PLATE_UP - 20, t: 0 });
    }
    onSet(n, s) {
      if (n === 'press' && s === 'up' && this.p > 0.95) {
        const sq = this.atStation();
        if (sq && sq.pressing) {
          sq.pressing = false;
          if (this.holdT >= MIN_HOLD) {
            sq.squishes++;
            this.note(sq.squishes >= NEED ? 'TESTED ✓' : `squish ${sq.squishes}!`, '#2b8a3e');
          } else this.note('too quick!', '#e8590c');
        }
      }
    }
    step(dt) {
      // press motion
      const target = this.dev.press === 'down' ? 1 : 0;
      const wasDown = this.p >= 1;
      if (target > this.p) this.p = Math.min(1, this.p + dt / PRESS_T);
      else if (target < this.p) this.p = Math.max(0, this.p - dt / PRESS_T);
      const beltOn = this.dev.belt === 'on';

      if (beltOn && this.p > 0.25 && this.under()) {
        this.fail(STATION, BELT_Y - 30, { label: 'JAM!', icon: '⚙️', title: 'The belt jammed!', text: 'The belt was moving while the press was down on a squishy, so everything got stuck.', tip: 'Stop the belt ("set belt off") before you press, and only start it again once the press is back up.' });
        return;
      }
      // the moment the plate reaches the squishy
      const sq = this.under();
      if (sq && target === 1 && !sq.pressing && this.p > 0.75) {
        if (sq.h < 0.97) {
          sq.popped = true;
          this.fail(sq.x, BELT_Y - 30, {
            label: 'SPLAT!', icon: '💥', title: 'The squishy popped!',
            text: `The ${sq.type.name} squishy hadn’t finished slowly rising back up (it was only ${Math.round(sq.h * 100)}% risen). Squishing it again so soon burst it!`,
            tip: 'After lifting the press, use "wait until squishy risen" before squishing again. Some squishies rise slower than others!',
          });
          return;
        }
        sq.pressing = true;
        this.holdT = 0;
      }
      if (sq && sq.pressing) {
        sq.h = Math.max(0.28, Math.min(sq.h, 1 - 0.72 * Math.max(0, (this.p - 0.75) / 0.25)));
        if (this.p >= 1) this.holdT += dt;
      }
      if (wasDown && this.p < 1 && sq && sq.pressing) sq.pressing = false; // lifted without onSet (safety)

      // slow rise
      for (const s of this.items) {
        if (!s.pressing && s.h < 1) {
          const plateBottom = this.plateBottom();
          const maxH = Math.max(0.28, (BELT_Y - plateBottom) / 60);
          s.h = Math.min(1, s.h + (0.72 / s.rise) * dt, Math.abs(s.x - STATION) < 55 ? maxH : 1);
          s.wob += dt;
        }
      }
      // belt
      if (beltOn) {
        this.beltPhase += BELT_V * dt;
        for (const s of this.items) {
          const was = s.x;
          s.x += BELT_V * dt;
          if (was <= STATION + 60 && s.x > STATION + 60) {
            if (s.squishes < NEED) {
              this.fail(s.x, BELT_Y - 30, {
                label: 'NOT TESTED!', icon: '🔍', title: 'An untested squishy got through!',
                text: `The ${s.type.name} squishy left the press after only ${s.squishes} good squish${s.squishes === 1 ? '' : 'es'}. Every squishy must be squished ${NEED} times (holding each squish for at least ${MIN_HOLD} s).`,
                tip: 'Stop the belt when a squishy is ready, squish it twice, then start the belt again.',
              });
              return;
            }
            this.passed++;
          }
        }
        const first = Math.min(...this.items.map((s) => s.x));
        if (first > -60 + SPACING) this.items.push(this.newSquishy(first - SPACING));
        this.items = this.items.filter((s) => s.x < W + 80);
      }
      for (const n of this.notes) {
        n.t += dt;
        n.y -= 25 * dt;
      }
      this.notes = this.notes.filter((n) => n.t < 1.4);
    }
    plateBottom() {
      return PLATE_UP + (BELT_Y - 17 - PLATE_UP) * this.p;
    }
    goals() {
      return [
        this.goal('pop', 'Don’t pop any squishies', this.failedWith('SPLAT!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', 'Let them rise before squishing again'),
        this.goal('tested', `Squish every squishy ${NEED} times before it leaves`, this.failedWith('NOT TESTED!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Hold each squish at least ${MIN_HOLD} s`),
        this.goal('count', `Test ${TARGET} squishies`, this.passed >= TARGET ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.passed} / ${TARGET} tested`),
        this.goal('speed', `Bonus: speedy tester – test ${BONUS} squishies`, this.passed >= BONUS && !this.crash ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', 'No wasted waiting!', false),
      ];
    }
    status() {
      const s = this.atStation();
      return [
        { label: 'Press', value: this.dev.press.toUpperCase(), note: this.p > 0 && this.p < 1 ? 'moving…' : this.p >= 1 ? `holding ${this.holdT.toFixed(1)} s` : '' },
        { label: 'Belt', value: this.dev.belt.toUpperCase(), swatch: this.dev.belt === 'on' ? '#2fd158' : '#ff3b30' },
        { label: 'Squishy at press', value: s ? s.type.name : '–', note: s ? `${s.squishes}/${NEED} squishes` : '' },
        { label: 'How risen', value: s ? `${Math.round(s.h * 100)}%` : '–', note: s && s.h >= 0.995 ? 'risen ✓' : '' },
        { label: 'Tested', value: `${this.passed} / ${TARGET}` },
      ];
    }
    buildBg(g, r) {
      // factory wall
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#fff0f6');
      grd.addColorStop(1, '#f3d9fa');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 40; i++) {
        g.beginPath();
        g.arc(r() * W, r() * 300, 3 + r() * 10, 0, Math.PI * 2);
        g.fill();
      }
      // sign
      g.fillStyle = '#ff8cc6';
      K.rr(g, 40, 30, 250, 54, 14);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '900 24px Nunito, system-ui, sans-serif';
      g.fillText('SQUISH LAB', 72, 66);
      g.font = '700 13px Nunito, system-ui, sans-serif';
      g.fillStyle = '#862e9c';
      g.fillText('Quality control: every squishy squished twice!', 40, 108);
      // floor
      g.fillStyle = '#d0bfff';
      g.fillRect(0, BELT_Y + 40, W, H - BELT_Y - 40);
      // press frame
      g.fillStyle = '#868e96';
      g.fillRect(STATION - 110, 60, 18, BELT_Y - 40);
      g.fillRect(STATION + 92, 60, 18, BELT_Y - 40);
      g.fillStyle = '#495057';
      K.rr(g, STATION - 120, 40, 240, 34, 8);
      g.fill();
      g.fillStyle = '#ffd43b';
      g.font = '900 13px Nunito, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('SQUISH-O-MATIC 3000', STATION, 62);
      // finished box
      g.fillStyle = '#c08552';
      g.fillRect(W - 70, BELT_Y - 20, 70, 80);
      g.fillStyle = '#a0683d';
      g.fillRect(W - 70, BELT_Y - 20, 70, 10);
      g.fillStyle = '#fff';
      g.font = '900 11px Nunito, system-ui, sans-serif';
      g.fillText('PASSED', W - 35, BELT_Y + 25);
      g.textAlign = 'left';
    }
    drawSquishy(ctx, s) {
      const h = s.h;
      const wob = s.h < 1 ? Math.sin(s.wob * 8) * 0.02 * (1 - h) : 0;
      const hh = 60 * (h + wob);
      const ww = 66 / Math.sqrt(Math.max(0.28, h));
      const x = s.x;
      const y = BELT_Y;
      const t = s.type;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.ellipse(x, y + 2, ww / 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // ears / leaves
      ctx.fillStyle = t.name === 'strawberry' ? '#51cf66' : t.dark;
      if (t.name === 'strawberry') {
        for (const dx of [-12, 0, 12]) {
          ctx.beginPath();
          ctx.ellipse(x + dx, y - hh + 2, 7, 4, dx / 20, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (t.name === 'cat') {
        for (const dx of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x + dx * ww * 0.18, y - hh + 8);
          ctx.lineTo(x + dx * ww * 0.36, y - hh - 10 * h);
          ctx.lineTo(x + dx * ww * 0.42, y - hh + 14);
          ctx.fill();
        }
      } else if (t.name === 'bunny') {
        for (const dx of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(x + dx * 12, y - hh - 12 * h, 6, 16 * h, dx * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // body
      ctx.fillStyle = t.body;
      K.rr(ctx, x - ww / 2, y - hh, ww, hh, Math.min(ww, hh) / 2.1);
      ctx.fill();
      ctx.strokeStyle = t.dark;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (t.name === 'donut') {
        ctx.fillStyle = '#f783ac';
        K.rr(ctx, x - ww / 2 + 3, y - hh, ww - 6, hh * 0.5, Math.min(ww, hh) / 3);
        ctx.fill();
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 6; i++) ctx.fillRect(x - ww / 3 + i * ww / 9, y - hh + hh * 0.18 + (i % 2) * 4, 4, 2);
      } else if (t.name === 'strawberry') {
        ctx.fillStyle = '#ffe066';
        for (let i = 0; i < 7; i++) ctx.fillRect(x - ww / 3 + ((i * 11) % (ww * 0.66)), y - hh * (0.3 + (i % 3) * 0.2), 2, 3);
      } else if (t.name === 'avocado') {
        ctx.fillStyle = '#8d5a3b';
        ctx.beginPath();
        ctx.ellipse(x, y - hh * 0.32, ww * 0.16, hh * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // face
      const fy = y - hh * 0.62;
      ctx.fillStyle = '#343a40';
      ctx.strokeStyle = '#343a40';
      ctx.lineWidth = 2;
      if (h < 0.6) {
        // squeezed: > <
        ctx.beginPath();
        ctx.moveTo(x - 14, fy - 3);
        ctx.lineTo(x - 9, fy);
        ctx.lineTo(x - 14, fy + 3);
        ctx.moveTo(x + 14, fy - 3);
        ctx.lineTo(x + 9, fy);
        ctx.lineTo(x + 14, fy + 3);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x - 11, fy, 2.6, 0, Math.PI * 2);
        ctx.arc(x + 11, fy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, fy + 4, 4, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,120,150,0.45)';
      ctx.beginPath();
      ctx.ellipse(x - 19, fy + 5, 5, 3, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 19, fy + 5, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // test stickers
      for (let i = 0; i < s.squishes; i++) {
        ctx.fillStyle = '#2b8a3e';
        ctx.beginPath();
        ctx.arc(x - 8 + i * 16, y - hh - 16, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '900 9px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✓', x - 8 + i * 16, y - hh - 13);
      }
      ctx.restore();
    }
    draw(ctx) {
      this.drawBg(ctx);
      // belt
      ctx.fillStyle = '#343a40';
      K.rr(ctx, -10, BELT_Y, W - 50, 30, 15);
      ctx.fill();
      ctx.fillStyle = '#495057';
      for (let x = -40 + (this.beltPhase % 40); x < W - 60; x += 40) ctx.fillRect(x, BELT_Y + 2, 20, 4);
      ctx.fillStyle = '#868e96';
      for (let x = 15; x < W - 60; x += 70) {
        ctx.beginPath();
        ctx.arc(x, BELT_Y + 15, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      // station marker
      ctx.fillStyle = this.atStation() ? '#2fd158' : '#ffd43b';
      ctx.fillRect(STATION - 30, BELT_Y + 30, 60, 5);
      for (const s of this.items) if (!s.popped) this.drawSquishy(ctx, s);
      // press piston + plate
      const pb = this.plateBottom();
      ctx.fillStyle = '#adb5bd';
      ctx.fillRect(STATION - 10, 74, 20, pb - 74 - 16);
      ctx.fillStyle = '#495057';
      K.rr(ctx, STATION - 60, pb - 18, 120, 18, 5);
      ctx.fill();
      ctx.fillStyle = '#ff8cc6';
      ctx.fillRect(STATION - 56, pb - 5, 112, 5);
      // floating notes
      for (const n of this.notes) {
        ctx.globalAlpha = Math.max(0, 1 - n.t / 1.4);
        ctx.fillStyle = n.color;
        ctx.font = '900 16px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.text, n.x + 130, n.y + 60);
        ctx.globalAlpha = 1;
      }
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#fff0f6"/><rect y="108" width="240" height="32" fill="#d0bfff"/>
    <rect x="0" y="96" width="220" height="12" rx="6" fill="#343a40"/>
    <rect x="84" y="10" width="72" height="10" rx="3" fill="#495057"/><rect x="116" y="20" width="8" height="34" fill="#adb5bd"/><rect x="96" y="54" width="48" height="8" rx="2" fill="#495057"/>
    <rect x="98" y="66" width="44" height="30" rx="14" fill="#ff6b81" stroke="#e8465e" stroke-width="1.5"/>
    <path d="M110 78 l3 2 -3 2 M130 78 l-3 2 3 2" stroke="#343a40" stroke-width="1.5" fill="none"/>
    <rect x="22" y="62" width="40" height="34" rx="16" fill="#9bd16f" stroke="#6aa84f" stroke-width="1.5"/><circle cx="36" cy="76" r="1.8" fill="#343a40"/><circle cx="48" cy="76" r="1.8" fill="#343a40"/>
    <rect x="172" y="62" width="40" height="34" rx="16" fill="#e5dbff" stroke="#b197fc" stroke-width="1.5"/><circle cx="186" cy="76" r="1.8" fill="#343a40"/><circle cx="198" cy="76" r="1.8" fill="#343a40"/>
    <circle cx="186" cy="54" r="5" fill="#2b8a3e"/><circle cx="198" cy="54" r="5" fill="#2b8a3e"/>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'squishy',
    order: 5,
    title: 'Squish Tester',
    tagline: 'Run the squishy factory’s testing press – squish each one twice, but don’t pop them!',
    difficulty: 'Beginner',
    concepts: ['Sequence', 'Repeat', 'Wait until', 'Sensors'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>Welcome to the <b>Squish Lab</b>! Every squishy that comes down the belt must be tested by the <b>Squish-o-matic 3000</b> press.</p>
      <p>The test: stop the belt when a squishy is under the press, then <b>squish it twice</b> – hold each squish for about a second. Then send it on to the PASSED box.</p>
      <p>But careful! Squishies are <b>slow-rise</b>: after a squish they take a few seconds to puff back up. Squish one again before it has risen and… <b>SPLAT!</b> And some rise slower than others.</p>
      <p>Sensors: <code>squishy ready</code> (one is under the press), <code>squishy risen</code> (fully puffed back up), <code>squishy flat</code>.</p>`,
    devices: {
      press: { label: 'press', aliases: ['squisher', 'presser', 'squish-o-matic'], states: ['up', 'down'], stateAliases: { lift: 'up', lower: 'down', raised: 'up', lowered: 'down' }, stateColors: { up: '#2fd158', down: '#ff8cc6' }, describe: 'The squishing press. Takes under half a second to move.' },
      belt: { label: 'belt', aliases: ['conveyor', 'conveyor belt'], states: ['on', 'off'], stateAliases: { go: 'on', stop: 'off', start: 'on' }, stateColors: { on: '#2fd158', off: '#ff3b30' }, describe: 'The conveyor belt that brings squishies to the press.' },
    },
    sensors: {
      'squishy ready': 'True when a squishy that still needs testing is right under the press.',
      'squishy risen': 'True when the squishy under the press has fully puffed back up (and the press is up).',
      'squishy flat': 'True while the squishy under the press is squashed flat.',
    },
    snippets: { set: 'set press down', sensor: 'squishy risen' },
    starter: `# Bring a squishy to the press, then squish it twice.
# After each squish, this waits 1 second for it to
# puff back up. Is that long enough? Press Run!

forever:
    set belt on
    wait until squishy ready
    set belt off
    repeat 2 times:
        set press down
        wait 1
        set press up
        wait 1
`,
    solution: `forever:
    # Bring the next squishy to the press
    set belt on
    wait until squishy ready
    set belt off
    # Squish it twice
    repeat 2 times:
        set press down
        wait 1
        set press up
        # Slow-rise squishies take their time!
        wait until squishy risen
`,
    hints: [
      'Watch the squishy after the press lifts: it slowly puffs back up. One second isn’t enough!',
      'Different squishies rise at different speeds, so any fixed wait might be wrong.',
      'Replace the second "wait 1" with "wait until squishy risen".',
      'Bonus: don’t hold the press down longer than you need – about 1 second is plenty.',
    ],
    create: () => new SquishySim(),
  });
})();
