// 渲染工作台并把点击写回 store。生图进度写在 mount 记录上，重绘后再放回 #status。

import { OPTIONS, PRESETS, WU_VALUES } from './catalog.js';
import { CONFIG_KEY, defaultState } from './state.js';
import { FACE_BACKUP_KEY, unlockReference } from './face.js';
import { dataUrlToBytes, imageFileName, makeFileKey, zipBatch, zipFiles } from './download.js';
import { browserFetcher, browserStreamFetcher, buildHotChibiPlan, buildKindPlan, buildSuitePlan, buildTunePlan, executePlanLocally, generateKind, generateSuite, generateTune, isPairSheet, isStopped, planToPayload, stepLabel } from './generate.js';
import { BASE_IMAGE_MODEL, CHIBI_IMAGE_MODEL, SUITE_IMAGE_MODEL, TUNE_IMAGE_MODEL, imageModelById, modelForGenerate } from './imageModels.js';
import { BED_POSES, tuneCombinations } from './prompts.js';
import { loadPersisted } from './gallery.js';
import { nextTheme, resolveTheme } from './theme.js';
import { viewModel } from './view.js';
import { applyClothingSelection, isEmptySkeleton } from './clothing.js';
import { BOTH_HANDS } from './rules.js';
import { normalizeHex, translateColorName } from './colorTranslate.js';
import { DEFAULT_WATERMARK_TEXT, DEFAULT_WATERMARK_FONT_SIZE, DEFAULT_WATERMARK_LETTER_GAP, DEFAULT_WATERMARK_LINE_GAP, watermarkDataUrl } from './watermark.js';
import {
  DEFAULT_VIDEO_WATERMARK, VIDEO_WATERMARK_LIMITS, normalizeVideoWatermark,
  drawVideoWatermark, videoWatermarkFileName,
  pickVideoMime, extensionForMime, percentToAlpha, alphaToPercent,
} from './videoWatermark.js';
import { GRADING_GROUPS, GRADING_PARAMS, GRADING_PRESETS, defaultGradingParams } from './colorGrade.js';
import { WALLPAPER_PLATFORMS, WALLPAPER_FOCUS_DEFAULT, cropForFocus, focusDeltaFromDrag, focusDeltaFromEditorDrag, containRect, loopDurationFor, normalizeCrop, scaleCrop, renderGradedCanvas } from './wallpaper.js';
import { gradeForExport, needsLut } from './gradeLut.js';
import { recordLoopVideo, recordCanvasH264, upscaleBlob, blobToDataUrl, transcodeToMp4 } from './exportVideo.js';
import { WALLPAPER2_MODELS, WALLPAPER2_DEFAULT_MODEL, WALLPAPER2_DURATION, WALLPAPER2_DURATIONS, WALLPAPER2_RESOLUTION, WALLPAPER2_RATIO, WALLPAPER2_UPSCALE_SCALE, generateWallpaper2Video, interpolateWallpaper2Video, lockWallpaper2Colors, buildWallpaper2Prompt } from './wallpaper2.js';
import {
  POOL_MAIN, POOL_WALLPAPER, TASK_POLL_MS, buildRetryPayload, cancelTask, deleteTask, elapsedMs,
  estimateMs, fetchTask, fetchTaskPayload, fetchTaskResult, fetchTaskResultBlob, fetchTasks,
  formatDuration, isTerminal,
  remainingOf, sleep, statusText, submitTask, taskPercent,
} from './tasks.js';
import { renderTaskBoard, routeForTask, taskDownloadEntries } from './taskview.js';

const CAPPED = new Set(['visualEffects', 'outfitEffects']);
const mounts = new WeakMap();
const watchedGalleries = new WeakSet();

const CHEVRON = '<svg class="acc-chevron" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>';

function esc(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ---------------- 渲染辅助 ----------------

function renderButton(control, ctx = {}) {
  const disabled = control.disabled ? ' disabled' : '';
  const pressed = control.selected ? 'true' : 'false';
  const cls = `pill${control.selected ? ' on' : ''}${control.disabled ? ' disabled' : ''}${control.recommended ? ' recommended' : ''}`;
  const swatch = control.swatch
    ? `<span class="dot" style="background:${esc(control.swatch)}"></span>`
    : '';
  const colorName = pillColorName(control, ctx);
  const part = control.part ? ` data-part="${esc(control.part)}"` : '';
  return `<button type="button" class="${cls}" data-field="${esc(control.field)}" data-value="${esc(control.value)}" data-mode="${esc(control.mode)}"${part} aria-pressed="${pressed}"${disabled}>${swatch}${esc(control.label)}${colorName}</button>`;
}

// 自由色（HEX）药丸：翻译中显示转圈，翻译完成显示 (英文名)。
function pillColorName(control, ctx) {
  const norm = normalizeHex(control.value);
  if (!norm) return '';
  if (ctx.translating && ctx.translating.has(norm)) {
    return '<span class="spinner-inline" aria-label="翻译中"></span>';
  }
  const name = ctx.names && ctx.names[norm];
  if (name) return ` <span class="pill-color-name">(${esc(titleCase(name))})</span>`;
  return '';
}

// 首字母大写，仅用于界面展示；存入 state / 拼进提示词仍用小写。
function titleCase(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function renderAspect(control) {
  const pressed = control.selected ? 'true' : 'false';
  const cls = `aspect-pill${control.selected ? ' on' : ''}`;
  return `<button type="button" class="${cls}" data-field="${esc(control.field)}" data-value="${esc(control.value)}" data-mode="${esc(control.mode)}" aria-pressed="${pressed}">${esc(control.label)}</button>`;
}

function renderPreset(control) {
  const swatches = (control.swatch || [])
    .map((color) => `<span class="swatch" style="background:${esc(color)}"></span>`)
    .join('');
  const pressed = control.selected ? 'true' : 'false';
  const cls = `preset${control.selected ? ' on' : ''}`;
  return `<button type="button" class="${cls}" data-preset="${esc(control.value)}" data-field="colorPreset" data-value="${esc(control.value)}" data-mode="single" aria-pressed="${pressed}"><span class="swatches">${swatches}</span><span class="name">${esc(control.label)}</span></button>`;
}

function colorInputHtml(dataField, value, { append = false, valueMode = false, inputMode = '', label = '', status = '' } = {}) {
  const mode = inputMode || (valueMode ? 'value' : 'append');
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : (valueMode ? '#ffffff' : '#ff4d8d');
  const hint = append ? '<span class="color-add">+</span>' : '';
  return `<label class="color-field" title="${esc(label)}"><input type="color" class="color-input" data-field="${esc(dataField)}" data-color-input="${mode}" value="${esc(safe)}" aria-label="${esc(label)}">${hint}</label>${status}`;
}

// 单个颜色值旁边的反馈：翻译中 -> 转圈；完成 -> #HEX (英文名)；未翻译 -> 仅 #HEX。
function colorStatusHtml(hex, ctx) {
  const norm = normalizeHex(hex);
  if (!norm) return '';
  if (ctx.translating && ctx.translating.has(norm)) {
    return '<span class="color-status loading"><span class="spinner" aria-hidden="true"></span>翻译中…</span>';
  }
  const name = ctx.names && ctx.names[norm];
  if (name) return `<span class="color-status">${esc(norm.toUpperCase())} <span class="color-name">(${esc(titleCase(name))})</span></span>`;
  return `<span class="color-status dim">${esc(norm.toUpperCase())}</span>`;
}

function renderSwitch(field) {
  const on = field.selected;
  const disabled = field.disabled ? ' disabled' : '';
  const pressed = on ? 'true' : 'false';
  const cls = `switch${on ? ' on' : ''}${field.disabled ? ' disabled' : ''}`;
  return `<section class="field"><button type="button" class="${cls}" data-field="${esc(field.field)}" data-value="true" data-mode="switch" aria-pressed="${pressed}"${disabled}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">${esc(field.label)}</span></button></section>`;
}

function renderChoices(field, ctx = {}) {
  const buttons = (field.options || []).map((control) => renderButton(control, ctx)).join('');
  const color = field.colorInput
    ? colorInputHtml(field.field, '#ff4d8d', { append: true, label: `${field.label}自由选色` })
    : '';
  const conditional = (field.colorInputs || [])
    .filter((spec) => spec.active)
    .map((spec) => colorInputHtml(spec.stateField, spec.value, {
      valueMode: true,
      label: spec.label,
      status: colorStatusHtml(spec.value, ctx),
    }))
    .join('');
  return `<section class="field"><h3>${esc(field.label)}</h3><div class="choices">${buttons}${color}${conditional}</div></section>`;
}

function renderRole(field) {
  const groups = field.groups.map((group) => {
    const options = group.options.map((option) => {
      const selected = option.selected ? ' selected' : '';
      return `<option value="${esc(option.value)}"${selected}>${esc(option.label)}</option>`;
    }).join('');
    return `<optgroup label="${esc(group.label)}">${options}</optgroup>`;
  }).join('');
  return `<section class="field"><h3>${esc(field.label)}</h3><div class="select-wrap"><select data-field="${esc(field.field)}">${groups}</select>${CHEVRON}</div></section>`;
}

function renderBackgroundColor(field, ctx = {}) {
  const value = /^#[0-9a-fA-F]{6}$/.test(field.value) ? field.value : '#ffffff';
  return `<section class="field"><h3>${esc(field.label)}</h3>${colorInputHtml('backgroundColor', value, { valueMode: true, label: field.label, status: colorStatusHtml(value, ctx) })}</section>`;
}

function renderSegmentOptions(segment, ctx) {
  if (segment.groups) {
    return segment.groups.map((group) => {
      const buttons = group.options.map((control) => renderButton(control, ctx)).join('');
      return `<div class="choice-group"><h4>${esc(group.label)}</h4><div class="choices">${buttons}</div></div>`;
    }).join('');
  }
  return `<div class="choices">${(segment.options || []).map((control) => renderButton(control, ctx)).join('')}</div>`;
}

function renderClothing(field, ctx = {}) {
  if (field.disabled) {
    const note = (field.notes || []).map((line) => `<p class="field-note">${esc(line)}</p>`).join('');
    return `<section class="field clothing-field is-disabled"><h3>${esc(field.label)}</h3>${note}</section>`;
  }
  const blocks = (field.segments || []).map((segment) => {
    const body = renderSegmentOptions(segment, ctx);
    const custom = segment.customActive
      ? colorInputHtml(field.field, segment.customValue, {
        inputMode: 'clothing',
        label: `${field.label}颜色`,
        status: colorStatusHtml(segment.customValue, ctx),
      })
      : '';
    return `<div class="clothing-seg"><h4>${esc(segment.label)}</h4>${body}${custom}</div>`;
  });
  const coarse = blocks.filter((_, index) => !(field.segments[index] || {}).fine).join('');
  const fine = blocks.filter((_, index) => (field.segments[index] || {}).fine).join('');
  const open = Boolean(ctx.openFines && ctx.openFines.has(field.field));
  const fineBlock = fine
    ? `<details class="clothing-fine" data-fine="${esc(field.field)}"${open ? ' open' : ''}><summary>细配</summary>${fine}</details>`
    : '';
  const notes = (field.notes || []).map((line) => `<p class="field-note">${esc(line)}</p>`).join('');
  return `<section class="field clothing-field"><h3>${esc(field.label)}</h3>${coarse}${fineBlock}${notes}</section>`;
}

function renderField(field, ctx = {}) {
  if (field.mode === 'clothing') return renderClothing(field, ctx);
  if (field.mode === 'switch') return renderSwitch(field);
  if (field.groups) return renderRole(field);
  if (field.field === 'backgroundColor') return renderBackgroundColor(field, ctx);
  return renderChoices(field, ctx);
}

function renderLeft(left, ctx = {}) {
  const fields = left.fields.map((field) => renderField(field, ctx)).join('');
  const presets = left.presets.map((group) => {
    const buttons = group.options.map(renderPreset).join('');
    return `<section class="preset-group"><h3>${esc(group.label)}</h3><div class="preset-grid">${buttons}</div></section>`;
  }).join('');
  return `<h2 class="section-title">身份基底</h2>${fields}<div class="presets"><h2 class="section-title">配色预设</h2>${presets}</div>`;
}

function renderMore(more, title, open, ctx = {}) {
  return `<div class="more${open ? ' is-open' : ''}" data-more>
    <button type="button" class="more-toggle" data-more-toggle aria-expanded="${open ? 'true' : 'false'}"><span>${esc(more.title)}</span>${CHEVRON}</button>
    <div class="more-body" data-more-body><div class="more-inner"><div class="choices">${more.options.map((control) => renderButton(control, ctx)).join('')}</div></div></div>
  </div>`;
}

function renderCenter(center, { closedGroups = new Set(), openMores = new Set(), ctx = {} } = {}) {
  return center.map((group) => {
    const open = !closedGroups.has(group.title);
    const locked = group.locked;
    const fields = group.fields.map((field) => renderField(field, ctx)).join('');
    const more = group.more ? renderMore(group.more, group.title, openMores.has(group.title), ctx) : '';
    return `<section class="acc-group${open ? ' is-open' : ''}${locked ? ' is-locked' : ''}" data-group="${esc(group.title)}">
      <button type="button" class="acc-header" data-accordion-toggle aria-expanded="${open ? 'true' : 'false'}"${locked ? ' disabled' : ''}>
        <span class="acc-title">${esc(group.title)}</span>
        ${locked ? '<span class="lock-badge">锁脸</span>' : ''}
        ${CHEVRON}
      </button>
      <div class="acc-body" data-accordion-body><div class="acc-inner">${fields}${more}</div></div>
    </section>`;
  }).join('');
}

function renderModelLock() {
  const row = (use, id, detail) => {
    const model = imageModelById(id);
    const extra = detail ? `<p class="model-lock-detail">${esc(detail)}</p>` : '';
    return `<div class="model-lock"><p class="model-lock-line"><span class="model-lock-use">${esc(use)}</span><span class="model-id">${esc(model.id)}</span></p>${extra}<p class="model-price">${esc(model.price)}</p></div>`;
  };
  return `<div class="model-picker"><span class="style-picker-label">生图模型</span><p class="model-note">千问是百炼官方价，标 $。Gemini 走 4sapi image 分组 2×，实扣人民币，标 ￥（1 美元按 ￥2 扣）。全部按 1K 出图，标的是出图价。</p>${row('基准立绘', BASE_IMAGE_MODEL)}${row('Q版形象', CHIBI_IMAGE_MODEL, '单张或完整设定集里的 Q 版都走千问')}${row('设定集', SUITE_IMAGE_MODEL, '三视图、表情差分图、服饰拆解图、手部拆解图、完整设定集其余部分')}</div>`;
}

function renderStyleSelector(options) {
  const buttons = options.map((opt) => {
    const pressed = opt.selected ? 'true' : 'false';
    const cls = `style-pill${opt.selected ? ' on' : ''}`;
    return `<button type="button" class="${cls}" data-field="style" data-value="${esc(opt.value)}" data-mode="single" aria-pressed="${pressed}">${esc(opt.label)}</button>`;
  }).join('');
  return `<div class="style-picker"><span class="style-picker-label">生成风格</span><div class="style-pills">${buttons}</div></div>`;
}

function renderRight(right, warningList, extras) {
  const warningHtml = warningList.map((text) => `<p>${esc(text)}</p>`).join('');
  const disabled = extras.generating ? ' disabled' : '';
  const renderButton = (button, countHtml = '') => {
    const aspects = button.aspect
      ? `<div class="aspects">${button.aspect.options.map(renderAspect).join('')}</div>`
      : '';
    return `<div class="gen${button.label === '生成完整设定集' || button.label === '生成基准立绘' ? ' gen-full' : ''}"><button type="button" class="gen-btn" data-generate="${esc(button.label)}"${disabled}>${esc(button.label)}</button>${countHtml}${aspects}</div>`;
  };
  const modelHtml = renderModelLock();
  const styleHtml = renderStyleSelector(right.style || []);
  // 出图背景：白/黑/绿/蓝 + 自定义。绿是给抠图用的 chroma key 绿幕。
  const bgPick = extras.sheetBg || '白';
  const bgCustom = extras.sheetBgCustom || '#ffffff';
  const bgHtml = `<div class="sheet-bg">
    <span class="sheet-bg-label">出图背景</span>
    ${['白', '黑', '绿', '蓝'].map((value) => `<button type="button" class="sheet-bg-btn${bgPick === value ? ' active' : ''}" data-sheet-bg="${value}">${value}</button>`).join('')}
    <button type="button" class="sheet-bg-btn${bgPick === '自定义' ? ' active' : ''}" data-sheet-bg="自定义">自定义</button>
    <input type="color" class="sheet-bg-color" data-sheet-bg-custom value="${esc(bgCustom)}" aria-label="自定义背景色">
  </div>`;
  // 上传参考图入口已删除，锁脸由下载页选定基准立绘驱动；这里只负责提示当前处于锁脸态。
  const reference = right.reference || {};
  const lockHtml = reference.locked && reference.message
    ? `<p class="lock-hint" id="lock-hint">${esc(reference.message)}</p>`
    : '';
  const baseHtml = right.base.map((button) => renderButton(button,
    `<div class="base-count"><span class="base-count-label">生成数量</span><input type="range" class="base-count-slider" min="1" max="4" step="1" value="${esc(String(extras.baseCount))}" data-base-count aria-label="生成图片数量"><output class="base-count-value" data-base-count-label>${esc(String(extras.baseCount))} 张</output></div>`
  )).join('');
  const typesHtml = right.types.map((button) => renderButton(button)).join('');
  const suiteHtml = right.suite.map((button) => renderButton(button,
    `<div class="base-count suite-count"><span class="base-count-label">生成套数</span><input type="range" class="base-count-slider" min="1" max="4" step="1" value="${esc(String(extras.suiteCount))}" data-suite-count aria-label="生成套数"><output class="base-count-value" data-suite-count-label>${esc(String(extras.suiteCount))} 套</output></div>`
  )).join('');
  return `<div class="right-panel">
    <div id="warnings">${warningHtml}</div>
    <div class="gen-stack">${lockHtml}${modelHtml}${styleHtml}${bgHtml}${baseHtml}<div class="gen-grid">${typesHtml}</div>${suiteHtml}</div>
    <div id="status"></div>
    <div id="progress" class="progress" hidden>
      <div class="progress-track"><div class="progress-fill"></div></div>
    </div>
    ${renderStop(extras.generating)}
    <div id="output" class="output-strip">${extras.output}</div>
  </div>`;
}

// 生成中才出现的「停止生成」。点了立刻掐断请求，已回显和未开始的图全部丢弃。
function renderStop(generating) {
  return `<div class="gen stop-row"${generating ? '' : ' hidden'}><button type="button" class="stop-btn" data-stop>停止生成</button></div>`;
}

// ---------------- 图库与预览 ----------------

// 生成页只展示本次打开后新生成的图。从服务端拉回的历史批次留给下载页，刷新后这里是空的。
// liveItems 是生成中已回显、尚未落入图库批次的瞬时图片。
function outputHtml(gallery, liveItems = [], { onlyKind = '', excludeKind = '' } = {}) {
  const session = galleryBatches(gallery).filter((batch) => !batch.history);
  let items = [...session.flatMap((batch) => batch.items || []), ...(liveItems || [])];
  if (onlyKind) items = items.filter((item) => item.kind === onlyKind);
  if (excludeKind) items = items.filter((item) => item.kind !== excludeKind);
  if (!items.length) return '<span class="output-empty">还没有图片</span>';
  return items.map((item) => (
    `<img class="output-img" src="${esc(item.dataUrl)}" alt="${esc(item.kind)}" title="点击查看大图">`
  )).join('');
}

function galleryBatches(gallery) {
  if (!gallery || typeof gallery.batches !== 'function') return [];
  return gallery.batches();
}

// 下载页按生成时间倒序。时间相同则后加入的在前。
function newestBatches(gallery) {
  return galleryBatches(gallery)
    .map((batch, index) => ({ batch, index }))
    .sort((a, b) => (b.batch.createdAt || 0) - (a.batch.createdAt || 0) || b.index - a.index)
    .map((entry) => entry.batch);
}

function locateItem(gallery, id) {
  for (const batch of galleryBatches(gallery)) {
    const index = batch.items.findIndex((item) => item.id === id);
    if (index >= 0) return { batch, item: batch.items[index], index: index + 1 };
  }
  return null;
}

// ---------------- 下载页 ----------------

function downloadRow(item) {
  return `<div class="download-row"><img src="${esc(item.dataUrl)}" alt="${esc(item.kind)}" title="点击查看大图"><span class="kind">${esc(item.kind)}</span><button type="button" class="mini-btn" data-download-item="${esc(item.id)}">下载这张</button></div>`;
}

function padTime(value) {
  return String(value).padStart(2, '0');
}

function formatGeneratedAt(createdAt) {
  const ms = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())} ${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`;
}

function generatedAtHtml(createdAt) {
  const text = formatGeneratedAt(createdAt);
  return text ? `<span class="generated-at">${esc(text)}</span>` : '';
}

function deleteButton(attr, id) {
  return `<button type="button" class="delete-btn" ${attr}="${esc(id)}">删除</button>`;
}

function batchGroup(batch) {
  if ((batch.items || []).length > 0 && batch.items.every((item) => item.kind === '微调角色')) return 'tune';
  if (batch.base && batch.base.dataUrl && (batch.items || []).some((item) => item.kind !== '三视图')) return 'suite';
  return 'other';
}

function downloadFilterBar(filter) {
  const tune = filter === 'tune' ? ' checked' : '';
  const suite = filter === 'suite' ? ' checked' : '';
  return `<div class="download-filters" role="group" aria-label="图集筛选"><label class="download-filter"><input type="checkbox" data-download-filter="tune"${tune}>微调角色图集</label><label class="download-filter"><input type="checkbox" data-download-filter="suite"${suite}>设定集</label></div>`;
}

function renderDownloadList(doc, gallery, filter = '') {
  const list = doc.getElementById('download-list');
  if (!list) return;
  const batches = newestBatches(gallery);
  if (!batches.length) {
    list.innerHTML = '<p class="empty-state">还没有生成图片</p>';
    return;
  }
  const sections = batches.map((batch) => {
    const group = batchGroup(batch);
    if (filter && group !== filter) return '';
    const when = generatedAtHtml(batch.createdAt);
    const remove = deleteButton('data-delete-batch', batch.id);
    if (group === 'tune') {
      const baseRow = batch.base && batch.base.dataUrl
        ? `<div class="download-row download-base-row"><img src="${esc(batch.base.dataUrl)}" alt="三视图" title="点击查看大图"><span class="kind">三视图</span><span class="base-tag">本套基准</span></div>`
        : '';
      const rows = batch.items.map(downloadRow).join('');
      const packTune = batch.status === 'complete'
        ? `<button type="button" class="pack-btn" data-download-batch="${esc(batch.id)}">打包本套</button>`
        : '';
      return `<section class="download-batch suite-group"><div class="suite-head"><span>微调角色图集</span>${when}<span class="suite-actions">${packTune}${remove}</span></div>${baseRow}${rows}</section>`;
    }
    if (group === 'suite') {
      const baseRow = `<div class="download-row download-base-row"><img src="${esc(batch.base.dataUrl)}" alt="基准立绘" title="点击查看大图"><span class="kind">基准立绘</span><span class="base-tag">本套基准</span></div>`;
      const rows = batch.items.map(downloadRow).join('');
      const packSuite = batch.status === 'complete'
        ? `<button type="button" class="pack-btn" data-download-batch="${esc(batch.id)}">打包本套</button>`
        : '';
      return `<section class="download-batch suite-group"><div class="suite-head"><span>设定集</span>${when}<span class="suite-actions">${packSuite}${remove}</span></div>${baseRow}${rows}</section>`;
    }
    const pack = batch.status === 'complete'
      ? `<button type="button" class="pack-btn" data-download-batch="${esc(batch.id)}">打包本次</button>`
      : '';
    const rows = batch.items.map(downloadRow).join('');
    return `<section class="download-batch"><div class="suite-head">${when}<span class="suite-actions">${pack}${remove}</span></div>${rows}</section>`;
  }).join('');
  const body = sections.trim()
    ? sections
    : '<p class="empty-state">没有符合的图集</p>';
  list.innerHTML = `${downloadFilterBar(filter)}${body}`;
}

// 「基准立绘」标签：列出所有基准立绘，点「确定」设为当前角色基准，点图片查看大图。
function renderBaseSelect(doc, gallery) {
  const box = doc.getElementById('base-select');
  if (!box) return;
  const items = newestBatches(gallery).flatMap((batch) => (
    (batch.items || []).filter((item) => item.kind === '基准立绘').map((item) => ({ item, createdAt: item.createdAt || batch.createdAt }))
  ));
  if (!items.length) {
    box.innerHTML = '<p class="empty-state">还没有生成基准立绘</p>';
    return;
  }
  const current = typeof gallery.base === 'function' ? gallery.base() : null;
  const cards = items.map(({ item, createdAt }) => {
    const isCurrent = Boolean(current && current.seed === item.seed && current.dataUrl === item.dataUrl);
    const badge = isCurrent ? '<span class="base-badge">当前基准</span>' : '';
    return `<div class="base-card${isCurrent ? ' on' : ''}">
      <img class="base-card-img" src="${esc(item.dataUrl)}" alt="基准立绘" title="点击查看大图" data-base-view="${esc(item.id)}">
      <div class="base-card-meta">种子 ${esc(String(item.seed))}${badge}</div>
      ${generatedAtHtml(createdAt)}
      <div class="base-card-actions"><button type="button" class="base-confirm-btn" data-base-select="${esc(item.id)}">确定</button>${deleteButton('data-delete-item', item.id)}</div>
    </div>`;
  }).join('');
  box.innerHTML = `<p class="base-select-hint">点「确定」将这张基准立绘设为当前角色基准（锁脸用）；点击图片可查看大图。</p><div class="base-grid">${cards}</div>`;
}

function renderDownloadPanes(doc, gallery) {
  renderDownloadList(doc, gallery, mounts.get(doc)?.downloadFilter || '');
  renderBaseSelect(doc, gallery);
  renderClothingPairs(doc, gallery);
}

function clothingGroups(gallery) {
  const groups = [];
  for (const batch of newestBatches(gallery)) {
    if (!batch.base || !batch.base.dataUrl) continue;
    for (const item of batch.items || []) {
      if (item.kind !== '三视图' || !item.dataUrl) continue;
      groups.push({ id: item.id, base: batch.base, turnaround: item, createdAt: item.createdAt || batch.createdAt });
    }
  }
  return groups;
}

function renderClothingPairs(doc, gallery) {
  const box = doc.getElementById('clothing-pairs');
  if (!box) return;
  const groups = clothingGroups(gallery);
  if (!groups.length) {
    box.innerHTML = '<p class="empty-state">还没有成对的基准立绘和三视图</p>';
    return;
  }
  const selected = gallery && typeof gallery.clothingPair === 'function' ? gallery.clothingPair() : null;
  const cards = groups.map((group) => {
    const on = Boolean(selected && selected.id === group.id);
    const badge = on ? '<span class="base-badge">当前选定</span>' : '';
    return `<section class="download-batch clothing-pair${on ? ' on' : ''}">
      <div class="suite-head"><span>服饰基准</span>${generatedAtHtml(group.createdAt)}${badge}<span class="suite-actions"><button type="button" class="pack-btn" data-clothing-pair="${esc(group.id)}">确定选定</button>${deleteButton('data-delete-item', group.id)}</span></div>
      <div class="download-row"><img src="${esc(group.base.dataUrl)}" alt="基准立绘" title="点击查看大图"><span class="kind">基准立绘</span></div>
      <div class="download-row"><img src="${esc(group.turnaround.dataUrl)}" alt="三视图" title="点击查看大图"><span class="kind">三视图</span></div>
    </section>`;
  }).join('');
  box.innerHTML = `<p class="base-select-hint">每一组是一张基准立绘和当时用它生成的三视图。点「确定选定」用于单次生成服饰拆解图或手部拆解图，不会替换锁脸基准。</p>${cards}`;
}

// ---------------- 批量水印页 ----------------

function watermarkFileName(name) {
  const base = String(name || 'image').replace(/\.[^.]*$/, '');
  return `${base}-wm.png`;
}

function watermarkStamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function paintWatermark(doc) {
  const box = doc.getElementById('page-watermark');
  if (!box) return;
  const mounted = mounts.get(doc) || {};
  const items = mounted.watermarkItems || [];
  const text = mounted.watermarkText || DEFAULT_WATERMARK_TEXT;
  const alpha = mounted.watermarkAlpha ?? 18;
  const fontSize = mounted.watermarkFontSize ?? DEFAULT_WATERMARK_FONT_SIZE;
  const letterGap = mounted.watermarkLetterGap ?? DEFAULT_WATERMARK_LETTER_GAP;
  const lineGap = mounted.watermarkLineGap ?? DEFAULT_WATERMARK_LINE_GAP;
  const rows = items.map((item, i) => `
    <div class="wm-card">
      <img src="${esc(item.dataUrl)}" alt="${esc(item.name)}" data-wm-view="${i}" title="点击查看大图">
      <div class="wm-meta">
        <span class="wm-name" title="${esc(item.name)}">${esc(item.name)}</span>
        <div class="wm-actions">
          <button type="button" class="mini-btn" data-wm-download="${i}">下载</button>
          <button type="button" class="delete-btn" data-wm-remove="${i}">删除</button>
        </div>
      </div>
    </div>`).join('');
  const grid = items.length
    ? `<div class="wm-grid">${rows}</div>`
    : '<p class="empty-state">还没有水印图片。拖入或选择多张图片开始。</p>';
  const actions = items.length
    ? `<div class="wm-actions-bar"><button type="button" class="pack-btn" data-wm-pack>打包全部</button><button type="button" class="delete-btn" data-wm-clear>清空</button></div>`
    : '';
  box.innerHTML = `
    <div class="wm-sheet">
      <h2 class="section-title">批量水印</h2>
      <section class="wm-block" data-wm-block="image">
        <h3 class="wm-subtitle">批量图片水印</h3>
        <div class="wm-controls">
          <label class="wm-field">水印文字 <input type="text" id="watermark-text" value="${esc(text)}"></label>
          <label class="wm-field">透明度 <input type="range" id="watermark-alpha" min="5" max="60" step="1" value="${esc(String(alpha))}"> <output id="watermark-alpha-label">${esc(String(alpha))}%</output></label>
          <label class="wm-field">字号 <input type="range" id="watermark-font-size" min="16" max="96" step="1" value="${esc(String(fontSize))}"> <output id="watermark-font-size-label">${esc(String(fontSize))}px</output></label>
          <label class="wm-field">字间距 <input type="range" id="watermark-letter-gap" min="0" max="300" step="10" value="${esc(String(letterGap))}"> <output id="watermark-letter-gap-label">${esc(String(letterGap))}px</output></label>
          <label class="wm-field">行间距 <input type="range" id="watermark-line-gap" min="20" max="400" step="10" value="${esc(String(lineGap))}"> <output id="watermark-line-gap-label">${esc(String(lineGap))}px</output></label>
        </div>
        <div class="upload-drop wm-drop" data-upload-zone="watermark-file">
          <label>拖入多张图片，或点击选择<input type="file" id="watermark-file" accept="image/*" multiple></label>
          <p class="model-note">水印文字会以左下→右上方向满屏平铺，半透明覆盖在图片上，原图不会被改动。</p>
        </div>
        ${mounted.watermarkBusy ? '<p class="wm-busy">正在处理…</p>' : ''}
        ${actions}
        ${grid}
      </section>
      ${paintVideoWatermark(mounted)}
    </div>`;
}

// 批量视频水印区块：参数表 + 上传 + 实时预览 + 已添加视频列表。
function paintVideoWatermark(mounted) {
  const opts = normalizeVideoWatermark(mounted.watermarkVideo || {});
  const items = mounted.watermarkVideoItems || [];
  const minPercent = alphaToPercent(opts.alphaMin);
  const maxPercent = alphaToPercent(opts.alphaMax);
  const selected = Math.min(Math.max(0, mounted.watermarkVideoIndex || 0), Math.max(0, items.length - 1));
  const cards = items.map((item, i) => `
    <div class="wm-card${i === selected ? ' on' : ''}">
      <video src="${esc(item.url)}" muted loop playsinline preload="metadata" data-wm-video-view="${i}" title="点击预览"></video>
      <div class="wm-meta">
        <span class="wm-name" title="${esc(item.name)}">${esc(item.name)}</span>
        <span class="wm-video-state">${item.dataUrl ? `已导出 · ${esc(item.ext || 'webm')}` : '未导出'}</span>
        <div class="wm-actions">
          <button type="button" class="mini-btn" data-wm-video-export="${i}"${mounted.watermarkVideoBusy ? ' disabled' : ''}>${item.dataUrl ? '重新生成' : '生成'}</button>
          <button type="button" class="mini-btn" data-wm-video-download="${i}"${item.dataUrl ? '' : ' disabled'}>下载</button>
          <button type="button" class="delete-btn" data-wm-video-remove="${i}">删除</button>
        </div>
      </div>
    </div>`).join('');
  const grid = items.length
    ? `<div class="wm-grid">${cards}</div>`
    : '<p class="empty-state">还没有水印视频。拖入或选择一个以上视频开始。</p>';
  const actions = items.length
    ? `<div class="wm-actions-bar">
        <button type="button" class="pack-btn" data-wm-video-pack${items.some((item) => item.dataUrl) ? '' : ' disabled'}>打包全部</button>
        <button type="button" class="pack-btn wp-cancel" data-wm-video-export-all${mounted.watermarkVideoBusy ? ' disabled' : ''}>全部生成</button>
        <button type="button" class="delete-btn" data-wm-video-clear>清空</button>
      </div>`
    : '';
  const status = mounted.watermarkVideoStatus
    ? `<p class="wm-busy">${esc(mounted.watermarkVideoStatus)}</p>`
    : '';
  return `
      <section class="wm-block" data-wm-block="video">
        <h3 class="wm-subtitle">批量视频水印</h3>
        <div class="wm-controls">
          <label class="wm-field">水印文字 <input type="text" id="watermark-video-text" value="${esc(opts.text)}"></label>
          <label class="wm-field">字号 <input type="range" id="watermark-video-font-size" min="${VIDEO_WATERMARK_LIMITS.fontSize.min}" max="${VIDEO_WATERMARK_LIMITS.fontSize.max}" step="${VIDEO_WATERMARK_LIMITS.fontSize.step}" value="${esc(String(opts.fontSize))}"> <output id="watermark-video-font-size-label">${esc(String(opts.fontSize))}px</output></label>
          <label class="wm-field">漂移速度 <input type="range" id="watermark-video-speed" min="${VIDEO_WATERMARK_LIMITS.speed.min}" max="${VIDEO_WATERMARK_LIMITS.speed.max}" step="${VIDEO_WATERMARK_LIMITS.speed.step}" value="${esc(String(opts.speed))}"> <output id="watermark-video-speed-label">${esc(String(opts.speed))}px/s</output></label>
          <label class="wm-field">透明度下限 <input type="range" id="watermark-video-alpha-min" min="${VIDEO_WATERMARK_LIMITS.alphaMin.min}" max="${VIDEO_WATERMARK_LIMITS.alphaMin.max}" step="${VIDEO_WATERMARK_LIMITS.alphaMin.step}" value="${esc(String(minPercent))}"> <output id="watermark-video-alpha-min-label">${esc(String(minPercent))}%</output></label>
          <label class="wm-field">透明度上限 <input type="range" id="watermark-video-alpha-max" min="${VIDEO_WATERMARK_LIMITS.alphaMax.min}" max="${VIDEO_WATERMARK_LIMITS.alphaMax.max}" step="${VIDEO_WATERMARK_LIMITS.alphaMax.step}" value="${esc(String(maxPercent))}"> <output id="watermark-video-alpha-max-label">${esc(String(maxPercent))}%</output></label>
          <label class="wm-field">透明度变化周期 <input type="range" id="watermark-video-pulse" min="${VIDEO_WATERMARK_LIMITS.pulsePeriod.min}" max="${VIDEO_WATERMARK_LIMITS.pulsePeriod.max}" step="${VIDEO_WATERMARK_LIMITS.pulsePeriod.step}" value="${esc(String(opts.pulsePeriod))}"> <output id="watermark-video-pulse-label">${esc(String(opts.pulsePeriod))}s</output></label>
        </div>
        <div class="upload-drop wm-drop" data-upload-zone="watermark-video-file">
          <label>拖入一个或多个视频，或点击选择<input type="file" id="watermark-video-file" accept="video/*" multiple></label>
          <p class="model-note">水印会在画面里持续漂移，透明度在 ${minPercent}%~${maxPercent}% 之间来回呼吸。周期数值越小，透明度变化越快。导出会按原速度重新录制一遍，时长与源视频相同。</p>
        </div>
        <div class="wm-preview-wrap">
          <canvas id="watermark-video-preview" class="wm-preview" width="520" height="292"></canvas>
          <p class="wm-preview-note">${items.length ? '实时预览（点下方视频可切换）' : '添加视频后这里显示实时水印预览'}</p>
        </div>
        ${status}
        ${actions}
        ${grid}
      </section>`;
}

function fileToDataUrl(doc, file) {
  return new Promise((resolve, reject) => {
    const reader = new doc.defaultView.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

async function handleWatermarkFiles(doc, files) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const list = Array.from(files || []).filter((f) => f && f.type && f.type.startsWith('image/'));
  if (!list.length) {
    showToast(doc, '没有可处理的图片');
    return;
  }
  mounted.watermarkBusy = true;
  paintWatermark(doc);
  try {
    for (const file of list) {
      const sourceDataUrl = await fileToDataUrl(doc, file);
      mounted.watermarkItems = [...(mounted.watermarkItems || []), { name: file.name, sourceDataUrl, dataUrl: sourceDataUrl }];
    }
    showToast(doc, `已为 ${list.length} 张图片加上水印`);
  } catch (error) {
    showToast(doc, error && error.message ? error.message : '加水印失败');
  } finally {
    mounted.watermarkBusy = false;
    await reprocessWatermark(doc);
  }
}

// 用当前水印参数（文字/透明度/字号/字间距/行间距）重新渲染所有已添加的图片。
async function reprocessWatermark(doc) {
  const mounted = mounts.get(doc);
  if (!mounted || !mounted.watermarkItems.length) {
    if (mounted) paintWatermark(doc);
    return;
  }
  const text = mounted.watermarkText || DEFAULT_WATERMARK_TEXT;
  const alpha = (Number(mounted.watermarkAlpha) || 18) / 100;
  const fontSize = Number(mounted.watermarkFontSize) || DEFAULT_WATERMARK_FONT_SIZE;
  const letterGap = Number(mounted.watermarkLetterGap) || DEFAULT_WATERMARK_LETTER_GAP;
  const lineGap = Number(mounted.watermarkLineGap) || DEFAULT_WATERMARK_LINE_GAP;
  mounted.watermarkBusy = true;
  paintWatermark(doc);
  try {
    const next = [];
    for (const item of mounted.watermarkItems) {
      const dataUrl = await watermarkDataUrl(item.sourceDataUrl, text, { alpha, fontSize, letterGap, lineGap });
      next.push({ ...item, dataUrl });
    }
    mounted.watermarkItems = next;
  } finally {
    mounted.watermarkBusy = false;
    paintWatermark(doc);
  }
}

function downloadWatermarkZip(doc) {
  const mounted = mounts.get(doc);
  const items = (mounted && mounted.watermarkItems) || [];
  if (!items.length) return;
  const now = Date.now();
  const batch = {
    createdAt: now,
    items: items.map((item) => ({
      dataUrl: item.dataUrl,
      createdAt: now,
      fileKey: makeFileKey(now),
    })),
  };
  const zipped = zipBatch(batch);
  zipped.filename = `批量水印-${watermarkStamp(now)}.zip`;
  saveFile(doc, zipped.filename, bytesToDataUrl(zipped.bytes));
}

// ---------------- 批量视频水印 ----------------

const VIDEO_WATERMARK_PREVIEW_LONG = 520; // 预览画布长边，够看清水印轨迹又不拖慢主线程
const VIDEO_WATERMARK_MAX_LONG = 1920;    // 导出画布长边上限，超过就等比缩小，避免 4K 源实时录制卡死

function canvasSizeFor(width, height, maxLong) {
  const sw = Math.max(2, Number(width) || 0);
  const sh = Math.max(2, Number(height) || 0);
  const long = Math.max(sw, sh);
  if (!maxLong || long <= maxLong) return { w: Math.round(sw), h: Math.round(sh) };
  const scale = maxLong / long;
  return { w: Math.max(2, Math.round(sw * scale)), h: Math.max(2, Math.round(sh * scale)) };
}

function videoWatermarkOpts(mounted) {
  return normalizeVideoWatermark(mounted.watermarkVideo || {});
}

function releaseWatermarkVideoItems(items) {
  for (const item of items || []) {
    if (item && item.url) {
      try { URL.revokeObjectURL(item.url); } catch { /* 忽略 */ }
    }
  }
}

// 预览用的隐藏 video：和列表里的 <video> 分开，避免每次重绘 innerHTML 都把播放打断。
function setWatermarkVideoPreview(doc, mounted, item) {
  const previous = mounted.watermarkVideoPreview;
  if (previous && previous.__wmUrl === (item && item.url)) return;
  if (previous) {
    try { previous.pause(); } catch { /* 忽略 */ }
    mounted.watermarkVideoPreview = null;
  }
  if (!item || !item.url) return;
  const video = doc.createElement('video');
  video.src = item.url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.__wmUrl = item.url;
  mounted.watermarkVideoPreview = video;
  const started = video.play && video.play();
  if (started && typeof started.catch === 'function') started.catch(() => { /* 自动播放被拦时静默 */ });
}

// 预览循环：有视频就画视频帧，没视频就在渐变底上演示漂移，参数改了即时生效。
function videoWatermarkFrame(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  if (mounted.activeRoute !== 'watermark') {
    mounted.watermarkVideoRaf = 0;
    return;
  }
  const view = doc.defaultView;
  const canvas = doc.getElementById('watermark-video-preview');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (ctx) {
    const opts = videoWatermarkOpts(mounted);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const video = mounted.watermarkVideoPreview;
    const frame = video && video.readyState >= 2 && video.videoWidth ? video : null;
    if (frame) {
      const rect = containRect(frame.videoWidth, frame.videoHeight, w, h);
      ctx.drawImage(frame, rect.x, rect.y, rect.w, rect.h);
    } else {
      // 没视频时给一块深色渐变底，让漂移和呼吸看得见。
      const grad = ctx.createLinearGradient ? ctx.createLinearGradient(0, 0, w, h) : null;
      if (grad) {
        grad.addColorStop(0, '#1f2937');
        grad.addColorStop(1, '#4c1d95');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = '#1f2937';
      }
      ctx.fillRect(0, 0, w, h);
    }
    // 水印漂移用独立于视频的持续时钟：视频 loop 回绕时 currentTime 会跳回 0，
    // 若拿它当 t 会让水印每隔几秒突然回到起点。改用墙钟，水印像「盖在原视频上」持续飘。
    const watermarkClock = (view.performance ? view.performance.now() : Date.now()) / 1000;
    drawVideoWatermark(ctx, { ...opts, width: w, height: h }, watermarkClock);
  }
  mounted.watermarkVideoRaf = view.requestAnimationFrame
    ? view.requestAnimationFrame(() => videoWatermarkFrame(doc))
    : 0;
}

function startWatermarkVideoPreview(doc) {
  const mounted = mounts.get(doc);
  const view = doc.defaultView;
  if (!mounted || !view || !view.requestAnimationFrame) return;
  if (mounted.watermarkVideoRaf) return;
  // 从别的页面回来时预览可能被暂停过，重新拉起来。
  const preview = mounted.watermarkVideoPreview;
  if (preview && preview.paused && typeof preview.play === 'function') {
    const started = preview.play();
    if (started && typeof started.catch === 'function') started.catch(() => { /* 忽略 */ });
  }
  const canvas = doc.getElementById('watermark-video-preview');
  if (canvas) {
    const { w, h } = canvasSizeFor(canvas.width || 640, canvas.height || 360, VIDEO_WATERMARK_PREVIEW_LONG);
    canvas.width = w;
    canvas.height = h;
  }
  mounted.watermarkVideoRaf = view.requestAnimationFrame(() => videoWatermarkFrame(doc));
}

function stopWatermarkVideoPreview(doc) {
  const mounted = mounts.get(doc);
  const view = doc.defaultView;
  if (mounted && mounted.watermarkVideoRaf && view && view.cancelAnimationFrame) {
    view.cancelAnimationFrame(mounted.watermarkVideoRaf);
  }
  if (mounted) {
    mounted.watermarkVideoRaf = 0;
    // 离页/导出期间不空转，预览视频先停掉省电省 CPU。
    if (mounted.watermarkVideoPreview) {
      try { mounted.watermarkVideoPreview.pause(); } catch { /* 忽略 */ }
    }
  }
}

function selectWatermarkVideo(doc, index) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const items = mounted.watermarkVideoItems || [];
  if (!items.length) {
    mounted.watermarkVideoIndex = 0;
    setWatermarkVideoPreview(doc, mounted, null);
    paintWatermark(doc);
    startWatermarkVideoPreview(doc);
    return;
  }
  // 夹在有效范围内，删掉最后一条时自动落到前一条。
  const next = Math.min(Math.max(0, Number(index) || 0), items.length - 1);
  mounted.watermarkVideoIndex = next;
  setWatermarkVideoPreview(doc, mounted, items[next]);
  paintWatermark(doc);
  startWatermarkVideoPreview(doc);
}

function handleWatermarkVideoFiles(doc, files) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const list = Array.from(files || []).filter((f) => f && f.type && f.type.startsWith('video/'));
  if (!list.length) {
    showToast(doc, '没有可处理的视频');
    return;
  }
  const added = list.map((file) => ({
    name: file.name,
    url: URL.createObjectURL(file),
    dataUrl: null,
    ext: 'webm',
    type: file.type,
  }));
  const merged = [...(mounted.watermarkVideoItems || []), ...added];
  mounted.watermarkVideoItems = merged;
  mounted.watermarkVideoIndex = Math.max(0, merged.length - added.length);
  setWatermarkVideoPreview(doc, mounted, merged[mounted.watermarkVideoIndex]);
  paintWatermark(doc);
  startWatermarkVideoPreview(doc);
  showToast(doc, `已加入 ${added.length} 个视频，点「生成」导出带水印的版本`);
}

// 逐帧把视频画到画布上，并实时录制成 webm。返回 { blob, ext, duration }。
async function renderWatermarkedVideo(doc, item, opts, { onProgress } = {}) {
  const view = doc.defaultView;
  if (!view || typeof view.MediaRecorder !== 'function') throw new Error('当前浏览器不支持录制视频');
  const video = doc.createElement('video');
  video.src = item.url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  await new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const fail = () => { if (!settled) { settled = true; reject(new Error('视频读取失败')); } };
    video.onloadedmetadata = done;
    video.onerror = fail;
    // 有些容器不会触发 loadedmetadata，兜底 5 秒后放行。
    setTimeout(done, 5000);
  });

  const { w, h } = canvasSizeFor(video.videoWidth || 1280, video.videoHeight || 720, VIDEO_WATERMARK_MAX_LONG);
  const canvas = doc.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const supports = typeof view.MediaRecorder.isTypeSupported === 'function'
    ? (type) => view.MediaRecorder.isTypeSupported(type)
    : () => false;
  const mime = pickVideoMime(supports);
  if (typeof canvas.captureStream !== 'function') throw new Error('当前浏览器不支持画布录制');
  const recorder = new view.MediaRecorder(canvas.captureStream(opts.fps), {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 8_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  let raf = 0;
  // 水印 t 用录制开始后的累计时钟，不依赖 video.currentTime（避免其抖动/回绕让水印跳变）。
  let clockStart = null;
  const drawFrame = () => {
    if (video.videoWidth) ctx.drawImage(video, 0, 0, w, h);
    if (clockStart === null) clockStart = view.performance ? view.performance.now() : Date.now();
    const watermarkT = ((view.performance ? view.performance.now() : Date.now()) - clockStart) / 1000;
    drawVideoWatermark(ctx, { ...opts, width: w, height: h }, watermarkT);
    if (onProgress) onProgress(video.currentTime);
    raf = view.requestAnimationFrame(drawFrame);
  };

  try {
    recorder.start(200);
    await video.play();
    raf = view.requestAnimationFrame(drawFrame);
    await new Promise((resolve) => {
      const finish = () => resolve();
      video.onended = finish;
      // 极端情况下 ended 不触发（元数据缺失/容器异常），按媒体时长兜底，最长 10 分钟。
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 15;
      setTimeout(finish, (duration + 1.5) * 1000);
      setTimeout(finish, 10 * 60 * 1000);
    });
  } finally {
    if (raf && view.cancelAnimationFrame) view.cancelAnimationFrame(raf);
    try { video.pause(); } catch { /* 忽略 */ }
    if (recorder.state !== 'inactive') recorder.stop();
  }
  await stopped;
  const blob = new view.Blob(chunks, { type: mime || 'video/webm' });
  if (!blob.size) throw new Error('录制结果为空，请换一个视频或缩短时长');
  return { blob, ext: extensionForMime(mime), duration: video.duration };
}

async function exportWatermarkVideoItem(doc, index, opts, label) {
  const mounted = mounts.get(doc);
  const items = (mounted && mounted.watermarkVideoItems) || [];
  const item = items[index];
  if (!mounted || !item) return false;
  mounted.watermarkVideoBusy = true;
  mounted.watermarkVideoStatus = label || `正在生成水印视频：${item.name}`;
  // 录制本身要占满 rAF，先停掉预览循环，别让两套绘制互相抢帧。
  stopWatermarkVideoPreview(doc);
  paintWatermark(doc);
  try {
    const { blob } = await renderWatermarkedVideo(doc, item, opts);
    // 浏览器 MediaRecorder 只能录 webm；这里转成 mp4 再入库，保证单下载和打包都是 mp4。
    mounted.watermarkVideoStatus = `${label || '正在生成水印视频'}：正在转码为 mp4…`;
    paintWatermark(doc);
    const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
    const mp4 = await transcodeToMp4(blob, { fetchImpl, fps: opts.fps });
    const dataUrl = await blobToDataUrl(mp4);
    const next = (mounted.watermarkVideoItems || []).slice();
    if (next[index]) next[index] = { ...next[index], dataUrl, ext: 'mp4' };
    mounted.watermarkVideoItems = next;
    mounted.watermarkVideoStatus = '';
    return true;
  } catch (error) {
    mounted.watermarkVideoStatus = '';
    showToast(doc, error && error.message ? error.message : '视频水印生成失败');
    return false;
  } finally {
    mounted.watermarkVideoBusy = false;
    paintWatermark(doc);
    // 批量导出时由外层统一恢复预览，避免每个视频都重启一次循环。
    if (!mounted.watermarkVideoBatch) startWatermarkVideoPreview(doc);
  }
}

async function exportAllWatermarkVideos(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const items = mounted.watermarkVideoItems || [];
  if (!items.length) return;
  if (mounted.watermarkVideoBusy) return;
  const opts = videoWatermarkOpts(mounted);
  let done = 0;
  mounted.watermarkVideoBatch = true;
  try {
    for (let i = 0; i < items.length; i += 1) {
      // 逐个排队：多个视频同时实时录制会把 CPU 和内存吃满。
      const ok = await exportWatermarkVideoItem(doc, i, opts, `正在生成水印视频（${i + 1}/${items.length}）：${items[i].name}`);
      if (ok) done += 1;
    }
  } finally {
    mounted.watermarkVideoBatch = false;
    mounted.watermarkVideoStatus = '';
    paintWatermark(doc);
    startWatermarkVideoPreview(doc);
  }
  showToast(doc, done === items.length
    ? `已生成 ${done} 个水印视频`
    : `已生成 ${done}/${items.length} 个水印视频，其余失败`);
}

function downloadWatermarkVideo(doc, index) {
  const mounted = mounts.get(doc);
  const item = (mounted && mounted.watermarkVideoItems || [])[index];
  if (!item || !item.dataUrl) return;
  const view = doc.defaultView;
  // 视频动辄几十 MB，用 data URL 直接挂在 <a> 上很容易把标签页顶爆；转成 Blob URL 再下载。
  if (view && typeof view.Blob === 'function' && typeof URL.createObjectURL === 'function') {
    const type = item.ext === 'mp4' ? 'video/mp4' : 'video/webm';
    const url = URL.createObjectURL(new view.Blob([dataUrlToBytes(item.dataUrl)], { type }));
    saveFile(doc, videoWatermarkFileName(item.name, item.ext || 'webm'), url);
    if (view.setTimeout) view.setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* 忽略 */ } }, 60_000);
    return;
  }
  saveFile(doc, videoWatermarkFileName(item.name, item.ext || 'webm'), item.dataUrl);
}

function downloadWatermarkVideoZip(doc) {
  const mounted = mounts.get(doc);
  const items = (mounted && mounted.watermarkVideoItems || []).filter((item) => item.dataUrl);
  if (!items.length) return;
  const now = Date.now();
  const files = items.map((item) => ({
    name: videoWatermarkFileName(item.name, item.ext || 'webm'),
    data: dataUrlToBytes(item.dataUrl),
  }));
  const zipped = zipFiles(files, `批量视频水印-${watermarkStamp(now)}.zip`, now);
  saveFile(doc, zipped.filename, bytesToDataUrl(zipped.bytes));
}

function removeWatermarkVideo(doc, index) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const items = mounted.watermarkVideoItems || [];
  const target = items[index];
  if (!target) return;
  releaseWatermarkVideoItems([target]);
  mounted.watermarkVideoItems = items.filter((_, i) => i !== index);
  if (mounted.watermarkVideoPreview && mounted.watermarkVideoPreview.__wmUrl === target.url) {
    setWatermarkVideoPreview(doc, mounted, null);
  }
  const nextIndex = mounted.watermarkVideoItems.length
    ? Math.min(mounted.watermarkVideoIndex || 0, mounted.watermarkVideoItems.length - 1)
    : 0;
  mounted.watermarkVideoIndex = nextIndex;
  setWatermarkVideoPreview(doc, mounted, mounted.watermarkVideoItems[nextIndex] || null);
  paintWatermark(doc);
  startWatermarkVideoPreview(doc);
}

function clearWatermarkVideos(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  releaseWatermarkVideoItems(mounted.watermarkVideoItems);
  mounted.watermarkVideoItems = [];
  mounted.watermarkVideoIndex = 0;
  mounted.watermarkVideoStatus = '';
  setWatermarkVideoPreview(doc, mounted, null);
  paintWatermark(doc);
  startWatermarkVideoPreview(doc);
}

// 视频水印滑杆：值写回 mounted.watermarkVideo，只更新对应 output，不重绘整页。
function updateVideoWatermarkOption(doc, mounted, el) {
  const current = normalizeVideoWatermark(mounted.watermarkVideo || {});
  const label = (id, text) => {
    const output = doc.getElementById(id);
    if (output) output.textContent = text;
  };
  switch (el.id) {
    case 'watermark-video-text':
      mounted.watermarkVideo = { ...current, text: el.value };
      return;
    case 'watermark-video-font-size':
      mounted.watermarkVideo = { ...current, fontSize: Math.round(Number(el.value)) };
      label('watermark-video-font-size-label', `${Math.round(Number(el.value))}px`);
      return;
    case 'watermark-video-speed':
      mounted.watermarkVideo = { ...current, speed: Number(el.value) };
      label('watermark-video-speed-label', `${el.value}px/s`);
      return;
    case 'watermark-video-pulse':
      mounted.watermarkVideo = { ...current, pulsePeriod: Number(el.value) };
      label('watermark-video-pulse-label', `${el.value}s`);
      return;
    case 'watermark-video-alpha-min':
    case 'watermark-video-alpha-max': {
      // 上下限互斥：拖过头时把另一侧推开，保证始终留 1% 的呼吸空间。
      let minPercent = alphaToPercent(current.alphaMin);
      let maxPercent = alphaToPercent(current.alphaMax);
      const value = Number(el.value);
      if (el.id === 'watermark-video-alpha-min') minPercent = Math.min(value, maxPercent - 1);
      else maxPercent = Math.max(value, minPercent + 1);
      mounted.watermarkVideo = { ...current, alphaMin: percentToAlpha(minPercent), alphaMax: percentToAlpha(maxPercent) };
      const minInput = doc.getElementById('watermark-video-alpha-min');
      const maxInput = doc.getElementById('watermark-video-alpha-max');
      if (minInput && Number(minInput.value) !== minPercent) minInput.value = String(minPercent);
      if (maxInput && Number(maxInput.value) !== maxPercent) maxInput.value = String(maxPercent);
      label('watermark-video-alpha-min-label', `${minPercent}%`);
      label('watermark-video-alpha-max-label', `${maxPercent}%`);
      return;
    }
    default:
      return;
  }
}

// ---------------- 动态壁纸页 ----------------

const WALLPAPER_PREVIEW_LONG = 440; // 预览画布长边像素，够看清、也够丝滑。
const WALLPAPER_EDITOR_W = 720; // 主编辑画布宽（16:9）
const WALLPAPER_EDITOR_H = 405;
const WALLPAPER_EDITOR_RATIO = 16 / 9; // 主画布上裁剪框的参考比例
const WALLPAPER_DEFAULT_DURATION = 4; // 纯图片底图导出成视频的默认时长（秒）

function wallpaperView(doc) {
  return doc && doc.defaultView ? doc.defaultView : (typeof window !== 'undefined' ? window : null);
}

// 每个平台的预览画布分辨率（长边固定，短边按比例）。
function wallpaperPreviewSize(platform) {
  const ratio = platform.ratio;
  return ratio >= 1
    ? { w: WALLPAPER_PREVIEW_LONG, h: Math.round(WALLPAPER_PREVIEW_LONG / ratio) }
    : { w: Math.round(WALLPAPER_PREVIEW_LONG * ratio), h: WALLPAPER_PREVIEW_LONG };
}

function sizeWallpaperCanvases(doc) {
  for (const platform of WALLPAPER_PLATFORMS) {
    const canvas = doc.getElementById(`wp-canvas-${platform.id}`);
    if (!canvas) continue;
    const { w, h } = wallpaperPreviewSize(platform);
    canvas.width = w;
    canvas.height = h;
    // 尺寸标签跟着平台定义走，避免 index.html 里硬编码的数字与导出分辨率脱节。
    const dim = doc.querySelector(`[data-wp-platform="${platform.id}"] .wp-dim`);
    if (dim) dim.textContent = `${platform.exportWidth}×${platform.exportHeight}`;
  }
  const editor = doc.getElementById('wp-canvas-editor');
  if (editor) {
    editor.width = WALLPAPER_EDITOR_W;
    editor.height = WALLPAPER_EDITOR_H;
  }
}

// 生成 16 个调色滑杆 + 4 个粒子预设按钮（结构静态，只构建一次）。
function bindWallpaper(doc) {
  if (!doc.getElementById('page-wallpaper')) return;
  sizeWallpaperCanvases(doc);
  const gradingBox = doc.getElementById('wallpaper-grading');
  if (gradingBox) {
    gradingBox.innerHTML = GRADING_GROUPS.map((group) => {
      const params = GRADING_PARAMS.filter((p) => p.group === group.id);
      const sliders = params.map((p) => `
        <div class="wp-slider">
          <label for="wp-param-${p.id}">${esc(p.label)}</label>
          <input type="range" id="wp-param-${p.id}" data-wp-param="${p.id}" min="-100" max="100" step="1" value="0">
          <output id="wp-param-${p.id}-label">0</output>
        </div>`).join('');
      return `<div class="wp-grade-group"><h4>${esc(group.label)}</h4>${sliders}</div>`;
    }).join('');
  }
  const presetsBox = doc.getElementById('wallpaper-grading-presets');
  if (presetsBox) {
    presetsBox.innerHTML = GRADING_PRESETS.map((p) => `
      <button type="button" class="wp-grading-preset" data-wp-grading-preset="${esc(p.id)}" title="${esc(p.note)}">
        <span class="wp-grading-preset-name">${esc(p.label)}</span>
        <span class="wp-grading-preset-note">${esc(p.note)}</span>
      </button>`).join('');
  }
  bindWallpaperDrag(doc);
  bindWallpaperEditorDrag(doc);
}

// 主编辑画布拖拽：在大画布上拖动，移动全局焦点，四端缩略图联动。
function bindWallpaperEditorDrag(doc) {
  const view = wallpaperView(doc);
  if (!view || typeof view.addEventListener !== 'function') return;
  const canvas = doc.getElementById('wp-canvas-editor');
  if (!canvas) return;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    updateWallpaperEditorFocus(doc, dx, dy);
  });
  const end = () => {
    dragging = false;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function updateWallpaperEditorFocus(doc, dx, dy) {
  const mounted = mounts.get(doc);
  const source = mounted && mounted.wallpaperSource;
  if (!mounted || !source) return;
  const crop = cropForFocus(source.sw, source.sh, WALLPAPER_EDITOR_RATIO, mounted.wallpaperFocus.fx, mounted.wallpaperFocus.fy);
  const rect = containRect(source.sw, source.sh, WALLPAPER_EDITOR_W, WALLPAPER_EDITOR_H);
  const { dfx, dfy } = focusDeltaFromEditorDrag(dx, dy, rect.w, rect.h, crop, source.sw, source.sh);
  mounted.wallpaperFocus.fx = Math.max(0, Math.min(1, mounted.wallpaperFocus.fx + dfx));
  mounted.wallpaperFocus.fy = Math.max(0, Math.min(1, mounted.wallpaperFocus.fy + dfy));
  mounted.wallpaperDirty = true;
}

// 四端联动拖拽：在任意一个预览框内拖动，更新全局焦点，四端一起重定位。
function bindWallpaperDrag(doc) {
  const view = wallpaperView(doc);
  if (!view || typeof view.addEventListener !== 'function') return;
  for (const platform of WALLPAPER_PLATFORMS) {
    const canvas = doc.getElementById(`wp-canvas-${platform.id}`);
    if (!canvas) continue;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.classList.add('dragging');
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      updateWallpaperFocus(doc, platform, dx, dy);
    });
    const end = () => {
      dragging = false;
      canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
}

// 每平台独立焦点的初始值（「连接关系」关闭时各自独立拖拽）。
function platformFocusDefaults() {
  return Object.fromEntries(WALLPAPER_PLATFORMS.map((p) => [p.id, { ...WALLPAPER_FOCUS_DEFAULT }]));
}

function resetWallpaperFocus(mounted) {
  mounted.wallpaperFocus = { ...WALLPAPER_FOCUS_DEFAULT };
  mounted.wallpaperPlatformFocus = platformFocusDefaults();
}

// 当前平台实际使用的焦点：连接开启时用全局焦点（四端联动），关闭时用各自独立焦点。
function platformFocus(mounted, platform) {
  if (mounted.wallpaperLinked) return mounted.wallpaperFocus;
  return mounted.wallpaperPlatformFocus[platform.id] || (mounted.wallpaperPlatformFocus[platform.id] = { ...WALLPAPER_FOCUS_DEFAULT });
}

function updateWallpaperFocus(doc, platform, dx, dy) {
  const mounted = mounts.get(doc);
  const source = mounted && mounted.wallpaperSource;
  if (!mounted || !source) return;
  const focus = platformFocus(mounted, platform);
  const crop = cropForFocus(source.sw, source.sh, platform.ratio, focus.fx, focus.fy);
  const rect = { w: wallpaperPreviewSize(platform).w, h: wallpaperPreviewSize(platform).h };
  const { dfx, dfy } = focusDeltaFromDrag(dx, dy, rect.w, rect.h, crop, source.sw, source.sh);
  focus.fx = Math.max(0, Math.min(1, focus.fx + dfx));
  focus.fy = Math.max(0, Math.min(1, focus.fy + dfy));
  mounted.wallpaperDirty = true;
}

// 整段循环的实际长度：底图是视频时跟着视频走，否则用粒子时长。
// 视频与粒子的周期必须一致，否则两套循环互相错拍，叠出来的整段就不再无缝。
function wallpaperLoop(mounted) {
  return loopDurationFor(mounted && mounted.wallpaperSource, mounted ? mounted.wallpaperDuration : WALLPAPER_DEFAULT_DURATION);
}

// 视频源：把当前时间同步到循环 t，返回待绘制的视频元素。
function syncVideoSource(mounted, t) {
  const source = mounted.wallpaperSource;
  if (!source || source.kind !== 'video') return null;
  const video = source.el;
  const dur = video.duration;
  if (dur && Number.isFinite(dur)) {
    const target = t % dur;
    if (Math.abs(video.currentTime - target) > 0.08) video.currentTime = target;
  }
  return video;
}

// 构建「裁剪 + 调色」后的底图。图片源缓存；视频源每帧重建。
function getWallpaperBase(mounted, platform, crop, w, h, t) {
  const source = mounted.wallpaperSource;
  if (!source) return null;
  if (source.kind === 'image') {
    if (mounted.wallpaperDirty || !mounted.wallpaperBases.has(platform.id)) {
      const base = renderGradedCanvas(source.el, crop, mounted.wallpaperParams, w, h);
      mounted.wallpaperBases.set(platform.id, base);
    }
    return mounted.wallpaperBases.get(platform.id);
  }
  // 视频：当前帧 → 裁剪 → 调色（预览分辨率，逐帧）
  const video = syncVideoSource(mounted, t);
  if (!video || !video.videoWidth) return null;
  return renderGradedCanvas(video, crop, mounted.wallpaperParams, w, h);
}

function drawWallpaperPreview(doc, mounted, platform, ctx, w, h, t) {
  ctx.clearRect(0, 0, w, h);
  const source = mounted.wallpaperSource;
  if (!source) {
    ctx.fillStyle = '#9aa0ae';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('拖入图片或视频', w / 2, h / 2);
    return;
  }
  const focus = platformFocus(mounted, platform);
  const crop = cropForFocus(source.sw, source.sh, platform.ratio, focus.fx, focus.fy);
  const base = getWallpaperBase(mounted, platform, crop, w, h, t);
  if (base) ctx.drawImage(base, 0, 0, w, h);
}

// 主编辑画布：contain 显示完整图，叠加暗角遮罩 + 焦点裁剪框（PC 比例参考）。
function drawWallpaperEditor(mounted, ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const source = mounted.wallpaperSource;
  if (!source) {
    ctx.fillStyle = '#9aa0ae';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('拖入图片或视频后在此拖动调整焦点', w / 2, h / 2);
    return;
  }
  const el = source.el;
  const rect = containRect(source.sw, source.sh, w, h);
  ctx.drawImage(el, rect.x, rect.y, rect.w, rect.h);

  // 焦点裁剪框（参考 PC 16:9），映射到画布坐标。
  const crop = cropForFocus(source.sw, source.sh, WALLPAPER_EDITOR_RATIO, mounted.wallpaperFocus.fx, mounted.wallpaperFocus.fy);
  const bx = rect.x + (crop.sx / source.sw) * rect.w;
  const by = rect.y + (crop.sy / source.sh) * rect.h;
  const bw = (crop.sw / source.sw) * rect.w;
  const bh = (crop.sh / source.sh) * rect.h;

  // 四周暗角遮罩，突出选中区域。
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, w, by);
  ctx.fillRect(0, by, bx, bh);
  ctx.fillRect(bx + bw, by, w - bx - bw, bh);
  ctx.fillRect(0, by + bh, w, h - by - bh);

  // 选中框描边 + 四角把手。
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  const corner = 14;
  ctx.lineWidth = 3;
  const corners = [
    [bx, by, 1, 1], [bx + bw, by, -1, 1],
    [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * corner, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * corner);
    ctx.stroke();
  }
}

function wallpaperFrame(doc) {
  const mounted = mounts.get(doc);
  const view = wallpaperView(doc);
  if (!mounted || !view) return;
  if (mounted.activeRoute !== 'wallpaper') return;
  const t = (view.performance ? view.performance.now() / 1000 : Date.now() / 1000) % wallpaperLoop(mounted);
  for (const platform of WALLPAPER_PLATFORMS) {
    const canvas = doc.getElementById(`wp-canvas-${platform.id}`);
    if (!canvas) continue;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) continue;
    drawWallpaperPreview(doc, mounted, platform, ctx, canvas.width, canvas.height, t);
  }
  const editorCanvas = doc.getElementById('wp-canvas-editor');
  if (editorCanvas) {
    const editorCtx = editorCanvas.getContext && editorCanvas.getContext('2d');
    if (editorCtx) drawWallpaperEditor(mounted, editorCtx, editorCanvas.width, editorCanvas.height);
  }
  mounted.wallpaperDirty = false;
  mounted.wallpaperRaf = view.requestAnimationFrame
    ? view.requestAnimationFrame(() => wallpaperFrame(doc))
    : 0;
}

function startWallpaper(doc) {
  const mounted = mounts.get(doc);
  const view = wallpaperView(doc);
  if (!mounted || !view) return;
  stopWallpaper(doc);
  sizeWallpaperCanvases(doc);
  mounted.wallpaperDirty = true;
  paintWallpaperFlow(doc);
  if (view.requestAnimationFrame) mounted.wallpaperRaf = view.requestAnimationFrame(() => wallpaperFrame(doc));
}

function stopWallpaper(doc) {
  const mounted = mounts.get(doc);
  const view = wallpaperView(doc);
  if (mounted && mounted.wallpaperRaf && view && view.cancelAnimationFrame) {
    view.cancelAnimationFrame(mounted.wallpaperRaf);
  }
  if (mounted) mounted.wallpaperRaf = 0;
}

function releaseWallpaperSource(mounted) {
  const source = mounted && mounted.wallpaperSource;
  if (source && source.url) {
    try { URL.revokeObjectURL(source.url); } catch { /* 忽略 */ }
  }
  if (mounted) {
    mounted.wallpaperSource = null;
    mounted.wallpaperSourceId = null; // 源变了，已上传的母版缓存作废
  }
}

// 建立画布底图。图片是静态底图，视频是逐帧底图——超分后的 4K 母版就是从这里进来的。
// 视频一定要 play()：如果只靠 currentTime 逐帧 seek，4K 上每帧一次定位会把预览拖垮。
function attachWallpaperSource(doc, kind, url, name = '') {
  const mounted = mounts.get(doc);
  if (!mounted || !url) return;
  releaseWallpaperSource(mounted);
  mounted.wallpaperBases.clear();
  mounted.wallpaperSourceName = name;
  if (kind === 'video') {
    const video = doc.createElement('video');
    video.src = url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      mounted.wallpaperSource = { kind: 'video', el: video, sw: video.videoWidth || 1, sh: video.videoHeight || 1, url };
      resetWallpaperFocus(mounted);
      mounted.wallpaperDirty = true;
      mounted.wallpaperBases.clear();
      try {
        const played = video.play();
        if (played && played.catch) played.catch(() => {});
      } catch { /* jsdom 等环境没有 play */ }
      paintWallpaperFlow(doc);
    };
    return;
  }
  const img = new Image();
  img.onload = () => {
    mounted.wallpaperSource = { kind: 'image', el: img, sw: img.naturalWidth || 1, sh: img.naturalHeight || 1, url };
    resetWallpaperFocus(mounted);
    mounted.wallpaperDirty = true;
    mounted.wallpaperBases.clear();
    paintWallpaperFlow(doc);
  };
  img.src = url;
}

// 上传入口已并入 onWallpaper2Files（一个口吃 1~N 张图片或 1 段视频）。

// ---------------- 录制与导出 ----------------
// 60FPS 录制 + 高码率中间件：录制这一段只做「裁剪 + 叠粒子」（都是 GPU 的 drawImage
// 和几十个 arc），所以能真的跑满 60 帧；调色交给最后那道 ffmpeg，不在循环里做。
const WALLPAPER_RECORD_FPS = 60;
// 录制码率随画布像素数走：1080P 给 26M 够用，4K（8M 像素以上）给 60M，
// 否则中间码率压得太狠，后面那道 ffmpeg 只能把瑕疵一起放大。
function wallpaperRecordBitrate(width, height) {
  return (width * height) >= 6_000_000 ? 60_000_000 : 26_000_000;
}
const WALLPAPER_EXPORT_CRF = 16;

// 导出播放时把视频时钟对齐到循环时间轴。阈值放宽到 0.25 秒：
// 判定得太严会变成每帧一次 4K seek，反而把录制拖到掉帧。
function syncExportVideo(video, t, loop) {
  if (!video || typeof video.currentTime !== 'number') return;
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : loop;
  if (!(duration > 0)) return;
  const target = ((t % duration) + duration) % duration;
  if (Math.abs(video.currentTime - target) > 0.25) {
    try { video.currentTime = target; } catch { /* 忽略 */ }
  }
}

// 组装某一端的录制器：画布、裁剪、粒子与逐帧 draw 函数。
// sourceOverride 用于导出：预览吃 720P 母版，导出吃 4K 母版，两者构图一致但尺寸不同，
// 所以裁剪框按比例换算过去（normalizeCrop → scaleCrop）。
function buildWallpaperRecorder(doc, platform, sourceOverride) {
  const mounted = mounts.get(doc);
  const preview = mounted && mounted.wallpaperSource;
  const source = sourceOverride || preview;
  if (!mounted || !source) {
    throw new Error('请先准备底图（立绘或视频）');
  }
  const canvas = doc.createElement('canvas');
  canvas.width = platform.exportWidth;
  canvas.height = platform.exportHeight;
  const ctx = canvas.getContext('2d');
  const focus = platformFocus(mounted, platform);
  const norm = normalizeCrop(
    cropForFocus(preview.sw, preview.sh, platform.ratio, focus.fx, focus.fy),
    preview.sw,
    preview.sh,
  );
  const crop = scaleCrop(norm, source.sw || 1, source.sh || 1);
  const loop = loopDurationFor(source, mounted.wallpaperDuration);

  // 图片源：裁剪结果固定，先画一次复用；视频源：每帧从母版裁一次（GPU 缩放，便宜）。
  let staticBase = null;
  if (source.kind === 'image') {
    staticBase = doc.createElement('canvas');
    staticBase.width = canvas.width;
    staticBase.height = canvas.height;
    staticBase.getContext('2d').drawImage(
      source.el, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height,
    );
  }
  // 结尾黑帧兜底：记下「上一次成功画出的纯底图」，回绕/拿不到帧时复用它，画布永不露黑。
  // 回绕检测只在逐帧编码主路径（seek:false）启用：seek 路径里 currentTime 会被人为跳变，误判会锁死画面。
  let lastBase = null;
  let prevVideoTime = -1;

  const draw = (t, { seek = true } = {}) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (source.kind === 'image') {
      ctx.drawImage(staticBase, 0, 0);
    } else {
      const video = source.el;
      // 逐帧编码那条路自己驱动播放，绝不能在这里 seek：4K 视频每帧 seek 会直接卡成幻灯片。
      if (seek) syncExportVideo(video, t, loop);
      const now = Number(video.currentTime) || 0;
      // currentTime 相对上一帧大幅回退 = loop 刚回绕到 0，此刻解码器拿不到结尾帧。
      const rewound = !seek && prevVideoTime >= 0 && now < prevVideoTime - loop * 0.5;
      prevVideoTime = now;
      if (!rewound && video.readyState >= 2 && video.videoWidth) {
        ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
        // 只缓存纯底图，下次回绕时复用。
        if (!lastBase) lastBase = doc.createElement('canvas');
        lastBase.width = canvas.width;
        lastBase.height = canvas.height;
        lastBase.getContext('2d').drawImage(canvas, 0, 0);
      } else if (lastBase) {
        ctx.drawImage(lastBase, 0, 0);
      }
    }
  };

  // video 只给 recordCanvasH264 用：它按视频真实播放进度推帧号；MediaRecorder 兜底时不用。
  return { canvas, draw, duration: loop, video: source.kind === 'video' ? source.el : null };
}

// 等视频能画出第一帧。导出前必须等到 readyState>=2，否则录到的是一段黑场。
function waitForVideoSource(doc, video, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const view = (doc && doc.defaultView) || {};
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (timer && view.clearTimeout) view.clearTimeout(timer);
      if (ok) resolve();
      else reject(new Error('视频加载失败，无法导出'));
    };
    const timer = view.setTimeout ? view.setTimeout(() => finish(false), timeoutMs) : 0;
    if (video.readyState >= 2 && video.videoWidth) {
      finish(true);
      return;
    }
    // 必须等到 readyState>=2（有可绘制的帧），只等 metadata 会录进一段黑场。
    video.oncanplay = () => finish(true);
    video.onloadeddata = () => finish(true);
    video.onerror = () => finish(false);
  });
}

// 有母版时临时挂一个 4K 视频元素给导出用；没有母版（直接上传的图片/视频）就用预览源。
async function withExportSource(doc, run) {
  const mounted = mounts.get(doc);
  const master = mounted && mounted.wallpaperMaster;
  if (!master || !master.url) {
    return await run(null);
  }
  const video = doc.createElement('video');
  video.src = master.url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  await waitForVideoSource(doc, video);
  try {
    const played = video.play();
    if (played && played.catch) played.catch(() => {});
  } catch { /* 忽略 */ }
  try {
    return await run({
      kind: 'video',
      el: video,
      sw: video.videoWidth || 1,
      sh: video.videoHeight || 1,
      url: '',
    });
  } finally {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch { /* 忽略 */ }
  }
}

// 只录制：底图裁剪 + 粒子叠层，60FPS。不做调色、不做超分。
// 首选 WebCodecs 逐帧编码（帧号即时间戳，严格 CFR）；只有浏览器不支持时才退回 MediaRecorder。
async function recordWallpaperVideo(doc, platform, signal) {
  return await withExportSource(doc, async (source) => {
    const { canvas, draw, duration, video } = buildWallpaperRecorder(doc, platform, source);
    let recorded = null;
    try {
      recorded = await recordCanvasH264({
        canvas,
        // 逐帧编码自己驱动播放进度，这里必须关掉 seek 对齐，否则 4K 每帧 seek 会直接卡住。
        draw: (t) => draw(t, { seek: false }),
        duration,
        fps: WALLPAPER_RECORD_FPS,
        bitrate: wallpaperRecordBitrate(canvas.width, canvas.height),
        signal,
        video,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      // 编码器异常（老显卡不支持 High profile 等）不该让整段导出报废，往下走兜底。
      recorded = null;
    }
    if (recorded) {
      const mounted = mounts.get(doc);
      if (mounted) {
        mounted.wallpaperLastExport = {
          frames: recorded.frames,
          fps: recorded.fps,
          unique: recorded.unique,
        };
      }
      return recorded;
    }
    setWallpaperStatus(doc, '浏览器逐帧编码不可用，退回实时录制（帧率可能不足 60）…');
    const blob = await recordLoopVideo({
      canvas,
      // 兜底路径没有播放进度可跟，只能按墙钟时间 seek 对齐。
      draw: (t) => draw(t, { seek: true }),
      duration,
      fps: WALLPAPER_RECORD_FPS,
      bitrate: wallpaperRecordBitrate(canvas.width, canvas.height),
      signal,
    });
    return { blob, fps: WALLPAPER_RECORD_FPS, frames: 0, format: 'webm' };
  });
}

// 收尾：调色（LUT + 4 个空间参数）与 h264 一次 ffmpeg 做完，然后自动下载。
async function finishWallpaperVideo(doc, recorded, platform, signal) {
  const mounted = mounts.get(doc);
  const { lut, grade } = gradeForExport(mounted ? mounted.wallpaperParams : {});
  const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
  const mp4 = await transcodeToMp4(recorded.blob, {
    fetchImpl,
    signal,
    lut,
    grade,
    crf: WALLPAPER_EXPORT_CRF,
    fps: (recorded && recorded.fps) || WALLPAPER_RECORD_FPS,
    inputFormat: (recorded && recorded.format) || 'webm',
  });
  saveFile(doc, `wallpaper-${platform.id}-60fps.mp4`, URL.createObjectURL(mp4));
  return mp4;
}

// 上传母版一次（缓存 sourceId），之后单端/四端导出都复用同一份落盘母版。
async function ensureWallpaperSource(doc, signal) {
  const mounted = mounts.get(doc);
  if (!mounted) throw new Error('缺少上下文');
  if (mounted.wallpaperSourceId) return mounted.wallpaperSourceId;
  const master = mounted.wallpaperMaster;
  const source = mounted.wallpaperSource;
  let kind;
  let dataUrl;
  if (master && master.blob) {
    kind = 'video';
    dataUrl = await blobToDataUrl(master.blob);
  } else if (source && source.kind === 'image') {
    kind = 'image';
    dataUrl = source.url; // 立绘上传时已 flatten 成 dataUrl
  } else {
    throw new Error('请先准备底图（立绘或视频）');
  }
  const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
  setWallpaperStatus(doc, '正在上传母版到本机服务（仅一次）…');
  const response = await fetchImpl('/api/wallpaper/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoDataUrl: dataUrl, kind }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `母版上传失败 (${response.status})`);
  }
  const data = await response.json();
  mounted.wallpaperSourceId = data.sourceId;
  return data.sourceId;
}

// 组装单端导出参数：归一化裁剪框 + 16 调色参数（LUT/空间）+ 粒子配置。
function buildWallpaperPayload(doc, platform, sourceId) {
  const mounted = mounts.get(doc);
  const source = mounted.wallpaperSource;
  const focus = platformFocus(mounted, platform);
  const norm = normalizeCrop(
    cropForFocus(source.sw, source.sh, platform.ratio, focus.fx, focus.fy),
    source.sw,
    source.sh,
  );
  const loop = loopDurationFor(source, mounted.wallpaperDuration);
  const { lut, grade } = gradeForExport(mounted.wallpaperParams || {});
  return {
    sourceId,
    sourceW: source.sw,
    sourceH: source.sh,
    platform: platform.id,
    outW: platform.exportWidth,
    outH: platform.exportHeight,
    crop: norm,
    fps: WALLPAPER_RECORD_FPS,
    duration: loop,
    lut,
    grade,
  };
}

async function exportPlatformVideo(doc, platform, signal) {
  const sourceId = await ensureWallpaperSource(doc, signal);
  const payload = buildWallpaperPayload(doc, platform, sourceId);
  const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
  setWallpaperProgress(doc, -1, `${platform.label} 渲染中`);
  setWallpaperStatus(doc, `正在渲染 ${platform.label}（后端：裁剪 + 粒子 + 调色）…`);
  const response = await fetchImpl('/api/wallpaper/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `导出失败 (${response.status})`);
  }
  const blob = await response.blob();
  saveFile(doc, `wallpaper-${platform.id}-60fps.mp4`, URL.createObjectURL(blob));
  return blob;
}

function updateWallpaperStatus(doc) {
  const mounted = mounts.get(doc);
  const el = doc.getElementById('wallpaper-status');
  if (el) el.textContent = mounted ? mounted.wallpaperStatus : '';
}

function setWallpaperStatus(doc, text) {
  const mounted = mounts.get(doc);
  if (mounted) mounted.wallpaperStatus = text;
  updateWallpaperStatus(doc);
}

// 壁纸导出进度条：null 隐藏；-1 显示不确定态（单端同步导出）；0~100 显示确定进度（四端）。
function setWallpaperProgress(doc, pct, label) {
  const box = doc.getElementById('wallpaper-progress');
  const bar = doc.getElementById('wallpaper-progress-bar');
  const text = doc.getElementById('wallpaper-progress-label');
  if (!box || !bar) return;
  if (pct == null) {
    box.hidden = true;
    bar.classList.remove('indeterminate');
    bar.style.width = '0%';
    return;
  }
  box.hidden = false;
  if (pct < 0) {
    bar.classList.add('indeterminate');
    bar.style.width = '100%';
  } else {
    bar.classList.remove('indeterminate');
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
  if (text) text.textContent = label != null ? label : `${Math.round(pct)}%`;
}

// 开始一段可取消的导出：建立 AbortController、切换按钮状态，跑完后统一收尾。
async function runWallpaperExport(doc, run) {
  const mounted = mounts.get(doc);
  if (!mounted || mounted.wallpaperExporting) return;
  if (!mounted.wallpaperSource) {
    showToast(doc, '请先准备底图（立绘或视频）');
    return;
  }
  mounted.wallpaperExporting = true;
  mounted.wallpaperAbort = new AbortController();
  syncWallpaperExportButtons(doc, true);
  // 导出期间停掉预览：5 块画布 60FPS 的粒子重绘和录制抢的是同一条主线程，
  // 抢输的代价就是掉帧（成片里出现重复帧）。
  const previewVideo = mounted.wallpaperSource && mounted.wallpaperSource.kind === 'video'
    ? mounted.wallpaperSource.el
    : null;
  const wasPlaying = Boolean(previewVideo && !previewVideo.paused);
  stopWallpaper(doc);
  if (wasPlaying) {
    try { previewVideo.pause(); } catch { /* 忽略 */ }
  }
  try {
    await run(mounted.wallpaperAbort.signal);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      setWallpaperStatus(doc, '已取消导出');
    } else {
      setWallpaperStatus(doc, '');
      showToast(doc, error && error.message ? error.message : '导出失败');
    }
  } finally {
    mounted.wallpaperExporting = false;
    mounted.wallpaperAbort = null;
    setWallpaperProgress(doc, null);
    if (wasPlaying) {
      try {
        const played = previewVideo.play();
        if (played && played.catch) played.catch(() => {});
      } catch { /* 忽略 */ }
    }
    if (mounted.activeRoute === 'wallpaper') startWallpaper(doc);
    syncWallpaperExportButtons(doc, false);
    paintWallpaperFlow(doc);
  }
}

// 单端导出：提交一个池 B 任务，服务端渲染完落盘，任务队列页轮询到完成后自动下载。
async function exportOneWallpaper(doc, platform) {
  await submitWallpaperExportTask(doc, [platform]);
}

// 四端导出：同样走池 B，服务端并行渲染 4 端并额外打包 zip，完成后自动下载 zip。
async function exportAllWallpapers(doc) {
  await submitWallpaperExportTask(doc, WALLPAPER_PLATFORMS);
}

function taskFetch(doc) {
  return (doc.defaultView && doc.defaultView.fetch) || fetch;
}

// 组装并提交导出任务：母版只上传/内联一次（sourceDataUrl），四端共用。
async function submitWallpaperExportTask(doc, platforms) {
  const mounted = mounts.get(doc);
  if (!mounted || mounted.wallpaperSubmitting) return;
  const source = mounted.wallpaperSource;
  if (!source) {
    showToast(doc, '请先准备底图（立绘或视频）');
    return;
  }
  const master = mounted.wallpaperMaster;
  let sourceDataUrl = '';
  try {
    if (master && master.blob) sourceDataUrl = await blobToDataUrl(master.blob);
    else if (source.kind === 'image') sourceDataUrl = source.url;
    if (!sourceDataUrl || !sourceDataUrl.startsWith('data:')) throw new Error('母版读取失败');
  } catch (error) {
    showToast(doc, error && error.message ? error.message : '母版读取失败');
    return;
  }
  const sourceKind = master && master.blob ? 'video' : 'image';
  const payloads = platforms.map((platform) => {
    const body = buildWallpaperPayload(doc, platform, null);
    delete body.sourceId;
    return body;
  });
  const steps = platforms.map((platform) => ({
    kind: 'wallpaper-export',
    title: `导出 ${platform.label}`,
    platform: platform.id,
  }));
  const title = platforms.length > 1
    ? '动态壁纸 · 四端导出'
    : `动态壁纸 · ${platforms[0].label} 导出`;
  mounted.wallpaperSubmitting = true;
  setWallpaperStatus(doc, '正在提交导出任务到壁纸处理队列…');
  paintWallpaperFlow(doc);
  try {
    await submitTask({
      kind: 'wallpaper-export',
      pool: POOL_WALLPAPER,
      title,
      unit: '端',
      total: platforms.length,
      steps,
      platforms: payloads,
      sourceDataUrl,
      sourceKind,
    }, { fetchImpl: taskFetch(doc) });
    resetWallpaperPage(doc);
    reloadWallpaperPage(doc);
  } catch (error) {
    mounted.wallpaperSubmitting = false;
    setWallpaperStatus(doc, '');
    paintWallpaperFlow(doc);
    showToast(doc, error && error.message ? error.message : '提交导出失败');
  }
}

async function pollWallpaperExport(doc, taskId, signal) {
  const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
  const view = doc.defaultView;
  const sleep = (ms) => new Promise((resolve) => {
    const timer = view && view.setTimeout ? view.setTimeout : setTimeout;
    timer(resolve, ms);
  });
  for (;;) {
    if (signal && signal.aborted) throw abortExportError();
    const res = await fetchImpl(`/api/wallpaper/export-all/status?taskId=${encodeURIComponent(taskId)}`, {
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error('查询导出进度失败');
    const data = await res.json();
    if (data.status === 'done') return;
    if (data.status === 'error') throw new Error(data.error || '导出失败');
    if (data.status === 'cancelled') throw abortExportError();
    const pct = Math.round(data.progress || 0);
    setWallpaperStatus(doc, `正在并行渲染四端（后端）… ${pct}%`);
    setWallpaperProgress(doc, pct, `四端渲染 ${pct}%`);
    await sleep(500);
  }
}

function abortExportError() {
  const error = new Error('已取消导出');
  error.name = 'AbortError';
  return error;
}

function cancelWallpaperExport(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  if (mounted.wallpaperAbort) mounted.wallpaperAbort.abort();
  // 四端导出是后端后台任务：主动通知后端终止 ffmpeg 进程树，别让它在后台白跑。
  if (mounted.wallpaperExportTaskId) {
    const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
    void fetchImpl(`/api/wallpaper/export-all/cancel?taskId=${encodeURIComponent(mounted.wallpaperExportTaskId)}`, {
      method: 'POST',
    }).catch(() => {});
    mounted.wallpaperExportTaskId = null;
  }
  setWallpaperStatus(doc, '正在取消导出…');
}

function syncWallpaperExportButtons(doc, exporting) {
  const mounted = mounts.get(doc);
  const hasSource = Boolean(mounted && mounted.wallpaperSource);
  for (const button of doc.querySelectorAll('#page-wallpaper .wp-export, #wallpaper-export-all')) {
    button.disabled = exporting || !hasSource;
  }
  const cancel = doc.getElementById('wallpaper-cancel');
  if (cancel) cancel.hidden = !exporting;
}

// ---------------- ① 生成待机循环 / ② 重处理母版 ----------------

// 模型原片：只留一版（6 秒视频按次计费，并出两版等于双倍成本）。
function releaseWallpaper2Raw(mounted) {
  const raw = mounted && mounted.wallpaper2Raw;
  if (raw && raw.url) {
    try { URL.revokeObjectURL(raw.url); } catch { /* 忽略 */ }
  }
  if (mounted) mounted.wallpaper2Raw = null;
}

// 4K/60 母版：两个 objectURL（预览元素 + 画布底图）各自释放。
function releaseWallpaperMaster(mounted) {
  const master = mounted && mounted.wallpaperMaster;
  if (master) {
    for (const key of ['url', 'previewUrl']) {
      if (master[key]) {
        try { URL.revokeObjectURL(master[key]); } catch { /* 忽略 */ }
      }
    }
  }
  if (mounted) {
    mounted.wallpaperMaster = null;
    mounted.wallpaperSourceId = null; // 母版换了，已上传的缓存作废
  }
}

// 万相不接受带透明通道的图（PNG 透明会被拒），也会卡 20MB 上限。
// 上传后统一铺白底、缩到长边 2048 再重编码成 JPEG，既避开透明通道也压小 base64 体积。
function flattenWallpaper2Image(doc, dataUrl) {
  return new Promise((resolve) => {
    const view = doc.defaultView;
    if (!view || typeof view.Image !== 'function') {
      resolve(dataUrl);
      return;
    }
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value || dataUrl);
    };
    // 某些环境（jsdom 等）Image 不会触发 load/error，兜底回退原图，别把流程卡死。
    const timer = view.setTimeout ? view.setTimeout(() => done(dataUrl), 6000) : 0;
    const img = new view.Image();
    img.onload = () => {
      if (timer && view.clearTimeout) view.clearTimeout(timer);
      try {
        const sw = img.naturalWidth || img.width || 0;
        const sh = img.naturalHeight || img.height || 0;
        if (!sw || !sh) {
          done(dataUrl);
          return;
        }
        const long = Math.max(sw, sh);
        const scale = long > 2048 ? 2048 / long : 1;
        const w = Math.max(1, Math.round(sw * scale));
        const h = Math.max(1, Math.round(sh * scale));
        const canvas = doc.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          done(dataUrl);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        done(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        done(dataUrl);
      }
    };
    img.onerror = () => {
      if (timer && view.clearTimeout) view.clearTimeout(timer);
      done(dataUrl);
    };
    img.src = dataUrl;
  });
}

// 统一的壁纸上传口：1~N 张立绘排队走完整流水线，或 1 段视频直接当母版。
// 立绘进池 B 的任务队列，提交后本页刷新；视频没有可排队的处理，直接挂上画布。
function isVideoFile(file) {
  if (!file) return false;
  if (file.type) return file.type.startsWith('video/');
  return /\.(mp4|webm|mov|m4v)$/i.test(file.name || '');
}

function readFileDataUrl(doc, file) {
  return new Promise((resolve, reject) => {
    const reader = new doc.defaultView.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = comma >= 0 ? dataUrl.slice(0, comma) : 'data:video/mp4';
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : '';
  const mime = (meta.match(/^data:([^;]+)/) || [])[1] || 'video/mp4';
  if (!/;base64/i.test(meta)) {
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function onWallpaper2Files(doc, files) {
  const mounted = mounts.get(doc);
  const list = Array.from(files || []);
  if (!mounted || !list.length) return;
  const videos = list.filter(isVideoFile);
  const images = list.filter((file) => !isVideoFile(file));
  // 视频与图片不能混传：视频直接当母版，图片要走生成+重处理，语义冲突。
  if (videos.length && (images.length || videos.length > 1)) {
    showToast(doc, '视频一次只能传 1 段，请单独上传');
    return;
  }

  if (videos.length) {
    const file = videos[0];
    let dataUrl;
    try {
      dataUrl = await readFileDataUrl(doc, file);
    } catch {
      showToast(doc, '视频读取失败，换一段试试');
      return;
    }
    if (!dataUrl.startsWith('data:video/')) {
      showToast(doc, '视频读取失败，换一段试试');
      return;
    }
    releaseWallpaper2Raw(mounted);
    releaseWallpaperMaster(mounted);
    const blob = dataUrlToBlob(dataUrl);
    mounted.wallpaperQueue = [];
    mounted.wallpaper2Video = { name: file.name || '上传视频', dataUrl };
    mounted.wallpaper2Source = null;
    mounted.wallpaper2Name = file.name || '上传视频';
    mounted.wallpaperMaster = {
      blob,
      url: URL.createObjectURL(blob),
      previewUrl: URL.createObjectURL(blob),
      label: `${mounted.wallpaper2Name} · 直接上传`,
    };
    mounted.wallpaper2MasterStatus = '直接上传，未重处理';
    mounted.wallpaper2Status = `已上传视频：${mounted.wallpaper2Name}，可直接在 ③ 剪辑导出`;
    // 视频已经是母版，画布直接吃它。
    attachWallpaperSource(doc, 'video', URL.createObjectURL(blob), mounted.wallpaper2Name);
    paintWallpaperFlow(doc);
    return;
  }

  const queue = [];
  for (const file of images) {
    let raw;
    try {
      raw = await readFileDataUrl(doc, file);
    } catch {
      continue;
    }
    if (!raw.startsWith('data:image/')) continue;
    const dataUrl = await flattenWallpaper2Image(doc, raw);
    queue.push({ name: file.name || `立绘 ${queue.length + 1}`, dataUrl });
  }
  if (!queue.length) {
    showToast(doc, '图片读取失败，换几张试试');
    return;
  }
  mounted.wallpaper2Video = null;
  mounted.wallpaperQueue = queue;
  releaseWallpaper2Raw(mounted);
  releaseWallpaperMaster(mounted);
  mounted.wallpaper2Source = queue[0].dataUrl;
  mounted.wallpaper2Name = queue[0].name;
  mounted.wallpaper2MasterStatus = '';
  mounted.wallpaper2Status = `已选择 ${queue.length} 张立绘，点「提交任务」排队处理`;
  // 只有一张时先挂成画布底图：静态壁纸也能直接裁 / 导出。
  if (queue.length === 1) attachWallpaperSource(doc, 'image', queue[0].dataUrl, queue[0].name);
  paintWallpaperFlow(doc);
}

// 把整条流水线的状态刷到静态 DOM：步骤门禁、缩略图、队列、母版、按钮可用性。
function paintWallpaperFlow(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const image = mounted.wallpaper2Source;
  const video = mounted.wallpaper2Video;
  const master = mounted.wallpaperMaster;
  const queue = mounted.wallpaperQueue || [];
  const clip = mounted.wallpaperSource;

  // ① 上传缩略图：单张图走预览，多张图走进度队列
  const sourceView = doc.getElementById('wallpaper2-source-view');
  const preview = doc.getElementById('wallpaper2-preview');
  const fileNote = doc.getElementById('wallpaper2-file-note');
  if (sourceView) sourceView.hidden = !image;
  if (preview) {
    if (image) {
      if (preview.getAttribute('src') !== image) preview.setAttribute('src', image);
    } else if (preview.hasAttribute('src')) {
      preview.removeAttribute('src');
    }
  }
  const queueBox = doc.getElementById('wallpaper2-queue');
  if (queueBox) {
    queueBox.hidden = queue.length < 2;
    if (queue.length >= 2 && queueBox.dataset.count !== String(queue.length)) {
      queueBox.dataset.count = String(queue.length);
      queueBox.innerHTML = queue.map((entry, index) => `
        <div class="wp2-batch-item">
          <img class="wp2-batch-thumb" src="${esc(entry.dataUrl)}" alt="${esc(entry.name)}">
          <p class="wp2-batch-name" title="${esc(entry.name)}">${esc(entry.name)}</p>
          <span class="wp2-batch-status">第 ${index + 1} / ${queue.length} 张</span>
        </div>`).join('');
    } else if (queue.length < 2) {
      queueBox.dataset.count = '';
      queueBox.innerHTML = '';
    }
  }
  if (fileNote) {
    if (video) {
      fileNote.textContent = `${video.name} · 直接作为母版，未重处理`;
    } else if (queue.length > 1) {
      fileNote.textContent = `已选择 ${queue.length} 张立绘，提交后各自跑完整条流水线并自动下载`;
    } else if (image) {
      fileNote.textContent = `${mounted.wallpaper2Name || '角色立绘'} · 重新选择会替换当前选择`;
    } else {
      fileNote.textContent = '';
    }
  }
  const zone = doc.querySelector('[data-upload-zone="wallpaper2-source"]');
  if (zone) zone.classList.toggle('has-file', Boolean(image || video || queue.length));

  // 模型 / 时长选中态
  const model = mounted.wallpaper2Model || WALLPAPER2_DEFAULT_MODEL;
  for (const button of doc.querySelectorAll('[data-wp2-model]')) {
    button.classList.toggle('on', button.dataset.wp2Model === model);
  }
  const duration = mounted.wallpaper2Duration || WALLPAPER2_DURATION;
  for (const button of doc.querySelectorAll('[data-wp2-duration]')) {
    button.classList.toggle('on', Number(button.dataset.wp2Duration) === duration);
  }

  // 状态文案
  const statusEl = doc.getElementById('wallpaper2-status');
  if (statusEl) statusEl.textContent = mounted.wallpaper2Status || '';
  const masterStatus = doc.getElementById('wallpaper2-process-status');
  if (masterStatus) masterStatus.textContent = mounted.wallpaper2MasterStatus || '';

  // 原片面板（已并入任务队列，本页不再展示原片；保留容器以兼容旧布局）
  const results = doc.getElementById('wallpaper2-results');
  const picksBox = doc.getElementById('wallpaper2-picks');
  if (results) results.hidden = true;
  if (picksBox && picksBox.dataset.raw) {
    picksBox.dataset.raw = '';
    picksBox.innerHTML = '';
  }

  // 母版预览
  const masterVideo = doc.getElementById('wallpaper-master-video');
  if (masterVideo) {
    const url = master && master.previewUrl ? master.previewUrl : '';
    if (url) {
      masterVideo.hidden = false;
      if (masterVideo.getAttribute('src') !== url) masterVideo.setAttribute('src', url);
    } else {
      masterVideo.hidden = true;
      if (masterVideo.hasAttribute('src')) masterVideo.removeAttribute('src');
    }
  }

  // 按钮门禁
  const busy = Boolean(mounted.wallpaperSubmitting || mounted.wallpaperExporting);
  const submit = doc.getElementById('wallpaper2-submit');
  if (submit) {
    const pending = queue.length > 0 && !video;
    submit.disabled = busy || !pending;
    submit.textContent = mounted.wallpaperSubmitting ? '提交中…' : '提交任务';
    submit.title = pending ? '' : (video ? '视频直接作母版，无需排队' : '请先上传立绘');
  }
  const process = doc.getElementById('wallpaper2-process');
  if (process) process.disabled = true;
  const processHint = doc.getElementById('wallpaper2-process');
  if (processHint) processHint.title = '重处理已并入任务队列，不再在本页执行';

  // 步骤徽标与就绪态
  const stepGenerate = doc.getElementById('wallpaper-step-generate');
  if (stepGenerate) {
    stepGenerate.textContent = video
      ? '视频直传'
      : queue.length > 1 ? `${queue.length} 张排队` : image ? '立绘已上传' : '待上传';
  }
  const stepMaster = doc.getElementById('wallpaper-step-master');
  if (stepMaster) {
    if (master && video) stepMaster.textContent = '直接上传，未重处理';
    else if (master) stepMaster.textContent = '母版就绪';
    else stepMaster.textContent = '等待母版';
  }
  const stepEdit = doc.getElementById('wallpaper-step-edit');
  if (stepEdit) stepEdit.textContent = clip ? '可以剪辑 / 导出' : '等待母版';
  const ready = { generate: true, master: Boolean(master), edit: Boolean(clip) };
  for (const step of doc.querySelectorAll('#page-wallpaper .wp-step')) {
    const name = step.dataset.wpStep;
    step.dataset.ready = ready[name] === false ? '0' : '1';
  }
  syncWallpaperExportButtons(doc, Boolean(mounted.wallpaperExporting || mounted.wallpaperSubmitting));
  syncWallpaperLinkToggle(doc);
}

// 「连接关系」开关的显示状态只从这里出：默认禁用，点击再切换，
// 避免 HTML 里的初始 class/文案和 mounted 状态各说一套。
function syncWallpaperLinkToggle(doc) {
  const mounted = mounts.get(doc);
  const button = doc.getElementById('wallpaper-link');
  if (!mounted || !button) return;
  const linked = Boolean(mounted.wallpaperLinked);
  button.dataset.wpLink = linked ? '1' : '0';
  button.classList.toggle('on', linked);
  button.textContent = linked ? '连接关系：已启用' : '连接关系：已禁用';
}

// 模型 / 时长按钮（静态构建一次）。
function bindWallpaperFlow(doc) {
  if (!doc.getElementById('page-wallpaper')) return;
  const box = doc.getElementById('wallpaper2-models');
  if (box) {
    box.innerHTML = WALLPAPER2_MODELS.map((m) => `
      <button type="button" class="wp-particle${m.id === WALLPAPER2_DEFAULT_MODEL ? ' on' : ''}" data-wp2-model="${m.id}">
        ${esc(m.label)}
      </button>`).join('');
  }
  const durations = doc.getElementById('wallpaper2-durations');
  if (durations) {
    durations.innerHTML = WALLPAPER2_DURATIONS.map((s) => `
      <button type="button" class="wp-particle${s === WALLPAPER2_DURATION ? ' on' : ''}" data-wp2-duration="${s}">
        ${s} 秒
      </button>`).join('');
  }
  paintWallpaperFlow(doc);
  paintWallpaperBatch(doc);
}

// 点「提交任务」：1~N 张立绘打包成池 B 任务，服务端逐张跑完
// 「万相原片 → 色彩锁定 → 补帧 60FPS → 4K 超分」并把成片落盘。
// 提交成功后本页立刻清空并刷新：进度与成片都在【任务队列】里看，页面不只留半成品。
async function generateWallpaper(doc) {
  const mounted = mounts.get(doc);
  if (!mounted || mounted.wallpaperSubmitting) return;
  if (mounted.wallpaper2Video) {
    showToast(doc, '视频已经是母版，无需提交处理任务');
    return;
  }
  const queue = (mounted.wallpaperQueue || []).slice();
  if (!queue.length && mounted.wallpaper2Source) {
    queue.push({ name: mounted.wallpaper2Name || '角色立绘', dataUrl: mounted.wallpaper2Source });
  }
  if (!queue.length) {
    showToast(doc, '请先上传角色立绘');
    return;
  }
  const model = mounted.wallpaper2Model || WALLPAPER2_DEFAULT_MODEL;
  const duration = mounted.wallpaper2Duration || WALLPAPER2_DURATION;
  const { prompt, negativePrompt } = buildWallpaper2Prompt(duration);
  const units = queue.map((entry) => ({
    kind: 'wallpaper-batch',
    title: entry.name,
    imageDataUrl: entry.dataUrl,
    model,
    duration,
    prompt,
    negativePrompt,
    resolution: WALLPAPER2_RESOLUTION,
    ratio: WALLPAPER2_RATIO,
    targetFps: 60,
    upscaleModel: 'animevideov3',
    upscaleScale: WALLPAPER2_UPSCALE_SCALE,
  }));
  mounted.wallpaperSubmitting = true;
  mounted.wallpaper2Status = '正在提交到壁纸处理队列…';
  paintWallpaperFlow(doc);
  try {
    await submitTask({
      kind: 'wallpaper-batch',
      pool: POOL_WALLPAPER,
      title: units.length > 1 ? `动态壁纸批处理 · ${units.length} 张` : `动态壁纸 · ${units[0].title}`,
      unit: '张',
      total: units.length,
      steps: units,
    }, { fetchImpl: taskFetch(doc) });
    resetWallpaperPage(doc);
    reloadWallpaperPage(doc);
  } catch (error) {
    mounted.wallpaperSubmitting = false;
    mounted.wallpaper2Status = '';
    paintWallpaperFlow(doc);
    showToast(doc, error && error.message ? error.message : '提交失败');
  }
}

// 提交成功后清空本页状态：队列、预览、母版、画布底图全部放掉。
// 真浏览器紧接着会 reload，这里清一遍既保证测试/禁刷新环境下不留残影，
// 也保证重新加载前不持有 objectURL。
function resetWallpaperPage(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  releaseWallpaperSource(mounted);
  releaseWallpaper2Raw(mounted);
  releaseWallpaperMaster(mounted);
  mounted.wallpaperQueue = [];
  mounted.wallpaper2Source = null;
  mounted.wallpaper2Name = '';
  mounted.wallpaper2Video = null;
  mounted.wallpaper2Status = '';
  mounted.wallpaper2MasterStatus = '';
  mounted.wallpaperSubmitting = false;
  mounted.wallpaperExporting = false;
  setWallpaperProgress(doc, null);
  paintWallpaperFlow(doc);
}

function reloadWallpaperPage(doc) {
  const view = doc && doc.defaultView;
  if (!view || !view.location || typeof view.location.reload !== 'function') return;
  try {
    view.location.reload();
  } catch { /* jsdom 等环境不支持导航 */ }
}

// ② 重处理母版链的纯函数版：色彩锁定 → 补帧 60FPS → 4K 超分，返回成片 blob。
// 顺序是有讲究的：先锁色（720P 便宜，且必须在补帧之前，否则插出来的中间帧
// 会把亮度跳变平均成一团糊），再补帧，最后超分；超分放在末尾，
// 避免先放大再补帧导致显存翻倍。单张流水线与批量流水线共用这一段。
async function runMasterChainCore({ sourceBlob, fetcher, fetchImpl, signal, onStep = () => {}, onWarn = () => {} }) {
  const done = [];
  // ① 色彩锁定：消除整段「一明一暗」的呼吸感。
  onStep('① / ③ 色彩锁定 · 逐帧对齐明暗与色温…');
  let current = sourceBlob;
  try {
    const locked = await lockWallpaper2Colors({
      videoDataUrl: await blobToDataUrl(current),
      fetcher,
      fetchImpl,
      signal,
    });
    current = locked.blob;
    done.push(locked.locked ? '色彩锁定' : '色彩锁定（无需调整）');
  } catch (error) {
    // 锁色只是画质增强，失败不该让整条流水线白跑。
    if (error && error.name === 'AbortError') throw error;
    done.push('色彩锁定（跳过）');
    onWarn(error && error.message ? error.message : '色彩锁定失败，已跳过');
  }

  // ② 补帧到 60FPS。onStatus 只会回 running，没有百分比，不必透传。
  onStep('② / ③ 补帧 60FPS · 正在插帧，这一步最久…');
  current = await interpolateWallpaper2Video({
    videoDataUrl: await blobToDataUrl(current),
    targetFps: 60,
    fetcher,
    fetchImpl,
    signal,
  });
  done.push('60FPS');

  // ③ 4K 超分。母版只做一次，四端导出都从它裁剪，不必超分四次。
  onStep('③ / ③ 4K 超分 · 正在放大到 3840×2160，最占显存…');
  current = await upscaleBlob(current, {
    fetcher,
    model: 'animevideov3',
    scale: WALLPAPER2_UPSCALE_SCALE,
    signal,
  });
  done.push('4K');

  return { blob: current, done, label: `母版：${done.join(' + ')}` };
}

// 单张流水线的包装版：跑完纯函数链后，把成片挂成「重处理母版」并接管画布。
async function runMasterChain(doc, sourceBlob, signal) {
  const mounted = mounts.get(doc);
  releaseWallpaperMaster(mounted);
  const fetcher = mounted.fetcher || browserFetcher;
  const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
  const step = (text) => {
    mounted.wallpaper2MasterStatus = text;
    paintWallpaperFlow(doc);
  };
  const { blob, done } = await runMasterChainCore({
    sourceBlob,
    fetcher,
    fetchImpl,
    signal,
    onStep: step,
    onWarn: (msg) => showToast(doc, msg),
  });

  releaseWallpaperMaster(mounted);
  mounted.wallpaperMaster = {
    blob,
    url: URL.createObjectURL(blob),
    previewUrl: URL.createObjectURL(blob),
    label: `母版：${done.join(' + ')}`,
  };
  mounted.wallpaper2MasterStatus = `母版就绪：${done.join(' + ')}`;
  mounted.wallpaper2Status = `重处理完成：${done.join(' + ')}`;
  // 母版就位后立刻接管画布：以后所有裁剪、调色、粒子都对着这份 4K/60 底片做。
  attachWallpaperSource(doc, 'video', URL.createObjectURL(blob), '4K/60 母版');
}

// 按钮入口：重新处理原片（换了调色不用重跑这里，调色在导出时由 LUT 完成）。
async function processWallpaperMaster(doc) {
  const mounted = mounts.get(doc);
  const raw = mounted && mounted.wallpaper2Raw;
  if (!mounted || !raw || !raw.blob) {
    showToast(doc, '还没有可处理的模型原片');
    return;
  }
  if (mounted.wallpaper2Busy) return;
  mounted.wallpaper2Busy = true;
  mounted.wallpaper2Abort = new AbortController();
  paintWallpaperFlow(doc);
  try {
    await runMasterChain(doc, raw.blob, mounted.wallpaper2Abort.signal);
  } catch (error) {
    if (error && error.name === 'AbortError') mounted.wallpaper2MasterStatus = '已取消处理';
    else {
      mounted.wallpaper2MasterStatus = '';
      showToast(doc, error && error.message ? error.message : '重处理失败');
    }
  } finally {
    mounted.wallpaper2Busy = false;
    mounted.wallpaper2Abort = null;
    paintWallpaperFlow(doc);
  }
}

// ---------------- 批量生成立绘视频 ----------------

const BATCH_STATUS_TEXT = {
  queued: '排队中',
  generating: '生成视频中',
  colorlocking: '色彩锁定',
  interpolating: '补帧 60FPS',
  upscaling: '4K 超分',
  done: '完成',
  error: '失败',
};

function batchStatusText(status) {
  return BATCH_STATUS_TEXT[status] || status || '排队中';
}

// 把母版链的进度文案映射回批量项的状态机，好让卡片徽标跟着走。
function batchStepStatus(text = '') {
  if (text.includes('色彩锁定')) return 'colorlocking';
  if (text.includes('补帧')) return 'interpolating';
  if (text.includes('超分')) return 'upscaling';
  return 'generating';
}

function releaseBatchItemUrls(item) {
  for (const key of ['rawUrl', 'masterUrl']) {
    if (item && item[key]) {
      try { URL.revokeObjectURL(item[key]); } catch { /* 忽略 */ }
    }
  }
}

function releaseWallpaper2Batch(mounted) {
  const list = mounted && mounted.wallpaper2Batch;
  if (Array.isArray(list)) for (const item of list) releaseBatchItemUrls(item);
  if (mounted) mounted.wallpaper2Batch = [];
}

// 批量上传：逐张铺白底缩到长边 2048（万相不收透明通道、也卡 20MB），入队但不立即生成。
async function onWallpaper2BatchFiles(doc, files) {
  const mounted = mounts.get(doc);
  if (!mounted || !files || !files.length) return;
  for (const file of files) {
    const isImage = file.type ? file.type.startsWith('image/') : /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '');
    if (!isImage) {
      showToast(doc, `跳过非图片文件：${file.name}`);
      continue;
    }
    const dataUrl = await new Promise((resolve) => {
      const reader = new doc.defaultView.FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      showToast(doc, `图片读取失败：${file.name}`);
      continue;
    }
    const flattened = await flattenWallpaper2Image(doc, dataUrl);
    mounted.wallpaper2Batch.push({
      id: makeFileKey(),
      name: file.name || '未命名立绘',
      imageDataUrl: flattened,
      status: 'queued',
      rawBlob: null,
      rawUrl: null,
      masterBlob: null,
      masterUrl: null,
      error: '',
    });
  }
  paintWallpaperBatch(doc);
}

// 渲染批量容器：每张图一个卡片，展示缩略图、状态、原片/成片与「作为母版/下载/删除」。
function paintWallpaperBatch(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const list = mounted.wallpaper2Batch || [];
  const box = doc.getElementById('wallpaper2-batch');
  const start = doc.getElementById('wallpaper2-batch-start');
  const cancel = doc.getElementById('wallpaper2-batch-cancel');
  const status = doc.getElementById('wallpaper2-batch-status');
  const zone = doc.querySelector('[data-upload-zone="wallpaper2-batch-file"]');
  if (status) status.textContent = mounted.wallpaper2BatchStatus || '';
  if (zone) zone.classList.toggle('has-file', list.length > 0);
  if (start) {
    const busy = Boolean(mounted.wallpaper2BatchBusy || mounted.wallpaper2Busy);
    start.disabled = busy || !list.length;
    start.title = list.length ? '' : '请先批量上传立绘';
  }
  if (cancel) cancel.hidden = !mounted.wallpaper2BatchBusy;
  if (!box) return;
  if (!list.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = list.map((item) => {
    const selectDisabled = item.status !== 'done' || !item.masterBlob;
    const downloadDisabled = !item.masterBlob;
    return `
      <div class="wp2-batch-item" data-batch-id="${esc(item.id)}">
        <div class="wp2-batch-head">
          <img class="wp2-batch-thumb" src="${esc(item.imageDataUrl)}" alt="${esc(item.name)}">
          <div class="wp2-batch-meta">
            <p class="wp2-batch-name" title="${esc(item.name)}">${esc(item.name)}</p>
            <span class="wp2-batch-status wp2-batch-status--${esc(item.status)}">${esc(batchStatusText(item.status))}</span>
            ${item.error ? `<p class="wp2-batch-error">${esc(item.error)}</p>` : ''}
          </div>
        </div>
        ${item.rawUrl ? `<video src="${esc(item.rawUrl)}" muted loop playsinline controls></video><p class="model-note wp2-pick-note">模型原片（未处理）</p>` : ''}
        ${item.masterUrl ? `<video src="${esc(item.masterUrl)}" muted loop playsinline controls></video><p class="model-note wp2-pick-note">成片：4K / 60FPS</p>` : ''}
        <div class="wm-actions">
          <button type="button" class="mini-btn" data-batch-select="${esc(item.id)}"${selectDisabled ? ' disabled' : ''}>作为母版</button>
          <button type="button" class="mini-btn" data-batch-download="${esc(item.id)}"${downloadDisabled ? ' disabled' : ''}>下载成片</button>
          <button type="button" class="mini-btn" data-batch-remove="${esc(item.id)}">删除</button>
        </div>
      </div>`;
  }).join('');
}

// 自动下载成片：处理完一条立刻落盘，用户回来时成片已在下载目录里。
function downloadBatchMaster(doc, item) {
  if (!item || !item.masterBlob) return;
  const stem = String(item.name || 'batch').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_');
  const url = URL.createObjectURL(item.masterBlob);
  saveFile(doc, `${stem}-4k-60fps.mp4`, url);
  const view = doc.defaultView;
  const timer = view && typeof view.setTimeout === 'function' ? view.setTimeout.bind(view) : setTimeout;
  timer(() => { try { URL.revokeObjectURL(url); } catch { /* 忽略 */ } }, 60_000);
}

// 选某条批量成片为「重处理母版」：后续四端剪辑/导出和单张流程完全一致。
function selectBatchMaster(doc, id) {
  const mounted = mounts.get(doc);
  const item = mounted && (mounted.wallpaper2Batch || []).find((it) => it.id === id);
  if (!item || !item.masterBlob) {
    showToast(doc, '这条还没处理完成');
    return;
  }
  releaseWallpaperMaster(mounted);
  mounted.wallpaperMaster = {
    blob: item.masterBlob,
    url: URL.createObjectURL(item.masterBlob),
    previewUrl: URL.createObjectURL(item.masterBlob),
    label: `${item.name} · 4K/60 母版`,
  };
  mounted.wallpaper2MasterStatus = `母版就绪：${item.name}`;
  mounted.wallpaper2Status = `已选择批量成片：${item.name}`;
  attachWallpaperSource(doc, 'video', URL.createObjectURL(item.masterBlob), item.name);
  paintWallpaperFlow(doc);
  showToast(doc, `已把「${item.name}」设为母版，可进入 ③ 四端剪辑导出`);
}

function removeBatchItem(doc, id) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  if (mounted.wallpaper2BatchBusy) {
    showToast(doc, '批量进行中，等跑完再删');
    return;
  }
  const idx = (mounted.wallpaper2Batch || []).findIndex((it) => it.id === id);
  if (idx < 0) return;
  releaseBatchItemUrls(mounted.wallpaper2Batch[idx]);
  mounted.wallpaper2Batch.splice(idx, 1);
  paintWallpaperBatch(doc);
}

// 顺序队列跑完整条批量流水线：生成 → 色彩锁定 → 补帧 60FPS → 4K 超分 → 自动下载。
// 本地 GPU 步骤串行，避免和正在跑的其它壁纸抢显存；万相生成是远端 API，也先串行求稳。
async function startWallpaperBatch(doc) {
  const mounted = mounts.get(doc);
  if (!mounted || mounted.wallpaper2BatchBusy) return;
  const list = mounted.wallpaper2Batch;
  if (!list.length) {
    showToast(doc, '请先批量上传立绘');
    return;
  }
  mounted.wallpaper2BatchBusy = true;
  mounted.wallpaper2BatchAbort = new AbortController();
  paintWallpaperBatch(doc);
  const fetcher = mounted.fetcher || browserFetcher;
  const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
  const model = mounted.wallpaper2Model || WALLPAPER2_DEFAULT_MODEL;
  const duration = mounted.wallpaper2Duration || WALLPAPER2_DURATION;
  let completed = 0;
  for (const item of list) {
    if (mounted.wallpaper2BatchAbort.signal.aborted) break;
    if (item.status === 'done') {
      completed += 1;
      continue;
    }
    try {
      item.error = '';
      item.status = 'generating';
      mounted.wallpaper2BatchStatus = `正在生成：${item.name}（${completed + 1}/${list.length}）`;
      paintWallpaperBatch(doc);
      const raw = await generateWallpaper2Video({
        imageDataUrl: item.imageDataUrl,
        model,
        duration,
        fetcher,
        fetchImpl,
        signal: mounted.wallpaper2BatchAbort.signal,
      });
      item.rawBlob = raw;
      if (item.rawUrl) { try { URL.revokeObjectURL(item.rawUrl); } catch { /* 忽略 */ } }
      item.rawUrl = URL.createObjectURL(raw);

      mounted.wallpaper2BatchStatus = `正在处理：${item.name} · 色彩锁定 → 补帧 → 4K 超分`;
      const result = await runMasterChainCore({
        sourceBlob: raw,
        fetcher,
        fetchImpl,
        signal: mounted.wallpaper2BatchAbort.signal,
        onStep: (text) => {
          item.status = batchStepStatus(text);
          item.error = '';
          mounted.wallpaper2BatchStatus = `${item.name} · ${text}`;
          paintWallpaperBatch(doc);
        },
        onWarn: (msg) => { item.error = msg; },
      });
      item.masterBlob = result.blob;
      if (item.masterUrl) { try { URL.revokeObjectURL(item.masterUrl); } catch { /* 忽略 */ } }
      item.masterUrl = URL.createObjectURL(result.blob);
      item.status = 'done';
      item.error = '';
      completed += 1;
      mounted.wallpaper2BatchStatus = `完成 ${completed}/${list.length}：${item.name}`;
      paintWallpaperBatch(doc);
      downloadBatchMaster(doc, item);
    } catch (error) {
      if (error && error.name === 'AbortError') {
        item.status = 'queued';
        item.error = '';
        break;
      }
      item.status = 'error';
      item.error = error && error.message ? error.message : '处理失败';
      mounted.wallpaper2BatchStatus = `失败：${item.name}`;
      paintWallpaperBatch(doc);
    }
  }
  mounted.wallpaper2BatchBusy = false;
  mounted.wallpaper2BatchAbort = null;
  if (completed === list.length) mounted.wallpaper2BatchStatus = `批量完成：${completed} 条`;
  paintWallpaperBatch(doc);
}

function showToast(doc, message) {
  const toast = doc.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  const view = doc.defaultView;
  const timer = view && typeof view.setTimeout === 'function' ? view.setTimeout.bind(view) : setTimeout;
  timer(() => {
    if (toast.textContent === message) toast.textContent = '';
  }, 3200);
}

function saveFile(doc, filename, href) {
  const link = doc.createElement('a');
  link.download = filename;
  link.href = href;
  doc.body.appendChild(link);
  link.click();
  link.remove();
}

function bytesToDataUrl(bytes, mime = 'application/zip') {
  let binary = '';
  const size = 0x2000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + size));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function remoteImageUrl(item) {
  if (!item) return '';
  if (typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:')) return '';
  const url = item.url || item.dataUrl;
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '';
}

function downloadPng(doc, item, index) {
  const remote = remoteImageUrl(item);
  if (remote) {
    void (async () => {
      const bytes = await fetchImageBytes(doc, remote);
      if (bytes) saveFile(doc, imageFileName(item), bytesToDataUrl(bytes, 'image/png'));
      else if (doc.defaultView) doc.defaultView.open(remote, '_blank');
    })();
    return;
  }
  saveFile(doc, imageFileName(item), item.dataUrl);
}

// OSS 图片没有跨域头，浏览器直接 fetch 会失败。改由本机服务代拉，地址必须已在图库里。
async function fetchImageBytes(doc, url) {
  const view = doc.defaultView;
  const fetchImpl = (view && view.fetch) || fetch;
  try {
    const response = await fetchImpl(`/api/image?url=${encodeURIComponent(url)}`);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function materializeItem(doc, item) {
  const remote = remoteImageUrl(item);
  if (!remote) return item;
  const bytes = await fetchImageBytes(doc, remote);
  if (!bytes) return null;
  return { ...item, bytes, remote: false };
}

// 历史批次只有 OSS 地址。打包前把字节拉回来，zipBatch 直接用 bytes，不再绕一圈 base64。
async function materializeBatch(doc, batch) {
  const items = [];
  for (const item of batch.items) {
    const local = await materializeItem(doc, item);
    if (!local) return null;
    items.push(local);
  }
  let base = batch.base;
  if (base) {
    base = await materializeItem(doc, base);
    if (!base) return null;
  }
  return { ...batch, items, base };
}

async function deleteGalleryItems(doc, items, apply) {
  const mounted = mounts.get(doc);
  if (!mounted || !items.length) return;
  const view = doc.defaultView;
  const message = items.length > 1
    ? '删除这一组图片？已保存的记录会一并去掉。'
    : '删除这张图片？已保存的记录会一并去掉。';
  if (view && typeof view.confirm === 'function' && !view.confirm(message)) return;
  const ids = items.map((item) => item.recordId).filter((id) => Number.isInteger(id));
  if (ids.length) {
    const fetcher = mounted.fetcher || browserFetcher;
    try {
      await fetcher('/api/gallery/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      showToast(doc, '删除失败，请确认后端已重启');
      return;
    }
  }
  apply();
  renderDownloadPanes(doc, mounted.gallery);
  mounted.paint();
  showToast(doc, '已删除');
}

async function downloadZip(doc, batch) {
  const localBatch = await materializeBatch(doc, batch);
  if (!localBatch) {
    const status = doc.getElementById('status');
    if (status) status.textContent = '远程图片拉取失败，请检查网络或单张下载';
    return;
  }
  const zipped = zipBatch(localBatch);
  saveFile(doc, zipped.filename, bytesToDataUrl(zipped.bytes));
}

const ROUTES = ['base', 'detail', 'tune', 'generate', 'hotchibi', 'watermark', 'wallpaper', 'download', 'tasks'];
const PAGE_BY_ROUTE = {
  base: '#page-base',
  detail: '#page-detail',
  tune: '#page-tune',
  generate: '#page-generate',
  hotchibi: '#page-hotchibi',
  watermark: '#page-watermark',
  wallpaper: '#page-wallpaper',
  download: '#download-view',
  tasks: '#page-tasks',
};

function showPage(doc, route) {
  const mounted = mounts.get(doc);
  if (mounted) mounted.activeRoute = route;
  for (const candidate of ROUTES) {
    const page = doc.querySelector(PAGE_BY_ROUTE[candidate]);
    if (page) page.hidden = candidate !== route;
  }
  for (const item of doc.querySelectorAll('#sidebar [data-route]')) {
    const active = item.dataset.route === route;
    item.classList.toggle('active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  }
  if (route === 'download') {
    renderDownloadPanes(doc, mounted?.gallery);
    syncDownloadTab(doc, mounted?.downloadTab || 'all');
  }
  if (route === 'watermark') {
    paintWatermark(doc);
    startWatermarkVideoPreview(doc);
  } else {
    stopWatermarkVideoPreview(doc);
  }
  if (route === 'wallpaper') startWallpaper(doc);
  else stopWallpaper(doc);
  if (route === 'tasks') {
    renderTasksView(doc);
    void refreshTasks(doc);
  }
}

// ---------------- 任务队列页 ----------------
//
// 任务的执行方在服务端，这一页只做两件事：轮询 /api/tasks 拿最新进度、
// 池 B 任务跑完后把产物取回本地自动下载（提交任务后页面会刷新，
// 所以自动下载不能依赖「用户正停在这一页」，轮询从挂载起就一直在跑）。

const TASK_POLL_ACTIVE_MS = 1500;
const TASK_POLL_IDLE_MS = 8000;
const TASK_DOWNLOADED_KEY = 'aiRoleGenTaskDownloads';

function taskState(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return null;
  if (!mounted.tasks) {
    mounted.tasks = {
      items: [],
      filter: 'all',
      expanded: new Set(),
      busy: new Set(),
      downloaded: loadDownloadedKeys(doc),
      // 三栏各自的分页位置：{ finished: 1, failed: 1, active: 1 }。
      pages: {},
      timer: null,
      loading: false,
    };
  }
  return mounted.tasks;
}

function loadDownloadedKeys(doc) {
  const view = doc.defaultView;
  try {
    const raw = view && view.localStorage ? view.localStorage.getItem(TASK_DOWNLOADED_KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

function saveDownloadedKeys(doc, keys) {
  const view = doc.defaultView;
  if (!view || !view.localStorage) return;
  try {
    // 只留最近 200 条，避免 localStorage 无限长。
    view.localStorage.setItem(TASK_DOWNLOADED_KEY, JSON.stringify([...keys].slice(-200)));
  } catch { /* 配额满就算了，顶多重复下载一次 */ }
}

function scheduleTaskPoll(doc, delay) {
  const state = taskState(doc);
  if (!state) return;
  const view = doc.defaultView;
  const setTimer = view && typeof view.setTimeout === 'function' ? view.setTimeout.bind(view) : setTimeout;
  state.timer = setTimer(() => {
    state.timer = null;
    void pollTasks(doc);
  }, delay);
}

async function pollTasks(doc) {
  await refreshTasks(doc, { quiet: true });
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const state = taskState(doc);
  const active = state.items.some((task) => !isTerminal(task));
  scheduleTaskPoll(doc, active ? TASK_POLL_ACTIVE_MS : TASK_POLL_IDLE_MS);
}

function startTasksPolling(doc) {
  if (!doc.getElementById('tasks-list')) return;
  const state = taskState(doc);
  if (!state || state.timer) return;
  scheduleTaskPoll(doc, 300);
}

async function refreshTasks(doc, { quiet = false } = {}) {
  const state = taskState(doc);
  if (!state || state.loading) return;
  state.loading = true;
  try {
    const tasks = await fetchTasks({ fetchImpl: taskFetch(doc), limit: 500 });
    state.items = Array.isArray(tasks) ? tasks : [];
    await autoDownloadWallpapers(doc, state.items);
  } catch (error) {
    if (!quiet) showToast(doc, error && error.message ? error.message : '任务列表加载失败');
  } finally {
    state.loading = false;
    const mounted = mounts.get(doc);
    if (mounted && mounted.activeRoute === 'tasks') renderTasksView(doc);
  }
}

function renderTasksView(doc) {
  const state = taskState(doc);
  const box = doc.getElementById('tasks-list');
  if (!state || !box) return;
  for (const tab of doc.querySelectorAll('[data-task-filter]')) {
    const active = tab.dataset.taskFilter === state.filter;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  // 轮询每秒重写这张列表：记住页面的滚动位置，否则用户滚到下面的卡片时会被弹回顶部。
  const page = doc.getElementById('page-tasks');
  const top = page ? page.scrollTop : 0;
  box.innerHTML = renderTaskBoard(state.items, {
    now: Date.now(),
    expanded: state.expanded,
    busy: state.busy,
    filter: state.filter,
    pages: state.pages,
  });
  if (page && page.scrollTop !== top) page.scrollTop = top;
}

// 池 B 任务跑到终态就把产物自动下载下来：批量壁纸逐张 mp4、四端导出一个 zip。
// 用「任务 id + 完成时间」做幂等键并落 localStorage，刷新页面也不会重复下载。
async function autoDownloadWallpapers(doc, tasks) {
  const state = taskState(doc);
  if (!state) return;
  const list = tasks.filter((task) => task.pool === POOL_WALLPAPER
    && isTerminal(task)
    && task.status !== 'cancelled'
    && task.status !== 'failed');
  for (const task of list) {
    const key = `${task.id}:${task.finished_at || ''}`;
    if (state.downloaded.has(key)) continue;
    const entries = taskDownloadEntries(task);
    if (!entries.length) continue;
    const saved = [];
    for (const entry of entries) {
      try {
        const blob = await fetchTaskResultBlob(task.id, entry.index, { fetchImpl: taskFetch(doc) });
        saveFile(doc, entry.filename, URL.createObjectURL(blob));
        saved.push(entry.filename);
      } catch { /* 取不到就留给用户手动下载 */ }
    }
    if (saved.length) {
      state.downloaded.add(key);
      saveDownloadedKeys(doc, state.downloaded);
      showToast(doc, `任务完成，已自动下载 ${saved.length} 个文件`);
    }
  }
}

async function downloadTaskResults(doc, task, index = null) {
  const entries = taskDownloadEntries(task);
  const picked = index == null ? entries : entries.filter((entry) => entry.index === Number(index));
  if (!picked.length) {
    showToast(doc, '还没有可下载的产物');
    return;
  }
  for (const entry of picked) {
    try {
      const blob = await fetchTaskResultBlob(task.id, entry.index, { fetchImpl: taskFetch(doc) });
      saveFile(doc, entry.filename, URL.createObjectURL(blob));
    } catch (error) {
      showToast(doc, error && error.message ? error.message : '下载失败');
    }
  }
}

async function withTaskBusy(doc, taskId, run) {
  const state = taskState(doc);
  if (!state) return;
  if (state.busy.has(taskId)) return;
  state.busy.add(taskId);
  renderTasksView(doc);
  try {
    await run();
  } finally {
    state.busy.delete(taskId);
    renderTasksView(doc);
  }
}

function findTask(doc, taskId) {
  const state = taskState(doc);
  return state ? state.items.find((task) => task.id === taskId) || null : null;
}

async function cancelTaskFromUi(doc, taskId) {
  await withTaskBusy(doc, taskId, async () => {
    try {
      await cancelTask(taskId, { fetchImpl: taskFetch(doc) });
    } catch (error) {
      showToast(doc, error && error.message ? error.message : '取消失败');
    }
    await refreshTasks(doc, { quiet: true });
  });
}

async function deleteTaskFromUi(doc, taskId) {
  await withTaskBusy(doc, taskId, async () => {
    try {
      await deleteTask(taskId, { fetchImpl: taskFetch(doc) });
      const state = taskState(doc);
      state.items = state.items.filter((task) => task.id !== taskId);
      state.expanded.delete(taskId);
      renderTasksView(doc);
    } catch (error) {
      showToast(doc, error && error.message ? error.message : '删除失败');
    }
  });
}

// 重试只重跑失败 / 跳过 / 取消的步骤：原始载荷从服务端取回（前端不缓存 base64），
// 依赖记号 `#N` 重新映射成新计划的序号，上游不在重试集合里的连坐剔除。
async function retryTaskFromUi(doc, taskId) {
  const task = findTask(doc, taskId);
  if (!task) return;
  await withTaskBusy(doc, taskId, async () => {
    try {
      const payload = await fetchTaskPayload(taskId, { fetchImpl: taskFetch(doc) });
      const retry = buildRetryPayload(task, payload);
      if (!retry.total) {
        showToast(doc, '没有可重试的步骤');
        return;
      }
      const body = {
        kind: task.kind,
        pool: task.pool,
        title: `${task.title}（重试）`,
        unit: task.unit,
        total: retry.total,
        steps: retry.steps,
        refs: retry.refs,
      };
      if (retry.key === 'units') {
        body.units = retry.steps;
        delete body.steps;
      }
      if (payload.platforms) body.platforms = payload.platforms;
      if (payload.sourceDataUrl) body.sourceDataUrl = payload.sourceDataUrl;
      if (payload.sourceKind) body.sourceKind = payload.sourceKind;
      await submitTask(body, { fetchImpl: taskFetch(doc) });
      showToast(doc, '已重新提交到任务队列');
      await refreshTasks(doc, { quiet: true });
    } catch (error) {
      showToast(doc, error && error.message ? error.message : '重试失败');
    }
  });
}

function toggleTaskExpanded(doc, taskId) {
  const state = taskState(doc);
  if (!state) return;
  if (state.expanded.has(taskId)) state.expanded.delete(taskId);
  else state.expanded.add(taskId);
  renderTasksView(doc);
}

function setTaskFilter(doc, filter) {
  const state = taskState(doc);
  if (!state) return;
  state.filter = filter;
  // 换池就回到每栏第一页，别让用户在新池里停在一个空白的第 3 页。
  state.pages = {};
  renderTasksView(doc);
}

// 三栏各自翻页：只动这一栏的位置，其它栏保持不动。
function stepTaskPage(doc, group, step) {
  const state = taskState(doc);
  if (!state) return;
  state.pages[group] = Math.max(1, (Number(state.pages[group]) || 1) + (Number(step) || 0));
  renderTasksView(doc);
}

function syncDownloadTab(doc, tab) {
  for (const pane of doc.querySelectorAll('#download-view [data-download-pane]')) {
    pane.hidden = pane.dataset.downloadPane !== tab;
  }
  for (const button of doc.querySelectorAll('#download-view [data-download-tab]')) {
    const active = button.dataset.downloadTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
}

function watchGallery(doc, gallery) {
  if (!gallery || typeof gallery.addBatch !== 'function' || watchedGalleries.has(gallery)) return;
  watchedGalleries.add(gallery);
  const original = gallery.addBatch.bind(gallery);
  gallery.addBatch = (items, base) => {
    const batch = original(items, base);
    renderDownloadPanes(doc, gallery);
    return batch;
  };
}

// ---------------- 全屏预览 ----------------

function openFullscreen(doc, src) {
  const overlay = doc.getElementById('fullscreen');
  const img = doc.getElementById('fullscreen-img');
  if (!overlay || !img || !src) return;
  img.src = src;
  overlay.hidden = false;
}

function closeFullscreen(doc) {
  const overlay = doc.getElementById('fullscreen');
  if (overlay) overlay.hidden = true;
}

// ---------------- 渲染 ----------------

// 细配是原生 details。选项和颜色一改就会整页重画，不记展开状态的话面板会立刻合上。
function rememberOpenFines(doc, mounted) {
  if (!mounted.openFines) mounted.openFines = new Set();
  for (const node of doc.querySelectorAll('details.clothing-fine[data-fine]')) {
    if (node.open) mounted.openFines.add(node.dataset.fine);
    else mounted.openFines.delete(node.dataset.fine);
  }
}

function renderTune(tune, warningList, extras) {
  const model = imageModelById(TUNE_IMAGE_MODEL);
  const poseWarnings = warningList.filter((text) => text.includes('躺/趴'));
  const warningHtml = poseWarnings.map((text) => `<p>${esc(text)}</p>`).join('');
  const disabled = extras.generating ? ' disabled' : '';
  const preview = (src, alt, removeId, removeLabel) => (
    src
      ? `<img class="tune-preview" src="${esc(src)}" alt="${esc(alt)}"><button type="button" id="${esc(removeId)}">${esc(removeLabel)}</button>`
      : ''
  );
  const groups = renderCenter(tune.groups, {
    closedGroups: extras.closedGroups || new Set(),
    openMores: extras.openMores || new Set(),
    ctx: extras.ctx || {},
  });
  const tuneGender = extras.tuneGender === '男' ? '男' : '女';
  const genderChoice = (value, label) => `<label class="tune-gender-option"><input type="radio" name="tuneGender" data-field="tuneGender" value="${value}"${tuneGender === value ? ' checked' : ''}>${label}</label>`;
  const aspects = (tune.aspect.options || []).map(renderAspect).join('');
  return `<div class="tune-sheet">
    <h2 class="section-title">角色定向微调</h2>
    <div class="model-lock"><p class="model-lock-line"><span class="model-lock-use">微调角色图集</span><span class="model-id">${esc(model.id)}</span></p><p class="model-price">${esc(model.price)}</p></div>
    <p class="model-note">走 Gemini，按 1K 出图。三视图、表情图集（可选再加手部拆解图）最多 3 张参考图。提示词末尾会自动追加防崩手的正负向补丁。图片按剩余张数 1~4 路并行生成。</p>
    ${renderStyleSelector(tune.style || [])}
    <div class="tune-uploads">
      <div class="upload-drop" data-upload-zone="turnaround-file">
        <label>上传角色三视图<input type="file" id="turnaround-file" accept="image/*"></label>
        ${preview(extras.turnaround, '角色三视图', 'remove-turnaround', '移除三视图')}
      </div>
      <div class="upload-drop" data-upload-zone="expression-file">
        <label>上传角色表情图集<input type="file" id="expression-file" accept="image/*"></label>
        ${preview(extras.expressions, '角色表情图集', 'remove-expressions', '移除表情图集')}
      </div>
      <div class="upload-drop" data-upload-zone="handsheet-file">
        <label>上传手部拆解图（可选）<input type="file" id="handsheet-file" accept="image/*"></label>
        ${preview(extras.handSheet, '手部拆解图', 'remove-handsheet', '移除手部拆解图')}
      </div>
      <fieldset class="tune-gender">
        <legend>角色性别</legend>
        ${genderChoice('女', '女')}
        ${genderChoice('男', '男')}
      </fieldset>
    </div>
    <p class="model-note">三视图和表情图集都要上传。三视图决定角色和衣服，表情图集决定脸部表情。手部拆解图可选：在「生成与处理」里点「生成手部拆解图」得到九宫格手势表，传进来后模型会照着它画手指结构，但不会把九宫格排版画进成品。性别只看这里的勾选。场景只选一套；姿势和表情按多选的组合出图。</p>
    <div id="tune-warnings">${warningHtml}</div>
    ${groups}
    <div class="gen gen-full">
      <button type="button" class="gen-btn" data-generate="生成微调角色图集"${disabled}>生成微调角色图集</button>
      <p class="tune-count">将生成 ${esc(String(extras.count))} 张</p>
      <div class="aspects">${aspects}</div>
    </div>
    <p class="model-note">点一次提交即返回，不锁界面：可以接着改选项再提交，多份任务在服务端按顺序排队，进度去【任务队列】看，出图仍会回到本页输出区。</p>
    <div id="tune-queue" class="wp-status">${esc(extras.queue || '')}</div>
    <div id="tune-status"></div>
    <div id="tune-progress" class="progress" hidden>
      <div class="progress-track"><div class="progress-fill"></div></div>
    </div>
    ${renderStop(extras.generating)}
    <div id="tune-output" class="output-strip">${extras.output}</div>
  </div>`;
}

// ---------------- 任务队列执行 ----------------

function sortGroupItems(group, items) {
  if (group.sort !== 'kind') return items;
  const order = { 三视图: 0, 表情差分图: 1, 服饰拆解图: 2, Q版形象: 3 };
  return items.slice().sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}

function waitMs(ms) {
  return new Promise((resolve) => {
    const timer = typeof setTimeout === 'function' ? setTimeout : null;
    if (!timer) { resolve(); return; }
    timer(resolve, ms);
  });
}

// 提交步骤计划到服务端任务队列，轮询回显；整组（套）齐了立刻入图库。
// 界面不刷新：进度条、输出区、停止按钮都留在原位，由轮询结果驱动。
// 停止 = 调 /api/tasks/<id>/cancel，服务端会把正在跑的子任务一起掐掉。
async function runPlanAsTask(doc, plan, { report = () => {}, onProgress, onImage, signal = null } = {}) {
  const mounted = mounts.get(doc);
  if (!mounted) throw new Error('缺少上下文');
  const fetchImpl = (doc.defaultView && doc.defaultView.fetch) || fetch;
  const meta = plan.steps.map((step) => step.meta);
  const payload = planToPayload(plan);

  const submitted = await submitTask({
    kind: 'image',
    pool: POOL_MAIN,
    title: plan.title,
    unit: plan.unit,
    total: plan.total,
    steps: payload.steps,
    refs: payload.refs,
  }, { fetchImpl });
  mounted.taskId = submitted.id;

  const fetched = new Map();
  const finished = new Set();
  const batches = [];
  const pending = (plan.stamps || []).map((group) => ({ group, done: false }));
  let latest = submitted;
  let shown = 0;

  const flush = () => {
    for (const entry of pending) {
      if (entry.done) continue;
      if (!entry.group.indices.every((index) => fetched.has(index) || finished.has(index))) continue;
      entry.done = true;
      const items = sortGroupItems(
        entry.group,
        entry.group.indices.map((index) => fetched.get(index)).filter((item) => item && item.dataUrl),
      );
      if (!items.length) continue;
      const batch = mounted.gallery.addBatch(items, entry.group.base || null);
      batch.createdAt = Date.now();
      batches.push(batch);
      // 这组已经进图库了，把对应的瞬时回显撤掉，否则输出区会同一张图显示两遍。
      const landed = new Set(entry.group.indices);
      mounted.liveItems = (mounted.liveItems || []).filter((item) => !landed.has(item.stepIndex));
      renderDownloadPanes(doc, mounted.gallery);
    }
  };

  // 把这一轮新落定的 step 产物取回本地：图库和下载页只认 data URL。
  const absorb = async (task) => {
    for (const entry of task.steps || []) {
      const index = entry.index;
      if (entry.status === 'done' && !fetched.has(index)) {
        try {
          const dataUrl = await fetchTaskResult(task.id, index, { fetchImpl });
          const item = {
            ...meta[index],
            dataUrl,
            url: entry.url || null,
            id: entry.recordId ?? null,
          };
          fetched.set(index, item);
          shown += 1;
          mounted.liveItems = [...(mounted.liveItems || []), { ...item, stepIndex: index }];
          if (onImage) onImage(item, index);
        } catch {
          finished.add(index);
        }
      } else if (entry.status === 'failed' || entry.status === 'skipped' || entry.status === 'cancelled') {
        finished.add(index);
      }
    }
    flush();
  };

  for (;;) {
    if (signal && signal.aborted) {
      try { await cancelTask(latest.id, { fetchImpl }); } catch { /* 服务端可能已经跑完 */ }
      const error = new Error('已停止生成');
      error.name = 'AbortError';
      error.stopped = true;
      throw error;
    }
    await absorb(latest);
    if (isTerminal(latest)) break;
    // 第一张还没出时才用「正在生成 X…」占位；之后由 onImage 逐张写「（i/N）」，
    // 避免每轮轮询都把进度文案盖回去。
    const running = (latest.steps || []).find((entry) => entry.status === 'running');
    if (onProgress && shown === 0) {
      onProgress({
        kind: (running && running.kind) || (meta[Math.min(shown, meta.length - 1)] || {}).kind || '图片',
        index: Math.min(Number(latest.done) || 0, plan.total),
        count: plan.total,
      });
    }
    setProgress(doc, {
      fraction: taskPercent(latest) / 100,
      active: true,
      total: plan.total,
    });
    // 轮询只刷新出图条与状态行：整页重绘会把滚动位置清零、折叠面板重建。
    paintLiveRegions(doc);
    await waitMs(mounted.pollMs || TASK_POLL_MS_LOCAL);
    latest = await fetchTask(latest.id, { fetchImpl });
  }
  await absorb(latest);
  // 一张都没出且任务失败：把服务端的错误原样抛给调用方，界面上就是错误文案，
  // 不能还报「已生成」。
  if (latest.status === 'failed' && shown === 0) {
    throw new Error(latest.error || latest.message || '生成失败');
  }
  const items = plan.steps.map((_, index) => fetched.get(index) || null);
  return {
    task: latest,
    batches,
    items,
    skipped: plan.steps.filter((_, index) => !fetched.has(index)).length,
  };
}

const TASK_POLL_MS_LOCAL = TASK_POLL_MS;

// ---------------- 微调页的后台队列 ----------------
//
// 微调页刻意不锁界面：点一次提交就把整份 step plan 丢进池 A，然后立刻返回，
// 用户可以接着改选项、再提交第二份、第三份，任务在服务端按提交顺序串行排队。
// 结果不靠本页等待，而是由这里的一组轻量轮询把已完成的图增量并进图库：
// 一整套（stamp）齐了才 addBatch，输出区和下载页看到的批次与现场生成完全一致。

function tuneQueueState(doc, mounted) {
  if (!Array.isArray(mounted.tuneJobs)) mounted.tuneJobs = [];
  if (!Array.isArray(mounted.tuneLive)) mounted.tuneLive = [];
  return mounted.tuneJobs;
}

function tuneQueueSummary(mounted) {
  const jobs = mounted.tuneJobs || [];
  const active = jobs.filter((job) => !job.done);
  const queued = active.filter((job) => job.status === 'queued').length;
  const running = active.length - queued;
  const done = jobs.length - active.length;
  return { total: jobs.length, queued, running, done, active: active.length };
}

// 队列摘要文案：本页只报数量，逐张进度在【任务队列】里看。
function tuneQueueText(mounted) {
  const counts = tuneQueueSummary(mounted);
  if (!counts.total) return '';
  const parts = [];
  if (counts.queued) parts.push(`排队 ${counts.queued}`);
  if (counts.running) parts.push(`进行中 ${counts.running}`);
  if (counts.done) parts.push(`已完成 ${counts.done}`);
  return `后台任务 ${counts.total} 个（${parts.join(' · ')}），进度见【任务队列】`;
}

function paintTuneQueue(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const text = tuneQueueText(mounted);
  mounted.tuneQueueText = text;
  const box = doc.getElementById('tune-queue');
  if (box) box.textContent = text;
}

// 出图区的签名：没变就不重写 innerHTML，避免每秒把同样的 data URL 重新塞回 DOM。
function liveSignature(mounted, { onlyKind = '', excludeKind = '' } = {}) {
  const keep = (kind) => (!onlyKind || kind === onlyKind) && (!excludeKind || kind !== excludeKind);
  const parts = [];
  for (const batch of galleryBatches(mounted.gallery)) {
    if (batch.history) continue;
    for (const item of batch.items || []) {
      if (keep(item.kind)) parts.push(item.id || '');
    }
  }
  for (const item of mounted.liveItems || []) {
    if (keep(item.kind)) parts.push(`l${item.stepIndex}`);
  }
  for (const item of mounted.tuneLive || []) {
    if (keep(item.kind)) parts.push(`t${item.taskId}:${item.stepIndex}`);
  }
  return `${parts.length}|${parts.join(',')}`;
}

// 三个页面的「实时区」：出图条 + 状态行。轮询只刷新这些节点。
const LIVE_REGIONS = [
  { key: 'generate', output: 'output', status: 'status', onlyKind: '', excludeKind: '微调角色' },
  { key: 'hot', output: 'hotchibi-output', status: 'hotchibi-status', onlyKind: '热门Q版', excludeKind: '' },
  { key: 'tune', output: 'tune-output', status: 'tune-status', onlyKind: '微调角色', excludeKind: '' },
];

function statusTextOf(mounted, key) {
  if (key === 'tune') return mounted.tuneStatusText || '';
  if (key === 'hot') return (mounted.hot && mounted.hot.status) || '';
  return mounted.statusText || '';
}

// 轮询时只刷新「出图容器 + 状态行 + 进度条」，绝不重建整页 DOM。
// 整页 innerHTML 重绘会把 .page 的滚动位置清零（内容高度瞬间归零时浏览器会把
// scrollTop 钳回 0），正在展开的折叠面板也会被重建 —— 用户滚到下面的场景区点选时
// 每秒被弹回顶部，看起来就是「选不上」。这里只改必要的几个节点。
function paintLiveRegions(doc) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  if (!mounted.liveSigs) mounted.liveSigs = {};
  const live = [...(mounted.liveItems || []), ...(mounted.tuneLive || [])];
  for (const region of LIVE_REGIONS) {
    const box = doc.getElementById(region.output);
    if (box) {
      const signature = liveSignature(mounted, region);
      if (mounted.liveSigs[region.key] !== signature) {
        mounted.liveSigs[region.key] = signature;
        box.innerHTML = outputHtml(mounted.gallery, live, region);
      }
    }
    const status = doc.getElementById(region.status);
    const text = statusTextOf(mounted, region.key);
    if (status && status.textContent !== text) status.textContent = text;
  }
  paintTuneQueue(doc);
  applyProgress(doc, mounted.progress);
}

// 兼容旧调用点：微调页的轮询走的就是同一套局部刷新。
function paintTuneRegions(doc) {
  paintLiveRegions(doc);
}

// 提交一份微调计划：只等到「服务端受理」为止，不等出图。
async function submitTuneQueueTask(doc, allowBedShoes) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  let plan;
  try {
    plan = await buildTunePlan({
      state: mounted.store.getState(),
      images: mounted.images,
      allowBedShoes,
      model: TUNE_IMAGE_MODEL,
    });
  } catch (error) {
    const message = error && error.message ? error.message : '生成失败';
    setTuneStatus(doc, message);
    showToast(doc, message);
    return;
  }
  const fetchImpl = taskFetch(doc);
  const payload = planToPayload(plan);
  let submitted;
  try {
    submitted = await submitTask({
      kind: 'image',
      pool: POOL_MAIN,
      title: plan.title,
      unit: plan.unit,
      total: plan.total,
      steps: payload.steps,
      refs: payload.refs,
    }, { fetchImpl });
  } catch (error) {
    const message = error && error.message ? error.message : '提交失败';
    setTuneStatus(doc, message);
    showToast(doc, message);
    return;
  }

  const jobs = tuneQueueState(doc, mounted);
  jobs.push({
    id: submitted.id,
    meta: plan.steps.map((step) => step.meta),
    fetched: new Map(),
    finished: new Set(),
    pending: (plan.stamps || []).map((group) => ({ group, done: false })),
    total: plan.total,
    shown: 0,
    status: submitted.status || 'queued',
    done: false,
  });
  mounted.tuneStatusText = `已提交「${plan.title}」，共 ${plan.total} 张`;
  // 只刷新出图区与状态行：整页重绘会把用户正滚到的位置弹回顶部。
  paintTuneRegions(doc);
  showToast(doc, `已提交到任务队列：${plan.total} 张`);
  // 任务队列页若已挂载，立刻拉一次，别等下一轮空闲轮询。
  void refreshTasks(doc, { quiet: true });
  startTunePolling(doc);
}

// 把一份任务里已完成但还没取回的图取回来，凑满一整套就入图库。
async function absorbTuneJob(doc, mounted, job, task) {
  const fetchImpl = taskFetch(doc);
  for (const entry of task.steps || []) {
    const index = entry.index;
    if (entry.status === 'done' && !job.fetched.has(index)) {
      try {
        const dataUrl = await fetchTaskResult(task.id, index, { fetchImpl });
        const item = {
          ...job.meta[index],
          dataUrl,
          url: entry.url || null,
          id: entry.recordId ?? null,
        };
        job.fetched.set(index, item);
        job.shown += 1;
        mounted.tuneLive.push({ ...item, stepIndex: index, taskId: task.id });
      } catch {
        job.finished.add(index);
      }
    } else if (entry.status === 'failed' || entry.status === 'skipped' || entry.status === 'cancelled') {
      job.finished.add(index);
    }
  }
  flushTuneJob(doc, mounted, job);
  job.status = task.status;
  if (isTerminal(task)) {
    job.done = true;
    // 任务收尾时把没凑满一套的部分也落进图库：否则已出的图只存在于瞬时回显里。
    flushTuneJob(doc, mounted, job, { force: true });
  }
}

function flushTuneJob(doc, mounted, job, { force = false } = {}) {
  for (const entry of job.pending) {
    if (entry.done) continue;
    const ready = entry.group.indices.every((index) => job.fetched.has(index) || job.finished.has(index));
    if (!ready && !force) continue;
    entry.done = true;
    const items = sortGroupItems(
      entry.group,
      entry.group.indices.map((index) => job.fetched.get(index)).filter((item) => item && item.dataUrl),
    );
    if (!items.length) continue;
    const batch = mounted.gallery.addBatch(items, entry.group.base || null);
    batch.createdAt = Date.now();
    // 已入图库的瞬时回显要撤掉，否则输出区同一张图会显示两遍。
    const landed = new Set(entry.group.indices);
    mounted.tuneLive = mounted.tuneLive.filter((item) => !(item.taskId === job.id && landed.has(item.stepIndex)));
    renderDownloadPanes(doc, mounted.gallery);
  }
}

function startTunePolling(doc) {
  const mounted = mounts.get(doc);
  if (!mounted || mounted.tunePollTimer) return;
  const view = doc.defaultView;
  const setTimer = view && typeof view.setTimeout === 'function' ? view.setTimeout.bind(view) : setTimeout;
  const tick = async () => {
    mounted.tunePollTimer = null;
    const jobs = (mounted.tuneJobs || []).filter((job) => !job.done);
    for (const job of jobs) {
      try {
        const task = await fetchTask(job.id, { fetchImpl: taskFetch(doc) });
        await absorbTuneJob(doc, mounted, job, task);
        if (job.done) {
          setTuneStatus(doc, task.status === 'done'
            ? `已生成微调角色图集（${job.shown} 张）`
            : (task.status === 'cancelled' ? '有一个后台任务已取消' : `有任务未全部成功：${task.message || task.status}`));
        }
      } catch {
        // 网络抖动：下一轮再试，不要把任务标成完成。
      }
    }
    // 局部刷新：只更新出图容器与状态行，不碰折叠面板和滚动位置。
    paintTuneRegions(doc);
    if ((mounted.tuneJobs || []).some((job) => !job.done)) {
      mounted.tunePollTimer = setTimer(() => { void tick(); }, mounted.pollMs || TASK_POLL_MS_LOCAL);
    }
  };
  mounted.tunePollTimer = setTimer(() => { void tick(); }, mounted.pollMs || TASK_POLL_MS_LOCAL);
}


// ---------------- 热门Q版：上传正比图 → 直接出 Q 版 ----------------

// 上传的正比图多是 2K 官方立绘，先等比压到长边 1024：base64 会把请求体撑爆。
function resizeDataUrl(doc, dataUrl, maxEdge = 1024) {
  return new Promise((resolve) => {
    const view = doc.defaultView;
    if (!view || typeof view.Image !== 'function') { resolve(dataUrl); return; }
    const img = new view.Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width || 1;
      const h = img.naturalHeight || img.height || 1;
      const long = Math.max(w, h);
      if (long <= maxEdge) { resolve(dataUrl); return; }
      const scale = maxEdge / long;
      const canvas = doc.createElement('canvas');
      canvas.width = Math.max(2, Math.round(w * scale));
      canvas.height = Math.max(2, Math.round(h * scale));
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function hotReady(hot) {
  return Boolean(hot && hot.a);
}

// 页面控件与 mounted.hot 对齐：预览图、张数、瞳色、生成按钮门禁。
function paintHotPage(doc) {
  const mounted = mounts.get(doc);
  const hot = mounted && mounted.hot;
  if (!hot) return;
  const box = doc.getElementById('hotchibi-preview-a');
  if (box) {
    box.hidden = !hot.a;
    const img = box.querySelector('img');
    if (img && hot.a) img.src = hot.a;
  }
  const count = doc.getElementById('hotchibi-count');
  if (count) count.value = String(hot.count || 1);
  const eye = doc.getElementById('hotchibi-eye');
  if (eye) eye.value = hot.eyeColor || '跟随参考图';
  const bgSelect = doc.getElementById('hotchibi-bg');
  if (bgSelect) {
    const live = mounted.store ? mounted.store.getState() : {};
    bgSelect.value = live.sheetBg || '白';
  }
  const btn = doc.getElementById('hotchibi-generate');
  if (btn) btn.disabled = !hotReady(hot) || Boolean(mounted.generating);
}

// 瞳色选项直接来自 catalog，避免这里再抄一份颜色清单。
function fillHotSelects(doc) {
  const fill = (id, options) => {
    const select = doc.getElementById(id);
    if (!select || select.dataset.filled === '1') return;
    for (const opt of options || []) {
      const node = doc.createElement('option');
      node.value = opt.value;
      node.textContent = opt.value;
      select.appendChild(node);
    }
    select.dataset.filled = '1';
  };
  fill('hotchibi-eye', OPTIONS.eyeColor);
  fill('hotchibi-bg', OPTIONS.sheetBg);
}

async function onHotFile(doc, file) {
  const mounted = mounts.get(doc);
  if (!mounted || !file) return;
  if (!file.type || !file.type.startsWith('image/')) { showToast(doc, '只接受图片文件'); return; }
  const raw = await fileToDataUrl(doc, file);
  if (!raw || !raw.startsWith('data:image/')) { showToast(doc, '读取图片失败'); return; }
  mounted.hot.a = await resizeDataUrl(doc, raw, 1024);
  paintHotPage(doc);
  showToast(doc, '已添加角色图；请确认是单人正比立绘');
}

async function startHotChibi(doc) {
  const mounted = mounts.get(doc);
  if (!mounted || mounted.generating || !hotReady(mounted.hot)) return;
  const hot = mounted.hot;
  const report = (text) => { hot.status = text; paintLiveRegions(doc); };
  mounted.generating = true;
  mounted.liveItems = [];
  report('正在生成 Q 版（第一阶段）…');
  paintHotPage(doc);
  // 该页不读工作台的设定表单：身份全部来自上传的正比图，这里只借 state 传风格与瞳色。
  const live = mounted.store.getState();
  const state = {
    ...defaultState(),
    eyeColor: hot.eyeColor || '跟随参考图',
    sheetBg: live.sheetBg,
    sheetBgCustom: live.sheetBgCustom,
  };
  try {
    // 两阶段：先出 Q 版，再以它为参考换出「站姿 / 坐姿」两张。
    const plan = await buildHotChibiPlan({
      state,
      gallery: mounted.gallery,
      hots: [hot.a],
      count: hot.count || 1,
      model: modelForGenerate('热门Q版'),
    });
    await runPlanAsTask(doc, plan, { report, onImage: () => paintLiveRegions(doc) });
    report('已生成热门Q版');
  } catch (error) {
    if (isStopped(error)) report('已停止生成');
    else report(error && error.message ? error.message : '生成失败');
  } finally {
    mounted.generating = false;
    mounted.liveItems = [];
    paintHotPage(doc);
    paintLiveRegions(doc);
  }
}

function render(doc, model) {
  const mounted = mounts.get(doc) || {};
  rememberOpenFines(doc, mounted);
  // 重绘前记住每个滚动容器的位置：innerHTML 清空的瞬间内容高度归零，
  // 浏览器会把 .page 的 scrollTop 钳回 0，用户滚到下面的场景区就被弹回顶部。
  const scrolls = [];
  for (const page of doc.querySelectorAll('.page')) {
    if (page.scrollTop) scrolls.push([page, page.scrollTop]);
  }
  const state = mounted.store && typeof mounted.store.getState === 'function'
    ? mounted.store.getState()
    : {};
  const ctx = {
    names: (state && state.colorNames) || {},
    translating: mounted.translating || new Set(),
    openFines: mounted.openFines,
  };
  const base = doc.getElementById('page-base');
  const detail = doc.getElementById('page-detail');
  const tune = doc.getElementById('page-tune');
  const generate = doc.getElementById('page-generate');
  if (base) base.innerHTML = renderLeft(model.left, ctx);
  if (detail) detail.innerHTML = renderCenter(model.center, {
    closedGroups: mounted.closedGroups || new Set(),
    openMores: mounted.openMores || new Set(),
    ctx,
  });
  if (tune && model.tune) {
    tune.innerHTML = renderTune(model.tune, model.warnings, {
      generating: Boolean(mounted.generating),
      // 微调页的瞬时回显单独放 tuneLive：多个后台任务同时在跑，各自的 step 序号会重号。
      output: outputHtml(mounted.gallery, [...(mounted.liveItems || []), ...(mounted.tuneLive || [])], { onlyKind: '微调角色' }),
      queue: mounted.tuneQueueText || '',
      turnaround: mounted.images && mounted.images.turnaround,
      expressions: mounted.images && mounted.images.expressions,
      handSheet: mounted.images && mounted.images.handSheet,
      tuneGender: state.tuneGender,
      count: tuneCombinations(state).length,
      closedGroups: mounted.closedGroups || new Set(),
      openMores: mounted.openMores || new Set(),
      ctx,
    });
  }
  if (generate) {
    generate.innerHTML = renderRight(model.right, model.warnings, {
      generating: Boolean(mounted.generating),
      output: outputHtml(mounted.gallery, mounted.liveItems, { excludeKind: '微调角色' }),
      baseCount: mounted.baseCount || 4,
      suiteCount: mounted.suiteCount || 1,
      sheetBg: state.sheetBg,
      sheetBgCustom: state.sheetBgCustom,
    });
  }
  const status = doc.getElementById('status');
  if (status) status.textContent = mounted.statusText || '';
  const tuneStatus = doc.getElementById('tune-status');
  if (tuneStatus) tuneStatus.textContent = mounted.tuneStatusText || '';
  // 内容已经重建好，把滚动位置放回去（同一批节点，只是 innerHTML 换了）。
  for (const [page, top] of scrolls) {
    if (page.scrollTop !== top) page.scrollTop = top;
  }
  // 整页已经按当前数据重建过三个出图区，记下签名，下一轮轮询不会再多写一次。
  resetLiveSigs(mounted);
  applyProgress(doc, mounted.progress);
  // 热门Q版页是静态骨架 + 局部同步：这里把预览图/张数/瞳色/按钮门禁对齐一次。
  fillHotSelects(doc);
  paintHotPage(doc);
}

function resetLiveSigs(mounted) {
  if (!mounted) return;
  mounted.liveSigs = {};
  for (const region of LIVE_REGIONS) {
    mounted.liveSigs[region.key] = liveSignature(mounted, region);
  }
}

function setStatus(doc, text) {
  const mounted = mounts.get(doc);
  if (mounted) mounted.statusText = text;
  const status = doc.getElementById('status');
  if (status) status.textContent = text;
}

function setTuneStatus(doc, text) {
  const mounted = mounts.get(doc);
  if (mounted) mounted.tuneStatusText = text;
  const status = doc.getElementById('tune-status');
  if (status) status.textContent = text;
}

// 进度条：fraction 是已完成张数占比，active 表示当前仍有图在生成（显示扫光动画）。
function applyProgress(doc, progress) {
  const mounted = mounts.get(doc);
  let id = 'progress';
  if (mounted && mounted.activeRoute === 'tune') id = 'tune-progress';
  const bar = doc.getElementById(id);
  if (!bar) return;
  if (!progress || !progress.active) {
    bar.hidden = true;
    bar.classList.remove('active', 'pending');
    return;
  }
  bar.hidden = false;
  bar.classList.add('active');
  const fill = bar.querySelector('.progress-fill');
  const fraction = Number.isFinite(progress.fraction) ? progress.fraction : 0;
  const pending = fraction <= 0;
  bar.classList.toggle('pending', pending);
  if (fill) {
    if (pending) fill.style.width = '';
    else fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }
}

function setProgress(doc, { fraction, active, total }) {
  const mounted = mounts.get(doc);
  if (mounted) mounted.progress = { fraction, active, total };
  applyProgress(doc, { fraction, active });
}

// ---------------- 生图 ----------------

const GENERATE_LABELS = {
  '生成基准立绘': '基准立绘',
  '生成三视图': '三视图',
  '生成表情差分图': '表情差分图',
  '生成服饰拆解图': '服饰拆解图',
  '生成手部拆解图': '手部拆解图',
  '生成Q版形象': 'Q版形象',
};

async function startGenerate(doc, label) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  if (!mounted.gallery || typeof mounted.gallery.addBatch !== 'function') return;
  const tuneJob = label === '生成微调角色图集';
  const hasTurnaround = mounted.images.turnaround && String(mounted.images.turnaround).startsWith('data:image/');
  const hasExpressions = mounted.images.expressions && String(mounted.images.expressions).startsWith('data:image/');
  // 微调页不锁界面：提交即返回，多个任务在池 A 里排队，结果由后台轮询并入图库。
  // 所以它的门禁只有上传是否齐，不看 mounted.generating（仍在跑的普通生图也不挡它）。
  if (tuneJob) {
    if (!hasTurnaround || !hasExpressions) {
      const message = !hasTurnaround && !hasExpressions
        ? '请先上传角色三视图和角色表情图集'
        : (!hasTurnaround ? '请先上传角色三视图' : '请先上传角色表情图集');
      setTuneStatus(doc, message);
      showToast(doc, message);
      return;
    }
    await submitTuneQueueTask(doc, resolveBedShoes(doc, mounted.store.getState()));
    return;
  }
  if (mounted.generating) return;
  const report = (text) => setStatus(doc, text);
  // 停止按钮通过它发出取消；服务端会把正在跑的子任务一起掐掉。
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  mounted.abort = controller;
  mounted.stopped = false;
  mounted.generating = true;
  mounted.liveItems = [];
  report('');
  setProgress(doc, { fraction: 0, active: false });
  mounted.paint();

  let total = 1;
  const onProgress = ({ kind, count }) => {
    total = Number.isInteger(count) && count > 0 ? count : 1;
    report(`正在生成${kind}…`);
  };
  const onImage = (item, index) => {
    const shown = Math.min(index + 1, total);
    const complete = shown >= total;
    const text = complete
      ? '已生成'
      : (total > 1 ? `正在生成${item.kind}（${shown}/${total}）` : `正在生成${item.kind}…`);
    report(text);
    // 新图只要刷进下方出图条，不动整页。
    paintLiveRegions(doc);
  };

  const shared = {
    state: mounted.store.getState(),
    gallery: mounted.gallery,
    images: mounted.images,
    fetcher: mounted.fetcher || browserFetcher,
    signal: controller ? controller.signal : null,
  };
  const run = (plan) => runPlanAsTask(doc, plan, {
    report, onProgress, onImage, signal: controller ? controller.signal : null,
  });
  try {
    if (label === '生成完整设定集') {
      if (!mounted.gallery.base()) {
        setStatus(doc, '请先选择合适的基准立绘');
        return;
      }
      const suiteCount = mounted.suiteCount || 1;
      const plan = await buildSuitePlan({ ...shared, suiteCount, model: modelForGenerate('三视图') });
      total = plan.total;
      const result = await run(plan);
      mounted.gallery.select(null);
      const completed = result.batches.length;
      if (result.task.status === 'cancelled') {
        setStatus(doc, completed
          ? `已停止生成，保留已完成的${completed}套`
          : '已停止生成');
      } else {
        setStatus(doc, result.skipped
          ? `已生成${completed}套设定集，有${result.skipped}张被跳过（上游未出图）`
          : `已生成${completed}套设定集`);
      }
    } else {
      const kind = GENERATE_LABELS[label];
      // 服饰拆解图和手部拆解图共用下载页里选定的那组「服饰基准」。
      if (isPairSheet(kind)) {
        const pair = mounted.gallery.clothingPair && mounted.gallery.clothingPair();
        if (!pair || !pair.base || !pair.turnaround) {
          const message = '请先在下载页的服饰基准里选定一组（手部拆解图也用这组输入）';
          setStatus(doc, message);
          showToast(doc, message);
          return;
        }
      }
      const hadBase = Boolean(mounted.gallery.base());
      const plan = await buildKindPlan({
        ...shared,
        kind,
        model: modelForGenerate(kind),
        baseCount: kind === '基准立绘' ? (mounted.baseCount || 4) : undefined,
      });
      total = plan.total;
      await run(plan);
      mounted.gallery.select(null);
      if (kind !== '基准立绘' && !hadBase) {
        report(`已生成${kind}。尚未设定角色基准，本次不会锁定脸。`);
      } else {
        report(`已生成${kind}`);
      }
    }
  } catch (error) {
    if (isStopped(error)) {
      report('已停止生成');
    } else {
      report(error && error.message ? error.message : '生成失败');
    }
  } finally {
    mounted.abort = null;
    mounted.taskId = null;
    mounted.liveItems = [];
    // 停止时不要跳到 100%，进度条停在已完成的位置。
    setProgress(doc, mounted.stopped
      ? { fraction: 0, active: false, total }
      : { fraction: 1, active: false });
    mounted.stopped = false;
    mounted.generating = false;
    mounted.paint();
  }
}

// ---------------- 交互 ----------------

function toggleMulti(state, field, value) {
  if (WU_VALUES.includes(value)) {
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
  if (field === 'handheld' && values.some((item) => item && item !== '无')) {
    const poses = Array.isArray(state.handPose) ? state.handPose : [];
    next.handPose = poses.filter((item) => !BOTH_HANDS.has(item));
  }
  return next;
}

function onClick(doc, event) {
  const mounted = mounts.get(doc);
  if (!mounted || !event.target?.closest) return;

  if (event.target.closest('#fullscreen-close')) {
    closeFullscreen(doc);
    return;
  }
  if (event.target.id === 'fullscreen') {
    closeFullscreen(doc);
    return;
  }
  const outputImg = event.target.closest('#output img, #tune-output img, .tune-preview');
  if (outputImg) {
    openFullscreen(doc, outputImg.getAttribute('src'));
    return;
  }
  const downloadImg = event.target.closest('#download-list .download-row img');
  if (downloadImg) {
    openFullscreen(doc, downloadImg.getAttribute('src'));
    return;
  }

  // 任务队列页：刷新、池筛选、卡片上的取消 / 重试 / 下载 / 展开 / 删除 / 跳转。
  if (event.target.closest('#tasks-refresh')) {
    void refreshTasks(doc);
    return;
  }
  const taskFilter = event.target.closest('[data-task-filter]');
  if (taskFilter) {
    setTaskFilter(doc, taskFilter.dataset.taskFilter);
    return;
  }
  const taskPageBtn = event.target.closest('[data-task-page]');
  if (taskPageBtn) {
    stepTaskPage(doc, taskPageBtn.dataset.taskPage, taskPageBtn.dataset.taskPageStep);
    return;
  }
  const taskCard = event.target.closest('[data-task-id]');
  if (taskCard) {
    const taskId = taskCard.dataset.taskId;
    const task = findTask(doc, taskId);
    if (event.target.closest('[data-task-expand]')) {
      toggleTaskExpanded(doc, taskId);
      return;
    }
    if (event.target.closest('[data-task-cancel]')) {
      void cancelTaskFromUi(doc, taskId);
      return;
    }
    if (event.target.closest('[data-task-retry]')) {
      void retryTaskFromUi(doc, taskId);
      return;
    }
    if (event.target.closest('[data-task-download]')) {
      if (task) void downloadTaskResults(doc, task);
      return;
    }
    if (event.target.closest('[data-task-download-index]')) {
      const index = event.target.closest('[data-task-download-index]').dataset.taskDownloadIndex;
      if (task) void downloadTaskResults(doc, task, index);
      return;
    }
    if (event.target.closest('[data-task-delete]')) {
      void deleteTaskFromUi(doc, taskId);
      return;
    }
    if (event.target.closest('[data-task-goto]')) {
      showPage(doc, routeForTask(task));
      return;
    }
  }

  const accToggle = event.target.closest('[data-accordion-toggle]');
  if (accToggle && !accToggle.disabled) {
    const group = accToggle.closest('[data-group]');
    const title = group ? group.dataset.group : '';
    const open = !group.classList.contains('is-open');
    group.classList.toggle('is-open', open);
    accToggle.setAttribute('aria-expanded', String(open));
    if (open) mounted.closedGroups.delete(title);
    else mounted.closedGroups.add(title);
    return;
  }

  const moreToggle = event.target.closest('[data-more-toggle]');
  if (moreToggle) {
    const more = moreToggle.closest('[data-more]');
    const open = !more.classList.contains('is-open');
    more.classList.toggle('is-open', open);
    moreToggle.setAttribute('aria-expanded', String(open));
    const group = more.closest('[data-group]');
    const title = group ? group.dataset.group : '';
    if (open) mounted.openMores.add(title);
    else mounted.openMores.delete(title);
    return;
  }

  const navItem = event.target.closest('#sidebar [data-route]');
  if (navItem) {
    showPage(doc, navItem.dataset.route);
    return;
  }
  if (event.target.closest('#download-back')) {
    showPage(doc, 'generate');
    return;
  }
  const downloadTab = event.target.closest('[data-download-tab]');
  if (downloadTab) {
    mounted.downloadTab = downloadTab.dataset.downloadTab;
    renderDownloadPanes(doc, mounted.gallery);
    syncDownloadTab(doc, downloadTab.dataset.downloadTab);
    return;
  }
  const baseView = event.target.closest('[data-base-view]');
  if (baseView) {
    const located = locateItem(mounted.gallery, baseView.dataset.baseView);
    if (located) openFullscreen(doc, located.item.dataUrl);
    return;
  }
  const pairImg = event.target.closest('#clothing-pairs img');
  if (pairImg) {
    openFullscreen(doc, pairImg.getAttribute('src'));
    return;
  }
  const clothingPairBtn = event.target.closest('[data-clothing-pair]');
  if (clothingPairBtn) {
    const located = locateItem(mounted.gallery, clothingPairBtn.dataset.clothingPair);
    if (located && located.item.kind === '三视图' && located.batch.base && located.batch.base.dataUrl
      && mounted.gallery && typeof mounted.gallery.setClothingPair === 'function') {
      mounted.gallery.setClothingPair({
        id: located.item.id,
        base: located.batch.base,
        turnaround: located.item,
      });
      renderDownloadPanes(doc, mounted.gallery);
      showToast(doc, '已选定这组服饰基准，仅用于单次服饰拆解图/手部拆解图');
    }
    return;
  }
  const baseCard = event.target.closest('[data-base-select]');
  if (baseCard) {
    const located = locateItem(mounted.gallery, baseCard.dataset.baseSelect);
    if (located && mounted.gallery && typeof mounted.gallery.setBase === 'function') {
      mounted.gallery.setBase(located.item);
      renderBaseSelect(doc, mounted.gallery);
      mounted.paint();
    }
    return;
  }
  const downloadItem = event.target.closest('[data-download-item]');
  if (downloadItem) {
    const located = locateItem(mounted.gallery, downloadItem.dataset.downloadItem);
    if (located) downloadPng(doc, located.item, located.index);
    return;
  }
  const downloadBatch = event.target.closest('[data-download-batch]');
  if (downloadBatch) {
    const batch = galleryBatches(mounted.gallery).find((entry) => entry.id === downloadBatch.dataset.downloadBatch);
    if (batch) void downloadZip(doc, batch);
    return;
  }
  const deleteBatch = event.target.closest('[data-delete-batch]');
  if (deleteBatch) {
    const batch = galleryBatches(mounted.gallery).find((entry) => entry.id === deleteBatch.dataset.deleteBatch);
    if (batch) void deleteGalleryItems(doc, batch.items, () => mounted.gallery.removeBatch(batch.id));
    return;
  }
  const deleteItem = event.target.closest('[data-delete-item]');
  if (deleteItem) {
    const located = locateItem(mounted.gallery, deleteItem.dataset.deleteItem);
    if (located) void deleteGalleryItems(doc, [located.item], () => mounted.gallery.removeItem(located.item.id));
    return;
  }
  const wmView = event.target.closest('[data-wm-view]');
  if (wmView) {
    const item = (mounted.watermarkItems || [])[Number(wmView.dataset.wmView)];
    if (item) openFullscreen(doc, item.dataUrl);
    return;
  }
  const wmDownload = event.target.closest('[data-wm-download]');
  if (wmDownload) {
    const item = (mounted.watermarkItems || [])[Number(wmDownload.dataset.wmDownload)];
    if (item) saveFile(doc, watermarkFileName(item.name), item.dataUrl);
    return;
  }
  const wmRemove = event.target.closest('[data-wm-remove]');
  if (wmRemove) {
    const idx = Number(wmRemove.dataset.wmRemove);
    mounted.watermarkItems = (mounted.watermarkItems || []).filter((_, i) => i !== idx);
    paintWatermark(doc);
    return;
  }
  const wmClear = event.target.closest('[data-wm-clear]');
  if (wmClear) {
    mounted.watermarkItems = [];
    paintWatermark(doc);
    return;
  }
  const wmPack = event.target.closest('[data-wm-pack]');
  if (wmPack) {
    downloadWatermarkZip(doc);
    return;
  }
  const wmVideoView = event.target.closest('[data-wm-video-view]');
  if (wmVideoView) {
    selectWatermarkVideo(doc, Number(wmVideoView.dataset.wmVideoView));
    return;
  }
  const wmVideoExport = event.target.closest('[data-wm-video-export]');
  if (wmVideoExport) {
    if (wmVideoExport.disabled || mounted.watermarkVideoBusy) return;
    void exportWatermarkVideoItem(doc, Number(wmVideoExport.dataset.wmVideoExport), videoWatermarkOpts(mounted));
    return;
  }
  const wmVideoDownload = event.target.closest('[data-wm-video-download]');
  if (wmVideoDownload) {
    downloadWatermarkVideo(doc, Number(wmVideoDownload.dataset.wmVideoDownload));
    return;
  }
  const wmVideoRemove = event.target.closest('[data-wm-video-remove]');
  if (wmVideoRemove) {
    removeWatermarkVideo(doc, Number(wmVideoRemove.dataset.wmVideoRemove));
    return;
  }
  const wmVideoClear = event.target.closest('[data-wm-video-clear]');
  if (wmVideoClear) {
    clearWatermarkVideos(doc);
    return;
  }
  const wmVideoPack = event.target.closest('[data-wm-video-pack]');
  if (wmVideoPack) {
    downloadWatermarkVideoZip(doc);
    return;
  }
  if (event.target.closest('[data-wm-video-export-all]')) {
    void exportAllWatermarkVideos(doc);
    return;
  }
  const wpLink = event.target.closest('#wallpaper-link');
  if (wpLink) {
    mounted.wallpaperLinked = !mounted.wallpaperLinked;
    if (!mounted.wallpaperLinked) {
      // 关闭连接：让各端从当前全局焦点起步，避免切换瞬间跳回中心。
      mounted.wallpaperPlatformFocus = Object.fromEntries(
        WALLPAPER_PLATFORMS.map((p) => [p.id, { ...mounted.wallpaperFocus }])
      );
    }
    syncWallpaperLinkToggle(doc);
    mounted.wallpaperDirty = true;
    return;
  }
  const wpExport = event.target.closest('[data-wp-export]');
  if (wpExport) {
    const platform = WALLPAPER_PLATFORMS.find((p) => p.id === wpExport.dataset.wpExport);
    if (platform) void exportOneWallpaper(doc, platform);
    return;
  }
  if (event.target.closest('#wallpaper-export-all')) {
    void exportAllWallpapers(doc);
    return;
  }
  if (event.target.closest('#wallpaper-cancel')) {
    cancelWallpaperExport(doc);
    return;
  }
  if (event.target.closest('#wallpaper-reset-grading')) {
    mounted.wallpaperParams = defaultGradingParams();
    mounted.wallpaperDirty = true;
    for (const param of GRADING_PARAMS) {
      const input = doc.getElementById(`wp-param-${param.id}`);
      const label = doc.getElementById(`wp-param-${param.id}-label`);
      if (input) input.value = '0';
      if (label) label.textContent = '0';
    }
    return;
  }
  const gradingPreset = event.target.closest('[data-wp-grading-preset]');
  if (gradingPreset) {
    const preset = GRADING_PRESETS.find((p) => p.id === gradingPreset.dataset.wpGradingPreset);
    if (!preset) return;
    mounted.wallpaperParams = { ...defaultGradingParams(), ...preset.params };
    mounted.wallpaperDirty = true;
    // 同步 16 根滑杆与数值标签，让「预设」和「手动微调」用同一份真相。
    for (const param of GRADING_PARAMS) {
      const value = String(mounted.wallpaperParams[param.id] ?? 0);
      const input = doc.getElementById(`wp-param-${param.id}`);
      const label = doc.getElementById(`wp-param-${param.id}-label`);
      if (input) input.value = value;
      if (label) label.textContent = value;
    }
    showToast(doc, `已套用调色预设：${preset.label}`);
    return;
  }
  // 上传区：点虚线框任意位置都能打开选文件（点 label 时交给浏览器原生行为，避免重复弹窗）。
  const wp2Zone = event.target.closest('[data-upload-zone="wallpaper2-source"]');
  if (wp2Zone) {
    const input = doc.getElementById('wallpaper2-source');
    if (input && !event.target.closest('label')) input.click();
    return;
  }
  const wp2Duration = event.target.closest('[data-wp2-duration]');
  if (wp2Duration) {
    const seconds = Number(wp2Duration.dataset.wp2Duration);
    if (WALLPAPER2_DURATIONS.includes(seconds)) mounted.wallpaper2Duration = seconds;
    paintWallpaperFlow(doc);
    return;
  }
  const wp2Model = event.target.closest('[data-wp2-model]');
  if (wp2Model) {
    mounted.wallpaper2Model = wp2Model.dataset.wp2Model;
    paintWallpaperFlow(doc);
    return;
  }
  if (event.target.closest('#wallpaper2-generate') || event.target.closest('#wallpaper2-submit')) {
    void generateWallpaper(doc);
    return;
  }
  if (event.target.closest('#wallpaper2-cancel')) {
    if (mounted.wallpaper2Abort) mounted.wallpaper2Abort.abort();
    return;
  }
  if (event.target.closest('#wallpaper2-process')) {
    void processWallpaperMaster(doc);
    return;
  }
  const batchZone = event.target.closest('[data-upload-zone="wallpaper2-batch-file"]');
  if (batchZone) {
    const input = doc.getElementById('wallpaper2-batch-file');
    if (input && !event.target.closest('label')) input.click();
    return;
  }
  if (event.target.closest('#wallpaper2-batch-start')) {
    void startWallpaperBatch(doc);
    return;
  }
  if (event.target.closest('#wallpaper2-batch-cancel')) {
    if (mounted.wallpaper2BatchAbort) mounted.wallpaper2BatchAbort.abort();
    return;
  }
  const batchSelect = event.target.closest('[data-batch-select]');
  if (batchSelect) {
    selectBatchMaster(doc, batchSelect.dataset.batchSelect);
    return;
  }
  const batchDownload = event.target.closest('[data-batch-download]');
  if (batchDownload) {
    const item = (mounted.wallpaper2Batch || []).find((it) => it.id === batchDownload.dataset.batchDownload);
    if (item) downloadBatchMaster(doc, item);
    return;
  }
  const batchRemove = event.target.closest('[data-batch-remove]');
  if (batchRemove) {
    removeBatchItem(doc, batchRemove.dataset.batchRemove);
    return;
  }
  const { store, images } = mounted;
  if (event.target.closest('#remove-turnaround')) {
    mounted.images.turnaround = null;
    mounted.paint();
    return;
  }
  if (event.target.closest('#remove-expressions')) {
    mounted.images.expressions = null;
    mounted.paint();
    return;
  }
  if (event.target.closest('#remove-handsheet')) {
    mounted.images.handSheet = null;
    mounted.paint();
    return;
  }
  const stopGenerate = event.target.closest('[data-stop]');
  if (stopGenerate) {
    if (stopGenerate.disabled) return;
    if (!mounted.generating || !mounted.abort) return;
    mounted.stopped = true;
    mounted.abort.abort();
    stopGenerate.disabled = true;
    stopGenerate.textContent = '正在停止…';
    return;
  }
  const generate = event.target.closest('[data-generate]');
  if (generate) {
    if (generate.disabled || mounted.generating) return;
    void startGenerate(doc, generate.dataset.generate);
    return;
  }
  const sheetBgBtn = event.target.closest('[data-sheet-bg]');
  if (sheetBgBtn) {
    const live = store.getState();
    store.replace({ ...live, sheetBg: sheetBgBtn.dataset.sheetBg });
    return;
  }
  if (event.target.closest('#hotchibi-generate')) {
    const btn = event.target.closest('#hotchibi-generate');
    if (btn.disabled || mounted.generating) return;
    void startHotChibi(doc);
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
  if (mode === 'clothing') {
    store.replace(applyClothingSelection(state, field, button.dataset.part, value));
    return;
  }
  if (mode === 'single') {
    store.replace({ ...state, [field]: value });
    return;
  }
  if (mode === 'multi') {
    if (field === 'pose') noteBedPoseChoice(doc, state, value);
    const next = toggleMulti(state, field, value);
    if (next) store.replace(next);
  }
}

function wearingShoes(state) {
  const shoes = state && state.shoes;
  if (!shoes || typeof shoes !== 'object') return false;
  // 赤脚（含脚链/足袋等足部装饰）在床姿里仍按赤脚处理。
  if (shoes.skeleton === '赤脚') return false;
  return !isEmptySkeleton('shoes', shoes.skeleton);
}

function confirmKeepShoes(doc) {
  const view = doc.defaultView;
  if (!view || typeof view.confirm !== 'function') return false;
  return view.confirm('当前姿势可能导致鞋具穿模。点「确定」仍穿鞋生成，点「取消」改为赤脚。');
}

// 躺、趴、跪默认赤脚。角色还穿着鞋时先问一次；取消后这组姿势按赤脚写提示词。
function resolveBedShoes(doc, state) {
  const mounted = mounts.get(doc);
  if (!mounted) return false;
  const poses = Array.isArray(state.pose) ? state.pose : [];
  if (!poses.some((pose) => BED_POSES.has(pose))) {
    mounted.bedShoeChoice = undefined;
    return false;
  }
  if (!wearingShoes(state)) {
    mounted.bedShoeChoice = 'barefoot';
    return false;
  }
  if (mounted.bedShoeChoice === 'shoes') return true;
  if (mounted.bedShoeChoice === 'barefoot') return false;
  const keep = confirmKeepShoes(doc);
  mounted.bedShoeChoice = keep ? 'shoes' : 'barefoot';
  return keep;
}

function noteBedPoseChoice(doc, state, value) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const current = Array.isArray(state.pose) ? state.pose : [];
  const turningOn = !current.includes(value);
  if (BED_POSES.has(value) && turningOn) {
    resolveBedShoes(doc, { ...state, pose: [...current, value] });
    return;
  }
  if (turningOn) return;
  const rest = current.filter((pose) => pose !== value);
  if (!rest.some((pose) => BED_POSES.has(pose))) mounted.bedShoeChoice = undefined;
}

// 参考图上传：读成 data URL 后先写入内存，再锁定，使清空的面部字段不被联动补回。
function readImageFile(doc, input, assign) {
  const mounted = mounts.get(doc);
  const file = input.files && input.files[0];
  if (!mounted || !file) return;
  const reader = new doc.defaultView.FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    if (!dataUrl.startsWith('data:image/')) return;
    assign(mounted, dataUrl);
    mounted.paint();
  };
  reader.readAsDataURL(file);
}

function onTurnaroundFile(doc, input) {
  readImageFile(doc, input, (mounted, dataUrl) => {
    mounted.images.turnaround = dataUrl;
  });
}

function onExpressionFile(doc, input) {
  readImageFile(doc, input, (mounted, dataUrl) => {
    mounted.images.expressions = dataUrl;
  });
}

function onHandSheetFile(doc, input) {
  readImageFile(doc, input, (mounted, dataUrl) => {
    mounted.images.handSheet = dataUrl;
  });
}

function onInput(doc, event) {
  const el = event.target;
  if (!el) return;
  const mounted = mounts.get(doc);
  if (!mounted) return;
  if (el.dataset.baseCount !== undefined) {
    mounted.baseCount = Number(el.value);
    const label = el.closest('.base-count')?.querySelector('[data-base-count-label]');
    if (label) label.textContent = `${mounted.baseCount} 张`;
    return;
  }
  if (el.dataset.suiteCount !== undefined) {
    mounted.suiteCount = Number(el.value);
    const label = el.closest('.suite-count')?.querySelector('[data-suite-count-label]');
    if (label) label.textContent = `${mounted.suiteCount} 套`;
    return;
  }
  if (el.id === 'watermark-text') {
    mounted.watermarkText = el.value;
    void reprocessWatermark(doc);
    return;
  }
  if (el.id === 'watermark-alpha') {
    mounted.watermarkAlpha = Number(el.value);
    const label = doc.getElementById('watermark-alpha-label');
    if (label) label.textContent = `${el.value}%`;
    void reprocessWatermark(doc);
    return;
  }
  if (el.id === 'watermark-font-size') {
    mounted.watermarkFontSize = Number(el.value);
    const label = doc.getElementById('watermark-font-size-label');
    if (label) label.textContent = `${el.value}px`;
    void reprocessWatermark(doc);
    return;
  }
  if (el.id === 'watermark-letter-gap') {
    mounted.watermarkLetterGap = Number(el.value);
    const label = doc.getElementById('watermark-letter-gap-label');
    if (label) label.textContent = `${el.value}px`;
    void reprocessWatermark(doc);
    return;
  }
  if (el.id === 'watermark-line-gap') {
    mounted.watermarkLineGap = Number(el.value);
    const label = doc.getElementById('watermark-line-gap-label');
    if (label) label.textContent = `${el.value}px`;
    void reprocessWatermark(doc);
    return;
  }
  // 视频水印参数：只改内存里的数值和标签，不重绘整页，预览循环立刻用新值。
  if (typeof el.id === 'string' && el.id.startsWith('watermark-video-')) {
    updateVideoWatermarkOption(doc, mounted, el);
    return;
  }
  if (el.dataset.wpParam) {
    mounted.wallpaperParams[el.dataset.wpParam] = Number(el.value);
    mounted.wallpaperDirty = true;
    const label = doc.getElementById(`wp-param-${el.dataset.wpParam}-label`);
    if (label) label.textContent = el.value;
    return;
  }
  if (el.id === 'wallpaper-duration') {
    mounted.wallpaperDuration = Number(el.value);
    mounted.wallpaperBases.clear(); // 底图缓存与时长绑定，重建
    const label = doc.getElementById('wallpaper-duration-label');
    if (label) label.textContent = `${el.value}s`;
    return;
  }
}

function onChange(doc, event) {
  const mounted = mounts.get(doc);
  const el = event.target;
  if (!mounted || !el?.dataset) return;
  const { store } = mounted;
  // 下拉走 change，不走 click：放在 onChange 里、且在 mounted 初始化之后才会真的生效。
  if (mounted.hot) {
    if (el.id === 'hotchibi-count') {
      mounted.hot.count = Math.min(4, Math.max(1, Number(el.value) || 1));
      return;
    }
    if (el.id === 'hotchibi-eye') {
      mounted.hot.eyeColor = el.value || '跟随参考图';
      return;
    }
    if (el.id === 'hotchibi-bg') {
      store.replace({ ...store.getState(), sheetBg: el.value || '白' });
      return;
    }
  }
  if (el.dataset.downloadFilter) {
    const picked = el.checked ? el.dataset.downloadFilter : '';
    mounted.downloadFilter = picked === 'tune' || picked === 'suite' ? picked : '';
    renderDownloadList(doc, mounted.gallery, mounted.downloadFilter);
    return;
  }
  if (el.id === 'turnaround-file') {
    onTurnaroundFile(doc, el);
    return;
  }
  if (el.id === 'expression-file') {
    onExpressionFile(doc, el);
    return;
  }
  if (el.id === 'handsheet-file') {
    onHandSheetFile(doc, el);
    return;
  }
  if (el.dataset && el.dataset.sheetBgCustom !== undefined) {
    const live = store.getState();
    const value = String(el.value || '').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(value)) store.replace({ ...live, sheetBg: '自定义', sheetBgCustom: value });
    return;
  }
  if (el.id === 'hotchibi-file-a') {
    const picked = el.files && el.files[0];
    // 清空选择：同一张图再选一次也要能触发 change。
    try { el.value = ''; } catch { /* 只读环境忽略 */ }
    if (picked) void onHotFile(doc, picked);
    return;
  }
  if (el.id === 'watermark-file') {
    void handleWatermarkFiles(doc, Array.from(el.files || []));
    return;
  }
  if (el.id === 'watermark-video-file') {
    handleWatermarkVideoFiles(doc, Array.from(el.files || []));
    // 清空选择，同一个文件再选一次也能触发 change。
    try { el.value = ''; } catch { /* 只读环境忽略 */ }
    return;
  }
  if (el.id === 'wallpaper2-source') {
    // 一个口吃 1~N 张图片或 1 段视频：先同步取出 FileList（清 value 会把它一起清空）。
    const files = Array.from(el.files || []);
    // 清空选择：同一张图再选一次也要能触发 change，否则会被当成「点了没反应」。
    try { el.value = ''; } catch { /* 只读环境忽略 */ }
    void onWallpaper2Files(doc, files);
    return;
  }
  if (el.id === 'wallpaper2-batch-file') {
    const files = Array.from(el.files || []);
    try { el.value = ''; } catch { /* 只读环境忽略 */ }
    void onWallpaper2BatchFiles(doc, files);
    return;
  }
  if (el.dataset.field === 'tuneGender') {
    const tuneGender = el.value === '男' ? '男' : '女';
    store.replace({ ...store.getState(), tuneGender });
    return;
  }
  if (el.dataset.colorInput === 'append') {
    const field = el.dataset.field;
    const state = store.getState();
    const current = Array.isArray(state[field]) ? state[field] : [];
    if (current.includes(el.value)) return;
    store.replace({ ...state, [field]: [...current, el.value], colorPreset: '' });
    void translateAndStore(doc, el.value);
    return;
  }
  if (el.dataset.colorInput === 'clothing') {
    const slot = el.dataset.field;
    const current = store.getState();
    const piece = { ...(current[slot] || {}), color: '自定义', colorCustom: el.value };
    store.replace({ ...current, [slot]: piece });
    void translateAndStore(doc, el.value);
    return;
  }
  if (el.dataset.colorInput === 'value') {
    store.replace({ ...store.getState(), [el.dataset.field]: el.value });
    void translateAndStore(doc, el.value);
    return;
  }
  if (el.tagName === 'SELECT' && el.dataset.field) {
    store.replace({ ...store.getState(), [el.dataset.field]: el.value });
  }
}

// 颜色实时异步翻译：change 后触发，翻译中显示转圈，完成把英文名写入 state.colorNames。
// 已有翻译或正在翻译的 HEX 直接跳过；翻译失败/超时由 translateColorName 内部兜底，绝不抛错。
async function translateAndStore(doc, hex) {
  const mounted = mounts.get(doc);
  if (!mounted) return;
  const norm = normalizeHex(hex);
  if (!norm) return;
  const names = mounted.store.getState().colorNames || {};
  if (names[norm] || mounted.translating.has(norm)) return;
  mounted.translating.add(norm);
  mounted.paint();
  try {
    // 真实模型链路：POST /api/translate-color（qwen3.8-flash -> deepseek-v4.1-flash -> qwen3.7-flash）。
    // 测试可注入 mounted.translate 覆盖；未配置/失败/超时由 translateColorName 内部兜底。
    const englishName = mounted.translate
      ? await mounted.translate(norm)
      : await translateColorName(norm, { fetcher: mounted.translateFetcher || browserFetcher });
    const state = mounted.store.getState();
    const merged = { ...(state.colorNames || {}), [norm]: englishName };
    mounted.store.replace({ ...state, colorNames: merged });
  } catch {
    // translateColorName 内部已兜底，这里只做防御。
  } finally {
    mounted.translating.delete(norm);
    mounted.paint();
  }
}

// ---------------- 主题与重置 ----------------

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

// 拖拽上传：所有带 data-upload-zone 的上传容器都支持把图片拖进去。
// 用 document 级委托，因为这些容器在 render() 时会整段重建，直接绑定会被清掉。
// zone 的 data-upload-zone 值即目标 <input type="file"> 的 id，drop 后赋值并派发 change。
function bindDragUpload(doc) {
  const view = doc.defaultView;
  const depth = new WeakMap();
  const zoneOf = (event) => {
    const target = event && event.target;
    return target && typeof target.closest === 'function'
      ? target.closest('[data-upload-zone]')
      : null;
  };
  const addDepth = (zone, delta) => {
    const next = (depth.get(zone) || 0) + delta;
    depth.set(zone, next);
    zone.classList.toggle('drag-over', next > 0);
  };
  doc.addEventListener('dragenter', (event) => {
    const zone = zoneOf(event);
    if (!zone) return;
    event.preventDefault();
    addDepth(zone, 1);
  });
  doc.addEventListener('dragleave', (event) => {
    const zone = zoneOf(event);
    if (!zone) return;
    addDepth(zone, -1);
  });
  doc.addEventListener('dragover', (event) => {
    const zone = zoneOf(event);
    if (!zone) return;
    event.preventDefault();
  });
  doc.addEventListener('drop', (event) => {
    const zone = zoneOf(event);
    if (!zone) return;
    event.preventDefault();
    depth.set(zone, 0);
    zone.classList.remove('drag-over');
    const zoneId = zone.dataset.uploadZone;
    const files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) return;
    // 壁纸上传口：一个口吃 1~N 张图或 1 段视频，拖入多少张就收多少张。
    if (zoneId === 'wallpaper2-source') {
      void onWallpaper2Files(doc, Array.from(files));
      return;
    }
    // 批量水印区：一次接收多张，直接交给水印流程处理。
    if (zoneId === 'watermark-file') {
      void handleWatermarkFiles(doc, Array.from(files));
      return;
    }
    if (zoneId === 'watermark-video-file') {
      handleWatermarkVideoFiles(doc, Array.from(files));
      return;
    }
    // 批量立绘区：一次接收多张，直接入队。
    if (zoneId === 'wallpaper2-batch-file') {
      void onWallpaper2BatchFiles(doc, Array.from(files));
      return;
    }
    const input = doc.getElementById(zoneId);
    const file = files[0];
    if (!input || !file) return;
    if (typeof view.DataTransfer === 'function') {
      try {
        const dt = new view.DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
      } catch {
        // jsdom 等环境 input.files 只读，忽略即可；真实浏览器走 DataTransfer 赋值。
      }
    }
    input.dispatchEvent(new view.Event('change', { bubbles: true }));
  });
}

// ---------------- 挂载 ----------------

export function mount(doc, { store, gallery, images = { reference: null }, fetcher, streamFetcher, translate, translateFetcher, pollMs } = {}) {
  const record = {
    store, images, gallery, fetcher, streamFetcher, translate, translateFetcher, pollMs,
    statusText: '', tuneStatusText: '', generating: false, progress: { fraction: 0, active: false },
    // 微调页后台队列：任务提交即返回，这里存仍在跟踪的提交与尚未入图库的瞬时回显。
    tuneJobs: [], tuneLive: [], tuneQueueText: '', tunePollTimer: null, liveSigs: {},
    closedGroups: new Set(), openMores: new Set(), openFines: new Set(), activeRoute: 'base', baseCount: 4, suiteCount: 1, downloadTab: 'all', downloadFilter: '',
    translating: new Set(),
    liveItems: [],
    watermarkItems: [], watermarkText: DEFAULT_WATERMARK_TEXT, watermarkAlpha: 18, watermarkBusy: false,
    watermarkFontSize: DEFAULT_WATERMARK_FONT_SIZE, watermarkLetterGap: DEFAULT_WATERMARK_LETTER_GAP, watermarkLineGap: DEFAULT_WATERMARK_LINE_GAP,
    // 视频水印：选项、待处理视频列表、当前预览下标、忙碌/状态文案、预览 rAF 句柄。
    watermarkVideo: { ...DEFAULT_VIDEO_WATERMARK },
    watermarkVideoItems: [], watermarkVideoIndex: 0, watermarkVideoBusy: false,
    watermarkVideoStatus: '', watermarkVideoRaf: 0, watermarkVideoPreview: null, watermarkVideoBatch: false,
    wallpaperSource: null, wallpaperFocus: { ...WALLPAPER_FOCUS_DEFAULT },
    // 连接关系默认关闭：四端各自独立拖拽，避免误拖一处把四个平台全带偏。
    wallpaperLinked: false, wallpaperPlatformFocus: platformFocusDefaults(),
    wallpaperParams: defaultGradingParams(),
    wallpaperDuration: WALLPAPER_DEFAULT_DURATION, wallpaperExporting: false, wallpaperStatus: '',
    wallpaperAbort: null, wallpaperRaf: 0, wallpaperBases: new Map(), wallpaperDirty: true,
    wallpaperSourceId: null, wallpaperExportTaskId: null,
    // 动态壁纸流水线：立绘 → 原片 → 4K/60 母版 → 四端剪辑。
    wallpaper2Source: null, wallpaper2Name: '', wallpaper2Model: WALLPAPER2_DEFAULT_MODEL, wallpaper2Duration: WALLPAPER2_DURATION,
    wallpaper2Busy: false, wallpaper2Abort: null, wallpaper2Status: '', wallpaperSubmitting: false,
    wallpaper2Raw: null, wallpaper2MasterStatus: '', wallpaperMaster: null,
    wallpaper2Batch: [], wallpaper2BatchBusy: false, wallpaper2BatchAbort: null, wallpaper2BatchStatus: '',
    wallpaperSourceName: '',
    hot: { a: null, count: 1, eyeColor: '跟随参考图', status: '' },
    paint: () => {},
  };
  mounts.set(doc, record);
  record.paint = () => render(doc, viewModel(store.getState(), { faceLocked: Boolean(images.reference) }));
  if (doc.documentElement.dataset.workbenchBound !== '1') {
    doc.documentElement.dataset.workbenchBound = '1';
    doc.addEventListener('click', (event) => onClick(doc, event));
    doc.addEventListener('change', (event) => onChange(doc, event));
    doc.addEventListener('input', (event) => onInput(doc, event));
    bindTheme(doc);
    bindReset(doc);
    bindDragUpload(doc);
    bindWallpaper(doc);
    bindWallpaperFlow(doc);
  }
  watchGallery(doc, gallery);
  store.subscribe(record.paint);
  showPage(doc, 'base');
  store.hydrate();
  // 任务在服务端跑：池 B 完成后要自动下载，所以轮询从挂载起就开着（任务队列页渲染同一份数据）。
  startTasksPolling(doc);
  // 只有备份、内存里没有参考图时不保持锁脸：还原面部并立刻落盘。
  const view = doc.defaultView;
  if (!images.reference && view.localStorage.getItem(FACE_BACKUP_KEY) !== null) {
    unlockReference(store, view.localStorage);
    store.flush();
  }
}

// 页面加载时拉取服务端 SQLite 里持久化的历史图片，按批组装回内存图库，
// 让用户下次打开下载页仍能找到之前生成（并已上传 OSS）的图片。
export async function loadHistory(doc, gallery, fetcher = browserFetcher) {
  if (!gallery || typeof gallery.addBatch !== 'function') return 0;
  let data;
  try {
    data = await fetcher('/api/gallery', { method: 'GET' });
  } catch {
    return 0;
  }
  const records = Array.isArray(data) ? data : (data && Array.isArray(data.images) ? data.images : []);
  if (!records.length) return 0;
  const added = loadPersisted(gallery, records);
  const mounted = mounts.get(doc);
  if (mounted) {
    mounted.paint();
    renderDownloadPanes(doc, gallery);
  }
  return added;
}
