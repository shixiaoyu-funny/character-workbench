// 调色引擎：16 个参数，范围 -100~100，默认 0。
// 纯数据函数：接受 { data, width, height }，返回新的 { data, width, height }，
// 不依赖 DOM/Canvas，便于单元测试与导出时在 Worker/主线程复用。

export const GRADING_GROUPS = [
  { id: '色彩', label: '色彩' },
  { id: '明度', label: '明度' },
  { id: '效果', label: '效果' },
];

export const GRADING_PARAMS = [
  { id: 'temperature', label: '色温', group: '色彩' },
  { id: 'tint', label: '色调', group: '色彩' },
  { id: 'saturation', label: '饱和度', group: '色彩' },
  { id: 'vibrance', label: '自然饱和度', group: '色彩' },
  { id: 'brightness', label: '亮度', group: '明度' },
  { id: 'contrast', label: '对比度', group: '明度' },
  { id: 'highlights', label: '高光', group: '明度' },
  { id: 'shadows', label: '阴影', group: '明度' },
  { id: 'whites', label: '白色', group: '明度' },
  { id: 'blacks', label: '黑色', group: '明度' },
  { id: 'glow', label: '光感', group: '效果' },
  { id: 'sharpen', label: '锐化', group: '效果' },
  { id: 'clarity', label: '清晰', group: '效果' },
  { id: 'grain', label: '颗粒', group: '效果' },
  { id: 'fade', label: '褪色', group: '效果' },
  { id: 'vignette', label: '暗角', group: '效果' },
];

export function defaultGradingParams() {
  const out = {};
  for (const { id } of GRADING_PARAMS) out[id] = 0;
  return out;
}

// 预设调色：针对「服饰(主体) / 环境(背景)」冷暖组合的一键整体调色。
// 引擎是全局逐像素的 16 参数（无主体/背景分区），所以预设不是真分区调色，
// 而是用「全局温度 + 饱和度 + 高光/阴影明度分离」去强化素材里已有的冷暖对比。
// 原则：幅度克制，别让成品看起来像手机滤镜；每个预设只覆盖非零项，套用时以全 0 打底。
export const GRADING_PRESETS = [
  {
    id: 'cool-warm',
    label: '冷服饰 · 暖环境',
    note: '青橙强化：高光暖、阴影冷，增强已有冷暖对比与纵深',
    params: {
      temperature: 4, tint: -3, saturation: 14, vibrance: 12,
      contrast: 8, highlights: 6, shadows: -6,
    },
  },
  {
    id: 'warm-warm',
    label: '暖服饰 · 暖环境',
    note: '统一暖调：整体温暖和谐，暗部不带冷，轻微柔化',
    params: {
      temperature: 12, saturation: 6, vibrance: 8,
      highlights: 6, shadows: 4, fade: 6,
    },
  },
  {
    id: 'warm-cool',
    label: '暖服饰 · 冷环境',
    note: '冷暖分离：主体高光提暖突出，环境阴影压冷后退',
    params: {
      temperature: -8, saturation: 10, vibrance: 8,
      contrast: 8, highlights: 8, shadows: -8,
    },
  },
  {
    id: 'cool-cool',
    label: '冷服饰 · 冷环境',
    note: '统一冷调：清冷空灵，去饱和让冷色更纯粹',
    params: {
      temperature: -12, saturation: -8, vibrance: -4,
      contrast: 4, shadows: -6, fade: 5,
    },
  },
];

// 是否需要真的跑一遍调色。预览是逐帧跑在 JS 里的，参数全 0 时能省掉一次
// getImageData/putImageData 往返（1080P 上这两步比运算本身还贵）。
export function hasGrading(params = {}) {
  return GRADING_PARAMS.some(({ id }) => {
    const v = Number(params && params[id]);
    return Number.isFinite(v) && Math.max(-100, Math.min(100, v)) !== 0;
  });
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function normalize(params) {
  const out = {};
  for (const { id } of GRADING_PARAMS) {
    const v = Number(params && params[id]);
    out[id] = Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) / 100 : 0;
  }
  return out;
}

// 确定性伪随机（基于坐标 + seed），返回 [0,1)。保证同帧稳定、可复现。
function hashNoise(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695040888963407) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const clampIdx = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);

// 可分离盒式模糊（水平 + 垂直各一遍）。unsharp 用，半径小，一次迭代足够。
function boxBlur(data, width, height, radius) {
  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  const inv = 1 / (2 * radius + 1);
  // 水平
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let x = -radius; x <= radius; x++) {
      const i = (row + clampIdx(x, width)) * 4;
      sr += data[i];
      sg += data[i + 1];
      sb += data[i + 2];
    }
    for (let x = 0; x < width; x++) {
      const i = (row + x) * 4;
      tmp[i] = sr * inv;
      tmp[i + 1] = sg * inv;
      tmp[i + 2] = sb * inv;
      tmp[i + 3] = data[i + 3];
      const ai = (row + clampIdx(x + radius + 1, width)) * 4;
      const si = (row + clampIdx(x - radius, width)) * 4;
      sr += data[ai] - data[si];
      sg += data[ai + 1] - data[si + 1];
      sb += data[ai + 2] - data[si + 2];
    }
  }
  // 垂直
  for (let x = 0; x < width; x++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let y = -radius; y <= radius; y++) {
      const i = (clampIdx(y, height) * width + x) * 4;
      sr += tmp[i];
      sg += tmp[i + 1];
      sb += tmp[i + 2];
    }
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      out[i] = sr * inv;
      out[i + 1] = sg * inv;
      out[i + 2] = sb * inv;
      out[i + 3] = tmp[i + 3];
      const ai = (clampIdx(y + radius + 1, height) * width + x) * 4;
      const si = (clampIdx(y - radius, height) * width + x) * 4;
      sr += tmp[ai] - tmp[si];
      sg += tmp[ai + 1] - tmp[si + 1];
      sb += tmp[ai + 2] - tmp[si + 2];
    }
  }
  return out;
}

function unsharp(dst, width, height, radius, amount) {
  if (amount === 0) return;
  const blurred = boxBlur(dst, width, height, radius);
  for (let i = 0; i < dst.length; i += 4) {
    dst[i] = clamp255(dst[i] + amount * (dst[i] - blurred[i]));
    dst[i + 1] = clamp255(dst[i + 1] + amount * (dst[i + 1] - blurred[i + 1]));
    dst[i + 2] = clamp255(dst[i + 2] + amount * (dst[i + 2] - blurred[i + 2]));
  }
}

export function applyGrading(frame, params = {}, opts = {}) {
  const { data: src, width, height } = frame;
  const dst = new Uint8ClampedArray(src.length);
  const p = normalize(params);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;

  const t = p.temperature;
  const tn = p.tint;
  const sat = p.saturation;
  const vib = p.vibrance;
  const bright = p.brightness;
  const contrast = p.contrast;
  const hi = p.highlights;
  const sh = p.shadows;
  const wh = p.whites;
  const bl = p.blacks;
  const glow = p.glow;
  const grain = p.grain;
  const fade = p.fade;
  const vig = p.vignette;

  const hasColor =
    t !== 0 || tn !== 0 || sat !== 0 || vib !== 0 || bright !== 0 || contrast !== 0 ||
    hi !== 0 || sh !== 0 || wh !== 0 || bl !== 0 || glow !== 0 || grain !== 0 || fade !== 0 || vig !== 0;

  if (hasColor) {
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.hypot(cx, cy) || 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let r = src[i];
        let g = src[i + 1];
        let b = src[i + 2];

        // 色温 / 色调
        if (t !== 0) {
          r += 40 * t;
          b -= 40 * t;
        }
        if (tn !== 0) g -= 30 * tn;

        // 饱和度 / 自然饱和度
        let luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (sat !== 0) {
          const f = 1 + sat;
          r = luma + (r - luma) * f;
          g = luma + (g - luma) * f;
          b = luma + (b - luma) * f;
        }
        if (vib !== 0) {
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const s = (maxC - minC) / 255;
          const f = 1 + vib * (1 - s);
          luma = 0.299 * r + 0.587 * g + 0.114 * b;
          r = luma + (r - luma) * f;
          g = luma + (g - luma) * f;
          b = luma + (b - luma) * f;
        }

        // 亮度 / 对比度
        if (bright !== 0) {
          r += bright * 60;
          g += bright * 60;
          b += bright * 60;
        }
        if (contrast !== 0) {
          const f = 1 + contrast;
          r = (r - 128) * f + 128;
          g = (g - 128) * f + 128;
          b = (b - 128) * f + 128;
        }

        // 高光 / 阴影 / 白色 / 黑色
        luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const ln = luma / 255;
        if (hi !== 0) {
          const w = ln * ln;
          r += hi * 90 * w;
          g += hi * 90 * w;
          b += hi * 90 * w;
        }
        if (sh !== 0) {
          const w = (1 - ln) * (1 - ln);
          r += sh * 90 * w;
          g += sh * 90 * w;
          b += sh * 90 * w;
        }
        if (wh !== 0) {
          const w = ln * ln * ln * ln;
          r += wh * 110 * w;
          g += wh * 110 * w;
          b += wh * 110 * w;
        }
        if (bl !== 0) {
          const w = (1 - ln) * (1 - ln) * (1 - ln) * (1 - ln);
          r += bl * 110 * w;
          g += bl * 110 * w;
          b += bl * 110 * w;
        }

        // 光感：柔和高光提亮
        if (glow !== 0) {
          r += glow * 45 * ln;
          g += glow * 45 * ln;
          b += glow * 45 * ln;
        }

        // 褪色：降对比向中灰靠拢 + 轻微提黑位
        if (fade !== 0) {
          const f = 1 - 0.45 * fade;
          const lift = 128 * (1 - f) + fade * 28;
          r = r * f + lift;
          g = g * f + lift;
          b = b * f + lift;
        }

        // 颗粒
        if (grain !== 0) {
          const n = (hashNoise(x, y, seed) - 0.5) * 2;
          r += n * grain * 40;
          g += n * grain * 40;
          b += n * grain * 40;
        }

        // 暗角
        if (vig !== 0) {
          const d = Math.hypot(x - cx, y - cy) / maxDist;
          const edge = d < 0.4 ? 0 : Math.min(1, (d - 0.4) / 0.9 * 1.4);
          const m = 1 - vig * 0.55 * edge;
          r *= m;
          g *= m;
          b *= m;
        }

        dst[i] = clamp255(r);
        dst[i + 1] = clamp255(g);
        dst[i + 2] = clamp255(b);
        dst[i + 3] = src[i + 3];
      }
    }
  } else {
    dst.set(src);
  }

  // 锐化 / 清晰（unsharp mask）
  if (p.sharpen !== 0) unsharp(dst, width, height, 1, p.sharpen * 1.2);
  if (p.clarity !== 0) unsharp(dst, width, height, 3, p.clarity * 0.9);

  return { data: dst, width, height };
}
