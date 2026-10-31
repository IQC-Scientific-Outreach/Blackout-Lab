// Shapes shared by the game logic and the renderer, so that what the flashlight
// "sees" is exactly what is drawn.

import { PLATFORM_H } from './levels.js';

export const TORCH = { range: 330, half: 0.33, dwell: 0.45 };
export const PLAYER = { w: 18, h: 32 };

// Rectangle of a platform parked in state 0 or 1: lowered or raised, or for a
// sideways platform (axis 'x'), at x0 or x1 on one height.
export function slotRect(p, state) {
  if (p.axis === 'x') return { x: state ? p.x1 : p.x0, y: p.y, w: p.w, h: PLATFORM_H };
  return { x: p.x, y: state ? p.y1 : p.y0, w: p.w, h: PLATFORM_H };
}

// The middle of a platform's state: halfway between its two slots.
export function slotMid(p) {
  const a = slotRect(p, 0);
  const b = slotRect(p, 1);
  return { x: (a.x + b.x + p.w) / 2, y: (a.y + b.y + PLATFORM_H) / 2 };
}

// -- backup lights ----------------------------------------------------------------
//
// A backup light is a lamp that shines a cone: { x, y, angle, spread, range, kind }
// (angle points the cone, spread is its half-width, both in radians). Solid things
// cast shadows, so its lit area is traced ray by ray, each ray stopping at the first
// rectangle it meets. The result is a polygon: the lamp, then the ends of the rays.
// The same polygon is drawn and used to decide what the light sees.

// How long a light must rest on a superposed platform to measure it, in seconds.
// 'weak' (faulty) lights take five times as long as the flashlight; 'emergency'
// lights damp the qubit to 0 in the flashlight's time.
export const LIGHT_KINDS = {
  normal: { dwell: TORCH.dwell },
  weak: { dwell: TORCH.dwell * 5 },
  emergency: { dwell: TORCH.dwell },
};

const RAYS = 72;

// Where a ray from (ox, oy) heading (dx, dy) first meets rectangle r, as a distance, or Infinity.
function rayHit(ox, oy, dx, dy, r) {
  let near = -Infinity;
  let far = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, r.x, r.x + r.w],
    [oy, dy, r.y, r.y + r.h],
  ]) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      near = Math.max(near, t1);
      far = Math.min(far, t2);
    }
  }
  return near <= far && far > 0 ? Math.max(near, 0) : Infinity;
}

export function lightPolygon(light, blockers) {
  const pts = [{ x: light.x, y: light.y }];
  for (let i = 0; i <= RAYS; i += 1) {
    const a = light.angle - light.spread + (2 * light.spread * i) / RAYS;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let reach = light.range;
    for (const r of blockers) reach = Math.min(reach, rayHit(light.x, light.y, dx, dy, r));
    pts.push({ x: light.x + dx * reach, y: light.y + dy * reach });
  }
  return pts;
}

export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Whether a light polygon reaches any part of a rectangle (its corners, edge middles and centre).
export function rectInLight(r, poly) {
  const xs = [r.x + 1, r.x + r.w / 2, r.x + r.w - 1];
  const ys = [r.y + 1, r.y + r.h / 2, r.y + r.h - 1];
  for (const x of xs) for (const y of ys) if (pointInPolygon({ x, y }, poly)) return true;
  return false;
}

export function doorRect(door) {
  return { x: door.x - 22, y: door.y - 70, w: 44, h: 70 };
}

// The lock panel beside the door: this is what the flashlight has to light.
// Three rows: the key, the lamps, and the name of the qubit behind each lamp.
export function lockRect(door) {
  const n = Math.max(1, door.lock.length);
  const w = 30 + n * 20;
  return { x: door.x - 32 - w, y: door.y - 84, w, h: 66 };
}

export function lampPos(door, i) {
  const r = lockRect(door);
  return { x: r.x + 36 + i * 20, keyY: r.y + 16, lockY: r.y + 41 };
}

// A terminal is a screen on the wall at head height with a keyboard shelf
// under it. `term.y` is the floor the player stands on to use it.
export function screenRect(term) {
  if (term.box) return boxRect(term);
  return { x: term.x - 15, y: term.y - 66, w: 30, h: 21 };
}

// The Professor's box sits on the floor; its canister port is on the front.
export function boxRect(term) {
  return { x: term.x - 16, y: term.y - 26, w: 32, h: 26 };
}

// A sealed qubit's housing stands on the floor beside its terminal.
export function cryoRect(term) {
  const side = term.cryoSide || 1;
  return { x: term.x + side * 30 - 7, y: term.y - 32, w: 14, h: 32 };
}

export function canisterRect(c) {
  return { x: c.x - 5, y: c.y - 20, w: 10, h: 20 };
}

export function center(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function handOf(player) {
  return { x: player.x + PLAYER.w / 2 + player.facing * 5, y: player.y + 14 };
}

function angleGap(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export function pointLit(hand, angle, x, y) {
  const dx = x - hand.x;
  const dy = y - hand.y;
  const dist = Math.hypot(dx, dy);
  if (dist > TORCH.range) return false;
  if (dist < 14) return true;
  return angleGap(Math.atan2(dy, dx), angle) <= TORCH.half;
}

// A rectangle counts as lit when its centre, or any two of its corners, are in the beam.
export function rectLit(hand, angle, r) {
  if (pointLit(hand, angle, r.x + r.w / 2, r.y + r.h / 2)) return true;
  const inset = 3;
  let hits = 0;
  for (const [x, y] of [
    [r.x + inset, r.y + inset],
    [r.x + r.w - inset, r.y + inset],
    [r.x + inset, r.y + r.h - inset],
    [r.x + r.w - inset, r.y + r.h - inset],
  ]) {
    if (pointLit(hand, angle, x, y)) hits += 1;
  }
  return hits >= 2;
}
