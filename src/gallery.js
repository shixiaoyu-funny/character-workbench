// 内存图库：批次、选中图和角色基准。不写入 localStorage。
// 图片 URL（OSS）持久化在服务端 SQLite，这里负责把它们按批组装回内存供下载页展示。

import { makeFileKey } from './download.js';

function persistedId(item) {
  const raw = item && (item.recordId ?? item.id);
  const id = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function persistedTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function samePicture(left, right) {
  if (!left || !right) return false;
  if (left.url && right.url && left.url === right.url) return true;
  if (left.dataUrl && right.dataUrl && left.dataUrl === right.dataUrl) return true;
  return false;
}

export function createGallery() {
  const batches = [];
  let selectedId = null;
  let base = null;
  let clothingPair = null;
  let n = 0;

  function findItem(id) {
    for (const batch of batches) {
      const found = batch.items.find((item) => item.id === id);
      if (found) return found;
    }
    return null;
  }

  function forgetLocks(items) {
    if (base && items.some((item) => samePicture(base, item))) base = null;
    if (clothingPair && items.some((item) => item.id === clothingPair.id || samePicture(clothingPair.turnaround, item))) {
      clothingPair = null;
    }
    if (selectedId && items.some((item) => item.id === selectedId)) selectedId = null;
  }

  return {
    addBatch(items, base = null) {
      const batch = {
        id: `batch-${++n}`,
        createdAt: Date.now(),
        status: 'complete',
        base: base
          ? { ...base, fileKey: base.fileKey || makeFileKey(Date.now()) }
          : null,
        items: items.map((item) => ({
          id: `item-${++n}`,
          recordId: persistedId(item),
          createdAt: persistedTime(item.createdAt),
          fileKey: item.fileKey || makeFileKey(persistedTime(item.createdAt) || Date.now()),
          kind: item.kind,
          aspect: item.aspect,
          seed: item.seed,
          positive: item.positive,
          negative: item.negative,
          dataUrl: item.dataUrl,
          url: item.url || null,
          remote: Boolean(item.remote),
          ...(item.state ? { state: item.state } : {}),
        })),
      };
      batches.push(batch);
      return batch;
    },
    batches() {
      return batches;
    },
    select(id) {
      selectedId = id;
    },
    selected() {
      if (!selectedId) return null;
      return findItem(selectedId);
    },
    lockSelected() {
      const item = this.selected();
      if (!item) return null;
      base = { dataUrl: item.dataUrl, url: item.url || null, seed: item.seed, ...(item.state ? { state: item.state } : {}) };
      return item.seed;
    },
    setBase(item) {
      if (!item || !item.dataUrl) return null;
      base = { dataUrl: item.dataUrl, url: item.url || null, seed: item.seed, ...(item.state ? { state: item.state } : {}) };
      return item.seed;
    },
    base() {
      return base;
    },
    // 只给单次服饰拆解图用，不改锁脸基准。
    setClothingPair(pair) {
      if (!pair || !pair.base || !pair.base.dataUrl || !pair.turnaround || !pair.turnaround.dataUrl) return null;
      clothingPair = {
        id: pair.id || null,
        base: {
          dataUrl: pair.base.dataUrl,
          url: pair.base.url || null,
          seed: pair.base.seed,
          ...(pair.base.state ? { state: pair.base.state } : {}),
        },
        turnaround: {
          dataUrl: pair.turnaround.dataUrl,
          url: pair.turnaround.url || null,
          seed: pair.turnaround.seed,
        },
      };
      return clothingPair;
    },
    clothingPair() {
      return clothingPair;
    },
    removeItem(id) {
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        const itemIndex = batch.items.findIndex((item) => item.id === id);
        if (itemIndex < 0) continue;
        const [removed] = batch.items.splice(itemIndex, 1);
        if (!batch.items.length) batches.splice(index, 1);
        forgetLocks([removed]);
        return removed;
      }
      return null;
    },
    removeBatch(id) {
      const index = batches.findIndex((batch) => batch.id === id);
      if (index < 0) return null;
      const [removed] = batches.splice(index, 1);
      forgetLocks(removed.items);
      return removed;
    },
  };
}

// 把服务端 /api/gallery 返回的记录按 batch_id 组装成批次，加入内存图库。
// 每条记录的 url 即 OSS 公开地址，作为 dataUrl 展示，并标记 remote 以便下载时走网络。
export function loadPersisted(gallery, records) {
  if (!gallery || typeof gallery.addBatch !== 'function' || !Array.isArray(records)) return 0;
  const sorted = [...records].sort((a, b) => (a.id - b.id));
  const groups = new Map();
  for (const rec of sorted) {
    const batchId = rec.batch_id || `history-${rec.id}`;
    if (!groups.has(batchId)) {
      groups.set(batchId, { batchId, base: rec.base || null, items: [] });
    }
    const group = groups.get(batchId);
    if (rec.base && rec.base.url && !group.base) group.base = rec.base;
    group.items.push({
      id: rec.id,
      recordId: rec.id,
      createdAt: rec.createdAt,
      kind: rec.kind,
      aspect: rec.aspect,
      seed: rec.seed,
      positive: rec.positive,
      negative: rec.negative,
      dataUrl: rec.url,
      url: rec.url,
      remote: true,
      ...(rec.state ? { state: rec.state } : {}),
    });
  }
  let added = 0;
  for (const group of groups.values()) {
    const base = group.base && group.base.url
      ? { dataUrl: group.base.url, url: group.base.url, seed: group.base.seed, remote: true }
      : null;
    const batch = gallery.addBatch(group.items, base);
    // 历史批次只给下载页。生成页刷新后不再铺这些图。
    batch.history = true;
    const times = batch.items.map((item) => item.createdAt).filter((value) => Number.isFinite(value));
    if (times.length) batch.createdAt = Math.min(...times);
    added += group.items.length;
  }
  return added;
}
