// 畫面合成：主影片 → 疊加畫面 → 畫面特效 → 文字 → 字幕
import { state, assets, luts, clipEnd } from './state.js';
import { FILTERS, GENS } from './builtin.js';
import { applyLut } from './lut.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
const easeOutBounce = (x) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const rnd = (s) => { const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const hexA = (hex, a) => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(n, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};

const pool = new Map();
function buf(name, w, h) {
  let c = pool.get(name);
  if (!c) { c = document.createElement('canvas'); pool.set(name, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

let noiseTiles = null;
function getNoise() {
  if (noiseTiles) return noiseTiles;
  noiseTiles = [];
  for (let k = 0; k < 4; k++) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'); const id = x.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    x.putImageData(id, 0, 0); noiseTiles.push(c);
  }
  return noiseTiles;
}

export function clipFilterCss(c) {
  const f = FILTERS[c.filter]?.css || '';
  const a = c.adjust || {};
  const adj = [];
  if (a.brightness != null && a.brightness !== 1) adj.push(`brightness(${a.brightness})`);
  if (a.contrast != null && a.contrast !== 1) adj.push(`contrast(${a.contrast})`);
  if (a.saturate != null && a.saturate !== 1) adj.push(`saturate(${a.saturate})`);
  return [f, ...adj].filter(Boolean).join(' ') || 'none';
}

function fadeAlpha(c, lt) {
  let a = 1;
  if (c.fadeIn > 0) a *= clamp(lt / c.fadeIn);
  if (c.fadeOut > 0) a *= clamp((c.duration - lt) / c.fadeOut);
  return a;
}

const active = (c, t) => t >= c.start && t < clipEnd(c);

/**
 * @param media { getVideo(clip) -> HTMLVideoElement|null }
 * @param hitBoxes 收集畫面上可點選物件的範圍
 */
export function renderFrame(out, t, media, hitBoxes = []) {
  const W = state.width, H = state.height;
  hitBoxes.length = 0;
  let cur = buf('a', W, H);
  let spare = buf('b', W, H);
  const cx = cur.getContext('2d');
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalAlpha = 1; cx.filter = 'none'; cx.globalCompositeOperation = 'source-over';
  cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);

  const tracksOf = (kind) => state.tracks.filter((x) => x.kind === kind);
  const clipsActive = (trackIds) => state.clips.filter((c) => trackIds.includes(c.trackId) && active(c, t));

  // 1. 主影片 + 疊加（列表下方的軌道先畫）
  const visualTracks = [...tracksOf('main'), ...tracksOf('overlay').reverse()];
  for (const tr of visualTracks) {
    for (const c of clipsActive([tr.id])) drawVisual(cx, c, t - c.start, media, hitBoxes, W, H);
  }

  // 2. 畫面特效
  for (const tr of tracksOf('fx').reverse()) {
    for (const c of clipsActive([tr.id])) {
      const res = applyEffect(cur, spare, c, t - c.start, W, H);
      if (res === spare) { [cur, spare] = [spare, cur]; }
    }
  }

  const o = out.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalAlpha = 1; o.filter = 'none'; o.globalCompositeOperation = 'source-over';
  o.drawImage(cur, 0, 0);

  // 3. 文字
  for (const tr of tracksOf('text').reverse()) {
    for (const c of clipsActive([tr.id])) drawText(o, c, t - c.start, W, H, hitBoxes);
  }

  // 4. 字幕
  for (const s of state.subtitles) if (t >= s.start && t < s.end) drawSubtitle(o, s, W, H);
}

// ---------- 影像片段 ----------
function drawVisual(ctx, c, lt, media, hitBoxes, W, H) {
  const a = assets.get(c.assetId);
  if (!a) return;
  let src = null, sw = 0, sh = 0;
  if (a.type === 'video') {
    const v = media.getVideo(c);
    if (!v || v.readyState < 2) return;
    src = v; sw = v.videoWidth; sh = v.videoHeight;
  } else if (a.type === 'image' && a.frames) {
    const t = (lt * c.speed + c.in) % a.animDuration;
    const f = a.frames.find((x) => t < x.start + x.dur) || a.frames[a.frames.length - 1];
    src = f.bmp; sw = f.bmp.width; sh = f.bmp.height;
  } else if (a.type === 'image') {
    if (!a.img?.complete) return;
    src = a.img; sw = a.img.naturalWidth; sh = a.img.naturalHeight;
  } else if (a.type === 'gen') {
    const g = buf('gen', W, H);
    const gx = g.getContext('2d');
    gx.setTransform(1, 0, 0, 1, 0, 0);
    GENS[a.genId].draw(gx, W, H, lt * c.speed + c.in, c.duration);
    src = g; sw = W; sh = H;
  }
  if (!src || !sw || !sh) return;
  const lut = c.lut && luts.get(c.lut);
  if (lut && c.lutAmount > 0) src = applyLut(src, sw, sh, c.lut, lut, c.lutAmount);
  const tf = c.transform;
  const fit = Math.min(W / sw, H / sh);
  const dw = sw * fit * tf.scale, dh = sh * fit * tf.scale;
  const px = tf.x * W, py = tf.y * H;
  ctx.save();
  ctx.globalAlpha = clamp(tf.opacity * fadeAlpha(c, lt));
  ctx.filter = clipFilterCss(c);
  ctx.globalCompositeOperation = c.blend || 'source-over';
  ctx.translate(px, py);
  ctx.rotate((tf.rotation * Math.PI) / 180);
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  hitBoxes.push({ id: c.id, x: px - dw / 2, y: py - dh / 2, w: dw, h: dh });
}

// ---------- 畫面特效 ----------
function applyEffect(cur, spare, c, lt, W, H) {
  const k = c.effect?.intensity ?? 1;
  const type = c.effect?.type;
  const cx = cur.getContext('2d');
  const sx = spare.getContext('2d');
  const unit = Math.min(W, H) / 720;
  const transform = (fn) => {
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.globalAlpha = 1; sx.filter = 'none'; sx.globalCompositeOperation = 'source-over';
    sx.fillStyle = '#000'; sx.fillRect(0, 0, W, H);
    sx.save(); fn(sx); sx.restore();
    return spare;
  };
  cx.save();
  try {
    switch (type) {
      case 'vignette': {
        const g = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.85 * k})`);
        cx.fillStyle = g; cx.fillRect(0, 0, W, H); break;
      }
      case 'grain': drawGrain(cx, W, H, lt, 0.18 * k); break;
      case 'oldfilm': {
        const r = transform((x) => { x.filter = `sepia(0.8) contrast(1.1) brightness(${0.9 + rnd(Math.floor(lt * 24)) * 0.15 * k})`; x.drawImage(cur, 0, 0); });
        const rx = r.getContext('2d');
        drawGrain(rx, W, H, lt, 0.22 * k);
        rx.save();
        for (let i = 0; i < 3; i++) {
          const s = rnd(Math.floor(lt * 12) * 7 + i);
          if (s < 0.6) { rx.fillStyle = `rgba(30,20,10,${0.35 * k})`; rx.fillRect(s / 0.6 * W, 0, 1.5 * unit, H); }
        }
        const g = rx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(20,10,0,${0.8 * k})`);
        rx.fillStyle = g; rx.fillRect(0, 0, W, H);
        rx.restore();
        return r;
      }
      case 'snow': {
        cx.fillStyle = 'rgba(255,255,255,.9)';
        const n = Math.floor(160 * k);
        for (let i = 0; i < n; i++) {
          const sp = 40 + rnd(i) * 80;
          const x = (rnd(i + 1) * W + Math.sin(lt * 1.2 + i) * 30 * unit) % W;
          const y = (rnd(i + 2) * H + lt * sp * unit) % H;
          const r = (1 + rnd(i + 3) * 3) * unit;
          cx.globalAlpha = 0.5 + rnd(i + 4) * 0.5;
          cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
        }
        break;
      }
      case 'hearts': {
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        const n = Math.floor(28 * k);
        for (let i = 0; i < n; i++) {
          const sz = (20 + rnd(i) * 40) * unit;
          const y = H + sz - ((lt * (60 + rnd(i + 2) * 80) * unit + rnd(i + 5) * H) % (H + sz * 2));
          const x = rnd(i + 1) * W + Math.sin(lt * 2 + i) * 20 * unit;
          cx.globalAlpha = 0.85;
          cx.font = `${sz}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
          cx.fillText(['❤️', '💕', '💗', '💖'][i % 4], x, y);
        }
        break;
      }
      case 'sparkle': {
        const n = Math.floor(40 * k);
        for (let i = 0; i < n; i++) {
          const phase = (lt * (0.8 + rnd(i) * 1.5) + rnd(i + 9)) % 1;
          const a = Math.sin(phase * Math.PI);
          const x = rnd(i + Math.floor(lt * (0.8 + rnd(i) * 1.5) + rnd(i + 9)) * 13) * W;
          const y = rnd(i * 3 + Math.floor(lt * (0.8 + rnd(i) * 1.5) + rnd(i + 9)) * 17) * H;
          const s = (6 + rnd(i + 2) * 16) * unit * a;
          cx.globalAlpha = a; cx.fillStyle = '#fff8d0';
          cx.shadowColor = '#ffe680'; cx.shadowBlur = 12 * unit;
          cx.beginPath();
          cx.moveTo(x, y - s); cx.quadraticCurveTo(x, y, x + s, y); cx.quadraticCurveTo(x, y, x, y + s);
          cx.quadraticCurveTo(x, y, x - s, y); cx.quadraticCurveTo(x, y, x, y - s); cx.fill();
        }
        break;
      }
      case 'flash': {
        cx.fillStyle = '#fff'; cx.globalAlpha = clamp(Math.exp(-lt * 5) * k);
        cx.fillRect(0, 0, W, H); break;
      }
      case 'shake': {
        const f = Math.floor(lt * 30);
        const amp = 0.025 * Math.min(W, H) * k;
        return transform((x) => {
          x.translate(W / 2 + (rnd(f) - 0.5) * 2 * amp, H / 2 + (rnd(f + 99) - 0.5) * 2 * amp);
          x.rotate((rnd(f + 7) - 0.5) * 0.02 * k); x.scale(1.06, 1.06);
          x.drawImage(cur, -W / 2, -H / 2);
        });
      }
      case 'rgbsplit': {
        const d = (6 + Math.sin(lt * 8) * 4) * unit * k;
        const r = tint(cur, '#ff0000', 'r', W, H), g = tint(cur, '#00ffff', 'g', W, H);
        return transform((x) => {
          x.drawImage(r, -d, 0);
          x.globalCompositeOperation = 'lighter';
          x.drawImage(g, d, 0);
        });
      }
      case 'lightleak': {
        cx.globalCompositeOperation = 'screen';
        const x0 = W * (0.5 + 0.5 * Math.sin(lt * 0.7)), y0 = H * (0.3 + 0.3 * Math.cos(lt * 0.5));
        const g = cx.createRadialGradient(x0, y0, 0, x0, y0, Math.max(W, H) * 0.7);
        g.addColorStop(0, `rgba(255,170,60,${0.75 * k})`); g.addColorStop(0.4, `rgba(255,60,120,${0.35 * k})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = g; cx.fillRect(0, 0, W, H); break;
      }
      case 'blur': return transform((x) => { x.filter = `blur(${(10 * k * unit).toFixed(1)}px)`; x.drawImage(cur, 0, 0); });
      case 'bwfx': return transform((x) => { x.filter = `grayscale(${k})`; x.drawImage(cur, 0, 0); });
      case 'letterbox': {
        const p = easeOut(clamp(Math.min(lt, c.duration - lt) / 0.5));
        const bh = H * 0.12 * k * p;
        cx.fillStyle = '#000'; cx.fillRect(0, 0, W, bh); cx.fillRect(0, H - bh, W, bh); break;
      }
      case 'fadeblack': {
        const edge = Math.min(1, c.duration / 2);
        cx.fillStyle = '#000';
        cx.globalAlpha = clamp((1 - Math.min(lt / edge, (c.duration - lt) / edge, 1)) * k);
        cx.fillRect(0, 0, W, H); break;
      }
      case 'zoompulse': {
        const s = 1 + 0.08 * k * Math.abs(Math.sin(lt * Math.PI * 2));
        return transform((x) => { x.translate(W / 2, H / 2); x.scale(s, s); x.drawImage(cur, -W / 2, -H / 2); });
      }
      case 'mirror': {
        return transform((x) => {
          x.drawImage(cur, 0, 0, W / 2, H, 0, 0, W / 2, H);
          x.translate(W, 0); x.scale(-1, 1);
          x.drawImage(cur, 0, 0, W / 2, H, 0, 0, W / 2, H);
        });
      }
      default: break;
    }
  } finally {
    cx.restore();
  }
  return cur;
}

function tint(src, color, name, W, H) {
  const c = buf('tint' + name, W, H);
  const x = c.getContext('2d');
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none';
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'multiply'; x.fillStyle = color; x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'source-over';
  return c;
}

function drawGrain(ctx, W, H, lt, alpha) {
  const tiles = getNoise();
  const tile = tiles[Math.floor(lt * 24) % tiles.length];
  ctx.save();
  ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'overlay';
  const ox = -Math.floor(rnd(Math.floor(lt * 24)) * 256);
  for (let y = ox; y < H; y += 256) for (let x = ox; x < W; x += 256) ctx.drawImage(tile, x, y);
  ctx.restore();
}

// ---------- 文字 ----------
export function textFont(p, size) {
  return `${p.italic ? 'italic ' : ''}${p.bold ? '800' : '400'} ${size}px ${p.font}`;
}

function drawText(ctx, c, lt, W, H, hitBoxes) {
  const p = c.text;
  if (!p) return;
  const tf = c.transform;
  const unit = Math.min(W, H) / 720;
  const size = p.size * unit * tf.scale;
  const ls = (p.letterSpacing || 0) * unit * tf.scale;
  const lh = size * (p.lineHeight || 1.25);
  ctx.save();
  ctx.font = textFont(p, size);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const lines = String(p.content || '').split('\n').map((line) => {
    const chars = [...line];
    const widths = chars.map((ch) => ctx.measureText(ch).width + ls);
    return { chars, widths, width: widths.reduce((a, b) => a + b, 0) - (chars.length ? ls : 0) };
  });
  const blockW = Math.max(1, ...lines.map((l) => l.width));
  const blockH = lines.length * lh;
  const totalChars = lines.reduce((a, l) => a + l.chars.length, 0);

  const dur = c.duration;
  const inD = Math.min(0.6, dur / 3);
  const pin = clamp(lt / inD), pout = clamp((dur - lt) / inD);
  let alpha = tf.opacity * fadeAlpha(c, lt), dx = 0, dy = 0, sc = 1, rot = (tf.rotation * Math.PI) / 180;
  let glow = p.glow ? size * 0.35 : 0;
  const anim = p.anim || 'none';
  switch (anim) {
    case 'fade': alpha *= Math.min(pin, pout); break;
    case 'slideUp': dy = (1 - easeOut(pin)) * size * 1.4; alpha *= Math.min(pin, pout); break;
    case 'slideLeft': dx = (1 - easeOut(pin)) * W * 0.35; alpha *= Math.min(pin * 2, pout); break;
    case 'zoom': sc = pin < 1 ? Math.max(0.01, easeOutBack(pin)) : 1; alpha *= Math.min(1, pin * 3, pout); break;
    case 'spin': rot += (1 - easeOut(pin)) * -Math.PI * 2; sc = Math.max(0.01, easeOut(pin)); alpha *= pout; break;
    case 'shake': { const f = Math.floor(lt * 30); dx = (rnd(f) - 0.5) * size * 0.12; dy = (rnd(f + 3) - 0.5) * size * 0.12; break; }
    case 'blink': alpha *= Math.floor(lt * 4) % 2 ? 0.2 : 1; break;
    case 'neon': glow = size * (0.3 + 0.25 * Math.sin(lt * 5)); alpha *= Math.min(pin, pout) * (0.85 + 0.15 * Math.sin(lt * 17)); break;
    case 'rainbow': case 'wave': case 'bounce': case 'typewriter': case 'glitch': alpha *= pout; break;
    default: break;
  }

  const px = tf.x * W + dx, py = tf.y * H + dy;
  ctx.translate(px, py);
  ctx.rotate(rot);
  ctx.scale(sc, sc);
  ctx.globalAlpha = clamp(alpha);

  if (p.bg) {
    const pad = size * 0.3;
    ctx.fillStyle = hexA(p.bgColor || '#000000', p.bgOpacity ?? 0.6);
    ctx.beginPath();
    ctx.roundRect(-blockW / 2 - pad, -blockH / 2 - pad * 0.6, blockW + pad * 2, blockH + pad * 1.2, size * 0.18);
    ctx.fill();
  }

  let visible = totalChars;
  if (anim === 'typewriter') visible = Math.floor(totalChars * clamp(lt / Math.min(dur * 0.7, totalChars * 0.09 + 0.05)));
  const glitchD = anim === 'glitch' ? (rnd(Math.floor(lt * 10)) > 0.4 ? (rnd(Math.floor(lt * 30)) - 0.5) * size * 0.16 : size * 0.02) : 0;

  const drawPass = (offX, fillOverride, strokeOn) => {
    let idx = 0;
    lines.forEach((l, li) => {
      let x = p.align === 'left' ? -blockW / 2 : p.align === 'right' ? blockW / 2 - l.width : -l.width / 2;
      const yBase = -blockH / 2 + lh * (li + 0.5);
      l.chars.forEach((ch, ci) => {
        if (idx >= visible) return;
        let y = yBase, cAlpha = 1, csc = 1;
        if (anim === 'wave') y += Math.sin(lt * 5 + idx * 0.6) * size * 0.16;
        if (anim === 'bounce') {
          const pi = clamp((lt - idx * 0.06) / 0.55);
          y -= (1 - easeOutBounce(pi)) * size * 1.3;
          cAlpha = pi > 0 ? 1 : 0;
        }
        if (anim === 'glitch' && rnd(idx + Math.floor(lt * 15)) > 0.92) y += size * 0.08;
        ctx.save();
        ctx.globalAlpha *= cAlpha;
        ctx.translate(x + offX + l.widths[ci] / 2 - ls / 2, y);
        ctx.scale(csc, csc);
        ctx.textAlign = 'center';
        if (strokeOn && p.strokeWidth > 0) {
          ctx.lineJoin = 'round'; ctx.miterLimit = 2;
          ctx.lineWidth = p.strokeWidth * unit * tf.scale;
          ctx.strokeStyle = p.stroke;
          ctx.strokeText(ch, 0, 0);
        }
        ctx.fillStyle = fillOverride || (anim === 'rainbow' ? `hsl(${(idx * 32 + lt * 220) % 360},95%,60%)` : p.color);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        x += l.widths[ci];
        idx++;
      });
    });
  };

  if (glitchD) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    drawPass(-glitchD, 'rgba(255,0,80,.8)', false);
    drawPass(glitchD, 'rgba(0,255,255,.8)', false);
    ctx.restore();
  }
  if (glow) { ctx.shadowColor = p.glow || p.color; ctx.shadowBlur = glow; }
  else if (p.shadow) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = size * 0.08; ctx.shadowOffsetY = size * 0.04; }
  drawPass(0, null, true);
  if (glow) { drawPass(0, null, false); }
  ctx.restore();

  const hw = (blockW / 2 + size * 0.3) * sc, hh = (blockH / 2 + size * 0.2) * sc;
  hitBoxes.push({ id: c.id, x: px - hw, y: py - hh, w: hw * 2, h: hh * 2 });
}

// ---------- 字幕 ----------
export function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of [...para]) {
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
      else line += ch;
    }
    out.push(line);
  }
  return out;
}

function drawSubtitle(ctx, s, W, H) {
  const st = state.subStyle;
  const unit = Math.min(W, H) / 720;
  const size = st.size * unit;
  ctx.save();
  ctx.font = `${st.bold ? '700' : '400'} ${size}px ${st.font}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrapText(ctx, s.text, W * 0.9);
  const lh = size * 1.3;
  const total = lines.length * lh;
  const cy = st.y * H - total / 2 + lh / 2;
  if (st.bg) {
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 0.8;
    ctx.fillStyle = hexA(st.bgColor, st.bgOpacity);
    ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, cy - lh / 2 - size * 0.15, w, total + size * 0.3, size * 0.15); ctx.fill();
  }
  lines.forEach((l, i) => {
    const y = cy + i * lh;
    if (st.strokeWidth > 0) {
      ctx.lineJoin = 'round'; ctx.lineWidth = st.strokeWidth * unit; ctx.strokeStyle = st.stroke; ctx.strokeText(l, W / 2, y);
    }
    ctx.fillStyle = st.color; ctx.fillText(l, W / 2, y);
  });
  ctx.restore();
}
