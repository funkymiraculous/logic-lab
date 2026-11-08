/* Scenario 2: Traffic lights controlling a single-lane bridge. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;

  const W = 900, H = 520;
  const RT = 214, RB = 306, BY = 260;
  const LANE_E = 237, LANE_W = 283; // UK: eastbound on the top lane
  const RIV_L = 340, RIV_R = 560;
  const BR_L = 330, BR_R = 570, TAPER = 42;
  const STOP_WEST = 272, STOP_EAST = 628;
  const CL = 44, CW = 22;
  const VMAX = 110, ACC = 80, DEC = 200;
  const DURATION = 90;
  const TARGET = 22;
  const MAX_WAIT = 40;
  const CAR_COLORS = ['#e94f37', '#3f88c5', '#f6ae2d', '#44af69', '#8e6c8a', '#eeeeee', '#2b2d42', '#ff8c42', '#1b998b', '#c0392b'];
  const NEXT = { red: 'red amber', 'red amber': 'green', green: 'amber', amber: 'red' };
  const LAMP = { red: '#ff3b30', amber: '#ffb000', green: '#2fd158' };

  function laneY(dir, x) {
    const base = dir > 0 ? LANE_E : LANE_W;
    let f;
    if (x < BR_L - TAPER || x > BR_R + TAPER) f = 0;
    else if (x < BR_L) f = (x - (BR_L - TAPER)) / TAPER;
    else if (x <= BR_R) f = 1;
    else f = (BR_R + TAPER - x) / TAPER;
    f = f * f * (3 - 2 * f);
    return base + (BY - base) * f;
  }

  class BridgeSim {
    constructor() {
      this.W = W;
      this.H = H;
      this.duration = DURATION;
      this.bg = null;
      this.reset();
    }

    reset() {
      this.t = 0;
      this.rng = K.rng(424242);
      this.dev = { west: 'red', east: 'red' };
      this.cars = [];
      this.fx = new K.Fx();
      this.crash = null;
      this.ended = false;
      this.nid = 0;
      this.spawnE = 0.2;
      this.spawnW = 0.9;
      this.crossed = 0;
      this.maxWait = 0;
      this.lastBothGo = -100;
      this.seqFailed = false;
      this.seqMsg = '';
      this.usedRedAmber = false;
    }

    setDevice(n, s) {
      const prev = this.dev[n];
      if (prev === s) return;
      if (NEXT[prev] !== s && !this.seqFailed) {
        this.seqFailed = true;
        this.seqMsg = `${n} lights went from ${prev.toUpperCase()} straight to ${s.toUpperCase()}`;
      }
      if (s === 'red amber') this.usedRedAmber = true;
      this.dev[n] = s;
    }
    getDevice(n) {
      return this.dev[n];
    }
    distToLine(c) {
      const front = c.x + (c.dir * CL) / 2;
      return c.dir > 0 ? STOP_WEST - front : front - STOP_EAST;
    }
    onBridge(c) {
      return c.passed && (c.dir > 0 ? c.x - CL / 2 < BR_R + TAPER : c.x + CL / 2 > BR_L - TAPER);
    }
    readSensor(n) {
      switch (n) {
        case 'bridge clear':
          return !this.cars.some((c) => this.onBridge(c));
        case 'car on bridge':
          return this.cars.some((c) => this.onBridge(c));
        case 'car waiting west':
          return this.cars.some((c) => c.dir > 0 && !c.passed && this.distToLine(c) < 150);
        case 'car waiting east':
          return this.cars.some((c) => c.dir < 0 && !c.passed && this.distToLine(c) < 150);
      }
      return false;
    }

    newCar(dir) {
      const v = VMAX * (0.9 + this.rng() * 0.1);
      const x = dir > 0 ? -30 : W + 30;
      return { id: ++this.nid, dir, x, y: laneY(dir, x), v, vmax: v, color: CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)], passed: false, wait: 0, braking: false, amber: null };
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

    update(dt) {
      if (this.crash) {
        this.crash.age += dt;
        this.fx.update(dt);
        return;
      }
      this.t += dt;
      const go = (s) => s === 'green' || s === 'amber';
      if (go(this.dev.west) && go(this.dev.east)) this.lastBothGo = this.t;

      this.spawnE -= dt;
      this.spawnW -= dt;
      if (this.spawnE <= 0) {
        if (!this.cars.some((c) => c.dir > 0 && c.x < 45)) {
          this.cars.push(this.newCar(1));
          this.spawnE = 2.6 + this.rng() * 3.4;
        } else this.spawnE = 0.5;
      }
      if (this.spawnW <= 0) {
        if (!this.cars.some((c) => c.dir < 0 && c.x > W - 45)) {
          this.cars.push(this.newCar(-1));
          this.spawnW = 2.6 + this.rng() * 3.4;
        } else this.spawnW = 0.5;
      }

      for (const c of this.cars) {
        const dist = this.distToLine(c);
        let target = c.vmax;
        if (!c.passed) {
          const light = this.dev[c.dir > 0 ? 'west' : 'east'];
          if (dist < -0.5) {
            c.passed = true;
            if (light === 'red' || light === 'red amber') c.ranRed = true;
          } else {
            let stop = false;
            if (light === 'red' || light === 'red amber') stop = true;
            else if (light === 'amber') {
              if (c.amber == null) c.amber = (c.v * c.v) / (2 * DEC) < dist - 1 || c.v < 25 ? 'stop' : 'go';
              stop = c.amber === 'stop';
            }
            if (light !== 'amber') c.amber = null;
            if (stop) target = Math.min(target, Math.sqrt(2 * DEC * Math.max(0, dist - 0.5)));
          }
        }
        const a = this.ahead(c);
        if (a) {
          const gap = Math.abs(a.x - c.x) - CL;
          const lim = Math.sqrt(Math.max(0, a.v * a.v + 2 * DEC * (gap - 12)));
          target = Math.min(target, gap < 12 ? 0 : lim);
        }
        c.braking = target < c.v - 2;
        if (c.v < target) c.v = Math.min(target, c.v + ACC * dt);
        else c.v = Math.max(target, c.v - DEC * 2.2 * dt);
        c.x += c.dir * c.v * dt;
        const ny = laneY(c.dir, c.x);
        c.ang = Math.atan2((ny - c.y) || 0, c.dir * Math.max(0.001, c.v * dt));
        if (c.v * dt < 0.01) c.ang = c.dir > 0 ? 0 : Math.PI;
        c.y = ny;
        if (!c.passed && c.v < 5) {
          c.wait += dt;
          if (c.wait > this.maxWait) this.maxWait = c.wait;
        }
        if (!c.counted && c.passed && !this.onBridge(c)) {
          c.counted = true;
          this.crossed++;
        }
      }
      this.cars = this.cars.filter((c) => c.x > -80 && c.x < W + 80);

      // head-on collisions
      for (const a of this.cars) {
        if (a.dir < 0) continue;
        for (const b of this.cars) {
          if (b.dir > 0) continue;
          if (Math.abs(a.x - b.x) < CL - 6 && Math.abs(a.y - b.y) < CW - 4) {
            this.crash = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, age: 0, cars: [a, b], reason: this.diagnose(a, b) };
            a.v = b.v = 0;
            this.fx.burst(this.crash.x, this.crash.y, this.rng);
            return;
          }
        }
      }
      this.fx.update(dt);
    }

    diagnose(a, b) {
      if (a.ranRed || b.ranRed) {
        return {
          title: 'Head-on crash on the bridge!',
          text: 'A light went straight from green to red while a car was right at the line. The driver couldn’t stop in time, so they carried on onto the bridge – and met traffic coming the other way.',
          tip: 'Warn drivers first: show AMBER for a few seconds between green and red, then wait for the bridge to clear.',
        };
      }
      if (this.t - this.lastBothGo < 9) {
        return {
          title: 'Head-on crash on the bridge!',
          text: 'Both sets of lights were letting traffic onto the bridge at the same time, so two cars met in the middle.',
          tip: 'Only one side should ever be green (or amber). Turn one side RED before the other side goes GREEN.',
        };
      }
      return {
        title: 'Head-on crash on the bridge!',
        text: 'A car was still driving across the bridge when the other side’s light turned green.',
        tip: 'After a light turns red, give the bridge time to empty before the other side goes green – try "wait 5", or better, "wait until bridge clear".',
      };
    }

    finish() {
      this.ended = true;
    }

    goals() {
      const crashed = !!this.crash;
      return [
        {
          id: 'safe', required: true, text: 'No crashes on the bridge',
          status: crashed ? 'fail' : this.ended ? 'pass' : 'pending',
          detail: crashed ? 'Two cars collided' : this.ended ? 'Every car crossed safely' : 'So far so good',
        },
        {
          id: 'flow', required: true, text: `Get ${TARGET} cars safely across`,
          status: this.crossed >= TARGET ? 'pass' : this.ended || crashed ? 'fail' : 'pending',
          detail: `${this.crossed} / ${TARGET} crossed`,
        },
        {
          id: 'wait', required: true, text: `Nobody waits longer than ${MAX_WAIT} seconds at a red light`,
          status: this.maxWait > MAX_WAIT ? 'fail' : this.ended ? 'pass' : 'pending',
          detail: `Longest wait: ${Math.round(this.maxWait)} s`,
        },
        {
          id: 'seq', required: false, text: 'Bonus: use the real UK sequence – red → red + amber → green → amber → red',
          status: this.seqFailed ? 'fail' : this.ended && this.usedRedAmber ? 'pass' : this.ended ? 'fail' : 'pending',
          detail: this.seqFailed ? this.seqMsg : 'Every change must follow the sequence',
        },
      ];
    }

    status() {
      const sw = (s) => (s === 'red amber' ? ['#ff3b30', '#ffb000'] : [LAMP[s]]);
      const onBridge = this.cars.filter((c) => this.onBridge(c)).length;
      return [
        { label: 'West lights', value: this.dev.west.toUpperCase(), swatches: sw(this.dev.west) },
        { label: 'East lights', value: this.dev.east.toUpperCase(), swatches: sw(this.dev.east) },
        { label: 'Cars on bridge', value: String(onBridge), note: onBridge ? '' : 'bridge clear ✓' },
        { label: 'Cars across', value: `${this.crossed} / ${TARGET}` },
        { label: 'Longest wait', value: `${Math.round(this.maxWait)} s` },
      ];
    }

    /* ---- drawing ---- */
    buildBg() {
      const c = document.createElement('canvas');
      c.width = W * 2;
      c.height = H * 2;
      const g = c.getContext('2d');
      g.scale(2, 2);
      const r = K.rng(99);
      g.fillStyle = '#80b960';
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 1000; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(60,120,50,0.25)' : 'rgba(180,225,140,0.25)';
        g.fillRect(r() * W, r() * H, 2, 2);
      }
      // river banks
      g.fillStyle = '#c9b98a';
      g.beginPath();
      g.moveTo(RIV_L - 18, 0);
      for (let y = 0; y <= H; y += 20) g.lineTo(RIV_L - 14 - Math.sin(y * 0.03) * 6, y);
      g.lineTo(RIV_R + 14, H);
      for (let y = H; y >= 0; y -= 20) g.lineTo(RIV_R + 14 + Math.sin(y * 0.025 + 1) * 6, y);
      g.closePath();
      g.fill();
      const wg = g.createLinearGradient(RIV_L, 0, RIV_R, 0);
      wg.addColorStop(0, '#2f78b7');
      wg.addColorStop(0.5, '#3d8fd1');
      wg.addColorStop(1, '#2f78b7');
      g.fillStyle = wg;
      g.beginPath();
      g.moveTo(RIV_L, 0);
      for (let y = 0; y <= H; y += 20) g.lineTo(RIV_L - Math.sin(y * 0.03) * 6, y);
      g.lineTo(RIV_R, H);
      for (let y = H; y >= 0; y -= 20) g.lineTo(RIV_R + Math.sin(y * 0.025 + 1) * 6, y);
      g.closePath();
      g.fill();
      // reeds and trees
      for (let i = 0; i < 26; i++) {
        const side = i % 2 ? RIV_L - 20 : RIV_R + 20;
        const y = r() * H;
        if (Math.abs(y - BY) < 70) continue;
        g.strokeStyle = '#5e8c3a';
        g.lineWidth = 1.5;
        for (let k = 0; k < 4; k++) {
          g.beginPath();
          g.moveTo(side + k * 3, y);
          g.lineTo(side + k * 3 + (r() - 0.5) * 6, y - 8 - r() * 6);
          g.stroke();
        }
      }
      const trees = [[60, 90], [140, 60], [220, 120], [90, 400], [180, 450], [260, 390], [650, 80], [740, 140], [830, 70], [680, 420], [780, 460], [860, 390], [40, 470], [300, 470], [620, 470]];
      trees.forEach(([x, y]) => K.drawTree(g, x, y, 15 + r() * 7, r));
      K.drawHouse(g, 120, 140, 70, 44, '#a5533a', '#e8dccb');
      K.drawHouse(g, 720, 352, 78, 46, '#546e7a', '#e8dccb');

      // roads
      g.fillStyle = '#9e9a93';
      g.fillRect(0, RT - 4, BR_L - TAPER, 4);
      g.fillRect(0, RB, BR_L - TAPER, 4);
      g.fillRect(BR_R + TAPER, RT - 4, W, 4);
      g.fillRect(BR_R + TAPER, RB, W, 4);
      g.fillStyle = '#4b4f56';
      g.fillRect(0, RT, BR_L - TAPER, RB - RT);
      g.fillRect(BR_R + TAPER, RT, W - BR_R - TAPER, RB - RT);
      g.beginPath();
      g.moveTo(BR_L - TAPER, RT);
      g.lineTo(BR_L, BY - 24);
      g.lineTo(BR_R, BY - 24);
      g.lineTo(BR_R + TAPER, RT);
      g.lineTo(BR_R + TAPER, RB);
      g.lineTo(BR_R, BY + 24);
      g.lineTo(BR_L, BY + 24);
      g.lineTo(BR_L - TAPER, RB);
      g.closePath();
      g.fill();
      // bridge shadow + deck
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(BR_L + 6, BY + 26, BR_R - BR_L - 6, 10);
      g.fillStyle = '#585c63';
      g.fillRect(BR_L, BY - 24, BR_R - BR_L, 48);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
        g.fillRect(r() * W, RT + r() * (RB - RT), 2, 2);
      }
      // parapets
      g.fillStyle = '#b8a98c';
      g.fillRect(BR_L - 4, BY - 30, BR_R - BR_L + 8, 6);
      g.fillRect(BR_L - 4, BY + 24, BR_R - BR_L + 8, 6);
      g.fillStyle = '#8f8168';
      for (let x = BR_L; x <= BR_R; x += 20) {
        g.fillRect(x - 2, BY - 31, 4, 8);
        g.fillRect(x - 2, BY + 23, 4, 8);
      }
      // markings
      g.fillStyle = '#f2f2f2';
      for (let x = 0; x < STOP_WEST - 30; x += 40) g.fillRect(x, BY - 1.5, 22, 3);
      for (let x = STOP_EAST + 30; x < W; x += 40) g.fillRect(x, BY - 1.5, 22, 3);
      g.fillRect(STOP_WEST - 30, BY - 1.5, 30, 3);
      g.fillRect(STOP_EAST, BY - 1.5, 30, 3);
      g.fillRect(STOP_WEST, RT + 2, 4, BY - RT - 2); // stop lines
      g.fillRect(STOP_EAST - 4, BY, 4, RB - BY - 2);
      g.font = '800 10px Nunito, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('STOP', STOP_WEST - 22, LANE_E + 4);
      g.save();
      g.translate(STOP_EAST + 22, LANE_W - 4);
      g.rotate(Math.PI);
      g.fillText('STOP', 0, 0);
      g.restore();
      // single-lane warning signs
      const sign = (x, y) => {
        g.fillStyle = '#555';
        g.fillRect(x - 1.5, y, 3, 18);
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
        g.fillRect(x - 4, y - 5, 2.5, 8);
        g.fillRect(x + 1.5, y - 5, 2.5, 8);
      };
      sign(200, 192);
      sign(700, 336);
      this.bg = c;
    }

    drawSignal(ctx, x, y, state, name) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      K.rr(ctx, x - 7, y - 20, 20, 48, 5);
      ctx.fill();
      ctx.fillStyle = '#555';
      ctx.fillRect(x - 1.5, y + 22, 3, 14);
      ctx.fillStyle = '#1c1f24';
      K.rr(ctx, x - 10, y - 24, 20, 48, 5);
      ctx.fill();
      const lit = { red: state === 'red' || state === 'red amber', amber: state === 'amber' || state === 'red amber', green: state === 'green' };
      const lamps = [['red', -13], ['amber', 0], ['green', 13]];
      for (const [col, dy] of lamps) {
        ctx.fillStyle = lit[col] ? LAMP[col] : K.shade(LAMP[col], -0.72);
        ctx.beginPath();
        ctx.arc(x, y + dy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.font = '800 11px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      K.rr(ctx, x - 20, y - 44, 40, 15, 7);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(name, x, y - 33);
      return lamps.filter(([col]) => lit[col]).map(([col, dy]) => [x, y + dy, col]);
    }

    draw(ctx) {
      if (!this.bg) this.buildBg();
      ctx.drawImage(this.bg, 0, 0, W, H);
      // flowing water ripples
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) {
        const x = RIV_L + 18 + ((i * 53) % (RIV_R - RIV_L - 36));
        const y = ((i * 97 + this.t * 28) % (H + 40)) - 20;
        if (Math.abs(y - BY) < 40) continue;
        ctx.beginPath();
        ctx.moveTo(x - 10, y);
        ctx.quadraticCurveTo(x, y + 5, x + 10, y);
        ctx.stroke();
      }
      for (const c of this.cars) {
        let ang = c.ang == null ? (c.dir > 0 ? 0 : Math.PI) : c.ang;
        const hit = this.crash && this.crash.cars.includes(c);
        if (hit) ang += (c.dir > 0 ? -1 : 1) * Math.min(0.5, this.crash.age * 1.2);
        K.drawCar(ctx, c.x, c.y, ang, c.color, { braking: c.braking || hit, len: CL, wid: CW });
      }
      // parapets drawn over cars at the edge for depth
      ctx.fillStyle = '#b8a98c';
      ctx.fillRect(BR_L - 4, BY - 30, BR_R - BR_L + 8, 6);
      ctx.fillRect(BR_L - 4, BY + 24, BR_R - BR_L + 8, 6);

      const litW = this.drawSignal(ctx, STOP_WEST - 18, 178, this.dev.west, 'WEST');
      const litE = this.drawSignal(ctx, STOP_EAST + 18, 342, this.dev.east, 'EAST');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const rgb = { red: '255,60,40', amber: '255,170,0', green: '40,220,90' };
      [...litW, ...litE].forEach(([x, y, col]) => K.glow(ctx, x, y, 16, rgb[col], 0.7));
      ctx.restore();

      this.fx.draw(ctx);
      if (this.crash) K.drawCrashBurst(ctx, this.crash.x, this.crash.y, this.crash.age);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#80b960"/>
    <rect x="88" width="64" height="140" fill="#3d8fd1"/>
    <rect y="52" width="80" height="36" fill="#4b4f56"/><rect x="160" y="52" width="80" height="36" fill="#4b4f56"/>
    <polygon points="80,52 92,60 148,60 160,52 160,88 148,80 92,80 80,88" fill="#4b4f56"/>
    <rect x="88" y="57" width="64" height="3" fill="#b8a98c"/><rect x="88" y="80" width="64" height="3" fill="#b8a98c"/>
    <rect x="30" y="56" width="26" height="12" rx="3" fill="#3f88c5"/><rect x="184" y="72" width="26" height="12" rx="3" fill="#f6ae2d"/>
    <g><rect x="64" y="22" width="12" height="28" rx="3" fill="#1c1f24"/><circle cx="70" cy="29" r="3" fill="#4a1512"/><circle cx="70" cy="36" r="3" fill="#4a3a10"/><circle cx="70" cy="43" r="3" fill="#2fd158"/></g>
    <g><rect x="164" y="92" width="12" height="28" rx="3" fill="#1c1f24"/><circle cx="170" cy="99" r="3" fill="#ff3b30"/><circle cx="170" cy="106" r="3" fill="#4a3a10"/><circle cx="170" cy="113" r="3" fill="#0f3a1c"/></g>
  </svg>`;

  FL.scenarios = FL.scenarios || [];
  FL.scenarios.push({
    id: 'bridge',
    order: 1,
    title: 'Single-Lane Bridge Lights',
    tagline: 'Control traffic lights at both ends of a narrow bridge – one direction at a time!',
    difficulty: 'Intermediate',
    concepts: ['Sequence', 'Timing', 'Wait until', 'Sensors', 'Safety logic'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>This old stone bridge is only wide enough for <b>one lane of traffic</b>. Traffic lights at the <b>west</b> and <b>east</b> ends take turns letting cars across.</p>
      <p>Drivers trust the lights completely: they drive on green, and on red they stop at the line. If cars from both sides end up on the bridge together, they crash head-on!</p>
      <p><b>Your job:</b> give each side a turn, keep the traffic moving, and make sure the bridge is <b>empty</b> before the other side goes green.</p>
      <p><b>Bonus:</b> use the real UK sequence: <span class="seq"><i class="l r"></i>red → <i class="l r"></i><i class="l a"></i>red + amber → <i class="l g"></i>green → <i class="l a"></i>amber → <i class="l r"></i>red</span>.</p>
      <p class="muted">Tip: crossing the bridge from a standstill takes about 4–5 seconds.</p>`,
    devices: {
      west: {
        label: 'west lights', aliases: ['west light', 'west lights', 'west side'],
        states: ['red', 'red amber', 'amber', 'green'],
        stateAliases: { yellow: 'amber', orange: 'amber', 'red yellow': 'red amber', 'amber red': 'red amber', 'red orange': 'red amber' },
        stateColors: { red: '#ff3b30', amber: '#ffb000', green: '#2fd158' },
        describe: 'The lights for cars coming from the west (left), heading east.',
      },
      east: {
        label: 'east lights', aliases: ['east light', 'east lights', 'east side'],
        states: ['red', 'red amber', 'amber', 'green'],
        stateAliases: { yellow: 'amber', orange: 'amber', 'red yellow': 'red amber', 'amber red': 'red amber', 'red orange': 'red amber' },
        stateColors: { red: '#ff3b30', amber: '#ffb000', green: '#2fd158' },
        describe: 'The lights for cars coming from the east (right), heading west.',
      },
    },
    sensors: {
      'bridge clear': 'True when there are no cars on the bridge.',
      'car on bridge': 'True when at least one car is on the bridge.',
      'car waiting west': 'True when a car is queuing at the west lights.',
      'car waiting east': 'True when a car is queuing at the east lights.',
    },
    snippets: { set: 'set west green', sensor: 'bridge clear' },
    starter: `# This bridge only has room for ONE lane of traffic.
# The lights at each end take turns letting cars across.
#
# This program swaps the lights straight over.
# Press Run - will every car make it across safely?

forever:
    set west green
    wait 8
    set west red
    set east green
    wait 8
    set east red
`,
    solution: `# One side at a time, using the real UK light sequence
forever:
    # --- West side's turn ---
    set west red amber
    wait 2
    set west green
    wait 10
    set west amber
    wait 3
    set west red
    wait until bridge clear
    wait 1

    # --- East side's turn ---
    set east red amber
    wait 2
    set east green
    wait 10
    set east amber
    wait 3
    set east red
    wait until bridge clear
    wait 1
`,
    hints: [
      'Run the starter program and watch closely: what is on the bridge when the east lights turn green?',
      'Cars that entered just before the light changed are still crossing. Add a gap where BOTH lights are red.',
      'Instead of guessing a time, use "wait until bridge clear" after turning a light red.',
      'Bonus: before green, show "red amber" for 2 seconds; after green, show "amber" for 3 seconds, then red.',
    ],
    create: () => new BridgeSim(),
  });
})();
