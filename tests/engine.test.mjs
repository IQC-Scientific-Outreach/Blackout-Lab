// Engine tests: node --test tests/
//
// The quantum engine (game/quantum.js) must follow ideal quantum mechanics
// exactly: H gives exactly 50/50, H twice cancels, H Z H is an X, entangled
// qubits collapse together, and teleportation works for every message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lab, createQuantum } from '../game/quantum.js';

// A small seeded random source, so every run of the tests is the same.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = 'ABCDEFGH';
const lab = (inits, seed = 1, prep = []) => new Lab(inits.map((init, i) => ({ id: NAMES[i], init })), { prep, random: seeded(seed) });
const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what || 'value'}: ${a} is not ${b}`);
const closeAll = (as, bs, what) => {
  assert.equal(as.length, bs.length, what);
  as.forEach((a, i) => close(a, bs[i], `${what || 'list'}[${i}]`));
};

test('starting states', () => {
  const snap = lab(['0', '1', '+', '-']).snapshot();
  assert.deepEqual(snap.definite, [0, 1, null, null]);
  closeAll(snap.p1, [0, 1, 0.5, 0.5], 'p1');
  close(snap.bloch[2][0], 1);
  close(snap.bloch[3][0], -1);
  assert.deepEqual(snap.ops, []);
  assert.deepEqual(snap.groups, []);
});

test('H gives exactly 50/50, and a flashlight on it is a fair coin', () => {
  let ones = 0;
  for (let seed = 0; seed < 400; seed += 1) {
    const q = lab(['0'], seed);
    q.apply('h', [0]);
    assert.equal(q.snapshot().definite[0], null);
    close(q.pOne(0), 0.5, 'chance of 1 after H');
    const event = q.measure(0);
    assert.ok(event.random);
    close(event.p1, 0.5);
    assert.deepEqual(q.snapshot().definite, [event.result]);
    ones += event.result;
  }
  assert.ok(ones > 160 && ones < 240, `${ones} ones in 400`);
});

test('measuring a definite qubit adds nothing unless forced', () => {
  const q = lab(['1']);
  assert.equal(q.measure(0), null);
  assert.deepEqual(q.snapshot().ops, []);
  assert.equal(q.measure(0, true).result, 1);
  assert.deepEqual(q.snapshot().ops.map((op) => op.gate), ['measure']);
});

test('interference: H H is nothing, H Z H is an X', () => {
  const q = lab(['0', '0', '-']);
  q.apply('h', [0]);
  q.apply('h', [0]);
  q.apply('h', [1]);
  q.apply('z', [1]);
  close(q.snapshot().p1[1], 0.5, 'Z leaves the odds untouched');
  q.apply('h', [1]);
  q.apply('h', [2]);
  assert.deepEqual(q.snapshot().definite, [0, 1, 1]);
});

test('a Bell pair collapses together', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const q = lab(['0', '0', '0'], seed);
    q.apply('h', [0]);
    q.apply('cx', [0, 1]);
    let snap = q.snapshot();
    assert.deepEqual(snap.groups, [[0, 1]]);
    assert.deepEqual(snap.definite, [null, null, 0]);
    assert.deepEqual(snap.joint[0].dist.map((r) => r.bits), ['00', '11']);
    closeAll(snap.joint[0].dist.map((r) => r.p), [0.5, 0.5], 'joint');
    const result = q.measure(1).result;
    snap = q.snapshot();
    assert.deepEqual(snap.definite, [result, result, 0]);
    assert.deepEqual(snap.groups, []);
  }
});

test('an anticorrelated GHZ state', () => {
  const q = lab(['0', '0', '1', '0'], 5);
  q.apply('h', [0]);
  for (const target of [1, 2, 3]) q.apply('cx', [0, target]);
  const snap = q.snapshot();
  assert.deepEqual(snap.groups, [[0, 1, 2, 3]]);
  assert.deepEqual(snap.joint[0].dist.map((r) => r.bits).sort(), ['0010', '1101']);
  const result = q.measure(3).result;
  assert.deepEqual(q.snapshot().definite, [result, result, 1 - result, result]);
});

test('two separate entangled groups', () => {
  const q = lab(['0', '0', '0', '0']);
  q.apply('h', [0]);
  q.apply('cx', [0, 2]);
  q.apply('h', [1]);
  q.apply('cx', [1, 3]);
  assert.deepEqual(q.snapshot().groups, [[0, 2], [1, 3]]);
});

test('groups survive a change of basis', () => {
  // GHZ with an extra H on every qubit: every pair looks uncorrelated, yet all three are entangled.
  let q = lab(['0', '0', '0', '0']);
  q.apply('h', [0]);
  q.apply('cx', [0, 1]);
  q.apply('cx', [0, 2]);
  for (let k = 0; k < 3; k += 1) q.apply('h', [k]);
  const snap = q.snapshot();
  assert.deepEqual(snap.groups, [[0, 1, 2]]);
  assert.deepEqual(snap.definite, [null, null, null, 0]);
  // A Bell pair whose sealed half got a second H is still entangled.
  q = lab(['0', '0']);
  q.apply('h', [0]);
  q.apply('cx', [0, 1]);
  q.apply('h', [0]);
  assert.deepEqual(q.snapshot().groups, [[0, 1]]);
});

test('reset clears a lock lamp', () => {
  const q = lab(['0', '0'], 3);
  q.apply('x', [0]);
  q.apply('cx', [0, 1]);
  q.reset(1);
  const snap = q.snapshot();
  assert.deepEqual(snap.definite, [1, 0]);
  assert.equal(snap.ops[snap.ops.length - 1].gate, 'reset');
});

test('bad requests are rejected', () => {
  const q = lab(['0', '0']);
  assert.throws(() => q.apply('cx', [0, 0]), /bad qubits/);
  assert.throws(() => q.apply('t', [0]), /unknown gate/);
  assert.throws(() => q.apply('h', [5]), /bad qubits/);
  assert.throws(() => q.apply('cx', [0]), /acts on 2/);
  assert.throws(() => lab(['2']), /unknown starting state/);
});

test('the Qiskit code listing records every step', () => {
  const q = lab(['+', '1', '0']);
  q.apply('z', [0]);
  q.apply('cx', [0, 2]);
  q.measure(2, false, 'torch');
  q.measure(1, true, 'machine');
  const lines = q.code().split('\n');
  assert.deepEqual(lines.slice(0, 4), ['from qiskit import QuantumCircuit', '', '# qubits: 0=A, 1=B, 2=C', 'qc = QuantumCircuit(3, 3)']);
  assert.equal(lines[4], 'qc.h(0)  # A starts in |+>');
  assert.equal(lines[5], 'qc.x(1)  # B starts in |1>');
  assert.equal(lines[6], 'qc.z(0)');
  assert.equal(lines[7], 'qc.cx(0, 2)');
  assert.match(lines[8], /^qc\.measure\(2, 2\) {2}# flashlight on C: read [01]$/);
  assert.equal(lines[9], 'qc.measure(1, 1)  # the machine measured B: read 1');
  assert.deepEqual(q.snapshot().stats, { gates: 2, measurements: 2, depth: 4 });
});

test('a floor can start entangled, and the floor\'s own gates are not the player\'s', () => {
  const q = new Lab([{ id: 'Q' }, { id: 'CAT' }], { prep: [{ gate: 'h', qubits: [0] }, { gate: 'cx', qubits: [0, 1] }] });
  let snap = q.snapshot();
  assert.deepEqual(snap.groups, [[0, 1]]);
  assert.equal(snap.stats.gates, 0);
  assert.deepEqual(snap.ops.map((op) => op.kind), ['auto', 'auto']);
  // Schrödinger's lab: bringing the partner back and applying CNOT undoes the entanglement.
  q.apply('cx', [0, 1]);
  snap = q.snapshot();
  assert.deepEqual(snap.definite, [null, 0]);
  assert.deepEqual(snap.groups, []);
  assert.equal(snap.stats.gates, 1);
  assert.match(q.code(), /done by the floor itself/);
});

test('the wrong CNOT direction leaves the cat uncertain', () => {
  const q = new Lab([{ id: 'Q' }, { id: 'CAT' }], { prep: [{ gate: 'h', qubits: [0] }, { gate: 'cx', qubits: [0, 1] }] });
  q.apply('cx', [1, 0]);
  const snap = q.snapshot();
  assert.deepEqual(snap.definite, [0, null]);
  close(snap.p1[1], 0.5);
});

// Floor 6 end to end. Qubits: 0=Q (canister), 1=B (Bob), 2=M (Alice's key), 3=L (lock).
function teleport(seed, fixX = true, fixZ = true) {
  const q = new Lab([...'QBML'].map((id) => ({ id })), {
    prep: [{ gate: 'h', qubits: [2] }, { gate: 'cx', qubits: [2, 3] }], // the key starts entangled with the lock
    random: seeded(seed),
  });
  q.apply('h', [0]);
  q.apply('cx', [0, 1]); // Bob shares a pair with the canister
  q.apply('cx', [2, 0]);
  q.apply('h', [2]); // Alice's two gates
  const m = q.measure(2, true, 'machine').result;
  const c = q.measure(0, true, 'machine').result;
  if (c && fixX) q.apply('x', [1]);
  if (m && fixZ) q.apply('z', [1]);
  q.auto([{ gate: 'cx', qubits: [1, 3] }, { gate: 'h', qubits: [1] }]); // the lock's own check
  const read = [q.measure(1, true, 'lock').result, q.measure(3, true, 'lock').result];
  return { message: [m, c], read };
}

test('teleportation opens the lock for every message', () => {
  const seen = new Set();
  for (let seed = 0; seed < 60; seed += 1) {
    const { message, read } = teleport(seed);
    seen.add(message.join(''));
    assert.deepEqual(read, [0, 0], `seed ${seed}, message ${message}`);
  }
  assert.deepEqual([...seen].sort(), ['00', '01', '10', '11']);
});

test('skipping a correction is caught by the lock', () => {
  for (let seed = 0; seed < 60; seed += 1) {
    let t = teleport(seed, false, true);
    assert.equal(t.read.join('') === '00', t.message[1] === 0);
    t = teleport(seed, true, false);
    assert.equal(t.read.join('') === '00', t.message[0] === 0);
  }
});

test('teleportation carries an arbitrary state, phase included', () => {
  const rand = seeded(2026);
  for (let trial = 0; trial < 20; trial += 1) {
    for (const [m, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      // Qubits: 0=M (Alice's state), 1=Q, 2=B. Write a random state into M by hand.
      const q = new Lab([{ id: 'M' }, { id: 'Q' }, { id: 'B' }], { random: () => 0.5 });
      const [ar, ai, br, bi] = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const norm = Math.hypot(ar, ai, br, bi);
      q.re.fill(0);
      q.im.fill(0);
      [q.re[0], q.im[0], q.re[1], q.im[1]] = [ar / norm, ai / norm, br / norm, bi / norm];
      const want = q.snapshot().bloch[0];
      q.apply('h', [1]);
      q.apply('cx', [1, 2]);
      q.apply('cx', [0, 1]);
      q.apply('h', [0]);
      // Each outcome of Alice's two measurements has chance 1/4; take the branch for this note.
      close(q.pOne(0), 0.5, 'M is a fair coin');
      q._collapse(0, m);
      close(q.pOne(1), 0.5, 'Q is a fair coin');
      q._collapse(1, c);
      if (c) q.apply('x', [2]);
      if (m) q.apply('z', [2]);
      closeAll(q.snapshot().bloch[2], want, `Bob's state for note M=${m} Q=${c}`);
    }
  }
});

test('createQuantum answers every call and never throws', () => {
  const Q = createQuantum({ random: seeded(4) });
  assert.match(Q.apply('h', [0]).error, /no floor loaded/);
  const loaded = Q.loadLevel({ qubits: [{ id: 'Q', init: '0' }, { id: 'A', init: '0' }] });
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.state.labels, ['Q', 'A']);
  Q.apply('h', [0]);
  const out = Q.apply('cx', [0, 1]);
  assert.deepEqual(out.state.groups, [[0, 1]]);
  const seen = Q.measure([1, 0]);
  assert.equal(seen.measured.length, 1, 'the partner is already definite by the time it is asked');
  const bad = Q.apply('nope', [0]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown gate/);
});

test('auto gates re-prepare a key after a refused one', () => {
  const Q = createQuantum({ random: seeded(9) });
  const prep = [{ gate: 'h', qubits: [0] }, { gate: 'cx', qubits: [0, 1] }];
  assert.deepEqual(Q.loadLevel({ qubits: [{ id: 'M' }, { id: 'L' }], prep }).state.groups, [[0, 1]]);
  Q.measure([0, 1], true, 'lock');
  const out = Q.auto(prep, [0, 1]);
  assert.ok(out.ok);
  assert.deepEqual(out.state.groups, [[0, 1]]);
  assert.equal(out.state.stats.gates, 0);
});

test('identity does nothing, and is listed as qc.id', () => {
  const q = lab(['+']);
  q.apply('i', [0]);
  close(q.snapshot().p1[0], 0.5);
  assert.equal(q.snapshot().bloch[0][0], 1);
  assert.match(q.code(), /qc\.id\(0\)/);
});

test('an emergency light damps a qubit to 0, even a certain 1, and says so', () => {
  const q = lab(['1', '+'], 3);
  q.reset(0, 'emergency');
  q.reset(1, 'emergency');
  assert.deepEqual(q.snapshot().definite, [0, 0]);
  assert.equal(q.snapshot().ops[0].by, 'emergency');
  assert.match(q.code(), /emergency light: A damped to 0/);
});

test('CZ flips the phase of |11> only, either way round', () => {
  // On |+>|1>, CZ turns the + into a -: H then shows it as a certain 1.
  const q = lab(['+', '1']);
  q.apply('cz', [0, 1]);
  q.apply('h', [0]);
  assert.deepEqual(q.snapshot().definite, [1, 1]);
  const r = lab(['1', '+']);
  r.apply('cz', [1, 0]);
  r.apply('h', [1]);
  assert.deepEqual(r.snapshot().definite, [1, 1]);
  // With the other qubit at 0, nothing happens.
  const s = lab(['+', '0']);
  s.apply('cz', [0, 1]);
  s.apply('h', [0]);
  assert.deepEqual(s.snapshot().definite, [0, 0]);
  assert.match(q.code(), /qc\.cz\(0, 1\)/);
});

test('bonus level 3, stage 2: A ends 0 and B ends 1 with H, Z on A, H on B and CZ', () => {
  const q = lab(['0', '0']);
  for (const [g, w] of [['h', 0], ['z', 0], ['h', 0], ['h', 1], ['cz', 0], ['h', 1], ['h', 0], ['z', 0], ['h', 0]]) q.apply(g, g === 'cz' ? [0, 1] : [w]);
  assert.deepEqual(q.snapshot().definite, [0, 1]);
});

test('Ry turns 0 into +, then 1, then -, then back', () => {
  const q = lab(['0']);
  q.apply('ry', [0], Math.PI / 2);
  close(q.snapshot().p1[0], 0.5);
  close(q.snapshot().bloch[0][0], 1, 'the + side of the Bloch sphere');
  q.apply('ry', [0], Math.PI / 2);
  assert.deepEqual(q.snapshot().definite, [1]);
  q.apply('ry', [0], Math.PI / 2);
  close(q.snapshot().bloch[0][0], -1, 'the - side');
  q.apply('ry', [0], Math.PI / 2);
  assert.deepEqual(q.snapshot().definite, [0]);
  assert.throws(() => q.apply('ry', [0]), /needs an angle/);
  assert.match(q.code(), /qc\.ry\(1\.570796, 0\)/);
});

test('a cavity drive is one growing circuit entry per stretch, cut by anything else on that qubit', () => {
  const q = lab(['0', '0'], 2);
  for (let k = 0; k < 30; k += 1) q.drive(0, Math.PI / 30);
  q.apply('h', [1]); // other qubits do not cut the stretch
  for (let k = 0; k < 30; k += 1) q.drive(0, Math.PI / 30);
  let ops = q.snapshot().ops;
  assert.equal(ops.filter((op) => op.kind === 'drive').length, 1);
  close(ops[0].angle, 2 * Math.PI);
  assert.deepEqual([q.snapshot().definite[0]], [0], 'a full Rabi cycle returns to 0');
  q.measure(0, true, 'torch');
  q.drive(0, 0.1);
  ops = q.snapshot().ops;
  assert.equal(ops.filter((op) => op.kind === 'drive').length, 2, 'a measurement starts a new stretch');
  assert.match(q.code(), /qc\.ry\(6\.283185, 0\) {2}# cavity drive on A/);
});
