// 屬性面板：調整選取片段的位置、濾鏡、音量、文字樣式、特效參數
import {
  state, ui, assets, luts, getClip, getTrack, commit, on, emit, select, splitClip, deleteClip, duplicateClip,
  packMain, maxSourceDuration, toast, fmtTime,
} from './state.js';
import { FILTERS, TEXT_ANIMS, EFFECTS, fontOptions } from './builtin.js';
import { saveTextPreset } from './imports.js';
import { pickFont, pickLut } from './library.js';

const root = () => document.getElementById('inspector');


function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

function section(title, extra = '') {
  const s = el(`<div class="insp-section"><div class="insp-title"><span>${title}</span>${extra}</div></div>`);
  root().appendChild(s);
  return s;
}

/** 滑桿列：get/set 存取片段屬性 */
function slider(parent, label, { min, max, step, get, set, fmt = (v) => v }) {
  const r = el(`<div class="row"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span class="val"></span></div>`);
  const input = r.querySelector('input'); const val = r.querySelector('.val');
  input.value = get(); val.textContent = fmt(+input.value);
  input.oninput = () => { set(+input.value); val.textContent = fmt(+input.value); };
  input.onchange = () => commit();
  input.ondblclick = () => { /* 雙擊還原預設由呼叫端決定 */ };
  parent.appendChild(r);
  return input;
}
function field(parent, label, inputHtml, bind) {
  const r = el(`<div class="row two"><span>${label}</span>${inputHtml}</div>`);
  const input = r.querySelector('input,select,textarea');
  bind(input);
  parent.appendChild(r);
  return input;
}
function check(parent, label, get, set) {
  const r = el(`<label class="inline" style="margin:4px 12px 4px 0"><input type="checkbox"> ${label}</label>`);
  const i = r.querySelector('input');
  i.checked = get();
  i.onchange = () => { set(i.checked); commit(); };
  parent.appendChild(r);
  return i;
}
const pct = (v) => Math.round(v * 100) + '%';
const BLENDS = [
  ['source-over', '正常'], ['screen', '濾色（去黑底）'], ['multiply', '色彩增值（去白底）'],
  ['lighter', '相加（發光）'], ['overlay', '覆蓋'], ['soft-light', '柔光'], ['difference', '差異'],
];

function renderEmpty() {
  const r = root();
  r.innerHTML = `<div class="insp-empty">在時間軸點選片段即可調整屬性。<br>
    • 空白鍵：播放 / 暫停<br>• S：在播放頭分割<br>• Delete：刪除選取<br>• ⌘/Ctrl + Z：復原<br>• ← →：逐格移動，Shift 加速</div>`;
  const vids = state.clips.filter((c) => c.kind === 'video');
  const music = state.clips.filter((c) => c.kind === 'audio');
  const s = section('整體聲音調整');
  const avg = (arr, f) => (arr.length ? arr.reduce((a, c) => a + f(c), 0) / arr.length : 1);
  slider(s, '影片原聲', {
    min: 0, max: 2, step: 0.01, get: () => avg(vids, (c) => (c.muted ? 0 : c.volume)),
    set: (v) => vids.forEach((c) => { c.volume = v; c.muted = v === 0; }), fmt: pct,
  });
  slider(s, '背景音樂', {
    min: 0, max: 2, step: 0.01, get: () => avg(music, (c) => c.volume),
    set: (v) => music.forEach((c) => { c.volume = v; }), fmt: pct,
  });
  const br = el('<div class="btn-row"></div>');
  const b1 = el('<button>🔇 移除全部原聲</button>');
  b1.onclick = () => { vids.forEach((c) => { c.muted = true; }); commit(); renderInspector(); toast('已移除所有影片原聲，可到「音樂」分頁加入新的背景音'); };
  const b2 = el('<button>🔊 還原全部原聲</button>');
  b2.onclick = () => { vids.forEach((c) => { c.muted = false; if (!c.volume) c.volume = 1; }); commit(); renderInspector(); };
  const b3 = el('<button>🗣 全部人聲強化</button>');
  b3.onclick = () => { const on = !vids.every((c) => c.voiceBoost); vids.forEach((c) => { c.voiceBoost = on; }); commit(); toast(on ? '已開啟人聲強化（減弱背景音）' : '已關閉人聲強化'); };
  br.append(b1, b2, b3);
  s.appendChild(br);
}

export function renderInspector() {
  const r = root();
  r.innerHTML = '';
  const c = getClip(ui.selectedId);
  if (!c) { renderEmpty(); return; }
  const track = getTrack(c.trackId);
  const a = assets.get(c.assetId);
  const kindName = { video: '影片', image: '圖片', gen: '動態素材', text: '文字', effect: '特效', audio: '音訊' }[c.kind];
  const visual = ['video', 'image', 'gen'].includes(c.kind);

  // ---- 基本 ----
  const s0 = section(`${kindName}：${a?.name || c.text?.content?.slice(0, 10) || EFFECTS[c.effect?.type]?.name || ''}`);
  s0.appendChild(el(`<div class="row two"><span>位置</span><span>${fmtTime(c.start)} → ${fmtTime(c.start + c.duration)}</span></div>`));
  field(s0, '長度 (秒)', '<input type="number" min="0.1" step="0.1">', (i) => {
    i.value = c.duration.toFixed(2);
    i.onchange = () => {
      const max = (maxSourceDuration(c) - c.in) / c.speed;
      c.duration = Math.max(0.1, Math.min(+i.value || 0.1, max));
      if (track.kind === 'main') packMain();
      commit(); renderInspector();
    };
  });
  const br = el('<div class="btn-row"></div>');
  const bs = el('<button>✂ 在播放頭分割</button>'); bs.onclick = () => { if (splitClip(c.id, ui.time)) commit(); else toast('播放頭不在此片段內'); };
  const bd = el('<button>⧉ 複製</button>'); bd.onclick = () => { const n = duplicateClip(c.id); commit(); select(n.id); };
  const bx = el('<button class="danger">🗑 刪除</button>'); bx.onclick = () => { deleteClip(c.id); commit(); emit('select'); };
  br.append(bs, bd, bx);
  if (visual && track.kind === 'overlay') {
    const bm = el('<button>⬇ 移到主影片</button>');
    bm.onclick = () => { c.trackId = state.tracks.find((t) => t.kind === 'main').id; c.transform = { ...c.transform, x: 0.5, y: 0.5, scale: 1 }; c.start = Infinity; packMain(); commit(); renderInspector(); };
    br.appendChild(bm);
  }
  s0.appendChild(br);

  // ---- 畫面 ----
  if (visual || c.kind === 'text') {
    const s = section('畫面', '<button class="reset">重設</button>');
    s.querySelector('.reset').onclick = () => { c.transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }; commit(); renderInspector(); };
    const tf = c.transform;
    slider(s, '水平位置', { min: 0, max: 1, step: 0.001, get: () => tf.x, set: (v) => { tf.x = v; }, fmt: pct });
    slider(s, '垂直位置', { min: 0, max: 1, step: 0.001, get: () => tf.y, set: (v) => { tf.y = v; }, fmt: pct });
    slider(s, '縮放', { min: 0.05, max: 3, step: 0.01, get: () => tf.scale, set: (v) => { tf.scale = v; }, fmt: pct });
    slider(s, '旋轉', { min: -180, max: 180, step: 1, get: () => tf.rotation, set: (v) => { tf.rotation = v; }, fmt: (v) => v + '°' });
    slider(s, '不透明度', { min: 0, max: 1, step: 0.01, get: () => tf.opacity, set: (v) => { tf.opacity = v; }, fmt: pct });
    slider(s, '淡入', { min: 0, max: 3, step: 0.1, get: () => c.fadeIn, set: (v) => { c.fadeIn = v; }, fmt: (v) => v + 's' });
    slider(s, '淡出', { min: 0, max: 3, step: 0.1, get: () => c.fadeOut, set: (v) => { c.fadeOut = v; }, fmt: (v) => v + 's' });
    if (visual) {
      field(s, '混合模式', `<select>${BLENDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>`, (i) => {
        i.value = c.blend || 'source-over'; i.onchange = () => { c.blend = i.value; commit(); };
      });
    }
    if (c.kind === 'video' || a?.frames) {
      check(s, '循環播放（可拉長超過素材長度）', () => !!c.loop, (v) => {
        c.loop = v;
        if (!v) {
          const max = (maxSourceDuration(c) - c.in) / c.speed;
          if (c.duration > max) { c.duration = Math.max(0.1, max); if (track.kind === 'main') packMain(); }
        }
      });
    }
    s.appendChild(el('<div style="color:var(--muted);font-size:11px">也可以直接在預覽畫面上拖曳移動、滾輪縮放</div>'));
  }

  // ---- 濾鏡 ----
  if (visual) {
    const s = section('濾鏡與調色');
    field(s, '濾鏡', `<select>${Object.entries(FILTERS).map(([k, f]) => `<option value="${k}">${f.name}</option>`).join('')}</select>`, (i) => {
      i.value = c.filter; i.onchange = () => { c.filter = i.value; commit(); };
    });
    const adj = c.adjust;
    slider(s, '亮度', { min: 0.2, max: 2, step: 0.01, get: () => adj.brightness, set: (v) => { adj.brightness = v; }, fmt: pct });
    slider(s, '對比', { min: 0.2, max: 2, step: 0.01, get: () => adj.contrast, set: (v) => { adj.contrast = v; }, fmt: pct });
    slider(s, '飽和度', { min: 0, max: 3, step: 0.01, get: () => adj.saturate, set: (v) => { adj.saturate = v; }, fmt: pct });
    const lr = el(`<div class="row two"><span>LUT</span><span style="display:flex;gap:6px"><select style="flex:1"><option value="">無</option>${[...luts.values()].map((l) => `<option value="${l.id}">${l.name}</option>`).join('')}</select><button>＋匯入</button></span></div>`);
    const ls = lr.querySelector('select');
    ls.value = c.lut && luts.has(c.lut) ? c.lut : '';
    ls.onchange = () => { c.lut = ls.value || null; commit(); renderInspector(); };
    lr.querySelector('button').onclick = pickLut;
    s.appendChild(lr);
    if (c.lut && luts.has(c.lut)) slider(s, 'LUT 強度', { min: 0, max: 1, step: 0.01, get: () => c.lutAmount ?? 1, set: (v) => { c.lutAmount = v; }, fmt: pct });
  }

  // ---- 速度 ----
  if (['video', 'gen', 'audio'].includes(c.kind)) {
    const s = section('速度');
    field(s, '播放速度', '<select><option>0.25</option><option>0.5</option><option>0.75</option><option>1</option><option>1.25</option><option>1.5</option><option>2</option><option>3</option></select>', (i) => {
      i.value = String(c.speed);
      i.onchange = () => {
        const ns = +i.value;
        c.duration = (c.duration * c.speed) / ns;
        const max = (maxSourceDuration(c) - c.in) / ns;
        c.duration = Math.min(c.duration, max);
        c.speed = ns;
        if (track.kind === 'main') packMain();
        commit(); renderInspector();
      };
    });
  }

  // ---- 聲音 ----
  if (c.kind === 'video' || c.kind === 'audio') {
    const s = section(c.kind === 'video' ? '原聲 / 背景音' : '音訊');
    slider(s, '音量', { min: 0, max: 2, step: 0.01, get: () => c.volume, set: (v) => { c.volume = v; }, fmt: pct });
    if (c.kind === 'audio') {
      slider(s, '淡入', { min: 0, max: 5, step: 0.1, get: () => c.fadeIn, set: (v) => { c.fadeIn = v; }, fmt: (v) => v + 's' });
      slider(s, '淡出', { min: 0, max: 5, step: 0.1, get: () => c.fadeOut, set: (v) => { c.fadeOut = v; }, fmt: (v) => v + 's' });
    }
    check(s, '靜音', () => c.muted, (v) => { c.muted = v; });
    if (c.kind === 'video') {
      check(s, '人聲強化（減弱背景音）', () => c.voiceBoost, (v) => { c.voiceBoost = v; });
      const b = el('<button style="margin-top:6px">🔁 移除原聲並替換背景音樂</button>');
      b.onclick = () => {
        c.muted = true; commit(); renderInspector();
        document.querySelector('#libTabs [data-tab=audio]').click();
        toast('已移除此片段原聲，把音樂拖到「背景音樂」軌即可替換');
      };
      s.appendChild(b);
    }
  }

  // ---- 文字 ----
  if (c.kind === 'text') {
    const p = c.text;
    const s = section('文字內容');
    field(s, '內容', '<textarea rows="3"></textarea>', (i) => {
      i.value = p.content;
      i.oninput = () => { p.content = i.value; };
      i.onchange = () => commit();
    });
    const fr = el(`<div class="row two"><span>字型</span><span style="display:flex;gap:6px"><select style="flex:1">${fontOptions().map(([v, n]) => `<option value='${v}'>${n}</option>`).join('')}</select><button>＋匯入</button></span></div>`);
    const fs = fr.querySelector('select');
    fs.value = p.font; if (fs.selectedIndex < 0) fs.selectedIndex = 0;
    fs.onchange = () => { p.font = fs.value; commit(); };
    fr.querySelector('button').onclick = pickFont;
    s.appendChild(fr);
    slider(s, '字級', { min: 12, max: 240, step: 1, get: () => p.size, set: (v) => { p.size = v; }, fmt: (v) => v });
    slider(s, '字距', { min: -10, max: 60, step: 1, get: () => p.letterSpacing || 0, set: (v) => { p.letterSpacing = v; }, fmt: (v) => v });
    const colors = el(`<div class="row two"><span>顏色</span><span style="display:flex;gap:10px;align-items:center">
      文字 <input type="color" class="c1"> 描邊 <input type="color" class="c2"></span></div>`);
    const c1 = colors.querySelector('.c1'), c2 = colors.querySelector('.c2');
    c1.value = p.color; c2.value = p.stroke;
    c1.oninput = () => { p.color = c1.value; }; c2.oninput = () => { p.stroke = c2.value; };
    c1.onchange = c2.onchange = () => commit();
    s.appendChild(colors);
    slider(s, '描邊粗細', { min: 0, max: 30, step: 1, get: () => p.strokeWidth, set: (v) => { p.strokeWidth = v; }, fmt: (v) => v });
    field(s, '對齊', '<select><option value="left">靠左</option><option value="center">置中</option><option value="right">靠右</option></select>', (i) => {
      i.value = p.align || 'center'; i.onchange = () => { p.align = i.value; commit(); };
    });
    const flags = el('<div></div>');
    check(flags, '粗體', () => p.bold, (v) => { p.bold = v; });
    check(flags, '斜體', () => p.italic, (v) => { p.italic = v; });
    check(flags, '陰影', () => p.shadow, (v) => { p.shadow = v; });
    check(flags, '底色框', () => p.bg, (v) => { p.bg = v; renderInspector(); });
    s.appendChild(flags);
    if (p.bg) {
      const bg = el('<div class="row two"><span>底色</span><input type="color"></div>');
      const bi = bg.querySelector('input'); bi.value = p.bgColor; bi.oninput = () => { p.bgColor = bi.value; }; bi.onchange = () => commit();
      s.appendChild(bg);
      slider(s, '底色透明', { min: 0, max: 1, step: 0.01, get: () => p.bgOpacity, set: (v) => { p.bgOpacity = v; }, fmt: pct });
    }
    const gl = el('<div class="row two"><span>發光</span><span style="display:flex;gap:8px;align-items:center"><input type="checkbox"><input type="color"></span></div>');
    const [gc, gcol] = gl.querySelectorAll('input');
    gc.checked = !!p.glow; gcol.value = p.glow || '#ff2fc2';
    gc.onchange = () => { p.glow = gc.checked ? gcol.value : ''; commit(); };
    gcol.oninput = () => { if (gc.checked) p.glow = gcol.value; };
    gcol.onchange = () => commit();
    s.appendChild(gl);

    const s2 = section('文字特效');
    const chips = el('<div class="chip-list"></div>');
    for (const [k, n] of Object.entries(TEXT_ANIMS)) {
      const ch = el(`<span class="chip ${p.anim === k ? 'active' : ''}">${n}</span>`);
      ch.onclick = () => { p.anim = k; commit(); renderInspector(); };
      chips.appendChild(ch);
    }
    s2.appendChild(chips);
    const sv = el('<button style="margin-top:10px;width:100%">💾 存成我的範本</button>');
    sv.onclick = () => {
      const name = prompt('範本名稱', (p.content || '我的範本').split('\n')[0].slice(0, 12));
      if (!name) return;
      saveTextPreset(c, name.trim());
      toast('已存到「文字」分頁的「我的範本」');
    };
    s2.appendChild(sv);
  }

  // ---- 特效 ----
  if (c.kind === 'effect') {
    const s = section('特效設定');
    field(s, '特效', `<select>${Object.entries(EFFECTS).map(([k, f]) => `<option value="${k}">${f.icon} ${f.name}</option>`).join('')}</select>`, (i) => {
      i.value = c.effect.type; i.onchange = () => { c.effect.type = i.value; commit(); };
    });
    slider(s, '強度', { min: 0, max: 2, step: 0.01, get: () => c.effect.intensity, set: (v) => { c.effect.intensity = v; }, fmt: pct });
  }
}

export function initInspector() {
  document.querySelectorAll('#sideTabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#sideTabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.side .tab-page').forEach((p) => p.classList.toggle('active', p.dataset.page === b.dataset.tab));
    };
  });
  on('select', renderInspector);
  on('library', () => {
    const ae = document.activeElement;
    if (root().contains(ae) && ae.matches('input,textarea,select')) return;
    renderInspector();
  });
  on('change', () => {
    const ae = document.activeElement;
    if (root().contains(ae) && ae.matches('input,textarea,select')) return;
    renderInspector();
  });
  renderInspector();
}
