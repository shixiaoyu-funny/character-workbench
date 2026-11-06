// 任务队列客户端：提交、轮询、取消、取产物。
//
// 任务的执行方在服务端（server/tasks.py 的两个单线程池），所以这里只做三件事：
// 把步骤计划 POST 上去、定期拉进度、跑完把产物字节取回本地。
// 浏览器刷新或关页不会打断任务，进度只是「看不到」，重新打开任务队列页还在。

export const TASK_POLL_MS = 1000;

// 服务端任务状态：排队 / 执行中 / 完成 / 部分完成 / 失败 / 已取消。
export const TERMINAL_STATUSES = new Set(['done', 'partial', 'failed', 'cancelled']);

export const STATUS_TEXT = {
  queued: '排队中',
  running: '进行中',
  done: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
};

export const POOL_MAIN = 'main';
export const POOL_WALLPAPER = 'wallpaper';

export function isTerminal(task) {
  return Boolean(task && TERMINAL_STATUSES.has(task.status));
}

export function statusText(task) {
  if (!task) return '';
  const base = STATUS_TEXT[task.status] || task.status || '';
  if (task.status === 'running') {
    const pct = Math.round(Number(task.progress) || 0);
    return `${base} ${pct}%`;
  }
  return base;
}

export function taskPercent(task) {
  if (!task) return 0;
  const value = Number(task.progress);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function remainingOf(task) {
  if (!task) return 0;
  const total = Number(task.total) || 0;
  const done = Number(task.done) || 0;
  const failed = Number(task.failed) || 0;
  return Math.max(0, total - done - failed);
}

// 已用时间（墙上时间）：从 created_at 算到 finished_at 或现在，含排队等待。
export function elapsedMs(task, now = Date.now()) {
  if (!task) return 0;
  const created = parseTime(task.created_at) || parseTime(task.started_at);
  if (!created) return 0;
  const ended = parseTime(task.finished_at) || now;
  return Math.max(0, ended - created);
}

// 任务的起点：优先 started_at（真正被 worker 取走的时间），没开始就退回 created_at。
export function startTimeOf(task) {
  return parseTime(task && (task.started_at || task.created_at));
}

// 执行时间：只算 worker 真正在跑的那一段，排队时间不算进去。
// 还没开始的排队任务返回 0，界面上显示 --。
export function runMs(task, now = Date.now()) {
  const started = parseTime(task && task.started_at);
  if (!started) return 0;
  const ended = parseTime(task && task.finished_at) || now;
  return Math.max(0, ended - started);
}

// 预估总时长：只对「同一任务已经跑出一些单位」时给得出，否则返回 null 显示 --。
export function estimateMs(task, now = Date.now()) {
  if (!task) return null;
  const total = Number(task.total) || 0;
  const done = (Number(task.done) || 0) + (Number(task.failed) || 0);
  if (total <= 1 || done <= 0) return null;
  const spent = runMs(task, now);
  if (spent <= 0) return null;
  return Math.round((spent / done) * total);
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// 时间戳显示成本地 `11-03 12:36:12`，一眼能看出这份任务是几点开工的。
export function formatClock(ms) {
  const value = Number(ms) || 0;
  if (!value) return '--';
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function parseTime(text) {
  if (!text) return 0;
  const value = Date.parse(text);
  return Number.isFinite(value) ? value : 0;
}

function doFetchOf(fetchImpl) {
  const impl = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!impl) throw new Error('当前环境不支持 fetch');
  return impl;
}

async function readJson(response) {
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

export async function submitTask(payload, { fetchImpl } = {}) {
  const doFetch = doFetchOf(fetchImpl);
  const response = await doFetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  return data.task;
}

export async function fetchTask(taskId, { fetchImpl } = {}) {
  const doFetch = doFetchOf(fetchImpl);
  const response = await doFetch(`/api/tasks/${encodeURIComponent(taskId)}`);
  const data = await readJson(response);
  return data.task;
}

export async function fetchTasks({ fetchImpl, limit = 200, pool } = {}) {
  const doFetch = doFetchOf(fetchImpl);
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (pool) params.set('pool', pool);
  const query = params.toString();
  const response = await doFetch(`/api/tasks${query ? `?${query}` : ''}`);
  const data = await readJson(response);
  return Array.isArray(data.tasks) ? data.tasks : [];
}

export async function cancelTask(taskId, { fetchImpl } = {}) {
  const doFetch = doFetchOf(fetchImpl);
  const response = await doFetch(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await readJson(response);
  return data.task;
}

export async function deleteTask(taskId, { fetchImpl } = {}) {
  const doFetch = doFetchOf(fetchImpl);
  const response = await doFetch(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  return readJson(response);
}

// 取回提交时的原始载荷：刷新页面后重试失败项要靠它重建步骤（前端不缓存 base64）。
export async function fetchTaskPayload(taskId, { fetchImpl } = {}) {
  const doFetch = doFetchOf(fetchImpl);
  const response = await doFetch(`/api/tasks/${encodeURIComponent(taskId)}/payload`);
  const data = await readJson(response);
  return data.payload || {};
}

const RETRY_STATUSES = new Set(['failed', 'skipped', 'cancelled']);

// 只重跑失败/跳过/取消的步骤，并把 `#N` 依赖改写成新计划的序号。
// 上游不在重试集合里的步骤拿不到参考图，等于无参考出图，直接一起剔掉（连坐）。
export function buildRetryPayload(task, payload = {}) {
  const source = Array.isArray(payload.steps)
    ? payload.steps
    : (Array.isArray(payload.units) ? payload.units : []);
  const stepsOfTask = Array.isArray(task && task.steps) ? task.steps : [];
  const failed = new Set(
    stepsOfTask
      .filter((step) => RETRY_STATUSES.has(step.status))
      .map((step) => Number(step.index)),
  );
  const pickAll = failed.size === 0;
  if (!source.length) {
    const steps = stepsOfTask
      .filter((step) => pickAll || failed.has(Number(step.index)))
      .map((step) => ({ kind: step.kind, title: step.title }));
    return { steps, refs: {}, total: steps.length, key: 'steps' };
  }

  let keep = source.map((step, index) => ({ step, index })).filter((entry) => pickAll || failed.has(entry.index));
  const key = Array.isArray(payload.steps) ? 'steps' : 'units';
  for (;;) {
    const allowed = new Set(keep.map((entry) => entry.index));
    const map = new Map(keep.map((entry, order) => [entry.index, order]));
    const next = [];
    let dropped = false;
    for (const entry of keep) {
      const refs = Array.isArray(entry.step.ref) ? entry.step.ref : [];
      const rewritten = [];
      let ok = true;
      for (const token of refs) {
        const match = /^#(\d+)$/.exec(String(token));
        if (!match) {
          rewritten.push(token);
          continue;
        }
        const target = Number(match[1]);
        if (!allowed.has(target)) {
          ok = false;
          break;
        }
        rewritten.push(`#${map.get(target)}`);
      }
      if (!ok) {
        dropped = true;
        continue;
      }
      next.push({ step: { ...entry.step, ref: rewritten }, index: entry.index });
    }
    keep = next;
    if (!dropped) break;
  }

  const steps = keep.map((entry) => entry.step);
  return { steps, refs: payload.refs || {}, total: steps.length, key };
}

export async function fetchTaskResultBlob(taskId, index, { fetchImpl } = {}) {
  const doFetch = doFetchOf(fetchImpl);
  const response = await doFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/result/${encodeURIComponent(String(index))}`,
  );
  if (!response.ok) throw new Error(`取任务产物失败 (${response.status})`);
  return response.blob();
}

function bytesToBase64(bytes) {
  let binary = '';
  const size = 0x2000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

// 取某个 step 的产物，转成 data URL 直接喂给图库/下载页（它们只认 data:）。
export async function fetchTaskResult(taskId, index, { fetchImpl, mime = 'image/png' } = {}) {
  const doFetch = doFetchOf(fetchImpl);
  const response = await doFetch(
    `/api/tasks/${encodeURIComponent(taskId)}/result/${encodeURIComponent(String(index))}`,
  );
  if (!response.ok) throw new Error(`取任务产物失败 (${response.status})`);
  const buffer = await response.arrayBuffer();
  return `data:${mime};base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

export function sleep(ms) {
  return new Promise((resolve) => {
    const timer = typeof setTimeout === 'function' ? setTimeout : null;
    if (!timer) { resolve(); return; }
    timer(resolve, ms);
  });
}

// 轮询到终态为止。onUpdate 每次拿到最新任务，可用于增量回显。
export async function pollTask(taskId, {
  fetchImpl, interval = TASK_POLL_MS, onUpdate, signal,
} = {}) {
  for (;;) {
    if (signal && signal.aborted) throw abortError();
    const task = await fetchTask(taskId, { fetchImpl });
    if (onUpdate) onUpdate(task);
    if (isTerminal(task)) return task;
    await sleep(interval);
  }
}

function abortError() {
  const error = new Error('已停止');
  error.name = 'AbortError';
  error.stopped = true;
  return error;
}
