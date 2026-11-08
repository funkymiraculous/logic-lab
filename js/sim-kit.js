/* Shared helpers for the scenario simulations: random numbers, drawing, effects. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return `rgb(${r},${g},${b})`;
  }

  /* Top-down car, centred on (x,y), facing angle `ang` (0 = east). */
  function drawCar(ctx, x, y, ang, color, o = {}) {
    const L = o.len || 46;
    const W = o.wid || 24;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    rr(ctx, -L / 2 + 2, -W / 2 + 3, L, W, 7);
    ctx.fill();
    ctx.fillStyle = color;
    rr(ctx, -L / 2, -W / 2, L, W, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = shade(color, -0.2);
    rr(ctx, -L / 2 + 8, -W / 2 + 3, L - 20, W - 6, 4);
    ctx.fill();
    ctx.fillStyle = '#22303f';
    rr(ctx, L / 2 - 17, -W / 2 + 3.5, 6, W - 7, 2);
    ctx.fill();
    rr(ctx, -L / 2 + 7, -W / 2 + 4.5, 4, W - 9, 1.5);
    ctx.fill();
    ctx.fillStyle = shade(color, 0.22);
    rr(ctx, -L / 2 + 13, -W / 2 + 5, L - 31, W - 10, 3);
    ctx.fill();
    ctx.fillStyle = '#fff7d1';
    ctx.fillRect(L / 2 - 2.5, -W / 2 + 2.5, 2.5, 4.5);
    ctx.fillRect(L / 2 - 2.5, W / 2 - 7, 2.5, 4.5);
    ctx.fillStyle = o.braking ? '#ff2a2a' : '#8c1c1c';
    ctx.fillRect(-L / 2, -W / 2 + 2.5, 2.5, 4.5);
    ctx.fillRect(-L / 2, W / 2 - 7, 2.5, 4.5);
    ctx.fillStyle = shade(color, -0.35);
    ctx.fillRect(L / 2 - 16, -W / 2 - 2, 3, 2);
    ctx.fillRect(L / 2 - 16, W / 2, 3, 2);
    ctx.restore();
  }

  function drawBeam(ctx, x, y, ang, len, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgba(255,244,190,${alpha})`);
    g.addColorStop(1, 'rgba(255,244,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(len, -28);
    ctx.lineTo(len, 28);
    ctx.lineTo(0, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function glow(ctx, x, y, r, rgb, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.35, `rgba(${rgb},${alpha * 0.45})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Top-down pedestrian facing angle `ang`. */
  function drawPerson(ctx, x, y, ang, color, phase, o = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(1.5, 2, 6, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const s = Math.sin(phase) * 4;
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.ellipse(s, -3.2, 3, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(-s, 3.2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = o.hair || '#4a3020';
    ctx.beginPath();
    ctx.arc(0.5, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTree(ctx, x, y, r, rnd) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(x + 4, y + 5, r, 0, Math.PI * 2);
    ctx.fill();
    const greens = ['#3f8f3a', '#4b9e44', '#357a31'];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rnd() * 0.5;
      ctx.fillStyle = greens[i % 3];
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHouse(ctx, x, y, w, h, roof, wall) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + 5, y + 6, w, h);
    ctx.fillStyle = wall;
    ctx.fillRect(x, y, w, h);
    // roof seen from above: two slopes
    ctx.fillStyle = roof;
    ctx.fillRect(x - 3, y - 3, w + 6, h / 2 + 3);
    ctx.fillStyle = shade(roof, -0.18);
    ctx.fillRect(x - 3, y + h / 2, w + 6, h / 2 + 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + h / 2);
    ctx.lineTo(x + w + 3, y + h / 2);
    ctx.stroke();
    ctx.fillStyle = '#7a4b3a';
    ctx.fillRect(x + w * 0.7, y + 4, 8, 8); // chimney
  }

  class Fx {
    constructor() {
      this.p = [];
    }
    burst(x, y, rnd) {
      const cols = ['#ffd23f', '#ff7b00', '#ff3c00', '#ffffff', '#ffb703'];
      for (let i = 0; i < 50; i++) {
        const a = rnd() * Math.PI * 2;
        const s = 50 + rnd() * 190;
        const life = 0.5 + rnd() * 0.8;
        this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: 1.5 + rnd() * 3.5, color: cols[i % cols.length] });
      }
      for (let i = 0; i < 16; i++) {
        const a = rnd() * Math.PI * 2;
        const s = 10 + rnd() * 40;
        const life = 1.2 + rnd() * 1.4;
        this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, life, max: life, size: 8 + rnd() * 10, color: 'smoke', grow: 14 });
      }
    }
    update(dt) {
      const drag = Math.pow(0.08, dt);
      for (const p of this.p) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.life -= dt;
        if (p.grow) p.size += p.grow * dt;
      }
      this.p = this.p.filter((p) => p.life > 0);
    }
    draw(ctx) {
      for (const p of this.p) {
        const a = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color === 'smoke' ? `rgba(90,90,95,${a * 0.45})` : p.color;
        ctx.globalAlpha = p.color === 'smoke' ? 1 : a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawCrashBurst(ctx, x, y, age, label) {
    label = label || 'CRASH!';
    const s = Math.min(1, age * 7) * (1 + Math.sin(age * 14) * 0.05) * Math.max(1, label.length / 6.5);
    ctx.save();
    ctx.translate(x, y - 6);
    ctx.scale(s, s);
    ctx.rotate(-0.12);
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? 22 : 40;
      const a = (i / (n * 2)) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r * 1.25, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffe03a';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e8590c';
    ctx.stroke();
    ctx.fillStyle = '#c92a2a';
    ctx.font = '900 17px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.min(17, 110 / label.length)}px Nunito, system-ui, sans-serif`;
    ctx.fillText(label, 0, 1);
    ctx.restore();
  }

  /* Eye badge shown above drivers who have noticed a hazard. */
  function drawEye(ctx, x, y) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(x, y, 7, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------- traffic signal (vertical housing). state: red | red amber | amber | green | off ---------- */
  const LAMP = { red: '#ff3b30', amber: '#ffb000', green: '#2fd158' };
  const LAMP_RGB = { red: '255,60,40', amber: '255,170,0', green: '40,220,90' };
  function drawSignal(ctx, x, y, state, name, o = {}) {
    const sc = o.scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    rr(ctx, -7, -20, 20, 48, 5);
    ctx.fill();
    ctx.fillStyle = '#555';
    ctx.fillRect(-1.5, 22, 3, 12);
    ctx.fillStyle = '#1c1f24';
    rr(ctx, -10, -24, 20, 48, 5);
    ctx.fill();
    const lit = {
      red: state === 'red' || state === 'red amber',
      amber: state === 'amber' || state === 'red amber' || (state === 'flashing amber' && o.blink),
      green: state === 'green',
    };
    const lamps = [['red', -13], ['amber', 0], ['green', 13]];
    for (const [col, dy] of lamps) {
      ctx.fillStyle = lit[col] ? LAMP[col] : shade(LAMP[col], -0.72);
      ctx.beginPath();
      ctx.arc(0, dy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (name) {
      ctx.font = '800 10px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      const w = Math.max(30, ctx.measureText(name).width + 12);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      rr(ctx, -w / 2, -42, w, 14, 7);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(name, 0, -32);
    }
    ctx.restore();
    return lamps.filter(([col]) => lit[col]).map(([col, dy]) => [x, y + dy * sc, col]);
  }
  function signalGlow(ctx, lamps) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    lamps.forEach(([x, y, col]) => glow(ctx, x, y, 15, LAMP_RGB[col], 0.7));
    ctx.restore();
  }
  const swatchesFor = (s) => (s === 'red amber' ? [LAMP.red, LAMP.amber] : LAMP[s] ? [LAMP[s]] : ['#555']);

  /* Barrier arm seen from above. p: 0 = down (full length), 1 = up (foreshortened). */
  function drawBarrier(ctx, x, y, len, ang, p, o = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const L = len * (1 - 0.85 * p);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(4, 4 + p * 8, L, 6);
    const n = Math.max(2, Math.round(L / 14));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#e03131';
      ctx.fillRect((i * L) / n, -3, L / n + 0.5, 6);
    }
    if (o.light && p < 0.5) {
      ctx.fillStyle = o.blink ? '#ff3b30' : '#5a1010';
      ctx.beginPath();
      ctx.arc(L - 3, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#333';
    rr(ctx, -9, -9, 18, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#ffd43b';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }

  function drawTruck(ctx, x, y, ang, o = {}) {
    // fire engine
    const L = o.len || 62;
    const W = o.wid || 26;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    rr(ctx, -L / 2 + 3, -W / 2 + 4, L, W, 5);
    ctx.fill();
    ctx.fillStyle = '#d62828';
    rr(ctx, -L / 2, -W / 2, L, W, 5);
    ctx.fill();
    ctx.fillStyle = '#9d0208';
    rr(ctx, L / 2 - 18, -W / 2 + 2, 15, W - 4, 3);
    ctx.fill();
    ctx.fillStyle = '#cfd8dc';
    ctx.fillRect(-L / 2 + 6, -3, L - 30, 6); // ladder
    ctx.strokeStyle = '#90a4ae';
    ctx.lineWidth = 1;
    for (let i = -L / 2 + 8; i < L / 2 - 24; i += 5) {
      ctx.beginPath();
      ctx.moveTo(i, -3);
      ctx.lineTo(i, 3);
      ctx.stroke();
    }
    const on = o.siren && Math.floor(o.t * 6) % 2 === 0;
    ctx.fillStyle = on ? '#4dabf7' : '#1c4f80';
    ctx.fillRect(L / 2 - 18, -W / 2 + 1, 4, 5);
    ctx.fillStyle = !on && o.siren ? '#4dabf7' : '#1c4f80';
    ctx.fillRect(L / 2 - 18, W / 2 - 6, 4, 5);
    ctx.fillStyle = '#fff7d1';
    ctx.fillRect(L / 2 - 2.5, -W / 2 + 2.5, 2.5, 4.5);
    ctx.fillRect(L / 2 - 2.5, W / 2 - 7, 2.5, 4.5);
    ctx.restore();
    if (on || (o.siren && Math.floor(o.t * 6) % 2 === 1)) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x, y, 34, '77,171,247', 0.35);
      ctx.restore();
    }
  }

  function drawPlane(ctx, x, y, ang, scale, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(scale, scale);
    const body = color || '#f1f3f5';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.save();
    ctx.translate(6 * (scale - 0.6) * 10, 8 * (scale - 0.6) * 10);
    planeShape(ctx);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = body;
    planeShape(ctx);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#1c7ed6';
    ctx.fillRect(-26, -1.5, 40, 3);
    ctx.fillStyle = '#343a40';
    ctx.fillRect(22, -3, 4, 6);
    ctx.restore();
  }
  function planeShape(ctx) {
    ctx.beginPath();
    ctx.moveTo(32, 0);
    ctx.quadraticCurveTo(30, -5, 22, -5);
    ctx.lineTo(4, -5);
    ctx.lineTo(-6, -30);
    ctx.lineTo(-13, -30);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-22, -5);
    ctx.lineTo(-29, -14);
    ctx.lineTo(-33, -14);
    ctx.lineTo(-30, 0);
    ctx.lineTo(-33, 14);
    ctx.lineTo(-29, 14);
    ctx.lineTo(-22, 5);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-13, 30);
    ctx.lineTo(-6, 30);
    ctx.lineTo(4, 5);
    ctx.lineTo(22, 5);
    ctx.quadraticCurveTo(30, 5, 32, 0);
    ctx.closePath();
  }

  function drawBoat(ctx, x, y, ang, color, o = {}) {
    const L = o.len || 70;
    const W = o.wid || 16;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(3, 4, L / 2, W / 2 + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.moveTo(L / 2, 0);
    ctx.quadraticCurveTo(L / 2 - 6, -W / 2, L / 2 - 14, -W / 2);
    ctx.lineTo(-L / 2 + 4, -W / 2);
    ctx.quadraticCurveTo(-L / 2, -W / 2, -L / 2, 0);
    ctx.quadraticCurveTo(-L / 2, W / 2, -L / 2 + 4, W / 2);
    ctx.lineTo(L / 2 - 14, W / 2);
    ctx.quadraticCurveTo(L / 2 - 6, W / 2, L / 2, 0);
    ctx.fill();
    ctx.fillStyle = color;
    rr(ctx, -L / 2 + 8, -W / 2 + 2.5, L - 26, W - 5, 2);
    ctx.fill();
    ctx.fillStyle = '#ffd43b';
    for (let i = -L / 2 + 14; i < L / 2 - 22; i += 9) ctx.fillRect(i, -1.5, 4, 3);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(-L / 2 + 1, -W / 2 + 3, 6, W - 6);
    ctx.restore();
  }

  function drawShip(ctx, x, y, ang, color, sinking) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (sinking) ctx.globalAlpha = Math.max(0.25, 1 - sinking * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(-40, -6);
    ctx.lineTo(-70, -14);
    ctx.lineTo(-70, 14);
    ctx.lineTo(-40, 6);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.quadraticCurveTo(26, -11, 12, -11);
    ctx.lineTo(-30, -11);
    ctx.lineTo(-32, 0);
    ctx.lineTo(-30, 11);
    ctx.lineTo(12, 11);
    ctx.quadraticCurveTo(26, 11, 34, 0);
    ctx.fill();
    ctx.fillStyle = '#f8f9fa';
    rr(ctx, -24, -7, 22, 14, 2);
    ctx.fill();
    ctx.fillStyle = '#e8590c';
    ctx.fillRect(-20, -3, 6, 6);
    ctx.fillStyle = '#495057';
    for (let i = 2; i < 22; i += 7) ctx.fillRect(i, -7, 5, 14);
    ctx.restore();
  }

  function drawTrain(ctx, x, y, dir, cars, o = {}) {
    // x = front of train; extends behind it
    const CL = 76;
    for (let i = 0; i < cars; i++) {
      const cx = x - dir * (CL / 2 + i * (CL + 4));
      ctx.save();
      ctx.translate(cx, y);
      if (dir < 0) ctx.rotate(Math.PI);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      rr(ctx, -CL / 2 + 3, -12, CL, 26, 5);
      ctx.fill();
      ctx.fillStyle = i === 0 ? '#ffd43b' : '#2f6fb2';
      rr(ctx, -CL / 2, -13, CL, 26, i === 0 ? 9 : 4);
      ctx.fill();
      ctx.fillStyle = i === 0 ? '#2f6fb2' : '#dfe7ef';
      rr(ctx, -CL / 2 + 6, -9, CL - (i === 0 ? 22 : 12), 18, 3);
      ctx.fill();
      if (i === 0) {
        ctx.fillStyle = '#1d2733';
        ctx.fillRect(CL / 2 - 13, -9, 6, 18);
        ctx.fillStyle = '#fff7d1';
        ctx.fillRect(CL / 2 - 2.5, -9, 2.5, 4);
        ctx.fillRect(CL / 2 - 2.5, 5, 2.5, 4);
      }
      ctx.restore();
    }
    if (o.lights) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x + dir * 6, y, 40, '255,240,200', 0.35);
      ctx.restore();
    }
  }

  /* ---------- Base class for scenario simulations ---------- */
  class BaseSim {
    constructor() {
      this.W = 900;
      this.H = 520;
      this.bg = null;
      this.reset();
    }
    get seed() {
      return 1234;
    }
    initialDevices() {
      return {};
    }
    init() {}
    reset() {
      this.t = 0;
      this.rng = rng(this.seed);
      this.fx = new Fx();
      this.crash = null;
      this.ended = false;
      this.nid = 0;
      this.dev = { ...this.initialDevices() };
      this.init();
    }
    setDevice(n, s) {
      const prev = this.dev[n];
      if (prev === s) return;
      this.dev[n] = s;
      if (this.onSet) this.onSet(n, s, prev);
    }
    getDevice(n) {
      return this.dev[n];
    }
    readSensor(n) {
      const f = this.sensorFns && this.sensorFns[n];
      return f ? f.call(this) : false;
    }
    update(dt) {
      if (this.crash) {
        this.crash.age += dt;
        this.fx.update(dt);
        if (this.afterCrash) this.afterCrash(dt);
        return;
      }
      this.t += dt;
      this.step(dt);
      this.fx.update(dt);
    }
    fail(x, y, reason) {
      if (this.crash) return;
      this.crash = { x, y, age: 0, reason };
      if (reason.burst !== false) this.fx.burst(x, y, this.rng);
    }
    finish() {
      this.ended = true;
    }
    drawBg(ctx) {
      if (!this.bg) {
        const c = document.createElement('canvas');
        c.width = this.W * 2;
        c.height = this.H * 2;
        const g = c.getContext('2d');
        g.scale(2, 2);
        this.buildBg(g, rng(this.seed + 7));
        this.bg = c;
      }
      ctx.drawImage(this.bg, 0, 0, this.W, this.H);
    }
    drawFx(ctx) {
      this.fx.draw(ctx);
      if (this.crash) drawCrashBurst(ctx, this.crash.x, this.crash.y, this.crash.age, this.crash.reason.label);
    }
    /* goal helper */
    goal(id, text, status, detail, required = true) {
      return { id, text, status, detail, required };
    }
    /* standard status for a "must not happen" goal */
    safeStatus() {
      return this.crash ? 'fail' : this.ended ? 'pass' : 'pending';
    }
    failedWith(label) {
      return !!(this.crash && this.crash.reason.label === label);
    }
  }

  /* Grass/road background helpers */
  function grass(g, r, W, H, col) {
    g.fillStyle = col || '#86bf6b';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1000; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(60,120,50,0.22)' : 'rgba(170,220,140,0.22)';
      g.fillRect(r() * W, r() * H, 2, 2);
    }
  }
  function asphalt(g, r, x, y, w, h) {
    g.fillStyle = '#4b4f56';
    g.fillRect(x, y, w, h);
    for (let i = 0; i < (w * h) / 120; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)';
      g.fillRect(x + r() * w, y + r() * h, 2, 2);
    }
  }
  function dashedLine(g, x0, y0, x1, y1, dash, gap, width, color) {
    g.strokeStyle = color || '#f2f2f2';
    g.lineWidth = width || 3;
    g.setLineDash([dash, gap]);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);
  }

  /* Simple car-following: limit speed so we don't hit the car ahead. */
  function followLimit(gap, aheadV, dec, margin) {
    if (gap < margin) return 0;
    return Math.sqrt(Math.max(0, aheadV * aheadV + 2 * dec * (gap - margin)));
  }
  /* Speed limit to stop at a line `dist` ahead. */
  function stopLimit(dist, dec) {
    return Math.sqrt(2 * dec * Math.max(0, dist - 0.5));
  }
  function approach(v, target, acc, dec, dt) {
    return v < target ? Math.min(target, v + acc * dt) : Math.max(target, v - dec * dt);
  }

  const CAR_COLORS = ['#e94f37', '#3f88c5', '#f6ae2d', '#44af69', '#8e6c8a', '#eeeeee', '#2b2d42', '#ff8c42', '#1b998b', '#c0392b'];
  const PED_COLORS = ['#d7263d', '#1b998b', '#2e294e', '#f46036', '#9bc53d', '#5c4d7d', '#e2a0ff', '#00a6ed'];
  const HAIR = ['#2b1d14', '#4a3020', '#c9a227', '#7b3f00', '#111', '#a0522d', '#ddd'];
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  FL.kit = {
    rng, rr, shade, drawCar, drawBeam, glow, drawPerson, drawTree, drawHouse, Fx, drawCrashBurst, drawEye,
    drawSignal, signalGlow, swatchesFor, LAMP, drawBarrier, drawTruck, drawPlane, drawBoat, drawShip, drawTrain,
    BaseSim, grass, asphalt, dashedLine, followLimit, stopLimit, approach, CAR_COLORS, PED_COLORS, HAIR, pick,
  };
})();
