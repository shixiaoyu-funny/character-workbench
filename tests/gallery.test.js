import assert from 'node:assert/strict';
import test from 'node:test';

import { createGallery, loadPersisted } from '../src/gallery.js';
import { generateKind, generateSuite, requestImagesStream, browserStreamFetcher, isStopped } from '../src/generate.js';
import { BASE_IMAGE_MODEL, CHIBI_IMAGE_MODEL, SUITE_IMAGE_MODEL, TUNE_IMAGE_MODEL, modelForGenerate } from '../src/imageModels.js';
import { defaultState } from '../src/state.js';

const PNG = 'data:image/png;base64,AA==';
const UPLOAD = 'data:image/png;base64,UPLOAD';
const BASE = 'data:image/png;base64,BASE';
const STYLE = 'data:image/png;base64,STYLE';
const STYLE2 = 'data:image/png;base64,STYLE2';
const LOCK = '(same face as reference:1.5)';
// Q 版锁脸句点名「第 1 张」：风格图排在角色图后面，写成 reference 会去抄风格图的脸与瞳色。
const CHIBI_LOCK = '(same face as the first reference:1.5)';

function item(overrides) {
  return {
    kind: '基准立绘',
    aspect: '3:4',
    seed: 1,
    positive: 'one',
    negative: 'neg',
    dataUrl: PNG,
    ...overrides,
  };
}

// 模拟服务端 SSE 流：记录 /api/generate-stream 调用并逐张回传；failOn 命中第 N 张时抛错。
function recording({ styleImages = [], failOn = 0 } = {}) {
  const fetcherCalls = [];
  const fetcher = async (url) => {
    fetcherCalls.push({ url });
    return { images: styleImages };
  };
  const streamCalls = [];
  let events = 0;
  const streamFetcher = async (url, init, onEvent) => {
    streamCalls.push({ url, init });
    const { jobs } = JSON.parse(init.body);
    for (let i = 0; i < jobs.length; i += 1) {
      events += 1;
      if (failOn && events === failOn) throw new Error('上游失败');
      onEvent({ index: i, seed: jobs[i].seed, dataUrl: PNG, url: null, id: null });
    }
    onEvent({ done: true });
  };
  return { fetcherCalls, streamCalls, fetcher, streamFetcher };
}

function jobsOf(calls) {
  return calls
    .filter((entry) => entry.url === '/api/generate-stream')
    .flatMap((entry) => JSON.parse(entry.init.body).jobs);
}

function chibiCalls(calls) {
  return calls.filter((entry) => entry.url === '/api/chibi-style');
}

function kindOf(prompt) {
  if (prompt.includes('clothing parts breakdown')) return '服饰拆解图';
  if (prompt.includes('expression chart')) return '表情差分图';
  if (prompt.includes('multiple views')) return '三视图';
  if (prompt.includes('chibi')) return 'Q版形象';
  if (prompt.includes('character design')) return '基准立绘';
  return '';
}

function sequence(start = 1) {
  let n = start;
  return () => n++;
}

function lockBase(gallery, seed = 42, dataUrl = BASE) {
  const batch = gallery.addBatch([item({ seed, dataUrl, positive: 'base' })]);
  gallery.select(batch.items[0].id);
  assert.equal(gallery.lockSelected(), seed);
  return batch.items[0];
}

// 伪造的 response.body：把若干 SSE 帧按块逐个吐出。
function sseBody(frames) {
  const encoder = new TextEncoder();
  const chunks = frames.map((frame) => encoder.encode(frame));
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i < chunks.length) return { done: false, value: chunks[i++] };
          return { done: true, value: undefined };
        },
      };
    },
  };
}

test('two batches keep their own items', () => {
  const gallery = createGallery();
  const first = gallery.addBatch([
    item({ seed: 1, positive: 'one', dataUrl: 'data:image/png;base64,AA==' }),
    item({ seed: 2, positive: 'two', kind: '三视图', aspect: '16:9' }),
  ]);
  const second = gallery.addBatch([
    item({ seed: 3, positive: 'three', kind: '表情差分图', dataUrl: 'data:image/png;base64,BB==' }),
  ]);
  assert.equal(gallery.batches().length, 2);
  assert.equal(first.status, 'complete');
  assert.equal(second.status, 'complete');
  assert.notEqual(first.id, second.id);
  assert.equal(typeof first.createdAt, 'number');
  assert.equal(gallery.batches()[0].items.length, 2);
  assert.equal(gallery.batches()[0].items[0].positive, 'one');
  assert.equal(gallery.batches()[0].items[0].seed, 1);
  assert.equal(gallery.batches()[0].items[1].kind, '三视图');
  assert.equal(gallery.batches()[1].items.length, 1);
  assert.equal(gallery.batches()[1].items[0].positive, 'three');
  assert.equal(gallery.batches()[1].items[0].dataUrl, 'data:image/png;base64,BB==');
  assert.notEqual(gallery.batches()[0].items[0].id, gallery.batches()[1].items[0].id);
});

test('loadPersisted groups records by batch_id and marks them remote', () => {
  const gallery = createGallery();
  const added = loadPersisted(gallery, [
    { id: 3, url: 'https://cdn/q.png', kind: 'Q版形象', aspect: '1:1', seed: 3, positive: 'p', negative: 'n', batch_id: 'b2', base: null, createdAt: '2026-10-29T06:00:00+00:00' },
    { id: 1, url: 'https://cdn/t.png', kind: '三视图', aspect: '16:9', seed: 1, positive: 'p', negative: 'n', batch_id: 'b1', base: { url: 'https://cdn/base.png', seed: 9 }, createdAt: '2026-10-29T05:00:00+00:00' },
    { id: 2, url: 'https://cdn/e.png', kind: '表情差分图', aspect: '1:1', seed: 2, positive: 'p', negative: 'n', batch_id: 'b1', base: { url: 'https://cdn/base.png', seed: 9 }, createdAt: '2026-10-29T05:00:00+00:00' },
  ]);
  assert.equal(added, 3);
  const batches = gallery.batches();
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0].items.map((entry) => entry.kind), ['三视图', '表情差分图']);
  assert.deepEqual(batches[1].items.map((entry) => entry.kind), ['Q版形象']);
  const { fileKey, ...base } = batches[0].base;
  assert.match(fileKey, /^[0-9a-f]{6}-\d{8}-\d{6}$/);
  assert.deepEqual(base, { dataUrl: 'https://cdn/base.png', url: 'https://cdn/base.png', seed: 9, remote: true });
  assert.equal(batches[0].history, true);
  assert.equal(batches[1].history, true);
  assert.equal(batches[0].items[0].remote, true);
  assert.equal(batches[0].items[0].url, 'https://cdn/t.png');
  assert.equal(batches[0].items[0].dataUrl, 'https://cdn/t.png');
  assert.equal(batches[1].base, null);
});

test('loadPersisted keeps sqlite ids and the earliest generation time', () => {
  const gallery = createGallery();
  loadPersisted(gallery, [
    { id: 2, url: 'https://cdn/e.png', kind: '表情差分图', aspect: '1:1', seed: 2, positive: 'p', negative: 'n', batch_id: 'b1', base: { url: 'https://cdn/base.png', seed: 9 }, createdAt: '2026-10-29T06:00:05+00:00' },
    { id: 1, url: 'https://cdn/t.png', kind: '三视图', aspect: '16:9', seed: 1, positive: 'p', negative: 'n', batch_id: 'b1', base: { url: 'https://cdn/base.png', seed: 9 }, createdAt: '2026-10-29T06:00:00+00:00' },
  ]);
  const batch = gallery.batches()[0];
  assert.equal(batch.createdAt, Date.parse('2026-10-29T06:00:00+00:00'));
  assert.deepEqual(batch.items.map((entry) => entry.recordId), [1, 2]);
  assert.equal(batch.items[0].createdAt, Date.parse('2026-10-29T06:00:00+00:00'));
});

test('removing a picture clears a lock that pointed at it', () => {
  const gallery = createGallery();
  const batch = gallery.addBatch([
    item({ seed: 7, dataUrl: BASE, id: 41 }),
    item({ seed: 8, dataUrl: UPLOAD, kind: '三视图', id: 42 }),
  ]);
  assert.equal(batch.items[0].recordId, 41);
  const turnaroundId = batch.items[1].id;
  gallery.setBase(batch.items[0]);
  gallery.setClothingPair({
    id: turnaroundId,
    base: { dataUrl: BASE, seed: 7 },
    turnaround: batch.items[1],
  });
  const removed = gallery.removeItem(batch.items[0].id);
  assert.equal(removed.recordId, 41);
  assert.equal(gallery.base(), null);
  assert.equal(gallery.clothingPair().id, turnaroundId);
  gallery.removeBatch(gallery.batches()[0].id);
  assert.equal(gallery.batches().length, 0);
  assert.equal(gallery.clothingPair(), null);
});

test('lockSelected returns the selected seed and null when nothing is selected', () => {
  const gallery = createGallery();
  assert.equal(gallery.selected(), null);
  assert.equal(gallery.lockSelected(), null);
  assert.equal(gallery.base(), null);
  const batch = gallery.addBatch([
    item({ seed: 7, dataUrl: BASE }),
    item({ seed: 8, dataUrl: UPLOAD, kind: '三视图' }),
  ]);
  gallery.select(batch.items[1].id);
  assert.equal(gallery.selected().seed, 8);
  assert.equal(gallery.lockSelected(), 8);
  assert.deepEqual(gallery.base(), { dataUrl: UPLOAD, url: null, seed: 8 });
});

test('setBase and lockSelected carry the character state snapshot', () => {
  const gallery = createGallery();
  const state = { ...defaultState(), hairColor: '金' };
  const batch = gallery.addBatch([item({ seed: 7, dataUrl: BASE, state })]);
  gallery.setBase(batch.items[0]);
  assert.deepEqual(gallery.base(), { dataUrl: BASE, url: null, seed: 7, state });
  // lockSelected 走同一份 state。
  gallery.select(batch.items[0].id);
  assert.equal(gallery.lockSelected(), 7);
  assert.deepEqual(gallery.base(), { dataUrl: BASE, url: null, seed: 7, state });
});

test('loadPersisted restores the saved state snapshot', () => {
  const gallery = createGallery();
  const state = { ...defaultState(), hairColor: '银' };
  loadPersisted(gallery, [{
    id: 5,
    url: BASE,
    kind: '基准立绘',
    aspect: '3:4',
    seed: 7,
    positive: 'base',
    negative: 'neg',
    batch_id: 'b1',
    base: null,
    state,
    createdAt: '2026-11-05T12:00:00+00:00',
  }]);
  const item = gallery.batches()[0].items[0];
  assert.deepEqual(item.state, state);
});

test('requestImagesStream posts all jobs once and maps results by index', async () => {
  const seen = [];
  const jobs = [
    { prompt: 'p1', seed: 5 },
    { prompt: 'p2', seed: 6 },
  ];
  const results = [];
  await requestImagesStream({
    jobs,
    streamFetcher: async (url, init, onEvent) => {
      seen.push({ url, init });
      onEvent({ index: 1, seed: 6, dataUrl: PNG, url: 'https://cdn/b.png', id: 2 });
      onEvent({ index: 0, seed: 5, dataUrl: PNG, url: null, id: 1 });
      onEvent({ done: true });
    },
    onImage: (index, result) => { results[index] = result; },
  });
  assert.equal(seen[0].url, '/api/generate-stream');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].init.body), { jobs });
  assert.deepEqual(results, [
    { seed: 5, dataUrl: PNG, url: null, id: 1 },
    { seed: 6, dataUrl: PNG, url: 'https://cdn/b.png', id: 2 },
  ]);
});

test('browserStreamFetcher parses SSE frames and throws on error frames', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      body: sseBody([
        'data: {"index":0,"seed":1}\n\n',
        'data: {"index":1,"seed":2}\n\ndata: {"index":2,"error":"boom"}\n\n',
      ]),
    });
    const events = [];
    await assert.rejects(
      () => browserStreamFetcher('/api/generate-stream', { method: 'POST' }, (event) => events.push(event)),
      /boom/,
    );
    assert.deepEqual(events, [{ index: 0, seed: 1 }, { index: 1, seed: 2 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('base portraits without a reference use four different new seeds and no reference image', async () => {
  const gallery = createGallery();
  const { fetcherCalls, streamCalls, fetcher, streamFetcher } = recording();
  const now = () => 1700000000000;
  const batch = await generateKind({
    kind: '基准立绘',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    now,
    randomSeed: sequence(11),
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs.map((body) => body.seed), [11, 12, 13, 14]);
  for (const body of jobs) {
    assert.deepEqual(body.referenceImages, []);
    assert.equal(body.prompt.includes(LOCK), false);
    assert.equal(body.aspectRatio, '3:4');
    assert.equal(kindOf(body.prompt), '基准立绘');
  }
  assert.equal(chibiCalls(fetcherCalls).length, 0);
  assert.equal(gallery.batches().length, 1);
  assert.equal(batch.status, 'complete');
  assert.equal(batch.createdAt, 1700000000000);
  assert.equal(batch.items.length, 4);
  assert.deepEqual(batch.items.map((entry) => entry.seed), [11, 12, 13, 14]);
  assert.equal(batch.items.every((entry) => entry.dataUrl === PNG && entry.kind === '基准立绘'), true);
});

test('base portraits send only the upload and ignore a locked base', async () => {
  const gallery = createGallery();
  lockBase(gallery, 99, BASE);
  const { fetcherCalls, streamCalls, fetcher, streamFetcher } = recording();
  await generateKind({
    kind: '基准立绘',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    streamFetcher,
    randomSeed: sequence(3),
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs.map((body) => body.seed), [3, 4, 5, 6]);
  for (const body of jobs) {
    assert.deepEqual(body.referenceImages, [UPLOAD]);
    assert.equal(body.prompt.includes(LOCK), true);
  }
  assert.equal(chibiCalls(fetcherCalls).length, 0);
});

test('base portraits send no reference when a base is locked but nothing was uploaded', async () => {
  const gallery = createGallery();
  lockBase(gallery, 99, BASE);
  const { streamCalls, fetcher, streamFetcher } = recording();
  await generateKind({
    kind: '基准立绘',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(3),
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 4);
  for (const body of jobs) {
    assert.deepEqual(body.referenceImages, []);
    assert.notEqual(body.seed, 99);
    assert.equal(body.prompt.includes(LOCK), false);
  }
});

test('a turnaround with a locked base reuses that image and seed', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { streamCalls, fetcher, streamFetcher } = recording();
  await generateKind({
    kind: '三视图',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    streamFetcher,
    randomSeed: () => {
      throw new Error('should reuse the base seed');
    },
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].seed, 42);
  assert.deepEqual(jobs[0].referenceImages, [BASE]);
  assert.equal(jobs[0].aspectRatio, '16:9');
  assert.equal(jobs[0].prompt.includes(LOCK), true);
  assert.equal(kindOf(jobs[0].prompt), '三视图');
  assert.equal(gallery.batches().at(-1).items.length, 1);
});

test('without a base an upload is the reference and the seed is new', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording();
  await generateKind({
    kind: '表情差分图',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    streamFetcher,
    randomSeed: sequence(70),
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].seed, 70);
  assert.deepEqual(jobs[0].referenceImages, [UPLOAD]);
  assert.equal(jobs[0].prompt.includes(LOCK), true);
  assert.equal(kindOf(jobs[0].prompt), '表情差分图');
});

test('without a base or an upload there is no reference image', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording();
  await generateKind({
    kind: '三视图',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(5),
  });
  const job = jobsOf(streamCalls)[0];
  assert.equal(job.seed, 5);
  assert.deepEqual(job.referenceImages, []);
  assert.equal(job.prompt.includes(LOCK), false);
});

test('clothing breakdown sends the selected base then its turnaround', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  gallery.setClothingPair({
    id: 'pair-1',
    base: { dataUrl: BASE, url: null, seed: 42 },
    turnaround: { dataUrl: UPLOAD, url: null, seed: 9 },
  });
  const { fetcherCalls, streamCalls, fetcher, streamFetcher } = recording();
  await generateKind({
    kind: '服饰拆解图',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    streamFetcher,
    randomSeed: sequence(77),
  });
  const job = jobsOf(streamCalls)[0];
  assert.equal(gallery.base().dataUrl, BASE);
  assert.equal(gallery.base().seed, 42);
  assert.equal(job.seed, 42);
  assert.deepEqual(job.referenceImages, [BASE, UPLOAD]);
  assert.equal(job.aspectRatio, '1:1');
  assert.equal(job.prompt.includes(LOCK), false);
  assert.equal(job.prompt.includes('each garment and accessory appears only once'), true);
  assert.equal(job.negativePrompt.includes('wearing clothes, text, arrows'), true);
  assert.equal(chibiCalls(fetcherCalls).length, 0);
});

test('hand breakdown sends the same base plus turnaround as the clothing sheet', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  gallery.setClothingPair({
    id: 'pair-1',
    base: { dataUrl: BASE, url: null, seed: 42 },
    turnaround: { dataUrl: UPLOAD, url: null, seed: 9 },
  });
  const { fetcherCalls, streamCalls, fetcher, streamFetcher } = recording();
  await generateKind({
    kind: '手部拆解图',
    state: { ...defaultState(), handAspect: '4:3' },
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(77),
  });
  const job = jobsOf(streamCalls)[0];
  assert.equal(job.seed, 42);
  assert.deepEqual(job.referenceImages, [BASE, UPLOAD]);
  assert.equal(job.aspectRatio, '4:3');
  assert.equal(job.prompt.includes('(hand gestures sheet:1.5)'), true);
  assert.equal(job.negativePrompt.includes('(bad anatomy, deformed hands'), true);
  assert.equal(job.prompt.includes(LOCK), false);
  assert.equal(chibiCalls(fetcherCalls).length, 0);
});

test('hand breakdown without a selected pair refuses to start', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording();
  await assert.rejects(() => generateKind({
    kind: '手部拆解图',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(77),
  }), /请先在下载页的服饰基准里选定一组/);
  assert.equal(streamCalls.length, 0);
});

test('every kind requests 1k', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording();
  await generateKind({
    kind: '三视图',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(1),
  });
  assert.equal(jobsOf(streamCalls)[0].resolution, '1k');

  const gallery2 = createGallery();
  const { streamCalls: chibiCalls2, fetcher: chibiFetcher, streamFetcher: chibiStream } = recording({ styleImages: [STYLE] });
  await generateKind({
    kind: 'Q版形象',
    state: defaultState(),
    gallery: gallery2,
    images: { reference: null },
    fetcher: chibiFetcher,
    streamFetcher: chibiStream,
    randomSeed: sequence(1),
  });
  assert.equal(jobsOf(chibiCalls2)[0].resolution, '1k');
});

test('chibi appends the style images after the character image', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { fetcherCalls, streamCalls, fetcher, streamFetcher } = recording({ styleImages: [STYLE, STYLE2] });
  await generateKind({
    kind: 'Q版形象',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    streamFetcher,
    randomSeed: () => {
      throw new Error('should reuse the base seed');
    },
  });
  assert.equal(chibiCalls(fetcherCalls).length, 1);
  const job = jobsOf(streamCalls)[0];
  assert.equal(job.seed, 42);
  assert.deepEqual(job.referenceImages, [BASE, STYLE, STYLE2]);
  assert.equal(job.prompt.includes(CHIBI_LOCK), true);
  // 两张风格图时，逐图声明必须点名「第 2 张到第 3 张」，并禁止照抄瞳色/发型/服饰。
  assert.equal(job.prompt.includes('第 1 张是角色参考图'), true);
  assert.equal(job.prompt.includes('第 2 张到第 3 张是画风参考图'), true);
  assert.equal(job.prompt.includes('(eye color exactly as the first reference:1.6)'), true);
  assert.equal(/图\d/.test(job.prompt), false, 'style sentence must not leak into prompt');
  assert.equal(kindOf(job.prompt), 'Q版形象');
  // Q 版固定用千问：单张生成由 modelForGenerate('Q版形象') 指定。
  assert.equal(job.model, CHIBI_IMAGE_MODEL);
  assert.equal(modelForGenerate('Q版形象'), 'qwen-image-3.0');
});

test('model routing keeps chibi on qwen and the rest on the suite model', () => {
  assert.equal(modelForGenerate('基准立绘'), BASE_IMAGE_MODEL);
  assert.equal(modelForGenerate('Q版形象'), CHIBI_IMAGE_MODEL);
  assert.equal(modelForGenerate('三视图'), SUITE_IMAGE_MODEL);
  assert.equal(modelForGenerate('表情差分图'), SUITE_IMAGE_MODEL);
  assert.equal(modelForGenerate('服饰拆解图'), SUITE_IMAGE_MODEL);
  assert.equal(modelForGenerate('手部拆解图'), SUITE_IMAGE_MODEL);
  assert.equal(modelForGenerate(undefined), SUITE_IMAGE_MODEL);
  // 定向微调回退到 Gemini：千问那版多姿态多机位的稳定性不够。
  assert.equal(TUNE_IMAGE_MODEL, 'gemini-3-pro-image-c');
});

test('chibi can send the style images alone when there is no character image', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording({ styleImages: [STYLE, STYLE2] });
  await generateKind({
    kind: 'Q版形象',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(8),
  });
  const job = jobsOf(streamCalls)[0];
  assert.equal(job.seed, 8);
  assert.deepEqual(job.referenceImages, [STYLE, STYLE2]);
  assert.equal(/图\d/.test(job.prompt), false, 'style sentence must not leak into prompt');
  assert.equal(job.prompt.includes(LOCK), false);
  assert.equal(job.prompt.includes('oval face'), true);
});

test('chibi caps reference images at three for qwen-image-3.0', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { streamCalls, fetcher, streamFetcher } = recording({
    styleImages: [STYLE, STYLE2, 'data:image/png;base64,S3', 'data:image/png;base64,S4', 'data:image/png;base64,S5'],
  });
  await generateKind({
    kind: 'Q版形象',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: () => {
      throw new Error('should reuse the base seed');
    },
  });
  const job = jobsOf(streamCalls)[0];
  assert.equal(job.seed, 42);
  assert.deepEqual(job.referenceImages, [BASE, STYLE, STYLE2]);
  assert.equal(job.model, 'qwen-image-3.0');
});

test('a wider model keeps more chibi style references and records its id', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const extra = ['data:image/png;base64,S3', 'data:image/png;base64,S4', 'data:image/png;base64,S5'];
  const { streamCalls, fetcher, streamFetcher } = recording({
    styleImages: [STYLE, STYLE2, ...extra],
  });
  await generateKind({
    kind: 'Q版形象',
    model: 'qwen-image-2.1-pro',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: () => 1,
  });
  const job = jobsOf(streamCalls)[0];
  assert.equal(job.model, 'qwen-image-2.1-pro');
  assert.deepEqual(job.referenceImages, [BASE, STYLE, STYLE2, ...extra]);
});

test('a base-portrait batch keeps the upload captured when the click starts', async () => {
  const gallery = createGallery();
  const images = { reference: UPLOAD };
  const nextUpload = 'data:image/png;base64,NEXT';
  const { streamCalls, fetcher, streamFetcher } = recording();
  let flipped = false;
  const wrappedStream = async (url, init, onEvent) => {
    await streamFetcher(url, init, (event) => {
      onEvent(event);
      if (!flipped && event.index === 0 && !event.done) {
        flipped = true;
        images.reference = nextUpload;
        const extra = gallery.addBatch([item({ seed: 99, dataUrl: 'data:image/png;base64,NEW' })]);
        gallery.select(extra.items[0].id);
        gallery.lockSelected();
      }
    });
  };
  await generateKind({
    kind: '基准立绘',
    state: defaultState(),
    gallery,
    images,
    fetcher,
    streamFetcher: wrappedStream,
    randomSeed: sequence(3),
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs.map((body) => body.seed), [3, 4, 5, 6]);
  for (const body of jobs) {
    assert.deepEqual(body.referenceImages, [UPLOAD]);
    assert.equal(body.prompt.includes(LOCK), true);
  }
  assert.equal(gallery.base().seed, 99);
  assert.equal(images.reference, nextUpload);
});

test('a suite requires a locked base', async () => {
  const gallery = createGallery();
  const { fetcher, streamFetcher } = recording();
  await assert.rejects(
    () => generateSuite({
      state: defaultState(),
      gallery,
      images: { reference: UPLOAD },
      fetcher,
      streamFetcher,
      randomSeed: sequence(20),
    }),
    /请先选择合适的基准立绘/,
  );
  assert.equal(gallery.batches().length, 0);
});

test('chibi without a style image sends only the character reference', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording({ styleImages: [] });
  await generateKind({
    kind: 'Q版形象',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    streamFetcher,
    randomSeed: sequence(9),
  });
  const job = jobsOf(streamCalls)[0];
  assert.equal(job.seed, 9);
  assert.deepEqual(job.referenceImages, [UPLOAD]);
  assert.equal(job.prompt.includes(CHIBI_LOCK), true);
  // 没有风格图时不能有逐图分工声明。
  assert.equal(/第 \d+ 张/.test(job.prompt), false);
  assert.equal(/图\d/.test(job.prompt), false, 'style sentence must not leak into prompt');
});

test('a failed request does not store a partial batch', async () => {
  const gallery = createGallery();
  const { fetcher, streamFetcher } = recording({ failOn: 3 });
  await assert.rejects(
    () => generateKind({
      kind: '基准立绘',
      state: defaultState(),
      gallery,
      images: { reference: null },
      fetcher,
      streamFetcher,
      randomSeed: sequence(1),
    }),
    /上游失败/,
  );
  assert.equal(gallery.batches().length, 0);
});

test('a suite generates the four follow-up kinds referencing the locked base', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { fetcherCalls, streamCalls, fetcher, streamFetcher } = recording({ styleImages: [STYLE] });
  const result = await generateSuite({
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(1),
  });
  assert.deepEqual(result, { stopped: false, completed: 1, skippedClothing: 0 });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs.map((body) => kindOf(body.prompt)),
    ['三视图', 'Q版形象', '表情差分图', '服饰拆解图']);
  assert.equal(jobs[0].seed, 42);
  assert.equal(jobs[1].seed, 42);
  assert.equal(jobs[2].seed, 42);
  assert.equal(jobs[3].seed, 42);
  assert.deepEqual(jobs[0].referenceImages, [BASE]);
  assert.deepEqual(jobs[1].referenceImages, [BASE, STYLE]);
  assert.deepEqual(jobs[2].referenceImages, [BASE]);
  assert.deepEqual(jobs[3].referenceImages, [BASE, PNG]);
  assert.equal(jobs[2].prompt.includes(LOCK), true);
  assert.equal(jobs[3].prompt.includes(LOCK), false);
  assert.equal(jobs[3].prompt.includes('each garment and accessory appears only once'), true);
  assert.equal(chibiCalls(fetcherCalls).length, 1);
  const batch = gallery.batches()[1];
  assert.equal(batch.items.length, 4);
  assert.deepEqual(batch.items.map((entry) => entry.kind),
    ['三视图', '表情差分图', '服饰拆解图', 'Q版形象']);
  assert.equal(batch.base.dataUrl, BASE);
  assert.equal(batch.base.seed, 42);
  assert.match(batch.base.fileKey, /^[0-9a-f]{6}-\d{8}-\d{6}$/);
  assert.equal(batch.status, 'complete');
});

test('a suite uses the locked base character state, not the current form', async () => {
  const gallery = createGallery();
  const baseState = { ...defaultState(), hairColor: '金' };
  gallery.addBatch([item({ seed: 42, dataUrl: BASE, positive: 'base', state: baseState })]);
  gallery.select(gallery.batches()[0].items[0].id);
  gallery.lockSelected();
  const formState = { ...defaultState(), hairColor: '黑' };
  const { streamCalls, fetcher, streamFetcher } = recording();
  await generateSuite({
    state: formState,
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(1),
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 4);
  // 三视图/Q版/表情都该用基准保存的发色（金），而不是表单里的黑。
  for (const job of jobs.slice(0, 3)) {
    assert.match(job.prompt, /blonde hair/);
    assert.doesNotMatch(job.prompt, /black hair/);
  }
});

test('a suite without a saved base state falls back to the form', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const formState = { ...defaultState(), hairColor: '黑' };
  const { streamCalls, fetcher, streamFetcher } = recording();
  await generateSuite({
    state: formState,
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(1),
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 4);
  assert.match(jobs[0].prompt, /black hair/);
});

test('a suite sends the chibi job to qwen even when the suite model is gemini', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { streamCalls, fetcher, streamFetcher } = recording({ styleImages: [STYLE] });
  await generateSuite({
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(1),
    model: 'gemini-3-pro-image-c',
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 4);
  assert.equal(jobs[0].model, 'gemini-3-pro-image-c');
  assert.equal(jobs[1].model, 'qwen-image-3.0', 'chibi overrides the suite model');
  assert.equal(jobs[2].model, 'gemini-3-pro-image-c');
  assert.equal(jobs[3].model, 'gemini-3-pro-image-c');
});

test('a suite can generate multiple sets and each records the same locked base', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { fetcherCalls, streamCalls, fetcher, streamFetcher } = recording();
  await generateSuite({
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(7),
    suiteCount: 2,
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 8);
  assert.equal(chibiCalls(fetcherCalls).length, 2);
  const added = gallery.batches().slice(1);
  assert.equal(added.length, 2);
  for (const batch of added) {
    assert.equal(batch.items.length, 4);
    assert.deepEqual(batch.items.map((entry) => entry.kind),
      ['三视图', '表情差分图', '服饰拆解图', 'Q版形象']);
    assert.equal(batch.base.dataUrl, BASE);
  assert.equal(batch.base.seed, 42);
  assert.match(batch.base.fileKey, /^[0-9a-f]{6}-\d{8}-\d{6}$/);
    assert.equal(batch.status, 'complete');
  }
});

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

test('stopping mid-stream throws a stop error and saves nothing', async () => {
  const gallery = createGallery();
  const controller = new AbortController();
  const streamFetcher = async (url, init, onEvent) => {
    const { jobs } = JSON.parse(init.body);
    // 先回显一张，再模拟浏览器 abort 掐断连接。
    onEvent({ index: 0, seed: jobs[0].seed, dataUrl: PNG, url: null, id: null });
    controller.abort();
    throw abortError();
  };
  await assert.rejects(
    () => generateKind({
      kind: '基准立绘',
      state: defaultState(),
      gallery,
      images: { reference: null },
      streamFetcher,
      signal: controller.signal,
      randomSeed: sequence(1),
    }),
    (error) => isStopped(error),
  );
  assert.equal(gallery.batches().length, 0, 'in-flight images are discarded');
});

test('stopping a suite keeps finished sets and drops the rest', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const controller = new AbortController();
  let calls = 0;
  const streamFetcher = async (url, init, onEvent) => {
    calls += 1;
    const { jobs } = JSON.parse(init.body);
    if (calls === 3) {
      controller.abort();
      throw abortError();
    }
    for (let i = 0; i < jobs.length; i += 1) {
      onEvent({ index: i, seed: jobs[i].seed, dataUrl: PNG, url: null, id: null });
    }
  };
  const result = await generateSuite({
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher: async () => ({ images: [] }),
    streamFetcher,
    signal: controller.signal,
    randomSeed: sequence(7),
    suiteCount: 2,
  });
  assert.equal(result.stopped, true);
  assert.equal(result.completed, 1);
  // 初始一条是锁定的基准批，只有第一套写进去了。
  assert.equal(gallery.batches().length, 2);
  assert.equal(gallery.batches()[1].items.length, 4);
});

test('a request stopped before it starts never opens the stream', async () => {
  const gallery = createGallery();
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    () => requestImagesStream({
      jobs: [{ prompt: 'x' }],
      streamFetcher: async () => { called = true; },
      signal: controller.signal,
    }),
    (error) => isStopped(error),
  );
  assert.equal(called, false);
  assert.equal(gallery.batches().length, 0);
});


// 瞳色永远取当前表单，而不是基准图当年保存的那份 state：
// 老基准里没有这个字段，若不覆盖，用户改了瞳色后续图也吃不到。
test('the current eye colour wins over the locked base snapshot', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording();
  const BASE = 'data:image/png;base64,BASEIMG';
  // 锁定一张「旧」基准：它的 state 里没有 eyeColor。
  const oldState = { ...defaultState() };
  delete oldState.eyeColor;
  delete oldState.eyeColorCustom;
  gallery.setBase({ id: 'b1', kind: '基准立绘', dataUrl: BASE, url: null, seed: 7, state: oldState });
  await generateKind({
    kind: 'Q版形象',
    state: { ...defaultState(), eyeColor: '棕' },
    gallery,
    images: { reference: null },
    fetcher,
    streamFetcher,
    randomSeed: sequence(3),
  });
  const job = jobsOf(streamCalls)[0];
  assert.ok(job.prompt.includes('brown eyes'), 'current eye colour must reach the prompt');
  assert.ok(job.prompt.includes('瞳色固定为「棕」'));
});

// 热门Q版：两张正比图在前，风格图只取 1 张排在最后；张数走 baseCount。
test('hot chibi feeds two character sheets then exactly one style reference', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording({ styleImages: [STYLE, STYLE2] });
  const A = 'data:image/png;base64,HOTA';
  const B = 'data:image/png;base64,HOTB';
  await generateKind({
    kind: '热门Q版',
    state: defaultState(),
    gallery,
    images: {},
    fetcher,
    streamFetcher,
    randomSeed: sequence(5),
    snapshot: { upload: null, base: null, clothingPair: null, hots: [A, B] },
    baseCount: 2,
  });
  const jobs = jobsOf(streamCalls);
  assert.equal(jobs.length, 2, 'baseCount 2 must produce two images');
  assert.deepEqual(jobs[0].referenceImages, [A, B, STYLE]);
  assert.equal(jobs[0].model, 'qwen-image-3.0');
  assert.ok(jobs[0].prompt.includes('图 3 只提供 Q 版画法'));
});

test('hot chibi works with a single character sheet', async () => {
  const gallery = createGallery();
  const { streamCalls, fetcher, streamFetcher } = recording({ styleImages: [STYLE] });
  const A = 'data:image/png;base64,HOTA';
  await generateKind({
    kind: '热门Q版',
    state: defaultState(),
    gallery,
    images: {},
    fetcher,
    streamFetcher,
    randomSeed: sequence(6),
    snapshot: { upload: null, base: null, clothingPair: null, hots: [A] },
  });
  const job = jobsOf(streamCalls)[0];
  assert.deepEqual(job.referenceImages, [A, STYLE]);
  assert.ok(job.prompt.includes('图 2 只提供 Q 版画法'));
});
