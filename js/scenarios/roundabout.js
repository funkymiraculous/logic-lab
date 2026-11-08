/* Roundabout with metering lights: stop one busy road starving another. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const CX = 450, CY = 260;
  const R = 92; // ring lane radius
  const LAT = 20; // lane offset from arm centre line
  const D0 = 132; // give-way line distance from centre
  const CL = 38, CW = 19;
  const VMAX = 85, VRING = 62, ACC = 70, DEC = 190;
  const DURATION = 100;
  const TARGET = 40;
  const MAX_Q = 10;
  const MAX_WAIT = 45;
  const MAX_HOLD = 15;
  const ARMS = {
    east: { th: 0, spawnD: 480, rate: [1.45, 0.9], dest: [['west', 0.75], ['south', 0.1], ['north', 0.15]] },
    south: { th: Math.PI / 2, spawnD: 300, rate: [2.2, 1.2], dest: [['north', 0.5], ['east', 0.3], ['west', 0.2]] },
    west: { th: Math.PI, spawnD: 480, rate: [4.5, 2], dest: [['east', 0.5], ['north', 0.25], ['south', 0.25]] },
    north: { th: -Math.PI / 2, spawnD: 300, rate: [4.5, 2], dest: [['south', 0.5], ['east', 0.25], ['west', 0.25]] },
  };
  const DELTA = Math.asin(LAT / R);
  const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  function armPoint(arm, d, side) {
    const th = ARMS[arm].th;
    const ux = Math.cos(th), uy = Math.sin(th);
    const nx = -Math.sin(th), ny = Math.cos(th);
    return [CX + ux * d + nx * LAT * side, CY + uy * d + ny * LAT * side];
  }

  class RoundaboutSim extends K.BaseSim {
    get seed() {
      return 6060;
    }
    initialDevices() {
      return { north: 'green', east: 'green', south: 'green', west: 'green' };
    }
    init() {
      this.duration = DURATION;
      this.cars = [];
      this.spawn = { east: 0.2, south: 0.8, west: 1.5, north: 2.5 };
      this.pending = { east: 0, south: 0, west: 0, north: 0 };
      this.redFor = { east: 0, south: 0, west: 0, north: 0 };
      this.holdFail = false;
      this.through = 0;
      this.maxWait = 0;
      const q = (a) => () => this.queue(a);
      this.sensorFns = {
        'queue north': q('north'), 'queue east': q('east'), 'queue south': q('south'), 'queue west': q('west'),
        'cars on roundabout': () => this.cars.filter((c) => c.state === 'ring' || c.state === 'enter').length,
      };
    }
    queue(arm) {
      return this.cars.filter((c) => c.arm === arm && c.state === 'approach' && c.d < D0 + 220).length + this.pending[arm];
    }
    pickDest(arm) {
      let r = this.rng();
      for (const [d, p] of ARMS[arm].dest) {
        if ((r -= p) <= 0) return d;
      }
      return ARMS[arm].dest[0][0];
    }
    gapClear(arm) {
      const entryA = norm(ARMS[arm].th + DELTA);
      for (const c of this.cars) {
        if (c.state === 'enter') {
          if (c.arm !== arm && norm(entryA - c.ringA) < 1.1) return false;
          continue;
        }
        if (c.state !== 'ring') continue;
        if (c.dest === arm && norm(c.exitA - c.a) < 0.6) continue; // about to leave here
        const behind = norm(entryA - c.a); // how far upstream (clockwise distance to our entry)
        const ahead = norm(c.a - entryA);
        if (behind < 1.15 || ahead < 0.32) return false;
      }
      return true;
    }
    step(dt) {
      // spawn
      for (const arm of Object.keys(ARMS)) {
        this.spawn[arm] -= dt;
        if (this.spawn[arm] <= 0) {
          this.pending[arm]++;
          const [a, b] = ARMS[arm].rate;
          this.spawn[arm] = a + this.rng() * b;
        }
        if (this.pending[arm] > 0) {
          const last = this.cars.filter((c) => c.arm === arm && c.state === 'approach').sort((x, y) => y.d - x.d)[0];
          if (!last || last.d < ARMS[arm].spawnD - CL - 12) {
            this.pending[arm]--;
            this.cars.push({ id: ++this.nid, arm, dest: this.pickDest(arm), state: 'approach', d: ARMS[arm].spawnD, v: VMAX * 0.85, wait: 0, color: K.pick(this.rng, K.CAR_COLORS) });
          }
        }
        if (this.dev[arm] === 'red') {
          this.redFor[arm] += dt;
          if (this.redFor[arm] > MAX_HOLD) this.holdFail = true;
        } else this.redFor[arm] = 0;
      }

      // approach queues
      for (const arm of Object.keys(ARMS)) {
        const q = this.cars.filter((c) => c.arm === arm && c.state === 'approach').sort((a, b) => a.d - b.d);
        q.forEach((c, i) => {
          const front = c.d - CL / 2;
          const dist = front - D0;
          let target = VMAX;
          if (dist < 90) target = Math.min(target, 45);
          const L = this.dev[arm];
          const mayGo = L === 'green' && this.gapClear(arm);
          if (!mayGo || i > 0) target = Math.min(target, K.stopLimit(dist, DEC));
          if (i > 0) target = Math.min(target, K.followLimit(front - (q[i - 1].d + CL / 2), q[i - 1].v, DEC, 9));
          c.v = K.approach(c.v, target, ACC, DEC * 2, dt);
          c.braking = target < c.v - 2;
          c.d -= c.v * dt;
          if (c.v < 4) {
            c.wait += dt;
            this.maxWait = Math.max(this.maxWait, c.wait);
          }
          if (i === 0 && dist < 2 && mayGo) {
            c.state = 'enter';
            c.t = 0;
            c.from = armPoint(arm, D0 - 4, 1);
            c.ringA = norm(ARMS[arm].th + DELTA);
            c.to = [CX + Math.cos(c.ringA) * R, CY + Math.sin(c.ringA) * R];
            c.v = Math.max(c.v, 30);
          }
        });
      }
      // gridlock check
      for (const arm of Object.keys(ARMS)) {
        if (this.queue(arm) >= MAX_Q) {
          const [x, y] = armPoint(arm, D0 + 120, 1);
          this.fail(x, y, { label: 'JAM!', icon: '🚗', title: `Gridlock on the ${arm} road!`, text: `${MAX_Q} cars queued on the ${arm} road and the traffic backed up out of sight.${arm === 'south' ? ' Busy traffic from the east kept going round, and drivers from the south never found a gap.' : ''}`, tip: arm === 'south' ? 'When "queue south" gets big, set the east lights red for a while so the south road gets a chance.' : `Don’t hold the ${arm} road at red for too long – give it a green again.` });
          return;
        }
      }
      if (this.maxWait > MAX_WAIT) {
        this.fail(CX, CY - 150, { label: 'JAM!', icon: '⏳', title: 'A driver waited too long!', text: `Someone waited more than ${MAX_WAIT} seconds to get onto the roundabout.`, tip: 'Make sure every road gets a green light regularly.' });
        return;
      }
      // enter / ring / exit / leave
      const ringCars = this.cars.filter((c) => c.state === 'ring');
      for (const c of this.cars) {
        if (c.state === 'enter') {
          c.t += (c.v * dt) / 30;
          c.v = Math.min(VRING, c.v + ACC * dt);
          if (c.t >= 1) {
            c.state = 'ring';
            c.a = c.ringA;
            const exitA = norm(ARMS[c.dest].th - DELTA);
            let ex = exitA;
            while (ex <= c.a + 0.3) ex += Math.PI * 2;
            c.exitA = ex;
          }
        } else if (c.state === 'ring') {
          let target = VRING;
          let nearest = Infinity;
          let nv = 0;
          for (const o of ringCars) {
            if (o === c) continue;
            const da = norm(o.a - c.a);
            if (da > 0 && da < nearest) {
              nearest = da;
              nv = o.v;
            }
          }
          if (nearest < Math.PI) target = Math.min(target, K.followLimit(nearest * R - CL, nv, DEC, 8));
          c.v = K.approach(c.v, target, ACC, DEC * 2, dt);
          c.a += (c.v * dt) / R;
          if (c.a >= c.exitA) {
            c.state = 'exit';
            c.t = 0;
            c.from = [CX + Math.cos(c.a) * R, CY + Math.sin(c.a) * R];
            c.to = armPoint(c.dest, D0 + 10, -1);
          }
        } else if (c.state === 'exit') {
          c.t += (c.v * dt) / 34;
          if (c.t >= 1) {
            c.state = 'leave';
            c.d = D0 + 10;
            this.through++;
          }
        } else if (c.state === 'leave') {
          c.v = Math.min(VMAX, c.v + ACC * dt);
          c.d += c.v * dt;
        }
      }
      this.cars = this.cars.filter((c) => !(c.state === 'leave' && c.d > 520));
      // positions
      for (const c of this.cars) {
        let x, y, ang;
        if (c.state === 'approach') {
          [x, y] = armPoint(c.arm, c.d, 1);
          ang = ARMS[c.arm].th + Math.PI;
        } else if (c.state === 'enter' || c.state === 'exit') {
          x = c.from[0] + (c.to[0] - c.from[0]) * Math.min(1, c.t);
          y = c.from[1] + (c.to[1] - c.from[1]) * Math.min(1, c.t);
          ang = Math.atan2(c.to[1] - c.from[1], c.to[0] - c.from[0]);
        } else if (c.state === 'ring') {
          x = CX + Math.cos(c.a) * R;
          y = CY + Math.sin(c.a) * R;
          ang = c.a + Math.PI / 2;
        } else {
          [x, y] = armPoint(c.dest, c.d, -1);
          ang = ARMS[c.dest].th;
        }
        c.x = x;
        c.y = y;
        c.ang = ang;
      }
    }
    goals() {
      return [
        this.goal('jam', `No gridlock – no queue reaches ${MAX_Q} cars`, this.failedWith('JAM!') ? 'fail' : this.ended ? 'pass' : 'pending', `Queues: E ${this.queue('east')} · S ${this.queue('south')} · W ${this.queue('west')} · N ${this.queue('north')}`),
        this.goal('flow', `Get ${TARGET} cars round the roundabout`, this.through >= TARGET ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.through} / ${TARGET}`),
        this.goal('wait', `Nobody waits more than ${MAX_WAIT} s`, this.maxWait > MAX_WAIT ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Longest wait: ${Math.round(this.maxWait)} s`),
        this.goal('hold', `Bonus: never hold any road at red for more than ${MAX_HOLD} s in one go`, this.holdFail ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', 'Use a variable to count how long you’ve held it', false),
      ];
    }
    status() {
      const row = (a) => ({ label: `${a[0].toUpperCase() + a.slice(1)} lights`, value: this.dev[a].toUpperCase(), swatches: K.swatchesFor(this.dev[a]), note: `queue ${this.queue(a)}${this.dev[a] === 'red' ? ` · red ${this.redFor[a].toFixed(0)} s` : ''}` });
      return [row('east'), row('south'), row('west'), row('north'), { label: 'Cars through', value: `${this.through} / ${TARGET}` }];
    }
    buildBg(g, r) {
      K.grass(g, r, W, H);
      // arms
      g.fillStyle = '#d6d3cc';
      g.fillRect(0, CY - 58, W, 116);
      g.fillRect(CX - 58, 0, 116, H);
      K.asphalt(g, r, 0, CY - 44, W, 88);
      K.asphalt(g, r, CX - 44, 0, 88, H);
      g.fillStyle = '#d6d3cc';
      g.beginPath();
      g.arc(CX, CY, R + 46, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4b4f56';
      g.beginPath();
      g.arc(CX, CY, R + 32, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 600; i++) {
        const a = r() * Math.PI * 2;
        const rad = R - 30 + r() * 62;
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
        g.fillRect(CX + Math.cos(a) * rad, CY + Math.sin(a) * rad, 2, 2);
      }
      // island
      g.fillStyle = '#9e9a93';
      g.beginPath();
      g.arc(CX, CY, R - 28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#6aa84f';
      g.beginPath();
      g.arc(CX, CY, R - 32, 0, Math.PI * 2);
      g.fill();
      const flowers = ['#ff6b6b', '#ffd43b', '#f783ac', '#ffffff'];
      for (let i = 0; i < 40; i++) {
        const a = r() * Math.PI * 2;
        const rad = r() * (R - 40);
        g.fillStyle = flowers[i % 4];
        g.beginPath();
        g.arc(CX + Math.cos(a) * rad, CY + Math.sin(a) * rad, 2.5, 0, Math.PI * 2);
        g.fill();
      }
      K.drawTree(g, CX, CY, 22, r);
      // lane lines on arms, give-way lines, arrows
      for (const arm of Object.keys(ARMS)) {
        const th = ARMS[arm].th;
        const [ax, ay] = [CX + Math.cos(th) * (R + 34), CY + Math.sin(th) * (R + 34)];
        const [bx, by] = [CX + Math.cos(th) * 600, CY + Math.sin(th) * 600];
        K.dashedLine(g, ax, ay, bx, by, 20, 16, 3);
        const [p0x, p0y] = armPoint(arm, D0, 0.05);
        const [p1x, p1y] = armPoint(arm, D0, 1.9);
        K.dashedLine(g, p0x, p0y, p1x, p1y, 5, 4, 3);
      }
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = i * (Math.PI / 2) + Math.PI / 4;
        const x = CX + Math.cos(a) * R;
        const y = CY + Math.sin(a) * R;
        const t = a + Math.PI / 2;
        g.beginPath();
        g.moveTo(x - Math.cos(t) * 8, y - Math.sin(t) * 8);
        g.lineTo(x + Math.cos(t) * 8, y + Math.sin(t) * 8);
        g.lineTo(x + Math.cos(t) * 2 + Math.cos(a) * 5, y + Math.sin(t) * 2 + Math.sin(a) * 5);
        g.stroke();
      }
      const corners = [[40, 30], [640, 30], [40, 350], [640, 350]];
      corners.forEach(([x, y], i) => {
        K.drawHouse(g, x + 40, y + 20, 100, 66, ['#a5533a', '#546e7a', '#8d6e63', '#6d4c41'][i], '#e8dccb');
        K.drawTree(g, x + 200, y + 60, 16, r);
      });
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = '900 12px Nunito, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('BUSY ROAD ➜', W - 90, CY + 64);
    }
    draw(ctx) {
      this.drawBg(ctx);
      for (const c of this.cars) {
        if (c.x == null) continue;
        K.drawCar(ctx, c.x, c.y, c.ang, c.color, { braking: c.braking, len: CL, wid: CW });
      }
      const lamps = [];
      for (const arm of Object.keys(ARMS)) {
        const [x, y] = armPoint(arm, D0 + 26, 2.9);
        lamps.push(...K.drawSignal(ctx, x, y, this.dev[arm], arm.toUpperCase(), { scale: 0.8 }));
        // queue badge
        const q = this.queue(arm);
        const [bx, by] = armPoint(arm, D0 + 200, 1);
        if (q > 2) {
          ctx.fillStyle = q >= MAX_Q - 2 ? '#e03131' : '#f08c00';
          K.rr(ctx, bx - 16, by - 30, 32, 18, 9);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '900 11px Nunito, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(q), bx, by - 17);
        }
      }
      K.signalGlow(ctx, lamps);
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#86bf6b"/><rect y="58" width="240" height="24" fill="#4b4f56"/><rect x="108" width="24" height="140" fill="#4b4f56"/>
    <circle cx="120" cy="70" r="36" fill="#4b4f56"/><circle cx="120" cy="70" r="18" fill="#6aa84f"/>
    <rect x="146" y="44" width="11" height="20" rx="3" fill="#3f88c5" transform="rotate(40 151 54)"/>
    <rect x="96" y="86" width="11" height="20" rx="3" fill="#e94f37" transform="rotate(-40 101 96)"/>
    ${[0, 1, 2, 3].map((i) => `<rect x="${170 + i * 16}" y="72" width="13" height="8" rx="2" fill="#f6ae2d"/>`).join('')}
    <rect x="122" y="112" width="8" height="12" rx="2" fill="#44af69"/><rect x="122" y="126" width="8" height="12" rx="2" fill="#44af69"/>
    <text x="146" y="124" font-size="12" font-weight="900" fill="#e03131">5</text>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'roundabout',
    order: 2,
    title: 'Smart Roundabout',
    tagline: 'Use queue sensors and variables to stop one busy road hogging the roundabout.',
    difficulty: 'Advanced',
    concepts: ['Variables', 'Numbers & comparison', 'Counting', 'Fairness'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>Traffic goes <b>clockwise</b> round this roundabout, and drivers must give way to cars already going round.</p>
      <p>The <b>east</b> road is very busy. Its cars pour round past the <b>south</b> entrance, so south drivers never find a gap – and their queue grows and grows…</p>
      <p>Each entrance has <b>metering lights</b>. The number sensors <code>queue south</code>, <code>queue east</code> (etc.) tell you how many cars are waiting. Hold the busy road at red when another queue gets long – but not for too long!</p>
      <p><b>New: variables!</b> A variable is a named box that holds a number: <code>set held to 0</code>, <code>change held by 1</code>, <code>if held > 10:</code>. Its value shows in the Live status panel.</p>`,
    devices: Object.fromEntries(['north', 'east', 'south', 'west'].map((d) => [d, {
      label: `${d} lights`, aliases: [`${d} light`, `${d} lights`], states: ['green', 'amber', 'red'],
      stateAliases: { yellow: 'amber', orange: 'amber' }, stateColors: { red: '#ff3b30', amber: '#ffb000', green: '#2fd158' },
      describe: `Metering lights for drivers joining from the ${d}.`,
    }])),
    sensors: {
      'queue north': { type: 'number', desc: 'Number of cars queuing on the north road.' },
      'queue east': { type: 'number', desc: 'Number of cars queuing on the east road.' },
      'queue south': { type: 'number', desc: 'Number of cars queuing on the south road.' },
      'queue west': { type: 'number', desc: 'Number of cars queuing on the west road.' },
      'cars on roundabout': { type: 'number', desc: 'Number of cars going round the roundabout right now.' },
    },
    snippets: { set: 'set east red', sensor: 'queue south > 3' },
    starter: `# The east road is so busy that drivers on the
# south road can never get on. This program holds
# the east traffic when the south queue gets long...
# but it never lets the east go again!

forever:
    if queue south > 3:
        set east red
    wait 1
`,
    solution: `# "held" counts how many seconds east has been red
set held to 0
forever:
    # hold east while south is busy - but not too long,
    # and not if the east queue is getting long too
    if queue south > 2 and held < 12 and queue east < 7:
        set east red
        change held by 1
        wait 1
    else:
        set east green
        if held > 0:
            # give the east road a fair turn
            set held to 0
            wait 4
        wait 1
`,
    hints: [
      'The starter never sets east back to green. Add an "else:" that does.',
      'Now east might flick red/green every second. Use a variable to count how long you have held it: "set held to 0" before the loop, "change held by 1" each second it is red.',
      'Only hold east while "held < 12" (and while "queue east < 7"). When you let it go, reset held to 0 and give east a few seconds of green.',
    ],
    create: () => new RoundaboutSim(),
  });
})();
