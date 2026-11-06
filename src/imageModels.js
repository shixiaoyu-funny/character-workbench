// 生图模型按按钮锁死，生成页只标明价格，不能再手选。
// 基准立绘、Q版形象用千问；角色定向微调、一般页三视图 / 表情 / 服饰 / 手部
// 和完整设定集其余部分用 Gemini。
// 千问走百炼北京官方美元价，标 $。Gemini 走 4sapi（image 分组 2×），实扣人民币，标 ￥。
// 全部按 1K 出图。标的是出图价。

export const IMAGE_MODEL_KEY = 'imageModel';
export const DEFAULT_IMAGE_MODEL = 'qwen-image-3.0';
export const BASE_IMAGE_MODEL = 'qwen-image-3.0';
export const SUITE_IMAGE_MODEL = 'gemini-3-pro-image-c';
// Q版形象改回千问：Gemini 的 Q 版头身比例和脸型偏"丑娃"，千问更贴近二次元手办感。
export const CHIBI_IMAGE_MODEL = 'qwen-image-3.0';
// 定向微调用 Nano Banana Pro（Gemini 3 Pro Image）。试过换千问，多姿态多机位的稳定性
// 明显不如 Gemini（千问那版手指崩坏率也更高），已回退，别再改回千问。
export const TUNE_IMAGE_MODEL = 'gemini-3-pro-image-c';

export function modelForGenerate(kind) {
  if (kind === '基准立绘' || kind === 'Q版形象') return BASE_IMAGE_MODEL;
  return SUITE_IMAGE_MODEL;
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
