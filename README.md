# Blackout Lab
By Team Qute Bits.

A 2D platformer where the level is a quantum circuit. The power is out in a quantum computing building and the lift platforms have become entangled with the lab's qubits. A platform in superposition is in two places at once until your flashlight lights it, because light is a measurement. Over seven floors you apply gates at terminals, carry a sealed qubit between rooms, save a cat, teleport a door key, and cross a floor with no light at all. Then you climb to the roof and bring the power back.

**Theme:** Quantum Playground + Quantum Unlocked &nbsp;·&nbsp; **Runs in:** any modern browser, nothing to install &nbsp;·&nbsp; **Licence:** MIT

This effort is supported by Qollab & IonQ.

> Team Members: Yusuf Ahmed, Dev Chauhan, Ayesha Iqbal.

> Qollab Project Page: https://qollab.xyz/u/D3vsinh/blackout-lab-educational-game

## How to run it

Blackout Lab is a static web page: HTML, CSS and plain JavaScript, with no server code, no build step to play it and nothing to install. Use a recent Chrome, Edge, Firefox, Safari, Brave or Opera on a computer with a keyboard.

- **On the web:** publish the repository with GitHub Pages (Settings → Pages → deploy from the branch, root folder) and open the site. `index.html` is the game.
- **From one file, offline:** download [`dist/blackout-lab.html`](dist/blackout-lab.html) and double-click it. It is the whole game in a single file, and works from disk with no server. (The fonts load from Google Fonts when online; without a connection the page falls back to system fonts.)
- **From a copy of the repository:** browsers will not run the split-up source files from `file://`, so either open `dist/blackout-lab.html` or serve the folder with any static server, for example `npx serve .` or `python3 -m http.server`, then open the address it prints.

## How to play

| Key | Action |
| --- | --- |
| ← → or A D | Walk |
| Space or W | Jump |
| F | The flashlight: held down to shine (Hold mode), or pressed to switch it on and off (Switch mode, in Options) |
| I / K, or the mouse | Aim the flashlight: straight ahead, tilted with I / K (the tilt eases back to straight ahead after a few steps of walking); with Mouse Aim on in Options, also at the mouse while it is over the game |
| Enter | At a terminal: apply the highlighted gate (standing at a terminal shows its gates; the first is highlighted). Elsewhere, the same as E |
| Q / E, [ / ], comma / full stop | At a terminal: move the highlight left / right |
| 1, 2, 3… or a click | Apply a terminal's gate directly, by its number |
| E | Use a port, talk, go through a room door, try a lock, pet the cat (at a terminal, it moves the highlight) |
| H | Show a hint; in story mode, call the Professor at an intercom |
| X | Story mode: clear the Professor's bubble (so do H, E, Enter, using a terminal, walking into the bubble, or clicking its ✕) |
| R / P / M | Restart floor / pause and options / sound |
| Main menu (top right) | Back to the title screen from anywhere, including the cleared-floor, pause and out-of-lives screens |

- Every moving platform is a qubit. State `0` parks it lowered, state `1` parks it raised.
- A platform in superposition is drawn as dotted outlines at both heights.
- Hold the flashlight beam on an outline for about half a second and the qubit is measured. It collapses to one height, at random, with the odds shown in the rack.
- Touching is measuring too. Land on either outline of a superposed platform and it collapses, by the Born rule (50/50 after an H): you land if it went to the height you touched, otherwise you drop past it. And if a gate leaves the platform you are standing on in superposition, your touch measures it at once: you stay on if it collapses where you stand, and fall if it goes to the other height. (A gate is taken as instantaneous; only a steady drive, like a cavity's, can be frozen by watching it.)
- Standing at a terminal shows its gates with their numbers. Enter applies the highlighted one (Q and E move the highlight), and 1, 2, 3 or a click apply one directly, while you can still move and look; platforms move as soon as a gate is applied. Nothing shuts you in at a terminal. An exit opens by itself once every lock lamp is certain and matches the key (except floor 6's, whose lock runs its own gates before reading).
- Each gate pops up over the qubits it acts on, and while you hold the canister the panel shows it enlarged with its state (or its entangled partners).
- From floor 3 you carry a **canister** holding one sealed qubit. No light gets in, so the flashlight cannot read it. Dead terminals still have a canister port: plug in and the port applies a CNOT with the canister as control.
- The title screen's side panel says where the game was made and links to its Qollab and GitHub pages (fill in the two empty `href` attributes in the `about` block of `index.html`, then rebuild the single file; until then each line reads "link not added yet").
- Falling into the gap costs one of three lives, and you are back at the last terminal you used (or the room's start) with every qubit just as you left it (every gate applied so far still applied). Lose all three and the floor starts over from the beginning. Unlimited lives are in the pause menu. "Skip to floor" on the title screen and in the pause menu jumps to any floor.
- **Stars**: one for clearing a floor and one for clearing it without a fall, and on a floor that can be solved without luck, one for the fewest gates with nothing left to chance and one for its own no-luck solution. A floor that needs luck has just those first two. No star rewards luck or speed, and hints cost nothing. Each level in the lists shows its stars (filled once earned, and kept) and its best time; the title shows the total.
- **Options** (a collapsible panel on the title screen, also shown on the pause screen), each a name with its choices: **Flashlight Switch** (Hold F, or Press F to switch it on and off), **Mouse Aim** (Off by default; On, the mouse aims the flashlight while it is over the game) and **Reset Progress** (Press to Reset, then press again to confirm), which clears every star and best time.

The **circuit** you have built on this floor is drawn under the game, whole, with a meter icon and its result for every observation (**Collapse** moves it into the rack on the right, where it scrolls sideways). The rack starts with the floor's **goal**, then the **probability** of 0 and 1 for every qubit plus the joint outcomes of anything entangled, **lab notes** with a concept explanation, hints and an event log, and last "This floor as Qiskit code" (the same circuit as code you can paste into a notebook).

### Developer options

The title screen has a collapsible **Developer options** panel, under the credits; the pause screen shows the same panel, next to a reminder of the controls. The browser remembers them (`localStorage`).

| Option | What it does |
| --- | --- |
| Swap delay | How long SWAP waits, counting down with its arrows showing, before the platforms set off: 1 to 5 seconds, 3 by default (3, 2, 1, SWAP!). |
| Panel position | Right (the normal layout) or Bottom: the rack moves under the game, with its modules side by side. |
| Circuit always adds to the right | Every new step in the circuit gets its own column after everything before it, instead of moving left into the first free column. |

Five earlier developer options are now simply how the game plays, always on, with no switch: touch-collapse, instant response, the passive terminal, the canister view and show gates (`ALWAYS_ON` in `game/game.js`). The keyboard flashlight became the Flashlight mode in Options. To add an option: put its default in `DEV_DEFAULTS` in `game/game.js`, add a switch to the `dev` block in `index.html`, and list it in `devSwitches` in `game/ui.js`.

## The seven floors

| Floor | What happens | What it teaches |
| --- | --- | --- |
| 1 Superposition | H, then look, until two platforms land raised. | H makes a 50/50 superposition; looking collapses it; a bad result can only be retried, not undone. |
| 2 Certainty and Interference | X, H and Z on three platforms. Its extra stars are for solving it without luck: H then X on the middle one and H·Z·H on the last one, with nothing measured, in six gates. | X is a certain flip. Z changes nothing you can see, yet H·Z·H is an X: phase is real, and interference turns it into certainty if you do not look in between. |
| 3 The Sealed Canister | Carry the canister; entangle it with a platform through a port; set a one-lamp exit key. | You cannot look inside the canister, but entangling it with a platform and looking at the platform measures both. |
| 4 Low Battery | The flashlight flickers, and dies as you reach the ledge with the battery station. The terminal on that ledge drives a platform far across the room. Two-lamp exit key. | You can only observe what your light reaches, so a 50/50 you cannot check from where you stand costs a trip each time it lands wrong. |
| 5 Schrödinger Lab | The Professor's cat is in a box whose atom is entangled with the canister at the top of the room. A broken bridge on the way holds only when both halves are in state 1. | Nothing done to one half of an entangled pair changes the other's odds. Bring them together and one CNOT undoes the entanglement, but only while the box is still shut. Only one bridge half has an H; the other can only follow it through a CNOT, so the two rise or fall together. |
| 6 Alice and Bob | Two rooms. The platform on the way to Alice can only be put in superposition and observed, which is why Bob cannot go himself. Share an entangled pair, carry half to Alice, read her two bits, walk them back, apply Bob's fix, open the exit. | Quantum teleportation, complete: the lock checks Bob's qubit against its own, so both the X and the Z correction matter, and the two bits have to be carried on foot. |
| 7 Lights Out | The flashlight is dead. Five platforms, one of which has to end up lowered, and a three-lamp key on a ledge at the top left. | With no way to look and retry, only gates with a certain result will do: H·Z·H, H undoing H, H telling \|+⟩ from \|−⟩, and a CNOT that separates an entangled pair. |

The last exit leads up to the terrace. There are no qubits there: crank the generator, the building's lights come back, and the Professor, Alice, Bob and the cat come out for a short ending. The final screen offers a return to the start or a replay of any floor.

Exit locks are made of qubit lamps, each labelled with the qubit behind it; those qubits are shown in yellow in the rack. A lock is read by flashlight or by pressing E beside it (E only on floor 6), and opens when the lamps match the key shown above them. A wrong key clears the lamps; on floor 6 it also uses up the teleported key, and a fresh one is prepared.

## Bonus levels

Bonus levels are reached only from "Skip to floor" (on the title screen and in the pause menu), under their own heading. They are not part of the climb: finishing one leads to the next bonus level or back to the title, running out of lives restarts it, and its stars do not count towards the ending.

| Bonus level | What happens | What it teaches |
| --- | --- | --- |
| 1 Broken Terminal | Your flashlight is dead and both terminals are broken, stuck in loops you cannot touch. T1 turns platform P by Ry(pi/2) every 1.5 seconds (lowered, superposed, raised, superposed): ride it up as it rises. On the ledge, a weak spare battery whose beam reaches A but not B, and T2 looping H on A, CNOT A to B, CNOT, H. Look at A until it reads 1 at the right point in the loop (caught just before the first H, it stays uncertain through the CNOTs: look again); from then on each cycle raises B for one tick (1.5 seconds), and you jump from A to B to the exit. | A gate sequence that undoes itself never leaves B certain, but one measurement changes what the same gates do: once A is an ordinary 1, the CNOT copies it onto B. |
| 2 SWAP Shuffle | A, B and C start at 0 0 0 and must read 0 1 1 to make a way across. T1 has only X on A, SWAP A and B, and SWAP B and C, and here the swaps go at once. X, SWAP A B, X, SWAP B C, SWAP A B does it; five gates earns the fewest-gates star. No superposition, no flashlight needed. | SWAP moves a state without copying it: ordinary bits, shuffled down a line. |
| 3 Quantum Communication | T1 offers H on Alice's platform Q, SWAP with Bob's platform R, Z on R, and X on the shield S. SWAP makes the two platforms trade places (after the swap delay, with arrows showing where each goes), so Q's state really crosses the room, under a backup light. Shielded, H, SWAP, Z, SWAP, H makes Q a certain 1; a last SWAP carries the player on it to the exit above Bob. The flashlight starts switched off, and luck can also win. Stranded down on Bob's side? T2 there swaps Q and R back, so a platform can carry you home. | Any light is a measurement, the way quantum key distribution spots an eavesdropper. SWAP moves a state between qubits. H, Z, H makes an X only if nothing looks in between. |
| 4 Emergency Channel | The same channel (T2 on Bob's side included) with a red emergency light: any unshielded crossing comes out as 0, even the raised platform you ride. The shield blocks the light in state 0. | Amplitude damping: the environment drains a qubit to 0. |
| 5 Decoherence Time | Faulty lights over every platform. At T1, H, Z, H raises P before the light collapses it. At T2, A must end lowered and B raised, with H and Z on A, H on B and a CZ between them: H Z H on A, H on B, CZ, H on B, H Z H on A. | Every superposition has a deadline (the decoherence time). CZ applies Z to one qubit when the other is 1. |
| 6 The Watched Qubit | Cavity waves keep P, A and B turning (Rabi oscillation). Freeze P lowered with the flashlight (it starts off) and stand on it to keep it there. A and B turn together, so Ry(pi/2) twice at T1 puts B half a turn ahead; then X at T2 slides the shield S into the waves as A reaches 0, freezing the pair at 0 and 1, and the flashlight collapses them. | Rabi oscillation, and the quantum watchdog (Zeno) effect: a qubit that is watched all the time cannot change. |

### Bonus level 7: The Beast on the Roof

The last bonus level, listed with the others. It opens like the ending on the terrace, but with a box in the middle of the roof and the terminals switched off. You walk to the generator and crank it, the lights come on, and the Professor, Bob, Alice and the cat come out. This time the cat hides in the box. Bob: "It's OK, here kitty kitty!" The Professor: "Don't open the box!" Bob opens it, and the radiation has turned the cat into a giant monster that rises behind the skyline: white, mangy and ragged, with glowing green slit eyes and long fangs over a shut snarl. The Professor: "Quick, we need to reverse this evolution!" One swipe sends Alice, Bob and the Professor off the building and brings down the string lights, and the lamp posts that held them burst and go dark; the monster screeches at you, mouth wide, and sinks into a mist, and the fight (and its music) begins. Before the generator is on, Space just jumps (over the box, say) and E away from the generator skips the scene; once it is cranked, Space or E skip the rest at any point.

The cat is one qubit: **0 is cute, 1 is monster**, and it starts at 1.

- **The mist.** The monster's face is in plain view at the start. Once the paws start, a mist rolls in over it, and only the flashlight parts it. In the light you see what the cat certainly is, monster or cute; a cat in superposition is measured first (two glowing eyes are all that shows through the mist otherwise).
- **The paws** (three players wide, no arms) float free. They take turns: one rises to the top of the screen, follows you, stops for a moment to wind up (its shadow turns red), then drops straight down. Three times in ten it swipes instead: it comes down at one end of the roof, a red streak shows its path, and it sweeps along the roof to the other end, low enough to jump over. Caught by a paw (or off the edge), you are flattened and flung off the screen: a life lost, and you are back at the stair door with the cat exactly as you left it (every gate applied so far still applied). Out of lives, the level starts over.
- **Two terminals**, one on each side of the roof, each apply **RY(pi/8)** with a single press of 1 (shown on the terminal panel, as on other levels with the passive terminal option) or E. The cat answers at once: a paw rises straight over that terminal and smashes it, with no following and no wind-up, so run as soon as you press. The terminal comes back 10 seconds later.
- **Looking** is a measurement: the flashlight on the cat, which takes no aiming up or jumping, since a beam held level along the roof towards the middle finds it. Cute (0) comes up with chance sin^2(k pi/16) after k turns: a MEOW, and the fight ends. Monster (1) undoes every turn: it SCREECHES, shows itself out of the mist for two full seconds, and brings both paws straight down wherever they are. Eight turns with nobody looking make it certainly cute, and that ends the fight too.
- **Boss music** plays while it fights: an original chiptune loop (A minor, i VI iv V, 150 bpm), written note by note in `game/audio.js` with Web Audio, so there is no music file and nothing to license.
- Stars: tamed; the fewest gates with no luck (8); and deterministically made the cat cute (eight RY turns in a row, no look).

| Bonus level | What happens | What it teaches |
| --- | --- | --- |
| 7 The Beast on the Roof | Dodge the paws while turning the cat with RY(pi/8) at two terminals the cat keeps smashing. The cat hides in a mist: gamble on an early look with the flashlight, or make eight turns and be sure. | A coherent change (a rotation) can be undone by the opposite rotation. Looking part way gives the Born-rule odds, and a bad result throws the progress away. |

They bring new pieces, which any floor can use:

- **Backup lights** shine a fixed cone. Solids and certain platforms cast shadows, so the lit area is traced around them. Like the flashlight, a light resting on a superposed platform measures it. A **normal** light is as quick as the flashlight; a **weak** (faulty) one, sparking at its lamp, takes five times as long; a red **emergency** light damps the qubit all the way to 0 (amplitude damping) in the flashlight's time, even from a certain 1. They stand in for decoherence: the environment watching your qubits, so they keep working while you are at a terminal.
- **Cavities** are a band of waves between two caps, fed with power through a waveguide from the edge of the room, turning every platform in the band round and round (a Rabi oscillation: Ry at a steady rate, 0, +, 1, -, 0). A state part way round is drawn as both pictures at once: the platform at its likelier position, as solid as the state is close to it, over faint 50/50 outlines. A watched platform (lit by the flashlight or a backup light, or stood on) does not turn: the quantum watchdog effect. A cavity is all or nothing: a shield (a `steady` platform) or a solid spanning the band's whole width empties it, and anything narrower does nothing; cleared, it fills again column by column and only drives once full. In a room with a cavity, platforms move while you are at a terminal, since timing is the puzzle there.
- **SWAP between two platforms** makes them trade places (where the two pass each other at one height, you stay on the one you are riding): after the swap delay, counted down on screen (3, 2, 1, SWAP!) while arrows show where each will go (time to jump on or off), the states are exchanged and each platform carries its old state to the other's place. Every other gate is greyed out until the swap has finished, and lights and cavities act on the platforms as they travel.
- **Broken terminals** cannot be used (no E): each applies its own gates by itself, one every so often, round and round, whatever you do. Its cracked screen shows the gate it applies next and a bar filling up to it; a spark flies to the qubit just as the gate lands, and the gates show in the circuit as the floor's own (`# done by the floor itself` in the Qiskit code).
- **Weak spare batteries** (`range` on a battery) refit a dead flashlight with a shorter beam, so you can only observe what is close.
- **Instant SWAPs**: a SWAP can set its own delay (`delay: 0` sends the platforms off at once, with no countdown), whatever the developer option says.
- **Sideways platforms** keep one height and slide between two positions for 0 and 1, to open a way through or to block a light.
- **The I (identity) gate** does nothing to the state, listed as `qc.id()` in the Qiskit code, and **SWAP** is `qc.swap()`.
- **The Ry gate** turns a qubit part of the way round by an angle (a terminal's Ry(pi/2) is a quarter turn); a cavity's drive shows in the circuit as one dashed RY box per stretch of driving, and as `qc.ry(angle, qubit)` in the Qiskit code.
- **The CZ gate** applies Z to one qubit when the other is 1 (it works the same both ways round), drawn as two joined dots, `qc.cz()` in the Qiskit code.

## Story mode

Story mode is listed under its own heading in "Skip to floor", after the bonus levels. The levels above stay as they are. Story levels start lit and introduce one idea at a time, with the Professor talking over the building's intercoms.

- **Title card.** Each story level opens with its name in block letters. The card goes, and the clock starts, as soon as the player moves.
- **Intercoms.** These are speaker boxes on the wall, set just before the terminal they go with, on the side the player walks in from (usually the left), so players try them first. In front of one, or anywhere its terminal can be used, an H shows above it; press H to call the Professor. His answer appears as a radio bubble with a lightning-bolt tail to the speaker, in the terminals' blue, and goes into the log. Walking, jumping, gates and the flashlight all keep working while the bubble is up. H, E, X or Enter clears it, and so do using a terminal, walking into the bubble, and clicking its ✕. Time spent on the Professor's messages does not count towards the level's time. A few intercoms speak by themselves, the first time the player reaches them; with **Automatic Hints** (Options, off by default) every intercom does.
- **Unlock Code.** Under Options, a code unlocks every level. Otherwise each story level opens once the one before it is cleared.
- **The Professor answers events** (a level's `events`): picking up the flashlight, or a qubit measured to a given value, makes him cut in through an intercom, and can change what that intercom says when called.

| Story level | What happens | What it teaches |
| --- | --- | --- |
| 0 The Lobby | A bright lobby; the player has no flashlight yet. X at T1 raises a platform (with the floor underneath). SWAP at T2 carries the player across on a moving platform to the stair landing. X at T3 sets the lock to the key, 1. The stair door opens at once, and the building shakes, cables spark and fall, and the lights go out. | X flips a qubit with certainty; SWAP exchanges two qubits; a lock reads its lamps. |
| 1 Superposition | Built from floor 1, in the dark. The flashlight lies on the floor in front of the player (FLASHLIGHT ACQUIRED!). A starts in superposition, with the only floor under it; the Professor answers each look at it ("That was lucky!" or "Bad luck!", then a hint about H). B starts lowered: H at T2, then look. C starts raised, out of reach: H at T3 works from raised too, then look until it is lowered. The intercoms by T2 and T3 speak only when called. | Superposition and measurement: H makes a 50/50 superposition from either state, and a look picks one at random. |

## Where the quantum computing is

All quantum behaviour is computed in the browser by a small exact simulator, `game/quantum.js`. It models **ideal** quantum mechanics: no device parameters, no noise.

- **Live state.** Each floor's qubits (at most 10) are held as a full state vector of complex amplitudes. A gate at a terminal is the exact H, X, Z or CNOT matrix applied to it, so H gives exactly 50/50, H twice cancels, and H·Z·H is exactly an X. Flashlight light is a Born-rule sample followed by a projection onto the outcome: the only randomness in the game. Entangled groups are found from reduced states: a set of qubits has a state of its own exactly when its reduced state is pure.
- **Circuit history.** Every action, including mid-circuit measurements and resets, is recorded. The drawing in the rack and the "This floor as Qiskit code" listing are generated from that record. The listing is real Qiskit code: paste it into a notebook with Qiskit installed and it rebuilds the same state, amplitude for amplitude. (The engine numbers qubits the way Qiskit does, so that this holds.)
- **Floors that start entangled.** A floor can list gates it applies before play (`prep` in `game/levels.js`), which is how the cat's atom starts entangled with the canister and Alice's key with the exit lock. The teleportation floor is tested end to end in `tests/engine.test.mjs` for all four messages and for each correction being skipped, and the protocol is checked separately on random input states, phase included.

## Project layout

```
index.html, main.css      the page and its styles
main.js                   entry point: starts the game
game/levels.js            floor data: rooms, geometry, qubits, terminal gates, hints; the terrace
game/story.js             dialogue and floor events (Professor, Alice, Bob, battery)
game/game.js              rules, platformer physics, flashlight, canister, doors, the ending
game/quantum.js           the quantum engine: exact state vector, measurement, circuit history, Qiskit listing
game/render.js            canvas drawing, the darkness mask, the terrace at night
game/panel.js             circuit, probabilities and notes in the rack
game/ui.js, input.js, audio.js, geometry.js
dist/blackout-lab.html    the whole game in one file (generated: do not edit by hand)
tools/build.mjs           generates dist/blackout-lab.html from the files above
tests/                    engine and level-data tests, browser playthrough bot
```

**Adding a floor** (or a bonus level, in `BONUS_LEVELS`) needs no code: append an object to `LEVELS` in `game/levels.js` with its qubits (`platform`, `canister`, `sealed`, `box` or `door`), platform positions for state 0 and 1, the gates each terminal or port offers, the exit key, and the hint texts. The comment at the top of that file lists every field. Characters and their lines go in `game/story.js`. Then run `npm test` (which also checks the new floor's data) and `npm run build` to refresh the single-file version.

**The single file** is generated, not written by hand. `tools/build.mjs` places `main.css` in a `<style>` block and every JavaScript file, in dependency order, in one `<script>`, each in its own scope under a banner naming its source file, with nothing minified. It stays readable, and a quick fix can be made in it directly, but edits there are lost at the next build, so make lasting changes in the source files.

## Tests

Needs [Node.js](https://nodejs.org/) 20 or later. Nothing else is needed for the first two commands.

```bash
npm test               # engine physics, teleportation, level data; checks dist/ is up to date
npm run build          # regenerate dist/blackout-lab.html after any change
npm run playthrough    # the bot plays the whole game (needs Playwright, see below)
```

`npm test` covers the engine (exact 50/50, H·H, H·Z·H, Bell and GHZ collapse, entanglement groups, resets, the code listing, teleportation for every message, with each correction skipped, and on random states) and checks every floor in `game/levels.js` for unknown qubit ids or gates, mismatched keys and locks, and that the engine can start it.

The playthrough is a bot that plays all seven floors and the ending in headless Chromium through real key events. Along the way it checks that only E leaves a terminal, all three stars on floor 2 with no luck, the flashlight dying and being revived on floor 4, a refused exit key, the Professor refusing to open an uncertain box, petting the cat, a teleport with the correction skipped (refused) and done properly (accepted), the terrace ending line by line, replaying a floor and returning to the start from the final screen, a fall keeping every qubit as it was, touching a superposed platform measuring it, the stars and best times kept on the title and cleared by Reset Progress, both flashlight modes with the mouse and I / K, a fall bringing the player back to the last terminal used, and losing all three lives on floor 3, which starts that floor over. It needs Playwright once: `npm install --no-save playwright && npx playwright install chromium`.

```bash
node tests/playthrough.cjs                           # the site, served from this folder
node tests/playthrough.cjs dist/blackout-lab.html    # the single file, opened from disk
node tests/playthrough.cjs https://<you>.github.io/<repo>/   # a published copy
```

## Accessibility

- Fully playable from the keyboard; the mouse can be switched on in Options as a second way to aim the flashlight, over the game only. Fixed-height jumps, no timers, no quick reactions required, pause at any time.
- Unlimited lives are an option.
- State is never carried by colour alone: every qubit shows `0` / `1`, lowered / raised, percentages, and solid versus dotted outlines.
- Terminals and menus are real buttons with visible focus, labelled for screen readers. Every quantum event and every line of dialogue is written to the event log and announced through a live region, and the circuit has a text description. Speech bubbles are repeated as text under the game. The ending plays by itself, but every line of it is also logged and announced, and E moves a spoken line on early.
- Sound is optional and never the only signal.

## Judging summary

- **Novelty and creativity.** Measurement is the core game mechanic, not a random-number source: where the player points the flashlight, and when, decides which qubits collapse. Entanglement is something you see and carry (platforms that snap together, a canister that is half of a pair), and Schrödinger's cat and teleportation are playable rather than explained.
- **Technical execution.** One exact state-vector engine is the single source of truth for state, circuit and probabilities, and its Qiskit listing rebuilds the same state in Qiskit. Automated engine and level-data tests, and an end-to-end browser playthrough of every floor.
- **Impact potential.** A first contact with superposition, measurement, interference, entanglement and teleportation that needs no maths and no install, and hands the player the Qiskit code for what they just did. New floors are data, so teachers and other builders can extend it.
- **Documentation.** This page, documented modules and floor data, and tests that double as examples.

## What is not here yet

- Only H, X, Z and CNOT. No rotations, no measurement in other bases.
- Ideal physics only: there is no noise. (An earlier Qiskit version, kept in a separate repository, measured a real backend's noise and fed it into the game.)

## Security and privacy

The game is a static page: no server, no accounts, no analytics, and nothing the player does leaves the browser. The only things it fetches from elsewhere are its fonts, from Google Fonts (which sees the player's IP address, as with any Google Fonts page; without a connection the page falls back to system fonts). A content security policy in `index.html` lets only the page's own scripts run (the single-file build allows its one inline script by hash) and blocks every other request. The developer options are kept in the browser's `localStorage` and are checked field by field when read back.

## Disclosures

- **Libraries:** none at runtime. The "This floor as Qiskit code" listing is meant to be run with [Qiskit](https://github.com/Qiskit/qiskit) (Apache 2.0), which the game itself does not need. Fonts, when the network allows them, are Atkinson Hyperlegible, Big Shoulders Display and JetBrains Mono from Google Fonts (SIL Open Font Licence); the page falls back to system fonts.
- **AI assistance:** Claude (Anthropic) was used in helping design, code, test, and refining documentation text during the build window.
- **Prior work:** none. No template or earlier project was used, and no code was copied from anywhere.
- **Where the platform know-how came from** (for the original Qollab version, now kept in a separate repository; none of that platform code remains here): the [Qollab documentation](https://qollab.xyz/learn/docs/runtime-environment) (file layout, `callPromising`, one job per run), and reading three public repositories from this hackathon to see how they talk to Qollab: [tomcode1000/Canary](https://github.com/tomcode1000/Canary), [AGONIXX15/quantum_project_qollab](https://github.com/AGONIXX15/quantum_project_qollab) and [udsy19/Qollab-Hackathon](https://github.com/udsy19/Qollab-Hackathon). Two ideas were taken from the second of these and re-implemented in that version: compiling against the backend with a pinned layout and then dropping idle device qubits (`engine/calibrate.py`), and ending `main.js` with a never-resolving `await` so the run stays alive.
