// 视频导出：把「调色底图」合成为一段无缝循环短视频，再走 4K 超分。
// 仅浏览器运行时调用：依赖 MediaRecorder / canvas.captureStream / rAF。
// 纯函数层（调色/裁剪）在 colorGrade.js / wallpaper.js，本模块只做录制与超分编排。

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(message = '已取消导出') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal, message) {
  if (signal && signal.aborted) throw abortError(message);
}

function pickMime(candidates) {
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined'
      && typeof MediaRecorder.isTypeSupported === 'function'
      && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取视频数据失败'));
    reader.readAsDataURL(blob);
  });
}

// 把 MediaRecorder 录出的 webm 转成 mp4（走本机 ffmpeg）。返回 mp4 blob。
// lut / grade 让最后这一道 ffmpeg 顺便把调色做完：LUT 负责 12 个逐像素参数，
// grade 负责 4 个空间参数（锐化/清晰/颗粒/暗角），省掉浏览器里逐帧调色的开销。
// fetchImpl 可注入以便测试；signal 用于取消（虽然转码是同步后端调用，仍透传）。
export async function transcodeToMp4(blob, {
  fetchImpl, signal, lut = '', grade = null, crf = 0, fps = 0, inputFormat = '',
} = {}) {
  const doFetch = fetchImpl || ((url, init) => fetch(url, init));
  const dataUrl = await blobToDataUrl(blob);
  const body = { videoDataUrl: dataUrl };
  if (lut) body.lut = lut;
  if (grade) body.grade = grade;
  if (crf) body.crf = crf;
  // 告诉后端「这段字节是什么容器」，以及目标帧率：webm 的墙钟时间戳必须显式重采样成 CFR，
  // 否则 ffmpeg 会照抄 webm 的乱序时间戳，转出来的 mp4 时基能到 2000fps、平均只有 11fps。
  if (fps) body.fps = fps;
  if (inputFormat) body.inputFormat = inputFormat;
  const response = await doFetch('/api/transcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `转码失败 (${response.status})`);
  }
  return await response.blob();
}

// 录制一段时长 duration（秒）的循环视频。draw(t) 由调用方提供，t∈[0,duration)。
// 传入 signal 后可在录制期间取消：每 100ms 检查一次，取消即提前停止录制并抛 AbortError。
// fps 与 bitrate 一起决定成片是否真的顺：录制端是 webm 中间件，码率给低了，
// 后面那道 ffmpeg 只能把压缩瑕疵一起调色放大。
export async function recordLoopVideo({ canvas, draw, duration, fps = 30, bitrate = 8_000_000, signal } = {}) {
  const stream = canvas.captureStream(fps);
  const mime = pickMime([
    'video/webm;codecs=h264', // 硬件编码，1080P60 最省 CPU；VP9 软编在 1080P 只有十几帧
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]);
  const options = mime
    ? { mimeType: mime, videoBitsPerSecond: bitrate }
    : { videoBitsPerSecond: bitrate };
  const recorder = new MediaRecorder(stream, options);
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start(100);

  const t0 = performance.now();
  const tick = () => {
    if (signal && signal.aborted) return;
    const t = ((performance.now() - t0) / 1000) % duration;
    draw(t);
    if (recorder.state === 'recording' && !(signal && signal.aborted)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const deadline = Date.now() + duration * 1000;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) {
      recorder.stop();
      await stopped;
      throw abortError();
    }
    await sleep(100);
  }
  recorder.stop();
  await stopped;
  const blob = new Blob(chunks, { type: mime || 'video/webm' });
  // 后台标签页会暂停 rAF，导致录到空画面；空 blob 到后端只会变成 400，这里提前给出可读的报错。
  if (!blob.size || blob.size < 1024) {
    throw new Error('录制失败：未捕获到画面，请保持页面在前台再试');
  }
  return blob;
}

// ==================== 逐帧确定性编码（WebCodecs） ====================
// 为什么不用 MediaRecorder 收尾：它按「墙钟」给帧打时间戳。渲染一帧要 90ms 时，
// 录出的 webm 就是 ~11fps 且时间戳不均匀；ffmpeg 照抄这些时间戳转 mp4，就得到
// 「r_frame_rate=2000/1、avg_frame_rate=11.5」的怪文件，播放器卡到不能看。
// 这里改成「帧序号即时间戳」：第 i 帧永远盖 i/fps 的戳，逐帧喂给 VideoEncoder，
// 与显示器刷新率、渲染快慢、浏览器软编性能完全解耦，输出严格 CFR。
// 编码结果以 Annex-B H.264 裸流交给后端（-f h264 -r fps），不需要在浏览器里封装容器。

// H.264 level 由「每秒宏块数」决定：1080p60 需要 4.2，1920×1440@60 要到 5.1。
// 4K 四端导出会用到更高档：3840×2160@60 卡在 5.2 边界，3840×2880@60 必须 6.0。
// 给低了编码器会拒绝配置，给高了老硬件可能不支持，所以按实际分辨率算。
export function pickAvcLevel(width, height, fps) {
  const mbW = Math.ceil(Math.max(1, width) / 16);
  const mbH = Math.ceil(Math.max(1, height) / 16);
  const mbps = mbW * mbH * Math.max(1, fps);
  const table = [
    [245760, '29'], // 4.1
    [522240, '2a'], // 4.2
    [589824, '32'], // 5.0
    [983040, '33'], // 5.1
    [2073600, '34'], // 5.2
    [4177920, '3c'], // 6.0
    [8355840, '3d'], // 6.1
  ];
  for (const [limit, level] of table) {
    if (mbps <= limit) return level;
  }
  return '3e'; // 6.2
}

// avcC 里的 lengthSizeMinusOne 在 description[4] 低两位；多数实现是 4 字节长度前缀。
export function readNalLengthSize(description) {
  if (!description) return 4;
  const bytes = description instanceof Uint8Array
    ? description
    : new Uint8Array(description.buffer ? description.buffer : description);
  if (bytes.length < 5) return 4;
  return (bytes[4] & 0x03) + 1;
}

// 有些平台无视 avc.format=annexb，仍回 AVC（长度前缀）格式；这里转成 Annex-B，
// 否则后端 `-f h264` 会把长度前缀当垃圾字节，解出一堆花屏。
export function avccToAnnexb(bytes, nalLengthSize = 4) {
  const size = nalLengthSize || 4;
  // 已经是 Annex-B（以 00 00 00 01 / 00 00 01 开头）就别再拆，按长度前缀读只会读出垃圾。
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0
    && ((bytes[2] === 0 && bytes[3] === 1) || bytes[2] === 1)) {
    return bytes;
  }
  const parts = [];
  let total = 0;
  let offset = 0;
  while (offset + size <= bytes.length) {
    let length = 0;
    for (let k = 0; k < size; k += 1) length = (length * 256) + bytes[offset + k];
    offset += size;
    if (length <= 0 || offset + length > bytes.length) break;
    const unit = new Uint8Array(length + 4);
    unit[0] = 0; unit[1] = 0; unit[2] = 0; unit[3] = 1;
    unit.set(bytes.subarray(offset, offset + length), 4);
    parts.push(unit);
    total += unit.length;
    offset += length;
  }
  if (!parts.length) return bytes;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function pickAvcConfig(width, height, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const level = pickAvcLevel(width, height, fps);
  const candidates = [`avc1.6400${level}`, 'avc1.640033', 'avc1.4d0033', 'avc1.42e033'];
  for (const codec of candidates) {
    const config = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      avc: { format: 'annexb' },
      latencyMode: 'quality',
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support && support.supported) return config;
    } catch { /* 换下一个 profile 试 */ }
  }
  return null;
}

function nextMacrotask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// 编码队列不能无限涨：1080p 一帧原始画面约 3MB，堆 200 帧就是几百兆。
async function drainQueue(encoder, limit = 4) {
  let guard = 0;
  while (encoder.encodeQueueSize > limit && guard < 3000) {
    guard += 1;
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
}

// 等「第一帧真的被合成器呈现」，返回是否等到了。
// readyState>=2 只说明解码器就绪：此时立刻 drawImage，Chromium 会画出一张全黑，
// 成片第一帧就变成黑闪——而循环壁纸每转一圈都会闪一次，比掉帧更显眼。
// requestVideoFrameCallback 是唯一可靠的「这一帧已经可以画了」信号；没有它时退回
// 轮询 currentTime（越过半帧说明至少有一帧走完了呈现流程）。
function waitForPresentedFrame(video, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    let progressed = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    if (typeof video.requestVideoFrameCallback === 'function') {
      try {
        video.requestVideoFrameCallback(() => { progressed = true; finish(true); });
      } catch { /* 走下面的轮询兜底 */ }
    }
    const startedAt = Date.now();
    const poll = () => {
      if (settled) return;
      const t = Number(video.currentTime) || 0;
      if (progressed || t > 0.02) { finish(true); return; }
      if (Date.now() - startedAt > timeoutMs) { finish(false); return; }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

// 把视频定位到某个时间点，等 seeked。兜底路径（MediaRecorder 实时录制）靠它对齐循环。
function seekTo(video, time) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { video.removeEventListener('seeked', finish); } catch { /* 忽略 */ }
      resolve();
    };
    if (Math.abs((video.currentTime || 0) - time) < 1e-3) {
      finish();
      return;
    }
    try { video.addEventListener('seeked', finish); } catch { finish(); return; }
    try { video.currentTime = time; } catch { finish(); }
    setTimeout(finish, 1500);
  });
}

// 逐帧编码一段无缝循环：返回 Annex-B H.264 裸流。
// 视频源：跟着母版自然播放走，用 currentTime 推算「这一帧该盖第几号戳」，
//         丢帧时补重复帧（时长与播放速度都不变），绝不 seek——4K 视频每帧 seek 会直接卡死。
// 图片源：没有播放进度可跟，直接按帧号画。
export async function recordCanvasH264({
  canvas, draw, duration, fps = 60, bitrate = 24_000_000, signal, video = null,
} = {}) {
  if (!canvas || !(duration > 0)) return null;
  const config = await pickAvcConfig(canvas.width, canvas.height, fps, bitrate);
  if (!config) return null;

  const total = Math.max(1, Math.round(duration * fps));
  const frameMicros = 1_000_000 / fps;
  const parts = [];
  let nalLengthSize = 0;
  let failure = null;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      const description = meta && meta.decoderConfig ? meta.decoderConfig.description : null;
      if (description && description.byteLength) {
        if (!nalLengthSize) nalLengthSize = readNalLengthSize(description);
        parts.push(avccToAnnexb(bytes, nalLengthSize));
      } else {
        parts.push(bytes);
      }
    },
    error: (error) => { failure = error; },
  });
  encoder.configure(config);

  let emitted = 0;
  // unique = 真正画过的新画面数。它明显小于总帧数，说明 4K 解码跟不上，
  // 剩下的是补帧（时长与速度都对，只是每秒的独立画面变少）。导出后报给用户看。
  let unique = 0;
  const emit = (slot) => {
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(slot * frameMicros),
      duration: Math.round(frameMicros),
      alpha: 'discard',
    });
    // 每 2 秒一个关键帧：成片以后在剪辑软件里拖时间轴也能秒出画面。
    encoder.encode(frame, { keyFrame: slot === 0 || slot % (fps * 2) === 0 });
    frame.close();
    emitted += 1;
  };
  // 跳过的时间槽用当前这张画面补齐：帧数严格等于 循环秒数×fps，时长不会被拖长或压短。
  const fillThrough = (slot) => {
    while (emitted <= slot && emitted < total) emit(emitted);
  };

  try {
    if (!video) {
      for (let slot = 0; slot < total; slot += 1) {
        throwIfAborted(signal);
        if (failure) break;
        draw(slot / fps);
        unique += 1;
        emit(slot);
        if (emitted % 6 === 0) {
          await drainQueue(encoder, 4);
          await nextMacrotask();
        }
      }
    } else {
      await seekTo(video, 0);
      try {
        const played = video.play();
        if (played && played.catch) played.catch(() => {});
      } catch { /* jsdom 等环境没有 play */ }
      // 必须等第一帧真的呈现再落笔，否则第一帧是黑的（循环播放时每圈闪一次）。
      const presented = await waitForPresentedFrame(video);
      if (!presented) {
        // 自动播放被拦：改成逐帧 seek 驱动。慢（4K 每帧一次定位），但绝不会画黑。
        for (let slot = 0; slot < total; slot += 1) {
          throwIfAborted(signal);
          if (failure) break;
          await seekTo(video, slot / fps);
          draw(slot / fps);
          unique += 1;
          emit(slot);
          if (emitted % 6 === 0) {
            await drainQueue(encoder, 4);
            await nextMacrotask();
          }
        }
      } else {
        // 2.5 倍时长还没走完，说明解码/合成卡住了；收尾补帧，至少保证时长与循环对齐。
        const deadline = Date.now() + Math.max(4000, duration * 1000 * 2.5);
        let lastSlot = -1;
        await new Promise((resolve) => {
          const step = () => {
            if ((signal && signal.aborted) || failure) { resolve(); return; }
            const t = Number(video.currentTime) || 0;
            if (video.ended || t >= duration - 1e-3 || Date.now() > deadline) { resolve(); return; }
            if (emitted >= total) { resolve(); return; }
            const slot = Math.min(total - 1, Math.max(0, Math.floor(t * fps)));
            // 高刷屏上 rAF 会跑到 120/144Hz，但母版只有 60 帧：同一条槽不用重复画。
            if (slot <= lastSlot) { requestAnimationFrame(step); return; }
            lastSlot = slot;
            if (encoder.encodeQueueSize <= 12) {
              draw(t);
              unique += 1;
              fillThrough(slot);
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        if (!(signal && signal.aborted) && !failure && emitted < total) {
          // 收尾前先停住视频，别让它 loop 回绕到 0：回绕瞬间 drawImage 拿不到帧，
          // 补出来的最后 1~2 帧会变黑（和录制首帧是同一个坑，只是发生在结尾）。
          // 停住后 seek 到最后一帧、等它呈现，再补帧——和首帧的 waitForPresentedFrame 同一套思路。
          try { video.pause(); } catch { /* 忽略 */ }
          await seekTo(video, Math.max(0, duration - 1e-3));
          await waitForPresentedFrame(video, 1000);
          const t = Math.min(duration - 1e-6, Math.max(0, Number(video.currentTime) || 0));
          // 补帧要分批喂：一次把几百帧塞进编码队列，1080P 的原始帧能把内存顶爆。
          while (emitted < total) {
            throwIfAborted(signal);
            draw(t);
            for (let i = 0; i < 12 && emitted < total; i += 1) emit(emitted);
            await drainQueue(encoder, 4);
          }
        }
      }
    }

    throwIfAborted(signal);
    if (failure) throw new Error(`逐帧编码失败：${(failure && failure.message) || failure}`);
    await encoder.flush();
  } finally {
    try { encoder.close(); } catch { /* 已关闭 */ }
  }

  if (!emitted) throw new Error('录制失败：一帧都没编出来，请保持页面在前台再试');
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const all = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return {
    blob: new Blob([all], { type: 'video/h264' }),
    fps,
    frames: emitted,
    unique,
    format: 'h264',
    codec: config.codec,
  };
}

// 超分：优先 window.upscaleTo4K（若用户已注入），否则走本机 /api/upscale（super-resolution-service）。
// fetcher 是可选的 JSON fetcher；不传则用全局 fetch（仅处理 JSON 端点）。
// signal 传入后，轮询期间取消会同时通知服务端终止超分子进程，避免 GPU 白跑。
export async function upscaleBlob(blob, { fetcher, model = 'animevideov3', scale = 2, onStatus, signal } = {}) {
  const view = typeof window !== 'undefined' ? window : undefined;
  if (view && typeof view.upscaleTo4K === 'function') {
    if (onStatus) onStatus('正在本地上采样 4K…');
    return await view.upscaleTo4K(blob);
  }

  const post = fetcher || (async (url, init) => {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
  });

  const dataUrl = await blobToDataUrl(blob);
  throwIfAborted(signal);
  const { taskId } = await post('/api/upscale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoDataUrl: dataUrl, model, scale }),
  });
  const cancelOnServer = async () => {
    try {
      await post(`/api/upscale/cancel?taskId=${encodeURIComponent(taskId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch { /* 取消请求本身失败可忽略 */ }
  };
  try {
    if (onStatus) onStatus('超分中…');
    for (;;) {
      throwIfAborted(signal);
      await sleep(1500);
      throwIfAborted(signal);
      const status = await post(`/api/upscale/status?taskId=${encodeURIComponent(taskId)}`);
      if (status.status === 'done') break;
      if (status.status === 'cancelled') throw abortError();
      if (status.status === 'error') throw new Error(status.error || '超分失败');
    }
  } catch (error) {
    if (signal && signal.aborted) await cancelOnServer();
    throw error;
  }
  const response = await fetch(`/api/upscale/result?taskId=${encodeURIComponent(taskId)}`);
  if (!response.ok) throw new Error('获取超分结果失败');
  return await response.blob();
}
