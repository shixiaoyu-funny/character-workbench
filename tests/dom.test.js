import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

import { applyLinkage } from '../src/rules.js';
import { createStore, defaultState } from '../src/state.js';
import { mount } from '../src/dom.js';

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

function setup(t, { beforeMount, matchMedia, virtualConsole } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://127.0.0.1/', virtualConsole });
  const { window } = dom;
  const { document } = window;
  if (matchMedia) window.matchMedia = matchMedia;
  if (beforeMount) beforeMount(window);
  const store = createStore({
    storage: window.localStorage,
    schedule: manualSchedule(),
    applyLinkage,
  });
  mount(document, { store, gallery: {} });
  t.after(() => window.close());
  return { window, document, store };
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

test('download entry and generate buttons report that generation is not connected', (t) => {
  const { document } = setup(t);
  const download = document.querySelector('#open-download');
  assert.ok(download);
  assert.equal(download.textContent.trim(), '下载页');
  assert.equal(document.body.textContent.includes('还没有图片'), true);
  assert.equal(document.body.textContent.includes('图库是空的'), true);
  for (const label of ['生成基准立绘', '生成三视图', '生成表情差分图', '生成服饰拆解图', '生成Q版形象', '生成完整图片（一键全套）']) {
    buttonByText(document, label).click();
    assert.equal(document.querySelector('#status').textContent, '生成功能尚未接入');
  }
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

test('main.js boots the workbench with the browser timer and toast', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /DOMContentLoaded/);
  assert.match(source, /schedule:\s*\{ in: \(ms, fn\) => setTimeout\(fn, ms\), cancel: clearTimeout \}/);
  assert.match(source, /getElementById\(['"]toast['"]\)/);
  assert.match(source, /mount\(/);
  assert.doesNotMatch(source, /\/api\/generate/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});
