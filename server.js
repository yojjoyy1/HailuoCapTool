// 本機靜態伺服器：node server.js 後開啟 http://localhost:5173
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

/** 代為下載外部網址，解決對方網站不允許跨站讀取的問題 */
async function proxy(req, res) {
  const target = new URL(req.url, 'http://localhost').searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(target)) { res.writeHead(400); res.end('bad url'); return; }
  try {
    const r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 HailuoEditor' } });
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
      'X-Final-Url': r.url,
      'Access-Control-Expose-Headers': 'X-Final-Url',
    });
    if (r.body) Readable.fromWeb(r.body).pipe(res);
    else res.end();
  } catch (err) {
    res.writeHead(502); res.end(String(err.message || err));
  }
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/proxy') { proxy(req, res); return; }
  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`剪輯器已經在執行中，直接用瀏覽器開啟 http://localhost:${PORT} 即可（或先關閉另一個啟動視窗）。`);
    process.exit(0);
  }
  throw err;
}).listen(PORT, '127.0.0.1', () => console.log(`海螺剪輯器已啟動：http://localhost:${PORT}`));
