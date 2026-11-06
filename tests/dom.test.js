import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

import { applyLinkage } from '../src/rules.js';
import { defaultState } from '../src/state.js';
import { loadHistory, mount } from '../src/dom.js';
import { createGallery } from '../src/gallery.js';
import { englishNameForHex } from '../src/colorTranslate.js';
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
  <div class="app-shell">
    <aside id="sidebar">
      <button type="button" class="nav-item" data-route="base">身份基底</button>
      <button type="button" class="nav-item" data-route="detail">细节样式</button>
      <button type="button" class="nav-item" data-route="tune">角色定向微调</button>
      <button type="button" class="nav-item" data-route="generate">生成与处理（一般）</button>
      <button type="button" class="nav-item" data-route="watermark">批量水印</button>
      <button type="button" class="nav-item" data-route="wallpaper">动态壁纸</button>
      <button type="button" class="nav-item" data-route="download">下载页</button>
    </aside>
    <main id="workbench">
      <section id="page-base" class="page" data-page="base"></section>
      <section id="page-detail" class="page" data-page="detail" hidden></section>
      <section id="page-tune" class="page" data-page="tune" hidden></section>
      <section id="page-generate" class="page" data-page="generate" hidden></section>
      <section id="download-view" class="page" data-page="download" hidden>
        <button type="button" id="download-back">返回生成页</button>
        <div class="download-tabs">
          <button type="button" class="download-tab" data-download-tab="all" aria-selected="true">全部</button>
          <button type="button" class="download-tab" data-download-tab="base" aria-selected="false">基准立绘</button>
          <button type="button" class="download-tab" data-download-tab="clothing" aria-selected="false">服饰基准</button>
        </div>
        <div id="download-list" data-download-pane="all"></div>
        <div id="base-select" data-download-pane="base" hidden></div>
        <div id="clothing-pairs" data-download-pane="clothing" hidden></div>
      </section>
      <section id="page-wallpaper" class="page" data-page="wallpaper" hidden>
        <div class="wp-step" data-wp-step="generate">
          <span id="wallpaper-step-generate"></span>
          <input type="file" id="wallpaper2-source" accept="image/*,video/*">
          <button type="button" id="wallpaper2-submit">提交任务</button>
          <span id="wallpaper2-status"></span>
          <div id="wallpaper2-models"></div>
          <div id="wallpaper2-durations"></div>
          <button type="button" id="wallpaper2-generate">生成视频</button>
        </div>
        <div class="wp-step" data-wp-step="master">
          <span id="wallpaper-step-master"></span>
          <button type="button" id="wallpaper2-process">重新处理</button>
          <span id="wallpaper2-process-status"></span>
        </div>
        <div class="wp-step" data-wp-step="edit">
          <span id="wallpaper-step-edit"></span>
          <button type="button" id="wallpaper-link" class="wp-link-toggle">连接关系：已禁用</button>
          <canvas id="wp-canvas-pc"></canvas>
          <canvas id="wp-canvas-phone"></canvas>
          <canvas id="wp-canvas-tablet"></canvas>
          <canvas id="wp-canvas-ipad"></canvas>
          <div id="wallpaper-grading"></div>
          <button type="button" class="wp-export" data-wp-export="pc">导出此端</button>
          <button type="button" id="wallpaper-export-all">导出四端并自动下载</button>
          <span id="wallpaper-status"></span>
        </div>
      </section>
    </main>
  </div>
  <div id="fullscreen" hidden>
    <button type="button" id="fullscreen-close">×</button>
    <img id="fullscreen-img" alt="全屏预览">
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

function setup(t, { beforeMount, matchMedia, virtualConsole, gallery, fetcher, streamFetcher, translate, taskServer, pollMs } = {}) {
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
  // 默认用即时、确定性的翻译，避免留下 300ms 悬空定时器；需要测 loading 时单独注入 deferred。
  const resolvedTranslate = translate || (async (hex) => englishNameForHex(hex));
  // 生图现在走服务端任务队列：把 window.fetch 换成假任务服务（mount 只会在点击后用到）。
  if (taskServer) {
    window.fetch = taskServer.fetchImpl;
    if (taskServer.dispose) t.after(() => taskServer.dispose());
  }
  mount(document, { store, gallery: resolvedGallery, images, fetcher, streamFetcher, translate: resolvedTranslate, pollMs });
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

// 假任务服务：生图/壁纸提交后由服务端推进，测试里用 complete/finish/failTask 控制节奏。
// 只实现前端真正用到的四个接口：提交、查询、取产物、取消。
function jsonResponse(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

function pngBytes(dataUrl) {
  const text = String(dataUrl || PNG);
  const payload = text.slice(text.indexOf(',') + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function scriptedTasks() {
  const state = { submissions: [], tasks: new Map(), cancelled: [], deleted: [], payloads: new Map() };
  let seq = 0;
  const clone = (task) => ({
    ...task,
    steps: task.steps.map((step) => ({ ...step })),
    results: task.results.map((entry) => ({ ...entry })),
  });
  const fetchImpl = (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (url === '/api/tasks' && method === 'POST') {
      const body = JSON.parse(init.body);
      seq += 1;
      const rawSteps = body.steps || body.units || [];
      const steps = rawSteps.map((step, index) => ({
        index,
        kind: step.kind || body.kind,
        title: step.title || `第 ${index + 1} 项`,
        status: 'pending',
        error: '',
        message: '',
        url: null,
        recordId: null,
      }));
      const task = {
        id: `task-${seq}`,
        pool: body.pool || 'main',
        kind: body.kind,
        title: body.title || body.kind,
        status: 'queued',
        total: Number(body.total) || steps.length,
        done: 0,
        failed: 0,
        skipped: 0,
        unit: body.unit || '项',
        progress: 0,
        message: '排队中',
        error: '',
        steps,
        results: [],
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
      };
      state.submissions.push(body);
      state.tasks.set(task.id, task);
      return jsonResponse({ task: clone(task) });
    }
    if (url === '/api/tasks' && method === 'GET') {
      return jsonResponse({ tasks: [...state.tasks.values()].map(clone) });
    }
    const result = /^\/api\/tasks\/([^/]+)\/result\/(\d+)$/.exec(url);
    if (result) {
      const task = state.tasks.get(result[1]);
      const step = task && task.steps[Number(result[2])];
      if (!step || !step.dataUrl) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
      }
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => pngBytes(step.dataUrl) });
    }
    const cancel = /^\/api\/tasks\/([^/]+)\/cancel$/.exec(url);
    if (cancel && method === 'POST') {
      const task = state.tasks.get(cancel[1]);
      state.cancelled.push(cancel[1]);
      if (task) {
        task.status = 'cancelled';
        task.message = '已取消';
        task.finished_at = new Date().toISOString();
        for (const step of task.steps) {
          if (step.status === 'pending' || step.status === 'running') step.status = 'cancelled';
        }
      }
      return jsonResponse({ task: task ? clone(task) : {} });
    }
    const payload = /^\/api\/tasks\/([^/]+)\/payload$/.exec(url);
    if (payload) return jsonResponse({ payload: state.payloads.get(payload[1]) || {} });
    const one = /^\/api\/tasks\/([^/]+)$/.exec(url);
    if (one) {
      if (method === 'DELETE') {
        state.deleted.push(one[1]);
        state.tasks.delete(one[1]);
        return jsonResponse({ deleted: one[1] });
      }
      const task = state.tasks.get(one[1]);
      if (!task) return jsonResponse({ error: '任务不存在' }, 404);
      return jsonResponse({ task: clone(task) });
    }
    return jsonResponse({ error: `unexpected ${url}` }, 500);
  };
  const latest = () => [...state.tasks.values()].at(-1);
  return {
    fetchImpl,
    get submissions() { return state.submissions; },
    get cancelled() { return state.cancelled; },
    get deleted() { return state.deleted; },
    get tasks() { return [...state.tasks.values()]; },
    task: latest,
    rememberPayload(body) {
      const task = latest();
      state.payloads.set(task.id, body);
      return task;
    },
    complete(index, overrides = {}) {
      const task = latest();
      const step = task.steps[index];
      step.status = 'done';
      step.url = overrides.url ?? null;
      step.recordId = overrides.id ?? null;
      step.dataUrl = overrides.dataUrl || PNG;
      task.done += 1;
      task.status = 'running';
      task.started_at = task.started_at || new Date().toISOString();
      task.progress = (task.done / task.total) * 100;
      return task;
    },
    failTask(message) {
      const task = latest();
      task.status = 'failed';
      task.error = message;
      task.message = message;
      task.progress = 100;
      task.finished_at = new Date().toISOString();
      return task;
    },
    finish() {
      const task = latest();
      task.status = 'done';
      task.message = '已完成';
      task.progress = 100;
      task.finished_at = new Date().toISOString();
      return task;
    },
    // 测试收尾：把没跑完的任务一次性收成 cancelled，避免前端轮询一直挂着定时器。
    dispose() {
      for (const task of state.tasks.values()) {
        if (['done', 'partial', 'failed', 'cancelled'].includes(task.status)) continue;
        task.status = 'cancelled';
        task.message = '已取消';
        task.finished_at = new Date().toISOString();
        for (const step of task.steps) {
          if (step.status === 'pending' || step.status === 'running') step.status = 'cancelled';
        }
      }
    },
  };
}

// 轮询式等待：假任务推进是异步的，断言前等到条件成立（默认 3 秒上限）。
async function waitFor(check, timeout = 3000) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// 可控的 SSE 流：记录 /api/generate-stream 调用，暴露 emit/finish/fail 逐张回传。
// 传入 AbortSignal 时会模拟浏览器：signal 一旦 abort，流请求以 AbortError 结束。
function scriptedStream() {
  const state = { jobs: null, onEvent: null, resolve: null, reject: null, signal: null };
  const streamFetcher = (url, init, onEvent) => {
    state.jobs = JSON.parse(init.body).jobs;
    state.onEvent = onEvent;
    state.signal = init.signal || null;
    return new Promise((res, rej) => {
      state.resolve = res;
      state.reject = rej;
      if (state.signal) {
        state.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          rej(error);
        });
      }
    });
  };
  return {
    streamFetcher,
    get jobs() { return state.jobs; },
    get signal() { return state.signal; },
    emit(index, overrides = {}) {
      state.onEvent({ index, seed: state.jobs[index].seed, dataUrl: PNG, url: null, id: null, ...overrides });
    },
    finish() {
      state.onEvent({ done: true });
      state.resolve();
    },
    fail(err) {
      state.reject(err);
    },
  };
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

test('handheld items multiply without a cap, and both-hands poses grey out', (t) => {
  const { document, store } = setup(t);
  control(document, 'handPose', '双手抱胸').click();
  control(document, 'handPose', '单手叉腰').click();
  for (const item of ['书本', '法杖', '长剑']) control(document, 'handheld', item).click();
  assert.deepEqual(store.getState().handheld, ['书本', '法杖', '长剑']);
  assert.equal(store.getState().handPose.includes('双手抱胸'), false);
  assert.equal(store.getState().handPose.includes('单手叉腰'), true);
  assert.equal(control(document, 'handPose', '双手抱胸').disabled, true);
  control(document, 'handPose', '双手抱胸').click();
  assert.deepEqual(store.getState().handheld, ['书本', '法杖', '长剑']);
  assert.equal(store.getState().handPose.includes('双手抱胸'), false);
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

test('generate page renders an empty output strip and aspect controls', (t) => {
  const { document } = setup(t);
  assert.equal(document.querySelector('#output').textContent.trim(), '还没有图片');
  for (const label of ['生成基准立绘', '生成三视图', '生成服饰拆解图']) {
    assert.ok(buttonByText(document, label).parentElement.querySelector('[data-field$="Aspect"]'), label);
  }
  for (const label of ['生成表情差分图', '生成Q版形象', '生成完整设定集']) {
    assert.equal(buttonByText(document, label).parentElement.querySelector('[data-field$="Aspect"]'), null, label);
  }
});

test('generation style picker offers a single 二次元风格 and stays selected', (t) => {
  const { document, store } = setup(t);
  const anime = control(document, 'style', '二次元风格');
  assert.ok(anime, 'style picker present');
  assert.equal(anime.getAttribute('aria-pressed'), 'true');
  assert.equal(store.getState().style, '二次元风格');
  anime.click();
  assert.equal(store.getState().style, '二次元风格');
  assert.equal(control(document, 'style', '二次元风格').getAttribute('aria-pressed'), 'true');
  // 写实风已删除：页面上不再有写实风样式按钮。
  assert.equal(document.querySelector('[data-field="style"][data-value="写实风二次元"]'), null);
  assert.equal(document.querySelector('[data-field="style"][data-value="米哈游风"]'), null);
});

test('generate page renders base and suite count sliders', (t) => {
  const { document, window } = setup(t);
  const base = document.querySelector('[data-base-count]');
  assert.ok(base, 'base count slider present');
  assert.equal(base.value, '4');
  assert.equal(document.querySelector('[data-base-count-label]').textContent, '4 张');
  const suite = document.querySelector('[data-suite-count]');
  assert.ok(suite, 'suite count slider present');
  assert.equal(suite.value, '1');
  assert.equal(document.querySelector('.suite-count .base-count-label').textContent, '生成套数');
  assert.equal(document.querySelector('[data-suite-count-label]').textContent, '1 套');
  suite.value = '3';
  suite.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('[data-suite-count-label]').textContent, '3 套');
});

test('heels render inline instead of a 更多 disclosure', (t) => {
  const { document } = setup(t);
  const toggle = [...document.querySelectorAll('[data-more-toggle]')].find((el) => el.textContent.trim() === '更多');
  assert.equal(toggle, undefined);
  const heels = [...document.querySelectorAll('[data-value="细高跟鞋"]')];
  assert.equal(heels.length, 1);
  assert.equal(heels[0].closest('[data-more]'), null);
  assert.ok(heels[0].closest('#page-detail'));
});

test('an open 细配 panel stays open after a detail or color choice', (t) => {
  const { document } = setup(t);
  const fine = document.querySelector('#page-detail details.clothing-fine');
  assert.ok(fine);
  const slot = fine.dataset.fine;
  fine.open = true;
  const detail = [...fine.querySelectorAll('button[data-part="detail"]')].find((el) => el.getAttribute('aria-pressed') !== 'true');
  assert.ok(detail);
  detail.click();
  const afterDetail = document.querySelector(`#page-detail details.clothing-fine[data-fine="${slot}"]`);
  assert.equal(afterDetail.open, true);
  const color = [...afterDetail.querySelectorAll('button[data-part="color"]')].find((el) => el.getAttribute('aria-pressed') !== 'true');
  assert.ok(color);
  color.click();
  const afterColor = document.querySelector(`#page-detail details.clothing-fine[data-fine="${slot}"]`);
  assert.equal(afterColor.open, true);
  afterColor.open = false;
  const another = [...afterColor.querySelectorAll('button[data-part="detail"]')].find((el) => el.getAttribute('aria-pressed') !== 'true');
  another.click();
  assert.equal(document.querySelector(`#page-detail details.clothing-fine[data-fine="${slot}"]`).open, false);
});

test('role recommendations render the recommended class and reorder pills', (t) => {
  const { document, window } = setup(t);
  const roleSelect = document.querySelector('select[data-field="role"]');
  roleSelect.value = '学院制服';
  roleSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  const top = control(document, 'top', '衬衫');
  assert.equal(top.classList.contains('recommended'), true);
  assert.equal(top.getAttribute('data-part'), 'style');
  assert.equal(control(document, 'top', 'T恤').classList.contains('recommended'), false);
  const firstStyle = document.querySelector('#page-detail [data-field="top"][data-part="style"]');
  assert.equal(firstStyle.getAttribute('data-value'), '衬衫');
  control(document, 'outfitEffects', '湿身').click();
  assert.equal(control(document, 'outfitEffects', '湿身').getAttribute('aria-pressed'), 'true');
  control(document, 'outfitEffects', '湿身').click();
  assert.equal(control(document, 'outfitEffects', '湿身').getAttribute('aria-pressed'), 'false');
});

test('color input appends a hex color onto the matching palette', (t) => {
  const { document, window, store } = setup(t);
  for (const field of ['mainColors', 'accentColors', 'backgroundColor']) {
    const input = document.querySelector(`input[data-field="${field}"]`);
    assert.equal(input.getAttribute('type'), 'color');
  }
  const scene = document.querySelector('#page-tune [data-group="场景构图与光影"]');
  assert.equal(scene.querySelector('input[data-field="backgroundColor"]') !== null, true);
  const clothing = groupBySummary(document, '服饰');
  assert.equal(clothing.querySelector('input[data-field="mainColors"]') !== null, true);
  const input = document.querySelector('input[data-field="mainColors"]');
  input.value = '#112233';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(store.getState().mainColors, ['#112233']);
  input.value = '#112233';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(store.getState().mainColors, ['#112233']);
});

test('choosing a custom color option reveals and writes its free color input', (t) => {
  const { document, window, store } = setup(t);
  assert.equal(document.querySelector('input[data-field="hairColorCustom"]'), null);
  control(document, 'hairColor', '自定义').click();
  const input = document.querySelector('input[data-field="hairColorCustom"]');
  assert.equal(input.getAttribute('type'), 'color');
  input.value = '#a1b2c3';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(store.getState().hairColorCustom, '#a1b2c3');
});

test('streak and gradient hair colors are exclusive single-choice color pickers', (t) => {
  const { document, window, store } = setup(t);
  // 初始无选择，不出现任何颜色选择器。
  assert.equal(document.querySelector('input[data-field="streakColor"]'), null);
  assert.equal(document.querySelector('input[data-field="gradientRootColor"]'), null);
  assert.equal(document.querySelector('input[data-field="gradientTipColor"]'), null);

  // 点「挑染」：出现一个挑染颜色选择器。
  control(document, 'hairColorExtra', '挑染').click();
  assert.equal(store.getState().hairColorExtra, '挑染');
  const streak = document.querySelector('input[data-field="streakColor"]');
  assert.notEqual(streak, null);
  assert.equal(streak.getAttribute('type'), 'color');
  assert.equal(document.querySelector('input[data-field="gradientRootColor"]'), null);
  assert.equal(document.querySelector('input[data-field="gradientTipColor"]'), null);
  streak.value = '#ff0000';
  streak.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(store.getState().streakColor, '#ff0000');

  // 点「渐变发色」：单选互斥，挑染颜色选择器消失，出现发根/发尾两个选择器。
  control(document, 'hairColorExtra', '渐变发色').click();
  assert.equal(store.getState().hairColorExtra, '渐变发色');
  assert.equal(document.querySelector('input[data-field="streakColor"]'), null);
  const root = document.querySelector('input[data-field="gradientRootColor"]');
  assert.notEqual(root, null);
  assert.notEqual(document.querySelector('input[data-field="gradientTipColor"]'), null);
  root.value = '#1a1a1a';
  root.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(store.getState().gradientRootColor, '#1a1a1a');
  // 写回会触发重绘，重新获取发尾色节点再写入。
  const tip = document.querySelector('input[data-field="gradientTipColor"]');
  tip.value = '#00ff00';
  tip.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(store.getState().gradientTipColor, '#00ff00');
});

test('color change (not input) triggers async translation with loading and english name', async (t) => {
  let resolveTranslate;
  const gate = new Promise((res) => { resolveTranslate = res; });
  const { document, window, store } = setup(t, {
    translate: () => gate.then(() => 'pale mint green'),
  });
  const input = document.querySelector('input[data-field="backgroundColor"]');

  // 拖动过程中的 input 事件绝不触发写回。
  input.value = '#111111';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(store.getState().backgroundColor, '#ffffff');

  input.value = '#dbfff4';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(store.getState().backgroundColor, '#dbfff4');
  // 翻译中显示极小的 loading 转圈。
  assert.ok(document.querySelector('#page-tune .color-status.loading') !== null);

  resolveTranslate('pale mint green');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getState().colorNames['#dbfff4'], 'pale mint green');
  assert.ok(document.body.innerHTML.includes('Pale mint green'));
  assert.ok(document.body.innerHTML.includes('#DBFFF4'));
});

test('appended hex main color shows its english name on the pill', async (t) => {
  const { document, window, store } = setup(t);
  const input = document.querySelector('input[data-field="mainColors"]');
  input.value = '#dbfff4';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(store.getState().mainColors.includes('#dbfff4'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getState().colorNames['#dbfff4'], 'pale aquamarine');
  const pill = control(document, 'mainColors', '#dbfff4');
  assert.ok(pill.textContent.includes('Pale aquamarine'));
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
  const found = [...document.querySelectorAll('#page-detail [data-group]')]
    .find((el) => el.dataset.group === title);
  assert.ok(found, `missing group ${title}`);
  return found;
}

function groupToggle(document, title) {
  return groupBySummary(document, title).querySelector('[data-accordion-toggle]');
}

test('locking a reference disables the face and makeup panels and strips the face', (t) => {
  const { window, document, store, images } = setup(t);
  // 「上传参考图」已删除：一般页基准立绘回到纯文生图，锁脸走下载页选定基准立绘。
  assert.equal(document.getElementById('reference-file'), null);
  assert.equal(document.body.textContent.includes('上传参考图'), false);
  const face = groupBySummary(document, '面部');
  assert.equal(face.querySelector('[data-accordion-toggle]').disabled, false);

  images.reference = PNG;
  assert.equal(lockReference(store, window.localStorage, PNG), true);

  assert.equal(groupToggle(document, '面部').disabled, true);
  assert.equal(groupToggle(document, '妆容').disabled, true);
  assert.equal(store.getState().faceShape, '');
  assert.equal(store.getState().hairStyle, '双马尾（高/低）');
  const backup = JSON.parse(window.localStorage.getItem(FACE_BACKUP_KEY));
  assert.equal(backup.faceShape, '鹅蛋脸（标准）');
  assert.equal(document.body.textContent.includes('已开启锁脸模式，当前角色的面部与妆容将由参考图决定。'), true);
  assert.equal(JSON.stringify(store.getState()).includes('data:image/'), false);
  assert.equal(JSON.stringify(window.localStorage.getItem('myCharacterConfig')).includes('data:image/'), false);

  control(document, 'faceShape', '鹅蛋脸（标准）').click();
  control(document, 'lipstick', '自然色').click();
  assert.equal(store.getState().faceShape, '');

  // 解锁不再依赖「移除」按钮（上传参考图入口已删除），直接走 store 的 unlock。
  assert.equal(unlockReference(store, window.localStorage), true);
  assert.equal(store.getState().faceShape, '鹅蛋脸（标准）');
  assert.equal(store.getState().lipstick, '自然色');
  assert.equal(window.localStorage.getItem(FACE_BACKUP_KEY), null);
  assert.equal(groupToggle(document, '面部').disabled, false);
  assert.equal(groupToggle(document, '妆容').disabled, false);
  assert.equal(document.body.textContent.includes('已开启锁脸模式'), false);
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
  assert.equal(groupToggle(document, '面部').disabled, false);
});

const LABELS = ['生成基准立绘', '生成三视图', '生成表情差分图', '生成服饰拆解图', '生成手部拆解图', '生成Q版形象', '生成完整设定集'];

function generateButtons(document) {
  return LABELS.map((label) => buttonByText(document, label));
}

test('generating base portraits fills the gallery and keeps progress across redraws', async (t) => {
  const gallery = createGallery();
  const tasks = scriptedTasks();
  const { window, document } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  buttonByText(document, '生成基准立绘').click();
  await waitFor(() => tasks.submissions.length === 1);
  assert.equal(tasks.submissions[0].kind, 'image');
  assert.equal(tasks.submissions[0].pool, 'main');
  assert.equal(tasks.submissions[0].steps.length, 4);
  assert.equal(generateButtons(document).every((button) => button.disabled), true);

  tasks.complete(0);
  await waitFor(() => document.querySelectorAll('#output img').length === 1);
  assert.equal(document.querySelector('#status').textContent, '正在生成基准立绘（1/4）');
  control(document, 'baseAspect', '9:16').click();
  await tick();
  assert.equal(document.querySelector('#status').textContent, '正在生成基准立绘（1/4）');
  assert.equal(generateButtons(document).every((button) => button.disabled), true);

  tasks.complete(1);
  await waitFor(() => document.querySelectorAll('#output img').length === 2);
  tasks.complete(2);
  await waitFor(() => document.querySelectorAll('#output img').length === 3);
  tasks.complete(3);
  await waitFor(() => document.querySelectorAll('#output img').length === 4);
  tasks.finish();
  await waitFor(() => document.querySelector('#status').textContent === '已生成基准立绘');
  assert.equal(document.querySelectorAll('#output img').length, 4);
  assert.equal(document.querySelector('#output').textContent.includes('还没有图片'), false);
  assert.equal(generateButtons(document).every((button) => button.disabled), false);
  assert.equal(JSON.stringify(window.localStorage).includes('data:image/'), false);
  assert.equal(gallery.batches().length, 1);
  assert.equal(gallery.batches()[0].items.length, 4);

  const first = gallery.batches()[0].items[0];
  // 基准改到下载页「基准立绘」标签里选择
  document.querySelector('#sidebar [data-route="download"]').click();
  document.querySelector('[data-download-tab="base"]').click();
  document.querySelector(`#base-select [data-base-select="${first.id}"]`).click();
  assert.equal(gallery.base().seed, first.seed);
  assert.equal(gallery.base().dataUrl, first.dataUrl);
});

test('the progress bar shows and fills as each image completes', async (t) => {
  const gallery = createGallery();
  const tasks = scriptedTasks();
  const { document } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  buttonByText(document, '生成基准立绘').click();
  await waitFor(() => document.getElementById('progress').hidden === false);
  const bar = document.getElementById('progress');
  assert.equal(bar.hidden, false, 'progress bar is visible while generating');
  assert.equal(bar.classList.contains('active'), true);
  assert.equal(bar.classList.contains('pending'), true, 'first image still pending');

  for (let i = 1; i <= 4; i += 1) {
    tasks.complete(i - 1);
    await waitFor(() => document.querySelectorAll('#output img').length === i);
    if (i < 4) {
      assert.equal(document.getElementById('progress').hidden, false);
      assert.equal(document.querySelector('#status').textContent, `正在生成基准立绘（${i}/4）`);
    }
  }
  tasks.finish();
  await waitFor(() => document.getElementById('progress').hidden === true);
  assert.equal(document.querySelector('#status').textContent, '已生成基准立绘');
});

test('stopping generation cancels the server task and discards everything', async (t) => {
  const gallery = createGallery();
  const tasks = scriptedTasks();
  const { document } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  const stop = document.querySelector('[data-stop]');
  assert.ok(stop);
  assert.equal(stop.closest('.stop-row').hidden, true, 'stop button is hidden when idle');

  buttonByText(document, '生成基准立绘').click();
  await waitFor(() => tasks.submissions.length === 1);
  const visibleStop = document.querySelector('[data-stop]');
  assert.equal(visibleStop.closest('.stop-row').hidden, false, 'stop button appears while generating');

  // 先回显一张，再按下停止：已回显的和没开始的都丢掉。
  tasks.complete(0);
  await waitFor(() => document.querySelectorAll('#output img').length === 1);
  document.querySelector('[data-stop]').click();
  await waitFor(() => tasks.cancelled.length === 1);

  await waitFor(() => document.querySelector('#status').textContent === '已停止生成');
  assert.equal(tasks.cancelled[0], tasks.task().id, '停止 = 取消服务端任务');
  assert.equal(gallery.batches().length, 0, 'stopped batch is not saved');
  assert.equal(document.querySelector('#output').textContent.trim(), '还没有图片');
  assert.equal(document.querySelector('[data-stop]').closest('.stop-row').hidden, true);
  assert.equal(generateButtons(document).every((button) => button.disabled), false);
  assert.equal(document.getElementById('progress').hidden, true);
});

test('a failed generation shows the error and stores nothing', async (t) => {
  const gallery = createGallery();
  const tasks = scriptedTasks();
  const { document } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  buttonByText(document, '生成基准立绘').click();
  await waitFor(() => tasks.submissions.length === 1);
  tasks.failTask('上游失败');
  await waitFor(() => document.querySelector('#status').textContent === '上游失败');
  assert.equal(gallery.batches().length, 0);
  assert.equal(document.querySelector('#output').textContent.trim(), '还没有图片');
  assert.equal(generateButtons(document).every((button) => button.disabled), false);
});

test('turnaround without a base warns that the face will not be locked', async (t) => {
  const gallery = createGallery();
  const tasks = scriptedTasks();
  const { document } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  buttonByText(document, '生成三视图').click();
  await waitFor(() => tasks.submissions.length === 1);
  tasks.complete(0, { seed: 1 });
  tasks.finish();
  await waitFor(() => document.querySelectorAll('#output img').length === 1);
  await waitFor(() => document.querySelector('#status').textContent === '已生成三视图。尚未设定角色基准，本次不会锁定脸。');
  assert.equal(gallery.base(), null);
});

test('each batch appends its images to the output strip', async (t) => {
  const gallery = createGallery();
  const tasks = scriptedTasks();
  const { document } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  const second = 'data:image/png;base64,BB==';
  buttonByText(document, '生成三视图').click();
  await waitFor(() => tasks.submissions.length === 1);
  tasks.complete(0, { seed: 1 });
  tasks.finish();
  await waitFor(() => document.querySelectorAll('#output img').length === 1);
  await waitFor(() => document.querySelector('#status').textContent.startsWith('已生成三视图'));

  buttonByText(document, '生成三视图').click();
  await waitFor(() => tasks.submissions.length === 2);
  tasks.complete(0, { seed: 2, dataUrl: second });
  tasks.finish();
  await waitFor(() => document.querySelectorAll('#output img').length === 2);
  await waitFor(() => document.querySelector('#status').textContent === '已生成三视图。尚未设定角色基准，本次不会锁定脸。');
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

test('the generate page shows the locked model and its price', (t) => {
  const { document } = setup(t);
  document.querySelector('#sidebar [data-route="generate"]').click();
  const page = document.getElementById('page-generate');
  assert.match(page.textContent, /基准立绘/);
  assert.match(page.textContent, /qwen-image-3\.0/);
  assert.match(page.textContent, /\$0\.024754\/张/);
  assert.match(page.textContent, /设定集/);
  assert.match(page.textContent, /gemini-3-pro-image-c/);
  assert.match(page.textContent, /￥0\.268\/张/);
  // Q版单独一行，锁到千问，不再挂在 Gemini 设定集下。
  assert.match(page.textContent, /Q版形象/);
  assert.equal(page.textContent.includes('qwen-image-3.0'), true);
  const chibiRow = [...page.querySelectorAll('.model-lock')]
    .find((row) => row.textContent.includes('Q版形象'));
  assert.ok(chibiRow, 'Q版 should have its own model row');
  assert.match(chibiRow.textContent, /qwen-image-3\.0/);
  assert.equal(chibiRow.textContent.includes('gemini'), false);
  assert.equal(page.querySelector('[data-image-model]'), null);
  assert.equal(page.textContent.includes('￥0.1008'), false);
});

test('the tune page is locked to Nano Banana Pro (Gemini 3 Pro Image)', (t) => {
  const { document } = setup(t);
  document.querySelector('#sidebar [data-route="tune"]').click();
  const page = document.getElementById('page-tune');
  assert.match(page.textContent, /gemini-3-pro-image-c/);
  assert.match(page.textContent, /￥0\.268\/张/);
  // 千问那套价格不该再出现在定向微调页。
  assert.equal(page.textContent.includes('$0.024754'), false);
});

test('the tune page offers an optional hand sheet upload and passes it as a third reference', (t) => {
  const { document } = setup(t);
  document.querySelector('#sidebar [data-route="tune"]').click();
  const input = document.getElementById('handsheet-file');
  assert.ok(input, 'tune page must offer a hand sheet upload');
  assert.ok(document.querySelector('[data-upload-zone="handsheet-file"]'), 'hand sheet input needs a drop zone');
  assert.match(document.getElementById('page-tune').textContent, /手部拆解图（可选）/);
});

test('the hand sheet upload wires into the mounted images and clears on remove', async (t) => {
  const { document, window, images } = setup(t);
  document.querySelector('#sidebar [data-route="tune"]').click();
  const input = document.getElementById('handsheet-file');
  const file = new window.File([new Uint8Array([1, 2, 3])], 'hand.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 20 && !images.handSheet; i += 1) await tick();
  assert.ok(String(images.handSheet).startsWith('data:image/'), 'hand sheet must be read as a data url');
  const remove = document.getElementById('remove-handsheet');
  assert.ok(remove, 'a preview with a remove button must render');
  remove.click();
  assert.equal(images.handSheet, null);
  assert.equal(document.getElementById('remove-handsheet'), null);
});

test('the tune page submits background tasks without locking the page', async (t) => {
  const tasks = scriptedTasks();
  const gallery = createGallery();
  const { document, images } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  document.querySelector('#sidebar [data-route="tune"]').click();
  images.turnaround = PNG;
  images.expressions = PNG;

  const button = () => document.querySelector('[data-generate="生成微调角色图集"]');
  button().click();
  await waitFor(() => tasks.submissions.length === 1);

  // 提交即返回：界面没进「生成中」，按钮仍可点，停止按钮不出现。
  assert.equal(button().disabled, false, '提交后按钮必须仍可点');
  assert.equal(document.querySelector('#page-tune .stop-row').hidden, true, '微调页不再有停止按钮');

  // 第一份还没出图就能提交第二份：两份都在池 A 排队。
  button().click();
  await waitFor(() => tasks.submissions.length === 2);
  assert.equal(tasks.submissions[0].pool, 'main');
  assert.equal(tasks.submissions[1].pool, 'main');
  assert.equal(tasks.submissions[1].total, tasks.submissions[0].total);
  // 微调走 Gemini：提交的每一步模型都必须是 gemini-3-pro-image-c，且提示词收尾是防崩手补丁。
  for (const step of tasks.submissions[0].steps) {
    assert.equal(step.body.model, 'gemini-3-pro-image-c');
    assert.ok(step.body.prompt.endsWith('2d anime style'));
  }
  assert.match(document.getElementById('tune-queue').textContent, /后台任务 2 个/);

  // 第一份跑完：结果由后台轮询并进图库并发到本页输出区，页面不需要刷新。
  const first = tasks.tasks[0];
  for (let index = 0; index < first.total; index += 1) {
    const step = first.steps[index];
    step.status = 'done';
    step.dataUrl = PNG;
    first.done += 1;
  }
  first.status = 'done';
  first.message = '已完成';
  first.progress = 100;
  await waitFor(() => gallery.batches().length === 1);
  await waitFor(() => document.querySelectorAll('#tune-output img').length === first.total);
  assert.equal(document.getElementById('tune-status').textContent, `已生成微调角色图集（${first.total} 张）`);
  // 第二份仍在排队，页面依然可以继续提交。
  assert.match(document.getElementById('tune-queue').textContent, /后台任务 2 个/);
  assert.equal(button().disabled, false);
});

test('tune polling updates only the output region and never rebuilds the page', async (t) => {
  const tasks = scriptedTasks();
  const gallery = createGallery();
  const { document, images } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  document.querySelector('#sidebar [data-route="tune"]').click();
  images.turnaround = PNG;
  images.expressions = PNG;

  document.querySelector('[data-generate="生成微调角色图集"]').click();
  await waitFor(() => tasks.submissions.length === 1);

  // 轮询运行期间，整页 DOM 必须保持不变：否则滚动位置会被清零、折叠面板被重建，
  // 用户正在点选的场景按钮就会被抽走。
  const sheet = document.querySelector('#page-tune .tune-sheet');
  const sceneGroup = document.querySelector('#page-tune [data-group]');
  assert.ok(sheet && sceneGroup, 'tune page rendered');

  const first = tasks.tasks[0];
  tasks.complete(0);
  await waitFor(() => document.querySelectorAll('#tune-output img').length === 1);
  // 再等几轮轮询，确认没有重建。
  await tick();
  await tick();
  await tick();

  assert.equal(document.querySelector('#page-tune .tune-sheet'), sheet, '整页容器必须还是同一个节点');
  assert.equal(sheet.isConnected, true, '轮询不能把页面节点摘掉');
  assert.equal(document.querySelector('#page-tune [data-group]'), sceneGroup, '折叠分组不能被重建');
  // 状态行与队列行仍然跟着更新。
  assert.match(document.getElementById('tune-queue').textContent, /后台任务 1 个/);
});

test('a full redraw keeps the page scroll position', (t) => {
  const { document, store } = setup(t);
  document.querySelector('#sidebar [data-route="tune"]').click();
  const page = document.getElementById('page-tune');
  // jsdom 不做布局，scrollTop 恒为 0；这里挂一个真实读写的存取器来验证「重绘前后保持一致」。
  let top = 0;
  Object.defineProperty(page, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value) => { top = value; },
  });
  page.scrollTop = 320;
  store.replace({ ...store.getState(), pose: ['站立'] });
  assert.equal(page.scrollTop, 320, '整页重绘后必须停在原来的滚动位置');
});

test('general generate polling also patches only the output strip', async (t) => {
  const tasks = scriptedTasks();
  const gallery = createGallery();
  const { document } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  document.querySelector('#sidebar [data-route="generate"]').click();
  buttonByText(document, '生成基准立绘').click();
  await waitFor(() => tasks.submissions.length === 1);

  const panel = document.querySelector('#page-generate .right-panel');
  const strip = document.getElementById('output');
  assert.ok(panel && strip, 'generate page rendered');

  tasks.complete(0);
  await waitFor(() => document.querySelectorAll('#output img').length === 1);
  await tick();
  await tick();

  // 轮询期间整块右栏不许被重建：折叠的「更多」、拉开的数量滑块、滚动位置都靠它存活。
  assert.equal(document.querySelector('#page-generate .right-panel'), panel, '整栏不能重建');
  assert.equal(panel.isConnected, true);
  assert.equal(document.getElementById('output'), strip, '出图条本身是同一个容器');
  assert.equal(strip.querySelectorAll('img').length, 1, '新图照样进来');
  assert.match(document.getElementById('status').textContent, /正在生成基准立绘/);
});

test('reloaded history stays on the download page and leaves the generate strip empty', async (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  await loadHistory(document, gallery, async () => ({
    images: [{
      id: 1,
      url: 'https://cdn/a.png',
      kind: '基准立绘',
      aspect: '3:4',
      seed: 1,
      positive: 'p',
      negative: 'n',
      batch_id: 'b1',
    }],
  }));
  assert.equal(document.querySelector('#output').textContent.trim(), '还没有图片');
  assert.equal(document.querySelectorAll('#output img').length, 0);
  document.querySelector('#sidebar [data-route="download"]').click();
  assert.match(document.getElementById('download-list').textContent, /基准立绘/);
});

test('opening the download page lists one batch and an empty gallery explains itself', (t) => {
  const gallery = createGallery();
  const { document, window } = setup(t, { gallery });
  document.querySelector('#sidebar [data-route="download"]').click();
  assert.equal(document.getElementById('page-generate').hidden, true);
  assert.equal(document.getElementById('download-view').hidden, false);
  assert.equal(document.getElementById('download-list').textContent, '还没有生成图片');
  assert.equal(gallery.batches().length, 0);

  document.getElementById('download-back').click();
  gallery.addBatch([
    sheet(),
    sheet({ kind: '三视图', aspect: '16:9', seed: 22, positive: '正向乙', negative: '负向乙', dataUrl: `${PNG}B` }),
  ]);
  document.querySelector('#sidebar [data-route="download"]').click();
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

test('download tabs list the newest batch first', (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  const older = gallery.addBatch([sheet({ seed: 1, dataUrl: `${PNG}old` })]);
  older.createdAt = 1000;
  const newer = gallery.addBatch([sheet({ seed: 2, dataUrl: `${PNG}new` })]);
  newer.createdAt = 2000;
  document.querySelector('#sidebar [data-route="download"]').click();
  const rows = [...document.querySelectorAll('#download-list .download-row img')];
  assert.equal(rows[0].getAttribute('src'), `${PNG}new`);
  assert.equal(rows[1].getAttribute('src'), `${PNG}old`);
  document.querySelector('[data-download-tab="base"]').click();
  const cards = [...document.querySelectorAll('#base-select .base-card-img')];
  assert.equal(cards[0].getAttribute('src'), `${PNG}new`);
  assert.equal(cards[1].getAttribute('src'), `${PNG}old`);
});

test('the base tab lists base portraits and clicking one sets the current base', (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  gallery.addBatch([
    sheet({ seed: 11 }),
    sheet({ seed: 12, kind: '三视图', aspect: '16:9' }),
    sheet({ seed: 13, kind: '表情差分图' }),
  ]);
  document.querySelector('#sidebar [data-route="download"]').click();

  // 默认在「全部」标签
  assert.equal(document.getElementById('download-list').hidden, false);
  assert.equal(document.getElementById('base-select').hidden, true);

  // 切到「基准立绘」标签，只列出 kind === 基准立绘 的一张卡片
  const baseTab = document.querySelector('[data-download-tab="base"]');
  baseTab.click();
  assert.equal(baseTab.classList.contains('active'), true);
  assert.equal(document.getElementById('download-list').hidden, true);
  assert.equal(document.getElementById('base-select').hidden, false);
  const confirms = document.querySelectorAll('#base-select [data-base-select]');
  assert.equal(confirms.length, 1);
  assert.equal(buttonByText(document, '确定').textContent.trim(), '确定');
  assert.equal(gallery.base(), null);

  // 点「确定」即设为当前基准
  confirms[0].click();
  assert.equal(gallery.base().seed, 11);
  assert.equal(gallery.base().dataUrl, PNG);
  const selectedCard = document.querySelector('#base-select .base-card');
  assert.equal(selectedCard.classList.contains('on'), true);

  // 点击图片查看大图
  const img = document.querySelector('#base-select [data-base-view]');
  img.click();
  assert.equal(document.getElementById('fullscreen').hidden, false);
  assert.equal(document.getElementById('fullscreen-img').getAttribute('src'), PNG);
});

test('a column redraw keeps the open download list and the in-memory gallery', (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  gallery.addBatch([sheet(), sheet({ kind: '三视图', seed: 22 })]);
  document.querySelector('#sidebar [data-route="download"]').click();
  assert.equal(buttonsByText(document.getElementById('download-list'), '下载这张').length, 2);
  control(document, 'baseAspect', '9:16').click();
  assert.equal(document.getElementById('page-generate').hidden, true);
  assert.equal(document.getElementById('download-view').hidden, false);
  assert.equal(buttonsByText(document.getElementById('download-list'), '下载这张').length, 2);
  assert.equal(buttonsByText(document.getElementById('download-list'), '打包本次').length, 1);
  assert.equal(gallery.batches().length, 1);
});

test('clicking a download page image opens the fullscreen preview', (t) => {
  const gallery = createGallery();
  gallery.addBatch([sheet()]);
  const { document } = setup(t, { gallery });
  document.querySelector('#sidebar [data-route="download"]').click();
  const img = document.querySelector('#download-list .download-row img');
  assert.ok(img);
  img.click();
  const fullscreen = document.getElementById('fullscreen');
  assert.equal(fullscreen.hidden, false);
  assert.equal(document.getElementById('fullscreen-img').getAttribute('src'), PNG);
  assert.equal(document.getElementById('download-view').hidden, false);
  document.getElementById('fullscreen-close').click();
  assert.equal(fullscreen.hidden, true);
});

test('a batch that is not complete has no pack button', (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  const stored = gallery.addBatch([sheet()]);
  stored.status = 'running';
  document.querySelector('#sidebar [data-route="download"]').click();
  const list = document.getElementById('download-list');
  assert.equal(buttonsByText(list, '下载这张').length, 1);
  assert.equal(buttonsByText(list, '打包本次').length, 0);
});

test('adding a batch while the download page is open refreshes the list', (t) => {
  const gallery = createGallery();
  const { document } = setup(t, { gallery });
  document.querySelector('#sidebar [data-route="download"]').click();
  assert.equal(document.getElementById('download-list').textContent, '还没有生成图片');
  gallery.addBatch([sheet({ kind: '三视图' })]);
  const list = document.getElementById('download-list');
  assert.equal(list.textContent.includes('还没有生成图片'), false);
  assert.equal(buttonsByText(list, '下载这张').length, 1);
  assert.equal(buttonsByText(list, '打包本次').length, 1);
  assert.equal(document.querySelector('#output').textContent.trim(), '还没有图片');
});

test('packing a remote batch pulls bytes through the local image proxy', async (t) => {
  const gallery = createGallery();
  const { document, window } = setup(t, { gallery });
  const png = Uint8Array.from(Buffer.from(PNG.slice(PNG.indexOf(',') + 1), 'base64'));
  const seen = [];
  window.fetch = async (url) => {
    seen.push(String(url));
    return { ok: true, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
  };
  const saved = captureDownloads(window);
  gallery.addBatch([{
    kind: '基准立绘', aspect: '3:4', seed: 1, positive: 'p', negative: 'n',
    dataUrl: 'https://cdn.example/a.png', url: 'https://cdn.example/a.png', remote: true,
  }]);
  document.querySelector('#sidebar [data-route="download"]').click();
  buttonsByText(document.getElementById('download-list'), '打包本次')[0].click();
  await tick();
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(decodeURIComponent(seen[0].slice(seen[0].indexOf('=') + 1)), 'https://cdn.example/a.png');
  assert.equal(saved.length, 1);
  assert.match(saved[0].download, /^角色设定-\d{8}-\d{6}\.zip$/);
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
  document.querySelector('#sidebar [data-route="download"]').click();
  const list = document.getElementById('download-list');
  buttonsByText(list, '下载这张')[1].click();
  assert.equal(saved[0].download, `${stored.items[1].fileKey}.png`);
  assert.equal(saved[0].href, second);
  buttonsByText(list, '打包本次')[0].click();
  await tick();
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

test('the full suite requires a locked base and blocks with a status hint', async (t) => {
  const gallery = createGallery();
  const tasks = scriptedTasks();
  const { document } = setup(t, { gallery, taskServer: tasks, pollMs: 1 });
  buttonByText(document, '生成完整设定集').click();
  assert.equal(document.querySelector('#status').textContent, '请先选择合适的基准立绘');
  assert.equal(gallery.batches().length, 0);
  assert.equal(tasks.submissions.length, 0);
});

test('the full suite generates the four follow-up kinds referencing the base', async (t) => {
  const gallery = createGallery();
  const baseBatch = gallery.addBatch([{
    kind: '基准立绘', aspect: '3:4', seed: 7, positive: 'p', negative: 'n', dataUrl: PNG,
  }]);
  gallery.select(baseBatch.items[0].id);
  gallery.lockSelected();
  const { queue, fetcher } = scriptedFetcher();
  const tasks = scriptedTasks();
  const { document } = setup(t, { gallery, fetcher, taskServer: tasks, pollMs: 1 });
  buttonByText(document, '生成完整设定集').click();
  // 套图构建阶段只发一次 /api/chibi-style（Q版风格图），回传空列表即可。
  await waitFor(() => queue.some((job) => job.url === '/api/chibi-style'));
  await respondNext(queue, { images: [] });
  await waitFor(() => tasks.submissions.length === 1);
  const steps = tasks.submissions[0].steps;
  assert.deepEqual(steps.map((step) => step.kind), ['三视图', 'Q版形象', '表情差分图', '服饰拆解图']);
  // 完整设定集里 Q 版单独走千问，其余图种继续用设定集模型（Gemini）。
  assert.equal(steps[0].body.model, 'gemini-3-pro-image-c');
  assert.equal(steps[1].body.model, 'qwen-image-3.0');
  // 第二波的服饰拆解图引用本套刚出的三视图（`#0`），表情图只吃基准（命名引用）。
  assert.equal(steps[3].ref.length, 2);
  assert.ok(steps[3].ref.includes('#0'));
  assert.ok(steps[2].ref.every((token) => !token.startsWith('#')));
  for (let index = 0; index < steps.length; index += 1) tasks.complete(index);
  tasks.finish();
  await waitFor(() => document.querySelector('#status').textContent === '已生成1套设定集');
  assert.equal(document.querySelectorAll('#output img').length, 5);
  const batch = gallery.batches().at(-1);
  assert.deepEqual(batch.items.map((entry) => entry.kind), ['三视图', '表情差分图', '服饰拆解图', 'Q版形象']);
  assert.equal(batch.base.seed, 7);
});

test('the inpaint page is gone from the sidebar and the workbench', (t) => {
  const { document } = setup(t);
  assert.equal(document.querySelector('#sidebar [data-route="inpaint"]'), null, 'nav entry must be removed');
  assert.equal(document.getElementById('page-inpaint'), null, 'page section must be removed');
  for (const route of ['base', 'detail', 'tune', 'generate', 'download']) {
    assert.ok(document.querySelector(`#sidebar [data-route="${route}"]`), `route ${route} must stay`);
  }
});

test('上传参考图已删除，其余上传口都包在拖放区里', (t) => {
  const { document } = setup(t);
  assert.equal(document.getElementById('reference-file'), null, '一般页不再提供上传参考图');
  for (const id of ['turnaround-file', 'expression-file']) {
    assert.ok(document.getElementById(id), `missing input ${id}`);
    const zone = document.querySelector(`[data-upload-zone="${id}"]`);
    assert.ok(zone, `missing drop zone for ${id}`);
    assert.ok(zone.contains(document.getElementById(id)), `zone ${id} must wrap its input`);
  }
});

test('the wallpaper page builds 16 grading sliders', (t) => {
  const { document } = setup(t);
  document.querySelector('#sidebar [data-route="wallpaper"]').click();
  assert.equal(document.querySelector('#page-wallpaper').hidden, false, 'wallpaper page becomes visible');
  assert.equal(document.querySelectorAll('#wallpaper-grading .wp-slider').length, 16, '16 grading sliders');
});

test('动态壁纸只有一条 bar，导出在没底图前是禁用的', (t) => {
  const { document } = setup(t);
  // 两个旧 bar 已经合并：导航里只剩一个「动态壁纸」，也没有 wallpaper2 这一页。
  assert.equal(document.querySelectorAll('#sidebar [data-route="wallpaper"]').length, 1);
  assert.equal(document.querySelectorAll('#sidebar [data-route="wallpaper2"]').length, 0);
  assert.equal(document.getElementById('page-wallpaper2'), null);

  document.querySelector('#sidebar [data-route="wallpaper"]').click();
  const exportAll = document.getElementById('wallpaper-export-all');
  assert.equal(exportAll.disabled, true, '没有底图时不允许导出');
  assert.equal(document.querySelector('[data-wp-export="pc"]').disabled, true, '单端导出同样禁用');

  // 三个步骤先建好，②③ 在没原片/母版时标记为未就绪。
  for (const step of document.querySelectorAll('#page-wallpaper .wp-step')) {
    const name = step.dataset.wpStep;
    const expected = name === 'generate' ? '1' : '0';
    assert.equal(step.dataset.ready, expected, `${name} 初始就绪态`);
  }
  assert.equal(document.getElementById('wallpaper-step-edit').textContent, '等待母版');
});

test('连接关系默认禁用，点一下才四端联动', (t) => {
  const { document } = setup(t);
  document.querySelector('#sidebar [data-route="wallpaper"]').click();
  const link = document.getElementById('wallpaper-link');
  assert.equal(link.dataset.wpLink, '0', '默认不联动');
  assert.equal(link.classList.contains('on'), false, '默认没有高亮');
  assert.equal(link.textContent, '连接关系：已禁用');

  link.click();
  assert.equal(link.dataset.wpLink, '1');
  assert.equal(link.classList.contains('on'), true);
  assert.equal(link.textContent, '连接关系：已启用');

  link.click();
  assert.equal(link.dataset.wpLink, '0', '再点一次回到禁用');
  assert.equal(link.textContent, '连接关系：已禁用');
});

test('动态壁纸的上传口吃 1~N 张图，点提交把它们排进池 B 任务', async (t) => {
  const tasks = scriptedTasks();
  const { document, window } = setup(t, {
    taskServer: tasks,
    pollMs: 1,
    beforeMount(win) {
      // jsdom 的 Image 不触发 load，置空让 flattenWallpaper2Image 直接回退原图，别卡 6 秒兜底。
      win.Image = null;
    },
  });
  document.querySelector('#sidebar [data-route="wallpaper"]').click();

  const input = document.getElementById('wallpaper2-source');
  const files = ['a.png', 'b.png'].map((name) => new window.File(['x'], name, { type: 'image/png' }));
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));

  const status = document.getElementById('wallpaper2-status');
  await waitFor(() => status.textContent.includes('已选择 2 张立绘'));
  assert.equal(tasks.submissions.length, 0, '上传不等于提交，还没点提交任务不该有任务');

  // 提交后本页会 reload：用 defaultView 代理把 reload 换成计数桩，
  // 既断言刷新动作，又不让 jsdom 抛「navigation to another Document」。
  let reloads = 0;
  Object.defineProperty(document, 'defaultView', {
    configurable: true,
    value: new Proxy(window, {
      get(target, prop) {
        if (prop === 'location') return { reload() { reloads += 1; } };
        return Reflect.get(target, prop);
      },
    }),
  });

  document.getElementById('wallpaper2-submit').click();
  await waitFor(() => tasks.submissions.length === 1);
  await waitFor(() => reloads === 1);

  const body = tasks.submissions[0];
  assert.equal(body.kind, 'wallpaper-batch');
  assert.equal(body.pool, 'wallpaper');
  assert.equal(body.total, 2);
  assert.equal(body.unit, '张');
  assert.equal(body.steps.length, 2, '每张立绘一条子项');
  assert.equal(body.steps[1].title, 'b.png');
  assert.equal(body.steps[1].imageDataUrl.startsWith('data:image/'), true, '提交的是图片本身，不只是文件名');
});

test('dragging over a zone highlights it and dropping fires a change event', (t) => {
  const { document, window } = setup(t);
  const zone = document.querySelector('[data-upload-zone="turnaround-file"]');
  const input = document.getElementById('turnaround-file');
  let changed = 0;
  input.addEventListener('change', () => { changed += 1; });

  const enter = new window.Event('dragenter', { bubbles: true, cancelable: true });
  zone.dispatchEvent(enter);
  assert.equal(zone.classList.contains('drag-over'), true, 'dragenter must highlight the zone');

  const over = new window.Event('dragover', { bubbles: true, cancelable: true });
  zone.dispatchEvent(over);
  assert.equal(zone.classList.contains('drag-over'), true, 'dragover must keep the highlight');

  const file = new window.File(['x'], 'turn.png', { type: 'image/png' });
  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { configurable: true, value: { files: [file] } });
  zone.dispatchEvent(drop);

  assert.equal(zone.classList.contains('drag-over'), false, 'drop must clear the highlight');
  assert.equal(changed, 1, 'drop must dispatch one change event');
});
