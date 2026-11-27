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
  // The flashlight is the keyboard one: face the point, tilt the beam at it (what I and K do,
  // set directly here), and hold F unless `shine` is false. dark() lets go of F.
  // While a point is aimed at, the beam keeps turning to it every frame, even as the player
  // moves (as a mouse pointer held still would), until dark() or another aim.
  let aimAt = null;
  function pointAt(x, y) {
    const g = G();
    const pl = g.player;
    const cx = pl.x + 9;
    pl.facing = x >= cx ? 1 : -1;
    const hand = { x: cx + pl.facing * 5, y: pl.y + 14 };
    const angle = Math.atan2(y - hand.y, x - hand.x);
    let tilt = pl.facing > 0 ? -angle : angle - Math.PI;
    if (tilt < -Math.PI) tilt += 2 * Math.PI;
    if (tilt > Math.PI) tilt -= 2 * Math.PI;
    g.torch.tilt = Math.max(-1.35, Math.min(1.35, tilt));
  }
  const follow = () => {
    if (aimAt) pointAt(aimAt.x, aimAt.y);
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  function aim(x, y, shine = true) {
    aimAt = { x, y };
    pointAt(x, y);
    if (shine) key('KeyF', true);
  }
  function dark() {
    aimAt = null;
    key('KeyF', false);
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
    dark(); // look away again
    await frame();
    return p.state;
  }
  // Use a terminal or port: `picks` are 1-based positions of the gate buttons to apply. Standing at
  // it shows its gates; E moves the highlight right, Q left, and Enter applies the highlighted one.
  async function terminal(id, picks) {
    const g = G();
    const term = g.room.terminals.find((t) => t.id === id);
    if (!term) throw new Error(`no terminal ${id} in this room`);
    await walkTo(term.x);
    await until(() => term.near && g.passive === term, 2000, `stand at ${id}`);
    dark();
    for (const n of picks) {
      const button = document.querySelectorAll('#term-ops button')[n - 1];
      if (!button || button.dataset.locked === '1') throw new Error(`gate ${n} at ${id} is not available`);
      await until(() => !G().busy, 12000, `${id} to be free`);
      for (let k = 0; G().sel !== n - 1 && k < 12; k += 1) await tap(G().sel < n - 1 ? 'KeyE' : 'KeyQ');
      if (G().sel !== n - 1 || !button.classList.contains('is-selected')) throw new Error(`E and Q should highlight gate ${n} at ${id}`);
      const before = G().q.ops.length;
      await tap('Enter');
      await until(() => G().q.ops.length > before && !G().busy, 12000, `gate ${n} at ${id}`); // a swap counts down, then travels
    }
    if (G().mode !== 'play') throw new Error(`${id} should never take the player out of play: ${G().mode}`);
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
    dark();
    await until(() => d.exposure === 0, 1000, 'look away');
    return ok;
  }
  // Read the exit lock with the E key (the only way when the flashlight is dead).
  async function unlockByHand() {
    const d = G().door;
    const left = d.x - 32 - (30 + d.lock.length * 20);
    await walkTo((left + d.x + 22) / 2);
    // A lock whose lamps are certain and match the key opens by itself (no E needed).
    if (d.unlocked) return true;
    await until(() => d.unlocked || (d.near && d.deniedT <= 0 && !d.pending), 4000, 'stand at the lock');
    if (d.unlocked) return true;
    await tap('KeyE');
    await until(() => d.unlocked || (d.deniedT > 0 && !d.pending), 6000, 'the lock to answer');
    return d.unlocked;
  }
  async function exit() {
    if (G().mode !== 'complete') await walkTo(G().door.x);
    await until(() => G().mode === 'complete', 3000, 'floor to complete');
  }
  window.bot = { G, frame, key, tap, until, walkTo, hop, aim, dark, observe, terminal, talk, through, unlock, unlockByHand, exit, slab, solid, platform, settle };
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
  const step = async (label, fn, arg) => {
    try {
      const out = await page.evaluate(fn, arg);
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
  const nameOf = (els) => els.map((el) => el.querySelector('.floor-name').textContent);
  const offered = await page.$$eval('#title-floors:not([hidden]) button:not(.bonus)', nameOf);
  const bonusOffered = await page.$$eval('#title-floors:not([hidden]) button.bonus:not(.story)', nameOf);
  // Each level shows its stars (none earned yet) and the title shows the total.
  // A locked story level shows a lock instead (it opens once the level before it is cleared).
  const locked = await page.$$eval('#title-floors button.locked', (els) => els.map((el) => [el.dataset.floor, el.disabled, !!el.querySelector('.floor-lock')]));
  if (JSON.stringify(locked) !== JSON.stringify([['16', true, true]])) throw new Error(`only story level 1 should start locked, showing a lock: ${JSON.stringify(locked)}`);
  const shown = await page.$$eval('#title-floors button:not(.locked)', (els) => els.map((el) => { const all = el.querySelector('.floor-stars'); const off = all.querySelector('.off'); return all.textContent.length > 0 && !!off && off.textContent.length === all.textContent.length; }));
  if (!shown.length || !shown.every(Boolean)) throw new Error('every level should show its stars, all blank to start');
  if (!/^★ 0 of \d+ stars$/.test((await page.textContent('#star-total')).trim())) throw new Error(`the title should show the star total: ${await page.textContent('#star-total')}`);
  if (!bonusOffered.length || !bonusOffered[0].startsWith('Bonus 1.') || bonusOffered[bonusOffered.length - 1] !== 'Bonus 7. The Beast on the Roof') {
    throw new Error(`"Skip to floor" should list the seven bonus levels: ${JSON.stringify(bonusOffered)}`);
  }
  const storyOffered = await page.$$eval('#title-floors:not([hidden]) button.story', nameOf);
  if (storyOffered[0] !== '0. The Lobby') throw new Error(`"Skip to floor" should list story mode, from Level 0: ${JSON.stringify(storyOffered)}`);
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
    const list = [...document.querySelectorAll('#complete-star-list li')].map((li) => li.textContent);
    if (list.join('|') !== 'Reached the exit|No falls') throw new Error(`floor 1 needs luck, so its stars are for clearing it and for no falls: ${list}`);
    return `floor 1 cleared after ${tries} H gates (luck needed: two stars, cleared and no falls), stats ${JSON.stringify(bot.G().stats)}`;
  });
  await nextFloor(1);

  // Floor 2: the no-luck route. X on A, H then X on B, H Z H on C: six gates, nothing measured.
  await step('floor 2', async () => {
    await bot.terminal('T1', [1]);
    await bot.settle('A');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    await bot.terminal('T2', [1, 2]);
    await bot.settle('B');
    if (bot.platform('B').state !== 1) throw new Error('H then X should raise B for certain');
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.terminal('T3', [1, 2, 1]);
    await bot.settle('C');
    if (bot.platform('C').state !== 1) throw new Error('H Z H should raise C for certain');
    await bot.hop(bot.slab('C'));
    await bot.hop(bot.solid(3));
    await bot.exit();
    const s = bot.G().stats;
    const r = bot.G().results[1];
    const list = [...document.querySelectorAll('#complete-star-list li')].map((li) => (li.classList.contains('missed') ? '-' : '+') + li.textContent);
    if (r.stars !== 4 || r.of !== 4 || list.join('|') !== '+Reached the exit|+No falls|+Fewest gates (6), no luck|+Solved without luck') throw new Error(`six gates, no luck and no falls should earn all four stars: ${JSON.stringify(r)} ${list}`);
    return `floor 2 cleared with no measurement at all: ${list.join(', ')}; stats ${JSON.stringify(s)}`;
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
    if (res.of !== 3 || res.stars !== 3 || list.join('|') !== 'Reached the exit|No falls|Fewest gates (11), no luck') throw new Error(`floor 7: eleven gates and no falls should earn all three of its stars, none for speed or hints: ${res.stars}/${res.of} ${JSON.stringify(list)}`);
    // Its best time and stars are kept for the level lists.
    const kept = JSON.parse(localStorage.getItem('blackoutLab.progress.v2') || '{}')['lights-out'];
    if (!kept || !kept.stars.cleared || !kept.stars.noFalls || !kept.stars.fewest || !(kept.best > 0)) throw new Error(`floor 7's stars and best time should be saved: ${JSON.stringify(kept)}`);
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

  await page.click('#btn-start');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);

  // Three falls on one floor send the player back to floor 1.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '2');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 2);
  await step('falling', async () => {
    const g = bot.G();
    // First, something to keep: the canister picked up and put in superposition.
    await bot.walkTo(g.canister.x);
    await bot.until(() => g.canister.carried, 2000, 'pick up the canister');
    await bot.terminal('T1', [1]);
    const kept = { ops: g.q.ops.length, q: g.q.definite[g.qIndex.Q] };
    if (kept.q !== null) throw new Error('H should put the canister in superposition');
    const lives = [];
    for (let i = 0; i < 3; i += 1) {
      bot.key('ArrowRight', true);
      await bot.until(() => bot.G().mode !== 'play', 6000, 'a fall');
      bot.key('ArrowRight', false);
      lives.push(bot.G().lives);
      if (i < 2) await bot.until(() => bot.G().mode === 'play', 4000, 'the player to be back');
      if (i === 0 && (g.q.ops.length !== kept.ops || g.q.definite[g.qIndex.Q] !== null || !g.canister.carried)) {
        throw new Error('a fall should leave every qubit as it was: the canister still held and still in superposition');
      }
      const t1 = g.room.terminals.find((t) => t.id === 'T1');
      if (i < 2 && Math.abs(g.player.x + 9 - t1.x) > 2) throw new Error(`a fall should bring the player back to the last terminal used (T1 at ${t1.x}): x ${g.player.x + 9}`);
    }
    await bot.until(() => bot.G().mode === 'play' && bot.G().lives === 3 && bot.G().q.ops.length === 0, 4000, 'the floor to start over');
    if (bot.G().levelIndex !== 2 || bot.G().canister.carried) throw new Error('out of lives, the same floor should start over from the beginning');
    return `on floor 3, each fall brought the player back to T1, the first with the canister still in superposition; falls left lives at ${lives.join(', ')}, then floor 3 started over with three lives`;
  });

  // Bonus level 1, Broken Terminal: two terminals stuck in loops, a dead flashlight, a weak spare.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '8'); // bonus level 1 (after the seven floors and the terrace)
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'broken');
  await step('bonus level 1', async () => {
    const g = bot.G();
    const P = bot.platform('P');
    const A = bot.platform('A');
    const B = bot.platform('B');
    const [t1, t2] = g.room.terminals;
    if (g.torch.battery !== 'dead') throw new Error('the flashlight should start dead');
    // T1 cannot be used: no E, and the prompt says it is broken. It turns P by itself.
    await bot.walkTo(t1.x);
    if (t1.near || !document.getElementById('prompt').textContent.includes('T1 is broken')) throw new Error(`T1 should be broken: ${document.getElementById('prompt').textContent}`);
    await bot.tap('KeyE');
    if (g.mode !== 'play') throw new Error('E at a broken terminal should do nothing');
    const turns = () => g.q.ops.filter((op) => op.kind === 'auto' && op.gate === 'ry').length;
    await bot.until(() => turns() >= 2, 5000, 'T1 to turn P by itself');
    const ticks = turns();
    // Standing on P as T1 turns it: the gate leaves P superposed under your feet, and your touch
    // measures it at once (50/50 from a certain state): you stay on it, or it goes and you fall.
    await bot.until(() => P.state !== null && t1.clock > 0.3 && t1.clock < 0.9, 6000, 'P certain, well before a tick');
    const slotY = P.state ? P.y1 : P.y0;
    Object.assign(g.player, { x: P.x + P.w / 2 - 9, y: slotY - 32, vx: 0, vy: 0 });
    await bot.until(() => g.player.standing === P, 1000, 'standing on P');
    const opsBefore = g.q.ops.length;
    await bot.until(() => g.q.ops.length > opsBefore + 1 || g.mode !== 'play', 3000, 'the tick and the touch');
    const touched = g.q.ops[opsBefore + 1];
    if (!touched || touched.kind !== 'measure' || touched.by !== 'touch' || P.state === null) throw new Error(`the turn should be measured by the touch at once: ${JSON.stringify(g.q.ops.slice(opsBefore))}`);
    const stayed = P.state === (slotY === P.y1 ? 1 : 0);
    for (let k = 0; k < 3 && g.mode === 'play'; k += 1) await bot.frame(); // (a fall onto its lower slot comes later)
    if (stayed !== (g.player.standing === P)) throw new Error(`the player should stay on P only if it collapsed where they stood: stayed ${stayed}, standing ${g.player.standing === P}`);
    for (let k = 0; k < 40; k += 1) await bot.frame(); // let a fall land (on P's lower position, or in the pit)
    if (g.mode === 'falling') await bot.until(() => g.mode === 'play', 4000, 'back after the fall');
    if (g.player.standing === P) Object.assign(g.player, { x: 60, y: 440 - 32, vx: 0, vy: 0 }); // back to the ground (a test shortcut)
    const touchNote = stayed ? 'P collapsed where the player stood, and they stayed on' : 'P collapsed away, and the player fell';
    // Ride P: from the edge of the ground, jump as it turns up to 1, run across it and jump to the ledge before it turns on.
    const { key, until, frame } = bot;
    const pl = g.player;
    const jump = async () => {
      key('Space', true);
      await frame();
      key('Space', false);
      await until(() => !pl.onGround, 1000, 'leave the ground');
    };
    let rides = 0;
    while (!(pl.onGround && Math.abs(pl.y + 32 - 340) < 2) && rides < 4) {
      rides += 1;
      if (g.mode !== 'play') await until(() => g.mode === 'play', 6000, 'back on the floor');
      await bot.walkTo(140);
      await until(() => P.state === 1 && t1.clock < 0.1, 9000, 'P to turn up to 1');
      key('ArrowRight', true);
      await jump();
      await until(() => pl.onGround || g.mode !== 'play', 3000, 'land on P');
      if (pl.standing !== P) {
        key('ArrowRight', false);
        continue;
      }
      await until(() => pl.x + 18 >= 282, 2000, 'the end of P');
      await jump();
      await until(() => pl.onGround || g.mode !== 'play', 3000, 'land on the ledge');
      key('ArrowRight', false);
    }
    if (Math.abs(pl.y + 32 - 340) > 2) throw new Error('P should have carried the player up to the ledge');
    // The spare battery: weak, so the beam reaches A and not B.
    await bot.walkTo(g.room.battery.x);
    await until(() => g.torch.battery === 'ok', 2000, 'the battery');
    if (g.torch.range !== 170 || !g.torch.on) throw new Error(`the spare should be weak: range ${g.torch.range}`);
    // Look at A until it reads 1 in the right phase of T2's loop (a 0 is turned back into a superposition by
    // the loop). A 1 seen just before the loop's first H is the wrong phase: the H turns it into a superposition
    // that the CNOTs entangle with B, and A is only certain between the two Hs. A is then 1 with T2's next gate
    // the first H (step 0); in the right phase A stays 1 through the CNOTs (steps 1 to 3).
    await bot.walkTo(436);
    bot.aim(A.x + A.w / 2, A.y1 + 30);
    await until(() => A.state === 1 && t2.step !== 0, 30000, 'A to read 1 in phase');
    bot.aim(pl.x, 20);
    const lookedAtB = g.q.ops.some((op) => op.kind === 'measure' && op.qubits.includes(B.qi));
    if (lookedAtB) throw new Error('the weak beam should not have reached B');
    // With A a certain 1, the loop raises B for a second after each H. Jump onto A just after the H,
    // run to its end, and jump to B as it rises; then run on to the exit before it drops.
    await until(() => A.state === 1 && t2.step === 1 && t2.clock < 0.1, 12000, 'the H that leaves A at 1');
    key('ArrowRight', true);
    await jump();
    await until(() => pl.onGround || g.mode !== 'play', 3000, 'land on A');
    if (pl.standing !== A) throw new Error(`should have landed on A: ${A.state}`);
    await until(() => pl.x + 18 >= 578, 2000, 'the end of A');
    // The jump takes about 0.55 s: leave so as to land just after B rises.
    const leave = t2.broken.every - 0.5;
    if (t2.clock < leave) {
      key('ArrowRight', false);
      await until(() => t2.clock >= leave, 2000, 'B about to rise');
      key('ArrowRight', true);
    }
    await jump();
    await until(() => pl.onGround || g.mode !== 'play', 3000, 'land on B');
    if (pl.standing !== B || B.state !== 1) throw new Error('should have landed on raised B');
    await until(() => pl.x > 725, 2000, 'onto the exit ledge');
    key('ArrowRight', false);
    await bot.exit();
    const stars = [...document.querySelectorAll('#complete-star-list li')].map((li) => (li.classList.contains('missed') ? '-' : '+') + li.textContent);
    return `bonus level 1: standing on P as T1 turned it, the touch measured it at once (${touchNote}); T1 turned P by itself (${ticks} tick(s) seen), ridden up in ${rides} try; spare battery range ${g.torch.range}; A read 1, then B rose and the player crossed in ${Math.round(g.floorTime)} s; stars ${stars.join(', ')}`;
  });
  await shot('15b-bonus-cleared');
  // The Main menu button stays usable on the cleared-floor screen (the rest of the page is inert).
  if (await page.evaluate(() => { const m = document.getElementById('btn-menu'); return m.disabled || !!m.closest('[inert]'); })) throw new Error('Main menu should be clickable on the cleared-floor screen');
  // ...and so are the rack's notes and the circuit's Collapse / Expand.
  const toggled = [await page.textContent('#circuit-expand')];
  await page.click('#circuit-expand', { timeout: 3000 });
  toggled.push(await page.textContent('#circuit-expand'));
  await page.click('#circuit-expand', { timeout: 3000 });
  toggled.push(await page.textContent('#circuit-expand'));
  if (toggled[0] === toggled[1] || toggled[0] !== toggled[2]) throw new Error(`the circuit should collapse and expand on the cleared-floor screen: ${toggled}`);
  if (await page.evaluate(() => !!document.querySelector('.rack-inner').closest('[inert]'))) throw new Error('the lab notes should scroll on the cleared-floor screen');
  report.push('on the cleared-floor screen, Main menu, the circuit toggle and the lab notes all work');
  if ((await page.textContent('#btn-next')) !== 'Next bonus level') throw new Error('bonus level 1 should lead on to the next bonus level');
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'shuffle');

  // Bonus level 2, SWAP Shuffle: 000 to 011 with X on A and two instant SWAPs.
  await step('bonus level 2', async () => {
    const g = bot.G();
    await bot.terminal('T1', [1, 2, 1, 3, 2]);
    const bits = ['A', 'B', 'C'].map((q) => g.q.definite[bot.platform(q).qi]).join('');
    if (bits !== '011') throw new Error(`X, SWAP A B, X, SWAP B C, SWAP A B should give 011: ${bits}`);
    await bot.settle('A');
    await bot.settle('B');
    await bot.settle('C');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.slab('C'));
    await bot.hop(bot.solid(1));
    await bot.exit();
    const stars = [...document.querySelectorAll('#complete-star-list li')].map((li) => (li.classList.contains('missed') ? '-' : '+') + li.textContent);
    if (!stars.includes('+Fewest gates (5), no luck')) throw new Error(`five gates should earn the fewest-gates star: ${stars.join(', ')}`);
    return `bonus level 2: X SWAP X SWAP SWAP gave 011 with no countdowns, and the player crossed; stars ${stars.join(', ')}`;
  });
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'channel');

  // Bonus level 3, Quantum Communication: a shuttle, a backup light, a sideways shield.
  // The swap delay developer option: 3 s by default, counted down; the slider changes it.
  const delays = await page.evaluate(() => {
    const range = document.getElementById('dev-swap-delay');
    const before = window.blackoutLab.state.dev.swapDelay;
    range.value = '5';
    range.dispatchEvent(new Event('input'));
    const changed = [window.blackoutLab.state.dev.swapDelay, document.getElementById('dev-swap-delay-text').textContent];
    range.value = '3';
    range.dispatchEvent(new Event('input'));
    return { before, changed };
  });
  if (delays.before !== 3 || delays.changed[0] !== 5 || delays.changed[1] !== '5 s') throw new Error(`swap delay option: ${JSON.stringify(delays)}`);
  const channel = async (level) => {
    const g = bot.G();
    const S = bot.platform('S');
    if (g.torch.on) throw new Error('the flashlight should start switched off here');
    // Unshielded: H, then SWAP sends the superposition across, and the light sees it on the way.
    await bot.terminal('T1', [1, 2]);
    const first = g.q.ops.map((op) => `${op.gate}${op.by ? `:${op.by}` : ''}`).join(' ');
    const seen = level === 4 ? 'reset:emergency' : 'measure:light';
    if (!first.startsWith('h swap') || !first.includes(seen)) throw new Error(`unshielded, the light should catch the crossing: ${first}`);
    document.getElementById('btn-restart').click();
    await bot.until(() => g.mode === 'play' && g.q.ops.length === 0, 4000, 'the restart');
    let rescue = '';
    if (level === 3) {
      // Stranded down on Bob's side: T2 there swaps the platforms back; ride R's platform home.
      Object.assign(g.player, { x: 871, y: 450 - 32, vx: 0, vy: 0 });
      const t2 = g.room.terminals.find((t) => t.id === 'T2');
      await bot.until(() => t2.near, 2000, 'stand at T2');
      await bot.until(() => g.passive && g.passive.id === 'T2', 2000, 'T2 to show its gates');
      document.querySelector('#term-ops button[data-op="0"]').click();
      const ride = bot.platform('R');
      await bot.walkTo(ride.x + ride.w / 2);
      if (g.player.standing !== ride || !g.swap || g.swap.travel) throw new Error('the player should be on R\'s platform before the swap sets off');
      await bot.until(() => !g.swap, 10000, 'the swap back');
      if (g.player.standing !== ride || g.player.x > 260) throw new Error(`the platform should carry the player home, staying on it where the two cross: x ${Math.round(g.player.x)}`);
      rescue = '; stranded on Bob\'s side, T2 swapped a platform back and carried the player home';
      document.getElementById('btn-restart').click();
      await bot.until(() => g.mode === 'play' && g.q.ops.length === 0, 4000, 'the restart');
    }
    // Shielded: X, H, SWAP, Z (on R, now holding Q's state), SWAP, H: Q is a certain 1.
    await bot.terminal('T1', [4, 1, 2, 3, 2, 1]);
    const Q = bot.platform('Q');
    if (Q.state !== 1 || !g.bonusDone || g.q.ops.some((op) => op.kind === 'measure' || op.kind === 'reset')) {
      throw new Error(`H, SWAP, Z, SWAP, H should make Q a certain 1, unseen: ${g.q.ops.map((op) => op.gate).join(' ')}, Q=${Q.state}`);
    }
    // The last SWAP: during the delay (arrows showing), jump onto the raised platform and ride it.
    const t1 = g.room.terminals[0];
    await bot.walkTo(t1.x);
    await bot.until(() => t1.near, 2000, 'stand at T1');
    await bot.until(() => g.passive && g.passive.id === 'T1', 2000, 'T1 to show its gates');
    document.querySelector('#term-ops button[data-op="1"]').click();
    await bot.frame();
    if (!g.swap || [...document.querySelectorAll('#term-ops button')].some((b) => !b.disabled)) throw new Error('during a swap every gate should be greyed out');
    if (g.swap.count !== 3) throw new Error(`the countdown should start at 3: ${g.swap.count}`);
    const ride = bot.platform('Q');
    await bot.hop(bot.slab('Q'));
    if (g.player.standing !== ride || g.swap.travel) throw new Error('the player should be aboard before the swap sets off');
    await bot.until(() => !g.swap, 8000, 'the swap to finish');
    if (g.player.standing !== ride || ride.q !== 'R' || ride.state !== 1) throw new Error(`the raised platform should have carried the player to R's place: ${ride.q} ${ride.state}`);
    await bot.hop(bot.solid(2));
    await bot.exit();
    const stars = [...document.querySelectorAll('#complete-star-list li')].map((li) => (li.classList.contains('missed') ? '-' : '+') + li.textContent);
    return `bonus level ${level}: unshielded the light caught the crossing (${first}); shielded, X H SWAP Z SWAP H made Q a certain 1, and the last SWAP carried the player across${rescue}; stars ${stars.join(', ')}`;
  };
  await step('bonus level 3', channel, 3);
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'channel-emergency');
  await step('bonus level 4', channel, 4);
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'decoherence');

  // Bonus level 5: weak lights over every platform; a timed H Z H, then A = 0 and B = 1 through CZ.
  await step('bonus level 5', async () => {
    const g = bot.G();
    const P = bot.platform('P');
    const A = bot.platform('A');
    const B = bot.platform('B');
    // The deadline: H on P, then wait at the terminal. The weak light measures P within a few seconds.
    const t1 = g.room.terminals.find((t) => t.id === 'T1');
    await bot.walkTo(t1.x);
    await bot.until(() => t1.near, 2000, 'stand at T1');
    await bot.until(() => g.passive && g.passive.id === 'T1', 2000, 'T1 to show its gates');
    const opened = performance.now();
    document.querySelector('#term-ops button[data-op="0"]').click();
    await bot.until(() => P.state === null, 2000, 'P in superposition');
    await bot.until(() => P.state !== null, 4000, 'the weak light to catch P');
    const caughtAfter = (performance.now() - opened) / 1000;
    const last = g.q.ops[g.q.ops.length - 1];
    if (!g.passive || last.by !== 'light' || caughtAfter < 2) throw new Error(`the weak light should measure P after about 2.25 s, even at the terminal: ${JSON.stringify(last)} after ${caughtAfter.toFixed(2)} s in ${g.mode}`);
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
    return `bonus level 5: left in superposition at T1, P was measured by the weak light after ${caughtAfter.toFixed(2)} s; P raised after ${tries} more try at T1; A=0, B=1 after ${rounds} round(s) at T2; crossed to the exit in ${Math.round(g.floorTime)} s`;
  });
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.level.id === 'rabi');

  // Bonus level 6: Rabi oscillation and the watchdog effect.
  await step('bonus level 6', async () => {
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
      bot.dark();
      bot.aim(P.x + P.w / 2, P.y0 + 6, false); // pointed at P, not yet shining
      await bot.until(() => P.p1 < 0.05, 6000, 'P to come round to 0');
      bot.key('KeyF', true);
      await bot.until(() => P.state !== null, 3000, 'P to collapse');
      freezes += 1;
    }
    if (P.state !== 0 || P.driven !== 'held') throw new Error(`P should be frozen lowered: ${P.state} ${P.driven}`);
    await bot.hop(bot.slab('P'));
    if (g.player.standing !== P || P.driven !== 'held') throw new Error('standing on P should keep it frozen');
    const heldAt = g.q.ops.length;
    bot.dark(); // look away: only standing on P holds it now
    for (let k = 0; k < 40; k += 1) await bot.frame();
    if (P.state !== 0 || g.q.ops.length !== heldAt) throw new Error('P should stay frozen while the player stands on it');
    await bot.hop(bot.solid(1));
    // T2: slide the shield in as A comes round to 0 (B is then at 1), then light both up.
    let rounds = 0;
    while (!(A.state === 0 && B.state === 1) && rounds < 6) {
      const t2 = g.room.terminals.find((t) => t.id === 'T2');
      await bot.walkTo(t2.x);
      await bot.until(() => t2.near, 2000, 'stand at T2');
      await bot.until(() => g.passive && g.passive.id === 'T2', 2000, 'T2 to show its gates');
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
      bot.aim(600, 330);
      await bot.until(() => A.state !== null && B.state !== null, 4000, 'A and B to collapse');
      bot.dark();
      rounds += 1;
    }
    if (A.state !== 0 || B.state !== 1) throw new Error(`A should be 0 and B 1: ${A.state} ${B.state}`);
    await bot.settle('A');
    await bot.settle('B');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.exit();
    if (document.getElementById('btn-next').textContent !== 'Next bonus level') throw new Error('bonus level 6 should lead on to bonus level 7');
    return `bonus level 6: P swung between ${lo.toFixed(2)} and ${hi.toFixed(2)} unwatched; frozen lowered after ${freezes} flashlight try, held while stood on; A=0, B=1 after ${rounds} shield round(s)`;
  });
  // Bonus level 7, the beast on the roof: straight on from bonus level 6.
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.level && window.blackoutLab.state.level.id === 'beast' && window.blackoutLab.state.beast && window.blackoutLab.state.beast.step === 'walk');
  await step('bonus level 7', async () => {
    const g = bot.G();
    const { key, until, frame } = bot;
    const b = () => g.beast;
    const cat = () => g.q.definite[0];
    const cute = () => 1 - g.q.p1[0];
    const close = (a, z) => Math.abs(a - z) < 1e-9;
    if (b().phase !== 'intro' || cat() !== 1) throw new Error('it should open on the intro, with the cat a monster (1)');
    // As on the terrace: the power is off, the terminals too, and a box sits in the middle of the roof.
    if (b().power !== 0 || b().termsOn || b().box.state !== 'shut' || g.room.terminals.some((t) => t.near)) throw new Error('the roof should start dark, with the terminals off and the box shut');
    // Space only jumps here (over the box, say): it does not skip the scene before the generator is on.
    await bot.tap('Space');
    for (let k = 0; k < 10; k += 1) await frame();
    if (b().step !== 'walk' || b().crank !== 0) throw new Error(`Space should not skip the opening, and the crank should not turn before it is used: ${b().step} ${b().crank}`);
    await bot.walkTo(700);
    await until(() => b().near, 2000, 'the generator');
    await bot.tap('KeyE');
    await until(() => g.mode === 'cutscene' && b().step === 'crank', 1000, 'the crank');
    await until(() => b().step === 'kitty', 25000, 'everyone out, the cat in the box, and Bob calling it');
    if (b().power !== 1 || !b().termsOn || b().cat.state !== 'in' || b().actors.length !== 3 || b().line.text !== "It's OK, here kitty kitty!") {
      throw new Error(`the scene so far: power ${b().power}, terminals ${b().termsOn}, cat ${b().cat.state}, line ${b().line && b().line.text}`);
    }
    await bot.tap('KeyE'); // skip the rest
    await until(() => g.mode === 'play' && b().phase === 'fight' && b().rise === 1, 2000, 'the fight to start');
    if (b().actors.length || !b().lightsBroken || b().box.state !== 'gone') throw new Error('skipping should leave the roof as the scene ends: the others gone, the string lights down');
    if (g.floorTime > 0.5) throw new Error(`the clock for the timed star should start with the fight: ${g.floorTime}`);
    await until(() => b().mist === 1 && b().reveal < 0.05, 8000, 'the mist to roll in');
    // Walk to x while keeping clear of any paw that has stopped to drop; until done() holds with no paw about to drop.
    const threat = () => b().paws.find((p) => (p.state === 'windup' || p.state === 'slam') && Math.abs(p.x - (g.player.x + 9)) < 64);
    let dodged = 0;
    let jumped = 0;
    const seenThreat = new Set();
    const swiping = () => b().paws.some((p) => p.state === 'swipeWind' || p.state === 'swipe');
    async function go(x, done, ms, what) {
      await until(() => {
        const finished = done(); // checked every frame, so a passing moment is not missed
        if (g.mode !== 'play') return finished;
        const cx = g.player.x + 9;
        // A swipe along the roof: jump as it comes close.
        const sw = b().paws.find((p) => p.state === 'swipe' && (cx - p.x) * p.dir > 0 && (cx - p.x) * p.dir < 105);
        if (sw && g.player.onGround && !seenThreat.has(sw)) {
          seenThreat.add(sw);
          jumped += 1;
          key('Space', true);
        } else key('Space', false);
        const p = threat();
        let goal = x;
        if (p) {
          if (!seenThreat.has(p)) {
            seenThreat.add(p);
            dodged += 1;
          }
          // Step to whichever side is clearer of every paw about to drop (or rising for a terminal).
          const danger = b().paws.filter((q) => q.state === 'windup' || q.state === 'slam' || (q.state === 'rise' && q.target)).map((q) => (q.target ? q.target.x : q.x));
          const room = (gx) => (gx < 20 || gx > 860 ? -1 : Math.min(...danger.map((dx) => Math.abs(gx - dx))));
          const sides = [p.x - 100, p.x + 100, cx - 100, cx + 100];
          goal = sides.reduce((best, gx) => (room(gx) > room(best) ? gx : best), sides[0]);
        } else seenThreat.clear();
        key('ArrowRight', goal - cx > 4);
        key('ArrowLeft', goal - cx < -4);
        return !p && !swiping() && g.player.onGround && Math.abs(goal - cx) <= 6 && finished;
      }, ms, what);
      key('ArrowRight', false);
      key('ArrowLeft', false);
      key('Space', false);
    }
    // Flattened: stand still under the paws until one comes down on the player.
    const lives = g.lives;
    await until(() => g.mode === 'falling', 15000, 'a paw to land on the player');
    if (!g.flung || g.lives !== lives - 1) throw new Error('a paw should flatten the player and cost a life');
    await until(() => g.flung && g.flung.launched && (g.player.y + 32 < 0 || g.player.x > 960 || g.player.x + 18 < 0), 3000, 'the player to be flung off the screen');
    await until(() => g.mode === 'play', 4000, 'the player to be back').catch((err) => { throw new Error(`${err.message}: mode ${g.mode}, lives ${g.lives}, falls ${g.stats.falls}, phase ${b().phase}, hit ${JSON.stringify(g.lastHit)}`); });
    if (b().phase !== 'fight' || cat() !== 1 || Math.abs(g.player.x - g.level.spawn.x) > 2) throw new Error('after a flattening the player is back at the stair door, with no intro');
    g.infinite = true; // lives are checked; from here on a stray paw only costs time (the bot waits without dodging at times)
    // Dodging: wait in the middle of the roof through two drops.
    const fallsBefore = g.stats.falls;
    let drops = 0;
    for (let k = 0; k < 2; k += 1) {
      let landed = false;
      await go(480, () => (landed = landed || b().paws.some((p) => p.state === 'down')), 25000, 'a paw to come down').catch((err) => {
        throw new Error(`${err.message}: mode ${g.mode}, paws ${b().paws.map((p) => `${p.state}@${Math.round(p.x)}`)}, player ${Math.round(g.player.x)}, wait ${b().wait.toFixed(2)}, falls ${g.stats.falls}`);
      });
      drops += 1;
      await until(() => !b().paws.some((p) => p.state === 'down'), 3000, 'the paw to lift');
    }
    if (g.stats.falls !== fallsBefore || g.mode !== 'play') throw new Error('moving when a paw stops should avoid it');
    // A swipe along the roof, made to happen here: jump it.
    await until(() => b().paws.every((p) => p.state === 'rest'), 6000, 'the paws to rest');
    const sweeper = b().paws[0];
    Object.assign(sweeper, { state: 'swipeIn', t: 0, dir: 1, from: { x: sweeper.x, y: sweeper.y }, target: null });
    b().grudge = null;
    let passed = false;
    await go(480, () => (passed = passed || sweeper.state === 'lift' || sweeper.state === 'rest'), 10000, 'the swipe to pass');
    if (g.stats.falls !== fallsBefore || g.mode !== 'play' || jumped < 1) throw new Error(`jumping should clear a swipe: falls ${g.stats.falls - fallsBefore}, jumps ${jumped}`);
    // One turn at T1: a little cute, and the cat smashes T1.
    const [t1, t2] = g.room.terminals;
    await go(t1.x, () => t1.near, 15000, 'stand at T1');
    // Standing at a quick terminal shows its gate with its number key, as on other levels.
    const keyShown = document.querySelector('#term-ops kbd');
    if (!keyShown || keyShown.textContent !== '1' || document.getElementById('dock-terminal').hidden) throw new Error('T1 should show its gate with the key 1');
    await bot.tap('Digit1');
    if (g.q.ops.length !== 1 || g.q.ops[0].gate !== 'ry' || !close(cute(), Math.sin(Math.PI / 16) ** 2)) throw new Error(`RY(pi/8) should make the cat ${Math.sin(Math.PI / 16) ** 2} cute: ${cute()}`);
    if (!t1.used || b().grudge !== t1) throw new Error('the cat should go for T1');
    await go(480, () => t1.wreck > 0, 15000, 'the cat to smash T1');
    if (g.stats.falls !== fallsBefore) throw new Error(`the player should have got away from T1 (hit by a paw: ${JSON.stringify(g.lastHit)})`);
    // Smashed terminals come back after 10 s; here the wait is cut short.
    t1.wreck = 0.2;
    await until(() => t1.wreck === 0 && !t1.used, 2000, 'T1 to come back');
    // Flattened again, this time with a turn applied: the cat keeps it.
    const kept = { ops: g.q.ops.length, cute: cute() };
    await until(() => g.mode === 'falling', 20000, 'a paw to land on the player again');
    await until(() => g.mode === 'play', 4000, 'the player to be back').catch((err) => { throw new Error(`${err.message}: mode ${g.mode}, lives ${g.lives}, falls ${g.stats.falls}, phase ${b().phase}, hit ${JSON.stringify(g.lastHit)}`); });
    if (g.q.ops.length !== kept.ops || !close(cute(), kept.cute)) throw new Error(`a flattening should leave the cat as it was: ${JSON.stringify(kept)} now ${g.q.ops.length} ops, ${cute()} cute`);
    // A look at 4% cute: almost surely a monster. The beam held level along the roof finds it:
    // no aiming up, no jumping. (The paws are held at rest for the look, so the bot can watch.)
    await until(() => b().paws.every((p) => p.state === 'rest'), 8000, 'the paws to rest');
    b().wait = 99;
    // Into the middle first, clear of both resting paws (a monster result brings them straight down).
    await go(400, () => true, 6000, 'the middle of the roof');
    bot.aim(760, b().roof - 22); // held level along the roof, F held
    let pawsAfter = null; // the paws on the frame the cat collapses
    let litAtLook = false;
    await go(400, () => {
      if (cat() !== null && !pawsAfter) {
        pawsAfter = b().paws.map((p) => p.state);
        litAtLook = b().lit;
      }
      return cat() !== null || g.mode !== 'play';
    }, 6000, 'the look');
    if (!litAtLook && b().phase === 'fight') throw new Error('a level beam towards the cat should find it');
    bot.dark(); // the light goes off at once
    // Just before the two seconds are up (in game time), it should still be in full view.
    if (cat() === 1) await until(() => b().t >= b().showUntil - 0.25 || g.mode !== 'play', 4000, 'most of the screech');
    const revealed = { seen: b().seen, reveal: b().reveal, lit: b().lit };
    const looked = g.q.ops.find((op) => op.kind === 'measure');
    if (!looked || looked.by !== 'torch') throw new Error('the flashlight on its face should measure the cat');
    if (b().phase === 'tamed') return 'bonus level 7: flattened and flung; dodged; T1 turned and smashed; flattened again with the turn kept; a look at 4% cute came out cute (lucky)';
    if (cat() !== 1) throw new Error('a monster result should leave the cat a plain 1');
    if (!pawsAfter.every((st) => st === 'slam' || st === 'down')) throw new Error(`a monster result should bring both paws straight down: ${pawsAfter}`);
    if (revealed.seen !== 'monster' || revealed.reveal < 0.95 || revealed.lit) throw new Error(`the screeching monster should stay in view for 2 s, light or no light: ${JSON.stringify(revealed)}`);
    await until(() => b().reveal < 0.2, 3000, 'the mist to close in again after the screech');
    b().wait = 1;
    // Now the sure way: eight turns, nobody looking, alternating T1 and T2; rebuilds cut short.
    let turns = 0;
    for (let tries = 0; b().phase === 'fight' && turns < 8 && tries < 40; tries += 1) {
      const t = turns % 2 === 0 ? t1 : t2;
      if (t.wreck > 0) t.wreck = Math.min(t.wreck, 0.2); // a paw chasing the player can smash it early, too
      await until(() => !(t.wreck > 0) && !t.used, 3000, `${t.id} to be back`);
      await go(t.x, () => t.near || t.wreck > 0, 20000, `stand at ${t.id}`);
      if (!t.near) continue;
      await bot.tap('KeyE');
      if (!t.used && b().phase === 'fight') continue;
      turns += 1;
      if (b().phase !== 'fight') break;
      if (!close(cute(), Math.sin((turns * Math.PI) / 16) ** 2)) throw new Error(`after ${turns} turns the cat should be sin^2(${turns} pi/16) cute: ${cute()}`);
      await go(t.x < 480 ? t.x + 260 : t.x - 260, () => t.wreck > 0, 20000, `the cat to smash ${t.id}`);
      t.wreck = 0.2;
    }
    if (turns !== 8 || b().phase !== 'tamed' || cat() !== 0) throw new Error(`eight turns should tame it without a look: ${turns} turns, ${b().phase}`);
    await until(() => g.mode === 'complete', 8000, 'bonus level 7 to be cleared');
    const stars = [...document.querySelectorAll('#complete-star-list li')].map((li) => (li.classList.contains('missed') ? '-' : '+') + li.textContent);
    if (document.getElementById('btn-next').textContent !== 'Back to title') throw new Error('after the last bonus level, Next should lead back to the title');
    if (!stars.includes('+Deterministically made the cat cute')) throw new Error(`eight RY turns in a row should earn the deterministic star: ${stars}`);
    return `bonus level 7: Space jumped without skipping; the generator cranked, everyone out, the cat in the box, Bob calling it, then the rest skipped; the mist rolled in; flattened and flung off the roof (a life lost, back at the stair door); ${drops} drops dodged (${dodged} paws stepped away from), ${jumped} swipe(s) jumped; T1 turned the cat to ${(Math.sin(Math.PI / 16) ** 2).toFixed(3)} cute and was smashed; flattened again with the turn kept; a look came out monster (a screech, both paws down, the monster in view for 2 s); eight turns then tamed it with no look; stars ${stars.join(', ')}`;
  });
  await shot('15c-beast-cleared');
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

  // Six former developer options are now how the game plays: always on, with no switches.
  // The rest are still developer options: off (or at their defaults) to start, and remembered.
  const dev = () => page.evaluate(() => ({ ...window.blackoutLab.state.dev }));
  let d = await dev();
  const always = ['touchCollapse', 'instantResponse', 'passiveTerminal', 'canisterView', 'showGates'];
  if (!always.every((k) => d[k] === true)) throw new Error(`these should always be on: ${JSON.stringify(d)}`);
  const switches = await page.$$eval('#dev input', (els) => els.map((el) => el.id));
  if (switches.some((id) => /key-torch|touch|instant|passive|canister|show-gates/.test(id))) throw new Error(`the always-on settings should have no switches left: ${switches}`);
  if (d.circuitRight || d.panel !== 'right' || d.swapDelay !== 3) throw new Error(`the remaining developer options should start at their defaults: ${JSON.stringify(d)}`);
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
  d = await dev();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('blackoutLab.dev') || 'null'));
  if (!d.circuitRight || d.panel !== 'right' || !saved || saved.circuitRight !== true || saved.panel !== 'right') {
    throw new Error(`developer switches did not take or were not saved: ${JSON.stringify(d)} vs ${JSON.stringify(saved)}`);
  }
  report.push('the six always-on settings are on with no switches; Panel: Bottom moved the rack under the game; the remaining developer switches turn on and are remembered');

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

  // The flashlight on floor 1: its two modes, the mouse, and I / K with the tilt easing back.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '0');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);
  await step('flashlight', async () => {
    const g = bot.G();
    const canvas = document.getElementById('game');
    const r = canvas.getBoundingClientRect();
    const frames = async (n) => { for (let k = 0; k < n; k += 1) await bot.frame(); };
    g.player.facing = 1;
    if (g.dev.torchMode !== 'hold') throw new Error(`the flashlight mode should start as Hold: ${g.dev.torchMode}`);
    // Hold mode, mouse off the game picture: F held shines straight ahead.
    bot.key('KeyF', true);
    await frames(2);
    const ahead = { active: g.torch.active, angle: g.torch.angle };
    // I tilts it up; a few steps of walking without I or K bring it back to straight ahead.
    bot.key('KeyI', true);
    await frames(15);
    bot.key('KeyI', false);
    const up = g.torch.angle;
    bot.key('ArrowRight', true);
    await bot.until(() => Math.abs(g.torch.angle) < 0.02, 3000, 'the tilt to ease back after a few steps');
    bot.key('ArrowRight', false);
    await frames(10);
    // Mouse Aim is off by default: the mouse over the game changes nothing.
    if (g.dev.mouseAim) throw new Error('Mouse Aim should start off');
    const target = { x: g.player.x + 160, y: g.player.y - 120 };
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + (target.x / 960) * r.width, clientY: r.top + (target.y / 540) * r.height, bubbles: true }));
    await frames(2);
    const ignored = g.torch.angle;
    canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    bot.key('KeyF', false);
    await frames(2);
    if (!ahead.active || Math.abs(ahead.angle) > 1e-9 || !(up < -0.1) || Math.abs(ignored) > 1e-9 || g.torch.active) {
      throw new Error(`Hold mode: ${JSON.stringify({ ahead, up, ignored, after: g.torch.active })}`);
    }
    return `flashlight, Hold: F held shone straight ahead; I tilted it to ${up.toFixed(2)}, and a few steps brought it back to 0; with Mouse Aim off (the default), the mouse changed nothing`;
  });
  // Mouse Aim, switched on in Options: the mouse over the game aims it; off the game,
  // it is straight ahead again. Then off again.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  if (!(await page.isVisible('#opt-mouse-on'))) await page.click('#options summary');
  await page.click('#opt-mouse-on');
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.dev.mouseAim === true);
  await step('flashlight mouse', async () => {
    const g = bot.G();
    const canvas = document.getElementById('game');
    const r = canvas.getBoundingClientRect();
    const frames = async (n) => { for (let k = 0; k < n; k += 1) await bot.frame(); };
    g.player.facing = 1;
    bot.key('KeyF', true);
    const target = { x: g.player.x + 160, y: g.player.y - 120 };
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + (target.x / 960) * r.width, clientY: r.top + (target.y / 540) * r.height, bubbles: true }));
    await frames(2);
    const mouse = g.torch.angle;
    canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    await frames(2);
    const left = g.torch.angle;
    bot.key('KeyF', false);
    await frames(2);
    const saved = JSON.parse(localStorage.getItem('blackoutLab.dev') || '{}').mouseAim;
    if (!(mouse < -0.3) || Math.abs(left) > 1e-9 || saved !== true) throw new Error(`Mouse Aim: ${JSON.stringify({ mouse, left, saved })}`);
    return `flashlight, Mouse Aim on: the mouse over the game aimed it at ${mouse.toFixed(2)}, off the game it was straight ahead again; the choice is remembered`;
  });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.click('#opt-mouse-off');
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.dev.mouseAim === false);
  // Switch mode, chosen in Options (on the pause screen here): F turns it on, and F again off.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  if (!(await page.isVisible('#opt-torch-switch'))) await page.click('#options summary');
  await page.click('#opt-torch-switch');
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.dev.torchMode === 'switch');
  await step('flashlight switch', async () => {
    const g = bot.G();
    const frames = async (n) => { for (let k = 0; k < n; k += 1) await bot.frame(); };
    await frames(3); // let the game run after the pause screen, so the flashlight is up again
    const start = g.torch.active;
    await bot.tap('KeyF');
    await frames(3);
    const flipped = g.torch.active;
    await bot.tap('KeyF');
    await frames(3);
    const back = g.torch.active;
    if (flipped === start || back !== start) throw new Error(`Switch mode: F should turn the flashlight ${start ? 'off' : 'on'} and back: ${JSON.stringify({ start, flipped, back })}`);
    return `flashlight, Switch: F turned it ${flipped ? 'on' : 'off'}, and F again ${back ? 'on' : 'off'}`;
  });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.click('#opt-torch-hold');
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.dev.torchMode === 'hold');

  // The pause screen shows the controls and the developer options, which return to the title afterwards.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  const pauseHas = await page.evaluate(() => ({
    dev: !!document.querySelector('#screen-pause #dev') && !!document.querySelector('#screen-pause #options'),
    keys: document.querySelectorAll('#screen-pause .keys dt').length,
  }));
  if (!pauseHas.dev || pauseHas.keys < 5) throw new Error(`the pause screen should show the developer options and the controls: ${JSON.stringify(pauseHas)}`);
  await shot('16-pause-dev');
  await page.click('#btn-resume');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play');
  report.push(`the pause screen shows the developer options and ${pauseHas.keys} controls`);

  // Passive terminal + instant response: standing at T1 shows its gates, 1 applies H, and the
  // platform moves while the gates are showing. (Keyboard flashlight is on, so nothing is observed.)
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
    // Enter applies the highlighted gate; Q, E, [ ], comma and full stop only move the highlight
    // (with one gate, it stays put); a click applies a gate too. Nothing ever shuts the player in.
    for (const code of ['KeyE', 'KeyQ', 'BracketLeft', 'BracketRight', 'Comma', 'Period']) await bot.tap(code);
    if (g.q.ops.length !== before + 2 || g.mode !== 'play' || g.sel !== 0) throw new Error(`moving the highlight should apply nothing: ${g.q.ops.length - before} ops, mode ${g.mode}, sel ${g.sel}`);
    if (!document.querySelector('#term-ops button.is-selected')) throw new Error('the gate Enter applies should be highlighted');
    await bot.tap('Enter');
    await bot.until(() => g.q.ops.length === before + 3 && !g.busy, 2000, 'Enter to apply the highlighted gate');
    document.querySelector('#term-ops button').click();
    await bot.until(() => g.q.ops.length === before + 4 && !g.busy, 2000, 'a click on the gate');
    if (g.mode !== 'play' || !g.passive) throw new Error('the gates should still be showing, with the player free to move');
    if (a.state !== 0) throw new Error('four H gates should leave A lowered');
    bot.key('ArrowLeft', true);
    await bot.until(() => !g.passive, 2000, 'walking away to hide the gates');
    bot.key('ArrowLeft', false);
    return 'passive terminal: standing at T1 showed its numbered gates; 1 applied H; Q, E, [, ], comma and full stop moved the highlight only; Enter and a click applied H; walking away hid them';
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
    await bot.until(() => g.passive && g.passive.id === 'T1', 2000, 'T1 to show its gates');
    const y0 = a.y;
    document.querySelector('#term-ops button').click();
    await bot.until(() => a.state === 0, 2000, 'X to flip A');
    await bot.until(() => a.y === a.y0, 2000, 'A to glide down while T1 is open');
    if (!g.passive || y0 === a.y) throw new Error('A should move while the gates are showing');
    return `instant response: X at T1 moved A from y=${y0} to y=${a.y} with the terminal still open`;
  });
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

  // Story mode, Level 0: the lobby. Its title card holds the clock until the player moves; the
  // Professor's intercom speaks by itself (the clock still stopped) while the player walks on;
  // X raises A, SWAP carries the player across on C, an X on the lock lamp opens the stair door,
  // and the blackout keeps it shut until the Professor has finished. All with real jumps.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '15');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 15);
  await step('story level 0', async () => {
    const g = bot.G();
    const pl = g.player;
    const out = [];
    await new Promise((r) => setTimeout(r, 600));
    if (!g.titleCard || g.floorTime !== 0) throw new Error(`the title card should show, the clock stopped: ${JSON.stringify([g.titleCard, g.floorTime])}`);
    await bot.tap('ArrowRight');
    await bot.until(() => !g.titleCard, 1000, 'the title card to go');
    await bot.until(() => g.intercom && g.intercom.box.id === 'I1', 2000, 'the first intercom message');
    const t0 = g.floorTime;
    await bot.walkTo(118);
    if (!g.intercom || g.floorTime !== t0) throw new Error('the bubble should stay while walking, and its time should not count');
    if (g.room.intercoms[0].near !== true) throw new Error('the intercom should know the player is in front of it');
    await bot.tap('KeyX');
    if (g.intercom) throw new Error('X should clear the bubble');
    if (!/Professor: Thank heavens/.test(document.getElementById('log').textContent)) throw new Error('the message should be in the log');
    out.push('title card held the clock; I1 spoke on entry, stayed up while walking (clock still), X cleared it, and it went to the log');
    // H at the box calls him back; H clears him again; then a click on the close box, and walking into the bubble.
    const cleared = [];
    for (const how of ['H', 'E', 'Enter', 'click', 'walk into it']) {
      await bot.tap('KeyH');
      await bot.until(() => g.intercom && g.intercom.rect, 1000, 'H to call the Professor');
      const r = g.intercom.closeRect;
      if (how === 'H') await bot.tap('KeyH');
      else if (how === 'E') await bot.tap('KeyE');
      else if (how === 'Enter') await bot.tap('Enter');
      else if (how === 'click') {
        const c = document.getElementById('game').getBoundingClientRect();
        const at = { clientX: c.left + ((r.x + r.w / 2) / 960) * c.width, clientY: c.top + ((r.y + r.h / 2) / 540) * c.height, bubbles: true };
        document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', at));
      } else {
        const keep = { x: pl.x, y: pl.y };
        Object.assign(pl, { x: g.intercom.rect.x + 20, y: g.intercom.rect.y + 10, vy: 0 }); // as if jumping into it
        await bot.frame();
        await bot.frame();
        Object.assign(pl, { ...keep, vy: 0 });
      }
      await bot.frame();
      if (g.intercom) throw new Error(`${how} should clear the bubble`);
      cleared.push(how);
      await bot.until(() => pl.onGround, 2000, 'land');
    }
    out.push(`the bubble cleared with X, ${cleared.join(', ')}`);
    // No flashlight in the lobby: F does nothing.
    bot.key('KeyF', true);
    for (let k = 0; k < 5; k += 1) await bot.frame();
    bot.key('KeyF', false);
    if (g.torch.active || g.torch.battery !== 'none') throw new Error('the lobby has no flashlight: F should do nothing');
    out.push('F did nothing (no flashlight yet)');
    // Jump from where the player stands up onto a surface, steering in the air.
    const jumpTo = async (s, from) => {
      await bot.walkTo(from);
      bot.key('Space', true);
      await bot.frame();
      bot.key('Space', false);
      await bot.until(() => !pl.onGround, 1000, 'leave the ground');
      const goal = s.x + s.w / 2;
      await bot.until(() => {
        const off = goal - (pl.x + 9);
        bot.key('ArrowRight', off > 4);
        bot.key('ArrowLeft', off < -4);
        return pl.onGround;
      }, 3000, 'land');
      bot.key('ArrowRight', false);
      bot.key('ArrowLeft', false);
      if (Math.abs(pl.y + 32 - s.y) > 2) throw new Error(`missed the jump to y ${s.y}: landed at ${pl.y + 32}`);
    };
    // At T1 the Professor moves on to how to use it; applying the gate clears him.
    const T1 = g.room.terminals.find((t) => t.id === 'T1');
    await bot.walkTo(T1.x);
    await bot.until(() => g.intercom && /flip the platform's state with an X gate/.test(g.intercom.lines[g.intercom.index]), 2000, 'the message at T1');
    await bot.terminal('T1', [1]);
    if (g.intercom) throw new Error('applying the gate should clear the message');
    out.push('at T1 the Professor explained the X gate, and applying it cleared him');
    const A = bot.platform('A');
    await bot.until(() => A.state === 1 && Math.abs(A.y - A.y1) < 1, 4000, 'A to rise');
    await jumpTo(A, 300);
    const stand = g.room.solids[2];
    await jumpTo({ x: stand.x, w: 60, y: stand.y }, A.x + A.w - 12);
    await bot.until(() => g.intercom && g.intercom.box.id === 'I2', 2000, 'the second intercom message');
    // SWAP from the terminal's screen (key 1), then on to C during the countdown.
    const T2 = g.room.terminals.find((t) => t.id === 'T2');
    await bot.walkTo(T2.x);
    await bot.until(() => g.passive === T2, 2000, 'T2 to show its gate');
    if (!g.intercom) throw new Error('the second message should still be up');
    await bot.tap('Enter');
    await bot.until(() => g.swap, 2000, 'the swap countdown');
    if (g.intercom) throw new Error('using a terminal should clear the bubble');
    const C = bot.platform('C');
    await jumpTo(C, stand.x + 30); // on C before the swap delay runs out
    await bot.until(() => Math.abs(C.x - 280) < 1 && Math.abs(C.y - 200) < 1, 8000, 'C to carry the player across');
    if (Math.abs(pl.y + 32 - C.y) > 2) throw new Error('the player should ride C across');
    await jumpTo(g.room.solids[1], C.x + 10);
    await bot.until(() => g.intercom && g.intercom.box.id === 'I3', 2000, 'the lock message');
    // The landing is reached from the right, so its intercom stands to the right of T3, met first.
    const I3 = g.room.intercoms[2];
    if (!(I3.x > g.room.terminals[2].x) || I3.term !== 'T3') throw new Error('the landing intercom should stand just right of T3');
    await bot.tap('KeyH');
    out.push('X raised A, SWAP carried the player across on C, onto the stair landing (real jumps)');
    await bot.terminal('T3', [1]);
    const d = g.door;
    await bot.until(() => g.blackout, 2000, 'the blackout');
    if (!d.open) throw new Error('the stair door should open as soon as the lock reads 1');
    await bot.until(() => g.blackout.dark && g.intercom && g.intercom.box.id === 'I3', 4000, 'the dark and the Professor');
    const t1 = g.floorTime;
    await new Promise((r) => setTimeout(r, 400));
    if (g.floorTime !== t1) throw new Error('the message should not count on the clock');
    await bot.exit();
    out.push(`the lock opened the door at once and set off the blackout; walked out while the Professor spoke; cleared in ${g.floorTime.toFixed(1)} s of play`);
    return `story level 0: ${out.join('; ')}`;
  });
  const lobbyStars = await page.getAttribute('#complete-stars', 'aria-label');
  if (lobbyStars !== '3 of 3 stars') throw new Error(`a clean lobby run earns every star: ${lobbyStars}`);
  report.push(`story level 0: ${lobbyStars}`);

  // Story mode, Level 1: Superposition. "Next level" from the lobby. The flashlight lies on the
  // floor; the Professor answers each look at A (lucky or not); T2's and T3's intercoms speak only
  // when called. Each platform is retried with H and the flashlight until it lands where needed.
  if ((await page.textContent('#btn-next')).trim() !== 'Next level') throw new Error('the lobby should lead on to the next story level');
  await page.click('#btn-next');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 16);
  await step('story level 1', async () => {
    const g = bot.G();
    const pl = g.player;
    const out = [];
    const said = () => (g.intercom ? g.intercom.lines[g.intercom.index] : '');
    await new Promise((r) => setTimeout(r, 400));
    if (!g.titleCard || g.torch.battery !== 'none') throw new Error('Level 1 opens on its title card, with no flashlight yet');
    bot.key('ArrowRight', true);
    await bot.until(() => !g.titleCard, 1000, 'the title card to go');
    bot.key('ArrowRight', false);
    await bot.until(() => /^Uh-oh, these platforms are in a quantum superposition/.test(said()), 2000, 'the Professor on entry');
    const fl = g.room.flashlight;
    await bot.walkTo(fl.x);
    await bot.until(() => fl.taken, 2000, 'the flashlight');
    if (g.torch.battery !== 'ok' || !g.banner || g.banner.text !== 'FLASHLIGHT ACQUIRED!') throw new Error('picking up the flashlight should fit it and say so');
    if (!/^Perfect! Press F to turn on the flashlight/.test(said())) throw new Error(`the Professor should explain F: "${said()}"`);
    out.push('the flashlight on the floor was picked up (FLASHLIGHT ACQUIRED!), and the Professor explained F');
    // A starts in superposition: look at it until it is raised; H at T1 between tries.
    let looks = 0;
    let unlucky = false;
    while (looks < 12) {
      await bot.walkTo(g.room.terminals[0].x);
      const got = await bot.observe('A');
      looks += 1;
      await bot.until(() => said(), 1000, 'the Professor to answer the look');
      if (got === 1) {
        if (said() !== 'That was lucky!') throw new Error(`a raised A should be "That was lucky!": "${said()}"`);
        break;
      }
      if (!/^Bad luck! Use the terminal/.test(said())) throw new Error(`a lowered A should be bad luck: "${said()}"`);
      unlucky = true;
      if (!/^Use the terminal to apply a Hadamard/.test(g.room.intercoms[0].lines[0])) throw new Error('after bad luck, the first intercom should explain H');
      await bot.terminal('T1', [1]);
      if (g.intercom) throw new Error('using T1 should clear the bubble');
    }
    const A = bot.platform('A');
    if (A.state !== 1) throw new Error('A never came up raised');
    out.push(`A came up raised after ${looks} look${looks === 1 ? '' : 's'}${unlucky ? ' (the Professor said "Bad luck!" and explained H first)' : ''}, "That was lucky!"`);
    await bot.tap('KeyX');
    const [stand2, stand3] = [g.room.solids[2], g.room.solids[3]];
    await bot.hop(bot.slab('A'));
    await bot.hop(stand2);
    // T2's intercom only speaks when called.
    // H at T2 (anywhere T2 can be used) calls its intercom, which stands just left of it.
    const I2 = g.room.intercoms[1];
    const T2 = g.room.terminals[1];
    if (!(I2.x < T2.x) || I2.term !== 'T2') throw new Error('the intercom by T2 should stand just left of it');
    await bot.walkTo(T2.x + 10);
    await bot.until(() => g.passive === T2, 2000, 'T2 to show its gate');
    if (g.intercom) throw new Error('the intercom by T2 should not speak by itself');
    await bot.tap('KeyH');
    if (!/^There's no way to jump across/.test(said())) throw new Error(`H at T2's intercom: "${said()}"`);
    const retry = async (term, q, want) => {
      let n = 0;
      while (bot.platform(q).state !== want && n < 12) {
        await bot.terminal(term, [1]);
        await bot.observe(q);
        n += 1;
      }
      if (bot.platform(q).state !== want) throw new Error(`${q} never came to ${want}`);
      await bot.tap('KeyX');
      return n;
    };
    const nB = await retry('T2', 'B', 1);
    await bot.hop(bot.slab('B'));
    await bot.hop(stand3);
    const I3 = g.room.intercoms[2];
    const T3 = g.room.terminals[2];
    if (!(I3.x < T3.x) || I3.term !== 'T3') throw new Error('the intercom by T3 should stand just left of it');
    await bot.walkTo(T3.x + 10);
    await bot.until(() => g.passive === T3, 2000, 'T3 to show its gate');
    if (g.intercom) throw new Error('the intercom by T3 should not speak by itself');
    await bot.tap('KeyH');
    if (said() !== 'This platform is too high. Do you think the Hadamard gate works on the higher state too?') throw new Error(`H at T3's intercom: "${said()}"`);
    const nC = await retry('T3', 'C', 0);
    await bot.hop(bot.slab('C'));
    await bot.hop(g.room.solids[4]);
    await bot.exit();
    out.push(`B raised after ${nB} H${nB === 1 ? '' : 's'}, C lowered (from raised) after ${nC}; the intercoms just left of T2 and T3 answered H at the terminals; out up the stairs`);
    return `story level 1: ${out.join('; ')}`;
  });
  const oneStars = await page.getAttribute('#complete-stars', 'aria-label');
  if (oneStars !== '2 of 2 stars') throw new Error(`a clean run of story level 1 earns both stars: ${oneStars}`);
  report.push(`story level 1: ${oneStars}`);

  // Options: Automatic Hints (off by default) and the unlock code.
  await page.click('#btn-menu');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'title');
  if (!(await page.isVisible('#opt-code'))) await page.click('#options summary');
  if (!(await page.isChecked('#opt-hints-off'))) throw new Error('Automatic Hints should be off by default');
  await page.check('#opt-hints-on');
  if (!(await page.evaluate(() => window.blackoutLab.state.dev.autoHints))) throw new Error('Automatic Hints on did not take');
  await page.check('#opt-hints-off');
  await page.fill('#opt-code', 'qbit');
  await page.click('#btn-code');
  if (!/does not work/.test(await page.textContent('#opt-code-status'))) throw new Error('a wrong code should be refused');
  await page.fill('#opt-code', 'qUbIt');
  await page.press('#opt-code', 'Enter');
  if (!/All levels unlocked/.test(await page.textContent('#opt-code-status'))) throw new Error('QUBIT should unlock every level');
  report.push('Options: Automatic Hints off by default and switchable; a wrong code refused, "qUbIt" unlocked every level');

  // The title keeps the stars and best times earned above; Reset game (two clicks) clears them.
  if (await page.evaluate(() => window.blackoutLab.state.mode !== 'title')) await page.click('#btn-menu');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'title');
  if (await page.isHidden('#title-floors')) await page.click('#btn-floors');
  const totals = async () => ({
    total: (await page.textContent('#star-total')).trim(),
    floor2: await page.$eval('#title-floors button[data-floor="1"]', (el) => el.getAttribute('aria-label')),
  });
  const before = await totals();
  if (!(await page.isVisible('#btn-reset'))) await page.click('#options summary');
  if (/^★ 0 of/.test(before.total) || !/4 of 4 stars\. Best time \d+:\d\d\./.test(before.floor2)) throw new Error(`the title should show the stars and best times earned: ${JSON.stringify(before)}`);
  await page.click('#btn-reset');
  if (/^★ 0 of/.test((await totals()).total)) throw new Error('one click must not reset the game');
  await page.click('#btn-reset');
  const after = await totals();
  const stored = await page.evaluate(() => localStorage.getItem('blackoutLab.progress.v2'));
  if (!/^★ 0 of/.test(after.total) || !/0 of 4 stars\. Not cleared yet\./.test(after.floor2) || stored !== '{}') throw new Error(`Reset Progress should clear every star and time: ${JSON.stringify(after)} ${stored}`);
  report.push(`the title showed ${before.total} and floor 2 "${before.floor2}"; Reset Progress (Options, two clicks) brought it back to ${after.total}`);

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
