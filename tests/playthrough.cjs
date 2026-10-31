// End-to-end playthrough: a bot plays all seven floors and the ending in a real
// browser, using only the keyboard, the pointer and the on-screen gate buttons.
//
//   node tests/playthrough.cjs                            the site (index.html), served locally
//   node tests/playthrough.cjs dist/blackout-lab.html     the single-file build, opened from disk
//   node tests/playthrough.cjs https://example.org/       any running copy, e.g. the GitHub Pages site
//
// A second argument names a folder to save screenshots in.
// Needs the `playwright` package and a Chromium it can launch.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const target = process.argv[2] || null;
const shotDir = process.argv[3] || null;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Serves the project folder, as GitHub Pages would. Resolves to the server and its address.
function serve() {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, name.endsWith('/') ? `${name}index.html` : name);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

// Runs inside the page: drives the game through real DOM events.
function installBot() {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const G = () => window.blackoutLab.state;
  const down = {};
  const key = (code, on) => {
    if (!!down[code] === on) return;
    down[code] = on;
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
  };
  const tap = async (code) => {
    key(code, true);
    await frame();
    key(code, false);
    await frame();
  };
  async function until(test, ms, what) {
    const end = performance.now() + (ms || 8000);
    while (performance.now() < end) {
      if (test()) return true;
      await frame();
    }
    key('ArrowLeft', false);
    key('ArrowRight', false);
    throw new Error(`timed out waiting for ${what || test}`);
  }
  const feet = () => G().player.y + 32;
  const mid = () => G().player.x + 9;
  function surface() {
    const g = G();
    const pl = g.player;
    const all = [...g.room.solids, ...g.room.platforms.filter((p) => p.state !== null).map((p) => ({ x: p.x, y: p.y, w: p.w }))];
    return all.find((s) => Math.abs(s.y - feet()) < 3 && pl.x + 18 > s.x && pl.x < s.x + s.w);
  }
  // Hold left or right as needed to bring the player's centre to x.
  function steer(x, slack) {
    const off = x - mid();
    key('ArrowRight', off > slack);
    key('ArrowLeft', off < -slack);
  }
  async function walkTo(x) {
    const pl = G().player;
    await until(() => {
      steer(x, 3);
      return Math.abs(x - mid()) <= 3 || G().mode !== 'play';
    }, 7000, `walk to ${x}`);
    steer(mid(), 99);
    await until(() => Math.abs(pl.vx) < 1 || G().mode !== 'play', 2000, 'stop');
  }
  // Jump from the current surface onto the rectangle {x, w, y}, steering in the air.
  async function hop(target) {
    const pl = G().player;
    const from = surface();
    if (!from) throw new Error('hop: not standing on anything');
    const goal = target.x + target.w / 2;
    const dir = goal > mid() ? 1 : -1;
    const edge = dir > 0 ? from.x + from.w : from.x;
    key(dir > 0 ? 'ArrowRight' : 'ArrowLeft', true);
    await until(() => (dir > 0 ? pl.x + 18 >= edge - 2 : pl.x <= edge + 2), 6000, 'reach the edge');
    key('Space', true);
    await frame();
    key('Space', false);
    await until(() => !pl.onGround, 1000, 'leave the ground');
    await until(() => {
      steer(goal, 4);
      return pl.onGround || G().mode !== 'play';
    }, 4000, 'land');
    await until(() => {
      steer(goal, 6);
      return Math.abs(goal - mid()) <= 6 || !pl.onGround || G().mode !== 'play';
    }, 3000, 'centre');
    steer(mid(), 99);
    await until(() => Math.abs(pl.vx) < 1 || G().mode !== 'play', 2000, 'stop');
    const landed = Math.abs(feet() - target.y) <= 3;
    if (!landed || !['play', 'complete'].includes(G().mode)) throw new Error(`hop missed: feet ${feet()} target ${target.y} mode ${G().mode}`);
  }
  function aim(x, y) {
    const canvas = document.getElementById('game');
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: r.left + (x / 960) * r.width, clientY: r.top + (y / 540) * r.height, bubbles: true })
    );
  }
  const platform = (q) => G().platforms.find((p) => p.q === q);
  const slab = (q) => {
    const p = platform(q);
    return { x: p.x, w: p.w, y: p.state ? p.y1 : p.y0 };
  };
  const solid = (i) => G().room.solids[i];
  // Wait for a platform that was flipped to finish sliding.
  const settle = (q) => until(() => platform(q).y === platform(q).targetY, 3000, `${q} to stop moving`);
  // Shine the flashlight on a superposed platform until it collapses; returns 0 or 1.
  async function observe(q) {
    const p = platform(q);
    if (p.state !== null) return p.state;
    const pl = G().player;
    const d = (y) => Math.hypot(p.x + p.w / 2 - pl.x, y - pl.y);
    aim(p.x + p.w / 2, (d(p.y1) < d(p.y0) ? p.y1 : p.y0) + 7);
    await until(() => p.state !== null, 6000, `collapse of ${q}`);
    aim(pl.x, 20); // look away again
    await frame();
    return p.state;
  }
  // Use a terminal or port: `picks` are 1-based positions of the gate buttons to press.
  async function terminal(id, picks) {
    const g = G();
    const term = g.room.terminals.find((t) => t.id === id);
    if (!term) throw new Error(`no terminal ${id} in this room`);
    await walkTo(term.x);
    await until(() => term.near, 2000, `stand at ${id}`);
    aim(g.player.x, 20);
    await tap('KeyE');
    await until(() => G().mode === 'terminal', 2000, `${id} to open`);
    for (const n of picks) {
      const button = document.querySelectorAll('#term-ops button')[n - 1];
      if (!button || button.disabled) throw new Error(`gate ${n} at ${id} is not available`);
      const before = G().q.ops.length;
      button.click();
      await until(() => G().q.ops.length > before && !G().busy, 5000, `gate ${n} at ${id}`);
    }
    await tap('Escape'); // Esc must not leave a terminal: only E does
    await frame();
    if (G().mode !== 'terminal') throw new Error(`Esc closed ${id}`);
    await tap('KeyE');
    await until(() => G().mode === 'play', 2000, `${id} to close`);
  }
  // Talk to someone until they have nothing more to say (later lines may arrive after a measurement).
  async function talk(id) {
    const npc = G().room.npcs.find((n) => n.id === id);
    await walkTo(npc.x - 20);
    await until(() => npc.near, 2000, `stand by ${id}`);
    await tap('KeyE');
    await until(() => G().mode === 'dialogue', 2000, `${id} to speak`);
    let quiet = 0;
    while (quiet < 25) {
      if (G().mode === 'dialogue') {
        quiet = 0;
        await tap('KeyE');
      } else {
        quiet += 1;
        await frame();
      }
    }
  }
  async function through(label) {
    const portal = G().room.portals.find((p) => p.label === label);
    const before = G().room.id;
    await walkTo(portal.x);
    await tap('KeyE');
    await until(() => G().room.id !== before, 2000, `go through ${label}`);
  }
  // Read the exit lock with the flashlight; true if it opened.
  async function unlock() {
    const d = G().door;
    const w = 30 + d.lock.length * 20;
    await until(() => d.deniedT <= 0 && !d.pending, 4000, 'the last refusal to clear');
    aim(d.x - 32 - w / 2, d.y - 55);
    await until(() => d.unlocked || (d.deniedT > 0 && !d.pending), 6000, 'the lock to answer');
    const ok = d.unlocked;
    aim(G().player.x, 20);
    await until(() => d.exposure === 0, 1000, 'look away');
    return ok;
  }
  // Read the exit lock with the E key (the only way when the flashlight is dead).
  async function unlockByHand() {
    const d = G().door;
    const left = d.x - 32 - (30 + d.lock.length * 20);
    await walkTo((left + d.x + 22) / 2);
    await until(() => d.near && d.deniedT <= 0 && !d.pending, 4000, 'stand at the lock');
    await tap('KeyE');
    await until(() => d.unlocked || (d.deniedT > 0 && !d.pending), 6000, 'the lock to answer');
    return d.unlocked;
  }
  async function exit() {
    if (G().mode !== 'complete') await walkTo(G().door.x);
    await until(() => G().mode === 'complete', 3000, 'floor to complete');
  }
  window.bot = { G, frame, key, tap, until, walkTo, hop, aim, observe, terminal, talk, through, unlock, unlockByHand, exit, slab, solid, platform, settle };
}

async function main() {
  let server = null;
  let url = target;
  if (!url) ({ server, url } = await serve());
  else if (!/^[a-z]+:\/\//i.test(url)) url = pathToFileURL(path.resolve(url)).href;
  console.log(`playing ${url}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g/.test(m.text())) problems.push(`console: ${m.text()}`);
    if (/frame error/.test(m.text())) problems.push(m.text());
  });
  const shot = async (name) => {
    if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
  };
  const report = [];
  const step = async (label, fn) => {
    try {
      const out = await page.evaluate(fn);
      if (out) report.push(out);
    } catch (err) {
      await shot(`FAILED-${label.replace(/\W+/g, '-')}`);
      throw new Error(`${label}: ${err.message.split('\n')[0]}`);
    }
  };
  const nextFloor = async (index) => {
    await page.click('#btn-next');
    await page.waitForFunction((n) => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === n, index);
    await page.waitForTimeout(200);
  };

  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 60000 });
  await shot('00-title');
  const rack = () =>
    page.evaluate(() => ({ about: !document.getElementById('about').hidden, circuit: !document.getElementById('circuit').closest('.module').hidden }));
  let r = await rack();
  if (!r.about || r.circuit) throw new Error(`the title screen should show the About panel, not the instruments: ${JSON.stringify(r)}`);
  await page.evaluate(installBot);
  // In through "Skip to floor" this time; "Enter the building" is used after the ending.
  await page.click('#btn-floors');
  const offered = await page.$$eval('#title-floors:not([hidden]) button:not(.bonus)', (els) => els.map((el) => el.textContent));
  const bonusOffered = await page.$$eval('#title-floors:not([hidden]) button.bonus', (els) => els.map((el) => el.textContent));
  if (!bonusOffered.length || !bonusOffered[0].startsWith('Bonus 1.')) throw new Error(`"Skip to floor" should list the bonus levels: ${JSON.stringify(bonusOffered)}`);
  if (offered.length !== 7 || offered[6] !== '7. Lights Out') throw new Error(`"Skip to floor" should list the seven floors: ${JSON.stringify(offered)}`);
  await page.click('#title-floors button[data-floor="0"]');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);
  if (await page.$('#opt-motion')) throw new Error('the reduce-motion option should be gone');
  r = await rack();
  if (r.about || !r.circuit) throw new Error(`in play the rack should show the instruments: ${JSON.stringify(r)}`);

  // Floor 1: H, look, repeat until the platform lands raised.
  await step('floor 1 superpose', async () => {
    await bot.terminal('T1', [1]);
  });
  await page.waitForTimeout(120);
  await shot('01-superposition');
  // The circuit starts expanded: under the game, drawn whole, with its Qiskit code left in the rack.
  // Collapse puts it (and the code) back in the rack.
  const circuitBox = () =>
    page.evaluate(() => {
      const mod = document.getElementById('circuit').closest('.module');
      const gates = document.getElementById('circuit-gates');
      const code = document.getElementById('code').closest('details');
      return {
        under: !!mod.closest('.left'),
        fits: gates.scrollWidth <= gates.clientWidth + 1,
        label: document.getElementById('circuit-expand').textContent,
        codeInRack: !!code.closest('.rack') && !!code.offsetParent,
        goalFirst: document.querySelector('.rack-inner > .module:not([hidden])').contains(document.getElementById('goal')),
      };
    });
  let box = await circuitBox();
  if (!box.under || !box.fits || box.label !== 'Collapse' || !box.codeInRack || !box.goalFirst) throw new Error(`expanded circuit by default: ${JSON.stringify(box)}`);
  await shot('01b-circuit-expanded');
  await page.click('#circuit-expand');
  box = await circuitBox();
  if (box.under || box.label !== 'Expand' || !box.codeInRack) throw new Error(`collapsed circuit: ${JSON.stringify(box)}`);
  await page.click('#circuit-expand');
  box = await circuitBox();
  if (!box.under || box.label !== 'Collapse') throw new Error(`expanded again: ${JSON.stringify(box)}`);
  report.push('the circuit starts expanded under the game, the Qiskit code and the goal stay in the rack, and Collapse/Expand both work');
  await step('floor 1', async () => {
    let tries = 1;
    while ((await bot.observe('A')) !== 1) {
      await bot.terminal('T1', [1]);
      tries += 1;
    }
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    do {
      await bot.terminal('T2', [1]);
      tries += 1;
    } while ((await bot.observe('B')) !== 1);
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.exit();
    return `floor 1 cleared after ${tries} H gates, stats ${JSON.stringify(bot.G().stats)}`;
  });
  await nextFloor(1);

  // Floor 2: X, then H-X on B (which earns the fourth star). On C: one gamble first, then H-Z-H, which earns it too.
  await step('floor 2', async () => {
    await bot.tap('KeyF');
    await bot.terminal('T1', [1]);
    await bot.settle('A');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    if (bot.G().bonusDone) throw new Error('X on A alone should not earn the fourth star');
    await bot.terminal('T2', [1, 2]);
    await bot.settle('B');
    if (!bot.G().bonusDone) throw new Error('H then X on B should earn the fourth star');
    bot.G().bonusDone = false; // set aside, to check that C can earn it on its own
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.terminal('T3', [1]);
    await bot.tap('KeyF');
    const gamble = await bot.observe('C');
    await bot.tap('KeyF');
    if (bot.G().bonusDone) throw new Error('a single H and a look is not the flip gate');
    await bot.terminal('T3', [1, 2, 1]);
    if (bot.platform('C').state !== 1 - gamble) throw new Error('H Z H should flip C with certainty');
    if (!bot.G().bonusDone) throw new Error('H Z H should count as the flip gate even after a look');
    if (gamble === 1) await bot.terminal('T3', [1, 2, 1]);
    await bot.settle('C');
    if (bot.platform('C').state !== 1) throw new Error('H Z H did not raise C');
    await bot.hop(bot.slab('C'));
    await bot.hop(bot.solid(3));
    await bot.exit();
    const s = bot.G().stats;
    const r = bot.G().results[1];
    const list = [...document.querySelectorAll('#complete-star-list li')].map((li) => li.textContent);
    if (r.stars !== 4 || r.of !== 4 || list.length !== 4) throw new Error(`H Z H on C should earn the fourth star: ${JSON.stringify(r)} ${JSON.stringify(list)}`);
    return `floor 2 cleared: gambled on C (got ${gamble}), then H Z H; ${r.stars} of ${r.of} stars ("${list[3]}"), stats ${JSON.stringify(s)}`;
  });
  await nextFloor(2);

  // Floor 3: the canister. A dead port refuses you without it; one look at A reads the canister too.
  await step('floor 3 canister', async () => {
    const g = bot.G();
    if (g.canister.carried) throw new Error('the canister should start on its dock');
    await bot.walkTo(g.canister.x);
    await bot.until(() => g.canister.carried, 2000, 'pick up the canister');
    await bot.terminal('T1', [1]);
    await bot.terminal('Port A', [1]);
    if (JSON.stringify(g.q.groups) !== '[[0,1]]') throw new Error(`Q and A should be entangled: ${JSON.stringify(g.q.groups)}`);
  });
  await page.waitForTimeout(150);
  await shot('03-canister-entangled');
  await step('floor 3', async () => {
    const g = bot.G();
    let tries = 1;
    while ((await bot.observe('A')) !== 1) {
      if (g.q.definite[g.qIndex.Q] !== 0) throw new Error('the canister should read 0 when A dropped');
      await bot.terminal('T1', [1]);
      await bot.terminal('Port A', [1]);
      tries += 1;
    }
    if (g.q.definite[g.qIndex.Q] !== 1) throw new Error('the canister should read 1 when A rose');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    await bot.terminal('Port B', [1]);
    await bot.settle('B');
    if (bot.platform('B').state !== 1) throw new Error('a canister reading 1 should raise B');
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.walkTo(g.door.x - 120);
    if (await bot.unlock()) throw new Error('the door opened without a key');
    await bot.terminal('Port D', [1]);
    await bot.walkTo(g.door.x - 120);
    if (!(await bot.unlock())) throw new Error('the right key was refused');
    await bot.exit();
    return `floor 3 cleared after ${tries} entangling rounds, stats ${JSON.stringify(g.stats)}`;
  });
  await nextFloor(3);

  // Floor 4: failing flashlight, battery station, a far terminal, a two-lamp key.
  await step('floor 4 start', async () => {
    const g = bot.G();
    if (g.torch.battery !== 'low') throw new Error('the flashlight should start low');
    await bot.walkTo(g.canister.x);
    do {
      await bot.terminal('T1', [1]);
      await bot.terminal('Port A', [1]);
    } while ((await bot.observe('A')) !== 1);
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    if (g.torch.battery !== 'low') throw new Error('the flashlight should last until the battery ledge');
    await bot.hop(bot.solid(2));
    if (g.torch.battery !== 'dead') throw new Error('the flashlight should die on the battery ledge');
    const spoken = () => (g.bubbles.find((b) => b.anchor === 'player' && !(b.wait > 0)) || {}).text || '';
    if (!/It just died/.test(spoken())) throw new Error(`the player should say the flashlight died, not "${spoken()}"`);
    await bot.tap('KeyF');
    if (g.torch.active) throw new Error('a dead flashlight must not light');
    if (!/It just died/.test(spoken())) throw new Error('a new line should wait until the last one has had time to be read');
    await bot.walkTo(g.room.battery.x);
    await bot.until(() => g.room.battery.taken, 2000, 'take the battery');
    if (g.torch.battery !== 'ok') throw new Error('the battery should fix the flashlight');
  });
  await shot('04-battery-station');
  await step('floor 4', async () => {
    const g = bot.G();
    let trips = 0;
    for (;;) {
      await bot.terminal('T2', [1]);
      trips += 1;
      await bot.hop(bot.solid(1));
      if ((await bot.observe('F')) === 1) break;
      await bot.hop(bot.solid(2));
    }
    await bot.hop(bot.solid(3));
    await bot.hop(bot.slab('F'));
    await bot.hop(bot.solid(4));
    await bot.terminal('T3', [1, 2]);
    await bot.walkTo(g.door.x - 130);
    if (!(await bot.unlock())) throw new Error('the 1 1 key was refused');
    await bot.exit();
    return `floor 4 cleared after ${trips} trip(s) to the far terminal, stats ${JSON.stringify(g.stats)}`;
  });
  await nextFloor(4);

  // Floor 5: the Professor's box. Both bridge halves must read 1; one CNOT at the box makes the cat certain.
  await step('floor 5 to the professor', async () => {
    const g = bot.G();
    if (JSON.stringify(g.q.groups) !== '[[3,4]]') throw new Error(`Q and CAT should start entangled: ${JSON.stringify(g.q.groups)}`);
    // Without T1 there is no way across: jumping on from the start ledge, and again
    // from lowered A, never reaches the bridge or the next stand and ends in the gap.
    bot.key('ArrowRight', true);
    await bot.until(() => g.player.x + 18 >= 148, 3000, 'reach the edge');
    await bot.tap('Space');
    let again = false;
    let highest = 475;
    await bot.until(() => {
      const pl = g.player;
      if (pl.onGround) highest = Math.min(highest, pl.y + 32);
      if (!again && pl.onGround && pl.x > 160 && pl.x + 18 >= 272) {
        again = true;
        bot.key('Space', true);
      } else if (again) bot.key('Space', false);
      return g.mode !== 'play';
    }, 8000, 'the fall');
    bot.key('ArrowRight', false);
    if (g.mode !== 'falling' || highest < 475) throw new Error(`the first gap should not be crossable without T1 (stood at y=${highest})`);
    await bot.until(() => g.mode === 'play', 4000, 'the floor to reset');
    await bot.terminal('T1', [1]);
    await bot.settle('A');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    await bot.hop(bot.solid(2));
    await bot.hop(bot.solid(3));
    if (g.door.open) throw new Error('the exit should be locked');
    await bot.talk('professor');
    if (g.hasKey) throw new Error('the Professor must not open an uncertain box');
    await bot.hop(bot.solid(4));
    await bot.terminal('T2', [1, 2]);
    if (g.room.terminals.find((t) => t.id === 'T2').ops.length !== 2) throw new Error('T2 should offer H on E and CNOT E to F only');
  });
  await page.waitForTimeout(150);
  await shot('05-broken-bridge');
  await step('floor 5', async () => {
    const g = bot.G();
    let tries = 1;
    while ((await bot.observe('E')) !== 1) {
      await bot.terminal('T2', [1, 2]);
      tries += 1;
    }
    if (bot.platform('F').state !== 1) throw new Error('the two halves should rise together');
    await bot.hop(bot.slab('E'));
    await bot.hop(bot.slab('F'));
    await bot.hop(bot.solid(5));
    await bot.walkTo(g.canister.x);
    await bot.until(() => g.canister.carried, 2000, 'take the canister');
    await bot.hop(bot.slab('F'));
    await bot.hop(bot.slab('E'));
    await bot.hop(bot.solid(4));
    await bot.hop(bot.solid(3));
    await bot.terminal('Box port', [1]);
    if (g.q.definite[g.qIndex.CAT] !== 0) throw new Error('CNOT Q to CAT should leave the atom certainly intact');
    await bot.talk('professor');
    await bot.until(() => g.hasKey && g.door.open, 3000, 'the key');
    const box = g.room.terminals.find((t) => t.box);
    await bot.walkTo(box.x - 14);
    await bot.until(() => box.near, 2000, 'stand by the box');
    await bot.frame();
    const prompt = document.getElementById('prompt').textContent;
    if (!/pet the cat/.test(prompt)) throw new Error(`the box should offer the cat, not its port: "${prompt}"`);
    await bot.tap('KeyE');
    await bot.frame();
    if (g.mode !== 'play' || !g.bubbles.some((b) => b.cat && /meow/.test(b.text))) throw new Error('petting the cat should get a meow');
    await bot.exit();
    return `floor 5 cleared after ${tries} bridge round(s), cat petted, stats ${JSON.stringify(g.stats)}`;
  });
  await shot('06-cat-alive');
  await nextFloor(5);

  // Floor 6: teleportation, twice if the first note calls for a fix: once skipping it (refused), once properly.
  const teleport = async (label, skipFix) =>
    step(label, async () => {
      const g = bot.G();
      const lamps = [...document.querySelectorAll('#probs .q-chip.q-door')].map((el) => el.textContent).join(' ');
      if (lamps !== 'B L') throw new Error(`both lock qubits should be marked in the rack, got "${lamps}"`);
      if (!g.canister.carried) {
        await bot.talk('bob');
        await bot.walkTo(g.canister.x);
        await bot.until(() => g.canister.carried, 2000, 'take the canister');
      }
      await bot.terminal('T1', [1, 2]);
      while (bot.platform('P').state !== 1) {
        await bot.terminal('T2', [1]); // H only: the platform has to be observed
        if (bot.platform('P').state !== null) throw new Error('T2 should leave P in superposition');
        await bot.observe('P');
      }
      await bot.settle('P');
      await bot.hop(bot.slab('P'));
      await bot.hop(bot.solid(1));
      await bot.through('TO ALICE');
      await bot.talk('alice');
      await bot.terminal('T3', [1, 2, 3]);
      const note = g.flags.note;
      if (!note) throw new Error('Alice should have printed a note');
      await bot.through('TO BOB');
      const needed = [...(note.q ? [3] : []), ...(note.m ? [4] : [])];
      const skip = window.skipFix && needed.length > 0; // a 0 0 note needs no fix, so there is nothing to skip
      await bot.hop(bot.slab('P'));
      await bot.hop(bot.solid(0));
      const fixes = skip ? [] : needed;
      if (fixes.length) await bot.terminal('T1', fixes);
      await bot.hop(bot.slab('P'));
      await bot.hop(bot.solid(1));
      await bot.hop(bot.solid(2));
      const opened = await bot.unlockByHand();
      if (skip) {
        if (opened) throw new Error(`the lock opened although the fix for M=${note.m} Q=${note.q} was skipped`);
        await bot.until(() => !g.door.pending, 3000, 'a fresh key');
        if (g.flags.note || JSON.stringify(g.q.groups) !== '[[3,4]]') throw new Error('a refused key should be replaced by a fresh entangled one');
        await bot.hop(bot.solid(1));
        await bot.hop(bot.slab('P'));
        await bot.hop(bot.solid(0));
        return `floor 6: skipping the fix for M=${note.m} Q=${note.q} was refused, and a fresh key was prepared`;
      }
      if (!opened) throw new Error(`the lock refused a correct teleport, note M=${note.m} Q=${note.q}`);
      await bot.exit();
      if (g.stats.looks < 1) throw new Error('reaching Alice should have taken at least one observation');
      return `floor 6 cleared: note M=${note.m} Q=${note.q}, stats ${JSON.stringify(g.stats)}`;
    });
  await page.evaluate(() => {
    window.skipFix = true;
  });
  await teleport('floor 6 without the fix');
  await shot('07-teleport-refused');
  if (await page.evaluate(() => window.blackoutLab.state.mode !== 'complete')) {
    await page.evaluate(() => {
      window.skipFix = false;
    });
    await teleport('floor 6');
  }
  await shot('08-teleported');
  await nextFloor(6);

  // Floor 7: no flashlight. Every platform is put in place with gates alone: D lowered, the rest raised.
  await step('floor 7', async () => {
    const g = bot.G();
    if (g.torch.battery !== 'dead') throw new Error('the flashlight should be dead');
    await bot.tap('KeyF');
    if (g.torch.active) throw new Error('a dead flashlight must not light');
    await bot.terminal('T1', [1, 2, 1]);
    await bot.settle('A');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    await bot.terminal('T2', [1, 2, 3]);
    await bot.settle('B');
    await bot.settle('E');
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.terminal('T3', [1, 2, 3]);
    await bot.settle('C');
    await bot.settle('D');
    const d = g.q.definite;
    const got = ['A', 'B', 'C', 'D', 'E'].map((q) => d[g.qIndex[q]]).join('');
    if (got !== '11101') throw new Error(`A B C D E should be certain 1 1 1 0 1, got ${got}`);
    if (!document.querySelector('#circuit').textContent.includes('D')) throw new Error('platform D should be named in the circuit');
    await bot.hop(bot.slab('C'));
    await bot.hop(bot.slab('D'));
    await bot.hop(bot.slab('E'));
    await bot.hop(bot.solid(3));
    if (g.player.x > g.door.x + 300) throw new Error('the exit ledge should be at the top left');
    await bot.terminal('T4', [1, 3]);
    if (!(await bot.unlockByHand())) throw new Error('the 1 0 1 key was refused');
    await bot.exit();
    if (g.stats.looks !== 0 || g.stats.gates !== 11) throw new Error(`floor 7 should take 11 gates and no observations: ${JSON.stringify(g.stats)}`);
    const line = document.getElementById('complete-stats').textContent;
    if (!/no observations/.test(line) || !/no unlucky collapses/.test(line)) throw new Error(`floor 7 summary: "${line}"`);
    const res = g.results[6];
    const list = [...document.querySelectorAll('#complete-star-list li')].map((li) => li.textContent);
    if (res.of !== 4 || list[3] !== 'Completed within 2 minutes') throw new Error(`floor 7 should have a timed fourth star: ${JSON.stringify(list)}`);
    if ((res.stars === 4) !== (g.floorTime <= 120)) throw new Error(`timed star does not match the time taken: ${res.stars} stars in ${g.floorTime}s`);
    return `floor 7 cleared in the dark in ${Math.round(g.floorTime)} s, ${res.stars} of ${res.of} stars, summary "${line}"`;
  });
  await shot('09-floor7-complete');

  // The ending: up to the terrace, crank the generator, and the rest plays itself.
  await nextFloor(7);
  await shot('10-terrace');
  await step('terrace', async () => {
    const g = bot.G();
    const sc = g.scene;
    if (!g.level.outdoor || sc.phase !== 'walk') throw new Error('the last exit should lead to the terrace');
    if (g.player.x > 260) throw new Error(`the player should arrive at the left of the terrace, not x=${g.player.x}`);
    bot.key('ArrowRight', true);
    await bot.until(() => sc.near, 9000, 'reach the generator');
    await bot.until(() => g.player.x + 18 > g.level.scene.generator.x - 50, 3000, 'walk up to the crank');
    bot.key('ArrowRight', false);
    await bot.until(() => Math.abs(g.player.vx) < 1, 2000, 'stop');
    if (g.player.x + 18 >= g.level.scene.generator.x - 30) throw new Error('the player should not walk through the generator');
    await bot.tap('KeyE');
    await bot.until(() => sc.phase === 'power', 6000, 'the generator to catch');
    await bot.until(() => sc.power === 1, 6000, 'every light to come on');
  });
  await shot('11-power-restored');
  await step('ending', async () => {
    const g = bot.G();
    const sc = g.scene;
    const said = [];
    const seen = new Set();
    await bot.until(() => {
      if (sc.line && !seen.has(sc.line.text)) {
        seen.add(sc.line.text);
        said.push(`${sc.line.who}: ${sc.line.text}`);
      }
      return sc.phase === 'meow';
    }, 30000, 'the conversation');
    if (sc.alarm) throw new Error('nobody should be alarmed the moment the cat meows');
    if (sc.actors.some((a) => !a.out)) throw new Error('all three should be out on the terrace');
    await bot.until(() => sc.alarm, 8000, 'the alarm');
    if (sc.cat.state !== 'run') throw new Error(`the alarm should come as the cat runs for the edge, not while she is "${sc.cat.state}"`);
    const xs = sc.actors.map((a) => a.x).sort((a, b) => a - b);
    if (xs[1] - xs[0] < 30 || xs[2] - xs[1] < 30) throw new Error(`they should stand side by side: ${xs}`);
    await bot.until(() => sc.cat.state === 'jump', 8000, 'the cat to jump');
    await bot.until(() => g.mode === 'win', 12000, 'the final screen');
    const expected = ['Professor: You restored power! Hurray!', 'Alice: Can we now test the cat teleportation protocol?', 'Cat: MEOW'];
    if (JSON.stringify(said) !== JSON.stringify(expected)) throw new Error(`unexpected lines: ${JSON.stringify(said)}`);
    const title = document.getElementById('win-h').textContent;
    const floors = document.querySelectorAll('#win-floors button:not(.bonus)').length;
    if (title !== 'Thank you for playing.' || floors !== 7) throw new Error(`final screen: "${title}", ${floors} floor buttons`);
    return `ending played: ${said.join(' / ')}; then "${title}" with ${document.getElementById('win-stars').textContent}`;
  });
  await page.waitForTimeout(300);
  await shot('12-thank-you');

  // "Replay a specific floor", then "Return to start".
  await page.click('#win-floors button[data-floor="2"]');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 2);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '7');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 7);
  await page.evaluate(() => {
    window.blackoutLab.state.scene.phase = 'fade'; // skip to the end of the ending
  });
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'win');
  await page.click('#btn-home');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'title' && window.blackoutLab.state.levelIndex === 0 && !window.blackoutLab.state.level.outdoor);
  await page.waitForTimeout(300);
  await shot('13-back-at-start');
  r = await rack();
  if (!r.about || r.circuit) throw new Error(`back at the title the rack should show the About panel again: ${JSON.stringify(r)}`);
  report.push('replaying floor 3 from the final screen and returning to start both work');

  // A superposed platform cannot be landed on, and jumping at it is not a measurement.
  await page.click('#btn-start');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);
  await step('no landing on a superposition', async () => {
    const g = bot.G();
    await bot.tap('KeyF');
    await bot.terminal('T1', [1]);
    const a = bot.platform('A');
    if (a.state !== null) throw new Error('A should be in superposition');
    const before = g.q.ops.length;
    bot.key('ArrowRight', true);
    await bot.until(() => g.player.x + 18 >= 148, 3000, 'reach the edge');
    await bot.tap('Space');
    let collapsed = false;
    await bot.until(() => {
      if (a.state !== null || g.q.ops.length !== before) collapsed = true;
      return g.mode !== 'play';
    }, 5000, 'the fall');
    bot.key('ArrowRight', false);
    if (collapsed) throw new Error('jumping at a superposed platform must not collapse it');
    if (g.mode !== 'falling' || g.lives !== 2) throw new Error(`the player should fall through and lose a life: ${g.mode}, ${g.lives}`);
    await bot.until(() => g.mode === 'play', 4000, 'the floor to reset');
    return 'jumping at superposed A: no collapse, straight through, one life lost';
  });

  // Three falls on one floor send the player back to floor 1.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '2');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 2);
  await step('falling', async () => {
    const lives = [];
    for (let i = 0; i < 3; i += 1) {
      bot.key('ArrowRight', true);
      await bot.until(() => bot.G().mode !== 'play', 6000, 'a fall');
      bot.key('ArrowRight', false);
      lives.push(bot.G().lives);
      if (i < 2) await bot.until(() => bot.G().mode === 'play', 4000, 'the floor to reset');
    }
    await bot.until(() => bot.G().mode === 'over', 4000, 'out of lives');
    return `on floor 3, falls left lives at ${lives.join(', ')} then out of lives`;
  });
  await shot('14-out-of-lives');
  await page.click('#btn-retry');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0 && window.blackoutLab.state.lives === 3);
  report.push('out of lives on floor 3 restarted the climb from floor 1 with three lives');

  // Bonus level 1, Quantum Communication: a shuttle, a backup light, a sideways shield.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', { label: 'Bonus 1. Quantum Communication' });
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'channel');
  await step('bonus level 1', async () => {
    const g = bot.G();
    const Q = bot.platform('Q');
    const S = bot.platform('S');
    if (g.torch.on) throw new Error('the flashlight should start switched off here');
    if (document.getElementById('hud-floor').textContent !== 'Bonus level 1') throw new Error('the status bar should say Bonus level 1');
    const home = () => bot.until(() => Q.trip === null && !Q.pending, 15000, 'Q to come home');
    // Unshielded: the backup light measures Q on its way, before the far terminal's Z.
    await bot.terminal('T1', [2]);
    await bot.until(() => Q.trip === 'out', 2000, 'Q to set off');
    await home();
    const first = g.q.ops.map((op) => `${op.gate}${op.by ? `:${op.by}` : ''}`).join(' ');
    if (first !== 'h measure:light z') throw new Error(`unshielded, the light should measure Q before the Z: ${first}`);
    // Shielded: X slides S under the light, then H, the trip's Z, and H again make an X.
    // (Unshielded, the light may have left Q raised by luck; carry on until the X is built.)
    await bot.terminal('T1', [3]);
    await bot.until(() => S.state === 1 && S.x === S.x1, 3000, 'the shield to slide in');
    let trips = 0;
    while (!(Q.state === 1 && g.bonusDone) && trips < 8) {
      const before = g.q.ops.length;
      await bot.terminal('T1', [2]);
      await home();
      trips += 1;
      if (g.q.ops.slice(before).some((op) => op.by === 'light')) throw new Error('the shielded light still measured Q');
    }
    if (Q.state !== 1 || !g.bonusDone) throw new Error('H, Z, H should bring Q home raised');
    await bot.hop(bot.slab('Q'));
    await bot.hop(bot.solid(1));
    await bot.exit();
    const stars = [...document.querySelectorAll('#complete-star-list li')].map((li) => (li.classList.contains('missed') ? '-' : '+') + li.textContent);
    if (document.getElementById('complete-eyebrow').textContent !== 'Bonus level 1 cleared' || document.getElementById('btn-next').textContent !== 'Next bonus level') {
      throw new Error('a bonus level should end with its own cleared screen');
    }
    return `bonus level 1: unshielded the light measured Q (${first}); shielded, ${trips} trips brought Q home raised; stars ${stars.join(', ')}`;
  });
  await shot('15b-bonus-cleared');
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'channel-emergency');

  // Bonus level 2: the same channel, with an emergency light that damps Q to 0.
  await step('bonus level 2', async () => {
    const g = bot.G();
    const Q = bot.platform('Q');
    const S = bot.platform('S');
    if (S.state !== 1 || S.x !== S.x1) throw new Error('the shield should start parked, out of the light');
    const home = () => bot.until(() => Q.trip === null && !Q.pending, 15000, 'Q to come home');
    await bot.terminal('T1', [2]);
    await home();
    const first = g.q.ops.map((op) => `${op.gate}${op.by ? `:${op.by}` : ''}`).join(' ');
    if (first !== 'h reset:emergency z' || Q.state !== 0) throw new Error(`unshielded, the emergency light should damp Q to 0: ${first}, Q=${Q.state}`);
    await bot.terminal('T1', [3]);
    await bot.until(() => S.state === 0 && S.x === S.x0, 3000, 'the shield to slide in');
    let trips = 0;
    while (!(Q.state === 1 && g.bonusDone) && trips < 6) {
      const before = g.q.ops.length;
      await bot.terminal('T1', [2]);
      await home();
      trips += 1;
      if (g.q.ops.slice(before).some((op) => op.by === 'emergency')) throw new Error('the shielded emergency light still reached Q');
    }
    if (Q.state !== 1 || S.state !== 0) throw new Error('Q should come home raised, with the shield still in place');
    await bot.hop(bot.slab('Q'));
    await bot.hop(bot.solid(1));
    await bot.exit();
    return `bonus level 2: unshielded the emergency light damped Q (${first}); the shield (blocking at 0) stayed put, and ${trips} trips brought Q home raised`;
  });
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'decoherence');

  // Bonus level 3: weak lights over every platform; a timed H Z H, then A = 0 and B = 1 through CZ.
  await step('bonus level 3', async () => {
    const g = bot.G();
    const P = bot.platform('P');
    const A = bot.platform('A');
    const B = bot.platform('B');
    // The deadline: H on P, then wait at the terminal. The weak light measures P within a few seconds.
    const t1 = g.room.terminals.find((t) => t.id === 'T1');
    await bot.walkTo(t1.x);
    await bot.until(() => t1.near, 2000, 'stand at T1');
    await bot.tap('KeyE');
    await bot.until(() => g.mode === 'terminal', 2000, 'T1 to open');
    const opened = performance.now();
    document.querySelector('#term-ops button[data-op="0"]').click();
    await bot.until(() => P.state === null, 2000, 'P in superposition');
    await bot.until(() => P.state !== null, 4000, 'the weak light to catch P');
    const caughtAfter = (performance.now() - opened) / 1000;
    const last = g.q.ops[g.q.ops.length - 1];
    if (g.mode !== 'terminal' || last.by !== 'light' || caughtAfter < 2) throw new Error(`the weak light should measure P after about 2.25 s, even at the terminal: ${JSON.stringify(last)} after ${caughtAfter.toFixed(2)} s in ${g.mode}`);
    await bot.tap('KeyE');
    await bot.until(() => g.mode === 'play', 2000, 'T1 to close');
    let tries = 0;
    // Stage 1: H, Z, H on P, quickly (a lucky collapse to 1 would do as well).
    while (P.state !== 1 && tries < 6) {
      await bot.terminal('T1', P.state === 0 ? [1, 2, 1] : [2]);
      await bot.until(() => P.state !== null, 4000, 'P to settle');
      tries += 1;
    }
    if (P.state !== 1) throw new Error('P should be raised');
    await bot.settle('P');
    await bot.hop(bot.slab('P'));
    await bot.hop(bot.solid(1));
    // Stage 2: H Z H on A; H on B; CZ; H on B; H Z H on A. Retry from scratch if a light catches one.
    let rounds = 0;
    while (!(A.state === 0 && B.state === 1) && rounds < 6) {
      const steps = [];
      if (A.state !== 0 || B.state !== 0) {
        // Bring them back to 0 0 first: a certain 1 becomes 0 with H Z H.
        if (A.state === 1) steps.push(1, 2, 1);
        if (B.state === 1) throw new Error('B is 1 but A is not 0: unexpected');
      }
      steps.push(1, 2, 1, 3, 4, 3, 1, 2, 1);
      await bot.terminal('T2', steps);
      await bot.until(() => A.state !== null && B.state !== null, 5000, 'A and B to settle');
      rounds += 1;
    }
    if (A.state !== 0 || B.state !== 1) throw new Error(`A should be 0 and B 1: ${A.state} ${B.state}`);
    await bot.settle('A');
    await bot.settle('B');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.exit();
    return `bonus level 3: left in superposition at T1, P was measured by the weak light after ${caughtAfter.toFixed(2)} s; P raised after ${tries} more try at T1; A=0, B=1 after ${rounds} round(s) at T2; crossed to the exit in ${Math.round(g.floorTime)} s`;
  });
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'rabi');

  // Bonus level 4: Rabi oscillation and the watchdog effect.
  await step('bonus level 4', async () => {
    const g = bot.G();
    const P = bot.platform('P');
    const A = bot.platform('A');
    const B = bot.platform('B');
    const S = bot.platform('S');
    // Unwatched, P turns round: its chance of 1 sweeps up and down.
    let lo = 1;
    let hi = 0;
    const end = performance.now() + 4200;
    while (performance.now() < end) {
      lo = Math.min(lo, P.p1);
      hi = Math.max(hi, P.p1);
      await bot.frame();
    }
    if (lo > 0.05 || hi < 0.95) throw new Error(`P should swing between 0 and 1 by itself: ${lo} to ${hi}`);
    // T1: Ry(pi/2) twice puts B half a turn ahead of A.
    await bot.terminal('T1', [1, 1]);
    // Freeze P lowered with the flashlight (switched off to start with), as it comes down to 0.
    let freezes = 0;
    while (P.state !== 0 && freezes < 6) {
      if (g.torch.on) await bot.tap('KeyF');
      bot.aim(P.x + P.w / 2, P.y0 + 6);
      await bot.until(() => P.p1 < 0.05, 6000, 'P to come round to 0');
      await bot.tap('KeyF');
      await bot.until(() => P.state !== null, 3000, 'P to collapse');
      freezes += 1;
    }
    if (P.state !== 0 || P.driven !== 'held') throw new Error(`P should be frozen lowered: ${P.state} ${P.driven}`);
    await bot.hop(bot.slab('P'));
    if (g.player.standing !== P || P.driven !== 'held') throw new Error('standing on P should keep it frozen');
    const heldAt = g.q.ops.length;
    bot.aim(60, 120); // look away: only standing on P holds it now
    for (let k = 0; k < 40; k += 1) await bot.frame();
    if (P.state !== 0 || g.q.ops.length !== heldAt) throw new Error('P should stay frozen while the player stands on it');
    await bot.hop(bot.solid(1));
    // T2: slide the shield in as A comes round to 0 (B is then at 1), then light both up.
    let rounds = 0;
    while (!(A.state === 0 && B.state === 1) && rounds < 6) {
      const t2 = g.room.terminals.find((t) => t.id === 'T2');
      await bot.walkTo(t2.x);
      await bot.until(() => t2.near, 2000, 'stand at T2');
      await bot.tap('KeyE');
      await bot.until(() => g.mode === 'terminal', 2000, 'T2 to open');
      if (S.state === 1) {
        document.querySelector('#term-ops button[data-op="0"]').click(); // shield out: A and B turn again
        await bot.until(() => S.state === 0, 1000, 'the shield to go');
        for (let k = 0; k < 30; k += 1) await bot.frame();
      }
      await bot.until(() => A.p1 < 0.03, 6000, 'A to come round to 0');
      document.querySelector('#term-ops button[data-op="0"]').click();
      await bot.until(() => S.state === 1 && S.x === S.x1, 1000, 'the shield to cut the waves');
      const frozen = [A.p1, B.p1];
      for (let k = 0; k < 20; k += 1) await bot.frame();
      if (Math.abs(A.p1 - frozen[0]) > 1e-6 || Math.abs(B.p1 - frozen[1]) > 1e-6) throw new Error('behind the shield, A and B should stop turning');
      await bot.tap('KeyE');
      await bot.until(() => g.mode === 'play', 2000, 'T2 to close');
      bot.aim(600, 330);
      await bot.until(() => A.state !== null && B.state !== null, 4000, 'A and B to collapse');
      rounds += 1;
    }
    if (A.state !== 0 || B.state !== 1) throw new Error(`A should be 0 and B 1: ${A.state} ${B.state}`);
    await bot.settle('A');
    await bot.settle('B');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.exit();
    if (document.getElementById('btn-next').textContent !== 'Back to title') throw new Error('after the last bonus level, Next should lead back to the title');
    return `bonus level 4: P swung between ${lo.toFixed(2)} and ${hi.toFixed(2)} unwatched; frozen lowered after ${freezes} flashlight try, held while stood on; A=0, B=1 after ${rounds} shield round(s)`;
  });
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'title');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);

  // The Main menu button, top right, goes back to the title from anywhere in a floor.
  if (!(await page.isDisabled('#btn-menu'))) {
    await page.click('#btn-menu');
  } else throw new Error('Main menu should be enabled during play');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'title' && !document.getElementById('screen-title').hidden);
  if (!(await page.isDisabled('#btn-menu'))) throw new Error('Main menu should be disabled on the title screen');
  report.push('the Main menu button returns to the title and is disabled there');

  // Developer options: off by default, switched on the title screen, remembered.
  const dev = () => page.evaluate(() => ({ ...window.blackoutLab.state.dev }));
  let d = await dev();
  if (d.keyTorch || d.touchCollapse || d.circuitRight || d.panel !== 'right') throw new Error(`developer options should start off: ${JSON.stringify(d)}`);
  await page.click('#dev summary');
  await page.click('#dev-panel-bottom');
  await page.waitForTimeout(200);
  const layout = await page.evaluate(() => ({
    rackTop: document.querySelector('.rack').getBoundingClientRect().top,
    gameBottom: document.getElementById('viewport').getBoundingClientRect().bottom,
    wide: document.querySelector('.rack').getBoundingClientRect().width > window.innerWidth * 0.8,
  }));
  if (layout.rackTop < layout.gameBottom || !layout.wide) throw new Error(`Panel: Bottom should put the rack under the game, full width: ${JSON.stringify(layout)}`);
  await shot('15-panel-bottom');
  await page.click('#dev-panel-right');
  await page.click('#dev-circuit-right');
  await page.click('#dev-key-torch');
  await page.click('#dev-touch-collapse');
  d = await dev();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('blackoutLab.dev') || 'null'));
  if (!d.keyTorch || !d.touchCollapse || !d.circuitRight || d.panel !== 'right' || JSON.stringify(saved) !== JSON.stringify(d)) {
    throw new Error(`developer switches did not take or were not saved: ${JSON.stringify(d)} vs ${JSON.stringify(saved)}`);
  }
  report.push('Panel: Bottom moved the rack under the game; the developer switches turn on and are remembered');

  // Circuit always adds to the right: on floor 6, X on B goes after the floor's own two gates.
  if (await page.isHidden('#title-floors')) await page.click('#btn-floors');
  await page.click('#title-floors button[data-floor="5"]');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 5);
  await step('circuit always adds to the right', async () => {
    await bot.terminal('T1', [3]);
    const xOf = (label) => [...document.querySelectorAll('#circuit-gates .gate text')].filter((t) => t.textContent === label).map((t) => Number(t.getAttribute('x')));
    const seq = { h: xOf('H')[0], x: xOf('X')[0] };
    document.getElementById('dev-circuit-right').click();
    await bot.frame();
    const packed = { h: xOf('H')[0], x: xOf('X')[0] };
    document.getElementById('dev-circuit-right').click();
    await bot.frame();
    if (!(seq.x > seq.h) || packed.x !== packed.h) throw new Error(`X should sit after the floor's gates only when the option is on: on ${JSON.stringify(seq)}, off ${JSON.stringify(packed)}`);
    return `circuit always adds to the right: X on B drawn at x=${seq.x} after H at x=${seq.h} (x=${packed.x} with the option off)`;
  });

  // Keyboard flashlight on floor 1: the mouse does nothing, F held shines straight ahead.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '0');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);
  await step('keyboard flashlight', async () => {
    const g = bot.G();
    bot.aim(500, 100);
    await bot.frame();
    await bot.frame();
    if (g.torch.active || g.torch.useMouse) throw new Error('with the keyboard flashlight the beam is off until F is held, and the mouse is ignored');
    bot.key('KeyF', true);
    await bot.frame();
    await bot.frame();
    const right = { active: g.torch.active, angle: g.torch.angle };
    bot.aim(10, 500);
    await bot.frame();
    const stillRight = g.torch.angle;
    await bot.tap('ArrowLeft');
    await bot.frame();
    const left = g.torch.angle;
    bot.key('KeyF', false);
    await bot.frame();
    await bot.frame();
    if (!right.active || right.angle !== 0 || stillRight !== 0 || Math.abs(left - Math.PI) > 1e-9 || g.torch.active) {
      throw new Error(`F held should shine straight ahead whatever the mouse does: ${JSON.stringify({ right, stillRight, left, after: g.torch.active })}`);
    }
    return 'keyboard flashlight: off until F is held, then straight ahead (0, then pi facing left), mouse ignored';
  });

  // The pause screen shows the controls and the developer options, which return to the title afterwards.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  const pauseHas = await page.evaluate(() => ({
    dev: !!document.querySelector('#screen-pause #dev'),
    keys: document.querySelectorAll('#screen-pause .keys dt').length,
  }));
  if (!pauseHas.dev || pauseHas.keys < 5) throw new Error(`the pause screen should show the developer options and the controls: ${JSON.stringify(pauseHas)}`);
  await shot('16-pause-dev');
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play');
  report.push(`the pause screen shows the developer options and ${pauseHas.keys} controls`);

  // Passive terminal + instant response: standing at T1 shows its gates, 1 applies H, and the
  // platform moves while the gates are showing. (Keyboard flashlight is on, so nothing is observed.)
  await page.evaluate(() => {
    document.getElementById('dev-passive-terminal').click();
    document.getElementById('dev-instant').click();
  });
  await step('passive terminal', async () => {
    const g = bot.G();
    await bot.walkTo(g.room.terminals[0].x);
    await bot.until(() => g.passive && !document.getElementById('dock-terminal').hidden, 2000, 'T1 to show passively');
    const key = document.querySelector('#term-ops .op-key');
    if (!key || key.textContent !== '1') throw new Error('each gate should show its number key');
    if (g.mode !== 'play') throw new Error(`a passive terminal must not take over: mode ${g.mode}`);
    const before = g.q.ops.length;
    await bot.tap('Digit1');
    await bot.until(() => g.q.ops.length === before + 1, 2000, '1 to apply H');
    await bot.tap('Digit1');
    await bot.until(() => g.q.ops.length === before + 2, 2000, '1 again to undo it');
    const a = bot.platform('A');
    if (a.state !== 0) throw new Error('H twice should leave A lowered');
    // E steps in: the gate buttons take the keys (arrows, then Enter or Space), and the numbers still work.
    await bot.tap('KeyE');
    await bot.until(() => g.mode === 'terminal', 2000, 'E to step into T1');
    await bot.frame();
    const focused = document.activeElement;
    if (!focused.matches('.op-btn') || !focused.querySelector('.op-key')) throw new Error('stepping in should focus a numbered gate button');
    focused.click(); // what Enter or Space does on the focused button
    await bot.until(() => g.q.ops.length === before + 3, 2000, 'the focused gate');
    await bot.tap('Digit1');
    await bot.until(() => g.q.ops.length === before + 4, 2000, '1 inside the terminal');
    await bot.tap('KeyE');
    await bot.until(() => g.mode === 'play' && g.passive, 2000, 'E to step out, gates still showing');
    if (a.state !== 0) throw new Error('four H gates should leave A lowered');
    bot.key('ArrowLeft', true);
    await bot.until(() => !g.passive, 2000, 'walking away to hide the gates');
    bot.key('ArrowLeft', false);
    return 'passive terminal: standing at T1 showed its numbered gates and 1 applied H; E stepped in (focused button and 1 both applied H) and E stepped out; walking away hid them';
  });
  // Passive terminal also opens an exit by itself once every lamp is certain and matches the key.
  // (The lamp readings are set directly here; floor 3's real play is covered above.)
  const autoOpen = async (floor, lamps) => {
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
    await page.selectOption('#opt-floor', String(floor));
    await page.waitForFunction((f) => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === f, floor);
    return page.evaluate(async (lamps) => {
      const g = window.blackoutLab.state;
      const d = g.door;
      const frames = async (n) => { for (let i = 0; i < n; i += 1) await new Promise((r) => requestAnimationFrame(r)); };
      const set = (bits) => {
        const definite = g.q.definite.slice();
        d.lockQi.forEach((q, i) => { definite[q] = bits[i] === '?' ? null : Number(bits[i]); });
        g.q = { ...g.q, definite };
      };
      set(lamps.wrong);
      await frames(10);
      const shutOnWrong = !d.open;
      set(lamps.right);
      await frames(10);
      return { shutOnWrong, open: d.open, key: d.key };
    }, lamps);
  };
  let auto = await autoOpen(2, { wrong: '?', right: '1' });
  if (!auto.shutOnWrong || !auto.open) throw new Error(`floor 3's exit should open by itself on the right key only: ${JSON.stringify(auto)}`);
  const floor6 = await autoOpen(5, { wrong: '01', right: '00' });
  if (floor6.open) throw new Error('floor 6 runs its own gates before reading, so its exit must still be tried by hand');
  report.push(`passive terminal: floor 3's exit opened by itself once its lamp was certainly ${auto.key}, not while uncertain; floor 6's self-checking lock did not`);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '0');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);

  // Instant response on its own: floor 2's T1 flips A with X, and A moves while the terminal is open.
  await page.evaluate(() => document.getElementById('dev-passive-terminal').click());
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '1');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 1);
  await step('instant response', async () => {
    const g = bot.G();
    const a = bot.platform('A');
    const term = g.room.terminals.find((t) => t.id === 'T1');
    await bot.walkTo(term.x);
    await bot.until(() => term.near, 2000, 'stand at T1');
    await bot.tap('KeyE');
    await bot.until(() => g.mode === 'terminal', 2000, 'T1 to open');
    const y0 = a.y;
    document.querySelector('#term-ops button').click();
    await bot.until(() => a.state === 0, 2000, 'X to flip A');
    await bot.until(() => a.y === a.y0, 2000, 'A to glide down while T1 is open');
    if (g.mode !== 'terminal' || y0 === a.y) throw new Error('A should move while the terminal is open');
    await bot.tap('KeyE');
    await bot.until(() => g.mode === 'play', 2000, 'T1 to close');
    return `instant response: X at T1 moved A from y=${y0} to y=${a.y} with the terminal still open`;
  });
  await page.evaluate(() => document.getElementById('dev-instant').click());
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '0');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);

  // Touch-collapse: jumping onto a superposed platform measures it. Retry until both outcomes are seen.
  await step('touch-collapse', async () => {
    const seen = {};
    for (let round = 0; round < 12 && !(seen.raised && seen.lowered); round += 1) {
      const g = bot.G();
      await bot.until(() => g.mode === 'play', 4000, 'play');
      await bot.terminal('T1', [1]);
      const a = bot.platform('A');
      if (a.state !== null) throw new Error('A should be in superposition');
      bot.key('ArrowRight', true);
      await bot.until(() => g.player.x + 18 >= 148, 3000, 'reach the edge');
      await bot.tap('Space');
      await bot.until(() => a.state !== null || g.mode !== 'play', 3000, 'touching A');
      bot.key('ArrowRight', false);
      const op = g.q.ops[g.q.ops.length - 1];
      if (a.state === null || op.kind !== 'measure' || op.by !== 'touch') throw new Error(`landing on A should measure it: ${JSON.stringify(op)}`);
      await bot.until(() => g.player.onGround || g.mode !== 'play', 3000, 'landing');
      if (a.state === 1 && g.player.standing !== a) throw new Error('A collapsed raised, under the player: they should be standing on it');
      seen[a.state ? 'raised' : 'lowered'] = (seen[a.state ? 'raised' : 'lowered'] || 0) + 1;
      document.getElementById('btn-restart').click();
      await bot.until(() => g.mode === 'play' && bot.platform('A').state === 0, 4000, 'restart');
    }
    if (!seen.raised || !seen.lowered) throw new Error(`expected both outcomes over 12 tries: ${JSON.stringify(seen)}`);
    return `touch-collapse: landing on A's outline measured it every time (raised and landed ${seen.raised}x, lowered ${seen.lowered}x)`;
  });

  // Canister view: holding the canister shows it enlarged in the rack, with its state or its partner.
  await page.evaluate(() => document.getElementById('dev-canister-view').click());
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '2');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 2);
  await step('canister view', async () => {
    const g = bot.G();
    const tile = document.getElementById('canister-module');
    const text = () => document.getElementById('canister-state').dataset.state;
    if (!tile.classList.contains('is-off')) throw new Error('the canister view should stay hidden until the canister is picked up');
    await bot.walkTo(g.canister.x);
    await bot.until(() => g.canister.carried && !tile.classList.contains('is-off'), 2000, 'the canister view to appear');
    const seen = [text()];
    await bot.terminal('T1', [1]);
    await bot.until(() => text() === '|+⟩', 2000, 'the view to show |+⟩');
    seen.push(text());
    await bot.terminal('Port A', [1]);
    await bot.until(() => text() === 'Entangled with A', 2000, 'the view to show the entanglement');
    seen.push(text());
    if (seen[0] !== '|0⟩') throw new Error(`a fresh canister should read |0⟩: ${seen}`);
    const box = document.getElementById('canister-view').getBoundingClientRect();
    if (box.height < 100 || getComputedStyle(document.getElementById('canister-view')).backgroundColor !== 'rgb(0, 0, 0)') throw new Error('the canister should be shown large, on black');
    return `canister view: ${seen.join(', then ')}`;
  });
  await shot('17-canister-view');

  // Canister view, continued: at Port D (its CNOT reaches the lock lamp D) the lock shows magnified.
  await step('lock view', async () => {
    const g = bot.G();
    const lock = document.getElementById('lock-module');
    if (!lock.classList.contains('is-off')) throw new Error('the lock view should stay hidden away from lock terminals');
    const port = g.room.terminals.find((t) => t.id === 'Port D');
    g.player.x = port.x - 9;
    g.player.y = port.y - 32;
    await bot.until(() => !lock.classList.contains('is-off'), 2000, 'the lock view at Port D');
    const c = document.getElementById('lock-canvas');
    const px = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    g.player.x = 40;
    g.player.y = 450 - 32;
    await bot.until(() => lock.classList.contains('is-off'), 2000, 'the lock view to hide again');
    return `lock view: shown magnified at Port D (centre pixel rgb ${px[0]},${px[1]},${px[2]}), hidden elsewhere`;
  });

  // Floor 5: at the Professor's box the tile shows the canister and the cat, entangled.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '4');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 4);
  await step('cat view', async () => {
    const g = bot.G();
    g.player.x = g.canister.x - 9;
    g.player.y = g.canister.y - 32;
    await bot.until(() => g.canister.carried, 2000, 'the canister');
    const box = g.room.terminals.find((t) => t.box);
    g.player.x = box.x - 9;
    g.player.y = box.y - 32;
    await bot.until(() => !document.getElementById('cat-state').hidden, 2000, 'the cat in the tile');
    const words = [document.getElementById('canister-h').textContent, document.getElementById('canister-state').dataset.state, document.getElementById('cat-state').dataset.state];
    if (words.join('|') !== 'Canister and cat qubits|Entangled with CAT|Entangled with Q') throw new Error(`the tile should show both, entangled: ${words}`);
    return `cat view: "${words[0]}" with "${words[1]}" and "${words[2]}"`;
  });

  // Show gates: a ball is thrown to the middle of the state, then the gate pops up there for a
  // second, and the state changes as soon as it appears.
  await page.evaluate(() => {
    for (const id of ['dev-show-gates', 'dev-passive-terminal']) document.getElementById(id).click();
  });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '0');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);
  await step('show gates', async () => {
    const g = bot.G();
    await bot.walkTo(g.room.terminals[0].x);
    await bot.until(() => g.passive, 2000, 'T1 to show passively');
    const start = performance.now();
    await bot.tap('Digit1');
    await bot.until(() => g.fx.some((f) => f.type === 'spark'), 500, 'the ball to be thrown');
    const ball = g.fx.find((f) => f.type === 'spark');
    const a = bot.platform('A');
    const middle = { x: a.x + a.w / 2, y: (a.y0 + a.y1 + 14) / 2 };
    if (g.fx.some((f) => f.type === 'gate') || Math.abs(ball.to.x - middle.x) > 0.5 || Math.abs(ball.to.y - middle.y) > 0.5) {
      throw new Error(`the ball should fly first, to the middle of A's state: ${JSON.stringify({ to: ball.to, middle })}`);
    }
    const early = a.state; // while the ball is in the air, nothing has changed yet
    await bot.until(() => g.fx.some((f) => f.type === 'gate'), 1500, 'the gate to pop up');
    const poppedAt = (performance.now() - start) / 1000;
    const fx = g.fx.find((f) => f.type === 'gate');
    await bot.until(() => bot.platform('A').state === null, 2000, 'the superposition to appear');
    const changedAt = (performance.now() - start) / 1000;
    await bot.until(() => !g.fx.includes(fx), 2000, 'the gate to pop out');
    const total = (performance.now() - start) / 1000;
    if (early !== 0 || poppedAt < 0.4 || Math.abs(changedAt - poppedAt) > 0.15 || total < poppedAt + 0.9 || total > 2.2 || fx.parts[0].role !== 'box') {
      throw new Error(`the ball should land, then the gate pop for about 1 s with the state changing as it appears: ${JSON.stringify({ early, poppedAt, changedAt, total })}`);
    }
    return `show gates: the ball landed mid-state on A and the H popped up at ${poppedAt.toFixed(2)} s, the superposition appeared at ${changedAt.toFixed(2)} s, the H was gone at ${total.toFixed(2)} s`;
  });
  await page.evaluate(() => {
    for (const id of ['dev-show-gates', 'dev-passive-terminal']) document.getElementById(id).click();
  });

  console.log(report.join('\n'));
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no page errors');
  await browser.close();
  if (server) server.close();
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`PLAYTHROUGH FAILED: ${err.message}`);
  process.exit(1);
});
