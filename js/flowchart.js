/* Turns a parsed program into an SVG flowchart.
 * Every layout piece knows its left/right extent (L, R) around a centre line,
 * its height (H), whether control can flow out of the bottom (exit), and how to draw itself.
 */
(function () {
  const FL = (globalThis.FL = globalThis.FL || {});
  const GAP = 30;
  const RH = 42;
  const DH = 76;
  const PH = 34;
  const HH = 38;

  let mctx = null;
  function tw(text, font) {
    if (typeof document === 'undefined') return text.length * 7.2;
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    mctx.font = font || '700 13px Nunito, system-ui, sans-serif';
    return mctx.measureText(text).width;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f = (n) => Math.round(n * 10) / 10;

  function path(o, pts, opts = {}) {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join(' ');
    o.e.push(`<path class="fc-edge ${opts.cls || ''}" d="${d}"${opts.arrow === false ? '' : ' marker-end="url(#fc-arrow)"'}/>`);
  }
  function label(o, x, y, text, anchor) {
    o.n.push(`<text class="fc-label" x="${f(x)}" y="${f(y)}" text-anchor="${anchor || 'middle'}">${esc(text)}</text>`);
  }
  const EMPTY = { L: 0, R: 0, H: 0, exit: true, empty: true, draw() {} };
  /* "+" buttons on the arrows, for adding a step at that point */
  /* A dashed slot shown where a block has no steps yet; clicking it adds one. */
  function slot(ins, text) {
    const w = text.length > 8 ? 120 : 76;
    const h = 30;
    return {
      L: w / 2, R: w / 2, H: h, exit: true,
      draw(cx, y, o) {
        o.n.push(`<g class="fc-plus fc-slot" data-ins="${ins}" tabindex="0"><title>Add a step here</title><rect x="${f(cx - w / 2)}" y="${f(y)}" width="${w}" height="${h}" rx="8"/><text x="${f(cx)}" y="${f(y + h / 2)}">${text}</text></g>`);
      },
    };
  }
  function plus(o, x, y, ins) {
    o.n.push(`<g class="fc-plus" data-ins="${ins}" tabindex="0"><title>Add a step here</title><circle cx="${f(x)}" cy="${f(y)}" r="8.5"/><path d="M${f(x - 4)} ${f(y)}h8M${f(x)} ${f(y - 4)}v8"/></g>`);
  }

  function makeLayout(scn) {
    const devLabel = (d) => (scn.devices[d] && scn.devices[d].label) || d;
    const stateColors = (d, s) => {
      const c = scn.devices[d] && scn.devices[d].stateColors;
      return (c && c[s]) || null;
    };

    function rectNode(s, text, kind, swatches, icon) {
      const extra = (swatches ? swatches.length * 14 + 6 : 0) + (icon ? 20 : 0);
      const w = Math.max(150, tw(text) + 36 + extra);
      return {
        L: w / 2, R: w / 2, H: RH, exit: true,
        draw(cx, y, o) {
          let g = `<g class="fc-node fc-${kind}" data-id="${s.id}" data-line="${s.line}" tabindex="0">`;
          g += `<rect x="${f(cx - w / 2)}" y="${f(y)}" width="${f(w)}" height="${RH}" rx="7"/>`;
          let tx = cx + extra / 2;
          let sx = cx - w / 2 + 16;
          if (icon) {
            g += `<text class="fc-icon" x="${f(sx + 4)}" y="${f(y + RH / 2)}">${icon}</text>`;
            sx += 20;
          }
          if (swatches) {
            swatches.forEach((c) => {
              g += `<circle class="fc-swatch" cx="${f(sx + 5)}" cy="${f(y + RH / 2)}" r="5.5" fill="${c}"/>`;
              sx += 14;
            });
          }
          g += `<text x="${f(tx)}" y="${f(y + RH / 2)}">${esc(text)}</text></g>`;
          o.n.push(g);
        },
      };
    }

    function diamondShape(s, sub, main) {
      const w = Math.max(170, (tw(main) + 26) / 0.62);
      return {
        w, h: DH,
        draw(cx, y, o) {
          const pts = [[cx, y], [cx + w / 2, y + DH / 2], [cx, y + DH], [cx - w / 2, y + DH / 2]].map((p) => p.map(f).join(',')).join(' ');
          o.n.push(
            `<g class="fc-node fc-decision" data-id="${s.id}" data-line="${s.line}" tabindex="0"><polygon points="${pts}"/>` +
              `<text class="fc-sub" x="${f(cx)}" y="${f(y + 23)}">${esc(sub)}</text>` +
              `<text x="${f(cx)}" y="${f(y + DH / 2 + 6)}">${esc(main)}</text></g>`
          );
        },
      };
    }

    function seq(stmts, firstIns) {
      if (!stmts.length && firstIns) return slot(firstIns, '+ add a step');
      const items = [];
      let exit = true;
      for (const st of stmts) {
        if (!exit) break;
        const it = stmt(st);
        items.push(it);
        exit = it.exit;
      }
      if (!items.length) return EMPTY;
      const L = Math.max(...items.map((i) => i.L));
      const R = Math.max(...items.map((i) => i.R));
      const H = items.reduce((a, i) => a + i.H, 0) + GAP * (items.length - 1);
      return {
        L, R, H, exit,
        draw(cx, y, o) {
          let yy = y;
          items.forEach((it, i) => {
            if (i > 0) {
              path(o, [[cx, yy], [cx, yy + GAP]]);
              plus(o, cx, yy + GAP / 2, 'after:' + stmts[i - 1].id);
              yy += GAP;
            } else if (firstIns) plus(o, cx, yy - GAP / 2, firstIns);
            it.draw(cx, yy, o);
            yy += it.H;
          });
          if (exit) plus(o, cx, yy + 13, 'after:' + stmts[items.length - 1].id);
        },
      };
    }

    function fmtNum(n) {
      return String(Math.round(n * 100) / 100);
    }

    function stmt(s) {
      switch (s.type) {
        case 'set': {
          const st = s.state.toUpperCase().replace(' ', ' + ');
          const sw = s.state.split(' ').map((p) => stateColors(s.device, p) || stateColors(s.device, s.state)).filter(Boolean);
          return rectNode(s, `Set ${devLabel(s.device)} to ${st}`, 'action', sw.length ? sw : null);
        }
        case 'wait':
          if (s.seconds == null) return rectNode(s, `Wait ${s.secondsText} seconds`, 'wait', null, '⏱');
          return rectNode(s, `Wait ${fmtNum(s.seconds)} second${s.seconds === 1 ? '' : 's'}`, 'wait', null, '⏱');
        case 'assign': {
          const txt = s.op === 'set' ? `Set ${s.name} to ${s.exprText}` : s.op === 'add' ? `Add ${s.exprText} to ${s.name}` : `Take ${s.exprText} from ${s.name}`;
          return rectNode(s, txt, 'var', null, '📦');
        }
        case 'waitUntil':
          return waitUntilNode(s);
        case 'if':
          return ifNode(s, s.elseIf ? 'ELSE IF' : 'IF');
        case 'while':
          return loopNode(s, 'WHILE', s.condText + '?', 'Yes', 'No');
        case 'repeat':
          if (s.count == null) return loopNode(s, 'REPEAT', `Done ${s.countText} times?`, 'No', 'Yes');
          return loopNode(s, 'REPEAT', `Done ${s.count} time${s.count === 1 ? '' : 's'}?`, 'No', 'Yes');
        case 'forever':
          return foreverNode(s);
      }
      return rectNode(s, s.text, 'action');
    }

    function waitUntilNode(s) {
      const d = diamondShape(s, 'WAIT UNTIL', s.condText + '?');
      const side = d.w / 2 + 24;
      return {
        L: d.w / 2, R: side + 8, H: d.h, exit: true,
        draw(cx, y, o) {
          const my = y + d.h / 2;
          path(o, [[cx + d.w / 2, my], [cx + side, my], [cx + side, y - 13], [cx, y - 13]], { arrow: false, cls: 'loop' });
          label(o, cx + d.w / 2 + 5, my - 7, 'No', 'start');
          label(o, cx + 8, y + d.h + 15, 'Yes', 'start');
          d.draw(cx, y, o);
        },
      };
    }

    function ifNode(s, sub) {
      const d = diamondShape(s, sub, s.condText + '?');
      const Y = seq(s.body, 'inside:' + s.id);
      const N = s.elseBody ? seq(s.elseBody, 'else:' + s.id) : slot('newelse:' + s.id, '+ else');
      const offY = Math.max(d.w / 2, Y.R + 28);
      const offN = Math.max(d.w / 2, N.L + 28);
      const bh = Math.max(Y.H, N.H);
      const exit = Y.exit || N.exit;
      const H = d.h + GAP + bh + GAP;
      return {
        L: Math.max(d.w / 2, offY + Y.L), R: Math.max(d.w / 2, offN + N.R), H, exit,
        draw(cx, y, o) {
          const my = y + d.h / 2;
          const by = y + d.h + GAP;
          const jy = y + H;
          const branch = (B, bx, vx, lbl, anchor) => {
            if (B.empty) {
              path(o, [[vx, my], [bx, my], [bx, jy], [cx, jy]], { arrow: false });
            } else {
              path(o, [[vx, my], [bx, my], [bx, by]]);
              B.draw(bx, by, o);
              if (B.exit) path(o, [[bx, by + B.H], [bx, jy], [cx, jy]], { arrow: false });
            }
            label(o, anchor === 'end' ? vx - 6 : vx + 6, my - 8, lbl, anchor);
          };
          branch(Y, cx - offY, cx - d.w / 2, 'Yes', 'end');
          branch(N, cx + offN, cx + d.w / 2, 'No', 'start');
          d.draw(cx, y, o);
          if (exit) o.n.push(`<circle class="fc-join" cx="${f(cx)}" cy="${f(jy)}" r="4"/>`);
        },
      };
    }

    function loopNode(s, sub, main, bodyLbl, exitLbl) {
      const d = diamondShape(s, sub, main);
      const B = seq(s.body, 'inside:' + s.id);
      const left = Math.max(d.w / 2, B.L) + 26;
      const right = Math.max(d.w / 2, B.R) + 26;
      const H = d.h + GAP + B.H + GAP + 16;
      return {
        L: left + 6, R: right + 6, H, exit: true,
        draw(cx, y, o) {
          const my = y + d.h / 2;
          const by = y + d.h + GAP;
          path(o, [[cx, y + d.h], [cx, by]]);
          label(o, cx + 8, y + d.h + 17, bodyLbl, 'start');
          B.draw(cx, by, o);
          if (B.exit) {
            const ey = by + B.H;
            const ly = ey + GAP * 0.55;
            path(o, [[cx, ey], [cx, ly], [cx - left, ly], [cx - left, my], [cx - d.w / 2, my]], { cls: 'loop' });
          }
          path(o, [[cx + d.w / 2, my], [cx + right, my], [cx + right, y + H], [cx, y + H]], { arrow: false });
          label(o, cx + d.w / 2 + 6, my - 8, exitLbl, 'start');
          d.draw(cx, y, o);
        },
      };
    }

    function foreverNode(s) {
      const text = 'Repeat forever';
      const w = Math.max(160, tw(text) + 60);
      const B = seq(s.body, 'inside:' + s.id);
      const left = Math.max(w / 2, B.L) + 26;
      const H = HH + GAP + B.H + GAP * 0.6 + 6;
      return {
        L: left + 6, R: Math.max(w / 2, B.R), H, exit: false,
        draw(cx, y, o) {
          const by = y + HH + GAP;
          path(o, [[cx, y + HH], [cx, by]]);
          B.draw(cx, by, o);
          if (B.exit) {
            const ey = by + B.H;
            const ly = ey + GAP * 0.6;
            path(o, [[cx, ey], [cx, ly], [cx - left, ly], [cx - left, y + HH / 2], [cx - w / 2, y + HH / 2]], { cls: 'loop' });
          }
          const x0 = cx - w / 2;
          const x1 = cx + w / 2;
          const pts = [[x0 + 14, y], [x1 - 14, y], [x1, y + HH / 2], [x1 - 14, y + HH], [x0 + 14, y + HH], [x0, y + HH / 2]]
            .map((p) => p.map(f).join(','))
            .join(' ');
          o.n.push(
            `<g class="fc-node fc-loop" data-id="${s.id}" data-line="${s.line}" tabindex="0"><polygon points="${pts}"/>` +
              `<text x="${f(cx)}" y="${f(y + HH / 2)}">🔁 ${esc(text)}</text></g>`
          );
        },
      };
    }

    return { seq };
  }

  function pill(o, cx, y, text, id) {
    const w = 110;
    o.n.push(
      `<g class="fc-node fc-terminal" data-id="${id}" tabindex="0"><rect x="${cx - w / 2}" y="${y}" width="${w}" height="${PH}" rx="${PH / 2}"/>` +
        `<text x="${cx}" y="${y + PH / 2}">${text}</text></g>`
    );
  }

  function render(program, scn) {
    const B = makeLayout(scn).seq(program.body, 'top');
    const o = { e: [], n: [] };
    let y = 0;
    pill(o, 0, 0, 'Start', 'start');
    y = PH;
    if (!B.empty) {
      path(o, [[0, y], [0, y + GAP]]);
      y += GAP;
      B.draw(0, y, o);
      y += B.H;
    }
    if (B.exit) {
      path(o, [[0, y], [0, y + GAP]]);
      y += GAP;
      pill(o, 0, y, 'End', 'end');
      y += PH;
    }
    const Lx = Math.max(B.L, 70) + 30;
    const Rx = Math.max(B.R, 70) + 30;
    const vb = [-Lx, -24, Lx + Rx, y + 48];
    const svg =
      `<svg class="fc-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f).join(' ')}" width="${f(vb[2])}" height="${f(vb[3])}">` +
      `<defs><marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="fc-arrowhead" d="M0,0 L10,5 L0,10 z"/></marker></defs>` +
      `<g class="fc-edges">${o.e.join('')}</g><g class="fc-nodes">${o.n.join('')}</g></svg>`;
    return { svg, width: vb[2], height: vb[3] };
  }

  FL.flowchart = { render };
})();
