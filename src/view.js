// 纯视图模型：把联动后的状态整理成左、中、右三栏控件。

import {
  OPTIONS, ROLE_GROUPS, BACKGROUND_GROUPS, PRESETS, ASPECT_OPTIONS, STYLE_OPTIONS, FACE_FIELDS, COLOR_HEX,
  WU_VALUES, ROLE_RECOMMENDATIONS,
} from './catalog.js';
import {
  applyLinkage, optionVisible, fieldVisible, optionDisabled, warnings, orderedOptions,
} from './rules.js';
import { CLOTHING_SLOTS, clothingView } from './clothing.js';

const FIELD_LABELS = {
  gender: '性别', age: '年龄', race: '种族', role: '角色定位', crossdressing: '特殊/伪娘',
  faceShape: '脸型', eyeShape: '眼型', pupil: '瞳孔', eyeColor: '瞳色', eyebrow: '眉毛', mouth: '嘴巴', nose: '鼻子',
  facialFeatures: '面部特征', skin: '肤色',
  hairLength: '长度', hairStyle: '基础造型', ahoge: '呆毛', bangs: '刘海', hairColor: '发色',
  hairColorExtra: '挑染与渐变',
  blush: '腮红', eyeMakeup: '眼妆', lipstick: '唇妆', specialMakeup: '特殊妆容',
  top: '上装', bottom: '下装', outerwear: '外套', onePiece: '连体装', shoes: '鞋子', socks: '袜子',
  outfitEffects: '整身特效', mainColors: '主色', accentColors: '辅色',
  hat: '帽子', feminineAccessories: '女生向小发饰', masculineAccessories: '男生向配饰',
  fantasyAccessories: '特殊奇幻',
  faceNeck: '面部颈部', handsBack: '手部背部', handheld: '手部持物',
  pose: '基础体态', handPose: '手部动作', headDirection: '头部朝向', gazes: '视线',
  eyeEmotions: '眼部情绪', mouthStates: '嘴部状态', effectSymbols: '特效符号',
  shot: '景别', camera: '镜头', background: '背景', lighting: '光影', visualEffects: '画面特效',
  backgroundColor: '背景颜色',
  tuneShoes: '是否穿鞋', tuneSocks: '是否穿袜子',
};

const CENTER_GROUPS = [
  { title: '面部', fields: ['faceShape', 'eyeShape', 'pupil', 'eyeColor', 'eyebrow', 'mouth', 'nose', 'facialFeatures', 'skin'] },
  { title: '发型', fields: ['hairLength', 'hairStyle', 'ahoge', 'bangs', 'hairColor', 'hairColorExtra'] },
  { title: '妆容', fields: ['blush', 'eyeMakeup', 'lipstick', 'specialMakeup'] },
  { title: '服饰', fields: ['top', 'bottom', 'outerwear', 'onePiece', 'shoes', 'socks', 'outfitEffects', 'mainColors', 'accentColors'] },
  { title: '头部配饰', fields: ['hat', 'feminineAccessories', 'masculineAccessories', 'fantasyAccessories'] },
  { title: '配饰', fields: ['faceNeck', 'handsBack'] },
];

const TUNE_GROUPS = [
  { title: '鞋袜', fields: ['tuneShoes', 'tuneSocks'] },
  { title: '姿势与表情', fields: ['pose', 'handPose', 'headDirection', 'gazes', 'eyeEmotions', 'mouthStates', 'effectSymbols'] },
  { title: '手部持物', fields: ['handheld'] },
  { title: '场景构图与光影', fields: ['shot', 'camera', 'background', 'lighting', 'visualEffects', 'backgroundColor'] },
];

// 生成页三区：基准立绘（顶部全宽）、若干类单图（中间网格）、完整设定集（底部全宽）。
// 服饰拆解图和手部拆解图共用同一组输入（基准立绘 + 配套三视图）。
const BASE_BUTTONS = [['生成基准立绘', 'baseAspect']];
const TYPE_BUTTONS = [
  ['生成三视图', 'turnaroundAspect'],
  ['生成表情差分图', null],
  ['生成服饰拆解图', 'clothingAspect'],
  ['生成手部拆解图', 'handAspect'],
  ['生成Q版形象', null],
];
const SUITE_BUTTONS = [['生成完整设定集', null]];

// 锁脸说明原文：已开启锁脸模式提示。锁脸时由右栏渲染，重绘不会丢。
export const FACE_LOCK_MESSAGE = '已开启锁脸模式，当前角色的面部与妆容将由参考图决定。';

// 面部与妆容两个 details 在锁脸时禁用。
const LOCKED_GROUP_TITLES = new Set(['面部', '妆容']);

// 布尔开关类字段：渲染成切换按钮（switch）。
const SWITCH_FIELDS = new Set(['crossdressing', 'ahoge', 'tuneShoes', 'tuneSocks']);

function choice(field, value, state, mode) {
  const current = state[field];
  let selected = false;
  if (mode === 'multi') {
    const values = Array.isArray(current) ? current : [];
    selected = WU_VALUES.includes(value) ? values.length === 0 : values.includes(value);
  } else {
    selected = current === value;
  }
  return {
    field,
    value,
    label: value,
    selected,
    disabled: optionDisabled(field, value, state),
    mode,
    folded: false,
  };
}

// 参与「角色定位 → 推荐标黄」的服装字段。
const RECOMMENDED_FIELDS = new Set(['top', 'bottom', 'outerwear', 'onePiece', 'shoes', 'socks']);

function recommendedFor(field, state) {
  if (!RECOMMENDED_FIELDS.has(field)) return [];
  return (ROLE_RECOMMENDATIONS[state.role] || {})[field] || [];
}

// 把当前角色定位推荐的服装排到最前（保持推荐顺序），其余保持原有顺序。
// 「无」等占位符始终排在最前，推荐项紧随其后。
function reorderRecommended(field, source, state) {
  const rec = recommendedFor(field, state);
  if (!rec.length) return source;
  const placeholder = [];
  const preferred = [];
  const rest = [];
  const seen = new Set();
  for (const opt of source) {
    if (WU_VALUES.includes(opt.value)) {
      placeholder.push(opt);
      seen.add(opt.value);
    }
  }
  for (const value of rec) {
    const opt = source.find((entry) => entry.value === value);
    if (opt && !seen.has(value)) {
      seen.add(value);
      preferred.push(opt);
    }
  }
  for (const opt of source) {
    if (!seen.has(opt.value)) rest.push(opt);
  }
  return [...placeholder, ...preferred, ...rest];
}

function listedOptions(field, state) {
  const source = field === 'background' ? orderedOptions(field, state) : (OPTIONS[field] || []);
  const visible = source.filter((opt) => optionVisible(field, opt.value, state));
  let result = visible;
  if (field === 'mainColors' || field === 'accentColors') {
    const known = new Set(visible.map((opt) => opt.value));
    const extras = (Array.isArray(state[field]) ? state[field] : [])
      .filter((value) => !known.has(value))
      .map((value) => ({ value }));
    result = [...visible, ...extras];
  }
  return reorderRecommended(field, result, state);
}

// 这些字段的选项要带色块预览（命名色走 COLOR_HEX，自由色直接用十六进制值）。
const SWATCH_FIELDS = new Set(['hairColor', 'eyeColor', 'mainColors', 'accentColors']);

// 「可选颜色」条件取色器：选中 when 时显示一个 <input type="color">，写入 stateField。
const CONDITIONAL_COLOR_INPUTS = {
  hairColor: [{ stateField: 'hairColorCustom', when: '自定义', label: '自定义发色' }],
  eyeColor: [{ stateField: 'eyeColorCustom', when: '自定义', label: '自定义瞳色' }],
  pupil: [
    { stateField: 'heterochromiaLeft', when: '异色瞳（左红右蓝等可配）', label: '左眼颜色' },
    { stateField: 'heterochromiaRight', when: '异色瞳（左红右蓝等可配）', label: '右眼颜色' },
  ],
  eyeMakeup: [{ stateField: 'eyeShadowColor', when: '眼影（可选颜色）', label: '眼影颜色' }],
  lipstick: [{ stateField: 'lipColor', when: '唇彩颜色可选', label: '唇彩颜色' }],
  hairColorExtra: [
    { stateField: 'streakColor', when: '挑染', label: '挑染颜色' },
    { stateField: 'gradientRootColor', when: '渐变发色', label: '发根颜色' },
    { stateField: 'gradientTipColor', when: '渐变发色', label: '发尾颜色' },
  ],
};

function isHex(value) {
  return typeof value === 'string' && (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value));
}

function selectedValue(field, state, value) {
  if (Array.isArray(state[field])) return state[field].includes(value);
  return state[field] === value;
}

function clothingChoice(slot, part, opt) {
  return {
    field: slot,
    part,
    value: opt.value,
    label: opt.value,
    selected: false,
    disabled: false,
    mode: 'clothing',
    folded: Boolean(opt.folded),
    recommended: Boolean(opt.recommended),
    swatch: opt.swatch || null,
  };
}

function buildClothingField(slot, state) {
  const model = clothingView(slot, state);
  const current = state[slot] || {};
  const segments = model.segments.map((segment) => {
    const decorate = (opt) => {
      const choice = clothingChoice(slot, segment.key, opt);
      choice.selected = current[segment.key] === opt.value;
      if (segment.swatch) choice.swatch = COLOR_HEX[opt.value] || null;
      return choice;
    };
    if (segment.groups) {
      return {
        key: segment.key,
        label: segment.label,
        fine: Boolean(segment.fine),
        groups: segment.groups.map((group) => ({
          label: group.label,
          options: group.options.map(decorate),
        })),
      };
    }
    return {
      key: segment.key,
      label: segment.label,
      fine: Boolean(segment.fine),
      customActive: segment.key === 'color' && current.color === '自定义',
      customValue: current.colorCustom || '',
      options: (segment.options || []).map(decorate),
    };
  });
  return {
    field: slot,
    label: FIELD_LABELS[slot] || slot,
    mode: 'clothing',
    disabled: model.disabled,
    notes: model.notes,
    segments,
  };
}

function extractFolded(built) {
  const folded = [];
  const pull = (options) => {
    const stay = [];
    for (const opt of options || []) {
      if (opt.folded) folded.push(opt);
      else stay.push(opt);
    }
    return stay;
  };
  for (const segment of built.segments || []) {
    if (segment.options) segment.options = pull(segment.options);
    if (segment.groups) {
      segment.groups = segment.groups
        .map((group) => ({ ...group, options: pull(group.options) }))
        .filter((group) => group.options.length);
    }
  }
  return folded;
}

function buildField(field, state, { forceVisible = false, forceDisabled = false } = {}) {
  if (CLOTHING_SLOTS.includes(field)) return buildClothingField(field, state);
  if (!fieldVisible(field, state)) return null;
  if (SWITCH_FIELDS.has(field)) {
    return {
      field,
      value: true,
      label: FIELD_LABELS[field],
      selected: Boolean(state[field]),
      disabled: forceDisabled,
      mode: 'switch',
      folded: false,
    };
  }
  if (field === 'backgroundColor') {
    return {
      field,
      value: state.backgroundColor,
      label: FIELD_LABELS.backgroundColor,
      selected: false,
      disabled: false,
      mode: 'single',
      folded: false,
      colorInput: true,
    };
  }
  if (field === 'role') {
    return {
      field,
      label: FIELD_LABELS.role,
      mode: 'single',
      groups: ROLE_GROUPS.map((group) => ({
        label: group.label,
        options: group.options
          .filter((value) => optionVisible(field, value, state))
          .map((value) => choice(field, value, state, 'single')),
      })),
    };
  }
  if (field === 'background') {
    return {
      field,
      label: FIELD_LABELS.background,
      mode: 'single',
      groups: BACKGROUND_GROUPS.map((group) => ({
        label: group.label,
        options: group.options
          .filter((value) => optionVisible(field, value, state))
          .map((value) => choice(field, value, state, 'single')),
      })),
    };
  }
  const mode = Array.isArray(state[field]) ? 'multi' : 'single';
  // 锁脸时面部/妆容字段绕过显隐过滤，全部选项可见。
  const source = forceVisible ? (OPTIONS[field] || []) : listedOptions(field, state);
  const withSwatch = SWATCH_FIELDS.has(field);
  const recommendedSet = new Set(recommendedFor(field, state));
  const options = source.map((opt) => {
    const built = choice(field, opt.value, state, mode);
    if (forceDisabled) built.disabled = true;
    if (withSwatch) {
      built.swatch = COLOR_HEX[opt.value] || (isHex(opt.value) ? opt.value : null);
    }
    if (recommendedSet.has(opt.value)) built.recommended = true;
    return built;
  });
  if (options.length === 0) return null;
  const result = { field, label: FIELD_LABELS[field] || field, mode, options };
  if (field === 'mainColors' || field === 'accentColors') result.colorInput = true;
  const specs = CONDITIONAL_COLOR_INPUTS[field];
  if (specs) {
    result.colorInputs = specs.map((spec) => ({
      stateField: spec.stateField,
      label: spec.label,
      mode: 'value',
      value: state[spec.stateField] || '',
      active: selectedValue(field, state, spec.when),
    }));
  }
  return result;
}

function buildLeft(state) {
  const fields = ['gender', 'age', 'race', 'role', 'crossdressing']
    .map((field) => buildField(field, state))
    .filter(Boolean);
  const presets = [];
  for (const preset of PRESETS) {
    if (!optionVisible('colorPreset', preset.id, state)) continue;
    let group = presets.find((item) => item.label === preset.group);
    if (!group) {
      group = { label: preset.group, options: [] };
      presets.push(group);
    }
    group.options.push({
      field: 'colorPreset',
      value: preset.id,
      label: preset.name,
      selected: state.colorPreset === preset.id,
      disabled: false,
      mode: 'single',
      folded: false,
      swatch: preset.swatch,
    });
  }
  return { fields, presets };
}

function styleOptions(state) {
  return STYLE_OPTIONS.map((opt) => ({
    field: 'style',
    value: opt.value,
    label: opt.label,
    selected: state.style === opt.value,
    disabled: false,
    mode: 'single',
    folded: false,
  }));
}

function buildGroups(groups, state, { faceLocked = false } = {}) {
  return groups.map((group) => {
    const locked = faceLocked && LOCKED_GROUP_TITLES.has(group.title);
    const fields = [];
    const moreOptions = [];
    for (const name of group.fields) {
      const built = buildField(name, state, { forceVisible: locked, forceDisabled: locked });
      if (!built) continue;
      if (built.mode === 'clothing') {
        moreOptions.push(...extractFolded(built));
        fields.push(built);
        continue;
      }
      if (built.options) {
        moreOptions.push(...built.options.filter((option) => option.folded));
        built.options = built.options.filter((option) => !option.folded);
        if (built.options.length === 0) continue;
      }
      fields.push(built);
    }
    return {
      title: group.title,
      locked,
      fields,
      more: moreOptions.length ? { title: '更多', open: false, options: moreOptions } : null,
    };
  });
}

function buildCenter(state, options) {
  return buildGroups(CENTER_GROUPS, state, options);
}

function buildTune(state) {
  return {
    groups: buildGroups(TUNE_GROUPS, state),
    style: styleOptions(state),
    aspect: {
      field: 'tuneAspect',
      options: ASPECT_OPTIONS.tuneAspect.map((value) => choice('tuneAspect', value, state, 'single')),
    },
  };
}

function buildRight(state, { faceLocked = false } = {}) {
  const buttons = (pairs) => pairs.map(([label, field]) => ({
    label,
    aspect: field ? {
      field,
      options: ASPECT_OPTIONS[field].map((value) => choice(field, value, state, 'single')),
    } : null,
  }));
  return {
    style: styleOptions(state),
    base: buttons(BASE_BUTTONS),
    types: buttons(TYPE_BUTTONS),
    suite: buttons(SUITE_BUTTONS),
    reference: {
      label: '上传参考图',
      locked: faceLocked,
      message: faceLocked ? FACE_LOCK_MESSAGE : '',
      removeLabel: '移除',
    },
  };
}

export function viewModel(state, { faceLocked = false } = {}) {
  const linked = applyLinkage(state);
  // 锁脸时面部字段用未联动的原值（''/[]），不被联动补回默认脸；其余字段照常联动。
  const effective = faceLocked
    ? { ...linked, ...Object.fromEntries(FACE_FIELDS.map((f) => [f, structuredClone(state[f])])) }
    : linked;
  return {
    left: buildLeft(effective),
    center: buildCenter(effective, { faceLocked }),
    tune: buildTune(effective),
    right: buildRight(effective, { faceLocked }),
    warnings: warnings(effective),
  };
}
