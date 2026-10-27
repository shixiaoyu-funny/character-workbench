import { applyLinkage } from './rules.js';
import { createFaceStore } from './face.js';
import { createGallery } from './gallery.js';
import { mount } from './dom.js';

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
});
