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

test('a cavity drives what is in its band, unless something blocks the way', async () => {
  const { cavityReaches } = await import('../game/geometry.js');
  const down = { x: 100, w: 100, y: 20, dir: 'down' };
  const target = { x: 120, y: 300, w: 60, h: 14 };
  assert.ok(cavityReaches(down, target, []));
  assert.ok(!cavityReaches(down, { x: 300, y: 300, w: 60, h: 14 }, []), 'outside the band');
  assert.ok(!cavityReaches(down, target, [{ x: 90, y: 150, w: 130, h: 14 }]), 'a shield above it');
  assert.ok(cavityReaches(down, target, [{ x: 90, y: 400, w: 130, h: 14 }]), 'a block below it does not matter');
  const up = { x: 100, w: 100, y: 530, dir: 'up' };
  assert.ok(cavityReaches(up, target, []));
  assert.ok(!cavityReaches(up, target, [{ x: 90, y: 450, w: 130, h: 14 }]), 'a block between the pit and it');
});
