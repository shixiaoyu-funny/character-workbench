import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState, sanitizeState, createStore, CONFIG_KEY } from '../src/state.js';

function manualSchedule() {
  const jobs = new Map();
  let n = 0;
  return {
    jobs,
    in(ms, fn) { const id = ++n; jobs.set(id, { ms, fn, cancelled: false }); return id; },
    cancel(id) { const job = jobs.get(id); if (job) job.cancelled = true; },
    run(id) { const job = jobs.get(id); if (job && !job.cancelled) job.fn(); }
  };
}

function memoryStorage(initial = new Map()) {
  const map = new Map(initial);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    dump: () => map,
  };
}

function lastJobId(schedule) {
  return [...schedule.jobs.keys()].at(-1);
}

test('defaultState returns independent deep copies', () => {
  const a = defaultState();
  const b = defaultState();
  assert.notEqual(a, b);
  a.gender = '男';
  a.gazes.push('污染');
  a.hairColorExtra = '挑染';
  assert.equal(b.gender, '女');
  assert.deepEqual(b.gazes, ['看着镜头']);
  assert.equal(b.hairColorExtra, '无');
});

test('sanitizeState accepts a complete valid object and returns a copy', () => {
  const s = defaultState();
  const out = sanitizeState(s);
  assert.deepEqual(out, s);
  assert.notEqual(out, s);
  assert.notEqual(out.gazes, s.gazes);
});

test('sanitizeState rejects non-objects', () => {
  assert.equal(sanitizeState('x'), null);
  assert.equal(sanitizeState(null), null);
  assert.equal(sanitizeState([]), null);
});

test('sanitizeState rejects a missing default key', () => {
  const keys = Object.keys(defaultState()).filter((key) => key !== 'style' && key !== 'tuneAspect' && key !== 'tuneGender' && key !== 'tuneShoes' && key !== 'tuneSocks' && key !== 'eyeColor' && key !== 'eyeColorCustom' && key !== 'sheetBg' && key !== 'sheetBgCustom' && key !== 'tuneLegwear' && key !== 'tuneLegwearColor');
  assert.ok(keys.length > 0);
  for (const key of keys) {
    const broken = { ...defaultState() };
    delete broken[key];
    assert.equal(sanitizeState(broken), null, `missing ${key} should be null`);
  }
});

test('sanitizeState backfills the later-added style field from old saves', () => {
  const s = defaultState();
  const old = { ...s };
  delete old.style;
  const out = sanitizeState(old);
  assert.ok(out);
  assert.equal(out.style, '二次元风格');
  const posed = { ...s, pose: '站立', handPose: '自然下垂', headDirection: '正面平视' };
  delete posed.tuneAspect;
  delete posed.tuneGender;
  delete posed.tuneShoes;
  delete posed.tuneSocks;
  const migrated = sanitizeState(posed);
  assert.deepEqual(migrated.pose, ['站立']);
  assert.deepEqual(migrated.handPose, ['自然下垂']);
  assert.deepEqual(migrated.headDirection, ['正面平视']);
  assert.equal(migrated.tuneAspect, '3:4');
  assert.equal(migrated.tuneGender, '女');
  assert.equal(migrated.tuneShoes, true);
  assert.equal(migrated.tuneSocks, true);
});

test('sanitizeState migrates legacy style values to 二次元风格', () => {
  for (const legacy of ['米哈游风', '写实风二次元']) {
    const out = sanitizeState({ ...defaultState(), style: legacy });
    assert.ok(out, `legacy ${legacy} must survive sanitization`);
    assert.equal(out.style, '二次元风格');
  }
  const kept = sanitizeState({ ...defaultState(), style: '二次元风格' });
  assert.equal(kept.style, '二次元风格');
});

test('sanitizeState rejects wrong types', () => {
  assert.equal(sanitizeState({ ...defaultState(), gender: [] }), null);
  assert.equal(sanitizeState({ ...defaultState(), gazes: '看着镜头' }), null);
  assert.equal(sanitizeState({ ...defaultState(), crossdressing: '否' }), null);
  assert.equal(sanitizeState({ ...defaultState(), backgroundColor: ['#ffffff'] }), null);
  assert.equal(sanitizeState({ ...defaultState(), hairColorExtra: ['挑染'] }), null);
  assert.equal(sanitizeState({ ...defaultState(), colorNames: ['#dbfff4'] }), null);
  assert.equal(sanitizeState({ ...defaultState(), colorNames: 'pale mint green' }), null);
});

test('sanitizeState accepts and normalizes colorNames', () => {
  const ok = sanitizeState({ ...defaultState(), colorNames: { '#DBFFF4': 'pale mint green' } });
  assert.deepEqual(ok.colorNames, { '#dbfff4': 'pale mint green' });
  // 非法键或值拒绝。
  assert.equal(sanitizeState({ ...defaultState(), colorNames: { 'red': 'red' } }), null);
  assert.equal(sanitizeState({ ...defaultState(), colorNames: { '#dbfff4': 3 } }), null);
  assert.equal(sanitizeState({ ...defaultState(), colorNames: { '#dbfff4': 'data:image/x' } }), null);
  assert.equal(sanitizeState({ ...defaultState(), colorNames: { '#dbfff4': 'x'.repeat(101) } }), null);
});

test('sanitizeState rejects forbidden keys', () => {
  const forbidden = ['image', 'images', 'base64', 'dataUrl', 'objectUrl', 'seed', 'reference', 'baseImage'];
  for (const key of forbidden) {
    assert.equal(sanitizeState({ ...defaultState(), [key]: 'x' }), null, `${key} should be rejected`);
  }
});

test('sanitizeState rejects suspicious or oversized strings, even inside arrays', () => {
  assert.equal(sanitizeState({ ...defaultState(), hat: 'data:image/png;base64,xxx' }), null);
  assert.equal(sanitizeState({ ...defaultState(), hat: 'blob:https://example.com/abc' }), null);
  assert.equal(sanitizeState({ ...defaultState(), effectSymbols: ['data:image/png;base64,xxx'] }), null);
  assert.equal(sanitizeState({ ...defaultState(), effectSymbols: ['blob:https://example.com/abc'] }), null);
  assert.equal(sanitizeState({ ...defaultState(), background: 'x'.repeat(501) }), null);
  assert.equal(sanitizeState({ ...defaultState(), effectSymbols: ['y'.repeat(501)] }), null);
  const ok = sanitizeState({ ...defaultState(), background: 'x'.repeat(500) });
  assert.equal(ok.background, 'x'.repeat(500));
});

test('sanitizeState drops extra keys', () => {
  const s = defaultState();
  const out = sanitizeState({ ...s, extra: 'whatever', image: 'oops' });
  assert.equal(out, null);
  assert.deepEqual(sanitizeState({ ...s, extra: 'whatever' }), s);
});

test('createStore debounces with delay 1000, cancels the previous timer, and only runs the last save', () => {
  const storage = memoryStorage();
  const schedule = manualSchedule();
  const toasts = [];
  const store = createStore({ storage, schedule, onToast: (m) => toasts.push(m) });

  store.replace({ ...defaultState(), gender: '男' });
  assert.equal(schedule.jobs.size, 1);
  const id1 = lastJobId(schedule);
  assert.equal(schedule.jobs.get(id1).ms, 1000);

  store.replace({ ...defaultState(), role: '奇幻冒险' });
  assert.ok(schedule.jobs.get(id1).cancelled, 'previous timer should be cancelled');
  const id2 = lastJobId(schedule);

  schedule.run(id2);
  schedule.run(id1); // cancelled, must not run
  const saved = JSON.parse(storage.getItem(CONFIG_KEY));
  assert.equal(saved.role, '奇幻冒险');
  assert.notEqual(saved.gender, '男');
  assert.deepEqual(toasts, ['配置已保存到本地']);
  assert.equal(storage.dump().size, 1);

  store.replace(defaultState());
  schedule.run(lastJobId(schedule));
  assert.equal(toasts.length, 1, 'second successful save must not toast again');
  assert.equal(storage.dump().size, 1);
});

test('storage.setItem failure toasts 保存失败 and does not consume the success quota', () => {
  const schedule = manualSchedule();
  const toasts = [];
  const map = new Map();
  let fail = true;
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (fail) throw new Error('quota exceeded'); map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  const store = createStore({ storage, schedule, onToast: (m) => toasts.push(m) });

  store.replace(defaultState());
  schedule.run(lastJobId(schedule));
  assert.deepEqual(toasts, ['保存失败']);
  assert.equal(map.has(CONFIG_KEY), false);

  fail = false;
  store.replace({ ...defaultState(), age: '青年' });
  schedule.run(lastJobId(schedule));
  assert.deepEqual(toasts, ['保存失败', '配置已保存到本地']);

  fail = true;
  store.replace(defaultState());
  schedule.run(lastJobId(schedule));
  assert.deepEqual(toasts, ['保存失败', '配置已保存到本地', '保存失败']);
});

test('hydrate with no stored data uses defaults and never writes', () => {
  const storage = memoryStorage();
  const wrapped = {
    getItem: storage.getItem,
    setItem: (k, v) => { writes.push(k); storage.setItem(k, v); },
    removeItem: storage.removeItem,
  };
  const writes = [];
  const schedule = manualSchedule();
  const linkageCalls = [];
  const store = createStore({
    storage: wrapped, schedule,
    applyLinkage: (s) => { linkageCalls.push(s); return s; },
  });
  store.hydrate();
  assert.deepEqual(store.getState(), defaultState());
  assert.equal(writes.length, 0);
  assert.equal(linkageCalls.length, 0);
  assert.equal(schedule.jobs.size, 0);
  assert.equal(storage.getItem(CONFIG_KEY), null);
});

test('hydrate with valid data restores it, applies linkage, and saves immediately if linkage changed the state', () => {
  const stored = { ...defaultState(), gender: '男' };
  const storage = memoryStorage([[CONFIG_KEY, JSON.stringify(stored)]]);
  const schedule = manualSchedule();
  const toasts = [];
  const calls = [];
  const store = createStore({
    storage, schedule,
    applyLinkage: (s) => { calls.push(1); return { ...s, hairColor: '银白' }; },
    onToast: (m) => toasts.push(m),
  });
  store.hydrate();
  assert.equal(calls.length, 1);
  assert.equal(store.getState().gender, '男');
  assert.equal(store.getState().hairColor, '银白');
  assert.equal(JSON.parse(storage.getItem(CONFIG_KEY)).hairColor, '银白');
  assert.deepEqual(toasts, ['配置已保存到本地'], 'hydrate auto-save consumes the success toast');
  assert.equal(schedule.jobs.size, 0);

  store.replace(defaultState());
  schedule.run(lastJobId(schedule));
  assert.equal(toasts.length, 1, 'quota already consumed by hydrate auto-save');
});

test('hydrate with identical linkage result does not rewrite storage', () => {
  const stored = defaultState();
  const storage = memoryStorage([[CONFIG_KEY, JSON.stringify(stored)]]);
  const schedule = manualSchedule();
  const toasts = [];
  const store = createStore({
    storage, schedule,
    applyLinkage: (s) => ({ ...s }),
    onToast: (m) => toasts.push(m),
  });
  store.hydrate();
  assert.deepEqual(store.getState(), stored);
  assert.equal(storage.getItem(CONFIG_KEY), JSON.stringify(stored));
  assert.equal(toasts.length, 0);
  assert.equal(schedule.jobs.size, 0);
});

test('hydrate with bad JSON or invalid state removes the key and falls back to defaults', () => {
  for (const raw of ['not json at all{', JSON.stringify('x'), JSON.stringify({ ...defaultState(), gender: [] }), JSON.stringify([])]) {
    const storage = memoryStorage([[CONFIG_KEY, raw]]);
    const schedule = manualSchedule();
    const toasts = [];
    const store = createStore({ storage, schedule, onToast: (m) => toasts.push(m) });
    store.hydrate();
    assert.deepEqual(store.getState(), defaultState());
    assert.equal(storage.getItem(CONFIG_KEY), null, `bad raw ${raw} must trigger removeItem`);
    assert.equal(toasts.length, 0);
    assert.equal(schedule.jobs.size, 0);
  }
});

test('subscribe listeners are notified on replace and hydrate', () => {
  const storage = memoryStorage([[CONFIG_KEY, JSON.stringify({ ...defaultState(), gender: '男' })]]);
  const schedule = manualSchedule();
  const seen = [];
  const store = createStore({
    storage, schedule,
    applyLinkage: (s) => ({ ...s, race: '精灵' }),
  });
  const off = store.subscribe((s) => seen.push(structuredClone(s)));
  assert.equal(seen.length, 0);
  store.replace({ ...defaultState(), role: '奇幻冒险' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].role, '奇幻冒险');
  store.hydrate();
  assert.equal(seen.length, 2);
  assert.equal(seen[1].gender, '男');
  assert.equal(seen[1].race, '精灵');
  off();
  store.replace(defaultState());
  assert.equal(seen.length, 2);
});

test('flush writes pending state immediately and cancels the timer', () => {
  const storage = memoryStorage();
  const schedule = manualSchedule();
  const toasts = [];
  const store = createStore({ storage, schedule, onToast: (m) => toasts.push(m) });
  store.replace({ ...defaultState(), gender: '男' });
  const id = lastJobId(schedule);
  store.flush();
  assert.ok(schedule.jobs.get(id).cancelled, 'timer must be cancelled by flush');
  assert.equal(JSON.parse(storage.getItem(CONFIG_KEY)).gender, '男');
  assert.deepEqual(toasts, ['配置已保存到本地']);
  // flush with nothing pending must not double-write or toast again
  store.flush();
  assert.equal(toasts.length, 1);
});

test('eye colour backfills from an old save instead of voiding the whole config', () => {
  const old = { ...defaultState() };
  delete old.eyeColor;
  delete old.eyeColorCustom;
  const out = sanitizeState(old);
  assert.ok(out);
  assert.equal(out.eyeColor, '跟随参考图');
  assert.equal(out.eyeColorCustom, '');
});

test('sheet background backfills from an old save', () => {
  const old = { ...defaultState() };
  delete old.sheetBg;
  delete old.sheetBgCustom;
  const out = sanitizeState(old);
  assert.ok(out);
  assert.equal(out.sheetBg, '白');
  assert.equal(out.sheetBgCustom, '#ffffff');
});
