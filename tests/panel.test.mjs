// Circuit layout checks: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutColumns } from '../game/panel.js';

const op = (gate, qubits) => ({ kind: 'gate', gate, qubits });
// H on A, H on A, X on B (A = 0, B = 1).
const ops = [op('h', [0]), op('h', [0]), op('x', [1])];

test('gates pack into the leftmost free column', () => {
  assert.deepEqual(layoutColumns(ops, 2), { cols: [0, 1, 0], count: 2 });
  // A CNOT blocks every wire it spans, including the ones in between.
  assert.deepEqual(layoutColumns([op('cx', [0, 2]), op('x', [1])], 3), { cols: [0, 1], count: 2 });
});

test('"circuit always adds to the right" gives every step its own column', () => {
  assert.deepEqual(layoutColumns(ops, 2, true), { cols: [0, 1, 2], count: 3 });
  assert.deepEqual(layoutColumns([], 2, true), { cols: [], count: 0 });
});
