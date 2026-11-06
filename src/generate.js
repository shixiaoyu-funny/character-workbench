// 生图计划：拼提示词、定参考图、排波次，产出「步骤计划」（step plan）。
// 计划要么交给服务端任务队列串行执行（dom.js 的正路），要么由 executePlanLocally
// 在浏览器里就地跑（测试与离线兜底用）。两条路吃的是同一份计划，不会走偏。
//
// 图片、种子和提示词只留在内存里；服务端执行时整份计划会落到 data/tasks/<id>/。

import { buildPrompt, buildTunePrompt, tuneCombinations } from './prompts.js';
import { CHIBI_IMAGE_MODEL, DEFAULT_IMAGE_MODEL, TUNE_IMAGE_MODEL, resolveImageModel } from './imageModels.js';
import { applyLinkage } from './rules.js';

const SEED_MAX = 2147483647;
const SUITE = ['三视图', '表情差分图', '服饰拆解图', 'Q版形象'];
// 这两类拆解图都不用锁脸基准，而是用下载页里「服饰基准」选定的那一组（基准立绘 + 配套三视图）。
const PAIR_SHEETS = ['服饰拆解图', '手部拆解图'];
// 引用「本任务里前面某个 step 的产物」的记号前缀，只在计划内部使用。
const STEP_TOKEN_PREFIX = 'step:';

export function isPairSheet(kind) {
  return PAIR_SHEETS.includes(kind);
}

// 用户点「停止生成」后统一的错误类型：调用方据此区分「用户主动停」和「真失败」。
export class GenerationStopped extends Error {
  constructor() {
    super('已停止生成');
    this.name = 'GenerationStopped';
    this.stopped = true;
  }
}

export function isStopped(error) {
  return Boolean(error && (error.stopped === true || error.name === 'AbortError'
    || error.name === 'GenerationStopped'));
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw new GenerationStopped();
}

function defaultSeed() {
  return Math.floor(Math.random() * SEED_MAX);
}

function newBatchId() {
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

// 流式请求：POST 后读取 response.body，按 SSE 帧（\n\n 分隔、data: 行）逐条回调。
// 整批级错误仍然抛出。tolerateItemErrors 时，单张失败帧交给调用方，不掐断同批另一张。
export async function browserStreamFetcher(url, init, onEvent, options = {}) {
  const tolerateItemErrors = Boolean(options && options.tolerateItemErrors);
  const signal = init && init.signal;
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // 用户按下停止：fetch 被 AbortController 掐断，这里统一转成停止信号。
    if (signal && signal.aborted) throw new GenerationStopped();
    throw error;
  }
  if (!response.ok) {
    let message = `生成失败 (${response.status})`;
    try {
      const data = await response.json();
      if (data && data.error) message = data.error;
    } catch {
      // 非 JSON 错误体：沿用状态码文案。
    }
    throw new Error(message);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('当前环境不支持流式响应');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (signal && signal.aborted) throw new GenerationStopped();
      throw error;
    }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event.error) {
          if (tolerateItemErrors && Number.isInteger(event.index)) {
            onEvent(event);
            continue;
          }
          try {
            await reader.cancel();
          } catch {
            // 取消读取失败不影响错误上抛。
          }
          throw new Error(event.error);
        }
        // 用户已按停止：这一帧直接丢弃，不再回调。
        if (signal && signal.aborted) throw new GenerationStopped();
        onEvent(event);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

// 一次性提交整批任务；服务器并发逐张回传，onImage(index, result) 每张回调一次。
// result 形如 { seed, dataUrl, url, id }，index 对应 jobs 下标。
export async function requestImagesStream({
  jobs,
  streamFetcher = browserStreamFetcher,
  onImage = () => {},
  tolerateItemErrors = false,
  signal = null,
}) {
  throwIfAborted(signal);
  const seen = new Set();
  await streamFetcher('/api/generate-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs }),
    ...(signal ? { signal } : {}),
  }, (event) => {
    if (event.done || event.error) return;
    if (!Number.isInteger(event.index) || seen.has(event.index)) return;
    if (signal && signal.aborted) return;
    seen.add(event.index);
    onImage(event.index, {
      seed: event.seed,
      dataUrl: event.dataUrl,
      url: event.url || null,
      id: event.id ?? null,
    });
  }, { tolerateItemErrors });
  // 流正常关闭但期间按过停止：已回显的图同样丢弃。
  throwIfAborted(signal);
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

// 一次点击开始时拍下上传图与已锁定基准。同一批里的每一张都用这份快照。
function captureSnapshot(gallery, images) {
  const upload = images && images.reference ? images.reference : null;
  const live = gallery && typeof gallery.base === 'function' ? gallery.base() : null;
  const base = live && live.dataUrl
    ? { dataUrl: live.dataUrl, url: live.url || null, seed: live.seed, ...(live.state ? { state: live.state } : {}) }
    : null;
  const clothingPair = gallery && typeof gallery.clothingPair === 'function' ? gallery.clothingPair() : null;
  return { upload, base, clothingPair };
}

// 锁定基准后，后续图用「基准当初保存的角色配置」写提示词，而不是当前表单：
// 这样选哪张基准立绘就出哪个角色，不会再被左侧表单里残留的旧角色带偏。
// 服饰/手部拆解图吃的是「服饰基准」那组，所以优先取服饰基准的配置。
function lockedCharacterState(snapshot, kind) {
  if (isPairSheet(kind)) {
    const pair = snapshot.clothingPair;
    if (pair && pair.base && pair.base.state) return pair.base.state;
  }
  if (snapshot.base && snapshot.base.state) return snapshot.base.state;
  return null;
}

// 基准立绘永远用新种子；有上传图时只带那一张。其余图种优先用已锁定的基准。
// 拆解图（服饰/手部）用选定的一组：先基准立绘，再配套三视图，种子用基准立绘的种子。
function planShot({ kind, snapshot, randomSeed, used, maxReferences = 10 }) {
  const upload = snapshot.upload;
  const locked = snapshot.base;

  if (isPairSheet(kind)) {
    const pair = snapshot.clothingPair;
    if (pair && pair.base && pair.base.dataUrl && pair.turnaround && pair.turnaround.dataUrl) {
      return {
        seed: pair.base.seed,
        referenceImages: [pair.base.dataUrl, pair.turnaround.dataUrl],
        hasReference: true,
      };
    }
    return { seed: takeSeed(randomSeed, used), referenceImages: [], hasReference: false };
  }
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

// ---------------- 步骤计划 ----------------

// 一个参考图引用：literal 是已经在手上的 dataUrl，step 是指向本任务内某个 step 的产物。
function literal(value) {
  return { kind: 'literal', value };
}

function fromStep(index) {
  return { kind: 'step', index };
}

function toRef(value, transform) {
  if (transform) {
    const mapped = transform(value);
    if (mapped) return mapped;
  }
  if (typeof value === 'string' && value.startsWith(STEP_TOKEN_PREFIX)) {
    return fromStep(Number(value.slice(STEP_TOKEN_PREFIX.length)));
  }
  return literal(value);
}

// 单个 step = 一次模型调用。body 是请求体（不含 referenceImages），ref 是参考图引用顺序表。
async function buildStep({
  kind, title, state, snapshot, randomSeed, used, batchId, base, fetcher, model, transform,
}) {
  const chosen = resolveImageModel(model);
  const plan = planShot({ kind, snapshot, randomSeed, used, maxReferences: chosen.maxReferences });
  let refs = plan.referenceImages.map((value) => toRef(value, transform));
  let styleCount = 0;
  if (kind === 'Q版形象') {
    const data = await fetcher('/api/chibi-style', { method: 'GET' });
    const styles = data && Array.isArray(data.images) ? data.images.filter(Boolean) : [];
    // 风格图只作为多图输入。参考图上限随模型变：qwen-image-3.0 是 3 张，其余到 10 张。
    // 锁脸基准排在风格图前面，名额不够时先丢掉后面的风格图。
    const room = Math.max(0, chosen.maxReferences - refs.length);
    const picked = styles.slice(0, room);
    styleCount = picked.length;
    refs = [...refs, ...picked.map(literal)];
  }
  // 基准立绘本身用当前表单生成（它才是新角色的来源）；其余后续图优先用锁定基准保存的配置。
  const isBase = kind === '基准立绘';
  const effectiveState = isBase ? state : (lockedCharacterState(snapshot, kind) || state);
  const built = buildPrompt(effectiveState, kind, { hasReference: plan.hasReference, styleCount });
  return {
    kind,
    title: title || kind,
    wave: 0,
    body: {
      prompt: built.positive,
      negativePrompt: built.negative,
      aspectRatio: built.aspect,
      seed: plan.seed,
      resolution: '1k',
      kind,
      batchId,
      base,
      model: chosen.id,
      ...(isBase ? { state: effectiveState } : {}),
    },
    ref: refs,
    meta: {
      kind,
      aspect: built.aspect,
      seed: plan.seed,
      positive: built.positive,
      negative: built.negative,
      ...(isBase ? { state: effectiveState } : {}),
    },
  };
}

function makePlan({ title, unit, steps, stamps, tolerateErrors = false, skippedCount = 0 }) {
  return {
    title,
    unit: unit || '张',
    total: steps.length,
    steps,
    stamps: stamps || [],
    tolerateErrors,
    // 局部执行时「等待上游产物」的 step 被跳过的次数（设定集的三视图失败时跳过服饰拆解图）。
    skippedCount,
  };
}

// 把计划里的 literal 引用整理成命名池，避免同一张图在多个 step 里重复 base64。
function serializeRefs(steps) {
  const pool = {};
  const byValue = new Map();
  let next = 0;
  for (const step of steps) {
    step.ref = step.ref.map((ref) => {
      if (ref.kind === 'step') return `#${ref.index}`;
      if (!byValue.has(ref.value)) {
        const name = `r${next}`;
        next += 1;
        byValue.set(ref.value, name);
        pool[name] = ref.value;
      }
      return byValue.get(ref.value);
    });
  }
  return pool;
}

// 计划 -> 提交给 /api/tasks 的载荷（step 顺序即执行顺序，ref 已换成命名/序号）。
export function planToPayload(plan) {
  const steps = plan.steps.map((step) => ({
    kind: step.kind,
    title: step.title,
    body: step.body,
    ref: step.ref.slice(),
  }));
  const refs = serializeRefs(steps);
  return { steps, refs };
}

function resolveRefs(step, results) {
  const out = [];
  for (const ref of step.ref) {
    if (ref.kind === 'step') {
      const item = results.get(ref.index);
      if (!item || !item.dataUrl) return null; // 上游没出图
      out.push(item.dataUrl);
    } else {
      out.push(ref.value);
    }
  }
  return out;
}

function stepWaves(steps) {
  const waves = [];
  let current = [];
  let waveNumber = null;
  steps.forEach((step, index) => {
    if (waveNumber !== null && step.wave !== waveNumber) {
      waves.push(current);
      current = [];
    }
    waveNumber = step.wave;
    current.push(index);
  });
  if (current.length) waves.push(current);
  return waves;
}

// 浏览器内执行计划（本地兜底与测试用）。服务端队列是正路，但两条路产出的
// 请求体和图片集合必须一致，否则「本地能跑、服务端跑不通」这种坑迟早会踩到。
// 每跑完一波就检查有没有整组（stamp）齐了：齐了就立刻入图库，中途停止时已完成的
// 套能保住，这是有意的行为。
export async function executePlanLocally(plan, {
  streamFetcher = browserStreamFetcher,
  signal = null,
  onProgress,
  onImage,
  onStamp,
} = {}) {
  const results = new Map();
  const skipped = new Set();
  const pending = (plan.stamps || []).map((group) => ({ group, done: false }));

  const flush = () => {
    for (const entry of pending) {
      if (entry.done) continue;
      const ready = entry.group.indices.every((index) => results.has(index) || skipped.has(index));
      if (!ready) continue;
      entry.done = true;
      const items = entry.group.indices
        .map((index) => results.get(index))
        .filter((item) => item && item.dataUrl);
      if (entry.group.sort === 'kind') {
        const order = { 三视图: 0, 表情差分图: 1, 服饰拆解图: 2, Q版形象: 3 };
        items.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
      }
      if (items.length && onStamp) onStamp(entry.group, items);
    }
  };

  for (const wave of stepWaves(plan.steps)) {
    throwIfAborted(signal);
    const runnable = [];
    for (const index of wave) {
      const step = plan.steps[index];
      if (onProgress) onProgress({ kind: step.kind, index, count: plan.total });
      if (resolveRefs(step, results) === null) {
        skipped.add(index);
        continue;
      }
      runnable.push(index);
    }
    if (runnable.length) {
      const jobs = runnable.map((index) => {
        const step = plan.steps[index];
        return { ...step.body, referenceImages: resolveRefs(step, results) };
      });
      await requestImagesStream({
        jobs,
        streamFetcher,
        signal,
        tolerateItemErrors: plan.tolerateErrors,
        onImage: (offset, result) => {
          const index = runnable[offset];
          const step = plan.steps[index];
          const item = { ...step.meta, dataUrl: result.dataUrl, url: result.url, id: result.id };
          results.set(index, item);
          if (onImage) onImage(item, index);
        },
      });
    }
    flush();
  }
  return { results, skipped };
}

// 进度文案：中文图种名原样，方便直接拼“正在生成三视图…”。
export function stepLabel(step) {
  return step && step.kind ? step.kind : '图片';
}

// ---------------- 计划构建：三种任务 ----------------

export async function buildKindPlan({
  kind,
  state,
  gallery,
  images,
  fetcher = browserFetcher,
  randomSeed = defaultSeed,
  snapshot,
  baseCount = 4,
  model = DEFAULT_IMAGE_MODEL,
}) {
  const frozen = snapshot || captureSnapshot(gallery, images);
  if (isPairSheet(kind)) {
    const pair = frozen.clothingPair;
    if (!pair || !pair.base || !pair.base.dataUrl || !pair.turnaround || !pair.turnaround.dataUrl) {
      throw new Error('请先在下载页的服饰基准里选定一组');
    }
  }
  const requested = Number.isInteger(baseCount) ? baseCount : 4;
  const count = kind === '基准立绘' ? Math.min(4, Math.max(1, requested)) : 1;
  const used = new Set();
  const batchId = newBatchId();
  const pairBase = isPairSheet(kind) ? frozen.clothingPair.base : null;
  const sourceBase = pairBase || frozen.base;
  const base = kind === '基准立绘' || !sourceBase || !sourceBase.url
    ? null
    : { url: sourceBase.url, seed: sourceBase.seed };
  const steps = [];
  for (let i = 0; i < count; i += 1) {
    steps.push(await buildStep({
      kind, state, snapshot: frozen, randomSeed, used, batchId, base, fetcher, model,
    }));
  }
  const attached = kind === '三视图' && frozen.base && frozen.base.dataUrl
    ? { dataUrl: frozen.base.dataUrl, url: frozen.base.url || null, seed: frozen.base.seed }
    : null;
  return makePlan({
    title: count > 1 ? `生成${kind} · ${count} 张` : `生成${kind}`,
    unit: '张',
    steps,
    stamps: [{ indices: steps.map((_, index) => index), base: attached, sort: null }],
  });
}

export async function buildSuitePlan({
  state,
  gallery,
  images,
  fetcher = browserFetcher,
  randomSeed = defaultSeed,
  suiteCount = 1,
  model = DEFAULT_IMAGE_MODEL,
  modelFor = null,
}) {
  // 可选的按图种选模型：调用方传 modelForGenerate，让设定集里的图与一般页用同一批模型。
  const modelOf = typeof modelFor === 'function'
    ? (kind) => modelFor(kind)
    : (kind) => (kind === 'Q版形象' ? CHIBI_IMAGE_MODEL : model);
  const live = gallery && typeof gallery.base === 'function' ? gallery.base() : null;
  if (!live || !live.dataUrl) throw new Error('请先选择合适的基准立绘');
  // 设定集里的服饰拆解图用本套刚生成的三视图，不用下载页手动选的那一组。
  const snapshot = { ...captureSnapshot(gallery, images), clothingPair: null };
  const count = Math.min(4, Math.max(1, Number.isInteger(suiteCount) ? suiteCount : 1));
  const used = new Set();
  const persistBase = live.url ? { url: live.url, seed: live.seed } : null;
  const attachedBase = {
    dataUrl: live.dataUrl,
    url: live.url || null,
    seed: live.seed,
    ...(live.state ? { state: live.state } : {}),
  };

  const steps = [];
  const stamps = [];
  for (let s = 0; s < count; s += 1) {
    const batchId = newBatchId();
    const first = steps.length;
    const turnaroundStep = first;
    for (const kind of ['三视图', 'Q版形象']) {
      const step = await buildStep({
        kind, state, snapshot, randomSeed, used, batchId, base: persistBase, fetcher, model: modelOf(kind),
      });
      step.wave = s * 2;
      steps.push(step);
    }
    const expressionStep = steps.length;
    const expression = await buildStep({
      kind: '表情差分图', state, snapshot, randomSeed, used, batchId, base: persistBase, fetcher,
      model: modelOf('表情差分图'),
    });
    expression.wave = s * 2 + 1;
    steps.push(expression);
    // 服饰拆解图吃本套刚出的三视图：用 step 起点占位，执行时再换成真实 dataUrl。
    const clothingShot = {
      ...snapshot,
      clothingPair: {
        base: attachedBase,
        turnaround: { dataUrl: `${STEP_TOKEN_PREFIX}${turnaroundStep}`, url: null, seed: null },
      },
    };
    const clothing = await buildStep({
      kind: '服饰拆解图', state, snapshot: clothingShot, randomSeed, used, batchId,
      base: persistBase, fetcher, model: modelOf('服饰拆解图'),
    });
    clothing.wave = s * 2 + 1;
    steps.push(clothing);
    stamps.push({
      indices: [first, expressionStep, steps.length - 1, first + 1],
      base: attachedBase,
      sort: 'kind',
    });
  }
  return makePlan({
    title: count > 1 ? `生成完整设定集 · ${count} 套` : '生成完整设定集',
    unit: '张',
    steps,
    stamps,
    tolerateErrors: true,
  });
}

export async function buildTunePlan({
  state,
  images,
  randomSeed = defaultSeed,
  model = TUNE_IMAGE_MODEL,
  allowBedShoes = false,
}) {
  const sheet = images && images.turnaround;
  const expressions = images && images.expressions;
  // 手部拆解图是可选输入：有就作为第三张参考图，并告诉模型它是什么、只用来参考手。
  const handSheet = images && images.handSheet && String(images.handSheet).startsWith('data:image/')
    ? images.handSheet
    : null;
  const hasSheet = sheet && String(sheet).startsWith('data:image/');
  const hasExpressions = expressions && String(expressions).startsWith('data:image/');
  if (!hasSheet && !hasExpressions) throw new Error('请先上传角色三视图和角色表情图集');
  if (!hasSheet) throw new Error('请先上传角色三视图');
  if (!hasExpressions) throw new Error('请先上传角色表情图集');
  const linked = applyLinkage(state);
  const combos = tuneCombinations(linked);
  const chosen = resolveImageModel(model);
  const used = new Set();
  const batchId = newBatchId();
  const refs = [sheet, expressions, ...(handSheet ? [handSheet] : [])];
  const steps = combos.map((combo) => {
    const built = buildTunePrompt(linked, combo, { allowBedShoes, hasHandSheet: Boolean(handSheet) });
    const seed = takeSeed(randomSeed, used);
    return {
      kind: '微调角色',
      title: '微调角色',
      wave: 0,
      body: {
        prompt: built.positive,
        negativePrompt: built.negative,
        aspectRatio: built.aspect,
        seed,
        resolution: '1k',
        kind: '微调角色',
        batchId,
        base: null,
        model: chosen.id,
      },
      ref: refs.map(literal),
      meta: {
        kind: '微调角色',
        aspect: built.aspect,
        seed,
        positive: built.positive,
        negative: built.negative,
      },
    };
  });
  return makePlan({
    title: `生成微调角色图集 · ${steps.length} 张`,
    unit: '张',
    steps,
    stamps: [{
      indices: steps.map((_, index) => index),
      base: { dataUrl: sheet, url: null, seed: null },
      sort: null,
    }],
    tolerateErrors: true,
  });
}


// ---------------- 本地执行包装（测试与离线兜底） ----------------

function stampGroup(gallery, group, items, now) {
  const batch = gallery.addBatch(items, group.base || null);
  batch.createdAt = now();
  return batch;
}

export async function generateKind(options) {
  const {
    gallery, now = () => Date.now(), streamFetcher = browserStreamFetcher,
    signal = null, onProgress, onImage,
  } = options;
  const plan = await buildKindPlan(options);
  throwIfAborted(signal);
  const batches = [];
  await executePlanLocally(plan, {
    streamFetcher,
    signal,
    onProgress,
    onImage,
    onStamp: (group, items) => batches.push(stampGroup(gallery, group, items, now)),
  });
  throwIfAborted(signal);
  return batches[0] || gallery.addBatch([]);
}

export async function generateSuite(options) {
  const {
    gallery, now = () => Date.now(), streamFetcher = browserStreamFetcher,
    signal = null, onProgress, onImage,
  } = options;
  const plan = await buildSuitePlan(options);
  const batches = [];
  let executed;
  try {
    throwIfAborted(signal);
    executed = await executePlanLocally(plan, {
      streamFetcher,
      signal,
      onProgress,
      onImage,
      onStamp: (group, items) => batches.push(stampGroup(gallery, group, items, now)),
    });
    throwIfAborted(signal);
  } catch (error) {
    // 停止：本套里已回显的图丢弃，之前已经成套保存的保留。
    if (isStopped(error)) {
      return {
        stopped: true,
        completed: batches.length,
        skippedClothing: executed ? executed.skipped.size : 0,
      };
    }
    throw error;
  }
  return { stopped: false, completed: batches.length, skippedClothing: executed.skipped.size };
}

export async function generateTune(options) {
  const {
    gallery, now = () => Date.now(), streamFetcher = browserStreamFetcher,
    signal = null, onProgress, onImage,
  } = options;
  const plan = await buildTunePlan(options);
  throwIfAborted(signal);
  const batches = [];
  await executePlanLocally(plan, {
    streamFetcher,
    signal,
    onProgress,
    onImage,
    onStamp: (group, items) => batches.push(stampGroup(gallery, group, items, now)),
  });
  // 中途停止：整批微调图丢弃，不写进图库。
  throwIfAborted(signal);
  const ready = batches[0] ? batches[0].items.length : 0;
  if (!ready) throw new Error('微调角色图生成失败');
  return { batch: batches[0], failed: plan.steps.length - ready };
}
