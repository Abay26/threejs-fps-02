// All sound is synthesised with WebAudio at boot: no audio files, no network. Gunfire
// is filtered noise, beeps are short oscillators, and the round stingers are two-note
// phrases. New in Saltline: the flashbang's high ring, the smoke's soft pop, and a
// low foghorn that opens every live round across the harbour. Everything is quiet
// until the player first interacts with the page.
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure() || !enabled) return;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    source.connect(filter).connect(gain).connect(master);
    source.start();
  }

  function tone(freq, duration, gainValue, type = 'sine', when = 0) {
    if (!ensure() || !enabled) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const start = ctx.currentTime + when;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainValue, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  return {
    unlock() { ensure(); },
    setEnabled(value) { enabled = value; },
    shot(kind) {
      if (kind === 'mastiff') noise(0.28, 900, 0.9);
      else if (kind === 'jackal') noise(0.09, 1600, 0.45);
      else if (kind === 'boar') noise(0.3, 700, 0.9);
      else noise(0.13, 1200, 0.6);
      tone(140, 0.08, 0.25, 'square');
    },
    enemyShot(distance) {
      const volume = Math.max(0.08, 0.5 - distance * 0.012);
      noise(0.11, 900, volume);
    },
    hit() { tone(1200, 0.05, 0.3, 'square'); },
    kill() { tone(880, 0.09, 0.35, 'square'); tone(1320, 0.12, 0.3, 'square', 0.07); },
    reload() { tone(500, 0.04, 0.25, 'square', 0.05); tone(700, 0.04, 0.25, 'square', 0.4); },
    beep() { tone(980, 0.09, 0.3, 'sine'); },
    plant() { tone(660, 0.1, 0.3, 'sine'); tone(660, 0.1, 0.3, 'sine', 0.25); },
    explosion() {
      noise(1.1, 220, 1.0);
      tone(55, 0.9, 0.7, 'sine');
    },
    roundWin() { tone(523, 0.16, 0.35); tone(659, 0.16, 0.35, 'sine', 0.14); tone(784, 0.3, 0.4, 'sine', 0.28); },
    roundLose() { tone(392, 0.2, 0.3); tone(311, 0.35, 0.3, 'sine', 0.18); },
    dryFire() { tone(300, 0.03, 0.2, 'square'); },
    // A flashbang: a sharp crack, then a high ringing that fades over two seconds.
    flash() {
      noise(0.12, 3000, 0.9, 'highpass');
      tone(2800, 1.8, 0.12, 'sine');
      tone(2100, 1.4, 0.08, 'sine', 0.1);
    },
    // A smoke grenade: a soft pop and a low hiss as the canister vents.
    smoke() {
      noise(0.25, 500, 0.4);
      noise(1.2, 300, 0.15, 'bandpass');
    },
    // The harbour foghorn that opens a live round.
    horn() {
      tone(98, 1.1, 0.3, 'sine');
      tone(147, 1.1, 0.18, 'sine');
    },
  };
}
