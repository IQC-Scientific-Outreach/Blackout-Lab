// Everything on the page that is not the canvas or the instrument rack:
// overlay screens, the console strip (prompt and terminal), status bar, toasts.

import { GATE_INFO } from './levels.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const SCREENS = ['title', 'pause', 'complete', 'over', 'win', 'error'];

export function grabDom() {
  const ids = [
    'lab', 'viewport', 'game', 'overlay', 'toast', 'touch', 'prompt', 'dock-play', 'dock-terminal', 'term-title', 'term-ops',
    'term-status', 'term-close', 'hud-floor', 'hud-name', 'hud-lives', 'hud-torch', 'btn-restart', 'btn-pause', 'btn-sound', 'btn-menu', 'note', 'opt-floor',
    'btn-start', 'btn-floors', 'title-floors', 'opt-lives', 'btn-resume',
    'btn-restart-2', 'btn-quit', 'complete-eyebrow', 'complete-h', 'complete-stars', 'complete-star-list', 'complete-takeaway',
    'complete-stats', 'btn-next', 'btn-replay', 'btn-retry', 'btn-over-quit', 'win-stars', 'win-stats', 'win-floors', 'btn-home', 'error-text',
    'btn-error-retry', 'circuit-labels', 'circuit-gates', 'circuit-readout', 'circuit-desc', 'stats', 'code', 'copy-code', 'probs', 'joint', 'floor-tag', 'goal', 'concept',
    'gate-list', 'hints', 'hint-button', 'log', 'live', 'about', 'circuit-expand', 'dev', 'dev-key-torch', 'dev-touch-collapse', 'dev-circuit-right', 'dev-instant', 'dev-passive-terminal', 'dev-canister-view', 'dev-show-gates', 'pause-dev-slot', 'pause-keys',
  ];
  const dom = {};
  for (const id of ids) {
    const key = id.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
    dom[key] = document.getElementById(id);
    if (!dom[key]) throw new Error(`index.html is missing #${id}`);
  }
  for (const name of SCREENS) dom[`screen_${name}`] = document.getElementById(`screen-${name}`);
  return dom;
}

// A pixel heart, drawn from a 9 x 8 grid: o outline, r fill, w highlight.
const HEART = ['.oo...oo.', 'orro.orro', 'orwrorrro', 'orrrrrrro', '.orrrrro.', '..orrro..', '...oro...', '....o....'];

function heartSvg(full) {
  const colour = full ? { o: '#3a0812', r: '#f0364f', w: '#ffd9df' } : { o: '#2a3a58', r: '#111a2b', w: '#111a2b' };
  let cells = '';
  HEART.forEach((row, y) => {
    row.split('').forEach((ch, x) => {
      if (ch !== '.') cells += `<rect x="${x * 2}" y="${y * 2}" width="2" height="2" fill="${colour[ch]}"/>`;
    });
  });
  return `<svg class="heart" width="18" height="16" viewBox="0 0 18 16" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}

const TORCH_TEXT = { low: 'Flashlight: low battery', dead: 'Flashlight: dead' };

function starsHtml(got, of) {
  return '★'.repeat(got) + `<span class="off">${'★'.repeat(of - got)}</span>`;
}

export function createUI(dom, handlers) {
  let screen = 'title';
  let toastLeft = 0;
  let terminal = null;
  let passive = false; // a passive terminal (developer option): shown, but the game keeps the keys
  // Developer options live on the title screen and move into the pause screen while it shows.
  const devHome = { parent: dom.dev.parentElement, next: dom.dev.nextElementSibling };
  // The pause screen repeats the title screen's list of controls.
  dom.pauseKeys.appendChild(document.querySelector('#screen-title .keys').cloneNode(true));

  function focusLater(el) {
    if (el && el.focus) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }

  // While a menu screen shows (any but the title, whose About links stay in reach), the rest
  // of the page is inert: Tab and screen readers stay inside the screen, as in a dialog.
  // Left alone: the live region that announces events, and the page's heading.
  function shield(el, on) {
    if (el.hasAttribute('aria-live') || el.matches('h1')) return;
    if (el.querySelector('h1')) for (const child of el.children) shield(child, on);
    else el.inert = on;
  }

  function setModal(on) {
    for (let node = dom.overlay; node && node !== dom.lab; node = node.parentElement) {
      for (const other of node.parentElement.children) if (other !== node) shield(other, on);
    }
  }

  function showScreen(name) {
    screen = name;
    setModal(!!name && name !== 'title');
    dom.overlay.hidden = !name;
    if (name) dom.toast.hidden = true;
    for (const s of SCREENS) dom[`screen_${s}`].hidden = s !== name;
    if (name === 'pause') dom.pauseDevSlot.appendChild(dom.dev);
    else if (name === 'title') devHome.parent.insertBefore(dom.dev, devHome.next);
    if (name) {
      const first = dom[`screen_${name}`].querySelector('.primary:not(:disabled)') || dom[`screen_${name}`].querySelector('button:not(:disabled)');
      focusLater(first);
    } else {
      focusLater(dom.game);
    }
  }

  function setHud({ floorText, name, lives, maxLives, infinite, torch }) {
    if (floorText !== undefined) dom.hudFloor.textContent = floorText;
    if (name !== undefined) dom.hudName.textContent = name;
    if (torch !== undefined) {
      dom.hudTorch.hidden = !TORCH_TEXT[torch];
      dom.hudTorch.textContent = TORCH_TEXT[torch] || '';
    }
    if (lives !== undefined) {
      dom.hudLives.setAttribute('aria-label', infinite ? 'Lives: unlimited' : `Lives: ${lives} of ${maxLives}`);
      dom.hudLives.innerHTML = infinite
        ? `${heartSvg(true)} &infin;`
        : Array.from({ length: maxLives }, (_, i) => heartSvg(i < lives)).join('');
    }
  }

  let promptHtml = '';
  function setPrompt(html) {
    if (html === promptHtml) return;
    promptHtml = html;
    dom.prompt.innerHTML = html;
  }

  function toast(text, kind, seconds) {
    dom.toast.textContent = text;
    dom.toast.className = `toast t-${kind || 'info'}`;
    dom.toast.hidden = false;
    toastLeft = seconds || 3.2;
  }

  function announce(text) {
    dom.live.textContent = '';
    dom.live.textContent = text;
  }

  function opLabel(op) {
    if (op.gate === 'cx') return `${op.q[0]} → ${op.q[1]}`;
    if (op.gate === 'cz') return `${op.q[0]} · ${op.q[1]}`;
    return op.q.join(', ');
  }

  // Options (passive terminal developer option):
  //   passive  shown just by standing at the terminal; the game keeps the keys
  //   numbers  each gate shows the number key that applies it
  function openTerminal(term, carrying, { passive: asPassive = false, numbers = asPassive } = {}) {
    terminal = term;
    passive = asPassive;
    const keys = Math.min(term.ops.length, 9);
    const range = keys > 1 ? `1 to ${keys}` : '1';
    dom.dockPlay.hidden = true;
    dom.dockTerminal.hidden = false;
    dom.termClose.hidden = passive;
    const kind = term.box ? 'Box port' : term.port ? `${term.id} · dead terminal, canister port only` : `Terminal ${term.id}`;
    dom.termTitle.textContent = `${kind}${term.sealed ? ` · holds sealed qubit ${term.sealed}` : ''} · ${passive ? 'flashlight still on' : 'flashlight lowered'}`;
    dom.termOps.innerHTML = term.ops
      .map((op, i) => {
        const info = GATE_INFO[op.gate];
        const locked = op.needsCanister && !carrying;
        const what = locked ? 'needs the canister' : op.gate === 'cx' ? 'control → target' : op.gate === 'cz' ? 'phase if both are 1' : info.name;
        const on = op.gate === 'cx' ? `from ${op.q[0]} to ${op.q[1]}` : `on ${op.q.join(' and ')}`;
        return (
          `<button type="button" class="op-btn" data-op="${i}" data-locked="${locked ? 1 : 0}" title="${esc(info.text)}" aria-label="${esc(`${info.name} ${on}. ${locked ? 'Needs the canister. ' : ''}${info.text}`)}"${locked ? ' disabled' : ''}>` +
          `<span class="op-gate">${esc(info.symbol)}</span><span class="op-target">${esc(opLabel(op))}</span><span class="op-hint">${esc(what)}</span>` +
          `${numbers && i < 9 ? `<kbd class="op-key" aria-hidden="true">${i + 1}</kbd>` : ''}</button>`
        );
      })
      .join('');
    if (passive) {
      setTerminalStatus(`Press ${range}, or click a gate. Your flashlight stays on here. E or Enter steps in to pick with the arrow keys.`, '');
      return;
    }
    setTerminalStatus(
      numbers
        ? `Pick a gate: arrow keys then Enter or Space, or press ${range}. Nothing is observed while you are at the terminal.`
        : 'Pick a gate. Nothing is observed while you are at the terminal.',
      ''
    );
    focusLater(dom.termOps.querySelector('button:not(:disabled)') || dom.termClose);
  }

  function closeTerminal() {
    terminal = null;
    passive = false;
    dom.dockTerminal.hidden = true;
    dom.dockPlay.hidden = false;
    focusLater(dom.game);
  }

  function setTerminalStatus(text, kind) {
    dom.termStatus.textContent = text;
    dom.termStatus.className = `term-status${kind ? ` is-${kind}` : ''}`;
  }

  let focusedOp;
  function setTerminalBusy(busy) {
    const active = document.activeElement;
    if (busy) focusedOp = active && active.dataset ? active.dataset.op : undefined;
    for (const b of dom.termOps.querySelectorAll('button')) b.disabled = busy || b.dataset.locked === '1';
    if (!busy && terminal && !passive) {
      const again = focusedOp !== undefined ? dom.termOps.querySelector(`button[data-op="${focusedOp}"]:not(:disabled)`) : null;
      const now = document.activeElement;
      if (again) again.focus({ preventScroll: true });
      else if (!now || now === document.body) focusLater(dom.termOps.querySelector('button:not(:disabled)') || dom.termClose);
    }
  }

  // `bonus`: { tag, more } for a bonus level (more: another bonus level follows), else null.
  function showComplete({ name, index, total, stars, of, earned, takeaway, stats, last, bonus }) {
    dom.completeEyebrow.textContent = bonus ? `${bonus.tag} cleared` : `Floor ${index + 1} of ${total} cleared`;
    dom.completeH.textContent = name;
    dom.completeStars.innerHTML = starsHtml(stars, of);
    dom.completeStars.setAttribute('aria-label', `${stars} of ${of} stars`);
    dom.completeStarList.innerHTML = earned.map((e) => `<li class="${e.got ? '' : 'missed'}">${esc(e.text)}</li>`).join('');
    dom.completeTakeaway.textContent = takeaway;
    dom.completeStats.textContent = stats;
    dom.btnNext.textContent = bonus ? (bonus.more ? 'Next bonus level' : 'Back to title') : last ? 'Up to the terrace' : 'Next floor';
    showScreen('complete');
  }

  function showWin({ stars, of, stats }) {
    dom.winStars.hidden = !of;
    dom.winStars.textContent = `★ ${stars} of ${of} stars`;
    dom.winStats.textContent = stats;
    showScreen('win');
  }

  // -- wiring ---------------------------------------------------------------

  // Every instrument module, wherever it is now (the circuit may sit under the game).
  const instruments = () => Array.from(document.querySelectorAll('.lab .module')).filter((el) => el !== dom.about);
  // A project link shows its own address as text. Until an address is filled in
  // (index.html), the line says so instead of offering a link that goes nowhere.
  for (const link of dom.about.querySelectorAll('a')) {
    const url = link.getAttribute('href');
    if (url) link.textContent = url.replace(/^https?:\/\//, '');
    else link.outerHTML = '<em>link not added yet</em>';
  }

  const click = (el, fn) => el.addEventListener('click', () => fn && fn());
  click(dom.btnStart, handlers.start);
  click(dom.btnPause, handlers.pause);
  click(dom.btnResume, handlers.resume);
  click(dom.btnRestart, handlers.restart);
  click(dom.btnRestart2, handlers.restart);
  click(dom.btnQuit, handlers.quit);
  click(dom.btnOverQuit, handlers.quit);
  click(dom.btnNext, handlers.next);
  click(dom.btnReplay, handlers.replay);
  click(dom.btnRetry, handlers.retry);
  click(dom.btnHome, handlers.home);
  dom.winFloors.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-floor]');
    if (btn) handlers.jump(Number(btn.dataset.floor));
  });
  click(dom.btnErrorRetry, handlers.errorRetry);
  click(dom.btnSound, handlers.sound);
  click(dom.btnMenu, handlers.menu);
  click(dom.hintButton, handlers.hint);
  click(dom.termClose, handlers.closeTerminal);
  dom.termOps.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-op]');
    if (btn && !btn.disabled) handlers.applyOp(Number(btn.dataset.op));
    if (passive && ev.detail > 0) dom.game.focus({ preventScroll: true }); // a click hands the keys back to the game
  });
  dom.optLives.addEventListener('change', () => handlers.option('lives', dom.optLives.checked));
  // Developer options: each control is one entry of the game's `dev` settings.
  const devSwitches = {
    keyTorch: dom.devKeyTorch,
    touchCollapse: dom.devTouchCollapse,
    instantResponse: dom.devInstant,
    passiveTerminal: dom.devPassiveTerminal,
    canisterView: dom.devCanisterView,
    showGates: dom.devShowGates,
    circuitRight: dom.devCircuitRight,
  };
  const panelRadios = Array.from(document.querySelectorAll('input[name="dev-panel"]'));
  for (const [name, input] of Object.entries(devSwitches)) input.addEventListener('change', () => handlers.dev(name, input.checked));
  for (const radio of panelRadios) radio.addEventListener('change', () => radio.checked && handlers.dev('panel', radio.value));
  dom.btnFloors.addEventListener('click', () => {
    const open = dom.titleFloors.hidden;
    dom.titleFloors.hidden = !open;
    dom.btnFloors.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  dom.titleFloors.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-floor]');
    if (btn) handlers.skipTo(Number(btn.dataset.floor));
  });
  dom.optFloor.addEventListener('change', () => handlers.jump(Number(dom.optFloor.value)));
  dom.copyCode.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dom.code.textContent);
      dom.copyCode.textContent = 'Copied';
    } catch (err) {
      const range = document.createRange();
      range.selectNodeContents(dom.code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      dom.copyCode.textContent = 'Selected: press Ctrl+C';
    }
  });

  for (const btn of dom.touch.querySelectorAll('.touch-btn')) {
    const hold = btn.dataset.hold;
    const tap = btn.dataset.tap;
    const set = (down) => (ev) => {
      ev.preventDefault();
      btn.classList.toggle('is-down', down);
      if (hold) handlers.touchHold(hold, down);
      else if (down) handlers.touchTap(tap);
    };
    btn.addEventListener('pointerdown', set(true));
    btn.addEventListener('pointerup', set(false));
    btn.addEventListener('pointercancel', set(false));
    btn.addEventListener('pointerleave', set(false));
  }

  return {
    showScreen,
    screen: () => screen,
    enableStart(label) {
      dom.btnStart.disabled = false;
      dom.btnFloors.disabled = false;
      dom.btnStart.textContent = label;
      if (screen === 'title') focusLater(dom.btnStart);
    },
    setHud,
    setPrompt,
    toast,
    announce,
    openTerminal,
    closeTerminal,
    setTerminalStatus,
    setTerminalBusy,
    showComplete,
    showWin,
    showError(text) {
      dom.errorText.textContent = text;
      showScreen('error');
    },
    setPlaying(playing) {
      dom.btnPause.disabled = !playing;
      dom.btnRestart.disabled = !playing;
    },
    setMenuButton(enabled) {
      dom.btnMenu.disabled = !enabled;
    },
    setDev(dev) {
      for (const [name, input] of Object.entries(devSwitches)) input.checked = !!dev[name];
      for (const radio of panelRadios) radio.checked = radio.value === dev.panel;
      dom.lab.classList.toggle('panel-bottom', dev.panel === 'bottom');
    },
    // The title screen swaps the instruments in the rack for a short "about" panel.
    setAbout(on) {
      for (const el of instruments()) el.hidden = on;
      dom.about.hidden = !on;
    },
    setSound(on) {
      dom.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    },
    setOptions({ lives, floor }) {
      dom.optLives.checked = lives;
      dom.optFloor.value = String(floor);
    },
    // names: the climb's floors; ending: the terrace; bonus: [{ name, index }], reached only from here.
    setFloors(names, ending, bonus = []) {
      const option = (name, i) => `<option value="${i}">${esc(name)}</option>`;
      dom.optFloor.innerHTML =
        [...names, ending].map(option).join('') +
        (bonus.length ? `<optgroup label="Bonus levels">${bonus.map((b) => option(b.name, b.index)).join('')}</optgroup>` : '');
      const button = (name, i, cls) => `<button type="button" class="key-btn${cls}" data-floor="${i}">${esc(name)}</button>`;
      const buttons = names.map((name, i) => button(name, i, '')).join('');
      const extra = bonus.length
        ? `<p class="bonus-head">Bonus levels</p>${bonus.map((b) => button(b.name, b.index, ' bonus')).join('')}`
        : '';
      dom.winFloors.innerHTML = buttons + extra;
      dom.titleFloors.innerHTML = buttons + extra;
    },
    setNote(text) {
      dom.note.hidden = !text;
      dom.note.textContent = text || '';
    },
    showTouch(show) {
      dom.touch.hidden = !show;
    },
    tick(dt) {
      if (toastLeft > 0) {
        toastLeft -= dt;
        if (toastLeft <= 0) dom.toast.hidden = true;
      }
    },
  };
}
