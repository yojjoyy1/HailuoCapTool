// 語音辨識 Worker：在瀏覽器內用 Whisper (transformers.js) 把影片語音轉成帶時間碼的文字
const CDN = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2',
];
let lib = null;
async function loadLib() {
  if (lib) return lib;
  let err;
  for (const url of CDN) {
    try { lib = await import(url); lib.env.allowLocalModels = false; return lib; } catch (e) { err = e; }
  }
  throw new Error('無法下載語音辨識程式庫，請確認網路連線：' + (err?.message || err));
}

let asr = null;
let key = '';
async function getPipeline(model, device) {
  const k = model + '|' + device;
  if (asr && key === k) return asr;
  const { pipeline } = await loadLib();
  const files = {};
  asr = await pipeline('automatic-speech-recognition', model, {
    device,
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    progress_callback: (p) => {
      if (p.status === 'progress' && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        const vals = Object.values(files);
        const loaded = vals.reduce((a, f) => a + f.loaded, 0);
        const total = vals.reduce((a, f) => a + f.total, 0);
        self.postMessage({ type: 'load', progress: total ? loaded / total : 0, loaded, total });
      }
    },
  });
  key = k;
  return asr;
}

const SR = 16000;
function rms(a, s, e) {
  let sum = 0;
  for (let i = s; i < e; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / Math.max(1, e - s));
}

/**
 * 用音量偵測找出有聲音的區段，再組成不超過 ~28 秒的段落。
 * Whisper 遇到開頭的長靜音時，時間碼容易整體偏移，所以每段都從說話處開始送入。
 */
function segment(audio) {
  const F = Math.floor(SR * 0.03);
  const n = Math.floor(audio.length / F);
  const en = new Float32Array(n);
  for (let i = 0; i < n; i++) en[i] = rms(audio, i * F, (i + 1) * F);
  const sorted = Float32Array.from(en).sort();
  const floor = sorted[Math.floor(n * 0.1)] || 0;
  const thr = Math.max(0.006, floor * 3);

  // 有聲區段（合併 < 0.5 秒的間隙）
  const regions = [];
  let s = -1, lastOn = -1;
  const gap = Math.ceil(0.5 / 0.03);
  for (let i = 0; i < n; i++) {
    if (en[i] > thr) {
      if (s < 0) s = i;
      else if (i - lastOn > gap) { regions.push([s, lastOn + 1]); s = i; }
      lastOn = i;
    }
  }
  if (s >= 0) regions.push([s, lastOn + 1]);

  const pad = Math.floor(0.25 / 0.03);
  const maxLen = Math.floor(28 / 0.03);
  const segs = [];
  let cur = null;
  for (let [a, b] of regions) {
    a = Math.max(0, a - pad); b = Math.min(n, b + pad);
    // 單一區段太長時硬切
    while (b - a > maxLen) {
      if (cur) { segs.push(cur); cur = null; }
      segs.push([a, a + maxLen]); a += maxLen;
    }
    if (!cur) cur = [a, b];
    else if (b - cur[0] <= maxLen && a - cur[1] < Math.floor(2 / 0.03)) cur[1] = b;
    else { segs.push(cur); cur = [a, b]; }
  }
  if (cur) segs.push(cur);
  return segs.map(([a, b]) => [a * F, Math.min(audio.length, b * F)]);
}

// Whisper 在靜音/音樂段常見的幻聽句子
const HALLUCINATION = /(amara\.org|字幕由.{0,12}提供|字幕志愿者|請不吝點贊|请不吝点赞|點贊.{0,4}訂閱.{0,4}轉發|点赞.{0,4}订阅.{0,4}转发|明镜与点点|優優獨播劇場|优优独播剧场)/i;

self.onmessage = async (e) => {
  const { audio, model, language, device } = e.data;
  try {
    let dev = device;
    let pipe;
    try { pipe = await getPipeline(model, dev); }
    catch (err) {
      if (dev !== 'webgpu') throw err;
      dev = 'wasm';
      self.postMessage({ type: 'status', text: 'GPU 加速不可用，改用 CPU…' });
      pipe = await getPipeline(model, dev);
    }
    self.postMessage({ type: 'ready' });
    const segs = segment(audio);
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      const [s, en] = segs[i];
      const off = s / SR;
      const slice = audio.subarray(s, en);
      self.postMessage({ type: 'progress', progress: i / segs.length });
      if (slice.length < SR * 0.3) continue;
      const opts = { return_timestamps: true, task: 'transcribe' };
      if (language) opts.language = language;
      let res;
      try { res = await pipe(slice, opts); }
      catch (err) {
        if (dev !== 'webgpu') throw err;
        dev = 'wasm'; pipe = await getPipeline(model, dev);
        res = await pipe(slice, opts);
      }
      const chunks = res.chunks || [{ text: res.text, timestamp: [0, slice.length / SR] }];
      const segChunks = [];
      for (const c of chunks) {
        const text = (c.text || '').trim();
        if (!text || HALLUCINATION.test(text)) continue;
        const st = off + (c.timestamp?.[0] ?? 0);
        let et = off + (c.timestamp?.[1] ?? slice.length / SR);
        if (et <= st) et = st + Math.max(1, text.length * 0.25);
        segChunks.push({ text, start: st, end: Math.min(et, off + slice.length / SR) });
      }
      out.push(...segChunks);
      self.postMessage({ type: 'partial', chunks: segChunks, progress: (i + 1) / segs.length });
    }
    self.postMessage({ type: 'done', chunks: out });
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) });
  }
};
