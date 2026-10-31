// Backup light geometry: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightPolygon, rectInLight, slotRect, slotMid } from '../game/geometry.js';

const lamp = { x: 100, y: 0, angle: Math.PI / 2, spread: 0.3, range: 300 };
const target = { x: 80, y: 200, w: 40, h: 14 };

test('a light reaches what is in its cone, and not what is outside it', () => {
  const poly = lightPolygon(lamp, []);
  assert.ok(rectInLight(target, poly));
  assert.ok(!rectInLight({ x: 300, y: 200, w: 40, h: 14 }, poly));
  assert.ok(!rectInLight({ x: 80, y: 340, w: 40, h: 14 }, poly), 'beyond its range');
});

test('a shield between the lamp and the target casts a shadow over it', () => {
  const shield = { x: 60, y: 100, w: 80, h: 14 };
  assert.ok(!rectInLight(target, lightPolygon(lamp, [shield])));
  const aside = { x: 160, y: 100, w: 80, h: 14 };
  assert.ok(rectInLight(target, lightPolygon(lamp, [aside])), 'a shield out of the cone shades nothing');
});

test('sideways platforms park at x0 and x1 on one height', () => {
  const p = { axis: 'x', x0: 10, x1: 200, y: 50, w: 60 };
  assert.deepEqual([slotRect(p, 0).x, slotRect(p, 1).x, slotRect(p, 1).y], [10, 200, 50]);
  assert.deepEqual(slotMid(p), { x: 135, y: 57 });
  const lift = { x: 10, y0: 300, y1: 200, w: 60 };
  assert.deepEqual(slotMid(lift), { x: 40, y: 257 });
});
