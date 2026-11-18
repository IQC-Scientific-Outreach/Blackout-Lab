// Small synthesised sound effects (Web Audio, no files). Sound starts only after
// the first key press or click, and every call is safe if audio is unavailable.

export function createAudio() {
  let ctx = null;
  let muted = false;

  function ensure() {
    if (ctx || muted) return ctx;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) ctx = new Ctor();
    } catch (err) {
      ctx = null;
    }
    return ctx;
  }

  function tone(freq, start, length, type, gain, slideTo) {
    const audio = ensure();
    if (!audio || muted) return;
    try {
      if (audio.state !== 'running') audio.resume();
      const t0 = audio.currentTime + start;
      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + length);
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(gain || 0.08, t0 + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      osc.connect(amp);
      amp.connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + length + 0.03);
    } catch (err) {
    }
  }

  const sounds = {
    jump: () => tone(300, 0, 0.14, 'triangle', 0.05, 520),
    land: () => tone(120, 0, 0.07, 'sine', 0.05, 70),
    gate: () => {
      tone(660, 0, 0.09, 'square', 0.035);
      tone(990, 0.07, 0.12, 'square', 0.03);
    },
    superpose: () => tone(420, 0, 0.5, 'sine', 0.04, 840),
    collapse1: () => {
      tone(520, 0, 0.1, 'triangle', 0.07);
      tone(780, 0.08, 0.2, 'triangle', 0.07);
    },
    collapse0: () => {
      tone(520, 0, 0.1, 'triangle', 0.07);
      tone(330, 0.08, 0.2, 'triangle', 0.07);
    },
    denied: () => {
      tone(160, 0, 0.16, 'square', 0.05);
      tone(120, 0.18, 0.22, 'square', 0.05);
    },
    unlock: () => {
      tone(523, 0, 0.12, 'triangle', 0.07);
      tone(659, 0.11, 0.12, 'triangle', 0.07);
      tone(784, 0.22, 0.28, 'triangle', 0.07);
    },
    fall: () => tone(400, 0, 0.5, 'sawtooth', 0.05, 60),
    win: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.07));
    },
    click: () => tone(880, 0, 0.04, 'square', 0.025),
    // A swap's countdown: a short tick for each number, a higher one for SWAP!
    tick: () => tone(660, 0, 0.07, 'square', 0.03),
    tickGo: () => {
      tone(990, 0, 0.09, 'square', 0.035);
      tone(1320, 0.08, 0.16, 'square', 0.03);
    },
    // A heavy switch thrown, "chun-chunk": two low metallic thuds, the second deeper and longer.
    switch: () => {
      tone(320, 0, 0.018, 'square', 0.03, 180); // the lever's bite
      tone(130, 0.004, 0.07, 'sawtooth', 0.06, 85); // chun
      tone(260, 0.115, 0.016, 'square', 0.03, 140);
      tone(92, 0.12, 0.13, 'sawtooth', 0.075, 52); // chunk
      tone(58, 0.125, 0.15, 'sine', 0.09, 40); // its weight
    },
    meow: () => {
      tone(620, 0, 0.16, 'triangle', 0.07, 980);
      tone(980, 0.15, 0.34, 'triangle', 0.07, 520);
    },
    crank: () => tone(150, 0, 0.06, 'square', 0.04, 90),
    // Bonus level 7's beast.
    roar: () => {
      tone(90, 0, 1.1, 'sawtooth', 0.07, 45);
      tone(135, 0.05, 0.9, 'sawtooth', 0.05, 60);
      tone(60, 0.1, 1.2, 'square', 0.03, 38);
    },
    thud: () => {
      tone(70, 0, 0.32, 'sine', 0.12, 32);
      tone(140, 0, 0.12, 'square', 0.04, 50);
    },
    smash: () => {
      tone(320, 0, 0.18, 'sawtooth', 0.05, 90);
      tone(1200, 0.02, 0.1, 'square', 0.025, 500);
      tone(60, 0, 0.35, 'sine', 0.1, 30);
    },
    windup: () => tone(180, 0, 0.3, 'triangle', 0.04, 360),
    fling: () => tone(700, 0, 0.6, 'triangle', 0.06, 1500),
    purr: () => {
      tone(30, 0, 0.9, 'sawtooth', 0.025, 28);
      tone(620, 0.4, 0.14, 'triangle', 0.06, 900);
      tone(900, 0.54, 0.26, 'triangle', 0.06, 640);
    },
    power: () => {
      tone(70, 0, 1.6, 'sawtooth', 0.04, 150);
      [392, 523, 659].forEach((f, i) => tone(f, 0.9 + i * 0.16, 0.4, 'triangle', 0.05));
    },
  };

  return {
    play(name) {
      if (sounds[name]) sounds[name]();
    },
    setMuted(value) {
      muted = value;
    },
    isMuted: () => muted,
    // Call from a click or key press. Safari keeps a page silent until a sound
    // has been started from inside one, so a one-sample silent buffer is played.
    unlock() {
      const audio = ensure();
      if (!audio || audio.state === 'running') return;
      try {
        audio.resume();
        const source = audio.createBufferSource();
        source.buffer = audio.createBuffer(1, 1, 22050);
        source.connect(audio.destination);
        source.start(0);
      } catch (err) {
        // ignore
      }
    },
  };
}
