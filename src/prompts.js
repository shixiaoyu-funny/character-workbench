// 提示词拼装：五种设定图的正负向提示词与宽高比。
// 标签按字段顺序收集，空标签跳过，同一个英文字符串只出现一次。
// 本模块只读传入的状态，不调用联动规则，也不渲染 UI。

import {
  OPTIONS, COLOR_WORDS, PRESETS, FACE_FIELDS, POSE_INHERIT, mouthMatchesEyes, BACKGROUND_PHYSICS,
} from './catalog.js';
import { clothingExclusions, clothingTerms } from './clothing.js';

export const KINDS = ['基准立绘', '三视图', '表情差分图', '服饰拆解图', '手部拆解图', 'Q版形象', '热门Q版'];

const LOCK_SENTENCE = '(same face as reference:1.5)';

// 基准立绘中文构图指令：中文写构图氛围，压住纯白底出图偏移与多余背景。
const BASE_COMPOSITION = '纯白背景，角色全身居中，四周留白充足，站姿。';
// 基准立绘只保留定图种词；构图（站姿/全身/居中/白底）交给上面的中文指令。
const BASE_QUALITY = ['masterpiece', 'best quality'];

// 通用正向质量词：除基准立绘（自带 highly detailed）外，各图种统一追加。
const QUALITY_TAGS = ['masterpiece', 'best quality', 'highres', 'highly detailed'];
// 通用负向质量词：崩坏、解剖、多肢体、手部、文字水印守卫，各图种按需追加。
const UNIVERSAL_NEGATIVE = [
  'worst quality', 'low quality', 'bad anatomy', 'missing limbs',
  'extra limbs', 'bad hands', 'text', 'watermark',
];
// 表情差分图预设的 9 宫格表情：差异巨大，避免用户勾选相近表情画成"连连看"。
const EXPRESSION_PRESET = [
  '(smiling:1.2)', '(angry:1.2)', '(crying:1.2)', '(surprised:1.2)',
  '(blushing:1.2)', '(smug:1.2)', '(sad:1.2)', '(winking:1.2)', '(expressionless:1.2)',
];

// ---------------- Q 版（chibi）：头身比是成败关键 ----------------
// 参考图是一张正常比例（约 7 头身）的全身立绘，模型会本能照抄它的身材：
// 只写一个 "chibi" 经常完全无效，出图仍是七头身的普通立绘（实测）。
// 头身比按示例风格参考图定标：**二头身**（头部几乎占全身一半），不是常见的 3 头身"萌系"。
// 所以这里用三层夹住：
//   ① 中文主指令（千问对中文指令遵循度最高）把 2~2.5 头身、头部占比说成数字；
//   ② 英文头身比锁 + 大头小身等形态词，重复声明；
//   ③ 负向排掉成人/写实比例，也排掉 3 头身以上的「偏高」比例。
// 另加一句「参考图只取长相」，把参考图从「身材模板」降级为「身份来源」。
const CHIBI_COMPOSITION = '把角色重画成 Q 版（chibi）：头身比约 2 头身（最多不超过 2.5 头身），'
  + '整个身子加起来只比头略高一点，头部约占全身高度的一半，身子只有一个多头高；'
  + '大头小身、短手短腿、手脚圆润简化、五官集中在大脸上、眼睛占脸的三分之一；'
  + '不要照抄参考图里的真实身材比例与身高。';
const CHIBI_PROPORTION_LOCKS = [
  '(chibi proportions:1.6)', '(2 heads tall:1.6)', '(2.5 heads tall:1.4)',
  '(oversized head:1.5)', '(tiny body:1.4)', 'head as tall as the body',
  'huge head in proportion to a small body', 'head occupying half of the total height',
  'short stubby limbs', 'chibi hands', 'small rounded hands', 'simplified anatomy',
  'flat color shading, thick clean outlines',
];
const CHIBI_NEGATIVE = [
  '(realistic proportions:1.4)', '(normal body proportions:1.4)',
  '(7 heads tall:1.4)', '(8 heads tall:1.4)', 'teenage proportions',
  '(3 heads tall:1.3)', '(4 heads tall:1.3)', '(5 heads tall:1.3)',
  'tall slender body', '(long legs:1.3)', 'adult proportions', 'mature figure',
  'realistic anatomy', 'detailed muscular anatomy', 'long neck',
];

// ---------------- Q 版：参考图分工（瞳色/发型/服饰必须来自角色图）----------------
// Q 版会同时吃「角色基准图」和「风格参考图」两张以上。模型默认把后面的风格图当主体模板，
// 会把风格图里的瞳色、发型、发饰、衣服整套照搬（实测：生成出来的 Q 版直接用了风格参考图
// 的蓝绿瞳，而角色本身不是这个瞳色）。所以必须逐图声明用途，并在正负向两头钉住五官归属：
// 风格图只准贡献「头身比、脸型轮廓、上色画风」，其余一律以第 1 张角色图为准。
function chibiRoleClause(styleCount, hasReference) {
  if (!styleCount) {
    return hasReference
      ? '参考图只提供角色的长相、五官、发型发色、头饰、服装与配色；Q 版头身比与画风按下面的指令来。'
      : '';
  }
  const span = styleCount > 1 ? `第 2 张到第 ${styleCount + 1} 张` : '第 2 张';
  if (!hasReference) {
    return '参考图只是画风参考图，只用来参考 Q 版头身比、脸型轮廓与上色画风；'
      + '角色的长相、五官、发型发色、头饰、服装与配色按下面的文字描述来，不要照抄参考图里的具体角色。';
  }
  return '参考图分工：第 1 张是角色参考图，角色的长相、眼睛颜色与瞳色、发型发色、头饰、服装与配色'
    + `全部以它为准；${span}是画风参考图，只用来参考 Q 版头身比、脸型轮廓与上色画风，`
    + '绝对不要照抄它的眼睛颜色、瞳孔颜色、发型、发色、发饰和服装。';
}

// 五官与服饰归属锁：只在真有角色参考图时生效（没有参考图时这些词无意义）。
const CHIBI_IDENTITY_LOCKS = [
  '(eye color exactly as the first reference:1.6)',
  '(same eye color as the character reference:1.5)',
  '(same hairstyle and hair color as the character reference:1.5)',
  '(same outfit and accessories as the character reference:1.5)',
];

const CHIBI_IDENTITY_NEGATIVE = [
  '(wrong eye color:1.5)', '(different eye color from the character:1.5)',
  'mismatched eye color', 'copied eye color from the style reference',
  '(different hair color:1.4)', '(different hairstyle:1.4)',
  '(different outfit:1.4)', '(different accessories:1.3)',
];

// Q 版锁脸句要指明「第 1 张」：风格图排在后面，写成 reference 会让模型去抄风格图的脸与瞳色。
const CHIBI_LOCK_SENTENCE = '(same face as the first reference:1.5)';

// ---------------- 热门Q版：用户上传正比图，直接出 Q 版 ----------------
// 与「Q版形象」的区别只在输入源：那边是锁定的基准立绘 + 全部风格图，
// 这边是用户现场传的 1~2 张正比立绘 + 固定 1 张风格图。
// 身份全部来自正比图，所以提示词里不拼任何角色标签（tagSequence 为空）。
// 只收 1 张角色图：角色图 = 图 1，风格图 = 图 2。
// 「成品只画一个角色」必须写死：用户很可能传一张双人截图，模型会忠实地把两个人都画出来。
function hotChibiRoleClause(charCount, styleCount) {
  const styleIndex = Math.max(1, charCount) + 1;
  const identity = '图 1 是角色参考图，角色的长相、五官、发色、瞳色、服装与配色全部以它为准；'
    + '成品只画这一个角色，图 1 里如果还有别的角色，一律不要画进成品。';
  if (!styleCount) {
    return `${identity}头身比与画风按下面的 Q 版指令来。`;
  }
  return `${identity}图 ${styleIndex} 只提供 Q 版画法：头身比、线条粗细、`
    + '上色与阴影方式；它不提供角色特征、发型、服装与任何颜色。';
}


const FIXED = {
  基准立绘: [
    'character design', 'official art',
  ],
  三视图: [
    'character sheet', 'turnaround', 'multiple views', 'front view', 'side view', 'back view',
    '(same character:1.3)', '3 views', 'standing', 'white background',
    'concept art', 'flat colors', ...QUALITY_TAGS,
  ],
  表情差分图: [
    '(expression chart:1.5)', '(3x3 grid:1.5)', '(9 different expressions:1.4)',
    'clear boundaries', 'white background', 'simple background', 'close-up face',
    'portrait', 'upper body', 'highly detailed faces',
    ...EXPRESSION_PRESET, ...QUALITY_TAGS,
  ],
  Q版形象: [
    'chibi', 'super deformed', 'cute', 'full body', 'standing',
    'white background', ...QUALITY_TAGS,
  ],
  // 热门Q版：身份全部来自用户上传的正比图，提示词只描述「画成 Q 版」这件事。
  热门Q版: [
    'chibi', 'super deformed', 'cute', 'full body', 'standing',
    'white background', ...QUALITY_TAGS,
  ],
};

const NEGATIVE = {
  基准立绘: ['multiple people', 'cropped', 'out of frame', ...UNIVERSAL_NEGATIVE],
  三视图: ['different characters', 'different clothes', 'different hair'],
  表情差分图: [
    'full body', 'nude', 'naked', 'blurry', 'watermark', 'merged cells', 'messy layout',
    ...UNIVERSAL_NEGATIVE,
  ],
  Q版形象: [...CHIBI_NEGATIVE, 'tall', 'slim waist', 'adult body'],
  热门Q版: [...CHIBI_NEGATIVE, 'tall', 'slim waist', 'adult body',
    // 正比原图多半带背景与特效，Q 版必须是干净白底立绘。
    '(complex background:1.3)', '(scenery:1.2)', '(text:1.3)', '(watermark:1.4)',
    // 用户很可能传双人截图，模型会照着画两个人；把「多角色」显式排掉。
    '(two characters:1.5)', '(second person:1.5)', '(background characters:1.4)',
    '(group:1.3)', '(different faces:1.4)'],
};

// 单一生成风格：二次元风格（赛璐璐平涂，米哈游风）。写实风已删除。
// positive 只含风格锚点词，quality 词（masterpiece/best quality）与动态标签在 buildPrompt 里统一追加。
// negative 会置于各图种负向词之前，作为风格级负向基线。
const STYLES = {
  二次元风格: {
    positive: [
      'anime gacha game style', 'Genshin Impact style', 'clean lineart', 'cel shading',
      'anime style', 'dreamy ethereal lighting', 'rim light glow', 'vibrant saturated colors',
      'ornate costume design', 'big anime eyes', '(miHoYo style:1.2)', 'metallic accents',
      'detailed eyes', 'glossy eyes',
    ],
    negative: [
      '(worst quality, low quality:1.4)', '(bad anatomy, bad hands, extra fingers, extra limbs:1.3)',
      '(realistic, photorealistic, 3d render, thick painting:1.2)', 'watermark', 'signature',
      'text', 'blurry', 'deformed',
    ],
  },
};

function styleOf(state) {
  return STYLES[state.style] || STYLES['二次元风格'];
}

// 服饰拆解图忽略界面上的风格。写实风里的皮肤质感不能进衣服，否则会变成布料照片。
// 这里固定二次元平涂设定稿，再接拆解词。衣服长什么样由参考图决定，不拼角色描述，也不加锁脸句。
const CLOTHING_POSITIVE = 'anime style, cel shading, concept art, '
  + '(clothing parts breakdown:1.5), (game equipment sheet:1.5), flat lay, '
  + 'isolated on white background, (no character, no human:1.5), highly detailed textures, vivid colors, '
  + '(each garment and accessory appears only once:1.5), exploded into separate pieces, '
  + '(transfer side-view and back-view details onto that single piece:1.3), '
  + 'intricate lace, embroidery, ribbons, chains, jewelry, layered fabric';
const CLOTHING_NEGATIVE = '(human, person, 1girl, 1boy, body, skin, face, mannequin:1.5), '
  + 'wearing clothes, text, arrows, '
  + '(duplicate:1.4), (repeated outfit:1.4), (second dress:1.3), (another angle of the same garment:1.3), '
  + 'extra skirt, legs, feet, (realistic, photographic:1.4)';

// 手部拆解图：九宫格手势参考表，输入图与服饰拆解图一致（基准立绘 + 三视图）。
// 九宫格里必须给具体手势，否则模型会画九个雷同的手。这一串同时承担「凑够 9 个」和「可实用」。
export const HAND_POSE_LIST = '(v sign, open palm, fist, thumbs up, pointing, peace sign, '
  + 'holding a sword, waving, resting chin:1.2)';

// 手是什么颜色、有没有手套，一律以参考图（基准立绘 + 三视图）为准。
// 之前写死「bare hands」是错的：角色本来戴手套就会被硬脱掉。这里只声明「照抄参考图」，
// 表单里选了手套/机械臂就把配饰原样带出来，只有确定是裸手时才补肤色词。
const HAND_REFERENCE_RULE = '(hand color and hand covering identical to the reference:1.6), '
  + '(same hand color as the reference images:1.5), (keep the reference gloves if any:1.4), '
  + '(do not recolor the hands:1.4)';

const HAND_POSITIVE_HEAD = 'anime style, cel shading, concept art, '
  + '(hand gestures sheet:1.5), (9 different hand poses:1.5), (3x3 grid:1.4), clear boundaries, '
  + '(isolated hands:1.4), (floating hands, no body, no face, no human:1.5), '
  + `${HAND_REFERENCE_RULE}, `;

const HAND_POSITIVE_TAIL = 'delicate anime hands, slender fingers, exactly five fingers, '
  + 'correct hand anatomy, clean lineart, flat color, white background, simple background, '
  + `${HAND_POSE_LIST}, highly detailed textures`;

const HAND_NEGATIVE = '(human, 1girl, 1boy, face, head, body, arms, legs:1.5), '
  + '(wrong hand color:1.5), (recolored hands, hands in a different color from the reference:1.4), '
  + '(invented gloves, gloves removed from a gloved character:1.4), '
  + 'painted hands, metallic hands, hands made of fabric, '
  + '(bad anatomy, deformed hands, mutated fingers, extra fingers, missing fingers, '
  + 'fused fingers:1.4), (realistic, 3d render, photorealistic:1.3), text, watermark, messy layout';

// 手部外观词：手套/机械臂等配饰照表单带出；只有没戴手套时才加肤色，免得肤色压过手套。
function handLookTags(state) {
  const handsBack = state.handsBack;
  const values = Array.isArray(handsBack) ? handsBack : [handsBack];
  const tags = [];
  const covered = values.some((value) => value === '手套（半指/全指）' || value === '机械臂');
  for (const value of values) {
    if (!value || value === '无') continue;
    for (const term of splitTerms(tagOf('handsBack', value))) tags.push(term);
  }
  if (!covered) {
    const skin = tagOf('skin', state.skin);
    if (skin) tags.push(skin);
  }
  return tags;
}

function handPositive(state) {
  const look = handLookTags(state);
  return `${HAND_POSITIVE_HEAD}${look.length ? `${look.join(', ')}, ` : ''}${HAND_POSITIVE_TAIL}`;
}

// 微调时如果用户上传了手部拆解图，用这几句告诉模型它是谁、怎么用。
// 关键是不能让它把九宫格排版或白底带进成品，所以既在正向里限定用途，也在负向里排掉网格。
const HAND_SHEET_CLAUSE = '第三张参考图是手部手势拆解表，只用来参考手指结构、指节比例和手势画法；'
  + '手的颜色、有没有手套要和角色参考图保持一致，不要把九宫格排版、分割线、白色背景或表格边框画进画面，'
  + '要画出与参考表风格一致的正常的手';
const HAND_SHEET_POSITIVE = [
  '(hand structure follows the third reference:1.3)',
  '(normal hand proportions:1.2)',
  '(perfect hands:1.2)',
];
const HAND_SHEET_NEGATIVE = [
  '(gesture sheet in the image:1.5)', '(3x3 grid:1.4)', '(nine panels:1.4)',
  '(reference sheet layout:1.3)', 'panel borders, grid lines',
];

// 身份字段：性别、年龄、种族、角色定位。
const IDENTITY_FIELDS = ['gender', 'age', 'race', 'role'];
// 发型字段：长度、样式、呆毛、刘海、发色、额外发色。
const HAIR_FIELDS = ['hairLength', 'hairStyle', 'ahoge', 'bangs', 'hairColor', 'hairColorExtra'];
// 服装节点与整身特效。连体装是否盖住上下装，由 clothingTerms 自己判断。
const CLOTHING_FIELDS = ['clothingNodes', 'outfitEffects'];
// 配饰字段：帽子、三类头饰、面颈、手背。
const ACCESSORY_FIELDS = [
  'hat', 'feminineAccessories', 'masculineAccessories', 'fantasyAccessories',
  'faceNeck', 'handsBack',
];
// 头饰字段（表情差分只用帽子与三类头饰）。
const HEADWEAR_FIELDS = ['hat', 'feminineAccessories', 'masculineAccessories', 'fantasyAccessories'];

function splitTerms(tag) {
  return String(tag).split(/,\s*/).map((t) => t.trim()).filter(Boolean);
}

function tagOf(field, value) {
  if (field === 'ahoge') return value === true ? 'ahoge' : '';
  const options = OPTIONS[field];
  if (!options || value === '无' || value === '') return '';
  const found = options.find((opt) => opt.value === value);
  return found ? found.tag : '';
}

function isHexColor(value) {
  return typeof value === 'string'
    && (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value));
}

// 自由取色的 HEX -> 提示词色词：优先读翻译后的英文名（colorNames），没有则回退原 HEX。
function colorNameOf(state, hex) {
  const name = (state.colorNames || {})[String(hex).toLowerCase()];
  return name || hex;
}

// 自由取色附加短语：发色/眼影/唇彩/异色瞳选了「可选颜色」时，把色词追加进提示词。
function customColorTerms(field, value, state) {
  const hex = (v) => (isHexColor(v) ? colorNameOf(state, v) : '');
  if (field === 'hairColor' && value === '自定义') {
    const color = hex(state.hairColorCustom);
    return color ? [`${color} hair`] : [];
  }
  if (field === 'eyeColor' && value === '自定义') {
    const color = hex(state.eyeColorCustom);
    return color ? [`${color} eyes`] : [];
  }
  if (field === 'pupil' && value === '异色瞳（左红右蓝等可配）') {
    return [hex(state.heterochromiaLeft), hex(state.heterochromiaRight)]
      .filter(Boolean).map((color) => `${color} eye`);
  }
  if (field === 'eyeMakeup' && value === '眼影（可选颜色）') {
    const color = hex(state.eyeShadowColor);
    return color ? [`${color} eyeshadow`] : [];
  }
  if (field === 'lipstick' && value === '唇彩颜色可选') {
    const color = hex(state.lipColor);
    return color ? [`${color} lips`] : [];
  }
  if (field === 'hairColorExtra' && value === '挑染') {
    const color = hex(state.streakColor);
    return color ? [`${color} streaks`] : [];
  }
  if (field === 'hairColorExtra' && value === '渐变发色') {
    const root = hex(state.gradientRootColor);
    const tip = hex(state.gradientTipColor);
    if (root && tip) return [`${root} to ${tip} hair`];
    if (root) return [`${root} hair`];
    if (tip) return [`${tip} hair`];
  }
  // 鞋袜颜色：命名色走 tag，自定义色走 colorNames 翻译；与鞋/袜单品合并为短语。
  return [];
}

// 按字段顺序收集标签，展开成英文术语并去重。
// 种族（精灵尖耳/兽耳/恶魔角/光环）先于头饰收集，
// 同名术语只出现一次，因此头饰里对应的耳朵、角、光环自然不再重复输出。
function collect(state, fields, { skipFace = false, sanitize = null } = {}) {
  const terms = [];
  const seen = new Set();
  const push = (term, field) => {
    const finalTerm = sanitize ? sanitize(term, field) : term;
    if (finalTerm && !seen.has(finalTerm)) {
      seen.add(finalTerm);
      terms.push(finalTerm);
    }
  };
  for (const field of fields) {
    if (field === 'colorScheme') {
      for (const phrase of colorPhrases(state)) {
        for (const term of splitTerms(phrase)) push(term, field);
      }
      continue;
    }
    if (field === 'clothingNodes') {
      for (const term of clothingTerms(state)) push(term, 'clothing');
      continue;
    }
    if (skipFace && FACE_FIELDS.includes(field)) continue;
    const values = Array.isArray(state[field]) ? state[field] : [state[field]];
    for (const value of values) {
      for (const term of splitTerms(tagOf(field, value))) push(term, field);
      for (const term of customColorTerms(field, value, state)) push(term, field);
    }
  }
  return terms;
}

function colorWord(value, state) {
  if (typeof value === 'string'
    && (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value))) {
    return colorNameOf(state, value);
  }
  return COLOR_WORDS[value];
}

// 配色句：主色/辅色英文连接，超出的写权重句；预设非空时追加该预设的 tags。
// 命名色走 COLOR_WORDS；自由取色的 #rgb / #rrggbb 优先读翻译后的英文名，否则原样作为色词。
function colorPhrases(state) {
  const phrases = [];
  const main = (state.mainColors || []).map((value) => colorWord(value, state)).filter(Boolean);
  const accent = (state.accentColors || []).map((value) => colorWord(value, state)).filter(Boolean);
  // 没有主色和辅色时不写颜色句；预设非空时仍追加该预设的 tags。
  if (main.length > 0) phrases.push(`${main.slice(0, 3).join(' and ')} clothes`);
  for (const color of main.slice(3)) phrases.push(`(${color} clothes:0.5)`);
  if (accent.length > 0) phrases.push(`${accent.slice(0, 5).join(' and ')} accents`);
  for (const color of accent.slice(5)) phrases.push(`(${color} accents:0.5)`);
  const preset = PRESETS.find((p) => p.id === state.colorPreset);
  if (preset) for (const tag of preset.tags) phrases.push(tag);
  return phrases;
}

function clothingFields() {
  return CLOTHING_FIELDS;
}

const MODESTY_POSITIVE = [
  '(safety shorts:1.4)', '(modesty shorts)', '(shorts under skirt:1.3)',
  '(fully clothed:1.3)', '(opaque clothes:1.3)', '(clothes stay in place:1.3)',
  'covered crotch', 'skirt covering legs',
];

const MODESTY_NEGATIVE = [
  '(upskirt:1.5)', '(pantyshot:1.5)', '(panties:1.5)', '(nopan:1.4)',
  '(nude:1.4)', '(exposed crotch:1.5)', 'cameltoe', '(nsfw:1.4)', '(pussy:1.5)',
  'spread legs', '(clothes lift:1.4)', '(skirt lift:1.4)', '(see-through:1.4)',
  '(transparent clothes:1.3)', '(open clothes:1.3)', '(wardrobe malfunction:1.4)',
];

function poseParent(pose) {
  return POSE_INHERIT[pose] || pose;
}

function needsModesty(state, pose) {
  if (state.tuneGender !== '女') return false;
  const parent = poseParent(pose);
  return parent === '坐姿' || parent === '躺姿' || parent === '趴姿'
    || pose === '蹲姿' || pose === '跪姿' || pose === '跳跃中';
}

// 坐/蹲/跪/躺/趴：非直立姿态，需要地面或支撑物，否则模型会画成悬空。
function isRestingPose(pose) {
  const parent = poseParent(pose);
  return parent === '坐姿' || parent === '蹲姿' || parent === '跪姿'
    || parent === '躺姿' || parent === '趴姿';
}

export function poseClause(state) {
  const tag = tagOf('pose', state.pose);
  return tag ? [tag] : [];
}

// 瞳色：唯一由表单直接钉死的五官属性 —— 颜色用文字说清，虹膜画法交给参考图。
// 它**不能**放进 FACE_FIELDS：锁脸时 skipFace 会把整个 FACE_FIELDS 剔掉，
// 这条约束会跟着一起消失，而「眼睛抄了风格参考图」正是这么发生的。
const EYE_FIELDS = ['eyeColor'];
const EYE_COLOR_FALLBACK = '跟随参考图';

function chosenEyeColor(state) {
  const value = state.eyeColor;
  if (!value || value === EYE_COLOR_FALLBACK) return '';
  if (value === '自定义') {
    return isHexColor(state.eyeColorCustom) ? colorNameOf(state, state.eyeColorCustom) : '';
  }
  return value;
}

// 正向：一句中文把颜色钉死，并明确「画法可以跟参考图，颜色不行」。
function eyeColorClause(state) {
  const label = chosenEyeColor(state);
  if (!label) return '';
  return `瞳色固定为「${label}」：虹膜与瞳孔的颜色全程只按这一个颜色绘制，`
    + '虹膜的形状、高光形状与渐变方式跟随参考图的画法，颜色以这句话为准。';
}

// 负向：把其它预设瞳色显式排掉。带上 eyes 限定，不会误伤同色的头发与衣服。
// 另外单独排青绿：预设里没有绿色，而「瞳色抄了风格参考图」实测抄的就是青绿渐变，
// 只按「其它预设色」生成负向会正好漏掉这个真正的翻车颜色。
const TEAL_EYE_NEGATIVE = ['(teal eyes:1.3)', '(green eyes:1.3)'];

function isGreenish(hex) {
  if (!isHexColor(hex)) return false;
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return false;
  let h;
  if (max === g) h = 60 * (2 + (b - r) / (max - min));
  else if (max === r) h = 60 * (((g - b) / (max - min)) % 6);
  else h = 60 * (4 + (r - g) / (max - min));
  if (h < 0) h += 360;
  return h >= 60 && h <= 180;
}

function eyeColorNegative(state) {
  const label = chosenEyeColor(state);
  if (!label) return [];
  // 自定义色不给「其它预设色」负向：取色器给的颜色可能正好接近某个预设（#8B4513 就是棕），
  // 那样会把用户自己选的颜色排掉。
  const isCustom = state.eyeColor === '自定义';
  const others = isCustom ? [] : (OPTIONS.eyeColor || [])
    .map((opt) => opt.value)
    .filter((value) => value && value !== '自定义' && value !== EYE_COLOR_FALLBACK && value !== state.eyeColor)
    .map((value) => tagOf('eyeColor', value))
    .filter(Boolean)
    .slice(0, 6)
    .map((tag) => `(${tag}:1.3)`);
  // 用户自己选了绿色系（自定义色相落在绿区）时，不要再排绿。
  const keepGreen = state.eyeColor === '自定义' && isGreenish(state.eyeColorCustom);
  return ['(wrong eye color:1.4)', '(different iris color:1.4)',
    ...(keepGreen ? [] : TEAL_EYE_NEGATIVE), ...others];
}

// 每种图的字段白名单，顺序即状态字段顺序（配色位于手持之后、体态之前）。
function tagSequence(kind, state) {
  if (kind === '基准立绘' || kind === 'Q版形象') {
    return [...IDENTITY_FIELDS, ...FACE_FIELDS, ...EYE_FIELDS, ...HAIR_FIELDS, ...clothingFields(state),
      ...ACCESSORY_FIELDS, 'colorScheme'];
  }
  if (kind === '三视图') {
    return [...IDENTITY_FIELDS, ...FACE_FIELDS, ...EYE_FIELDS, ...HAIR_FIELDS, ...clothingFields(state),
      ...ACCESSORY_FIELDS, 'colorScheme'];
  }
  // 表情差分图：身份、五官妆容、发型、头饰（帽子与三类头饰）、面颈配饰（眼镜/Choker/领带等）。
  // 表情由 EXPRESSION_PRESET 预设的 9 宫格统一指定，不依赖用户勾选的 eyeEmotions/mouthStates/effectSymbols。
  // 保留发型发色面部特征与头部/颈部配饰，防止被画成光头/裸体；不含服装、配色、手持、手背配饰、体态、视线、镜头与背景。
  return [...IDENTITY_FIELDS, ...FACE_FIELDS, ...EYE_FIELDS, ...HAIR_FIELDS,
    ...HEADWEAR_FIELDS, 'faceNeck'];
}

// 单风格下不再需要写实风的 2.5d 放大补丁，直接删除。

export function buildPrompt(state, kind, { hasReference = false, styleCount = 0, charCount = 0 } = {}) {
  if (!KINDS.includes(kind)) {
    throw new Error(`未知图种: ${kind}`);
  }
  if (kind === '服饰拆解图') {
    return {
      positive: CLOTHING_POSITIVE,
      negative: CLOTHING_NEGATIVE,
      aspect: state.clothingAspect || '1:1',
    };
  }
  // 手部拆解图同样是固定设定稿：输入图和服饰拆解图一致，但画的是九宫格手势表。
  if (kind === '手部拆解图') {
    return {
      positive: handPositive(state),
      negative: HAND_NEGATIVE,
      aspect: state.handAspect || '1:1',
    };
  }
  // 基准立绘：中文构图指令打头，角色英文标签随后，英文画风词定调，英文质量词收尾。
  if (kind === '基准立绘') {
    const collected = collect(state, tagSequence(kind, state), { skipFace: hasReference });
    const style = styleOf(state);
    const positiveParts = [BASE_COMPOSITION];
    for (const tag of FIXED[kind] || []) positiveParts.push(tag);
    if (hasReference) positiveParts.push(LOCK_SENTENCE);
    // 瞳色紧随锁脸句：锁脸时五官文字全被剔掉，这里是唯一还在的五官约束。
    positiveParts.push(eyeColorClause(state));
    for (const tag of collected) positiveParts.push(tag);
    // 轮廓排除只算一次，正向与负向共用。
    const shape = clothingExclusions(state);
    for (const tag of shape.positive) positiveParts.push(tag);
    for (const tag of style.positive) positiveParts.push(tag);
    for (const tag of BASE_QUALITY) positiveParts.push(tag);
    return {
      positive: positiveParts.join(', '),
      // 轮廓排除词放在最后：体操服这类露臂连体款，模型会自动补袖套和身后半片裙摆。
      negative: [...new Set([
        ...style.negative,
        ...(NEGATIVE[kind] || []),
        ...eyeColorNegative(state),
        ...shape.negative,
      ])].join(', '),
      aspect: state.baseAspect,
    };
  }
  // Q 版：中文头身比指令打头，压住参考图里正常比例立绘的身体，再接风格、锁脸与形态词。
  // 参考图分工声明紧跟其后：Q 版会同时吃角色图和风格图，必须逐图说明用途，
  // 否则模型会把风格图的瞳色/发型/衣服整套照搬（实测发生过）。
  if (kind === 'Q版形象') {
    const chibiCollected = collect(state, tagSequence(kind, state), { skipFace: hasReference });
    const chibiStyle = styleOf(state);
    const chibiParts = [];
    const chibiSeen = new Set();
    const pushChibi = (value) => {
      if (value && !chibiSeen.has(value)) {
        chibiSeen.add(value);
        chibiParts.push(value);
      }
    };
    pushChibi(CHIBI_COMPOSITION);
    pushChibi(chibiRoleClause(styleCount, hasReference));
    // 身份词要排在风格锚点之前：风格锚点里的 big/detailed/glossy eyes 会盖过身份锁，
    // 让模型觉得「眼睛画得漂亮就行」，于是顺手抄了风格图的瞳色。
    if (hasReference) pushChibi(CHIBI_LOCK_SENTENCE);
    // 瞳色：表单给定就写死颜色，风格图只许贡献画法。这一句必须排在风格锚点之前。
    pushChibi(eyeColorClause(state));
    // 五官归属锁只用来挡「风格图抢走瞳色/发型/服饰」，没有风格图时不需要。
    if (hasReference && styleCount > 0) {
      for (const tag of CHIBI_IDENTITY_LOCKS) pushChibi(tag);
    }
    for (const tag of chibiStyle.positive) pushChibi(tag);
    for (const tag of CHIBI_PROPORTION_LOCKS) pushChibi(tag);
    for (const tag of FIXED[kind] || []) pushChibi(tag);
    for (const tag of chibiCollected) pushChibi(tag);
    // 连体装轮廓排除：体操服/泳装这类款式不许补袖套与裙摆（Q 版同样会加）。
    const chibiShape = clothingExclusions(state);
    for (const tag of chibiShape.positive) pushChibi(tag);
    return {
      positive: chibiParts.join(', '),
      negative: [...new Set([
        ...chibiStyle.negative,
        ...(NEGATIVE[kind] || []),
        // 有角色参考图时，把「抄了风格图的五官/衣服」这类错误显式排掉。
        ...(hasReference && styleCount > 0 ? CHIBI_IDENTITY_NEGATIVE : []),
        ...eyeColorNegative(state),
        ...chibiShape.negative,
      ])].join(', '),
      aspect: '1:1',
    };
  }
  // 热门Q版：身份 100% 来自上传的正比图，所以只拼「Q 版怎么画」相关的段落，
  // 一个角色标签都不加（脸、发、衣服、瞳色全交给图 1、图 2）。
  if (kind === '热门Q版') {
    const hotStyle = styleOf(state);
    const hotParts = [];
    const hotSeen = new Set();
    const pushHot = (value) => {
      if (value && !hotSeen.has(value)) {
        hotSeen.add(value);
        hotParts.push(value);
      }
    };
    pushHot(CHIBI_COMPOSITION);
    pushHot(hotChibiRoleClause(charCount, styleCount));
    if (hasReference) pushHot(CHIBI_LOCK_SENTENCE);
    pushHot(eyeColorClause(state));
    for (const tag of hotStyle.positive) pushHot(tag);
    for (const tag of CHIBI_PROPORTION_LOCKS) pushHot(tag);
    for (const tag of FIXED[kind] || []) pushHot(tag);
    return {
      positive: hotParts.join(', '),
      negative: [...new Set([
        ...hotStyle.negative,
        ...(NEGATIVE[kind] || []),
        ...eyeColorNegative(state),
      ])].join(', '),
      aspect: '1:1',
    };
  }
  const collected = collect(state, tagSequence(kind, state), { skipFace: hasReference });
  const style = styleOf(state);
  const positiveParts = [];
  // 风格锚点词放在最前（锁脸句之前），让风格先定调。
  for (const tag of style.positive) positiveParts.push(tag);
  if (hasReference) positiveParts.push(LOCK_SENTENCE);
  const seen = new Set();
  const push = (value) => {
    if (value && !seen.has(value)) {
      seen.add(value);
      positiveParts.push(value);
    }
  };
  // 瞳色紧随锁脸句：锁脸时五官文字全被剔掉，这里是唯一还在的五官约束。
  push(eyeColorClause(state));
  for (const tag of FIXED[kind] || []) push(tag);
  for (const tag of collected) push(tag);
  // 连体装轮廓排除：只写 leotard 时模型爱补半透明袖套与身后半片裙摆，这里正负向两头钉住。
  // 表情差分图不描述服装，替它断言「无袖」会和真实上衣打架，所以只给三视图。
  const shape = kind === '三视图' ? clothingExclusions(state) : { positive: [], negative: [] };
  for (const tag of shape.positive) push(tag);
  return {
    positive: positiveParts.join(', '),
    negative: [...new Set([
      ...style.negative,
      ...(NEGATIVE[kind] || []),
      ...eyeColorNegative(state),
      ...shape.negative,
    ])].join(', '),
    aspect: kind === '三视图' ? state.turnaroundAspect : '1:1',
  };
}


const TUNE_AXES = ['pose', 'handPose', 'headDirection', 'gazes', 'eyeEmotions', 'mouthStates', 'effectSymbols', 'handheld'];
const TUNE_SCENE = ['camera', 'background', 'lighting', 'visualEffects'];

export const BED_POSES = new Set([
  '躺姿', '趴姿', '跪姿',
  ...Object.entries(POSE_INHERIT)
    .filter(([, parent]) => parent === '躺姿' || parent === '趴姿')
    .map(([child]) => child),
]);

const TUNE_HAND_POSITIVE = [
  '(detailed hands:1.2)', '(anatomically correct hands:1.2)', '(two arms:1.2)',
];

// 微调场景的画风词：单一二次元风格走 gacha。
const TUNE_STYLE_TAG = {
  二次元风格: 'anime gacha game style',
};

const PURE_BACKGROUNDS = new Set(['纯色背景', '纯色背景(可自选颜色)']);

// 中文动作与场景描述：明确要求摆出所选姿势、手部动作与背景，防止图生图照抄参考图站姿。
function tuneChineseClause(state, combo) {
  const parts = [];
  if (combo.pose) parts.push(`摆出【${combo.pose}】`);
  if (combo.handPose) parts.push(String(combo.handPose));
  const bg = state.background;
  if (bg && !PURE_BACKGROUNDS.has(bg)) parts.push(`背景是【${bg}】`);
  const intro = parts.length
    ? `请参考图中的人物设定，但必须让她${parts.join('，')}`
    : '请参考图中的人物设定';
  return `${intro}。不要沿用参考图里的站立姿势。`;
}

// 英文光影与镜头词：画风 tag + 电影级打光 + 光影 + 景深，随风格分支。
// 镜头俯仰（camera）不在这里写：俯视/仰视需要用影视摄影术语 + 明确机位角度单独钉死，
// 见 tuneCameraClause —— 一个「from above」这种弱词模型经常不理会。
function tuneLensClause(state) {
  const tags = [TUNE_STYLE_TAG[state.style] || TUNE_STYLE_TAG['二次元风格']];
  tags.push('cinematic lighting', 'rim light');
  const light = tagOf('lighting', state.lighting);
  if (light) tags.push(light);
  tags.push('depth of field', 'highly detailed textures');
  return tags;
}

// 镜头俯仰：影视摄影专业术语 + 明确机位/角度自然语言描述，并配反向排除词。
// 关键：定向微调用 Gemini 图片模型（不吃 SD 的 (词:权重) 语法），所以这里用多词的自然
// 语言把 45° 俯视/仰视钉死，而不是只写一个「from above / from below」。
// 反向排除词再堵住模型画成相反角度或退回平视。
function tuneCameraClause(state) {
  switch (state.camera) {
    case '俯视(从高往下看)':
      return {
        positive: [
          'high angle shot', 'camera placed high above the character',
          'viewed from above at a 45-degree downward angle',
          'looking down at the subject', 'elevated camera, slight overhead view',
        ],
        negative: [
          'low angle', 'from below', 'looking up at the subject',
          'eye-level shot', 'camera at eye level', 'wrong camera angle',
        ],
      };
    case '仰视(从下往上看)':
      return {
        positive: [
          'low angle shot', 'camera placed low near the ground',
          'viewed from below at a 45-degree upward angle',
          'looking up at the subject', 'low camera position',
        ],
        negative: [
          'high angle', 'from above', 'looking down at the subject',
          'eye-level shot', 'camera at eye level', 'wrong camera angle',
        ],
      };
    case '广角(带透视感)':
      return {
        positive: [
          'dynamic angle', 'wide-angle lens', 'dramatic perspective', 'strong foreshortening',
        ],
        negative: [],
      };
    default:
      return {
        positive: [
          'eye level', 'straight-on camera angle',
          'camera at the same height as the character',
        ],
        negative: [
          'high angle', 'low angle', 'from above', 'from below',
          'looking up at the subject', 'looking down at the subject',
        ],
      };
  }
}

const TUNE_LIMB_NEGATIVE = [
  '(extra legs:1.3)', '(many legs:1.3)', '(three legs:1.3)', '(missing legs:1.3)',
  'more than two legs', '(poorly drawn legs:1.3)', 'extra limbs', '(extra arms:1.3)',
  '(missing arms:1.3)', 'malformed limbs', 'mutated', 'disfigured', 'bad proportions',
  'fused body', 'twins',
  '(bad hands:1.3)', '(poorly drawn hands:1.3)', '(missing fingers:1.3)',
  '(extra fingers:1.3)', '(fused fingers:1.3)', '(extra digits:1.3)', '(fewer digits:1.3)',
  '(malformed hands:1.3)',
  '(poorly drawn feet:1.3)', 'bad feet', 'extra feets', 'wrong feet',
];

// Nano 专属「防崩手」补丁。定向微调换成 Nano Banana Pro 后追加。
// 正向固定贴在提示词最末尾：放最后权重最实，前面已有的风格与构图词不会被它冲散。
export const NANO_HAND_POSITIVE = '(perfect hands:1.4), (correct hand anatomy:1.3), '
  + 'exactly five fingers, slender fingers, delicate anime hands, natural finger joints, '
  + '(hands proportional to body:1.2), (small hands:1.1), '
  + 'clean lineart, cel shading, flat color, 2d anime style';

// 负向要一字不改地整段拼进去，所以当作单个元素塞进负向列表，不参与去重拆词。
export const NANO_HAND_NEGATIVE = '(bad hands:1.5), (deformed hands:1.4), '
  + 'extra fingers, missing fingers, fused fingers, mutated fingers, webbed fingers, '
  + 'extra limbs, disconnected hands, floating hands, (oversized hands, giant hands:1.3), '
  + '(realistic hands, photorealistic, 3d render, thick painting, oil painting:1.4), '
  + 'claws, text, watermark';

const BED_SHOE_NEGATIVE = [
  '(shoes on bed:1.4)', '(high heels on bed:1.4)', 'wearing shoes in bed',
];

const REFERENCE_SOCKS = [
  '(same socks as the first reference:1.3)', 'keep the hosiery from the first reference',
];

// 脱鞋留袜：钉死袜子仍完整包裹脚部、布料不透脚趾，防止模型把脚画成接近赤脚。
const SHOELESS_SOCKS_POSITIVE = [
  '(socks still on:1.4)', '(feet fully covered by socks:1.4)',
  'sock fabric wrapping over the feet', '(toes hidden inside the socks:1.3)',
  'no bare skin on the feet',
];

const SHOELESS_SOCKS_NEGATIVE = [
  '(visible toes:1.4)', '(toes showing through the socks:1.4)',
  'bare toes', 'see-through socks', 'socks removed', '(no socks:1.3)',
];

const SOCKS_ON_NEGATIVE = [
  '(barefoot:1.3)', '(bare feet:1.3)', '(one bare foot:1.3)',
  'mismatched socks', 'different socks', '(wrong sock color:1.3)',
];

// 显式「不穿鞋」：除了 shotClause 的 barefoot 词，再钉死无鞋、禁止模型按参考图补鞋。
const SHOES_OFF_NEGATIVE = [
  '(shoes:1.4)', '(footwear:1.4)', '(sneakers:1.3)', '(heels:1.3)', '(boots:1.3)',
  'wearing shoes', 'shoes visible',
];

// 显式「不穿袜子」：裸腿、无袜、无连裤袜，防止模型给角色凭空补袜子。
const SOCKS_OFF_POSITIVE = [
  'bare legs', 'bare ankles', 'no socks', 'no stockings', 'no hosiery', 'no tights', 'no legwear',
];

const SOCKS_OFF_NEGATIVE = [
  '(socks:1.4)', '(stockings:1.4)', '(tights:1.4)', '(pantyhose:1.4)',
  '(thigh-high socks:1.3)', '(knee-high socks:1.3)', '(over-the-knee socks:1.3)',
  '(calf socks:1.3)', '(ankle socks:1.3)', '(legwear:1.3)', 'hosiery',
];

// 取景（shot size）改用专业影视/摄影的景别术语，再配「物理锚点」。
// 调研结论（社区实测与 PromptAtlas / Tensor.Art 指南）：
//   ① 只写 full body，模型经常仍然给四分之三身 —— 必须把首尾两端都说死
//      （头顶、脚底/大腿/胸口各自的落点），并给出上下留白。
//   ② 模型对「物体关系」的遵循度远高于「景别名词」：脚踩在地面、鞋完整在框内，
//      比 full body 更能阻止裁脚。
//   ③ 距离语言（机位拉远、人物占画面比例适中）确实能把镜头推远。
//   ④ 显式反裁切（no cropped body）在正向里也有效。
//   ⑤ 「portrait」在模型里默认指脸部特写，且明确不能与 full body 混用，
//      所以四档一律不使用 portrait —— 原来的「特写」用 portrait 是自相矛盾的。
//   ⑥ 专业剪辑规则：不在人体关节处切（膝、肘、腰），切在关节上会读成截肢。
function shotClause(shot, pose, feet) {
  if (shot === '全身像') {
    // Full shot / full-body shot / full-length framing：头顶到脚底完整。
    const tags = [
      '(full-body shot:1.5)', '(full shot:1.3)', 'full-length framing',
      'framed from the top of the head down to the soles of the feet',
      'entire body inside the frame, head and both feet included',
      'clear margin above the head and floor space below the feet',
      'the whole figure fits the full height of the frame',
      '(camera pulled back:1.3)',
    ];
    if (feet === 'unshod') {
      tags.push('no shoes', 'shoes removed', 'both bare feet fully inside the frame');
    // 赤脚（含脚链/足袋等装饰）不能写 shoes visible，否则模型会补一双鞋。
    } else if (feet === 'barefoot') {
      tags.push('barefoot', 'bare feet', 'both bare feet fully inside the frame');
    } else {
      tags.push('shoes visible', 'both shoes fully inside the frame',
        '(feet resting on the ground:1.2)');
    }
    if ((pose === '坐姿' || POSE_INHERIT[pose] === '坐姿') && feet === 'shoes') {
      tags.push('legs and shoes in frame');
    }
    return tags;
  }
  if (shot === '半身像(大腿以上)') {
    // Cowboy shot / medium-full shot：头顶到大腿中段，切口落在髋下、膝上。
    return [
      '(cowboy shot:1.4)', '(medium-full shot:1.3)',
      'framed from the top of the head down to mid-thigh',
      'head, torso, hips and upper thighs all inside the frame',
      'the frame cuts across mid-thigh, well below the hips and well above the knees',
    ];
  }
  if (shot === '特写(胸部以上)') {
    // Medium close-up / bust shot：头顶到胸口下方，切口落在上腹，不切脖子也不切腰。
    return [
      '(medium close-up:1.4)', '(bust shot:1.3)',
      'framed from the top of the head down to just below the chest',
      'head, neck and upper chest inside the frame',
      'the frame cuts across the upper torso, never at the neck and never at the waist',
    ];
  }
  if (shot === '大头贴(Q版专用)') {
    // Close-up / headshot：头顶到肩下，脸占满画面。
    return [
      '(close-up:1.4)', '(headshot:1.3)', '(head and shoulders:1.2)',
      'framed from the top of the head down to just below the shoulders',
      'the face dominates the frame',
    ];
  }
  return [];
}

function isBarefoot(state) {
  const shoes = state && state.shoes;
  return !!shoes && typeof shoes === 'object' && shoes.skeleton === '赤脚';
}

// 负向同样按「景别漂移」写：每档既要挡住比自己更紧的取景，也要挡住更松的。
// 全身像最常见的就是被裁成半身，所以 cropped / half-body / upper body 权重给到最高。
function shotNegative(shot) {
  if (shot === '全身像') return [
    '(cropped:1.4)', '(half-body shot:1.4)', '(upper body:1.4)', '(cowboy shot:1.3)',
    '(close-up:1.3)', 'headshot', '(feet out of frame:1.4)', '(cropped feet:1.4)',
    '(cut off at the knees:1.3)', '(cut off at the waist:1.3)', '(cut off at the ankles:1.3)',
    '(zoomed in:1.3)', 'from the knees up',
  ];
  if (shot === '半身像(大腿以上)') return [
    '(full-body shot:1.4)', '(full shot:1.3)', '(head to toe:1.3)',
    '(close-up:1.3)', '(medium close-up:1.2)', 'headshot',
    '(cut off at the knee:1.2)', 'shoes', 'feet', 'lower body',
  ];
  if (shot === '特写(胸部以上)') return [
    '(full-body shot:1.4)', '(full shot:1.3)', '(cowboy shot:1.3)',
    '(medium shot:1.3)', '(upper body:1.2)', '(waist up:1.2)', '(wide shot:1.2)',
    'shoes', 'feet', 'legs', 'lower body',
  ];
  if (shot === '大头贴(Q版专用)') return [
    '(full-body shot:1.4)', '(full shot:1.3)', '(cowboy shot:1.3)',
    '(medium close-up:1.2)', '(medium shot:1.3)', '(upper body:1.2)',
    'torso', 'legs', 'feet', 'shoes',
  ];
  return [];
}

function chosenValues(state, field) {
  const raw = state[field];
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return values.filter((value) => value && value !== '无');
}

export function tuneCombinations(state) {
  const source = state || {};
  const constants = {};
  const axes = [];
  for (const field of TUNE_AXES) {
    const values = chosenValues(source, field);
    if (values.length >= 2) axes.push({ field, values });
    else if (values.length === 1) constants[field] = values[0];
  }
  let combos = [{ ...constants }];
  for (const axis of axes) {
    const next = [];
    for (const combo of combos) {
      for (const value of axis.values) next.push({ ...combo, [axis.field]: value });
    }
    combos = next;
  }
  // 眼部情绪与嘴部状态必须相配：剔除「开心 + 撇嘴」这类冲突组合。
  const matched = combos.filter((combo) => !combo.eyeEmotions || !combo.mouthStates
    || mouthMatchesEyes([combo.eyeEmotions], combo.mouthStates));
  return matched.length ? matched : combos;
}

function plainBackgroundTerm(state) {
  if (state.background !== '纯色背景(可自选颜色)' && state.background !== '纯色背景') return '';
  const hex = String(state.backgroundColor || '').trim().toLowerCase();
  if (hex === '#fff' || hex === '#ffffff') return 'white background';
  if (!hex) return '';
  const named = (state.colorNames || {})[hex];
  return `${named || hex} background`;
}

export function buildTunePrompt(state, combo = {}, { allowBedShoes = false, hasHandSheet = false } = {}) {
  const style = styleOf(state);
  const barefoot = isBarefoot(state);
  // 鞋袜显式开关：tuneShoes / tuneSocks 为 false 表示「不穿」，缺省 true 跟随角色配置。
  const wearShoes = state.tuneShoes !== false;
  const wearSocks = state.tuneSocks !== false;
  // feet: 'shoes'=穿鞋 / 'unshod'=脱鞋留袜 / 'barefoot'=赤脚。
  // 显式不穿鞋时：仍穿袜则「脱鞋留袜」（unshod），不穿袜则彻底赤脚（barefoot）。
  const feet = !wearShoes
    ? (wearSocks ? 'unshod' : 'barefoot')
    : (BED_POSES.has(combo.pose) && !allowBedShoes
      ? 'unshod'
      : (barefoot ? 'barefoot' : 'shoes'));
  const positiveParts = [];
  const seen = new Set();
  const push = (value) => {
    if (value && !seen.has(value)) {
      seen.add(value);
      positiveParts.push(value);
    }
  };
  // 参考图声明 + 中文动作与场景描述打头，随后英文光影镜头词，再拼英文加固词。
  push(tuneChineseClause(state, combo));
  // 景别紧跟中文主指令：它是全局约束，越靠前权重越实。原来排在手部/姿势/场景词
  // 之后，被后面前缀一路稀释，是「选了全身像却画出半身」的主因之一。
  for (const tag of shotClause(state.shot, combo.pose, feet)) push(tag);
  for (const tag of tuneLensClause(state)) push(tag);
  // 镜头俯仰单独用专业术语钉死：正向写 45° 机位角度，负向排除相反角度与平视。
  const camClause = tuneCameraClause(state);
  for (const tag of camClause.positive) push(tag);
  push('(same face, hair and clothes as the first reference:1.5)');
  push('(expressions consistent with the second reference:1.3)');
  for (const tag of TUNE_HAND_POSITIVE) push(tag);
  if (state.shot === '全身像' || state.shot === '半身像(大腿以上)') push('(two legs:1.2)');
  // 上传了手部拆解图：先声明它是什么、怎么用，再补几条手部加固词。
  if (hasHandSheet) {
    push(HAND_SHEET_CLAUSE);
    for (const tag of HAND_SHEET_POSITIVE) push(tag);
  }
  if (combo.pose) {
    for (const tag of poseClause({ ...state, pose: combo.pose })) push(tag);
  }
  // 坐/躺/趴 + 无支撑物硬地背景（街道/教室/天台/花海）：补「贴地」正向词，避免画成悬空。
  if (isRestingPose(combo.pose) && BACKGROUND_PHYSICS[state.background] === 'ground') {
    push('(resting on the ground, sitting on the floor:1.2)');
  }
  const modest = needsModesty(state, combo.pose);
  if (modest) {
    for (const tag of MODESTY_POSITIVE) push(tag);
  }
  for (const field of TUNE_AXES) {
    if (field === 'pose' || !combo[field]) continue;
    for (const term of splitTerms(tagOf(field, combo[field]))) push(term);
  }
  if (feet === 'unshod') {
    push('no shoes');
    push('shoes removed');
    if (wearSocks) {
      for (const tag of REFERENCE_SOCKS) push(tag);
      // 脱鞋但仍穿袜：额外钉死袜子包裹脚部、脚趾不外露，避免画成赤脚。
      for (const tag of SHOELESS_SOCKS_POSITIVE) push(tag);
    }
  } else if (feet === 'barefoot' && !wearShoes) {
    // 显式「不穿鞋且不穿袜」：彻底赤脚，钉死无鞋（角色配置本就是赤脚时 shotClause 已写足）。
    push('no shoes');
    push('shoes removed');
    push('(barefoot:1.4)');
  }
  // 显式「不穿袜子」：裸腿、无袜、无连裤袜。
  if (!wearSocks) {
    for (const tag of SOCKS_OFF_POSITIVE) push(tag);
  }
  for (const field of TUNE_SCENE) {
    // camera 已由 tuneCameraClause 用专业术语单独处理，这里跳过，避免弱词回灌。
    if (field === 'camera') continue;
    for (const value of chosenValues(state, field)) {
      for (const term of splitTerms(tagOf(field, value))) push(term);
    }
  }
  push(plainBackgroundTerm(state));
  for (const tag of QUALITY_TAGS) push(tag);
  // Nano 专属防崩手补丁，固定在提示词最末尾。
  push(NANO_HAND_POSITIVE);
  return {
    positive: positiveParts.join(', '),
    negative: [...new Set([
      // 补丁整段放最前，确保这些词一定进请求（Gemini 没有负向参数，服务端会折成 Avoid 段）。
      NANO_HAND_NEGATIVE,
      ...(hasHandSheet ? HAND_SHEET_NEGATIVE : []),
      ...style.negative,
      ...TUNE_LIMB_NEGATIVE,
      ...(feet === 'shoes' ? [] : BED_SHOE_NEGATIVE),
      ...(feet === 'unshod' && wearSocks ? SOCKS_ON_NEGATIVE : []),
      ...(feet === 'unshod' && wearSocks ? SHOELESS_SOCKS_NEGATIVE : []),
      ...(!wearShoes ? SHOES_OFF_NEGATIVE : []),
      ...(!wearSocks ? SOCKS_OFF_NEGATIVE : []),
      ...(modest ? MODESTY_NEGATIVE : []),
      // 任何坐/躺/趴姿势都加「防悬空」负向词：反重力、僵硬、无表面支撑。
      ...(isRestingPose(combo.pose) ? ['(floating in the air, antigravity, stiff pose, no surface support:1.3)'] : []),
      ...shotNegative(state.shot),
      // 镜头角度反向排除：俯视排仰视/平视，仰视排俯视/平视，平视排高低角度。
      ...camClause.negative,
      'different character', 'different clothes', 'multiple people',
    ])].join(', '),
    aspect: state.tuneAspect || '3:4',
  };
}
