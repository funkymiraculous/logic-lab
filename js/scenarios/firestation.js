/* Fire station: stop traffic, open the doors, get the engine out fast. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const RT = 300, RB = 400, MID = 350;
  const LANE_E = 326, LANE_W = 374;
  const STOP_E = 372, STOP_W = 528;
  const DOOR_Y = 222, DX0 = 410, DX1 = 490;
  const CL = 44, CW = 22;
  const VMAX = 115, ACC = 90, DEC = 220;
  const ALARMS = [6, 36, 66];
  const RESPONSE = 20;
  const DURATION = 92;
  const PATH = [[450, 150], [450, 296], [446, 326], [432, 356], [404, 372], [-120, 372]];

  class FireSim extends K.BaseSim {
    get seed() {
      return 999;
    }
    initialDevices() {
      return { traffic: 'green', doors: 'closed', siren: 'off' };
    }
    init() {
      this.duration = DURATION;
      this.cars = [];
      this.d = 0;
      this.ai = 0;
      this.alarm = false;
      this.alarmT = 0;
      this.answered = 0;
      this.engine = this.newEngine();
      this.spawnE = 0.3;
      this.spawnW = 1.2;
      this.pointless = 0;
      this.sirenFail = false;
      this.afterOut = null;
      this.greenFail = false;
      this.times = [];
      this.sensorFns = {
        alarm: () => this.alarm,
        'engine ready': () => this.engine.state === 'ready',
        'engine out': () => !this.alarm && this.afterOut != null,
        'road clear': () => !this.cars.some((c) => c.x + CL / 2 > STOP_E + 2 && c.x - CL / 2 < STOP_W - 2),
      };
    }
    newEngine() {
      return { x: PATH[0][0], y: PATH[0][1], ang: Math.PI / 2, seg: 1, v: 0, state: 'parked', crew: 0 };
    }
    newCar(dir) {
      const v = VMAX * (0.88 + this.rng() * 0.12);
      return { dir, x: dir > 0 ? -30 : W + 30, y: dir > 0 ? LANE_E : LANE_W, v, vmax: v, color: K.pick(this.rng, K.CAR_COLORS), amber: null };
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
      // alarms
      if (this.ai < ALARMS.length && this.t >= ALARMS[this.ai]) {
        this.ai++;
        this.alarm = true;
        this.alarmT = 0;
        this.afterOut = null;
        if (this.engine.state === 'gone') this.engine = this.newEngine();
        this.engine.state = 'boarding';
        this.engine.crew = 0;
      }
      if (this.alarm) {
        this.alarmT += dt;
        if (this.alarmT > RESPONSE) {
          this.fail(450, 120, { label: 'TOO LATE!', icon: '🔥', title: 'The fire engine was too slow!', text: `The engine didn’t get out within ${RESPONSE} seconds of the alarm, and the fire spread.`, tip: this.dev.doors === 'closed' ? 'The engine can’t leave until the doors are open!' : 'Stop the traffic and open the doors as soon as the alarm sounds.' });
          return;
        }
      }
      if (this.afterOut != null) {
        this.afterOut += dt;
        if (this.afterOut > 10 && this.dev.traffic !== 'green') this.greenFail = true;
      }
      // doors
      const open = this.dev.doors === 'open';
      const wasD = this.d;
      this.d = open ? Math.min(1, this.d + dt / 3) : Math.max(0, this.d - dt / 3);
      const e = this.engine;
      if (!open && this.d < wasD && this.d < 0.6 && e.y + 31 > DOOR_Y - 8 && e.y - 31 < DOOR_Y + 8 && e.state === 'driving') {
        this.fail(450, DOOR_Y, { label: 'CRUNCH!', icon: '🚒', title: 'The doors closed on the fire engine!', text: 'The station doors came down while the engine was still driving out.', tip: 'Wait until the engine is out ("wait until engine out") before closing the doors.' });
        return;
      }
      // engine
      if (e.state === 'boarding') {
        e.crew += dt;
        if (e.crew > 4) e.state = 'ready';
      }
      if (e.state === 'ready' && this.d >= 0.99) e.state = 'driving';
      if (e.state === 'driving') {
        if (this.alarm && this.dev.siren !== 'on') this.sirenFail = true;
        e.v = Math.min(110, e.v + 70 * dt);
        let move = e.v * dt;
        while (move > 0 && e.seg < PATH.length) {
          const [tx, ty] = PATH[e.seg];
          const dx = tx - e.x;
          const dy = ty - e.y;
          const dd = Math.hypot(dx, dy);
          if (dd <= move) {
            e.x = tx;
            e.y = ty;
            e.seg++;
            move -= dd;
          } else {
            e.x += (dx / dd) * move;
            e.y += (dy / dd) * move;
            move = 0;
          }
          const want = Math.atan2(dy, dx);
          let da = want - e.ang;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          e.ang += da * Math.min(1, dt * 8);
        }
        if (this.alarm && e.x < 300) {
          this.alarm = false;
          this.answered++;
          this.times.push(this.alarmT);
          this.afterOut = 0;
        }
        if (e.x < -100) e.state = 'gone';
      }

      // traffic
      this.spawnE -= dt;
      this.spawnW -= dt;
      if (this.spawnE <= 0) {
        if (!this.cars.some((c) => c.dir > 0 && c.x < 50)) {
          this.cars.push(this.newCar(1));
          this.spawnE = 1.6 + this.rng() * 2.4;
        } else this.spawnE = 0.4;
      }
      if (this.spawnW <= 0) {
        if (!this.cars.some((c) => c.dir < 0 && c.x > W - 50)) {
          this.cars.push(this.newCar(-1));
          this.spawnW = 1.6 + this.rng() * 2.4;
        } else this.spawnW = 0.4;
      }
      const L = this.dev.traffic;
      if (L !== 'green' && !this.alarm && (this.afterOut == null || this.afterOut > 4)) this.pointless += dt;
      for (const c of this.cars) {
        const front = c.x + (c.dir * CL) / 2;
        const dist = c.dir > 0 ? STOP_E - front : front - STOP_W;
        let target = c.vmax;
        if (!c.passed) {
          if (dist < -0.5) {
            c.passed = true;
            if (L === 'red') c.ranRed = true;
          } else {
            let stop = L === 'red' || L === 'red amber';
            if (L === 'amber') {
              if (c.amber == null) c.amber = (c.v * c.v) / (2 * DEC) < dist - 1 || c.v < 25 ? 'stop' : 'go';
              stop = c.amber === 'stop';
            } else c.amber = null;
            if (stop) target = Math.min(target, K.stopLimit(dist, DEC));
          }
        }
        const a = this.ahead(c);
        if (a) target = Math.min(target, K.followLimit(Math.abs(a.x - c.x) - CL, a.v, DEC, 14));
        // drivers behind the fire engine follow it
        if (c.dir < 0 && e.state === 'driving' && e.y > 362 && e.x < c.x) {
          target = Math.min(target, K.followLimit(c.x - CL / 2 - (e.x + 31), e.v, DEC, 14));
        }
        c.braking = target < c.v - 2;
        c.v = K.approach(c.v, target, ACC, DEC * 2.2, dt);
        c.x += c.dir * c.v * dt;
      }
      this.cars = this.cars.filter((c) => c.x > -80 && c.x < W + 80);

      // engine vs cars
      if (e.state === 'driving') {
        const pts = [-22, 0, 22].map((o) => [e.x + Math.cos(e.ang) * o, e.y + Math.sin(e.ang) * o]);
        for (const c of this.cars) {
          for (const [px, py] of pts) {
            if (Math.abs(px - c.x) < CL / 2 + 10 && Math.abs(py - c.y) < CW / 2 + 10) {
              c.v = 0;
              this.fail((px + c.x) / 2, (py + c.y) / 2, this.diagnose(c));
              return;
            }
          }
        }
      }
    }
    diagnose(c) {
      const b = { label: 'CRASH!', icon: '🚒', title: 'The fire engine crashed into a car!' };
      if (this.dev.traffic === 'green') return { ...b, text: 'The engine pulled out while the traffic lights were still green, straight into passing cars.', tip: 'When the alarm sounds, turn the traffic lights amber, then red, BEFORE opening the doors.' };
      if (c.ranRed) return { ...b, text: 'The lights went straight from green to red, so a driver couldn’t stop in time.', tip: 'Show amber for 3 seconds before red so drivers can stop safely.' };
      return { ...b, text: 'A car was still driving past the station when the engine pulled out.', tip: 'After turning the lights red, "wait until road clear" before opening the doors.' };
    }
    goals() {
      const n = ALARMS.length;
      return [
        this.goal('safe', 'No crashes', this.safeStatus(), 'Stop traffic before the engine leaves'),
        this.goal('respond', `Answer all ${n} emergency calls within ${RESPONSE} s`, this.answered >= n ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.answered} / ${n} answered${this.times.length ? ` · last: ${this.times[this.times.length - 1].toFixed(1)} s` : ''}`),
        this.goal('flow', 'Keep normal traffic moving between emergencies', this.pointless > 10 ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Traffic held for nothing: ${this.pointless.toFixed(0)} s (max 10)`),
        this.goal('siren', 'Bonus: siren on as the engine leaves, and traffic back to green afterwards', this.sirenFail || this.greenFail ? 'fail' : this.ended && !this.crash && this.answered ? 'pass' : 'pending', this.sirenFail ? 'The siren was off!' : this.greenFail ? 'Traffic left on red' : 'Device: siren', false),
      ];
    }
    status() {
      const e = this.engine;
      const es = { parked: 'in station', boarding: 'crew boarding…', ready: 'READY – waiting for doors', driving: 'driving out!', gone: 'on its way' }[e.state];
      return [
        { label: 'Sensor: alarm', value: this.alarm ? `TRUE 🔥 ${this.alarmT.toFixed(0)} s` : 'FALSE' },
        { label: 'Fire engine', value: es },
        { label: 'Traffic lights', value: this.dev.traffic.toUpperCase(), swatches: K.swatchesFor(this.dev.traffic) },
        { label: 'Doors · siren', value: `${this.dev.doors} · ${this.dev.siren}` },
        { label: 'Calls answered', value: `${this.answered} / ${ALARMS.length}` },
      ];
    }
    buildBg(g, r) {
      K.grass(g, r, W, H);
      // station yard and building
      g.fillStyle = '#c8c3ba';
      g.fillRect(360, 210, 180, RT - 210);
      g.fillStyle = '#9b2226';
      g.fillRect(370, 60, 160, DOOR_Y - 60);
      g.fillStyle = '#ae2012';
      g.fillRect(370, 60, 160, 40);
      g.fillStyle = '#fff';
      g.font = '900 15px Nunito, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('FIRE STATION', 450, 86);
      g.fillStyle = '#e9ecef';
      g.fillRect(DX0, 100, DX1 - DX0, DOOR_Y - 100);
      g.fillStyle = '#ffd43b';
      for (let x = 362; x < 540; x += 16) g.fillRect(x, RT - 8, 8, 4);
      // pavements
      g.fillStyle = '#d6d3cc';
      g.fillRect(0, RT - 22, 360, 22);
      g.fillRect(540, RT - 22, W - 540, 22);
      g.fillRect(0, RB, W, 22);
      K.asphalt(g, r, 0, RT, W, RB - RT);
      g.fillStyle = '#f2f2f2';
      for (let x = 0; x < W; x += 40) if (x < 330 || x > 560) g.fillRect(x, MID - 1.5, 22, 3);
      // keep clear box
      g.strokeStyle = '#ffd43b';
      g.lineWidth = 2;
      g.strokeRect(STOP_E + 4, RT + 3, STOP_W - STOP_E - 8, RB - RT - 6);
      for (let x = STOP_E + 4; x < STOP_W - 4; x += 18) {
        g.beginPath();
        g.moveTo(x, RT + 3);
        g.lineTo(Math.min(STOP_W - 4, x + 30), RB - 3);
        g.stroke();
      }
      g.fillStyle = '#f2f2f2';
      g.fillRect(STOP_E - 4, RT + 3, 4, MID - RT - 3);
      g.fillRect(STOP_W, MID, 4, RB - MID - 3);
      g.font = '900 13px Nunito, system-ui, sans-serif';
      g.fillText('KEEP CLEAR', 450, MID + 5);
      for (let i = 0; i < 9; i++) {
        K.drawTree(g, 20 + i * 38, 150 + (i % 2) * 40, 14, r);
        K.drawTree(g, 580 + i * 36, 150 + (i % 2) * 40, 14, r);
        K.drawTree(g, 30 + i * 100, 470, 15, r);
      }
      K.drawHouse(g, 80, 30, 90, 60, '#6d4c41', '#e8dccb');
      K.drawHouse(g, 700, 30, 90, 60, '#546e7a', '#e8dccb');
    }
    draw(ctx) {
      this.drawBg(ctx);
      const e = this.engine;
      if (e.state !== 'gone') K.drawTruck(ctx, e.x, e.y, e.ang, { siren: this.dev.siren === 'on', t: this.t });
      // doors (roller shutter)
      const shut = (1 - this.d) * (DOOR_Y - 100);
      ctx.fillStyle = '#adb5bd';
      ctx.fillRect(DX0, DOOR_Y - Math.max(6, shut * 0.25), DX1 - DX0, Math.max(6, shut * 0.25));
      ctx.fillStyle = this.d >= 0.99 ? '#2fd158' : '#495057';
      ctx.fillRect(DX0, DOOR_Y - 3, DX1 - DX0, 3);
      // roof over the engine bay
      ctx.fillStyle = 'rgba(155,34,38,0.9)';
      ctx.fillRect(370, 60, 160, 50);
      ctx.fillStyle = '#fff';
      ctx.font = '900 15px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FIRE STATION', 450, 90);
      if (this.alarm) {
        const blink = Math.floor(this.t * 4) % 2 === 0;
        ctx.fillStyle = blink ? '#ff3b30' : '#ffd43b';
        K.rr(ctx, 330, 22, 240, 28, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '900 14px Nunito, system-ui, sans-serif';
        ctx.fillText(`🔔 ALARM! ${(RESPONSE - this.alarmT).toFixed(0)} s to respond`, 450, 41);
      }
      for (const c of this.cars) K.drawCar(ctx, c.x, c.y, c.dir > 0 ? 0 : Math.PI, c.color, { braking: c.braking, len: CL, wid: CW });
      const lamps = [
        ...K.drawSignal(ctx, STOP_E - 16, RT - 34, this.dev.traffic, null),
        ...K.drawSignal(ctx, STOP_W + 16, RB + 32, this.dev.traffic, null),
      ];
      K.signalGlow(ctx, lamps);
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#86bf6b"/><rect x="88" y="10" width="64" height="50" fill="#9b2226"/><rect x="100" y="30" width="40" height="30" fill="#e9ecef"/>
    <rect y="80" width="240" height="34" fill="#4b4f56"/><rect x="96" y="60" width="48" height="20" fill="#c8c3ba"/>
    <rect x="108" y="44" width="24" height="36" rx="3" fill="#d62828"/><rect x="113" y="50" width="14" height="22" fill="#cfd8dc"/>
    <rect x="30" y="84" width="30" height="12" rx="3" fill="#3f88c5"/><rect x="180" y="98" width="30" height="12" rx="3" fill="#f6ae2d"/>
    <g><rect x="76" y="56" width="10" height="22" rx="2" fill="#1c1f24"/><circle cx="81" cy="62" r="3" fill="#ff3b30"/><circle cx="81" cy="68" r="3" fill="#4a3a10"/><circle cx="81" cy="74" r="3" fill="#0f3a1c"/></g>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'firestation',
    order: 5,
    title: 'Fire Station Exit',
    tagline: 'When the alarm rings, stop the traffic and get the fire engine out – fast!',
    difficulty: 'Intermediate',
    concepts: ['Interrupting normal behaviour', 'Priority', 'Timing', 'Wait until'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>The fire station is on a busy road. Normally the traffic lights stay <b>green</b>.</p>
      <p>When the <code>alarm</code> sounds, the crew board the engine (about 4 seconds). You must <b>stop the traffic</b> (amber, then red), make sure the road is clear, and <b>open the doors</b> (they take 3 seconds). The engine drives out as soon as the doors are fully open.</p>
      <p>You have <b>${RESPONSE} seconds</b> from the alarm to get the engine out. Afterwards, close the doors and let traffic flow again.</p>
      <p><b>Bonus:</b> switch the <code>siren</code> on while the engine leaves.</p>`,
    devices: {
      traffic: { label: 'traffic lights', aliases: ['lights', 'traffic lights', 'traffic light', 'light'], states: ['green', 'amber', 'red'], stateAliases: { yellow: 'amber', orange: 'amber' }, stateColors: { green: '#2fd158', amber: '#ffb000', red: '#ff3b30' }, describe: 'The traffic lights on the main road, both directions.' },
      doors: { label: 'station doors', aliases: ['door', 'station doors', 'shutter'], states: ['open', 'closed'], stateAliases: { close: 'closed', shut: 'closed', up: 'open', down: 'closed' }, stateColors: { open: '#2fd158', closed: '#ff3b30' }, describe: 'The big roller doors. They take 3 seconds to open or close.' },
      siren: { label: 'siren', aliases: ['sirens', 'blue lights'], states: ['on', 'off'], stateColors: { on: '#4dabf7', off: '#5b5b5b' }, describe: 'The engine’s siren and flashing blue lights.' },
    },
    sensors: {
      alarm: 'True from when an emergency call comes in until the engine is out.',
      'engine ready': 'True when the crew are on board and waiting for the doors.',
      'engine out': 'True once the engine has left and is on its way.',
      'road clear': 'True when no car is in the KEEP CLEAR box.',
    },
    snippets: { set: 'set traffic red', sensor: 'alarm' },
    starter: `# When the alarm rings, open the doors
# so the fire engine can get out.
# What about the traffic? Press Run!

forever:
    wait until alarm
    set doors open
    wait until engine out
    set doors closed
`,
    solution: `set traffic green
forever:
    wait until alarm
    set siren on
    # Stop the traffic safely
    set traffic amber
    wait 3
    set traffic red
    wait until road clear
    # Let the engine out
    set doors open
    wait until engine out
    set doors closed
    set traffic green
    set siren off
`,
    hints: [
      'The engine drives out as soon as the doors are open – so stop the traffic FIRST.',
      'Use amber for 3 seconds, then red, then "wait until road clear" before "set doors open".',
      'After "wait until engine out", close the doors and set the traffic back to green.',
      'Bonus: "set siren on" when the alarm sounds and "set siren off" at the end.',
    ],
    create: () => new FireSim(),
  });
})();
