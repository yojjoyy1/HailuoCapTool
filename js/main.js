import {
  state, ui, initTracks, initHistory, commit, undo, redo, setAspect, getClip, getTrack, select, setTime,
  splitClip, deleteClip, duplicateClip, totalDuration, fmtTime, on, emit, toast, clipEnd, mainTrack,
} from './state.js';
import { initPlayer, togglePlay, hitBoxes, setMasterVolume, pause } from './player.js';
import { initLibrary, loadBuiltins } from './library.js';
import { initTimeline } from './timeline.js';
import { initInspector } from './inspector.js';
import { initSubtitles, tap, tapEnd, exportSrt } from './subtitles.js';
import { exportVideo, isExporting } from './exporter.js';
import { restoreLibrary } from './imports.js';
import { openRecorder } from './recorder.js';
import { saveProject, pickProject } from './project.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');

initTracks();
initHistory();
initPlayer(canvas);
initLibrary();
initTimeline();
initInspector();
initSubtitles();
loadBuiltins().catch((e) => { console.error(e); toast('預設素材載入失敗：' + e.message); });
restoreLibrary();

// ---------- 畫面比例 ----------
function applyAspect() {
  canvas.width = state.width;
  canvas.height = state.height;
  $('aspectSelect').value = state.aspect;
}
on('aspect', applyAspect);
$('aspectSelect').onchange = (e) => setAspect(e.target.value);
applyAspect();

// ---------- 播放控制 ----------
$('btnPlay').onclick = togglePlay;
$('btnToStart').onclick = () => setTime(0);
$('btnToEnd').onclick = () => setTime(totalDuration());
$('masterVol').oninput = (e) => setMasterVolume(+e.target.value);
on('play', () => { $('btnPlay').textContent = ui.playing ? '⏸' : '▶'; });
const updateTc = () => { $('tcNow').textContent = fmtTime(ui.time); $('tcTotal').textContent = fmtTime(totalDuration()); };
on('time', updateTc);
on('change', updateTc);

// ---------- 編輯操作 ----------
function doSplit() {
  const sel = getClip(ui.selectedId);
  if (sel && ui.time > sel.start && ui.time < clipEnd(sel)) {
    splitClip(sel.id, ui.time); commit(); return;
  }
  const m = mainTrack();
  const hit = state.clips.find((c) => c.trackId === m.id && ui.time > c.start && ui.time < clipEnd(c));
  if (hit) { splitClip(hit.id, ui.time); commit(); toast('已在播放頭分割主影片'); }
  else toast('播放頭位置沒有可分割的片段');
}
function doDelete() {
  if (ui.selectedId) { deleteClip(ui.selectedId); commit(); emit('select'); return; }
  if (ui.selectedSubId) {
    state.subtitles = state.subtitles.filter((s) => s.id !== ui.selectedSubId);
    ui.selectedSubId = null; commit();
  }
}
function doDuplicate() {
  if (!ui.selectedId) return;
  const n = duplicateClip(ui.selectedId); commit(); select(n.id);
}
$('btnSplit').onclick = doSplit;
$('btnDelete').onclick = doDelete;
$('btnDuplicate').onclick = doDuplicate;
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnDetachAudio').onclick = () => {
  const sel = getClip(ui.selectedId);
  const targets = sel?.kind === 'video' ? [sel] : state.clips.filter((c) => c.kind === 'video');
  if (!targets.length) { toast('時間軸上沒有影片'); return; }
  targets.forEach((c) => { c.muted = true; });
  commit();
  document.querySelector('#libTabs [data-tab=audio]').click();
  toast(sel?.kind === 'video' ? '已移除此片段原聲，可拖入新的背景音樂' : '已移除所有影片原聲，可拖入新的背景音樂');
};
$('btnExport').onclick = () => { pause(); exportVideo(canvas); };
$('btnExportSrt').onclick = exportSrt;
$('btnSaveProject').onclick = saveProject;
$('btnOpenProject').onclick = pickProject;
$('btnRecord').onclick = $('btnRecordLib').onclick = () => { pause(); openRecorder(); };

// ---------- 鍵盤快捷鍵 ----------
window.addEventListener('keydown', (e) => {
  if (isExporting() || !$('modal').classList.contains('hidden')) return;
  const tag = document.activeElement?.tagName;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); redo(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); doDuplicate(); return; }
  if (mod) return;
  switch (e.key) {
    case ' ': e.preventDefault(); document.activeElement?.blur(); togglePlay(); break;
    case 's': case 'S': doSplit(); break;
    case 'm': case 'M': tap(); break;
    case 'n': case 'N': tapEnd(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); doDelete(); break;
    case 'ArrowLeft': e.preventDefault(); setTime(ui.time - (e.shiftKey ? 1 : 1 / 30)); break;
    case 'ArrowRight': e.preventDefault(); setTime(ui.time + (e.shiftKey ? 1 : 1 / 30)); break;
    case 'Home': setTime(0); break;
    case 'End': setTime(totalDuration()); break;
    case 'Escape': select(null); break;
    default: break;
  }
});

// ---------- 預覽畫面：點選 / 拖曳移動 / 滾輪縮放 ----------
const wrap = $('stageWrap');
wrap.style.position = 'relative';
const selBox = document.createElement('div');
selBox.className = 'sel-box';
wrap.appendChild(selBox);

function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
}
function hitTest(p) {
  for (let i = hitBoxes.length - 1; i >= 0; i--) {
    const b = hitBoxes[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b.id;
  }
  return null;
}
canvas.addEventListener('mousedown', (e) => {
  const p0 = toCanvas(e);
  const id = hitTest(p0);
  if (!id) { select(null); return; }
  if (id !== ui.selectedId) select(id);
  const c = getClip(id);
  const orig = { x: c.transform.x, y: c.transform.y };
  let moved = false;
  canvas.style.cursor = 'move';
  const onMove = (ev) => {
    const p = toCanvas(ev);
    let nx = orig.x + (p.x - p0.x) / canvas.width;
    let ny = orig.y + (p.y - p0.y) / canvas.height;
    // 置中吸附
    if (Math.abs(nx - 0.5) < 0.012) nx = 0.5;
    if (Math.abs(ny - 0.5) < 0.012) ny = 0.5;
    c.transform.x = nx; c.transform.y = ny;
    moved = true;
  };
  const onUp = () => {
    canvas.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (moved) commit();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});
let wheelTimer;
canvas.addEventListener('wheel', (e) => {
  const c = getClip(ui.selectedId);
  if (!c || !c.transform) return;
  e.preventDefault();
  c.transform.scale = Math.max(0.05, Math.min(5, c.transform.scale * (e.deltaY < 0 ? 1.05 : 0.95)));
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(commit, 300);
}, { passive: false });
canvas.addEventListener('mousemove', (e) => { if (!e.buttons) canvas.style.cursor = hitTest(toCanvas(e)) ? 'pointer' : ''; });

function updateSelBox() {
  const b = ui.selectedId && hitBoxes.find((h) => h.id === ui.selectedId);
  if (!b || isExporting()) { selBox.style.display = 'none'; }
  else {
    const r = canvas.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const sx = r.width / canvas.width, sy = r.height / canvas.height;
    Object.assign(selBox.style, {
      display: 'block',
      left: r.left - wr.left + b.x * sx + 'px', top: r.top - wr.top + b.y * sy + 'px',
      width: b.w * sx + 'px', height: b.h * sy + 'px',
    });
  }
  requestAnimationFrame(updateSelBox);
}
requestAnimationFrame(updateSelBox);

window.addEventListener('beforeunload', (e) => { if (state.clips.length) { e.preventDefault(); e.returnValue = ''; } });

updateTc();
