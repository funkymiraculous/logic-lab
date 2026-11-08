/* Automatic shop doors: open for customers, never close on them, keep the heat in. */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const K = FL.kit;
  const W = 900, H = 520;
  const WALL_Y = 250;
  const DX0 = 400, DX1 = 500, DC = 450;
  const ZONE = { x0: 370, x1: 530, y0: 165, y1: 335 };
  const CLOSING = 45;
  const DURATION = 60;
  const GIVE_UP = 6;
  const WASTE_MAX = 10;

  class DoorsSim extends K.BaseSim {
    get seed() {
      return 5150;
    }
    initialDevices() {
      return { doors: 'closed' };
    }
    init() {
      this.duration = DURATION;
      this.people = [];
      this.o = 0;
      this.spawnIn = 0.6;
      this.spawnOut = 3;
      this.served = 0;
      this.waste = 0;
      this.lateEntry = false;
      this.sensorFns = {
        'person near': () => this.people.some((p) => this.inZone(p)),
        'person entering': () => this.people.some((p) => this.inZone(p) && p.dir === 'in'),
        'person leaving': () => this.people.some((p) => this.inZone(p) && p.dir === 'out'),
        'shop closed': () => this.t >= CLOSING,
        'person in doorway': () => this.people.some((p) => this.inDoorway(p)),
      };
      this.lateOpen = 0;
    }
    inZone(p) {
      return p.x > ZONE.x0 && p.x < ZONE.x1 && p.y > ZONE.y0 && p.y < ZONE.y1 && p.state !== 'away';
    }
    inDoorway(p) {
      return Math.abs(p.y - WALL_Y) < 10 + p.r && p.x > DX0 && p.x < DX1;
    }
    newPerson(dir) {
      const trolley = this.rng() < 0.3;
      const fromLeft = this.rng() < 0.5;
      const p = {
        dir, trolley, r: trolley ? 11 : 7, speed: trolley ? 24 : 36 + this.rng() * 10, color: K.pick(this.rng, K.PED_COLORS), hair: K.pick(this.rng, K.HAIR),
        phase: 0, wait: 0, ang: 0, alpha: 1, side: fromLeft ? -1 : 1, lane: DC - 18 + this.rng() * 36,
      };
      if (dir === 'in') {
        p.x = fromLeft ? -15 : W + 15;
        p.y = 300 + this.rng() * 20;
        p.path = [[p.lane, p.y], [p.lane, WALL_Y + 14 + p.r], [p.lane, 150], [150 + this.rng() * 600, 60 + this.rng() * 90]];
      } else {
        p.x = 150 + this.rng() * 600;
        p.y = 60 + this.rng() * 90;
        p.alpha = 0;
        p.path = [[p.lane, 150], [p.lane, WALL_Y - 14 - p.r], [p.lane, 360], [fromLeft ? -20 : W + 20, 360 + this.rng() * 20]];
      }
      p.pi = 0;
      p.state = 'walk';
      return p;
    }
    step(dt) {
      const target = this.dev.doors === 'open' ? 1 : 0;
      const closing = target < this.o;
      this.o = target > this.o ? Math.min(1, this.o + dt / 0.8) : Math.max(0, this.o - dt / 0.8);

      this.spawnIn -= dt;
      this.spawnOut -= dt;
      if (this.spawnIn <= 0 && this.t < DURATION - 6) {
        this.people.push(this.newPerson('in'));
        this.spawnIn = 3 + this.rng() * 2.5;
      }
      if (this.spawnOut <= 0 && this.t < DURATION - 8) {
        this.people.push(this.newPerson('out'));
        this.spawnOut = 3.5 + this.rng() * 3;
      }

      for (const p of this.people) {
        if (p.alpha < 1 && p.state === 'walk') p.alpha = Math.min(1, p.alpha + dt * 2);
        if (p.state === 'shopping') {
          p.alpha -= dt * 2;
          continue;
        }
        const [tx, ty] = p.path[p.pi];
        // waiting at the door
        const atDoor = p.pi === 1 && Math.hypot(tx - p.x, ty - p.y) < 1;
        if (atDoor) {
          if (p.dir === 'in' && this.t >= CLOSING) {
            p.state = 'away';
            p.path = [[p.x, 320], [p.side < 0 ? -20 : W + 20, 320]];
            p.pi = 0;
            continue;
          }
          if (this.o < 0.85) {
            p.wait += dt;
            if (p.wait > GIVE_UP) {
              this.fail(p.x, p.y, { label: 'GRRR!', icon: '😠', title: p.dir === 'in' ? 'A customer gave up!' : 'A customer is stuck inside!', text: `Someone waited at the doors for ${GIVE_UP} seconds and they never opened.`, tip: 'Open the doors whenever "person near" is true.' });
              return;
            }
            continue;
          }
          p.pi++;
          continue;
        }
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        const stepLen = p.speed * dt;
        p.ang = Math.atan2(dy, dx);
        p.phase += dt * 9;
        if (d <= stepLen) {
          p.x = tx;
          p.y = ty;
          if (p.pi < p.path.length - 1) p.pi++;
          else if (p.dir === 'in' && p.state !== 'away') {
            p.state = 'shopping';
            this.served++;
          } else p.gone = true;
        } else {
          p.x += (dx / d) * stepLen;
          p.y += (dy / d) * stepLen;
        }
        if (p.dir === 'out' && p.pi >= 3 && !p.counted) {
          p.counted = true;
          this.served++;
        }
      }
      this.people = this.people.filter((p) => !p.gone && !(p.state === 'shopping' && p.alpha <= 0));

      // pinched in the doors
      for (const p of this.people) {
        if (this.inDoorway(p) && closing && this.o < 0.7) {
          this.fail(p.x, WALL_Y, { label: 'OUCH!', icon: '🚪', title: 'The doors closed on someone!', text: p.trolley ? 'A shopper with a heavy trolley was still walking through the doorway when the doors shut.' : 'Someone was still walking through the doorway when the doors shut.', tip: 'People take different amounts of time to get through. Instead of a fixed wait, keep the doors open WHILE someone is near.' });
          return;
        }
      }
      // after closing, doors should only open for people leaving
      if (this.t >= CLOSING + 1 && this.o > 0.3 && !this.readSensor('person leaving') && !this.readSensor('person in doorway')) {
        this.lateOpen += dt;
        if (this.lateOpen > 1.5) this.lateEntry = true;
      } else this.lateOpen = 0;
      // heat wasted
      const near = this.readSensor('person near');
      if (this.o > 0.05 && !near) {
        this.waste += dt;
        if (this.waste > WASTE_MAX) {
          this.fail(DC, WALL_Y - 60, { label: 'BRRR!', icon: '🥶', title: 'The shop is freezing!', text: 'The doors were left open with nobody around, and all the warm air escaped.', tip: 'Close the doors again once nobody is near them.' });
        }
      }
    }
    temp() {
      return 21 - this.waste * 0.9;
    }
    goals() {
      return [
        this.goal('ouch', 'The doors never close on anyone', this.failedWith('OUCH!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', 'Use while…'),
        this.goal('wait', `Nobody waits more than ${GIVE_UP} s at the doors`, this.failedWith('GRRR!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `${this.served} customers through`),
        this.goal('heat', 'Keep the heat in – don’t leave the doors open for nobody', this.failedWith('BRRR!') ? 'fail' : this.ended && !this.crash ? 'pass' : 'pending', `Shop temperature: ${this.temp().toFixed(0)}°C`),
        this.goal('closed', 'Bonus: after closing time, only open the doors for people leaving', this.lateEntry ? 'fail' : this.ended ? 'pass' : 'pending', this.lateEntry ? 'Doors opened for someone arriving after closing' : 'Sensors: shop closed, person leaving', false),
      ];
    }
    status() {
      return [
        { label: 'Doors', value: this.dev.doors.toUpperCase(), note: this.o > 0 && this.o < 1 ? 'moving…' : '' },
        { label: 'Sensor: person near', value: this.readSensor('person near') ? 'TRUE' : 'FALSE' },
        { label: 'Sensor: shop closed', value: this.t >= CLOSING ? 'TRUE' : 'FALSE', note: this.t < CLOSING ? `closes at ${CLOSING} s` : '' },
        { label: 'Temperature', value: `${this.temp().toFixed(1)} °C`, swatch: this.temp() > 17 ? '#ff922b' : '#4dabf7' },
        { label: 'Customers through', value: String(this.served) },
      ];
    }
    buildBg(g, r) {
      // shop floor
      g.fillStyle = '#efe6d8';
      g.fillRect(0, 0, W, WALL_Y);
      g.strokeStyle = 'rgba(0,0,0,0.06)';
      g.lineWidth = 1;
      for (let x = 0; x < W; x += 30) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, WALL_Y);
        g.stroke();
      }
      for (let y = 0; y < WALL_Y; y += 30) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
      // shelves
      const goods = ['#e03131', '#1c7ed6', '#f59f00', '#2b8a3e', '#ae3ec9', '#fd7e14'];
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 4; i++) {
          const x = 70 + i * 200 + (i >= 2 ? 40 : 0);
          const y = 40 + row * 90;
          if (row === 1 && (i === 1 || i === 2)) continue;
          g.fillStyle = '#9c8b74';
          g.fillRect(x, y, 130, 26);
          for (let k = 0; k < 12; k++) {
            g.fillStyle = goods[(k + i + row) % goods.length];
            g.fillRect(x + 4 + k * 10.5, y + 3, 8, 9);
            g.fillRect(x + 4 + k * 10.5, y + 14, 8, 9);
          }
        }
      }
      // tills
      g.fillStyle = '#495057';
      g.fillRect(140, 190, 70, 22);
      g.fillRect(690, 190, 70, 22);
      // wall
      g.fillStyle = '#5c4033';
      g.fillRect(0, WALL_Y - 6, DX0, 12);
      g.fillRect(DX1, WALL_Y - 6, W - DX1, 12);
      g.fillStyle = '#a5d8ff';
      for (let x = 20; x < DX0 - 20; x += 90) g.fillRect(x, WALL_Y - 3, 70, 6);
      for (let x = DX1 + 20; x < W - 20; x += 90) g.fillRect(x, WALL_Y - 3, 70, 6);
      // pavement + road
      g.fillStyle = '#d6d3cc';
      g.fillRect(0, WALL_Y + 6, W, 170);
      g.strokeStyle = 'rgba(0,0,0,0.07)';
      for (let x = 0; x < W; x += 28) {
        g.beginPath();
        g.moveTo(x, WALL_Y + 6);
        g.lineTo(x, WALL_Y + 176);
        g.stroke();
      }
      K.asphalt(g, r, 0, 430, W, 90);
      g.fillStyle = '#9e9a93';
      g.fillRect(0, 426, W, 4);
      K.dashedLine(g, 0, 476, W, 476, 24, 18, 3);
      // door mat / sensor zone
      g.fillStyle = 'rgba(80,80,90,0.35)';
      g.fillRect(DX0 + 6, WALL_Y + 10, DX1 - DX0 - 12, 40);
      g.fillRect(DX0 + 6, WALL_Y - 50, DX1 - DX0 - 12, 40);
      g.strokeStyle = 'rgba(28,126,214,0.5)';
      g.setLineDash([6, 6]);
      g.lineWidth = 2;
      g.strokeRect(ZONE.x0, ZONE.y0, ZONE.x1 - ZONE.x0, ZONE.y1 - ZONE.y0);
      g.setLineDash([]);
      g.fillStyle = 'rgba(28,126,214,0.8)';
      g.font = '800 11px Nunito, system-ui, sans-serif';
      g.fillText('sensor area', ZONE.x0 + 4, ZONE.y1 + 13);
      // sign
      g.fillStyle = '#2b2d42';
      K.rr(g, DX1 + 30, WALL_Y + 14, 120, 26, 6);
      g.fill();
      g.fillStyle = '#ffd43b';
      g.font = '900 14px Nunito, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('CORNER SHOP', DX1 + 90, WALL_Y + 32);
      g.textAlign = 'left';
    }
    draw(ctx) {
      this.drawBg(ctx);
      for (const p of this.people) {
        if (p.trolley) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.ang);
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.strokeStyle = '#868e96';
          ctx.lineWidth = 2;
          ctx.strokeRect(8, -8, 16, 16);
          ctx.fillStyle = 'rgba(134,142,150,0.3)';
          ctx.fillRect(8, -8, 16, 16);
          ctx.restore();
        }
        K.drawPerson(ctx, p.x, p.y, p.ang, p.color, p.phase, { hair: p.hair, alpha: Math.max(0, p.alpha) });
        if (p.wait > 1.5 && !this.crash) {
          ctx.font = '16px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(p.wait > 4 ? '😠' : '😐', p.x, p.y - 16);
        }
      }
      // sliding doors
      const slide = this.o * 48;
      ctx.fillStyle = 'rgba(165,216,255,0.85)';
      ctx.strokeStyle = '#495057';
      ctx.lineWidth = 2;
      ctx.fillRect(DX0 - slide, WALL_Y - 4, 50, 8);
      ctx.strokeRect(DX0 - slide, WALL_Y - 4, 50, 8);
      ctx.fillRect(DC + slide, WALL_Y - 4, 50, 8);
      ctx.strokeRect(DC + slide, WALL_Y - 4, 50, 8);
      // closed sign
      if (this.t >= CLOSING) {
        ctx.fillStyle = '#c92a2a';
        K.rr(ctx, DX0 - 100, WALL_Y + 14, 80, 24, 6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '900 13px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CLOSED', DX0 - 60, WALL_Y + 31);
      }
      // thermometer
      const temp = this.temp();
      const tx = 40, ty = 300;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      K.rr(ctx, tx - 16, ty - 8, 64, 110, 10);
      ctx.fill();
      ctx.fillStyle = '#dee2e6';
      K.rr(ctx, tx - 4, ty, 10, 78, 5);
      ctx.fill();
      const f = Math.max(0, Math.min(1, (temp - 8) / 14));
      ctx.fillStyle = temp > 17 ? '#ff6b6b' : temp > 13 ? '#ffa94d' : '#4dabf7';
      K.rr(ctx, tx - 4, ty + 78 - 78 * f, 10, 78 * f, 5);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx + 1, ty + 84, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212529';
      ctx.font = '800 12px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${temp.toFixed(0)}°`, tx + 12, ty + 40);
      this.drawFx(ctx);
    }
  }

  const thumb = `<svg viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg">
    <rect width="240" height="70" fill="#efe6d8"/><rect y="70" width="240" height="50" fill="#d6d3cc"/><rect y="120" width="240" height="20" fill="#4b4f56"/>
    <rect x="20" y="15" width="50" height="10" fill="#9c8b74"/><rect x="170" y="15" width="50" height="10" fill="#9c8b74"/>
    <rect y="67" width="96" height="6" fill="#5c4033"/><rect x="144" y="67" width="96" height="6" fill="#5c4033"/>
    <rect x="86" y="68" width="24" height="4" fill="#a5d8ff" stroke="#495057"/><rect x="130" y="68" width="24" height="4" fill="#a5d8ff" stroke="#495057"/>
    <circle cx="120" cy="88" r="5" fill="#1b998b"/><circle cx="120" cy="88" r="3" fill="#4a3020"/>
    <rect x="113" y="96" width="14" height="10" fill="none" stroke="#868e96" stroke-width="1.5"/>
    <text x="120" y="56" font-size="14" text-anchor="middle">🙂</text>
  </svg>`;

  (FL.scenarios = FL.scenarios || []).push({
    id: 'doors',
    order: 4,
    title: 'Automatic Shop Doors',
    tagline: 'Open the doors for shoppers, never squash anyone, and keep the warm air inside.',
    difficulty: 'Beginner',
    concepts: ['While loops', 'If vs while', 'Sensors', 'Nested if (bonus)'],
    thumb,
    duration: DURATION,
    briefing: `
      <p>The corner shop has sliding doors with a sensor that spots anyone nearby (the dotted blue area).</p>
      <p>Open the doors when someone is coming, and close them again to keep the warmth in. But people walk at different speeds – and shoppers with <b>trolleys</b> are slow. Close the doors too early and… <b>OUCH!</b></p>
      <p><b>Bonus:</b> the shop closes at ${CLOSING} seconds. After that, only open the doors for people <b>leaving</b>. Sensors: <code>shop closed</code>, <code>person leaving</code>, <code>person entering</code>, <code>person in doorway</code>.</p>`,
    devices: {
      doors: { label: 'doors', aliases: ['door', 'shop doors', 'sliding doors'], states: ['open', 'closed'], stateAliases: { close: 'closed', shut: 'closed' }, stateColors: { open: '#2fd158', closed: '#ff3b30' }, describe: 'The sliding glass doors. They take under a second to open or close.' },
    },
    sensors: {
      'person near': 'True when anyone is in the sensor area, inside or outside.',
      'person entering': 'True when someone near the doors is coming in.',
      'person leaving': 'True when someone near the doors is going out.',
      'shop closed': `True after closing time (${CLOSING} seconds).`,
      'person in doorway': 'True when someone is right in the doorway.',
    },
    snippets: { set: 'set doors open', sensor: 'person near' },
    starter: `# Open the doors when someone is near, close them
# after 2 seconds, then keep them shut for 3 seconds
# to save heat. Is that always OK? Press Run and see!

forever:
    wait until person near
    set doors open
    wait 2
    set doors closed
    wait 3
`,
    solution: `forever:
    if shop closed:
        # After closing: only let people out
        # (and never close on someone in the doorway)
        if person leaving or person in doorway:
            set doors open
        else:
            set doors closed
    else:
        if person near:
            set doors open
        else:
            set doors closed
    wait 0.1
`,
    hints: [
      'A fixed "wait 2" is too short for slow shoppers with trolleys.',
      'Instead of waiting a fixed time, keep the doors open WHILE someone is near: "while person near:" with "wait 0.1" inside it.',
      'Another way: inside "forever:", use "if person near:" to open and "else:" to close, then "wait 0.1".',
      'Bonus: put an "if shop closed:" around it, and after closing only open for "person leaving".',
    ],
    create: () => new DoorsSim(),
  });
})();
