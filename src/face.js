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
export function createFaceStore({ images = { reference: null }, applyLinkage = (s) => s, ...rest }) {
  return createStore({
    ...rest,
    applyLinkage: (state) => {
      const linked = applyLinkage(state);
      return images.reference ? stripFace(linked) : linked;
    },
  });
}

// 锁定：拒绝非 data:image/ 开头的字符串且不改状态。
// 成功时备份原面部选项到 FACE_BACKUP_KEY（已有备份不覆盖，保留最早的一份），
// 然后把状态里的面部字段清空。调用方需先把参考图写进 images.reference。
export function lockReference(store, storage, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
  if (storage.getItem(FACE_BACKUP_KEY) === null || storage.getItem(FACE_BACKUP_KEY) === undefined) {
    const backup = backupFace(store.getState());
    storage.setItem(FACE_BACKUP_KEY, JSON.stringify(backup));
  }
  store.replace(stripFace(store.getState()));
  return true;
}

// 解锁：读备份写回状态，删除备份键。调用方需先清空 images.reference。
export function unlockReference(store, storage) {
  const raw = storage.getItem(FACE_BACKUP_KEY);
  if (raw === null || raw === undefined) return false;
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
