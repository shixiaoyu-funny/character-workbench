// 浏览器侧生图：拼提示词、带参考图请求 /api/generate，成功后写入图库。
// 图片、种子和提示词只留在内存里。

import { buildPrompt } from './prompts.js';

const SEED_MAX = 2147483647;
const SUITE = ['三视图', '表情差分图', '服饰拆解图', 'Q版形象'];

function defaultSeed() {
  return Math.floor(Math.random() * SEED_MAX);
}

export async function browserFetcher(url, init) {
  const response = await fetch(url, init);
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.error || `生成失败 (${response.status})`);
  return data;
}

export async function requestImage({
  prompt,
  negativePrompt,
  aspectRatio,
  seed,
  referenceImages = [],
  fetcher = browserFetcher,
}) {
  const data = await fetcher('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      negativePrompt,
      aspectRatio,
      seed,
      referenceImages,
    }),
  });
  if (!data || !data.dataUrl) throw new Error((data && data.error) || '生成失败');
  return { dataUrl: data.dataUrl, seed: data.seed };
}

function takeSeed(randomSeed, used) {
  let seed = randomSeed();
  let guard = 0;
  while (used.has(seed) && guard < 16) {
    seed = randomSeed();
    guard += 1;
  }
  used.add(seed);
  return seed;
}

// 基准立绘永远用新种子；有上传图时只带那一张。其余图种优先用已锁定的基准。
function planShot({ kind, gallery, images, randomSeed, used }) {
  const upload = images && images.reference ? images.reference : null;
  const locked = typeof gallery.base === 'function' ? gallery.base() : null;
  if (kind === '基准立绘') {
    return {
      seed: takeSeed(randomSeed, used),
      referenceImages: upload ? [upload] : [],
      hasReference: Boolean(upload),
    };
  }
  if (locked && locked.dataUrl) {
    return { seed: locked.seed, referenceImages: [locked.dataUrl], hasReference: true };
  }
  if (upload) {
    return { seed: takeSeed(randomSeed, used), referenceImages: [upload], hasReference: true };
  }
  return { seed: takeSeed(randomSeed, used), referenceImages: [], hasReference: false };
}

async function produceOne({ kind, state, gallery, images, fetcher, randomSeed, used }) {
  const plan = planShot({ kind, gallery, images, randomSeed, used });
  let referenceImages = plan.referenceImages;
  let hasReference = plan.hasReference;
  let styleReference = false;
  if (kind === 'Q版形象') {
    const data = await fetcher('/api/chibi-style', { method: 'GET' });
    const style = data && Array.isArray(data.images) ? data.images.find(Boolean) : null;
    if (style) {
      referenceImages = [...referenceImages, style];
      styleReference = true;
      hasReference = true;
    }
  }
  const built = buildPrompt(state, kind, { hasReference, styleReference });
  const result = await requestImage({
    prompt: built.positive,
    negativePrompt: built.negative,
    aspectRatio: built.aspect,
    seed: plan.seed,
    referenceImages,
    fetcher,
  });
  return {
    kind,
    aspect: built.aspect,
    seed: result.seed,
    positive: built.positive,
    negative: built.negative,
    dataUrl: result.dataUrl,
  };
}

function stamp(gallery, items, now) {
  const batch = gallery.addBatch(items);
  batch.createdAt = now();
  return batch;
}

export async function generateKind({
  kind,
  state,
  gallery,
  images,
  fetcher,
  now = () => Date.now(),
  randomSeed = defaultSeed,
}) {
  const count = kind === '基准立绘' ? 4 : 1;
  const used = new Set();
  const items = [];
  for (let i = 0; i < count; i += 1) {
    items.push(await produceOne({ kind, state, gallery, images, fetcher, randomSeed, used }));
  }
  return stamp(gallery, items, now);
}

export async function generateSuite({
  state,
  gallery,
  images,
  fetcher,
  now = () => Date.now(),
  randomSeed = defaultSeed,
}) {
  if (!gallery.base()) {
    await generateKind({ kind: '基准立绘', state, gallery, images, fetcher, now, randomSeed });
    return { stopped: true };
  }
  const used = new Set();
  const items = [];
  for (const kind of SUITE) {
    items.push(await produceOne({ kind, state, gallery, images, fetcher, randomSeed, used }));
  }
  stamp(gallery, items, now);
  return { stopped: false };
}
