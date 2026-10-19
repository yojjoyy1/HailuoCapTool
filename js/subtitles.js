// 字幕打點區：手動打點、文稿對時、自動語音辨識、樣式、SRT 匯入匯出
import {
  state, ui, assets, newId, commit, on, emit, setTime, fmtTime, parseTime, toast, clipEnd, getTrack,
} from './state.js';
import { decodeAsset } from './library.js';
import { fontOptions } from './builtin.js';

const root = () => document.getElementById('subtitlePanel');
let pending = []; // 文稿中尚未打點的句子
let openSub = null; // 打點中的字幕
let worker = null;
let running = false;
const itemEls = new Map();

const MODELS = [
  ['onnx-community/whisper-base', 'Base（推薦，平衡）'],
  ['onnx-community/whisper-tiny', 'Tiny（最快，較不準）'],
  ['onnx-community/whisper-small', 'Small（最準，下載較大）'],
];
const LANGS = [['chinese', '中文'], ['english', '英文'], ['japanese', '日文'], ['korean', '韓文'], ['', '自動偵測']];

const prefs = { model: MODELS[0][0], language: 'chinese', toTrad: true, maxChars: 16, stripPunct: true, gpu: !!navigator.gpu };

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function sortSubs() { state.subtitles.sort((a, b) => a.start - b.start); }
function addSub(start, end, text = '') {
  const s = { id: newId('s'), start, end, text };
  state.subtitles.push(s);
  sortSubs();
  return s;
}

// ---------- 打點 ----------
export function tap() {
  const t = ui.time;
  if (openSub) openSub.end = Math.max(openSub.start + 0.2, t);
  const text = pending.shift() ?? '';
  openSub = addSub(t, t + 3, text);
  ui.selectedSubId = openSub.id;
  commit();
  renderList();
  scrollToItem(openSub.id);
  updatePending();
}
export function tapEnd() {
  if (!openSub) return;
  openSub.end = Math.max(openSub.start + 0.2, ui.time);
  openSub = null;
  commit();
  renderList();
}

// ---------- SRT ----------
const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
export function toSrt() {
  return state.subtitles.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join('\n');
}
export function exportSrt() {
  if (!state.subtitles.length) { toast('目前沒有字幕'); return; }
  const blob = new Blob([toSrt()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = '字幕.srt'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function parseSrt(text) {
  const out = [];
  const toSec = (s) => { const [hms, ms] = s.trim().replace('.', ',').split(','); return parseTime(hms) + (+ms || 0) / 1000; };
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    out.push({ start: toSec(a), end: toSec(b), text: lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '') });
  }
  return out;
}

// ---------- 自動辨識 ----------
let opencc = null;
async function getConverter() {
  if (opencc) return opencc;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  opencc = window.OpenCC.Converter({ from: 'cn', to: 'twp' });
  return opencc;
}

/** 把時間軸上所有影片的原始聲音混成 16kHz 單聲道（包含已靜音的原聲，方便換配樂後仍可辨識） */
async function mixSpeechAudio() {
  const clips = state.clips.filter((c) => c.kind === 'video' && ['main', 'overlay'].includes(getTrack(c.trackId)?.kind));
  if (!clips.length) throw new Error('時間軸上還沒有影片，請先加入影片');
  const total = Math.max(...clips.map(clipEnd));
  const SR = 16000;
  const ctx = new OfflineAudioContext(1, Math.ceil(total * SR) + SR, SR);
  let any = false;
  for (const c of clips) {
    let buf;
    try { buf = await decodeAsset(assets.get(c.assetId)); } catch { continue; }
    if (!buf) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.speed;
    src.connect(ctx.destination);
    src.start(c.start, c.in, c.duration * c.speed);
    any = true;
  }
  if (!any) throw new Error('影片中讀不到聲音軌');
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

const PUNCT = /[，。！？、,.!?；;：:]/;
function splitForSubs(text, start, end, maxChars) {
  const pieces = [];
  let cur = '';
  for (const ch of [...text]) {
    cur += ch;
    if (PUNCT.test(ch) && cur.length >= 4) { pieces.push(cur); cur = ''; }
  }
  if (cur.trim()) pieces.push(cur);
  // 合併太短、拆開太長
  const merged = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && (last + p).replace(PUNCT, '').length <= maxChars * 0.6) merged[merged.length - 1] = last + p;
    else merged.push(p);
  }
  const final = [];
  for (const p of merged) {
    const chars = [...p.trim()];
    // 英文依單字切
    if (/[a-z]/i.test(p) && !/[\u4e00-\u9fff\u3040-\u30ff]/.test(p)) {
      const words = p.trim().split(/\s+/);
      let line = '';
      for (const w of words) {
        if ((line + ' ' + w).trim().length > maxChars * 2.4 && line) { final.push(line); line = w; } else line = (line + ' ' + w).trim();
      }
      if (line) final.push(line);
    } else {
      for (let i = 0; i < chars.length; i += maxChars) final.push(chars.slice(i, i + maxChars).join(''));
    }
  }
  const totalLen = final.reduce((a, p) => a + p.length, 0) || 1;
  let t = start;
  return final.map((p) => {
    const d = ((end - start) * p.length) / totalLen;
    const r = { start: t, end: t + d, text: p };
    t += d;
    return r;
  });
}

async function postProcess(chunks) {
  let conv = (s) => s;
  if (prefs.toTrad && (prefs.language === 'chinese' || !prefs.language)) {
    try { conv = await getConverter(); } catch { toast('繁體轉換元件載入失敗，保留原文'); }
  }
  const out = [];
  for (const c of chunks) {
    const txt = conv(c.text).replace(/\s+/g, (m, i, s) => (/[a-z0-9]/i.test(s[i - 1] || '') && /[a-z0-9]/i.test(s[i + m.length] || '') ? ' ' : ''));
    for (const p of splitForSubs(txt, c.start, c.end, prefs.maxChars)) {
      let text = p.text.trim();
      if (prefs.stripPunct) text = text.replace(/[，。、,；;：:]+$/g, '').replace(/^[，。、,；;]+/, '');
      if (text) out.push({ ...p, text });
    }
  }
  return out;
}

async function runAsr() {
  if (running) return;
  const st = root().querySelector('.asr-status');
  const bar = root().querySelector('.progress > div');
  const btn = root().querySelector('.asr-run');
  const setP = (p, text) => { bar.style.width = Math.round(p * 100) + '%'; if (text) st.textContent = text; };
  if (state.subtitles.length && !confirm('要用辨識結果取代目前所有字幕嗎？\n（按「取消」則保留並加在一起）')) {
    // 保留
  } else state.subtitles = [];
  running = true; btn.disabled = true;
  try {
    setP(0, '正在讀取影片聲音…');
    const audio = await mixSpeechAudio();
    setP(0, '正在下載語音模型（第一次使用需要一點時間，之後會快取）…');
    if (!worker) worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
    const partials = [];
    const chunks = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'load') setP(m.progress, `下載模型中… ${(m.loaded / 1048576).toFixed(1)} / ${(m.total / 1048576).toFixed(1)} MB`);
        else if (m.type === 'status') st.textContent = m.text;
        else if (m.type === 'ready') setP(0, '模型已就緒，開始辨識…');
        else if (m.type === 'progress') setP(m.progress, `辨識中… ${Math.round(m.progress * 100)}%`);
        else if (m.type === 'partial') {
          setP(m.progress, `辨識中… ${Math.round(m.progress * 100)}%`);
          partials.push(postProcess(m.chunks).then((subs) => {
            for (const s of subs) addSub(s.start, s.end, s.text);
            renderList(); emit('change');
          }));
        } else if (m.type === 'done') Promise.all(partials).then(() => resolve(m.chunks));
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || '語音辨識程式發生錯誤'));
      worker.postMessage({ audio, model: prefs.model, language: prefs.language || null, device: prefs.gpu ? 'webgpu' : 'wasm' }, [audio.buffer]);
    });
    sortSubs();
    commit();
    setP(1, `完成！共產生 ${state.subtitles.length} 句字幕，可在下方逐句微調。`);
    toast(chunks.length ? '自動字幕完成' : '沒有辨識到語音');
  } catch (err) {
    console.error(err);
    setP(0, '辨識失敗：' + err.message);
    toast('辨識失敗：' + err.message, 4000);
    if (worker) { worker.terminate(); worker = null; }
  } finally {
    running = false; btn.disabled = false;
    renderList();
  }
}

// ---------- UI ----------
function updatePending() {
  const p = root().querySelector('.pending-info');
  if (p) p.textContent = pending.length ? `文稿剩餘 ${pending.length} 句待打點，下一句：「${pending[0]}」` : '';
}

function openScriptModal() {
  const modal = document.getElementById('modal');
  const card = document.getElementById('modalCard');
  card.innerHTML = `<h3>貼上文稿逐句打點</h3>
    <p style="color:var(--muted);margin:0 0 8px">一行一句。貼上後播放影片，在每句開口時按 <b>M</b>，就會把文稿依序對到時間上。</p>
    <textarea style="width:100%;height:220px" placeholder="第一句台詞&#10;第二句台詞&#10;…">${escapeHtml(pending.join('\n'))}</textarea>
    <div class="actions"><button class="cancel">取消</button><button class="primary ok">開始打點</button></div>`;
  modal.classList.remove('hidden');
  card.querySelector('.cancel').onclick = () => modal.classList.add('hidden');
  card.querySelector('.ok').onclick = () => {
    pending = card.querySelector('textarea').value.split('\n').map((s) => s.trim()).filter(Boolean);
    modal.classList.add('hidden');
    updatePending();
    toast(`已載入 ${pending.length} 句，播放並按 M 打點`);
  };
}

function renderStatic() {
  const r = root();
  r.innerHTML = `
    <div class="asr-box">
      <div class="insp-title"><span>🎙 自動辨識影片語音</span></div>
      <div class="row"><span>語言</span><select class="p-lang">${LANGS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
      <div class="row"><span>模型</span><select class="p-model">${MODELS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
      <div class="row"><span>每句字數</span><input type="number" class="p-max" min="6" max="40"></div>
      <div>
        <label class="inline" style="margin-right:10px"><input type="checkbox" class="p-trad"> 轉繁體</label>
        <label class="inline" style="margin-right:10px"><input type="checkbox" class="p-punct"> 去句尾標點</label>
        <label class="inline"><input type="checkbox" class="p-gpu"> GPU 加速</label>
      </div>
      <button class="primary asr-run" style="width:100%;margin-top:8px">開始自動上字幕</button>
      <div class="progress"><div></div></div>
      <div class="asr-status">在瀏覽器內辨識，影片不會上傳。</div>
    </div>
    <div class="tap-hint">⌨ 打點：播放時按 <b>M</b> 開始新的一句（同時結束上一句），按 <b>N</b> 結束目前這句。
      <div class="pending-info" style="margin-top:4px;color:#fff"></div></div>
    <div class="sub-toolbar">
      <button class="b-tap">📍 打點 (M)</button>
      <button class="b-add">＋ 播放頭新增</button>
      <button class="b-script">📝 貼上文稿</button>
      <button class="b-import">匯入 SRT</button>
      <button class="b-export">匯出 SRT</button>
      <button class="b-clear danger">清空</button>
      <input type="file" class="f-srt" accept=".srt,.vtt,text/plain" hidden>
    </div>
    <details class="sub-style" style="margin-bottom:10px">
      <summary style="cursor:pointer;color:var(--muted);margin-bottom:6px">🎨 字幕樣式</summary>
      <div class="style-body"></div>
    </details>
    <div class="sub-list"></div>`;
  const q = (s) => r.querySelector(s);
  q('.p-lang').value = prefs.language; q('.p-lang').onchange = (e) => { prefs.language = e.target.value; };
  q('.p-model').value = prefs.model; q('.p-model').onchange = (e) => { prefs.model = e.target.value; };
  q('.p-max').value = prefs.maxChars; q('.p-max').onchange = (e) => { prefs.maxChars = Math.max(6, +e.target.value || 16); };
  q('.p-trad').checked = prefs.toTrad; q('.p-trad').onchange = (e) => { prefs.toTrad = e.target.checked; };
  q('.p-punct').checked = prefs.stripPunct; q('.p-punct').onchange = (e) => { prefs.stripPunct = e.target.checked; };
  q('.p-gpu').checked = prefs.gpu; q('.p-gpu').disabled = !navigator.gpu; q('.p-gpu').onchange = (e) => { prefs.gpu = e.target.checked; };
  q('.asr-run').onclick = runAsr;
  q('.b-tap').onclick = tap;
  q('.b-add').onclick = () => { const s = addSub(ui.time, ui.time + 2, '新字幕'); ui.selectedSubId = s.id; commit(); renderList(); scrollToItem(s.id, true); };
  q('.b-script').onclick = openScriptModal;
  q('.b-export').onclick = exportSrt;
  q('.b-import').onclick = () => q('.f-srt').click();
  q('.f-srt').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const list = parseSrt(await f.text());
    for (const s of list) addSub(s.start, s.end, s.text);
    commit(); renderList(); toast(`已匯入 ${list.length} 句字幕`);
    e.target.value = '';
  };
  q('.b-clear').onclick = () => { if (state.subtitles.length && confirm('確定清空所有字幕？')) { state.subtitles = []; openSub = null; commit(); renderList(); } };
  renderStyle();
}

function renderStyle() {
  const b = root().querySelector('.style-body');
  const st = state.subStyle;
  b.innerHTML = `
    <div class="row two"><span>字型</span><select class="s-font">${fontOptions().map(([v, n]) => `<option value='${v}'>${n}</option>`).join('')}</select></div>
    <div class="row"><span>字級</span><input type="range" min="16" max="120" class="s-size"><span class="val v-size"></span></div>
    <div class="row"><span>垂直位置</span><input type="range" min="0.05" max="0.97" step="0.01" class="s-y"><span class="val v-y"></span></div>
    <div class="row"><span>描邊粗細</span><input type="range" min="0" max="20" class="s-sw"><span class="val v-sw"></span></div>
    <div class="row two"><span>顏色</span><span style="display:flex;gap:10px;align-items:center">文字 <input type="color" class="s-color"> 描邊 <input type="color" class="s-stroke"></span></div>
    <div class="row two"><span>底色框</span><span style="display:flex;gap:10px;align-items:center"><input type="checkbox" class="s-bg"><input type="color" class="s-bgc"><input type="range" min="0" max="1" step="0.05" class="s-bgo" style="flex:1"></span></div>
    <label class="inline"><input type="checkbox" class="s-bold"> 粗體</label>`;
  const bind = (cls, key, fmt, num = true) => {
    const i = b.querySelector(cls);
    const v = b.querySelector(cls.replace('s-', 'v-'));
    const isCheck = i.type === 'checkbox';
    if (isCheck) i.checked = !!st[key]; else i.value = st[key];
    if (v && fmt) v.textContent = fmt(st[key]);
    i.oninput = () => { st[key] = isCheck ? i.checked : num ? +i.value : i.value; if (v && fmt) v.textContent = fmt(st[key]); };
    i.onchange = () => { i.oninput(); commit(); };
  };
  bind('.s-size', 'size', (x) => x);
  bind('.s-y', 'y', (x) => Math.round(x * 100) + '%');
  bind('.s-sw', 'strokeWidth', (x) => x);
  bind('.s-color', 'color', null, false);
  bind('.s-stroke', 'stroke', null, false);
  bind('.s-bg', 'bg');
  bind('.s-bgc', 'bgColor', null, false);
  bind('.s-bgo', 'bgOpacity');
  bind('.s-bold', 'bold');
  const fs = b.querySelector('.s-font');
  fs.value = st.font; if (fs.selectedIndex < 0) fs.selectedIndex = 0;
  fs.onchange = () => { st.font = fs.value; commit(); };
}

function renderList() {
  const list = root().querySelector('.sub-list');
  if (!list) return;
  list.innerHTML = '';
  itemEls.clear();
  if (!state.subtitles.length) {
    list.innerHTML = '<div style="color:var(--muted);padding:8px 0">還沒有字幕。可用上方「自動上字幕」，或播放影片時按 M 打點。</div>';
    return;
  }
  state.subtitles.forEach((s, idx) => {
    const d = el(`<div class="sub-item ${s.id === ui.selectedSubId ? 'active' : ''}">
      <div class="times">
        <span style="color:var(--muted);width:22px">${idx + 1}</span>
        <input class="t-s" value="${fmtTime(s.start)}" title="開始">
        <button class="set-s" title="設為播放頭時間">⤓</button>
        <span>→</span>
        <input class="t-e" value="${fmtTime(s.end)}" title="結束">
        <button class="set-e" title="設為播放頭時間">⤓</button>
        <span class="spacer"></span>
        <button class="go" title="跳到這句">▶</button>
        <button class="merge" title="與下一句合併">⇣</button>
        <button class="del danger" title="刪除">✕</button>
      </div>
      <textarea rows="1">${escapeHtml(s.text)}</textarea>
    </div>`);
    const q = (c) => d.querySelector(c);
    q('.t-s').onchange = (e) => { s.start = Math.max(0, parseTime(e.target.value)); if (s.end <= s.start) s.end = s.start + 1; sortSubs(); commit(); renderList(); };
    q('.t-e').onchange = (e) => { s.end = Math.max(s.start + 0.1, parseTime(e.target.value)); commit(); renderList(); };
    q('.set-s').onclick = () => { s.start = ui.time; if (s.end <= s.start) s.end = s.start + 2; sortSubs(); commit(); renderList(); };
    q('.set-e').onclick = () => { s.end = Math.max(s.start + 0.1, ui.time); commit(); renderList(); };
    q('.go').onclick = () => { setTime(s.start); ui.selectedSubId = s.id; renderList(); };
    q('.merge').onclick = () => {
      const next = state.subtitles[idx + 1];
      if (!next) return;
      s.text = s.text + (/[a-z]$/i.test(s.text) ? ' ' : '') + next.text; s.end = next.end;
      state.subtitles.splice(idx + 1, 1); commit(); renderList();
    };
    q('.del').onclick = () => { state.subtitles = state.subtitles.filter((x) => x !== s); if (openSub === s) openSub = null; commit(); renderList(); };
    const ta = q('textarea');
    ta.oninput = () => { s.text = ta.value; };
    ta.onchange = () => commit();
    ta.onfocus = () => { ui.selectedSubId = s.id; if (!ui.playing) setTime(s.start + 0.01); };
    d.dataset.id = s.id;
    itemEls.set(s.id, { el: d, s });
    list.appendChild(d);
  });
  highlightActive();
}

function scrollToItem(id, focus = false) {
  const it = itemEls.get(id);
  if (!it) return;
  it.el.scrollIntoView({ block: 'nearest' });
  if (focus) it.el.querySelector('textarea').focus();
}

let lastActive = null;
function highlightActive() {
  const t = ui.time;
  let act = null;
  for (const { el: e, s } of itemEls.values()) {
    const on = t >= s.start && t < s.end;
    e.classList.toggle('active', on || s.id === ui.selectedSubId);
    if (on) act = s.id;
  }
  if (ui.playing && act && act !== lastActive) scrollToItem(act);
  lastActive = act;
}

export function initSubtitles() {
  renderStatic();
  renderList();
  on('change', () => {
    if (root().contains(document.activeElement) && document.activeElement.matches('input,textarea')) return;
    renderList();
    renderStyle();
  });
  on('time', highlightActive);
  on('library', renderStyle);
  on('subtimes', () => {
    for (const { el: e, s } of itemEls.values()) {
      e.querySelector('.t-s').value = fmtTime(s.start);
      e.querySelector('.t-e').value = fmtTime(s.end);
    }
  });
  on('subselect', (id) => {
    document.querySelector('#sideTabs [data-tab=subs]').click();
    renderList();
    scrollToItem(id);
  });
}
