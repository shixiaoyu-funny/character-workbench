import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../src/state.js';
import {
  OPTIONS, ROLE_GROUPS, PRESETS, COLOR_WORDS, FACE_FIELDS, ASPECT_OPTIONS,
} from '../src/catalog.js';
import {
  applyLinkage, optionVisible, fieldVisible, optionDisabled, warnings, orderedOptions,
} from '../src/rules.js';

const LYING_WARNING = '躺/趴姿势搭配平视容易出图失败，建议改为俯视。';
const HAT_WARNING = '帽子可能遮挡部分发型。';
const COLOR_WARNING = '颜色过多可能导致AI出图画面杂乱，建议精简颜色。';

test('default female/shoujo state: twintails visible, mullet hidden, crossdressing field hidden', () => {
  const s = defaultState();
  assert.equal(s.gender, '女');
  assert.equal(s.age, '少女');
  assert.equal(optionVisible('hairStyle', '双马尾（高/低）', s), true);
  assert.equal(optionVisible('hairStyle', '狼尾（Mullet）', s), false);
  assert.equal(fieldVisible('crossdressing', s), false);
  assert.equal(fieldVisible('feminineAccessories', s), true);
});

test('male linkage: age pool becomes xiaohai, crossdressing visible, gender-locked options hidden', () => {
  const s = applyLinkage({ ...defaultState(), gender: '男' });
  assert.equal(s.age, '小孩');
  assert.equal(fieldVisible('crossdressing', s), true);
  assert.equal(optionVisible('hairStyle', '双马尾（高/低）', s), false);
  assert.equal(optionVisible('hairStyle', '狼尾（Mullet）', s), true);
  assert.equal(optionVisible('bottom', '百褶裙', s), false);
  assert.equal(fieldVisible('feminineAccessories', s), false);
});

test('male with crossdressing true: hidden female options become visible again', () => {
  const s = applyLinkage({ ...defaultState(), gender: '男', crossdressing: true });
  assert.equal(s.crossdressing, true);
  assert.equal(optionVisible('hairStyle', '双马尾（高/低）', s), true);
  assert.equal(optionVisible('hairStyle', '狼尾（Mullet）', s), true, 'male replacement styles stay visible');
  assert.equal(fieldVisible('feminineAccessories', s), true);
});

test('loli hides mature options; wasteland role restores gun; night-rose preset hidden', () => {
  let s = applyLinkage({ ...defaultState(), age: '萝莉' });
  assert.equal(optionVisible('mouth', '猫唇（M字唇）', s), false);
  assert.equal(optionVisible('hairStyle', '大波浪', s), false);
  assert.equal(optionVisible('shoes', '高跟鞋', s), false);
  assert.equal(optionVisible('pose', '趴姿', s), false);
  assert.equal(optionVisible('mouthStates', '吐舌(调皮)', s), false);
  assert.equal(optionVisible('handheld', '枪械', s), false);
  s = applyLinkage({ ...defaultState(), age: '萝莉', role: '末世废土' });
  assert.equal(optionVisible('handheld', '枪械', s), true);
  assert.equal(optionVisible('handheld', '匕首', s), true);
  assert.equal(optionVisible('colorPreset', 'night-rose', s), false);
  assert.equal(optionVisible('colorPreset', 'dark-gold', s), false);
});

test('shoujo hides face tattoo and heavy blush but not high heels', () => {
  const s = defaultState();
  assert.equal(optionVisible('facialFeatures', '面部纹身（可选位置）', s), false);
  assert.equal(optionVisible('blush', '重度（全脸通红）', s), false);
  assert.equal(optionVisible('shoes', '高跟鞋', s), true);
});

test('handheld keeps at most the first two selected items', () => {
  const s = applyLinkage({ ...defaultState(), handheld: ['书本', '法杖', '长剑'] });
  assert.deepEqual(s.handheld, ['书本', '法杖']);
});

test('holding a sword disables arms-crossed and linkage bounces the pose back', () => {
  const withSword = { ...defaultState(), handheld: ['长剑'] };
  assert.equal(optionDisabled('handPose', '双手抱胸', withSword), true);
  assert.equal(optionDisabled('handPose', '自然下垂', withSword), false);
  const crossed = { ...defaultState(), handPose: '双手抱胸' };
  assert.equal(optionDisabled('handheld', '长剑', crossed), true);
  const linked = applyLinkage({ ...defaultState(), handheld: ['长剑'], handPose: '双手抱胸' });
  assert.notEqual(linked.handPose, '双手抱胸');
  assert.ok(OPTIONS.handPose.some((o) => o.value === linked.handPose));
});

test('warnings: lying pose with eye-level camera, hat notice, too many main colors', () => {
  assert.deepEqual(warnings(defaultState()), []);
  const w1 = warnings({ ...defaultState(), pose: '躺姿' });
  assert.ok(w1.includes(LYING_WARNING), JSON.stringify(w1));
  const w1b = warnings({ ...defaultState(), pose: '趴姿' });
  assert.ok(w1b.includes(LYING_WARNING));
  const w2 = warnings({ ...defaultState(), hat: '贝雷帽' });
  assert.ok(w2.includes(HAT_WARNING));
  assert.ok(!w2.includes(LYING_WARNING));
  const w3 = warnings({ ...defaultState(), mainColors: ['黑', '白', '红', '银'] });
  assert.ok(w3.includes(COLOR_WARNING));
  const w4 = warnings({ ...defaultState(), accentColors: ['黑', '白', '红', '银', '金', '粉'] });
  assert.ok(w4.includes(COLOR_WARNING));
});

test('orderedOptions puts the recommended background first by role', () => {
  const cyber = applyLinkage({ ...defaultState(), role: '赛博朋克' });
  assert.equal(orderedOptions('background', cyber)[0].value, '赛博霓虹街');
  const fantasy = applyLinkage({ ...defaultState(), role: '西式奇幻（剑与魔法）' });
  assert.equal(orderedOptions('background', fantasy)[0].value, '奇幻森林');
  const plain = orderedOptions('background', defaultState());
  assert.equal(plain[0].value, '纯色背景(可自选颜色)');
  assert.equal(plain.length, OPTIONS.background.length);
});

test('wu is dropped when it coexists with concrete values', () => {
  const s = applyLinkage({ ...defaultState(), specialMakeup: ['无', '绷带'] });
  assert.deepEqual(s.specialMakeup, ['绷带']);
  const onlyWu = applyLinkage({ ...defaultState(), visualEffects: ['无'] });
  assert.deepEqual(onlyWu.visualEffects, []);
  const none = applyLinkage({ ...defaultState(), specialMakeup: ['无'] });
  assert.deepEqual(none.specialMakeup, []);
});

test('applyLinkage returns a new object and never mutates its input', () => {
  const input = { ...defaultState(), gender: '男', specialMakeup: ['无', '绷带'] };
  const snapshot = structuredClone(input);
  const out = applyLinkage(input);
  assert.notEqual(out, input);
  assert.deepEqual(input, snapshot);
  assert.equal(out.age, '小孩');
  assert.deepEqual(out.specialMakeup, ['绷带']);
  assert.deepEqual(input.specialMakeup, ['无', '绷带']);
});

test('after linkage every single-select default value is wu or visible', () => {
  const linked = applyLinkage(defaultState());
  const multi = new Set(['facialFeatures', 'hairColorExtra', 'eyeMakeup', 'specialMakeup', 'materials',
    'feminineAccessories', 'masculineAccessories', 'fantasyAccessories', 'faceNeck', 'handsBack', 'handheld',
    'mainColors', 'accentColors', 'gazes', 'eyeEmotions', 'mouthStates', 'effectSymbols', 'visualEffects']);
  const skipped = new Set(['crossdressing', 'ahoge', 'backgroundColor']);
  for (const [field, value] of Object.entries(linked)) {
    if (multi.has(field) || skipped.has(field) || field.endsWith('Aspect')) continue;
    assert.ok(Array.isArray(OPTIONS[field]), `OPTIONS missing for ${field}`);
    assert.ok(value === '无' || optionVisible(field, value, linked), `${field}=${value} must be visible`);
  }
  // legacy short labels from state.js are normalized to the catalog label
  assert.equal(linked.camera, '平视(默认)');
  assert.equal(linked.background, '纯色背景(可自选颜色)');
  assert.deepEqual(OPTIONS.hairColorExtra.map((o) => o.value), ['挑染', '渐变发色']);
  const male = applyLinkage({ ...defaultState(), gender: '男' });
  assert.equal(typeof male.ahoge, 'boolean');
  assert.equal(male.crossdressing, false);
});

test('female linkage forces crossdressing false and keeps all female ages', () => {
  const s = applyLinkage({ ...defaultState(), crossdressing: true });
  assert.equal(s.crossdressing, false);
  for (const age of ['萝莉', '少女', '成女']) {
    assert.equal(applyLinkage({ ...defaultState(), age }).age, age);
  }
  assert.equal(applyLinkage({ ...defaultState(), age: '小孩' }).age, '萝莉');
  const male = applyLinkage({ ...defaultState(), gender: '男', age: '成女' });
  assert.equal(male.age, '小孩');
});

test('multi fields with wu expose wu in OPTIONS; shared accessories appear in both gender lists', () => {
  const withWu = ['specialMakeup', 'effectSymbols', 'visualEffects', 'feminineAccessories',
    'masculineAccessories', 'fantasyAccessories', 'faceNeck', 'handsBack', 'handheld'];
  for (const field of withWu) {
    assert.ok(OPTIONS[field].some((o) => o.value === '无' && o.tag === ''), `${field} must list wu with empty tag`);
  }
  const shared = ['运动发带', '护额（忍者/运动）', '头戴式耳机（电竞/赛博）', '战术护目镜', '单片眼镜（复古）', '绷带（战损缠头）'];
  for (const item of shared) {
    assert.ok(OPTIONS.feminineAccessories.some((o) => o.value === item), `feminine missing ${item}`);
    assert.ok(OPTIONS.masculineAccessories.some((o) => o.value === item), `masculine missing ${item}`);
    const femTag = OPTIONS.feminineAccessories.find((o) => o.value === item).tag;
    const mascTag = OPTIONS.masculineAccessories.find((o) => o.value === item).tag;
    assert.equal(femTag, mascTag);
  }
});

test('catalog surface: ROLE_GROUPS cover all roles, 24 presets with required fields, aspect options', () => {
  const allRoles = OPTIONS.role.map((o) => o.value);
  const grouped = ROLE_GROUPS.flatMap((g) => g.options);
  assert.deepEqual([...grouped].sort(), [...allRoles].sort());
  assert.equal(PRESETS.length, 24);
  for (const p of PRESETS) {
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id), `${p.id} must be kebab-case`);
    for (const key of ['id', 'group', 'name', 'main', 'accent', 'tags', 'swatch']) {
      assert.ok(p[key] !== undefined, `preset ${p.id} missing ${key}`);
    }
    assert.equal(p.swatch.length, 2);
    assert.ok(p.tags.length > 0);
  }
  assert.deepEqual(ASPECT_OPTIONS, {
    baseAspect: ['3:4', '9:16', '1:1'],
    turnaroundAspect: ['16:9', '3:2'],
    clothingAspect: ['1:1', '4:3'],
  });
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, 24);
});

test('every preset main and accent color is a COLOR_WORDS key', () => {
  for (const p of PRESETS) {
    for (const word of [...p.main, ...p.accent]) {
      assert.ok(COLOR_WORDS[word] !== undefined, `preset ${p.id}: COLOR_WORDS missing ${word}`);
    }
  }
});

test('COLOR_WORDS covers every Chinese color name used by presets', () => {
  const needed = ['黑', '红', '白', '灰', '藏青', '浅灰', '浅蓝', '卡其', '浅棕', '米色', '银',
    '浅粉', '薄荷绿', '浅黄', '浅紫', '粉', '鹅黄', '纯黑', '暗红', '紫', '深灰', '深绿', '金',
    '暗黄', '荧光绿', '荧光粉', '亮蓝', '青色', '棕', '沙色', '生锈红', '深棕', '黄铜', '暗金',
    '青', '墨蓝', '朱红', '竹绿', '墨黑', '橄榄绿', '浅绿', '血红', '深蓝', '蕾丝'];
  for (const word of needed) {
    assert.ok(COLOR_WORDS[word] !== undefined, `COLOR_WORDS missing ${word}`);
    assert.equal(typeof COLOR_WORDS[word], 'string');
  }
  assert.equal(COLOR_WORDS['蕾丝'], 'lace');
});

test('FACE_FIELDS lists the twelve face fields', () => {
  assert.deepEqual(FACE_FIELDS, ['faceShape', 'eyeShape', 'pupil', 'eyebrow', 'mouth', 'nose',
    'facialFeatures', 'skin', 'blush', 'eyeMakeup', 'lipstick', 'specialMakeup']);
});

test('out-of-range single values fall back to the first visible option; aspects clamp to first', () => {
  const s = applyLinkage({ ...defaultState(), hairStyle: '大波浪', age: '萝莉' });
  assert.notEqual(s.hairStyle, '大波浪');
  assert.ok(optionVisible('hairStyle', s.hairStyle, s));
  const maleBottom = applyLinkage({ ...defaultState(), gender: '男', bottom: '百褶裙' });
  assert.notEqual(maleBottom.bottom, '百褶裙');
  assert.ok(optionVisible('bottom', maleBottom.bottom, maleBottom));
  const badAspect = applyLinkage({ ...defaultState(), baseAspect: '21:9' });
  assert.equal(badAspect.baseAspect, '3:4');
  const okAspect = applyLinkage({ ...defaultState(), turnaroundAspect: '3:2' });
  assert.equal(okAspect.turnaroundAspect, '3:2');
});

test('invisible multi values are removed, invisible preset selection resets to empty', () => {
  const s = applyLinkage({
    ...defaultState(),
    age: '萝莉',
    handheld: ['枪械', '书本'],
    mouthStates: ['微笑', '吐舌(调皮)'],
    eyeMakeup: ['眼线（上挑猫眼/下垂无辜眼）'],
  });
  assert.deepEqual(s.handheld, ['书本']);
  assert.deepEqual(s.mouthStates, ['微笑']);
  assert.deepEqual(s.eyeMakeup, []);
  const preset = applyLinkage({ ...defaultState(), age: '萝莉', colorPreset: 'night-rose' });
  assert.equal(preset.colorPreset, '');
});
