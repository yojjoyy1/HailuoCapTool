// 時間軸：軌道、尺規、播放頭、拖曳/修剪/吸附、從素材區拖入
import {
  state, ui, assets, TRACK_KINDS, getClip, getTrack, clipEnd, totalDuration, packMain, findFreeTrack,
  removeTrackIfEmpty, maxSourceDuration, commit, select, setTime, on, emit, fmtTime,
} from './state.js';
import { dragPayload, placeClip } from './library.js';
import { TEXT_ANIMS, EFFECTS } from './builtin.js';

const $ = (id) => document.getElementById(id);
let heads, lanes, ruler, content, scroll, playhead;
const SUB_LANE = '__subs';
const SNAP_PX = 8;

const px = () => ui.pxPerSec;
const timeFromClientX = (x) => Math.max(0, (x - lanes.getBoundingClientRect().left) / px());

function laneOrder() {
  // 字幕軌顯示在文字軌之後
  const list = [];
  let subPlaced = false;
  for (const t of state.tracks) {
    if (!subPlaced && !['fx', 'text'].includes(t.kind)) { list.push({ id: SUB_LANE, kind: 'sub' }); subPlaced = true; }
    list.push(t);
  }
  if (!subPlaced) list.push({ id: SUB_LANE, kind: 'sub' });
  return list;
}

function contentWidth() {
  const vis = scroll.clientWidth;
  return Math.max(vis, (totalDuration() + 30) * px());
}

function renderRuler() {
  const w = contentWidth();
  content.style.width = w + 'px';
  ruler.innerHTML = '';
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const step = steps.find((s) => s * px() >= 70) || 300;
  const minor = step / 5;
  const end = w / px();
  const frag = document.createDocumentFragment();
  for (let i = 0; i * minor <= end; i++) {
    const t = Math.round(i * minor * 1000) / 1000;
    const major = i % 5 === 0;
    const d = document.createElement('div');
    d.className = 'tick' + (major ? '' : ' minor');
    d.style.left = t * px() + 'px';
    if (major) d.textContent = fmtTime(t, step < 1);
    frag.appendChild(d);
  }
  ruler.appendChild(frag);
}

function clipLabel(c) {
  if (c.kind === 'text') return `T ${c.text?.content?.split('\n')[0] || ''}`;
  if (c.kind === 'effect') return `✦ ${EFFECTS[c.effect?.type]?.name || '特效'}`;
  const a = assets.get(c.assetId);
  return a?.name || c.name || '';
}
function clipTag(c) {
  const bits = [fmtTime(c.duration)];
  if (c.speed !== 1) bits.push(`${c.speed}x`);
  if (c.kind === 'text' && c.text?.anim && c.text.anim !== 'none') bits.push(TEXT_ANIMS[c.text.anim]);
  if (c.filter && c.filter !== 'none') bits.push('濾鏡');
  return bits.join(' · ');
}

function renderHeads(order) {
  heads.innerHTML = '';
  const counts = {};
  for (const t of order) {
    const d = document.createElement('div');
    d.className = 'tl-head';
    if (t.kind === 'sub') {
      d.innerHTML = `<span><span class="dot" style="background:var(--sub)"></span>字幕</span>`;
    } else {
      counts[t.kind] = (counts[t.kind] || 0) + 1;
      const info = TRACK_KINDS[t.kind];
      const total = state.tracks.filter((x) => x.kind === t.kind).length;
      const name = info.name + (total > 1 ? ` ${total - counts[t.kind] + 1}` : '');
      const hasAudio = ['main', 'overlay', 'audio'].includes(t.kind);
      d.innerHTML = `<span><span class="dot" style="background:${info.color}"></span>${name}</span>
        <span>${hasAudio ? `<button class="mute" title="整軌靜音">${t.muted ? '🔇' : '🔊'}</button>` : ''}</span>`;
      d.querySelector('.mute')?.addEventListener('click', () => { t.muted = !t.muted; commit(); });
    }
    heads.appendChild(d);
  }
}

function renderLanes() {
  const order = laneOrder();
  renderHeads(order);
  renderRuler();
  lanes.innerHTML = '';
  for (const t of order) {
    const lane = document.createElement('div');
    lane.className = 'tl-lane';
    lane.dataset.track = t.id;
    if (t.kind === 'sub') {
      for (const s of state.subtitles) lane.appendChild(subEl(s));
    } else {
      for (const c of state.clips.filter((x) => x.trackId === t.id)) lane.appendChild(clipEl(c, t));
    }
    setupLaneDrop(lane, t);
    lane.addEventListener('mousedown', (e) => {
      if (e.target !== lane) return;
      select(null);
      startScrub(e);
    });
    lanes.appendChild(lane);
  }
  updatePlayhead();
}

function clipEl(c, track) {
  const d = document.createElement('div');
  const a = assets.get(c.assetId);
  d.className = `clip k-${c.kind} t-${track.kind}` + (c.id === ui.selectedId ? ' selected' : '') + (c.muted ? ' muted' : '');
  d.dataset.id = c.id;
  d.style.left = c.start * px() + 'px';
  d.style.width = Math.max(4, c.duration * px()) + 'px';
  if (a?.type === 'audio' && a.waveform) {
    const full = (a.duration / c.speed) * px();
    d.style.backgroundImage = `url('${a.waveform}')`;
    d.style.backgroundSize = `${full}px 100%`;
    d.style.backgroundPosition = `${(-c.in / c.speed) * px()}px 0`;
    d.style.backgroundRepeat = 'no-repeat';
  } else if (a?.thumb && a.type !== 'audio') {
    d.style.backgroundImage = `linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.25)),url('${a.thumb}')`;
  }
  d.innerHTML = `<div class="h l"></div><div class="label">${escapeHtml(clipLabel(c))}</div><div class="tag">${escapeHtml(clipTag(c))}</div><div class="h r"></div>`;
  d.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    select(c.id);
    const mode = e.target.classList.contains('l') ? 'trimL' : e.target.classList.contains('r') ? 'trimR' : 'move';
    startClipDrag(e, c, mode);
  });
  return d;
}

function subEl(s) {
  const d = document.createElement('div');
  d.className = 'clip k-sub' + (s.id === ui.selectedSubId ? ' selected' : '');
  d.style.left = s.start * px() + 'px';
  d.style.width = Math.max(4, (s.end - s.start) * px()) + 'px';
  d.innerHTML = `<div class="h l"></div><div class="label">${escapeHtml(s.text)}</div><div class="h r"></div>`;
  d.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    ui.selectedSubId = s.id; ui.selectedId = null;
    emit('select'); emit('subselect', s.id);
    const mode = e.target.classList.contains('l') ? 'trimL' : e.target.classList.contains('r') ? 'trimR' : 'move';
    startSubDrag(e, s, mode);
  });
  return d;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// ---------- 吸附 ----------
function snapPoints(ignoreId) {
  const pts = [0, ui.time];
  for (const c of state.clips) if (c.id !== ignoreId) pts.push(c.start, clipEnd(c));
  for (const s of state.subtitles) if (s.id !== ignoreId) pts.push(s.start, s.end);
  return pts;
}
let snapLine = null;
function showSnap(t) {
  if (!snapLine) { snapLine = document.createElement('div'); snapLine.className = 'snap-line'; }
  if (t == null) { snapLine.remove(); return; }
  snapLine.style.left = t * px() + 'px';
  content.appendChild(snapLine);
}
/** 回傳吸附後的位移量 */
function snapDelta(edges, ignoreId) {
  if (!ui.snap) return { d: 0, at: null };
  const pts = snapPoints(ignoreId);
  let best = { d: 0, dist: SNAP_PX / px(), at: null };
  for (const e of edges) for (const p of pts) {
    const dist = Math.abs(p - e);
    if (dist < best.dist) best = { d: p - e, dist, at: p };
  }
  return best;
}

// ---------- 片段拖曳 ----------
function laneAt(clientY) {
  for (const l of lanes.children) {
    const r = l.getBoundingClientRect();
    if (clientY >= r.top && clientY < r.bottom) return getTrack(l.dataset.track);
  }
  return null;
}

function startClipDrag(e, c, mode) {
  const x0 = e.clientX;
  const orig = { start: c.start, duration: c.duration, in: c.in, trackId: c.trackId };
  const srcMax = maxSourceDuration(c);
  const isMedia = srcMax !== Infinity;
  const visual = ['video', 'image', 'gen'].includes(c.kind);
  let moved = false;
  const onMove = (ev) => {
    const dt = (ev.clientX - x0) / px();
    if (Math.abs(ev.clientX - x0) > 2) moved = true;
    if (!moved) return;
    let snapAt = null;
    if (mode === 'move') {
      let ns = Math.max(0, orig.start + dt);
      const s = snapDelta([ns, ns + c.duration], c.id);
      ns = Math.max(0, ns + s.d); snapAt = s.at;
      c.start = ns;
      const lt = laneAt(ev.clientY);
      if (lt && lt.id !== c.trackId) {
        const cur = getTrack(c.trackId);
        const ok = lt.kind === cur.kind || (visual && ['main', 'overlay'].includes(lt.kind));
        if (ok) c.trackId = lt.id;
      }
    } else if (mode === 'trimL') {
      let d = dt;
      const s = snapDelta([orig.start + d], c.id); d += s.d; snapAt = s.at;
      const minD = isMedia ? -orig.in / c.speed : -orig.start;
      d = Math.max(minD, -orig.start, Math.min(d, orig.duration - 0.1));
      c.start = orig.start + d;
      c.in = orig.in + d * c.speed;
      c.duration = orig.duration - d;
      if (!isMedia && c.kind === 'gen') c.in = Math.max(0, c.in);
    } else {
      let nd = orig.duration + dt;
      const s = snapDelta([orig.start + nd], c.id); nd += s.d; snapAt = s.at;
      const maxD = isMedia ? (srcMax - orig.in) / c.speed : Infinity;
      c.duration = Math.max(0.1, Math.min(nd, maxD));
    }
    showSnap(snapAt);
    renderLanes();
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    showSnap(null);
    if (!moved) return;
    const t = getTrack(c.trackId);
    const prev = getTrack(orig.trackId);
    if (t.kind === 'main') {
      // 主軌移動時：以落點決定順序，再緊密排列
      if (mode === 'move') {
        const others = state.clips.filter((x) => x.trackId === t.id && x.id !== c.id);
        const center = c.start + c.duration / 2;
        const target = others.find((o) => center < o.start + o.duration / 2);
        c.start = target ? target.start - 0.0001 : Infinity;
      }
      packMain();
    } else {
      const overlap = state.clips.some((x) => x.trackId === t.id && x.id !== c.id && x.start < clipEnd(c) - 1e-6 && clipEnd(x) > c.start + 1e-6);
      if (overlap) {
        c.trackId = '__tmp';
        c.trackId = findFreeTrack(t.kind, c.start, clipEnd(c), null).id;
      }
    }
    if (prev.kind === 'main' && t.kind !== 'main') {
      packMain();
      c.transform.scale = Math.min(c.transform.scale, 0.5);
    }
    if (prev.kind !== 'main') removeTrackIfEmpty(prev.id);
    commit();
    renderLanes();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startSubDrag(e, s, mode) {
  const x0 = e.clientX;
  const orig = { start: s.start, end: s.end };
  let moved = false;
  const onMove = (ev) => {
    const dt = (ev.clientX - x0) / px();
    if (Math.abs(ev.clientX - x0) > 2) moved = true;
    if (!moved) return;
    let snapAt = null;
    if (mode === 'move') {
      let ns = Math.max(0, orig.start + dt);
      const sd = snapDelta([ns, ns + orig.end - orig.start], s.id); ns = Math.max(0, ns + sd.d); snapAt = sd.at;
      s.start = ns; s.end = ns + (orig.end - orig.start);
    } else if (mode === 'trimL') {
      let ns = orig.start + dt; const sd = snapDelta([ns], s.id); ns += sd.d; snapAt = sd.at;
      s.start = Math.max(0, Math.min(ns, s.end - 0.1));
    } else {
      let ne = orig.end + dt; const sd = snapDelta([ne], s.id); ne += sd.d; snapAt = sd.at;
      s.end = Math.max(s.start + 0.1, ne);
    }
    showSnap(snapAt);
    renderLanes();
    emit('subtimes');
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    showSnap(null);
    if (moved) { state.subtitles.sort((a, b) => a.start - b.start); commit(); }
    else setTime(s.start);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ---------- 播放頭 / 拖動時間 ----------
function startScrub(e) {
  setTime(timeFromClientX(e.clientX));
  const onMove = (ev) => setTime(timeFromClientX(ev.clientX));
  const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function updatePlayhead() {
  playhead.style.left = ui.time * px() + 'px';
  playhead.style.height = content.scrollHeight + 'px';
}

function followPlayhead() {
  if (!ui.playing) return;
  const x = ui.time * px();
  if (x > scroll.scrollLeft + scroll.clientWidth - 60 || x < scroll.scrollLeft) scroll.scrollLeft = x - 60;
}

// ---------- 從素材區拖入 ----------
function setupLaneDrop(lane, t) {
  lane.addEventListener('dragover', (e) => {
    if (!dragPayload || t.kind === 'sub') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    lane.classList.add('drop-ok');
  });
  lane.addEventListener('dragleave', () => lane.classList.remove('drop-ok'));
  lane.addEventListener('drop', (e) => {
    lane.classList.remove('drop-ok');
    if (!dragPayload || t.kind === 'sub') return;
    e.preventDefault();
    let time = timeFromClientX(e.clientX);
    const s = snapDelta([time], null);
    time += s.d;
    placeClip(dragPayload, t.kind, time, t.id);
  });
}

export function initTimeline() {
  heads = $('tlHeads'); lanes = $('tlLanes'); ruler = $('tlRuler');
  content = $('tlContent'); scroll = $('tlScroll'); playhead = $('tlPlayhead');
  scroll.addEventListener('scroll', () => { heads.scrollTop = scroll.scrollTop; });
  ruler.addEventListener('mousedown', startScrub);
  playhead.querySelector('.knob').addEventListener('mousedown', (e) => { e.stopPropagation(); startScrub(e); });
  $('zoom').addEventListener('input', (e) => {
    const center = ui.time;
    ui.pxPerSec = +e.target.value;
    renderLanes();
    scroll.scrollLeft = center * px() - scroll.clientWidth / 2;
  });
  scroll.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    ui.pxPerSec = Math.max(10, Math.min(300, ui.pxPerSec * (e.deltaY < 0 ? 1.12 : 0.89)));
    $('zoom').value = ui.pxPerSec;
    renderLanes();
  }, { passive: false });
  $('snapToggle').addEventListener('change', (e) => { ui.snap = e.target.checked; });
  on('change', renderLanes);
  on('select', () => {
    lanes.querySelectorAll('.clip').forEach((el) => el.classList.toggle('selected', !!el.dataset.id && el.dataset.id === ui.selectedId));
    if (ui.selectedSubId) renderLanes();
  });
  on('time', () => { updatePlayhead(); followPlayhead(); });
  on('assets', renderLanes);
  window.addEventListener('resize', renderLanes);
  renderLanes();
}

export { renderLanes };
