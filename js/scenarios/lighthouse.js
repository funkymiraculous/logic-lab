/* Lighthouse: flash the signature pattern so ships can identify it in the fog. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const LH = { x: 742, y: 112 };
  const ROCKS = [[565, 262, 22], [600, 300, 27], [642, 252, 19], [622, 336, 17], [552, 318, 14], [668, 292, 16], [590, 232, 12]];
  const DECIDE_X = 330;
  const SAFE_Y = 440;
  const SPEED = 42;
  const DURATION = 60;
  const SHIP_COLORS = ['#c92a2a', '#1864ab', '#2b8a3e', '#5f3dc4', '#e67700'];

  function darkness(t) {
    if (t < 45) return 1;
    if (t < 50) return 1 - (t - 45) / 5;
    return 0;
  }

  class LighthouseSim extends K.BaseSim {
    get seed() {
      return 3141;
    }
    initialDevices() {
      return { lamp: 'off' };
    }
    init() {
      this.duration = DURATION;
      this.ships = [];
      this.spawnT = 0;
      this.onStart = null;
      this.offStart = 0;
      this.groupCount = 0;
      this.groupBad = false;
      this.groupOpen = false;
      this.lastGroup = null;
      this.goodGroups = 0;
      this.toggles = 0;
      this.saved = 0;
      this.dayFail = false;
      this.sensorFns = { dark: () => darkness(this.t) > 0.5 };
    }
    onSet(n, s) {
      this.toggles++;
      if (s === 'on') {
        const off = this.t - this.offStart;
        if (!this.groupOpen || off >= 2) {
          this.groupOpen = true;
          this.groupCount = 1;
          this.groupBad = false;
        } else if (off >= 0.2 && off <= 1.2) {
          this.groupCount++;
        } else {
          this.groupBad = true;
          this.groupCount++;
        }
        this.onStart = this.t;
      } else {
        const on = this.t - (this.onStart == null ? this.t : this.onStart);
        if (on > 1.2 || on < 0.15) this.groupBad = true;
        this.offStart = this.t;
        this.onStart = null;
      }
    }
    step(dt) {
      const lampOn = this.dev.lamp === 'on';
      // close a group once the lamp has been dark for 2 seconds
      if (!lampOn && this.groupOpen && this.t - this.offStart >= 2) {
        this.groupOpen = false;
        this.lastGroup = { count: this.groupCount, bad: this.groupBad, t: this.t };
        if (!this.groupBad && this.groupCount === 3) {
          this.goodGroups++;
          for (const s of this.ships) if (s.x < DECIDE_X) s.knows = true;
        }
      }
      if (lampOn && this.onStart != null && this.t - this.onStart > 1.2) this.groupBad = true;
      if (lampOn && this.t > 51) this.dayFail = true;

      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.ships.push({ x: -70, y: 245 + this.rng() * 70, ang: 0, color: K.pick(this.rng, SHIP_COLORS), knows: false, route: null, wake: 0 });
        this.spawnT = 9 + this.rng() * 3;
      }
      const dark = darkness(this.t);
      for (const s of this.ships) {
        if (!s.route && s.x >= DECIDE_X) {
          s.route = s.knows || dark < 0.5 ? 'safe' : 'lost';
        }
        let targetY = s.y;
        if (s.route === 'safe') targetY = SAFE_Y;
        const dy = Math.max(-34, Math.min(34, targetY - s.y));
        const want = Math.atan2(dy, 60);
        s.ang += (want - s.ang) * Math.min(1, dt * 2.5);
        s.x += Math.cos(s.ang) * SPEED * dt;
        s.y += Math.sin(s.ang) * SPEED * dt;
        s.wake += dt;
        if (!s.counted && s.x > 720) {
          s.counted = true;
          this.saved++;
        }
        const fx = s.x + Math.cos(s.ang) * 32;
        const fy = s.y + Math.sin(s.ang) * 32;
        for (const [rx, ry, rr] of ROCKS) {
          if (Math.hypot(fx - rx, fy - ry) < rr + 4) {
            s.wrecked = true;
            this.fail(fx, fy, this.diagnose());
            return;
          }
        }
      }
      this.ships = this.ships.filter((s) => s.x < W + 90);
    }
    afterCrash(dt) {
      for (const s of this.ships) if (s.wrecked) s.sink = (s.sink || 0) + dt;
    }
    diagnose() {
      const base = { label: 'CRASH!', icon: '🚢' };
      if (this.toggles === 0) {
        return { ...base, title: 'Shipwreck on the rocks!', text: 'The lighthouse never lit up. In the fog, the ship had no idea the rocks were there.', tip: 'Turn the lamp on and off to make flashes: "set lamp on", "wait 0.5", "set lamp off", "wait 0.5".' };
      }
      if (this.dev.lamp === 'on' && this.onStart != null && this.t - this.onStart > 2) {
        return { ...base, title: 'Shipwreck on the rocks!', text: 'The lamp stayed on without flashing. A steady light could be anything – a house, another ship – so the sailors couldn’t tell where they were.', tip: 'Lighthouses flash a pattern. This one must flash 3 times, then stay dark for a few seconds.' };
      }
      const g = this.lastGroup;
      if (!g) {
        return { ...base, title: 'Shipwreck on the rocks!', text: 'The lamp never paused in the dark, so the sailors couldn’t count the flashes or tell where the pattern started.', tip: 'After your 3 flashes, keep the lamp off for about 3 seconds before starting again.' };
      }
      if (g.bad) {
        return { ...base, title: 'Shipwreck on the rocks!', text: 'The flashes were the wrong length, so the sailors couldn’t read the pattern clearly.', tip: 'Make each flash short: on for about 0.5 seconds, then off for about 0.5 seconds.' };
      }
      if (g.count !== 3) {
        return { ...base, title: 'Wrong lighthouse!', text: `The lamp flashed ${g.count} time${g.count === 1 ? '' : 's'} in each group. The sailors looked that up on their chart, thought they were somewhere else, and steered straight onto the rocks.`, tip: 'This lighthouse’s pattern is exactly 3 flashes, then darkness. "repeat 3 times:" is perfect for this.' };
      }
      return { ...base, title: 'Shipwreck on the rocks!', text: 'The ship didn’t see a complete pattern in time to steer away from the rocks.', tip: 'Keep the pattern going all night: 3 flashes, then about 3 seconds of darkness, forever.' };
    }
    goals() {
      return [
        this.goal('pattern', 'Flash the signature: 3 short flashes, then darkness', this.goodGroups >= 3 ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', this.lastGroup ? `Last pattern: ${this.lastGroup.count} flash${this.lastGroup.count === 1 ? '' : 'es'}${this.lastGroup.bad ? ' (uneven)' : ''}` : 'No pattern seen yet'),
        this.goal('safe', 'Every ship steers safely past the rocks', this.safeStatus(), `${this.saved} ship${this.saved === 1 ? '' : 's'} safely past`),
        this.goal('day', 'Bonus: switch the lamp off once it’s daylight', this.dayFail ? 'fail' : this.ended ? 'pass' : 'pending', this.dayFail ? 'Lamp was left on in daylight' : 'Use the "dark" sensor', false),
      ];
    }
    status() {
      const g = this.lastGroup;
      return [
        { label: 'Lamp', value: this.dev.lamp.toUpperCase(), swatch: this.dev.lamp === 'on' ? '#fff3a0' : '#555' },
        { label: 'Flashes so far in group', value: this.groupOpen ? String(this.groupCount) : '–' },
        { label: 'Last pattern seen', value: g ? `${g.count} flash${g.count === 1 ? '' : 'es'}` : 'none', note: g ? (g.count === 3 && !g.bad ? '✓ correct' : '✗ wrong') : '' },
        { label: 'Sensor: dark', value: darkness(this.t) > 0.5 ? 'TRUE 🌙' : 'FALSE ☀️' },
        { label: 'Ships safe', value: String(this.saved) },
      ];
    }
    buildBg(g, r) {
      g.fillStyle = '#1f6f9e';
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = 'rgba(255,255,255,0.08)';
        g.lineWidth = 1.5;
        const x = r() * W;
        const y = r() * H;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + 8, y - 4, x + 16, y);
        g.stroke();
      }
      // headland
      g.fillStyle = '#d9c99a';
      g.beginPath();
      g.moveTo(600, 0);
      g.bezierCurveTo(640, 90, 690, 180, 790, 190);
      g.bezierCurveTo(840, 195, 880, 170, W, 180);
      g.lineTo(W, 0);
      g.closePath();
      g.fill();
      g.fillStyle = '#7fae5a';
      g.beginPath();
      g.moveTo(625, 0);
      g.bezierCurveTo(660, 80, 700, 160, 790, 168);
      g.bezierCurveTo(840, 172, 880, 152, W, 160);
      g.lineTo(W, 0);
      g.closePath();
      g.fill();
      K.drawTree(g, 850, 60, 16, r);
      K.drawTree(g, 820, 120, 13, r);
      K.drawHouse(g, 790, 30, 44, 30, '#a5533a', '#eee');
      // rocks with surf
      for (const [x, y, rad] of ROCKS) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.arc(x, y, rad + 6, 0, Math.PI * 2);
        g.fill();
      }
      for (const [x, y, rad] of ROCKS) {
        g.fillStyle = '#4a4a4a';
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#6b6b6b';
        g.beginPath();
        g.arc(x - rad * 0.25, y - rad * 0.25, rad * 0.6, 0, Math.PI * 2);
        g.fill();
      }
      // chart label for the safe channel
      K.dashedLine(g, 430, SAFE_Y, 860, SAFE_Y, 10, 10, 2, 'rgba(255,255,255,0.35)');
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.font = '800 12px Nunito, system-ui, sans-serif';
      g.fillText('safe channel →', 700, SAFE_Y - 10);
    }
    draw(ctx) {
      this.drawBg(ctx);
      const d = darkness(this.t);
      const on = this.dev.lamp === 'on';
      for (const s of this.ships) K.drawShip(ctx, s.x, s.y + (s.sink || 0) * 4, s.ang + (s.sink ? Math.min(0.6, s.sink) : 0), s.color, s.sink);
      // tower
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(LH.x + 6, LH.y + 6, 22, 0, Math.PI * 2);
      ctx.fill();
      [[22, '#f8f9fa'], [17, '#e03131'], [12, '#f8f9fa'], [8, '#343a40']].forEach(([rad, c]) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(LH.x, LH.y, rad, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = on ? '#fff9c4' : '#6c757d';
      ctx.beginPath();
      ctx.arc(LH.x, LH.y, 5, 0, Math.PI * 2);
      ctx.fill();

      if (d > 0) {
        ctx.fillStyle = `rgba(6,12,36,${0.7 * d})`;
        ctx.fillRect(0, 0, W, H);
        // fog banks
        ctx.save();
        ctx.globalAlpha = 0.18 * d;
        ctx.fillStyle = '#c8d3e6';
        for (let i = 0; i < 6; i++) {
          const x = ((i * 190 + this.t * 8) % (W + 300)) - 150;
          ctx.beginPath();
          ctx.ellipse(x, 120 + i * 65, 170, 34, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (on) {
        K.glow(ctx, LH.x, LH.y, 140 + 60 * d, '255,245,190', 0.45 + 0.35 * d);
        K.glow(ctx, LH.x, LH.y, 30, '255,255,230', 0.9);
      }
      ctx.restore();
      // ship lights + what the crew think
      for (const s of this.ships) {
        if (d > 0.2) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          K.glow(ctx, s.x + Math.cos(s.ang) * 26, s.y + Math.sin(s.ang) * 26, 14, '255,240,200', 0.5 * d);
          ctx.restore();
        }
        if (!s.route && d > 0.5) {
          const txt = s.knows ? '✓' : '?';
          ctx.fillStyle = s.knows ? '#2b8a3e' : '#495057';
          ctx.beginPath();
          ctx.arc(s.x, s.y - 24, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '900 12px Nunito, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, s.x, s.y - 23.5);
        }
      }
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#123a5c"/>
    <path d="M160,0 C170,25 185,48 210,50 C225,52 235,46 240,48 L240,0Z" fill="#7fae5a"/>
    <circle cx="198" cy="30" r="40" fill="#fff6c2" opacity=".25"/><circle cx="198" cy="30" r="7" fill="#fff"/><circle cx="198" cy="30" r="4" fill="#e03131"/>
    <circle cx="150" cy="75" r="8" fill="#4a4a4a"/><circle cx="162" cy="86" r="10" fill="#4a4a4a"/><circle cx="172" cy="70" r="6" fill="#4a4a4a"/>
    <path d="M40,80 l26,0 q8,0 10,5 q-2,5 -10,5 l-26,0z" fill="#c92a2a"/><rect x="44" y="81" width="8" height="8" fill="#fff"/>
    <circle cx="58" cy="70" r="6" fill="#2b8a3e"/><text x="58" y="73" font-size="9" text-anchor="middle" fill="#fff" font-weight="900">✓</text>
  </svg>`;

  FL.scenarios.push({
    id: 'lighthouse',
    order: 2,
    title: 'Lighthouse Signal',
    tagline: 'Flash the lighthouse’s secret pattern so ships know where they are in the fog.',
    difficulty: 'Beginner',
    concepts: ['Repeat N times', 'Loops inside loops', 'Timing', 'If / else (bonus)'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>Every lighthouse flashes its own <b>pattern</b>, so sailors can look it up on their chart and work out exactly where they are.</p>
      <p>This lighthouse’s pattern is: <b>3 short flashes, then about 3 seconds of darkness</b> – over and over.</p>
      <p>Ships in the fog watch for the pattern. If they see it (✓), they steer into the safe channel. If they can’t (?), they sail straight onto the rocks!</p>
      <p><b>Bonus:</b> morning comes near the end. Use the <code>dark</code> sensor to switch the lamp off in daylight and save power.</p>`,
    devices: {
      lamp: { label: 'lamp', aliases: ['light', 'lighthouse', 'lantern', 'lamps'], states: ['on', 'off'], stateColors: { on: '#ffe066', off: '#5b5b5b' }, describe: 'The big lamp at the top of the lighthouse.' },
    },
    sensors: { dark: 'True during the night.' },
    snippets: { set: 'set lamp on', sensor: 'dark' },
    starter: `# This lighthouse's pattern: 3 short flashes, then darkness.
# Ships use the pattern to work out where they are.
#
# This program only flashes ONCE each time round.
# Press Run, watch the ships, then fix it!

forever:
    set lamp on
    wait 0.5
    set lamp off
    wait 3
`,
    solution: `# 3 flashes, then a dark pause - all night long
forever:
    if dark:
        repeat 3 times:
            set lamp on
            wait 0.5
            set lamp off
            wait 0.5
        wait 3
    else:
        # Daytime: save power
        set lamp off
        wait 1
`,
    hints: [
      'You need the flash (on, wait, off, wait) to happen 3 times in a row.',
      'Put the flash steps inside "repeat 3 times:" – indented underneath it.',
      'After the repeat, add "wait 3" (not indented inside the repeat) for the dark pause. Keep all of it inside "forever:".',
      'Bonus: wrap it in "if dark:" and add an "else:" that turns the lamp off.',
    ],
    create: () => new LighthouseSim(),
  });
})();
