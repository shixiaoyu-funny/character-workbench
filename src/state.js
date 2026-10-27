// 配置状态与自动保存：内存状态 + 防抖 localStorage 持久化。

export const CONFIG_KEY = 'myCharacterConfig';

const DEFAULT_STATE = {
  gender: '女', age: '少女', race: '人类', role: '日常休闲', crossdressing: false,
  faceShape: '鹅蛋脸（标准）', eyeShape: '杏眼（标准）', pupil: '圆形瞳', eyebrow: '细平眉',
  mouth: '嘴角上扬（默认微笑）', nose: '小翘鼻（默认）', facialFeatures: [], skin: '自然肤色',
  hairLength: '中长发', hairStyle: '双马尾（高/低）', ahoge: false, bangs: '空气刘海',
  hairColor: '黑', hairColorExtra: [],
  blush: '轻微（眼下微红）', eyeMakeup: [], lipstick: '自然色', specialMakeup: [],
  top: '衬衫', bottom: '百褶裙', outerwear: '无', onePiece: '无', shoes: '小皮鞋', socks: '无', materials: [],
  hat: '无', feminineAccessories: [], masculineAccessories: [], fantasyAccessories: [],
  faceNeck: [], handsBack: [], handheld: [],
  colorPreset: '', mainColors: [], accentColors: [], backgroundColor: '#ffffff',
  pose: '站立', handPose: '自然下垂', headDirection: '正面平视', gazes: ['看着镜头'],
  eyeEmotions: [], mouthStates: [], effectSymbols: [],
  shot: '全身像', camera: '平视', background: '纯色背景', lighting: '默认柔光', visualEffects: [],
  baseAspect: '3:4', turnaroundAspect: '16:9', clothingAspect: '1:1'
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
  return suspiciousString(value);
}

export function defaultState() {
  return structuredClone(DEFAULT_STATE);
}

export function sanitizeState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (FORBIDDEN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
  if (Object.keys(value).some((key) => suspiciousValue(value[key]))) return null;
  const out = {};
  for (const key of STATE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
    if (TYPE_OF(value[key]) !== EXPECTED_TYPES[key]) return null;
    out[key] = structuredClone(value[key]);
  }
  return out;
}

export function createStore({ storage, schedule, applyLinkage = (s) => s, onToast = () => {}, delay = 1000 } = {}) {
  let state = defaultState();
  let timerId = null;
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
    timerId = schedule.in(delay, () => {
      timerId = null;
      saveNow();
    });
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
      const pending = schedule.jobs.get(timerId);
      if (pending) pending.fn = null;
      timerId = null;
      saveNow();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
