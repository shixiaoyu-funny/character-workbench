// 动态壁纸2：首尾帧视频生成 + 补帧/超分编排。
// 纯逻辑层：提示词拼装、模型表、异步任务轮询。DOM 交互在 dom.js，真实网络调用通过注入的 fetcher/fetchImpl。

export const WALLPAPER2_MODELS = [
  { id: 'wan3.0-video-prime', label: 'wan3.0-video-prime（优速版，首尾帧无缝循环）' },
  { id: 'wan3.0-video', label: 'wan3.0-video（标准版，质量优先）' },
];

export const WALLPAPER2_DEFAULT_MODEL = 'wan3.0-video-prime';
// 时长决定「柔性循环」能不能成立：周期越短，同样的位移就要用更快的速度完成，
// 越快就越像抽搐。成人静息呼吸 12~16 次/分 → 一个完整呼吸周期约 3.8~5 秒，
// 而全身重心左右交替的一个来回通常是 6~10 秒。循环越接近自然频率，越「柔」。
// 2 秒会把一次呼吸压成 30 次/分，这是旧版机械感的直接来源，故不再提供。
// 现已固定 6 秒：只有这一档，不再让用户选，保证呼吸节奏与眨眼时机每次都一致。
export const WALLPAPER2_DURATIONS = [6];
export const WALLPAPER2_DURATION = 6;

// 眨眼位置：整段的三分之二处。取 2/3 而不是首尾附近，是因为贴近循环边界
// 时那一下眨眼会变成一个可被眼睛抓到的「节拍点」，破坏无缝循环的观感。
export const WALLPAPER2_BLINK_FRACTION = 2 / 3;

// 「果冻眼」眨眼的参数依据（MMD 的 JellyEye / 绝区零的弹性眼做法）：
//   眼睑动作只是触发器，真正好看的是虹膜被带动后的欠阻尼回弹 —— 弹一下就收。
//   · 频率 3Hz、振幅半衰期 0.28s：一个来回约 0.33s，晃两下就停，不是嗡嗡震。
//   · 睁眼时横向放大远多于纵向（约 +20% X / +5% Y），闭眼时被眼睑压扁约 18% Y。
//   · 闭合推得猛、睁开推得轻，所以「弹」主要发生在睁开的瞬间。
//   · 遵循挤压拉伸：任一轴被压其他轴等量补偿，视觉体积不变（像水气球）。
// 整段只允许这一次眨眼，且弹动必须在 0.55s 内彻底静止。

export const WALLPAPER2_RESOLUTION = '720P';
export const WALLPAPER2_RATIO = 'adaptive';

// 超分倍率：源片是 720P，放大 2 倍只有 1440P，算不上 4K；3 倍才真正到 3840×2160。
// 这一档也是最慢的一步（360 帧 4K 编码），嫌慢就改回 2。
export const WALLPAPER2_UPSCALE_SCALE = 3;

// 正向提示词：一条「力从地面往上、再从前端往下」的连续传导链，而不是几个并列动作。
// 三条设计原则：
//   1. 只写一条链。并列事件会被模型当成一段「表演」，在首尾同帧的循环里逐帧复刻。
//   2. 振幅阶梯 + 时间延迟。脚踝几乎不动、指尖发梢动得最多且最晚，这才是「柔」。
//   3. 低频、连续、无节拍。没有起停、没有停顿—爆发，位移是平滑的正弦而非钟摆。
// 另外单独锁死色彩与光影：模型最容易在「极静」画面里漏出逐帧亮度呼吸，
// 那是比动作更容易被眼睛抓到的机械感来源。
export function buildWallpaper2Prompt(duration = WALLPAPER2_DURATION) {
  const seconds = Number(duration) > 0 ? Number(duration) : WALLPAPER2_DURATION;
  // 吸气略短于呼气，是静息呼吸的真实比例；中段留一次自然停顿。
  const inhale = Math.round(seconds * 0.34 * 10) / 10;
  const exhale = Math.round(seconds * 0.44 * 10) / 10;
  // 眨眼固定在整段 2/3 处：避开首尾帧，贴在循环边界会变成一个可见的「节拍点」。
  const blinkAt = Math.round(seconds * WALLPAPER2_BLINK_FRACTION * 10) / 10;
  // 果冻眨眼的各阶段时间点一律写成两位小数，模型对「4.09s」这类精确时刻更听话。
  const f = (value) => value.toFixed(2);

  const prompt = [
    '生成单镜头，一镜到底，固定机位，摄影机完全静止，全程无剪辑、无转场、无切镜。',
    '这是一段可以无限循环播放的待机动画（idle loop），像一张会呼吸的静态插画：画面几乎是静止的，只有极轻、极慢、连续的起伏在流动。',
    '',
    '【主体】沿用参考立绘中的同一位角色：相同的五官脸型、相同发型发色、相同服装配饰、相同体型比例、相同站姿。不做任何表演性动作，不做任何有始有终的单独动作。',
    '【场景】完全沿用参考立绘的背景与环境，背景元素的位置、大小、透视全程不变。',
    '',
    '【整体动态原则】整段只有一条连续的力，从脚底向上传递到头顶，再从前端（发梢、袖口、衣摆、指尖）向下回落；没有任何独立事件，没有动作的开始与结束，每一帧都处在同一条平滑曲线上的不同位置。',
    `1. 这条力的频率极低、周期等于整段 ${seconds} 秒，整段只走完一个循环，因此首帧与尾帧的姿态、构图、光影完全一致，天然闭环；首尾处的运动速度也一样平缓，不出现回弹、急停或跳回。`,
    '2. 速度曲线是平滑的正弦式流动（缓入缓出），全程没有停顿、没有加速爆发、没有节拍感、没有卡点；不要用钟摆那样匀速对称的来回摆，左右两侧的幅度与时机必须有细微差异，看起来不对称、不机械、不可预测。',
    '',
    '【动作幅度阶梯】位移从上到下逐级放大，任何一级都不能越过下面给出的上限，整体观感是「几乎没动，但确实活着」：',
    '· 脚与脚踝：位置与朝向完全不动，只允许重心在左右脚掌之间有不超过 2 毫米的极轻转移，脚跟不离地、脚尖不抬起。',
    '· 膝关节：始终自然微松，只做不超过 1 毫米的缓冲浮动，膝盖不弯曲变化、不打直、不锁死。',
    '· 髋与腰：随重心转移产生不超过 3 毫米的横向位移，骨盆微微一侧高一侧低，躯干不前后倾、不左右扭转（旋转不超过 1 度）。',
    '· 脊柱与胸腔：随呼吸缓慢扩张再回落，胸部视觉起伏不超过 1 厘米，肩线随之抬起再落下，高差变化不超过 3 毫米。',
    '· 颈与头：由躯干带动，出现不超过 0.4 秒的滞后；头部倾斜不超过 1.5 度、位移不超过 6 毫米，只是极轻地跟着身体浮动，绝不主动转头、歪头、点头或抬起。',
    '· 肩、上臂、前臂、手：手臂完全放松，像被挂在肩上一样被躯干轻轻带着走，比肩线再晚 0.2 秒；手肘随惯性有极小的内外浮动，手指自然放松、略有细微的松弛跟随，但没有握拳、没有张开、没有动手指的动作。',
    '· 头发、发梢、衣摆、袖口、飘带、裙摆：最晚、最柔、幅度最大的一级，延迟 0.3~0.6 秒；根部几乎不动，越靠近末端摆幅越大，末端位移可到 1~1.5 厘米；这是被气流与惯性被动带起的结果，一条丝带式的连续流动，不是左右抖。',
    '',
    '【传导与物理】力的传递有先后：地面 → 脚踝 → 膝 → 髋 → 腰 → 胸 → 肩 → 颈 → 头 → 发梢，以及 肩 → 肘 → 腕 → 指尖 与 腰 → 衣摆；每一级都比上一级晚一点、小一点，逐级衰减，没有一级在没人带动的情况下自己先动。材质有重量：布料下垂受重力、头发有惯性、丝绸柔软、皮革挺括；不许出现橡皮筋式的伸缩、弹簧式回弹、反物理漂浮、布料僵直或穿模。',
    '',
    `【呼吸】整段完成一次自然的静息呼吸：吸气约 ${inhale} 秒，短暂停顿，呼气约 ${exhale} 秒且略长于吸气。呼吸不是单独的动作，而是上面那条全身传导链的驱动力，被全身分摊掉了，所以看不出一块肌肉在刻意发力。`,
    `【面部基调】安静、放松、平视；整体表情与参考立绘完全一致，全程不做任何表演。以下两段对嘴部与眨眼做硬性锁定，优先级等同于一镜到底。`,
    '',
    `【FACIAL LOCK — MOUTH REGION】The mouth is a rigid, locked region. It must remain visually identical to the reference illustration on every single frame, as if the mouth were a still image composited onto a living face.`,
    `- Preserve exactly, without any change: mouth shape, lip contour, lip thickness, lip color, lip-corner angle, teeth visibility, and the precise degree of lip parting shown in the reference.`,
    `- Lips stay gently closed and naturally touching; no lip parting, no jaw opening or closing, no chewing, no swallowing, no tongue motion, no teeth exposure.`,
    `- Zero mouth expression change: no smile, no smirk, no grin, no frown, no pout, no lip pressing, no mouth twitch, no lip-corner lift and no lip-corner drop.`,
    `- No speech, no lip-sync, no phoneme mouth shapes, no audible or visible mouth breathing, no vocalization, no sighing.`,
    `- If the reference already shows a faint closed-mouth smile, reproduce that exact smile unchanged — do not amplify it, do not soften it, do not re-animate it.`,
    `- The jaw and chin remain static. Breathing motion is confined to the chest and shoulder line and must never propagate into the mouth, jaw or chin.`,
    '',
    `【BLINK — 果冻微弹 / JELLY BLINK — exactly one, at the two-thirds mark】Exactly one single blink occurs, centered at t = ${blinkAt}s of ${seconds}s (the 2/3 point of the clip). This is not an ordinary blink: it is a "jelly eye" blink. The eyelid motion is only the trigger; the actual performance is a single soft jiggle of the iris that it sets off — one bounce, then dead still. No other blink exists anywhere in the clip.`,
    `- Timing (all rebound settled within 0.55s, then perfectly motionless):`,
    `  · ${f(blinkAt)}–${f(blinkAt + 0.09)}s closing — the upper lid drops quickly and gathers cleanly in about 0.09s.`,
    `  · ${f(blinkAt + 0.09)}–${f(blinkAt + 0.13)}s closed hold — held for only 1–2 frames, never reads as a pause.`,
    `  · ${f(blinkAt + 0.13)}–${f(blinkAt + 0.24)}s opening — slightly slower than the closing, lifting softly.`,
    `  · ${f(blinkAt + 0.18)}–${f(blinkAt + 0.30)}s overshoot — at the very instant the eye reopens, the iris and pupil give one soft bounce: visibly wider on X (about +20%), only barely taller on Y (about +5%), like a gummy tapped lightly.`,
    `  · ${f(blinkAt + 0.30)}–${f(blinkAt + 0.55)}s damped settle — one small counter-rebound (slightly narrower than rest), then the amplitude decays to zero. The decay is fast: amplitude halves about every 0.28s with a roughly 3Hz under-damped spring, so the eye shows a single bounce, never a vibration.`,
    `- Squash & stretch, volume preserved: when the lid presses down the eye region squashes on Y (up to about 18%) and widens a little on X; on reopening it goes briefly narrow-then-wide as it rebounds. Any compression on one axis must be compensated on the other so the apparent volume never changes — think of a water balloon.`,
    `- Secondary details, barely perceptible: the iris carries a slight twist (under 1°) as it rebounds; the highlight / catchlight has its own tiny tremble (about 10Hz, amplitude under 3% of an iris radius); during the reopen the iris swings just past its rest position, then wobbles back.`,
    `- Restraint: this is a soft single jiggle, not exaggerated cartoon rubber-hosing. Small amplitude, one bounce only, completely still within 0.55s. No double blink, no rapid flutter, no half blink, no squinting, no eye squeeze, no eyebrow movement.`,
    `- Outside that single window the eyes stay fully open and motionless: no gaze drift, no eye darting, no pupil dilation or constriction, no extra blink, and no movement of the eye highlights.`,
    `- The jiggle is confined to the eyes. The mouth, jaw and chin are untouched by it (see the mouth lock above), the cheeks are not dragged, and the head, face and whole-image scale never deform.`,
    '',
    '【色彩与光影锁定】这一点和动作同等重要——画面必须像被钉住的照片：调色板、白平衡、曝光、亮度、饱和度、对比度、色温、gamma、暗部与高光的分布，全程每一帧都与首帧完全一致。主光方向、强度、阴影位置与边缘光的形状全程不变。不允许任何逐帧的亮度呼吸、色彩渐变、光斑移动、阴影漂移、背景色温变化、整体闪动或闪烁；不要重打光、不要调色、不要加氛围光、不要改变画面整体的明暗。',
    '',
    `【TEMPORAL STABILITY】Every frame must be a continuous, physically plausible evolution of the immediately preceding frame. No frame-to-frame popping, no jitter, no strobing, no flicker, no morphing, no identity drift, no texture crawling, no edge shimmer, no line-art wobble, and no duplicated or frozen frames. Motion blur must stay consistent with the extremely low motion amplitude — do not introduce artificial motion blur, sharpening halos, or frame-level contrast or exposure pumping. Line art, line weight, shading gradients and color fills remain perfectly registered across the whole clip and never re-render between frames.`,
    '',
    '【镜头】固定镜头，摄影机静止，机位、焦距、景别、构图全程不变；画面极度稳定，不做推拉摇移、不缩放、不做呼吸式晃动、不失焦。',
    '【画质】完全沿用参考立绘的线条、上色与画风；清晰、干净、稳定，无噪点、无闪烁、无跳帧、无重影、无拖影。',
  ].join('\n');

  return { prompt, negativePrompt: WALLPAPER2_NEGATIVE_PROMPT };
}

// 负向清单：按万相 3.0 官方「常见负向」写法分组——镜头 / 动作 / 节奏 / 色彩 / 身份 / 画质。
// 「机械式周期性重复」与「亮度呼吸」「色彩漂移」是实际成片里最容易被眼睛抓到的翻车点。
export const WALLPAPER2_NEGATIVE_PROMPT = [
  '多镜头、切镜、转场、硬切、分屏、叠化',
  '镜头推拉摇移、变焦、镜头缩放、镜头晃动、手持抖动、呼吸式晃动',
  '走路、走动、转身、抬手、挥手、叉腰、耸肩、点头、摇头、摆臂、跳跃、踢腿、伸懒腰',
  '大幅动作、夸张肢体动作、表演性动作、机械式周期性重复同一个动作、鬼畜式循环',
  '钟摆式匀速摆动、节拍感、卡点、动作停顿后突然启动、回弹',
  '频繁眨眼、连续眨眼、二次眨眼、夸张眨眼、挤眼、眯眼、瞪眼、眼球乱转、瞳孔缩放',
  '眼睛整体放大、眼球膨胀、气球式膨胀、眼震、高速抖动、连续抖动、橡皮筋式晃动、卡通夸张弹跳',
  '整个头部缩放、脸颊变形、五官整体位移、面部体积变化',
  '张嘴、闭嘴动作、嘴唇开合、说话、口型变化、对口型、牙齿露出、舌头运动、下颌运动',
  '嘴部形变、嘴型改变、嘴角上扬、嘴角下垂、微笑变化、撇嘴、嘴唇抖动、表情剧烈变化',
  '亮度忽明忽暗、曝光跳变、色彩漂移、色温变化、饱和度跳变、调色变化、阴影晃动、背景色变化、光斑移动、整体闪烁',
  '换脸、面部变形、改变发型发色、改变服装、人物漂移、人物位置变化、背景变化、背景扭曲',
  '四肢扭曲、多余手指、手部畸形、肢体穿模、身体比例变化、衣料穿模',
  '画面闪烁、跳帧、抖动、重影、拖影、低清晰度、模糊、噪点、水印、字幕、文字',
  '描线抖动、线条漂移、线宽变化、材质蠕动、边缘闪烁、逐帧重绘、冻结帧、重复帧、画面跳变、身份漂移',
].join('、');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(message = '已取消') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

// 通用异步任务编排：POST createPath 建任务 -> 轮询 statusPath -> 拉取 resultPath 的 blob。
// 视频生成、补帧共用这一套，只是端点不同。
export async function runAsyncVideoJob({
  createPath,
  statusPath,
  resultPath,
  body,
  fetcher,
  fetchImpl,
  onStatus = () => {},
  pollMs = 1500,
  signal = null,
}) {
  const post = fetcher || (async (url, init) => {
    const response = await fetchImpl(url, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
    return data;
  });
  const fetchRaw = fetchImpl || ((url, init) => fetch(url, init));

  const { taskId } = await post(createPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  for (;;) {
    if (signal && signal.aborted) throw abortError();
    await sleep(pollMs);
    if (signal && signal.aborted) throw abortError();
    const status = await post(`${statusPath}?taskId=${encodeURIComponent(taskId)}`);
    if (status.status === 'done') break;
    if (status.status === 'cancelled') throw abortError();
    if (status.status === 'error') throw new Error(status.error || '处理失败');
    onStatus(status.status);
  }

  const response = await fetchRaw(`${resultPath}?taskId=${encodeURIComponent(taskId)}`);
  if (!response.ok) throw new Error('获取结果失败');
  return await response.blob();
}

// 生成一版待机循环视频（首尾帧都用同一张图，因此必然闭环）。
export function generateWallpaper2Video({
  imageDataUrl,
  model = WALLPAPER2_DEFAULT_MODEL,
  duration = WALLPAPER2_DURATION,
  fetcher,
  fetchImpl,
  onStatus,
  signal,
  pollMs,
}) {
  // 提示词里的呼吸节奏、眨眼时机都跟时长绑定，两边必须用同一个时长。
  const seconds = Number(duration) > 0 ? Number(duration) : WALLPAPER2_DURATION;
  const built = buildWallpaper2Prompt(seconds);
  return runAsyncVideoJob({
    createPath: '/api/video-gen',
    statusPath: '/api/video-gen/status',
    resultPath: '/api/video-gen/result',
    body: {
      imageDataUrl,
      model,
      prompt: built.prompt,
      negativePrompt: built.negativePrompt,
      duration: seconds,
      resolution: WALLPAPER2_RESOLUTION,
      ratio: WALLPAPER2_RATIO,
      // 壁纸不需要音轨：显式关掉，省体积也避免播放器出声。
      audio: false,
    },
    fetcher,
    fetchImpl,
    onStatus,
    signal,
    pollMs,
  });
}

// 把选中的视频补帧到 60FPS（RIFE）。
export function interpolateWallpaper2Video({
  videoDataUrl,
  targetFps = 60,
  fetcher,
  fetchImpl,
  onStatus,
  signal,
  pollMs,
}) {
  return runAsyncVideoJob({
    createPath: '/api/interpolate',
    statusPath: '/api/interpolate/status',
    resultPath: '/api/interpolate/result',
    body: { videoDataUrl, targetFps },
    fetcher,
    fetchImpl,
    onStatus,
    signal,
    pollMs,
  });
}

// 逐帧色彩锁定（消除整段一明一暗的呼吸感）。后端是同步接口，返回 mp4 字节。
// 返回值里的 locked 用于如实反映这一步有没有真的改动画面（缺 numpy/ffmpeg 会跳过）。
export async function lockWallpaper2Colors({ videoDataUrl, fetcher, fetchImpl, signal }) {
  const doFetch = fetchImpl || fetcher;
  const response = await doFetch('/api/color-lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoDataUrl }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `色彩锁定失败 (${response.status})`);
  }
  const headers = response.headers;
  const flag = headers && typeof headers.get === 'function' ? headers.get('X-Color-Locked') : null;
  return { blob: await response.blob(), locked: flag !== '0' };
}
