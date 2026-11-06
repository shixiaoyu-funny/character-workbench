// 配置状态与自动保存：内存状态 + 防抖 localStorage 持久化。

import { defaultClothing, migrateClothing } from './clothing.js';

export const CONFIG_KEY = 'myCharacterConfig';

const DEFAULT_STATE = {
  gender: '女', age: '少女', race: '人类', role: '日常休闲', crossdressing: false,
  faceShape: '鹅蛋脸（标准）', eyeShape: '杏眼（标准）', pupil: '圆形瞳', eyebrow: '细平眉',
  mouth: '嘴角上扬（默认微笑）', nose: '小翘鼻（默认）', facialFeatures: [], skin: '自然肤色',
  heterochromiaLeft: '', heterochromiaRight: '',
  // 瞳色：表单直接钉死，不再让模型从参考图里去猜。
  // 「跟随参考图」表示不写进提示词（锁脸时的默认行为，不给模型添矛盾）。
  eyeColor: '跟随参考图', eyeColorCustom: '',
  hairLength: '中长发', hairStyle: '双马尾（高/低）', ahoge: false, bangs: '空气刘海',
  hairColor: '黑', hairColorCustom: '', hairColorExtra: '无',
  streakColor: '', gradientRootColor: '', gradientTipColor: '',
  blush: '轻微（眼下微红）', eyeMakeup: [], eyeShadowColor: '', lipstick: '自然色', lipColor: '', specialMakeup: [],
  ...defaultClothing(),
  outfitEffects: [],
  hat: '无', feminineAccessories: [], masculineAccessories: [], fantasyAccessories: [],
  faceNeck: [], handsBack: [], handheld: [],
  colorPreset: '', mainColors: [], accentColors: [], backgroundColor: '#ffffff',
  pose: ['站立'], handPose: ['自然下垂'], headDirection: ['正面平视'], gazes: ['看着镜头'],
  eyeEmotions: [], mouthStates: [], effectSymbols: [],
  shot: '全身像', camera: '平视', background: '纯色背景', lighting: '默认柔光', visualEffects: [],
  baseAspect: '3:4', turnaroundAspect: '16:9', clothingAspect: '1:1', handAspect: '1:1', tuneAspect: '3:4',
  style: '二次元风格',
  tuneGender: '女',
  tuneShoes: true,
  tuneSocks: true,
  colorNames: {},
};

// 类型表按 defaultState() 的运行时类型生成，不手写第二份键清单。
const STATE_KEYS = Object.keys(DEFAULT_STATE);
const TYPE_OF = (v) => (Array.isArray(v) ? 'array' : typeof v);
const EXPECTED_TYPES = Object.fromEntries(STATE_KEYS.map((k) => [k, TYPE_OF(DEFAULT_STATE[k])]));

const FORBIDDEN_KEYS = ['image', 'images', 'base64', 'dataUrl', 'objectUrl', 'seed', 'reference', 'baseImage'];
const SUSPICIOUS_PREFIXES = ['data:image/', 'blob:'];
const MAX_STRING_LENGTH = 500;

function suspiciousString(value) {
  if (typeof value !== 'string') return false;
  if (value.length > MAX_STRING_LENGTH) return true;
  return SUSPICIOUS_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function suspiciousValue(value) {
  if (Array.isArray(value)) return value.some(suspiciousValue);
  if (value && typeof value === 'object') return Object.values(value).some(suspiciousValue);
  return suspiciousString(value);
}

// colorNames 必须是 { '#rrggbb': '英文描述' } 的普通对象；值要短且不含危险前缀。
function sanitizeColorNames(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [key, name] of Object.entries(value)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(key)) return null;
    if (typeof name !== 'string' || !name || name.length > 100 || suspiciousString(name)) return null;
    out[key.toLowerCase()] = name;
  }
  return out;
}

export function defaultState() {
  return structuredClone(DEFAULT_STATE);
}

const TUNE_MULTI = ['pose', 'handPose', 'headDirection'];

// 后加字段：旧存档缺这些键时回退默认值，而不是判定整份配置损坏。
const LATE_FIELDS = new Set(['style', 'tuneAspect', 'tuneGender', 'eyeColor', 'eyeColorCustom']);

function migrateTuneState(value) {
  const next = { ...value };
  for (const key of TUNE_MULTI) {
    if (typeof next[key] === 'string') next[key] = next[key] ? [next[key]] : [];
  }
  if (!Object.prototype.hasOwnProperty.call(next, 'tuneAspect')) next.tuneAspect = DEFAULT_STATE.tuneAspect;
  if (next.tuneGender !== '男' && next.tuneGender !== '女') next.tuneGender = DEFAULT_STATE.tuneGender;
  // 鞋袜开关是后加字段：旧存档缺省或类型异常时回退默认（跟随角色配置）。
  if (typeof next.tuneShoes !== 'boolean') next.tuneShoes = DEFAULT_STATE.tuneShoes;
  if (typeof next.tuneSocks !== 'boolean') next.tuneSocks = DEFAULT_STATE.tuneSocks;
  return next;
}

export function sanitizeState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (FORBIDDEN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
  value = migrateTuneState(migrateClothing(value));
  if (Object.keys(value).some((key) => suspiciousValue(value[key]))) return null;
  const colorNames = sanitizeColorNames(value.colorNames);
  if (colorNames === null) return null;
  const out = {};
  for (const key of STATE_KEYS) {
    // style、tuneAspect 是后加字段：旧存档没有它们时回退默认，避免整份配置被当作损坏重置。
    if (LATE_FIELDS.has(key) && !Object.prototype.hasOwnProperty.call(value, key)) {
      out[key] = DEFAULT_STATE[key];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
    if (TYPE_OF(value[key]) !== EXPECTED_TYPES[key]) return null;
    out[key] = structuredClone(value[key]);
  }
  // 风格旧值迁移：米哈游风 / 写实风二次元 一律映射为 二次元风格，否则老存档的风格按钮全不选中。
  if (out.style === '米哈游风' || out.style === '写实风二次元') out.style = '二次元风格';
  out.colorNames = colorNames;
  return out;
}

export function createStore({ storage, schedule, applyLinkage = (s) => s, onToast = () => {}, delay = 1000 } = {}) {
  let state = defaultState();
  let timerId = null;
  let pendingSave = null;
  let announcedSave = false;
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(state);
  }

  function saveNow() {
    try {
      storage.setItem(CONFIG_KEY, JSON.stringify(state));
      if (!announcedSave) {
        announcedSave = true;
        onToast('配置已保存到本地');
      }
    } catch {
      onToast('保存失败');
    }
  }

  function scheduleSave() {
    if (timerId !== null) schedule.cancel(timerId);
    pendingSave = () => {
      timerId = null;
      pendingSave = null;
      saveNow();
    };
    timerId = schedule.in(delay, pendingSave);
  }

  function resetToDefault() {
    storage.removeItem(CONFIG_KEY);
    state = defaultState();
    notify();
  }

  return {
    getState() {
      return structuredClone(state);
    },
    replace(next) {
      state = applyLinkage(next);
      notify();
      scheduleSave();
    },
    hydrate() {
      const raw = storage.getItem(CONFIG_KEY);
      if (raw === null || raw === undefined) {
        state = defaultState();
        notify();
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        resetToDefault();
        return;
      }
      const sanitized = sanitizeState(parsed);
      if (sanitized === null) {
        resetToDefault();
        return;
      }
      const linked = applyLinkage(sanitized);
      state = linked;
      notify();
      if (JSON.stringify(linked) !== raw) saveNow();
    },
    flush() {
      if (timerId === null) return;
      schedule.cancel(timerId);
      const run = pendingSave;
      timerId = null;
      pendingSave = null;
      run();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
