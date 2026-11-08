/* Six Seven Spotter: react to 6s and 7s on the board – and only those! */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const SHOW = 1.8; // seconds each number is on the board
  const GAP = 0.4; // blank board between numbers
  const GRACE = 0.35; // reaction time allowed at the start of each number
  const NEEDED = 0.3; // seconds of reaction that count
  const DURATION = 75;
  const TARGET = 10;
  const MAX_STRIKES = 3;
  const TRICKY = [16, 17, 76, 60, 70, 66, 77, 61, 71];
  const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f5d0b0'];
  const HAIR = ['#2b1d14', '#4a3020', '#c9a227', '#7b3f00', '#111', '#a0522d', '#e8590c'];
  const SHIRT = ['#e64980', '#4c6ef5', '#12b886', '#fab005', '#7950f2', '#fd7e14', '#15aabf', '#e03131'];

  const isSixSeven = (n) => n === 6 || n === 7 || n === 67;

  class SixSevenSim extends K.BaseSim {
    get seed() {
      return 6767;
    }
    initialDevices() {
      return { class: 'calm', confetti: 'off' };
    }
    init() {
      this.duration = DURATION;
      this.cur = null;
      this.nextAt = 1;
      this.caught = 0;
      this.strikes = 0;
      this.confettiFail = false;
      this.saw67 = false;
      this.history = [];
      this.notes = [];
      this.confetti = [];
      this.fxRng = K.rng(99); // separate, so confetti never changes the numbers
      this.kids = [];
      const rows = [[300, 0.8], [372, 0.9], [448, 1]];
      rows.forEach(([y, sc], r) => {
        for (let i = 0; i < 6; i++) {
          this.kids.push({
            x: 190 + i * 118 + (r % 2) * 22, y, sc, skin: K.pick(this.rng, SKIN), hair: K.pick(this.rng, HAIR), shirt: K.pick(this.rng, SHIRT),
            off: this.rng() * 0.6, talker: (i + r) % 3 === 0,
          });
        }
      });
      this.sensorFns = {
        number: () => (this.cur ? this.cur.value : 0),
        'number showing': () => !!this.cur,
      };
    }
    pickNumber() {
      const r = this.rng();
      if (r < 0.2) return 6;
      if (r < 0.4) return 7;
      if (r < 0.48) return 67;
      if (r < 0.66) return K.pick(this.rng, TRICKY);
      let n;
      do n = 1 + Math.floor(this.rng() * 30);
      while (n === 6 || n === 7);
      return n;
    }
    note(text, color) {
      this.notes.push({ text, color, t: 0 });
    }
    step(dt) {
      const waving = this.dev.class === 'wave';
      const conf = this.dev.confetti === 'on';
      if (!this.cur && this.t >= this.nextAt) {
        this.cur = { value: this.pickNumber(), t0: this.t, waveT: 0, confT: 0 };
      }
      if (this.cur) {
        const c = this.cur;
        if (this.t - c.t0 > GRACE) {
          if (waving) c.waveT += dt;
          if (conf) c.confT += dt;
        }
        if (this.t - c.t0 >= SHOW) this.judge(c);
      }
      // confetti particles
      if (conf) {
        for (let i = 0; i < 4; i++) {
          const R = this.fxRng;
          this.confetti.push({ x: R() * W, y: -10, vx: (R() - 0.5) * 60, vy: 80 + R() * 120, rot: R() * 6, vr: (R() - 0.5) * 10, c: K.pick(R, SHIRT), life: 3 });
        }
      }
      for (const p of this.confetti) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= dt;
      }
      this.confetti = this.confetti.filter((p) => p.life > 0 && p.y < H + 10);
      for (const n of this.notes) n.t += dt;
      this.notes = this.notes.filter((n) => n.t < 1.6);
    }
    judge(c) {
      this.cur = null;
      this.nextAt = this.t + GAP;
      const ss = isSixSeven(c.value);
      const reacted = c.waveT >= NEEDED;
      this.history.push({ value: c.value, ok: ss ? reacted : !reacted });
      if (c.value === 67) {
        this.saw67 = true;
        if (c.confT < NEEDED) this.confettiFail = true;
      } else if (c.confT >= NEEDED) this.confettiFail = true;
      if (ss) {
        if (reacted) {
          this.caught++;
          this.note(c.value === 67 ? 'SIX SEVEN!!! 🎉' : 'SIX SEVEN! ✓', '#2b8a3e');
        } else {
          this.fail(450, 110, {
            label: 'MISSED!', icon: '🙈', title: `A ${c.value} came up and nobody reacted!`,
            text: `The board showed ${c.value}, but the class just sat there. Every 6, 7 – and 67 – needs a "six seven!"`,
            tip: c.value === 67 ? 'Check for 67 too: "if number = 67:"' : 'Check for BOTH numbers with "or": "if number = 6 or number = 7:"',
          });
        }
      } else if (reacted) {
        this.strikes++;
        this.note(`${c.value}?! Wrong number!`, '#e03131');
        if (this.strikes >= MAX_STRIKES) {
          this.fail(110, 180, {
            label: 'ENOUGH!', icon: '😤', title: 'The teacher has had enough!',
            text: `The class shouted "six seven!" when the board said ${c.value}. That’s ${MAX_STRIKES} wrong shouts – detention for everyone!`,
            tip: TRICKY.includes(c.value) ? `Careful: ${c.value} isn’t 6 or 7! Use "=" to check the exact number, and add "else: set class calm" so the class calms down.` : 'Add an "else:" that sets the class back to calm when the number isn’t 6 or 7.',
          });
        }
      }
    }
    goals() {
      return [
        this.goal('miss', 'Never miss a 6, 7 or 67', this.failedWith('MISSED!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', 'React while the number is on the board'),
        this.goal('teacher', `Don’t annoy the teacher – fewer than ${MAX_STRIKES} wrong shouts`, this.failedWith('ENOUGH!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Wrong shouts: ${this.strikes} / ${MAX_STRIKES}`),
        this.goal('count', `Spot ${TARGET} six-sevens`, this.caught >= TARGET ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.caught} / ${TARGET} spotted`),
        this.goal('confetti', 'Bonus: confetti for every 67 – and only for 67!', this.confettiFail ? 'fail' : this.ended && !this.crash && this.saw67 ? 'pass' : this.ended ? 'fail' : 'pending', this.confettiFail ? 'Confetti at the wrong time (or missing)' : 'Device: confetti', false),
      ];
    }
    status() {
      const n = this.cur ? this.cur.value : null;
      return [
        { label: 'Sensor: number', value: n == null ? '0 (blank)' : String(n), note: n != null && isSixSeven(n) ? '👀 six seven!' : '' },
        { label: 'Class', value: this.dev.class.toUpperCase(), swatch: this.dev.class === 'wave' ? '#fab005' : '#868e96' },
        { label: 'Confetti', value: this.dev.confetti.toUpperCase() },
        { label: 'Teacher’s patience', value: '❤️'.repeat(MAX_STRIKES - this.strikes) + '🖤'.repeat(this.strikes) },
        { label: 'Six-sevens spotted', value: `${this.caught} / ${TARGET}` },
      ];
    }
    buildBg(g, r) {
      g.fillStyle = '#fff3bf';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffe8a1';
      for (let x = 0; x < W; x += 60) g.fillRect(x, 0, 30, 250);
      // floor
      g.fillStyle = '#c2a383';
      g.fillRect(0, 250, W, H - 250);
      g.strokeStyle = 'rgba(0,0,0,0.08)';
      for (let x = -200; x < W; x += 50) {
        g.beginPath();
        g.moveTo(x, 250);
        g.lineTo(x + 200, H);
        g.stroke();
      }
      // board
      g.fillStyle = '#8d6e63';
      K.rr(g, 290, 22, 320, 170, 10);
      g.fill();
      g.fillStyle = '#1b3a2a';
      K.rr(g, 300, 32, 300, 150, 6);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = '800 13px Nunito, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('MATHS QUIZ', 450, 52);
      // posters
      const poster = (x, y, c, t) => {
        g.fillStyle = c;
        K.rr(g, x, y, 92, 64, 6);
        g.fill();
        g.fillStyle = '#fff';
        g.font = '900 20px Nunito, system-ui, sans-serif';
        g.fillText(t, x + 46, y + 40);
      };
      poster(660, 50, '#4c6ef5', '2 + 2');
      poster(770, 70, '#12b886', '× ÷');
      poster(160, 60, '#e64980', 'ABC');
      g.textAlign = 'left';
      // window
      g.fillStyle = '#a5d8ff';
      K.rr(g, 20, 40, 110, 90, 6);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.strokeRect(20, 40, 110, 90);
      g.beginPath();
      g.moveTo(75, 40);
      g.lineTo(75, 130);
      g.moveTo(20, 85);
      g.lineTo(130, 85);
      g.stroke();
    }
    drawKid(ctx, k, waving) {
      const s = k.sc;
      const x = k.x;
      const y = k.y;
      const ph = this.t * 7 + k.off * 10;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      const bob = waving ? Math.sin(ph * 2) * 1.5 : Math.sin(this.t * 1.5 + k.off * 9) * 0.6;
      // body
      ctx.fillStyle = k.shirt;
      K.rr(ctx, -20, -18 + bob, 40, 40, 12);
      ctx.fill();
      // head
      ctx.fillStyle = k.skin;
      ctx.beginPath();
      ctx.arc(0, -34 + bob, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = k.hair;
      ctx.beginPath();
      ctx.arc(0, -38 + bob, 17, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
      // face
      ctx.fillStyle = '#212529';
      ctx.beginPath();
      ctx.arc(-6, -34 + bob, 2, 0, Math.PI * 2);
      ctx.arc(6, -34 + bob, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#212529';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      if (waving) {
        ctx.fillStyle = '#c92a2a';
        ctx.ellipse(0, -26 + bob, 4.5, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.arc(0, -29 + bob, 4, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
      }
      // arms – the 6-7 move: palms up, hands going up and down in turn
      ctx.strokeStyle = k.skin;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      const handY = (side) => (waving ? -16 + Math.sin(ph + (side > 0 ? Math.PI : 0)) * 12 : 14);
      for (const side of [-1, 1]) {
        const hy = handY(side) + bob;
        const hx = side * (waving ? 30 : 18);
        ctx.beginPath();
        ctx.moveTo(side * 16, -12 + bob);
        ctx.quadraticCurveTo(side * 30, 4 + bob, hx, hy);
        ctx.stroke();
        ctx.fillStyle = k.skin;
        ctx.beginPath();
        ctx.ellipse(hx, hy, waving ? 8 : 5, waving ? 3.5 : 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (waving && k.talker && Math.floor(this.t * 1.5 + k.off * 3) % 2 === 0) {
        ctx.fillStyle = '#fff';
        K.rr(ctx, x - 44, y - 82 * s, 88, 22, 11);
        ctx.fill();
        ctx.strokeStyle = '#212529';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#212529';
        ctx.font = '900 12px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SIX SEVEN!', x, y - 67 * s);
      }
    }
    draw(ctx) {
      this.drawBg(ctx);
      // number on the board
      if (this.cur) {
        const v = this.cur.value;
        const age = this.t - this.cur.t0;
        const pop = Math.min(1, age * 6);
        ctx.save();
        ctx.translate(450, 122);
        ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
        ctx.fillStyle = v === 67 ? '#ffd43b' : '#fff';
        ctx.font = '900 92px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), 0, 0);
        ctx.restore();
        // time bar
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(320, 168, 260, 5);
        ctx.fillStyle = '#69db7c';
        ctx.fillRect(320, 168, 260 * Math.max(0, 1 - age / SHOW), 5);
      }
      // recent numbers
      ctx.font = '800 12px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText('Recent:', 630, 168);
      this.history.slice(-6).forEach((h, i) => {
        ctx.fillStyle = h.ok ? '#2b8a3e' : '#e03131';
        ctx.fillText(`${h.value}${h.ok ? '✓' : '✗'}`, 680 + i * 36, 168);
      });
      // teacher
      const tx = 110, ty = 240;
      const mood = ['🙂', '😐', '😠', '😤'][Math.min(3, this.strikes + (this.failedWith('ENOUGH!') ? 1 : 0))];
      ctx.fillStyle = '#495057';
      K.rr(ctx, tx - 22, ty - 20, 44, 60, 12);
      ctx.fill();
      ctx.font = '40px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mood, tx, ty - 38);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      K.rr(ctx, tx - 50, ty + 46, 100, 22, 11);
      ctx.fill();
      ctx.font = '13px system-ui';
      ctx.fillText('❤️'.repeat(MAX_STRIKES - this.strikes) + '🖤'.repeat(this.strikes), tx, ty + 62);
      // kids (back row first) with desks in front of them
      const waving = this.dev.class === 'wave';
      for (const k of this.kids) {
        this.drawKid(ctx, k, waving);
        ctx.fillStyle = '#a9744f';
        K.rr(ctx, k.x - 34 * k.sc, k.y + 10 * k.sc, 68 * k.sc, 24 * k.sc, 4);
        ctx.fill();
        ctx.fillStyle = '#8b5a3c';
        ctx.fillRect(k.x - 34 * k.sc, k.y + 30 * k.sc, 68 * k.sc, 5 * k.sc);
      }
      for (const p of this.confetti) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-4, -2, 8, 4);
        ctx.restore();
      }
      for (const n of this.notes) {
        ctx.globalAlpha = Math.max(0, 1 - n.t / 1.6);
        ctx.fillStyle = n.color;
        ctx.font = '900 22px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.text, 450, 222 - n.t * 20);
        ctx.globalAlpha = 1;
      }
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#fff3bf"/><rect y="70" width="240" height="70" fill="#c2a383"/>
    <rect x="70" y="8" width="100" height="56" rx="4" fill="#8d6e63"/><rect x="74" y="12" width="92" height="48" rx="3" fill="#1b3a2a"/>
    <text x="120" y="50" font-size="34" font-weight="900" fill="#ffd43b" text-anchor="middle" font-family="sans-serif">67</text>
    ${[40, 95, 150, 205].map((x, i) => `<g><rect x="${x - 11}" y="96" width="22" height="22" rx="7" fill="${SHIRT[i]}"/><circle cx="${x}" cy="88" r="9" fill="${SKIN[i]}"/>
      <ellipse cx="${x - 16}" cy="${i % 2 ? 92 : 100}" rx="5" ry="2.5" fill="${SKIN[i]}"/><ellipse cx="${x + 16}" cy="${i % 2 ? 100 : 92}" rx="5" ry="2.5" fill="${SKIN[i]}"/></g>`).join('')}
    <rect x="18" y="22" width="40" height="5" fill="#e64980"/><rect x="190" y="30" width="5" height="8" fill="#4c6ef5" transform="rotate(30 192 34)"/><rect x="200" y="14" width="6" height="4" fill="#fab005"/>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'sixseven',
    order: 6,
    title: 'Six Seven Spotter',
    tagline: 'Numbers flash up on the board – get the class to shout “six seven!” at exactly the right moments.',
    difficulty: 'Intermediate',
    concepts: ['If / else', 'Or', 'Comparing numbers', 'Else if'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>It’s maths quiz time, and the board is showing numbers one after another. The class have one rule: whenever a <b>6</b> or a <b>7</b> appears, they do the <b>six-seven wave</b> and shout <b>“SIX SEVEN!”</b> 🙌</p>
      <p>The <code>number</code> sensor tells you the number on the board (it’s 0 while the board is blank). Set <code>class</code> to <code>wave</code> or <code>calm</code>.</p>
      <p>But the teacher is watching 👀. Shout on the <b>wrong</b> number ${MAX_STRIKES} times and it’s detention for everyone! Watch out for sneaky ones like <b>16</b>, <b>17</b> and <b>76</b>…</p>
      <p><b>67</b> counts too! <b>Bonus:</b> set off the <code>confetti</code> for every 67 – and only for 67.</p>`,
    devices: {
      class: { label: 'class', aliases: ['kids', 'students', 'children', 'pupils'], states: ['calm', 'wave'], stateAliases: { shout: 'wave', 'six seven': 'wave', quiet: 'calm' }, stateColors: { calm: '#868e96', wave: '#fab005' }, describe: 'The whole class: calm in their seats, or doing the six-seven wave.' },
      confetti: { label: 'confetti', aliases: ['confetti cannon', 'party'], states: ['on', 'off'], stateColors: { on: '#e64980', off: '#5b5b5b' }, describe: 'The confetti cannon – for very special numbers only.' },
    },
    sensors: {
      number: { type: 'number', desc: 'The number on the board right now (0 while the board is blank).' },
      'number showing': 'True while a number is on the board.',
    },
    snippets: { set: 'set class wave', sensor: 'number = 6' },
    starter: `# When a 6 or a 7 appears on the board,
# the class shouts "SIX SEVEN!"
# This program isn't quite right... Press Run!

forever:
    if number = 6:
        set class wave
    wait 0.2
`,
    solution: `forever:
    if number = 67:
        # The ultimate number!
        set class wave
        set confetti on
    else if number = 6 or number = 7:
        set class wave
        set confetti off
    else:
        set class calm
        set confetti off
    wait 0.2
`,
    hints: [
      'The starter only checks for 6. Use "or" to check for 7 too: "if number = 6 or number = 7:".',
      'Once the class starts waving, they never stop! Add an "else:" that does "set class calm".',
      'Don’t forget 67 – add it to your check, or give it its own "if number = 67:".',
      'Bonus: put the 67 check first, with "set confetti on", then use "else if" for 6 and 7. Turn confetti off everywhere else.',
    ],
    create: () => new SixSevenSim(),
  });
})();
