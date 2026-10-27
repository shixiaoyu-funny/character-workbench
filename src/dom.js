// 渲染工作台并把点击写回 store。生图进度写在 mount 记录上，重绘后再放回 #status。

import { PRESETS } from './catalog.js';
import { CONFIG_KEY } from './state.js';
import { FACE_BACKUP_KEY, lockReference, unlockReference } from './face.js';
import { browserFetcher, generateKind, generateSuite } from './generate.js';
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

function renderRight(right, warningList, extras) {
  const warningHtml = warningList.map((text) => `<p>${esc(text)}</p>`).join('');
  const disabled = extras.generating ? ' disabled' : '';
  const buttons = right.buttons.map((button) => {
    const aspects = button.aspect
      ? `<div class="aspects">${button.aspect.options.map(renderButton).join('')}</div>`
      : '';
    return `<div class="gen"><button type="button" data-generate="${esc(button.label)}"${disabled}>${esc(button.label)}</button>${aspects}</div>`;
  }).join('');
  return `<div id="warnings">${warningHtml}</div>${buttons}<div id="status"></div><div id="reference">${renderReference(right.reference)}</div><div id="preview">${extras.preview}</div><div id="gallery">${extras.gallery}</div><button type="button" id="lock-base">设为当前角色基准</button><button type="button" id="open-download">${esc(right.download)}</button>`;
}

function galleryItems(gallery) {
  if (!gallery || typeof gallery.batches !== 'function') return [];
  return gallery.batches().flatMap((batch) => batch.items || []);
}

function renderShot(item, selected) {
  const pressed = selected ? 'true' : 'false';
  return `<button type="button" data-select="${esc(item.id)}" aria-pressed="${pressed}"><img src="${esc(item.dataUrl)}" alt="${esc(item.kind)}"></button>`;
}

function previewHtml(gallery) {
  const items = galleryItems(gallery);
  if (!items.length) return '还没有图片';
  const selected = typeof gallery.selected === 'function' ? gallery.selected() : null;
  const shown = selected ? [selected] : gallery.batches().at(-1).items;
  return shown.map((item) => renderShot(item, Boolean(selected && item.id === selected.id))).join('');
}

function galleryHtml(gallery) {
  const items = galleryItems(gallery);
  if (!items.length) return '图库是空的';
  const selected = typeof gallery.selected === 'function' ? gallery.selected() : null;
  return items.map((item) => renderShot(item, Boolean(selected && item.id === selected.id))).join('');
}

function render(doc, model) {
  const mounted = mounts.get(doc) || {};
  const left = doc.getElementById('col-left');
  const center = doc.getElementById('col-center');
  const right = doc.getElementById('col-right');
  if (left) left.innerHTML = renderLeft(model.left);
  if (center) center.innerHTML = renderCenter(model.center);
  if (right) {
    right.innerHTML = renderRight(model.right, model.warnings, {
      generating: Boolean(mounted.generating),
      preview: previewHtml(mounted.gallery),
      gallery: galleryHtml(mounted.gallery),
    });
  }
  const status = doc.getElementById('status');
  if (status) status.textContent = mounted.statusText || '';
}

function setStatus(doc, text) {
  const mounted = mounts.get(doc);
  if (mounted) mounted.statusText = text;
  const status = doc.getElementById('status');
  if (status) status.textContent = text;
}

const GENERATE_LABELS = {
  '生成基准立绘': '基准立绘',
  '生成三视图': '三视图',
  '生成表情差分图': '表情差分图',
  '生成服饰拆解图': '服饰拆解图',
  '生成Q版形象': 'Q版形象',
};

async function startGenerate(doc, label) {
  const mounted = mounts.get(doc);
  if (!mounted || mounted.generating) return;
  if (!mounted.gallery || typeof mounted.gallery.addBatch !== 'function') return;
  mounted.generating = true;
  setStatus(doc, '');
  mounted.paint();
  const counting = label === '生成基准立绘'
    || (label === '生成完整图片（一键全套）' && !mounted.gallery.base());
  let step = 0;
  const fetcher = async (url, init) => {
    if (counting && url === '/api/generate') {
      step += 1;
      setStatus(doc, `正在生成基准立绘（${step}/4）`);
    }
    return (mounted.fetcher || browserFetcher)(url, init);
  };
  try {
    const common = {
      state: mounted.store.getState(),
      gallery: mounted.gallery,
      images: mounted.images,
      fetcher,
    };
    if (label === '生成完整图片（一键全套）') {
      const result = await generateSuite(common);
      mounted.gallery.select(null);
      setStatus(doc, result.stopped ? '请选择一张基准立绘，并设为当前角色基准。' : '');
    } else {
      const kind = GENERATE_LABELS[label];
      const hadBase = Boolean(mounted.gallery.base());
      await generateKind({ ...common, kind });
      mounted.gallery.select(null);
      setStatus(doc, kind !== '基准立绘' && !hadBase ? '尚未设定角色基准，本次不会锁定脸。' : '');
    }
  } catch (error) {
    setStatus(doc, error && error.message ? error.message : '生成失败');
  } finally {
    mounted.generating = false;
    mounted.paint();
  }
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
  const select = event.target.closest('[data-select]');
  if (select && mounted.gallery && typeof mounted.gallery.select === 'function') {
    mounted.gallery.select(select.dataset.select);
    mounted.paint();
    return;
  }
  if (event.target.closest('#lock-base')) {
    if (mounted.gallery && typeof mounted.gallery.lockSelected === 'function') mounted.gallery.lockSelected();
    mounted.paint();
    return;
  }
  const generate = event.target.closest('[data-generate]');
  if (generate) {
    if (generate.disabled || mounted.generating) return;
    void startGenerate(doc, generate.dataset.generate);
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

export function mount(doc, { store, gallery, images = { reference: null }, fetcher } = {}) {
  const record = { store, images, gallery, fetcher, statusText: '', generating: false, paint: () => {} };
  mounts.set(doc, record);
  record.paint = () => render(doc, viewModel(store.getState(), { faceLocked: Boolean(images.reference) }));
  if (doc.documentElement.dataset.workbenchBound !== '1') {
    doc.documentElement.dataset.workbenchBound = '1';
    doc.addEventListener('click', (event) => onClick(doc, event));
    doc.addEventListener('change', (event) => onChange(doc, event));
    bindTheme(doc);
    bindReset(doc);
  }
  store.subscribe(record.paint);
  store.hydrate();
  // 只有备份、内存里没有参考图时不保持锁脸：还原面部并立刻落盘。
  const view = doc.defaultView;
  if (!images.reference && view.localStorage.getItem(FACE_BACKUP_KEY) !== null) {
    unlockReference(store, view.localStorage);
    store.flush();
  }
}
