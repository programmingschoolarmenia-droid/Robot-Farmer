// Sound effects and gentle background music, synthesised with WebAudio (no sound files needed).
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.5;
    this.musicVolume = 0;
    this.blips = true;
    this.musicTimer = null;
    this.musicStep = 0;
    this.lastPlay = new Map();
    const unlock = () => {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume * 0.25;
      this.musicGain.connect(this.master);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  setVolumes({ sfx, music, blips }) {
    if (sfx !== undefined) this.sfxVolume = sfx;
    if (blips !== undefined) this.blips = blips;
    if (music !== undefined) {
      this.musicVolume = music;
      if (this.musicGain) this.musicGain.gain.value = music * 0.25;
      if (music > 0) this.startMusic();
      else this.stopMusic();
    }
  }

  tone(freq, dur, { type = 'square', vol = 0.2, slide = 0, delay = 0, attack = 0.005 } = {}) {
    const ctx = this.ensure();
    if (!ctx || this.sfxVolume <= 0 || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * this.sfxVolume), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Avoid machine-gun sounds when many things happen at once.
  throttled(name, ms) {
    const now = performance.now();
    if (now - (this.lastPlay.get(name) || 0) < ms) return false;
    this.lastPlay.set(name, now);
    return true;
  }

  play(name) {
    switch (name) {
      case 'harvest':
        if (!this.throttled(name, 70)) return;
        this.tone(660, 0.07, { type: 'triangle', vol: 0.18, slide: 300 });
        break;
      case 'plant':
        if (!this.throttled(name, 90)) return;
        this.tone(320, 0.06, { type: 'triangle', vol: 0.12, slide: -80 });
        break;
      case 'till':
        if (!this.throttled(name, 90)) return;
        this.tone(140, 0.08, { type: 'sawtooth', vol: 0.06, slide: -40 });
        break;
      case 'move':
        if (!this.throttled(name, 120)) return;
        this.tone(240, 0.05, { type: 'sine', vol: 0.05, slide: 60 });
        break;
      case 'giant':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', vol: 0.18, delay: i * 0.08 }));
        break;
      case 'unlock':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, { type: 'square', vol: 0.1, delay: i * 0.07 }));
        break;
      case 'quest':
        [659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.16, delay: i * 0.09 }));
        break;
      case 'error':
        this.tone(220, 0.16, { type: 'square', vol: 0.1, slide: -90 });
        this.tone(160, 0.2, { type: 'square', vol: 0.08, delay: 0.12, slide: -60 });
        break;
      case 'warn':
        if (!this.throttled(name, 400)) return;
        this.tone(440, 0.08, { type: 'triangle', vol: 0.1 });
        break;
      case 'click':
        this.tone(880, 0.03, { type: 'square', vol: 0.06 });
        break;
      case 'run':
        this.tone(523, 0.06, { type: 'square', vol: 0.08 });
        this.tone(784, 0.08, { type: 'square', vol: 0.08, delay: 0.05 });
        break;
      case 'stop':
        this.tone(523, 0.06, { type: 'square', vol: 0.07 });
        this.tone(392, 0.08, { type: 'square', vol: 0.07, delay: 0.05 });
        break;
      case 'flip':
        this.tone(300, 0.3, { type: 'sine', vol: 0.12, slide: 600 });
        break;
      case 'died':
        this.tone(200, 0.25, { type: 'sawtooth', vol: 0.05, slide: -120 });
        break;
      case 'thunder':
        this.tone(90, 0.7, { type: 'sawtooth', vol: 0.05, slide: -45, attack: 0.02 });
        this.tone(60, 0.9, { type: 'square', vol: 0.03, slide: -15, delay: 0.08, attack: 0.05 });
        break;
      default:
        break;
    }
  }

  // Bridgy's "voice": short random robot syllables.
  blip() {
    if (!this.blips) return;
    const f = 520 + Math.random() * 260;
    this.tone(f, 0.045, { type: 'square', vol: 0.07 });
  }

  // Simple looping pentatonic tune.
  startMusic() {
    if (this.musicTimer || this.musicVolume <= 0) return;
    const scale = [262, 294, 330, 392, 440, 523, 587, 659];
    const pattern = [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 5, 7, 5, 4, 2];
    const bass = [131, 131, 98, 110];
    this.musicTimer = setInterval(() => {
      const ctx = this.ensure();
      if (!ctx || ctx.state !== 'running') return;
      const i = this.musicStep++;
      const note = scale[pattern[i % pattern.length]];
      this.musicNote(note, 0.22, 'triangle', 0.5);
      if (i % 4 === 0) this.musicNote(bass[(i / 4) % bass.length], 0.5, 'sine', 0.7);
    }, 300);
  }

  musicNote(freq, dur, type, vol) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.musicGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}
