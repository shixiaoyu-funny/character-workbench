// 任务队列页的纯渲染层：只把任务对象翻译成 HTML 字符串，不碰 DOM、不发请求。
// 卡片结构固定为「标题 + 状态标签 / 指标 / 进度条 / 操作 / 可展开子项」，
// 这样 dom.js 只负责把字符串塞进容器、把点击路由回动作函数。

import {
  estimateMs, formatClock, formatDuration, isTerminal, parseTime, remainingOf, runMs,
  startTimeOf, taskPercent,
} from './tasks.js';

const POOL_LABEL = {
  main: '生成队列',
  wallpaper: '壁纸处理队列',
};

const TAG_TEXT = {
  queued: '排队中',
  running: '进行中',
  done: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
};

const STEP_STATUS_TEXT = {
  pending: '待执行',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
  cancelled: '已取消',
};

// 注意：这里不能用 dom.js 的 esc（会形成循环依赖），单文件重写一份。
function esc(text) {
  return String(text == null ? '' : text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function taskTagText(task) {
  if (!task) return '';
  const status = displayStatus(task);
  const base = TAG_TEXT[status] || status || '';
  if (status === 'running') return `${base} ${Math.round(taskPercent(task))}%`;
  return base;
}

// 实际展示用的状态：有成功也有失败一律算「部分完成」（黄色），不当整体失败。
// 老数据里这类任务被记成 failed，这里统一纠一遍，不必改库。
export function displayStatus(task) {
  const status = (task && task.status) || 'queued';
  if (status === 'failed' && (Number(task.done) || 0) > 0 && (Number(task.failed) || 0) > 0) {
    return 'partial';
  }
  return status;
}

export function taskPoolLabel(task) {
  return POOL_LABEL[task && task.pool] || (task && task.pool) || '';
}

export function taskMetrics(task, now = Date.now()) {
  const total = Number(task && task.total) || 0;
  const done = Number(task && task.done) || 0;
  const failed = Number(task && task.failed) || 0;
  const skipped = Number(task && task.skipped) || 0;
  return {
    total,
    done,
    failed,
    skipped,
    remaining: remainingOf(task),
    startedAt: startTimeOf(task),
    started: Boolean(task && task.started_at),
    run: runMs(task, now),
    estimate: estimateMs(task, now),
    percent: taskPercent(task),
    unit: (task && task.unit) || '项',
  };
}

function baseName(text, fallback) {
  const cleaned = String(text || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

// 产物文件名：优先用步骤标题（前端提交时就是用户看得懂的名字），
// 但扩展名只认产物本身（result.mp4 / result.png），不能沿用步骤标题里的名字。
// 壁纸任务的步骤标题是用户上传的「微调角色 (2).png」，早先这里直接把标题当文件名返回，
// 4K 视频就被存成了 .png —— 下载下来一串图片名，看起来像「视频丢了」。
const MEDIA_EXT_RE = /\.(mp4|mov|webm|zip|png|jpe?g|webp|gif)$/i;

export function resultFileName(task, index, ext = '') {
  const step = (task && task.steps ? task.steps[index] : null) || null;
  const fallback = `task-${(task && task.id) || 'x'}-${index}`;
  const suffix = String(ext || '').toLowerCase().replace(/^\./, '') || 'png';
  const stem = baseName(step && step.title, fallback).replace(MEDIA_EXT_RE, '').trim() || fallback;
  if (suffix === 'zip') {
    // 四端导出的 zip 是整包产物、没有对应步骤标题，给它一个说得清的名字。
    if (!step && task && task.kind === 'wallpaper-export') return 'wallpaper-60fps.zip';
    return `${stem}.zip`;
  }
  if (suffix === 'mp4' && task && task.kind === 'wallpaper-batch') return `${stem}-4k-60fps.mp4`;
  return `${stem}.${suffix}`;
}

// 一个任务里所有可下载的产物。四端导出会把 4 个 mp4 打成 zip，
// 这时只暴露 zip，避免用户点一次下载弹 5 个文件。
export function taskDownloadEntries(task) {
  if (!task || !isTerminal(task)) return [];
  const results = Array.isArray(task.results) ? task.results : [];
  if (!results.length) return [];
  const entries = results.map((entry) => ({
    index: Number(entry.index) || 0,
    ext: String(entry.ext || 'mp4').toLowerCase(),
  }));
  const hasZip = entries.some((entry) => entry.ext === 'zip');
  return entries
    .filter((entry) => !hasZip || entry.ext === 'zip')
    .sort((a, b) => a.index - b.index)
    .map((entry) => ({
      ...entry,
      filename: resultFileName(task, entry.index, entry.ext),
    }));
}

export function canRetry(task) {
  if (!task) return false;
  if (!['partial', 'failed', 'cancelled'].includes(task.status)) return false;
  return (task.steps || []).some((step) => ['failed', 'skipped', 'cancelled'].includes(step.status));
}

function renderMetrics(task, metrics) {
  const estimate = metrics.estimate == null ? '--' : formatDuration(metrics.estimate);
  const unit = esc(metrics.unit);
  const cells = [
    ['总数', `${metrics.total} ${unit}`],
    ['已完成', String(metrics.done)],
    ['剩余', String(metrics.remaining)],
    ['失败', String(metrics.failed)],
    ['开始时间', formatClock(metrics.startedAt)],
    ['执行时间', metrics.started ? formatDuration(metrics.run) : '--'],
    ['预估', estimate],
  ];
  return `<dl class="task-metrics">${cells.map(([label, value]) => `
    <div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
  </dl>`;
}

function renderSteps(task, expanded) {
  const steps = task.steps || [];
  if (!steps.length) return '';
  const rows = steps.map((step) => {
    const status = step.status || 'pending';
    const label = STEP_STATUS_TEXT[status] || status;
    const title = step.title || `第 ${Number(step.index) + 1} 项`;
    const note = step.error || step.message || '';
    const download = status === 'done'
      ? `<button type="button" class="mini-btn" data-task-download-index="${esc(step.index)}">下载</button>`
      : '';
    const link = step.url
      ? `<a class="task-step-link" href="${esc(step.url)}" target="_blank" rel="noreferrer">原图</a>`
      : '';
    return `<li class="task-step" data-step-status="${esc(status)}">
      <span class="task-step-index">${Number(step.index) + 1}</span>
      <span class="task-step-title" title="${esc(title)}">${esc(title)}</span>
      <span class="task-step-status">${esc(label)}</span>
      ${note ? `<span class="task-step-note">${esc(note)}</span>` : ''}
      ${link}${download}
    </li>`;
  }).join('');
  return `<ol class="task-steps"${expanded ? '' : ' hidden'}>${rows}</ol>`;
}

export function renderTaskCard(task, { now = Date.now(), expanded = false, busy = false } = {}) {
  const metrics = taskMetrics(task, now);
  const status = displayStatus(task);
  const percent = Math.max(0, Math.min(100, metrics.percent));
  const entries = taskDownloadEntries(task);
  const terminal = isTerminal(task);
  const actions = [];
  if (!terminal) {
    actions.push(`<button type="button" class="mini-btn" data-task-cancel${busy ? ' disabled' : ''}>取消</button>`);
  }
  if (canRetry(task)) {
    actions.push(`<button type="button" class="mini-btn" data-task-retry${busy ? ' disabled' : ''}>重试失败</button>`);
  }
  if (entries.length) {
    actions.push(`<button type="button" class="mini-btn" data-task-download>下载${entries.length > 1 ? ` (${entries.length})` : ''}</button>`);
  }
  if (terminal) {
    actions.push(`<button type="button" class="mini-btn" data-task-delete${busy ? ' disabled' : ''}>删除</button>`);
  }
  actions.push('<button type="button" class="mini-btn" data-task-goto>去所属页</button>');

  // 部分完成自己算一句准确的话：老数据里的 message 可能还写着「全部失败」。
  let message = '';
  if (status === 'partial') {
    message = `部分完成：${metrics.done} 成功 / ${metrics.failed} 失败`
      + (metrics.skipped ? ` / ${metrics.skipped} 跳过` : '')
      + (task.error ? `（${task.error}）` : '');
  } else if (task.error) {
    message = task.error;
  } else if (status === 'running') {
    message = task.message || '';
  }
  return `<article class="task-card" data-task-id="${esc(task.id)}" data-status="${esc(status)}" data-pool="${esc(task.pool || '')}">
    <header class="task-card-head">
      <div class="task-card-title">
        <span class="task-pool">${esc(taskPoolLabel(task))}</span>
        <h3>${esc(task.title || task.kind || '任务')}</h3>
      </div>
      <span class="task-tag task-tag--${esc(status)}">${esc(taskTagText(task))}</span>
    </header>
    ${renderMetrics(task, metrics)}
    <div class="task-progress" role="progressbar" aria-valuenow="${Math.round(percent)}" aria-valuemin="0" aria-valuemax="100">
      <div class="task-progress-bar" style="width:${percent.toFixed(1)}%"></div>
    </div>
    <div class="task-card-foot">
      <button type="button" class="mini-btn" data-task-expand aria-expanded="${expanded ? 'true' : 'false'}">${expanded ? '收起 ▴' : '展开 ▾'}</button>
      <div class="task-actions">${actions.join('')}</div>
    </div>
    ${message ? `<p class="task-message">${esc(message)}</p>` : ''}
    ${renderSteps(task, expanded)}
  </article>`;
}

// 任务列表分成三栏：跑完的（含部分完成）、全部失败、还在队列里。
// 每栏各自分页，栏内按时间倒序（最新的在最上面）。
export const TASK_GROUPS = [
  { id: 'finished', label: '已完成 / 部分完成', empty: '这一栏还没有跑完的任务。' },
  { id: 'failed', label: '全部失败', empty: '没有失败的任务。' },
  { id: 'active', label: '正在队列中', empty: '队列是空的。' },
];

export const TASK_PAGE_SIZE = 5;

export function taskGroupOf(task) {
  const status = displayStatus(task);
  if (status === 'done' || status === 'partial') return 'finished';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'queued' || status === 'running') return 'active';
  // 未知状态按终态处理：宁可落到失败栏，也别永远挂在「正在队列中」。
  return isTerminal(task) ? 'failed' : 'active';
}

// 时间倒序、最新的在前。排序键用提交时间（created_at），
// 服务端已按它倒序给了一次，这里再稳排一遍，兜住内存任务与库记录合并后的乱序。
export function sortTasksNewestFirst(tasks) {
  const list = Array.isArray(tasks) ? tasks.slice() : [];
  const key = (task) => parseTime(task && task.created_at) || startTimeOf(task) || 0;
  return list.sort((a, b) => key(b) - key(a));
}

export function paginateTasks(list, page = 1, size = TASK_PAGE_SIZE) {
  const items = Array.isArray(list) ? list : [];
  const per = Math.max(1, Math.floor(Number(size) || TASK_PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(items.length / per));
  const current = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pages);
  const start = (current - 1) * per;
  return { items: items.slice(start, start + per), page: current, pages, total: items.length };
}

function setsOf(expanded, busy) {
  return {
    expanded: expanded instanceof Set ? expanded : new Set(expanded || []),
    busy: busy instanceof Set ? busy : new Set(busy || []),
  };
}

function renderPager(group, paged) {
  if (paged.pages <= 1) return '';
  const prev = paged.page <= 1 ? ' disabled' : '';
  const next = paged.page >= paged.pages ? ' disabled' : '';
  return `<div class="task-pager">
      <button type="button" class="mini-btn" data-task-page="${esc(group.id)}" data-task-page-step="-1"${prev}>上一页</button>
      <span class="task-pager-info">${paged.page} / ${paged.pages}</span>
      <button type="button" class="mini-btn" data-task-page="${esc(group.id)}" data-task-page-step="1"${next}>下一页</button>
    </div>`;
}

export function renderTaskBoard(tasks, {
  now = Date.now(), expanded, busy, filter = 'all', pages = {}, pageSize = TASK_PAGE_SIZE,
} = {}) {
  const { expanded: expandedSet, busy: busySet } = setsOf(expanded, busy);
  const visible = sortTasksNewestFirst(tasks)
    .filter((task) => !filter || filter === 'all' || task.pool === filter);
  const buckets = { finished: [], failed: [], active: [] };
  for (const task of visible) buckets[taskGroupOf(task)].push(task);

  // 一栏都没东西才算「还没有任务」，否则空栏只给自己的简短提示。
  const boardEmpty = Array.isArray(tasks) && tasks.length
    ? '<p class="task-empty">这个队列暂时没有任务，切到「全部」看看。</p>'
    : '<p class="task-empty">还没有任务。生成、微调走生成队列，动态壁纸走壁纸处理队列，提交后都会出现在这里。</p>';

  const columns = TASK_GROUPS.map((group) => {
    const paged = paginateTasks(buckets[group.id], pages[group.id], pageSize);
    const body = paged.items.length
      ? paged.items.map((task) => renderTaskCard(task, {
        now,
        expanded: expandedSet.has(task.id),
        busy: busySet.has(task.id),
      })).join('')
      : `<p class="task-empty">${esc(group.empty)}</p>`;
    return `<section class="task-column" data-group="${esc(group.id)}">
      <header class="task-column-head">
        <h4>${esc(group.label)}</h4>
        <span class="task-column-count">${paged.total}</span>
      </header>
      <div class="task-column-body">${body}</div>
      ${renderPager(group, paged)}
    </section>`;
  }).join('');

  if (!visible.length) {
    return `<div class="task-board task-board--empty">${boardEmpty}</div>`;
  }
  return `<div class="task-board">${columns}</div>`;
}

// 任务归属哪个页面，供「去所属页」按钮跳转。
export function routeForTask(task) {
  if (!task) return 'tasks';
  if (task.kind === 'wallpaper-batch' || task.kind === 'wallpaper-export') return 'wallpaper';
  if (task.kind === 'image') {
    const title = String(task.title || '');
    if (title.includes('微调')) return 'tune';
    if (title.includes('热门Q版')) return 'hotchibi';
    return 'generate';
  }
  return 'generate';
}
