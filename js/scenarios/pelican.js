/* Pelican crossing: push-button pedestrian lights. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const RT = 190, RB = 330, MID = 260;
  const LANE_E = 225, LANE_W = 295;
  const XL = 420, XR = 480, XC = 450;
  const STOP_E = 402, STOP_W = 498;
  const CL = 46, CW = 24;
  const VMAX = 125, ACC = 100, DEC = 220;
  const KERB_T = 184, KERB_B = 336, PAVE_T = 166, PAVE_B = 354;
  const DURATION = 90;
  const PATIENCE = 25;

  class PelicanSim extends K.BaseSim {
    get seed() {
      return 8080;
    }
    initialDevices() {
      return { lights: 'green', man: 'red' };
    }
    init() {
      this.duration = DURATION;
      this.cars = [];
      this.peds = [];
      this.spawnE = 0.3;
      this.spawnW = 1.3;
      this.spawnP = 1;
      this.button = false;
      this.crossed = 0;
      this.carsPassed = 0;
      this.jaywalk = 0;
      this.pointless = 0;
      this.lastBothGo = -100;
      this.usedFlashMan = false;
      this.usedFlashAmber = false;
      this.sensorFns = {
        'button pressed': () => this.button,
        'person waiting': () => this.peds.some((p) => p.state === 'waiting'),
        'crossing clear': () => !this.peds.some((p) => p.state === 'crossing'),
      };
    }
    onSet(n, s) {
      if (n === 'man' && s === 'green') this.button = false;
      if (n === 'man' && s === 'flashing') this.usedFlashMan = true;
      if (n === 'lights' && s === 'flashing amber') this.usedFlashAmber = true;
    }
    newCar(dir) {
      const v = VMAX * (0.88 + this.rng() * 0.12);
      return { dir, x: dir > 0 ? -30 : W + 30, y: dir > 0 ? LANE_E : LANE_W, v, vmax: v, color: K.pick(this.rng, K.CAR_COLORS), passed: false, amber: null };
    }
    newPed() {
      const top = this.rng() < 0.5;
      const fromLeft = this.rng() < 0.5;
      const slow = this.rng() < 0.25;
      return {
        top, hdir: fromLeft ? 1 : -1, x: fromLeft ? XC - 150 - this.rng() * 200 : XC + 150 + this.rng() * 200, y: top ? PAVE_T : PAVE_B,
        crossX: XC - 18 + this.rng() * 36, state: 'approach', speed: slow ? 26 : 38 + this.rng() * 10, slow,
        color: K.pick(this.rng, K.PED_COLORS), hair: slow ? '#ddd' : K.pick(this.rng, K.HAIR), phase: 0, wait: 0, ang: fromLeft ? 0 : Math.PI, fade: 0,
      };
    }
    ahead(c) {
      let best = null;
      let bd = Infinity;
      for (const o of this.cars) {
        if (o === c || o.dir !== c.dir) continue;
        const d = (o.x - c.x) * c.dir;
        if (d > 0 && d < bd) {
          bd = d;
          best = o;
        }
      }
      return best;
    }
    step(dt) {
      const L = this.dev.lights;
      const M = this.dev.man;
      if (L === 'green' && (M === 'green' || M === 'flashing')) this.lastBothGo = this.t;

      this.spawnE -= dt;
      this.spawnW -= dt;
      this.spawnP -= dt;
      if (this.spawnE <= 0) {
        if (!this.cars.some((c) => c.dir > 0 && c.x < 50)) {
          this.cars.push(this.newCar(1));
          this.spawnE = 2 + this.rng() * 2.8;
        } else this.spawnE = 0.4;
      }
      if (this.spawnW <= 0) {
        if (!this.cars.some((c) => c.dir < 0 && c.x > W - 50)) {
          this.cars.push(this.newCar(-1));
          this.spawnW = 2 + this.rng() * 2.8;
        } else this.spawnW = 0.4;
      }
      if (this.spawnP <= 0) {
        this.peds.push(this.newPed());
        this.spawnP = 4.5 + this.rng() * 5;
      }

      const onCrossing = this.peds.some((p) => p.state === 'crossing');
      for (const c of this.cars) {
        const front = c.x + (c.dir * CL) / 2;
        const dist = c.dir > 0 ? STOP_E - front : front - STOP_W;
        let target = c.vmax;
        if (!c.passed) {
          if (dist < -0.5) {
            c.passed = true;
            if (L === 'red') c.ranRed = true;
          } else {
            let stop = false;
            if (L === 'red' || L === 'red amber') stop = true;
            else if (L === 'flashing amber') stop = onCrossing;
            else if (L === 'amber') {
              if (c.amber == null) c.amber = (c.v * c.v) / (2 * DEC) < dist - 1 || c.v < 25 ? 'stop' : 'go';
              stop = c.amber === 'stop';
            }
            if (L !== 'amber') c.amber = null;
            if (stop) target = Math.min(target, K.stopLimit(dist, DEC));
          }
        }
        const a = this.ahead(c);
        if (a) target = Math.min(target, K.followLimit(Math.abs(a.x - c.x) - CL, a.v, DEC, 14));
        c.braking = target < c.v - 2;
        c.v = K.approach(c.v, target, ACC, DEC * 2.2, dt);
        c.x += c.dir * c.v * dt;
        if (!c.counted && (c.dir > 0 ? c.x > XR + 40 : c.x < XL - 40)) {
          c.counted = true;
          this.carsPassed++;
        }
      }
      this.cars = this.cars.filter((c) => c.x > -80 && c.x < W + 80);

      const move = (p, tx, ty) => {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        const s = p.speed * dt;
        if (d <= s) {
          p.x = tx;
          p.y = ty;
          return true;
        }
        p.x += (dx / d) * s;
        p.y += (dy / d) * s;
        p.ang = Math.atan2(dy, dx);
        p.phase += dt * 9;
        return false;
      };
      for (const p of this.peds) {
        p.fade = Math.min(1, p.fade + dt * 2);
        switch (p.state) {
          case 'approach':
            if (move(p, p.crossX, p.y)) p.state = 'toKerb';
            break;
          case 'toKerb':
            if (move(p, p.crossX, p.top ? KERB_T : KERB_B)) {
              p.state = 'waiting';
              p.ang = p.top ? Math.PI / 2 : -Math.PI / 2;
              this.button = true;
              p.pressed = 0.4;
            }
            break;
          case 'waiting':
            p.wait += dt;
            if (p.pressed) p.pressed = Math.max(0, p.pressed - dt);
            if (M === 'green') p.state = 'crossing';
            else if (p.wait > PATIENCE) {
              p.state = 'crossing';
              p.jay = true;
              this.jaywalk++;
            }
            break;
          case 'crossing':
            if (move(p, p.crossX, p.top ? KERB_B : KERB_T)) {
              p.state = 'leave';
              this.crossed++;
            }
            break;
          case 'leave': {
            const py = p.top ? PAVE_B : PAVE_T;
            if (Math.abs(p.y - py) > 0.5) move(p, p.x, py);
            else move(p, p.x + p.hdir * 1000, py);
            break;
          }
        }
      }
      this.peds = this.peds.filter((p) => p.x > -30 && p.x < W + 30);

      // traffic stopped for no reason
      const needed = this.peds.some((p) => p.state === 'waiting' || p.state === 'crossing');
      if ((L === 'red' || L === 'amber') && !needed) this.pointless += dt;

      for (const p of this.peds) {
        if (p.state !== 'crossing') continue;
        for (const c of this.cars) {
          if (Math.abs(p.x - c.x) < CL / 2 + 5 && Math.abs(p.y - c.y) < CW / 2 + 5) {
            c.v = 0;
            this.hitPed = p;
            this.fail((p.x + c.x) / 2, (p.y + c.y) / 2, this.diagnose(c, p));
            return;
          }
        }
      }
    }
    diagnose(c, p) {
      const b = { label: 'CRASH!', icon: '💥', title: 'Accident at the crossing!' };
      if (p.jay) return { ...b, text: `Someone waited more than ${PATIENCE} seconds for the green man, got fed up, and crossed on red.`, tip: 'Respond to the button quickly – use "wait until button pressed" and then start the change straight away.' };
      if (c.ranRed) return { ...b, text: 'The traffic light went straight from green to red. A driver right at the line couldn’t stop in time.', tip: 'Show AMBER for about 3 seconds before red, so drivers have time to stop.' };
      if (this.t - this.lastBothGo < 3) return { ...b, text: 'The green man and the green traffic light were on at the same time!', tip: 'Make sure the traffic light is RED before you show the green man.' };
      return { ...b, text: 'The traffic light let cars go while someone was still on the crossing.', tip: 'After the green man, wait until the crossing is clear ("wait until crossing clear") before giving traffic a green light.' };
    }
    goals() {
      return [
        this.goal('safe', 'No accidents at the crossing', this.safeStatus(), `${this.crossed} people crossed`),
        this.goal('patience', `Everyone gets a green man within ${PATIENCE} s of pressing`, this.jaywalk ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', this.jaywalk ? `${this.jaywalk} crossed on red` : 'Respond to the button'),
        this.goal('flow', 'Don’t stop the traffic when nobody needs to cross', this.pointless > 12 ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Cars stopped for nobody: ${this.pointless.toFixed(0)} s (max 12)`),
        this.goal('flash', 'Bonus: finish with a flashing green man AND flashing amber, like a real pelican', this.ended && this.usedFlashMan && this.usedFlashAmber && !this.crash ? 'pass' : this.ended ? 'fail' : 'pending', 'States: man flashing, lights flashing amber', false),
      ];
    }
    status() {
      const manCol = { red: '#ff3b30', green: '#2fd158', flashing: '#2fd158' };
      return [
        { label: 'Traffic lights', value: this.dev.lights.toUpperCase(), swatches: this.dev.lights === 'flashing amber' ? ['#ffb000'] : K.swatchesFor(this.dev.lights) },
        { label: 'Green / red man', value: this.dev.man.toUpperCase(), swatch: manCol[this.dev.man] },
        { label: 'Sensor: button pressed', value: this.button ? 'TRUE' : 'FALSE' },
        { label: 'Sensor: crossing clear', value: this.readSensor('crossing clear') ? 'TRUE' : 'FALSE' },
        { label: 'People crossed', value: String(this.crossed) },
      ];
    }
    buildBg(g, r) {
      K.grass(g, r, W, H);
      const roofs = ['#a5533a', '#8d6e63', '#6d4c41', '#b5654b', '#546e7a'];
      for (let i = 0; i < 6; i++) {
        K.drawHouse(g, 38 + i * 150, 30, 92, 62, roofs[i % 5], '#e8dccb');
        K.drawHouse(g, 50 + i * 150, 412, 92, 62, roofs[(i + 2) % 5], '#e8dccb');
      }
      for (let i = 0; i < 9; i++) {
        K.drawTree(g, 10 + i * 105 + r() * 20, 125, 13, r);
        K.drawTree(g, 60 + i * 105, 392, 12, r);
      }
      g.fillStyle = '#d6d3cc';
      g.fillRect(0, 148, W, RT - 148);
      g.fillRect(0, RB, W, 372 - RB);
      g.fillStyle = '#9e9a93';
      g.fillRect(0, RT - 3, W, 3);
      g.fillRect(0, RB, W, 3);
      g.fillStyle = '#c9897a';
      g.fillRect(XL + 4, RT - 18, XR - XL - 8, 15);
      g.fillRect(XL + 4, RB + 3, XR - XL - 8, 15);
      K.asphalt(g, r, 0, RT, W, RB - RT);
      g.fillStyle = '#f2f2f2';
      for (let x = 0; x < W; x += 40) if (x < 250 || x > 640) g.fillRect(x, MID - 1.5, 22, 3);
      // zig-zags
      g.strokeStyle = '#f2f2f2';
      g.lineWidth = 2.5;
      const zig = (x0, x1, y) => {
        g.beginPath();
        g.moveTo(x0, y);
        let up = true;
        for (let x = x0 + 12; x <= x1; x += 12) {
          g.lineTo(x, y + (up ? -4.5 : 4.5));
          up = !up;
        }
        g.stroke();
      };
      [RT + 7, MID, RB - 7].forEach((y) => {
        zig(250, STOP_E - 6, y);
        zig(STOP_W + 6, 650, y);
      });
      // crossing studs
      for (let y = RT + 4; y < RB - 2; y += 8) {
        g.fillStyle = '#f2f2f2';
        g.fillRect(XL, y, 4, 4);
        g.fillRect(XR - 4, y, 4, 4);
      }
      g.fillRect(STOP_E - 4, RT + 3, 4, MID - RT - 3);
      g.fillRect(STOP_W, MID + 1, 4, RB - MID - 4);
    }
    drawMan(ctx, x, y, state) {
      const blink = Math.floor(this.t * 3) % 2 === 0;
      ctx.fillStyle = '#1c1f24';
      K.rr(ctx, x - 9, y - 12, 18, 24, 4);
      ctx.fill();
      const green = state === 'green' || (state === 'flashing' && blink);
      const red = state === 'red';
      ctx.fillStyle = red ? '#ff3b30' : '#4a1512';
      ctx.font = '900 9px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚶', x, y - 5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = red ? '#ff3b30' : '#3d1210';
      ctx.fillRect(x - 5, y - 9, 10, 8);
      ctx.fillStyle = green ? '#2fd158' : '#0f3a1c';
      ctx.fillRect(x - 5, y + 1, 10, 8);
      if (green || red) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        K.glow(ctx, x, y + (green ? 5 : -5), 12, green ? '40,220,90' : '255,60,40', 0.6);
        ctx.restore();
      }
    }
    draw(ctx) {
      this.drawBg(ctx);
      for (const p of this.peds) {
        if (this.crash && this.hitPed === p) continue;
        K.drawPerson(ctx, p.x, p.y, p.ang, p.color, p.phase, { hair: p.hair, alpha: p.fade });
        if (p.state === 'waiting' && p.wait > PATIENCE * 0.6 && !this.crash) {
          ctx.font = '15px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('😠', p.x, p.y - 16);
        }
      }
      for (const c of this.cars) K.drawCar(ctx, c.x, c.y, c.dir > 0 ? 0 : Math.PI, c.color, { braking: c.braking, len: CL, wid: CW });
      if (this.crash && this.hitPed) {
        const p = this.hitPed;
        K.drawPerson(ctx, p.x, p.y, p.ang + this.crash.age * 2, p.color, 0, { hair: p.hair });
      }
      const blink = Math.floor(this.t * 3) % 2 === 0;
      const L = this.dev.lights;
      const lamps = [
        ...K.drawSignal(ctx, STOP_E - 14, 160, L, null, { blink }),
        ...K.drawSignal(ctx, STOP_W + 14, 362, L, null, { blink }),
      ];
      K.signalGlow(ctx, lamps);
      this.drawMan(ctx, XR + 12, 168, this.dev.man);
      this.drawMan(ctx, XL - 12, 352, this.dev.man);
      // buttons
      [[XL - 10, KERB_T - 6], [XR + 10, KERB_B + 6]].forEach(([x, y]) => {
        ctx.fillStyle = '#ffd43b';
        K.rr(ctx, x - 6, y - 5, 12, 10, 2);
        ctx.fill();
        ctx.fillStyle = this.button && blink ? '#ff922b' : '#495057';
        ctx.fillRect(x - 3, y - 2, 6, 4);
      });
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#86bf6b"/><rect y="38" width="240" height="14" fill="#d6d3cc"/><rect y="98" width="240" height="14" fill="#d6d3cc"/>
    <rect y="52" width="240" height="46" fill="#4b4f56"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="104" y="${54 + i * 5.5}" width="2" height="2" fill="#fff"/><rect x="134" y="${54 + i * 5.5}" width="2" height="2" fill="#fff"/>`).join('')}
    <rect x="60" y="56" width="30" height="12" rx="3" fill="#3f88c5"/>
    <g><rect x="92" y="14" width="10" height="24" rx="2" fill="#1c1f24"/><circle cx="97" cy="20" r="3" fill="#ff3b30"/><circle cx="97" cy="27" r="3" fill="#4a3a10"/><circle cx="97" cy="34" r="3" fill="#0f3a1c"/></g>
    <g><rect x="140" y="16" width="12" height="18" rx="2" fill="#1c1f24"/><rect x="143" y="26" width="6" height="6" fill="#2fd158"/></g>
    <circle cx="120" cy="70" r="5" fill="#d7263d"/>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'pelican',
    order: 2,
    title: 'Pelican Crossing',
    tagline: 'Press the button, wait for the green man – program the full pedestrian crossing sequence.',
    difficulty: 'Intermediate',
    concepts: ['Responding to events', 'Long sequences', 'Wait until', 'Safety timing'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>At a <b>pelican crossing</b>, people press a button and wait for the <b>green man</b>. The traffic lights must stop the cars first!</p>
      <p>The real sequence: traffic <b>green → amber → red</b>, then the <b>green man</b>. When time is nearly up, the man <b>flashes</b> (don’t start crossing!) and traffic sees <b>flashing amber</b> (go only if the crossing is clear). Then back to red man and green traffic.</p>
      <p>Older people walk slowly – make sure everyone is off the crossing before cars get a green light. And don’t keep people waiting too long, or they’ll cross anyway!</p>`,
    devices: {
      lights: {
        label: 'traffic lights', aliases: ['light', 'traffic light', 'traffic lights', 'traffic'], states: ['green', 'amber', 'red', 'flashing amber'],
        stateAliases: { yellow: 'amber', orange: 'amber', 'flashing yellow': 'flashing amber', flashing: 'flashing amber' },
        stateColors: { green: '#2fd158', amber: '#ffb000', red: '#ff3b30', 'flashing amber': '#ffb000' }, describe: 'The traffic lights facing the cars.',
      },
      man: {
        label: 'man', aliases: ['green man', 'red man', 'walk light', 'pedestrian light', 'person light'], states: ['red', 'green', 'flashing'],
        stateAliases: { 'flashing green': 'flashing' }, stateColors: { red: '#ff3b30', green: '#2fd158', flashing: '#8ce99a' }, describe: 'The red / green man shown to people crossing.',
      },
    },
    sensors: {
      'button pressed': 'True after someone presses the button (until the green man shows).',
      'person waiting': 'True when someone is waiting at the kerb.',
      'crossing clear': 'True when nobody is on the crossing.',
    },
    snippets: { set: 'set lights amber', sensor: 'button pressed' },
    starter: `# When the button is pressed, stop the traffic
# and show the green man.
# Something is missing... Press Run and watch carefully!

forever:
    wait until button pressed
    set lights red
    set man green
    wait 4
    set man red
    set lights green
`,
    solution: `set lights green
set man red
forever:
    wait until button pressed
    # Warn drivers, then stop them
    set lights amber
    wait 3
    set lights red
    wait 1
    # People cross
    set man green
    wait 6
    # Time's nearly up
    set man flashing
    set lights flashing amber
    wait until crossing clear
    # Back to normal
    set man red
    set lights green
    wait 8
`,
    hints: [
      'Drivers need a warning: put "set lights amber" and "wait 3" before "set lights red".',
      'Slow walkers might still be on the crossing after 8 seconds. Use "wait until crossing clear" before giving cars green.',
      'Give the traffic a few seconds of green at the end of the loop so cars can get going again.',
      'Bonus: after the green man, use "set man flashing" and "set lights flashing amber" while you wait for the crossing to clear.',
    ],
    create: () => new PelicanSim(),
  });
})();
