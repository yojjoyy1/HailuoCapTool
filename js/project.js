// 專案檔（.hlproj）：時間軸內容 + 用到的匯入素材、字型、LUT 打包成單一檔案
import { state, assets, userFonts, luts, loadProjectState, setTime, toast } from './state.js';
import { addFileAsset } from './library.js';
import { importFont, importLut } from './imports.js';
import { pause, setMasterVolume } from './player.js';

const MAGIC = 'HLPROJ01';
const EXT = '.hlproj';
let projectName = '未命名專案';

function usedFonts() {
  const css = new Set([state.subStyle.font, ...state.clips.map((c) => c.text?.font).filter(Boolean)]);
  return userFonts.filter((f) => css.has(f.css));
}

async function buildProjectBlob() {
  const blobs = [];
  let offset = 0;
  const pushBlob = (b) => { const e = { offset, size: b.size }; blobs.push(b); offset += b.size; return e; };

  const media = [];
  for (const id of new Set(state.clips.map((c) => c.assetId).filter(Boolean))) {
    const a = assets.get(id);
    if (!a || a.builtin || !a.blob) continue;
    media.push({ id, name: a.name, type: a.blob.type, category: a.category, ...pushBlob(a.blob) });
  }
  const fonts = [];
  for (const f of usedFonts()) {
    if (f.blob) fonts.push({ id: f.id, name: f.blob.name || f.name + '.ttf', ...pushBlob(f.blob) });
  }
  const lutList = [];
  for (const id of new Set(state.clips.map((c) => c.lut).filter(Boolean))) {
    const l = luts.get(id);
    if (l?.text) lutList.push({ id, name: l.name + '.cube', text: l.text });
  }

  const header = {
    app: 'hailuo-editor', version: 1, name: projectName, savedAt: new Date().toISOString(),
    project: {
      aspect: state.aspect, tracks: state.tracks, clips: state.clips, subtitles: state.subtitles,
      subStyle: state.subStyle, masterVolume: state.masterVolume,
    },
    media, fonts, luts: lutList,
  };
  const head = new TextEncoder().encode(JSON.stringify(header));
  const len = new ArrayBuffer(4);
  new DataView(len).setUint32(0, head.length, true);
  return new Blob([MAGIC, len, head, ...blobs], { type: 'application/octet-stream' });
}

export async function saveProject() {
  if (!state.clips.length && !state.subtitles.length) { toast('時間軸是空的，沒有內容可以存'); return; }
  pause();
  toast('正在打包專案…');
  let blob;
  try { blob = await buildProjectBlob(); } catch (err) { toast('專案打包失敗：' + err.message); return; }
  const suggested = projectName + EXT;
  if (window.showSaveFilePicker) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: '海螺剪輯器專案', accept: { 'application/octet-stream': [EXT] } }],
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      handle = null;
    }
    if (handle) {
      try {
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        setName(handle.name);
        toast(`已儲存專案「${handle.name}」（${(blob.size / 1048576).toFixed(1)} MB）`);
        return;
      } catch (err) { toast('寫入失敗，改用下載方式：' + err.message); }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggested;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(`專案已下載為「${suggested}」（${(blob.size / 1048576).toFixed(1)} MB）`);
}

function setName(fileName) {
  projectName = fileName.replace(/\.hlproj$/i, '') || '未命名專案';
  document.title = `${projectName} - 海螺剪輯器`;
}

async function readHeader(file) {
  const pre = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(pre.slice(0, 8)) !== MAGIC) throw new Error('這不是海螺剪輯器的專案檔');
  const len = new DataView(pre.buffer).getUint32(8, true);
  const header = JSON.parse(await file.slice(12, 12 + len).text());
  return { header, base: 12 + len };
}

export async function openProject(file) {
  if ((state.clips.length || state.subtitles.length) && !confirm('開啟專案會取代目前時間軸上的內容（未存檔的修改會遺失），確定要開啟嗎？')) return;
  pause();
  toast('正在開啟專案…', 10000);
  let header, base;
  try { ({ header, base } = await readHeader(file)); } catch (err) {
    toast(err instanceof SyntaxError ? '專案檔已損壞，無法讀取' : err.message);
    return;
  }
  const part = (e, name, type) => new File([file.slice(base + e.offset, base + e.offset + e.size)], name, { type });
  const failed = [];

  for (const m of header.media || []) {
    if (assets.has(m.id)) continue;
    try { await addFileAsset(part(m, m.name, m.type), { id: m.id, category: m.category }); } catch { failed.push(m.name); }
  }
  for (const f of header.fonts || []) {
    if (userFonts.some((x) => x.id === f.id || x.name === f.name.replace(/\.[^.]+$/, ''))) continue;
    try { await importFont(part(f, f.name, ''), { id: f.id }); } catch { failed.push(f.name); }
  }
  for (const l of header.luts || []) {
    if (luts.has(l.id)) continue;
    try { await importLut(l.name, l.text, { id: l.id }); } catch { failed.push(l.name); }
  }

  const p = header.project;
  const missing = p.clips.filter((c) => c.assetId && !assets.has(c.assetId)).length;
  loadProjectState(p);
  setMasterVolume(state.masterVolume);
  document.getElementById('masterVol').value = state.masterVolume;
  setTime(0);
  setName(file.name);
  const warn = [failed.length && `${failed.length} 個檔案無法載入`, missing && `${missing} 個片段找不到素材`].filter(Boolean).join('、');
  toast(warn ? `已開啟專案，但有 ${warn}` : `已開啟專案「${projectName}」`, warn ? 5000 : 2500);
}

export function pickProject() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = EXT;
  input.onchange = () => { if (input.files[0]) openProject(input.files[0]); };
  input.click();
}
