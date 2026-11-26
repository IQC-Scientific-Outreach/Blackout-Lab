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

  // A burst of filtered white noise: drums, and the beast's screech.
  let noiseBuffer = null;
  function noise(start, length, gain, filter, freq) {
    const audio = ensure();
    if (!audio || muted) return;
    try {
      if (!noiseBuffer) {
        noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      }
      const t0 = audio.currentTime + start;
      const src = audio.createBufferSource();
      src.buffer = noiseBuffer;
      const shape = audio.createBiquadFilter();
      shape.type = filter;
      shape.frequency.value = freq;
      const amp = audio.createGain();
      amp.gain.setValueAtTime(gain, t0);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      src.connect(shape);
      shape.connect(amp);
      amp.connect(audio.destination);
      src.start(t0);
      src.stop(t0 + length + 0.02);
    } catch (err) {
      // ignore
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
    // An item found: a quick rising fanfare (C E G, then a held high C).
    success: () => {
      tone(523, 0, 0.09, 'square', 0.04);
      tone(659, 0.09, 0.09, 'square', 0.04);
      tone(784, 0.18, 0.09, 'square', 0.04);
      tone(1047, 0.27, 0.45, 'square', 0.045);
      tone(1568, 0.27, 0.45, 'triangle', 0.025);
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
    // Story mode: the intercom crackling on, sparks from falling cables, the power failing.
    radio: () => {
      noise(0, 0.12, 0.05, 'bandpass', 1800);
      tone(1200, 0.06, 0.05, 'square', 0.02);
      tone(900, 0.12, 0.06, 'square', 0.02);
    },
    spark: () => noise(0, 0.06, 0.06, 'highpass', 4000),
    powerDown: () => {
      tone(220, 0, 1.2, 'sawtooth', 0.05, 40);
      noise(0, 0.4, 0.04, 'lowpass', 400);
    },
    // The beast caught by the light as a monster: a ragged scream.
    screech: () => {
      tone(1400, 0, 0.9, 'sawtooth', 0.06, 2600);
      tone(1900, 0.05, 0.8, 'square', 0.03, 1100);
      tone(700, 0, 1.0, 'sawtooth', 0.04, 380);
      noise(0, 0.9, 0.12, 'bandpass', 2400);
    },
    // ...and as a cat again: a proper MEOW.
    bigMeow: () => {
      tone(520, 0, 0.22, 'triangle', 0.1, 900);
      tone(900, 0.2, 0.5, 'triangle', 0.1, 480);
      tone(1040, 0.2, 0.5, 'sine', 0.03, 960);
    },
    swoosh: () => {
      tone(500, 0, 0.35, 'sawtooth', 0.035, 140);
      tone(90, 0, 0.4, 'sine', 0.07, 50);
    },
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

  // Boss music (bonus level 7): an original chiptune loop, written here note by note, so
  // there is no file and nothing to license. A minor, i VI iv V (Am F Dm E), 150 beats a
  // minute: driving octave bass, a sixteenth-note arpeggio, kick, snare and hats.
  const BOSS = {
    step: 0.1, // a sixteenth note
    chords: [
      { root: 110, arp: [440, 523.25, 659.25] }, // Am
      { root: 87.31, arp: [349.23, 440, 523.25] }, // F
      { root: 73.42, arp: [293.66, 349.23, 440] }, // Dm
      { root: 82.41, arp: [329.63, 415.3, 493.88] }, // E
    ],
    arp: [0, 1, 2, 1, 2, 0, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2],
    // A short lead line over the second time round, in sixteenths (0: rest).
    lead: [880, 0, 0, 0, 783.99, 0, 659.25, 0, 698.46, 0, 0, 0, 659.25, 0, 587.33, 0,
      587.33, 0, 0, 0, 523.25, 0, 587.33, 0, 659.25, 0, 0, 0, 830.61, 0, 0, 0],
  };
  let music = null; // { timer, next, n }
  function scheduleMusic() {
    const audio = ensure();
    if (!audio || !music) return;
    while (music.next < audio.currentTime + 0.25) {
      const n = music.n;
      const at = Math.max(0, music.next - audio.currentTime);
      const bar = Math.floor(n / 16) % 4;
      const inBar = n % 16;
      const chord = BOSS.chords[bar];
      if (inBar % 2 === 0) tone(chord.root * (inBar % 4 === 0 ? 1 : 2), at, 0.09, 'square', 0.03);
      tone(chord.arp[BOSS.arp[inBar]] * (inBar >= 8 ? 2 : 1), at, 0.07, 'square', 0.012);
      if (Math.floor(n / 64) % 2 === 1) {
        const note = BOSS.lead[(n % 64) >> 1];
        if (note && n % 2 === 0) tone(note, at, 0.18, 'triangle', 0.035);
      }
      if (inBar % 8 === 0) tone(150, at, 0.12, 'sine', 0.09, 45); // kick
      if (inBar % 8 === 4) noise(at, 0.12, 0.08, 'highpass', 1500); // snare
      if (inBar % 2 === 1) noise(at, 0.03, 0.025, 'highpass', 7000); // hat
      music.n += 1;
      music.next += BOSS.step;
    }
  }

  return {
    play(name) {
      if (sounds[name]) sounds[name]();
    },
    // 'boss' starts the loop (if it is not already playing); null stops it.
    music(name) {
      if (name && !music) {
        const audio = ensure();
        if (!audio) return;
        music = { next: audio.currentTime + 0.1, n: 0, timer: null };
        music.timer = setInterval(scheduleMusic, 40);
        scheduleMusic();
      } else if (!name && music) {
        clearInterval(music.timer);
        music = null;
      }
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
