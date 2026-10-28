// @ts-check
// ============================================================================
// Visionary — Distraction Shield
//   * Ambient sound generated locally with the Web Audio API (no downloads,
//     nothing leaves the device): rain, brown noise, soft wind.
//   * Full-screen focus state (Fullscreen API + a body class the CSS reads).
// ============================================================================
(function () {
  'use strict';

  /** @type {AudioContext|null} */ let ctx = null;
  /** @type {AudioNode[]} */ let nodes = [];
  /** @type {GainNode|null} */ let master = null;
  /** @type {string|null} */ let current = null;

  const PRESETS = /** @type {const} */ ({
    rain: { label: 'Rain', filter: 'bandpass', freq: 1200, q: 0.6, gain: 0.35, lfo: 0.15, lfoDepth: 0.12 },
    brown: { label: 'Brown noise', filter: 'lowpass', freq: 400, q: 0.7, gain: 0.5, lfo: 0, lfoDepth: 0 },
    wind: { label: 'Soft wind', filter: 'lowpass', freq: 650, q: 1.2, gain: 0.4, lfo: 0.06, lfoDepth: 0.35 }
  });

  function makeNoise(ac) {
    const seconds = 4;
    const buffer = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;   // leaky integrator → brown-ish spectrum
      data[i] = last * 3.5;
    }
    const src = ac.createBufferSource();
    src.buffer = buffer; src.loop = true;
    return src;
  }

  /** @param {keyof typeof PRESETS} name */
  function start(name) {
    stop(false);
    const preset = PRESETS[name];
    if (!preset) return false;
    try {
      ctx ||= new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const src = makeNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = preset.filter; filter.frequency.value = preset.freq; filter.Q.value = preset.q;
      master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(preset.gain, ctx.currentTime + 1.2);
      src.connect(filter).connect(master).connect(ctx.destination);
      src.start();
      nodes = [src, filter, master];
      if (preset.lfo) {
        const lfo = ctx.createOscillator(); const depth = ctx.createGain();
        lfo.frequency.value = preset.lfo; depth.gain.value = preset.freq * preset.lfoDepth;
        lfo.connect(depth).connect(filter.frequency); lfo.start();
        nodes.push(lfo, depth);
      }
      current = name;
      return true;
    } catch { return false; }
  }

  function stop(fade = true) {
    if (!ctx || !master) { current = null; return; }
    const m = master, list = nodes;
    try {
      m.gain.cancelScheduledValues(ctx.currentTime);
      m.gain.setValueAtTime(Math.max(0.0001, m.gain.value), ctx.currentTime);
      m.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (fade ? 0.6 : 0.05));
    } catch { /* ignore */ }
    setTimeout(() => list.forEach((n) => { try { /** @type {any} */ (n).stop?.(); n.disconnect(); } catch { /* ignore */ } }), fade ? 700 : 80);
    nodes = []; master = null; current = null;
  }

  function setVolume(v) { if (master && ctx) master.gain.setTargetAtTime(Math.max(0.0001, Math.min(1, v)), ctx.currentTime, 0.05); }

  async function enterZen() {
    document.body.classList.add('zen');
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* user gesture missing or unsupported */ }
  }
  async function exitZen() {
    document.body.classList.remove('zen');
    try { if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen(); } catch { /* ignore */ }
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('zen'); });

  window.VisionaryShield = Object.freeze({ PRESETS, start, stop, setVolume, current: () => current, enterZen, exitZen, isZen: () => document.body.classList.contains('zen') });
})();
