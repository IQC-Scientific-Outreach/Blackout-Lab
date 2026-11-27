// Canvas renderer. The room is drawn fully lit, then covered by a darkness
// mask with holes cut for the flashlight beam and for anything that glows. Things
// that give off their own light (LED strips, screens, superposed platforms,
// signs, speech bubbles) are drawn again on top, so they stay readable in the dark.

import { WORLD, PLATFORM_H } from './levels.js';
import { TORCH, PLAYER, slotRect, slotMid, doorRect, lockRect, lampPos, screenRect, boxRect, cryoRect, canisterRect, center, handOf, LIGHT_KINDS } from './geometry.js';

const C = {
  wallTop: '#1a2942',
  wallBottom: '#0d1626',
  seam: 'rgba(120,150,200,0.16)',
  concrete: '#33415a',
  concreteEdge: '#5a6d8f',
  steel: '#4a5a78',
  steelLight: '#8195b8',
  hazard: '#e0b040',
  ink: '#dbe7f5',
  dim: '#8fa3bd',
  torch: '#ffd98a',
  qubit: '#5ee6ff',
  link: '#ff7ad9',
  zero: '#8fb3ff',
  one: '#ffd98a',
  ok: '#7dffa8',
  bad: '#ff6b6b',
  dark: 'rgba(3,6,12,0.9)',
};

const SIGN_FONT = '"Big Shoulders Display", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const MONO_FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const BODY_FONT = '"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// How each character is dressed.
const PEOPLE = {
  professor: { hair: '#f1f1f1', skin: '#eac4a2', top: '#f4f4f0', legs: '#3a3f52', coat: true, glasses: true, wild: true },
  alice: { hair: '#a8452f', skin: '#f0c9a6', top: '#8a5fd0', legs: '#2f3e63', long: true },
  bob: { hair: '#1d1a1a', skin: '#c99670', top: '#3f9d6b', legs: '#3b3b4a' },
};

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

// The canister sprite, standing on baseY. Shared with the canister view in the rack.
//
// `state` (canister view only) lights its two bands the way platforms show a qubit:
//   { value: 0 | 1 }   definite: the bottom band (0) or the top band (1) glows bright blue
//   { p1, t }          superposed or entangled: both bands get a moving dashed outline,
//                      each as strong as the chance of its value, like a platform's outlines
export function paintCanister(ctx, x, baseY, state) {
  const bands = [
    { value: 1, y: baseY - 16 },
    { value: 0, y: baseY - 6 },
  ];
  ctx.fillStyle = '#9fb3d6';
  rr(ctx, x - 5, baseY - 19, 10, 19, 4);
  ctx.fill();
  for (const band of bands) {
    const lit = state && state.value === band.value;
    ctx.save();
    if (lit) {
      ctx.shadowColor = '#3ea6ff';
      ctx.shadowBlur = 6;
    }
    ctx.fillStyle = lit ? '#3ea6ff' : '#5d7299';
    ctx.fillRect(x - 6, band.y, 12, 2.5);
    ctx.restore();
    if (state && state.p1 !== undefined) {
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.7 * (band.value ? state.p1 : 1 - state.p1);
      ctx.strokeStyle = '#5ee6ff';
      ctx.lineWidth = 0.55;
      ctx.setLineDash([1.4, 1]);
      ctx.lineDashOffset = -(state.t || 0) * 3;
      ctx.strokeRect(x - 6.6, band.y - 0.6, 13.2, 3.7);
      ctx.restore();
    }
  }
  ctx.fillStyle = '#2a3855';
  ctx.fillRect(x - 2, baseY - 22, 4, 3);
}

// Show gates (developer option): a gate popping up over a qubit, drawn like the
// circuit diagram. `part.role` is 'box' (a gate square with its letter), 'ctrl'
// (a CNOT's control dot) or 'targ' (its target, a circled plus). `k` runs 0 to 1
// over the animation: in with a spring, hold, then out. `size` is the box width.
export const GATE_COLORS = { h: '#5ee6ff', x: '#ffd98a', z: '#8fb3ff', ry: '#c39bff', cx: '#ff8adf', cz: '#ff8adf', swap: '#e6edf7' };

export function gatePop(k, calm) {
  if (calm) return { scale: 1, alpha: k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1, glow: k < 0.2 ? 1 : Math.max(0.35, 1 - (k - 0.2) * 2) };
  let scale = 1;
  if (k < 0.2) {
    const u = k / 0.2 - 1; // ease out with a small overshoot
    scale = 1 + 2.7 * u * u * u + 1.7 * u * u;
  } else if (k > 0.8) {
    const u = (k - 0.8) / 0.2;
    scale = 1 - u * u;
  }
  return { scale: Math.max(0, scale), alpha: 1, glow: k < 0.2 ? 1 : Math.max(0.35, 1 - (k - 0.2) * 2) };
}

export function paintGate(ctx, x, y, part, pop, size) {
  const half = size / 2;
  const color = GATE_COLORS[part.gate] || '#dbe7f5';
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pop.scale, pop.scale);
  ctx.globalAlpha = pop.alpha;
  ctx.lineWidth = size * 0.06;
  // A soft white halo behind the gate, brightest as it appears.
  const halo = ctx.createRadialGradient(0, 0, size * 0.2, 0, 0, size * 1.15);
  halo.addColorStop(0, `rgba(255,255,255,${0.42 * pop.glow})`);
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(-size * 1.15, -size * 1.15, size * 2.3, size * 2.3);
  // The white outline under a light blur, strongest as the gate appears. (The halo above
  // carries most of the glow: blurs are costly, so there is only one, and a small one.)
  const glow = () => {
    ctx.shadowColor = `rgba(255,255,255,${pop.glow})`;
    ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pop.glow})`;
    ctx.lineWidth = size * 0.07;
    ctx.shadowBlur = size * 0.5 * pop.glow;
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
  if (part.role === 'box') {
    rr(ctx, -half, -half, size, size, size * 0.19);
    ctx.fillStyle = '#152036';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
    rr(ctx, -half - size * 0.08, -half - size * 0.08, size * 1.16, size * 1.16, size * 0.25);
    glow();
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.round(size * 0.46)}px 'JetBrains Mono', ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(part.symbol, 0, size * 0.03);
  } else if (part.role === 'swap') {
    // A swap's end: a cross, as in a circuit diagram.
    const r = size * 0.28;
    ctx.beginPath();
    ctx.moveTo(-r, -r);
    ctx.lineTo(r, r);
    ctx.moveTo(r, -r);
    ctx.lineTo(-r, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
    glow();
  } else if (part.role === 'ctrl') {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.17, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.27, 0, Math.PI * 2);
    glow();
  } else {
    const r = size * 0.37;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#152036';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r + size * 0.09, 0, Math.PI * 2);
    glow();
  }
  ctx.restore();
}

// The glowing white line joining a CNOT's control and target.
export function paintGateLink(ctx, a, b, pop, size) {
  ctx.save();
  ctx.globalAlpha = pop.alpha * Math.min(1, pop.scale);
  ctx.shadowColor = `rgba(255,255,255,${pop.glow})`;
  ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pop.glow})`;
  ctx.lineWidth = size * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.shadowBlur = size * 0.5 * pop.glow;
  ctx.stroke();
  ctx.restore();
}

const CAT = { fur: '#f0a04b', stripe: '#b9631c', chest: '#fbe3c0', eye: '#1d3b16' };

// The cat, sitting on y. `dead` (the canister view's cat): upside down, eyes crossed out.
export function paintCat(ctx, x, y, dead) {
  ctx.save();
  if (dead) {
    // Upside down, legs in the air, around the middle of the body.
    ctx.translate(x, y - 9);
    ctx.rotate(Math.PI);
    ctx.translate(-x, -(y - 9));
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = CAT.fur;
  ctx.lineWidth = 2.4;
  ctx.beginPath(); // tail
  ctx.moveTo(x - 6, y - 4);
  ctx.quadraticCurveTo(x - 13, y - 6, x - 11, y - 14);
  ctx.stroke();
  ctx.fillStyle = CAT.fur;
  ctx.beginPath();
  ctx.ellipse(x, y - 5, 7, 6, 0, 0, Math.PI * 2); // body
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 5, y - 12, 4.5, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.beginPath(); // ears
  ctx.moveTo(x + 1.5, y - 14);
  ctx.lineTo(x + 2.5, y - 19);
  ctx.lineTo(x + 5, y - 15.5);
  ctx.moveTo(x + 5.5, y - 15.5);
  ctx.lineTo(x + 8, y - 19);
  ctx.lineTo(x + 9, y - 14);
  ctx.fill();
  ctx.fillStyle = CAT.chest;
  ctx.beginPath();
  ctx.ellipse(x + 4, y - 5, 2.6, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = CAT.stripe;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); // tabby stripes
  for (const dx of [-4, -1.5]) {
    ctx.moveTo(x + dx, y - 10);
    ctx.lineTo(x + dx - 0.5, y - 6.5);
  }
  ctx.stroke();
  if (dead) {
    ctx.strokeStyle = CAT.eye; // eyes crossed out
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const ex of [4, 7]) {
      ctx.moveTo(x + ex - 1.1, y - 13.4);
      ctx.lineTo(x + ex + 1.1, y - 11.2);
      ctx.moveTo(x + ex + 1.1, y - 13.4);
      ctx.lineTo(x + ex - 1.1, y - 11.2);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = CAT.eye;
    ctx.fillRect(x + 3.2, y - 13.2, 1.6, 1.8);
    ctx.fillRect(x + 6.2, y - 13.2, 1.6, 1.8);
  }
  ctx.restore();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const mask = document.createElement('canvas');
  const mctx = mask.getContext('2d');
  const calm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let scale = 1;
  // The darkness is drawn small and stretched over the picture: it is all soft edges,
  // so the stretch blurs it for free, and it is a fraction of the pixels to fill and copy.
  let maskScale = 0.5;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = rect.width || WORLD.w;
    scale = Math.max(0.5, Math.min(2, (cssW / WORLD.w) * dpr));
    const w = Math.round(WORLD.w * scale);
    const h = Math.round(WORLD.h * scale);
    maskScale = Math.min(scale, 0.5);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      mask.width = Math.round(WORLD.w * maskScale);
      mask.height = Math.round(WORLD.h * maskScale);
    }
  }

  function label(text, x, y, color, size, align, font) {
    ctx.font = `700 ${size || 12}px ${font || MONO_FONT}`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function tag(text, x, y, color) {
    ctx.font = `700 11px ${MONO_FONT}`;
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(7,11,20,0.82)';
    rr(ctx, x - w / 2, y - 8, w, 16, 4);
    ctx.fill();
    label(text, x, y + 0.5, color, 11);
  }

  // -- lit layer: the room itself ---------------------------------------------

  function drawWall(G) {
    const g = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    g.addColorStop(0, C.wallTop);
    g.addColorStop(1, C.wallBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.strokeStyle = C.seam;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 60; y < WORLD.h; y += 60) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(WORLD.w, y + 0.5);
      const shift = (y / 60) % 2 ? 0 : 60;
      for (let x = shift; x < WORLD.w; x += 120) {
        ctx.moveTo(x + 0.5, y - 60);
        ctx.lineTo(x + 0.5, y);
      }
    }
    ctx.stroke();

    if (G.level.story) return drawCeiling(); // story levels are not numbered floors
    ctx.save();
    ctx.fillStyle = 'rgba(219,231,245,0.17)';
    ctx.font = `800 150px ${SIGN_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const bonus = /^Bonus level (\d+)/.exec(G.level.tag || ''); // a bonus level is painted B1, B2, ...
    ctx.fillText(bonus ? `B${bonus[1]}` : String(G.levelIndex + 1).padStart(2, '0'), 250, 200);
    ctx.font = `700 22px ${SIGN_FONT}`;
    ctx.fillStyle = 'rgba(219,231,245,0.24)';
    ctx.fillText(bonus ? 'BONUS' : 'FLOOR', 254, 78);
    ctx.restore();
    drawCeiling();
  }

  function drawCeiling() {
    ctx.fillStyle = '#22314c';
    ctx.fillRect(0, 22, WORLD.w, 9);
    ctx.fillStyle = '#31456a';
    for (let x = 70; x < WORLD.w; x += 190) ctx.fillRect(x, 19, 12, 15);
  }

  function windows(G) {
    const out = [];
    const set = G.level.windows;
    if (set) return set.xs.map((x) => ({ x, y: set.y, w: 46, h: 84 }));
    for (let i = 0; i < 3; i += 1) out.push({ x: 170 + i * 250 + ((G.levelIndex * 37 + G.roomIndex * 80) % 60), y: 70, w: 46, h: 84 });
    return out;
  }

  function drawWindows(G, glowOnly) {
    for (const w of windows(G)) {
      if (!glowOnly) {
        ctx.fillStyle = '#0a1120';
        ctx.fillRect(w.x - 4, w.y - 4, w.w + 8, w.h + 8);
      }
      const g = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
      g.addColorStop(0, glowOnly ? 'rgba(70,100,170,0.30)' : '#25365c');
      g.addColorStop(1, glowOnly ? 'rgba(40,60,110,0.18)' : '#16223d');
      ctx.fillStyle = g;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = glowOnly ? 'rgba(10,17,32,0.7)' : '#0a1120';
      ctx.fillRect(w.x + w.w / 2 - 1.5, w.y, 3, w.h);
      ctx.fillRect(w.x, w.y + w.h / 2 - 1.5, w.w, 3);
    }
  }

  function drawDecor(G) {
    for (const d of G.room.decor) {
      if (d.type === 'sign') {
        ctx.save();
        ctx.fillStyle = 'rgba(240,228,190,0.7)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `800 30px ${SIGN_FONT}`;
        d.lines.forEach((line, i) => ctx.fillText(line, d.x, d.y + i * 32));
        ctx.restore();
      } else if (d.type === 'entrance') {
        // The street door the player came in by: open, daylight beyond, until they walk away.
        const r = doorRect(d);
        const open = G.player.x < d.x + 40 && !G.blackout;
        if (open) {
          ctx.fillStyle = '#cfe2ff';
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        drawDoorLeaf(r, open, '#44597f');
        ctx.fillStyle = '#2b3954';
        ctx.fillRect(r.x - 6, r.y - 8, r.w + 12, 8);
      } else if (d.type === 'candle') {
        ctx.fillStyle = '#3a4d72';
        ctx.fillRect(d.x - 9, d.y + 10, 18, 3); // bracket
        ctx.fillRect(d.x - 1, d.y + 13, 2, 8);
        ctx.fillStyle = '#efe6c8';
        ctx.fillRect(d.x - 3, d.y - 2, 6, 12);
      } else if (d.type === 'teleporter') {
        ctx.fillStyle = '#2c3d5e';
        ctx.fillRect(d.x - 34, d.y - 8, 68, 8);
        ctx.fillRect(d.x - 34, d.y - 84, 9, 76);
        ctx.fillRect(d.x + 25, d.y - 84, 9, 76);
        ctx.fillRect(d.x - 34, d.y - 92, 68, 10);
        ctx.fillStyle = '#42587f';
        for (let y = d.y - 76; y < d.y - 12; y += 12) {
          ctx.fillRect(d.x - 36, y, 13, 4);
          ctx.fillRect(d.x + 23, y, 13, 4);
        }
      }
    }
  }

  function drawSolids(G) {
    for (const s of G.room.solids) {
      if (s.kind === 'ground') {
        ctx.fillStyle = C.concrete;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = C.concreteEdge;
        ctx.fillRect(s.x, s.y, s.w, 4);
        const edges = [];
        if (s.x + s.w < WORLD.w) edges.push(s.x + s.w - 6);
        if (s.x > 0) edges.push(s.x);
        for (const edgeX of edges) {
          for (let y = s.y + 8; y < Math.min(s.y + 64, s.y + s.h); y += 14) {
            ctx.fillStyle = C.hazard;
            ctx.fillRect(edgeX, y, 6, 7);
          }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let y = s.y + 30; y < s.y + s.h; y += 34) ctx.fillRect(s.x, y, s.w, 2);
      } else {
        ctx.strokeStyle = '#2b3b59';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x + 10, 31);
        ctx.lineTo(s.x + 10, s.y);
        ctx.moveTo(s.x + s.w - 10, 31);
        ctx.lineTo(s.x + s.w - 10, s.y);
        ctx.stroke();
        ctx.fillStyle = C.steel;
        rr(ctx, s.x, s.y, s.w, s.h, 3);
        ctx.fill();
        ctx.fillStyle = C.steelLight;
        ctx.fillRect(s.x + 2, s.y, s.w - 4, 3);
      }
    }
  }

  function drawRails(p) {
    ctx.strokeStyle = '#2a3a58';
    ctx.lineWidth = 3;
    if (p.axis === 'x') {
      // A sideways platform runs along a track under both of its slots.
      const y = p.y + PLATFORM_H + 4;
      ctx.beginPath();
      ctx.moveTo(Math.min(p.x0, p.x1) - 8, y);
      ctx.lineTo(Math.max(p.x0, p.x1) + p.w + 8, y);
      ctx.stroke();
      ctx.fillStyle = '#3a4d72';
      for (const x of [p.x0, p.x1]) ctx.fillRect(x + p.w / 2 - 5, y - 1, 10, 3);
      return;
    }
    ctx.beginPath();
    for (const x of [p.x + 9, p.x + p.w - 9]) {
      ctx.moveTo(x, p.y1 - 14);
      ctx.lineTo(x, p.y0 + PLATFORM_H + 12);
    }
    ctx.stroke();
    ctx.fillStyle = '#3a4d72';
    for (const y of [p.y1, p.y0]) {
      ctx.fillRect(p.x + 4, y + PLATFORM_H, 10, 3);
      ctx.fillRect(p.x + p.w - 14, y + PLATFORM_H, 10, 3);
    }
  }

  function platformPath(p, x, y) {
    const w = p.w;
    const h = PLATFORM_H;
    ctx.beginPath();
    if (p.half === 'left') {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - 5, y);
      ctx.lineTo(x + w, y + 4);
      ctx.lineTo(x + w - 6, y + 8);
      ctx.lineTo(x + w - 1, y + h);
      ctx.lineTo(x, y + h);
    } else if (p.half === 'right') {
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + 2, y + h);
      ctx.lineTo(x + 7, y + 8);
      ctx.lineTo(x, y + 4);
    } else {
      rr(ctx, x, y, w, h, 3);
      return;
    }
    ctx.closePath();
  }

  function drawPlatformBody(p) {
    ctx.fillStyle = '#566a8f';
    platformPath(p, p.x, p.y);
    ctx.fill();
    ctx.fillStyle = '#93a8cd';
    ctx.fillRect(p.x + 7, p.y, p.w - 14, 3);
    ctx.fillStyle = '#2a3855';
    ctx.fillRect(p.x + 8, p.y + PLATFORM_H - 4, p.w - 16, 2);
  }

  function drawBox(G, term) {
    const r = boxRect(term);
    const opened = !!G.flags.opened;
    const shake = !opened ? Math.sin(G.t * 23) * (Math.sin(G.t * 1.7) > 0.86 ? 1.2 : 0) : 0;
    ctx.save();
    ctx.translate(shake, 0);
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(r.x, r.y + 5, r.w, r.h - 5);
    ctx.fillStyle = '#5d4329';
    ctx.fillRect(r.x, r.y + 13, r.w, 2);
    ctx.fillRect(r.x + 6, r.y + 5, 2, r.h - 5);
    ctx.fillRect(r.x + r.w - 8, r.y + 5, 2, r.h - 5);
    ctx.fillStyle = '#8d6a45';
    if (opened) {
      ctx.save();
      ctx.translate(r.x + r.w, r.y + 5);
      ctx.rotate(-1.1);
      ctx.fillRect(-r.w - 1, -5, r.w + 2, 5);
      ctx.restore();
    } else ctx.fillRect(r.x - 1, r.y, r.w + 2, 6);
    ctx.fillStyle = '#16213a';
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + 19, 4.5, 0, Math.PI * 2);
    ctx.fill();
    if (opened) drawCat(r.x + r.w / 2 - 2, r.y + 6);
    ctx.restore();
  }


  function drawCat(x, y) {
    paintCat(ctx, x, y);
  }

  function drawCatRun(x, y, stride, tilt) {
    ctx.save();
    ctx.translate(x, y - 8);
    ctx.rotate(tilt);
    ctx.lineCap = 'round';
    ctx.strokeStyle = CAT.fur;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); // tail, streaming behind
    ctx.moveTo(-9, -1);
    ctx.quadraticCurveTo(-16, -3, -19, -8);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.beginPath(); // legs
    ctx.moveTo(6, 2);
    ctx.lineTo(7 + stride * 6, 8);
    ctx.moveTo(4, 2);
    ctx.lineTo(4 - stride * 4, 8);
    ctx.moveTo(-6, 2);
    ctx.lineTo(-7 - stride * 6, 8);
    ctx.moveTo(-4, 2);
    ctx.lineTo(-4 + stride * 4, 8);
    ctx.stroke();
    ctx.fillStyle = CAT.fur;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(11, -4, 4.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // ears
    ctx.moveTo(8, -6.5);
    ctx.lineTo(8.5, -11.5);
    ctx.lineTo(11, -8);
    ctx.moveTo(11.5, -8);
    ctx.lineTo(14, -11.5);
    ctx.lineTo(14.5, -6.5);
    ctx.fill();
    ctx.strokeStyle = CAT.stripe;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const dx of [-5, -1.5, 2]) {
      ctx.moveTo(dx, -4);
      ctx.lineTo(dx - 0.5, -0.5);
    }
    ctx.stroke();
    ctx.fillStyle = CAT.eye;
    ctx.fillRect(12.4, -5.2, 1.6, 1.8);
    ctx.restore();
  }

  function drawTerminal(G, term) {
    if (term.box) {
      drawBox(G, term);
      return;
    }
    const s = screenRect(term);
    ctx.fillStyle = '#1b2740';
    rr(ctx, s.x - 5, s.y - 5, s.w + 10, s.h + 12, 3); // wall plate
    ctx.fill();
    ctx.fillStyle = '#2f4062';
    ctx.fillRect(term.x - 2, s.y + s.h + 2, 4, 9); // arm down to the shelf
    ctx.fillStyle = '#0c1422';
    rr(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, 3); // bezel
    ctx.fill();
    ctx.fillStyle = '#3a4d72';
    ctx.beginPath();
    ctx.moveTo(term.x - 15, term.y - 31);
    ctx.lineTo(term.x + 15, term.y - 31);
    ctx.lineTo(term.x + 13, term.y - 26);
    ctx.lineTo(term.x - 13, term.y - 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1b2740';
    ctx.fillRect(term.x - 11, term.y - 30, 22, 2);
    if (term.port) {
      ctx.fillStyle = '#16213a';
      ctx.beginPath();
      ctx.arc(term.x, term.y - 15, 6, 0, Math.PI * 2); // canister port
      ctx.fill();
    }
    if (term.sealed) {
      const c = cryoRect(term);
      ctx.fillStyle = '#3d4f72';
      rr(ctx, c.x, c.y, c.w, c.h, 5);
      ctx.fill();
      ctx.fillStyle = '#5d7299';
      ctx.fillRect(c.x - 2, c.y + 4, c.w + 4, 3);
      ctx.fillRect(c.x - 2, c.y + c.h - 7, c.w + 4, 3);
    }
  }

  function drawCanister(x, baseY) {
    paintCanister(ctx, x, baseY);
  }

  function drawPickups(G) {
    const c = G.canister;
    if (c && c.roomId === G.room.id) {
      ctx.fillStyle = '#2f4062'; // its dock
      ctx.fillRect(c.x - 9, c.y - 4, 18, 4);
      ctx.fillRect(c.x - 9, c.y - 10, 2, 6);
      ctx.fillRect(c.x + 7, c.y - 10, 2, 6);
      if (!c.carried) drawCanister(c.x, c.y - 4);
    }
    const fl = G.room.flashlight;
    if (fl && !fl.taken) {
      // A flashlight lying on the floor, its lens glinting.
      const bob = Math.sin(G.t * 3) * 1.5;
      ctx.save();
      ctx.translate(fl.x, fl.y - 6 + bob);
      ctx.fillStyle = '#2b3550';
      rr(ctx, -11, -4, 16, 8, 2);
      ctx.fill();
      ctx.fillStyle = '#55617a';
      ctx.fillRect(-11, -4, 3, 8);
      ctx.fillStyle = '#3a4762';
      ctx.fillRect(5, -6, 6, 12);
      ctx.fillStyle = C.torch;
      ctx.fillRect(10, -5, 2, 10);
      ctx.restore();
    }
    const b = G.room.battery;
    if (b) {
      ctx.fillStyle = '#1b2740';
      rr(ctx, b.x - 15, b.y - 56, 30, 40, 4); // wall cabinet
      ctx.fill();
      ctx.fillStyle = '#0c1422';
      ctx.fillRect(b.x - 10, b.y - 50, 20, 28);
      if (!b.taken) {
        ctx.fillStyle = '#5fbf7a';
        ctx.fillRect(b.x - 5, b.y - 46, 10, 20);
        ctx.fillStyle = '#d7dbe2';
        ctx.fillRect(b.x - 2, b.y - 49, 4, 3);
      }
    }
  }

  function drawDoorLeaf(r, open, colour) {
    ctx.fillStyle = '#1b2740';
    ctx.fillRect(r.x - 5, r.y - 5, r.w + 10, r.h + 5);
    if (open) {
      const g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
      g.addColorStop(0, '#f6f2d4');
      g.addColorStop(1, '#c9d9c0');
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = colour;
      ctx.fillRect(r.x + r.w - 8, r.y, 8, r.h); // the leaf, swung open
      return;
    }
    ctx.fillStyle = colour;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(r.x + 5, r.y + 6, r.w - 10, 26);
    ctx.fillRect(r.x + 5, r.y + 38, r.w - 10, 26);
    ctx.fillStyle = C.hazard;
    ctx.fillRect(r.x + r.w - 11, r.y + 34, 5, 5);
  }

  function drawDoors(G) {
    for (const p of G.room.portals) drawDoorLeaf(doorRect(p), false, '#4d5f96');
    const door = G.room.door;
    if (!door) return;
    drawDoorLeaf(doorRect(door), door.open, '#44597f');
    if (door.key) {
      const l = lockRect(door);
      ctx.fillStyle = '#16213a';
      rr(ctx, l.x, l.y, l.w, l.h, 4);
      ctx.fill();
      ctx.strokeStyle = '#3a4d72';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawPerson(x, footY, look, opts) {
    const o = opts || {};
    const sway = o.shake || 0;
    const cx = x + sway;
    const top = footY - 34;
    const step = (o.step || 0) * 4; // legs swing while walking
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = look.legs;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 3, top + 23);
    ctx.lineTo(cx - 3 + step, footY - 1);
    ctx.moveTo(cx + 3, top + 23);
    ctx.lineTo(cx + 3 - step, footY - 1);
    ctx.stroke();
    ctx.fillStyle = look.top;
    rr(ctx, cx - 7, top + 10, 14, look.coat ? 20 : 15, 4);
    ctx.fill();
    if (look.coat) {
      ctx.fillStyle = '#c9ccd4';
      ctx.fillRect(cx - 0.5, top + 14, 1, 16);
      ctx.fillStyle = '#c0392b'; // bow tie
      ctx.fillRect(cx - 3, top + 11, 6, 3);
    }
    ctx.strokeStyle = look.top;
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (o.armsUp) {
      ctx.moveTo(cx - 6, top + 13);
      ctx.lineTo(cx - 12, top + 3);
      ctx.moveTo(cx + 6, top + 13);
      ctx.lineTo(cx + 12, top + 3);
    } else {
      ctx.moveTo(cx - 7, top + 13);
      ctx.lineTo(cx - 8, top + 23);
      ctx.moveTo(cx + 7, top + 13);
      ctx.lineTo(cx + 8, top + 23);
    }
    ctx.stroke();
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(cx, top + 6, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.hair;
    if (look.wild) {
      for (const [dx, dy, r] of [[-6, 3, 3.6], [6, 3, 3.6], [-4, -1, 3], [4, -1, 3], [0, -1, 2.6]]) {
        ctx.beginPath();
        ctx.arc(cx + dx, top + 2 + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(cx, top + 5, 6, Math.PI, 0);
      ctx.fill();
      if (look.long) {
        ctx.fillRect(cx - 6.5, top + 4, 3, 11);
        ctx.fillRect(cx + 3.5, top + 4, 3, 11);
      }
    }
    if (look.glasses) {
      ctx.strokeStyle = '#1c1c22';
      ctx.lineWidth = 1.3;
      ctx.fillStyle = 'rgba(220,240,255,0.55)';
      for (const dx of [-3, 3]) {
        ctx.beginPath();
        ctx.arc(cx + dx, top + 6.5, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawNpcs(G) {
    for (const n of G.room.npcs) {
      const panicking = n.kind === 'professor' && !G.flags.opened;
      drawPerson(n.x, n.y, PEOPLE[n.kind], {
        armsUp: panicking,
        shake: panicking ? Math.sin(G.t * 26) * 0.9 : 0,
      });
    }
  }

  function drawPlayer(G) {
    const p = G.player;
    const f = p.facing;
    const cx = p.x + PLAYER.w / 2;
    const run = p.onGround && Math.abs(p.vx) > 20 ? Math.sin(p.anim * 14) : 0;
    ctx.save();
    ctx.lineCap = 'round';
    if (G.canister && G.canister.carried) drawCanister(cx - f * 8, p.y + 27); // on the back
    ctx.strokeStyle = '#33456e'; // jeans
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 3, p.y + 21);
    ctx.lineTo(cx - 3 + run * 4, p.y + PLAYER.h - 2);
    ctx.moveTo(cx + 3, p.y + 21);
    ctx.lineTo(cx + 3 - run * 4, p.y + PLAYER.h - 2);
    ctx.stroke();
    ctx.strokeStyle = '#e9ecf2'; // trainers
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 3 + run * 4, p.y + PLAYER.h - 1);
    ctx.lineTo(cx - 3 + run * 4 + f * 2, p.y + PLAYER.h - 1);
    ctx.moveTo(cx + 3 - run * 4, p.y + PLAYER.h - 1);
    ctx.lineTo(cx + 3 - run * 4 + f * 2, p.y + PLAYER.h - 1);
    ctx.stroke();
    ctx.fillStyle = '#3f8f9a'; // hoodie
    rr(ctx, cx - 7, p.y + 9, 14, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#35777f';
    ctx.fillRect(cx - 4, p.y + 18, 8, 4); // pocket
    ctx.fillStyle = '#eec3a0';
    ctx.beginPath();
    ctx.arc(cx, p.y + 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3324'; // hair
    ctx.beginPath();
    ctx.arc(cx, p.y + 5, 5.6, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();
    ctx.fillRect(cx - 5.5 - (f > 0 ? 0.5 : 0), p.y + 3, 3, 4);
    if (G.scene && G.scene.phase === 'crank') {
      const grip = crankGrip(G);
      ctx.strokeStyle = '#3f8f9a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, p.y + 13);
      ctx.lineTo(grip.x, grip.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (G.torch.battery === 'none') {
      ctx.restore(); // no flashlight yet: arms at the sides
      return;
    }
    const hand = handOf(p);
    const a = G.torch.lowered ? (f > 0 ? 1.2 : Math.PI - 1.2) : G.torch.angle;
    ctx.strokeStyle = '#3f8f9a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, p.y + 13);
    ctx.lineTo(hand.x + Math.cos(a) * 3, hand.y + Math.sin(a) * 3);
    ctx.stroke();
    ctx.translate(hand.x + Math.cos(a) * 4, hand.y + Math.sin(a) * 4);
    ctx.rotate(a);
    ctx.fillStyle = '#1c2436';
    ctx.fillRect(-2, -2.5, 9, 5);
    ctx.fillStyle = G.torch.active ? C.torch : '#55617a';
    ctx.fillRect(7, -3.5, 3, 7);
    ctx.restore();
  }

  // -- darkness -------------------------------------------------------------

  function hole(x, y, radius, strength) {
    const g = mctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    mctx.fillStyle = g;
    mctx.beginPath();
    mctx.arc(x, y, radius, 0, Math.PI * 2);
    mctx.fill();
  }

  function beamPath(c, hand, angle, range) {
    c.beginPath();
    c.moveTo(hand.x, hand.y);
    c.arc(hand.x, hand.y, range, angle - TORCH.half, angle + TORCH.half);
    c.closePath();
  }

  function drawDarkness(G) {
    const room = G.room;
    mctx.setTransform(maskScale, 0, 0, maskScale, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    mctx.clearRect(0, 0, WORLD.w, WORLD.h);
    mctx.fillStyle = C.dark;
    mctx.fillRect(0, 0, WORLD.w, WORLD.h);
    mctx.globalCompositeOperation = 'destination-out';

    const p = G.player;
    const dead = G.torch.battery === 'dead';
    hole(p.x + PLAYER.w / 2, p.y + PLAYER.h / 2, dead ? 58 : 84, 0.72);
    for (const term of room.terminals) {
      if (term.box) hole(term.x, term.y - 14, 40, 0.45);
      else hole(term.x, term.y - 50, term.port ? 30 : 46, term.port ? 0.32 : 0.5);
    }
    for (const n of room.npcs) hole(n.x, n.y - 20, 46, 0.55);
    for (const pt of room.portals) hole(pt.x, pt.y - 52, 60, 0.5);
    if (room.battery) hole(room.battery.x, room.battery.y - 36, 44, 0.5);
    if (room.flashlight && !room.flashlight.taken) hole(room.flashlight.x, room.flashlight.y - 8, 40, 0.6);
    for (const ic of room.intercoms || []) hole(ic.x, ic.y - 50, 26, 0.35);
    if (G.canister && !G.canister.carried && G.canister.roomId === room.id) hole(G.canister.x, G.canister.y - 12, 34, 0.5);
    for (const d of room.decor) {
      if (d.type === 'candle') hole(d.x, d.y - 30 + (d.drop || 0), (d.reach || 118) + (Math.sin(G.t * 11) * 4), 0.86);
      if (d.type === 'teleporter') hole(d.x, d.y - 46, 70, 0.55);
    }
    if (room.door) {
      const c = center(doorRect(room.door));
      hole(c.x, c.y - 26, room.door.open ? 96 : 64, room.door.open ? 0.85 : 0.5);
    }
    // Backup lights cut their traced cones (shadows included) out of the dark.
    for (const light of room.lights || []) {
      if (!light.poly) continue;
      const g = mctx.createRadialGradient(light.x, light.y, 6, light.x, light.y, light.range);
      const strength = light.kind === 'weak' ? 0.62 : 0.92;
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.7, `rgba(0,0,0,${strength * 0.75})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.fillStyle = g;
      polyPath(mctx, light.poly);
      mctx.fill();
      hole(light.x, light.y, 26, 0.7); // the lamp itself
    }

    if (G.torch.active) {
      const hand = handOf(p);
      const g = mctx.createRadialGradient(hand.x, hand.y, 8, hand.x, hand.y, G.torch.range);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.92)');
      g.addColorStop(0.9, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.fillStyle = g;
      beamPath(mctx, hand, G.torch.angle, G.torch.range); // its edge is softened by the stretch below
      mctx.fill();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (G.torch.active) {
      const hand = handOf(p);
      const g = ctx.createRadialGradient(hand.x, hand.y, 4, hand.x, hand.y, G.torch.range);
      g.addColorStop(0, 'rgba(255,217,138,0.20)');
      g.addColorStop(1, 'rgba(255,217,138,0)');
      ctx.fillStyle = g;
      beamPath(ctx, hand, G.torch.angle, G.torch.range);
      ctx.fill();
    }
  }

  // -- things that glow -----------------------------------------------------

  // `fade` (0 to 1) thins the outline for a state close to 0 or 1 (see drawPlatformGlow).
  function drawGhost(G, p, state, prob, lit, percent, fade = 1) {
    const r = slotRect(p, state);
    const jitter = Math.sin(G.t * 9 + p.x + state * 2) * 1.2;
    ctx.save();
    ctx.globalAlpha = (0.3 + 0.7 * prob) * fade;
    ctx.fillStyle = 'rgba(94,230,255,0.10)';
    platformPath(p, r.x, r.y + jitter);
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -G.t * 22;
    ctx.strokeStyle = C.qubit;
    ctx.lineWidth = lit ? 2.5 : 1.8;
    ctx.stroke();
    ctx.restore();
    tag(`${state} · ${percent}%`, r.x + r.w / 2, r.y - 12, C.qubit);
  }

  // How far a light has got towards measuring a platform: a ring filling up.
  function exposureRing(x, y, part, color) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, part));
    ctx.stroke();
  }

  const LIGHT_RING = { normal: '#ffe9b0', weak: '#ffe9b0', emergency: '#ff6b6b' };

  function drawPlatformGlow(G, p) {
    const lightPart = p.lightKind ? p.lightExposure / LIGHT_KINDS[p.lightKind].dwell : 0;
    if (p.state === null) {
      const p1 = p.p1;
      const one = Math.round(p1 * 100);
      const seen = p.exposure > 0 || lightPart > 0;
      // A state part way between certain and 50/50 (a cavity's rotation) is drawn as both
      // at once: the platform at its likelier slot, as solid as the state is close to it,
      // over the 50/50 outlines, as faint as it is far from them.
      const near = Math.abs(1 - 2 * p1);
      if (near > 0.02) {
        const slot = slotRect(p, p1 > 0.5 ? 1 : 0);
        ctx.save();
        ctx.globalAlpha = near * 0.85;
        drawPlatformBody({ ...p, x: slot.x, y: slot.y });
        ctx.restore();
      }
      const fade = Math.max(0.2, 1 - near);
      drawGhost(G, p, 0, near > 0.02 ? 0.5 : 1 - p1, seen, 100 - one, fade);
      drawGhost(G, p, 1, near > 0.02 ? 0.5 : p1, seen, one, fade);
      const mid = slotMid(p);
      if (p.exposure > 0) exposureRing(mid.x, mid.y, p.exposure / TORCH.dwell, C.torch);
      else if (lightPart > 0) exposureRing(mid.x, mid.y, lightPart, LIGHT_RING[p.lightKind]);
      tag(p.q, mid.x - (seen ? 30 : 0), mid.y, C.qubit); // beside the ring while a light works on it
      return;
    }
    if (lightPart > 0) exposureRing(p.x + p.w / 2, p.y - 16, lightPart, LIGHT_RING[p.lightKind]); // an emergency light at work
    const flash = Math.max(0, p.flash);
    ctx.fillStyle = flash > 0 ? `rgba(255,255,255,${0.35 + 0.65 * flash})` : p.state ? 'rgba(255,217,138,0.75)' : 'rgba(143,179,255,0.75)';
    ctx.fillRect(p.x + 7, p.y + 1, p.w - 14, 2);
    tag(`${p.q} = ${p.state}`, p.x + p.w / 2, p.y + PLATFORM_H + 11, p.state ? C.one : C.zero);
  }

  function drawStandGlow(s) {
    const ground = s.kind === 'ground';
    ctx.fillStyle = ground ? 'rgba(219,231,245,0.30)' : 'rgba(219,231,245,0.45)';
    ctx.fillRect(s.x + (ground ? 0 : 5), s.y + 1, s.w - (ground ? 0 : 10), 2);
    if (ground) {
      ctx.fillStyle = 'rgba(224,176,64,0.85)';
      if (s.x + s.w < WORLD.w) ctx.fillRect(s.x + s.w - 10, s.y, 10, 4);
      if (s.x > 0) ctx.fillRect(s.x, s.y, 10, 4);
    }
  }

  function sealedTag(G, name, qi, x, y) {
    const definite = G.q ? G.q.definite[qi] : 0;
    tag(definite === null ? `${name} ?` : name, x, y, definite === null ? C.qubit : C.dim);
    return definite;
  }

  // A broken terminal: a cracked, flickering screen stuck on its loop. It shows the gate it
  // applies next and, along the bottom, how long until it does.
  const BROKEN_SYMBOL = { cx: 'CX', cz: 'CZ', swap: 'SW', ry: 'RY' };
  function drawBrokenScreen(G, term, s) {
    const b = term.broken;
    const op = b.ops[term.step];
    const flicker = 0.75 + 0.25 * Math.sin(G.t * 23 + term.x) * Math.sin(G.t * 7);
    ctx.fillStyle = '#2a1410';
    rr(ctx, s.x, s.y, s.w, s.h, 2);
    ctx.fill();
    ctx.globalAlpha = flicker;
    label(`${BROKEN_SYMBOL[op.gate] || op.gate.toUpperCase()} ${op.q.join('')}`, s.x + s.w / 2, s.y + 8, '#ffb070', 8);
    ctx.fillStyle = '#ff8a4a';
    ctx.fillRect(s.x + 3, s.y + s.h - 5, (s.w - 6) * Math.min(1, term.clock / b.every), 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,220,200,0.55)'; // the crack
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(s.x + s.w - 4, s.y + 1);
    ctx.lineTo(s.x + s.w - 10, s.y + 7);
    ctx.lineTo(s.x + s.w - 7, s.y + 11);
    ctx.lineTo(s.x + s.w - 14, s.y + s.h - 1);
    ctx.stroke();
  }

  function drawTerminalGlow(G, term) {
    const carrying = !!(G.canister && G.canister.carried);
    const s = screenRect(term);
    if (term.box) {
      const r = boxRect(term);
      const pulse = 0.6 + 0.4 * Math.sin(G.t * 5);
      ctx.strokeStyle = carrying ? C.torch : 'rgba(255,217,138,0.5)';
      ctx.globalAlpha = carrying ? pulse : 0.7;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + 19, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const qi = G.level.qubits.findIndex((q) => q.role === 'box');
      if (qi >= 0 && !G.flags.opened) sealedTag(G, G.level.qubits[qi].id, qi, r.x + r.w / 2, r.y - 12);
    } else if (term.broken) {
      drawBrokenScreen(G, term, s);
    } else if (term.port) {
      ctx.fillStyle = '#1a1014';
      rr(ctx, s.x, s.y, s.w, s.h, 2);
      ctx.fill();
      ctx.strokeStyle = '#a04a4a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(s.x + 9, s.y + 5);
      ctx.lineTo(s.x + s.w - 9, s.y + s.h - 5);
      ctx.moveTo(s.x + s.w - 9, s.y + 5);
      ctx.lineTo(s.x + 9, s.y + s.h - 5);
      ctx.stroke();
      const pulse = 0.6 + 0.4 * Math.sin(G.t * 5);
      ctx.strokeStyle = C.torch;
      ctx.globalAlpha = carrying ? pulse : 0.6;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(term.x, term.y - 15, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      label(term.id.replace('Port ', ''), term.x, term.y - 14.5, C.torch, 8);
    } else {
      ctx.fillStyle = term.near ? '#bff6ff' : '#3fb6cf';
      rr(ctx, s.x, s.y, s.w, s.h, 2);
      ctx.fill();
      label(term.id, s.x + s.w / 2, s.y + s.h / 2 + 0.5, '#06202a', 10);
      ctx.fillStyle = 'rgba(94,230,255,0.55)'; // lit keys
      for (let i = 0; i < 6; i += 1) ctx.fillRect(term.x - 10 + i * 3.6, term.y - 30, 2, 1.5);
    }
    const catOut = !!(term.box && G.flags.opened);
    // A passive terminal (developer option) needs no E: its gates show by themselves. Petting the cat still does.
    const passive = G.dev.passiveTerminal && !catOut && !term.quick;
    if (term.near && G.mode === 'play' && !passive && (!term.port || carrying || catOut)) {
      const bob = Math.sin(G.t * 5) * 2;
      tag('E', term.x + (catOut ? 3 : 0), s.y - (catOut ? 28 : 14) + bob, C.torch);
    }
    if (term.sealed) {
      const c = cryoRect(term);
      const definite = sealedTag(G, term.sealed, term.sealedQi, c.x + c.w / 2, c.y - 12);
      if (definite === null) {
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.t * 6);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = C.qubit;
        ctx.lineWidth = 2;
        rr(ctx, c.x - 2, c.y - 2, c.w + 4, c.h + 4, 6);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function canisterAnchor(G) {
    const c = G.canister;
    if (!c) return null;
    if (c.carried) return { x: G.player.x + PLAYER.w / 2 - G.player.facing * 8, y: G.player.y + 17 };
    if (c.roomId !== G.room.id) return null;
    return center(canisterRect({ x: c.x, y: c.y - 4 }));
  }

  function drawPickupGlow(G) {
    const c = G.canister;
    const at = canisterAnchor(G);
    if (c && at) {
      const definite = G.q ? G.q.definite[c.qi] : 0;
      ctx.save();
      ctx.strokeStyle = definite === null ? C.qubit : 'rgba(219,231,245,0.6)';
      ctx.globalAlpha = definite === null ? 0.6 + 0.4 * Math.sin(G.t * 6) : 0.85;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(at.x, at.y, 7, 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (!c.carried) sealedTag(G, c.q, c.qi, at.x, at.y - 24);
    }
    const b = G.room.battery;
    if (b && !b.taken) {
      const bob = Math.sin(G.t * 4) * 1.5;
      tag('BATTERY', b.x, b.y - 68 + bob, C.ok);
      ctx.fillStyle = 'rgba(125,255,168,0.9)';
      ctx.fillRect(b.x - 5, b.y - 46, 10, 20);
      label('+', b.x, b.y - 36, '#06140c', 11);
    }
  }

  function drawExitSign(r, open) {
    const text = open ? 'EXIT' : 'LOCKED!';
    ctx.font = `800 13px ${SIGN_FONT}`;
    const icon = open ? 16 : 0;
    const w = Math.max(r.w + 4, ctx.measureText(text).width + 14 + icon);
    const x = r.x + r.w / 2 - w / 2;
    ctx.fillStyle = open ? C.ok : '#ff9d8f';
    rr(ctx, x, r.y - 26, w, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#06140c';
    if (open) {
      const ix = x + 5;
      const iy = r.y - 23;
      ctx.beginPath();
      ctx.moveTo(ix, iy + 10);
      ctx.lineTo(ix, iy + 7);
      ctx.lineTo(ix + 3.5, iy + 7);
      ctx.lineTo(ix + 3.5, iy + 4);
      ctx.lineTo(ix + 7, iy + 4);
      ctx.lineTo(ix + 7, iy + 1);
      ctx.lineTo(ix + 11, iy + 1);
      ctx.lineTo(ix + 11, iy + 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + icon + (w - icon) / 2, r.y - 17.5);
  }

  function drawDoorGlow(G) {
    for (const p of G.room.portals) {
      const r = doorRect(p);
      ctx.font = `800 12px ${SIGN_FONT}`;
      const w = ctx.measureText(p.label).width + 14;
      ctx.fillStyle = '#dbe7f5';
      rr(ctx, r.x + r.w / 2 - w / 2, r.y - 25, w, 16, 3);
      ctx.fill();
      ctx.fillStyle = '#0b1220';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, r.x + r.w / 2, r.y - 16.5);
      if (p.near && G.mode === 'play') tag('E', r.x + r.w / 2, r.y - 38 + (Math.sin(G.t * 5) * 2), C.torch);
    }
    const door = G.room.door;
    if (!door) return;
    const r = doorRect(door);
    drawExitSign(r, door.open);
    if (!door.key) return;

    const l = lockRect(door);
    label('KEY', l.x + 5, l.y + 16.5, C.torch, 8, 'left');
    label('LOCK', l.x + 5, l.y + 41.5, C.ink, 8, 'left');
    ctx.fillStyle = 'rgba(42,58,88,0.9)';
    ctx.fillRect(l.x + 4, l.y + 28, l.w - 8, 1);
    door.lock.forEach((id, i) => {
      const pos = lampPos(door, i);
      const want = Number(door.key[i]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = C.torch;
      ctx.fillStyle = want ? C.torch : 'rgba(0,0,0,0)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.keyY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      label(String(want), pos.x, pos.keyY + 0.5, want ? '#1c1403' : C.torch, 9);
      const state = G.q ? G.q.definite[door.lockQi[i]] : 0;
      ctx.save();
      if (state === null) {
        ctx.setLineDash([2.5, 2.5]);
        ctx.lineDashOffset = -G.t * 14;
        ctx.strokeStyle = C.qubit;
        ctx.beginPath();
        ctx.arc(pos.x, pos.lockY, 7, 0, Math.PI * 2);
        ctx.stroke();
        label('?', pos.x, pos.lockY + 0.5, C.qubit, 9);
      } else {
        const good = state === want;
        ctx.strokeStyle = door.unlocked ? C.ok : good ? C.ink : C.zero;
        ctx.fillStyle = state ? (door.unlocked ? C.ok : C.ink) : 'rgba(0,0,0,0)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.lockY, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        label(String(state), pos.x, pos.lockY + 0.5, state ? '#0b1220' : C.zero, 9);
      }
      ctx.restore();
      label(id, pos.x, pos.lockY + 15.5, C.torch, 8); // which qubit this lamp reads
    });
    if (door.exposure > 0 && !door.unlocked) {
      const c = center(l);
      ctx.strokeStyle = C.torch;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(c.x, l.y - 13, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, door.exposure / TORCH.dwell));
      ctx.stroke();
    }
    if (door.near && !door.unlocked && G.mode === 'play') tag('E', center(l).x, l.y - 14 + (Math.sin(G.t * 5) * 2), C.torch);
    if (door.deniedT > 0) {
      ctx.strokeStyle = C.bad;
      ctx.lineWidth = 2.5;
      rr(ctx, l.x - 3, l.y - 3, l.w + 6, l.h + 6, 6);
      ctx.stroke();
    }
  }

  function polyPath(c, poly) {
    c.beginPath();
    c.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i += 1) c.lineTo(poly[i].x, poly[i].y);
    c.closePath();
  }

  const LIGHT_TINT = { normal: '255,236,190', weak: '255,226,160', emergency: '255,70,70' };

  // Cavities: a cap at each end of the band, like the mirrors of a microwave cavity, and
  // the waves between them. Blocked, the cavity is empty; cleared, its waves come back one
  // column at a time as it loads (it drives nothing until full).
  function drawCavityCap(c, y, facing) {
    // facing: +1 when the cap's mirror faces down the room, -1 when it faces up.
    ctx.fillStyle = '#2c3a55';
    ctx.fillRect(c.x - 8, facing > 0 ? y - 12 : y, c.w + 16, 12);
    ctx.strokeStyle = '#c39bff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(c.x - 4, y);
    ctx.quadraticCurveTo(c.x + c.w / 2, y - facing * 7, c.x + c.w + 4, y); // a concave mirror
    ctx.stroke();
    ctx.fillStyle = '#43557a';
    ctx.fillRect(c.x - 8, facing > 0 ? y - 16 : y + 12, 6, 4);
    ctx.fillRect(c.x + c.w + 2, facing > 0 ? y - 16 : y + 12, 6, 4);
  }

  // The feed: a waveguide from the edge of the room into the emitting cap, with power
  // flowing along it into the cavity. Always on, even while the cavity is blocked: the
  // cavity only keeps its waves while energy is pumped in.
  function drawCavityFeed(c, sign, drift) {
    const cx = c.x + c.w / 2;
    const from = sign > 0 ? 0 : WORLD.h; // the room's edge behind the emitter
    const to = c.y - sign * 12; // the back of the emitting cap
    const half = 13;
    ctx.save();
    ctx.fillStyle = 'rgba(20,28,46,0.9)';
    ctx.fillRect(cx - half, Math.min(from, to), half * 2, Math.abs(to - from));
    ctx.strokeStyle = '#43557a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - half, from);
    ctx.lineTo(cx - half, to);
    ctx.moveTo(cx + half, from);
    ctx.lineTo(cx + half, to);
    ctx.stroke();
    // The seeding wave, travelling towards the cavity, brighter as it arrives.
    const length = Math.abs(to - from);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let d = 0; d <= length; d += 2) {
      const y = from + sign * d;
      const x = cx + Math.sin((d - drift * 1.6) / 5) * (half - 4);
      if (d === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const g = ctx.createLinearGradient(0, from, 0, to);
    g.addColorStop(0, 'rgba(195,155,255,0.25)');
    g.addColorStop(1, 'rgba(225,200,255,0.95)');
    ctx.strokeStyle = g;
    ctx.shadowColor = 'rgba(195,155,255,0.8)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();
  }

  function drawCavities(G) {
    const room = G.room;
    if (!room.cavities || !room.cavities.length) return;
    const drift = calm.matches ? 0 : G.t * 40; // the waves travel away from the emitter
    for (const c of room.cavities) {
      const sign = c.dir === 'up' ? -1 : 1;
      drawCavityFeed(c, sign, drift);
      const length = Math.abs(c.to - c.y);
      const columns = [];
      for (let x = c.x + 9; x <= c.x + c.w - 9; x += 18) columns.push(x);
      const shown = c.blocked ? 0 : Math.ceil((c.load || 0) * columns.length - 1e-9);
      ctx.save();
      ctx.strokeStyle = 'rgba(195,155,255,0.38)';
      ctx.lineWidth = 1.6;
      columns.slice(0, shown).forEach((x) => {
        ctx.beginPath();
        for (let d = 0; d <= length; d += 4) {
          const wx = x + Math.sin((d - drift) / 9) * 3.5;
          if (d === 0) ctx.moveTo(wx, c.y + sign * d);
          else ctx.lineTo(wx, c.y + sign * d);
        }
        ctx.stroke();
      });
      ctx.restore();
      drawCavityCap(c, c.y, sign);
      drawCavityCap(c, c.to, -sign);
    }
  }

  // During a swap's delay: an arrow in the middle of each platform's state, pointing
  // where it is about to go.
  function drawSwapArrows(G) {
    const sw = G.swap;
    if (!sw) return;
    // The countdown, big, between the two platforms: 3, 2, 1, then SWAP! as they set off.
    if (!sw.travel || sw.go > 0) {
      const a = slotMid(sw.a);
      const b = slotMid(sw.b);
      const text = sw.travel ? 'SWAP!' : String(sw.count);
      const phase = sw.travel ? 1 - sw.go / 0.7 : 1 - (sw.wait - Math.floor(sw.wait - 1e-9)); // 0 to 1 through each second
      const pop = calm.matches ? 1 : 1 + 0.35 * Math.max(0, 1 - phase * 4);
      ctx.save();
      ctx.translate((a.x + b.x) / 2, Math.min(a.y, b.y) - 70);
      ctx.scale(pop, pop);
      ctx.globalAlpha = sw.travel ? Math.min(1, sw.go / 0.3) : 1;
      ctx.font = `800 ${sw.travel ? 46 : 64}px ${SIGN_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(7,11,20,0.85)';
      ctx.strokeText(text, 0, 0);
      ctx.shadowColor = sw.travel ? 'rgba(125,255,168,0.9)' : 'rgba(255,217,138,0.9)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = sw.travel ? '#7dffa8' : '#ffd98a';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    if (sw.travel) return;
    const pulse = calm.matches ? 1 : 0.65 + 0.35 * Math.sin(G.t * 9);
    for (const [p, other] of [[sw.a, sw.b], [sw.b, sw.a]]) {
      const mid = slotMid(p);
      const dir = Math.sign(other.placeX - p.placeX) || 1;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.translate(mid.x, mid.y);
      ctx.scale(dir, 1);
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-22, -4);
      ctx.lineTo(8, -4);
      ctx.lineTo(8, -11);
      ctx.lineTo(24, 0);
      ctx.lineTo(8, 11);
      ctx.lineTo(8, 4);
      ctx.lineTo(-22, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Backup lights: the tint of each cone, then the lamp hanging at its top. A faulty
  // (weak) lamp sparks at its wiring; an emergency lamp glows red.
  function drawLights(G) {
    for (const light of G.room.lights || []) {
      if (!light.poly) continue;
      const tint = LIGHT_TINT[light.kind] || LIGHT_TINT.normal;
      const g = ctx.createRadialGradient(light.x, light.y, 4, light.x, light.y, light.range);
      g.addColorStop(0, `rgba(${tint},${light.kind === 'emergency' ? 0.3 : 0.2})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      polyPath(ctx, light.poly);
      ctx.fill();
      ctx.save();
      ctx.translate(light.x, light.y);
      ctx.rotate(light.angle - Math.PI / 2);
      ctx.fillStyle = '#2c3a55'; // cable and housing
      ctx.fillRect(-1, -60, 2, 52);
      ctx.beginPath();
      ctx.moveTo(-14, -2);
      ctx.lineTo(14, -2);
      ctx.lineTo(8, -12);
      ctx.lineTo(-8, -12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = light.kind === 'emergency' ? '#ff5a5a' : light.kind === 'weak' ? '#e9d79a' : '#fff4d0';
      ctx.fillRect(-11, -3, 22, 3);
      if (light.kind === 'weak') {
        // A faulty circuit: a few short sparks by the housing, changing several times a
        // second. Small and local, so not a flashing hazard (the cone itself is steady).
        const tick = Math.floor(G.t * 8);
        ctx.strokeStyle = '#fff2a8';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let k = 0; k < 3; k += 1) {
          const r = Math.sin((tick + 1) * 12.9898 + k * 78.233) * 43758.5453;
          const u = r - Math.floor(r);
          if (u < 0.35) continue;
          const sx = -10 + u * 20;
          const sy = -8 - u * 6;
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + (u - 0.5) * 8, sy - 3);
          ctx.lineTo(sx + (u - 0.5) * 3, sy - 6);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawDecorGlow(G) {
    for (const d of G.room.decor) {
      if (d.type === 'candle') {
        const flick = Math.sin(G.t * 13) * 0.8;
        ctx.fillStyle = '#ffb347';
        ctx.beginPath();
        ctx.ellipse(d.x + flick * 0.4, d.y - 7, 3, 6 + flick, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        ctx.ellipse(d.x, d.y - 5, 1.4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.type === 'plate') {
        ctx.font = `800 12px ${SIGN_FONT}`;
        const w = ctx.measureText(d.text).width + 14;
        ctx.fillStyle = '#dbe7f5';
        rr(ctx, d.x - w / 2, d.y - 8, w, 16, 3);
        ctx.fill();
        ctx.fillStyle = '#0b1220';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text, d.x, d.y + 0.5);
      } else if (d.type === 'teleporter') {
        ctx.save();
        ctx.strokeStyle = C.qubit;
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(G.t * 3);
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]);
        ctx.lineDashOffset = -G.t * 18;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y - 46, 18, 30, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        tag('TELEPORTER', d.x, d.y - 104, C.qubit);
      }
    }
    for (const n of G.room.npcs) {
      tag(n.name, n.x, n.y - 46, C.ink);
      if (n.near && G.mode === 'play') tag('E', n.x, n.y - 64 + (Math.sin(G.t * 5) * 2), C.torch);
    }
  }

  function anchorOf(G, qi) {
    const room = G.room;
    for (const p of room.platforms) {
      if (p.qi === qi) {
        return p.state === null ? slotMid(p) : { x: p.x + p.w / 2, y: p.y + PLATFORM_H / 2 };
      }
    }
    if (G.canister && G.canister.qi === qi) return canisterAnchor(G);
    for (const term of room.terminals) {
      if (term.sealedQi === qi) return center(cryoRect(term));
      if (term.box && G.level.qubits[qi].role === 'box') return center(boxRect(term));
    }
    if (room.door) {
      const i = room.door.lockQi.indexOf(qi);
      if (i >= 0) {
        const pos = lampPos(room.door, i);
        return { x: pos.x, y: pos.lockY };
      }
    }
    return null;
  }

  function drawLinks(G) {
    if (!G.q) return;
    ctx.save();
    ctx.strokeStyle = C.link;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2, 6]);
    ctx.lineDashOffset = -G.t * 26;
    ctx.globalAlpha = 0.85;
    for (const group of G.q.groups) {
      const pts = group.map((qi) => anchorOf(G, qi)).filter(Boolean).sort((a, b) => a.x - b.x);
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else {
          const prev = pts[i - 1];
          ctx.quadraticCurveTo((prev.x + pt.x) / 2, Math.min(prev.y, pt.y) - 34, pt.x, pt.y);
        }
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  // Where a gate pops up over a qubit: halfway between a platform's two heights (the
  // middle of its state), or over the qubit's machine, lamp or carried canister.
  // A canister held in the canister view shows its part in that tile instead.
  function gateAnchor(G, qi) {
    const p = G.room.platforms.find((pl) => pl.qi === qi);
    if (p) return slotMid(p);
    return anchorOf(G, qi);
  }

  function drawGateFx(G, fx, k) {
    const pop = gatePop(k, calm.matches);
    const at = fx.parts.map((part) => ({ part, pos: gateAnchor(G, part.qi), tile: fx.tileQis.includes(part.qi) }));
    // A gate wholly on qubits in the canister view tile is drawn only there.
    if (at.every((a) => a.tile)) return;
    if (at.length === 2 && at[0].pos && at[1].pos) paintGateLink(ctx, at[0].pos, at[1].pos, pop, 26); // a two-qubit gate's line
    for (const a of at) {
      if (!a.pos) continue;
      // The canister view tile shows a qubit's gate; on the player's back stays only a
      // CNOT's dot, so the line still starts somewhere. Without the tile the canister gets it all, small.
      if (a.tile && a.part.role !== 'ctrl') continue;
      const small = G.canister && a.part.qi === G.canister.qi;
      paintGate(ctx, a.pos.x, a.pos.y, a.part, pop, small ? 16 : 26);
    }
  }

  function drawFx(G) {
    for (const fx of G.fx) {
      const k = Math.min(1, fx.t / fx.dur);
      ctx.save();
      if (fx.type === 'ring') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 8 + k * (fx.size || 46), 0, Math.PI * 2);
        ctx.stroke();
      } else if (fx.type === 'gate') {
        drawGateFx(G, fx, k);
      } else if (fx.type === 'spark') {
        // The ball rides the drawn arc itself: the same quadratic curve, at k along it.
        const cx = (fx.from.x + fx.to.x) / 2;
        const cy = Math.min(fx.from.y, fx.to.y) - 52;
        const u = 1 - k;
        const x = u * u * fx.from.x + 2 * u * k * cx + k * k * fx.to.x;
        const y = u * u * fx.from.y + 2 * u * k * cy + k * k * fx.to.y;
        ctx.globalAlpha = 0.35 * (1 - k);
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx.from.x, fx.from.y);
        ctx.quadraticCurveTo(cx, cy, fx.to.x, fx.to.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = fx.color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const f of G.floaters) {
      const k = Math.min(1, f.t / f.dur);
      ctx.save();
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      tag(f.text, f.x, f.y - (18 + k * 20), f.color);
      ctx.restore();
    }
  }

  // -- speech -----------------------------------------------------------------

  function wrap(text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  function speech(x, y, text, speaker, alpha, more, loud) {
    const font = loud ? `700 18px ${BODY_FONT}` : `400 12px ${BODY_FONT}`;
    const lineH = loud ? 21 : 15;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font;
    const lines = wrap(text, 216);
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), speaker ? 60 : 0);
    const w = textW + 18;
    const h = lines.length * lineH + (speaker ? 15 : 0) + 12;
    const bx = Math.max(8, Math.min(WORLD.w - w - 8, x - w / 2));
    const by = Math.max(8, y - h - 9);
    ctx.fillStyle = 'rgba(243,246,251,0.97)';
    rr(ctx, bx, by, w, h, 8);
    ctx.fill();
    const tx = Math.max(bx + 12, Math.min(bx + w - 12, x));
    ctx.beginPath();
    ctx.moveTo(tx - 6, by + h - 1);
    ctx.lineTo(tx, by + h + 8);
    ctx.lineTo(tx + 6, by + h - 1);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let ty = by + 7;
    if (speaker) {
      ctx.font = `700 10px ${MONO_FONT}`;
      ctx.fillStyle = '#35607a';
      ctx.fillText(speaker.toUpperCase(), bx + 9, ty);
      ty += 15;
    }
    ctx.font = font;
    ctx.fillStyle = '#101826';
    for (const l of lines) {
      ctx.fillText(l, bx + 9, ty);
      ty += lineH;
    }
    if (more !== undefined) {
      ctx.font = `700 9px ${MONO_FONT}`;
      ctx.fillStyle = '#35607a';
      ctx.textAlign = 'right';
      ctx.fillText(more ? 'E ▸' : 'E ✕', bx + w - 7, by + 6);
    }
    ctx.restore();
  }

  function drawSpeech(G) {
    const head = { x: G.player.x + PLAYER.w / 2, y: G.player.y - 4 };
    for (const b of G.bubbles) {
      if (b.wait > 0) continue;
      if (G.dialogue && b.anchor !== 'player') continue;
      const at = b.anchor === 'player' ? head : b.anchor;
      const fade = Math.min(1, b.t / 0.15, (b.dur - b.t) / 0.4);
      speech(at.x, at.y, b.text, null, Math.max(0, fade));
    }
    const d = G.dialogue;
    if (d) {
      const at = d.anchor === 'player' ? head : d.anchor;
      speech(at.x, at.y - 14, d.lines[d.index], d.speaker, 1, d.index < d.lines.length - 1);
    }
  }

  // -- the terrace (epilogue) ---------------------------------------------------

  const SKY_STARS = Array.from({ length: 80 }, (_, i) => {
    const a = Math.abs(Math.sin(i * 127.1) * 43758.5453) % 1;
    const b = Math.abs(Math.sin(i * 311.7 + 2) * 12543.1234) % 1;
    return { x: a * WORLD.w, y: b * 300, r: i % 6 === 0 ? 1.5 : 0.9, phase: i * 1.7 };
  });
  const SKYLINE = [[186, 70, 46], [276, 52, 80], [344, 92, 34], [466, 60, 66], [546, 86, 40], [658, 48, 92], [716, 80, 52], [814, 72, 70], [892, 68, 120]]; // x, width, height
  const FACADE_WINDOWS = [50, 197, 344, 490, 637, 784];
  const WINDOW = { w: 46, h: 84 };

  const litAt = (x, power) => power > 0.1 + 0.72 * (1 - Math.min(1, x / 800));
  const windowLit = (i, row, power) => power > 0.28 + 0.6 * (((i * 5 + row * 3) % 6) / 6);

  function crankGrip(G) {
    const gen = G.level.scene.generator;
    // Bonus level 7: still until it is cranked in the opening, then running through the fight.
    const turn = G.scene ? G.scene.crank : G.beast && G.beast.phase === 'intro' ? G.beast.crank : G.t * 11;
    return { x: gen.x - 36 + Math.cos(turn) * 8, y: gen.y - 22 + Math.sin(turn) * 8 };
  }

  let festoonCache = null;
  function festoon(s) {
    if (festoonCache) return festoonCache;
    const roof = s.door.y;
    const pts = [{ x: 168, y: roof - 90 }, ...s.lamps.map((x) => ({ x, y: roof - 102 })), { x: s.generator.x + 24, y: roof - 90 }];
    const spans = [];
    const bulbs = [];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const mid = { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 26 };
      spans.push([a, mid, b]);
      const n = Math.max(3, Math.round((b.x - a.x) / 26));
      for (let k = 1; k < n; k += 1) {
        const t = k / n;
        const u = 1 - t;
        bulbs.push({ x: u * u * a.x + 2 * u * t * mid.x + t * t * b.x, y: u * u * a.y + 2 * u * t * mid.y + t * t * b.y + 3 });
      }
    }
    festoonCache = { spans, bulbs };
    return festoonCache;
  }

  function glow(x, y, radius, colour) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, colour);
    g.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function drawGenerator(G, gen, running) {
    const y = gen.y;
    const hum = running ? Math.sin(G.t * 46) * 0.5 : 0;
    ctx.save();
    ctx.translate(hum, 0);
    ctx.fillStyle = '#1b2740';
    ctx.fillRect(gen.x - 34, y - 4, 68, 4); // skids
    ctx.fillStyle = '#2f4062';
    ctx.fillRect(gen.x + 22, y - 92, 4, 54); // exhaust mast
    ctx.fillRect(gen.x + 19, y - 94, 10, 3);
    ctx.fillStyle = '#4a5a78';
    rr(ctx, gen.x - 20, y - 50, 30, 12, 4); // fuel tank
    ctx.fill();
    ctx.fillStyle = '#3d4f72';
    rr(ctx, gen.x - 30, y - 40, 60, 36, 4); // housing
    ctx.fill();
    ctx.fillStyle = '#5d7299';
    ctx.fillRect(gen.x - 28, y - 40, 56, 3);
    ctx.fillStyle = '#22314c';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(gen.x - 22 + i * 8, y - 29, 4, 17); // vents
    ctx.fillStyle = '#4a2a30';
    ctx.beginPath();
    ctx.arc(gen.x + 18, y - 22, 3, 0, Math.PI * 2); // status lamp, off
    ctx.fill();
    const hub = { x: gen.x - 36, y: y - 22 };
    const grip = crankGrip(G);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2f4062';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gen.x - 30, hub.y);
    ctx.lineTo(hub.x, hub.y);
    ctx.stroke();
    ctx.strokeStyle = C.steelLight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(hub.x, hub.y);
    ctx.lineTo(grip.x, grip.y);
    ctx.stroke();
    ctx.fillStyle = C.hazard;
    ctx.beginPath();
    ctx.arc(grip.x, grip.y, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPane(x, y, lit) {
    const g = ctx.createLinearGradient(0, y, 0, y + WINDOW.h);
    g.addColorStop(0, lit ? '#ffeab0' : '#25365c');
    g.addColorStop(1, lit ? '#f2b552' : '#16223d');
    ctx.save();
    if (lit) {
      ctx.shadowColor = 'rgba(255,205,120,0.6)';
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, y, WINDOW.w, WINDOW.h);
    ctx.restore();
    ctx.fillStyle = lit ? '#6b4a16' : '#0a1120';
    ctx.fillRect(x + WINDOW.w / 2 - 1.5, y, 3, WINDOW.h);
    ctx.fillRect(x, y + WINDOW.h / 2 - 1.5, WINDOW.w, 3);
  }

  function drawTerrace(G) {
    const sc = G.scene;
    const s = G.level.scene;
    const roof = s.door.y;
    const gen = s.generator;
    const power = sc.power;
    const { spans, bulbs } = festoon(s);
    const rows = [roof + 48, roof + 170];

    ctx.fillStyle = '#1c2742';
    ctx.fillRect(0, roof + 14, s.edge, WORLD.h - roof - 14);
    ctx.fillStyle = 'rgba(120,150,200,0.10)';
    for (let y = roof + 40; y < WORLD.h; y += 30) ctx.fillRect(0, y, s.edge, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(s.edge - 8, roof + 14, 8, WORLD.h); // the corner of the building
    rows.forEach((y) => {
      for (const x of FACADE_WINDOWS) {
        ctx.fillStyle = '#0a1120';
        ctx.fillRect(x - 4, y - 4, WINDOW.w + 8, WINDOW.h + 8);
        drawPane(x, y, false);
      }
    });
    ctx.fillStyle = C.concrete;
    ctx.fillRect(0, roof, s.edge + 6, 14); // roof slab
    ctx.fillRect(s.edge - 10, roof - 12, 12, 12); // kerb at the edge
    ctx.fillStyle = C.concreteEdge;
    ctx.fillRect(0, roof, s.edge - 10, 3);
    ctx.fillRect(s.edge - 10, roof - 12, 12, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, roof + 14, s.edge, 4);

    ctx.fillStyle = '#2b3954';
    ctx.fillRect(56, roof - 94, 112, 94);
    ctx.fillStyle = '#3a4b6c';
    ctx.fillRect(50, roof - 101, 124, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = roof - 70; y < roof; y += 24) ctx.fillRect(56, y, 112, 1);
    drawDoorLeaf(doorRect(s.door), sc.doorOpen, '#44597f');
    ctx.fillStyle = '#16213a';
    rr(ctx, s.door.x - 7, roof - 90, 14, 8, 3); // lamp over the door
    ctx.fill();

    for (const x of s.lamps) {
      ctx.fillStyle = '#2f4062';
      ctx.fillRect(x - 1.5, roof - 102, 3, 102);
      ctx.fillRect(x - 7, roof - 4, 14, 4);
      ctx.fillStyle = '#16213a';
      rr(ctx, x - 6, roof - 116, 12, 14, 3); // lantern
      ctx.fill();
    }
    ctx.strokeStyle = '#0d1424';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [a, mid, b] of spans) {
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
    }
    ctx.stroke();
    ctx.fillStyle = '#56627e';
    for (const b of bulbs) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const a of sc.actors) {
      if (!a.out) continue;
      drawPerson(a.x, roof, PEOPLE[a.kind], { armsUp: sc.alarm, step: a.moving ? Math.sin(a.anim * 12) : 0 });
    }
    const cat = sc.cat;
    if (cat.state === 'sit') drawCat(cat.x, cat.y - 1);
    else if (cat.state === 'trot' || cat.state === 'run') drawCatRun(cat.x, cat.y, Math.sin(cat.anim * (cat.state === 'run' ? 26 : 18)), 0);
    else if (cat.state === 'jump') drawCatRun(cat.x, cat.y, 0.9, Math.atan2(cat.vy, 230) * 0.7);
    drawGenerator(G, gen, power > 0);
    if (G.player.visible) drawPlayer(G);

    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(5,9,24,${0.46 - 0.32 * power})`;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    for (const x of s.lamps) if (litAt(x, power)) glow(x, roof - 100, 170, 'rgba(255,214,140,0.24)');
    if (litAt(s.door.x, power)) glow(s.door.x, roof - 80, 110, 'rgba(255,214,140,0.22)');

    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = 'rgba(255,214,140,0.5)';
    SKYLINE.forEach(([x, w, h], n) => {
      for (let k = 0; k < 4; k += 1) ctx.fillRect(x + 8 + ((n * 17 + k * 23) % Math.max(1, w - 16)), roof - h + 10 + ((n * 29 + k * 31) % Math.max(1, h - 4)), 3, 4);
    });
    ctx.fillStyle = '#0d1530';
    for (const [x, w, h] of SKYLINE) ctx.fillRect(x, roof - h, w, WORLD.h - roof + h);
    const moon = { x: 846, y: 78, r: 30 };
    ctx.fillStyle = '#d8d2b6';
    for (const [dx, dy, r] of [[-9, -6, 6], [8, 5, 4.5], [-3, 12, 3.5], [11, -11, 3]]) {
      ctx.beginPath();
      ctx.arc(moon.x + dx, moon.y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f4efda';
    ctx.beginPath();
    ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
    ctx.fill();
    glow(moon.x, moon.y, 120, 'rgba(210,220,255,0.28)');
    for (const st of SKY_STARS) {
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(G.t * 1.3 + st.phase);
      ctx.fillStyle = '#e8eeff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    sky.addColorStop(0, '#060a1c');
    sky.addColorStop(0.62, '#1a2852');
    sky.addColorStop(1, '#0d1634');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.globalCompositeOperation = 'source-over';
    rows.forEach((y, row) => {
      FACADE_WINDOWS.forEach((x, i) => {
        if (windowLit(i, row, power)) drawPane(x, y, true);
      });
    });
    for (const b of bulbs) {
      if (!litAt(b.x, power)) continue;
      glow(b.x, b.y, 13, 'rgba(255,214,140,0.5)');
      ctx.fillStyle = '#fff1c2';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const x of s.lamps) {
      if (!litAt(x, power)) continue;
      glow(x, roof - 109, 46, 'rgba(255,214,140,0.55)');
      ctx.fillStyle = '#fff1c2';
      rr(ctx, x - 4, roof - 114, 8, 10, 2);
      ctx.fill();
    }
    if (litAt(s.door.x, power)) {
      glow(s.door.x, roof - 86, 30, 'rgba(255,214,140,0.55)');
      ctx.fillStyle = '#fff1c2';
      rr(ctx, s.door.x - 5, roof - 89, 10, 6, 2);
      ctx.fill();
    }
    if (power > 0) {
      ctx.fillStyle = C.ok;
      ctx.beginPath();
      ctx.arc(gen.x + 18, roof - 22, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const bob = Math.sin(G.t * 5) * 2;
    if (sc.phase === 'walk') {
      tag('GENERATOR', gen.x, roof - 108, C.ok);
      if (sc.near) tag('E', gen.x - 36, roof - 46 + bob, C.torch);
    }
    for (const a of sc.actors) {
      if (!a.out) continue;
      tag(a.name, a.x, roof - 46, C.ink);
      if (sc.alarm) {
        const hop = Math.abs(Math.sin(G.t * 9 + a.x)) * 3;
        ctx.fillStyle = 'rgba(7,11,20,0.85)';
        ctx.beginPath();
        ctx.arc(a.x, roof - 70 - hop, 10, 0, Math.PI * 2);
        ctx.fill();
        label('!', a.x, roof - 69 - hop, C.torch, 17, 'center', SIGN_FONT);
      }
    }
    if (sc.line) {
      const who = sc.actors.find((a) => a.id === sc.line.follow);
      const at = who ? { x: who.x, y: roof - 58 } : { x: cat.x + 6, y: cat.y - 26 };
      speech(at.x, at.y, sc.line.text, sc.line.who, 1, undefined, !who);
    }
    drawSpeech(G);
    if (sc.fade > 0) {
      ctx.fillStyle = `rgba(3,6,12,${sc.fade})`;
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    }
  }

  // -- bonus level 7: the beast on the roof ------------------------------------------

  const BEAST_FUR = { monster: '#e8ebef', monsterDark: '#9aa1ad', cute: '#f0a04b', cuteDark: '#b9631c' };

  // The outline of the head and ears, for the shade that hides it in the dark.
  function headPath(c, x, y, s) {
    c.beginPath();
    c.ellipse(x, y, 140 * s, 112 * s, 0, 0, Math.PI * 2);
    for (const side of [-1, 1]) {
      c.moveTo(x + side * 50 * s, y - 92 * s);
      c.lineTo(x + side * 112 * s, y - 165 * s);
      c.lineTo(x + side * 128 * s, y - 52 * s);
      c.closePath();
    }
  }

  // The mutated cat: white, mangy and ragged, with glowing green slit eyes and long fangs.
  // The mouth is shut in a snarl (open 0) until it screeches (open 1). Flat shapes, like the
  // rest of the game.
  const MONSTER = {
    fur: '#e8ebef',
    shade: '#c3c9d2',
    mange: '#aab1bc',
    line: '#59606b',
    ear: '#b8444f',
    mouth: '#3a0a12',
    gum: '#c2566a',
    tongue: '#d8718a',
    fang: '#f1e8d0',
    fangLine: '#a59775',
  };

  function paintMonsterHead(c, x, y, s, t, opened) {
    const M = MONSTER;
    glow(x, y, 235 * s, 'rgba(150,255,170,0.14)');
    // Ears: tall, ragged, raw inside.
    for (const side of [-1, 1]) {
      c.fillStyle = M.fur;
      c.beginPath();
      c.moveTo(x + side * 46 * s, y - 88 * s);
      c.lineTo(x + side * 112 * s, y - 178 * s);
      c.lineTo(x + side * 120 * s, y - 150 * s); // a tear in the edge
      c.lineTo(x + side * 128 * s, y - 140 * s);
      c.lineTo(x + side * 134 * s, y - 44 * s);
      c.closePath();
      c.fill();
      c.fillStyle = M.ear;
      c.beginPath();
      c.moveTo(x + side * 62 * s, y - 90 * s);
      c.lineTo(x + side * 108 * s, y - 158 * s);
      c.lineTo(x + side * 120 * s, y - 64 * s);
      c.closePath();
      c.fill();
    }
    // Mangy tufts along the cheeks, then the head.
    c.fillStyle = M.fur;
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(x + side * 112 * s, y - 50 * s);
      for (let k = 0; k <= 6; k += 1) {
        const ty = y + (-40 + k * 22) * s;
        const tx = x + side * (138 - k * 9) * s;
        c.lineTo(tx + side * 26 * s, ty + 6 * s);
        c.lineTo(tx, ty + 14 * s);
      }
      c.lineTo(x + side * 40 * s, y + 104 * s);
      c.closePath();
      c.fill();
    }
    c.beginPath();
    c.ellipse(x, y, 134 * s, 108 * s, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha *= 0.45;
    c.fillStyle = M.shade; // shadow under the brow and down the jaw
    c.beginPath();
    c.ellipse(x, y + 46 * s, 112 * s, 60 * s, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = M.mange;
    c.beginPath();
    c.ellipse(x + 40 * s, y - 84 * s, 30 * s, 14 * s, 0.3, 0, Math.PI * 2);
    c.ellipse(x - 70 * s, y + 20 * s, 22 * s, 30 * s, -0.4, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha /= 0.45;
    c.strokeStyle = M.shade; // fur strokes
    c.lineWidth = 2 * s;
    c.beginPath();
    for (const [dx, dy] of [[-20, -70], [8, -60], [36, -46], [-60, -54], [-100, -6], [104, -12], [60, 6]]) {
      c.moveTo(x + dx * s, y + dy * s);
      c.lineTo(x + (dx + 6) * s, y + (dy + 12) * s);
    }
    c.stroke();
    // Brows, eyes.
    for (const side of [-1, 1]) {
      const ex = x + side * 52 * s;
      const ey = y - 16 * s;
      c.strokeStyle = M.line;
      c.lineWidth = 7 * s;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(ex - side * 36 * s, ey - 36 * s);
      c.lineTo(ex + side * 22 * s, ey - 14 * s);
      c.stroke();
      glow(ex, ey, 50 * s, 'rgba(120,255,90,0.55)');
      const iris = c.createRadialGradient(ex, ey, 2 * s, ex, ey, 30 * s);
      iris.addColorStop(0, '#f2ffc4');
      iris.addColorStop(0.45, '#8dff52');
      iris.addColorStop(1, '#2fae2a');
      c.fillStyle = iris;
      c.beginPath();
      c.ellipse(ex, ey, 30 * s, 17 * s, side * 0.3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#05080a';
      c.beginPath();
      c.ellipse(ex, ey, 3.5 * s, 15 * s, side * 0.3, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = M.line;
      c.lineWidth = 3 * s;
      c.beginPath();
      c.ellipse(ex, ey, 30 * s, 17 * s, side * 0.3, 0, Math.PI * 2);
      c.stroke();
    }
    // Nose.
    c.fillStyle = '#b65a66';
    c.beginPath();
    c.moveTo(x - 14 * s, y + 14 * s);
    c.lineTo(x + 14 * s, y + 14 * s);
    c.lineTo(x, y + 28 * s);
    c.closePath();
    c.fill();
    // The mouth: a shut snarl, the long upper fangs down over the chin; it gapes as it screeches.
    const open = Math.max(0, Math.min(1, opened || 0));
    const low = y + (58 + 66 * open) * s; // how far down the jaw has dropped
    c.fillStyle = M.mouth;
    c.beginPath();
    c.moveTo(x - 74 * s, y + 34 * s);
    c.quadraticCurveTo(x, y + 52 * s, x + 74 * s, y + 34 * s);
    c.quadraticCurveTo(x + 40 * s, low, x, low + 2 * s);
    c.quadraticCurveTo(x - 40 * s, low, x - 74 * s, y + 34 * s);
    c.fill();
    if (open > 0.2) {
      c.globalAlpha *= Math.min(1, (open - 0.2) * 3);
      c.strokeStyle = M.gum;
      c.lineWidth = 6 * s;
      c.beginPath();
      c.moveTo(x - 70 * s, y + 38 * s);
      c.quadraticCurveTo(x, y + 56 * s, x + 70 * s, y + 38 * s);
      c.stroke();
      c.fillStyle = M.tongue;
      c.beginPath();
      c.ellipse(x, low - 18 * s, 30 * open * s, 13 * open * s, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha /= Math.min(1, (open - 0.2) * 3);
    }
    c.strokeStyle = M.line; // the lips
    c.lineWidth = 3 * s;
    c.beginPath();
    c.moveTo(x - 74 * s, y + 34 * s);
    c.quadraticCurveTo(x, y + 52 * s, x + 74 * s, y + 34 * s);
    c.stroke();
    const fang = (fx, fy, len, dir) => {
      c.beginPath();
      c.moveTo(fx - 7 * s, fy);
      c.quadraticCurveTo(fx - 2 * s, fy + dir * len * 0.7 * s, fx + 1 * s, fy + dir * len * s);
      c.lineTo(fx + 7 * s, fy);
      c.closePath();
      c.fillStyle = M.fang;
      c.fill();
      c.strokeStyle = M.fangLine;
      c.lineWidth = 1.2 * s;
      c.stroke();
    };
    for (const side of [-1, 1]) {
      fang(x + side * 44 * s, y + 44 * s, 36 + 8 * open, 1); // the long upper canines, always out
      if (open > 0.2) {
        fang(x + side * 22 * s, y + 50 * s, 14 * open, 1);
        fang(x + side * 36 * s, low - 6 * s, 26 * open, -1); // lower canines
      }
    }
    // Whiskers, some snapped.
    c.strokeStyle = '#f6f8fa';
    c.lineWidth = 1.8 * s;
    c.beginPath();
    for (const side of [-1, 1]) {
      for (const [dy, len] of [[-4, 150], [8, 120], [20, 165]]) {
        c.moveTo(x + side * 76 * s, y + (24 + dy) * s);
        c.lineTo(x + side * (76 + len) * s, y + (16 + dy * 2.2) * s);
      }
    }
    c.stroke();
  }

  function paintCuteHead(c, x, y, s) {
    glow(x, y, 210 * s, 'rgba(255,200,120,0.16)');
    c.fillStyle = BEAST_FUR.cute;
    headPath(c, x, y, s);
    c.fill();
    c.fillStyle = '#f7b6c2';
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(x + side * 64 * s, y - 92 * s);
      c.lineTo(x + side * 106 * s, y - 142 * s);
      c.lineTo(x + side * 114 * s, y - 70 * s);
      c.closePath();
      c.fill();
    }
    c.fillStyle = BEAST_FUR.cuteDark; // forehead stripes
    for (const dx of [-26, 0, 26]) {
      c.beginPath();
      c.moveTo(x + (dx - 9) * s, y - 110 * s);
      c.lineTo(x + (dx + 9) * s, y - 110 * s);
      c.lineTo(x + dx * s, y - 70 * s);
      c.closePath();
      c.fill();
    }
    c.fillStyle = '#fbe3c0'; // muzzle
    c.beginPath();
    c.ellipse(x - 24 * s, y + 42 * s, 34 * s, 26 * s, 0, 0, Math.PI * 2);
    c.ellipse(x + 24 * s, y + 42 * s, 34 * s, 26 * s, 0, 0, Math.PI * 2);
    c.fill();
    for (const side of [-1, 1]) {
      const ex = x + side * 54 * s;
      const ey = y - 6 * s;
      c.fillStyle = '#2b2233'; // big round eyes
      c.beginPath();
      c.ellipse(ex, ey, 24 * s, 28 * s, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(ex - 8 * s, ey - 10 * s, 8 * s, 0, Math.PI * 2);
      c.arc(ex + 8 * s, ey + 8 * s, 4 * s, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,120,150,0.45)'; // blush
      c.beginPath();
      c.ellipse(x + side * 92 * s, y + 34 * s, 18 * s, 10 * s, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#e8728a'; // nose
    c.beginPath();
    c.moveTo(x - 10 * s, y + 22 * s);
    c.lineTo(x + 10 * s, y + 22 * s);
    c.lineTo(x, y + 32 * s);
    c.closePath();
    c.fill();
    c.strokeStyle = '#5a3a2a'; // a w for a mouth, and whiskers
    c.lineWidth = 3 * s;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y + 32 * s);
    c.quadraticCurveTo(x - 6 * s, y + 46 * s, x - 18 * s, y + 40 * s);
    c.moveTo(x, y + 32 * s);
    c.quadraticCurveTo(x + 6 * s, y + 46 * s, x + 18 * s, y + 40 * s);
    c.stroke();
    c.strokeStyle = '#fff6e6';
    c.lineWidth = 2 * s;
    c.beginPath();
    for (const side of [-1, 1]) {
      for (const dy of [-6, 6]) {
        c.moveTo(x + side * 60 * s, y + (36 + dy) * s);
        c.lineTo(x + side * 150 * s, y + (28 + dy * 2.4) * s);
      }
    }
    c.stroke();
  }

  // The head, as both pictures at once while the cat is superposed: each as solid as its odds.
  // `shade` (0 to 1) hides it in the dark when the flashlight is not on it.
  function paintBeastHead(c, x, y, s, p0, t, shade, open) {
    c.save();
    const jitter = p0 > 0.001 && p0 < 0.999 ? Math.sin(t * 9) * 1.5 : 0;
    if (p0 < 0.999) {
      c.globalAlpha = 1 - p0;
      paintMonsterHead(c, x + jitter, y, s, t, open);
    }
    if (p0 > 0.001) {
      c.globalAlpha = p0;
      paintCuteHead(c, x - jitter, y, s);
    }
    c.globalAlpha = shade;
    c.fillStyle = '#060a1a';
    headPath(c, x, y, s * 1.02);
    c.fill();
    c.restore();
  }

  // A paw, floating free: `bottom` is its underside. Claws out while it is a monster.
  function paintPaw(c, x, bottom, w, p0) {
    const h = 46;
    c.save();
    c.lineCap = 'round';
    const base = c.globalAlpha; // fading out as the cat is tamed
    for (const [look, alpha] of [['monster', 1 - p0], ['cute', p0]]) {
      if (alpha < 0.01) continue;
      c.globalAlpha = base * alpha;
      c.fillStyle = BEAST_FUR[look];
      rr(c, x - w / 2, bottom - h, w, h, 16);
      c.fill();
      c.fillStyle = look === 'monster' ? BEAST_FUR.monsterDark : BEAST_FUR.cuteDark;
      for (const dx of [-w / 4, 0, w / 4]) c.fillRect(x + dx - 1, bottom - 16, 2, 14); // toes
      if (look === 'monster') {
        c.fillStyle = MONSTER.fang; // claws: plain triangles, outlined to show against the white
        c.strokeStyle = MONSTER.line;
        c.lineWidth = 1.2;
        for (const dx of [-w / 3, -w / 9, w / 9, w / 3]) {
          c.beginPath();
          c.moveTo(x + dx - 4, bottom - 4);
          c.lineTo(x + dx + 4, bottom - 4);
          c.lineTo(x + dx + 1, bottom + 9);
          c.closePath();
          c.fill();
          c.stroke();
        }
      } else {
        c.fillStyle = '#f7b6c2';
        for (const dx of [-w / 3.2, 0, w / 3.2]) {
          c.beginPath();
          c.ellipse(x + dx, bottom - 6, 5, 4, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    c.restore();
  }

  // The mist the cat floats in: soft puffs drifting over the head. `amount` 0 to 1.
  const MIST = Array.from({ length: 14 }, (_, i) => ({
    dx: Math.sin(i * 2.4) * 150,
    dy: Math.cos(i * 1.7) * 95 - 20,
    r: 80 + (i % 4) * 22,
    speed: 0.25 + (i % 5) * 0.07,
    phase: i * 1.3,
  }));
  function drawMist(G, x, y, amount) {
    if (amount <= 0.01) return;
    for (const m of MIST) {
      const px = x + m.dx + Math.sin(G.t * m.speed + m.phase) * 30;
      const py = y + m.dy + Math.cos(G.t * m.speed * 0.8 + m.phase) * 14;
      const g = ctx.createRadialGradient(px, py, 0, px, py, m.r);
      g.addColorStop(0, `rgba(150,146,190,${0.62 * amount})`);
      g.addColorStop(0.55, `rgba(110,108,150,${0.42 * amount})`);
      g.addColorStop(1, 'rgba(90,90,130,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - m.r, py - m.r, m.r * 2, m.r * 2);
    }
  }

  function drawBeast(G) {
    const b = G.beast;
    const s = G.level.scene;
    const cfg = G.level.beast;
    const roof = b.roof;
    const qi = G.qIndex.CAT;
    const p0 = G.q ? 1 - G.q.p1[qi] : 0;
    const shake = calm.matches ? 0 : G.shake;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 10, (Math.random() - 0.5) * shake * 10);

    // The sky, then the head rising behind the city, then the city.
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    sky.addColorStop(0, '#05081a');
    sky.addColorStop(0.62, '#1c1a46');
    sky.addColorStop(1, '#0d1634');
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, WORLD.w + 40, WORLD.h + 40);
    for (const st of SKY_STARS) {
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(G.t * 1.3 + st.phase);
      ctx.fillStyle = '#e8eeff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    const moon = { x: 846, y: 78, r: 30 };
    glow(moon.x, moon.y, 120, 'rgba(210,220,255,0.28)');
    ctx.fillStyle = '#f4efda';
    ctx.beginPath();
    ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
    ctx.fill();

    const tame = b.tame;
    const headY = cfg.head.y + (1 - b.rise) * 340 + tame * 120;
    const headS = 1 - 0.85 * tame;
    // The head shows only where the mist is parted: at the very start, or in the
    // flashlight, as whichever cat the light found. Otherwise, at most, two eyes in the mist.
    const hidden = b.mist * (1 - b.reveal);
    if (b.rise > 0 && tame < 1) {
      ctx.save();
      ctx.globalAlpha = (1 - tame) * (1 - hidden);
      if (ctx.globalAlpha > 0.01) paintBeastHead(ctx, cfg.head.x, headY, headS, b.seen === 'cute' ? 1 : 0, G.t, b.lit || !b.attacked || b.t < b.showUntil ? 0.04 : 0.3, b.mouth);
      ctx.restore();
    }
    drawMist(G, cfg.head.x, headY, b.mist * (1 - 0.75 * b.reveal) * (1 - tame));
    if (hidden > 0.5 && b.seen === 'monster' && b.phase === 'fight') {
      const flicker = 0.18 + 0.12 * Math.sin(G.t * 2.3);
      for (const side of [-1, 1]) glow(cfg.head.x + side * 52, headY - 14, 22, `rgba(190,255,90,${flicker * hidden})`);
    }
    if (b.exposure > 0) exposureRing(cfg.face.x + cfg.face.w / 2, cfg.face.y + cfg.face.h / 2, b.exposure / TORCH.dwell, C.torch);

    ctx.fillStyle = '#0d1530';
    for (const [x, w, h] of SKYLINE) ctx.fillRect(x, roof - h, w, WORLD.h - roof + h);
    ctx.fillStyle = 'rgba(255,214,140,0.5)';
    SKYLINE.forEach(([x, w, h], n) => {
      for (let k = 0; k < 4; k += 1) ctx.fillRect(x + 8 + ((n * 17 + k * 23) % Math.max(1, w - 16)), roof - h + 10 + ((n * 29 + k * 31) % Math.max(1, h - 4)), 3, 4);
    });

    // The building and the roof; the lights come on with the generator.
    const power = b.power;
    const rows = [roof + 48, roof + 170];
    ctx.fillStyle = '#1c2742';
    ctx.fillRect(0, roof + 14, s.edge, WORLD.h - roof - 14);
    rows.forEach((y, row) => {
      FACADE_WINDOWS.forEach((x, i) => {
        ctx.fillStyle = '#0a1120';
        ctx.fillRect(x - 4, y - 4, WINDOW.w + 8, WINDOW.h + 8);
        drawPane(x, y, windowLit(i, row, power));
      });
    });
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(s.edge - 8, roof + 14, 8, WORLD.h);
    ctx.fillStyle = C.concrete;
    ctx.fillRect(0, roof, s.edge + 6, 14);
    ctx.fillRect(s.edge - 10, roof - 12, 12, 12);
    ctx.fillStyle = C.concreteEdge;
    ctx.fillRect(0, roof, s.edge - 10, 3);
    ctx.fillStyle = '#2b3954';
    ctx.fillRect(56, roof - 94, 112, 94);
    ctx.fillStyle = '#3a4b6c';
    ctx.fillRect(50, roof - 101, 124, 8);
    drawDoorLeaf(doorRect(s.door), b.doorOpen, '#44597f');
    const { spans, bulbs } = festoon(s);
    for (const x of s.lamps) {
      ctx.fillStyle = '#2f4062';
      ctx.fillRect(x - 1.5, roof - 102, 3, 102);
      ctx.fillRect(x - 7, roof - 4, 14, 4);
    }
    ctx.strokeStyle = '#0d1424';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (!b.lightsBroken) {
      for (const [a, mid, z] of spans) {
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mid.x, mid.y, z.x, z.y);
      }
    } else {
      // Torn down by the swipe: snapped wires dangling from the lamp posts.
      for (const [a, , z] of spans) {
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(a.x + 6, a.y + 30, a.x + 2 + Math.sin(G.t * 2 + a.x) * 2, a.y + 52);
        ctx.moveTo(z.x, z.y);
        ctx.quadraticCurveTo(z.x - 6, z.y + 24, z.x - 3 + Math.sin(G.t * 2.3 + z.x) * 2, z.y + 40);
      }
    }
    ctx.stroke();
    drawGenerator(G, s.generator, power > 0);
    for (const x of s.lamps) {
      ctx.fillStyle = '#16213a';
      rr(ctx, x - 6, roof - 116, 12, 14, 3);
      ctx.fill();
      if (b.lightsBroken) {
        ctx.strokeStyle = '#3d4a63'; // burst: a cracked, empty lantern
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 4, roof - 114);
        ctx.lineTo(x + 1, roof - 108);
        ctx.lineTo(x - 2, roof - 104);
        ctx.moveTo(x + 4, roof - 113);
        ctx.lineTo(x + 1, roof - 108);
        ctx.stroke();
        continue;
      }
      if (!litAt(x, power)) continue;
      glow(x, roof - 109, 46, 'rgba(255,214,140,0.5)');
      ctx.fillStyle = '#fff1c2';
      rr(ctx, x - 4, roof - 114, 8, 10, 2);
      ctx.fill();
    }
    if (!b.lightsBroken) {
      for (const bulb of bulbs) {
        const on = litAt(bulb.x, power);
        if (on) glow(bulb.x, bulb.y, 13, 'rgba(255,214,140,0.45)');
        ctx.fillStyle = on ? '#fff1c2' : '#56627e';
        ctx.beginPath();
        ctx.arc(bulb.x, bulb.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#56627e'; // a few dead bulbs on the roof
      for (const bx of [214, 318, 472, 566, 690]) ctx.fillRect(bx, roof - 3, 4, 3);
    }
    if (b.phase === 'intro' && b.step === 'walk') {
      const bob = Math.sin(G.t * 5) * 2;
      tag('GENERATOR', s.generator.x, roof - 108, C.ok);
      if (b.near) tag('E', s.generator.x - 36, roof - 46 + bob, C.torch);
    }

    // Terminals: working, waiting to be smashed, or smashed and rebuilding.
    for (const term of G.room.terminals) {
      if (term.wreck > 0) drawWreck(G, term, cfg.wreck);
      else if (!b.termsOn) {
        drawTerminal(G, term); // switched off: a dark screen
        const r = screenRect(term);
        ctx.fillStyle = '#0b1220';
        rr(ctx, r.x, r.y, r.w, r.h, 2);
        ctx.fill();
        label('OFF', r.x + r.w / 2, r.y + r.h / 2 + 0.5, '#3d4a63', 8);
      } else {
        drawTerminal(G, term);
        drawTerminalGlow(G, term);
        if (term.used && Math.sin(G.t * 12) > 0) {
          const r = screenRect(term);
          ctx.fillStyle = 'rgba(255,90,90,0.75)';
          rr(ctx, r.x, r.y, r.w, r.h, 2);
          ctx.fill();
          label('!', r.x + r.w / 2, r.y + r.h / 2 + 1, '#fff', 14, 'center', SIGN_FONT);
        }
      }
    }

    // The intro: the cat, the box and its radiation.
    const box = b.box;
    if (box.state === 'shut' || box.state === 'open' || box.state === 'burst') {
      ctx.save();
      const jig = box.state !== 'burst' ? Math.sin(G.t * 40) * 3 * box.shake : 0;
      ctx.translate(box.x + jig, roof);
      if (box.glow > 0) glow(0, -20, 40 + 70 * box.glow, `rgba(125,255,106,${0.25 + 0.4 * box.glow})`);
      if (box.state !== 'burst') {
        ctx.fillStyle = '#7a5a3a';
        ctx.fillRect(-24, -34, 48, 34);
        ctx.fillStyle = '#8d6a45';
        ctx.save(); // the lid, hinged at the back right
        ctx.translate(26, -39);
        ctx.rotate(-1.9 * (box.lid || 0));
        ctx.fillRect(-52, 0, 52, 6);
        ctx.restore();
        ctx.fillStyle = '#5d4329';
        ctx.fillRect(-24, -26, 48, 2);
        ctx.fillStyle = '#f2d14a'; // the radiation sign
        ctx.beginPath();
        ctx.arc(0, -15, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#16213a';
        for (let k = 0; k < 3; k += 1) {
          ctx.beginPath();
          ctx.moveTo(0, -15);
          ctx.arc(0, -15, 8, -Math.PI / 2 + (k * 2 * Math.PI) / 3 - 0.5, -Math.PI / 2 + (k * 2 * Math.PI) / 3 + 0.5);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = '#f2d14a';
        ctx.beginPath();
        ctx.arc(0, -15, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#7a5a3a'; // splinters
        const k = b.step === 'open' ? Math.max(0, Math.min(1, b.st - 0.6)) : 1;
        for (let i = 0; i < 8; i += 1) {
          const a = -Math.PI * (0.1 + 0.8 * (i / 7));
          ctx.save();
          ctx.translate(Math.cos(a) * 90 * k, -10 + Math.sin(a) * 120 * k + 160 * k * k);
          ctx.rotate(i + k * 8);
          ctx.fillRect(-8, -2, 16, 4);
          ctx.restore();
        }
      }
      ctx.restore();
    }
    const cat = b.cat;
    if (cat.state === 'sit') {
      const alpha = b.phase === 'tamed' ? Math.min(1, (b.t - 2.2) / 0.4) : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      drawCat(cat.x, roof - 1);
      ctx.restore();
    } else if (cat.state === 'trot') {
      drawCatRun(cat.x, roof, Math.sin(cat.k * 18), 0);
    } else if (cat.state === 'jump') {
      const k = Math.min(1, cat.k); // a hop from where it sat into the box
      drawCatRun(cat.from + (box.x - cat.from) * k, roof - Math.sin(k * Math.PI) * 60 - 14 * k, 0.9, (k - 0.5) * 1.6);
    }
    // The Professor, Bob and Alice, until the swipe sends them off the roof.
    for (const a of b.actors) {
      if (!a.out) continue;
      const fy = a.flung ? a.flung.y : 0;
      if (roof + fy < -80) continue;
      ctx.save();
      if (a.flung) {
        ctx.translate(a.x, roof + fy - 17);
        ctx.rotate(a.flung.spin);
        ctx.translate(-a.x, -(roof + fy - 17));
      }
      drawPerson(a.x, roof + fy, PEOPLE[a.kind], { armsUp: a.alarm, step: a.moving ? Math.sin(a.anim * 12) : 0 });
      ctx.restore();
      if (a.flung) continue;
      tag(a.name, a.x, roof - 46, C.ink);
      if (a.alarm) {
        const hop = Math.abs(Math.sin(G.t * 9 + a.x)) * 3;
        ctx.fillStyle = 'rgba(7,11,20,0.85)';
        ctx.beginPath();
        ctx.arc(a.x, roof - 70 - hop, 10, 0, Math.PI * 2);
        ctx.fill();
        label('!', a.x, roof - 69 - hop, C.torch, 17, 'center', SIGN_FONT);
      }
    }

    // Shadows of the raised paws: they turn red as a paw winds up to drop.
    for (const paw of b.paws) {
      if (!['rise', 'track', 'windup', 'slam'].includes(paw.state) || b.phase !== 'fight') continue;
      const near = 1 - Math.min(1, (roof - paw.y) / (roof - cfg.top + 20));
      const warn = paw.state === 'windup' || paw.state === 'slam';
      ctx.fillStyle = warn ? 'rgba(255,70,70,0.55)' : 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.ellipse(paw.x, roof + 1, (cfg.pawW / 2) * (0.6 + 0.4 * near), 5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (paw.state === 'windup') label('!', paw.x, roof - 12, '#ff6b6b', 16, 'center', SIGN_FONT);
    }
    // A swipe about to sweep along the roof: a red streak along its path, chevrons pointing the way.
    for (const paw of b.paws) {
      if (b.phase !== 'fight' || (paw.state !== 'swipeWind' && paw.state !== 'swipe')) continue;
      const end = paw.dir > 0 ? s.edge - 30 : 30;
      const from = paw.x + paw.dir * (cfg.pawW / 2);
      if ((end - from) * paw.dir <= 0) continue;
      const pulse = paw.state === 'swipeWind' ? 0.35 + 0.25 * Math.sin(G.t * 18) : 0.18;
      ctx.fillStyle = `rgba(255,70,70,${pulse})`;
      ctx.fillRect(Math.min(from, end), roof - 6, Math.abs(end - from), 6);
      if (paw.state === 'swipeWind') {
        ctx.strokeStyle = 'rgba(255,120,120,0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let x = from + paw.dir * 30; (end - x) * paw.dir > 0; x += paw.dir * 60) {
          const shift = ((G.t * 120) % 60) * paw.dir;
          ctx.moveTo(x + shift - paw.dir * 7, roof - 22);
          ctx.lineTo(x + shift, roof - 15);
          ctx.lineTo(x + shift - paw.dir * 7, roof - 8);
        }
        ctx.stroke();
        label('!', paw.x, roof - 64, '#ff6b6b', 16, 'center', SIGN_FONT);
      }
    }

    // The player, flattened and flung if a paw caught them.
    if (G.player.visible) {
      const f = G.flung;
      if (f) {
        const pl = G.player;
        ctx.save();
        if (f.t < 0.22) {
          ctx.translate(pl.x + PLAYER.w / 2, pl.y + PLAYER.h);
          ctx.scale(1.5, 0.22);
          ctx.translate(-(pl.x + PLAYER.w / 2), -(pl.y + PLAYER.h));
        } else {
          ctx.translate(pl.x + PLAYER.w / 2, pl.y + PLAYER.h / 2);
          ctx.rotate(f.spin);
          ctx.translate(-(pl.x + PLAYER.w / 2), -(pl.y + PLAYER.h / 2));
        }
        drawPlayer(G);
        ctx.restore();
      } else drawPlayer(G);
    }

    // The paws, floating free of the mist. Always a monster's while it fights.
    if (b.rise > 0.3) {
      ctx.save();
      ctx.globalAlpha = (1 - tame) * Math.min(1, (b.rise - 0.3) / 0.4);
      for (const paw of b.paws) {
        const jig = paw.state === 'windup' ? Math.sin(G.t * 60) * 2 : 0;
        const bob = paw.state === 'rest' ? Math.sin(G.t * 1.6 + paw.side) * 4 : 0;
        paintPaw(ctx, paw.x + jig, paw.y + bob, cfg.pawW, b.phase === 'tamed' ? 1 : 0);
      }
      ctx.restore();
    }

    if (G.torch.active) {
      const hand = handOf(G.player);
      const g = ctx.createRadialGradient(hand.x, hand.y, 4, hand.x, hand.y, G.torch.range);
      g.addColorStop(0, 'rgba(255,217,138,0.28)');
      g.addColorStop(1, 'rgba(255,217,138,0)');
      ctx.fillStyle = g;
      beamPath(ctx, hand, G.torch.angle, G.torch.range);
      ctx.fill();
    }
    if (b.phase !== 'intro' && b.phase !== 'tamed' && G.q) {
      const pct = Math.round(p0 * 100);
      tag(G.q.definite[qi] === 1 ? 'CAT = 1 (monster)' : G.q.definite[qi] === 0 ? 'CAT = 0 (cute)' : `CAT: ${pct}% cute`, 92, 22, G.q.definite[qi] === null ? C.qubit || '#ffd36b' : C.ink);
    }
    drawFx(G);
    if (b.line) {
      const who = b.actors.find((a) => a.id === b.line.follow);
      const at = who ? { x: who.x, y: roof - 58 } : { x: b.cat.x + 6, y: roof - 30 };
      speech(at.x, at.y, b.line.text, b.line.who, 1, undefined, b.line.text === 'MEOW');
    }
    drawSpeech(G);
    if (b.flash > 0) {
      // A single flash; softer with reduced motion, like the screen shake.
      ctx.fillStyle = `rgba(200,255,190,${Math.min(calm.matches ? 0.25 : 0.85, b.flash)})`;
      ctx.fillRect(-20, -20, WORLD.w + 40, WORLD.h + 40);
    }
    ctx.restore();
  }

  // A smashed terminal: a heap of panels and wires, and how long until it is back.
  function drawWreck(G, term, total) {
    const y = term.y;
    ctx.fillStyle = '#1b2740';
    ctx.save();
    ctx.translate(term.x, y);
    ctx.rotate(-0.25);
    ctx.fillRect(-18, -8, 22, 6);
    ctx.restore();
    ctx.fillStyle = '#2f4062';
    ctx.fillRect(term.x - 4, y - 14, 18, 10);
    ctx.fillStyle = '#0c1422';
    ctx.fillRect(term.x - 12, y - 6, 26, 6);
    if (Math.sin(G.t * 17 + term.x) > 0.6) {
      ctx.fillStyle = '#ffd36b'; // a spark
      ctx.fillRect(term.x + 6 + Math.random() * 4, y - 18 - Math.random() * 6, 2, 2);
    }
    const left = Math.max(0, term.wreck);
    const cx = term.x;
    const cy = y - 40;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#7dffa8';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - left / total));
    ctx.stroke();
    label(String(Math.ceil(left)), cx, cy + 0.5, C.ink, 10);
    label(term.id, cx, cy - 22, '#ff9a7a', 9);
  }

  // -- frame ----------------------------------------------------------------

  function draw(G) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, WORLD.w, WORLD.h);
    if (!G.level || !G.room) {
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
      return;
    }
    if (G.level.outdoor) {
      drawTerrace(G);
      return;
    }
    if (G.level.beast && G.beast) {
      drawBeast(G);
      return;
    }
    const room = G.room;
    const shake = calm.matches ? 0 : G.shake;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 8, (Math.random() - 0.5) * shake * 8);

    drawWall(G);
    drawWindows(G, false);
    drawDecor(G);
    for (const p of room.platforms) drawRails(p);
    drawSolids(G);
    for (const p of room.platforms) if (p.state !== null) drawPlatformBody(p);
    drawDoors(G);
    for (const term of room.terminals) drawTerminal(G, term);
    drawIntercoms(G);
    drawPickups(G);
    drawNpcs(G);
    if (G.player.visible) drawPlayer(G);

    // A lit room (story mode) has no darkness, until its blackout (which flickers first).
    const b = G.blackout;
    drawLamps(G, !(b && (b.dark || b.flickerOff)));
    if (!G.level.lit || (b && (b.dark || b.flickerOff))) drawDarkness(G);

    drawWindows(G, true);
    for (const s of room.solids) drawStandGlow(s);
    drawLinks(G);
    for (const p of room.platforms) drawPlatformGlow(G, p);
    for (const term of room.terminals) drawTerminalGlow(G, term);
    drawPickupGlow(G);
    drawDoorGlow(G);
    drawDecorGlow(G);
    drawCavities(G);
    drawLights(G);
    drawSwapArrows(G);
    drawIntercomGlow(G);
    const fl = G.room.flashlight;
    if (fl && !fl.taken) glow(fl.x + 11, fl.y - 6, 22 + Math.sin(G.t * 4) * 4, 'rgba(255,217,138,0.45)');
    drawBlackoutFx(G);
    drawFx(G);
    drawSpeech(G);
    drawRadio(G);
    ctx.restore();
    drawTitleCard(G);
    drawBanner(G);
  }

  // A short announcement in block letters across the middle (FLASHLIGHT ACQUIRED!).
  function drawBanner(G) {
    const b = G.banner;
    if (!b) return;
    const k = b.t / b.dur;
    const alpha = Math.min(1, b.t / 0.15, (1 - k) / 0.2);
    const pop = 1 + 0.25 * Math.max(0, 1 - b.t / 0.2);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(WORLD.w / 2, WORLD.h / 2 - 40);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 56px ${SIGN_FONT}`;
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(7,11,20,0.9)';
    ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = C.torch;
    ctx.fillText(b.text, 0, 0);
    ctx.restore();
  }

  // -- story mode -----------------------------------------------------------------

  // A lit room's ceiling lamps, and the light they throw while they are on.
  function drawLamps(G, on) {
    const xs = G.level.lamps;
    if (!xs) return;
    ctx.save();
    if (on) {
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = 'rgba(70,82,104,0.35)';
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
      for (const x of G.blackout ? [] : xs) {
        const g = ctx.createLinearGradient(0, 34, 0, WORLD.h);
        g.addColorStop(0, 'rgba(255,236,190,0.22)');
        g.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - 14, 40);
        ctx.lineTo(x + 14, 40);
        ctx.lineTo(x + 120, WORLD.h);
        ctx.lineTo(x - 120, WORLD.h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const x of xs) {
      if (G.blackout && G.blackout.t > 0.1) continue; // torn down
      ctx.fillStyle = '#3a4a66';
      ctx.fillRect(x - 1, 31, 2, 5);
      ctx.fillStyle = on ? '#fff1c8' : '#3d4659';
      ctx.beginPath();
      ctx.ellipse(x, 38, 16, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // An intercom: a small speaker box on the wall, at head height over its surface.
  function drawIntercoms(G) {
    for (const i of G.room.intercoms || []) {
      const x = i.x;
      const y = i.y - 50;
      ctx.fillStyle = '#1b2740';
      rr(ctx, x - 11, y - 14, 22, 28, 3);
      ctx.fill();
      ctx.fillStyle = '#3a4d72';
      rr(ctx, x - 9, y - 12, 18, 24, 2);
      ctx.fill();
      ctx.fillStyle = '#16213a'; // the grille
      for (let r = 0; r < 4; r += 1) for (let c = 0; c < 3; c += 1) ctx.fillRect(x - 6 + c * 5, y - 7 + r * 5, 2, 2);
      ctx.fillStyle = '#2f4062';
      ctx.fillRect(x - 1, y - 20, 2, 6); // the wire up to the ceiling run
    }
  }

  function drawIntercomGlow(G) {
    const speaking = G.intercom && G.intercom.box;
    for (const i of G.room.intercoms || []) {
      const x = i.x;
      const y = i.y - 50;
      const on = speaking === i;
      const blink = on ? 0.6 + 0.4 * Math.sin(G.t * 14) : 1;
      ctx.globalAlpha = blink;
      ctx.fillStyle = on ? '#7dffa8' : i.heard ? '#3f6b52' : '#ffd98a';
      ctx.beginPath();
      ctx.arc(x + 6, y + 9, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (i.near && !G.intercom && G.mode === 'play') tag('H', x, y - 30 + Math.sin(G.t * 5) * 2, C.torch);
    }
  }

  // The Professor on the radio: a bubble at the top of the screen with jagged edges, and a
  // lightning-bolt tail down to the intercom he is speaking through.
  const TERMINAL_BLUE = '#3fb6cf'; // the terminals' screens
  function drawRadio(G) {
    const ic = G.intercom;
    if (!ic) return;
    const text = ic.lines[ic.index];
    const box = ic.box;
    ctx.save();
    ctx.font = `600 14px ${BODY_FONT}`;
    const lines = wrap(text, 400);
    const lineH = 18;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 170) + 34;
    const h = lines.length * lineH + 40;
    const bx = Math.max(10, Math.min(WORLD.w - w - 10, box.x - w / 2));
    const high = box.y < WORLD.h / 2; // a speaker high up: the bubble goes low, clear of the player
    const by = high ? WORLD.h - h - 16 : 12;
    const pop = Math.min(1, ic.t / 0.15);
    ctx.globalAlpha = pop;
    // The tail: a zigzag from the bubble down to the speaker.
    const sx = box.x;
    const sy = box.y - 66;
    const tx = Math.max(bx + 20, Math.min(bx + w - 20, sx));
    ctx.strokeStyle = TERMINAL_BLUE;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    const y0 = high ? by : by + h;
    const y1 = high ? box.y - 34 : sy;
    ctx.moveTo(tx, y0);
    const steps = 5;
    for (let k = 1; k <= steps; k += 1) {
      const f = k / steps;
      const zx = tx + (sx - tx) * f + (k < steps ? (k % 2 ? 9 : -9) : 0);
      ctx.lineTo(zx, y0 + (y1 - y0) * f);
    }
    ctx.stroke();
    // The bubble, its edge jagged like a radio signal.
    ctx.fillStyle = 'rgba(243,246,251,0.97)';
    ctx.beginPath();
    const teeth = (x0, y0, x1, y1, n, out) => {
      for (let k = 0; k <= n; k += 1) {
        const f = k / n;
        const px = x0 + (x1 - x0) * f;
        const py = y0 + (y1 - y0) * f;
        const d = k % 2 ? out : 0;
        const nx = (y1 - y0) === 0 ? 0 : Math.sign(y1 - y0) * d;
        const ny = (x1 - x0) === 0 ? 0 : -Math.sign(x1 - x0) * d;
        if (k === 0 && x0 === bx && y0 === by) ctx.moveTo(px, py);
        else ctx.lineTo(px + nx, py + ny);
      }
    };
    teeth(bx, by, bx + w, by, Math.round(w / 14) * 2, 4);
    teeth(bx + w, by, bx + w, by + h, Math.round(h / 14) * 2, 4);
    teeth(bx + w, by + h, bx, by + h, Math.round(w / 14) * 2, 4);
    teeth(bx, by + h, bx, by, Math.round(h / 14) * 2, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = TERMINAL_BLUE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 10px ${MONO_FONT}`;
    ctx.fillStyle = '#35607a';
    ctx.fillText('PROFESSOR', bx + 16, by + 9);
    ctx.font = `600 14px ${BODY_FONT}`;
    ctx.fillStyle = '#101826';
    lines.forEach((l, k) => ctx.fillText(l, bx + 16, by + 26 + k * lineH));
    ctx.font = `700 10px ${MONO_FONT}`;
    ctx.fillStyle = '#35607a';
    // The close box, top right (a click on it clears the bubble); H moves on to a next line.
    const close = { x: bx + w - 26, y: by + 7, w: 17, h: 17 };
    ctx.fillStyle = TERMINAL_BLUE;
    rr(ctx, close.x, close.y, close.w, close.h, 3);
    ctx.fill();
    ctx.strokeStyle = '#06202a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(close.x + 5, close.y + 5);
    ctx.lineTo(close.x + close.w - 5, close.y + close.h - 5);
    ctx.moveTo(close.x + close.w - 5, close.y + 5);
    ctx.lineTo(close.x + 5, close.y + close.h - 5);
    ctx.stroke();
    if (ic.index < ic.lines.length - 1) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#35607a';
      ctx.fillText('H ▸', close.x - 8, by + 11);
    }
    ic.rect = { x: bx, y: by, w, h };
    ic.closeRect = { x: close.x - 4, y: close.y - 4, w: close.w + 8, h: close.h + 8 }; // a little extra to hit
    ctx.restore();
  }

  // The blackout: cables torn from the ceiling, swinging and sparking.
  function drawBlackoutFx(G) {
    const b = G.blackout;
    if (!b) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const c of b.cables) {
      const k = Math.max(0, Math.min(1, (b.t - c.delay) / 0.35));
      if (k <= 0) continue;
      const len = c.len * k;
      const swing = Math.sin(b.t * c.sway + c.x) * 10 * Math.min(1, b.t);
      const end = { x: c.x + swing, y: len };
      ctx.strokeStyle = '#151c2c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(c.x, 0);
      ctx.quadraticCurveTo(c.x + swing * 0.3, len * 0.6, end.x, end.y);
      ctx.stroke();
      // Sparks at the torn end: often at first, now and then afterwards.
      const often = b.t < 2.5 ? 0.7 : 0.15;
      if (Math.sin(G.t * 23 + c.x) > 1 - often) {
        glow(end.x, end.y, 16, 'rgba(255,214,140,0.7)');
        ctx.fillStyle = '#fff1c2';
        for (let n = 0; n < 4; n += 1) ctx.fillRect(end.x + Math.sin(G.t * 40 + n * 2) * 6, end.y + Math.abs(Math.cos(G.t * 33 + n)) * 8, 2, 2);
      }
    }
    ctx.restore();
  }

  // A story level's name in block letters over the screen, until the player first moves.
  function drawTitleCard(G) {
    const lines = G.titleCard;
    if (!lines) return;
    ctx.save();
    ctx.fillStyle = 'rgba(7,11,20,0.45)';
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, k) => {
      const size = k === 0 ? 40 : 76;
      const y = WORLD.h / 2 - 50 + k * 78;
      ctx.font = `800 ${size}px ${SIGN_FONT}`;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(7,11,20,0.9)';
      ctx.strokeText(line, WORLD.w / 2, y);
      ctx.fillStyle = k === 0 ? C.qubit : C.torch;
      ctx.fillText(line, WORLD.w / 2, y);
    });
    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = C.ink;
    ctx.fillText('Move to begin', WORLD.w / 2, WORLD.h / 2 + 96);
    ctx.restore();
  }

  // The exit's lock panel, its sign and the door, in this canvas's pixels (the lock view
  // developer option magnifies this part of the picture). Null if this room has no lock.
  function lockCrop(G) {
    const d = G.room && G.room.door;
    if (!d || !d.lock || !d.lock.length) return null;
    const l = lockRect(d);
    const x0 = l.x - 10;
    const y0 = d.y - 104;
    return { x: x0 * scale, y: y0 * scale, w: (d.x + 32 - x0) * scale, h: (d.y + 8 - y0) * scale };
  }

  return { draw, resize, anchorOf, gateAnchor, lockCrop };
}
