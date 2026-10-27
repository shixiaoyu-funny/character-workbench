import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

import { applyLinkage } from '../src/rules.js';
import { defaultState } from '../src/state.js';
import { mount } from '../src/dom.js';
import { createGallery } from '../src/gallery.js';
import {
  FACE_BACKUP_KEY, backupFace, stripFace,
  createFaceStore, lockReference, unlockReference,
} from '../src/face.js';

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<body>
  <div class="topbar">
    <button type="button" id="theme-toggle">🌙</button>
    <button type="button" id="reset">重置</button>
  </div>
  <div id="workbench">
    <div id="col-left"></div>
    <div id="col-center"></div>
    <div id="col-right"></div>
  </div>
  <div id="download-view" hidden>
    <button type="button" id="download-back">返回工作台</button>
    <div id="download-list"></div>
  </div>
  <div id="toast"></div>
</body>
</html>`;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function manualSchedule() {
  const jobs = new Map();
  let n = 0;
  return {
    jobs,
    in(ms, fn) {
      const id = ++n;
      jobs.set(id, { ms, fn, cancelled: false });
      return id;
    },
    cancel(id) {
      const job = jobs.get(id);
      if (job) job.cancelled = true;
    },
  };
}

function setup(t, { beforeMount, matchMedia, virtualConsole, gallery, fetcher } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://127.0.0.1/', virtualConsole });
  const { window } = dom;
  const { document } = window;
  if (matchMedia) window.matchMedia = matchMedia;
  if (beforeMount) beforeMount(window);
  const images = { reference: null };
  const store = createFaceStore({
    images,
    storage: window.localStorage,
    schedule: manualSchedule(),
    applyLinkage,
  });
  const resolvedGallery = gallery === undefined ? {} : gallery;
  mount(document, { store, gallery: resolvedGallery, images, fetcher });
  t.after(() => window.close());
  return { window, document, store, images, gallery: resolvedGallery };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function scriptedFetcher() {
  const queue = [];
  const fetcher = (url, init) => {
    const job = deferred();
    queue.push({ url, init, ...job, done: false });
    return job.promise;
  };
  return { queue, fetcher };
}

async function respondNext(queue, value) {
  const job = queue.find((item) => !item.done);
  job.done = true;
  job.resolve(value);
  await tick();
}

function buttonByText(document, text) {
  const found = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === text);
  assert.ok(found, `missing button ${text}`);
  return found;
}

function control(document, field, value) {
  const found = document.querySelector(`[data-field="${field}"][data-value="${value}"]`);
  assert.ok(found, `missing control ${field}=${value}`);
  return found;
}

function mediaQuery(matches, listeners = []) {
  return {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener(type, fn) {
      if (type === 'change') listeners.push(fn);
    },
    removeEventListener() {},
  };
}

test('initial age is 少女 and choosing 男 reveals 小孩 without twintails', (t) => {
  const { document } = setup(t);
  const shoujo = buttonByText(document, '少女');
  assert.equal(shoujo.getAttribute('aria-pressed'), 'true');
  assert.equal(document.body.textContent.includes('双马尾（高/低）'), true);
  buttonByText(document, '男').click();
  assert.equal(buttonByText(document, '小孩').textContent.trim(), '小孩');
  assert.equal(document.body.textContent.includes('双马尾（高/低）'), false);
  assert.equal(document.body.textContent.includes('狼尾（Mullet）'), true);
});

test('preset writes both palettes and editing a main color clears it', (t) => {
  const { document, store } = setup(t);
  buttonByText(document, '经典黑红白').click();
  assert.deepEqual(store.getState().mainColors, ['黑', '红']);
  assert.deepEqual(store.getState().accentColors, ['白', '灰']);
  assert.equal(store.getState().colorPreset, 'classic-black-red');
  assert.equal(control(document, 'mainColors', '红').getAttribute('aria-pressed'), 'true');
  control(document, 'mainColors', '红').click();
  assert.deepEqual(store.getState().mainColors, ['黑']);
  assert.deepEqual(store.getState().accentColors, ['白', '灰']);
  assert.equal(store.getState().colorPreset, '');
});

test('a third handheld or visual effect is not added', (t) => {
  const { document, store } = setup(t);
  for (const item of ['书本', '法杖', '长剑']) control(document, 'handheld', item).click();
  assert.equal(store.getState().handheld.length, 2);
  assert.deepEqual(store.getState().handheld, ['书本', '法杖']);
  for (const item of ['樱花飘落', '雪花', '萤火虫']) control(document, 'visualEffects', item).click();
  assert.equal(store.getState().visualEffects.length, 2);
  assert.deepEqual(store.getState().visualEffects, ['樱花飘落', '雪花']);
});

test('choosing 无 clears that multi-select', (t) => {
  const { document, store } = setup(t);
  control(document, 'specialMakeup', '绷带').click();
  assert.deepEqual(store.getState().specialMakeup, ['绷带']);
  control(document, 'specialMakeup', '无').click();
  assert.deepEqual(store.getState().specialMakeup, []);
});

test('download entry, empty preview, and aspect controls render', (t) => {
  const { document } = setup(t);
  const download = document.querySelector('#open-download');
  assert.ok(download);
  assert.equal(download.textContent.trim(), '下载页');
  assert.equal(document.querySelector('#preview').textContent.trim(), '还没有图片');
  assert.equal(document.querySelector('#gallery').textContent.trim(), '图库是空的');
  assert.equal(buttonByText(document, '设为当前角色基准').textContent.trim(), '设为当前角色基准');
  for (const label of ['生成基准立绘', '生成三视图', '生成服饰拆解图']) {
    assert.ok(buttonByText(document, label).parentElement.querySelector('[data-field$="Aspect"]'), label);
  }
  for (const label of ['生成表情差分图', '生成Q版形象', '生成完整图片（一键全套）']) {
    assert.equal(buttonByText(document, label).parentElement.querySelector('[data-field$="Aspect"]'), null, label);
  }
});

test('shoujo heels sit in a closed 更多 disclosure', (t) => {
  const { document } = setup(t);
  const summary = [...document.querySelectorAll('summary')].find((el) => el.textContent.trim() === '更多');
  assert.ok(summary);
  const details = summary.parentElement;
  assert.equal(details.open, false);
  const heels = [...document.querySelectorAll('[data-value="高跟鞋"]')];
  assert.equal(heels.length, 1);
  assert.equal(heels[0].closest('details'), details);
});

test('color input appends a hex color onto the matching palette', (t) => {
  const { document, window, store } = setup(t);
  for (const field of ['mainColors', 'accentColors', 'backgroundColor']) {
    const input = document.querySelector(`input[data-field="${field}"]`);
    assert.equal(input.getAttribute('type'), 'color');
  }
  const scene = [...document.querySelectorAll('#col-center details')].find((el) => el.querySelector('summary')?.textContent.trim() === '场景构图与光影');
  assert.equal(scene.querySelector('input[data-field="backgroundColor"]') !== null, true);
  assert.equal(document.querySelector('#col-center details input[data-field="mainColors"]').closest('details').querySelector('summary').textContent.trim(), '服饰');
  const input = document.querySelector('input[data-field="mainColors"]');
  input.value = '#112233';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(store.getState().mainColors, ['#112233']);
  input.value = '#112233';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(store.getState().mainColors, ['#112233']);
});

test('aspect choice and warnings render into the page', (t) => {
  const { document, store } = setup(t);
  control(document, 'baseAspect', '9:16').click();
  assert.equal(store.getState().baseAspect, '9:16');
  store.replace({ ...store.getState(), pose: '躺姿', mainColors: ['黑', '白', '红', '银'] });
  const warnings = document.querySelector('#warnings').textContent;
  assert.equal(warnings.includes('躺/趴姿势搭配平视容易出图失败，建议改为俯视。'), true);
  assert.equal(warnings.includes('颜色过多可能导致AI出图画面杂乱，建议精简颜色。'), true);
});

test('theme follows the system until the user chooses one', (t) => {
  const listeners = [];
  const media = mediaQuery(false, listeners);
  const { document, window } = setup(t, { matchMedia: () => media });
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.getElementById('theme-toggle').textContent, '☀️');
  assert.equal(window.localStorage.getItem('theme'), null);
  media.matches = true;
  for (const fn of listeners) fn({ matches: true });
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(document.getElementById('theme-toggle').textContent, '🌙');
  assert.equal(window.localStorage.getItem('theme'), null);
  document.getElementById('theme-toggle').click();
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.getElementById('theme-toggle').textContent, '☀️');
  assert.equal(window.localStorage.getItem('theme'), 'light');
  media.matches = true;
  for (const fn of listeners) fn({ matches: true });
  assert.equal(document.documentElement.dataset.theme, 'light');
});

test('stored theme wins over the system preference', (t) => {
  const { document } = setup(t, {
    matchMedia: () => mediaQuery(true),
    beforeMount(window) {
      window.localStorage.setItem('theme', 'light');
    },
  });
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.getElementById('theme-toggle').textContent, '☀️');
});

test('reset confirms, deletes the saved config, keeps theme, and reloads', (t) => {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (error) => errors.push(String(error)));
  let asked = null;
  const { document, window } = setup(t, {
    virtualConsole,
    beforeMount(win) {
      win.localStorage.setItem('myCharacterConfig', JSON.stringify(defaultState()));
      win.localStorage.setItem('theme', 'dark');
      win.confirm = (message) => {
        asked = message;
        return false;
      };
    },
  });
  document.getElementById('reset').click();
  assert.equal(asked, '是否清除本地保存的角色配置并恢复默认？');
  assert.notEqual(window.localStorage.getItem('myCharacterConfig'), null);
  assert.equal(errors.length, 0);
  window.confirm = () => true;
  document.getElementById('reset').click();
  assert.equal(window.localStorage.getItem('myCharacterConfig'), null);
  assert.equal(window.localStorage.getItem('theme'), 'dark');
  assert.equal(errors.some((error) => error.includes('Not implemented: navigation to another Document')), true);
});

test('reset clears the face backup along with the saved config', (t) => {
  let reloaded = false;
  const { window, document, store, images } = setup(t, {
    beforeMount(win) {
      const realLocation = win.location;
      Object.defineProperty(win.document, 'defaultView', {
        configurable: true,
        get() {
          return new Proxy(win, {
            get(target, prop) {
              if (prop === 'location') {
                return {
                  href: realLocation.href,
                  reload() {
                    assert.equal(win.localStorage.getItem('myCharacterConfig'), null);
                    assert.equal(win.localStorage.getItem(FACE_BACKUP_KEY), null);
                    assert.equal(win.localStorage.getItem('theme'), 'dark');
                    reloaded = true;
                  },
                };
              }
              return Reflect.get(target, prop);
            },
          });
        },
      });
    },
  });
  images.reference = PNG;
  lockReference(store, window.localStorage, PNG);
  assert.notEqual(window.localStorage.getItem(FACE_BACKUP_KEY), null);
  window.localStorage.setItem('myCharacterConfig', JSON.stringify(defaultState()));
  window.localStorage.setItem('theme', 'dark');
  window.confirm = () => true;
  document.getElementById('reset').click();
  assert.equal(reloaded, true);
});

test('main.js boots the workbench with the browser timer and toast', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /DOMContentLoaded/);
  assert.match(source, /schedule:\s*\{ in: \(ms, fn\) => setTimeout\(fn, ms\), cancel: clearTimeout \}/);
  assert.match(source, /getElementById\(['"]toast['"]\)/);
  assert.match(source, /mount\(/);
  assert.match(source, /createFaceStore\(/);
  assert.match(source, /createGallery\(/);
  assert.match(source, /\{ reference: null \}/);
  assert.doesNotMatch(source, /\/api\/generate/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^)]*dataUrl/);
});

function groupBySummary(document, title) {
  const found = [...document.querySelectorAll('#col-center details')]
    .find((el) => el.querySelector('summary')?.textContent.trim() === title);
  assert.ok(found, `missing group ${title}`);
  return found;
}

test('locking a reference disables the face and makeup panels and strips the face', (t) => {
  const { window, document, store, images } = setup(t);
  assert.ok(document.querySelector('#reference input[type="file"]'));
  assert.equal(document.body.textContent.includes('上传参考图'), true);
  const face = groupBySummary(document, '面部');
  assert.equal(face.hasAttribute('disabled'), false);
  const remove = buttonByText(document, '移除');
  assert.equal(remove.hidden, true);

  images.reference = PNG;
  assert.equal(lockReference(store, window.localStorage, PNG), true);

  assert.equal(groupBySummary(document, '面部').hasAttribute('disabled'), true);
  assert.equal(groupBySummary(document, '妆容').hasAttribute('disabled'), true);
  assert.equal(store.getState().faceShape, '');
  assert.equal(store.getState().hairStyle, '双马尾（高/低）');
  const backup = JSON.parse(window.localStorage.getItem(FACE_BACKUP_KEY));
  assert.equal(backup.faceShape, '鹅蛋脸（标准）');
  assert.equal(document.body.textContent.includes('已开启锁脸模式，当前角色的面部与妆容将由参考图决定。'), true);
  assert.equal(buttonByText(document, '移除').hidden, false);
  assert.equal(JSON.stringify(store.getState()).includes('data:image/'), false);
  assert.equal(JSON.stringify(window.localStorage.getItem('myCharacterConfig')).includes('data:image/'), false);

  control(document, 'faceShape', '鹅蛋脸（标准）').click();
  control(document, 'lipstick', '自然色').click();
  assert.equal(store.getState().faceShape, '');

  buttonByText(document, '移除').click();
  assert.equal(store.getState().faceShape, '鹅蛋脸（标准）');
  assert.equal(store.getState().lipstick, '自然色');
  assert.equal(window.localStorage.getItem(FACE_BACKUP_KEY), null);
  assert.equal(groupBySummary(document, '面部').hasAttribute('disabled'), false);
  assert.equal(groupBySummary(document, '妆容').hasAttribute('disabled'), false);
  assert.equal(document.body.textContent.includes('已开启锁脸模式'), false);
  assert.equal(buttonByText(document, '移除').hidden, true);
  control(document, 'faceShape', '圆脸（幼态）').click();
  assert.equal(store.getState().faceShape, '圆脸（幼态）');
});

test('a leftover backup without a reference restores the face and flushes', (t) => {
  const { window, document, store } = setup(t, {
    beforeMount(win) {
      win.localStorage.setItem('myCharacterConfig', JSON.stringify(stripFace(defaultState())));
      win.localStorage.setItem(FACE_BACKUP_KEY, JSON.stringify(backupFace(defaultState())));
    },
  });
  assert.equal(store.getState().faceShape, '鹅蛋脸（标准）');
  assert.equal(window.localStorage.getItem(FACE_BACKUP_KEY), null);
  const saved = JSON.parse(window.localStorage.getItem('myCharacterConfig'));
  assert.equal(saved.faceShape, '鹅蛋脸（标准）');
  assert.equal(document.body.textContent.includes('已开启锁脸模式'), false);
  assert.equal(groupBySummary(document, '面部').hasAttribute('disabled'), false);
});

const LABELS = ['生成基准立绘', '生成三视图', '生成表情差分图', '生成服饰拆解图', '生成Q版形象', '生成完整图片（一键全套）'];

function generateButtons(document) {
  return LABELS.map((label) => buttonByText(document, label));
}

test('generating base portraits fills the gallery and keeps progress across redraws', async (t) => {
  const gallery = createGallery();
  const { queue, fetcher } = scriptedFetcher();
  const { window, document } = setup(t, { gallery, fetcher });
  buttonByText(document, '生成基准立绘').click();
  assert.equal(document.querySelector('#status').textContent, '正在生成基准立绘（1/4）');
  assert.equal(generateButtons(document).every((button) => button.disabled), true);

  await respondNext(queue, { dataUrl: PNG, seed: JSON.parse(queue[0].init.body).seed });
  assert.equal(document.querySelector('#status').textContent, '正在生成基准立绘（2/4）');
  control(document, 'baseAspect', '9:16').click();
  assert.equal(document.querySelector('#status').textContent, '正在生成基准立绘（2/4）');
  assert.equal(generateButtons(document).every((button) => button.disabled), true);

  while (queue.length < 4 || queue.some((job) => !job.done)) {
    const job = queue.find((item) => !item.done);
    await respondNext(queue, { dataUrl: PNG, seed: JSON.parse(job.init.body).seed });
  }
  assert.equal(document.querySelector('#status').textContent, '');
  assert.equal(document.querySelectorAll('#gallery img').length, 4);
  assert.equal(document.querySelectorAll('#preview img').length >= 1, true);
  assert.equal(document.querySelector('#gallery').textContent.includes('图库是空的'), false);
  assert.equal(generateButtons(document).every((button) => button.disabled), false);
  assert.equal(JSON.stringify(window.localStorage).includes('data:image/'), false);
  assert.equal(gallery.batches().length, 1);
  assert.equal(gallery.batches()[0].items.length, 4);

  const first = gallery.batches()[0].items[0];
  document.querySelector(`[data-select="${first.id}"]`).click();
  assert.equal(document.querySelector(`[data-select="${first.id}"]`).getAttribute('aria-pressed'), 'true');
  buttonByText(document, '设为当前角色基准').click();
  assert.equal(gallery.base().seed, first.seed);
  assert.equal(gallery.base().dataUrl, first.dataUrl);
});

test('a failed generation shows the error and stores nothing', async (t) => {
  const gallery = createGallery();
  const { queue, fetcher } = scriptedFetcher();
  const { document } = setup(t, { gallery, fetcher });
  buttonByText(document, '生成基准立绘').click();
  queue[0].done = true;
  queue[0].reject(new Error('上游失败'));
  await tick();
  assert.equal(document.querySelector('#status').textContent, '上游失败');
  assert.equal(gallery.batches().length, 0);
  assert.equal(document.querySelector('#preview').textContent.trim(), '还没有图片');
  assert.equal(document.querySelector('#gallery').textContent.trim(), '图库是空的');
  assert.equal(generateButtons(document).every((button) => button.disabled), false);
});

test('turnaround without a base warns that the face will not be locked', async (t) => {
  const gallery = createGallery();
  const { queue, fetcher } = scriptedFetcher();
  const { document } = setup(t, { gallery, fetcher });
  buttonByText(document, '生成三视图').click();
  await respondNext(queue, { dataUrl: PNG, seed: 1 });
  assert.equal(document.querySelector('#status').textContent, '尚未设定角色基准，本次不会锁定脸。');
  assert.equal(document.querySelectorAll('#gallery img').length, 1);
  assert.equal(gallery.base(), null);
});

test('a later batch replaces the preview even when an older image was selected', async (t) => {
  const gallery = createGallery();
  const { queue, fetcher } = scriptedFetcher();
  const { document } = setup(t, { gallery, fetcher });
  const second = 'data:image/png;base64,BB==';
  buttonByText(document, '生成三视图').click();
  await respondNext(queue, { dataUrl: PNG, seed: 1 });
  document.querySelector('[data-select]').click();
  assert.equal(document.querySelector('#preview img').getAttribute('src'), PNG);
  buttonByText(document, '生成三视图').click();
  await respondNext(queue, { dataUrl: second, seed: 2 });
  assert.equal(document.querySelector('#preview img').getAttribute('src'), second);
  assert.equal(document.querySelectorAll('#gallery img').length, 2);
  assert.equal(document.querySelector('#status').textContent, '尚未设定角色基准，本次不会锁定脸。');
});

function buttonsByText(document, text) {
  return [...document.querySelectorAll('button')].filter((el) => el.textContent.trim() === text);
}

function captureDownloads(window) {
  const saved = [];
  const original = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function patchedClick() {
    if (this.download) {
      saved.push({ download: this.download, href: this.href });
      return;
    }
    return original.apply(this, arguments);
  };
  return saved;
}

function sheet(overrides = {}) {
  return {
    kind: '基准立绘',
    aspect: '3:4',
    seed: 11,
    positive: '正向甲',
    negative: '负向甲',
    dataUrl: PNG,
    ...overrides,
  };
}

test('opening the download page lists one batch and an empty gallery explains itself', (t) => {
  const gallery = createGallery();
  const { document, window } = setup(t, { gallery });
  document.getElementById('open-download').click();
  assert.equal(document.getElementById('workbench').hidden, true);
  assert.equal(document.getElementById('download-view').hidden, false);
  assert.equal(document.getElementById('download-list').textContent, '还没有生成图片');
  assert.equal(gallery.batches().length, 0);

  document.getElementById('download-back').click();
  gallery.addBatch([
    sheet(),
    sheet({ kind: '三视图', aspect: '16:9', seed: 22, positive: '正向乙', negative: '负向乙', dataUrl: `${PNG}B` }),
  ]);
  document.getElementById('open-download').click();
  const list = document.getElementById('download-list');
  assert.equal(buttonsByText(list, '下载这张').length, 2);
  assert.equal(buttonsByText(list, '打包本次').length, 1);
  assert.equal(list.querySelectorAll('img').length, 2);
  assert.equal(list.textContent.includes('基准立绘'), true);
  assert.equal(list.textContent.includes('三视图'), true);
  assert.equal(list.textContent.includes('还没有生成图片'), false);
  assert.equal(gallery.batches().length, 1);
  assert.equal(gallery.batches()[0].items[0].dataUrl, PNG);
  assert.equal(JSON.stringify(window.localStorage).includes('data:image/'), false);
  assert.equal(JSON.stringify(window.localStorage).includes('正向甲'), false);
});

test('a column redraw keeps the open download list and the in-memory gallery', (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  gallery.addBatch([sheet(), sheet({ kind: '三视图', seed: 22 })]);
  document.getElementById('open-download').click();
  assert.equal(buttonsByText(document.getElementById('download-list'), '下载这张').length, 2);
  control(document, 'baseAspect', '9:16').click();
  assert.equal(document.getElementById('workbench').hidden, true);
  assert.equal(document.getElementById('download-view').hidden, false);
  assert.equal(buttonsByText(document.getElementById('download-list'), '下载这张').length, 2);
  assert.equal(buttonsByText(document.getElementById('download-list'), '打包本次').length, 1);
  assert.equal(gallery.batches().length, 1);
});

test('a batch that is not complete has no pack button', (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  const stored = gallery.addBatch([sheet()]);
  stored.status = 'running';
  document.getElementById('open-download').click();
  const list = document.getElementById('download-list');
  assert.equal(buttonsByText(list, '下载这张').length, 1);
  assert.equal(buttonsByText(list, '打包本次').length, 0);
});

test('adding a batch while the download page is open refreshes the list', (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  document.getElementById('open-download').click();
  assert.equal(document.getElementById('download-list').textContent, '还没有生成图片');
  gallery.addBatch([sheet({ kind: '三视图' })]);
  const list = document.getElementById('download-list');
  assert.equal(list.textContent.includes('还没有生成图片'), false);
  assert.equal(buttonsByText(list, '下载这张').length, 1);
  assert.equal(buttonsByText(list, '打包本次').length, 1);
  assert.equal(document.querySelector('#gallery').textContent.trim(), '图库是空的');
});

test('download buttons save one png or the batch zip through a temporary anchor', async (t) => {
  const gallery = createGallery();
  const { document, window } = setup(t, { gallery });
  const second = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const stored = gallery.addBatch([
    sheet(),
    sheet({ kind: '三视图', aspect: '16:9', seed: 22, positive: '正向乙', negative: '负向乙', dataUrl: second }),
  ]);
  stored.createdAt = new Date(2026, 9, 27, 21, 40, 5).getTime();
  const saved = captureDownloads(window);
  document.getElementById('open-download').click();
  const list = document.getElementById('download-list');
  buttonsByText(list, '下载这张')[1].click();
  assert.equal(saved[0].download, '02-三视图.png');
  assert.equal(saved[0].href, second);
  buttonsByText(list, '打包本次')[0].click();
  assert.equal(saved[1].download, '角色设定-20261027-214005.zip');
  const { zipBatch } = await import('../src/download.js');
  const zipped = zipBatch(gallery.batches()[0]);
  const comma = saved[1].href.indexOf(',');
  const bytes = Uint8Array.from(Buffer.from(saved[1].href.slice(comma + 1), 'base64'));
  assert.deepEqual(bytes, zipped.bytes);
  assert.equal(document.getElementById('download-view').hidden, false);
  assert.equal(JSON.stringify(window.localStorage).includes('data:image/'), false);
  assert.equal(JSON.stringify(window.localStorage).includes('正向乙'), false);
});

test('a gallery thumbnail context menu downloads that image and stays on the workbench', (t) => {
  const gallery = createGallery();
  gallery.addBatch([sheet(), sheet({ kind: '表情差分图', seed: 8 })]);
  gallery.addBatch([sheet({ kind: '三视图', seed: 9, dataUrl: `${PNG}B` })]);
  const { document, window } = setup(t, { gallery });
  const saved = captureDownloads(window);
  const shots = document.querySelectorAll('#gallery [data-select]');
  assert.equal(shots.length, 3);
  const event = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  shots[2].querySelector('img').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].download, '01-三视图.png');
  assert.equal(saved[0].href, `${PNG}B`);
  assert.equal(document.getElementById('workbench').hidden, false);
  assert.equal(document.getElementById('download-view').hidden, true);

  const previewEvent = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.querySelector('#preview img').dispatchEvent(previewEvent);
  assert.equal(previewEvent.defaultPrevented, false);
  assert.equal(saved.length, 1);
});

test('the full suite without a base asks for a locked base portrait', async (t) => {
  const gallery = createGallery();
  const { queue, fetcher } = scriptedFetcher();
  const { document } = setup(t, { gallery, fetcher });
  buttonByText(document, '生成完整图片（一键全套）').click();
  while (gallery.batches().length === 0) {
    const job = queue.find((item) => !item.done);
    await respondNext(queue, { dataUrl: PNG, seed: JSON.parse(job.init.body).seed });
  }
  assert.equal(document.querySelector('#status').textContent, '请选择一张基准立绘，并设为当前角色基准。');
  assert.equal(document.querySelectorAll('#gallery img').length, 4);
  assert.equal(gallery.batches()[0].items.every((entry) => entry.kind === '基准立绘'), true);
});
