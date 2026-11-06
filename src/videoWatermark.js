// 批量视频水印：文字在画面内持续漂移，透明度在 [min, max] 之间周期性呼吸。
// 本模块只做纯计算与 canvas 绘制，不碰 DOM、不依赖浏览器 API，方便单测。
// 真正的视频编码在 dom.js 里用 MediaRecorder + canvas.captureStream 完成。

export const DEFAULT_VIDEO_WATERMARK_TEXT = 'shixiaoyu-funny';

// 默认透明度区间 25% ~ 45%，一个完整呼吸周期 2 秒。
export const DEFAULT_VIDEO_WATERMARK = {
  text: DEFAULT_VIDEO_WATERMARK_TEXT,
  fontSize: 16,       // 字号（px）
  speed: 120,         // 漂移速度（px/s）
  alphaMin: 0.25,     // 透明度下限
  alphaMax: 0.45,     // 透明度上限
  pulsePeriod: 2,     // 透明度呼吸一个完整周期的秒数（越小闪得越快）
  fps: 30,
};

// 滑杆范围与默认值同源，界面按这里渲染，避免两处写死不一致。
export const VIDEO_WATERMARK_LIMITS = {
  fontSize: { min: 16, max: 160, step: 1 },
  speed: { min: 0, max: 400, step: 5 },
  alphaMin: { min: 5, max: 50, step: 1 },
  alphaMax: { min: 20, max: 80, step: 1 },
  pulsePeriod: { min: 1, max: 20, step: 0.5 },
  fps: { min: 15, max: 60, step: 5 },
};

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// 百分比滑杆给的是 15/35 这种整数，内部统一换算成 0~1 的 alpha。
export function percentToAlpha(value) {
  const number = Number(value);
  return clamp((Number.isFinite(number) ? number : 0) / 100, 0, 1);
}

export function alphaToPercent(alpha) {
  return Math.round(clamp(alpha, 0, 1) * 100);
}

// 洗一遍参数：越界夹回范围，上下限反了就互换，保证 alphaMin < alphaMax。
export function normalizeVideoWatermark(options = {}) {
  const base = DEFAULT_VIDEO_WATERMARK;
  const pick = (key) => (options[key] === undefined || options[key] === null ? base[key] : options[key]);
  const fontSize = clamp(Number(pick('fontSize')), VIDEO_WATERMARK_LIMITS.fontSize.min, VIDEO_WATERMARK_LIMITS.fontSize.max);
  const speed = clamp(Number(pick('speed')), VIDEO_WATERMARK_LIMITS.speed.min, VIDEO_WATERMARK_LIMITS.speed.max);
  const pulsePeriod = clamp(Number(pick('pulsePeriod')), VIDEO_WATERMARK_LIMITS.pulsePeriod.min, VIDEO_WATERMARK_LIMITS.pulsePeriod.max);
  const fps = clamp(Number(pick('fps')), VIDEO_WATERMARK_LIMITS.fps.min, VIDEO_WATERMARK_LIMITS.fps.max);
  let alphaMin = clamp(Number(pick('alphaMin')), 0, 1);
  let alphaMax = clamp(Number(pick('alphaMax')), 0, 1);
  if (alphaMax < alphaMin) [alphaMin, alphaMax] = [alphaMax, alphaMin];
  const text = typeof pick('text') === 'string' && pick('text').trim() ? pick('text') : DEFAULT_VIDEO_WATERMARK_TEXT;
  return {
    text,
    fontSize: Math.round(fontSize),
    speed,
    alphaMin,
    alphaMax,
    pulsePeriod,
    fps: Math.round(fps),
    seed: Number.isFinite(Number(pick('seed'))) ? Math.floor(Number(pick('seed'))) : 1,
  };
}

// 透明度呼吸曲线：0.5 - 0.5cos 让 t=0 落在下限、t=period/2 到达上限，来回都是平滑减速。
export function watermarkAlphaAt(t, options = {}) {
  const { alphaMin, alphaMax, pulsePeriod } = normalizeVideoWatermark(options);
  const period = Math.max(0.2, pulsePeriod);
  const seconds = Number.isFinite(t) ? t : 0;
  const phase = ((seconds % period) + period) % period / period;
  const eased = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  return alphaMin + (alphaMax - alphaMin) * eased;
}

// 按种子生成固定的相位，保证同一个视频每次导出的漂移轨迹一致、可复现。
function phasesFor(seed) {
  let state = (Math.floor(seed) || 1) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return [next(), next(), next(), next()].map((n) => n * Math.PI * 2);
}

// 水印中心点的漂移位置：两路不同频率的正弦叠加，看起来像随机乱飘但永远在画面内。
// 平均移动速度按 speed（px/s）近似换算成角频率，所以调速度的手感是线性的。
export function floatPosition(t, options = {}) {
  const opts = normalizeVideoWatermark(options);
  const width = Math.max(1, Number(options.width) || 1);
  const height = Math.max(1, Number(options.height) || 1);
  const textWidth = Math.max(0, Number(options.textWidth) || 0);
  const fontSize = opts.fontSize;
  const seconds = Number.isFinite(t) ? t : 0;

  // 文字整体框要留在画面内：中心点的可移动半径 = (边长 - 内容尺寸) / 2。
  const halfX = Math.max(0, (width - textWidth) / 2);
  const halfY = Math.max(0, (height - fontSize) / 2);
  const [p1, p2, p3, p4] = phasesFor(opts.seed);

  // 角频率：把「每秒移动 speed 像素」折算到各自的振幅上。
  const wx = opts.speed / Math.max(halfX * 1.6, 60);
  const wy = opts.speed / Math.max(halfY * 1.6, 60);

  const x = halfX <= 0 ? width / 2
    : width / 2
      + halfX * 0.62 * Math.sin(wx * seconds + p1)
      + halfX * 0.38 * Math.sin(wx * 1.7 * seconds + p2);
  const y = halfY <= 0 ? height / 2
    : height / 2
      + halfY * 0.58 * Math.sin(wy * 0.7 * seconds + p3)
      + halfY * 0.42 * Math.sin(wy * 1.9 * seconds + p4);

  // 文字比画面还宽时（超大字号）居中即可，clamp 的上下界会反过来。
  return {
    x: halfX <= 0 ? width / 2 : clamp(x, textWidth / 2, width - textWidth / 2),
    y: halfY <= 0 ? height / 2 : clamp(y, fontSize / 2, height - fontSize / 2),
  };
}

// 在 canvas 上画一帧水印。返回这一帧的位置和透明度，方便预览时做 HUD 或测试断言。
export function drawVideoWatermark(ctx, options = {}, t = 0) {
  if (!ctx) return null;
  const opts = normalizeVideoWatermark(options);
  ctx.save();
  ctx.font = `bold ${opts.fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textWidth = typeof ctx.measureText === 'function'
    ? Math.max(0, Number(ctx.measureText(opts.text)?.width) || 0)
    : (opts.text.length * opts.fontSize) / 2;
  const { x, y } = floatPosition(t, { ...opts, width: ctx.canvas?.width, height: ctx.canvas?.height, textWidth });
  const alpha = watermarkAlphaAt(t, opts);

  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  // 轻描边：白字压在亮背景上也留得住轮廓，和图片水印保持同一套观感。
  ctx.lineWidth = Math.max(1, Math.round(opts.fontSize / 16));
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.strokeText(opts.text, x, y);
  ctx.fillText(opts.text, x, y);
  ctx.restore();

  return { x, y, alpha, textWidth };
}

// 视频水印文件名：原名的扩展名换成导出容器的扩展名。
export function videoWatermarkFileName(name, ext = 'webm') {
  const base = String(name || 'video').replace(/\.[^.]*$/, '');
  return `${base}-vm.${ext}`;
}

// MediaRecorder 实际支持的容器；实在都不支持就交给浏览器默认（返回空串）。
export function pickVideoMime(supported, candidates = [
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4',
]) {
  if (typeof supported !== 'function') return '';
  for (const mime of candidates) {
    if (supported(mime)) return mime;
  }
  return '';
}

export function extensionForMime(mime) {
  return String(mime || '').includes('mp4') ? 'mp4' : 'webm';
}
