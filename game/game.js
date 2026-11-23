// Blackout Lab: game state, platformer physics and the rules that connect the
// flashlight, the terminals, the canister and the doors to the quantum engine.
//
// The quantum state itself lives in the engine (quantum.js). This file only
// ever asks the engine to apply a gate, measure, or reset, and then moves the
// platforms to wherever the returned snapshot says they are.

import { LEVELS, BONUS_LEVELS, BEAST, TERRACE, WORLD, PLATFORM_H, LIVES_PER_FLOOR, GATE_INFO, ROLE_WORDS, roomsOf } from './levels.js';
import { TORCH, PLAYER, slotRect, slotMid, doorRect, lockRect, screenRect, center, handOf, rectLit, pointLit, lightPolygon, rectInLight, LIGHT_KINDS, cavityBlocked, cavityHolds } from './geometry.js';
import { STORY } from './story.js';
import { createQuantum } from './quantum.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer } from './render.js';
import { createPanel, describe } from './panel.js';
import { createUI, grabDom } from './ui.js';

const PHYS = { speed: 190, accel: 2200, gravity: 1900, jump: 620, coyote: 0.09, buffer: 0.11, maxFall: 900, step: 1 / 120 };
const MIN_REMARK = 2.5;
const LONG_TOAST = 5.2;
const CRANK_X = TERRACE.scene.generator.x - 53;

// The terrace has no qubits, so the rack is handed an empty snapshot there.
const NO_QUBITS = {
  labels: [],
  init: [],
  p1: [],
  definite: [],
  bloch: [],
  purity: [],
  groups: [],
  joint: [],
  ops: [],
  code: '# No qubits on the terrace.',
  stats: { gates: 0, measurements: 0, depth: 0 },
};

// Settings that began as developer options and are now simply how the game plays:
//   keyTorch         hold F to shine, I / K to tilt; the mouse does not aim
//   touchCollapse    touching a superposed platform measures it
//   instantResponse  platforms move while you are still at a terminal
//   passiveTerminal  standing at a terminal shows its gates; 1, 2, 3 apply them
//   canisterView     the held canister's state shows in the panel
//   showGates        each gate pops up over the qubits it acts on
const ALWAYS_ON = { keyTorch: true, touchCollapse: true, instantResponse: true, passiveTerminal: true, canisterView: true, showGates: true };
// Developer options (title screen). Remembered in this browser only.
const DEV_KEY = 'blackoutLab.dev';
const DEV_DEFAULTS = {
  swapDelay: 3, // whole seconds between choosing SWAP and the platforms setting off (1 to 5), counted down
  panel: 'right',
  circuitRight: false,
};

function loadDev() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEV_KEY) || '{}');
    const dev = { ...DEV_DEFAULTS };
    for (const name of Object.keys(DEV_DEFAULTS)) if (typeof saved[name] === typeof DEV_DEFAULTS[name]) dev[name] = saved[name];
    dev.swapDelay = Math.min(5, Math.max(1, Math.round(Number(dev.swapDelay) || 3)));
    return { ...dev, ...ALWAYS_ON };
  } catch (err) {
    return { ...DEV_DEFAULTS, ...ALWAYS_ON };
  }
}

function saveDev(dev) {
  try {
    localStorage.setItem(DEV_KEY, JSON.stringify(dev));
  } catch (err) {
    // private windows and blocked storage: the options last until the page closes
  }
}

// Level numbers: the climb's floors (0 to 6), then the terrace, then the bonus levels,
// which are reached only from "Skip to floor" and are not part of the climb.
const BONUS_FROM = LEVELS.length + 1;
const isBonus = (index) => index >= BONUS_FROM;
// The last bonus level, the beast on the roof, is its own kind of level (BEAST in levels.js).
const BEAST_INDEX = BONUS_FROM + BONUS_LEVELS.length;
const levelAt = (index) =>
  index < LEVELS.length ? LEVELS[index] : index === BEAST_INDEX ? BEAST : isBonus(index) ? BONUS_LEVELS[index - BONUS_FROM] : null;
const hasNextBonus = (index) => index + 1 <= BEAST_INDEX;

// Each level's stars, the same every time (so they can be shown before it is played):
//   1. cleared;
//   2. the fewest gates (`shortest`), where the floor needs any;
//   3. solved without luck: bonus level 7's eight unobserved turns; a level's own no-luck
//      gate sequence (`bonus.sequences`); or, with `noLuck`, no outcome left to chance at all.
//      Where luck cannot be avoided, solved with no hints instead.
function starsOf(level) {
  const stars = [{ key: 'cleared', text: level.firstStar || 'Reached the exit' }];
  if (level.shortest > 0) stars.push({ key: 'fewest', text: `Fewest gates (${level.shortest})` });
  if (level.beast) stars.push({ key: 'sure', text: level.beast.sureStar });
  else if (level.bonus && level.bonus.sequences) stars.push({ key: 'sequence', text: level.bonus.text });
  else if (level.noLuck) stars.push({ key: 'noLuck', text: 'Solved without luck' });
  else stars.push({ key: 'noHints', text: 'No hints' });
  return stars;
}

// Stars and best times, kept in this browser: { [level id]: { stars: [true, false, ...], best } }.
// A star, once earned, stays earned; the best time is the fastest clear.
const PROGRESS_KEY = 'blackoutLab.progress';
function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch (err) {
    return {};
  }
}
function saveProgress(progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (err) {
    // private windows and blocked storage: progress lasts until the page closes
  }
}

const count = (n, one, many) => (n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`);
const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function startGame() {
  const dom = grabDom();
  const Q = createQuantum();
  const audio = createAudio();
  const renderer = createRenderer(dom.game);
  const panel = createPanel(dom);
  const input = createInput(dom.game, WORLD);

  const G = {
    mode: 'boot', // boot | title | loading | play | terminal | dialogue | cutscene | paused | falling | complete | over | win | error
    t: 0,
    epoch: 0,
    levelIndex: 0,
    level: null,
    q: null,
    qIndex: {},
    rooms: [],
    roomIndex: 0,
    room: null, // the room on screen
    platforms: [],
    door: null,
    canister: null,
    player: { x: 0, y: 0, vx: 0, vy: 0, facing: 1, onGround: false, coyote: 0, buffer: 0, anim: 0, standing: null, visible: true },
    torch: { on: true, active: false, lowered: false, angle: 0, tilt: 0.15, useMouse: false, battery: 'ok', range: TORCH.range, flickT: 3, flickLeft: 0 },
    dialogue: null,
    bubbles: [],
    fx: [],
    floaters: [],
    shake: 0,
    lives: LIVES_PER_FLOOR,
    infinite: false,
    dev: loadDev(),
    stats: null,
    results: [],
    hints: 0,
    flags: {},
    floorTime: 0, // seconds of play on this attempt
    bonusDone: false,
    scene: null,
    pausedFrom: 'play',
    hasKey: false,
    busy: false,
    terminal: null,
    passive: null, // the terminal shown passively (developer option), if any
    passiveCarrying: false,
    fallT: 0,
    started: false,
  };

  const ui = createUI(dom, {
    start: () => startRun(),
    reset: () => resetGame(),
    pause: () => pause(),
    resume: () => resume(),
    restart: () => restartFloor(),
    quit: () => toTitle(),
    next: () => nextFloor(),
    replay: () => loadLevel(G.levelIndex),
    retry: () => startRun(),
    home: () => toTitle(),
    errorRetry: () => loadLevel(G.levelIndex),
    skipTo: (index) => {
      audio.unlock();
      G.started = true;
      G.results = [];
      loadLevel(index);
    },
    jump: (index) => {
      G.started = true;
      loadLevel(index);
    },
    sound: () => toggleSound(),
    hint: () => showHint(),
    closeTerminal: () => closeTerminal(),
    applyOp: (i) => applyOp(i),
    option: (name, value) => setOption(name, value),
    dev: (name, value) => setDev(name, value),
    menu: () => toTitle(),
    touchHold: (action, down) => input.setHeld(action, down),
    touchTap: (action) => {
      input.setHeld(action, true);
      input.setHeld(action, false);
    },
  });
  let progress = loadProgress();
  // The level lists (title, pause, ending) with each level's stars and best time, and the total.
  function listFloors() {
    const entry = (level, name, index) => {
      const saved = progress[level.id] || {};
      const of = starsOf(level).length;
      const got = Array.isArray(saved.stars) ? saved.stars.slice(0, of).filter(Boolean).length : 0;
      return { name, index, got, of, best: Number.isFinite(saved.best) ? saved.best : null };
    };
    const floors = LEVELS.map((level, i) => entry(level, `${i + 1}. ${level.name}`, i));
    const bonus = [...BONUS_LEVELS, BEAST].map((level, i) => entry(level, `Bonus ${i + 1}. ${level.name}`, BONUS_FROM + i));
    ui.setFloors(floors, `Ending: ${TERRACE.name}`, bonus);
    const all = [...floors, ...bonus];
    ui.setStarTotal(all.reduce((n, f) => n + f.got, 0), all.reduce((n, f) => n + f.of, 0));
  }
  listFloors();

  function recordClear(level, earned, seconds) {
    const saved = progress[level.id] || {};
    const stars = earned.map((e, i) => e.got || !!(saved.stars && saved.stars[i]));
    const best = Number.isFinite(saved.best) ? Math.min(saved.best, seconds) : seconds;
    progress = { ...progress, [level.id]: { stars, best } };
    saveProgress(progress);
    listFloors();
  }

  function resetGame() {
    progress = {};
    saveProgress(progress);
    G.results = [];
    listFloors();
    ui.announce('Game reset: every star and best time is cleared.');
    ui.toast('Game reset: every star and best time is cleared.', 'info');
  }

  // -- small helpers --------------------------------------------------------

  function say(text, kind, toastToo) {
    panel.log(text, kind);
    ui.announce(text);
    if (toastToo) {
      const look = kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : kind === 'quantum' ? 'quantum' : 'info';
      ui.toast(text, look, typeof toastToo === 'number' ? toastToo : undefined);
    }
  }

  const LIVE_MODES = ['play', 'terminal', 'dialogue', 'cutscene'];
  function setMode(mode) {
    G.mode = mode;
    if (mode !== 'play') closePassive();
    input.setEnabled(LIVE_MODES.includes(mode));
    ui.setPlaying(LIVE_MODES.includes(mode));
    ui.setMenuButton(mode !== 'boot' && mode !== 'title');
    input.clearPresses();
  }

  const roleOf = (qi) => G.level.qubits[qi].role;
  const carrying = () => !!(G.canister && G.canister.carried);
  const story = () => STORY[G.level.id] || {};

  function valueWords(qi, value) {
    const words = ROLE_WORDS[roleOf(qi)];
    return words ? `state ${value} (${words[value]})` : `state ${value}`;
  }

  function stateSentence(snap, qi) {
    const name = snap.labels[qi];
    const d = describe(snap, qi);
    const words = ROLE_WORDS[roleOf(qi)] || ['0', '1'];
    if (d.kind === 'definite') return `${name} is in ${valueWords(qi, d.p1)}.`;
    if (d.kind === 'entangled') return `${name} is entangled with ${list(d.partners.map((k) => snap.labels[k]))}: they will collapse together.`;
    return `${name} is in superposition ${d.ket}: ${Math.round((1 - d.p1) * 100)}% ${words[0]}, ${Math.round(d.p1 * 100)}% ${words[1]}.`;
  }

  function updateHud() {
    ui.setHud({
      floorText: (G.level && G.level.tag) || `Floor ${G.levelIndex + 1} of ${LEVELS.length}`,
      name: G.level ? G.level.name : '',
      lives: G.lives,
      maxLives: LIVES_PER_FLOOR,
      infinite: G.infinite,
      torch: G.level && G.level.outdoor ? 'ok' : G.torch.battery,
    });
  }

  function addRing(pt, color, size) {
    if (pt) G.fx.push({ type: 'ring', x: pt.x, y: pt.y, t: 0, dur: 0.55, color, size });
  }

  function addFloater(pt, text, color) {
    if (pt) G.floaters.push({ x: pt.x, y: pt.y, text, color, t: 0, dur: 1.5 });
  }

  // -- story plumbing ---------------------------------------------------------

  // The player thinks out loud. A line already showing gets at least MIN_REMARK
  // seconds before the next one takes its place.
  function remark(text, extra) {
    const showing = G.bubbles.find((b) => b.anchor === 'player' && !(b.wait > 0));
    const wait = showing ? Math.max(0, MIN_REMARK - showing.t) : 0;
    if (showing) showing.dur = showing.t + wait;
    G.bubbles = G.bubbles.filter((b) => b.anchor !== 'player' || (b === showing && wait > 0));
    G.bubbles.push({ anchor: 'player', text, t: 0, wait, dur: Math.max(4.5, text.length * 0.075) + (extra || 0) });
    panel.log(`You: ${text}`, 'info');
    ui.announce(text);
  }

  function anchorNamed(at) {
    if (at && typeof at === 'object') return at;
    const npc = G.room.npcs.find((n) => n.id === at);
    if (npc) return { x: npc.x, y: npc.y - 44 };
    if (at === 'box') {
      const box = G.room.terminals.find((t) => t.box);
      if (box) return G.flags.opened ? { x: box.x + 3, y: box.y - 42 } : { x: box.x, y: box.y - 34 };
    }
    return null;
  }

  function bubble(at, text) {
    const anchor = anchorNamed(at);
    if (!anchor) return;
    G.bubbles.push({ anchor, text, t: 0, dur: Math.max(2.2, text.length * 0.07) });
    if (text.length > 12) panel.log(text, 'info');
  }

  function talkLines(speaker, lines, then, anchor) {
    G.dialogue = { speaker, lines, index: 0, then: then || null, anchor };
    setMode('dialogue');
    showLine();
  }

  function showLine() {
    const d = G.dialogue;
    const text = d.lines[d.index];
    const more = d.index < d.lines.length - 1;
    ui.setPrompt(`<b>${esc(d.speaker)}:</b> ${esc(text)} <span class="fine">${more ? 'E: next' : 'E: close'}</span>`);
    panel.log(`${d.speaker}: ${text}`, 'info');
    ui.announce(`${d.speaker}: ${text}`);
  }

  function advanceDialogue(skip) {
    const d = G.dialogue;
    if (!d) return;
    if (!skip && d.index < d.lines.length - 1) {
      d.index += 1;
      audio.play('click');
      showLine();
      return;
    }
    G.dialogue = null;
    setMode('play');
    if (d.then) d.then();
  }

  function storyCtx(npc) {
    const idx = (id) => G.qIndex[id];
    return {
      flags: G.flags,
      definite: (id) => G.q.definite[idx(id)],
      p1: (id) => G.q.p1[idx(id)],
      carrying: carrying(),
      doorOpen: !!(G.door && G.door.open),
      say: (who, lines, then) => talkLines(who, lines, then, npc ? { x: npc.x, y: npc.y - 44 } : 'player'),
      remark,
      bubble,
      setNote: (text) => ui.setNote(text),
      giveKey() {
        G.hasKey = true;
        if (G.door) {
          G.door.unlocked = true;
          G.door.open = true;
          addRing(center(doorRect(G.door)), '#7dffa8', 60);
        }
        audio.play('unlock');
        say('You have the key. The exit is unlocked.', 'good', true);
      },
      async measure(ids, by) {
        const epoch = G.epoch;
        const before = G.q;
        const res = await Q.measure(ids.map(idx), true, by);
        if (epoch !== G.epoch || !res.ok) return [];
        applySnapshot(res.state);
        reportCollapse(before, res.state, res.measured);
        if (by === 'box') {
          const r = res.state.definite[idx(ids[0])];
          say(r ? 'The box is open. The atom had decayed.' : 'The box is open. The atom is intact and the cat is alive.', r ? 'bad' : 'good');
        }
        return ids.map((id) => res.state.definite[idx(id)]);
      },
      restart: () => reprepare('The experiment was reset to its starting entanglement.'),
    };
  }

  async function reprepare(message) {
    const epoch = G.epoch;
    const reset = G.level.qubits.map((q, i) => (q.role === 'platform' ? -1 : i)).filter((i) => i >= 0);
    const res = await Q.auto(prepOps(), reset);
    if (epoch !== G.epoch || !res.ok) return;
    applySnapshot(res.state);
    if (message) say(message, 'info', true);
  }

  function prepOps() {
    return (G.level.prep || []).map((op) => ({ gate: op.gate, qubits: op.q.map((id) => G.qIndex[id]) }));
  }

  // -- floors ---------------------------------------------------------------

  function placePlayer(x, surfaceY) {
    const pl = G.player;
    pl.x = x;
    pl.y = surfaceY - PLAYER.h;
    pl.vx = 0;
    pl.vy = 0;
    pl.onGround = true;
    pl.standing = null;
    pl.visible = true;
  }

  function buildFloor(level) {
    G.level = level;
    G.qIndex = {};
    level.qubits.forEach((q, i) => {
      G.qIndex[q.id] = i;
    });
    const canQubit = level.qubits.find((q) => q.role === 'canister');
    G.canister = null;
    G.door = null;
    G.rooms = roomsOf(level).map((room) => {
      const built = {
        id: room.id,
        name: room.name,
        spawn: room.spawn,
        solids: room.solids,
        decor: room.decor || [],
        platforms: (room.platforms || []).map((p) => {
          // A sideways platform keeps one height and moves between x0 and x1.
          const sideways = p.axis === 'x' ? { x: p.x0, y0: p.y, y1: p.y } : {};
          const built = { ...p, ...sideways, qi: G.qIndex[p.q], state: 0, p1: 0, flash: 0, exposure: 0, lightExposure: 0, lightKind: null, pending: false };
          // It starts where its starting state parks it (a qubit that starts as 1 does not glide over).
          const start = slotRect(built, level.qubits[G.qIndex[p.q]].init === '1' ? 1 : 0);
          built.x = start.x;
          built.y = start.y;
          built.targetX = start.x;
          built.targetY = start.y;
          built.placeX = built.x; // where a swap is taking it (see swapPlatforms)
          return built;
        }),
        lights: (room.lights || []).map((l) => ({ ...l, poly: null })),
        cavities: (room.cavities || []).map((c) => ({ ...c, load: 0 })), // load: 0 to 1, refilling after a block
        terminals: (room.terminals || []).map((t) => {
          const surface = room.solids.find((s) => t.x >= s.x && t.x <= s.x + s.w && Math.abs(s.y - t.y) < 1);
          const fitsRight = surface ? t.x + 40 <= surface.x + surface.w : true;
          return {
            ...t,
            ops: t.ops.map((op) => ({ ...op, qi: op.q.map((id) => G.qIndex[id]), needsCanister: !!canQubit && op.q.includes(canQubit.id) })),
            broken: t.broken ? { ...t.broken, ops: t.broken.ops.map((op) => ({ ...op, qi: op.q.map((id) => G.qIndex[id]) })) } : null,
            clock: 0, // a broken terminal: time since its last gate
            step: 0, // and which of its gates comes next
            thrown: false,
            sealedQi: t.sealed ? G.qIndex[t.sealed] : -1,
            cryoSide: fitsRight ? 1 : -1,
            near: false,
          };
        }),
        npcs: (room.npcs || []).map((n) => ({ ...n, near: false })),
        portals: (room.portals || []).map((p) => ({ ...p, near: false })),
        battery: room.battery ? { ...room.battery, taken: false } : null,
        door: null,
      };
      if (room.door) {
        built.door = {
          ...room.door,
          lockQi: room.door.lock.map((id) => G.qIndex[id]),
          open: !room.door.key && !room.door.item,
          unlocked: !room.door.key && !room.door.item,
          exposure: 0,
          armed: true,
          pending: false,
          lastRead: null,
          deniedT: 0,
          near: false,
        };
        G.door = built.door;
      }
      if (room.canister) G.canister = { ...room.canister, qi: G.qIndex[room.canister.q], carried: false, roomId: room.id };
      return built;
    });
    G.platforms = G.rooms.flatMap((r) => r.platforms);
    G.roomIndex = 0;
    G.room = G.rooms[0];
    placePlayer(G.room.spawn.x, G.room.spawn.y);
    G.player.facing = 1;
    G.fx = [];
    G.floaters = [];
    G.bubbles = [];
    G.dialogue = null;
    G.shake = 0;
    G.flags = {};
    G.floorTime = 0;
    G.bonusDone = false;
    G.scene = null;
    G.hasKey = false;
    G.torch.on = !level.torchOff;
    G.torch.tilt = 0.15;
    G.torch.battery = level.torch || 'ok';
    G.torch.range = TORCH.range;
    G.torch.flickT = 0.5; // a failing flashlight stutters as soon as the floor starts
    G.torch.flickLeft = 0;
    G.terminal = null;
    G.passive = null;
    G.swap = null;
    G.busy = false;
    G.beast = null;
    G.flung = null;
  }

  async function loadLevel(index, opts) {
    if (index === LEVELS.length) return loadTerrace();
    const level = levelAt(index);
    if (!level) return toTitle();
    const epoch = (G.epoch += 1);
    const backdrop = !!(opts && opts.backdrop);
    const carry = opts && opts.carry;
    if (G.terminal || G.passive) ui.closeTerminal();
    G.levelIndex = index;
    buildFloor(level);
    ui.setNote(null);
    if (!backdrop) setMode('loading');
    const res = await Q.loadLevel({ qubits: level.qubits.map((q) => ({ id: q.id, init: q.init })), prep: prepOps() });
    if (epoch !== G.epoch) return false;
    if (!res.ok) {
      setMode('error');
      ui.showError(`The quantum engine could not start this floor. ${res.error}`);
      return false;
    }
    const falls = carry && G.stats ? G.stats.falls : 0;
    G.stats = { gates: 0, looks: 0, unlucky: 0, denied: 0, chance: 0, falls };
    if (!carry) {
      G.lives = LIVES_PER_FLOOR;
      G.hints = 0;
    }
    if (!backdrop) ui.setAbout(false);
    panel.setLevel(level, isBonus(index) ? index - BONUS_FROM : index, isBonus(index) ? BONUS_LEVELS.length + 1 : LEVELS.length);
    panel.setHints(G.hints);
    applySnapshot(res.state);
    updateHud();
    if (backdrop) return true;
    ui.showScreen(null);
    setMode('play');
    if (carry === 'fall') {
      say(`You fell. The floor reset to its starting state. Lives left: ${G.infinite ? 'unlimited' : G.lives}.`, 'bad', true);
    } else if (carry === 'restart') {
      say('Floor restarted: platforms and circuit are back to their starting states.', 'info', true);
    } else {
      say(`${isBonus(index) ? level.tag : `Floor ${index + 1}`}: ${level.name}. ${level.goal}`, 'info');
    }
    if (level.beast) startBeast(!carry); // a restart (R) skips the intro; a fall does not reload at all (respawn)
    // The opening line is said every time the floor starts, restarts and falls included.
    for (const line of story().intro || []) remark(line, story().introHold);
    return true;
  }

  // `quiet`: a cavity's drive, every frame; the rack is then redrawn ten times a second.
  function applySnapshot(snap, quiet) {
    G.q = snap;
    for (const p of G.platforms) {
      const now = snap.definite[p.qi];
      p.p1 = snap.p1[p.qi];
      if (now === null) {
        if (p.state !== null) p.exposure = 0;
        p.state = null;
      } else {
        const slot = slotRect(p, now);
        if (p.state === null) {
          p.x = slot.x; // it materialises where it collapsed
          p.y = slot.y;
          p.flash = 1;
        }
        p.state = now;
        p.targetX = slot.x;
        p.targetY = slot.y;
      }
    }
    if (!quiet || snap.ops.length !== G.drawnOps || G.t - G.drawnAt > 0.1) {
      panel.render(snap);
      G.drawnOps = snap.ops.length;
      G.drawnAt = G.t;
    }
    if (!quiet) measureUnderfoot();
  }

  // A gate (H, say) that leaves the platform you are standing on in superposition: your touch
  // measures it at once. A gate is taken as instantaneous, so there is no watched evolution to
  // freeze (unlike a cavity's steady drive, which a watched platform does not feel at all): it
  // simply collapses, 50/50 for an H, and if it goes to the other position you fall.
  function measureUnderfoot() {
    const p = G.player.standing;
    if (!p || p.state !== null || p.pending || !G.dev.touchCollapse || !['play', 'terminal', 'cutscene'].includes(G.mode)) return;
    const before = G.q;
    const res = Q.measure([p.qi], true, 'touch');
    if (!res.ok) return;
    G.touchUnderfoot = true;
    applySnapshot(res.state);
    reportCollapse(before, res.state, res.measured);
    G.touchUnderfoot = false;
  }

  function enterRoom(portal) {
    const index = G.rooms.findIndex((r) => r.id === portal.to);
    if (index < 0) return;
    G.roomIndex = index;
    G.room = G.rooms[index];
    closePassive();
    placePlayer(portal.arrive.x, portal.arrive.y);
    G.fx = [];
    G.floaters = [];
    G.bubbles = [];
    audio.play('click');
    say(`You step through the door into ${G.room.name}.`, 'info');
  }

  // -- terminals: gates ---------------------------------------------------

  function useTerminal(term) {
    if (term.port && !carrying()) {
      say(
        term.box
          ? 'The box has a canister port and nothing else. Bring the canister.'
          : `${term.id} is a dead terminal. Only its canister port works: bring the canister.`,
        'info',
        true
      );
      return;
    }
    G.terminal = term;
    setMode('terminal');
    ui.openTerminal(term, carrying(), { numbers: G.dev.passiveTerminal });
    audio.play('click');
    ui.announce(`${term.id} open. ${term.ops.length} gate${term.ops.length === 1 ? '' : 's'} available.`);
  }

  function closeTerminal() {
    if (!G.terminal) return;
    G.terminal = null;
    ui.closeTerminal();
    setMode('play');
  }

  // Developer option: standing at a terminal shows its gates, and 1 to 9 apply them,
  // without entering the terminal (so the player can still move and look).
  function updatePassive(hit) {
    // Quick terminals (bonus level 7) always show their gate this way, with its number key.
    const near = hit && hit.type === 'terminal' ? hit.obj : null;
    const term = near && (near.quick || (G.dev.passiveTerminal && !(near.port && !carrying()))) ? near : null;
    if (!hit && G.passive && !G.player.onGround) return; // a hop at the terminal keeps it open
    if (term === G.passive && (!term || G.passiveCarrying === carrying())) return;
    closePassive();
    if (!term) return;
    G.passive = term;
    G.passiveCarrying = carrying();
    ui.openTerminal(term, carrying(), { passive: true });
  }

  function closePassive() {
    if (!G.passive) return;
    G.passive = null;
    ui.closeTerminal();
  }

  // Developer option (show gates), in order:
  //   1. the key is pressed: a switch sound, and a ball is thrown from the terminal to
  //      where the gate will appear (the middle of a platform's state), and to the
  //      canister too when a two-qubit gate involves it;
  //   2. the ball lands: the gate pops up over its qubits, with its sound, and the new
  //      state is shown at once; the gate stays its full second, then pops out.
  // Resolves at step 2, as the gate appears.
  const SPARK_SECONDS = 0.45;
  const GATE_SECONDS = 1;
  const COLOR_OF = (gate) => (gate === 'cx' || gate === 'cz' ? '#ff8adf' : gate === 'swap' ? '#e6edf7' : '#5ee6ff');

  function untilFx(fx, part, epoch) {
    return new Promise((resolve) => {
      const wait = () => (fx.t >= fx.dur * part || epoch !== G.epoch || !G.fx.includes(fx) ? resolve() : requestAnimationFrame(wait));
      wait();
    });
  }

  async function throwGate(term, gate, qis, pop, epoch) {
    audio.play('switch');
    const from = center(screenRect(term));
    const target = qis[qis.length - 1];
    const aims = [target];
    if (qis.length === 2 && G.canister && qis.includes(G.canister.qi) && G.canister.qi !== target) aims.push(G.canister.qi);
    let lead = null;
    for (const qi of aims) {
      const to = renderer.gateAnchor(G, qi);
      if (!to) continue;
      const spark = { type: 'spark', from, to, t: 0, dur: SPARK_SECONDS, color: COLOR_OF(gate) };
      G.fx.push(spark);
      lead = lead || spark;
    }
    if (lead) await untilFx(lead, 1, epoch);
    if (epoch !== G.epoch) return;
    G.fx.push({ type: 'gate', parts: gateParts(gate, qis), tileQis: tileItems().map((it) => it.qi), t: 0, dur: GATE_SECONDS });
    audio.play(pop);
  }

  function gateParts(gate, qis) {
    if (gate === 'cx') return [{ qi: qis[0], role: 'ctrl', gate }, { qi: qis[1], role: 'targ', gate }];
    if (gate === 'cz') return [{ qi: qis[0], role: 'ctrl', gate }, { qi: qis[1], role: 'ctrl', gate }];
    if (gate === 'swap') return [{ qi: qis[0], role: 'swap', gate }, { qi: qis[1], role: 'swap', gate }];
    return [{ qi: qis[0], role: 'box', gate, symbol: GATE_INFO[gate].symbol }];
  }

  // Broken terminals: stuck in a loop, applying their gates one after another, one every
  // `every` seconds, whatever anyone does, and nobody can use them. A spark leaves the
  // screen just before each gate so that it lands as the gate takes effect.
  const BROKEN_SPARK = 0.3;
  function updateBroken(dt) {
    const room = G.room;
    if (!room || !G.q) return;
    for (const t of room.terminals) {
      const b = t.broken;
      if (!b) continue;
      t.clock += dt;
      const op = b.ops[t.step];
      if (!t.thrown && t.clock >= b.every - BROKEN_SPARK) {
        t.thrown = true;
        const to = renderer.gateAnchor(G, op.qi[op.qi.length - 1]);
        if (to) G.fx.push({ type: 'spark', from: center(screenRect(t)), to, t: 0, dur: BROKEN_SPARK, color: COLOR_OF(op.gate) });
      }
      if (t.clock < b.every) continue;
      t.clock -= b.every;
      t.thrown = false;
      t.step = (t.step + 1) % b.ops.length;
      const res = Q.auto([{ gate: op.gate, qubits: op.qi, angle: op.angle }]);
      if (!res.ok) continue;
      applySnapshot(res.state);
      if (G.dev.showGates) G.fx.push({ type: 'gate', parts: gateParts(op.gate, op.qi), tileQis: tileItems().map((it) => it.qi), t: 0, dur: Math.min(GATE_SECONDS, b.every * 0.8) });
    }
  }

  // How a gate reads in a sentence: "H on A", "CNOT on A and B", "RY(pi/2) on P".
  function opWords(op) {
    const turns = op.angle / Math.PI;
    const angle = Math.abs(turns - 0.5) < 1e-9 ? '\u03c0/2' : Math.abs(turns - 1) < 1e-9 ? '\u03c0' : Number(op.angle).toFixed(2);
    return `${GATE_INFO[op.gate].symbol}${op.gate === 'ry' ? `(${angle})` : ''} on ${list(op.q)}`;
  }

  async function machineMeasure(term, op) {
    const epoch = G.epoch;
    const before = G.q;
    G.busy = true;
    ui.setTerminalBusy(true, carrying());
    const res = await Q.measure(op.qi, true, 'machine');
    G.busy = false;
    if (epoch !== G.epoch) return;
    ui.setTerminalBusy(false, carrying());
    if (!res.ok) {
      ui.setTerminalStatus(`The measurement failed. ${res.error}`, 'bad');
      return;
    }
    applySnapshot(res.state);
    reportCollapse(before, res.state, res.measured);
    const results = {};
    op.q.forEach((id, i) => {
      results[id] = res.state.definite[op.qi[i]];
    });
    const text = `The machine measured ${list(op.q.map((id) => `${id} = ${results[id]}`))}. Those are ordinary bits now.`;
    audio.play('collapse1');
    say(text, 'quantum');
    ui.setTerminalStatus(text, 'quantum');
    if (story().onMachine) story().onMachine(storyCtx(null), results);
  }

  // Whether qubit qi's latest operations are exactly `seq.gates` (the floor's own gates count
  // too), leaving it certain; `seq.value`: certain in that state; `seq.untouched`: with
  // nothing measured or reset anywhere since the sequence began.
  function endsWith(snap, qi, seq) {
    const gates = seq.gates;
    const mine = snap.ops.map((op, at) => ({ op, at })).filter(({ op }) => op.qubits.includes(qi)).slice(-gates.length);
    if (mine.length !== gates.length || snap.definite[qi] === null) return false;
    if (seq.value !== undefined && snap.definite[qi] !== seq.value) return false;
    if (!mine.every(({ op }, i) => (op.kind === 'gate' || op.kind === 'auto') && op.gate === gates[i])) return false;
    return !seq.untouched || !snap.ops.slice(mine[0].at).some((op) => op.kind === 'measure' || op.kind === 'reset');
  }

  function checkBonus(snap, target) {
    const bonus = G.level.bonus;
    if (bonus && bonus.sequences && bonus.sequences.some((s) => target === G.qIndex[s.q] && endsWith(snap, target, s))) G.bonusDone = true;
  }

  // SWAP between two platforms: after the swap delay (arrows show where each will go, so
  // the player can jump on or off), the states are exchanged and the two platforms trade
  // places, each carrying its old state to the other's place: the platform setting off
  // for R's place now shows R's qubit, which holds what was Q's. The other gates wait.
  const SWAP_SPEED = 260;

  // A swap's countdown: a tick for each new number.
  function countDown(dt) {
    const sw = G.swap;
    if (!sw) return;
    if (sw.go > 0) sw.go -= dt;
    if (sw.travel) return;
    sw.wait -= dt;
    const count = Math.max(1, Math.ceil(sw.wait - 1e-9));
    if (count < sw.count && sw.wait > 0) audio.play('tick');
    sw.count = count;
  }
  async function swapPlatforms(term, op) {
    const epoch = G.epoch;
    const [pa, pb] = op.qi.map((qi) => G.platforms.find((p) => p.qi === qi));
    G.busy = true;
    ui.setTerminalBusy(true, carrying());
    audio.play('switch');
    // A countdown, one number a second (3, 2, 1, SWAP! by default), set by the swap delay.
    // A swap op can set its own delay; 0 sends the platforms off at once.
    const delay = Number.isFinite(op.delay) ? op.delay : G.dev.swapDelay;
    G.swap = { a: pa, b: pb, wait: delay, delay, count: delay, go: 0 };
    if (delay > 0) {
      audio.play('tick');
      say(`SWAP ${pa.q} and ${pb.q}: the platforms trade places in ${delay}.`, 'info');
    }
    await new Promise((resolve) => {
      const tick = () => (epoch !== G.epoch || G.swap.wait <= 0 ? resolve() : requestAnimationFrame(tick));
      tick();
    });
    if (epoch !== G.epoch) return;
    const before = G.q;
    const res = await Q.apply('swap', op.qi);
    if (!res.ok) {
      G.swap = null;
      G.busy = false;
      ui.setTerminalBusy(false, carrying());
      ui.setTerminalStatus(`That gate did not go through. ${res.error}`, 'bad');
      return;
    }
    G.swap.go = delay > 0 ? 0.7 : 0; // SWAP! on screen as they set off, after a countdown
    if (delay > 0) audio.play('tickGo');
    if (G.dev.showGates) await throwGate(term, 'swap', op.qi, 'gate', epoch);
    else audio.play('gate');
    if (epoch !== G.epoch) return;
    // Each platform takes on the other's qubit and place, and sets off.
    for (const key of ['qi', 'q', 'need', 'y0', 'y1']) [pa[key], pb[key]] = [pb[key], pa[key]];
    [pa.placeX, pb.placeX] = [pb.placeX, pa.placeX];
    G.swap.travel = true;
    G.stats.gates += 1;
    applySnapshot(res.state);
    checkBonus(res.state, op.qi[0]);
    const words = (qi) => stateSentence(res.state, qi);
    say(`SWAP: ${before.labels[op.qi[0]]} and ${before.labels[op.qi[1]]} traded states, and their platforms trade places. ${words(op.qi[0])} ${words(op.qi[1])}`, 'quantum');
    await new Promise((resolve) => {
      const tick = () => (epoch !== G.epoch || (pa.x === pa.placeX && pb.x === pb.placeX) ? resolve() : requestAnimationFrame(tick));
      tick();
    });
    if (epoch !== G.epoch) return;
    G.swap = null;
    G.busy = false;
    ui.setTerminalBusy(false, carrying());
  }

  async function applyOp(i) {
    const term = G.terminal || G.passive;
    if (term && term.quick) {
      if (term.ops[i]) quickTerminal(term);
      return;
    }
    if (!term || G.busy || !term.ops[i]) return;
    const op = term.ops[i];
    if (op.needsCanister && !carrying()) {
      ui.setTerminalStatus('That gate acts on the canister qubit. Bring the canister here first.', 'bad');
      return;
    }
    if (op.gate === 'measure') {
      await machineMeasure(term, op);
      return;
    }
    if (op.gate === 'swap' && G.platforms.filter((p) => op.qi.includes(p.qi)).length === 2) {
      await swapPlatforms(term, op);
      return;
    }
    const qis = op.qi;
    const target = qis[qis.length - 1];
    const epoch = G.epoch;
    const before = G.q;
    G.busy = true;
    ui.setTerminalBusy(true, carrying());
    const res = await Q.apply(op.gate, qis, op.angle);
    const wasDefinite = before.definite[target] !== null;
    const nowDefinite = res.ok && res.state.definite[target] !== null;
    const pop = wasDefinite && !nowDefinite ? 'superpose' : 'gate';
    if (res.ok && G.dev.showGates) await throwGate(term, op.gate, qis, pop, epoch);
    G.busy = false;
    if (epoch !== G.epoch) return;
    ui.setTerminalBusy(false, carrying());
    if (!res.ok) {
      ui.setTerminalStatus(`That gate did not go through. ${res.error}`, 'bad');
      return;
    }
    G.stats.gates += 1;
    applySnapshot(res.state);
    checkBonus(res.state, target);

    if (!G.dev.showGates) {
      const to = renderer.anchorOf(G, target);
      if (to) G.fx.push({ type: 'spark', from: center(screenRect(term)), to, t: 0, dur: SPARK_SECONDS, color: COLOR_OF(op.gate) });
      audio.play(pop);
    }

    const info = GATE_INFO[op.gate];
    const what = op.gate === 'cx' ? `CNOT ${op.q[0]} to ${op.q[1]}` : op.gate === 'cz' ? `CZ on ${op.q[0]} and ${op.q[1]}` : `${info.symbol} on ${op.q[0]}`;
    let text = `${what}. ${stateSentence(res.state, target)}`;
    if (op.gate === 'z' && !nowDefinite) text = `${what}. The odds did not move, but the phase flipped. ${stateSentence(res.state, target)}`;
    if (op.gate === 'cx' && wasDefinite && nowDefinite && before.definite[target] === res.state.definite[target]) {
      text = `${what}. ${op.q[0]} is in state 0, so nothing flipped. ${stateSentence(res.state, target)}`;
    }
    say(text, nowDefinite ? 'info' : 'quantum');
    ui.setTerminalStatus(text, nowDefinite ? '' : 'quantum');
  }

  // -- measurement: flashlight and locks ---------------------------------------

  function reportCollapse(before, snap, measured) {
    const seen = new Set(measured.map((e) => e.qubit));
    for (const e of measured) {
      if (!e.random) continue;
      G.stats.chance += 1; // an outcome left to chance (see the "no luck" star)
      if (e.by === 'torch') G.stats.looks += 1;
      const platform = G.platforms.find((p) => p.qi === e.qubit);
      const pt = renderer.anchorOf(G, e.qubit);
      addRing(pt, '#ffd98a', 52);
      addFloater(pt, `${e.label} → ${e.result}`, e.result ? '#ffd98a' : '#8fb3ff');
      audio.play(e.result ? 'collapse1' : 'collapse0');
      G.shake = 0.5;
      if (platform && platform.need !== e.result) G.stats.unlucky += 1;
      const value = valueWords(e.qubit, e.result);
      let text = `${e.label} was measured: it collapsed to ${value}.`;
      if (e.by === 'torch') text = `Flashlight on ${e.label}: it collapsed to ${value}.`;
      if (e.by === 'lock') text = `The lock observed ${e.label}: it collapsed to ${value}.`;
      if (e.by === 'touch') text = G.touchUnderfoot ? `${e.label} went into superposition under your feet, and your touch measured it: it collapsed to ${value}.` : `You landed on ${e.label} without looking: it collapsed to ${value}.`;
      if (e.by === 'light') text = `The backup light observed ${e.label}: it collapsed to ${value}.`;
      const partners = [];
      for (let q = 0; q < snap.definite.length; q += 1) {
        if (!seen.has(q) && before.definite[q] === null && snap.definite[q] !== null) {
          partners.push(q);
          seen.add(q);
          addRing(renderer.anchorOf(G, q), '#ff8adf', 40);
          addFloater(renderer.anchorOf(G, q), `${snap.labels[q]} → ${snap.definite[q]}`, '#ff8adf');
        }
      }
      if (partners.length) {
        text += ` Entangled partner${partners.length > 1 ? 's' : ''} collapsed with it: ${list(partners.map((q) => `${snap.labels[q]} = ${snap.definite[q]}`))}.`;
      }
      say(text, 'quantum');
    }
  }

  async function observe(platforms, by) {
    const epoch = G.epoch;
    const before = G.q;
    for (const p of platforms) p.pending = true;
    const res = await Q.measure(platforms.map((p) => p.qi), false, by);
    if (epoch !== G.epoch) return;
    for (const p of platforms) {
      p.pending = false;
      p.exposure = 0;
    }
    if (!res.ok) {
      ui.toast(`The measurement failed. ${res.error}`, 'bad');
      return;
    }
    applySnapshot(res.state);
    reportCollapse(before, res.state, res.measured);
  }

  function updateTorch(dt) {
    const pl = G.player;
    const t = G.torch;
    const dead = t.battery === 'dead';
    const keyTorch = G.dev.keyTorch; // hold F to shine; I / K tilt it; the mouse does not aim
    if (input.pointer.moved) {
      t.useMouse = !keyTorch;
      input.pointer.moved = false;
    }
    if (G.mode === 'play' && keyTorch) {
      t.useMouse = false;
      if (input.take('torch') && dead && story().onDeadTorch) story().onDeadTorch(storyCtx(null));
      const tilt = (input.held.tiltUp ? 1 : 0) - (input.held.tiltDown ? 1 : 0);
      if (tilt) t.tilt = Math.max(-1.35, Math.min(1.35, t.tilt + tilt * 1.2 * dt));
      t.angle = pl.facing > 0 ? -t.tilt : Math.PI + t.tilt;
    } else if (G.mode === 'play') {
      const tilt = (input.held.tiltUp ? 1 : 0) - (input.held.tiltDown ? 1 : 0);
      if (tilt) {
        t.useMouse = false;
        t.tilt = Math.max(-1.35, Math.min(1.35, t.tilt + tilt * 1.2 * dt));
      }
      if (input.take('torch')) {
        if (dead) {
          if (story().onDeadTorch) story().onDeadTorch(storyCtx(null));
        } else {
          t.on = !t.on;
          audio.play('click');
          ui.announce(t.on ? 'Flashlight on.' : 'Flashlight off.');
        }
      }
      if (t.useMouse) {
        const hand = handOf(pl);
        const dx = input.pointer.x - hand.x;
        const dy = input.pointer.y - hand.y;
        if (Math.hypot(dx, dy) > 6) {
          if (Math.abs(dx) > 8) pl.facing = dx >= 0 ? 1 : -1;
          t.angle = Math.atan2(dy, dx);
        }
      } else {
        t.angle = pl.facing > 0 ? -t.tilt : Math.PI + t.tilt;
      }
    }
    let blink = false;
    if (t.battery === 'low' && G.mode === 'play') {
      t.flickT -= dt;
      if (t.flickT <= 0) {
        t.flickLeft = 0.8;
        t.flickT = 2.6 + Math.random() * 3;
      }
      if (t.flickLeft > 0) {
        t.flickLeft -= dt;
        // About 2.4 blinks a second: under the 3 flashes a second that can trigger seizures (WCAG 2.3.1).
        blink = Math.sin(t.flickLeft * 15) > -0.1;
      }
    }
    t.lowered = G.mode !== 'play';
    t.active = (keyTorch ? !!input.held.torch : t.on) && !t.lowered && !dead && !blink;

    if (G.mode !== 'play' || !G.q) return;
    const hand = handOf(pl);
    const ready = [];
    for (const p of G.room.platforms) {
      if (p.state !== null || p.pending) {
        if (p.state !== null) p.exposure = 0;
        continue;
      }
      const lit = t.active && (rectLit(hand, t.angle, slotRect(p, 0), t.range) || rectLit(hand, t.angle, slotRect(p, 1), t.range));
      p.exposure = lit ? p.exposure + dt : 0;
      if (p.exposure >= TORCH.dwell) ready.push(p);
    }
    if (ready.length) observe(ready, 'torch');
  }

  // -- the exit -----------------------------------------------------------------

  async function tryDoor() {
    const d = G.door;
    const epoch = G.epoch;
    if (d.pending || d.unlocked) return;
    d.pending = true;
    let snap = G.q;
    const bitsOf = (s) => d.lockQi.map((q) => (s.definite[q] === null ? '?' : s.definite[q])).join('');
    if (d.check || bitsOf(snap).includes('?') || bitsOf(snap) !== d.lastRead) {
      if (d.check) {
        const res = await Q.auto(d.check.map((op) => ({ gate: op.gate, qubits: op.q.map((id) => G.qIndex[id]) })));
        if (epoch !== G.epoch) return;
        if (res.ok) applySnapshot(res.state);
      }
      const before = G.q;
      const res = await Q.measure(d.lockQi, true, 'lock');
      if (epoch !== G.epoch) return;
      if (!res.ok) {
        d.pending = false;
        ui.toast(`The lock could not be read. ${res.error}`, 'bad');
        return;
      }
      applySnapshot(res.state);
      reportCollapse(before, res.state, res.measured);
      snap = res.state;
    }
    const bits = bitsOf(snap);
    const spaced = (s) => s.split('').join(' ');
    d.lastRead = bits;
    if (bits === d.key) {
      d.unlocked = true;
      d.open = true;
      audio.play('unlock');
      addRing(center(lockRect(d)), '#7dffa8', 60);
      say(`The lock read ${spaced(bits)}. Key accepted: the exit is open.`, 'good', true);
    } else {
      G.stats.denied += 1;
      d.deniedT = 1.2;
      audio.play('denied');
      if (d.reprep) {
        say(`The lock read ${spaced(bits)} but needs ${spaced(d.key)}. Refused, and the key was used up. A fresh one is being prepared: the whole transfer has to be done again.`, 'bad', true);
        if (story().onRefused) story().onRefused(storyCtx(null));
        await reprepare(null);
        if (epoch !== G.epoch) return;
        d.lastRead = null;
      } else {
        const ones = d.lockQi.filter((q) => snap.definite[q] === 1);
        say(`The lock read ${spaced(bits)} but the key is ${spaced(d.key)}. Refused${ones.length ? ', and the lamps were reset to state 0' : ''}.`, 'bad', true);
        if (ones.length) {
          const res = await Q.reset(ones);
          if (epoch !== G.epoch) return;
          if (res.ok) {
            applySnapshot(res.state);
            d.lastRead = bitsOf(res.state);
          }
        }
      }
    }
    d.pending = false;
  }

  // With the passive terminal developer option, an exit opens by itself as soon as
  // every lamp is certain and matches the key: reading certain lamps changes
  // nothing, so no measurement is needed. A lock that runs its own gates before
  // reading (floor 6) still has to be tried, since those gates are part of the test.
  function autoOpen(d) {
    if (!d.key || d.unlocked || d.pending || d.check || !G.q) return;
    const bits = d.lockQi.map((q) => (G.q.definite[q] === null ? '?' : G.q.definite[q])).join('');
    if (bits !== d.key) return;
    d.unlocked = true;
    d.open = true;
    d.lastRead = bits;
    audio.play('unlock');
    addRing(center(lockRect(d)), '#7dffa8', 60);
    say(`The lamps show ${bits.split('').join(' ')}, which matches the key: the exit opens by itself.`, 'good', true);
  }

  function updateDoor(dt) {
    const d = G.room.door;
    if (!d) return;
    const pl = G.player;
    if (d.deniedT > 0) d.deniedT -= dt;
    if (G.dev.passiveTerminal) autoOpen(d);
    if (d.key && !d.unlocked && !d.byHand) {
      const lit = G.torch.active && rectLit(handOf(pl), G.torch.angle, lockRect(d), G.torch.range);
      if (!lit) {
        d.exposure = 0;
        d.armed = true;
      } else if (d.armed && !d.pending) {
        d.exposure += dt;
        if (d.exposure >= TORCH.dwell) {
          d.armed = false;
          d.exposure = 0;
          tryDoor();
        }
      }
    }
    if (d.open && pl.onGround && overlap({ x: pl.x, y: pl.y, w: PLAYER.w, h: PLAYER.h }, doorRect(d))) completeFloor();
  }

  // -- things in reach --------------------------------------------------------------

  function findInteract() {
    const pl = G.player;
    const room = G.room;
    for (const t of room.terminals) t.near = false;
    for (const n of room.npcs) n.near = false;
    for (const p of room.portals) p.near = false;
    if (room.door) room.door.near = false;
    if (!pl.onGround) return null;
    const cx = pl.x + PLAYER.w / 2;
    const feet = pl.y + PLAYER.h;
    let best = null;
    const offer = (type, obj, x, y, reach) => {
      if (Math.abs(feet - y) > 6) return;
      const d = Math.abs(cx - x);
      if (d < reach && (!best || d < best.d)) best = { type, obj, d };
    };
    for (const t of room.terminals) if (!t.broken && !(t.wreck > 0) && !t.used) offer(t.box && G.flags.opened ? 'cat' : 'terminal', t, t.x, t.y, 26); // nobody can use a broken one
    for (const n of room.npcs) offer('npc', n, n.x, n.y, 34);
    for (const p of room.portals) offer('portal', p, p.x, p.y, 22);
    const d = room.door;
    if (d && d.key && !d.unlocked) {
      const left = lockRect(d).x;
      const right = d.x + 22;
      offer('lock', d, (left + right) / 2, d.y, (right - left) / 2 + 8);
    }
    if (best) best.obj.near = true;
    return best;
  }

  function pickUps() {
    const pl = G.player;
    const cx = pl.x + PLAYER.w / 2;
    const feet = pl.y + PLAYER.h;
    const c = G.canister;
    if (c && !c.carried && c.roomId === G.room.id && Math.abs(cx - c.x) < 16 && Math.abs(feet - c.y) < 8) {
      c.carried = true;
      audio.play('gate');
      say(`You picked up the canister. It holds the sealed qubit ${c.q}.`, 'info', LONG_TOAST);
      if (story().onCanister) story().onCanister(storyCtx(null));
    }
    const b = G.room.battery;
    if (!b || b.taken) return;
    if (b.diesOnArrival && G.torch.battery === 'low' && pl.onGround && Math.abs(feet - b.y) < 2) {
      G.torch.battery = 'dead';
      audio.play('denied');
      updateHud();
      panel.log('Your flashlight has died.', 'bad');
      if (story().onBatteryDead) story().onBatteryDead(storyCtx(null));
    }
    if (Math.abs(cx - b.x) < 18 && Math.abs(feet - b.y) < 8) {
      b.taken = true;
      G.torch.battery = 'ok';
      G.torch.range = b.range || TORCH.range; // a spare battery can be a weak one
      G.torch.on = true;
      audio.play('unlock');
      say(b.range ? 'Spare battery fitted. It is a weak one: the beam only reaches a short way.' : 'New battery fitted. The flashlight is steady again.', 'good', LONG_TOAST);
      updateHud();
      if (story().onBattery) story().onBattery(storyCtx(null));
    }
  }

  function petCat() {
    const at = anchorNamed('box');
    if (!at) return;
    audio.play('meow');
    G.bubbles = G.bubbles.filter((b) => !b.cat);
    G.bubbles.push({ anchor: at, text: '*meow*', cat: true, t: 0, dur: 1.8 });
    panel.log('You pet the cat. Meow.', 'info');
    ui.announce('Meow.');
  }

  // -- platformer physics -----------------------------------------------------

  function slabs() {
    const out = [];
    for (const s of G.room.solids) if (s.kind === 'stand') out.push(s);
    for (const p of G.room.platforms) if (p.state !== null) out.push({ x: p.x, y: p.y, w: p.w, h: PLATFORM_H, platform: p });
    return out;
  }

  // Certain platforms glide to the slot their state says, carrying the player; a platform
  // in a swap travels to its new place whatever its state.
  function movePlatforms(dt) {
    const pl = G.player;
    for (const p of G.platforms) {
      const bx = p.x;
      const by = p.y;
      if (p.axis !== 'x' && p.x !== p.placeX) {
        p.x += Math.sign(p.placeX - p.x) * Math.min(Math.abs(p.placeX - p.x), SWAP_SPEED * dt);
        if (p.state !== null) p.targetX = p.x;
      } else if (p.state !== null && p.axis === 'x') p.x += Math.sign(p.targetX - p.x) * Math.min(Math.abs(p.targetX - p.x), (p.speed || 240) * dt);
      if (p.state !== null) p.y += Math.sign(p.targetY - p.y) * Math.min(Math.abs(p.targetY - p.y), 300 * dt);
      if (pl.standing === p) {
        pl.x += p.x - bx;
        pl.y += p.y - by;
      }
    }
  }

  // Backup lights: each traces its lit area around the shadows of solids and certain
  // platforms, and measures (or, for an emergency light, damps to 0) a platform it
  // rests on for long enough. The flashlight's rule, without the player.
  const certainRects = (room) => room.platforms.filter((p) => p.state !== null).map((p) => ({ p, r: { x: p.x, y: p.y, w: p.w, h: PLATFORM_H } }));

  // Every frame, in any mode: the lit area of each light, for drawing and for updateLights.
  function traceLights() {
    const room = G.room;
    if (!room || !room.lights || !room.lights.length) return;
    const blockers = [...room.solids, ...certainRects(room).map((c) => c.r)];
    for (const light of room.lights) light.poly = lightPolygon(light, blockers);
  }

  function updateLights(dt) {
    const room = G.room;
    if (!room.lights.length || !G.q) return;
    const solids = room.solids;
    const certain = certainRects(room);
    for (const p of room.platforms) {
      if (p.pending) continue;
      // What a light acts on: a superposed platform, and for an emergency light anything not certainly 0.
      let kind = null;
      for (const light of room.lights) {
        const acts = light.kind === 'emergency' ? p.state !== 0 : p.state === null;
        if (!acts) continue;
        // A certain platform does not shade itself.
        const own = p.state === null ? light.poly : lightPolygon(light, [...solids, ...certain.filter((c) => c.p !== p).map((c) => c.r)]);
        const seen = p.state === null ? rectInLight(slotRect(p, 0), own) || rectInLight(slotRect(p, 1), own) : rectInLight({ x: p.x, y: p.y, w: p.w, h: PLATFORM_H }, own);
        if (seen && (!kind || LIGHT_KINDS[light.kind].dwell < LIGHT_KINDS[kind].dwell || light.kind === 'emergency')) kind = light.kind;
      }
      if (!kind) {
        p.lightExposure = 0;
        p.lightKind = null;
        continue;
      }
      if (kind !== p.lightKind) p.lightExposure = 0;
      p.lightKind = kind;
      p.lightExposure += dt;
      if (p.lightExposure >= LIGHT_KINDS[kind].dwell) {
        p.lightExposure = 0;
        if (kind === 'emergency') dampToZero(p);
        else observe([p], 'light');
      }
    }
  }

  // Whether anything is watching a platform: the flashlight or a backup light on it, or
  // the player standing on it. Watched, a driven platform does not evolve (the quantum
  // watchdog, or Zeno, effect): it holds where it is, and a measurement collapses it.
  function watched(p) {
    if (G.player.standing === p) return true;
    const rects = p.state === null ? [slotRect(p, 0), slotRect(p, 1)] : [{ x: p.x, y: p.y, w: p.w, h: PLATFORM_H }];
    const t = G.torch;
    if (t.active && rects.some((r) => rectLit(handOf(G.player), t.angle, r, t.range))) return true;
    return G.room.lights.some((light) => light.poly && rects.some((r) => rectInLight(r, light.poly)));
  }

  // Cavities: the waves rotate every platform they reach (Ry, a Rabi oscillation),
  // 0 to + to 1 to - and round again, unless something is watching it. Blocked waves
  // drive nothing beyond the blocker.
  // A cleared cavity takes this long to fill with waves again before it drives anything.
  const CAVITY_LOAD = 0.45;
  function updateCavities(dt) {
    const room = G.room;
    if (!room || !room.cavities.length || !G.q) return;
    // Only solids and steady platforms (shields) block, and only across the whole band.
    const blockers = [...room.solids, ...certainRects(room).filter((c) => c.p.steady).map((c) => c.r)];
    for (const c of room.cavities) {
      c.blocked = cavityBlocked(c, blockers);
      c.load = c.blocked ? 0 : Math.min(1, c.load + dt / CAVITY_LOAD);
    }
    const pairs = [];
    for (const p of room.platforms) {
      p.driven = false;
      if (p.pending || p.steady) continue;
      const rects = p.state === null ? [slotRect(p, 0), slotRect(p, 1)] : [{ x: p.x, y: p.y, w: p.w, h: PLATFORM_H }];
      const cavity = room.cavities.find((c) => c.load >= 1 && rects.some((r) => cavityHolds(c, r)));
      if (!cavity) continue;
      if (watched(p)) {
        p.driven = 'held';
        continue;
      }
      p.driven = true;
      pairs.push([p.qi, cavity.rate * dt]);
    }
    if (!pairs.length) return;
    const res = Q.drive(pairs);
    if (res.ok) applySnapshot(res.state, true);
  }

  // An emergency light: amplitude damping, all the way, so the qubit ends in |0>.
  async function dampToZero(p) {
    const epoch = G.epoch;
    const before = G.q;
    p.pending = true;
    const res = await Q.reset([p.qi], 'emergency');
    if (epoch !== G.epoch) return;
    p.pending = false;
    if (!res.ok) return;
    applySnapshot(res.state);
    const pt = renderer.anchorOf(G, p.qi);
    addRing(pt, '#ff6b6b', 52);
    addFloater(pt, `${p.q} → 0`, '#ff8585');
    audio.play('collapse0');
    const partners = res.state.definite.map((d, q) => (q !== p.qi && before.definite[q] === null && d !== null ? `${res.state.labels[q]} = ${d}` : null)).filter(Boolean);
    say(`The emergency light damped ${p.q} to ${valueWords(p.qi, 0)}.${partners.length ? ` Entangled partner${partners.length > 1 ? 's' : ''} settled with it: ${list(partners)}.` : ''}`, 'quantum');
  }

  function physicsStep(dt) {
    const pl = G.player;
    movePlatforms(dt);
    const want = G.mode === 'play' ? (input.held.right ? 1 : 0) - (input.held.left ? 1 : 0) : 0;
    const targetV = want * PHYS.speed;
    const dv = targetV - pl.vx;
    pl.vx += Math.sign(dv) * Math.min(Math.abs(dv), PHYS.accel * dt);
    if (want && !G.torch.useMouse) pl.facing = want;
    if (Math.abs(pl.vx) > 5) pl.anim += dt;

    pl.coyote = pl.onGround ? PHYS.coyote : pl.coyote - dt;
    pl.buffer -= dt;
    if (G.mode === 'play' && input.take('jump')) pl.buffer = PHYS.buffer;
    if (pl.buffer > 0 && pl.coyote > 0) {
      pl.vy = -PHYS.jump;
      pl.buffer = 0;
      pl.coyote = 0;
      pl.onGround = false;
      pl.standing = null;
      audio.play('jump');
    }
    pl.vy = Math.min(PHYS.maxFall, pl.vy + PHYS.gravity * dt);

    pl.x += pl.vx * dt;
    for (const s of G.room.solids) {
      if (s.kind !== 'ground') continue;
      if (overlap({ x: pl.x, y: pl.y, w: PLAYER.w, h: PLAYER.h - 1 }, s)) {
        pl.x = pl.vx > 0 ? s.x - PLAYER.w : s.x + s.w;
        pl.vx = 0;
      }
    }
    const fenced = G.level.outdoor || (G.beast && G.beast.phase === 'intro');
    pl.x = Math.max(0, Math.min((fenced ? CRANK_X + PLAYER.w / 2 : WORLD.w) - PLAYER.w, pl.x));

    const feetBefore = pl.y + PLAYER.h;
    const wasOnGround = pl.onGround;
    const wasOn = pl.standing; // where two platforms cross (a SWAP), stay on the one you were on
    pl.y += pl.vy * dt;
    pl.onGround = false;
    pl.standing = null;
    for (const s of G.room.solids) {
      if (s.kind !== 'ground') continue;
      if (overlap({ x: pl.x, y: pl.y, w: PLAYER.w, h: PLAYER.h }, s)) {
        if (pl.vy >= 0 && feetBefore <= s.y + 2) {
          pl.y = s.y - PLAYER.h;
          pl.onGround = true;
          pl.vy = 0;
        } else if (pl.vy < 0) {
          pl.y = s.y + s.h;
          pl.vy = 0;
        }
      }
    }
    if (pl.vy >= 0 && !pl.onGround && G.dev.touchCollapse && G.mode === 'play') {
      touchCollapse(feetBefore, pl.y + PLAYER.h);
    }
    if (pl.vy >= 0 && !pl.onGround) {
      const feet = pl.y + PLAYER.h;
      const under = slabs().sort((a, b) => (b.platform === wasOn && wasOn ? 1 : 0) - (a.platform === wasOn && wasOn ? 1 : 0));
      for (const s of under) {
        if (pl.x + PLAYER.w > s.x && pl.x < s.x + s.w && feetBefore <= s.y + 2 && feet >= s.y) {
          pl.y = s.y - PLAYER.h;
          pl.vy = 0;
          pl.onGround = true;
          pl.standing = s.platform || null;
          break;
        }
      }
    }
    if (pl.onGround && !wasOnGround) audio.play('land');
  }

  // Developer option: coming down onto either outline of a superposed platform
  // measures it. It materialises at the height it collapsed to, so the player
  // lands only if that is the outline they touched (or one still below them).
  function touchCollapse(feetBefore, feet) {
    const pl = G.player;
    for (const p of G.room.platforms) {
      if (p.state !== null || p.pending) continue;
      const touched = [slotRect(p, 1), slotRect(p, 0)].some((r) => pl.x + PLAYER.w > r.x && pl.x < r.x + r.w && feetBefore <= r.y + 2 && feet >= r.y);
      if (!touched) continue;
      const before = G.q;
      const res = Q.measure([p.qi], false, 'touch');
      if (!res.ok) return;
      applySnapshot(res.state);
      reportCollapse(before, res.state, res.measured);
      return;
    }
  }

  function loseLife() {
    audio.play('fall');
    G.stats.falls += 1;
    if (!G.infinite) G.lives -= 1;
    G.player.visible = false;
    G.fallT = 0.7;
    updateHud();
    setMode('falling');
  }

  // Fallen (or flattened, on bonus level 7) with lives left: back at the room's start, with
  // every qubit exactly as it was (every gate applied so far still applied). Only running out
  // of lives, or Restart, puts the floor back to its starting states.
  function respawn() {
    const b = G.beast;
    const room = G.room;
    G.flung = null;
    if (G.terminal) closeTerminal();
    closePassive();
    placePlayer(room.spawn.x, room.spawn.y);
    G.player.facing = 1;
    if (b) {
      for (const paw of b.paws) {
        Object.assign(paw, { state: 'rest', t: 0, target: null, x: G.level.beast.head.x + paw.side * 175, y: PAW_REST_Y });
      }
      b.wait = 1.6;
      b.exposure = 0;
      b.showUntil = 0;
    }
    for (const p of G.platforms) p.exposure = 0;
    setMode('play');
    const lives = `Lives left: ${G.infinite ? 'unlimited' : G.lives}.`;
    if (b) {
      const qi = G.qIndex.CAT;
      const now = G.q.definite[qi] === 1 ? 'still a monster (1)' : `still ${Math.round((1 - G.q.p1[qi]) * 100)}% cute`;
      say(`Knocked off the roof, but the cat is just as you left it: ${now}. ${lives}`, 'bad', true);
    } else say(`You fell, but every qubit is just as you left it. ${lives}`, 'bad', true);
  }

  function afterFall() {
    if (G.lives > 0 || G.infinite) {
      respawn();
      return;
    }
    if (G.lives <= 0 && !G.infinite && isBonus(G.levelIndex)) {
      // A bonus level is not part of the climb: out of lives, it simply starts over.
      loadLevel(G.levelIndex);
      say('Out of lives: the bonus level starts over with three.', 'bad', true);
      return;
    }
    if (G.lives <= 0 && !G.infinite) {
      setMode('over');
      ui.showScreen('over');
      ui.announce('Out of lives. You start again from floor 1.');
    }
  }

  // -- bonus level 7: the beast on the roof -------------------------------------
  //
  // The cat is one qubit, CAT: 0 cute, 1 monster, starting at 1. Its head floats behind
  // the skyline, plain to see until the first attack, then hidden in a mist that only the
  // flashlight parts: lit, it shows as what it certainly is, monster or cute (a superposed
  // cat is measured first). Its paws take turns: rise, follow the player, stop (the
  // wind-up), drop straight down. A quick terminal turns the cat by RY(pi/8), and the cat answers by
  // smashing that terminal, which comes back after a while. The flashlight resting on
  // its face measures it: cute ends the fight, monster starts the count again.
  // Times in seconds, speeds in pixels a second. The wind-up (the warning) is not hurried.
  const PAW = { rise: 0.4, track: [1.3, 2.1], speed: 450, windup: 0.55, fall: 14600, down: 0.37, lift: 0.47, h: 46 };
  // The low swipe, three attacks in ten: down onto the roof at one end, a moment's warning,
  // then a sweep along the roof to the other end. Jump over it.
  const SWIPE = { chance: 0.3, settle: 0.4, windup: 0.6, speed: 600, ends: [30, 850] };
  const PAW_REST_Y = 266;
  const ease = (k) => k * k * (3 - 2 * k);

  // The intro, like the terrace's ending at first: walk to the generator and crank it, and
  // everyone comes out onto the roof. Then the cat hides in the box, Bob opens it, and the
  // monster rises; one swipe sends Alice, Bob and the Professor off the building and brings
  // down the string lights; it screeches at you and hides in the mist. Space, or E away from
  // the generator, skips it while walking; E or Space skip it during the scene.
  const INTRO = [
    ['crank', 2.4],
    ['power', 3.2],
    ['arrive', 0], // until everyone has come out and stopped
    ['talk1', 3.0],
    ['talk2', 3.4],
    ['meow', 1.9],
    ['kitty', 2.8],
    ['dont', 2.2],
    ['open', 3.4],
    ['reverse', 2.6],
    ['swipe', 0], // until the paw is back
    ['roar', 2.0],
    ['mist', 1.2],
  ];

  function startBeast(intro) {
    const cfg = G.level.beast;
    const s = G.level.scene;
    const roof = G.level.solids[0].y;
    const paw = (side) => ({ side, x: cfg.head.x + side * 175, y: PAW_REST_Y, state: 'rest', t: 0, from: null, track: 0, target: null, vy: 0 });
    const walker = (id, name, delay) => ({ id, kind: id, name, x: s.door.x, target: s.line[id], delay, out: false, moving: false, anim: 0, alarm: false, flung: null });
    for (const t of G.room.terminals) {
      t.wreck = 0;
      t.used = false;
    }
    G.beast = {
      phase: intro ? 'intro' : 'fight', // intro | fight | tamed
      step: intro ? 'walk' : null, // the intro's step (INTRO), 'walk' before the crank
      st: 0, // time in this step
      t: 0,
      roof,
      power: intro ? 0 : 1,
      crank: 0,
      tick: 0,
      near: false,
      doorOpen: false,
      lightsBroken: !intro, // the string lights, until the swipe
      termsOn: !intro,
      actors: intro ? [walker('professor', 'Professor', 0.5), walker('bob', 'Bob', 1.5), walker('alice', 'Alice', 2.5)] : [],
      rise: intro ? 0 : 1, // the head coming up behind the skyline
      flash: 0,
      tame: 0, // 0 to 1 as it shrinks back to a cat
      mouth: 0, // 0 shut, 1 wide open (screeching)
      mouthOpen: false,
      cat: { x: s.door.x, y: roof, state: intro ? 'inside' : 'gone', k: 0, delay: 3.5, from: 0 },
      box: { x: cfg.head.x, state: intro ? 'shut' : 'gone', shake: 0, glow: 0, lid: 0 },
      line: null, // a speech bubble: { text, who, follow, until }
      paws: [paw(-1), paw(1)],
      next: Math.random() < 0.5 ? 0 : 1,
      wait: 1.4,
      grudge: null, // the terminal it is going for
      exposure: 0,
      lit: false,
      mist: 0, // 0 to 1: rolls in once the attacks begin
      reveal: 1, // 0 to 1: how far the flashlight has parted the mist
      seen: 'monster', // the face the light last showed
      showUntil: 0, // a screeching monster stays in view until then
      attacked: false,
      cues: {},
    };
    G.torch.active = false; // the title screen's backdrop may have left it shining
    if (intro) {
      G.torch.on = false;
      ui.setPrompt('The generator is at the far end of the roof: walk there and press <b>E</b> to crank it. <b>E</b> anywhere else skips the scene.');
    } else {
      b0Fight();
    }
  }

  // Straight into the fight (a restart, or the intro skipped or over).
  function b0Fight() {
    const b = G.beast;
    b.phase = 'fight';
    b.step = null;
    b.power = 1;
    b.doorOpen = false;
    b.lightsBroken = true;
    b.termsOn = true;
    b.actors = [];
    b.cat.state = 'gone';
    b.box.state = 'gone';
    b.rise = 1;
    b.line = null;
    b.mouthOpen = false;
    b.attacked = true; // the mist rolls in at once
    for (const paw of b.paws) Object.assign(paw, { state: 'rest', t: 0, target: null, x: G.level.beast.head.x + paw.side * 175, y: PAW_REST_Y });
    b.wait = 1.6;
  }

  function cue(name, at, fn) {
    const b = G.beast;
    if (b.t >= at && !b.cues[name]) {
      b.cues[name] = true;
      fn();
    }
  }

  function endIntro() {
    b0Fight();
    G.floorTime = 0; // the clock for the timed star starts with the fight
    G.player.vx = 0;
    setMode('play');
    say('The radiation made the cat a monster: state 1. Turn it back to cute (0) at T1 and T2, and dodge the paws.', 'quantum', true);
  }

  function beastLine(who, text, follow, dur) {
    const b = G.beast;
    b.line = { who, text, follow, until: b.st + (dur || 99) };
    panel.log(`${who}: ${text}`, 'info');
    ui.announce(`${who}: ${text}`);
    ui.setPrompt(`<b>${esc(who)}:</b> ${esc(text)} <span class="fine">(E or Space skips)</span>`);
  }

  function nextIntroStep() {
    const b = G.beast;
    const i = INTRO.findIndex(([name]) => name === b.step);
    if (i === INTRO.length - 1) {
      endIntro();
      return;
    }
    b.step = INTRO[i + 1][0];
    b.st = 0;
    b.line = null;
    enterIntroStep(b.step);
  }

  function enterIntroStep(step) {
    const b = G.beast;
    const pl = G.player;
    const actor = (id) => b.actors.find((a) => a.id === id);
    if (step === 'crank') {
      setMode('cutscene');
      b.near = false;
      b.fromX = pl.x;
      pl.vx = 0;
      pl.facing = 1;
      say('You lean into the crank of the generator.', 'info');
      ui.setPrompt('You lean into the crank. <span class="fine">(E or Space skips)</span>');
    } else if (step === 'power') {
      audio.play('power');
      say('The generator catches. The lights are coming back on.', 'good');
    } else if (step === 'arrive') {
      b.doorOpen = true;
      b.termsOn = true;
      pl.facing = -1;
      audio.play('click');
      say('The stair door opens. The Professor, Bob, Alice and the cat come out onto the roof.', 'info');
    } else if (step === 'talk1') beastLine('Professor', 'You restored power! Hurray!', 'professor');
    else if (step === 'talk2') beastLine('Alice', 'Can we now test the cat teleportation protocol?', 'alice');
    else if (step === 'meow') {
      audio.play('meow');
      beastLine('Cat', 'MEOW', 'cat', 1.0);
      b.cat.from = b.cat.x;
    } else if (step === 'kitty') beastLine('Bob', "It's OK, here kitty kitty!", 'bob');
    else if (step === 'dont') {
      beastLine('Professor', "Don't open the box!", 'professor');
      actor('professor').alarm = true;
    } else if (step === 'open') {
      b.line = null;
      ui.setPrompt('Bob opens the box. <span class="fine">(E or Space skips)</span>');
    } else if (step === 'reverse') beastLine('Professor', 'Quick, we need to reverse this evolution!', 'professor');
    else if (step === 'swipe') {
      const paw = b.paws[1];
      Object.assign(paw, { state: 'swipeIn', t: 0, dir: -1, startX: 640, from: { x: paw.x, y: paw.y }, target: null });
      ui.setPrompt('The cat swipes. <span class="fine">(E or Space skips)</span>');
    } else if (step === 'roar') {
      b.mouthOpen = true;
      b.flash = 0.35;
      G.shake = Math.max(G.shake, 0.8);
      audio.play('screech');
      audio.play('roar');
      pl.facing = 1;
      ui.setPrompt('It screeches at you. <span class="fine">(E or Space skips)</span>');
    } else if (step === 'mist') {
      b.mouthOpen = false;
      b.attacked = true;
      ui.setPrompt('It sinks back into a mist. <span class="fine">(E or Space skips)</span>');
    }
  }

  function updateIntro(dt) {
    const b = G.beast;
    const pl = G.player;
    const s = G.level.scene;
    const step = b.step;
    const dur = (INTRO.find(([name]) => name === step) || [null, 0])[1];
    if (step !== 'walk' && step !== 'crank') b.crank += dt * 11; // the flywheel keeps spinning
    for (const a of b.actors) {
      if (!a.flung) continue;
      a.flung.vy += 1500 * dt;
      a.x += a.flung.vx * dt;
      a.flung.y += a.flung.vy * dt;
      a.flung.spin += -13 * dt;
    }
    if (step === 'crank') {
      pl.x = b.fromX + (CRANK_X - PLAYER.w / 2 - b.fromX) * Math.min(1, b.st / 0.25);
      b.crank += dt * (4 + b.st * 3.5);
      b.tick -= dt;
      if (b.tick <= 0) {
        audio.play('crank');
        b.tick = Math.max(0.12, 0.34 - b.st * 0.09);
      }
    } else if (step === 'power') {
      b.power = Math.min(1, b.st / 2.2);
    } else if (step === 'arrive') {
      let settled = true;
      for (const a of b.actors) {
        if (b.st < a.delay) {
          settled = false;
          continue;
        }
        a.out = true;
        const gap = a.target - a.x;
        const move = Math.min(Math.abs(gap), 125 * dt);
        a.moving = move > 0.001;
        a.x += Math.sign(gap) * move;
        if (a.moving) {
          a.anim += dt;
          settled = false;
        }
      }
      const cat = b.cat;
      if (b.st >= cat.delay && cat.state !== 'sit') {
        cat.state = 'trot';
        const move = Math.min(s.line.cat - cat.x, 190 * dt);
        cat.x += move;
        cat.k += dt;
        if (move <= 0.001) cat.state = 'sit';
      }
      if (cat.state !== 'sit') settled = false;
      b.rest = settled ? (b.rest || 0) + dt : 0;
      if (b.rest > 0.6) nextIntroStep();
      return;
    } else if (step === 'meow') {
      // A dash to the box and a hop inside.
      const cat = b.cat;
      if (b.st >= 0.6 && b.st < 1.3) {
        cat.state = 'jump';
        cat.k = (b.st - 0.6) / 0.7;
        cue('hop', 0, () => audio.play('jump'));
      } else if (b.st >= 1.3 && cat.state !== 'in') {
        cat.state = 'in';
        b.box.shake = 0.5;
        audio.play('land');
        say('The cat hides in the box. The box that is still full of radiation.', 'info');
      }
      b.box.shake = Math.max(0, b.box.shake - dt);
    } else if (step === 'kitty') {
      const bob = b.actors.find((a) => a.id === 'bob');
      const goal = b.box.x - 32;
      const move = Math.min(Math.abs(goal - bob.x), 110 * dt);
      bob.moving = move > 0.001;
      bob.x += Math.sign(goal - bob.x) * move;
      if (bob.moving) bob.anim += dt;
    } else if (step === 'open') {
      const box = b.box;
      if (b.st < 0.6) {
        box.state = 'open';
        box.lid = b.st / 0.6;
        box.glow = box.lid;
      } else if (box.state === 'open') {
        box.state = 'burst';
        b.flash = 1;
        G.shake = 0.9;
        audio.play('smash');
        audio.play('roar');
        for (const a of b.actors) a.alarm = true;
        say('Bob opens the box, and the monster comes out.', 'bad');
      }
      if (b.st >= 0.6) b.rise = ease(Math.min(1, (b.st - 0.6) / 2.2));
      if (b.st >= 1.2) box.state = 'gone';
    } else if (step === 'swipe') {
      const paw = b.paws[1];
      if (paw.state === 'swipe' && !b.lightsBroken) {
        b.lightsBroken = true; // the string lights come down, and the lamps holding them burst
        audio.play('smash');
        for (const x of G.level.scene.lamps) {
          addRing({ x, y: b.roof - 109 }, '#fff1c2', 34);
          G.fx.push({ type: 'spark', from: { x, y: b.roof - 109 }, to: { x: x - 14, y: b.roof - 4 }, t: 0, dur: 0.4, color: '#ffd36b' });
          G.fx.push({ type: 'spark', from: { x, y: b.roof - 109 }, to: { x: x + 16, y: b.roof - 2 }, t: 0, dur: 0.5, color: '#ffd36b' });
        }
      }
      for (const a of b.actors) {
        if (!a.flung && paw.state === 'swipe' && Math.abs(paw.x - a.x) < G.level.beast.pawW / 2 + 9) {
          a.flung = { vx: -420 - Math.random() * 160, vy: -760 - Math.random() * 120, y: 0, spin: 0 };
          audio.play('fling');
        }
      }
      if (b.st > 0.2 && paw.state === 'rest') nextIntroStep();
      return;
    }
    if (dur && b.st >= dur) nextIntroStep();
  }

  // The intro, and the ending once the cat is cute again.
  function updateBeastScene(dt) {
    const b = G.beast;
    if (input.take('pause')) {
      pause();
      return;
    }
    if (input.take('restart')) {
      restartFloor();
      return;
    }
    b.t += dt;
    b.st += dt;
    b.flash = Math.max(0, b.flash - dt * 1.4);
    b.mouth += ((b.mouthOpen || b.t < b.showUntil ? 1 : 0) - b.mouth) * Math.min(1, dt * 10);
    if (b.line && b.st > b.line.until) b.line = null;
    if (b.phase === 'intro') {
      const pl = G.player;
      if (b.step === 'walk') {
        // Walking to the generator, as on the terrace: Space jumps (over the box, say) and does
        // not skip; E away from the generator does.
        let left = dt;
        while (left > 1e-6) {
          const step = Math.min(PHYS.step, left);
          physicsStep(step);
          left -= step;
        }
        if (Math.abs(pl.vx) > 5) pl.facing = Math.sign(pl.vx);
        b.near = pl.onGround && pl.x + PLAYER.w / 2 > CRANK_X - 30;
        const used = input.take('use');
        if (used && b.near) {
          b.step = 'crank';
          b.st = 0;
          enterIntroStep('crank');
        } else if (used) endIntro();
        else ui.setPrompt(b.near ? 'Press <b>E</b> to crank the generator.' : 'The generator is at the far end of the roof: walk there and press <b>E</b> to crank it. <b>E</b> anywhere else skips the scene.');
        G.torch.active = false;
        return;
      }
      if (input.take('use') || input.take('jump')) {
        endIntro();
        return;
      }
      if (b.step === 'swipe') updatePaws(dt); // the one swipe, moved by the fight's own rules
      updateIntro(dt);
      G.torch.active = false;
      return;
    }
    if (b.phase === 'tamed') {
      const skip = input.take('use') || input.take('jump');
      b.tame = ease(Math.min(1, b.t / 2.2));
      b.seen = 'cute';
      b.reveal = Math.min(1, b.reveal + dt * 4);
      b.mist = Math.max(0, b.mist - dt);
      for (const paw of b.paws) paw.y += (PAW_REST_Y + 120 - paw.y) * Math.min(1, dt * 3);
      cue('sit', 2.2, () => {
        b.cat.state = 'sit';
        b.cat.x = G.level.beast.head.x;
        audio.play('purr');
        b.line = { text: 'mew', who: 'Cat', follow: 'cat', until: b.st + 99 };
        panel.log('Cat: mew', 'info');
      });
      if (b.t >= 4.4 || (skip && b.t > 2.4)) {
        setMode('play');
        completeFloor();
      }
    }
  }

  // The fight, every frame of play.
  function updateBeast(dt) {
    const b = G.beast;
    const cfg = G.level.beast;
    b.t += dt;
    b.flash = Math.max(0, b.flash - dt * 1.4);
    for (const t of G.room.terminals) {
      if (!(t.wreck > 0)) continue;
      t.wreck -= dt;
      if (t.wreck <= 0) {
        t.wreck = 0;
        t.used = false;
        audio.play('click');
        addRing(center(screenRect(t)), '#7dffa8', 40);
        say(`${t.id} is working again.`, 'info');
      }
    }
    updatePaws(dt);
    if (G.mode !== 'play') return;
    // The flashlight on its face: a measurement, as on any superposed platform.
    const qi = G.qIndex.CAT;
    const torch = G.torch;
    b.lit = torch.active && sightLit(cfg.sight, torch);
    b.exposure = b.lit && G.q.definite[qi] === null ? b.exposure + dt : 0;
    if (b.exposure >= TORCH.dwell) {
      b.exposure = 0;
      lookAtBeast(qi);
    }
    b.mouth += ((b.t < b.showUntil ? 1 : 0) - b.mouth) * Math.min(1, dt * 10); // it screeches with its mouth open
    // The mist: in once the paws start, parted by the light on a cat that is certain.
    const certain = G.q.definite[qi];
    if (certain !== null && b.lit) b.seen = certain === 0 ? 'cute' : 'monster';
    if (b.attacked) b.mist = Math.min(1, b.mist + dt / 1.6);
    const shown = !b.attacked || (b.lit && certain !== null) || b.t < b.showUntil;
    b.reveal = shown ? Math.min(1, b.reveal + dt * 4) : Math.max(0, b.reveal - dt * 1.2);
  }

  // Any part of the cat's column in the beam: a grid of points over it, so the beam finds it
  // held level from anywhere near the middle of the roof, even from right underneath.
  function sightLit(r, torch) {
    const hand = handOf(G.player);
    for (let i = 0; i <= 4; i += 1) {
      for (let j = 0; j <= 6; j += 1) {
        if (pointLit(hand, torch.angle, r.x + (r.w * i) / 4, r.y + (r.h * j) / 6, torch.range)) return true;
      }
    }
    return false;
  }

  function updatePaws(dt) {
    const b = G.beast;
    const cfg = G.level.beast;
    const pl = G.player;
    const clampX = (x) => Math.max(36, Math.min(844, x));
    // A terminal just used: a free paw (or one still on its way up) goes straight for it and
    // smashes it at once, with no following and no wind-up.
    if (b.phase === 'fight' && b.grudge && !(b.grudge.wreck > 0) && !b.paws.some((p) => p.target === b.grudge)) {
      const paw = b.paws.find((p) => p.state === 'rest') || b.paws.find((p) => p.state === 'rise' || p.state === 'track');
      if (paw) {
        paw.state = 'rise';
        paw.t = 0;
        paw.from = { x: paw.x, y: paw.y };
        paw.target = b.grudge;
      }
    }
    if (b.phase === 'fight' && b.paws.every((p) => p.state === 'rest')) {
      b.wait -= dt;
      if (b.wait <= 0) {
        const paw = b.paws[b.next];
        b.next = 1 - b.next;
        b.attacked = true;
        paw.state = 'rise';
        paw.t = 0;
        paw.from = { x: paw.x, y: paw.y };
        paw.target = null;
        paw.track = PAW.track[0] + Math.random() * (PAW.track[1] - PAW.track[0]);
        if (Math.random() < SWIPE.chance) {
          paw.state = 'swipeIn';
          paw.dir = paw.side < 0 ? 1 : -1; // from its own side across to the other
        }
      }
    }
    for (const paw of b.paws) {
      paw.t += dt;
      const aim = clampX(paw.target ? paw.target.x : pl.x + PLAYER.w / 2);
      if (paw.state === 'rise') {
        const k = ease(Math.min(1, paw.t / PAW.rise));
        paw.x = paw.from.x + (aim - paw.from.x) * k;
        paw.y = paw.from.y + (cfg.top - paw.from.y) * k;
        if (paw.t >= PAW.rise && paw.target) {
          paw.state = 'slam'; // over the terminal: straight down
          paw.t = 0;
          paw.vy = 250;
          audio.play('roar');
        } else if (paw.t >= PAW.rise) {
          paw.state = 'track';
          paw.t = 0;
        }
      } else if (paw.state === 'track') {
        const gap = aim - paw.x;
        paw.x += Math.sign(gap) * Math.min(Math.abs(gap), PAW.speed * dt);
        paw.y = cfg.top + Math.sin(paw.t * 6) * 3;
        if (paw.t >= paw.track) {
          paw.state = 'windup';
          paw.t = 0;
          audio.play('windup');
        }
      } else if (paw.state === 'windup') {
        paw.y = cfg.top - 16 * Math.min(1, paw.t / 0.2); // it stops, and draws back
        if (paw.t >= PAW.windup) {
          paw.state = 'slam';
          paw.t = 0;
          paw.vy = 250;
        }
      } else if (paw.state === 'slam') {
        paw.vy += PAW.fall * dt;
        paw.y = Math.min(b.roof, paw.y + paw.vy * dt);
        const r = { x: paw.x - cfg.pawW / 2, y: paw.y - PAW.h, w: cfg.pawW, h: PAW.h };
        if (G.mode === 'play' && overlap(r, { x: pl.x, y: pl.y, w: PLAYER.w, h: PLAYER.h })) smush(paw);
        if (paw.y >= b.roof) {
          paw.state = 'down';
          paw.t = 0;
          pawLands(paw);
        }
      } else if (paw.state === 'swipeIn') {
        const k = ease(Math.min(1, paw.t / SWIPE.settle));
        const startX = paw.startX !== undefined ? paw.startX : paw.dir > 0 ? SWIPE.ends[0] : SWIPE.ends[1];
        paw.x = paw.from.x + (startX - paw.from.x) * k;
        paw.y = paw.from.y + (b.roof - paw.from.y) * k;
        if (paw.t >= SWIPE.settle) {
          paw.state = 'swipeWind';
          paw.t = 0;
          audio.play('windup');
        }
      } else if (paw.state === 'swipeWind') {
        if (paw.t >= SWIPE.windup) {
          paw.state = 'swipe';
          paw.t = 0;
          audio.play('swoosh');
        }
      } else if (paw.state === 'swipe') {
        paw.x += paw.dir * SWIPE.speed * dt;
        const r = { x: paw.x - cfg.pawW / 2, y: b.roof - PAW.h, w: cfg.pawW, h: PAW.h };
        if (G.mode === 'play' && overlap(r, { x: pl.x, y: pl.y, w: PLAYER.w, h: PLAYER.h })) smush(paw);
        if (paw.dir > 0 ? paw.x >= SWIPE.ends[1] : paw.x <= SWIPE.ends[0]) {
          paw.state = 'lift';
          paw.t = 0;
          paw.from = { x: paw.x, y: paw.y };
        }
      } else if (paw.state === 'down') {
        if (paw.t >= PAW.down) {
          paw.state = 'lift';
          paw.t = 0;
          paw.from = { x: paw.x, y: paw.y };
        }
      } else if (paw.state === 'lift') {
        const k = ease(Math.min(1, paw.t / PAW.lift));
        const restX = cfg.head.x + paw.side * 175;
        paw.x = paw.from.x + (restX - paw.from.x) * k;
        paw.y = paw.from.y + (PAW_REST_Y - paw.from.y) * k;
        if (paw.t >= PAW.lift) {
          paw.state = 'rest';
          paw.target = null;
          paw.startX = undefined;
          b.wait = 0.45 + Math.random() * 0.6;
        }
      }
    }
  }

  function pawLands(paw) {
    const b = G.beast;
    const cfg = G.level.beast;
    G.shake = Math.max(G.shake, 0.55);
    audio.play('thud');
    for (const t of G.room.terminals) {
      if (t.wreck > 0 || Math.abs(t.x - paw.x) > cfg.pawW / 2 + 14) continue;
      t.wreck = cfg.wreck;
      t.used = false;
      if (b.grudge === t) b.grudge = null;
      audio.play('smash');
      addRing(center(screenRect(t)), '#ff8a4a', 50);
      say(`The cat smashed ${t.id}. It comes back in ${cfg.wreck} seconds.`, 'bad');
    }
    if (paw.target && paw.target.wreck > 0) paw.target = null;
  }

  // Flattened: squashed for a moment under the paw, then sent spinning off the screen.
  function smush(paw) {
    const pl = G.player;
    const dir = paw.state === 'swipe' ? paw.dir : pl.x + PLAYER.w / 2 < paw.x ? -1 : 1; // a swipe bats you along
    G.flung = { t: 0, dir, vx: 0, vy: 0, spin: 0, launched: false };
    G.lastHit = { state: paw.state, x: Math.round(paw.x), target: paw.target ? paw.target.id : null }; // for the tests
    audio.play('fling');
    G.stats.falls += 1;
    if (!G.infinite) G.lives -= 1;
    G.fallT = 1.7;
    updateHud();
    setMode('falling');
    ui.announce('Flattened by a paw.');
  }

  function updateFling(dt) {
    const f = G.flung;
    const pl = G.player;
    f.t += dt;
    if (f.t < 0.22) return; // squashed flat
    if (!f.launched) {
      f.launched = true;
      f.vx = f.dir * 520;
      f.vy = -1150; // up and away, off the top of the screen
    }
    f.vy += 1500 * dt;
    pl.x += f.vx * dt;
    pl.y += f.vy * dt;
    f.spin += f.dir * 13 * dt;
  }

  function quickTerminal(term) {
    if (!G.beast || term.wreck > 0 || term.used || !G.q) return;
    const op = term.ops[0];
    const res = Q.apply(op.gate, op.qi, op.angle);
    if (!res.ok) {
      say(`That gate did not go through. ${res.error}`, 'bad');
      return;
    }
    const b = G.beast;
    term.used = true;
    G.stats.gates += 1;
    applySnapshot(res.state);
    audio.play('switch');
    audio.play('gate');
    const head = G.level.beast.head;
    G.fx.push({ type: 'spark', from: center(screenRect(term)), to: { x: head.x, y: head.y }, t: 0, dur: 0.45, color: COLOR_OF(op.gate) });
    b.grudge = term; // it goes for the terminal at once (updatePaws)
    if (res.state.definite[op.qi[0]] === 0) {
      // Eight turns with nobody looking: certainly cute, no gamble needed.
      audio.play('collapse0');
      b.deterministic = true; // eight turns in a row with no look: no luck needed
      tameBeast(`${term.id}: RY(π/8), and the cat is certainly cute: state 0. The mist clears, and the monster shrinks back into a cat.`);
      return;
    }
    const p0 = 1 - res.state.p1[op.qi[0]];
    say(`${term.id}: RY(π/8) on the cat. If you looked now it would be cute (0) with chance ${Math.round(p0 * 100)}%. It is coming for ${term.id}: get away!`, 'quantum');
  }

  function tameBeast(text) {
    const b = G.beast;
    b.phase = 'tamed';
    b.t = 0;
    b.st = 0;
    b.cues = {};
    b.grudge = null;
    b.exposure = 0;
    G.torch.on = false;
    G.torch.active = false;
    for (const t of G.room.terminals) t.used = false; // nothing left to come for
    setMode('cutscene');
    say(text, 'good', true);
  }

  function slamAll() {
    const b = G.beast;
    for (const paw of b.paws) {
      paw.t = 0;
      paw.target = null;
      if (paw.y < b.roof - 1) {
        paw.state = 'slam';
        paw.vy = 250;
      } else {
        paw.state = 'down'; // already on the roof (a swipe): it stops dead there
        pawLands(paw);
      }
    }
  }

  function lookAtBeast(qi) {
    const b = G.beast;
    const res = Q.measure([qi], true, 'torch');
    if (!res.ok) return;
    G.stats.looks += 1;
    G.stats.chance += 1; // a superposed cat: the outcome was left to chance
    applySnapshot(res.state);
    if (res.state.definite[qi] === 0) {
      audio.play('bigMeow');
      tameBeast('MEOW! You looked, and it came out cute: state 0. The monster shrinks back into a cat.');
      return;
    }
    // A monster: it screeches, shows itself for two full seconds, and brings both paws
    // straight down wherever they are.
    G.stats.unlucky += 1;
    audio.play('screech');
    b.seen = 'monster';
    b.showUntil = b.t + 2;
    b.flash = 0.5;
    G.shake = Math.max(G.shake, 0.7);
    slamAll();
    say('SCREECH! You looked, and it came out monster: state 1. Every turn so far is undone. Start again, or turn it further before you look.', 'bad', true);
  }

  function beastPrompt(hit) {
    const b = G.beast;
    const pl = G.player;
    const cx = pl.x + PLAYER.w / 2;
    const term = G.room.terminals.find((t) => Math.abs(cx - t.x) < 34);
    const qi = G.qIndex.CAT;
    const p0 = 1 - G.q.p1[qi];
    const superposed = G.q.definite[qi] === null;
    if (b.exposure > 0) ui.setPrompt('Looking at the cat. Hold the light on its face.');
    else if (hit && hit.type === 'terminal') ui.setPrompt(`Press <b>1</b> or <b>E</b> to turn the cat with RY(π/8) at <b>${hit.obj.id}</b>. Then run.`);
    else if (term && term.wreck > 0) ui.setPrompt(`<b>${term.id}</b> is smashed. It comes back in <b>${Math.ceil(term.wreck)}</b> s.`);
    else if (term && term.used) ui.setPrompt(`The cat is going for <b>${term.id}</b>: get away from it!`);
    else if (superposed) {
      ui.setPrompt(
        `The cat is <b>${Math.round(p0 * 100)}%</b> cute. Hold <b>F</b> to shine the flashlight its way and look, or turn it further first.`
      );
    } else ui.setPrompt('When a raised paw stops, it is about to drop: move. Turn the cat at <b>T1</b> and <b>T2</b>.');
  }

  // -- flow -------------------------------------------------------------------

  function completeFloor() {
    if (G.mode !== 'play') return;
    const level = G.level;
    const s = G.stats;
    const got = {
      cleared: true,
      fewest: s.gates <= level.shortest,
      sure: !!(G.beast && G.beast.deterministic),
      sequence: G.bonusDone,
      noLuck: s.chance === 0,
      noHints: G.hints === 0,
    };
    const earned = starsOf(level).map((star) => ({ got: got[star.key], text: star.text }));
    const stars = earned.filter((e) => e.got).length;
    recordClear(level, earned, G.floorTime);
    const of = earned.length;
    const bonusLevel = isBonus(G.levelIndex);
    if (!bonusLevel) G.results[G.levelIndex] = { stars, of, ...s, hints: G.hints }; // bonus levels are not part of the climb
    const last = G.levelIndex === LEVELS.length - 1;
    setMode('complete');
    audio.play(last ? 'win' : 'unlock');
    const parts = [
      `${count(s.gates, 'gate', 'gates')} (fewest possible: ${level.shortest})`,
      count(s.looks, 'observation', 'observations'),
      count(s.unlucky, 'unlucky collapse', 'unlucky collapses'),
    ];
    const secs = Math.round(G.floorTime);
    parts.push(`time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    ui.showComplete({
      name: level.name,
      index: G.levelIndex,
      total: LEVELS.length,
      bonus: bonusLevel ? { tag: level.tag, more: hasNextBonus(G.levelIndex) } : null,
      stars,
      of,
      earned,
      takeaway: level.takeaway,
      stats: `${parts.join(' · ')}.`,
      last,
    });
    ui.announce(`${bonusLevel ? level.tag : `Floor ${G.levelIndex + 1}`} cleared with ${stars} of ${of} stars. ${level.takeaway}`);
  }

  function nextFloor() {
    if (isBonus(G.levelIndex) && !hasNextBonus(G.levelIndex)) toTitle(); // after the last bonus level
    else loadLevel(G.levelIndex + 1);
  }

  // -- the terrace: an epilogue with no qubits ---------------------------------

  function loadTerrace() {
    const s = TERRACE.scene;
    G.epoch += 1;
    if (G.terminal || G.passive) ui.closeTerminal();
    G.levelIndex = LEVELS.length;
    buildFloor(TERRACE);
    ui.setNote(null);
    ui.setAbout(false);
    G.stats = { gates: 0, looks: 0, unlucky: 0, denied: 0, chance: 0, falls: 0 };
    G.lives = LIVES_PER_FLOOR;
    G.hints = 0;
    const walker = (id, name, delay) => ({ id, kind: id, name, x: s.door.x, target: s.line[id], delay, out: false, moving: false, anim: 0 });
    G.scene = {
      phase: 'walk', // walk | crank | power | arrive | talk1 | talk2 | meow | gone | fade
      t: 0,
      crank: 0, // angle of the crank handle
      tick: 0,
      fromX: 0,
      power: 0,
      fade: 0,
      doorOpen: false,
      alarm: false,
      near: false,
      skip: false,
      rest: 0,
      line: null,
      actors: [walker('professor', 'Professor', 0.5), walker('bob', 'Bob', 1.5), walker('alice', 'Alice', 2.5)],
      cat: { x: s.door.x, y: s.door.y, target: s.line.cat, delay: 3.5, state: 'inside', vy: 0, anim: 0 },
    };
    panel.setLevel(TERRACE, G.levelIndex, LEVELS.length);
    applySnapshot(NO_QUBITS);
    updateHud();
    ui.showScreen(null);
    setMode('play');
    say(`${TERRACE.name}. ${TERRACE.goal}`, 'info');
    return true;
  }

  function scenePhase(phase) {
    G.scene.phase = phase;
    G.scene.t = 0;
    G.scene.skip = false;
  }

  function sceneLine(who, text, follow) {
    G.scene.line = { who, text, follow };
    ui.setPrompt(`<b>${esc(who)}:</b> ${esc(text)}`);
    panel.log(`${who}: ${text}`, 'info');
    ui.announce(`${who}: ${text}`);
  }

  function updateTerrace(dt) {
    const sc = G.scene;
    const s = TERRACE.scene;
    const pl = G.player;
    if (input.take('pause')) {
      pause();
      return;
    }
    if (input.take('restart')) {
      restartFloor();
      return;
    }
    input.take('hint');
    input.take('torch');
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(PHYS.step, left);
      physicsStep(step);
      left -= step;
    }
    G.torch.active = false;
    G.torch.lowered = true;
    if (G.mode === 'play' && Math.abs(pl.vx) > 5) pl.facing = Math.sign(pl.vx);
    const used = input.take('use');
    const skip = G.mode === 'cutscene' && (used || input.take('jump') || sc.skip);
    sc.skip = false;
    sc.t += dt;
    if (sc.phase !== 'walk' && sc.phase !== 'crank') sc.crank += dt * 11; // the flywheel keeps spinning

    if (sc.phase === 'walk') {
      sc.near = pl.onGround && pl.x + PLAYER.w / 2 > CRANK_X - 30;
      if (sc.near && used) {
        setMode('cutscene');
        scenePhase('crank');
        sc.near = false;
        sc.fromX = pl.x;
        pl.vx = 0;
        pl.facing = 1;
        say('You lean into the crank of the generator.', 'info');
        ui.setPrompt('You lean into the crank.');
      } else {
        ui.setPrompt(sc.near ? 'Press <b>E</b> to crank the generator.' : esc(TERRACE.goal));
      }
    } else if (sc.phase === 'crank') {
      pl.x = sc.fromX + (CRANK_X - PLAYER.w / 2 - sc.fromX) * Math.min(1, sc.t / 0.25);
      sc.crank += dt * (4 + sc.t * 3.5);
      sc.tick -= dt;
      if (sc.tick <= 0) {
        audio.play('crank');
        sc.tick = Math.max(0.12, 0.34 - sc.t * 0.09);
      }
      if (sc.t >= 2.4) {
        scenePhase('power');
        audio.play('power');
        say('The generator catches. The lights are coming back on.', 'good', true);
        ui.setPrompt('The generator catches. The lights are coming back on.');
      }
    } else if (sc.phase === 'power') {
      sc.power = Math.min(1, sc.t / 2.2);
      if (sc.t >= 3.2) {
        scenePhase('arrive');
        sc.doorOpen = true;
        pl.facing = -1;
        audio.play('click');
        say('The stair door opens. The Professor, Bob, Alice and the cat come out onto the terrace.', 'info');
        ui.setPrompt('Someone is coming up the stairs.');
      }
    } else if (sc.phase === 'arrive') {
      let settled = true;
      for (const a of sc.actors) {
        if (sc.t < a.delay) {
          settled = false;
          continue;
        }
        a.out = true;
        const gap = a.target - a.x;
        const move = Math.min(Math.abs(gap), 125 * dt);
        a.moving = move > 0.001;
        a.x += Math.sign(gap) * move;
        if (a.moving) {
          a.anim += dt;
          settled = false;
        }
      }
      const cat = sc.cat;
      if (sc.t >= cat.delay && cat.state !== 'sit') {
        cat.state = 'trot';
        const move = Math.min(cat.target - cat.x, 190 * dt);
        cat.x += move;
        cat.anim += dt;
        if (move <= 0.001) cat.state = 'sit';
      }
      if (cat.state !== 'sit') settled = false;
      sc.rest = settled ? sc.rest + dt : 0;
      if (sc.rest > 0.6) {
        scenePhase('talk1');
        sceneLine('Professor', 'You restored power! Hurray!', 'professor');
      }
    } else if (sc.phase === 'talk1') {
      if (sc.t >= 3.4 || skip) {
        scenePhase('talk2');
        sceneLine('Alice', 'Can we now test the cat teleportation protocol?', 'alice');
      }
    } else if (sc.phase === 'talk2') {
      if (sc.t >= 4.4 || skip) {
        scenePhase('meow');
        audio.play('meow');
        sceneLine('Cat', 'MEOW', 'cat');
      }
    } else if (sc.phase === 'meow') {
      const cat = sc.cat;
      pl.facing = cat.x > pl.x ? 1 : -1; // everyone watches her go
      if (cat.state === 'sit' && sc.t >= 1.1) cat.state = 'run';
      if (cat.state === 'run') {
        cat.x += 300 * dt;
        cat.anim += dt;
        if (cat.x >= s.edge - 150) sc.alarm = true;
        if (cat.x >= s.edge - 46) {
          cat.state = 'jump';
          cat.vy = -430;
          audio.play('jump');
        }
      } else if (cat.state === 'jump') {
        cat.x += 230 * dt;
        cat.vy += 1100 * dt;
        cat.y += cat.vy * dt;
        cat.anim += dt;
        if (cat.y > s.door.y + 20) sc.line = null;
        if (cat.y > WORLD.h + 40) {
          cat.state = 'gone';
          scenePhase('gone');
          panel.log('The cat has had enough of being experimented on.', 'info');
          ui.announce('The cat jumps off the roof. The cat has had enough of being experimented on.');
          ui.setPrompt('The cat has had enough of being experimented on.');
        }
      }
    } else if (sc.phase === 'gone') {
      if (sc.t >= 1.3) scenePhase('fade');
    } else if (sc.phase === 'fade') {
      sc.fade = Math.min(1, sc.t / 1.8);
      if (sc.t >= 2.3) finishEnding();
    }
  }

  function finishEnding() {
    const done = G.results.filter(Boolean);
    const sum = (key) => done.reduce((total, r) => total + (r[key] || 0), 0);
    const run = done.length
      ? `${count(sum('gates'), 'gate', 'gates')}, ${count(sum('looks'), 'observation', 'observations')} and ${count(sum('falls'), 'fall', 'falls')} across the ${done.length} of ${LEVELS.length} floors you cleared. `
      : '';
    // Stars are counted against the whole game, so a skipped floor shows as stars not earned.
    const possible = LEVELS.reduce((n, level) => n + starsOf(level).length, 0);
    setMode('win');
    audio.play('win');
    ui.showWin({
      stars: sum('stars'),
      of: done.length ? possible : 0,
      stats: `${run}Physics: exact state-vector simulation, in your browser.`,
    });
    ui.announce('Thank you for playing.');
  }

  function startRun() {
    audio.unlock();
    G.started = true;
    G.results = [];
    loadLevel(0);
  }

  function restartFloor() {
    if (!['play', 'terminal', 'dialogue', 'cutscene', 'paused'].includes(G.mode)) return;
    loadLevel(G.levelIndex, { carry: 'restart' });
  }

  function pause() {
    if (G.mode === 'terminal') closeTerminal();
    if (G.mode !== 'play' && G.mode !== 'cutscene') return;
    G.pausedFrom = G.mode;
    setMode('paused');
    ui.setOptions({ lives: G.infinite, floor: G.levelIndex });
    ui.showScreen('pause');
  }

  function resume() {
    if (G.mode !== 'paused') return;
    ui.showScreen(null);
    setMode(G.pausedFrom);
  }

  async function toTitle() {
    const fromRoof = !!(G.level && (G.level.outdoor || G.level.beast));
    G.epoch += 1;
    if (G.terminal) {
      G.terminal = null;
      ui.closeTerminal();
    }
    closePassive();
    G.dialogue = null;
    G.bubbles = [];
    setMode('title');
    ui.showScreen('title');
    ui.setAbout(true);
    ui.setPrompt('The lab is ready. Enter the building when you are.');
    if (!fromRoof) return;
    await loadLevel(0, { backdrop: true });
    G.torch.active = true;
    G.torch.angle = -0.22;
  }

  function toggleSound() {
    const muted = !audio.isMuted();
    audio.setMuted(muted);
    ui.setSound(!muted);
  }

  function showHint() {
    if (!G.level || G.hints >= G.level.hints.length) return;
    G.hints += 1;
    panel.setHints(G.hints);
    ui.announce(`Hint ${G.hints}: ${G.level.hints[G.hints - 1]}`);
  }

  function applyDev() {
    ui.setDev(G.dev);
    panel.setSequential(G.dev.circuitRight);
    requestAnimationFrame(() => panel.refresh()); // the rack may have changed size
  }

  function setDev(name, value) {
    G.dev[name] = value;
    saveDev(G.dev);
    applyDev();
  }

  function setOption(name, value) {
    if (name === 'lives') {
      G.infinite = value;
      updateHud();
    }
  }

  function interactPrompt(hit) {
    if (!hit) return '';
    if (hit.type === 'npc') return `Press <b>E</b> to talk to ${esc(hit.obj.name)}.`;
    if (hit.type === 'portal') return `Press <b>E</b> to go through the door marked ${esc(hit.obj.label)}.`;
    if (hit.type === 'lock') return 'Press <b>E</b> to try the lock.';
    if (hit.type === 'cat') return 'Press <b>E</b> to pet the cat.';
    const term = hit.obj;
    if (term.port && !carrying()) {
      return term.box ? 'The box has a canister port. You need the canister.' : `${esc(term.id)}: a dead terminal with a working canister port. You need the canister.`;
    }
    if (G.dev.passiveTerminal) return `${esc(term.id)}: press the number under a gate, or <b>E</b> to step in.`;
    return `Press <b>E</b> to use ${term.port ? esc(term.id) : `terminal ${esc(term.id)}`}.`;
  }

  function brokenNear() {
    const pl = G.player;
    return G.room.terminals.find((t) => t.broken && Math.abs(pl.x + PLAYER.w / 2 - t.x) < 30 && Math.abs(pl.y + PLAYER.h - t.y) < 6);
  }

  function updatePrompt(hit) {
    if (G.mode !== 'play') return;
    if (G.beast) {
      beastPrompt(hit);
      return;
    }
    const ghosts = G.room.platforms.filter((p) => p.state === null);
    const lit = ghosts.find((p) => p.exposure > 0);
    const ghost = ghosts[0];
    const d = G.room.door;
    const act = interactPrompt(hit);
    const orAct = act ? ` ${act}` : '';
    const station = G.room.battery;
    panel.setGoal(station && station.taken && G.level.goalAfterBattery ? G.level.goalAfterBattery : G.level.goal);
    if (lit) ui.setPrompt(`Observing <b>${lit.q}</b>. Hold the light steady.`);
    else if (G.swap && !G.swap.travel) ui.setPrompt(`<b>${G.swap.a.q}</b> and <b>${G.swap.b.q}</b> trade places in <b>${G.swap.count}</b>: jump on or off now.`);
    else if (G.swap) ui.setPrompt(`<b>${G.swap.a.q}</b> and <b>${G.swap.b.q}</b> are trading places.`);
    else if (brokenNear()) {
      const t = brokenNear();
      ui.setPrompt(`<b>${t.id}</b> is broken. It is stuck applying ${list(t.broken.ops.map(opWords))}, over and over, ${t.broken.every === 1 ? 'one gate a second' : `one gate every ${t.broken.every} seconds`}. It does not respond.`);
    } else if (station && !station.taken && G.torch.battery === 'dead') {
      ui.setPrompt(`Your flashlight is dead. The <b>battery station</b> is ${station.where || 'at the left end of this ledge'}: walk up to it.${orAct}`);
    } else if (act && !ghost) ui.setPrompt(act);
    else if (ghost && G.torch.battery === 'dead') ui.setPrompt(`<b>${ghost.q}</b> is in superposition and you have no light to observe it. Make it certain with gates.${orAct}`);
    else if (ghost && G.level.torchOff) ui.setPrompt(`<b>${ghost.q}</b> is in superposition. Your flashlight is off, so you are not looking at it.${orAct}`);
    else if (ghost) ui.setPrompt(`<b>${ghost.q}</b> is in superposition. Hold <b>F</b> to shine the flashlight on a dotted outline and observe it (<b>I</b> / <b>K</b> tilt it).${orAct}`);
    else if (d && d.item && !d.open && G.player.x > d.x - 220) ui.setPrompt('The exit is locked, and this lock takes an ordinary key.');
    else if (d && d.key && !d.unlocked && G.player.x > d.x - 220) {
      const byHand = d.byHand || G.torch.battery === 'dead';
      ui.setPrompt(
        byHand
          ? 'The exit is locked. Press <b>E</b> at the <b>lock panel</b> to test the key.'
          : 'The exit is locked. Shine the flashlight on the <b>lock panel</b> beside it, or press <b>E</b> there.'
      );
    }
    else if (d && d.open && (d.key || d.item)) ui.setPrompt('The exit is open. Walk through it.');
    else ui.setPrompt('Walk with <b>&larr;</b> <b>&rarr;</b>, jump with <b>Space</b>, and use terminals with <b>E</b>. The goal is at the top of the panel.');
  }

  function update(dt) {
    G.t += dt;
    // Boss music while the beast fights (not while paused, nor in its intro or ending).
    audio.music(G.beast && G.beast.phase === 'fight' && (G.mode === 'play' || G.mode === 'falling') ? 'boss' : null);
    if (G.mode === 'play' || G.mode === 'terminal' || G.mode === 'dialogue') G.floorTime += dt;
    for (const fx of G.fx) fx.t += dt;
    for (const f of G.floaters) f.t += dt;
    for (const b of G.bubbles) {
      if (b.wait > 0) b.wait -= dt;
      else b.t += dt;
    }
    G.fx = G.fx.filter((fx) => fx.t < fx.dur);
    G.floaters = G.floaters.filter((f) => f.t < f.dur);
    G.bubbles = G.bubbles.filter((b) => b.t < b.dur);
    G.shake = Math.max(0, G.shake - dt * 3);
    for (const p of G.platforms) p.flash = Math.max(0, p.flash - dt * 2.2);

    if (input.take('mute')) toggleSound();
    traceLights();

    if (G.mode === 'falling') {
      if (G.flung) updateFling(dt);
      G.fallT -= dt;
      if (G.fallT <= 0) afterFall();
      return;
    }
    if (G.mode === 'paused') {
      if (input.take('pause')) resume();
      return;
    }
    if (G.mode === 'terminal') {
      if (input.take('use')) closeTerminal();
      input.take('pause'); // only E leaves a terminal
      for (let k = 1; k <= 9; k += 1) if (input.take(`op${k}`) && G.dev.passiveTerminal) applyOp(k - 1);
      // Platforms wait until you leave the terminal, except with the instant response developer
      // option, or in a room with a cavity, where timing is the whole puzzle (a shield cutting
      // the waves has to do so the moment you apply its gate).
      if (G.dev.instantResponse || G.room.cavities.length || G.swap) movePlatforms(dt); // a swap does not wait either
      countDown(dt);
      updateLights(dt); // backup lights stand for decoherence, which does not wait while you are at a terminal
      updateCavities(dt); // nor does a cavity's drive
      updateBroken(dt); // nor a broken terminal
      updateTorch(dt);
      return;
    }
    if (G.mode === 'dialogue') {
      if (input.take('pause')) advanceDialogue(true);
      else if (input.take('use') || input.take('jump')) advanceDialogue(false);
      updateTorch(dt);
      return;
    }
    if (G.level && G.level.outdoor && (G.mode === 'play' || G.mode === 'cutscene')) {
      updateTerrace(dt);
      return;
    }
    if (G.beast && (G.mode === 'cutscene' || (G.mode === 'play' && G.beast.phase === 'intro'))) {
      updateBeastScene(dt);
      return;
    }
    if (G.mode !== 'play' || !G.level) return;

    if (input.take('pause')) {
      pause();
      return;
    }
    if (input.take('restart')) {
      restartFloor();
      return;
    }
    if (input.take('hint')) showHint();

    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(PHYS.step, left);
      physicsStep(step);
      left -= step;
    }

    updateLights(dt);
    updateCavities(dt);
    updateBroken(dt);
    if (G.beast) {
      updateBeast(dt);
      if (G.mode !== 'play') return; // flattened, or the cat is cute again
    }
    countDown(dt);
    pickUps();
    const hit = findInteract();
    updatePassive(hit);
    for (let k = 1; k <= 9; k += 1) if (input.take(`op${k}`) && G.passive) applyOp(k - 1);
    if (input.take('use') && hit) {
      if (hit.type === 'terminal' && hit.obj.quick) quickTerminal(hit.obj);
      else if (hit.type === 'terminal') {
        closePassive(); // with the passive terminal option, E steps in: arrow keys or numbers pick a gate
        useTerminal(hit.obj);
      }
      else if (hit.type === 'npc') {
        const talk = (story().talk || {})[hit.obj.id];
        if (talk) talk(storyCtx(hit.obj));
      } else if (hit.type === 'portal') {
        enterRoom(hit.obj);
        return;
      } else if (hit.type === 'lock') tryDoor();
      else if (hit.type === 'cat') petCat();
      if (G.mode !== 'play') return;
    }
    if (story().tick) story().tick(storyCtx(null), dt);
    updateTorch(dt);
    updateDoor(dt);
    if (G.player.y > WORLD.h + 30) loseLife();
    updatePrompt(hit);
  }

  // Browsers keep audio suspended until the page has had a click or a key press.
  for (const type of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown']) window.addEventListener(type, () => audio.unlock());

  dom.game.addEventListener('pointerdown', () => {
    if (G.mode === 'dialogue') advanceDialogue(false);
    else if (G.mode === 'cutscene' && G.scene) G.scene.skip = true;
  });

  window.addEventListener('keydown', (ev) => {
    if (G.mode !== 'terminal' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.code !== 'ArrowRight' && ev.code !== 'ArrowLeft') return;
    const buttons = Array.from(dom.termOps.querySelectorAll('button:not(:disabled)'));
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    const next = (at + (ev.code === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[at < 0 ? 0 : next].focus();
    ev.preventDefault();
  });

  // -- canister and lock views (developer option) -------------------------------

  // The terminal the player is using or standing at, if any.
  function terminalAtHand() {
    if (!G.room || (G.mode !== 'play' && G.mode !== 'terminal')) return null;
    return G.terminal || G.room.terminals.find((t) => t.near) || null;
  }

  // What the canister view shows, left to right: the carried canister, and at the
  // Professor's box the cat (the atom's qubit) beside it.
  function tileItems() {
    if (!G.dev.canisterView || !G.q || !G.level || G.level.outdoor) return [];
    const items = [];
    if (carrying()) items.push({ qi: G.canister.qi, kind: 'canister' });
    const term = terminalAtHand();
    const cat = G.level.qubits.findIndex((q) => q.role === 'box');
    if (term && term.box && cat >= 0) items.push({ qi: cat, kind: 'cat' });
    return items;
  }

  // Each frame, after the game is drawn: the tile, and the magnified lock when the
  // terminal at hand acts on one of the lock's lamps.
  function updateViews() {
    const items = tileItems();
    const qis = items.map((it) => it.qi);
    const fx = items.length ? G.fx.find((f) => f.type === 'gate' && f.parts.some((p) => qis.includes(p.qi))) : null;
    panel.setTile(items, G.t, fx ? { parts: fx.parts, k: Math.min(1, fx.t / fx.dur) } : null);
    const term = G.dev.canisterView && G.q && !G.level.outdoor ? terminalAtHand() : null;
    const d = G.room && G.room.door;
    const lamps = d && d.lockQi ? d.lockQi : [];
    const touches = !!term && lamps.length > 0 && term.ops.some((op) => (op.qi || []).some((q) => lamps.includes(q)));
    panel.setLockView(dom.game, touches ? renderer.lockCrop(G) : null, touches ? `The exit lock, magnified: key ${d.key.split('').join(' ')}, lamps ${lamps.map((q) => G.q.labels[q]).join(', ')}` : null);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      update(dt);
      renderer.draw(G);
      updateViews();
      ui.tick(dt);
    } catch (err) {
      console.log(`Blackout Lab frame error: ${err && err.stack ? err.stack : err}`);
    }
    requestAnimationFrame(frame);
  }

  function watchSize() {
    renderer.resize();
    if (window.ResizeObserver) new ResizeObserver(() => renderer.resize()).observe(dom.viewport);
    window.addEventListener('resize', () => renderer.resize());
  }

  async function boot() {
    watchSize();
    ui.showScreen('title');
    ui.setAbout(true);
    ui.showTouch(!!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
    applyDev();
    requestAnimationFrame(frame);

    await loadLevel(0, { backdrop: true });
    if (G.mode === 'error') return;
    G.torch.active = true;
    G.torch.angle = -0.22;
    setMode('title');
    ui.setPrompt('The lab is ready. Enter the building when you are.');
    ui.enableStart('Enter the building');
  }

  return { boot, state: G };
}
