// 提示词拼装：五种设定图的正负向提示词与宽高比。
// 标签按字段顺序收集，空标签跳过，同一个英文字符串只出现一次。
// 本模块只读传入的状态，不调用联动规则，也不渲染 UI。

import { OPTIONS, COLOR_WORDS, PRESETS, FACE_FIELDS } from './catalog.js';

export const KINDS = ['基准立绘', '三视图', '表情差分图', '服饰拆解图', 'Q版形象'];

const LOCK_SENTENCE = '(same face as reference:1.5)';
const CHIBI_STYLE_SENTENCE = '图1的人物，使用图2的Q版画风';

const FIXED = {
  基准立绘: [
    'character design', 'solo', 'full body', 'standing', 'official art',
    'highly detailed', 'white background',
  ],
  三视图: [
    'character sheet', 'three views', 'front view', 'side view', 'back view',
    'same character', '3 people', 'standing', 'white background', 'concept art',
    'flat colors',
  ],
  表情差分图: [
    'expression chart', 'multiple expressions', 'grid layout', 'close-up face',
    'portrait', 'white background',
  ],
  Q版形象: [
    'chibi', 'super deformed', 'cute', '3 heads tall', 'full body',
    'white background', 'simple background',
  ],
};

const NEGATIVE = {
  基准立绘: ['multiple people', 'cropped', 'out of frame'],
  三视图: ['different characters', 'different clothes'],
  表情差分图: ['full body', 'single expression'],
  服饰拆解图: [
    'human', '1girl', '1boy', 'body', 'skin', 'face', 'head', 'hands', 'legs',
    'mannequin', 'person', 'character', 'wearing clothes', 'full outfit',
    'merged items', 'connected parts',
  ],
  Q版形象: [],
};

const CLOTHING_SHEET_PREFIX = '(game equipment sheet:1.4), (clothing parts breakdown:1.4), '
  + 'itemized components, scattered clothing parts, individual accessories, isolated items, '
  + 'flat lay, all items separated, various sizes, headwear, facial accessories, top, bottom, '
  + 'footwear, socks, jewelry, small details, white background, concept art, high resolution, '
  + 'clear outlines, no humans, grid layout, scattered layout';

// 身份字段：性别、年龄、种族、角色定位。
const IDENTITY_FIELDS = ['gender', 'age', 'race', 'role'];
// 发型字段：长度、样式、呆毛、刘海、发色、额外发色。
const HAIR_FIELDS = ['hairLength', 'hairStyle', 'ahoge', 'bangs', 'hairColor', 'hairColorExtra'];
// 服装字段：上装、下装、外套、连体、鞋、袜、材质。
const CLOTHING_FIELDS = ['top', 'bottom', 'outerwear', 'onePiece', 'shoes', 'socks', 'materials'];
// 配饰字段：帽子、三类头饰、面颈、手背。
const ACCESSORY_FIELDS = [
  'hat', 'feminineAccessories', 'masculineAccessories', 'fantasyAccessories',
  'faceNeck', 'handsBack',
];
// 头饰字段（表情差分只用帽子与三类头饰）。
const HEADWEAR_FIELDS = ['hat', 'feminineAccessories', 'masculineAccessories', 'fantasyAccessories'];
// 表情段字段。
const EXPRESSION_FIELDS = ['eyeEmotions', 'mouthStates', 'effectSymbols'];

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

// 按字段顺序收集标签，展开成英文术语并去重。
// 种族（精灵尖耳/兽耳/恶魔角/光环）先于头饰收集，
// 同名术语只出现一次，因此头饰里对应的耳朵、角、光环自然不再重复输出。
function collect(state, fields, { skipFace = false } = {}) {
  const terms = [];
  const seen = new Set();
  for (const field of fields) {
    if (field === 'colorScheme') {
      for (const phrase of colorPhrases(state)) {
        for (const term of splitTerms(phrase)) {
          if (!seen.has(term)) {
            seen.add(term);
            terms.push(term);
          }
        }
      }
      continue;
    }
    if (skipFace && FACE_FIELDS.includes(field)) continue;
    const values = Array.isArray(state[field]) ? state[field] : [state[field]];
    for (const value of values) {
      for (const term of splitTerms(tagOf(field, value))) {
        if (!seen.has(term)) {
          seen.add(term);
          terms.push(term);
        }
      }
    }
  }
  return terms;
}

// 配色句：主色/辅色英文连接，超出的写权重句；预设非空时追加该预设的 tags。
function colorPhrases(state) {
  const phrases = [];
  const main = (state.mainColors || []).map((c) => COLOR_WORDS[c]).filter(Boolean);
  const accent = (state.accentColors || []).map((c) => COLOR_WORDS[c]).filter(Boolean);
  // 没有主色和辅色时不写颜色句；预设非空时仍追加该预设的 tags。
  if (main.length > 0) phrases.push(`${main.slice(0, 3).join(' and ')} clothes`);
  for (const color of main.slice(3)) phrases.push(`(${color} clothes:0.5)`);
  if (accent.length > 0) phrases.push(`${accent.slice(0, 5).join(' and ')} accents`);
  for (const color of accent.slice(5)) phrases.push(`(${color} accents:0.5)`);
  const preset = PRESETS.find((p) => p.id === state.colorPreset);
  if (preset) for (const tag of preset.tags) phrases.push(tag);
  return phrases;
}

// 连体服饰不是「无」时不输出上装和下装。
function clothingFields(state) {
  if (state.onePiece && state.onePiece !== '无') {
    return CLOTHING_FIELDS.filter((f) => f !== 'top' && f !== 'bottom');
  }
  return CLOTHING_FIELDS;
}

export function poseClause(state) {
  const tag = tagOf('pose', state.pose);
  const out = tag ? [tag] : [];
  if (state.age === '少女' && (state.pose === '趴姿' || state.pose === '躺姿')) {
    out.push('fully clothed');
  }
  return out;
}

// 每种图的字段白名单，顺序即状态字段顺序（配色位于手持之后、体态之前）。
function tagSequence(kind, state) {
  if (kind === '服饰拆解图') {
    return [...HEADWEAR_FIELDS, 'faceNeck', ...clothingFields(state), 'handsBack', 'handheld',
      'colorScheme'];
  }
  if (kind === '基准立绘' || kind === 'Q版形象') {
    return [...IDENTITY_FIELDS, ...FACE_FIELDS, ...HAIR_FIELDS, ...clothingFields(state),
      ...ACCESSORY_FIELDS, 'handheld', 'colorScheme', 'handPose', 'headDirection', 'gazes',
      'lighting', 'visualEffects'];
  }
  if (kind === '三视图') {
    return [...IDENTITY_FIELDS, ...FACE_FIELDS, ...HAIR_FIELDS, ...clothingFields(state),
      ...ACCESSORY_FIELDS, 'handheld', 'colorScheme'];
  }
  // 表情差分图：身份、五官妆容、发型、头饰（帽子与三类头饰）、表情段。
  // 不含服装、配色、手持、面颈/手背配饰、体态、视线、镜头与背景。
  return [...IDENTITY_FIELDS, ...FACE_FIELDS, ...HAIR_FIELDS,
    ...HEADWEAR_FIELDS, ...EXPRESSION_FIELDS];
}

export function buildPrompt(state, kind, { hasReference = false, styleReference = false } = {}) {
  if (!KINDS.includes(kind)) {
    throw new Error(`未知图种: ${kind}`);
  }
  const skipFace = hasReference && kind !== '服饰拆解图';
  const collected = collect(state, tagSequence(kind, state), { skipFace });
  const positiveParts = [];
  if (kind !== '服饰拆解图' && hasReference) positiveParts.push(LOCK_SENTENCE);
  if (kind === 'Q版形象' && styleReference) positiveParts.push(CHIBI_STYLE_SENTENCE);
  if (kind === '服饰拆解图') positiveParts.push(CLOTHING_SHEET_PREFIX);
  const seen = new Set();
  const push = (value) => {
    if (value && !seen.has(value)) {
      seen.add(value);
      positiveParts.push(value);
    }
  };
  for (const tag of FIXED[kind] || []) push(tag);
  for (const tag of collected) push(tag);
  return {
    positive: positiveParts.join(', '),
    negative: (NEGATIVE[kind] || []).join(', '),
    aspect: kind === '基准立绘' ? state.baseAspect
      : kind === '三视图' ? state.turnaroundAspect
        : kind === '服饰拆解图' ? state.clothingAspect : '1:1',
  };
}
