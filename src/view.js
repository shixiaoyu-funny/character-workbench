// 纯视图模型：把联动后的状态整理成左、中、右三栏控件。

import {
  OPTIONS, ROLE_GROUPS, PRESETS, ASPECT_OPTIONS, FACE_FIELDS,
} from './catalog.js';
import {
  applyLinkage, optionVisible, fieldVisible, optionDisabled, warnings, orderedOptions,
} from './rules.js';

const FIELD_LABELS = {
  gender: '性别', age: '年龄', race: '种族', role: '角色定位', crossdressing: '特殊/伪娘',
  faceShape: '脸型', eyeShape: '眼型', pupil: '瞳孔', eyebrow: '眉毛', mouth: '嘴巴', nose: '鼻子',
  facialFeatures: '面部特征', skin: '肤色',
  hairLength: '长度', hairStyle: '基础造型', ahoge: '呆毛', bangs: '刘海', hairColor: '发色',
  hairColorExtra: '挑染与渐变',
  blush: '腮红', eyeMakeup: '眼妆', lipstick: '唇妆', specialMakeup: '特殊妆容',
  top: '上装', bottom: '下装', outerwear: '外套', onePiece: '连体装', shoes: '鞋子', socks: '袜子',
  materials: '材质', mainColors: '主色', accentColors: '辅色',
  hat: '帽子', feminineAccessories: '女生向小发饰', masculineAccessories: '男生向配饰',
  fantasyAccessories: '特殊奇幻',
  faceNeck: '面部颈部', handsBack: '手部背部', handheld: '手持道具',
  pose: '基础体态', handPose: '手部动作', headDirection: '头部朝向', gazes: '视线',
  eyeEmotions: '眼部情绪', mouthStates: '嘴部状态', effectSymbols: '特效符号',
  shot: '景别', camera: '镜头', background: '背景', lighting: '光影', visualEffects: '画面特效',
  backgroundColor: '背景颜色',
};

const CENTER_GROUPS = [
  { title: '面部', fields: ['faceShape', 'eyeShape', 'pupil', 'eyebrow', 'mouth', 'nose', 'facialFeatures', 'skin'] },
  { title: '发型', fields: ['hairLength', 'hairStyle', 'ahoge', 'bangs', 'hairColor', 'hairColorExtra'] },
  { title: '妆容', fields: ['blush', 'eyeMakeup', 'lipstick', 'specialMakeup'] },
  { title: '服饰', fields: ['top', 'bottom', 'outerwear', 'onePiece', 'shoes', 'socks', 'materials', 'mainColors', 'accentColors'] },
  { title: '头部配饰', fields: ['hat', 'feminineAccessories', 'masculineAccessories', 'fantasyAccessories'] },
  { title: '配饰与手持物', fields: ['faceNeck', 'handsBack', 'handheld'] },
  { title: '姿势与表情', fields: ['pose', 'handPose', 'headDirection', 'gazes', 'eyeEmotions', 'mouthStates', 'effectSymbols'] },
  { title: '场景构图与光影', fields: ['shot', 'camera', 'background', 'lighting', 'visualEffects', 'backgroundColor'] },
];

const GENERATE_BUTTONS = [
  ['生成基准立绘', 'baseAspect'],
  ['生成三视图', 'turnaroundAspect'],
  ['生成表情差分图', null],
  ['生成服饰拆解图', 'clothingAspect'],
  ['生成Q版形象', null],
  ['生成完整图片（一键全套）', null],
];

// 锁脸说明原文：已开启锁脸模式提示。锁脸时由右栏渲染，重绘不会丢。
export const FACE_LOCK_MESSAGE = '已开启锁脸模式，当前角色的面部与妆容将由参考图决定。';

// 面部与妆容两个 details 在锁脸时禁用。
const LOCKED_GROUP_TITLES = new Set(['面部', '妆容']);

function choice(field, value, state, mode) {
  const current = state[field];
  let selected = false;
  if (mode === 'multi') {
    const values = Array.isArray(current) ? current : [];
    selected = value === '无' ? values.length === 0 : values.includes(value);
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
    folded: field === 'shoes' && value === '高跟鞋' && state.age === '少女',
  };
}

function listedOptions(field, state) {
  const source = field === 'background' ? orderedOptions(field, state) : (OPTIONS[field] || []);
  const visible = source.filter((opt) => optionVisible(field, opt.value, state));
  if (field !== 'mainColors' && field !== 'accentColors') return visible;
  const known = new Set(visible.map((opt) => opt.value));
  const extras = (Array.isArray(state[field]) ? state[field] : [])
    .filter((value) => !known.has(value))
    .map((value) => ({ value }));
  return [...visible, ...extras];
}

function buildField(field, state, { forceVisible = false, forceDisabled = false } = {}) {
  if (!fieldVisible(field, state)) return null;
  if (field === 'crossdressing' || field === 'ahoge') {
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
  const mode = Array.isArray(state[field]) ? 'multi' : 'single';
  // 锁脸时面部/妆容字段绕过显隐过滤，全部选项可见。
  const source = forceVisible ? (OPTIONS[field] || []) : listedOptions(field, state);
  const options = source.map((opt) => {
    const built = choice(field, opt.value, state, mode);
    if (forceDisabled) built.disabled = true;
    return built;
  });
  if (options.length === 0) return null;
  const result = { field, label: FIELD_LABELS[field] || field, mode, options };
  if (field === 'mainColors' || field === 'accentColors') result.colorInput = true;
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

function buildCenter(state, { faceLocked = false } = {}) {
  return CENTER_GROUPS.map((group) => {
    const locked = faceLocked && LOCKED_GROUP_TITLES.has(group.title);
    const fields = [];
    const moreOptions = [];
    for (const name of group.fields) {
      const built = buildField(name, state, { forceVisible: locked, forceDisabled: locked });
      if (!built) continue;
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

function buildRight(state, { faceLocked = false } = {}) {
  return {
    buttons: GENERATE_BUTTONS.map(([label, field]) => ({
      label,
      aspect: field ? {
        field,
        options: ASPECT_OPTIONS[field].map((value) => choice(field, value, state, 'single')),
      } : null,
    })),
    reference: {
      label: '上传参考图',
      locked: faceLocked,
      message: faceLocked ? FACE_LOCK_MESSAGE : '',
      removeLabel: '移除',
    },
    preview: '还没有图片',
    gallery: '图库是空的',
    download: '下载页',
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
    right: buildRight(effective, { faceLocked }),
    warnings: warnings(effective),
  };
}
