import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WALLPAPER2_MODELS,
  WALLPAPER2_DEFAULT_MODEL,
  WALLPAPER2_DURATION,
  WALLPAPER2_DURATIONS,
  WALLPAPER2_RESOLUTION,
  WALLPAPER2_RATIO,
  WALLPAPER2_UPSCALE_SCALE,
  WALLPAPER2_NEGATIVE_PROMPT,
  buildWallpaper2Prompt,
  runAsyncVideoJob,
  generateWallpaper2Video,
  interpolateWallpaper2Video,
  lockWallpaper2Colors,
} from '../src/wallpaper2.js';

test('model list is the wan3.0 family and never turbo', () => {
  assert.ok(WALLPAPER2_MODELS.some((m) => m.id === 'wan3.0-video-prime'));
  assert.ok(WALLPAPER2_MODELS.some((m) => m.id === 'wan3.0-video'));
  // 已下线的 hallucinated ID 不应再出现。
  assert.ok(!WALLPAPER2_MODELS.some((m) => m.id === 'wan2.1-flf2v'));
  for (const m of WALLPAPER2_MODELS) {
    assert.ok(!/turbo/i.test(m.id), `${m.id} must not be a turbo model`);
    assert.ok(/^wan3\.0-/.test(m.id), `${m.id} must be a wan3.0 model`);
  }
});

test('default model is the wan3.0 fast edition with 720P adaptive framing', () => {
  assert.equal(WALLPAPER2_DEFAULT_MODEL, 'wan3.0-video-prime');
  assert.equal(WALLPAPER2_RESOLUTION, '720P');
  assert.equal(WALLPAPER2_RATIO, 'adaptive');
});

test('默认循环固定为 6 秒的柔性周期，2 秒已移除', () => {
  // 全身重心一个来回 ≈ 6~10 秒；周期越长，同样的位移需要越慢的速度，越「柔」。
  assert.equal(WALLPAPER2_DURATION, 6);
  // 已固定 6 秒，不再提供 4/8 让用户选，保证呼吸节奏与眨眼时机每次都一致。
  assert.deepEqual(WALLPAPER2_DURATIONS, [6]);
  assert.ok(WALLPAPER2_DURATIONS.includes(WALLPAPER2_DURATION));
  // 2 秒会把呼吸压成 30 次/分，正是旧版机械感的来源，不再提供。
  assert.ok(!WALLPAPER2_DURATIONS.includes(2));
});

test('idle prompt 锁死一镜到底与「一条传导链」', () => {
  const { prompt } = buildWallpaper2Prompt(6);
  // 万相 3.0 用「生成单镜头」控制一镜到底（2.7 起不再有 shot_type 参数）。
  assert.ok(prompt.includes('生成单镜头'));
  assert.ok(prompt.includes('一镜到底'));
  assert.ok(prompt.includes('固定机位'));
  // 核心：不是「呼吸 + 眨眼 + 发丝」三个并列事件，而是一条连续的力。
  assert.ok(prompt.includes('整段只有一条连续的力'));
  assert.ok(prompt.includes('整段只走完一个循环'));
  assert.ok(prompt.includes('天然闭环'));
  // 首尾速度也要连续，否则循环边界会「跳」一下。
  assert.ok(prompt.includes('首尾处的运动速度'));
});

test('振幅阶梯必须从脚底逐级放大到发梢', () => {
  const { prompt } = buildWallpaper2Prompt(6);
  assert.ok(prompt.includes('位移从上到下逐级放大'));
  // 六级约束都在：脚 / 膝 / 髋 / 胸肩 / 头 / 手臂 / 发梢衣摆。
  for (const part of ['脚与脚踝', '膝关节', '髋与腰', '脊柱与胸腔', '颈与头', '手', '头发、发梢、衣摆']) {
    assert.ok(prompt.includes(part), `振幅阶梯缺少 ${part}`);
  }
  // 传导有先后、逐级衰减——这是「柔」而不是「一起晃」的关键。
  assert.ok(prompt.includes('传导与物理'));
  assert.ok(prompt.includes('逐级衰减'));
  // 钟摆式匀速对称摆动会被看成机械，必须显式排除。
  assert.ok(prompt.includes('钟摆'));
});

test('提示词单独锁死色彩与光影，防止逐帧亮度呼吸', () => {
  const { prompt } = buildWallpaper2Prompt(6);
  assert.ok(prompt.includes('色彩与光影锁定'));
  assert.ok(prompt.includes('曝光'));
  assert.ok(prompt.includes('白平衡'));
  assert.ok(prompt.includes('亮度呼吸'));
  // 动作幅度再小，只要整体明暗在动，眼睛一样会觉得假。
  assert.ok(prompt.includes('主光方向'));
});

test('呼吸与眨眼时刻跟着时长缩放，眨眼固定在 2/3 处并避开首尾帧', () => {
  const short = buildWallpaper2Prompt(4);
  assert.ok(short.prompt.includes('周期等于整段 4 秒'));
  // 6 秒：吸气 2 秒 / 呼气 2.6 秒，呼气必须比吸气长。
  const six = buildWallpaper2Prompt(6).prompt;
  assert.ok(six.includes('吸气约 2 秒'));
  assert.ok(six.includes('呼气约 2.6 秒'));
  // 眨眼固定在三分之二处（6 秒 → 4 秒）；贴近循环边界会变成可见的节拍点。
  assert.ok(six.includes('t = 4s of 6s'));
  assert.ok(six.includes('2/3 point of the clip'));
  // 4 秒 → 2.7 秒；8 秒 → 5.3 秒，都随 duration 缩放，不会串档。
  assert.ok(buildWallpaper2Prompt(4).prompt.includes('t = 2.7s of 4s'));
  assert.ok(buildWallpaper2Prompt(8).prompt.includes('t = 5.3s of 8s'));
});

test('嘴部被锁死：形变/开合/表情变化/口型全部禁止', () => {
  const { prompt, negativePrompt } = buildWallpaper2Prompt(6);
  // 正向：嘴部锁定是独立的高优先级段落，且明确「每帧与参考图一致」。
  assert.ok(prompt.includes('FACIAL LOCK — MOUTH REGION'));
  assert.ok(prompt.includes('visually identical to the reference illustration'));
  // 不留任何开合/表情/口型空间。
  assert.ok(prompt.includes('no jaw opening or closing'));
  assert.ok(prompt.includes('Zero mouth expression change'));
  assert.ok(prompt.includes('No speech, no lip-sync'));
  // 呼吸不能传导到嘴/下颌。
  assert.ok(prompt.includes('never propagate into the mouth'));
  // 眨眼只允许一次，且明确禁止二次眨眼与眼球游移。
  assert.ok(prompt.includes('Exactly one single blink'));
  assert.ok(prompt.includes('No double blink'));
  assert.ok(prompt.includes('no gaze drift'));
  // 时序稳定段存在，保证成片不抖不跳。
  assert.ok(prompt.includes('TEMPORAL STABILITY'));
  assert.ok(prompt.includes('no identity drift'));
  // 负向也要封住嘴部与逐帧重绘。
  assert.ok(negativePrompt.includes('嘴部形变'));
  assert.ok(negativePrompt.includes('嘴唇开合'));
  assert.ok(negativePrompt.includes('逐帧重绘'));
});

test('negative list 覆盖机械重复、钟摆、色彩漂移与亮度跳变', () => {
  assert.ok(WALLPAPER2_NEGATIVE_PROMPT.includes('多镜头'));
  assert.ok(WALLPAPER2_NEGATIVE_PROMPT.includes('夸张肢体动作'));
  assert.ok(WALLPAPER2_NEGATIVE_PROMPT.includes('机械式周期性重复同一个动作'));
  assert.ok(WALLPAPER2_NEGATIVE_PROMPT.includes('钟摆式匀速摆动'));
  assert.ok(WALLPAPER2_NEGATIVE_PROMPT.includes('亮度忽明忽暗'));
  assert.ok(WALLPAPER2_NEGATIVE_PROMPT.includes('色彩漂移'));
  assert.ok(WALLPAPER2_NEGATIVE_PROMPT.includes('水印'));
});

test('buildWallpaper2Prompt 返回正向文案与同一份负向清单', () => {
  const { prompt, negativePrompt } = buildWallpaper2Prompt();
  assert.equal(negativePrompt, WALLPAPER2_NEGATIVE_PROMPT);
  assert.equal(buildWallpaper2Prompt(WALLPAPER2_DURATION).prompt, prompt);
});

function fakeFetchImpl(text = 'FAKE-VIDEO') {
  return async () => ({
    ok: true,
    blob: async () => new Blob([text], { type: 'video/mp4' }),
  });
}

test('runAsyncVideoJob creates, polls, then downloads the result blob', async () => {
  const posts = [];
  const fetcher = async (url, init) => {
    posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('/api/job/status')) return { status: 'done' };
    return { taskId: 't1' };
  };
  const blob = await runAsyncVideoJob({
    createPath: '/api/job',
    statusPath: '/api/job/status',
    resultPath: '/api/job/result',
    body: { a: 1 },
    fetcher,
    fetchImpl: fakeFetchImpl(),
    pollMs: 1,
  });
  assert.equal(await blob.text(), 'FAKE-VIDEO');
  assert.equal(posts[0].url, '/api/job');
  assert.deepEqual(posts[0].body, { a: 1 });
  assert.ok(posts.some((p) => p.url.startsWith('/api/job/status')));
});

test('runAsyncVideoJob rejects on an error status', async () => {
  const fetcher = async (url) => {
    if (url.startsWith('/api/job/status')) return { status: 'error', error: 'boom' };
    return { taskId: 't1' };
  };
  await assert.rejects(
    () =>
      runAsyncVideoJob({
        createPath: '/api/job',
        statusPath: '/api/job/status',
        resultPath: '/api/job/result',
        body: {},
        fetcher,
        fetchImpl: fakeFetchImpl(),
        pollMs: 1,
      }),
    /boom/,
  );
});

test('generateWallpaper2Video sends the idle prompt, a 6s soft loop, and the image as both frames', async () => {
  const posts = [];
  const fetcher = async (url, init) => {
    posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('/api/video-gen/status')) return { status: 'done' };
    return { taskId: 't1' };
  };
  await generateWallpaper2Video({
    imageDataUrl: 'data:image/png;base64,AAAA',
    model: 'wan3.0-video-prime',
    fetcher,
    fetchImpl: fakeFetchImpl(),
    pollMs: 1,
  });
  const body = posts[0].body;
  assert.equal(posts[0].url, '/api/video-gen');
  assert.equal(body.prompt, buildWallpaper2Prompt(WALLPAPER2_DURATION).prompt);
  assert.equal(body.negativePrompt, WALLPAPER2_NEGATIVE_PROMPT);
  assert.equal(body.duration, 6);
  assert.equal(body.model, 'wan3.0-video-prime');
  assert.equal(body.resolution, '720P');
  assert.equal(body.ratio, 'adaptive');
  assert.equal(body.audio, false);
  // 旧的 parameters.size 字段已经不在新接口里。
  assert.equal('size' in body, false);
  assert.equal(body.imageDataUrl, 'data:image/png;base64,AAAA');
});

test('提示词里的秒数必须跟着 duration 参数走', async () => {
  const posts = [];
  const fetcher = async (url, init) => {
    posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('/api/video-gen/status')) return { status: 'done' };
    return { taskId: 't1' };
  };
  await generateWallpaper2Video({
    imageDataUrl: 'data:image/png;base64,AAAA',
    duration: 8,
    fetcher,
    fetchImpl: fakeFetchImpl(),
    pollMs: 1,
  });
  assert.equal(posts[0].body.duration, 8);
  assert.ok(posts[0].body.prompt.includes('周期等于整段 8 秒'));
});

test('interpolateWallpaper2Video targets 60 FPS', async () => {
  const posts = [];
  const fetcher = async (url, init) => {
    posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('/api/interpolate/status')) return { status: 'done' };
    return { taskId: 't1' };
  };
  await interpolateWallpaper2Video({
    videoDataUrl: 'data:video/mp4;base64,BBBB',
    fetcher,
    fetchImpl: fakeFetchImpl(),
    pollMs: 1,
  });
  assert.equal(posts[0].url, '/api/interpolate');
  assert.equal(posts[0].body.targetFps, 60);
  assert.equal(posts[0].body.videoDataUrl, 'data:video/mp4;base64,BBBB');
});

test('lockWallpaper2Colors posts to the sync color-lock endpoint and honours the flag', async () => {
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    return {
      ok: true,
      headers: { get: () => '1' },
      blob: async () => new Blob(['LOCKED'], { type: 'video/mp4' }),
    };
  };
  const { blob, locked } = await lockWallpaper2Colors({
    videoDataUrl: 'data:video/mp4;base64,BBBB',
    fetchImpl,
  });
  assert.equal(posts[0].url, '/api/color-lock');
  assert.equal(posts[0].body.videoDataUrl, 'data:video/mp4;base64,BBBB');
  assert.equal(locked, true);
  assert.equal(blob.size, 6);

  // 后端会原样返回（缺 numpy/ffmpeg 时），要能如实读出「没改动」。
  const skipped = await lockWallpaper2Colors({
    videoDataUrl: 'data:video/mp4;base64,BBBB',
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => '0' },
      blob: async () => new Blob(['RAW'], { type: 'video/mp4' }),
    }),
  });
  assert.equal(skipped.locked, false);
});

test('lockWallpaper2Colors surfaces backend errors instead of returning garbage', async () => {
  await assert.rejects(
    () => lockWallpaper2Colors({
      videoDataUrl: 'data:video/mp4;base64,BBBB',
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: '未找到 ffmpeg/ffprobe，无法做色彩锁定' }),
      }),
    }),
    /未找到 ffmpeg/,
  );
});

test('超分倍率必须真的到 4K（720P 放大 2 倍只有 1440P）', () => {
  assert.equal(WALLPAPER2_UPSCALE_SCALE, 3);
});
