// 调色 → 3D LUT（.cube）。
//
// 为什么要把调色搬去做 LUT：导出的每一帧都要调色，但在 1920×1080 上跑一遍
// applyGrading 实测要 60ms（带锐化/清晰要 160ms），而 60FPS 每帧只有 16.7ms 预算。
// 也就是说「录制的每一帧里顺手调色」这条路线在 1080P 60FPS 上根本不成立——要么掉帧，
// 要么把画布录制变成 10fps 的幻灯片。
//
// 而调色里的 12 个参数（色温/色调/饱和度/自然饱和度/亮度/对比度/高光/阴影/白色/
// 黑色/光感/褪色）都只跟「这一像素自己的 RGB」有关，与位置、尺寸、时间无关。
// 所以它们可以被完整地摊成一张查找表，交给 ffmpeg 的 lut3d 一次性应用：
// 结果与逐像素调色完全一致，但代价接近零。
//
// 表是从 applyGrading 本身算出来的（把 4 个空间参数置零后跑一遍），不是另写一套公式，
// 所以不存在「预览和导出色调不一致」的问题。

import { applyGrading } from './colorGrade.js';

// 这 4 个是空间参数：依赖像素位置（暗角、颗粒）或邻域（锐化、清晰），
// 不能进 LUT，导出时交给 ffmpeg 的同名滤镜逐个处理。
export const LUT_SPATIAL_PARAMS = ['sharpen', 'clarity', 'grain', 'vignette'];

// 这 12 个是逐像素参数，进 LUT。
export const LUT_POINTWISE_PARAMS = [
  'temperature', 'tint', 'saturation', 'vibrance',
  'brightness', 'contrast', 'highlights', 'shadows',
  'whites', 'blacks', 'glow', 'fade',
];

// 33 个采样点：非线性最强的几条曲线（高光/白色/黑色是四次方权重）也能落在 1/255 以内。
export const LUT_SIZE = 33;

function clampParam(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-100, Math.min(100, n));
}

// 只保留逐像素参数（空间参数置 0），用于生成 LUT。
export function lutParams(params = {}) {
  const out = {};
  for (const key of LUT_POINTWISE_PARAMS) out[key] = clampParam(params[key]);
  for (const key of LUT_SPATIAL_PARAMS) out[key] = 0;
  return out;
}

// 逐像素参数全为 0 时不必生成 LUT（identity），省一次 ffmpeg 的 lut3d。
export function needsLut(params = {}) {
  return LUT_POINTWISE_PARAMS.some((key) => clampParam(params[key]) !== 0);
}

// 空间参数（-1..1）→ 交给 ffmpeg 滤镜的数值。
export function spatialGrade(params = {}) {
  const get = (key) => clampParam(params[key]) / 100;
  return {
    sharpen: get('sharpen'),
    clarity: get('clarity'),
    grain: get('grain'),
    vignette: get('vignette'),
  };
}

// 生成 .cube 文本。数据行顺序是 R 变化最快、B 最慢（.cube 规范）。
export function buildCubeLut(params = {}, size = LUT_SIZE) {
  const n = Math.max(2, Math.min(65, Math.floor(size)));
  const paramsOnly = lutParams(params);
  const count = n * n * n;
  const frame = { data: new Uint8ClampedArray(count * 4), width: count, height: 1 };
  const step = 255 / (n - 1);
  let at = 0;
  for (let b = 0; b < n; b += 1) {
    for (let g = 0; g < n; g += 1) {
      for (let r = 0; r < n; r += 1) {
        frame.data[at] = Math.round(r * step);
        frame.data[at + 1] = Math.round(g * step);
        frame.data[at + 2] = Math.round(b * step);
        frame.data[at + 3] = 255;
        at += 4;
      }
    }
  }
  const graded = applyGrading(frame, paramsOnly);
  const lines = [
    '# 由项目调色引擎导出的 3D LUT（仅逐像素参数；锐化/清晰/颗粒/暗角由 ffmpeg 滤镜处理）',
    `LUT_3D_SIZE ${n}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  const { data } = graded;
  for (let i = 0; i < data.length; i += 4) {
    lines.push(
      `${(data[i] / 255).toFixed(6)} ${(data[i + 1] / 255).toFixed(6)} ${(data[i + 2] / 255).toFixed(6)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

// 导出用的一次性参数包：LUT 文本（可为空）+ 空间参数。
export function gradeForExport(params = {}) {
  return {
    lut: needsLut(params) ? buildCubeLut(params) : '',
    grade: spatialGrade(params),
  };
}
