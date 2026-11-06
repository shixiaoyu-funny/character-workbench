// 生图模型按按钮锁死，生成页只标明价格，不能再手选。
// 基准立绘、Q版形象用千问；角色定向微调、一般页三视图 / 表情 / 服饰 / 手部
// 和完整设定集其余部分用 Gemini。
// 千问走百炼北京官方美元价，标 $。Gemini 走 4sapi（image 分组 2×），实扣人民币，标 ￥。
// 全部按 1K 出图。标的是出图价。

export const IMAGE_MODEL_KEY = 'imageModel';
export const DEFAULT_IMAGE_MODEL = 'qwen-image-3.0';
export const BASE_IMAGE_MODEL = 'qwen-image-3.0';
export const SUITE_IMAGE_MODEL = 'gemini-3-pro-image-c';
// 换衣页那两张白底三视图（白底三视图 / 白底头部三视图）走千问：
// Nano Banana Pro 出的身材比例、头身比和脸与换衣基准立绘对不上，「不像」比「不够稳」更伤。
// 只影响换衣页这两张；一般页的三视图与设定集里的三视图仍用 SUITE_IMAGE_MODEL。
// 千问最多吃 3 张参考图（见 QWEN_MODELS），多传的多角度图按上传顺序取前 3 张。
export const DRESSUP_IMAGE_MODEL = 'qwen-image-3.0';
// Q版形象改回千问：Gemini 的 Q 版头身比例和脸型偏"丑娃"，千问更贴近二次元手办感。
export const CHIBI_IMAGE_MODEL = 'qwen-image-3.0';
// 定向微调用 Nano Banana Pro（Gemini 3 Pro Image）。试过换千问，多姿态多机位的稳定性
// 明显不如 Gemini（千问那版手指崩坏率也更高），已回退，别再改回千问。
export const TUNE_IMAGE_MODEL = 'gemini-3-pro-image-c';

export function modelForGenerate(kind) {
  if (kind === '基准立绘' || kind === 'Q版形象') return BASE_IMAGE_MODEL;
  return SUITE_IMAGE_MODEL;
}

// 换衣页不另立一套模型：基准立绘与一般页一样走千问，五种后续图直接复用一般页的映射。
// 只有两张白底三视图单独指定为 DRESSUP_IMAGE_MODEL（千问），因为它们直接决定换衣套图的体型。
export function modelForDressup(kind) {
  if (kind === '换衣三视图' || kind === '换衣头部三视图') return DRESSUP_IMAGE_MODEL;
  if (kind === '换衣基准立绘') return BASE_IMAGE_MODEL;
  return modelForGenerate(kind);
}

export const IMAGE_MODELS = [
  {
    id: 'qwen-image-3.0',
    group: '千问',
    family: 'qwen',
    price: '出图 $0.024754/张（1K、2K 同价），参考图每张另加 $0.002750',
    maxReferences: 3,
    negativePrompt: true,
  },
  {
    id: 'qwen-image-2.1-pro',
    group: '千问',
    family: 'qwen',
    price: '$0.035333/张',
    maxReferences: 10,
    negativePrompt: false,
  },
  {
    id: 'qwen-image-2.1-turbo',
    group: '千问',
    family: 'qwen',
    price: '$0.014133/张',
    maxReferences: 10,
    negativePrompt: false,
  },
  {
    id: 'gemini-3-pro-image-c',
    group: 'Gemini',
    family: 'gemini',
    price: '1K/2K ￥0.268/张',
    maxReferences: 10,
    negativePrompt: false,
  },
  {
    id: 'gemini-nano-banana-2.1-c',
    group: 'Gemini',
    family: 'gemini',
    price: '1K ￥0.0672/张，2K ￥0.1008/张',
    maxReferences: 10,
    negativePrompt: false,
  },
  {
    id: 'gemini-3.1-flash-image-c',
    group: 'Gemini',
    family: 'gemini',
    price: '1K ￥0.134/张，2K ￥0.202/张',
    maxReferences: 10,
    negativePrompt: false,
  },
];

export function imageModelById(id) {
  return IMAGE_MODELS.find((item) => item.id === id) || null;
}

export function resolveImageModel(id) {
  return imageModelById(id) || imageModelById(DEFAULT_IMAGE_MODEL);
}
