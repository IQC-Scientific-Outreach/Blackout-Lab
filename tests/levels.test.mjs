// Level data checks: node --test tests/
//
// Catches the usual slips when adding or editing a floor in game/levels.js: a
// qubit id that does not exist, a gate the engine does not know, a key that does
// not match its lock, a floor the engine cannot start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, GATE_INFO, roomsOf } from '../game/levels.js';
import { Lab } from '../game/quantum.js';

const ROLES = ['platform', 'canister', 'sealed', 'box', 'door'];

for (const [index, level] of LEVELS.entries()) {
  test(`floor ${index + 1}: ${level.name}`, () => {
    const ids = level.qubits.map((q) => q.id);
    const known = (id, where) => assert.ok(ids.includes(id), `${where} uses qubit ${id}, which is not in this floor's qubits`);
    const gateOps = (ops, where) => {
      for (const op of ops || []) {
        assert.ok(op.gate in GATE_INFO, `${where}: unknown gate ${op.gate}`);
        if (op.gate === 'cx') assert.equal(op.q.length, 2, `${where}: cx needs [control, target]`);
        else if (op.gate !== 'measure') assert.equal(op.q.length, 1, `${where}: ${op.gate} acts on one qubit`);
        op.q.forEach((id) => known(id, where));
      }
    };

    assert.ok(level.id && level.name && level.goal && Array.isArray(level.hints), 'id, name, goal and hints are required');
    assert.equal(new Set(ids).size, ids.length, 'qubit ids must be unique');
    for (const q of level.qubits) assert.ok(ROLES.includes(q.role), `qubit ${q.id}: unknown role ${q.role}`);
    gateOps(level.prep, 'prep');

    for (const room of roomsOf(level)) {
      const where = (thing) => `room ${room.id}, ${thing}`;
      for (const p of room.platforms || []) {
        known(p.q, where('platform'));
        assert.ok([0, 1].includes(p.need), where(`platform ${p.q}: need must be 0 or 1`));
      }
      for (const t of room.terminals || []) gateOps(t.ops, where(`terminal ${t.id}`));
      if (room.canister) known(room.canister.q, where('canister'));
      if (room.door) {
        const { key, lock } = room.door;
        lock.forEach((id) => known(id, where('door lock')));
        assert.equal((key || '').length, lock.length, where('door: the key needs one digit per lock lamp'));
        gateOps(room.door.check, where('door check'));
      }
    }

    // The engine can start the floor exactly as the game does.
    const index = Object.fromEntries(ids.map((id, i) => [id, i]));
    const prep = (level.prep || []).map((op) => ({ gate: op.gate, qubits: op.q.map((id) => index[id]) }));
    const snap = new Lab(level.qubits.map((q) => ({ id: q.id, init: q.init })), { prep }).snapshot();
    assert.deepEqual(snap.labels, ids);
  });
}
