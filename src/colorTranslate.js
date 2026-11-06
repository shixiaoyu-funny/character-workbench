// 颜色实时异步翻译：把 HEX 色值翻译成最贴切的英文颜色描述（含深浅色调）。
//
// 前端当前默认走 mockTranslateColor（本地 HSL 映射 + 300ms 延迟）模拟；
// translateColorName 预留了真实模型链路：向 /api/translate-color 发请求，
// 服务端按 COLOR_MODELS 顺序依次尝试（qwen3.8-flash -> deepseek-v4.1-flash -> qwen3.7-flash），
// 任一响应即返回，保证服务可用性。任何一步超时/失败都回退到 fallbackColorName。

// 真实翻译可用模型：按顺序 fallback。
export const COLOR_MODELS = ['qwen3.8-flash', 'deepseek-v4.1-flash', 'qwen3.7-flash'];

// 归一化：#rgb / #RRGGBB -> #rrggbb；非法输入返回 ''。
export function normalizeHex(value) {
  if (typeof value !== 'string') return '';
  const hex = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
  }
  return '';
}

function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

function rgbToHsl(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

// 色相分段 -> 基础色名（色环按度划分，红为 0/360 附近）。
function hueName(h) {
  if (h < 12 || h >= 355) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 190) return 'cyan';
  if (h < 250) return 'blue';
  if (h < 285) return 'purple';
  return 'pink';
}

// 二次元敏感基础色名：结合色相/明度/饱和度给出更贴合 AI 绘画的色名。
function animeBaseName(h, s, l) {
  if (h >= 155 && h <= 175 && l > 0.55) return 'aquamarine';
  if (h >= 250 && h < 300) return s > 0.5 ? 'violet' : 'purple';
  if (h >= 190 && h < 250) return l < 0.35 ? 'navy blue' : 'blue';
  if (h >= 175 && h < 190) return 'cyan';
  if (h >= 90 && h < 155) return l > 0.75 ? 'mint green' : 'green';
  if (h >= 70 && h < 90) return 'yellow';
  if (h >= 45 && h < 70) return 'yellow';
  if (h >= 25 && h < 45) return 'orange';
  if (h >= 12 && h < 25) return s > 0.7 ? 'orange red' : 'orange';
  if (h >= 300 && h < 360) return 'pink';
  // 0-12 红（深红为 crimson）
  return l < 0.35 ? 'crimson' : 'red';
}

// 深浅/饱和度修饰词，对齐真实模型 System Prompt 的示例命名风格。
function shadeWord(base, s, l) {
  if (base === 'aquamarine') return 'pale';
  if (base === 'navy blue') return 'deep';
  if (l < 0.2) return 'deep';
  if (l < 0.35) return 'dark';
  if (l > 0.8) return 'pastel';
  if (l > 0.7) return s < 0.5 ? 'pastel' : 'light';
  if (s > 0.7) return 'vibrant';
  if (s < 0.35) return 'muted';
  return '';
}

// 富英文名（mock 与兜底前的主翻译）：浅/深 + 鲜/柔 + 色相，如 pastel pink、deep navy blue、vibrant violet。
export function englishNameForHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const { h, s, l } = rgbToHsl(...rgb);
  if (s < 0.08) {
    if (l < 0.15) return 'black';
    if (l > 0.9) return 'white';
    return l < 0.5 ? 'dark gray' : 'light gray';
  }
  const base = animeBaseName(h, s, l);
  const shade = shadeWord(base, s, l);
  return [shade, base].filter(Boolean).join(' ');
}

// 粗粒度兜底：基础色名（red / blue / black 级别），非法 HEX 返回 ''。
export function basicColorName(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const { h, s, l } = rgbToHsl(...rgb);
  if (s < 0.12) {
    if (l < 0.18) return 'black';
    if (l > 0.85) return 'white';
    return 'gray';
  }
  return hueName(h);
}

// 兜底：翻译失败/超时时输出基础色名，仍失败则 color #HEX。绝不抛错。
export function fallbackColorName(hex) {
  const name = basicColorName(hex);
  return name || `color ${normalizeHex(hex) || String(hex)}`;
}

// 同步翻译（mock 内部用）：单色 -> 英文名；渐变 -> gradient from X to Y。
function translateInput(input) {
  if (typeof input !== 'string') return fallbackColorName(String(input));
  const gradient = input.match(/^gradient\s+from\s+(#[0-9a-fA-F]{3,6})\s+to\s+(#[0-9a-fA-F]{3,6})$/);
  if (gradient) {
    return `gradient from ${englishNameForHex(gradient[1])} to ${englishNameForHex(gradient[2])}`;
  }
  return englishNameForHex(input) || fallbackColorName(input);
}

// mock 模拟：延迟 300ms 返回英文颜色描述，只输出英文单词。
export function mockTranslateColor(input, { delay = 300 } = {}) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(translateInput(input)), delay);
  });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('translate timeout')), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

// 统一入口：优先真实模型链路（若提供 fetcher），否则 mock；超时/失败统一兜底。
export async function translateColorName(input, { fetcher, translate, timeoutMs = 5000 } = {}) {
  let attempt;
  try {
    if (fetcher) {
      attempt = fetcher('/api/translate-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      }).then((data) => {
        if (data && typeof data.englishName === 'string' && data.englishName) return data.englishName;
        throw new Error('empty translation');
      });
    } else if (translate) {
      attempt = Promise.resolve().then(() => translate(input));
    } else {
      attempt = mockTranslateColor(input);
    }
  } catch {
    return fallbackColorName(input);
  }
  try {
    const name = await withTimeout(attempt, timeoutMs);
    if (typeof name === 'string' && name) return name;
  } catch {
    // 忽略，走兜底。
  }
  return fallbackColorName(input);
}
