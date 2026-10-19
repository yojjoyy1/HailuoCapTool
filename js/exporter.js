// 匯出影片：以即時播放方式錄製畫布與混音
import { ui, totalDuration, setTime, fmtTime, toast, on } from './state.js';
import { ensureAudio, exportDest, play, pause, onPlaybackEnd } from './player.js';

const TYPES = [
  ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
  ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9,opus', 'webm'],
  ['video/webm;codecs=vp8,opus', 'webm'],
  ['video/webm', 'webm'],
];

let exporting = false;
export const isExporting = () => exporting;

export async function exportVideo(canvas) {
  if (exporting) return;
  const total = totalDuration();
  if (total <= 0) { toast('時間軸是空的，請先加入素材'); return; }
  if (!window.MediaRecorder) { toast('此瀏覽器不支援錄製，請使用 Chrome 或 Edge'); return; }
  const supported = TYPES.filter(([t]) => MediaRecorder.isTypeSupported(t));
  if (!supported.length) { toast('此瀏覽器不支援影片編碼'); return; }

  const modal = document.getElementById('modal');
  const card = document.getElementById('modalCard');
  const byExt = new Map();
  for (const [t, ext] of supported) if (!byExt.has(ext)) byExt.set(ext, t);
  const fmts = [...byExt.entries()];
  card.innerHTML = `<h3>匯出影片</h3>
    <div class="row two"><span>格式</span><select class="fmt">${fmts.map(([ext, t]) => `<option value="${t}">${ext.toUpperCase()}</option>`).join('')}</select></div>
    <div class="row two"><span>畫質</span><select class="q"><option value="4000000">標準 (4 Mbps)</option><option value="8000000" selected>高 (8 Mbps)</option><option value="16000000">極高 (16 Mbps)</option></select></div>
    <div class="row two"><span>影格率</span><select class="fps"><option>24</option><option selected>30</option><option>60</option></select></div>
    <p style="color:var(--muted);font-size:12px">影片長度 ${fmtTime(total)}。匯出會即時播放一次並錄製，過程中請保持此分頁在前景。</p>
    <div class="progress"><div></div></div><div class="asr-status st"></div>
    <div class="actions"><button class="cancel">取消</button><button class="primary go">開始匯出</button></div>`;
  modal.classList.remove('hidden');
  const q = (s) => card.querySelector(s);
  let rec = null;
  let cancelled = false;
  q('.cancel').onclick = () => {
    if (rec) { cancelled = true; pause(); rec.stop(); }
    modal.classList.add('hidden');
  };
  q('.go').onclick = async () => {
    q('.go').disabled = true;
    q('.fmt').disabled = q('.q').disabled = q('.fps').disabled = true;
    const mime = q('.fmt').value;
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    exporting = true;
    ensureAudio();
    pause();
    setTime(0);
    q('.st').textContent = '準備中…';
    await new Promise((r) => setTimeout(r, 800)); // 等待第一格畫面就緒
    const stream = canvas.captureStream(+q('.fps').value);
    exportDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: +q('.q').value, audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const offTime = () => {
      q('.progress > div').style.width = Math.min(100, (ui.time / total) * 100) + '%';
      q('.st').textContent = `錄製中… ${fmtTime(ui.time)} / ${fmtTime(total)}`;
    };
    on('time', offTime);
    rec.onstop = () => {
      exporting = false;
      onPlaybackEnd(null);
      stream.getVideoTracks().forEach((t) => t.stop());
      if (cancelled) { toast('已取消匯出'); return; }
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `海螺剪輯_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      q('.st').textContent = `完成！檔案大小 ${(blob.size / 1048576).toFixed(1)} MB`;
      q('.cancel').textContent = '關閉';
      rec = null;
      toast('匯出完成');
    };
    onPlaybackEnd(() => setTimeout(() => rec?.state === 'recording' && rec.stop(), 300));
    rec.start(500);
    play();
  };
}
