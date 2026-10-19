// 專案狀態、軌道、片段操作與復原/重做

export const ASPECTS = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [1080, 1080],
};

export const TRACK_KINDS = {
  fx: { name: '特效', color: 'var(--fx)', accepts: ['effect'] },
  text: { name: '文字', color: 'var(--textc)', accepts: ['text'] },
  overlay: { name: '疊加畫面', color: 'var(--overlay)', accepts: ['video', 'image', 'gen'] },
  main: { name: '主影片', color: 'var(--main)', accepts: ['video', 'image', 'gen'] },
  audio: { name: '背景音樂', color: 'var(--audio)', accepts: ['audio'] },
};
// 時間軸由上到下的顯示順序
const KIND_ORDER = ['fx', 'text', 'overlay', 'main', 'audio'];

let uid = 1;
export const newId = (p = 'c') => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

export const assets = new Map(); // 素材不進 undo 歷史
export const userFonts = []; // { id, name, family }
export const luts = new Map(); // id -> { id, name, size, data, min, max, preview }
export const userTextPresets = []; // { id, name, text, x, y }

export const state = {
  aspect: '16:9',
  width: 1280,
  height: 720,
  tracks: [],
  clips: [],
  subtitles: [],
  subStyle: {
    font: 'PingFang TC, Noto Sans TC, sans-serif',
    size: 46, color: '#ffffff', stroke: '#000000', strokeWidth: 6,
    bg: false, bgColor: '#000000', bgOpacity: 0.5, y: 0.9, bold: true,
  },
  masterVolume: 1,
};

export const ui = {
  selectedId: null,
  selectedSubId: null,
  time: 0,
  playing: false,
  pxPerSec: 70,
  snap: true,
};

// ---------- 事件 ----------
const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
}
export function emit(evt, data) {
  listeners.get(evt)?.forEach((fn) => fn(data));
}

// ---------- 復原 / 重做 ----------
const undoStack = [];
const redoStack = [];
const snapshot = () => JSON.stringify({ tracks: state.tracks, clips: state.clips, subtitles: state.subtitles, subStyle: state.subStyle, aspect: state.aspect });

let lastSnap = null;
export function initHistory() { lastSnap = snapshot(); }

/** 在每次使用者完成一個動作後呼叫 */
export function commit() {
  const s = snapshot();
  if (s === lastSnap) return;
  undoStack.push(lastSnap);
  if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0;
  lastSnap = s;
  emit('change');
}
function restore(s) {
  const o = JSON.parse(s);
  state.tracks = o.tracks; state.clips = o.clips; state.subtitles = o.subtitles; state.subStyle = o.subStyle;
  setAspect(o.aspect, false);
  lastSnap = s;
  if (ui.selectedId && !getClip(ui.selectedId)) ui.selectedId = null;
  emit('change');
  emit('select');
}
/** 開啟專案：取代目前內容並清空復原紀錄 */
export function loadProjectState(o) {
  state.tracks = o.tracks; state.clips = o.clips; state.subtitles = o.subtitles || [];
  if (o.subStyle) state.subStyle = { ...state.subStyle, ...o.subStyle };
  if (o.masterVolume != null) state.masterVolume = o.masterVolume;
  undoStack.length = 0; redoStack.length = 0;
  ui.selectedId = null; ui.selectedSubId = null;
  setAspect(ASPECTS[o.aspect] ? o.aspect : '16:9', false);
  lastSnap = snapshot();
  emit('change');
  emit('select');
}
export function undo() { if (undoStack.length) { redoStack.push(lastSnap); restore(undoStack.pop()); } }
export function redo() { if (redoStack.length) { undoStack.push(lastSnap); restore(redoStack.pop()); } }

export function setAspect(a, doCommit = true) {
  state.aspect = a;
  [state.width, state.height] = ASPECTS[a];
  emit('aspect');
  if (doCommit) commit();
}

// ---------- 軌道 ----------
export function addTrack(kind) {
  const t = { id: newId('t'), kind };
  // 依種類順序插入；同種類新軌道放在該種類最上方（疊在上層）
  const firstIdx = state.tracks.findIndex((x) => x.kind === kind);
  if (firstIdx >= 0) state.tracks.splice(firstIdx, 0, t);
  else {
    const order = KIND_ORDER.indexOf(kind);
    let idx = state.tracks.findIndex((x) => KIND_ORDER.indexOf(x.kind) > order);
    if (idx < 0) idx = state.tracks.length;
    state.tracks.splice(idx, 0, t);
  }
  return t;
}
export function initTracks() {
  state.tracks = [];
  for (const k of KIND_ORDER) addTrack(k);
}
export const getTrack = (id) => state.tracks.find((t) => t.id === id);
export const mainTrack = () => state.tracks.find((t) => t.kind === 'main');
export function removeTrackIfEmpty(id) {
  const t = getTrack(id);
  if (!t || t.kind === 'main') return;
  const sameKind = state.tracks.filter((x) => x.kind === t.kind);
  if (sameKind.length <= 1) return;
  if (state.clips.some((c) => c.trackId === id)) return;
  state.tracks = state.tracks.filter((x) => x.id !== id);
}

// ---------- 片段 ----------
export const getClip = (id) => state.clips.find((c) => c.id === id);
export const clipsOn = (trackId) => state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
export const clipEnd = (c) => c.start + c.duration;

export function totalDuration() {
  let d = 0;
  for (const c of state.clips) d = Math.max(d, clipEnd(c));
  for (const s of state.subtitles) d = Math.max(d, s.end);
  return d;
}

function overlaps(trackId, start, end, ignoreId) {
  return state.clips.some((c) => c.trackId === trackId && c.id !== ignoreId && c.start < end - 1e-6 && clipEnd(c) > start + 1e-6);
}
/** 找一條同種類且不重疊的軌道，沒有就新增 */
export function findFreeTrack(kind, start, end, preferId) {
  if (preferId) {
    const t = getTrack(preferId);
    if (t && t.kind === kind && !overlaps(t.id, start, end)) return t;
  }
  for (const t of state.tracks.filter((x) => x.kind === kind)) if (!overlaps(t.id, start, end)) return t;
  return addTrack(kind);
}

export function defaultClip(asset, kind) {
  const base = {
    id: newId(), assetId: asset?.id ?? null, kind, trackId: null, start: 0,
    duration: 5, in: 0, speed: 1, name: asset?.name ?? '',
    volume: 1, muted: false, voiceBoost: false, fadeIn: 0, fadeOut: 0,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    filter: 'none', adjust: { brightness: 1, contrast: 1, saturate: 1 },
    lut: null, lutAmount: 1, blend: 'source-over', loop: false,
  };
  if (asset && (asset.type === 'video' || asset.type === 'audio')) base.duration = asset.duration || 5;
  if (asset?.type === 'gen') base.duration = asset.duration || 5;
  if (asset?.frames) { base.loop = true; base.duration = Math.max(3, asset.animDuration || 3); }
  if (asset?.category === 'fx') {
    base.loop = true;
    if (asset.type === 'video') base.blend = 'screen';
  }
  return base;
}

/** 主軌道磁吸：依開始時間排序並緊密排列 */
export function packMain() {
  const m = mainTrack();
  if (!m) return;
  let t = 0;
  for (const c of clipsOn(m.id)) { c.start = t; t += c.duration; }
}

/**
 * 加入片段到時間軸
 * kindOfTrack: main/overlay/text/fx/audio
 */
export function insertClip(clip, trackKind, time, preferTrackId) {
  if (trackKind === 'main') {
    const m = mainTrack();
    clip.trackId = m.id;
    const list = clipsOn(m.id);
    // 若時間點落在某片段中間 → 先分割再插入
    const hit = list.find((c) => time > c.start + 0.05 && time < clipEnd(c) - 0.05);
    if (hit) {
      splitClip(hit.id, time);
      clip.start = time - 0.0001;
    } else {
      // 吸到最近的片段邊界
      let best = 0;
      for (const c of list) {
        for (const b of [c.start, clipEnd(c)]) if (Math.abs(b - time) < Math.abs(best - time)) best = b;
      }
      clip.start = best - 0.0001;
    }
    state.clips.push(clip);
    packMain();
  } else {
    clip.start = Math.max(0, time);
    const t = findFreeTrack(trackKind, clip.start, clip.start + clip.duration, preferTrackId);
    clip.trackId = t.id;
    state.clips.push(clip);
  }
  return clip;
}

export function splitClip(id, time) {
  const c = getClip(id);
  if (!c || time <= c.start + 0.03 || time >= clipEnd(c) - 0.03) return null;
  const leftDur = time - c.start;
  const right = structuredClone(c);
  right.id = newId();
  right.start = time;
  right.duration = c.duration - leftDur;
  right.in = c.in + leftDur * c.speed;
  right.fadeIn = 0;
  c.duration = leftDur;
  c.fadeOut = 0;
  state.clips.push(right);
  return right;
}

export function deleteClip(id) {
  const c = getClip(id);
  if (!c) return;
  state.clips = state.clips.filter((x) => x.id !== id);
  const track = getTrack(c.trackId);
  if (track?.kind === 'main') packMain();
  else removeTrackIfEmpty(c.trackId);
  if (ui.selectedId === id) ui.selectedId = null;
}

export function duplicateClip(id) {
  const c = getClip(id);
  if (!c) return null;
  const n = structuredClone(c);
  n.id = newId();
  const track = getTrack(c.trackId);
  if (track.kind === 'main') {
    n.start = clipEnd(c) - 0.0001;
    state.clips.push(n);
    packMain();
  } else {
    n.start = clipEnd(c);
    n.trackId = findFreeTrack(track.kind, n.start, n.start + n.duration, track.id).id;
    state.clips.push(n);
  }
  return n;
}

/** 片段的最大可用長度（受原始素材長度限制） */
export function maxSourceDuration(c) {
  if (c.loop) return Infinity;
  const a = assets.get(c.assetId);
  if (a && (a.type === 'video' || a.type === 'audio') && a.duration) return a.duration;
  return Infinity;
}

export function select(id) {
  ui.selectedId = id;
  ui.selectedSubId = null;
  emit('select');
}

export function setTime(t) {
  ui.time = Math.max(0, t);
  emit('time');
}

// ---------- 工具 ----------
export function fmtTime(t, withMs = true) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${withMs ? '.' + String(cs).padStart(2, '0') : ''}`;
}
export function parseTime(str) {
  const p = String(str).trim().split(':');
  let sec = 0;
  for (const x of p) sec = sec * 60 + parseFloat(x || 0);
  return isNaN(sec) ? 0 : sec;
}

let toastTimer;
export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
