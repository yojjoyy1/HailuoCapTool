// 螢幕 / 視窗錄影：選擇來源 → 調整截取範圍 → 錄製 → 加入素材庫
import { ui, toast, fmtTime } from './state.js';
import { addFileAsset, placeClip } from './library.js';

const TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4',
];
const RATIOS = [
  ['free', '自由調整'], ['full', '全畫面'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:3', '4:3'],
];
const SIZES = [['0', '原始解析度'], ['1080', '最高 1080p'], ['720', '最高 720p']];
const MIN = 32;

const opts = { sysAudio: true, mic: false, cursor: true, fps: 30, countdown: true, autoPlace: true, ratio: 'free', size: '1080' };
let session = null;

const $m = () => document.getElementById('modal');
const $card = () => document.getElementById('modalCard');
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export function openRecorder() {
  if (session?.rec) { toast('正在錄影中'); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) { toast('此瀏覽器不支援螢幕錄影，請使用 Chrome、Edge 或 Firefox'); return; }
  if (!window.MediaRecorder || !TYPES.some((t) => MediaRecorder.isTypeSupported(t))) { toast('此瀏覽器不支援錄影編碼'); return; }
  showSetup();
}

function closeModal() {
  $m().classList.add('hidden');
  $card().classList.remove('wide');
}

function cleanup() {
  if (!session) return;
  session.stopped = true;
  session.abort?.abort();
  clearInterval(session.timer);
  session.ticker?.terminate();
  [session.display, session.micStream, session.outStream].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
  session.ac?.close().catch(() => {});
  session.preview?.remove();
  document.getElementById('recBar')?.remove();
  session = null;
}

// ---------- 第一步：選擇來源 ----------
function showSetup() {
  const card = $card();
  card.classList.remove('wide');
  card.innerHTML = `<h3>🎥 錄製畫面</h3>
    <p class="rec-tip">選擇要錄製的來源，瀏覽器會跳出視窗讓你挑選。</p>
    <div class="rec-sources">
      <button data-s="monitor"><b>🖥</b>整個螢幕</button>
      <button data-s="window"><b>🪟</b>應用程式視窗</button>
      <button data-s="browser"><b>🌐</b>瀏覽器分頁</button>
    </div>
    <label class="rec-opt"><input type="checkbox" class="o-sys" ${opts.sysAudio ? 'checked' : ''}> 錄製系統 / 分頁聲音</label>
    <label class="rec-opt"><input type="checkbox" class="o-mic" ${opts.mic ? 'checked' : ''}> 同時錄製麥克風</label>
    <label class="rec-opt"><input type="checkbox" class="o-cur" ${opts.cursor ? 'checked' : ''}> 顯示滑鼠游標</label>
    <label class="rec-opt"><input type="checkbox" class="o-cd" ${opts.countdown ? 'checked' : ''}> 開始前倒數 3 秒</label>
    <label class="rec-opt"><input type="checkbox" class="o-place" ${opts.autoPlace ? 'checked' : ''}> 錄完自動放到時間軸播放頭位置</label>
    <div class="row two"><span>影格率</span><select class="o-fps"><option value="30">30 fps</option><option value="60">60 fps</option></select></div>
    <p class="rec-tip">Mac 上「系統聲音」只能錄到瀏覽器分頁的聲音；整個螢幕或視窗的聲音請改用麥克風。</p>
    <div class="actions"><button class="cancel">取消</button></div>`;
  const q = (s) => card.querySelector(s);
  q('.o-fps').value = String(opts.fps);
  const read = () => Object.assign(opts, {
    sysAudio: q('.o-sys').checked, mic: q('.o-mic').checked, cursor: q('.o-cur').checked,
    countdown: q('.o-cd').checked, autoPlace: q('.o-place').checked, fps: +q('.o-fps').value,
  });
  card.querySelectorAll('.rec-sources button').forEach((b) => { b.onclick = () => { read(); pickSource(b.dataset.s); }; });
  q('.cancel').onclick = () => { cleanup(); closeModal(); };
  $m().classList.remove('hidden');
}

async function pickSource(surface) {
  cleanup();
  let display;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: surface, frameRate: { ideal: opts.fps }, cursor: opts.cursor ? 'always' : 'never' },
      audio: opts.sysAudio ? { suppressLocalAudioPlayback: false } : false,
      systemAudio: opts.sysAudio ? 'include' : 'exclude',
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
    });
  } catch (err) {
    if (err.name !== 'NotAllowedError') toast('無法開始擷取畫面：' + err.message);
    return;
  }
  const preview = document.createElement('video');
  preview.muted = true; preview.playsInline = true; preview.autoplay = true;
  preview.srcObject = display;
  session = { display, preview, rect: { x: 0, y: 0, w: 1, h: 1 } };
  const vTrack = display.getVideoTracks()[0];
  vTrack.addEventListener('ended', () => {
    if (session?.rec) stopRecording();
    else if (session?.display === display) { cleanup(); showSetup(); }
  });
  await new Promise((r) => { if (preview.videoWidth) r(); else preview.onloadedmetadata = () => r(); });
  preview.play().catch(() => {});
  showCrop();
}

// ---------- 第二步：調整截取範圍 ----------
function srcSize() {
  const v = session.preview;
  return { W: v.videoWidth || 1280, H: v.videoHeight || 720 };
}

function outSize() {
  const { W, H } = srcSize();
  const r = session.rect;
  let w = r.w * W, h = r.h * H;
  const cap = +opts.size;
  if (cap) { const k = Math.min(1, cap / Math.min(w, h), (cap * 16 / 9) / Math.max(w, h)); w *= k; h *= k; }
  return { w: even(w), h: even(h) };
}

function ratioValue() {
  if (!opts.ratio.includes(':')) return null;
  const [a, b] = opts.ratio.split(':').map(Number);
  return a / b;
}

/** 依比例在目前範圍內取最大置中矩形（以實際像素計算比例） */
function applyRatio() {
  const r = session.rect;
  if (opts.ratio === 'full') { Object.assign(r, { x: 0, y: 0, w: 1, h: 1 }); return; }
  const k = ratioValue();
  if (!k) return;
  const { W, H } = srcSize();
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let pw = r.w * W, ph = r.h * H;
  if (pw / ph > k) pw = ph * k; else ph = pw / k;
  if (pw < MIN * 4) { pw = Math.min(W, H * k) * 0.8; ph = pw / k; }
  r.w = pw / W; r.h = ph / H;
  r.x = Math.min(Math.max(0, cx - r.w / 2), 1 - r.w);
  r.y = Math.min(Math.max(0, cy - r.h / 2), 1 - r.h);
}

function showCrop() {
  const card = $card();
  card.classList.add('wide');
  const { W, H } = srcSize();
  card.innerHTML = `<h3>🎥 調整截取範圍</h3>
    <div class="rec-stage" style="aspect-ratio:${W}/${H};--ar:${W / H}">
      <div class="rec-video"></div>
      <div class="rec-crop"><span class="rec-size"></span>
        ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => `<i data-d="${d}"></i>`).join('')}
      </div>
    </div>
    <div class="rec-controls">
      <label>比例 <select class="c-ratio">${RATIOS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
      <label>X <input type="number" class="c-x" min="0"></label>
      <label>Y <input type="number" class="c-y" min="0"></label>
      <label>寬 <input type="number" class="c-w" min="${MIN}"></label>
      <label>高 <input type="number" class="c-h" min="${MIN}"></label>
      <label>輸出 <select class="c-size">${SIZES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
    </div>
    <p class="rec-tip">拖曳框框移動位置、拖曳邊角調整大小。來源畫面 ${W}×${H}，輸出 <b class="c-out"></b>。</p>
    <div class="actions">
      <button class="again">重新選擇來源</button><span class="spacer"></span>
      <button class="cancel">取消</button><button class="primary go">● 開始錄製</button>
    </div>`;
  const q = (s) => card.querySelector(s);
  q('.rec-video').appendChild(session.preview);
  q('.c-ratio').value = opts.ratio;
  q('.c-size').value = opts.size;
  const stage = q('.rec-stage');
  const crop = q('.rec-crop');

  const sync = () => {
    const r = session.rect;
    const { W: w0, H: h0 } = srcSize();
    Object.assign(crop.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
    const px = { x: Math.round(r.x * w0), y: Math.round(r.y * h0), w: Math.round(r.w * w0), h: Math.round(r.h * h0) };
    for (const k of ['x', 'y', 'w', 'h']) if (document.activeElement !== q('.c-' + k)) q('.c-' + k).value = px[k];
    q('.rec-size').textContent = `${px.w} × ${px.h}`;
    const o = outSize();
    q('.c-out').textContent = `${o.w}×${o.h}`;
  };
  sync();

  crop.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const dir = e.target.dataset.d || 'move';
    const box = stage.getBoundingClientRect();
    const start = { ...session.rect };
    const k = ratioValue();
    const { W: w0, H: h0 } = srcSize();
    const minW = MIN / w0, minH = MIN / h0;
    crop.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = (ev.clientX - e.clientX) / box.width, dy = (ev.clientY - e.clientY) / box.height;
      const r = session.rect;
      if (dir === 'move') {
        r.x = Math.min(Math.max(0, start.x + dx), 1 - start.w);
        r.y = Math.min(Math.max(0, start.y + dy), 1 - start.h);
      } else {
        let l = start.x, t = start.y, rt = start.x + start.w, b = start.y + start.h;
        if (dir.includes('w')) l = Math.min(Math.max(0, l + dx), rt - minW);
        if (dir.includes('e')) rt = Math.max(Math.min(1, rt + dx), l + minW);
        if (dir.includes('n')) t = Math.min(Math.max(0, t + dy), b - minH);
        if (dir.includes('s')) b = Math.max(Math.min(1, b + dy), t + minH);
        if (k) {
          // 鎖定比例：以拖曳的對邊（或中心）為錨點，寬高依比例互推並限制在畫面內
          const vertical = dir === 'n' || dir === 's';
          let pw = (rt - l) * w0, ph = (b - t) * h0;
          if (vertical) pw = ph * k; else ph = pw / k;
          const cx = start.x + start.w / 2, cy = start.y + start.h / 2;
          const availW = dir.includes('w') ? start.x + start.w : dir.includes('e') ? 1 - start.x : 2 * Math.min(cx, 1 - cx);
          const availH = dir.includes('n') ? start.y + start.h : dir.includes('s') ? 1 - start.y : 2 * Math.min(cy, 1 - cy);
          const s = Math.min(availW * w0 / pw, availH * h0 / ph, 1);
          pw = Math.max(MIN, pw * s); ph = Math.max(MIN, ph * s);
          const wn = pw / w0, hn = ph / h0;
          l = dir.includes('w') ? start.x + start.w - wn : dir.includes('e') ? start.x : cx - wn / 2;
          t = dir.includes('n') ? start.y + start.h - hn : dir.includes('s') ? start.y : cy - hn / 2;
          rt = l + wn; b = t + hn;
        }
        Object.assign(r, { x: l, y: t, w: rt - l, h: b - t });
      }
      sync();
    };
    const up = () => { crop.removeEventListener('pointermove', move); crop.removeEventListener('pointerup', up); };
    crop.addEventListener('pointermove', move);
    crop.addEventListener('pointerup', up);
  });

  q('.c-ratio').onchange = (e) => { opts.ratio = e.target.value; applyRatio(); sync(); };
  q('.c-size').onchange = (e) => { opts.size = e.target.value; sync(); };
  for (const key of ['x', 'y', 'w', 'h']) {
    q('.c-' + key).onchange = () => {
      const { W: w0, H: h0 } = srcSize();
      const r = session.rect;
      const v = Math.max(0, +q('.c-' + key).value || 0);
      if (key === 'w') { r.w = Math.min(Math.max(MIN, v), w0) / w0; r.x = Math.min(r.x, 1 - r.w); }
      if (key === 'h') { r.h = Math.min(Math.max(MIN, v), h0) / h0; r.y = Math.min(r.y, 1 - r.h); }
      if (key === 'x') r.x = Math.min(v / w0, 1 - r.w);
      if (key === 'y') r.y = Math.min(v / h0, 1 - r.h);
      if (ratioValue() && (key === 'w' || key === 'h')) {
        const k = ratioValue();
        if (key === 'w') r.h = Math.min(1, (r.w * w0) / k / h0); else r.w = Math.min(1, (r.h * h0 * k) / w0);
        r.x = Math.min(r.x, 1 - r.w); r.y = Math.min(r.y, 1 - r.h);
      }
      sync();
    };
  }
  // 視窗大小改變時（例如錄製的視窗被縮放）更新比例
  session.preview.onresize = () => {
    const s = srcSize();
    stage.style.aspectRatio = `${s.W}/${s.H}`;
    stage.style.setProperty('--ar', s.W / s.H);
    sync();
  };
  q('.again').onclick = () => { cleanup(); showSetup(); };
  q('.cancel').onclick = () => { cleanup(); closeModal(); };
  q('.go').onclick = () => startRecording();
}

// ---------- 錄製 ----------
/** 每一格依截取範圍裁切並縮放。Chromium 用 MediaStreamTrackProcessor，背景分頁也不會降速 */
function buildVideoTrack(out) {
  const src = session.display.getVideoTracks()[0];
  const cropOf = (W, H) => {
    const r = session.rect;
    return [r.x * W, r.y * H, r.w * W, r.h * H];
  };
  if (window.MediaStreamTrackProcessor && window.MediaStreamTrackGenerator && window.OffscreenCanvas) {
    const proc = new MediaStreamTrackProcessor({ track: src.clone() });
    const gen = new MediaStreamTrackGenerator({ kind: 'video' });
    const oc = new OffscreenCanvas(out.w, out.h);
    const ox = oc.getContext('2d');
    session.abort = new AbortController();
    proc.readable.pipeThrough(new TransformStream({
      transform(frame, ctl) {
        try {
          ox.drawImage(frame, ...cropOf(frame.displayWidth, frame.displayHeight), 0, 0, out.w, out.h);
          ctl.enqueue(new VideoFrame(oc, { timestamp: frame.timestamp }));
        } finally { frame.close(); }
      },
    }), { signal: session.abort.signal }).pipeTo(gen.writable, { signal: session.abort.signal }).catch(() => {});
    return new MediaStream([gen]);
  }
  // 其他瀏覽器：用畫布繪製，並以 Worker 計時避免背景分頁被節流
  const c = document.createElement('canvas');
  c.width = out.w; c.height = out.h;
  const x = c.getContext('2d');
  const v = session.preview;
  const worker = new Worker(URL.createObjectURL(new Blob(
    ['let id;onmessage=(e)=>{clearInterval(id);if(e.data)id=setInterval(()=>postMessage(0),e.data)}'], { type: 'text/javascript' })));
  worker.onmessage = () => { if (v.videoWidth) x.drawImage(v, ...cropOf(v.videoWidth, v.videoHeight), 0, 0, out.w, out.h); };
  worker.postMessage(1000 / opts.fps);
  session.ticker = worker;
  return c.captureStream(opts.fps);
}

async function buildAudioTrack() {
  const tracks = [...session.display.getAudioTracks()];
  if (opts.mic) {
    try {
      session.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      tracks.push(...session.micStream.getAudioTracks());
    } catch { toast('無法使用麥克風，將只錄製畫面聲音'); }
  }
  if (tracks.length <= 1) return tracks[0] || null;
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  for (const t of tracks) ac.createMediaStreamSource(new MediaStream([t])).connect(dest);
  session.ac = ac;
  return dest.stream.getAudioTracks()[0];
}

function recBar() {
  const bar = document.createElement('div');
  bar.id = 'recBar';
  bar.className = 'rec-bar';
  bar.innerHTML = `<span class="dot"></span><span class="t">準備中</span>
    <button class="pause" title="暫停 / 繼續">⏸</button>
    <button class="stop primary" title="停止並加入素材">■ 停止</button>
    <button class="discard danger" title="放棄這段錄影">✕</button>`;
  document.body.appendChild(bar);
  return bar;
}

async function startRecording() {
  const out = outSize();
  closeModal();
  const s = session;
  const bar = recBar();
  const q = (sel) => bar.querySelector(sel);
  q('.pause').disabled = q('.stop').disabled = true;
  q('.discard').onclick = () => { s.discarded = true; s.rec ? s.rec.stop() : cleanup(); toast('已放棄錄影'); };

  if (opts.countdown) {
    for (let i = 3; i > 0 && !s.stopped; i--) {
      q('.t').textContent = `${i} 秒後開始`;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (s.stopped || session !== s) return;

  const stream = buildVideoTrack(out);
  const audio = await buildAudioTrack();
  if (audio) stream.addTrack(audio);
  s.outStream = stream;
  const mime = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const bitrate = Math.min(20e6, Math.max(3e6, out.w * out.h * opts.fps * 0.12));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => finish(s, chunks, mime);
  s.rec = rec;
  rec.start(1000);

  let elapsed = 0, last = performance.now();
  bar.classList.add('live');
  q('.pause').disabled = q('.stop').disabled = false;
  s.timer = setInterval(() => {
    const now = performance.now();
    if (rec.state === 'recording') elapsed += now - last;
    last = now;
    q('.t').textContent = (rec.state === 'paused' ? '已暫停 ' : '') + fmtTime(elapsed / 1000, false);
  }, 200);
  q('.pause').onclick = () => {
    if (rec.state === 'recording') { rec.pause(); q('.pause').textContent = '▶'; bar.classList.remove('live'); }
    else if (rec.state === 'paused') { rec.resume(); q('.pause').textContent = '⏸'; bar.classList.add('live'); }
  };
  q('.stop').onclick = stopRecording;
}

function stopRecording() {
  const rec = session?.rec;
  if (rec && rec.state !== 'inactive') rec.stop();
}

async function finish(s, chunks, mime) {
  const discarded = s.discarded;
  if (session === s) cleanup();
  if (discarded || !chunks.length) return;
  const type = mime.split(';')[0];
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `螢幕錄影 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.${ext}`;
  toast('錄影處理中…');
  try {
    const a = await addFileAsset(new File(chunks, name, { type }));
    document.querySelector('#libTabs [data-tab=media]')?.click();
    if (opts.autoPlace) { placeClip({ kind: 'asset', id: a.id }, null, ui.time); toast('錄影完成，已加入素材並放到時間軸'); }
    else toast('錄影完成，已加入素材庫');
  } catch (err) {
    toast('錄影儲存失敗：' + err.message);
  }
}
