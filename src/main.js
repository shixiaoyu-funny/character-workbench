import { applyLinkage } from './rules.js';
import { mount } from './dom.js';
import { createStore } from './state.js';

function showToast(message) {
  const toast = document.getElementById('toast');
  if (toast) toast.textContent = message;
}

document.addEventListener('DOMContentLoaded', () => {
  const store = createStore({
    storage: localStorage,
    schedule: { in: (ms, fn) => setTimeout(fn, ms), cancel: clearTimeout },
    applyLinkage,
    onToast: showToast,
  });
  mount(document, { store, gallery: {} });
});
