// 播放引擎：同步每個片段的 <video>/<audio>、Web Audio 音量處理、畫面渲染迴圈
import { state, ui, assets, clipEnd, emit, on, totalDuration, getTrack } from './state.js';
import { renderFrame } from './renderer.js';

export let actx = null;
let master = null;
export let exportDest = null;
const els = new Map(); // clipId -> { el, assetId, gain, src, chain }
export const hitBoxes = [];
let canvas;

export function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = state.masterVolume;
    exportDest = actx.createMediaStreamDestination();
    master.connect(actx.destination);
    master.connect(exportDest);
    for (const e of els.values()) wireAudio(e);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

export function setMasterVolume(v) {
  state.masterVolume = v;
  if (master) master.gain.value = v;
}

function wireAudio(e) {
  if (!actx || e.src) return;
  e.src = actx.createMediaElementSource(e.el);
  e.gain = actx.createGain();
  e.gain.gain.value = 0;
  // 人聲強化：高通去低頻背景、低通去高頻雜音、提升人聲頻段
  const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160; hp.Q.value = 0.7;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000; lp.Q.value = 0.7;
  const pk = actx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2200; pk.gain.value = 5; pk.Q.value = 1;
  hp.connect(lp).connect(pk);
  e.chain = { hp, pk };
  e.voice = null;
  e.gain.connect(master);
  setVoice(e, false);
}
function setVoice(e, on) {
  if (!e.src || e.voice === on) return;
  e.src.disconnect();
  e.chain.pk.disconnect();
  if (on) { e.src.connect(e.chain.hp); e.chain.pk.connect(e.gain); }
  else e.src.connect(e.gain);
  e.voice = on;
}

function getEntry(c) {
  let e = els.get(c.id);
  if (e && e.assetId === c.assetId) return e;
  const a = assets.get(c.assetId);
  if (!a || (a.type !== 'video' && a.type !== 'audio')) return null;
  const el = document.createElement(a.type === 'video' ? 'video' : 'audio');
  el.src = a.url;
  el.preload = 'auto';
  el.playsInline = true;
  el.crossOrigin = 'anonymous';
  document.getElementById('hiddenMedia').appendChild(el);
  e = { el, assetId: c.assetId, gain: null, src: null };
  els.set(c.id, e);
  wireAudio(e);
  return e;
}

function cleanup() {
  const ids = new Set(state.clips.map((c) => c.id));
  for (const [id, e] of els) {
    if (!ids.has(id)) {
      e.el.pause();
      try { e.gain?.disconnect(); } catch {}
      e.el.removeAttribute('src'); e.el.load(); e.el.remove();
      els.delete(id);
    }
  }
}

export const media = {
  getVideo(c) { const e = getEntry(c); return e && e.el.tagName === 'VIDEO' ? e.el : null; },
};

function clipGain(c, lt) {
  if (c.muted || getTrack(c.trackId)?.muted) return 0;
  let g = c.volume;
  if (c.fadeIn > 0) g *= Math.min(1, lt / c.fadeIn);
  if (c.fadeOut > 0) g *= Math.min(1, Math.max(0, (c.duration - lt) / c.fadeOut));
  return Math.max(0, g);
}

function syncMedia() {
  const t = ui.time;
  for (const c of state.clips) {
    const a = assets.get(c.assetId);
    if (!a || (a.type !== 'video' && a.type !== 'audio')) continue;
    const e = getEntry(c);
    if (!e) continue;
    const el = e.el;
    const isActive = t >= c.start && t < clipEnd(c);
    const srcDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (a.duration || Infinity);
    let local = c.in + (t - c.start) * c.speed;
    if (c.loop && Number.isFinite(srcDur) && srcDur > 0) local %= srcDur;
    const target = Math.min(srcDur - 0.01, local);
    if (isActive) {
      if (el.playbackRate !== c.speed) el.playbackRate = c.speed;
      if (ui.playing) {
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
          if (target < srcDur - 0.02) el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - target) > 0.35 && !el.seeking) {
          el.currentTime = target;
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.03 && !el.seeking) el.currentTime = target;
      }
      if (e.gain) {
        setVoice(e, !!c.voiceBoost);
        e.gain.gain.setTargetAtTime(clipGain(c, t - c.start), actx.currentTime, 0.015);
      }
    } else {
      if (!el.paused) el.pause();
      if (e.gain) e.gain.gain.setTargetAtTime(0, actx.currentTime, 0.01);
      const until = c.start - t;
      if (until > 0 && until < 1.5 && Math.abs(el.currentTime - c.in) > 0.05 && !el.seeking) el.currentTime = c.in;
    }
  }
}

/** 以正在播放的主軌影片作為時鐘，避免畫面與聲音漂移 */
function masterClockTime() {
  for (const c of state.clips) {
    if (getTrack(c.trackId)?.kind !== 'main') continue;
    if (!(ui.time >= c.start && ui.time < clipEnd(c))) continue;
    const e = els.get(c.id);
    if (c.loop) return null;
    if (!e || e.el.paused || e.el.seeking || e.el.readyState < 3) return null;
    const t = c.start + (e.el.currentTime - c.in) / c.speed;
    if (Math.abs(t - ui.time) < 0.25) return t;
    return null;
  }
  return null;
}

let last = 0;
let onEndCb = null;
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (ui.playing) {
    const total = totalDuration();
    const mt = masterClockTime();
    let nt = ui.time + dt;
    if (mt != null && mt > ui.time) nt = Math.max(mt, ui.time);
    ui.time = nt;
    if (ui.time >= total) {
      ui.time = total;
      pause();
      onEndCb?.();
    }
    emit('time');
  }
  syncMedia();
  renderFrame(canvas, ui.time, media, hitBoxes);
  requestAnimationFrame(tick);
}

export function initPlayer(cv) {
  canvas = cv;
  on('change', cleanup);
  last = performance.now();
  requestAnimationFrame(tick);
}

export function play() {
  ensureAudio();
  if (ui.time >= totalDuration() - 0.02) ui.time = 0;
  ui.playing = true;
  emit('play');
}
export function pause() {
  ui.playing = false;
  for (const e of els.values()) e.el.pause();
  emit('play');
}
export function togglePlay() { ui.playing ? pause() : play(); }
export function onPlaybackEnd(cb) { onEndCb = cb; }
