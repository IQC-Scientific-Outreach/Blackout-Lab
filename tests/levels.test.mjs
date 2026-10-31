// Level data checks: node --test tests/
//
// Catches the usual slips when adding or editing a floor in game/levels.js: a
// qubit id that does not exist, a gate the engine does not know, a key that does
// not match its lock, a floor the engine cannot start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, BONUS_LEVELS, GATE_INFO, roomsOf } from '../game/levels.js';
import { LIGHT_KINDS } from '../game/geometry.js';
import { Lab } from '../game/quantum.js';

const ROLES = ['platform', 'canister', 'sealed', 'box', 'door'];

const ALL = [...LEVELS.map((level, i) => [`floor ${i + 1}`, level]), ...BONUS_LEVELS.map((level, i) => [`bonus level ${i + 1}`, level])];

for (const [where0, level] of ALL) {
  test(`${where0}: ${level.name}`, () => {
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
        if (p.axis === 'x') assert.ok([p.x0, p.x1, p.y].every(Number.isFinite), where(`sideways platform ${p.q} needs x0, x1 and y`));
        else assert.ok([p.x, p.y0, p.y1].every(Number.isFinite), where(`platform ${p.q} needs x, y0 and y1`));
        if (p.shuttle) {
          const far = (room.terminals || []).find((t) => t.id === p.shuttle.arrive);
          assert.ok(far && far.auto, where(`shuttle ${p.q} arrives at ${p.shuttle.arrive}, which must be an auto terminal`));
          assert.ok(p.shuttle.speed > 0 && Number.isFinite(p.shuttle.to), where(`shuttle ${p.q} needs a speed and a destination`));
        }
      }
      for (const light of room.lights || []) {
        assert.ok(light.kind in LIGHT_KINDS, where(`unknown light kind ${light.kind}`));
        assert.ok([light.x, light.y, light.angle, light.spread, light.range].every(Number.isFinite), where('a light needs x, y, angle, spread and range'));
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
