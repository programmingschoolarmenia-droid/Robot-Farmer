// WebAudio effects and a streamed, original background score (loaded only when music is enabled).
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.5;
    this.musicVolume = 0;
    this.blips = true;
    this.musicPlayer = null;
    this.musicSource = null;
    this.musicStarting = false;
    this.lastPlay = new Map();
    this.noteVoices = new Set();
    this.noteClock = null;
    const unlock = () => {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      if (this.musicVolume > 0) this.startMusic();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopMusic();
        this.stopNotes();
      }
      else if (this.musicVolume > 0) this.startMusic();
    });
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
      this.musicGain.gain.value = this.musicVolume * 0.65;
      this.musicGain.connect(this.master);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  setVolumes({ sfx, music, blips }) {
    if (sfx !== undefined) this.sfxVolume = sfx;
    if (this.notesGain) this.notesGain.gain.value = this.sfxVolume;
    if (blips !== undefined) this.blips = blips;
    if (music !== undefined) {
      this.musicVolume = music;
      if (this.musicGain) this.musicGain.gain.value = music * 0.65;
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

  // Load a small, locally bundled piano bank once the Music card is available.
  // A soft synthesised piano is ready immediately, including when a download fails.
  prepareNotes() {
    const ctx = this.ensure();
    if (!ctx || this.noteSamples || this.noteSamplesFailed) return Promise.resolve();
    if (!this.noteSamplesLoading) {
      this.noteSamplesLoading = (async () => {
        const response = await fetch(new URL('../assets/audio/nvagel-piano.mp3', import.meta.url));
        if (!response.ok) throw new Error('Piano samples unavailable');
        this.noteSamples = await ctx.decodeAudioData(await response.arrayBuffer());
      })().catch(() => { this.noteSamplesFailed = true; });
    }
    return this.noteSamplesLoading;
  }

  // nvagel(): piano notes and chords share an audio clock, so rendering frames
  // cannot move individual notes off the beat. Other sound effects keep their own path.
  note(pitches, seconds, timing = null) {
    const ctx = this.ensure();
    if (!ctx || this.sfxVolume <= 0 || ctx.state !== 'running' || document.hidden || !Number.isFinite(seconds) || seconds <= 0) return;
    const frequencies = [...new Set((Array.isArray(pitches) ? pitches : [pitches]).filter((freq) => Number.isFinite(freq) && freq > 0 && freq < 20000))].slice(0, 8);
    if (!frequencies.length) return;
    this.prepareNotes();
    if (!this.notesGain) {
      this.notesGain = ctx.createGain();
      this.notesGain.gain.value = this.sfxVolume;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -10;
      compressor.knee.value = 8;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      const output = ctx.createGain();
      output.gain.value = 0.6; // Headroom for simultaneous drones and the compressor's makeup gain.
      this.notesGain.connect(compressor).connect(output).connect(this.master);
    }
    let t0 = ctx.currentTime;
    if (timing && Number.isFinite(timing.at) && Number.isFinite(timing.now) && timing.speed > 0) {
      let clock = this.noteClock;
      if (!clock || clock.speed !== timing.speed || Math.abs(ctx.currentTime - clock.audio - (timing.now - clock.game) / timing.speed) > 0.12) {
        clock = this.noteClock = { audio: ctx.currentTime + 0.035, game: timing.now, speed: timing.speed };
      }
      t0 = Math.max(ctx.currentTime, clock.audio + (timing.at - clock.game) / clock.speed);
    }
    const dur = Math.min(64, Math.max(0.025, seconds));
    const vol = 0.32 / Math.sqrt(frequencies.length);
    for (const freq of frequencies) {
      if (this.noteVoices.size >= 24) this.releaseNote(this.noteVoices.values().next().value);
      const gain = ctx.createGain();
      let source;
      let offset = 0;
      if (this.noteSamples) {
        source = ctx.createBufferSource();
        source.buffer = this.noteSamples;
        const midi = 69 + 12 * Math.log2(freq / 440);
        const slot = Math.max(0, Math.min(7, Math.round((midi - 24) / 12)));
        const baseFreq = 440 * Math.pow(2, (24 + slot * 12 - 69) / 12);
        source.playbackRate.setValueAtTime(freq / baseFreq, t0);
        offset = slot * 6;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
        gain.gain.setValueAtTime(vol, t0 + Math.max(0.005, dur - 0.015));
      } else {
        if (!this.pianoWave) {
          this.pianoWave = ctx.createPeriodicWave(new Float32Array(7), new Float32Array([0, 1, 0.3, 0.13, 0.06, 0.025, 0.01]));
        }
        source = ctx.createOscillator();
        source.setPeriodicWave(this.pianoWave);
        source.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol * 0.55, t0 + 0.006);
        gain.gain.exponentialRampToValueAtTime(vol * 0.2, t0 + Math.min(0.22, dur * 0.6));
        gain.gain.exponentialRampToValueAtTime(vol * 0.06, t0 + dur);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.16);
      source.connect(gain).connect(this.notesGain);
      const voice = { source, gain };
      this.noteVoices.add(voice);
      source.onended = () => {
        this.noteVoices.delete(voice);
        source.disconnect();
        gain.disconnect();
      };
      if (this.noteSamples) source.start(t0, offset, 6);
      else source.start(t0);
      source.stop(t0 + dur + 0.18);
    }
  }

  releaseNote(voice) {
    const now = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.005);
    voice.source.stop(now + 0.03);
    this.noteVoices.delete(voice);
  }

  stopNotes() {
    this.noteClock = null;
    for (const voice of this.noteVoices) this.releaseNote(voice);
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

  // Apricot Afternoon: a 64-bar piano/guitar score. A media element streams it without
  // decoding the entire three-minute recording into a large WebAudio buffer.
  startMusic() {
    if (this.musicVolume <= 0 || document.hidden || this.musicStarting) return;
    const ctx = this.ensure();
    if (!ctx) return;
    if (!this.musicPlayer) {
      const player = new Audio();
      player.preload = 'none';
      player.loop = true;
      const ext = player.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3';
      player.src = new URL(`../assets/audio/apricot-afternoon.${ext}`, import.meta.url).href;
      player.addEventListener('error', () => console.warn('Background music could not load:', player.error));
      this.musicSource = ctx.createMediaElementSource(player);
      this.musicSource.connect(this.musicGain);
      this.musicPlayer = player;
    }
    if (!this.musicPlayer.paused) return;
    this.musicStarting = true;
    this.musicPlayer.play().then(() => {
      if (this.musicVolume <= 0 || document.hidden) this.musicPlayer.pause();
    }).catch((e) => {
      // Autoplay waits for the next tap; a deliberate pause can abort a pending play.
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') console.warn('Background music could not play:', e);
    }).finally(() => { this.musicStarting = false; });
  }

  stopMusic() {
    if (this.musicPlayer) this.musicPlayer.pause();
  }
}
