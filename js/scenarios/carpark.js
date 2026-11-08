/* Car park barrier: one car per opening, never lower it onto a car. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const LANE_X = 450;
  const BY = 300; // barrier line
  const PAD_Y = BY + 20; // where car fronts stop to take a ticket
  const AISLE_Y = 196;
  const CL = 44, CW = 22;
  const VMAX = 75, ACC = 60, DEC = 160;
  const TARGET = 8;
  const DURATION = 60;

  const BAYS = [];
  for (let x = 110; x <= 790; x += 56) BAYS.push({ x, y: 112, dir: -1 });
  for (let x = 110; x <= 790; x += 56) if (x < 370 || x > 530) BAYS.push({ x, y: 282, dir: 1 });

  class CarParkSim extends K.BaseSim {
    get seed() {
      return 777;
    }
    initialDevices() {
      return { barrier: 'down' };
    }
    init() {
      this.duration = DURATION;
      this.cars = [];
      this.p = 0;
      this.spawnT = 0.5;
      this.parked = 0;
      this.closedSinceLast = true;
      this.everUp = false;
      this.idleUp = 0;
      this.idleFail = false;
      this.freeBays = BAYS.map((b, i) => i).sort(() => this.rng() - 0.5);
      this.sensorFns = {
        'car waiting': () => this.cars.some((c) => c.state === 'ticket' || c.state === 'wait'),
        'car under barrier': () => this.cars.some((c) => this.under(c)),
        'barrier clear': () => !this.cars.some((c) => this.under(c)),
      };
    }
    onSet(n, s) {
      if (s === 'up') this.everUp = true;
      if (s === 'down') this.closedSinceLast = true;
    }
    under(c) {
      return c.lane && c.y - CL / 2 < BY + 5 && c.y + CL / 2 > BY - 5;
    }
    step(dt) {
      // barrier motion
      const target = this.dev.barrier === 'up' ? 1 : 0;
      const lowering = target < this.p;
      this.p = target > this.p ? Math.min(1, this.p + dt / 1.2) : Math.max(0, this.p - dt / 1.2);

      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const last = this.cars.filter((c) => c.lane).sort((a, b) => b.y - a.y)[0];
        if (!last || last.y < H + 10 - CL - 8) {
          this.cars.push({ id: ++this.nid, lane: true, x: LANE_X, y: H + 30, v: VMAX * 0.8, state: 'queue', t: 0, wait: 0, color: K.pick(this.rng, K.CAR_COLORS), ang: -Math.PI / 2 });
          this.spawnT = 4 + this.rng() * 3;
        } else this.spawnT = 0.5;
      }

      const lane = this.cars.filter((c) => c.lane).sort((a, b) => a.y - b.y);
      lane.forEach((c, i) => {
        const ahead = i > 0 ? lane[i - 1] : null;
        let target = VMAX;
        const front = c.y - CL / 2;
        if (c.state === 'queue') {
          target = Math.min(target, K.stopLimit(front - PAD_Y, DEC));
          if (front - PAD_Y < 1.5 && c.v < 3) {
            c.state = 'ticket';
            c.t = 0;
          }
        } else if (c.state === 'ticket') {
          target = 0;
          c.t += dt;
          if (c.t > 1.2) c.state = 'wait';
        } else if (c.state === 'wait') {
          target = 0;
          c.wait += dt;
          if (this.p >= 0.999) c.state = 'go';
          if (c.wait > 15) {
            this.fail(c.x, c.y - 30, this.everUp
              ? { label: 'JAM!', icon: '🚗', title: 'The driver couldn’t get in', text: 'The barrier kept going back down before the car had a chance to drive through, and the queue backed up onto the main road.', tip: 'After lifting the barrier, wait until the car is under it, THEN wait until it has gone past, before lowering it again.' }
              : { label: 'JAM!', icon: '🚗', title: 'Traffic jam!', text: 'The barrier never opened, so cars queued all the way back onto the main road.', tip: 'Use "wait until car waiting", then "set barrier up".' });
            return;
          }
        }
        if (ahead) {
          const gap = front - (ahead.y + CL / 2);
          target = Math.min(target, K.followLimit(gap, ahead.v, DEC, 10));
        }
        c.v = K.approach(c.v, target, ACC, DEC * 2, dt);
        const wasUnder = this.under(c);
        c.y -= c.v * dt;
        if (!wasUnder && this.under(c) && c.state === 'go') {
          if (!this.closedSinceLast) {
            this.fail(c.x, BY, { label: 'FREE RIDE!', icon: '🎟️', title: 'A car sneaked in!', text: 'The barrier was still up from the last car, so the next driver drove straight in without paying.', tip: 'Lower the barrier after each car has gone through, so every driver has to stop and take a ticket.' });
            return;
          }
          this.closedSinceLast = false;
        }
        if (this.under(c) && lowering && this.p < 0.55) {
          this.fail(c.x, BY, { label: 'BONK!', icon: '🚧', title: 'The barrier hit a car!', text: 'The barrier came down while a car was still driving underneath it.', tip: 'Don’t lower the barrier straight away – use "wait until barrier clear" first, so the car has completely gone past.' });
          return;
        }
        if (c.y < AISLE_Y + 2) {
          c.lane = false;
          c.state = 'park';
          const bi = this.freeBays.shift();
          const b = BAYS[bi == null ? 0 : bi];
          c.path = [[LANE_X, AISLE_Y], [b.x, AISLE_Y], [b.x, b.y]];
          c.pi = 1;
          c.v = Math.min(c.v, 50);
        }
      });
      if (this.crash) return;
      // queue too long
      const waiting = this.cars.filter((c) => c.lane && c.y > PAD_Y);
      if (waiting.length >= 6) {
        this.fail(LANE_X, H - 40, { label: 'JAM!', icon: '🚗', title: 'Traffic jam!', text: 'Cars queued all the way back onto the main road.', tip: 'Let each car in as soon as it has its ticket.' });
        return;
      }
      for (const c of this.cars) {
        if (c.state !== 'park') continue;
        const [tx, ty] = c.path[c.pi];
        const dx = tx - c.x;
        const dy = ty - c.y;
        const d = Math.hypot(dx, dy);
        const step = 45 * dt;
        const wantAng = Math.atan2(dy, dx);
        let da = wantAng - c.ang;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        c.ang += da * Math.min(1, dt * 6);
        if (d <= step) {
          c.x = tx;
          c.y = ty;
          c.pi++;
          if (c.pi >= c.path.length) {
            c.state = 'parked';
            this.parked++;
          }
        } else {
          c.x += (dx / d) * step;
          c.y += (dy / d) * step;
        }
      }
      // bonus: barrier left up with nobody using it
      const busy = this.cars.some((c) => c.state === 'ticket' || c.state === 'wait' || (c.state === 'go' && c.lane));
      if (this.dev.barrier === 'up' && !busy) {
        this.idleUp += dt;
        if (this.idleUp > 5) this.idleFail = true;
      } else this.idleUp = 0;
    }
    goals() {
      return [
        this.goal('safe', 'No car is hit by the barrier', this.failedWith('BONK!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', 'Wait until the car has gone past'),
        this.goal('ticket', 'Only one car gets in each time the barrier opens', this.failedWith('FREE RIDE!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', 'Lower it after each car'),
        this.goal('parked', `Park ${TARGET} cars`, this.parked >= TARGET ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.parked} / ${TARGET} parked`),
        this.goal('idle', 'Bonus: never leave the barrier up with nobody there', this.idleFail ? 'fail' : this.ended ? 'pass' : 'pending', this.idleFail ? 'Left up for more than 5 s' : 'Keeps the car park secure', false),
      ];
    }
    status() {
      const waiting = this.cars.filter((c) => c.lane && c.y > PAD_Y - 2).length;
      return [
        { label: 'Barrier', value: this.dev.barrier.toUpperCase(), note: this.p > 0 && this.p < 1 ? 'moving…' : '' },
        { label: 'Sensor: car waiting', value: this.readSensor('car waiting') ? 'TRUE' : 'FALSE' },
        { label: 'Sensor: car under barrier', value: this.readSensor('car under barrier') ? 'TRUE' : 'FALSE' },
        { label: 'Cars queuing', value: String(waiting) },
        { label: 'Cars parked', value: `${this.parked} / ${TARGET}` },
      ];
    }
    buildBg(g, r) {
      K.grass(g, r, W, H);
      K.asphalt(g, r, 60, 50, W - 120, 280);
      g.strokeStyle = '#9e9a93';
      g.lineWidth = 4;
      g.strokeRect(60, 50, W - 120, 280);
      K.asphalt(g, r, LANE_X - 34, 326, 68, H - 326);
      g.fillStyle = '#4b4f56';
      g.fillRect(LANE_X - 34, 320, 68, 14);
      // bays
      g.strokeStyle = '#f2f2f2';
      g.lineWidth = 2;
      for (const b of BAYS) {
        g.beginPath();
        g.moveTo(b.x - 28, b.y - 32);
        g.lineTo(b.x - 28, b.y + 32);
        g.moveTo(b.x + 28, b.y - 32);
        g.lineTo(b.x + 28, b.y + 32);
        g.stroke();
      }
      K.dashedLine(g, 80, AISLE_Y, W - 80, AISLE_Y, 16, 14, 2, 'rgba(255,255,255,0.4)');
      // arrows
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.moveTo(LANE_X, 360);
      g.lineTo(LANE_X - 9, 378);
      g.lineTo(LANE_X + 9, 378);
      g.fill();
      g.fillRect(LANE_X - 3, 376, 6, 22);
      // pad markings
      g.fillStyle = '#f2f2f2';
      g.fillRect(LANE_X - 30, PAD_Y - 2, 60, 3);
      g.font = '900 11px Nunito, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('STOP', LANE_X, PAD_Y + 18);
      // ticket machine
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(LANE_X + 42, PAD_Y + 2, 18, 22);
      g.fillStyle = '#ffd43b';
      K.rr(g, LANE_X + 38, PAD_Y - 2, 18, 22, 3);
      g.fill();
      g.fillStyle = '#343a40';
      g.fillRect(LANE_X + 42, PAD_Y + 2, 10, 6);
      // P sign
      g.fillStyle = '#1c7ed6';
      K.rr(g, LANE_X + 52, 360, 36, 36, 6);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '900 26px Nunito, system-ui, sans-serif';
      g.fillText('P', LANE_X + 70, 388);
      for (let i = 0; i < 7; i++) {
        K.drawTree(g, 30 + i * 60 + (i > 3 ? 360 : 0), 470 + (i % 2) * 20, 14, r);
      }
      K.drawTree(g, 30, 200, 15, r);
      K.drawTree(g, 870, 260, 15, r);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.font = '800 12px Nunito, system-ui, sans-serif';
      g.fillText('from main road', LANE_X - 80, H - 12);
    }
    draw(ctx) {
      this.drawBg(ctx);
      for (const c of this.cars) {
        K.drawCar(ctx, c.x, c.y, c.ang, c.color, { len: CL, wid: CW, braking: c.lane && c.v < 20 && c.state !== 'go' });
      }
      const blink = Math.floor(this.t * 3) % 2 === 0;
      K.drawBarrier(ctx, LANE_X - 42, BY, 86, 0, this.p, { light: true, blink });
      // status light on the barrier box
      ctx.fillStyle = this.p >= 0.999 ? '#2fd158' : '#ff3b30';
      ctx.beginPath();
      ctx.arc(LANE_X - 42, BY, 3, 0, Math.PI * 2);
      ctx.fill();
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#86bf6b"/><rect x="16" y="12" width="208" height="70" fill="#4b4f56"/>
    <rect x="108" y="82" width="24" height="58" fill="#4b4f56"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${24 + i * 28}" y="16" width="2" height="22" fill="#fff"/>`).join('')}
    <rect x="34" y="20" width="12" height="18" rx="2" fill="#3f88c5"/><rect x="90" y="20" width="12" height="18" rx="2" fill="#e94f37"/><rect x="146" y="20" width="12" height="18" rx="2" fill="#44af69"/>
    <g>${[0, 1, 2, 3].map((i) => `<rect x="${101 + i * 7}" y="86" width="7" height="4" fill="${i % 2 ? '#fff' : '#e03131'}"/>`).join('')}<rect x="96" y="83" width="8" height="10" fill="#333"/></g>
    <rect x="114" y="98" width="12" height="20" rx="2" fill="#f6ae2d"/>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'carpark',
    order: 3,
    title: 'Car Park Barrier',
    tagline: 'Let cars into the car park one at a time – without dropping the barrier on anyone.',
    difficulty: 'Beginner',
    concepts: ['Wait until', 'Sensors', 'Order of steps'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>Drivers stop at the barrier and take a ticket. Then the barrier lifts, they drive in and park.</p>
      <p>The barrier must go back <b>down after every car</b>, so the next driver has to stop and take a ticket too. But be careful – if it comes down while a car is underneath… <b>BONK!</b></p>
      <p>Your sensors: <code>car waiting</code> (someone has a ticket), <code>car under barrier</code>, and <code>barrier clear</code>.</p>
      <p><b>Bonus:</b> never leave the barrier up when nobody is using it.</p>`,
    devices: {
      barrier: { label: 'barrier', aliases: ['gate', 'arm', 'barrier arm'], states: ['up', 'down'], stateAliases: { open: 'up', closed: 'down', raised: 'up', lowered: 'down' }, stateColors: { up: '#2fd158', down: '#ff3b30' }, describe: 'The red-and-white arm across the entrance. Takes about 1 second to move.' },
    },
    sensors: {
      'car waiting': 'True when a car is stopped at the barrier with a ticket.',
      'car under barrier': 'True when a car is underneath the barrier arm.',
      'barrier clear': 'True when nothing is underneath the barrier arm.',
    },
    snippets: { set: 'set barrier up', sensor: 'car waiting' },
    starter: `# Cars stop at the barrier and take a ticket.
# This program lifts the barrier for them...
# but does it ever put it back down?

forever:
    wait until car waiting
    set barrier up
`,
    solution: `# One car at a time
forever:
    wait until car waiting
    set barrier up
    # let the car drive under the barrier...
    wait until car under barrier
    # ...and all the way past it
    wait until barrier clear
    set barrier down
`,
    hints: [
      'After the car goes in, you need "set barrier down" – but when?',
      'If you lower it straight away, the car hasn’t moved yet. If you lower it while the car is underneath – BONK!',
      'Use two waits: first "wait until car under barrier", then "wait until barrier clear". Then lower it.',
    ],
    create: () => new CarParkSim(),
  });
})();
