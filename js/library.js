// 素材管理區：匯入、縮圖、預設素材、拖曳到時間軸
import {
  state, ui, assets, userFonts, luts, userTextPresets, newId, defaultClip, insertClip, commit, select, emit, on, toast, getClip, fmtTime,
} from './state.js';
import { dbDelete } from './storage.js';
import {
  importAny, importFromUrl, persist, removeFont, removeLut, removePreset, exportPresets,
} from './imports.js';
import {
  GENS, EFFECTS, FILTERS, TEXT_ANIMS, TEXT_PRESETS, defaultTextProps, makeBuiltinImages, makeBuiltinAudio,
} from './builtin.js';

export let dragPayload = null;

// ---------- 素材建立 ----------
function loadMeta(url, tag) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    el.preload = 'metadata';
    el.muted = true;
    el.src = url;
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) { resolve(el); return; }
      // 瀏覽器錄製的 webm 常缺少長度資訊，跳到極遠處讓瀏覽器算出真實長度
      const done = () => { el.ondurationchange = null; el.currentTime = 0; resolve(el); };
      el.ondurationchange = () => { if (Number.isFinite(el.duration)) done(); };
      el.currentTime = 1e101;
      setTimeout(done, 4000);
    };
    el.onerror = () => reject(new Error('無法讀取檔案'));
  });
}
function seekOnce(v, t) {
  return new Promise((r) => { v.onseeked = () => r(); v.currentTime = t; setTimeout(r, 2500); });
}
async function videoThumb(v) {
  await seekOnce(v, Math.min(1, (v.duration || 1) * 0.1));
  const c = document.createElement('canvas');
  c.width = 192; c.height = Math.round(192 * (v.videoHeight / v.videoWidth || 9 / 16));
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

const decodeCtx = () => new OfflineAudioContext(1, 1, 44100);
export function decodeAsset(a) {
  if (!a.decoded) {
    a.decoded = (async () => {
      const ab = await (a.blob || (await fetch(a.url).then((r) => r.blob()))).arrayBuffer();
      return await decodeCtx().decodeAudioData(ab);
    })();
    a.decoded.catch(() => { a.decoded = null; });
  }
  return a.decoded;
}

function waveformImage(buffer, w = 600, h = 36) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const d = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / w));
  x.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < w; i++) {
    let m = 0;
    for (let j = 0; j < step; j += 16) m = Math.max(m, Math.abs(d[i * step + j] || 0));
    const bh = Math.max(1, m * h);
    x.fillRect(i, (h - bh) / 2, 1, bh);
  }
  return c.toDataURL();
}

/** 用 WebCodecs 把動態 GIF / WebP / APNG 拆成影格；非動畫或不支援時回傳 null */
async function decodeAnimated(file) {
  if (!('ImageDecoder' in window) || !/image\/(gif|webp|png|apng)/.test(file.type)) return null;
  try {
    if (!(await ImageDecoder.isTypeSupported(file.type))) return null;
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
    await dec.tracks.ready;
    await dec.completed;
    const track = dec.tracks.selectedTrack;
    if (!track || track.frameCount <= 1) { dec.close(); return null; }
    const frames = [];
    let total = 0;
    for (let i = 0; i < Math.min(track.frameCount, 900); i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const dur = Math.max(0.02, (image.duration || 100000) / 1e6);
      frames.push({ bmp: await createImageBitmap(image), start: total, dur });
      image.close();
      total += dur;
    }
    dec.close();
    return { frames, duration: total };
  } catch (err) {
    console.warn('動畫解碼失敗', err);
    return null;
  }
}

export async function addFileAsset(file, opts = {}) {
  const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') ? 'audio' : null;
  if (!type) throw new Error(`不支援的檔案類型：${file.name || file.type}`);
  const url = URL.createObjectURL(file);
  const a = { id: opts.id || newId('a'), type, name: opts.name || file.name || '未命名', url, blob: file, builtin: !!opts.builtin, category: opts.category };
  if (type === 'video') {
    const v = await loadMeta(url, 'video');
    a.duration = v.duration; a.width = v.videoWidth; a.height = v.videoHeight;
    a.hasVideo = v.videoWidth > 0;
    a.thumb = a.hasVideo ? await videoThumb(v) : null;
    if (!a.hasVideo) a.type = 'audio';
  } else if (type === 'image') {
    a.img = new Image();
    a.img.src = url;
    await a.img.decode().catch(() => {});
    a.width = a.img.naturalWidth; a.height = a.img.naturalHeight; a.thumb = url;
    const anim = await decodeAnimated(file);
    if (anim) { a.frames = anim.frames; a.animDuration = anim.duration; }
  }
  if (a.type === 'audio') {
    const el = await loadMeta(url, 'audio');
    a.duration = el.duration;
    decodeAsset(a).then((b) => { a.waveform = waveformImage(b); emit('assets'); emit('change'); }).catch(() => {});
  }
  assets.set(a.id, a);
  if (!a.builtin && opts.persist !== false) {
    persist({ id: a.id, kind: 'media', name: a.name, type: file.type, category: a.category, blob: file });
  }
  emit('assets');
  return a;
}

function addGenAssets() {
  for (const [genId, g] of Object.entries(GENS)) {
    const c = document.createElement('canvas'); c.width = 192; c.height = 108;
    g.draw(c.getContext('2d'), 192, 108, 1.2, g.duration);
    const a = { id: 'gen_' + genId, type: 'gen', genId, name: g.name, duration: g.duration, thumb: c.toDataURL(), builtin: true };
    assets.set(a.id, a);
  }
}

export async function loadBuiltins() {
  addGenAssets();
  renderBuiltinVisuals();
  const imgs = await makeBuiltinImages();
  for (const i of imgs) await addFileAsset(new File([i.blob], i.name + '.png', { type: 'image/png' }), { id: `b_${i.category}_${i.name}`, name: i.name, builtin: true, category: i.category });
  renderBuiltinVisuals();
  const auds = await makeBuiltinAudio();
  for (const i of auds) await addFileAsset(new File([i.blob], i.name + '.wav', { type: 'audio/wav' }), { id: `b_${i.category}_${i.name}`, name: i.name, builtin: true, category: i.category });
  renderAudioLists();
}

// ---------- 從素材建立片段 ----------
const findTextPreset = (id) => TEXT_PRESETS.find((x) => x.id === id) || userTextPresets.find((x) => x.id === id);

/** payload: {kind:'asset', id} | {kind:'text', preset} | {kind:'effect', fx} */
export function clipFromPayload(p) {
  if (p.kind === 'asset') {
    const a = assets.get(p.id);
    if (!a) return null;
    const c = defaultClip(a, a.type);
    if (a.type === 'audio') return { clip: c, track: 'audio' };
    return { clip: c, track: a.category === 'fx' || a.category === 'sticker' ? 'overlay' : 'main' };
  }
  if (p.kind === 'text') {
    const preset = findTextPreset(p.preset);
    const c = defaultClip(null, 'text');
    c.duration = 4;
    c.text = { ...defaultTextProps(), ...structuredClone(preset?.text || {}) };
    c.name = c.text.content;
    if (preset?.y != null) c.transform.y = preset.y;
    if (preset?.x != null) c.transform.x = preset.x;
    if (preset?.scale != null) c.transform.scale = preset.scale;
    return { clip: c, track: 'text' };
  }
  if (p.kind === 'effect') {
    const c = defaultClip(null, 'effect');
    c.duration = p.fx === 'flash' ? 1 : 4;
    c.effect = { type: p.fx, intensity: 1 };
    c.name = EFFECTS[p.fx].name;
    return { clip: c, track: 'fx' };
  }
  return null;
}

/** 依素材種類決定可放入的軌道；影像素材放到疊加軌時預設縮小 */
export function placeClip(p, trackKind, time, trackId) {
  const r = clipFromPayload(p);
  if (!r) return null;
  let kind = trackKind || r.track;
  const visual = ['video', 'image', 'gen'].includes(r.clip.kind);
  if (visual && !['main', 'overlay'].includes(kind)) kind = r.track;
  if (!visual && kind !== r.track) kind = r.track;
  if (kind === 'overlay') {
    const a = assets.get(r.clip.assetId);
    const tf = r.clip.transform;
    if (a?.category === 'fx') Object.assign(tf, { scale: 1, x: 0.5, y: 0.5 });
    else if (a?.category === 'sticker') Object.assign(tf, { scale: 0.35, x: 0.5, y: 0.5 });
    else Object.assign(tf, { scale: 0.45, x: 0.72, y: 0.3 });
  }
  insertClip(r.clip, kind, time, trackId);
  commit();
  select(r.clip.id);
  return r.clip;
}

function addAtPlayhead(p) {
  const r = clipFromPayload(p);
  if (!r) return;
  placeClip(p, r.track, ui.time);
  toast('已加入時間軸');
}

// ---------- UI ----------
function makeDraggable(el, payload) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    dragPayload = payload;
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  });
  el.addEventListener('dragend', () => { dragPayload = null; emit('dragend'); });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

function assetCard(a, { badge, checker } = {}) {
  const d = document.createElement('div');
  d.className = 'asset';
  d.innerHTML = `
    <div class="thumb ${checker ? 'checker' : ''}" style="${a.thumb && !checker ? `background-image:url('${a.thumb}')` : ''}">${checker && a.thumb ? `<img src="${a.thumb}">` : ''}${!a.thumb ? '🎵' : ''}</div>
    <div class="name" title="${esc(a.name)}">${esc(a.name)}</div>
    ${badge ? `<span class="badge">${badge}</span>` : ''}
    <button class="add" title="加到播放頭位置">＋</button>`;
  d.querySelector('.add').onclick = (e) => { e.stopPropagation(); addAtPlayhead({ kind: 'asset', id: a.id }); };
  d.ondblclick = () => addAtPlayhead({ kind: 'asset', id: a.id });
  makeDraggable(d, { kind: 'asset', id: a.id });
  return d;
}

function removableCard(card, a, rerender) {
  const del = document.createElement('button');
  del.className = 'del danger'; del.textContent = '移除';
  del.onclick = (e) => {
    e.stopPropagation();
    if (state.clips.some((c) => c.assetId === a.id)) { toast('此素材正在時間軸上使用中'); return; }
    assets.delete(a.id); URL.revokeObjectURL(a.url);
    dbDelete(a.id).catch(() => {});
    rerender();
  };
  card.appendChild(del);
  return card;
}

function audioRow(a) {
  const d = document.createElement('div');
  d.className = 'asset-row';
  d.innerHTML = `<span>🎵</span><span class="nm">${esc(a.name)}</span><span class="dur">${fmtTime(a.duration, false)}</span>
    <button class="pv">試聽</button><button class="ad">＋</button>`;
  let audio = null;
  d.querySelector('.pv').onclick = (e) => {
    const b = e.target;
    if (audio) { audio.pause(); audio = null; b.textContent = '試聽'; return; }
    audio = new Audio(a.url); audio.play(); b.textContent = '停止';
    audio.onended = () => { audio = null; b.textContent = '試聽'; };
  };
  d.querySelector('.ad').onclick = () => addAtPlayhead({ kind: 'asset', id: a.id });
  makeDraggable(d, { kind: 'asset', id: a.id });
  return d;
}

const mediaBadge = (a) => (a.type === 'video' ? `🎬 ${fmtTime(a.duration, false)}`
  : a.frames ? `🎞 動畫 ${a.animDuration.toFixed(1)}s` : a.type === 'image' ? '🖼 圖片' : `🎵 ${fmtTime(a.duration, false)}`);

export function renderMediaGrid() {
  const g = document.getElementById('mediaGrid');
  g.innerHTML = '';
  const list = [...assets.values()].filter((a) => !a.builtin && a.category !== 'fx');
  if (!list.length) { g.innerHTML = '<div style="grid-column:1/-1;color:var(--muted);padding:10px 0">尚未匯入素材</div>'; return; }
  for (const a of list) {
    const card = assetCard(a, { badge: mediaBadge(a), checker: a.type === 'image' && a.frames });
    if (a.type === 'audio' && a.waveform) card.querySelector('.thumb').style.cssText = `background:#14361f url('${a.waveform}') center/100% 60% no-repeat`;
    g.appendChild(removableCard(card, a, renderMediaGrid));
  }
}

function renderFxMedia() {
  const g = document.getElementById('fxMediaGrid');
  g.innerHTML = '';
  const list = [...assets.values()].filter((a) => a.category === 'fx');
  if (!list.length) { g.innerHTML = '<div style="grid-column:1/-1;color:var(--muted);font-size:11px">可匯入透明背景影片、黑底特效影片、GIF、PNG，會放到疊加軌並自動循環。</div>'; return; }
  for (const a of list) g.appendChild(removableCard(assetCard(a, { badge: mediaBadge(a), checker: a.type === 'image' }), a, renderFxMedia));
}

function renderBuiltinVisuals() {
  const gg = document.getElementById('genGrid'); gg.innerHTML = '';
  const ig = document.getElementById('imageGrid'); ig.innerHTML = '';
  for (const a of assets.values()) {
    if (!a.builtin) continue;
    if (a.type === 'gen') gg.appendChild(assetCard(a, { badge: `▶ ${a.duration}s` }));
    if (a.type === 'image') ig.appendChild(assetCard(a, { checker: a.category === 'sticker', badge: a.category === 'sticker' ? '貼圖' : '背景' }));
  }
}

function renderAudioLists() {
  const ml = document.getElementById('musicList'); ml.innerHTML = '';
  const sl = document.getElementById('sfxList'); sl.innerHTML = '';
  for (const a of assets.values()) {
    if (!a.builtin || a.type !== 'audio') continue;
    (a.category === 'sfx' ? sl : ml).appendChild(audioRow(a));
  }
  const userAudio = [...assets.values()].filter((a) => !a.builtin && a.type === 'audio');
  if (userAudio.length) {
    const h = document.createElement('h4'); h.textContent = '我匯入的音訊'; ml.appendChild(h);
    for (const a of userAudio) ml.appendChild(audioRow(a));
  }
}

function presetCard(p, removable) {
  const t = p.text;
  const d = document.createElement('div');
  d.className = 'asset';
  const style = p.preview
    ? Object.entries(p.preview).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`).join(';')
    : [`color:${t.color}`, `font-family:${t.font}`, `font-weight:${t.bold ? 800 : 400}`,
      t.strokeWidth > 0 ? `-webkit-text-stroke:1px ${t.stroke}` : '', t.bg ? `background:${t.bgColor};padding:0 6px` : '',
      t.glow ? `text-shadow:0 0 8px ${t.glow}` : ''].filter(Boolean).join(';');
  d.innerHTML = `<div class="thumb"><span style="${esc(style)}">${esc((t.content || '').split('\n')[0].slice(0, 6))}</span></div>
    <div class="name">${esc(p.name)}</div><button class="add">＋</button>`;
  d.querySelector('.add').onclick = (e) => { e.stopPropagation(); addAtPlayhead({ kind: 'text', preset: p.id }); };
  d.ondblclick = () => addAtPlayhead({ kind: 'text', preset: p.id });
  makeDraggable(d, { kind: 'text', preset: p.id });
  if (removable) {
    const del = document.createElement('button');
    del.className = 'del danger'; del.textContent = '移除';
    del.onclick = (e) => { e.stopPropagation(); if (confirm(`刪除範本「${p.name}」？`)) removePreset(p.id); };
    d.appendChild(del);
  }
  return d;
}

function renderUserPresets() {
  const g = document.getElementById('userTextGrid');
  g.innerHTML = '';
  if (!userTextPresets.length) { g.innerHTML = '<div style="grid-column:1/-1;color:var(--muted);font-size:11px">選取文字片段後，在屬性面板按「存成我的範本」，或匯入範本檔。</div>'; return; }
  for (const p of userTextPresets) g.appendChild(presetCard(p, true));
}

function renderFonts() {
  const l = document.getElementById('fontList');
  l.innerHTML = '';
  if (!userFonts.length) { l.innerHTML = '<div style="color:var(--muted);font-size:11px">支援 .ttf / .otf / .woff / .woff2，匯入後可在文字與字幕的字型選單選用。</div>'; return; }
  for (const f of userFonts) {
    const d = document.createElement('div');
    d.className = 'asset-row';
    d.innerHTML = `<span class="nm" style='font-family:${f.css};font-size:16px'>${esc(f.name)} 字型預覽 Aa</span><button class="danger">✕</button>`;
    d.querySelector('button').onclick = () => { if (confirm(`移除字型「${f.name}」？`)) removeFont(f.id); };
    l.appendChild(d);
  }
}

function renderLuts() {
  const l = document.getElementById('lutList');
  l.innerHTML = '';
  if (!luts.size) { l.innerHTML = '<div style="color:var(--muted);font-size:11px">匯入 .cube 檔後，點一下就能套用到選取的片段。</div>'; return; }
  for (const lut of luts.values()) {
    const d = document.createElement('div');
    d.className = 'asset-row';
    d.innerHTML = `<img src="${lut.preview}" style="width:48px;height:14px;border-radius:3px"><span class="nm">${esc(lut.name)}</span><button class="ap">套用</button><button class="danger">✕</button>`;
    d.querySelector('.ap').onclick = () => {
      const c = getClip(ui.selectedId);
      if (!c || !['video', 'image', 'gen'].includes(c.kind)) { toast('請先在時間軸選取一個影片或圖片片段'); return; }
      c.lut = lut.id; c.lutAmount = c.lutAmount || 1; commit(); emit('select');
    };
    d.querySelector('.danger').onclick = () => { if (confirm(`移除 LUT「${lut.name}」？`)) removeLut(lut.id); };
    l.appendChild(d);
  }
}

function renderTextAndFx() {
  const tg = document.getElementById('textGrid');
  for (const p of TEXT_PRESETS) tg.appendChild(presetCard(p, false));
  const al = document.getElementById('textAnimList');
  for (const [k, name] of Object.entries(TEXT_ANIMS)) {
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.textContent = name; chip.dataset.anim = k;
    chip.onclick = () => {
      const c = getClip(ui.selectedId);
      if (!c || c.kind !== 'text') { toast('請先在時間軸選取一個文字片段'); return; }
      c.text.anim = k; commit(); emit('select');
    };
    al.appendChild(chip);
  }
  const fg = document.getElementById('fxGrid');
  for (const [k, fx] of Object.entries(EFFECTS)) {
    const d = document.createElement('div');
    d.className = 'asset';
    d.innerHTML = `<div class="thumb" style="background:linear-gradient(135deg,#1e5a4a,#173040);font-size:26px">${fx.icon}</div><div class="name">${fx.name}</div><button class="add">＋</button>`;
    d.querySelector('.add').onclick = (e) => { e.stopPropagation(); addAtPlayhead({ kind: 'effect', fx: k }); };
    d.ondblclick = () => addAtPlayhead({ kind: 'effect', fx: k });
    makeDraggable(d, { kind: 'effect', fx: k });
    fg.appendChild(d);
  }
  const fl = document.getElementById('filterList');
  for (const [k, f] of Object.entries(FILTERS)) {
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.textContent = f.name; chip.dataset.filter = k;
    chip.onclick = () => {
      const c = getClip(ui.selectedId);
      if (!c || !['video', 'image', 'gen'].includes(c.kind)) { toast('請先在時間軸選取一個影片或圖片片段'); return; }
      c.filter = k; commit(); emit('select');
    };
    fl.appendChild(chip);
  }
}

export async function importFiles(files, opts = {}) {
  let n = 0;
  for (const f of files) {
    try { if (await importAny(f, opts)) n++; } catch (err) { toast(err.message, 4000); }
  }
  if (n) toast(`已匯入 ${n} 個項目`);
}

/** 讓按鈕開啟對應的隱藏檔案選擇器 */
function bindPicker(btnId, inputId, opts) {
  const input = document.getElementById(inputId);
  document.getElementById(btnId).onclick = () => input.click();
  input.onchange = () => { importFiles([...input.files], opts); input.value = ''; };
}
export const pickFont = () => document.getElementById('fontInput').click();
export const pickLut = () => document.getElementById('lutInput').click();

export function initLibrary() {
  document.querySelectorAll('#libTabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#libTabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.library .tab-page').forEach((p) => p.classList.toggle('active', p.dataset.page === b.dataset.tab));
    };
  });
  const input = document.getElementById('fileInput');
  const dz = document.getElementById('dropzone');
  input.onchange = () => { importFiles([...input.files]); input.value = ''; };
  dz.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dz.classList.add('over'); } });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); importFiles([...e.dataTransfer.files]); });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length && !e.target.closest('.tl-lane') && !e.target.closest('#dropzone')) { e.preventDefault(); importFiles([...e.dataTransfer.files]); }
  });

  const urlInput = document.getElementById('urlInput');
  const urlBtn = document.getElementById('urlBtn');
  const loadUrl = async () => {
    if (!urlInput.value.trim()) return;
    urlBtn.disabled = true; urlBtn.textContent = '下載中…';
    try {
      const r = await importFromUrl(urlInput.value, { category: urlInput.dataset.category || undefined });
      if (r) toast('已從網址載入');
      urlInput.value = '';
    } catch (err) { toast(err.message, 5000); }
    urlBtn.disabled = false; urlBtn.textContent = '載入';
  };
  urlBtn.onclick = loadUrl;
  urlInput.onkeydown = (e) => { if (e.key === 'Enter') loadUrl(); };

  bindPicker('btnImportFont', 'fontInput');
  bindPicker('btnImportPreset', 'presetInput');
  bindPicker('btnImportFx', 'fxInput', { category: 'fx' });
  bindPicker('btnImportLut', 'lutInput');
  document.getElementById('btnExportPreset').onclick = exportPresets;
  document.getElementById('btnFxUrl').onclick = async () => {
    const url = prompt('貼上特效素材的網址（影片、GIF、PNG 的直接連結）');
    if (!url) return;
    try { if (await importFromUrl(url, { category: 'fx' })) toast('已載入特效素材'); } catch (err) { toast(err.message, 5000); }
  };

  renderTextAndFx();
  const rerender = () => { renderMediaGrid(); renderAudioLists(); renderFxMedia(); };
  const rerenderLib = () => { renderUserPresets(); renderFonts(); renderLuts(); };
  rerender(); rerenderLib();
  on('assets', rerender);
  on('library', rerenderLib);
}

export { addAtPlayhead };
