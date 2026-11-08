/* Crossroads: four sets of traffic lights, turning traffic, right-turners giving way. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const X0 = 400, X1 = 500, Y0 = 210, Y1 = 310, CX = 450, CY = 260;
  const CL = 40, CW = 20;
  const VMAX = 95, VTURN = 55, ACC = 75, DEC = 200;
  const DURATION = 120;
  const TARGET = 25;
  const BONUS = 45;
  const MAX_WAIT = 75;
  const NEXT = { red: 'red amber', 'red amber': 'green', green: 'amber', amber: 'red' };
  const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
  const CROSS = { north: ['east', 'west'], south: ['east', 'west'], east: ['north', 'south'], west: ['north', 'south'] };

  function arcPts(cx, cy, p0, p1, n) {
    const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
    let a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d <= -Math.PI) d += Math.PI * 2;
    const r = Math.hypot(p0[0] - cx, p0[1] - cy);
    const out = [];
    for (let i = 1; i <= n; i++) out.push([cx + Math.cos(a0 + (d * i) / n) * r, cy + Math.sin(a0 + (d * i) / n) * r]);
    return out;
  }
  // [spawn, box edge, {straight, left, right}]
  const APPROACH = {
    west: { spawn: [-40, 235], edge: [X0, 235], routes: { straight: [[X1, 235], [W + 40, 235]], left: [...arcPts(X0, Y0, [X0, 235], [425, Y0], 6), [425, -40]], right: [...arcPts(X0, Y1, [X0, 235], [475, Y1], 10), [475, H + 40]] } },
    east: { spawn: [W + 40, 285], edge: [X1, 285], routes: { straight: [[X0, 285], [-40, 285]], left: [...arcPts(X1, Y1, [X1, 285], [475, Y1], 6), [475, H + 40]], right: [...arcPts(X1, Y0, [X1, 285], [425, Y0], 10), [425, -40]] } },
    north: { spawn: [475, -40], edge: [475, Y0], routes: { straight: [[475, Y1], [475, H + 40]], left: [...arcPts(X1, Y0, [475, Y0], [X1, 235], 6), [W + 40, 235]], right: [...arcPts(X0, Y0, [475, Y0], [X0, 285], 10), [-40, 285]] } },
    south: { spawn: [425, H + 40], edge: [425, Y1], routes: { straight: [[425, Y0], [425, -40]], left: [...arcPts(X0, Y1, [425, Y1], [X0, 285], 6), [-40, 285]], right: [...arcPts(X1, Y1, [425, Y1], [X1, 235], 10), [W + 40, 235]] } },
  };
  function buildPath(from, route) {
    const a = APPROACH[from];
    const pts = [a.spawn, a.edge, ...a.routes[route]];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const edgeS = cum[1];
    const exitS = cum[pts.length - 2];
    return { pts, cum, edgeS, exitS, len: cum[cum.length - 1] };
  }
  function posAt(p, s) {
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const s0 = p.cum[i - 1];
    const seg = p.cum[i] - s0 || 1;
    const f = Math.max(0, Math.min(1, (s - s0) / seg));
    const [x0, y0] = p.pts[i - 1];
    const [x1, y1] = p.pts[i];
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, ang: Math.atan2(y1 - y0, x1 - x0) };
  }

  class CrossroadsSim extends K.BaseSim {
    get seed() {
      return 4321;
    }
    initialDevices() {
      return { north: 'red', south: 'red', east: 'red', west: 'red' };
    }
    init() {
      this.duration = DURATION;
      this.cars = [];
      this.spawn = { north: 1, south: 2, east: 0.3, west: 1.5 };
      this.through = 0;
      this.maxWait = 0;
      this.lastConflict = -100;
      this.seqFail = false;
      const waiting = (d) => () => this.cars.some((c) => c.from === d && !c.passed && c.path.edgeS - c.s < 130);
      const queue = (d) => () => this.cars.filter((c) => c.from === d && !c.passed && c.path.edgeS - c.s < 260).length;
      this.sensorFns = {
        'car waiting north': waiting('north'), 'car waiting south': waiting('south'), 'car waiting east': waiting('east'), 'car waiting west': waiting('west'),
        'queue north': queue('north'), 'queue south': queue('south'), 'queue east': queue('east'), 'queue west': queue('west'),
        'junction clear': () => !this.cars.some((c) => this.inBox(c)),
      };
    }
    onSet(n, s, prev) {
      if (NEXT[prev] !== s) this.seqFail = true;
    }
    inBox(c) {
      return c.passed && c.s < c.path.exitS + CL / 2;
    }
    go(s) {
      return s === 'green' || s === 'amber';
    }
    step(dt) {
      for (const d of ['north', 'south']) for (const e of ['east', 'west']) if (this.go(this.dev[d]) && this.go(this.dev[e])) this.lastConflict = this.t;
      // spawn
      const rate = { north: [3.2, 4], south: [3.2, 4], east: [2.6, 3.4], west: [2.6, 3.4] };
      for (const d of Object.keys(this.spawn)) {
        this.spawn[d] -= dt;
        if (this.spawn[d] > 0) continue;
        const last = this.cars.filter((c) => c.from === d).sort((a, b) => a.s - b.s)[0];
        if (last && last.s < CL + 14) {
          this.spawn[d] = 0.5;
          continue;
        }
        const r = this.rng();
        const route = r < 0.64 ? 'straight' : r < 0.89 ? 'left' : 'right';
        const path = buildPath(d, route);
        this.cars.push({ id: ++this.nid, from: d, route, path, s: 0, v: VMAX * 0.9, color: K.pick(this.rng, K.CAR_COLORS), passed: false, wait: 0, amber: null, ...posAt(path, 0) });
        this.spawn[d] = rate[d][0] + this.rng() * rate[d][1];
      }

      for (const c of this.cars) {
        const p = c.path;
        const stopS = p.edgeS - 8;
        const dist = stopS - (c.s + CL / 2);
        let target = VMAX;
        if (c.passed && c.s < p.exitS && c.route !== 'straight') target = VTURN;
        if (!c.passed) {
          const L = this.dev[c.from];
          if (dist < -0.5) {
            c.passed = true;
            if (L === 'red' || L === 'red amber') c.ranRed = true;
          } else {
            let stop = L === 'red' || L === 'red amber';
            if (L === 'amber') {
              if (c.amber == null) c.amber = (c.v * c.v) / (2 * DEC) < dist - 1 || c.v < 25 ? 'stop' : 'go';
              stop = c.amber === 'stop';
            } else c.amber = null;
            if (stop) target = Math.min(target, K.stopLimit(dist, DEC));
            if (dist < 60) target = Math.min(target, c.route === 'straight' ? VMAX : VTURN + 10);
          }
        }
        // right turners give way to oncoming traffic
        // right turners edge into the junction and wait for a gap in oncoming traffic
        const WAIT_IN = 6;
        const front = c.s + CL / 2;
        if (c.route === 'right' && front < p.edgeS + WAIT_IN + 1 && (c.passed || dist < 40)) {
          const danger = this.cars.some((o) => {
            if (o.from !== OPP[c.from] || o.s >= o.path.exitS) return false;
            const oFront = o.s + CL / 2;
            const oWait = o.path.edgeS + WAIT_IN;
            if (o.route !== 'right') {
              const oDist = o.path.edgeS - 8 - oFront;
              return (o.passed && o.v > 5) || (oDist < 190 && o.v > 20) || (oDist < 70 && this.go(this.dev[o.from]));
            }
            // opposite right turner: whoever got there first goes first
            return oFront > oWait + 1 || (o.id < c.id && Math.abs(oFront - oWait) < 3);
          });
          c.yielding = danger;
          if (danger) target = Math.min(target, K.stopLimit(p.edgeS + WAIT_IN - front, DEC * 1.5));
        } else c.yielding = false;
        // don't drive into a right-turner that is crossing in front of us
        if (c.route !== 'right' && front < p.edgeS + 4) {
          const [ex, ey] = APPROACH[c.from].edge;
          const blocking = this.cars.some((o) => o.from === OPP[c.from] && o.route === 'right' && o.passed && o.s < o.path.exitS + CL / 2 && Math.hypot(o.x - ex, o.y - ey) < 55);
          if (blocking) target = Math.min(target, K.stopLimit(p.edgeS - 2 - front, DEC * 1.5));
        }
        // follow vehicles ahead heading the same way
        const ca = Math.cos(c.ang);
        const sa = Math.sin(c.ang);
        for (const o of this.cars) {
          if (o === c) continue;
          let da = Math.abs(o.ang - c.ang);
          if (da > Math.PI) da = Math.PI * 2 - da;
          if (da > 0.7) continue;
          const dx = o.x - c.x;
          const dy = o.y - c.y;
          const along = dx * ca + dy * sa;
          const lat = Math.abs(-dx * sa + dy * ca);
          if (along > 0 && along < 120 && lat < 11) target = Math.min(target, K.followLimit(along - CL, o.v, DEC, 10));
        }
        c.braking = target < c.v - 2;
        c.v = K.approach(c.v, target, ACC, DEC * 2.2, dt);
        c.s += c.v * dt;
        Object.assign(c, posAt(p, c.s));
        if (!c.passed && c.v < 4) {
          c.wait += dt;
          this.maxWait = Math.max(this.maxWait, c.wait);
        }
        if (!c.counted && c.s > p.exitS + CL) {
          c.counted = true;
          this.through++;
        }
      }
      this.cars = this.cars.filter((c) => c.s < c.path.len);

      // collisions in the junction
      const near = this.cars.filter((c) => Math.abs(c.x - CX) < 90 && Math.abs(c.y - CY) < 90);
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const a = near[i];
          const b = near[j];
          if (a.from === b.from) continue;
          const pa = [-CL / 4, CL / 4].map((o) => [a.x + Math.cos(a.ang) * o, a.y + Math.sin(a.ang) * o]);
          const pb = [-CL / 4, CL / 4].map((o) => [b.x + Math.cos(b.ang) * o, b.y + Math.sin(b.ang) * o]);
          for (const [ax, ay] of pa) {
            for (const [bx, by] of pb) {
              if (Math.hypot(ax - bx, ay - by) < CW - 1) {
                a.v = b.v = 0;
                this.hitCars = [a, b];
                this.fail((ax + bx) / 2, (ay + by) / 2, this.diagnose(a, b));
                return;
              }
            }
          }
        }
      }
    }
    diagnose(a, b) {
      const base = { label: 'CRASH!', icon: '💥', title: 'Crash in the junction!' };
      if (a.ranRed || b.ranRed) return { ...base, text: 'A light went straight from green to red, so a driver right at the line couldn’t stop and drove into the junction.', tip: 'Always show amber (for about 3 seconds) between green and red.' };
      if (this.t - this.lastConflict < 6) return { ...base, text: 'Roads that cross each other had green lights at the same time (for example north and east).', tip: 'Only give green to roads that don’t cross: north + south together, OR east + west together.' };
      return { ...base, text: 'Cars were still in the middle of the junction when the crossing road got a green light.', tip: 'After turning lights red, "wait until junction clear" before giving the next road green.' };
    }
    goals() {
      return [
        this.goal('safe', 'No crashes in the junction', this.safeStatus(), 'Never give crossing roads green together'),
        this.goal('flow', `Get ${TARGET} cars through the junction`, this.through >= TARGET ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.through} / ${TARGET}`),
        this.goal('wait', `Nobody waits more than ${MAX_WAIT} s`, this.maxWait > MAX_WAIT ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Longest wait: ${Math.round(this.maxWait)} s`),
        this.goal('super', `Bonus: super-flow – ${BONUS} cars through`, this.through >= BONUS && !this.crash ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', 'Let opposite roads go together', false),
      ];
    }
    status() {
      const row = (d) => ({ label: `${d[0].toUpperCase() + d.slice(1)} lights`, value: this.dev[d].toUpperCase(), swatches: K.swatchesFor(this.dev[d]), note: `queue ${this.readSensor('queue ' + d)}` });
      return [row('north'), row('south'), row('east'), row('west'), { label: 'Cars through', value: `${this.through} / ${TARGET}`, note: this.readSensor('junction clear') ? 'junction clear ✓' : '' }];
    }
    buildBg(g, r) {
      K.grass(g, r, W, H);
      // pavements
      g.fillStyle = '#d6d3cc';
      g.fillRect(0, Y0 - 16, W, Y1 - Y0 + 32);
      g.fillRect(X0 - 16, 0, X1 - X0 + 32, H);
      K.asphalt(g, r, 0, Y0, W, Y1 - Y0);
      K.asphalt(g, r, X0, 0, X1 - X0, H);
      // corner buildings and trees
      const corners = [[30, 20, 330, 150], [540, 20, 330, 150], [30, 350, 330, 150], [540, 350, 330, 150]];
      corners.forEach(([x, y, w, h], i) => {
        K.drawHouse(g, x + 30, y + 20, 110, 70, ['#a5533a', '#546e7a', '#8d6e63', '#6d4c41'][i], '#e8dccb');
        K.drawTree(g, x + 220, y + 50, 18, r);
        K.drawTree(g, x + 280, y + 100, 14, r);
      });
      // markings
      g.fillStyle = '#f2f2f2';
      for (let x = 0; x < X0 - 30; x += 40) g.fillRect(x, CY - 1.5, 22, 3);
      for (let x = X1 + 30; x < W; x += 40) g.fillRect(x, CY - 1.5, 22, 3);
      for (let y = 0; y < Y0 - 30; y += 40) g.fillRect(CX - 1.5, y, 3, 22);
      for (let y = Y1 + 30; y < H; y += 40) g.fillRect(CX - 1.5, y, 3, 22);
      g.fillRect(X0 - 30, CY - 1.5, 30, 3);
      g.fillRect(X1, CY - 1.5, 30, 3);
      g.fillRect(CX - 1.5, Y0 - 30, 3, 30);
      g.fillRect(CX - 1.5, Y1, 3, 30);
      // stop lines
      g.fillRect(X0 - 8, Y0 + 2, 4, CY - Y0 - 2);
      g.fillRect(X1 + 4, CY, 4, Y1 - CY - 2);
      g.fillRect(CX, Y0 - 8, X1 - CX - 2, 4);
      g.fillRect(X0 + 2, Y1 + 4, CX - X0 - 2, 4);
      // box junction
      g.strokeStyle = 'rgba(255,212,59,0.7)';
      g.lineWidth = 2;
      g.strokeRect(X0 + 3, Y0 + 3, X1 - X0 - 6, Y1 - Y0 - 6);
      for (let k = -100; k < 100; k += 22) {
        g.beginPath();
        g.moveTo(Math.max(X0 + 3, X0 + 3 + k), Math.max(Y0 + 3, Y0 + 3 - k));
        g.lineTo(Math.min(X1 - 3, X1 - 3 + k), Math.min(Y1 - 3, Y1 - 3 - k));
        g.stroke();
      }
    }
    draw(ctx) {
      this.drawBg(ctx);
      for (const c of this.cars) {
        let ang = c.ang;
        if (this.crash && this.hitCars && this.hitCars.includes(c)) ang += Math.min(0.5, this.crash.age);
        K.drawCar(ctx, c.x, c.y, ang, c.color, { braking: c.braking, len: CL, wid: CW });
        if (c.route !== 'straight' && !c.counted) {
          // indicator
          const blink = Math.floor(this.t * 3 + c.id) % 2 === 0;
          if (blink) {
            const side = c.route === 'left' ? -1 : 1;
            ctx.fillStyle = '#ffa94d';
            ctx.beginPath();
            ctx.arc(c.x + Math.cos(c.ang) * (CL / 2 - 2) - Math.sin(c.ang) * side * (CW / 2), c.y + Math.sin(c.ang) * (CL / 2 - 2) + Math.cos(c.ang) * side * (CW / 2), 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      const lamps = [
        ...K.drawSignal(ctx, X0 - 24, Y0 - 30, this.dev.west, 'WEST', { scale: 0.85 }),
        ...K.drawSignal(ctx, X1 + 24, Y1 + 36, this.dev.east, 'EAST', { scale: 0.85 }),
        ...K.drawSignal(ctx, X1 + 26, Y0 - 30, this.dev.north, 'NORTH', { scale: 0.85 }),
        ...K.drawSignal(ctx, X0 - 26, Y1 + 36, this.dev.south, 'SOUTH', { scale: 0.85 }),
      ];
      K.signalGlow(ctx, lamps);
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#86bf6b"/><rect y="52" width="240" height="36" fill="#4b4f56"/><rect x="102" width="36" height="140" fill="#4b4f56"/>
    <rect x="104" y="54" width="32" height="32" fill="none" stroke="#ffd43b" stroke-width="1.5"/>
    <rect x="40" y="55" width="24" height="11" rx="3" fill="#3f88c5"/><rect x="170" y="74" width="24" height="11" rx="3" fill="#e94f37"/>
    <rect x="125" y="14" width="11" height="22" rx="3" fill="#f6ae2d"/><rect x="104" y="104" width="11" height="22" rx="3" fill="#44af69"/>
    ${[[88, 34], [146, 92], [148, 30], [84, 96]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="8" height="16" rx="2" fill="#1c1f24"/><circle cx="${x + 4}" cy="${y + 4}" r="2.2" fill="${i < 2 ? '#2fd158' : '#ff3b30'}"/>`).join('')}
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'crossroads',
    order: 1,
    title: 'Crossroads Junction',
    tagline: 'Run a four-way junction: phases, turning traffic, and keeping crossing roads apart.',
    difficulty: 'Advanced',
    concepts: ['State machines', 'Phases', 'Many devices', 'Clearance timing'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>Four roads meet at a busy crossroads. Each road has its own lights: <code>north</code>, <code>south</code>, <code>east</code>, <code>west</code> (named after where the traffic comes <b>from</b>).</p>
      <p>Roads that <b>cross</b> must never be green together. But <b>opposite</b> roads (north + south, or east + west) can go at the same time – drivers turning right will wait for a gap in oncoming traffic.</p>
      <p>Think of the junction as being in one <b>phase</b> at a time, with a safe changeover in between: amber, red, and wait until the junction is clear.</p>
      <p>Sensors include <code>junction clear</code>, <code>car waiting north</code>… and numbers like <code>queue east</code>.</p>`,
    devices: Object.fromEntries(['north', 'south', 'east', 'west'].map((d) => [d, {
      label: `${d} lights`, aliases: [`${d} light`, `${d} lights`], states: ['red', 'red amber', 'amber', 'green'],
      stateAliases: { yellow: 'amber', orange: 'amber', 'red yellow': 'red amber', 'amber red': 'red amber' },
      stateColors: { red: '#ff3b30', amber: '#ffb000', green: '#2fd158' }, describe: `Lights for traffic coming from the ${d}.`,
    }])),
    sensors: {
      'junction clear': 'True when no car is in the middle of the junction.',
      'car waiting north': 'True when a car is waiting at the north lights.',
      'car waiting south': 'True when a car is waiting at the south lights.',
      'car waiting east': 'True when a car is waiting at the east lights.',
      'car waiting west': 'True when a car is waiting at the west lights.',
      'queue north': { type: 'number', desc: 'How many cars are queuing at the north lights.' },
      'queue south': { type: 'number', desc: 'How many cars are queuing at the south lights.' },
      'queue east': { type: 'number', desc: 'How many cars are queuing at the east lights.' },
      'queue west': { type: 'number', desc: 'How many cars are queuing at the west lights.' },
    },
    snippets: { set: 'set north green', sensor: 'junction clear' },
    starter: `# North + south go together, then east + west.
# But the changeover is too sudden... Press Run!

forever:
    set north green
    set south green
    wait 8
    set north red
    set south red
    set east green
    set west green
    wait 8
    set east red
    set west red
`,
    solution: `# Two phases: north+south, then east+west
forever:
    # --- Phase 1: north and south ---
    set north red amber
    set south red amber
    wait 2
    set north green
    set south green
    wait 10
    set north amber
    set south amber
    wait 3
    set north red
    set south red
    wait until junction clear
    wait 1

    # --- Phase 2: east and west ---
    set east red amber
    set west red amber
    wait 2
    set east green
    set west green
    wait 10
    set east amber
    set west amber
    wait 3
    set east red
    set west red
    wait until junction clear
    wait 1
`,
    hints: [
      'Each changeover needs: amber (3 s), then red, then a pause while the junction empties.',
      'Use "wait until junction clear" after turning a pair of lights red – right-turners may still be finishing their turn.',
      'Keep north+south together and east+west together – that gets the most cars through (bonus!).',
      'Advanced: use "if queue east > 4:" to give a busy road a longer green.',
    ],
    create: () => new CrossroadsSim(),
  });
})();
