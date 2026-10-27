// 联动规则：年龄池、显隐、禁用、多选修正与警告。

import { OPTIONS, ASPECT_OPTIONS } from './catalog.js';
import { defaultState } from './state.js';

const MALE_AGES = ['小孩', '少年', '青年', '成年'];
const FEMALE_AGES = ['萝莉', '少女', '成女'];

const MULTI_WITH_WU = new Set([
  'specialMakeup', 'effectSymbols', 'visualEffects', 'feminineAccessories',
  'masculineAccessories', 'fantasyAccessories', 'faceNeck', 'handsBack', 'handheld',
]);
const CAPPED_TWO = new Set(['handheld', 'visualEffects']);

// 女性专属选项：男性未开伪娘开关时隐藏。
const FEMALE_ONLY = {
  hairStyle: ['双马尾（高/低）', '丸子头', '麻花辫', '姬发式'],
  hairLength: ['超长拖地发'],
  faceShape: ['肉肉脸（可爱）'],
  mouth: ['樱桃小嘴'],
  lipstick: ['亮面唇釉（水润）', '咬唇妆（渐变）'],
  eyeMakeup: ['浓密睫毛', '卧蚕'],
  onePiece: ['连衣裙', '洛丽塔洋装', '女仆装'],
  top: ['吊带', '抹胸'],
  bottom: ['包臀裙', '百褶裙'],
  shoes: ['高跟鞋'],
  socks: ['连裤袜（黑丝/白丝）'],
  hat: ['女仆头饰'],
  handPose: ['提着裙摆'],
  mouthStates: ['嘟嘴(生气/可爱)'],
};

// 男性替换发型：性别为女时不可见。
const MALE_ONLY = { hairStyle: ['狼尾（Mullet）', '碎发', '大背头', '飞机头'] };

// 萝莉隐藏项。
const LOLI_HIDDEN = {
  hairStyle: ['大波浪', '姬发式'],
  hairLength: ['超长拖地发'],
  eyeShape: ['上挑眼（凌厉·魅惑）'],
  mouth: ['猫唇（M字唇）'],
  facialFeatures: ['面部纹身（可选位置）'],
  faceShape: ['方脸·硬朗（偏男性）'],
  lipstick: ['亮面唇釉（水润）', '咬唇妆（渐变）'],
  blush: ['横向腮红（微醺/醉酒）', '重度（全脸通红）'],
  eyeMakeup: ['眼线（上挑猫眼/下垂无辜眼）'],
  bottom: ['包臀裙'],
  top: ['吊带', '抹胸', '露脐装'],
  shoes: ['高跟鞋'],
  socks: ['渔网袜'],
  materials: ['半透明（需谨慎）'],
  pose: ['躺姿', '趴姿', '蹲姿', '跪姿', '奔跑中'],
  mouthStates: ['吐舌(调皮)'],
  colorPreset: ['night-rose', 'dark-gold'],
};

// 萝莉默认隐藏的武器类，末世废土/赛博朋克定位时恢复可见。
const LOLI_HIDDEN_WEAPONS = { handheld: ['枪械', '匕首'], handsBack: ['纹身（手臂）'] };

// 少女隐藏项。
const SHOUJO_HIDDEN = {
  facialFeatures: ['面部纹身（可选位置）'],
  blush: ['重度（全脸通红）'],
  materials: ['破损（战损）', '半透明（需谨慎）'],
};

const TEMPLATE = defaultState();
const SINGLE_FIELDS = Object.keys(TEMPLATE).filter(
  (k) => typeof TEMPLATE[k] === 'string' && Object.prototype.hasOwnProperty.call(OPTIONS, k),
);
const MULTI_FIELDS = Object.keys(TEMPLATE).filter(
  (k) => Array.isArray(TEMPLATE[k]) && Object.prototype.hasOwnProperty.call(OPTIONS, k),
);

export function fieldVisible(field, state) {
  if (field === 'crossdressing') return state.gender === '男';
  if (field === 'feminineAccessories') return !(state.gender === '男' && !state.crossdressing);
  return true;
}

function isHexColor(value) {
  return typeof value === 'string'
    && (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value));
}

export function optionVisible(field, value, state) {
  if (!fieldVisible(field, state)) return false;
  // 调色板追加的十六进制颜色不在 COLOR_WORDS 里，仍要保留。
  if ((field === 'mainColors' || field === 'accentColors') && isHexColor(value)) return true;
  const options = OPTIONS[field];
  if (!options) return true; // 布尔开关（crossdressing/ahoge）等无选项字段
  if (!options.some((opt) => opt.value === value)) return false;
  const male = state.gender === '男';
  if (male && !state.crossdressing && (FEMALE_ONLY[field] || []).includes(value)) return false;
  if (!male && (MALE_ONLY[field] || []).includes(value)) return false;
  if (field === 'age') return (male ? MALE_AGES : FEMALE_AGES).includes(value);
  if (state.age === '萝莉') {
    if ((LOLI_HIDDEN[field] || []).includes(value)) return false;
    if (state.role !== '末世废土' && state.role !== '赛博朋克'
      && (LOLI_HIDDEN_WEAPONS[field] || []).includes(value)) return false;
  }
  if (state.age === '少女' && (SHOUJO_HIDDEN[field] || []).includes(value)) return false;
  return true;
}

export function optionDisabled(field, value, state) {
  if (field === 'handPose' && value === '双手抱胸' && (state.handheld || []).includes('长剑')) return true;
  if (field === 'handheld' && value === '长剑' && state.handPose === '双手抱胸') return true;
  return false;
}

export function applyLinkage(state) {
  const s = structuredClone(state);
  if (!OPTIONS.gender.some((opt) => opt.value === s.gender)) s.gender = OPTIONS.gender[0].value;
  if (typeof s.crossdressing !== 'boolean') s.crossdressing = false;
  if (!fieldVisible('crossdressing', s)) s.crossdressing = false;
  if (typeof s.ahoge !== 'boolean') s.ahoge = false;
  const pool = s.gender === '男' ? MALE_AGES : FEMALE_AGES;
  if (!pool.includes(s.age)) s.age = pool[0];
  for (const field of SINGLE_FIELDS) {
    const ok = (v) => optionVisible(field, v, s) && !optionDisabled(field, v, s);
    if (!ok(s[field])) {
      const first = OPTIONS[field].find((opt) => ok(opt.value));
      if (first) s[field] = first.value;
    }
  }
  for (const field of MULTI_FIELDS) {
    let values = (Array.isArray(s[field]) ? s[field] : []).filter((v) => optionVisible(field, v, s));
    if (MULTI_WITH_WU.has(field)) values = values.filter((v) => v !== '无');
    if (CAPPED_TWO.has(field)) values = values.slice(0, 2);
    s[field] = values;
  }
  for (const [field, list] of Object.entries(ASPECT_OPTIONS)) {
    if (!list.includes(s[field])) s[field] = list[0];
  }
  return s;
}

export function warnings(state) {
  const s = applyLinkage(state);
  const out = [];
  if ((s.pose === '躺姿' || s.pose === '趴姿') && s.camera === '平视(默认)') {
    out.push('躺/趴姿势搭配平视容易出图失败，建议改为俯视。');
  }
  if (s.hat !== '无') out.push('帽子可能遮挡部分发型。');
  if (s.mainColors.length > 3 || s.accentColors.length > 5) {
    out.push('颜色过多可能导致AI出图画面杂乱，建议精简颜色。');
  }
  return out;
}

export function orderedOptions(field, state) {
  const options = [...(OPTIONS[field] || [])];
  if (field === 'background') {
    const preferred = { 赛博朋克: '赛博霓虹街', '西式奇幻（剑与魔法）': '奇幻森林' }[state.role];
    if (preferred) {
      const index = options.findIndex((opt) => opt.value === preferred);
      if (index > 0) options.unshift(...options.splice(index, 1));
    }
  }
  return options;
}
