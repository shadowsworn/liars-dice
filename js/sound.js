/* Small synthesized sounds: dice rattling in a cup, the cup landing, the slam of an open. No audio files. */
(function () {
  'use strict';
  const LD = window.LD;
  let ctx = null;
  let noise = null;

  const Sound = {
    on: true,
    ensure() {
      if (!this.on) return null;
      try {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        if (!noise) {
          noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
      } catch (e) {
        return null;
      }
      return ctx;
    },
    burst(at, { freq = 2400, q = 3, gain = 0.25, len = 0.035, type = 'bandpass' } = {}) {
      const c = this.ensure();
      if (!c) return;
      const src = c.createBufferSource();
      src.buffer = noise;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      const t = c.currentTime + at;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t, Math.random() * 0.4, len + 0.02);
    },
    tone(at, freq, len, gain = 0.2, type = 'sine', slideTo) {
      const c = this.ensure();
      if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      const t = c.currentTime + at;
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + len + 0.05);
    },
    rattle(dur = 1.1) {
      if (!this.ensure()) return;
      const hits = Math.round(dur * 26);
      for (let i = 0; i < hits; i++) {
        const at = Math.random() * dur;
        this.burst(at, { freq: 1800 + Math.random() * 2600, q: 4 + Math.random() * 6, gain: 0.08 + Math.random() * 0.14, len: 0.02 + Math.random() * 0.03 });
      }
      this.thud(dur + 0.02);
    },
    thud(at = 0) {
      this.tone(at, 140, 0.16, 0.35, 'sine', 60);
      this.burst(at, { freq: 600, q: 1, gain: 0.18, len: 0.06, type: 'lowpass' });
    },
    clack() {
      this.burst(0, { freq: 3200, q: 8, gain: 0.18, len: 0.03 });
      this.tone(0, 90, 0.1, 0.18, 'sine', 55);
    },
    tick() {
      this.burst(0, { freq: 4200, q: 10, gain: 0.08, len: 0.02 });
    },
    slam() {
      this.tone(0, 120, 0.28, 0.5, 'sine', 45);
      this.burst(0, { freq: 900, q: 0.8, gain: 0.35, len: 0.12, type: 'lowpass' });
    },
    lift() {
      this.burst(0, { freq: 1200, q: 0.7, gain: 0.08, len: 0.25 });
    },
    win() {
      [523, 659, 784].forEach((f, i) => this.tone(i * 0.09, f, 0.35, 0.12, 'triangle'));
    },
    lose() {
      [392, 330, 262].forEach((f, i) => this.tone(i * 0.11, f, 0.4, 0.12, 'triangle'));
    },
  };

  LD.Sound = Sound;
})();
