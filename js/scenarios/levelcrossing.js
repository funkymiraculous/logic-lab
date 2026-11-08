/* Railway level crossing: warning lights, barriers, trains that can't stop. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const RX0 = 398, RX1 = 482;
  const LANE_S = 461, LANE_N = 419; // UK: drive on the left
  const TRACK_Y = 260;
  const BAR_N = 206, BAR_S = 314; // barrier lines
  const STOP_S = BAR_N - 12; // southbound cars stop with their front here
  const STOP_N = BAR_S + 12;
  const CL = 44, CW = 22;
  const VMAX = 100, ACC = 80, DEC = 220;
  const TRAIN_V = 240;
  const TRAIN_CARS = 4;
  const TRAIN_LEN = TRAIN_CARS * 80;
  const WARN_DIST = 2200; // sensor distance before the crossing
  const DURATION = 80;
  const TARGET = 20;
  const TRAINS = [[5, 1], [31, -1], [56, 1]];

  class LevelCrossingSim extends K.BaseSim {
    get seed() {
      return 2468;
    }
    initialDevices() {
      return { lights: 'off', barriers: 'up' };
    }
    init() {
      this.duration = DURATION;
      this.cars = [];
      this.down = 0;
      this.trains = [];
      this.trainIdx = 0;
      this.spawnS = 0.4;
      this.spawnN = 1.6;
      this.crossed = 0;
      this.maxWait = 0;
      this.amberSeen = false;
      this.warnFail = false;
      this.reopenFail = false;
      this.wasComing = false;
      this.sinceTrain = null;
      this.sensorFns = {
        'train coming': () => this.trainComing(),
        'crossing clear': () => !this.cars.some((c) => this.onCrossing(c)),
        'barriers down': () => this.down >= 0.999,
      };
    }
    onSet(n, s) {
      if (n === 'lights' && s === 'amber') this.amberSeen = true;
      if (n === 'lights' && s === 'off') this.amberSeen = false;
      if (n === 'barriers' && s === 'down' && !(this.dev.lights === 'flashing' && this.amberSeen)) this.warnFail = true;
    }
    trainComing() {
      return this.trains.some((t) => {
        const distToCross = t.dir > 0 ? RX0 - t.x : t.x - RX1;
        const rear = t.x - t.dir * TRAIN_LEN;
        const rearPast = t.dir > 0 ? rear > RX1 + 10 : rear < RX0 - 10;
        return distToCross < WARN_DIST && !rearPast;
      });
    }
    onCrossing(c) {
      const top = c.y - CL / 2;
      const bot = c.y + CL / 2;
      return bot > BAR_N - 4 && top < BAR_S + 4;
    }
    step(dt) {
      // trains
      if (this.trainIdx < TRAINS.length && this.t >= TRAINS[this.trainIdx][0]) {
        const dir = TRAINS[this.trainIdx][1];
        this.trains.push({ dir, x: dir > 0 ? RX0 - WARN_DIST - 150 : RX1 + WARN_DIST + 150 });
        this.trainIdx++;
      }
      for (const t of this.trains) t.x += t.dir * TRAIN_V * dt;
      this.trains = this.trains.filter((t) => (t.dir > 0 ? t.x - TRAIN_LEN < W + 100 : t.x + TRAIN_LEN > -100));

      const coming = this.trainComing();
      if (this.wasComing && !coming) this.sinceTrain = 0;
      this.wasComing = coming;
      if (this.sinceTrain != null) {
        this.sinceTrain += dt;
        if (this.dev.barriers === 'up' && this.dev.lights === 'off') this.sinceTrain = null;
        else if (this.sinceTrain > 4) this.reopenFail = true;
      }
      const target = this.dev.barriers === 'down' ? 1 : 0;
      const lowering = target > this.down;
      this.down = target > this.down ? Math.min(1, this.down + dt / 3) : Math.max(0, this.down - dt / 3);

      this.spawnS -= dt;
      this.spawnN -= dt;
      if (this.spawnS <= 0) {
        if (!this.cars.some((c) => c.dir > 0 && c.y < 40)) {
          this.cars.push(this.newCar(1));
          this.spawnS = 1.8 + this.rng() * 2.2;
        } else this.spawnS = 0.5;
      }
      if (this.spawnN <= 0) {
        if (!this.cars.some((c) => c.dir < 0 && c.y > H - 40)) {
          this.cars.push(this.newCar(-1));
          this.spawnN = 1.8 + this.rng() * 2.2;
        } else this.spawnN = 0.5;
      }

      const L = this.dev.lights;
      for (const c of this.cars) {
        const front = c.y + (c.dir * CL) / 2;
        const distEntry = c.dir > 0 ? STOP_S - front : front - STOP_N;
        const exitLine = c.dir > 0 ? BAR_S - 6 : BAR_N + 6;
        const distExit = c.dir > 0 ? exitLine - front : front - exitLine;
        let target = VMAX;
        if (!c.passed) {
          if (distEntry < -0.5) c.passed = true;
          else {
            let stop = this.down > 0.02;
            if (L === 'flashing') stop = stop || (c.v * c.v) / (2 * DEC) < distEntry + 4 || c.v < 30;
            if (L === 'amber') {
              if (c.amber == null) c.amber = (c.v * c.v) / (2 * DEC) < distEntry - 1 || c.v < 25 ? 'stop' : 'go';
              stop = stop || c.amber === 'stop';
            } else c.amber = null;
            if (stop) target = Math.min(target, K.stopLimit(distEntry, DEC));
          }
        } else if (distExit > -1 && this.down > 0.15) {
          target = Math.min(target, K.stopLimit(distExit, DEC * 2));
          c.trapped = true;
        }
        const a = this.ahead(c);
        if (a) target = Math.min(target, K.followLimit(Math.abs(a.y - c.y) - CL, a.v, DEC, 12));
        c.braking = target < c.v - 2;
        c.v = K.approach(c.v, target, ACC, DEC * 2.2, dt);
        c.y += c.dir * c.v * dt;
        if (!c.passed && c.v < 4) {
          c.wait += dt;
          this.maxWait = Math.max(this.maxWait, c.wait);
        }
        if (!c.counted && (c.dir > 0 ? c.y - CL / 2 > BAR_S + 8 : c.y + CL / 2 < BAR_N - 8)) {
          c.counted = true;
          this.crossed++;
        }
        // barrier lowered onto a car
        for (const by of [BAR_N, BAR_S]) {
          if (lowering && this.down > 0.6 && c.y - CL / 2 < by + 4 && c.y + CL / 2 > by - 4) {
            this.fail(c.x, by, { label: 'BONK!', icon: '🚧', title: 'A barrier came down on a car!', text: 'The barriers started lowering while a car was still driving across.', tip: 'Before lowering the barriers, "wait until crossing clear".' });
            return;
          }
        }
      }
      this.cars = this.cars.filter((c) => c.y > -60 && c.y < H + 60);

      // train collisions
      for (const t of this.trains) {
        const x0 = Math.min(t.x, t.x - t.dir * TRAIN_LEN);
        const x1 = Math.max(t.x, t.x - t.dir * TRAIN_LEN);
        for (const c of this.cars) {
          if (c.x + CW / 2 > x0 && c.x - CW / 2 < x1 && Math.abs(c.y - TRACK_Y) < CL / 2 + 13) {
            this.hit = c;
            this.fail(c.x, TRACK_Y, this.diagnose(c));
            return;
          }
        }
      }
    }
    newCar(dir) {
      return { dir, x: dir > 0 ? LANE_S : LANE_N, y: dir > 0 ? -30 : H + 30, v: VMAX * 0.9, color: K.pick(this.rng, K.CAR_COLORS), wait: 0, passed: false };
    }
    ahead(c) {
      let best = null;
      let bd = Infinity;
      for (const o of this.cars) {
        if (o === c || o.dir !== c.dir) continue;
        const d = (o.y - c.y) * c.dir;
        if (d > 0 && d < bd) {
          bd = d;
          best = o;
        }
      }
      return best;
    }
    afterCrash(dt) {
      for (const t of this.trains) t.x += t.dir * TRAIN_V * dt * Math.max(0, 0.4 - this.crash.age);
      if (this.hit) this.hit.spin = (this.hit.spin || 0) + dt * 6 * Math.max(0, 1 - this.crash.age);
    }
    diagnose(c) {
      const b = { label: 'CRASH!', icon: '🚂', title: 'The train hit a car!' };
      if (c.trapped) return { ...b, text: 'The car was trapped on the railway between the barriers – the barrier on the far side came down in front of it.', tip: 'Wait until the crossing is clear before lowering the barriers.' };
      if (this.dev.lights === 'off' && this.dev.barriers === 'up') return { ...b, text: 'The lights never warned drivers and the barriers stayed up, so the driver had no idea a train was coming.', tip: 'Use "wait until train coming", then warn drivers with the lights and lower the barriers.' };
      return { ...b, text: 'A car was still on the railway when the train arrived. Trains can’t stop quickly!', tip: 'Start warning drivers as soon as the train is coming: amber, then flashing red, then lower the barriers.' };
    }
    goals() {
      return [
        this.goal('safe', 'No crashes – trains or barriers', this.safeStatus(), this.trainComing() ? '🚂 Train coming!' : 'Watch the train indicator'),
        this.goal('flow', `Get ${TARGET} cars across`, this.crossed >= TARGET ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.crossed} / ${TARGET}`),
        this.goal('wait', 'Nobody waits more than 40 s', this.maxWait > 40 ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Longest wait: ${Math.round(this.maxWait)} s`),
        this.goal('warn', 'Always warn drivers: amber, then flashing red, before the barriers come down', this.warnFail ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', this.warnFail ? 'Barriers lowered without a full warning' : 'Like a real UK crossing'),
        this.goal('reopen', 'Bonus: reopen quickly – barriers up and lights off within 4 s of each train passing', this.reopenFail ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', this.reopenFail ? 'Drivers were kept waiting after the train' : 'Use "wait until not train coming"', false),
      ];
    }
    status() {
      const next = this.trains.find((t) => (t.dir > 0 ? t.x < RX0 : t.x > RX1));
      const secs = next ? (Math.abs((next.dir > 0 ? RX0 : RX1) - next.x) / TRAIN_V).toFixed(0) : null;
      return [
        { label: 'Warning lights', value: this.dev.lights.toUpperCase(), swatch: this.dev.lights === 'off' ? '#555' : this.dev.lights === 'amber' ? '#ffb000' : '#ff3b30' },
        { label: 'Barriers', value: this.dev.barriers.toUpperCase(), note: this.down > 0 && this.down < 1 ? 'moving…' : '' },
        { label: 'Sensor: train coming', value: this.trainComing() ? 'TRUE 🚂' : 'FALSE' },
        { label: 'Next train arrives in', value: secs != null ? `${secs} s` : '–' },
        { label: 'Cars across', value: `${this.crossed} / ${TARGET}` },
      ];
    }
    buildBg(g, r) {
      K.grass(g, r, W, H, '#8cc06e');
      // fields
      g.fillStyle = 'rgba(200,180,90,0.35)';
      g.fillRect(40, 30, 300, 150);
      g.fillRect(560, 340, 300, 150);
      g.strokeStyle = 'rgba(120,100,40,0.3)';
      for (let y = 36; y < 180; y += 10) {
        g.beginPath();
        g.moveTo(40, y);
        g.lineTo(340, y);
        g.stroke();
      }
      for (let i = 0; i < 12; i++) K.drawTree(g, 30 + r() * 840, i < 6 ? 340 + r() * 160 : 20 + r() * 160, 12 + r() * 6, r);
      // ballast + track
      g.fillStyle = '#9b8e7e';
      g.fillRect(0, TRACK_Y - 26, W, 52);
      g.fillStyle = '#6d4c41';
      for (let x = 0; x < W; x += 14) g.fillRect(x, TRACK_Y - 20, 7, 40);
      g.fillStyle = '#adb5bd';
      g.fillRect(0, TRACK_Y - 13, W, 4);
      g.fillRect(0, TRACK_Y + 9, W, 4);
      // road
      K.asphalt(g, r, RX0, 0, RX1 - RX0, H);
      g.fillStyle = '#5b5f66';
      g.fillRect(RX0, TRACK_Y - 26, RX1 - RX0, 52);
      g.fillStyle = '#adb5bd';
      g.fillRect(RX0, TRACK_Y - 13, RX1 - RX0, 4);
      g.fillRect(RX0, TRACK_Y + 9, RX1 - RX0, 4);
      K.dashedLine(g, (RX0 + RX1) / 2, 0, (RX0 + RX1) / 2, BAR_N - 30, 20, 16, 3);
      K.dashedLine(g, (RX0 + RX1) / 2, BAR_S + 30, (RX0 + RX1) / 2, H, 20, 16, 3);
      // yellow box
      g.strokeStyle = '#ffd43b';
      g.lineWidth = 2;
      g.strokeRect(RX0 + 3, BAR_N + 2, RX1 - RX0 - 6, BAR_S - BAR_N - 4);
      g.fillStyle = '#f2f2f2';
      g.fillRect((RX0 + RX1) / 2, STOP_S - 3, (RX1 - RX0) / 2 - 2, 3);
      g.fillRect(RX0 + 2, STOP_N, (RX1 - RX0) / 2 - 2, 3);
      // warning signs
      [[RX0 - 30, 120], [RX1 + 30, 400]].forEach(([x, y]) => {
        g.fillStyle = '#555';
        g.fillRect(x - 1.5, y, 3, 16);
        g.fillStyle = '#fff';
        g.beginPath();
        g.moveTo(x, y - 16);
        g.lineTo(x + 13, y + 6);
        g.lineTo(x - 13, y + 6);
        g.closePath();
        g.fill();
        g.strokeStyle = '#d0021b';
        g.lineWidth = 3;
        g.stroke();
        g.fillStyle = '#222';
        g.fillRect(x - 6, y - 2, 12, 4);
      });
    }
    drawLights(ctx, x, y) {
      const L = this.dev.lights;
      const blink = Math.floor(this.t * 2.5) % 2 === 0;
      ctx.fillStyle = '#1c1f24';
      K.rr(ctx, x - 16, y - 8, 32, 30, 5);
      ctx.fill();
      const amber = L === 'amber';
      const redL = L === 'flashing' && blink;
      const redR = L === 'flashing' && !blink;
      ctx.fillStyle = redL ? '#ff3b30' : '#4a1512';
      ctx.beginPath();
      ctx.arc(x - 8, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = redR ? '#ff3b30' : '#4a1512';
      ctx.beginPath();
      ctx.arc(x + 8, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = amber ? '#ffb000' : '#4a3a10';
      ctx.beginPath();
      ctx.arc(x, y + 13, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (redL) K.glow(ctx, x - 8, y, 18, '255,60,40', 0.7);
      if (redR) K.glow(ctx, x + 8, y, 18, '255,60,40', 0.7);
      if (amber) K.glow(ctx, x, y + 13, 18, '255,170,0', 0.7);
      ctx.restore();
    }
    draw(ctx) {
      this.drawBg(ctx);
      for (const c of this.cars) {
        K.drawCar(ctx, c.x, c.y, (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) + (c.spin || 0), c.color, { braking: c.braking, len: CL, wid: CW });
      }
      for (const t of this.trains) K.drawTrain(ctx, t.x, TRACK_Y, t.dir, TRAIN_CARS, { lights: true });
      const p = 1 - this.down;
      const blink = Math.floor(this.t * 2.5) % 2 === 0;
      K.drawBarrier(ctx, RX0 - 10, BAR_N, RX1 - RX0 + 6, 0, p, { light: true, blink });
      K.drawBarrier(ctx, RX1 + 10, BAR_S, RX1 - RX0 + 6, Math.PI, p, { light: true, blink });
      this.drawLights(ctx, RX1 + 34, BAR_N - 34);
      this.drawLights(ctx, RX0 - 34, BAR_S + 24);
      // approaching-train indicator
      const coming = this.trainComing();
      ctx.fillStyle = coming ? 'rgba(201,42,42,0.9)' : 'rgba(20,24,40,0.7)';
      K.rr(ctx, 12, 12, 200, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '800 13px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(coming ? '🚂 TRAIN COMING' : 'No train detected', 22, 32);
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#8cc06e"/><rect y="56" width="240" height="28" fill="#9b8e7e"/>
    <rect y="62" width="240" height="2" fill="#adb5bd"/><rect y="76" width="240" height="2" fill="#adb5bd"/>
    <rect x="106" width="28" height="140" fill="#4b4f56"/>
    <rect x="20" y="58" width="40" height="24" rx="4" fill="#ffd43b"/><rect x="62" y="58" width="40" height="24" rx="2" fill="#2f6fb2"/>
    ${[0, 1, 2, 3].map((i) => `<rect x="${100 + i * 9}" y="48" width="9" height="4" fill="${i % 2 ? '#fff' : '#e03131'}"/>`).join('')}
    <circle cx="146" cy="40" r="4" fill="#ff3b30"/><circle cx="156" cy="40" r="4" fill="#4a1512"/>
    <rect x="113" y="12" width="12" height="20" rx="2" fill="#3f88c5"/>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'levelcrossing',
    order: 3,
    title: 'Railway Level Crossing',
    tagline: 'Warn the drivers and lower the barriers before the train arrives – trains can’t stop!',
    difficulty: 'Intermediate',
    concepts: ['Events', 'Safe order of actions', 'Wait until', 'Not'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>A road crosses a railway. A sensor down the line tells you when a <b>train is coming</b> – it arrives about <b>9 seconds</b> later, and it <b>cannot stop</b>.</p>
      <p>A UK crossing warns drivers with a steady <b>amber</b> light, then <b>flashing red</b> lights, and then the <b>barriers</b> come down (they take 3 seconds).</p>
      <p>Careful: there are barriers on <b>both sides</b>. Lower them while a car is on the crossing and it gets trapped on the railway!</p>
      <p>After the train has gone, lift the barriers and turn the lights off so traffic can flow again.</p>`,
    devices: {
      lights: { label: 'warning lights', aliases: ['light', 'warning lights', 'signals', 'wig wags'], states: ['off', 'amber', 'flashing'], stateAliases: { 'flashing red': 'flashing', red: 'flashing', yellow: 'amber' }, stateColors: { off: '#5b5b5b', amber: '#ffb000', flashing: '#ff3b30' }, describe: 'The warning lights facing drivers: off, amber, or flashing red.' },
      barriers: { label: 'barriers', aliases: ['barrier', 'gates', 'gate'], states: ['up', 'down'], stateAliases: { open: 'up', closed: 'down', raised: 'up', lowered: 'down' }, stateColors: { up: '#2fd158', down: '#ff3b30' }, describe: 'The barriers on both sides of the railway. They take 3 seconds to move.' },
    },
    sensors: {
      'train coming': 'True from when a train is detected until it has completely passed the crossing.',
      'crossing clear': 'True when no car is on the crossing.',
      'barriers down': 'True when the barriers are fully down.',
    },
    snippets: { set: 'set lights amber', sensor: 'train coming' },
    starter: `# When a train is coming, lower the barriers.
# When it's gone, lift them again.
# But do drivers get any warning? Press Run!

forever:
    wait until train coming
    set barriers down
    wait until not train coming
    set barriers up
`,
    solution: `forever:
    wait until train coming
    # Warn drivers
    set lights amber
    wait 3
    set lights flashing
    # Don't trap anyone on the railway
    wait until crossing clear
    set barriers down
    # Let the train pass
    wait until not train coming
    set barriers up
    set lights off
`,
    hints: [
      'Drivers need a warning before the barriers move: "set lights amber", "wait 3", then "set lights flashing".',
      'If a car is already on the crossing when the barriers come down, it gets trapped. Add "wait until crossing clear" before lowering them.',
      'After the train has gone, remember to turn the lights off as well as lifting the barriers.',
    ],
    create: () => new LevelCrossingSim(),
  });
})();
