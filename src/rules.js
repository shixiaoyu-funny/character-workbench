// 联动规则：年龄池、显隐、禁用、多选修正与警告。

import {
  OPTIONS, ASPECT_OPTIONS, WU_VALUES, POSE_INHERIT, poseCompatibleValues, mouthAllowedValues,
  BACKGROUND_PHYSICS,
} from './catalog.js';
import { normalizeClothing, wearingSkirt } from './clothing.js';
import { defaultState } from './state.js';

const MALE_AGES = ['小孩', '少年', '青年', '成年'];
const FEMALE_AGES = ['萝莉', '少女', '成女'];

const MULTI_WITH_WU = new Set([
  'specialMakeup', 'effectSymbols', 'visualEffects', 'feminineAccessories',
  'masculineAccessories', 'fantasyAccessories', 'faceNeck', 'handsBack', 'handheld',
]);
const CAPPED_TWO = new Set(['visualEffects', 'outfitEffects']);

// 女性专属选项：男性未开伪娘开关时隐藏。
const FEMALE_ONLY = {
  hairStyle: ['双马尾（高/低）', '丸子头', '麻花辫', '姬发式'],
  hairLength: ['超长拖地发'],
  faceShape: ['肉肉脸（可爱）'],
  mouth: ['樱桃小嘴'],
  lipstick: ['亮面唇釉（水润）', '咬唇妆（渐变）'],
  eyeMakeup: ['浓密睫毛', '卧蚕'],
  hat: ['女仆头饰'],
  handPose: ['单手提着裙摆'],
  mouthStates: ['嘟嘴(生气/可爱)'],
};

// 男性替换发型：性别为女时不可见。
const MALE_ONLY = { hairStyle: ['狼尾（Mullet）', '碎发', '大背头', '飞机头'] };

// 需要特定穿搭才成立的手部动作（帽子/眼镜/领带/裙摆）。
const HAND_POSE_NEEDS = {
  单手扶帽檐: (s) => s.hat !== '无',
  单手扶眼镜: (s) => [...(Array.isArray(s.faceNeck) ? s.faceNeck : []),
    ...(Array.isArray(s.facialFeatures) ? s.facialFeatures : [])].some((value) => value.includes('眼镜')),
  整理领带: (s) => (Array.isArray(s.faceNeck) ? s.faceNeck : []).some((value) => value === '领带' || value === '领结'),
  单手提着裙摆: (s) => wearingSkirt(s),
};

// 必须手里真的拿着对应道具才成立的动作。
const HAND_POSE_ITEM = {
  抱枕头: ['枕头'],
  双手抓住毯子: ['毛毯'],
  双手拉背包带: ['背包'],
};

function heldItems(state) {
  return (Array.isArray(state.handheld) ? state.handheld : []).filter((value) => value && value !== '无');
}

function handPoseItemOk(value, state) {
  const need = HAND_POSE_ITEM[value];
  if (!need) return true;
  const held = heldItems(state);
  return need.some((item) => held.includes(item));
}

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
  const tuneOnly = field === 'pose' || field === 'handPose' || field === 'headDirection'
    || field === 'gazes' || field === 'eyeEmotions' || field === 'mouthStates'
    || field === 'effectSymbols' || field === 'handheld';
  if (!tuneOnly) {
    const male = state.gender === '男';
    if (male && !state.crossdressing && (FEMALE_ONLY[field] || []).includes(value)) return false;
    if (!male && (MALE_ONLY[field] || []).includes(value)) return false;
    if (field === 'age') return (male ? MALE_AGES : FEMALE_AGES).includes(value);
  }
  const allowed = poseCompatibleValues(field, state.pose);
  if (allowed && !allowed.includes(value)) return false;
  if (field === 'handPose') {
    const needs = HAND_POSE_NEEDS[value];
    if (needs && !needs(state)) return false;
    if (!handPoseItemOk(value, state)) return false;
  }
  // 嘴部状态必须与已选的眼部情绪相配（未选眼部情绪时不限制）。
  if (field === 'mouthStates') {
    const mouths = mouthAllowedValues(state.eyeEmotions);
    if (mouths && !mouths.includes(value)) return false;
  }
  return true;
}

// 两只手都占住了，就不能再拿一件东西。单手动作留着另一只手。
export const BOTH_HANDS = new Set([
  '双手抱胸', '双手背后', '双手合十', '摊开双手', '双手放腿上', '抱膝',
  '双手枕在脑后', '双手放腹部', '双手交叉放胸前', '双手撑地', '双手托下巴',
  '双手放在胸前', '双手垫在脸下', '双手举起', '双手抱膝', '双手放膝盖',
  '抱着膝盖发呆', '祈祷', '双手插兜', '双手张开', '双手向上伸', '抱枕头',
  '双手交叠放在身前', '双手握拳放身侧', '双手捧脸', '双手捂耳朵', '双手捂嘴',
  '双臂环抱自己', '双手抓住衣角', '双手举起投降', '双手比心', '双手抱头',
  '双手做喇叭状', '双手摊开耸肩', '双手捧起头发', '双手捂住脸', '双手拉背包带',
  '双手抓住毯子', '双手交握放在腹部', '双手放在桌面上',
]);

const LABEL_RENAMES = {
  handPose: { '提着裙摆': '单手提着裙摆' },
  gazes: { '眼神向别处飘（傲娇/走神）': '眼神向别处飘' },
  effectSymbols: { '星星眼(已选可忽略)': '星星眼', '泪滴(委屈)': '泪滴' },
};

export function optionDisabled(field, value, state) {
  if (field !== 'handPose') return false;
  const held = heldItems(state);
  // 动作本身就是拿这件道具（抱枕头/抓毯子/拉背包带）时不算冲突。
  const need = HAND_POSE_ITEM[value];
  if (need && need.some((item) => held.includes(item))) return false;
  if (!BOTH_HANDS.has(value)) return false;
  return held.length > 0;
}

export function applyLinkage(state) {
  const s = structuredClone(state);
  if (!OPTIONS.gender.some((opt) => opt.value === s.gender)) s.gender = OPTIONS.gender[0].value;
  if (typeof s.crossdressing !== 'boolean') s.crossdressing = false;
  if (!fieldVisible('crossdressing', s)) s.crossdressing = false;
  if (typeof s.ahoge !== 'boolean') s.ahoge = false;
  for (const field of ['pose', 'handPose', 'headDirection']) {
    if (typeof s[field] === 'string') s[field] = s[field] ? [s[field]] : [];
    else if (!Array.isArray(s[field])) s[field] = [];
  }
  s.pose = expandPoses(s.pose);
  for (const [field, renames] of Object.entries(LABEL_RENAMES)) {
    if (!Array.isArray(s[field])) continue;
    s[field] = s[field].map((value) => renames[value] || value);
  }
  s.handPose = s.handPose.filter((value) => value !== '持物（配合道具）');
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
    values = values.filter((v) => !optionDisabled(field, v, s));
    if (MULTI_WITH_WU.has(field)) values = values.filter((v) => !WU_VALUES.includes(v));
    if (CAPPED_TWO.has(field)) values = values.slice(0, 2);
    s[field] = values;
  }
  for (const [field, list] of Object.entries(ASPECT_OPTIONS)) {
    if (!list.includes(s[field])) s[field] = list[0];
  }
  normalizeClothing(s);
  return s;
}

const POSE_CHILDREN = Object.entries(POSE_INHERIT).reduce((groups, [child, parent]) => {
  if (!groups[parent]) groups[parent] = [];
  groups[parent].push(child);
  return groups;
}, {});

function expandPoses(values) {
  const out = [];
  for (const value of values) {
    for (const pose of POSE_CHILDREN[value] || [value]) {
      if (!out.includes(pose)) out.push(pose);
    }
  }
  return out;
}

function isLyingFamily(pose) {
  return pose === '躺姿' || pose === '趴姿' || POSE_INHERIT[pose] === '躺姿' || POSE_INHERIT[pose] === '趴姿';
}

// 站立/行走/奔跑/跳跃：直立姿态，落到低矮坐卧支撑物上容易穿模。
function isUprightPose(pose) {
  return pose === '站立' || pose === '行走中' || pose === '奔跑中' || pose === '跳跃中';
}

export function warnings(state) {
  const s = applyLinkage(state);
  const out = [];
  const poses = Array.isArray(s.pose) ? s.pose : [s.pose];
  if (poses.some(isLyingFamily) && s.camera === '平视(默认)') {
    out.push('躺/趴姿势搭配平视容易出图失败，建议改为俯视。');
  }
  if (s.hat !== '无') out.push('帽子可能遮挡部分发型。');
  if (s.mainColors.length > 3 || s.accentColors.length > 5) {
    out.push('颜色过多可能导致AI出图画面杂乱，建议精简颜色。');
  }
  // 站立/行走/奔跑/跳跃 + 沙发床等坐卧支撑物场景：站立姿势与低矮支撑物易穿模。
  if (BACKGROUND_PHYSICS[s.background] === 'support' && poses.some(isUprightPose)) {
    out.push('站立/行走/奔跑/跳跃姿势搭配沙发、床等坐卧场景可能穿模，建议改为坐姿或躺姿。');
  }
  return out;
}

export function orderedOptions(field, state) {
  const options = [...(OPTIONS[field] || [])];
  return options;
}
