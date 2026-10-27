// 渲染工作台并把点击写回 store。本任务不请求生图。

import { PRESETS } from './catalog.js';
import { CONFIG_KEY } from './state.js';
import { FACE_BACKUP_KEY, lockReference, unlockReference } from './face.js';
import { nextTheme, resolveTheme } from './theme.js';
import { viewModel } from './view.js';

const CAPPED = new Set(['handheld', 'visualEffects']);
const mounts = new WeakMap();

function esc(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderButton(control) {
  const disabled = control.disabled ? ' disabled' : '';
  const pressed = control.selected ? 'true' : 'false';
  return `<button type="button" data-field="${esc(control.field)}" data-value="${esc(control.value)}" data-mode="${esc(control.mode)}" aria-pressed="${pressed}"${disabled}>${esc(control.label)}</button>`;
}

function renderPreset(control) {
  const swatches = (control.swatch || [])
    .map((color) => `<span class="swatch" style="background:${esc(color)}"></span>`)
    .join('');
  const pressed = control.selected ? 'true' : 'false';
  return `<button type="button" data-preset="${esc(control.value)}" data-field="colorPreset" data-value="${esc(control.value)}" data-mode="single" aria-pressed="${pressed}">${swatches}<span class="name">${esc(control.label)}</span></button>`;
}

function renderChoices(field) {
  const buttons = (field.options || []).map(renderButton).join('');
  const color = field.colorInput
    ? `<input type="color" data-field="${esc(field.field)}" data-color-input="append" value="#000000" aria-label="${esc(field.label)}">`
    : '';
  return `<section class="field"><h3>${esc(field.label)}</h3><div class="choices">${buttons}${color}</div></section>`;
}

function renderRole(field) {
  const groups = field.groups.map((group) => {
    const options = group.options.map((option) => {
      const selected = option.selected ? ' selected' : '';
      return `<option value="${esc(option.value)}"${selected}>${esc(option.label)}</option>`;
    }).join('');
    return `<optgroup label="${esc(group.label)}">${options}</optgroup>`;
  }).join('');
  return `<section class="field"><h3>${esc(field.label)}</h3><select data-field="role">${groups}</select></section>`;
}

function renderBackgroundColor(field) {
  const value = /^#[0-9a-fA-F]{6}$/.test(field.value) ? field.value : '#ffffff';
  return `<section class="field"><h3>${esc(field.label)}</h3><input type="color" data-field="backgroundColor" data-color-input="value" value="${esc(value)}" aria-label="${esc(field.label)}"></section>`;
}

function renderField(field) {
  if (field.mode === 'switch') return `<section class="field">${renderButton(field)}</section>`;
  if (field.groups) return renderRole(field);
  if (field.field === 'backgroundColor') return renderBackgroundColor(field);
  return renderChoices(field);
}

function renderLeft(left) {
  const fields = left.fields.map(renderField).join('');
  const presets = left.presets.map((group) => {
    const buttons = group.options.map(renderPreset).join('');
    return `<section class="preset-group"><h3>${esc(group.label)}</h3>${buttons}</section>`;
  }).join('');
  return `${fields}<section class="presets"><h2>配色预设</h2>${presets}</section>`;
}

function renderCenter(center) {
  return center.map((group) => {
    const fields = group.fields.map(renderField).join('');
    const more = group.more
      ? `<details><summary>更多</summary>${group.more.options.map(renderButton).join('')}</details>`
      : '';
    const disabled = group.locked ? ' disabled' : '';
    return `<details open${disabled}><summary>${esc(group.title)}</summary>${fields}${more}</details>`;
  }).join('');
}

function renderReference(reference) {
  const removeHidden = reference.locked ? '' : ' hidden';
  const note = reference.locked ? `<p id="face-lock-note">${esc(reference.message)}</p>` : '';
  return `<label id="reference-upload">${esc(reference.label)}<input type="file" id="reference-file" accept="image/*"></label><button type="button" id="remove-reference"${removeHidden}>${esc(reference.removeLabel)}</button>${note}`;
}

function renderRight(right, warningList) {
  const warningHtml = warningList.map((text) => `<p>${esc(text)}</p>`).join('');
  const buttons = right.buttons.map((button) => {
    const aspects = button.aspect
      ? `<div class="aspects">${button.aspect.options.map(renderButton).join('')}</div>`
      : '';
    return `<div class="gen"><button type="button" data-generate="${esc(button.label)}">${esc(button.label)}</button>${aspects}</div>`;
  }).join('');
  return `<div id="warnings">${warningHtml}</div>${buttons}<div id="status"></div><div id="reference">${renderReference(right.reference)}</div><div id="preview">${esc(right.preview)}</div><div id="gallery">${esc(right.gallery)}</div><button type="button" id="open-download">${esc(right.download)}</button>`;
}

function render(doc, model) {
  const left = doc.getElementById('col-left');
  const center = doc.getElementById('col-center');
  const right = doc.getElementById('col-right');
  if (left) left.innerHTML = renderLeft(model.left);
  if (center) center.innerHTML = renderCenter(model.center);
  if (right) right.innerHTML = renderRight(model.right, model.warnings);
}

function toggleMulti(state, field, value) {
  if (value === '无') {
    const next = { ...state, [field]: [] };
    if (field === 'mainColors' || field === 'accentColors') next.colorPreset = '';
    return next;
  }
  const current = Array.isArray(state[field]) ? state[field] : [];
  let values;
  if (current.includes(value)) values = current.filter((item) => item !== value);
  else if (CAPPED.has(field) && current.length >= 2) return null;
  else values = [...current, value];
  const next = { ...state, [field]: values };
  if (field === 'mainColors' || field === 'accentColors') next.colorPreset = '';
  return next;
}

function onClick(doc, event) {
  const mounted = mounts.get(doc);
  if (!mounted || !event.target?.closest) return;
  const { store, images } = mounted;
  if (event.target.closest('#remove-reference')) {
    images.reference = null;
    unlockReference(store, doc.defaultView.localStorage);
    return;
  }
  const generate = event.target.closest('[data-generate]');
  if (generate) {
    const status = doc.getElementById('status');
    if (status) status.textContent = '生成功能尚未接入';
    return;
  }
  const presetButton = event.target.closest('[data-preset]');
  if (presetButton) {
    const preset = PRESETS.find((item) => item.id === presetButton.dataset.preset);
    if (!preset) return;
    const state = store.getState();
    store.replace({
      ...state,
      mainColors: [...preset.main],
      accentColors: [...preset.accent],
      colorPreset: preset.id,
    });
    return;
  }
  const button = event.target.closest('button[data-field]');
  if (!button || button.disabled) return;
  const { field, mode } = button.dataset;
  const value = button.dataset.value;
  const state = store.getState();
  if (mode === 'switch') {
    store.replace({ ...state, [field]: !state[field] });
    return;
  }
  if (mode === 'single') {
    store.replace({ ...state, [field]: value });
    return;
  }
  if (mode === 'multi') {
    const next = toggleMulti(state, field, value);
    if (next) store.replace(next);
  }
}

// 参考图上传：读成 data URL 后先写入内存，再锁定，使清空的面部字段不被联动补回。
function onReferenceFile(doc, input) {
  const mounted = mounts.get(doc);
  const file = input.files && input.files[0];
  if (!mounted || !file) return;
  const view = doc.defaultView;
  const reader = new view.FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    if (!dataUrl.startsWith('data:image/')) return;
    mounted.images.reference = dataUrl;
    lockReference(mounted.store, view.localStorage, dataUrl);
  };
  reader.readAsDataURL(file);
}

function onChange(doc, event) {
  const mounted = mounts.get(doc);
  const el = event.target;
  if (!mounted || !el?.dataset) return;
  const { store } = mounted;
  if (el.id === 'reference-file') {
    onReferenceFile(doc, el);
    return;
  }
  if (el.dataset.colorInput === 'append') {
    const field = el.dataset.field;
    const state = store.getState();
    const current = Array.isArray(state[field]) ? state[field] : [];
    if (current.includes(el.value)) return;
    store.replace({ ...state, [field]: [...current, el.value], colorPreset: '' });
    return;
  }
  if (el.dataset.colorInput === 'value') {
    store.replace({ ...store.getState(), [el.dataset.field]: el.value });
    return;
  }
  if (el.tagName === 'SELECT' && el.dataset.field) {
    store.replace({ ...store.getState(), [el.dataset.field]: el.value });
  }
}

function storedTheme(view) {
  try {
    return view.localStorage.getItem('theme');
  } catch {
    return null;
  }
}

function systemMedia(view) {
  try {
    if (typeof view.matchMedia !== 'function') return null;
    return view.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return null;
  }
}

function bindTheme(doc) {
  const view = doc.defaultView;
  const media = systemMedia(view);
  const stored = storedTheme(view);
  let following = stored !== 'light' && stored !== 'dark';
  const paint = (theme) => {
    doc.documentElement.dataset.theme = theme;
    const button = doc.getElementById('theme-toggle');
    if (button) button.textContent = theme === 'dark' ? '🌙' : '☀️';
  };
  paint(resolveTheme({ stored, prefersDark: Boolean(media?.matches) }));
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', (event) => {
      if (!following) return;
      paint(event.matches ? 'dark' : 'light');
    });
  }
  doc.getElementById('theme-toggle')?.addEventListener('click', () => {
    const current = doc.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const next = nextTheme(current);
    following = false;
    try {
      view.localStorage.setItem('theme', next);
    } catch {
      // 主题写失败时仍切换当前页面，避免把按钮点死。
    }
    paint(next);
  });
}

function bindReset(doc) {
  const view = doc.defaultView;
  doc.getElementById('reset')?.addEventListener('click', () => {
    if (!view.confirm('是否清除本地保存的角色配置并恢复默认？')) return;
    view.localStorage.removeItem(CONFIG_KEY);
    view.localStorage.removeItem(FACE_BACKUP_KEY);
    view.location.reload();
  });
}

export function mount(doc, { store, gallery, images = { reference: null } } = {}) {
  void gallery;
  mounts.set(doc, { store, images });
  if (doc.documentElement.dataset.workbenchBound !== '1') {
    doc.documentElement.dataset.workbenchBound = '1';
    doc.addEventListener('click', (event) => onClick(doc, event));
    doc.addEventListener('change', (event) => onChange(doc, event));
    bindTheme(doc);
    bindReset(doc);
  }
  const paint = () => render(doc, viewModel(store.getState(), { faceLocked: Boolean(images.reference) }));
  store.subscribe(paint);
  store.hydrate();
  // 只有备份、内存里没有参考图时不保持锁脸：还原面部并立刻落盘。
  const view = doc.defaultView;
  if (!images.reference && view.localStorage.getItem(FACE_BACKUP_KEY) !== null) {
    unlockReference(store, view.localStorage);
    store.flush();
  }
}
