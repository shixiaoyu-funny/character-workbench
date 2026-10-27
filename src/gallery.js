// 内存图库：批次、选中图和角色基准。不写入 localStorage。

export function createGallery() {
  const batches = [];
  let selectedId = null;
  let base = null;
  let n = 0;

  function findItem(id) {
    for (const batch of batches) {
      const found = batch.items.find((item) => item.id === id);
      if (found) return found;
    }
    return null;
  }

  return {
    addBatch(items) {
      const batch = {
        id: `batch-${++n}`,
        createdAt: Date.now(),
        status: 'complete',
        items: items.map((item) => ({
          id: `item-${++n}`,
          kind: item.kind,
          aspect: item.aspect,
          seed: item.seed,
          positive: item.positive,
          negative: item.negative,
          dataUrl: item.dataUrl,
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
      base = { dataUrl: item.dataUrl, seed: item.seed };
      return item.seed;
    },
    base() {
      return base;
    },
  };
}
