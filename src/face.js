// 参考图锁脸：面部字段备份、清空、还原与锁定/解锁接口。
// 参考图 data URL 只放在 mount 的内存 images 对象里，绝不进 store，
// 也不写进 myCharacterConfig；备份键只存选项文字。

import { FACE_FIELDS } from './catalog.js';
import { createStore } from './state.js';

export const FACE_BACKUP_KEY = 'myCharacterFaceBackup';

// 只拷贝 FACE_FIELDS，值深拷贝，不带回其他字段。
export function backupFace(state) {
  const backup = {};
  for (const field of FACE_FIELDS) backup[field] = structuredClone(state[field]);
  return backup;
}

// 返回新状态：面部字段里字符串变 ''，数组变 []，其余字段原样。
export function stripFace(state) {
  const next = structuredClone(state);
  for (const field of FACE_FIELDS) {
    next[field] = Array.isArray(next[field]) ? [] : '';
  }
  return next;
}

// 把备份写回：只覆盖备份里实际存在的面部字段，返回新状态。
export function restoreFace(state, backup) {
  const next = structuredClone(state);
  if (backup === null || typeof backup !== 'object') return next;
  for (const field of FACE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(backup, field)) {
      next[field] = structuredClone(backup[field]);
    }
  }
  return next;
}

// 锁脸期间联动不得把清空的面部字段补回默认值：
// 锁定（images.reference 非空）时在原联动之后再清一次面部字段。
// store → 内存参考图容器（images）。参考图只放内存，不写 store，也不写 localStorage。
// 锁/解锁时由这里直接维护 images.reference，调用方不必再手工清空。
const IMAGES_BY_STORE = new WeakMap();

export function createFaceStore({ images = { reference: null }, applyLinkage = (s) => s, ...rest }) {
  const store = createStore({
    ...rest,
    applyLinkage: (state) => {
      const linked = applyLinkage(state);
      return images.reference ? stripFace(linked) : linked;
    },
  });
  IMAGES_BY_STORE.set(store, images);
  return store;
}

// 锁定：拒绝非 data:image/ 开头的字符串且不改状态。
// 成功时把参考图写进 images.reference，备份原面部选项到 FACE_BACKUP_KEY
//（已有备份不覆盖，保留最早的一份），然后把状态里的面部字段清空。
export function lockReference(store, storage, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
  const images = IMAGES_BY_STORE.get(store);
  if (images) images.reference = dataUrl;
  if (storage.getItem(FACE_BACKUP_KEY) === null || storage.getItem(FACE_BACKUP_KEY) === undefined) {
    const backup = backupFace(store.getState());
    storage.setItem(FACE_BACKUP_KEY, JSON.stringify(backup));
  }
  store.replace(stripFace(store.getState()));
  return true;
}

// 解锁：先清空内存参考图（否则 applyLinkage 会再次清掉面部），再读备份写回状态并删除备份键。
export function unlockReference(store, storage) {
  const raw = storage.getItem(FACE_BACKUP_KEY);
  if (raw === null || raw === undefined) return false;
  const images = IMAGES_BY_STORE.get(store);
  if (images) images.reference = null;
  let backup;
  try {
    backup = JSON.parse(raw);
  } catch {
    storage.removeItem(FACE_BACKUP_KEY);
    return false;
  }
  storage.removeItem(FACE_BACKUP_KEY);
  store.replace(restoreFace(store.getState(), backup));
  return true;
}
