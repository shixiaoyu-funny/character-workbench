// 锁脸用例：备份/清空/还原、锁定与解锁接口、锁脸视图模型。

import test from 'node:test';
import assert from 'node:assert/strict';

import { FACE_FIELDS } from '../src/catalog.js';
import { applyLinkage } from '../src/rules.js';
import { defaultState } from '../src/state.js';
import { viewModel } from '../src/view.js';
import {
  FACE_BACKUP_KEY, backupFace, stripFace, restoreFace,
  createFaceStore, lockReference, unlockReference,
} from '../src/face.js';

const LOCK_MESSAGE = '已开启锁脸模式，当前角色的面部与妆容将由参考图决定。';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function makeStore(storage, images = { reference: null }) {
  return createFaceStore({
    images,
    storage,
    schedule: { in: () => 0, cancel: () => {} },
    applyLinkage,
  });
}

test('backupFace copies only the face fields', () => {
  const state = defaultState();
  const backup = backupFace(state);
  assert.deepEqual(Object.keys(backup).sort(), [...FACE_FIELDS].sort());
  assert.equal(backup.faceShape, '鹅蛋脸（标准）');
  assert.equal(backup.lipstick, '自然色');
  assert.equal(Object.prototype.hasOwnProperty.call(backup, 'hairStyle'), false);
});

test('stripFace empties strings and arrays but leaves hairStyle alone', () => {
  const state = defaultState();
  const stripped = stripFace(state);
  assert.notEqual(stripped, state);
  assert.equal(stripped.faceShape, '');
  assert.deepEqual(stripped.facialFeatures, []);
  assert.deepEqual(stripped.specialMakeup, []);
  assert.equal(stripped.hairStyle, state.hairStyle);
  assert.equal(state.faceShape, '鹅蛋脸（标准）');
});

test('restoreFace writes a backup back into the state', () => {
  const state = defaultState();
  const backup = backupFace(state);
  const restored = restoreFace(stripFace(state), backup);
  assert.deepEqual(restored, state);
  assert.notEqual(restored, state);
  assert.equal(restoreFace(state, {}).faceShape, state.faceShape);
});

test('lockReference backs the face up, strips the state, and survives linkage', () => {
  const storage = memoryStorage();
  const images = { reference: null };
  const store = makeStore(storage, images);
  images.reference = PNG;
  assert.equal(lockReference(store, storage, PNG), true);
  assert.equal(store.getState().faceShape, '');
  assert.deepEqual(store.getState().facialFeatures, []);
  assert.equal(store.getState().hairStyle, '双马尾（高/低）');
  assert.equal(JSON.parse(storage.getItem(FACE_BACKUP_KEY)).faceShape, '鹅蛋脸（标准）');
});

test('lockReference rejects non data:image strings without touching state', () => {
  const storage = memoryStorage();
  const store = makeStore(storage);
  assert.equal(lockReference(store, storage, 'http://example.com/face.png'), false);
  assert.equal(store.getState().faceShape, '鹅蛋脸（标准）');
  assert.equal(storage.getItem(FACE_BACKUP_KEY), null);
});

test('unlockReference restores the face and deletes the backup key', () => {
  const storage = memoryStorage();
  const images = { reference: null };
  const store = makeStore(storage, images);
  images.reference = PNG;
  lockReference(store, storage, PNG);
  images.reference = null;
  assert.equal(unlockReference(store, storage), true);
  assert.equal(store.getState().faceShape, '鹅蛋脸（标准）');
  assert.deepEqual(store.getState().facialFeatures, []);
  assert.equal(storage.getItem(FACE_BACKUP_KEY), null);
});

test('locking again keeps the first backup instead of storing stripped values', () => {
  const storage = memoryStorage();
  const images = { reference: null };
  const store = makeStore(storage, images);
  images.reference = PNG;
  lockReference(store, storage, PNG);
  images.reference = PNG;
  lockReference(store, storage, PNG);
  const backup = JSON.parse(storage.getItem(FACE_BACKUP_KEY));
  assert.equal(backup.faceShape, '鹅蛋脸（标准）');
});

test('a locked store keeps the face stripped through unrelated replaces', () => {
  const storage = memoryStorage();
  const images = { reference: PNG };
  const store = makeStore(storage, images);
  store.replace({ ...store.getState(), gender: '男' });
  assert.equal(store.getState().gender, '男');
  assert.equal(store.getState().faceShape, '');
});

test('viewModel with faceLocked shows every face and makeup option disabled', () => {
  const state = stripFace({ ...defaultState(), gender: '男' });
  const vm = viewModel(state, { faceLocked: true });
  const face = vm.center.find((group) => group.title === '面部');
  const makeup = vm.center.find((group) => group.title === '妆容');
  assert.equal(face.locked, true);
  assert.equal(makeup.locked, true);
  const faceShape = face.fields.find((field) => field.field === 'faceShape');
  assert.equal(faceShape.options.some((option) => option.value === '肉肉脸（可爱）'), true);
  assert.equal(faceShape.options.every((option) => option.disabled), true);
  assert.equal(faceShape.options.some((option) => option.selected), false);
  const lipstick = makeup.fields.find((field) => field.field === 'lipstick');
  assert.equal(lipstick.options.some((option) => option.value === '咬唇妆（渐变）'), true);
  assert.equal(lipstick.options.every((option) => option.disabled), true);
  const hair = vm.center.find((group) => group.title === '发型');
  assert.equal(hair.locked, false);
  assert.equal(hair.fields.find((field) => field.field === 'hairStyle').options.every((option) => option.disabled), false);
  assert.equal(vm.right.reference.locked, true);
  assert.equal(vm.right.reference.message, LOCK_MESSAGE);
  assert.equal(vm.right.reference.removeLabel, '移除');
});

test('viewModel without faceLocked behaves as before', () => {
  const vm = viewModel(defaultState());
  assert.equal(vm.center.find((group) => group.title === '面部').locked, false);
  assert.equal(vm.right.reference.locked, false);
  assert.equal(vm.right.reference.message, '');
});
