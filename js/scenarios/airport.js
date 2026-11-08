/* Airport: one runway shared by landings and take-offs. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const RY = 220; // runway centre line
  const RX0 = 90, RX1 = 830;
  const TD = 170; // touchdown point
  const TWY = 332; // taxiway
  const HOLD = [140, 292];
  const EXIT_X = 690;
  const STACK = [120, 90];
  const DURATION = 120;
  const ARRIVALS = [2, 12, 24, 37, 50, 63, 76, 90];
  const DEPARTURES = [9, 21, 34, 47, 60, 73, 86];
  const NEED_LAND = 6, NEED_DEP = 5;
  const COLORS = ['#f1f3f5', '#ffe066', '#a5d8ff', '#ffc9c9', '#d3f9d8'];

  function lerp(a, b, f) {
    return a + (b - a) * f;
  }

  class AirportSim extends K.BaseSim {
    get seed() {
      return 7373;
    }
    initialDevices() {
      return { approach: 'hold', 'stop bar': 'on' };
    }
    init() {
      this.duration = DURATION;
      this.planes = [];
      this.ai = 0;
      this.di = 0;
      this.lastRelease = -100;
      this.landed = 0;
      this.departed = 0;
      this.maxDepWait = 0;
      this.sensorFns = {
        'plane waiting to land': () => this.planes.some((p) => p.kind === 'arr' && p.state === 'stack'),
        'plane landing': () => this.planes.some((p) => p.kind === 'arr' && (p.state === 'final' || p.state === 'roll')),
        'plane waiting to depart': () => this.planes.some((p) => p.kind === 'dep' && p.state === 'hold'),
        'plane taking off': () => this.planes.some((p) => p.kind === 'dep' && (p.state === 'lineup' || p.state === 'takeoff')),
        'runway clear': () => !this.planes.some((p) => this.onRunway(p)),
        'lowest fuel': () => {
          const f = this.planes.filter((p) => p.state === 'stack').map((p) => p.fuel);
          return f.length ? Math.floor(Math.min(...f)) : 99;
        },
        'planes waiting to land': () => this.planes.filter((p) => p.state === 'stack').length,
      };
    }
    onRunway(p) {
      return (p.kind === 'arr' && (p.state === 'final' || p.state === 'roll')) || (p.kind === 'dep' && (p.state === 'lineup' || p.state === 'takeoff'));
    }
    step(dt) {
      if (this.ai < ARRIVALS.length && this.t >= ARRIVALS[this.ai]) {
        this.ai++;
        this.planes.push({ kind: 'arr', state: 'stack', fuel: 45 + this.rng() * 15, a: this.rng() * 6, color: K.pick(this.rng, COLORS), id: ++this.nid });
      }
      if (this.di < DEPARTURES.length && this.t >= DEPARTURES[this.di]) {
        this.di++;
        this.planes.push({ kind: 'dep', state: 'taxiOut', path: [[300 + this.di * 30, 470], [300 + this.di * 30, TWY], [HOLD[0], TWY], HOLD], pi: 1, x: 300 + this.di * 30, y: 470, ang: -Math.PI / 2, wait: 0, color: K.pick(this.rng, COLORS), id: ++this.nid });
      }
      // release next lander
      if (this.dev.approach === 'land' && this.t - this.lastRelease > 8) {
        const p = this.planes.find((q) => q.state === 'stack');
        if (p) {
          p.state = 'final';
          p.f = 0;
          this.lastRelease = this.t;
        }
      }
      for (const p of this.planes) {
        if (p.state === 'stack') {
          p.fuel -= dt;
          p.a += dt * 0.9;
          if (p.fuel <= 0) {
            this.fail(STACK[0], STACK[1], { label: 'MAYDAY!', icon: '⛽', title: 'A plane ran out of fuel!', text: 'A plane circled in the holding pattern for so long that it ran out of fuel.', tip: 'Let planes land! When "plane waiting to land", wait until the runway is clear, then "set approach land".' });
            return;
          }
          p.x = STACK[0] + Math.cos(p.a) * 60;
          p.y = STACK[1] + Math.sin(p.a) * 26;
          p.ang = p.a + Math.PI / 2;
          p.sc = 0.75;
        } else if (p.state === 'final') {
          p.f += dt / 4;
          const f = Math.min(1, p.f);
          p.x = lerp(-60, TD, f);
          p.y = lerp(110, RY, f);
          p.ang = Math.atan2(RY - 110, TD + 60) * (1 - f);
          p.sc = lerp(1.35, 1, f);
          if (p.f >= 1) {
            p.state = 'roll';
            p.v = 190;
          }
        } else if (p.state === 'roll') {
          p.v = Math.max(45, p.v - 45 * dt);
          p.x += p.v * dt;
          p.ang = 0;
          p.sc = 1;
          if (p.x >= EXIT_X) {
            p.state = 'taxiIn';
            p.path = [[EXIT_X, TWY], [520, TWY], [520, 480]];
            p.pi = 0;
            this.landed++;
          }
        } else if (p.state === 'taxiIn' || p.state === 'taxiOut' || p.state === 'lineup') {
          const [tx, ty] = p.path[p.pi];
          const dx = tx - p.x;
          const dy = ty - p.y;
          const d = Math.hypot(dx, dy);
          const sp = (p.state === 'lineup' ? 40 : 60) * dt;
          if (d > 0.5) p.ang = Math.atan2(dy, dx);
          p.sc = 0.9;
          // don't run into the plane ahead at the hold
          if (p.state === 'taxiOut') {
            const ahead = this.planes.find((o) => o !== p && o.kind === 'dep' && (o.state === 'hold' || o.state === 'taxiOut') && o.pi >= p.pi && o.id < p.id && Math.hypot(o.x - p.x, o.y - p.y) < 70);
            if (ahead) continue;
          }
          if (d <= sp) {
            p.x = tx;
            p.y = ty;
            p.pi++;
            if (p.pi >= p.path.length) {
              if (p.state === 'taxiOut') {
                p.state = 'hold';
                p.ang = -Math.PI / 2;
              } else if (p.state === 'lineup') {
                p.state = 'takeoff';
                p.v = 0;
                p.ang = 0;
              } else p.gone = true;
            }
          } else {
            p.x += (dx / d) * sp;
            p.y += (dy / d) * sp;
          }
        } else if (p.state === 'hold') {
          p.wait += dt;
          this.maxDepWait = Math.max(this.maxDepWait, p.wait);
          if (this.dev['stop bar'] === 'off') {
            p.state = 'lineup';
            p.path = [[HOLD[0], RY], [HOLD[0] + 30, RY]];
            p.pi = 0;
          }
        } else if (p.state === 'takeoff') {
          p.v += 60 * dt;
          p.x += p.v * dt;
          p.ang = 0;
          p.sc = p.x > 600 ? 1 + (p.x - 600) / 250 : 1;
          p.alt = Math.max(0, p.x - 600);
          if (p.x > 640 && !p.counted) {
            p.counted = true;
            p.state = 'climb';
            this.departed++;
          }
        } else if (p.state === 'climb') {
          p.v += 40 * dt;
          p.x += p.v * dt;
          p.y -= 30 * dt;
          p.sc = 1 + (p.x - 600) / 250;
          p.alt = p.x - 600;
          if (p.x > W + 100) p.gone = true;
        }
      }
      this.planes = this.planes.filter((p) => !p.gone);
      // runway collisions
      const onRw = this.planes.filter((p) => (p.state === 'roll' || p.state === 'takeoff' || p.state === 'lineup' || (p.state === 'final' && p.f > 0.9)) && Math.abs(p.y - RY) < 20);
      for (let i = 0; i < onRw.length; i++) {
        for (let j = i + 1; j < onRw.length; j++) {
          if (Math.abs(onRw[i].x - onRw[j].x) < 58) {
            const a = onRw[i];
            const b = onRw[j];
            this.fail((a.x + b.x) / 2, RY, { label: 'CRASH!', icon: '✈️', title: 'Runway collision!', text: a.kind !== b.kind ? 'A plane was landing while another was taking off – on the same runway at the same time!' : 'Two planes were on the runway together.', tip: 'Only one plane may use the runway at a time. Before clearing a plane, "wait until runway clear" – and keep the stop bar ON while a plane is landing.' });
            return;
          }
        }
      }
    }
    goals() {
      return [
        this.goal('safe', 'No runway collisions', this.failedWith('CRASH!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', 'One plane on the runway at a time'),
        this.goal('fuel', 'No plane runs out of fuel', this.failedWith('MAYDAY!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Lowest fuel: ${this.readSensor('lowest fuel') === 99 ? '–' : this.readSensor('lowest fuel') + ' s'}`),
        this.goal('land', `Land ${NEED_LAND} planes`, this.landed >= NEED_LAND ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.landed} / ${NEED_LAND} landed`),
        this.goal('dep', `${NEED_DEP} planes take off`, this.departed >= NEED_DEP ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.departed} / ${NEED_DEP} departed`),
        this.goal('wait', 'Bonus: no departing plane waits more than 30 s', this.maxDepWait > 30 ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Longest wait at the stop bar: ${Math.round(this.maxDepWait)} s`, false),
      ];
    }
    status() {
      return [
        { label: 'Approach', value: this.dev.approach.toUpperCase(), swatch: this.dev.approach === 'land' ? '#2fd158' : '#ffb000' },
        { label: 'Stop bar', value: this.dev['stop bar'].toUpperCase(), swatch: this.dev['stop bar'] === 'on' ? '#ff3b30' : '#2fd158' },
        { label: 'Waiting to land', value: String(this.readSensor('planes waiting to land')), note: this.readSensor('planes waiting to land') ? `lowest fuel ${this.readSensor('lowest fuel')} s` : '' },
        { label: 'Sensor: runway clear', value: this.readSensor('runway clear') ? 'TRUE' : 'FALSE' },
        { label: 'Landed · departed', value: `${this.landed} · ${this.departed}` },
      ];
    }
    buildBg(g, r) {
      K.grass(g, r, W, H, '#8fbf6f');
      // runway
      g.fillStyle = '#3d4148';
      g.fillRect(RX0, RY - 24, RX1 - RX0, 48);
      g.fillStyle = '#f2f2f2';
      for (let x = RX0 + 60; x < RX1 - 40; x += 46) g.fillRect(x, RY - 1.5, 26, 3);
      for (let i = 0; i < 6; i++) {
        g.fillRect(RX0 + 8, RY - 20 + i * 7, 26, 4);
        g.fillRect(RX1 - 34, RY - 20 + i * 7, 26, 4);
      }
      g.fillRect(TD - 6, RY - 18, 30, 8);
      g.fillRect(TD - 6, RY + 10, 30, 8);
      g.font = '900 16px Nunito, system-ui, sans-serif';
      g.save();
      g.translate(RX0 + 50, RY);
      g.rotate(Math.PI / 2);
      g.textAlign = 'center';
      g.fillText('09', 0, 6);
      g.restore();
      // taxiways
      g.fillStyle = '#5b5f66';
      g.fillRect(HOLD[0] - 14, TWY - 14, 720 - HOLD[0] + 28, 28);
      g.fillRect(HOLD[0] - 14, RY + 20, 28, TWY - RY - 20);
      g.fillRect(EXIT_X - 14, RY + 20, 28, TWY - RY - 20);
      g.fillRect(506, TWY, 28, 150);
      g.fillRect(300, TWY, 28 * 9, 150);
      g.strokeStyle = '#ffd43b';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(HOLD[0], TWY);
      g.lineTo(720, TWY);
      g.moveTo(HOLD[0], TWY);
      g.lineTo(HOLD[0], RY);
      g.moveTo(EXIT_X, RY);
      g.lineTo(EXIT_X, TWY);
      g.stroke();
      // holding position marking
      g.fillStyle = '#ffd43b';
      g.fillRect(HOLD[0] - 14, HOLD[1] - 12, 28, 2);
      g.fillRect(HOLD[0] - 14, HOLD[1] - 8, 28, 2);
      // terminal
      g.fillStyle = '#ced4da';
      g.fillRect(260, 470, 420, 50);
      g.fillStyle = '#adb5bd';
      g.fillRect(260, 470, 420, 8);
      g.fillStyle = '#495057';
      g.font = '900 14px Nunito, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('TERMINAL', 470, 505);
      // tower
      g.fillStyle = '#868e96';
      g.fillRect(760, 380, 30, 30);
      g.fillStyle = '#74c0fc';
      g.beginPath();
      g.arc(775, 395, 18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#343a40';
      g.beginPath();
      g.arc(775, 395, 10, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 10; i++) K.drawTree(g, 20 + r() * 860, i < 5 ? 20 + r() * 60 : 400 + r() * 100, 12 + r() * 5, r);
      // holding pattern ring
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.setLineDash([6, 6]);
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(STACK[0], STACK[1], 60, 26, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = '800 11px Nunito, system-ui, sans-serif';
      g.fillText('HOLDING', STACK[0], STACK[1] + 44);
    }
    draw(ctx) {
      this.drawBg(ctx);
      // stop bar
      const on = this.dev['stop bar'] === 'on';
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = on ? '#ff3b30' : '#2fd158';
        ctx.beginPath();
        ctx.arc(HOLD[0] - 12 + i * 6, HOLD[1] - 18, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      K.glow(ctx, HOLD[0], HOLD[1] - 18, 22, on ? '255,60,40' : '40,220,90', 0.6);
      ctx.restore();
      // approach lights (runway threshold)
      const land = this.dev.approach === 'land';
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = land ? '#fff3bf' : '#495057';
        ctx.beginPath();
        ctx.arc(RX0 - 12 - i * 14, RY, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const order = this.planes.slice().sort((a, b) => (a.alt || 0) + (a.state === 'final' || a.state === 'stack' ? 1000 : 0) - ((b.alt || 0) + (b.state === 'final' || b.state === 'stack' ? 1000 : 0)));
      for (const p of order) {
        if (p.x == null) continue;
        const air = p.state === 'stack' || p.state === 'final' || p.state === 'climb' || (p.alt || 0) > 0;
        if (air) {
          // shadow on the ground
          const off = p.state === 'stack' ? 40 : p.state === 'final' ? 30 * (1 - Math.min(1, p.f)) : Math.min(40, (p.alt || 0) / 6);
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.translate(p.x + off, p.y + off);
          ctx.rotate(p.ang);
          ctx.scale(p.sc * 0.9, p.sc * 0.9);
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.ellipse(0, 0, 30, 6, 0, 0, Math.PI * 2);
          ctx.ellipse(-4, 0, 6, 28, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        K.drawPlane(ctx, p.x, p.y, p.ang, p.sc * 0.8, p.color);
        if (p.state === 'stack') {
          ctx.fillStyle = p.fuel < 15 ? '#e03131' : 'rgba(0,0,0,0.6)';
          K.rr(ctx, p.x - 16, p.y - 30, 32, 14, 7);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '800 10px Nunito, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`⛽${Math.ceil(p.fuel)}`, p.x, p.y - 20);
        }
      }
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#8fbf6f"/><rect x="16" y="48" width="208" height="20" fill="#3d4148"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${40 + i * 26}" y="57" width="14" height="2" fill="#fff"/>`).join('')}
    <rect x="30" y="90" width="170" height="8" fill="#5b5f66"/><rect x="30" y="66" width="8" height="30" fill="#5b5f66"/>
    <g transform="translate(150 58) scale(.55)"><path d="M32,0 Q30,-5 22,-5 L4,-5 L-6,-30 L-13,-30 L-6,-5 L-22,-5 L-29,-14 L-33,-14 L-30,0 L-33,14 L-29,14 L-22,5 L-6,5 L-13,30 L-6,30 L4,5 L22,5 Q30,5 32,0Z" fill="#fff"/></g>
    <g transform="translate(48 24) scale(.45) rotate(30)"><path d="M32,0 Q30,-5 22,-5 L4,-5 L-6,-30 L-13,-30 L-6,-5 L-22,-5 L-29,-14 L-33,-14 L-30,0 L-33,14 L-29,14 L-22,5 L-6,5 L-13,30 L-6,30 L4,5 L22,5 Q30,5 32,0Z" fill="#ffe066"/></g>
    <circle cx="28" cy="78" r="2.5" fill="#ff3b30"/><circle cx="34" cy="78" r="2.5" fill="#ff3b30"/><circle cx="40" cy="78" r="2.5" fill="#ff3b30"/>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'airport',
    order: 3,
    title: 'Airport Runway',
    tagline: 'Share one runway between landings and take-offs – and don’t let anyone run out of fuel.',
    difficulty: 'Advanced',
    concepts: ['Sharing a resource', 'Planning ahead', 'If + and', 'Number sensors'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>You are air traffic control! There is <b>one runway</b>. Planes arriving wait in the <b>holding pattern</b> (top left), and planes leaving wait at the <b>stop bar</b> (red lights).</p>
      <p>Set <code>approach</code> to <code>land</code> to bring planes in (one every 8 seconds while it stays on), or <code>hold</code> to keep them circling. Turn the <code>stop bar</code> <b>off</b> to let a waiting plane take off.</p>
      <p>A landing plane is <b>committed</b> – it can’t stop. Never let a plane take off while one is landing! But planes in the holding pattern are slowly <b>running out of fuel</b> ⛽…</p>
      <p>Number sensors: <code>planes waiting to land</code>, <code>lowest fuel</code>.</p>`,
    devices: {
      approach: { label: 'approach', aliases: ['landing', 'arrivals'], states: ['land', 'hold'], stateAliases: { 'clear to land': 'land', landing: 'land', wait: 'hold' }, stateColors: { land: '#2fd158', hold: '#ffb000' }, describe: 'Tells arriving planes to land (one at a time) or keep circling.' },
      'stop bar': { label: 'stop bar', aliases: ['stopbar', 'stop lights', 'departures'], states: ['on', 'off'], stateColors: { on: '#ff3b30', off: '#2fd158' }, describe: 'Red lights at the runway entrance. Turn OFF to let a waiting plane take off.' },
    },
    sensors: {
      'plane waiting to land': 'True when at least one plane is in the holding pattern.',
      'plane landing': 'True while a plane is landing (from final approach until it leaves the runway).',
      'plane waiting to depart': 'True when a plane is waiting at the stop bar.',
      'plane taking off': 'True while a plane is lining up or taking off.',
      'runway clear': 'True when no plane is using the runway.',
      'planes waiting to land': { type: 'number', desc: 'How many planes are in the holding pattern.' },
      'lowest fuel': { type: 'number', desc: 'Seconds of fuel left in the emptiest holding plane (99 if none).' },
    },
    snippets: { set: 'set approach land', sensor: 'runway clear' },
    starter: `# Let every plane land and every plane take off!
# What could possibly go wrong? Press Run...

set approach land
set stop bar off
forever:
    wait 1
`,
    solution: `set approach hold
set stop bar on
forever:
    # Arrivals first - they're using fuel
    if plane waiting to land:
        wait until runway clear
        set approach land
        wait until plane landing
        set approach hold
        wait until runway clear
    # Then let one plane take off
    if plane waiting to depart:
        set stop bar off
        wait until plane taking off
        set stop bar on
        wait until runway clear
    wait 0.5
`,
    hints: [
      'Only one plane may be on the runway. Start with "set approach hold" and "set stop bar on".',
      'To land one plane: wait until runway clear, set approach land, wait until plane landing, then set approach hold again.',
      'To launch one plane: set stop bar off, wait until plane taking off, then set stop bar on. Then wait until runway clear.',
      'Put both inside "forever:" using "if plane waiting to land:" and "if plane waiting to depart:".',
    ],
    create: () => new AirportSim(),
  });
})();
