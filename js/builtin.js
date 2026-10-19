// 預設素材：程式產生的圖片、動態影片、背景音樂、音效，以及文字/特效/濾鏡預設
import { userFonts } from './state.js';

// ================= 濾鏡 =================
export const FILTERS = {
  none: { name: '原色', css: '' },
  bw: { name: '黑白', css: 'grayscale(1)' },
  sepia: { name: '復古', css: 'sepia(0.75) contrast(1.05)' },
  vivid: { name: '鮮豔', css: 'saturate(1.7) contrast(1.08)' },
  contrast: { name: '高對比', css: 'contrast(1.5)' },
  warm: { name: '暖陽', css: 'sepia(0.25) saturate(1.4) hue-rotate(-12deg) brightness(1.05)' },
  cool: { name: '冷調', css: 'saturate(0.9) hue-rotate(12deg) brightness(1.03) contrast(1.05)' },
  soft: { name: '柔焦', css: 'blur(1.5px) brightness(1.1) saturate(1.1)' },
  fade: { name: '淡雅', css: 'contrast(0.85) saturate(0.7) brightness(1.1)' },
  noir: { name: '黑色電影', css: 'grayscale(1) contrast(1.6) brightness(0.9)' },
  dream: { name: '夢幻', css: 'saturate(1.3) hue-rotate(-25deg) brightness(1.1) contrast(0.9)' },
  invert: { name: '負片', css: 'invert(1)' },
};

// ================= 字型 =================
export const FONTS = [
  ['PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif', '黑體'],
  ['"Songti TC", "Noto Serif TC", PMingLiU, serif', '明體'],
  ['"Kaiti TC", "BiauKai", DFKai-SB, serif', '楷體'],
  ['"Yuanti TC", "Arial Rounded MT Bold", sans-serif', '圓體'],
  ['Impact, "Arial Black", sans-serif', 'Impact'],
  ['Georgia, serif', 'Georgia'],
  ['Menlo, Consolas, monospace', '等寬'],
];
/** 內建字型 + 使用者匯入的字型 */
export const fontOptions = () => [...FONTS, ...userFonts.map((f) => [f.css, `${f.name}（匯入）`])];

// ================= 文字特效（動畫） =================
export const TEXT_ANIMS = {
  none: '無',
  fade: '淡入淡出',
  typewriter: '打字機',
  slideUp: '向上滑入',
  slideLeft: '從右滑入',
  zoom: '彈出放大',
  bounce: '逐字彈跳',
  wave: '波浪',
  shake: '抖動',
  blink: '閃爍',
  neon: '霓虹呼吸',
  rainbow: '彩虹',
  glitch: '故障',
  spin: '旋轉進場',
};

// ================= 文字樣式範本 =================
const BASE_FONT = 'PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif';
export const TEXT_PRESETS = [
  { id: 'title', name: '大標題', preview: { color: '#fff', textShadow: '0 0 3px #000' },
    text: { content: '大標題', size: 96, color: '#ffffff', stroke: '#000000', strokeWidth: 8, bold: true, anim: 'zoom' } },
  { id: 'variety', name: '綜藝黃字', preview: { color: '#ffe23a', textShadow: '2px 2px 0 #d02020' },
    text: { content: '笑死我了！', size: 84, color: '#ffe23a', stroke: '#c81e1e', strokeWidth: 10, bold: true, anim: 'bounce' } },
  { id: 'neon', name: '霓虹粉', preview: { color: '#ff5cd6', textShadow: '0 0 8px #ff5cd6' },
    text: { content: 'NEON NIGHT', size: 80, color: '#ffd6f6', stroke: '#ff2fc2', strokeWidth: 3, bold: true, glow: '#ff2fc2', anim: 'neon' } },
  { id: 'card', name: '字卡底色', preview: { color: '#111', background: '#fff', padding: '0 6px' },
    text: { content: '重點整理', size: 56, color: '#111111', stroke: '#000000', strokeWidth: 0, bold: true, bg: true, bgColor: '#ffffff', bgOpacity: 1, anim: 'slideLeft' } },
  { id: 'cinema', name: '電影感', preview: { color: '#f0e6d2', letterSpacing: '3px' },
    text: { content: 'CHAPTER  ONE', size: 60, color: '#f0e6d2', stroke: '#000000', strokeWidth: 0, bold: false, letterSpacing: 12, anim: 'fade' } },
  { id: 'type', name: '打字機', preview: { color: '#7dffb0', fontFamily: 'Menlo, monospace' },
    text: { content: 'Hello World_', size: 56, color: '#7dffb0', stroke: '#000000', strokeWidth: 0, bold: false, font: 'Menlo, Consolas, monospace', anim: 'typewriter' } },
  { id: 'rainbow', name: '彩虹字', preview: { background: 'linear-gradient(90deg,#f55,#fd3,#5f5,#5cf,#c5f)', WebkitBackgroundClip: 'text', color: 'transparent' },
    text: { content: '生日快樂', size: 90, color: '#ffffff', stroke: '#ffffff', strokeWidth: 4, bold: true, anim: 'rainbow' } },
  { id: 'glitch', name: '故障風', preview: { color: '#fff', textShadow: '-2px 0 #f0f, 2px 0 #0ff' },
    text: { content: 'GLITCH', size: 100, color: '#ffffff', stroke: '#000000', strokeWidth: 0, bold: true, anim: 'glitch' } },
  { id: 'lower', name: '人名條', preview: { color: '#fff', background: '#e8344e', padding: '0 6px' },
    text: { content: '王小明｜攝影師', size: 42, color: '#ffffff', stroke: '#000000', strokeWidth: 0, bold: true, bg: true, bgColor: '#e8344e', bgOpacity: 0.95, anim: 'slideLeft' }, y: 0.8, x: 0.3 },
  { id: 'wave', name: '波浪字', preview: { color: '#5cf0ff' },
    text: { content: '夏日海灘', size: 84, color: '#5cf0ff', stroke: '#003a66', strokeWidth: 8, bold: true, anim: 'wave' } },
];
export function defaultTextProps() {
  return {
    content: '輸入文字', font: BASE_FONT, size: 72, color: '#ffffff', stroke: '#000000', strokeWidth: 6,
    bold: true, italic: false, align: 'center', letterSpacing: 0, lineHeight: 1.25,
    bg: false, bgColor: '#000000', bgOpacity: 0.6, glow: '', shadow: true, anim: 'fade',
  };
}

// ================= 畫面特效（特效軌） =================
export const EFFECTS = {
  vignette: { name: '暗角', icon: '◐' },
  grain: { name: '底片顆粒', icon: '░' },
  oldfilm: { name: '老電影', icon: '🎞' },
  snow: { name: '下雪', icon: '❄' },
  hearts: { name: '愛心飄落', icon: '💗' },
  sparkle: { name: '星光閃爍', icon: '✨' },
  flash: { name: '閃白', icon: '⚡' },
  shake: { name: '畫面震動', icon: '〰' },
  rgbsplit: { name: 'RGB 分離', icon: '🌈' },
  lightleak: { name: '漏光', icon: '☀' },
  blur: { name: '全畫面模糊', icon: '◌' },
  bwfx: { name: '全畫面黑白', icon: '◑' },
  letterbox: { name: '電影黑邊', icon: '▭' },
  fadeblack: { name: '淡入淡出黑', icon: '■' },
  zoompulse: { name: '節奏縮放', icon: '⤢' },
  mirror: { name: '鏡像', icon: '⇋' },
};

// ================= 動態影片素材（程式即時繪製） =================
function rand(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }

export const GENS = {
  gradientFlow: {
    name: '漸層流動', duration: 6,
    draw(ctx, w, h, t) {
      const a = t * 0.6;
      const g = ctx.createLinearGradient(w / 2 + Math.cos(a) * w, h / 2 + Math.sin(a) * h, w / 2 - Math.cos(a) * w, h / 2 - Math.sin(a) * h);
      g.addColorStop(0, `hsl(${(t * 40) % 360},80%,55%)`);
      g.addColorStop(0.5, `hsl(${(t * 40 + 120) % 360},80%,50%)`);
      g.addColorStop(1, `hsl(${(t * 40 + 240) % 360},80%,55%)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    },
  },
  countdown: {
    name: '倒數計時', duration: 5,
    draw(ctx, w, h, t, dur) {
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
      const n = Math.max(1, Math.ceil(dur - t));
      const frac = 1 - ((dur - t) % 1 || 1);
      const r = Math.min(w, h) * 0.32;
      ctx.strokeStyle = '#444'; ctx.lineWidth = r * 0.06;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#3fb8ff';
      ctx.beginPath(); ctx.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${r * 1.1}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), w / 2, h / 2 + r * 0.05);
    },
  },
  starfield: {
    name: '星空穿梭', duration: 8,
    draw(ctx, w, h, t) {
      ctx.fillStyle = '#02030a'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const z = (rand(i) + t * 0.25) % 1;
        const ang = rand(i + 99) * Math.PI * 2;
        const d = Math.pow(z, 2.2) * Math.max(w, h) * 0.8;
        const x = w / 2 + Math.cos(ang) * d, y = h / 2 + Math.sin(ang) * d;
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, z * 1.4)})`;
        const s = 0.5 + z * 3;
        ctx.fillRect(x, y, s, s);
      }
    },
  },
  bubbles: {
    name: '彩色泡泡', duration: 8,
    draw(ctx, w, h, t) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a2a6c'); g.addColorStop(1, '#b21f1f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        const r = 10 + rand(i) * 60;
        const x = rand(i + 5) * w + Math.sin(t + i) * 20;
        const y = h + r - ((t * (30 + rand(i + 9) * 60) + rand(i + 3) * h) % (h + r * 2));
        ctx.fillStyle = `hsla(${rand(i + 1) * 360},90%,70%,.35)`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    },
  },
  waves: {
    name: '海浪線條', duration: 8,
    draw(ctx, w, h, t) {
      ctx.fillStyle = '#04263a'; ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 8; k++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = h * (0.3 + k * 0.08) + Math.sin(x * 0.008 + t * (1 + k * 0.2) + k) * 30;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${190 + k * 6},90%,${50 + k * 4}%,.7)`; ctx.lineWidth = 3; ctx.stroke();
      }
    },
  },
  loading: {
    name: '載入轉圈', duration: 4,
    draw(ctx, w, h, t) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      const r = Math.min(w, h) * 0.12;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const on = ((Math.floor(t * 12) - i) % 12 + 12) % 12;
        ctx.fillStyle = `rgba(30,30,30,${1 - on / 12})`;
        ctx.beginPath(); ctx.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, r * 0.13, 0, Math.PI * 2); ctx.fill();
      }
    },
  },
  confetti: {
    name: '彩帶慶祝', duration: 6,
    draw(ctx, w, h, t) {
      ctx.fillStyle = '#1b1035'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) {
        const x = rand(i) * w + Math.sin(t * 2 + i) * 30;
        const y = ((rand(i + 7) * h + t * (80 + rand(i + 2) * 120)) % (h + 40)) - 20;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * 3 + i);
        ctx.fillStyle = `hsl(${rand(i + 4) * 360},90%,60%)`;
        ctx.fillRect(-6, -3, 12, 6); ctx.restore();
      }
    },
  },
};

// ================= 圖片素材（canvas 產生） =================
function canvasToBlob(c) { return new Promise((r) => c.toBlob(r, 'image/png')); }
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

export async function makeBuiltinImages() {
  const out = [];
  const gradients = [
    ['夕陽漸層', ['#ff7e5f', '#feb47b']], ['海洋漸層', ['#2193b0', '#6dd5ed']],
    ['紫夜漸層', ['#41295a', '#2f0743']], ['薄荷漸層', ['#a8ff78', '#78ffd6']],
  ];
  for (const [name, [a, b]] of gradients) {
    const [c, x] = mk(1280, 720);
    const g = x.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, a); g.addColorStop(1, b);
    x.fillStyle = g; x.fillRect(0, 0, 1280, 720);
    out.push({ name, blob: await canvasToBlob(c), category: 'bg' });
  }
  for (const [name, col] of [['純黑', '#000'], ['純白', '#fff']]) {
    const [c, x] = mk(1280, 720); x.fillStyle = col; x.fillRect(0, 0, 1280, 720);
    out.push({ name, blob: await canvasToBlob(c), category: 'bg' });
  }
  for (const [name, em] of [['愛心', '❤️'], ['星星', '⭐'], ['大笑', '😂'], ['讚', '👍'], ['火', '🔥'], ['慶祝', '🎉'], ['驚訝', '😮'], ['皇冠', '👑']]) {
    const [c, x] = mk(400, 400);
    x.font = '320px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(em, 200, 215);
    out.push({ name: `貼圖-${name}`, blob: await canvasToBlob(c), category: 'sticker' });
  }
  { // 對話框
    const [c, x] = mk(600, 360);
    x.fillStyle = '#fff'; x.strokeStyle = '#111'; x.lineWidth = 10;
    x.beginPath(); x.roundRect(20, 20, 560, 250, 60); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(160, 262); x.lineTo(120, 340); x.lineTo(240, 262); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = '#fff'; x.fillRect(150, 255, 100, 12);
    out.push({ name: '貼圖-對話框', blob: await canvasToBlob(c), category: 'sticker' });
  }
  { // 箭頭
    const [c, x] = mk(400, 240);
    x.fillStyle = '#ff3b3b'; x.strokeStyle = '#fff'; x.lineWidth = 12; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(20, 80); x.lineTo(240, 80); x.lineTo(240, 20); x.lineTo(380, 120); x.lineTo(240, 220); x.lineTo(240, 160); x.lineTo(20, 160); x.closePath();
    x.stroke(); x.fill();
    out.push({ name: '貼圖-箭頭', blob: await canvasToBlob(c), category: 'sticker' });
  }
  { // 訂閱按鈕
    const [c, x] = mk(520, 180);
    x.fillStyle = '#e62117'; x.beginPath(); x.roundRect(10, 10, 500, 160, 30); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 72px "PingFang TC","Noto Sans TC",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('🔔 訂閱', 260, 95);
    out.push({ name: '貼圖-訂閱', blob: await canvasToBlob(c), category: 'sticker' });
  }
  return out;
}

// ================= 音樂 / 音效合成 =================
function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  ws(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([data], { type: 'audio/wav' });
}

const SR = 32000;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
function noiseBuf(ctx, dur) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function note(ctx, dest, freq, t, dur, { type = 'triangle', vol = 0.2, attack = 0.01, release = 0.3, detune = 0 } = {}) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.setTargetAtTime(0, t + Math.max(attack, dur - release), release / 3);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + release);
}
function kick(ctx, dest, t, vol = 0.9) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(g).connect(dest); o.start(t); o.stop(t + 0.35);
}
function hat(ctx, dest, t, nb, vol = 0.15, len = 0.05) {
  const s = ctx.createBufferSource(); s.buffer = nb;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + len + 0.02);
}
function snare(ctx, dest, t, nb, vol = 0.35) {
  const s = ctx.createBufferSource(); s.buffer = nb;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + 0.2);
}

const SONGS = {
  upbeat: {
    name: '輕快陽光', bpm: 118, bars: 8,
    build(ctx, out, nb, beat) {
      const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];
      const mel = [72, 74, 76, 79, 76, 74, 72, 67, 69, 72, 74, 72, 71, 67, 69, 71];
      for (let bar = 0; bar < 8; bar++) {
        const ch = chords[bar % 4]; const t0 = bar * 4 * beat;
        for (let b = 0; b < 4; b++) {
          kick(ctx, out, t0 + b * beat, b % 2 ? 0.5 : 0.8);
          if (b % 2) snare(ctx, out, t0 + b * beat, nb);
          hat(ctx, out, t0 + b * beat + beat / 2, nb);
          for (const n of ch) note(ctx, out, midi(n), t0 + b * beat, beat * 0.45, { type: 'square', vol: 0.025, release: 0.08 });
        }
        note(ctx, out, midi(ch[0] - 24), t0, beat * 2, { type: 'sawtooth', vol: 0.06 });
        note(ctx, out, midi(ch[0] - 24), t0 + 2 * beat, beat * 2, { type: 'sawtooth', vol: 0.06 });
        if (bar >= 2) for (let i = 0; i < 4; i++) note(ctx, out, midi(mel[(bar * 4 + i) % 16]), t0 + i * beat, beat * 0.9, { type: 'triangle', vol: 0.09 });
      }
    },
  },
  piano: {
    name: '抒情鋼琴', bpm: 72, bars: 8,
    build(ctx, out, nb, beat) {
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      for (let bar = 0; bar < 8; bar++) {
        const ch = chords[bar % 4]; const t0 = bar * 4 * beat;
        note(ctx, out, midi(ch[0] - 12), t0, beat * 4, { type: 'sine', vol: 0.14, release: 1.2 });
        const arp = [ch[0], ch[1], ch[2], ch[1] + 12, ch[2], ch[1], ch[0] + 12, ch[2]];
        arp.forEach((n, i) => note(ctx, out, midi(n), t0 + i * beat / 2, beat * 1.5, { type: 'triangle', vol: 0.07, attack: 0.005, release: 1 }));
        if (bar % 2) note(ctx, out, midi(ch[2] + 12), t0 + beat, beat * 2.5, { type: 'sine', vol: 0.06, release: 1.5 });
      }
    },
  },
  lofi: {
    name: 'Lo-fi 放鬆', bpm: 80, bars: 8,
    build(ctx, out, nb, beat) {
      const chords = [[62, 65, 69, 72], [55, 59, 62, 65], [60, 64, 67, 71], [57, 60, 64, 67]];
      for (let bar = 0; bar < 8; bar++) {
        const ch = chords[bar % 4]; const t0 = bar * 4 * beat;
        kick(ctx, out, t0, 0.7); kick(ctx, out, t0 + 2.5 * beat, 0.5);
        snare(ctx, out, t0 + beat, nb, 0.2); snare(ctx, out, t0 + 3 * beat, nb, 0.2);
        for (let i = 0; i < 8; i++) hat(ctx, out, t0 + i * beat / 2 + (i % 2 ? 0.04 : 0), nb, 0.06);
        for (const n of ch) note(ctx, out, midi(n), t0, beat * 3.6, { type: 'sine', vol: 0.045, attack: 0.08, release: 0.6, detune: Math.random() * 14 - 7 });
        note(ctx, out, midi(ch[0] - 24), t0, beat * 3, { type: 'sine', vol: 0.16 });
      }
    },
  },
  edm: {
    name: '電子動感', bpm: 128, bars: 8,
    build(ctx, out, nb, beat) {
      const roots = [57, 53, 60, 55];
      for (let bar = 0; bar < 8; bar++) {
        const r = roots[bar % 4]; const t0 = bar * 4 * beat;
        for (let b = 0; b < 4; b++) { kick(ctx, out, t0 + b * beat); hat(ctx, out, t0 + b * beat + beat / 2, nb, 0.18, 0.08); if (b % 2) snare(ctx, out, t0 + b * beat, nb, 0.3); }
        for (let i = 0; i < 8; i++) note(ctx, out, midi(r - 12), t0 + i * beat / 2 + beat / 4, beat / 4, { type: 'sawtooth', vol: 0.07, release: 0.05 });
        for (let i = 0; i < 16; i++) {
          const n = r + [12, 15, 19, 24][i % 4];
          note(ctx, out, midi(n), t0 + i * beat / 4, beat / 4, { type: 'square', vol: 0.025, release: 0.04 });
        }
      }
    },
  },
};

const SFX = {
  ding: { name: '叮！', dur: 1.2, build(ctx, out) { note(ctx, out, 1568, 0, 0.1, { type: 'sine', vol: 0.4, release: 1 }); note(ctx, out, 2093, 0.08, 0.1, { type: 'sine', vol: 0.25, release: 1 }); } },
  whoosh: { name: '咻～轉場', dur: 1, build(ctx, out) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx, 1);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(5000, 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.8, 0.35); g.gain.linearRampToValueAtTime(0, 0.9);
    s.connect(f).connect(g).connect(out); s.start(0);
  } },
  pop: { name: '啵', dur: 0.4, build(ctx, out) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(400, 0); o.frequency.exponentialRampToValueAtTime(1200, 0.06);
    g.gain.setValueAtTime(0.5, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.15); o.connect(g).connect(out); o.start(0); o.stop(0.2);
  } },
  boing: { name: '彈簧', dur: 0.8, build(ctx, out) {
    const o = ctx.createOscillator(); const g = ctx.createGain(); const lfo = ctx.createOscillator(); const lg = ctx.createGain();
    o.frequency.value = 300; lfo.frequency.value = 18; lg.gain.value = 120; lfo.connect(lg).connect(o.frequency);
    o.frequency.setValueAtTime(200, 0); o.frequency.linearRampToValueAtTime(500, 0.6);
    g.gain.setValueAtTime(0.35, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.7);
    o.connect(g).connect(out); o.start(0); lfo.start(0); o.stop(0.75); lfo.stop(0.75);
  } },
  drum: { name: '咚咚鏘', dur: 1.5, build(ctx, out) {
    kick(ctx, out, 0); kick(ctx, out, 0.25); const nb = noiseBuf(ctx, 1);
    const s = ctx.createBufferSource(); s.buffer = nb; const g = ctx.createGain(); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
    g.gain.setValueAtTime(0.6, 0.5); g.gain.exponentialRampToValueAtTime(0.001, 1.4); s.connect(f).connect(g).connect(out); s.start(0.5);
  } },
  fail: { name: '失敗音', dur: 1.8, build(ctx, out) {
    [392, 370, 349, 330].forEach((f, i) => note(ctx, out, f, i * 0.35, i === 3 ? 0.9 : 0.3, { type: 'sawtooth', vol: 0.08, release: 0.2 }));
  } },
  applause: { name: '掌聲', dur: 3, build(ctx, out) {
    const nb = noiseBuf(ctx, 0.05);
    for (let i = 0; i < 260; i++) {
      const t = Math.random() * 2.6; const s = ctx.createBufferSource(); s.buffer = nb;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1000 + Math.random() * 2500;
      const g = ctx.createGain(); const env = Math.min(1, t * 3) * Math.min(1, (2.9 - t) * 2);
      g.gain.setValueAtTime(0.35 * env, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      s.connect(f).connect(g).connect(out); s.start(t);
    }
  } },
};

async function renderAudio(dur, build) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
  const comp = ctx.createDynamicsCompressor();
  const master = ctx.createGain(); master.gain.value = 0.9;
  master.connect(comp).connect(ctx.destination);
  build(ctx, master);
  const buf = await ctx.startRendering();
  return encodeWav(buf);
}

export async function makeBuiltinAudio() {
  const out = [];
  for (const [id, s] of Object.entries(SONGS)) {
    const beat = 60 / s.bpm;
    const dur = s.bars * 4 * beat + 1.5;
    const nb = null;
    const blob = await renderAudio(dur, (ctx, master) => s.build(ctx, master, nb || noiseBuf(ctx, 2), beat));
    out.push({ id, name: s.name, blob, category: 'music' });
  }
  for (const [id, s] of Object.entries(SFX)) {
    out.push({ id, name: s.name, blob: await renderAudio(s.dur, s.build), category: 'sfx' });
  }
  return out;
}
