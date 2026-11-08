/* Scenario 1: Belisha beacons at a zebra crossing. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;

  const W = 900, H = 520;
  const RT = 190, RB = 330, MID = 260;
  const LANE_E = 225, LANE_W = 295; // UK: drive on the left, so eastbound traffic uses the top lane
  const XL = 420, XR = 480, XC = 450;
  const STOP_E = 408, STOP_W = 492;
  const CL = 46, CW = 24;
  const VMAX = 130, VCAUTION = 70, ACC = 110, DEC = 230;
  const PAVE_T = 168, PAVE_B = 352, KERB_T = 185, KERB_B = 335;
  const DURATION = 60;
  const CAR_COLORS = ['#e94f37', '#3f88c5', '#f6ae2d', '#44af69', '#8e6c8a', '#eeeeee', '#2b2d42', '#ff8c42', '#1b998b'];
  const PED_COLORS = ['#d7263d', '#1b998b', '#2e294e', '#f46036', '#9bc53d', '#5c4d7d', '#e2a0ff', '#00a6ed'];
  const HAIR = ['#2b1d14', '#4a3020', '#c9a227', '#7b3f00', '#111', '#a0522d', '#ddd'];

  function darkness(t) {
    if (t < 16) return 0;
    if (t < 21) return (t - 16) / 5;
    if (t < 38) return 1;
    if (t < 43) return 1 - (t - 38) / 5;
    return 0;
  }

  class ZebraSim {
    constructor() {
      this.W = W;
      this.H = H;
      this.duration = DURATION;
      this.bg = null;
      this.reset();
    }

    reset() {
      this.t = 0;
      this.rng = K.rng(20261108);
      this.dev = { beacon: 'off', floodlight: 'off' };
      this.toggles = [];
      this.cars = [];
      this.peds = [];
      this.fx = new K.Fx();
      this.crash = null;
      this.ended = false;
      this.nid = 0;
      this.spawnE = 0.3;
      this.spawnW = 1.4;
      this.spawnP = 2.5;
      this.stats = { cars: 0, peds: 0, aware: 0, unaware: 0 };
      this.flashGood = 0;
      this.floodMismatch = 0;
      this.floodFailed = false;
      this.floodNight = false;
      this.floodDay = false;
      // a couple of people already on their way to the crossing
      this.peds.push(this.newPed(true, XC - 70, 1));
      this.peds.push(this.newPed(false, XC + 150, -1));
    }

    /* ---- program interface ---- */
    setDevice(n, s) {
      if (this.dev[n] === s) return;
      this.dev[n] = s;
      if (n === 'beacon') {
        this.toggles.push(this.t);
        if (this.toggles.length > 10) this.toggles.shift();
      }
    }
    getDevice(n) {
      return this.dev[n];
    }
    readSensor(n) {
      if (n === 'dark') return darkness(this.t) > 0.5;
      if (n === 'pedestrian waiting') return this.peds.some((p) => p.state === 'waiting');
      return false;
    }

    flashing() {
      const T = this.toggles;
      const n = T.length;
      if (n < 3) return false;
      if (this.t - T[n - 1] > 1.6) return false;
      const a = T[n - 1] - T[n - 2];
      const b = T[n - 2] - T[n - 3];
      return a >= 0.25 && a <= 1.6 && b >= 0.25 && b <= 1.6;
    }

    /* ---- simulation ---- */
    newCar(dir) {
      const v = VMAX * (0.88 + this.rng() * 0.12);
      return {
        id: ++this.nid, dir, x: dir > 0 ? -30 : W + 30, y: dir > 0 ? LANE_E : LANE_W,
        v, vmax: v, color: CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)], aware: false, braking: false,
      };
    }
    newPed(top, x, hdir) {
      return {
        x, y: top ? PAVE_T : PAVE_B, top, hdir,
        crossX: XC - 16 + this.rng() * 32, state: 'approach', speed: 40 + this.rng() * 12,
        color: PED_COLORS[Math.floor(this.rng() * PED_COLORS.length)],
        hair: HAIR[Math.floor(this.rng() * HAIR.length)], phase: this.rng() * 6, waitT: 0, ang: hdir > 0 ? 0 : Math.PI,
      };
    }

    update(dt) {
      if (this.crash) {
        this.crash.age += dt;
        this.fx.update(dt);
        return;
      }
      this.t += dt;
      const flashing = this.flashing();
      if (flashing) this.flashGood += dt;

      const dark = this.readSensor('dark');
      const fl = this.dev.floodlight === 'on';
      if (dark && fl) this.floodNight = true;
      if (!dark && !fl && this.t > 44) this.floodDay = true;
      if (dark !== fl) {
        this.floodMismatch += dt;
        if (this.floodMismatch > 3) this.floodFailed = true;
      } else this.floodMismatch = 0;

      this.spawn(dt);
      this.updateCars(dt, flashing);
      this.updatePeds(dt);
      this.checkCrash();
      this.fx.update(dt);
    }

    spawn(dt) {
      this.spawnE -= dt;
      this.spawnW -= dt;
      this.spawnP -= dt;
      if (this.spawnE <= 0) {
        if (!this.cars.some((c) => c.dir > 0 && c.x < 50)) {
          this.cars.push(this.newCar(1));
          this.spawnE = 2.2 + this.rng() * 3;
        } else this.spawnE = 0.4;
      }
      if (this.spawnW <= 0) {
        if (!this.cars.some((c) => c.dir < 0 && c.x > W - 50)) {
          this.cars.push(this.newCar(-1));
          this.spawnW = 2.2 + this.rng() * 3;
        } else this.spawnW = 0.4;
      }
      if (this.spawnP <= 0) {
        const fromLeft = this.rng() < 0.5;
        const startX = fromLeft ? XC - 180 - this.rng() * 240 : XC + 180 + this.rng() * 240;
        const p = this.newPed(this.rng() < 0.5, startX, fromLeft ? 1 : -1);
        p.fade = 0;
        this.peds.push(p);
        this.spawnP = 1.8 + this.rng() * 2.6;
      }
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

    updateCars(dt, flashing) {
      const pedPresent = this.peds.some((p) => p.state === 'crossing' || p.state === 'waiting');
      for (const c of this.cars) {
        const front = c.x + (c.dir * CL) / 2;
        const dist = c.dir > 0 ? STOP_E - front : front - STOP_W;
        if (!c.aware && dist > 0 && dist < 430 && flashing) c.aware = true;
        let target = c.vmax;
        if (c.aware && dist >= 0) {
          if (dist < 230) target = Math.min(target, VCAUTION);
          if (pedPresent) target = Math.min(target, Math.sqrt(2 * DEC * Math.max(0, dist - 2)));
        }
        const a = this.ahead(c);
        if (a) {
          const gap = Math.abs(a.x - c.x) - CL;
          const lim = Math.sqrt(Math.max(0, a.v * a.v + 2 * DEC * (gap - 14)));
          target = Math.min(target, gap < 14 ? 0 : lim);
        }
        c.braking = target < c.v - 2;
        if (c.v < target) c.v = Math.min(target, c.v + ACC * dt);
        else c.v = Math.max(target, c.v - DEC * 2.2 * dt);
        c.x += c.dir * c.v * dt;
        if (!c.counted && (c.dir > 0 ? c.x - CL / 2 > XR : c.x + CL / 2 < XL)) {
          c.counted = true;
          this.stats.cars++;
          if (c.aware) this.stats.aware++;
          else this.stats.unaware++;
        }
      }
      this.cars = this.cars.filter((c) => c.x > -80 && c.x < W + 80);
    }

    safeToCross() {
      for (const c of this.cars) {
        const minX = c.x - CL / 2;
        const maxX = c.x + CL / 2;
        if (maxX > XL - 8 && minX < XR + 8) return false;
        const front = c.x + (c.dir * CL) / 2;
        const dist = c.dir > 0 ? XL - front : front - XR;
        if (dist > 0 && dist < 85 && c.v > 18) return false;
      }
      return true;
    }

    updatePeds(dt) {
      const move = (p, tx, ty) => {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        const step = p.speed * dt;
        if (d <= step) {
          p.x = tx;
          p.y = ty;
          return true;
        }
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        p.ang = Math.atan2(dy, dx);
        p.phase += dt * 9;
        return false;
      };
      for (const p of this.peds) {
        if (p.fade != null && p.fade < 1) p.fade = Math.min(1, p.fade + dt * 2);
        const kerbY = p.top ? KERB_T : KERB_B;
        const farKerb = p.top ? KERB_B : KERB_T;
        switch (p.state) {
          case 'approach':
            if (move(p, p.crossX, p.y)) p.state = 'toKerb';
            break;
          case 'toKerb':
            if (move(p, p.crossX, kerbY)) {
              p.state = 'waiting';
              p.ang = p.top ? Math.PI / 2 : -Math.PI / 2;
            }
            break;
          case 'waiting':
            p.waitT += dt;
            if (p.waitT > 0.6 && this.safeToCross()) p.state = 'crossing';
            break;
          case 'crossing':
            if (move(p, p.crossX, farKerb)) {
              p.state = 'leave';
              this.stats.peds++;
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
    }

    checkCrash() {
      for (const p of this.peds) {
        if (p.state !== 'crossing') continue;
        for (const c of this.cars) {
          if (Math.abs(p.x - c.x) < CL / 2 + 5 && Math.abs(p.y - c.y) < CW / 2 + 5) {
            this.crash = { x: (p.x + c.x) / 2, y: (p.y + c.y) / 2, age: 0, car: c, ped: p, reason: this.diagnose(c) };
            c.v = 0;
            this.fx.burst(this.crash.x, this.crash.y, this.rng);
            return;
          }
        }
      }
    }

    diagnose(c) {
      const T = this.toggles;
      if (c.aware) {
        return {
          title: 'Accident at the crossing',
          text: 'The driver noticed the crossing, but couldn’t stop in time.',
          tip: 'Keep the beacons flashing steadily the whole time so drivers notice them early.',
        };
      }
      if (T.length === 0) {
        return {
          title: 'The driver didn’t see the crossing',
          text: 'The beacons never lit up, so the driver had no warning that a zebra crossing was ahead.',
          tip: 'Use "set beacon on" and "set beacon off", with a "wait" after each one, inside a "forever:" loop.',
        };
      }
      const since = this.t - T[T.length - 1];
      if (since > 1.6) {
        if (this.dev.beacon === 'on') {
          return {
            title: 'The driver didn’t notice the crossing',
            text: 'The beacons stayed on without flashing. A steady orange light looks just like a street lamp, so the driver didn’t realise there was a crossing.',
            tip: 'Make the beacons FLASH: on, wait, off, wait … and repeat that forever.',
          };
        }
        return {
          title: 'The beacons stopped flashing',
          text: 'The beacons flashed for a bit, then stopped. The next driver had no warning about the crossing.',
          tip: 'Put your flashing steps inside a "forever:" loop so they never stop.',
        };
      }
      const iv = [];
      for (let i = 1; i < T.length; i++) iv.push(T[i] - T[i - 1]);
      const recent = iv.slice(-3);
      if (recent.some((x) => x > 1.6)) {
        return {
          title: 'The beacons flashed too slowly',
          text: 'The beacons changed so slowly that the driver didn’t spot them flashing in time.',
          tip: 'Real Belisha beacons flash about once a second. Try waiting 0.5 seconds between on and off.',
        };
      }
      if (recent.some((x) => x < 0.25)) {
        return {
          title: 'The beacons flickered too fast',
          text: 'The beacons flickered so quickly that they looked broken, and the driver ignored them.',
          tip: 'Real Belisha beacons flash about once a second. Try waiting 0.5 seconds between on and off.',
        };
      }
      return {
        title: 'The driver didn’t notice the crossing',
        text: 'The beacons weren’t flashing properly when this driver approached the crossing.',
        tip: 'Keep the beacons flashing on and off about once a second, forever.',
      };
    }

    finish() {
      this.ended = true;
    }

    goals() {
      const crashed = !!this.crash;
      return [
        {
          id: 'flash', required: true,
          text: 'Make the beacons flash on and off (about once a second)',
          status: this.flashGood >= 5 ? 'pass' : this.ended || crashed ? 'fail' : 'pending',
          detail: this.flashGood >= 5 ? 'Flashing nicely' : this.flashing() ? 'Flashing…' : 'Not flashing yet',
        },
        {
          id: 'safe', required: true,
          text: 'Everyone crosses safely – no accidents',
          status: crashed ? 'fail' : this.ended ? 'pass' : 'pending',
          detail: `${this.stats.peds} people crossed`,
        },
        {
          id: 'flood', required: false,
          text: 'Bonus: floodlights on when it’s dark, off in daylight',
          status: this.floodFailed ? 'fail' : this.floodNight && this.floodDay ? 'pass' : this.ended ? 'fail' : 'pending',
          detail: this.floodFailed ? 'Floodlights were wrong for too long' : this.floodNight && this.floodDay ? 'Floodlights switched correctly' : 'Use: if dark:',
        },
      ];
    }

    status() {
      const dark = this.readSensor('dark');
      return [
        { label: 'Beacons', value: this.dev.beacon.toUpperCase(), swatch: this.dev.beacon === 'on' ? '#ffb000' : '#555', note: this.flashing() ? 'flashing ✓' : 'not flashing' },
        { label: 'Floodlights', value: this.dev.floodlight.toUpperCase(), swatch: this.dev.floodlight === 'on' ? '#fff3b0' : '#555' },
        { label: 'Sensor: dark', value: dark ? 'TRUE 🌙' : 'FALSE ☀️' },
        { label: 'Drivers who noticed 👁', value: `${this.stats.aware} of ${this.stats.aware + this.stats.unaware}` },
        { label: 'People crossed', value: String(this.stats.peds) },
      ];
    }

    /* ---- drawing ---- */
    buildBg() {
      const c = document.createElement('canvas');
      c.width = W * 2;
      c.height = H * 2;
      const g = c.getContext('2d');
      g.scale(2, 2);
      const r = K.rng(7);
      g.fillStyle = '#86bf6b';
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(60,120,50,0.25)' : 'rgba(170,220,140,0.25)';
        g.fillRect(r() * W, r() * H, 2, 2);
      }
      // gardens and houses
      const roofs = ['#a5533a', '#8d6e63', '#6d4c41', '#b5654b', '#546e7a'];
      for (let i = 0; i < 6; i++) {
        const x = 20 + i * 150;
        g.fillStyle = '#b9b2a6';
        g.fillRect(x + 50, 110, 14, 40);
        K.drawHouse(g, x + 18, 28, 92, 62, roofs[i % roofs.length], '#e8dccb');
        K.drawHouse(g, x + 30, 410, 92, 62, roofs[(i + 2) % roofs.length], '#e8dccb');
        g.fillStyle = '#b9b2a6';
        g.fillRect(x + 62, 370, 14, 40);
      }
      for (let i = 0; i < 9; i++) {
        K.drawTree(g, 10 + i * 105 + r() * 20, 125 + r() * 10, 13 + r() * 5, r);
        K.drawTree(g, 60 + i * 105 + r() * 20, 392 + r() * 6, 12 + r() * 5, r);
      }
      // pavements
      g.fillStyle = '#d6d3cc';
      g.fillRect(0, 148, W, RT - 148);
      g.fillRect(0, RB, W, 372 - RB);
      g.strokeStyle = 'rgba(0,0,0,0.07)';
      g.lineWidth = 1;
      for (let x = 0; x < W; x += 24) {
        g.beginPath();
        g.moveTo(x, 148);
        g.lineTo(x, RT);
        g.moveTo(x + 12, RB);
        g.lineTo(x + 12, 372);
        g.stroke();
      }
      g.fillStyle = '#9e9a93';
      g.fillRect(0, RT - 3, W, 3);
      g.fillRect(0, RB, W, 3);
      // tactile paving at the crossing
      g.fillStyle = '#c9897a';
      g.fillRect(XL + 4, RT - 18, XR - XL - 8, 15);
      g.fillRect(XL + 4, RB + 3, XR - XL - 8, 15);
      // road
      g.fillStyle = '#4b4f56';
      g.fillRect(0, RT, W, RB - RT);
      for (let i = 0; i < 500; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
        g.fillRect(r() * W, RT + r() * (RB - RT), 2, 2);
      }
      // centre line (dashed) away from the zig-zags
      g.fillStyle = '#f2f2f2';
      for (let x = 0; x < W; x += 40) {
        if (x > 230 && x < 650) continue;
        g.fillRect(x, MID - 1.5, 22, 3);
      }
      // zig-zags
      g.strokeStyle = '#f2f2f2';
      g.lineWidth = 2.5;
      const zig = (x0, x1, y, amp) => {
        g.beginPath();
        let up = true;
        g.moveTo(x0, y);
        for (let x = x0 + 12; x <= x1; x += 12) {
          g.lineTo(x, y + (up ? -amp : amp) * 0.5);
          up = !up;
        }
        g.stroke();
      };
      [RT + 7, MID, RB - 7].forEach((y) => {
        zig(240, STOP_E - 6, y, 9);
        zig(STOP_W + 6, 660, y, 9);
      });
      // give-way lines
      g.fillStyle = '#f2f2f2';
      for (let y = RT + 3; y < MID; y += 10) g.fillRect(STOP_E - 3, y, 3, 6);
      for (let y = MID + 2; y < RB - 3; y += 10) g.fillRect(STOP_W, y, 3, 6);
      // zebra stripes
      for (let y = RT + 4; y < RB - 4; y += 17) {
        g.fillStyle = '#f7f7f7';
        g.fillRect(XL, y, XR - XL, 9);
      }
      this.bg = c;
    }

    drawBeacon(ctx, bx, by, on, flood) {
      const h = 32;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(bx + 5, by + 2, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#f5f5f5' : '#1a1a1a';
        ctx.fillRect(bx - 2.2, by - (i + 1) * (h / 8), 4.4, h / 8);
      }
      // floodlight head
      ctx.fillStyle = flood ? '#fff6c2' : '#7a7a7a';
      ctx.fillRect(bx - 6, by - h + 7, 12, 4);
      ctx.fillStyle = on ? '#ffb300' : '#8f6a2a';
      ctx.beginPath();
      ctx.arc(bx, by - h - 6, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (on) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(bx - 2, by - h - 8, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    draw(ctx) {
      if (!this.bg) this.buildBg();
      ctx.drawImage(this.bg, 0, 0, W, H);
      const d = darkness(this.t);
      const on = this.dev.beacon === 'on';
      const flood = this.dev.floodlight === 'on';
      const beacons = [[XL - 14, RT - 2], [XR + 14, RT - 2], [XL - 14, RB + 32], [XR + 14, RB + 32]];

      for (const p of this.peds) {
        if (this.crash && this.crash.ped === p) continue;
        K.drawPerson(ctx, p.x, p.y, p.ang, p.color, p.phase, { hair: p.hair, alpha: p.fade == null ? 1 : p.fade });
      }
      for (const c of this.cars) {
        let ang = c.dir > 0 ? 0 : Math.PI;
        if (this.crash && this.crash.car === c) ang += Math.sin(this.crash.age * 3) * 0.25 * Math.min(1, this.crash.age * 3);
        K.drawCar(ctx, c.x, c.y, ang, c.color, { braking: c.braking || (this.crash && this.crash.car === c), len: CL, wid: CW });
      }
      if (this.crash) {
        const p = this.crash.ped;
        K.drawPerson(ctx, p.x, p.y, p.ang + this.crash.age * 2, p.color, 0, { hair: p.hair });
      }
      beacons.forEach(([x, y]) => this.drawBeacon(ctx, x, y, on, flood));

      if (d > 0) {
        ctx.fillStyle = `rgba(8,14,44,${0.62 * d})`;
        ctx.fillRect(0, 0, W, H);
      }
      // light pass
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (flood) {
        K.glow(ctx, XC, MID, 150, '255,240,190', 0.18 + 0.3 * d);
        beacons.forEach(([x, y]) => K.glow(ctx, x, y - 23, 20, '255,250,220', 0.5));
      }
      if (on) beacons.forEach(([x, y]) => K.glow(ctx, x, y - 38, 34 + 16 * d, '255,170,0', 0.55 + 0.3 * d));
      if (d > 0.15) {
        for (const c of this.cars) {
          K.drawBeam(ctx, c.x + (c.dir * CL) / 2, c.y, c.dir > 0 ? 0 : Math.PI, 110, 0.35 * d);
        }
        for (let i = 0; i < 6; i++) {
          // windows glowing at night
          ctx.fillStyle = `rgba(255,210,120,${0.5 * d})`;
          ctx.fillRect(20 + i * 150 + 45, 50, 10, 8);
          ctx.fillRect(20 + i * 150 + 72, 432, 10, 8);
        }
      }
      ctx.restore();

      // drivers who have noticed the crossing
      for (const c of this.cars) {
        const front = c.x + (c.dir * CL) / 2;
        const before = c.dir > 0 ? front < XR : front > XL;
        if (c.aware && before) K.drawEye(ctx, c.x, c.y - CW / 2 - 8);
      }
      this.fx.draw(ctx);
      if (this.crash) K.drawCrashBurst(ctx, this.crash.x, this.crash.y, this.crash.age);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#86bf6b"/>
    <rect y="38" width="240" height="14" fill="#d6d3cc"/><rect y="98" width="240" height="14" fill="#d6d3cc"/>
    <rect y="52" width="240" height="46" fill="#4b4f56"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="104" y="${55 + i * 9}" width="32" height="5" fill="#f7f7f7"/>`).join('')}
    <rect x="58" y="78" width="30" height="12" rx="3" fill="#3f88c5"/><rect x="158" y="58" width="30" height="12" rx="3" fill="#e94f37"/>
    <g><rect x="96" y="20" width="3" height="20" fill="#222"/><circle cx="97.5" cy="18" r="6" fill="#ffb300"/><circle cx="97.5" cy="18" r="12" fill="#ffb300" opacity=".3"/></g>
    <g><rect x="142" y="92" width="3" height="20" fill="#222"/><circle cx="143.5" cy="90" r="6" fill="#ffb300"/><circle cx="143.5" cy="90" r="12" fill="#ffb300" opacity=".3"/></g>
    <circle cx="118" cy="44" r="5" fill="#d7263d"/>
  </svg>`;

  FL.scenarios = FL.scenarios || [];
  FL.scenarios.push({
    id: 'zebra',
    order: 1,
    title: 'Zebra Crossing Beacons',
    tagline: 'Make the Belisha beacons flash so drivers stop for people crossing.',
    difficulty: 'Beginner',
    concepts: ['Sequence', 'Forever loops', 'Wait', 'If / else (bonus)'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>At a UK zebra crossing, black-and-white poles with flashing orange globes – called <b>Belisha beacons</b> – warn drivers that people might step out.</p>
      <p>Drivers are trained to look out for the <b>flashing</b>. A light that just stays on looks like an ordinary street lamp, so nobody slows down.</p>
      <p><b>Your job:</b> program the beacons so they flash on and off, about once a second, for the whole simulation.</p>
      <p><b>Bonus:</b> it gets dark halfway through. Use the <code>dark</code> sensor to switch the floodlights on at night and off again in the daytime.</p>
      <p class="muted">Tip: drivers with a 👁 above their car have noticed the crossing.</p>`,
    devices: {
      beacon: {
        label: 'beacon', aliases: ['beacons', 'belisha beacon', 'belisha beacons', 'light', 'lights'],
        states: ['on', 'off'], stateColors: { on: '#ffb300', off: '#5b5b5b' }, describe: 'The flashing orange globes on top of the poles.',
      },
      floodlight: {
        label: 'floodlight', aliases: ['floodlights', 'flood light', 'flood lights', 'lamp'],
        states: ['on', 'off'], stateColors: { on: '#ffe680', off: '#5b5b5b' }, describe: 'Lights up the crossing so drivers can see people at night.',
      },
    },
    sensors: {
      dark: 'True when it is night-time.',
      'pedestrian waiting': 'True when someone is waiting at the kerb to cross.',
    },
    snippets: { set: 'set beacon on', sensor: 'dark' },
    starter: `# Belisha beacons warn drivers about the zebra crossing.
# Drivers only notice them when they FLASH on and off.
#
# This program turns the beacons on... and that's all.
# Press Run to see what happens, then fix it!

set beacon on
`,
    solution: `# Flash the Belisha beacons forever
forever:
    set beacon on
    wait 0.5
    set beacon off
    wait 0.5
    # Bonus: floodlights on only at night
    if dark:
        set floodlight on
    else:
        set floodlight off
`,
    hints: [
      'A steady light isn’t enough – the beacon has to go on AND off.',
      'Use "wait 0.5" after each change so people can see it.',
      'Wrap your steps in "forever:" and indent them underneath, so they repeat.',
      'Bonus: inside the loop, add "if dark:" to turn the floodlight on, and "else:" to turn it off.',
    ],
    create: () => new ZebraSim(),
  });
})();
