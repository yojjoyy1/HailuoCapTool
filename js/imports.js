// 外部載入：字型、LUT、文字範本、網址下載，以及重新整理後的還原
import { userFonts, luts, userTextPresets, newId, emit, toast } from './state.js';
import { defaultTextProps } from './builtin.js';
import { addFileAsset } from './library.js';
import { dbPut, dbDelete, dbAll } from './storage.js';
import { parseCube, lutPreview, forgetLut } from './lut.js';

const EXT_MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};
const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();

export function kindOf(file) {
  const e = extOf(file.name);
  if (['ttf', 'otf', 'woff', 'woff2'].includes(e) || file.type.startsWith('font/')) return 'font';
  if (e === 'cube') return 'lut';
  if (e === 'json' || file.type === 'application/json') return 'preset';
  const t = file.type || EXT_MIME[e] || '';
  if (/^(video|image|audio)\//.test(t)) return 'media';
  return null;
}
function withType(file) {
  if (file.type && file.type !== 'application/octet-stream') return file;
  const t = EXT_MIME[extOf(file.name)];
  return t ? new File([file], file.name, { type: t }) : file;
}

export function persist(rec) {
  return dbPut(rec).catch((err) => {
    console.warn(err);
    toast('瀏覽器儲存空間不足：這個項目可以使用，但重新整理後不會保留', 4000);
  });
}

/** 依檔案種類自動分派 */
export async function importAny(file, opts = {}) {
  if (extOf(file.name) === 'hlproj') return (await import('./project.js')).openProject(file);
  file = withType(file);
  switch (kindOf(file)) {
    case 'font': return importFont(file);
    case 'lut': return importLut(file.name, await file.text());
    case 'preset': return importPresetFile(file);
    case 'media': return addFileAsset(file, opts);
    default: throw new Error(`不支援的檔案：${file.name}`);
  }
}

// ---------- 字型 ----------
export async function importFont(file, { id, persist: save = true } = {}) {
  const name = file.name.replace(/\.[^.]+$/, '');
  const family = 'UF-' + name.replace(/["\\]/g, '');
  if (userFonts.some((f) => f.family === family)) { toast(`字型「${name}」已經匯入過了`); return null; }
  const face = new FontFace(family, await file.arrayBuffer());
  try { await face.load(); } catch { throw new Error(`無法讀取字型檔：${file.name}`); }
  document.fonts.add(face);
  const f = { id: id || newId('f'), name, family, css: `"${family}", PingFang TC, Noto Sans TC, sans-serif`, face, blob: file };
  userFonts.push(f);
  if (save) await persist({ id: f.id, kind: 'font', name: file.name, blob: file });
  emit('library');
  return f;
}
export function removeFont(id) {
  const i = userFonts.findIndex((f) => f.id === id);
  if (i < 0) return;
  document.fonts.delete(userFonts[i].face);
  userFonts.splice(i, 1);
  dbDelete(id).catch(() => {});
  emit('library');
}

// ---------- LUT ----------
export async function importLut(fileName, text, { id, persist: save = true } = {}) {
  const lut = parseCube(text);
  lut.id = id || newId('l');
  lut.name = fileName.replace(/\.cube$/i, '');
  lut.text = text;
  lut.preview = lutPreview(lut);
  luts.set(lut.id, lut);
  if (save) await persist({ id: lut.id, kind: 'lut', name: fileName, text });
  emit('library');
  return lut;
}
export function removeLut(id) {
  luts.delete(id);
  forgetLut(id);
  dbDelete(id).catch(() => {});
  emit('library');
}

// ---------- 文字範本 ----------
const savePresets = () => persist({ id: '__textPresets', kind: 'presets', list: userTextPresets });

export function saveTextPreset(clip, name) {
  userTextPresets.push({
    id: newId('p'), name, text: structuredClone(clip.text),
    x: clip.transform.x, y: clip.transform.y, scale: clip.transform.scale,
  });
  savePresets();
  emit('library');
}
export function removePreset(id) {
  const i = userTextPresets.findIndex((p) => p.id === id);
  if (i >= 0) userTextPresets.splice(i, 1);
  savePresets();
  emit('library');
}
export function exportPresets() {
  if (!userTextPresets.length) { toast('還沒有自訂文字範本'); return; }
  const data = { format: 'hailuo-text-presets', version: 1, presets: userTextPresets.map(({ id, ...p }) => p) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = '文字範本.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importPresetFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('範本檔不是正確的 JSON 格式'); }
  const list = Array.isArray(data) ? data : data?.presets;
  if (!Array.isArray(list)) throw new Error('範本檔裡找不到 presets 清單');
  let n = 0;
  for (const p of list) {
    if (!p || typeof p.text !== 'object') continue;
    userTextPresets.push({
      id: newId('p'), name: String(p.name || '範本'), text: { ...defaultTextProps(), ...p.text },
      x: p.x ?? 0.5, y: p.y ?? 0.5, scale: p.scale ?? 1,
    });
    n++;
  }
  savePresets();
  emit('library');
  toast(`已匯入 ${n} 個文字範本`);
}

// ---------- 網址 ----------
export async function importFromUrl(url, opts = {}) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('請輸入 http:// 或 https:// 開頭的網址');
  let res;
  try {
    res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    // 對方網站不允許跨站讀取時，改由本機伺服器代為下載
    res = await fetch('/proxy?url=' + encodeURIComponent(url)).catch(() => null);
    if (!res) throw new Error('無法連線，請確認網址與網路');
    if (!res.ok) throw new Error(`下載失敗（狀態碼 ${res.status}）`);
  }
  const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct === 'text/html') throw new Error('這個網址是網頁而不是檔案（YouTube、IG 等影片頁面無法直接載入），請使用檔案的直接連結');
  const blob = await res.blob();
  const finalUrl = res.headers.get('x-final-url') || url;
  let name = '';
  try { name = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || ''); } catch {}
  if (!name) name = 'download';
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    const e = Object.entries(EXT_MIME).find(([, m]) => m === ct)?.[0];
    if (e) name += '.' + e;
  }
  const type = ['application/octet-stream', 'text/plain', 'binary/octet-stream'].includes(ct) ? '' : ct;
  return importAny(new File([blob], name, { type }), opts);
}

// ---------- 還原 ----------
export async function restoreLibrary() {
  let recs = [];
  try { recs = await dbAll(); } catch { return; }
  let n = 0;
  for (const r of recs) {
    try {
      if (r.kind === 'media') await addFileAsset(new File([r.blob], r.name, { type: r.type }), { id: r.id, category: r.category, persist: false });
      else if (r.kind === 'font') await importFont(new File([r.blob], r.name), { id: r.id, persist: false });
      else if (r.kind === 'lut') await importLut(r.name, r.text, { id: r.id, persist: false });
      else if (r.kind === 'presets') { userTextPresets.push(...(r.list || [])); emit('library'); n += (r.list || []).length - 1; }
      n++;
    } catch (err) {
      console.warn('還原失敗', r.name, err);
    }
  }
  if (n > 0) toast(`已載入先前匯入的 ${n} 個項目`);
}
