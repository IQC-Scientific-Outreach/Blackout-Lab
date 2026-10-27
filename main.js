// Blackout Lab: entry point. Everything runs in the browser; the quantum
// physics is the exact state-vector engine in game/quantum.js.
import { startGame } from './game/game.js';

const game = startGame();
globalThis.blackoutLab = game;
game.boot();
