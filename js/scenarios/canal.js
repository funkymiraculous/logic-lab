/* Canal lock: raise and lower boats between two water levels. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const CY = 240; // canal centre line (top view)
  const CW2 = 34; // half width of canal
  const TOP_G = 318, BOT_G = 582; // gate x positions
  const MIDX = 450;
  const BL = 70; // boat length
  const SPEED = 40;
  const GATE_T = 2;
  const FILL_T = 5;
  const DURATION = 140;
  const TARGET = 4;
  const BOAT_COLORS = ['#2b8a3e', '#c92a2a', '#1864ab', '#862e9c', '#e67700'];
  // side view
  const SV_TOP = 380, SV_HIGH = 410, SV_LOW = 460, SV_BED = 492;

  class CanalSim extends K.BaseSim {
    get seed() {
      return 1066;
    }
    initialDevices() {
      return { 'top gates': 'closed', 'bottom gates': 'closed', 'top paddles': 'closed', 'bottom paddles': 'closed' };
    }
    init() {
      this.duration = DURATION;
      this.L = 0;
      this.g = { top: 0, bottom: 0 };
      this.used = { top: false, bottom: false };
      this.boats = [];
      this.through = 0;
      this.maxWait = 0;
      this.wasted = 0;
      this.schedule = [[1, 1], [14, -1], [40, 1], [58, -1], [80, -1], [100, 1]];
      this.si = 0;
      this.sensorFns = {
        'boat waiting above': () => this.boats.some((b) => b.dir > 0 && b.state === 'wait'),
        'boat waiting below': () => this.boats.some((b) => b.dir < 0 && b.state === 'wait'),
        'boat in lock': () => this.boats.some((b) => b.state === 'inLock'),
        'lock empty': () => !this.boats.some((b) => ['enter', 'inLock', 'exit'].includes(b.state)),
        'water high': () => this.L > 0.98,
        'water low': () => this.L < 0.02,
      };
    }
    onSet(n, s) {
      if (s === 'closed' && n === 'top gates') this.used.top = false;
      if (s === 'closed' && n === 'bottom gates') this.used.bottom = false;
      if (s !== 'open') return;
      if (n === 'top gates' && this.L < 0.88) {
        this.fail(TOP_G, CY, { label: 'FLOOD!', icon: '🌊', title: 'Flood!', text: `The top gates were opened while the water in the lock was ${this.L < 0.1 ? 'right down at the low level' : 'lower than the top canal'}. Water from the high canal rushed in and flooded everywhere!`, tip: 'Before opening the top gates, fill the lock: close the bottom paddles, open the top paddles, and "wait until water high".' });
      }
      if (n === 'bottom gates' && this.L > 0.12) {
        this.fail(BOT_G, CY, { label: 'FLOOD!', icon: '🌊', title: 'Flood!', text: 'The bottom gates were opened while the lock was still full of water. It all rushed out at once, tossing the boats about!', tip: 'Before opening the bottom gates, empty the lock: close the top paddles, open the bottom paddles, and "wait until water low".' });
      }
    }
    boatAt(dir, state) {
      return this.boats.find((b) => b.dir === dir && b.state === state);
    }
    step(dt) {
      if (this.si < this.schedule.length && this.t >= this.schedule[this.si][0]) {
        const dir = this.schedule[this.si][1];
        this.boats.push({ dir, x: dir > 0 ? -50 : W + 50, state: 'approach', color: BOAT_COLORS[this.si % BOAT_COLORS.length], wait: 0, bob: this.rng() * 6 });
        this.si++;
      }
      // gates
      for (const k of ['top', 'bottom']) {
        const open = this.dev[k + ' gates'] === 'open';
        const was = this.g[k];
        this.g[k] = open ? Math.min(1, was + dt / GATE_T) : Math.max(0, was - dt / GATE_T);
        if (!open && was > this.g[k] && this.g[k] < 0.6) {
          const gx = k === 'top' ? TOP_G : BOT_G;
          const b = this.boats.find((b) => Math.abs(b.x - gx) < BL / 2 + 6);
          if (b) {
            this.fail(gx, CY, { label: 'CRUNCH!', icon: '🛶', title: 'The gates closed on a boat!', text: `The ${k} gates closed while a boat was still passing through them.`, tip: k === 'top' ? 'Wait until the boat is fully inside ("wait until boat in lock") before closing the gates behind it.' : 'Wait until the boat has left ("wait until lock empty") before closing the gates.' });
            return;
          }
        }
      }
      // water
      const tp = this.dev['top paddles'] === 'open';
      const bp = this.dev['bottom paddles'] === 'open';
      if (tp && bp) this.wasted += dt;
      let dL = (tp ? 1 : 0) - (bp ? 1 : 0);
      this.L = Math.max(0, Math.min(1, this.L + (dL * dt) / FILL_T));
      if (this.g.top > 0.1) this.L = Math.min(1, this.L + dt);
      if (this.g.bottom > 0.1) this.L = Math.max(0, this.L - dt);

      // boats
      const lockBusy = () => this.boats.some((b) => ['enter', 'inLock', 'exit'].includes(b.state));
      for (const b of this.boats) {
        b.bob += dt;
        const entryGate = b.dir > 0 ? 'top' : 'bottom';
        const exitGate = b.dir > 0 ? 'bottom' : 'top';
        const waitX = b.dir > 0 ? TOP_G - 14 - BL / 2 : BOT_G + 14 + BL / 2;
        const queueAhead = this.boats.find((o) => o !== b && o.dir === b.dir && ['approach', 'wait'].includes(o.state) && (o.x - b.x) * b.dir > 0);
        if (b.state === 'approach') {
          const stopX = queueAhead ? queueAhead.x - b.dir * (BL + 20) : waitX;
          const d = (stopX - b.x) * b.dir;
          if (d > 0) b.x += b.dir * Math.min(d, SPEED * dt);
          if (!queueAhead && d <= 0.5) b.state = 'wait';
        } else if (b.state === 'wait') {
          b.wait += dt;
          this.maxWait = Math.max(this.maxWait, b.wait);
          if (this.g[entryGate] >= 0.99 && this.dev[entryGate + ' gates'] === 'open' && !lockBusy() && !this.used[entryGate]) {
            b.state = 'enter';
            this.used[entryGate] = true;
          }
        } else if (b.state === 'enter') {
          const d = (MIDX - b.x) * b.dir;
          b.x += b.dir * Math.min(d, SPEED * dt);
          if (d <= 0.5) b.state = 'inLock';
        } else if (b.state === 'inLock') {
          if (this.g[exitGate] >= 0.99 && this.dev[exitGate + ' gates'] === 'open') {
            b.state = 'exit';
            this.used[exitGate] = true;
          }
        } else if (b.state === 'exit' || b.state === 'leave') {
          b.x += b.dir * SPEED * dt;
          if (b.state === 'exit' && (b.dir > 0 ? b.x - BL / 2 > BOT_G + 12 : b.x + BL / 2 < TOP_G - 12)) {
            b.state = 'leave';
            this.through++;
          }
        }
        // a boat stuck in a closed gate it is driving towards
        if (b.state === 'enter' && this.g[entryGate] < 0.5 && Math.abs(b.x - (b.dir > 0 ? TOP_G : BOT_G)) < BL / 2 + 6) {
          // handled by CRUNCH check above
        }
      }
      this.boats = this.boats.filter((b) => b.x > -120 && b.x < W + 120);
    }
    boatLevel(b) {
      // water height under a boat: 1 = high, 0 = low
      if (['enter', 'inLock', 'exit'].includes(b.state) && b.x > TOP_G && b.x < BOT_G) return this.L;
      return b.x < TOP_G ? 1 : b.x > BOT_G ? 0 : this.L;
    }
    goals() {
      return [
        this.goal('safe', 'No floods and no boats crunched by the gates', this.safeStatus(), 'Match the water level before opening a gate'),
        this.goal('through', `Get ${TARGET} boats through the lock`, this.through >= TARGET ? 'pass' : this.ended || this.crash ? 'fail' : 'pending', `${this.through} / ${TARGET} through`),
        this.goal('wait', 'No boat waits more than 60 s', this.maxWait > 60 ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Longest wait: ${Math.round(this.maxWait)} s`),
        this.goal('water', 'Bonus: never open the top and bottom paddles at the same time (wastes water)', this.wasted > 0.5 ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', this.wasted > 0.5 ? 'Water was wasted' : 'Close one before opening the other', false),
      ];
    }
    status() {
      const sw = (s) => (s === 'open' ? '#2fd158' : '#ff3b30');
      return [
        { label: 'Lock water level', value: `${Math.round(this.L * 100)}%`, note: this.L > 0.98 ? 'high' : this.L < 0.02 ? 'low' : this.dev['top paddles'] === 'open' ? 'filling…' : this.dev['bottom paddles'] === 'open' ? 'emptying…' : '' },
        { label: 'Top gates / paddles', value: `${this.dev['top gates']} / ${this.dev['top paddles']}`, swatches: [sw(this.dev['top gates']), sw(this.dev['top paddles'])] },
        { label: 'Bottom gates / paddles', value: `${this.dev['bottom gates']} / ${this.dev['bottom paddles']}`, swatches: [sw(this.dev['bottom gates']), sw(this.dev['bottom paddles'])] },
        { label: 'Boats waiting', value: `above ${this.boats.filter((b) => b.dir > 0 && b.state === 'wait').length} · below ${this.boats.filter((b) => b.dir < 0 && b.state === 'wait').length}` },
        { label: 'Boats through', value: `${this.through} / ${TARGET}` },
      ];
    }
    buildBg(g, r) {
      K.grass(g, r, W, H, '#84b863');
      // towpath
      g.fillStyle = '#c9b48a';
      g.fillRect(0, CY - CW2 - 26, W, 20);
      g.fillRect(0, CY + CW2 + 6, W, 20);
      // stone lock walls
      g.fillStyle = '#a8a29a';
      g.fillRect(TOP_G - 20, CY - CW2 - 8, BOT_G - TOP_G + 40, 8);
      g.fillRect(TOP_G - 20, CY + CW2, BOT_G - TOP_G + 40, 8);
      g.strokeStyle = 'rgba(0,0,0,0.15)';
      for (let x = TOP_G - 20; x < BOT_G + 20; x += 16) {
        g.strokeRect(x, CY - CW2 - 8, 16, 8);
        g.strokeRect(x, CY + CW2, 16, 8);
      }
      // trees, cottage
      for (let i = 0; i < 14; i++) K.drawTree(g, 20 + r() * 860, i < 7 ? 20 + r() * 120 : 300 + r() * 40, 12 + r() * 6, r);
      K.drawHouse(g, 640, 120, 70, 44, '#8d6e63', '#f1e3c8');
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = '800 12px Nunito, system-ui, sans-serif';
      g.fillText('⬅ HIGH canal', 20, CY - CW2 - 34);
      g.fillText('LOW canal ➡', W - 100, CY - CW2 - 34);
      // side-view panel
      g.fillStyle = 'rgba(255,255,255,0.92)';
      K.rr(g, 10, SV_TOP - 22, W - 20, SV_BED - SV_TOP + 34, 12);
      g.fill();
      g.fillStyle = '#495057';
      g.font = '900 11px Nunito, system-ui, sans-serif';
      g.fillText('SIDE VIEW (water levels)', 24, SV_TOP - 6);
      g.fillStyle = '#8d6e63';
      g.beginPath();
      g.moveTo(20, SV_HIGH + 26);
      g.lineTo(TOP_G, SV_HIGH + 26);
      g.lineTo(TOP_G, SV_BED);
      g.lineTo(W - 20, SV_BED);
      g.lineTo(W - 20, SV_BED + 6);
      g.lineTo(20, SV_BED + 6);
      g.closePath();
      g.fill();
    }
    drawGates(ctx, x, open) {
      // two mitre leaves hinged on the walls
      const len = CW2 + 2;
      const a = (0.35 + open * 1.15) * 1;
      ctx.strokeStyle = '#3b2a1a';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      const side = x === TOP_G ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(x, CY - CW2);
      ctx.lineTo(x + side * Math.sin(a) * len * 0.5 + side * (1 - open) * 4, CY - CW2 + Math.cos(a) * len);
      ctx.moveTo(x, CY + CW2);
      ctx.lineTo(x + side * Math.sin(a) * len * 0.5 + side * (1 - open) * 4, CY + CW2 - Math.cos(a) * len);
      ctx.stroke();
      // balance beams
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, CY - CW2 - 6);
      ctx.lineTo(x - side * 34 * Math.cos(open * 1.2), CY - CW2 - 6 - 30 * Math.sin(open * 1.2));
      ctx.moveTo(x, CY + CW2 + 6);
      ctx.lineTo(x - side * 34 * Math.cos(open * 1.2), CY + CW2 + 6 + 30 * Math.sin(open * 1.2));
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    drawPaddle(ctx, x, y, open) {
      ctx.fillStyle = '#212529';
      K.rr(ctx, x - 7, y - 7, 14, 14, 3);
      ctx.fill();
      ctx.fillStyle = open ? '#2fd158' : '#ff3b30';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    draw(ctx) {
      this.drawBg(ctx);
      const hi = [41, 104, 168];
      const lo = [74, 151, 214];
      const mix = (t) => `rgb(${hi.map((h, i) => Math.round(lo[i] + (h - lo[i]) * t)).join(',')})`;
      ctx.fillStyle = mix(1);
      ctx.fillRect(0, CY - CW2, TOP_G, CW2 * 2);
      ctx.fillStyle = mix(0);
      ctx.fillRect(BOT_G, CY - CW2, W - BOT_G, CW2 * 2);
      ctx.fillStyle = mix(this.L);
      ctx.fillRect(TOP_G, CY - CW2, BOT_G - TOP_G, CW2 * 2);
      // ripples where water flows
      const tp = this.dev['top paddles'] === 'open';
      const bp = this.dev['bottom paddles'] === 'open';
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      if (tp && this.L < 1) for (let i = 0; i < 4; i++) {
        const x = TOP_G + 8 + ((this.t * 50 + i * 20) % 80);
        ctx.beginPath();
        ctx.arc(TOP_G, CY, x - TOP_G, -0.6, 0.6);
        ctx.stroke();
      }
      if (bp && this.L > 0) for (let i = 0; i < 4; i++) {
        const x = 8 + ((this.t * 50 + i * 20) % 80);
        ctx.beginPath();
        ctx.arc(BOT_G, CY, x, Math.PI - 0.6, Math.PI + 0.6);
        ctx.stroke();
      }
      for (const b of this.boats) K.drawBoat(ctx, b.x, CY + Math.sin(b.bob * 1.5) * 1.2 + (b.dir > 0 ? -6 : 6), b.dir > 0 ? 0 : Math.PI, b.color, { len: BL });
      this.drawGates(ctx, TOP_G, this.g.top);
      this.drawGates(ctx, BOT_G, this.g.bottom);
      this.drawPaddle(ctx, TOP_G + 26, CY - CW2 - 18, tp);
      this.drawPaddle(ctx, TOP_G + 26, CY + CW2 + 18, tp);
      this.drawPaddle(ctx, BOT_G - 26, CY - CW2 - 18, bp);
      this.drawPaddle(ctx, BOT_G - 26, CY + CW2 + 18, bp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = '800 10px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TOP', TOP_G, CY - CW2 - 36);
      ctx.fillText('BOTTOM', BOT_G, CY - CW2 - 36);

      // side view
      const lockY = SV_LOW - (SV_LOW - SV_HIGH) * this.L;
      ctx.fillStyle = '#4dabf7';
      ctx.fillRect(20, SV_HIGH, TOP_G - 20, SV_HIGH + 26 - SV_HIGH);
      ctx.fillRect(TOP_G, lockY, BOT_G - TOP_G, SV_BED - lockY);
      ctx.fillRect(BOT_G, SV_LOW, W - 20 - BOT_G, SV_BED - SV_LOW);
      ctx.fillStyle = '#3b2a1a';
      if (this.g.top < 0.95) ctx.fillRect(TOP_G - 3, SV_HIGH - 10, 6, SV_BED - SV_HIGH + 10);
      if (this.g.bottom < 0.95) ctx.fillRect(BOT_G - 3, SV_HIGH - 10, 6, SV_BED - SV_HIGH + 10);
      ctx.globalAlpha = 0.3;
      if (this.g.top >= 0.95) ctx.fillRect(TOP_G - 3, SV_HIGH - 30, 6, 20);
      if (this.g.bottom >= 0.95) ctx.fillRect(BOT_G - 3, SV_HIGH - 30, 6, 20);
      ctx.globalAlpha = 1;
      for (const b of this.boats) {
        const y = SV_LOW - (SV_LOW - SV_HIGH) * this.boatLevel(b);
        ctx.fillStyle = b.color;
        K.rr(ctx, b.x - BL / 2, y - 9, BL, 9, 3);
        ctx.fill();
        ctx.fillStyle = '#263238';
        ctx.fillRect(b.x - BL / 2 + 10, y - 15, BL - 26, 6);
      }
      ctx.fillStyle = '#212529';
      ctx.font = '800 11px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`lock: ${Math.round(this.L * 100)}%`, MIDX, SV_BED + 2 - 6);
      this.drawFx(ctx);
      if (this.crash && this.crash.reason.label === 'FLOOD!') {
        ctx.fillStyle = `rgba(77,171,247,${Math.min(0.55, this.crash.age * 0.8)})`;
        ctx.fillRect(0, CY - 120 * Math.min(1, this.crash.age), W, 240 * Math.min(1, this.crash.age));
      }
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="140" fill="#84b863"/>
    <rect y="46" width="84" height="28" fill="#29689f"/><rect x="84" y="46" width="72" height="28" fill="#3b80bd"/><rect x="156" y="46" width="84" height="28" fill="#4a97d6"/>
    <line x1="84" y1="46" x2="90" y2="60" stroke="#3b2a1a" stroke-width="3"/><line x1="84" y1="74" x2="90" y2="60" stroke="#3b2a1a" stroke-width="3"/>
    <line x1="156" y1="46" x2="150" y2="60" stroke="#3b2a1a" stroke-width="3"/><line x1="156" y1="74" x2="150" y2="60" stroke="#3b2a1a" stroke-width="3"/>
    <rect x="100" y="55" width="40" height="10" rx="4" fill="#2b8a3e"/>
    <rect x="10" y="96" width="220" height="36" rx="6" fill="#fff" opacity=".9"/>
    <rect x="16" y="104" width="68" height="20" fill="#4dabf7"/><rect x="84" y="110" width="72" height="14" fill="#4dabf7"/><rect x="156" y="116" width="68" height="8" fill="#4dabf7"/>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'canal',
    order: 4,
    title: 'Canal Lock',
    tagline: 'Fill and empty a lock to lift boats up and down a hill – without flooding the valley.',
    difficulty: 'Intermediate',
    concepts: ['Conditions with and/not', 'Safe states', 'Long sequences', 'Two directions'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>A <b>lock</b> lets boats travel between a <b>high</b> canal (left) and a <b>low</b> canal (right). The side view at the bottom shows the water levels.</p>
      <p><b>Paddles</b> are small sluices: open the <b>top paddles</b> to fill the lock up to the high level, or the <b>bottom paddles</b> to empty it down to the low level.</p>
      <p>A <b>gate</b> may only be opened when the water is the <b>same height on both sides</b> – otherwise: <b>FLOOD!</b> And never close a gate while a boat is in it.</p>
      <p>Boats come from both directions. Sensors: <code>boat waiting above</code>, <code>boat waiting below</code>, <code>boat in lock</code>, <code>lock empty</code>, <code>water high</code>, <code>water low</code>.</p>`,
    devices: {
      'top gates': { label: 'top gates', aliases: ['top gate', 'upper gates', 'upper gate'], states: ['open', 'closed'], stateAliases: { close: 'closed', shut: 'closed' }, stateColors: { open: '#2fd158', closed: '#ff3b30' }, describe: 'Gates between the lock and the HIGH canal (left).' },
      'bottom gates': { label: 'bottom gates', aliases: ['bottom gate', 'lower gates', 'lower gate'], states: ['open', 'closed'], stateAliases: { close: 'closed', shut: 'closed' }, stateColors: { open: '#2fd158', closed: '#ff3b30' }, describe: 'Gates between the lock and the LOW canal (right).' },
      'top paddles': { label: 'top paddles', aliases: ['top paddle', 'upper paddles', 'fill paddles'], states: ['open', 'closed'], stateAliases: { close: 'closed', shut: 'closed' }, stateColors: { open: '#4dabf7', closed: '#868e96' }, describe: 'Let water IN from the high canal to fill the lock.' },
      'bottom paddles': { label: 'bottom paddles', aliases: ['bottom paddle', 'lower paddles', 'empty paddles'], states: ['open', 'closed'], stateAliases: { close: 'closed', shut: 'closed' }, stateColors: { open: '#4dabf7', closed: '#868e96' }, describe: 'Let water OUT to the low canal to empty the lock.' },
    },
    sensors: {
      'boat waiting above': 'True when a boat is waiting in the high canal to go down.',
      'boat waiting below': 'True when a boat is waiting in the low canal to go up.',
      'boat in lock': 'True when a boat is fully inside the lock.',
      'lock empty': 'True when no boat is in the lock or its gates.',
      'water high': 'True when the lock is full (level with the high canal).',
      'water low': 'True when the lock is empty (level with the low canal).',
    },
    snippets: { set: 'set top paddles open', sensor: 'boat waiting above' },
    starter: `# Boats from the HIGH canal wait above the lock.
# This program opens the gates for them...
# but is the water at the right level? Press Run!

forever:
    wait until boat waiting above
    set top gates open
    wait until boat in lock
    set top gates closed
    set bottom gates open
    wait until lock empty
    set bottom gates closed
`,
    solution: `forever:
    if boat waiting above:
        # Fill the lock to the high level
        set bottom paddles closed
        set top paddles open
        wait until water high
        set top gates open
        wait until boat in lock
        set top gates closed
        # Lower the boat
        set top paddles closed
        set bottom paddles open
        wait until water low
        set bottom gates open
        wait until lock empty
        set bottom gates closed
    else if boat waiting below:
        # Empty the lock to the low level
        set top paddles closed
        set bottom paddles open
        wait until water low
        set bottom gates open
        wait until boat in lock
        set bottom gates closed
        # Raise the boat
        set bottom paddles closed
        set top paddles open
        wait until water high
        set top gates open
        wait until lock empty
        set top gates closed
    wait 0.5
`,
    hints: [
      'The lock starts LOW. Before opening the top gates you must fill it: "set top paddles open", then "wait until water high".',
      'Once the boat is in and the top gates are closed, close the top paddles and open the bottom paddles to lower it ("wait until water low").',
      'Boats also come from below! Use "if boat waiting above:" … "else if boat waiting below:" to handle both directions.',
      'Bonus: always close one set of paddles before opening the other.',
    ],
    create: () => new CanalSim(),
  });
})();
