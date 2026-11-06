import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TASK_GROUPS, paginateTasks, renderTaskBoard, renderTaskCard, resultFileName,
  sortTasksNewestFirst, taskDownloadEntries, taskGroupOf, taskTagText,
} from '../src/taskview.js';

// 壁纸任务的步骤标题就是用户上传的原图名（「微调角色 (2).png」），
// 但产物是 4K mp4。曾经这里直接沿用标题当文件名，视频被存成 .png，
// 下载目录里一串图片名字，看起来像「视频没生成」。
test('wallpaper-batch 的 mp4 产物不会被存成 .png', () => {
  const task = {
    id: 't1',
    kind: 'wallpaper-batch',
    status: 'done',
    steps: [{ index: 0, title: '微调角色 (2).png' }],
    results: [{ index: 0, ext: 'mp4' }],
  };
  const [entry] = taskDownloadEntries(task);
  assert.equal(entry.ext, 'mp4');
  assert.equal(entry.filename, '微调角色 (2)-4k-60fps.mp4');
  assert.ok(entry.filename.endsWith('.mp4'));
});

test('出图任务的 png 产物保留原图名', () => {
  assert.equal(
    resultFileName({ id: 't2', kind: 'image', steps: [{ title: '微调角色.png' }] }, 0, 'png'),
    '微调角色.png',
  );
});

test('标题里的扩展名不会压过真实产物类型', () => {
  assert.equal(
    resultFileName({ id: 't3', kind: 'image', steps: [{ title: 'a.webp' }] }, 0, 'png'),
    'a.png',
  );
  assert.equal(
    resultFileName({ id: 't4', kind: 'wallpaper-batch', steps: [{ title: 'a.png' }] }, 0, 'mp4'),
    'a-4k-60fps.mp4',
  );
});

test('四端导出的 zip 有固定可读的名字', () => {
  const task = {
    id: 't5',
    kind: 'wallpaper-export',
    status: 'done',
    steps: [{ index: 0, title: 'p0' }],
    results: [{ index: 0, ext: 'mp4' }, { index: 1, ext: 'zip' }],
  };
  const entries = taskDownloadEntries(task);
  // 有 zip 时只暴露 zip，避免点一次下载弹 5 个文件。
  assert.equal(entries.length, 1);
  assert.equal(entries[0].filename, 'wallpaper-60fps.zip');
});

test('步骤标题为空时用任务 id 兜底且扩展名正确', () => {
  assert.equal(
    resultFileName({ id: 'abc', kind: 'wallpaper-batch', steps: [] }, 2, 'mp4'),
    'task-abc-2-4k-60fps.mp4',
  );
});

function taskFixture(id, status, createdAt, extra = {}) {
  return {
    id,
    kind: 'image',
    pool: 'main',
    status,
    total: 2,
    done: status === 'done' ? 2 : 0,
    failed: status === 'failed' ? 2 : 0,
    created_at: createdAt,
    started_at: createdAt,
    finished_at: null,
    steps: [{ index: 0, title: `${id}-a`, status: 'done' }],
    results: [],
    ...extra,
  };
}

test('三栏按状态分组：部分完成算「已完成」，取消算失败栏，排队/进行中算队列', () => {
  assert.equal(taskGroupOf({ status: 'done' }), 'finished');
  assert.equal(taskGroupOf({ status: 'partial' }), 'finished');
  assert.equal(taskGroupOf({ status: 'failed' }), 'failed');
  assert.equal(taskGroupOf({ status: 'cancelled' }), 'failed');
  assert.equal(taskGroupOf({ status: 'queued' }), 'active');
  assert.equal(taskGroupOf({ status: 'running' }), 'active');
  assert.deepEqual(TASK_GROUPS.map((group) => group.id), ['finished', 'failed', 'active']);
});

test('任务按提交时间倒序，最新的排在最前面', () => {
  const older = taskFixture('old', 'done', '2026-11-03T02:00:00+00:00');
  const newer = taskFixture('new', 'failed', '2026-11-03T05:00:00+00:00');
  const middle = taskFixture('mid', 'running', '2026-11-03T03:30:00.250+00:00');
  assert.deepEqual(
    sortTasksNewestFirst([older, newer, middle]).map((task) => task.id),
    ['new', 'mid', 'old'],
  );
  // 不就地改动传入数组
  const source = [older, newer];
  sortTasksNewestFirst(source);
  assert.deepEqual(source.map((task) => task.id), ['old', 'new']);
});

test('分页把任务切成每页固定条数，页码越界自动夹回边界', () => {
  const list = Array.from({ length: 12 }, (_, i) => taskFixture(`t${i}`, 'done', `2026-11-03T0${i % 9}:00:00+00:00`));
  const first = paginateTasks(list, 1, 5);
  assert.equal(first.items.length, 5);
  assert.equal(first.pages, 3);
  assert.equal(first.total, 12);
  assert.equal(paginateTasks(list, 3, 5).items.length, 2);
  assert.equal(paginateTasks(list, 99, 5).page, 3);
  assert.equal(paginateTasks(list, 0, 5).page, 1);
});

test('看板把任务分到三栏，并带上开始时间与执行时间', () => {
  const html = renderTaskBoard([
    taskFixture('a', 'done', '2026-11-03T04:00:00+00:00', {
      started_at: '2026-11-03T04:00:10+00:00',
      finished_at: '2026-11-03T04:01:40+00:00',
    }),
    taskFixture('b', 'partial', '2026-11-03T05:00:00+00:00'),
    taskFixture('c', 'failed', '2026-11-03T06:00:00+00:00'),
    taskFixture('d', 'running', '2026-11-03T07:00:00+00:00'),
  ]);
  assert.match(html, /data-group="finished"/);
  assert.match(html, /data-group="failed"/);
  assert.match(html, /data-group="active"/);
  assert.match(html, /开始时间/);
  assert.match(html, /执行时间/);
  // 90 秒的执行时间只算 worker 真正在跑的那一段
  assert.match(html, /00:01:30/);
  // 部分完成用黄色标签，不是红色
  assert.match(html, /task-tag--partial/);
});

test('有成功也有失败的任务一律按黄色「部分完成」展示，哪怕库里记的是 failed', () => {
  const legacy = taskFixture('legacy', 'failed', '2026-11-03T04:00:00+00:00', {
    total: 2, done: 1, failed: 1,
    message: '全部失败（1）',
    error: '百炼视频任务失败（FAILED）',
  });
  assert.equal(taskGroupOf(legacy), 'finished');
  assert.equal(taskTagText(legacy), '部分完成');
  const html = renderTaskCard(legacy);
  assert.match(html, /data-status="partial"/);
  assert.match(html, /task-tag--partial/);
  // 不再沿用库里那句错的「全部失败」
  assert.doesNotMatch(html, /全部失败/);
  assert.match(html, /部分完成：1 成功 \/ 1 失败/);

  // 真的一件都没成功，才留在失败栏
  const allFailed = taskFixture('all', 'failed', '2026-11-03T05:00:00+00:00', { done: 0, failed: 2 });
  assert.equal(taskGroupOf(allFailed), 'failed');
  assert.equal(taskTagText(allFailed), '失败');
});

test('看板按池筛选，只在对应栏里出现该池的任务', () => {
  const wall = taskFixture('w', 'done', '2026-11-03T04:00:00+00:00', { pool: 'wallpaper' });
  const gen = taskFixture('g', 'done', '2026-11-03T05:00:00+00:00');
  assert.doesNotMatch(renderTaskBoard([wall, gen], { filter: 'wallpaper' }), /data-task-id="g"/);
  assert.match(renderTaskBoard([wall, gen], { filter: 'wallpaper' }), /data-task-id="w"/);
});

test('超过一页时出现翻页按钮，页码指示当前栏的位置', () => {
  const many = Array.from({ length: 7 }, (_, i) => taskFixture(
    `t${i}`, 'done', `2026-11-03T0${i}:00:00+00:00`,
  ));
  const html = renderTaskBoard(many, { pages: { finished: 2 } });
  assert.match(html, /data-task-page="finished" data-task-page-step="-1"/);
  assert.match(html, /2 \/ 2/);
  assert.match(html, /data-task-id="t0"/, '第 2 页只剩最早的两条');
  assert.doesNotMatch(html, /data-task-id="t6"/, '第 1 页的任务不该出现在第 2 页');
});
