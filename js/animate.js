// Animation export. Frames are drawn off-screen with the same renderer as the
// map, then encoded as MP4 (H.264 via WebCodecs), WebM (MediaRecorder, for
// browsers without WebCodecs) or GIF. Encoders load only when needed.

import { ensure } from './ephem.js';
import { buildScene, needs } from './scene.js';
import { composeFrame } from './export.js';
import { tr } from './i18n.js';

const MP4_MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm';
const GIFENC = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm';

export const LIMITS = { video: 3000, gif: 400 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Load every ephemeris chunk the whole sequence will touch.
async function preload(S, jd0, jd1) {
  const span = new Map();
  for (const jd of [jd0, jd1]) {
    for (const [k, a, b] of needs(jd, S)) {
      const c = span.get(k);
      span.set(k, c ? [Math.min(c[0], a), Math.max(c[1], b)] : [a, b]);
    }
  }
  await Promise.all([...span].map(([k, [a, b]]) => ensure([k], a, b)));
}

export const videoSupport = () => (typeof VideoEncoder !== 'undefined' ? 'mp4' : 'webm');

// o: { S, theme, jd0, jd1, step, fps, width, height, format: 'video' | 'gif',
//      meta(jd), onProgress(done, total), signal }
export async function recordAnimation(o) {
  const n = Math.floor((o.jd1 - o.jd0) / o.step + 1e-9) + 1;
  const limit = o.format === 'gif' ? LIMITS.gif : LIMITS.video;
  if (n > limit) throw new Error(tr('That is {n} frames; the limit is {limit}. Use a larger step or a shorter range.', { n, limit }));
  await preload(o.S, o.jd0, o.jd1);
  const cv = document.createElement('canvas');
  cv.width = o.width;
  cv.height = o.height;
  const ctx = cv.getContext('2d', { willReadFrequently: o.format === 'gif' });
  const draw = (i) => {
    const jd = o.jd0 + i * o.step;
    const s = { ...o.S, jd };
    composeFrame(ctx, o.width, o.height, buildScene(jd, s), s, o.theme, o.meta(jd));
  };
  const check = () => { if (o.signal?.aborted) throw new DOMException('Recording cancelled', 'AbortError'); };

  if (o.format === 'gif') return gif(o, n, ctx, draw, check);
  if (typeof VideoEncoder !== 'undefined') {
    const out = await mp4(o, n, cv, draw, check);
    if (out) return out;
  }
  return webm(o, n, cv, draw, check);
}

async function mp4(o, n, cv, draw, check) {
  const { Muxer, ArrayBufferTarget } = await import(MP4_MUXER);
  let config = null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']) {
    const c = {
      codec, width: o.width, height: o.height, framerate: o.fps,
      bitrate: Math.round(o.width * o.height * o.fps * 0.12),
    };
    try {
      if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; }
    } catch { /* try the next profile */ }
  }
  if (!config) return null;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: o.width, height: o.height }, fastStart: 'in-memory' });
  let failure = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  enc.configure(config);
  const dt = 1e6 / o.fps;
  try {
    for (let i = 0; i < n; i++) {
      check();
      if (failure) throw failure;
      draw(i);
      const frame = new VideoFrame(cv, { timestamp: Math.round(i * dt), duration: Math.round(dt) });
      enc.encode(frame, { keyFrame: i % (o.fps * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 6) await sleep(4);
      o.onProgress(i + 1, n);
      if (i % 3 === 0) await sleep(0);
    }
    await enc.flush();
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
  if (failure) throw failure;
  muxer.finalize();
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
}

async function webm(o, n, cv, draw, check) {
  if (typeof MediaRecorder === 'undefined' || !cv.captureStream) {
    throw new Error(tr('This browser cannot record video. Try the GIF format, or a current Chrome, Edge, Safari or Firefox.'));
  }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((m) => MediaRecorder.isTypeSupported(m));
  const stream = cv.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });
  rec.start();
  try {
    // MediaRecorder timestamps frames by the wall clock, so pace them in real time.
    for (let i = 0; i < n; i++) {
      check();
      draw(i);
      track.requestFrame();
      o.onProgress(i + 1, n);
      await sleep(1000 / o.fps);
    }
  } finally {
    rec.stop();
    await stopped;
  }
  const type = mime.split(';')[0];
  return { blob: new Blob(parts, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm' };
}

async function gif(o, n, ctx, draw, check) {
  const { GIFEncoder, quantize, applyPalette } = await import(GIFENC);
  const enc = GIFEncoder();
  for (let i = 0; i < n; i++) {
    check();
    draw(i);
    const { data } = ctx.getImageData(0, 0, o.width, o.height);
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    enc.writeFrame(index, o.width, o.height, { palette, delay: Math.round(1000 / o.fps) });
    o.onProgress(i + 1, n);
    await sleep(0);
  }
  enc.finish();
  return { blob: new Blob([enc.bytes()], { type: 'image/gif' }), ext: 'gif' };
}
