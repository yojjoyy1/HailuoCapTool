// 3D LUT（.cube）解析與 WebGL 套用
export function parseCube(text) {
  let size = 0;
  let min = [0, 0, 0], max = [1, 1, 1];
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
    else if (key === 'LUT_1D_SIZE') throw new Error('不支援 1D LUT，請使用 3D LUT');
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (/^[-+\d.]/.test(parts[0]) && parts.length >= 3) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || size > 64) throw new Error('LUT 檔案格式不正確（缺少 LUT_3D_SIZE 或尺寸過大）');
  if (vals.length !== size * size * size * 3) throw new Error(`LUT 資料數量不符（預期 ${size ** 3} 組，實際 ${vals.length / 3} 組）`);
  return { size, data: new Float32Array(vals), min, max };
}

/** 依 LUT 產生預覽縮圖用的漸層色條 */
export function lutPreview(lut) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 20;
  const x = c.getContext('2d');
  const { size, data } = lut;
  for (let i = 0; i < 96; i++) {
    const t = i / 95;
    const h = t * 6;
    const rgb = [Math.abs(h - 3) - 1, 2 - Math.abs(h - 2), 2 - Math.abs(h - 4)].map((v) => Math.max(0, Math.min(1, v)) * 0.8 + 0.1);
    const idx = rgb.map((v) => Math.round(v * (size - 1)));
    const o = (idx[0] + idx[1] * size + idx[2] * size * size) * 3;
    x.fillStyle = `rgb(${data[o] * 255},${data[o + 1] * 255},${data[o + 2] * 255})`;
    x.fillRect(i, 0, 1, 20);
  }
  return c.toDataURL();
}

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision highp float;
uniform sampler2D img; uniform sampler2D lut;
uniform float size; uniform float amount; uniform vec3 dmin; uniform vec3 dmax;
varying vec2 uv;
void main() {
  vec4 c = texture2D(img, uv);
  vec3 v = clamp((c.rgb - dmin) / (dmax - dmin), 0.0, 1.0);
  float s = size;
  float b = v.b * (s - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, s - 1.0);
  float x = v.r * (s - 1.0) + 0.5;
  float y = (v.g * (s - 1.0) + 0.5) / s;
  vec3 l0 = texture2D(lut, vec2((b0 * s + x) / (s * s), y)).rgb;
  vec3 l1 = texture2D(lut, vec2((b1 * s + x) / (s * s), y)).rgb;
  gl_FragColor = vec4(mix(c.rgb, mix(l0, l1, b - b0), amount), c.a);
}`;

let gl = null, glCanvas = null, prog = null, imgTex = null;
const lutTex = new Map();

function init() {
  if (gl) return gl;
  glCanvas = document.createElement('canvas');
  gl = glCanvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  imgTex = makeTex();
  gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'lut'), 1);
  return gl;
}
function makeTex() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function getLutTex(id, lut) {
  let t = lutTex.get(id);
  if (t) return t;
  const { size, data } = lut;
  const w = size * size;
  const px = new Uint8Array(w * size * 4);
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const si = (r + g * size + b * size * size) * 3;
    const di = (g * w + b * size + r) * 4;
    px[di] = Math.round(Math.min(1, Math.max(0, data[si])) * 255);
    px[di + 1] = Math.round(Math.min(1, Math.max(0, data[si + 1])) * 255);
    px[di + 2] = Math.round(Math.min(1, Math.max(0, data[si + 2])) * 255);
    px[di + 3] = 255;
  }
  t = makeTex();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  lutTex.set(id, t);
  return t;
}

/** 回傳套用 LUT 後的畫布；失敗時回傳原始來源 */
export function applyLut(src, sw, sh, id, lut, amount = 1) {
  if (!init()) return src;
  const scale = Math.min(1, 1920 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, getLutTex(id, lut));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, imgTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch { return src; }
  gl.uniform1f(gl.getUniformLocation(prog, 'size'), lut.size);
  gl.uniform1f(gl.getUniformLocation(prog, 'amount'), amount);
  gl.uniform3fv(gl.getUniformLocation(prog, 'dmin'), lut.min);
  gl.uniform3fv(gl.getUniformLocation(prog, 'dmax'), lut.max);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return glCanvas;
}

export function forgetLut(id) {
  const t = lutTex.get(id);
  if (t && gl) gl.deleteTexture(t);
  lutTex.delete(id);
}
