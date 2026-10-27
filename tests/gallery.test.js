import assert from 'node:assert/strict';
import test from 'node:test';

import { createGallery } from '../src/gallery.js';
import { generateKind, generateSuite, requestImage } from '../src/generate.js';
import { defaultState } from '../src/state.js';

const PNG = 'data:image/png;base64,AA==';
const UPLOAD = 'data:image/png;base64,UPLOAD';
const BASE = 'data:image/png;base64,BASE';
const STYLE = 'data:image/png;base64,STYLE';
const LOCK = '(same face as reference:1.5)';
const STYLE_SENTENCE = '图1的人物，使用图2的Q版画风';

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

function recordingFetcher({ styleImage = null, failOn = 0 } = {}) {
  const calls = [];
  let posts = 0;
  const fetcher = async (url, init) => {
    if (url === '/api/chibi-style') {
      calls.push({ url, body: null });
      return { images: styleImage ? [styleImage] : [] };
    }
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    posts += 1;
    if (failOn && posts === failOn) throw new Error('上游失败');
    return { dataUrl: PNG, seed: body.seed };
  };
  return { calls, fetcher };
}

function postsOf(calls) {
  return calls.filter((call) => call.url === '/api/generate').map((call) => call.body);
}

function kindOf(prompt) {
  if (prompt.includes('clothing parts breakdown')) return '服饰拆解图';
  if (prompt.includes('expression chart')) return '表情差分图';
  if (prompt.includes('three views')) return '三视图';
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
  assert.deepEqual(gallery.base(), { dataUrl: UPLOAD, seed: 8 });
});

test('requestImage posts /api/generate and returns dataUrl and seed', async () => {
  const seen = [];
  const result = await requestImage({
    prompt: 'p',
    negativePrompt: 'n',
    aspectRatio: '3:4',
    seed: 5,
    referenceImages: [UPLOAD],
    fetcher: async (url, init) => {
      seen.push({ url, init });
      return { dataUrl: PNG, seed: 5 };
    },
  });
  assert.equal(seen[0].url, '/api/generate');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].init.body), {
    prompt: 'p',
    negativePrompt: 'n',
    aspectRatio: '3:4',
    seed: 5,
    referenceImages: [UPLOAD],
  });
  assert.deepEqual(result, { dataUrl: PNG, seed: 5 });
});

test('base portraits without a reference use four different new seeds and no reference image', async () => {
  const gallery = createGallery();
  const { calls, fetcher } = recordingFetcher();
  const now = () => 1700000000000;
  const batch = await generateKind({
    kind: '基准立绘',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    now,
    randomSeed: sequence(11),
  });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 4);
  assert.deepEqual(bodies.map((body) => body.seed), [11, 12, 13, 14]);
  for (const body of bodies) {
    assert.deepEqual(body.referenceImages, []);
    assert.equal(body.prompt.includes(LOCK), false);
    assert.equal(body.aspectRatio, '3:4');
    assert.equal(kindOf(body.prompt), '基准立绘');
  }
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
  const { calls, fetcher } = recordingFetcher();
  await generateKind({
    kind: '基准立绘',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    randomSeed: sequence(3),
  });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 4);
  assert.deepEqual(bodies.map((body) => body.seed), [3, 4, 5, 6]);
  for (const body of bodies) {
    assert.deepEqual(body.referenceImages, [UPLOAD]);
    assert.equal(body.prompt.includes(LOCK), true);
  }
  assert.equal(calls.some((call) => call.url === '/api/chibi-style'), false);
});

test('base portraits send no reference when a base is locked but nothing was uploaded', async () => {
  const gallery = createGallery();
  lockBase(gallery, 99, BASE);
  const { calls, fetcher } = recordingFetcher();
  await generateKind({
    kind: '基准立绘',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    randomSeed: sequence(3),
  });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 4);
  for (const body of bodies) {
    assert.deepEqual(body.referenceImages, []);
    assert.notEqual(body.seed, 99);
    assert.equal(body.prompt.includes(LOCK), false);
  }
});

test('a turnaround with a locked base reuses that image and seed', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { calls, fetcher } = recordingFetcher();
  await generateKind({
    kind: '三视图',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    randomSeed: () => {
      throw new Error('should reuse the base seed');
    },
  });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].seed, 42);
  assert.deepEqual(bodies[0].referenceImages, [BASE]);
  assert.equal(bodies[0].aspectRatio, '16:9');
  assert.equal(bodies[0].prompt.includes(LOCK), true);
  assert.equal(kindOf(bodies[0].prompt), '三视图');
  assert.equal(gallery.batches().at(-1).items.length, 1);
});

test('without a base an upload is the reference and the seed is new', async () => {
  const gallery = createGallery();
  const { calls, fetcher } = recordingFetcher();
  await generateKind({
    kind: '表情差分图',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    randomSeed: sequence(70),
  });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].seed, 70);
  assert.deepEqual(bodies[0].referenceImages, [UPLOAD]);
  assert.equal(bodies[0].prompt.includes(LOCK), true);
  assert.equal(kindOf(bodies[0].prompt), '表情差分图');
});

test('without a base or an upload there is no reference image', async () => {
  const gallery = createGallery();
  const { calls, fetcher } = recordingFetcher();
  await generateKind({
    kind: '三视图',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    randomSeed: sequence(5),
  });
  const body = postsOf(calls)[0];
  assert.equal(body.seed, 5);
  assert.deepEqual(body.referenceImages, []);
  assert.equal(body.prompt.includes(LOCK), false);
});

test('clothing breakdown sends the reference image without the face-lock sentence', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { calls, fetcher } = recordingFetcher();
  await generateKind({
    kind: '服饰拆解图',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    randomSeed: () => {
      throw new Error('should reuse the base seed');
    },
  });
  const body = postsOf(calls)[0];
  assert.equal(body.seed, 42);
  assert.deepEqual(body.referenceImages, [BASE]);
  assert.equal(body.aspectRatio, '1:1');
  assert.equal(body.prompt.includes(LOCK), false);
  assert.equal(body.prompt.includes('clothing parts breakdown'), true);
  assert.equal(calls.some((call) => call.url === '/api/chibi-style'), false);
});

test('chibi appends the style image after the character image', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { calls, fetcher } = recordingFetcher({ styleImage: STYLE });
  await generateKind({
    kind: 'Q版形象',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    randomSeed: () => {
      throw new Error('should reuse the base seed');
    },
  });
  assert.equal(calls[0].url, '/api/chibi-style');
  const body = postsOf(calls)[0];
  assert.equal(body.seed, 42);
  assert.deepEqual(body.referenceImages, [BASE, STYLE]);
  assert.equal(body.prompt.includes(LOCK), true);
  assert.equal(body.prompt.indexOf(LOCK) < body.prompt.indexOf(STYLE_SENTENCE), true);
  assert.equal(kindOf(body.prompt), 'Q版形象');
});

test('chibi can send the style image alone when there is no character image', async () => {
  const gallery = createGallery();
  const { calls, fetcher } = recordingFetcher({ styleImage: STYLE });
  await generateKind({
    kind: 'Q版形象',
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    randomSeed: sequence(8),
  });
  const body = postsOf(calls)[0];
  assert.equal(body.seed, 8);
  assert.deepEqual(body.referenceImages, [STYLE]);
  assert.equal(body.prompt.includes(STYLE_SENTENCE), true);
  assert.equal(body.prompt.includes(LOCK), false);
  assert.equal(body.prompt.includes('oval face'), true);
});

test('a base-portrait batch keeps the upload captured when the click starts', async () => {
  const gallery = createGallery();
  const images = { reference: UPLOAD };
  const nextUpload = 'data:image/png;base64,NEXT';
  let flipped = false;
  const { calls, fetcher } = recordingFetcher();
  const wrapped = async (url, init) => {
    const result = await fetcher(url, init);
    if (!flipped) {
      flipped = true;
      images.reference = nextUpload;
      const extra = gallery.addBatch([item({ seed: 99, dataUrl: 'data:image/png;base64,NEW' })]);
      gallery.select(extra.items[0].id);
      gallery.lockSelected();
    }
    return result;
  };
  await generateKind({
    kind: '基准立绘',
    state: defaultState(),
    gallery,
    images,
    fetcher: wrapped,
    randomSeed: sequence(3),
  });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 4);
  assert.deepEqual(bodies.map((body) => body.seed), [3, 4, 5, 6]);
  for (const body of bodies) {
    assert.deepEqual(body.referenceImages, [UPLOAD]);
    assert.equal(body.prompt.includes(LOCK), true);
  }
  assert.equal(gallery.base().seed, 99);
  assert.equal(images.reference, nextUpload);
});

test('a follow-up suite keeps the base captured when the click starts', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const other = gallery.addBatch([item({ seed: 7, dataUrl: 'data:image/png;base64,NEW', kind: '基准立绘' })]);
  gallery.select(gallery.batches()[0].items[0].id);
  assert.equal(gallery.lockSelected(), 42);
  const images = { reference: null };
  let flipped = false;
  const { calls, fetcher } = recordingFetcher({ styleImage: STYLE });
  const wrapped = async (url, init) => {
    const result = await fetcher(url, init);
    if (!flipped) {
      flipped = true;
      images.reference = UPLOAD;
      gallery.select(other.items[0].id);
      gallery.lockSelected();
    }
    return result;
  };
  await generateSuite({
    state: defaultState(),
    gallery,
    images,
    fetcher: wrapped,
    randomSeed: () => {
      throw new Error('should reuse the base seed');
    },
  });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 4);
  assert.deepEqual(bodies.map((body) => body.seed), [42, 42, 42, 42]);
  assert.deepEqual(bodies[0].referenceImages, [BASE]);
  assert.deepEqual(bodies[1].referenceImages, [BASE]);
  assert.deepEqual(bodies[2].referenceImages, [BASE]);
  assert.deepEqual(bodies[3].referenceImages, [BASE, STYLE]);
  assert.equal(gallery.base().seed, 7);
  assert.equal(images.reference, UPLOAD);
});

test('chibi without a style image sends only the character reference', async () => {
  const gallery = createGallery();
  const { calls, fetcher } = recordingFetcher({ styleImage: null });
  await generateKind({
    kind: 'Q版形象',
    state: defaultState(),
    gallery,
    images: { reference: UPLOAD },
    fetcher,
    randomSeed: sequence(9),
  });
  const body = postsOf(calls)[0];
  assert.equal(body.seed, 9);
  assert.deepEqual(body.referenceImages, [UPLOAD]);
  assert.equal(body.prompt.includes(LOCK), true);
  assert.equal(body.prompt.includes(STYLE_SENTENCE), false);
});

test('a failed request does not store a partial batch', async () => {
  const gallery = createGallery();
  const { fetcher } = recordingFetcher({ failOn: 3 });
  await assert.rejects(
    () => generateKind({
      kind: '基准立绘',
      state: defaultState(),
      gallery,
      images: { reference: null },
      fetcher,
      randomSeed: sequence(1),
    }),
    /上游失败/,
  );
  assert.equal(gallery.batches().length, 0);
});

test('a suite without a base generates four base portraits and stops', async () => {
  const gallery = createGallery();
  const { calls, fetcher } = recordingFetcher();
  const result = await generateSuite({
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    randomSeed: sequence(1),
  });
  assert.deepEqual(result, { stopped: true });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 4);
  assert.equal(calls.length, 4);
  assert.deepEqual(bodies.map((body) => kindOf(body.prompt)), ['基准立绘', '基准立绘', '基准立绘', '基准立绘']);
  assert.equal(new Set(bodies.map((body) => body.seed)).size, 4);
  assert.equal(gallery.batches().length, 1);
  assert.equal(gallery.batches()[0].items.length, 4);
});

test('a suite with a base adds one batch of the four follow-up kinds in order', async () => {
  const gallery = createGallery();
  lockBase(gallery, 42, BASE);
  const { calls, fetcher } = recordingFetcher({ styleImage: STYLE });
  const result = await generateSuite({
    state: defaultState(),
    gallery,
    images: { reference: null },
    fetcher,
    randomSeed: () => {
      throw new Error('should reuse the base seed');
    },
  });
  assert.deepEqual(result, { stopped: false });
  const bodies = postsOf(calls);
  assert.equal(bodies.length, 4);
  assert.deepEqual(bodies.map((body) => kindOf(body.prompt)), ['三视图', '表情差分图', '服饰拆解图', 'Q版形象']);
  assert.deepEqual(bodies.map((body) => body.seed), [42, 42, 42, 42]);
  assert.deepEqual(bodies[0].referenceImages, [BASE]);
  assert.deepEqual(bodies[3].referenceImages, [BASE, STYLE]);
  assert.equal(bodies[2].prompt.includes(LOCK), false);
  assert.equal(calls.filter((call) => call.url === '/api/chibi-style').length, 1);
  const added = gallery.batches().at(-1);
  assert.equal(added.items.length, 4);
  assert.deepEqual(added.items.map((entry) => entry.kind), ['三视图', '表情差分图', '服饰拆解图', 'Q版形象']);
  assert.equal(added.status, 'complete');
});
