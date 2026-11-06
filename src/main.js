import { applyLinkage } from './rules.js';
import { createFaceStore } from './face.js';
import { createGallery } from './gallery.js';
import { mount, loadHistory } from './dom.js';

function showToast(message) {
  const toast = document.getElementById('toast');
  if (toast) toast.textContent = message;
}

document.addEventListener('DOMContentLoaded', () => {
  const images = { reference: null };
  const gallery = createGallery();
  const store = createFaceStore({
    images,
    storage: localStorage,
    schedule: { in: (ms, fn) => setTimeout(fn, ms), cancel: clearTimeout },
    applyLinkage,
    onToast: showToast,
  });
  mount(document, { store, gallery, images });
  // 异步拉取历史图片（OSS 持久化），失败静默忽略，不影响当前会话。
  void loadHistory(document, gallery);
});
