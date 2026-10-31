// The quantum engine: the live state of one floor's qubits, computed exactly.
//
// Each floor owns a handful of qubits: one per moving platform, one per sealed
// qubit and one per door-lock lamp. They are held as a full state vector of
// 2^n complex amplitudes (at most 10 qubits), and every gate is the exact
// matrix, so the physics is ideal: H gives exactly 50/50, H then H is nothing,
// H, Z, H is an X. Only a measurement is random, by the Born rule.
//
//     gate at a terminal     -> Lab.apply    (exact gate on the amplitudes)
//     flashlight on a qubit  -> Lab.measure  (Born-rule sample, then collapse)
//     wrong door key         -> Lab.reset
//     how a floor starts     -> Lab.auto     (gates the floor applies by itself,
//                                             such as a pair that begins entangled)
//
// Every action is also recorded, so the rack can draw the floor's circuit and
// list it as Qiskit code. Nothing here knows about the game's geometry or the
// page: Lab.snapshot() returns plain data that the game turns into platforms and
// charts, and the file runs unchanged in Node for the tests.
//
// Qubit k is bit k of an amplitude's index (Qiskit's ordering), so the code
// listing rebuilds exactly this state when run in Qiskit.

const EPS = 1e-9;
const R = Math.SQRT1_2;

// Gates a terminal may offer, with the number of qubits each acts on.
const GATE_QUBITS = { i: 1, h: 1, x: 1, z: 1, cx: 2, cz: 2 }; // i: identity, which does nothing

// How a floor's starting states are prepared from |0>.
const INIT_GATES = { 0: [], 1: ['x'], '+': ['h'], '-': ['x', 'h'] };

// How a measurement is described in the code listing.
const MEASURED_BY = {
  torch: 'flashlight on',
  lock: 'the door lock read',
  machine: 'the machine measured',
  box: 'opening the box showed',
  touch: 'the player landed on',
  light: 'the backup light observed',
};

function combinations(items, size) {
  if (size === 0) return [[]];
  const out = [];
  items.forEach((item, i) => {
    for (const tail of combinations(items.slice(i + 1), size - 1)) out.push([item, ...tail]);
  });
  return out;
}

export class Lab {
  // qubits: [{ id: 'A', init: '0' | '1' | '+' | '-' }, ...]
  // prep:   gates the floor applies before play, e.g. [{ gate: 'cx', qubits: [0, 1] }]
  // random: a function returning [0, 1), replaceable in tests
  constructor(qubits, { prep = [], random = Math.random } = {}) {
    const n = qubits.length;
    if (n < 1 || n > 10) throw new Error('a floor needs between 1 and 10 qubits');
    this.n = n;
    this.labels = qubits.map((q) => String(q.id));
    this.init = qubits.map((q) => String(q.init === undefined ? '0' : q.init));
    this.random = random;
    this.re = new Float64Array(1 << n);
    this.im = new Float64Array(1 << n);
    this.re[0] = 1;
    // One entry per instruction of the floor's circuit, in order.
    this.meta = [];
    this.init.forEach((init, q) => {
      if (!(init in INIT_GATES)) throw new Error(`unknown starting state '${init}'`);
      for (const name of INIT_GATES[init]) this._gate(name, [q], 'init');
    });
    this.auto(prep);
  }

  // -- operations -------------------------------------------------------

  _check(qubits) {
    const out = qubits.map((q) => Number(q));
    if (new Set(out).size !== out.length || out.some((q) => !Number.isInteger(q) || q < 0 || q >= this.n)) {
      throw new Error(`bad qubits [${out}]`);
    }
    return out;
  }

  _valid(name, qubits) {
    name = String(name).toLowerCase();
    if (!(name in GATE_QUBITS)) throw new Error(`unknown gate '${name}'`);
    qubits = this._check(qubits);
    if (qubits.length !== GATE_QUBITS[name]) throw new Error(`${name} acts on ${GATE_QUBITS[name]} qubit(s)`);
    return [name, qubits];
  }

  // The gate itself, on the amplitudes. cx is [control, target]; cz is symmetric.
  _evolve(name, qubits) {
    if (name === 'i') return;
    const { re, im } = this;
    const size = 1 << this.n;
    if (name === 'cz') {
      // Z on one qubit when the other is 1: the |11> amplitudes change sign (it is symmetric).
      const both = (1 << qubits[0]) | (1 << qubits[1]);
      for (let i = 0; i < size; i += 1) {
        if ((i & both) === both) {
          re[i] = -re[i];
          im[i] = -im[i];
        }
      }
      return;
    }
    const bit = 1 << qubits[qubits.length - 1];
    if (name === 'cx') {
      const ctrl = 1 << qubits[0];
      for (let i = 0; i < size; i += 1) {
        if (i & ctrl && !(i & bit)) {
          const j = i | bit;
          [re[i], re[j]] = [re[j], re[i]];
          [im[i], im[j]] = [im[j], im[i]];
        }
      }
      return;
    }
    for (let i = 0; i < size; i += 1) {
      if (i & bit) continue;
      const j = i | bit;
      const ar = re[i];
      const ai = im[i];
      const br = re[j];
      const bi = im[j];
      if (name === 'h') {
        re[i] = (ar + br) * R;
        im[i] = (ai + bi) * R;
        re[j] = (ar - br) * R;
        im[j] = (ai - bi) * R;
      } else if (name === 'x') {
        re[i] = br;
        im[i] = bi;
        re[j] = ar;
        im[j] = ai;
      } else if (name === 'z') {
        re[j] = -br;
        im[j] = -bi;
      }
    }
  }

  _gate(name, qubits, kind) {
    this._evolve(name, qubits);
    this.meta.push({ kind, gate: name, qubits: qubits.slice() });
  }

  // Gates the floor applies by itself: a starting entanglement, a lock's own check.
  // They are not counted as the player's gates.
  auto(ops) {
    for (const op of ops || []) {
      const [name, qubits] = this._valid(op.gate, op.qubits);
      this._gate(name, qubits, 'auto');
    }
  }

  // A gate chosen at a terminal.
  apply(name, qubits) {
    [name, qubits] = this._valid(name, qubits);
    this._gate(name, qubits, 'gate');
  }

  // Probability that measuring qubit q gives 1.
  pOne(q) {
    let p = 0;
    const bit = 1 << q;
    for (let i = 0; i < 1 << this.n; i += 1) if (i & bit) p += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    return p;
  }

  _collapse(q, outcome) {
    const bit = 1 << q;
    let norm = 0;
    for (let i = 0; i < 1 << this.n; i += 1) {
      if (!!(i & bit) !== !!outcome) {
        this.re[i] = 0;
        this.im[i] = 0;
      } else norm += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    }
    if (norm < EPS) throw new Error('cannot collapse onto an outcome with zero probability');
    norm = Math.sqrt(norm);
    for (let i = 0; i < 1 << this.n; i += 1) {
      this.re[i] /= norm;
      this.im[i] /= norm;
    }
  }

  // Measure one qubit in the computational basis and collapse the state.
  //
  // A qubit that is already definite is left alone (nothing is recorded) unless
  // `force` is set, which locks and machines use so that their read-out shows up
  // on the circuit. `by` records what did the measuring: torch, lock, machine, box or
  // touch (landing on a platform, a developer option).
  measure(q, force = false, by = 'torch') {
    [q] = this._check([q]);
    const p1 = this.pOne(q);
    const definite = p1 < EPS || p1 > 1 - EPS;
    if (definite && !force) return null;
    const outcome = definite ? Number(p1 > 0.5) : Number(this.random() < p1);
    this._collapse(q, outcome);
    this.meta.push({ kind: 'measure', gate: 'measure', qubits: [q], result: outcome, p1, by });
    return { qubit: q, label: this.labels[q], result: outcome, p1, random: !definite, by };
  }

  // Return one qubit to |0> (measure it, then flip it back if it read 1).
  // `by` records what did it: '' for a lock clearing its lamps, 'emergency' for an
  // emergency backup light (amplitude damping, all the way to |0>).
  reset(q, by = '') {
    [q] = this._check([q]);
    const p1 = this.pOne(q);
    const outcome = p1 > EPS && p1 < 1 - EPS ? Number(this.random() < p1) : Number(p1 > 0.5);
    this._collapse(q, outcome);
    if (outcome) this._evolve('x', [q]);
    this.meta.push({ kind: 'reset', gate: 'reset', qubits: [q], by });
  }

  // -- read-outs --------------------------------------------------------

  // Bloch vector and purity of every single qubit.
  _reduced() {
    const out = [];
    for (let q = 0; q < this.n; q += 1) {
      const bit = 1 << q;
      let r00 = 0;
      let r11 = 0;
      let xr = 0;
      let xi = 0;
      for (let i = 0; i < 1 << this.n; i += 1) {
        if (i & bit) continue;
        const j = i | bit;
        r00 += this.re[i] * this.re[i] + this.im[i] * this.im[i];
        r11 += this.re[j] * this.re[j] + this.im[j] * this.im[j];
        xr += this.re[i] * this.re[j] + this.im[i] * this.im[j];
        xi += this.im[i] * this.re[j] - this.re[i] * this.im[j];
      }
      out.push({ x: 2 * xr, y: -2 * xi, z: r00 - r11, purity: r00 * r00 + r11 * r11 + 2 * (xr * xr + xi * xi) });
    }
    return out;
  }

  // Purity of the reduced state of a set of qubits: 1 means the set has a state of its own.
  _purityOf(subset) {
    const rest = [];
    for (let q = 0; q < this.n; q += 1) if (!subset.includes(q)) rest.push(q);
    const index = (a, b) => {
      let i = 0;
      subset.forEach((q, k) => {
        if ((a >> k) & 1) i |= 1 << q;
      });
      rest.forEach((q, k) => {
        if ((b >> k) & 1) i |= 1 << q;
      });
      return i;
    };
    let purity = 0;
    for (let a = 0; a < 1 << subset.length; a += 1) {
      for (let c = 0; c < 1 << subset.length; c += 1) {
        let xr = 0;
        let xi = 0;
        for (let b = 0; b < 1 << rest.length; b += 1) {
          const i = index(a, b);
          const j = index(c, b);
          xr += this.re[i] * this.re[j] + this.im[i] * this.im[j];
          xi += this.im[i] * this.re[j] - this.re[i] * this.im[j];
        }
        purity += xr * xr + xi * xi;
      }
    }
    return purity;
  }

  // Sets of qubits that are entangled with one another.
  //
  // The register as a whole is in a pure state, so a set of qubits has a state of
  // its own exactly when its reduced state is pure. A qubit that is mixed on its
  // own (purity < 1) is entangled with something: its group is the smallest set
  // containing it whose reduced state is pure again.
  _groups(reduced) {
    let left = [];
    for (let q = 0; q < this.n; q += 1) if (reduced[q].purity < 1 - 1e-7) left.push(q);
    const groups = [];
    while (left.length) {
      const [first, ...others] = left;
      let group = left.slice();
      for (let size = 1; size < others.length; size += 1) {
        const found = combinations(others, size).find((c) => Math.abs(this._purityOf([first, ...c]) - 1) < 1e-7);
        if (found) {
          group = [first, ...found];
          break;
        }
      }
      groups.push(group.slice().sort((a, b) => a - b));
      left = left.filter((q) => !group.includes(q));
    }
    return groups.sort((a, b) => a[0] - b[0]);
  }

  // Outcome probabilities of a group. bits[k] is the value of group[k].
  _joint(group) {
    const probs = new Array(1 << group.length).fill(0);
    for (let i = 0; i < 1 << this.n; i += 1) {
      let k = 0;
      group.forEach((q, pos) => {
        if ((i >> q) & 1) k |= 1 << pos;
      });
      probs[k] += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    }
    const rows = [];
    probs.forEach((p, index) => {
      if (p > 1e-9) rows.push({ bits: group.map((_, k) => (index >> k) & 1).join(''), p });
    });
    const key = (r) => Math.round(r.p * 1e9);
    return rows.sort((a, b) => key(b) - key(a) || (a.bits < b.bits ? -1 : 1));
  }

  // Everything done since the floor started, for the circuit drawing.
  ops() {
    return this.meta
      .filter((m) => m.kind !== 'init')
      .map((m) => {
        if (m.kind === 'measure') return { kind: m.kind, gate: m.gate, qubits: m.qubits, result: m.result, by: m.by };
        if (m.kind === 'reset') return { kind: m.kind, gate: m.gate, qubits: m.qubits, by: m.by };
        return { kind: m.kind, gate: m.gate, qubits: m.qubits };
      });
  }

  // The floor's circuit as Qiskit code a player can paste into a notebook and run.
  code() {
    const lines = [
      'from qiskit import QuantumCircuit',
      '',
      `# qubits: ${this.labels.map((label, i) => `${i}=${label}`).join(', ')}`,
      `qc = QuantumCircuit(${this.n}, ${this.n})`,
    ];
    for (const m of this.meta) {
      const q = m.qubits;
      const label = this.labels[q[q.length - 1]];
      if (m.kind === 'measure') lines.push(`qc.measure(${q[0]}, ${q[0]})  # ${MEASURED_BY[m.by] || m.by} ${label}: read ${m.result}`);
      else if (m.kind === 'reset') lines.push(`qc.reset(${q[0]})  # ${m.by === 'emergency' ? `emergency light: ${label} damped to 0` : `${label} cleared to 0`}`);
      else {
        let call = `qc.${m.gate === 'i' ? 'id' : m.gate}(${q.join(', ')})`;
        if (m.kind === 'init') call += `  # ${label} starts in |${this.init[q[0]]}>`;
        else if (m.kind === 'auto') call += '  # done by the floor itself';
        lines.push(call);
      }
    }
    return lines.join('\n');
  }

  // Circuit depth the way Qiskit counts it: every instruction, measurements and resets included.
  _depth() {
    const level = new Array(this.n).fill(0);
    for (const m of this.meta) {
      const d = Math.max(...m.qubits.map((q) => level[q])) + 1;
      for (const q of m.qubits) level[q] = d;
    }
    return Math.max(0, ...level);
  }

  // Everything the game needs to draw this floor's quantum state.
  snapshot() {
    const reduced = this._reduced();
    const round6 = (v) => Math.round(v * 1e6) / 1e6 + 0;
    const raw = reduced.map((r) => Math.min(Math.max((1 - r.z) / 2, 0), 1));
    const definite = raw.map((p) => (p < 1e-6 ? 0 : p > 1 - 1e-6 ? 1 : null));
    const groups = this._groups(reduced);
    return {
      labels: this.labels,
      init: this.init,
      p1: raw.map((p, q) => (definite[q] === null ? p : definite[q])),
      definite,
      bloch: reduced.map((r) => [round6(r.x), round6(r.y), round6(r.z)]),
      purity: reduced.map((r) => round6(r.purity)),
      groups,
      joint: groups.map((g) => ({ qubits: g, dist: this._joint(g) })),
      ops: this.ops(),
      code: this.code(),
      stats: {
        gates: this.meta.filter((m) => m.kind === 'gate').length,
        measurements: this.meta.filter((m) => m.kind === 'measure').length,
        depth: this._depth(),
      },
    };
  }
}

// What the game calls. Every call answers { ok: true, ... } or { ok: false, error }
// and never throws, so an engine error cannot freeze the game loop.
export function createQuantum({ random = Math.random } = {}) {
  let lab = null;

  function reply(fn) {
    try {
      return { ok: true, ...(fn() || {}) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  function need() {
    if (!lab) throw new Error('no floor loaded yet');
    return lab;
  }

  return {
    // spec: { qubits: [{ id, init }, ...], prep: [{ gate, qubits }, ...] }
    loadLevel: (spec) =>
      reply(() => {
        lab = new Lab(spec.qubits, { prep: spec.prep, random });
        return { state: lab.snapshot() };
      }),
    apply: (gate, qubits) =>
      reply(() => {
        need().apply(gate, qubits);
        return { state: lab.snapshot() };
      }),
    // Measures the qubits one by one; a partner already settled by an earlier one is skipped.
    measure: (qubits, force = false, by = 'torch') =>
      reply(() => {
        const measured = qubits.map((q) => need().measure(q, !!force, String(by))).filter(Boolean);
        return { state: lab.snapshot(), measured };
      }),
    // Gates the floor applies itself, after clearing `reset`: a lock's check, a fresh key.
    auto: (ops, reset = []) =>
      reply(() => {
        for (const q of reset) need().reset(q);
        need().auto(ops);
        return { state: lab.snapshot() };
      }),
    reset: (qubits, by = '') =>
      reply(() => {
        for (const q of qubits) need().reset(q, by);
        return { state: lab.snapshot() };
      }),
  };
}
