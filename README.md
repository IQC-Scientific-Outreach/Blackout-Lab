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
| Mouse, or I / K | Aim the flashlight |
| F | Flashlight on / off |
| E or Enter | Use a terminal or port, talk, go through a room door, try a lock, pet the cat |
| ← → then Enter | Pick a gate while a terminal is open (E to leave) |
| H | Show a hint |
| R / P / M | Restart floor / pause and options / sound |
| Main menu (top right) | Back to the title screen from anywhere |

- Every moving platform is a qubit. State `0` parks it lowered, state `1` parks it raised.
- A platform in superposition is drawn as dotted outlines at both heights and cannot be stood on.
- Hold the flashlight beam on an outline for about half a second and the qubit is measured. It collapses to one height, at random, with the odds shown in the rack.
- Only light observes. Jumping at a superposed platform does not collapse it, and you fall straight through.
- While you are at a terminal your flashlight is lowered, so nothing is observed between the gates you apply there.
- From floor 3 you carry a **canister** holding one sealed qubit. No light gets in, so the flashlight cannot read it. Dead terminals still have a canister port: plug in and the port applies a CNOT with the canister as control.
- The title screen's side panel says where the game was made and links to its Qollab and GitHub pages (fill in the two empty `href` attributes in the `about` block of `index.html`, then rebuild the single file; until then each line reads "link not added yet").
- Falling into the gap costs one of three lives and resets the floor. Lose all three on one floor and the climb starts again from floor 1. There is no timer. Unlimited lives are in the pause menu. "Skip to floor" on the title screen and in the pause menu jumps to any floor.

The **circuit** you have built on this floor is drawn under the game, whole, with a meter icon and its result for every observation (**Collapse** moves it into the rack on the right, where it scrolls sideways). The rack starts with the floor's **goal**, then the **probability** of 0 and 1 for every qubit plus the joint outcomes of anything entangled, **lab notes** with a concept explanation, hints and an event log, and last "This floor as Qiskit code" (the same circuit as code you can paste into a notebook).

### Developer options

The title screen has a collapsible **Developer options** panel, under the credits, with experimental switches for trying out ideas. The pause screen shows the same panel, next to a reminder of the controls. All are off by default, and the browser remembers them (`localStorage`).

| Option | What it does |
| --- | --- |
| Keyboard flashlight | The flashlight shines only while F is held, straight ahead in the direction the player faces. The mouse does not aim it at all. |
| Touch-collapse | Landing on either outline of a superposed platform measures it, by the Born rule (50/50 after an H). The platform appears at the height it collapsed to: you land if that is the outline you touched, otherwise you drop past it. The circuit records it as a measurement ("Player landed on"). |
| Instant response | A gate applied at a terminal moves its platform straight away, while you are still at the terminal (normally the platforms wait until you leave). |
| Passive terminal | Standing at a terminal shows its gates, each with a number under it. Press 1, 2, 3 and so on (or click) to apply one: no E needed (and no E marker over the terminal), and you can still move and use the flashlight, so it can observe between gates. E or Enter steps into the terminal as usual (flashlight lowered), where the arrow keys then Enter or Space pick a gate, or the number keys still apply one; E steps back out. Exits also open by themselves as soon as every lamp is certain and matches the key, except floor 6's, whose lock runs its own gates before reading. |
| Canister view | While you hold the canister, a tile in the panel shows it enlarged on black, with its state over it in green (\|0⟩, \|+⟩ and so on), or "Entangled with A" (naming its partners) when it has no state of its own. |
| Show gates | Each gate you apply pops up for one second over its qubits, drawn like the circuit diagram (a square with its letter, or a CNOT's control dot and target joined by a line), with a glowing white outline. It sits halfway between a platform's two heights, or over the canister in the canister view. The new state appears halfway through, so the gate pops out onto it. |
| Panel position | Right (the normal layout) or Bottom: the rack moves under the game, with its modules side by side. |
| Circuit always adds to the right | Every new step in the circuit gets its own column after everything before it, instead of moving left into the first free column. |

To add an option: put its default in `DEV_DEFAULTS` in `game/game.js`, add a switch to the `dev` block in `index.html`, and list it in `devSwitches` in `game/ui.js`.

## The seven floors

| Floor | What happens | What it teaches |
| --- | --- | --- |
| 1 Superposition | H, then look, until two platforms land raised. | H makes a 50/50 superposition; looking collapses it; a bad result can only be retried, not undone. |
| 2 Certainty and Interference | X, H and Z on three platforms. A fourth star goes to whoever guarantees a platform with gates: H then X on the middle one, or H·Z·H on the last one, even after gambling on it first. | X is a certain flip. Z changes nothing you can see, yet H·Z·H is an X: phase is real, and interference turns it into certainty if you do not look in between. |
| 3 The Sealed Canister | Carry the canister; entangle it with a platform through a port; set a one-lamp exit key. | You cannot look inside the canister, but entangling it with a platform and looking at the platform measures both. |
| 4 Low Battery | The flashlight flickers, and dies as you reach the ledge with the battery station. The terminal on that ledge drives a platform far across the room. Two-lamp exit key. | You can only observe what your light reaches, so a 50/50 you cannot check from where you stand costs a trip each time it lands wrong. |
| 5 Schrödinger Lab | The Professor's cat is in a box whose atom is entangled with the canister at the top of the room. A broken bridge on the way holds only when both halves are in state 1. | Nothing done to one half of an entangled pair changes the other's odds. Bring them together and one CNOT undoes the entanglement, but only while the box is still shut. Only one bridge half has an H; the other can only follow it through a CNOT, so the two rise or fall together. |
| 6 Alice and Bob | Two rooms. The platform on the way to Alice can only be put in superposition and observed, which is why Bob cannot go himself. Share an entangled pair, carry half to Alice, read her two bits, walk them back, apply Bob's fix, open the exit. | Quantum teleportation, complete: the lock checks Bob's qubit against its own, so both the X and the Z correction matter, and the two bits have to be carried on foot. |
| 7 Lights Out | The flashlight is dead. Five platforms, one of which has to end up lowered, and a three-lamp key on a ledge at the top left. A fourth star for clearing it within two minutes. | With no way to look and retry, only gates with a certain result will do: H·Z·H, H undoing H, H telling \|+⟩ from \|−⟩, and a CNOT that separates an entangled pair. |

The last exit leads up to the terrace. There are no qubits there: crank the generator, the building's lights come back, and the Professor, Alice, Bob and the cat come out for a short ending. The final screen offers a return to the start or a replay of any floor.

Exit locks are made of qubit lamps, each labelled with the qubit behind it; those qubits are shown in yellow in the rack. A lock is read by flashlight or by pressing E beside it (E only on floor 6), and opens when the lamps match the key shown above them. A wrong key clears the lamps; on floor 6 it also uses up the teleported key, and a fresh one is prepared.

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

**Adding a floor** needs no code: append an object to `LEVELS` in `game/levels.js` with its qubits (`platform`, `canister`, `sealed`, `box` or `door`), platform positions for state 0 and 1, the gates each terminal or port offers, the exit key, and the hint texts. The comment at the top of that file lists every field. Characters and their lines go in `game/story.js`. Then run `npm test` (which also checks the new floor's data) and `npm run build` to refresh the single-file version.

**The single file** is generated, not written by hand. `tools/build.mjs` places `main.css` in a `<style>` block and every JavaScript file, in dependency order, in one `<script>`, each in its own scope under a banner naming its source file, with nothing minified. It stays readable, and a quick fix can be made in it directly, but edits there are lost at the next build, so make lasting changes in the source files.

## Tests

Needs [Node.js](https://nodejs.org/) 20 or later. Nothing else is needed for the first two commands.

```bash
npm test               # engine physics, teleportation, level data; checks dist/ is up to date
npm run build          # regenerate dist/blackout-lab.html after any change
npm run playthrough    # the bot plays the whole game (needs Playwright, see below)
```

`npm test` covers the engine (exact 50/50, H·H, H·Z·H, Bell and GHZ collapse, entanglement groups, resets, the code listing, teleportation for every message, with each correction skipped, and on random states) and checks every floor in `game/levels.js` for unknown qubit ids or gates, mismatched keys and locks, and that the engine can start it.

The playthrough is a bot that plays all seven floors and the ending in headless Chromium through real key and pointer events. Along the way it checks that only E leaves a terminal, the fourth star on floor 2, the flashlight dying and being revived on floor 4, a refused exit key, the Professor refusing to open an uncertain box, petting the cat, a teleport with the correction skipped (refused) and done properly (accepted), the terrace ending line by line, replaying a floor and returning to the start from the final screen, falling straight through a superposed platform without collapsing it, and losing all three lives on floor 3, which restarts the climb from floor 1. It needs Playwright once: `npm install --no-save playwright && npx playwright install chromium`.

```bash
node tests/playthrough.cjs                           # the site, served from this folder
node tests/playthrough.cjs dist/blackout-lab.html    # the single file, opened from disk
node tests/playthrough.cjs https://<you>.github.io/<repo>/   # a published copy
```

## Accessibility

- Fully playable from the keyboard; the mouse is only a second way to aim. Fixed-height jumps, no timers, no quick reactions required, pause at any time.
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

## Disclosures

- **Libraries:** none at runtime. The "This floor as Qiskit code" listing is meant to be run with [Qiskit](https://github.com/Qiskit/qiskit) (Apache 2.0), which the game itself does not need. Fonts, when the network allows them, are Atkinson Hyperlegible, Big Shoulders Display and JetBrains Mono from Google Fonts (SIL Open Font Licence); the page falls back to system fonts.
- **AI assistance:** Claude (Anthropic) was used in helping design, code, test, and refining documentation text during the build window.
- **Prior work:** none. No template or earlier project was used, and no code was copied from anywhere.
- **Where the platform know-how came from** (for the original Qollab version, now kept in a separate repository; none of that platform code remains here): the [Qollab documentation](https://qollab.xyz/learn/docs/runtime-environment) (file layout, `callPromising`, one job per run), and reading three public repositories from this hackathon to see how they talk to Qollab: [tomcode1000/Canary](https://github.com/tomcode1000/Canary), [AGONIXX15/quantum_project_qollab](https://github.com/AGONIXX15/quantum_project_qollab) and [udsy19/Qollab-Hackathon](https://github.com/udsy19/Qollab-Hackathon). Two ideas were taken from the second of these and re-implemented in that version: compiling against the backend with a pinned layout and then dropping idle device qubits (`engine/calibrate.py`), and ending `main.js` with a never-resolving `await` so the run stays alive.
