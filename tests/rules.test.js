import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../src/state.js';
import {
  OPTIONS, ROLE_GROUPS, PRESETS, COLOR_WORDS, FACE_FIELDS, ASPECT_OPTIONS,
  ROLE_RECOMMENDATIONS, WU_VALUES, MOUTH_COMPATIBILITY, POSE_COMPATIBILITY,
} from '../src/catalog.js';
import {
  applyLinkage, optionVisible, fieldVisible, optionDisabled, warnings, orderedOptions,
} from '../src/rules.js';
import { hasClothingOption, isChoiceVisible } from '../src/clothing.js';

const LYING_WARNING = '躺/趴姿势搭配平视容易出图失败，建议改为俯视。';
const HAT_WARNING = '帽子可能遮挡部分发型。';
const COLOR_WARNING = '颜色过多可能导致AI出图画面杂乱，建议精简颜色。';
const CLIPPING_WARNING = '站立/行走/奔跑/跳跃姿势搭配沙发、床等坐卧场景可能穿模，建议改为坐姿或躺姿。';

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
  assert.equal(isChoiceVisible('bottom', 'style', '百褶裙', s), false);
  assert.equal(fieldVisible('feminineAccessories', s), false);
});

test('male with crossdressing true: hidden female options become visible again', () => {
  const s = applyLinkage({ ...defaultState(), gender: '男', crossdressing: true });
  assert.equal(s.crossdressing, true);
  assert.equal(optionVisible('hairStyle', '双马尾（高/低）', s), true);
  assert.equal(optionVisible('hairStyle', '狼尾（Mullet）', s), true, 'male replacement styles stay visible');
  assert.equal(fieldVisible('feminineAccessories', s), true);
});

test('female age never hides mature options, weapons, or presets', () => {
  const s = applyLinkage({ ...defaultState(), age: '萝莉' });
  assert.equal(optionVisible('mouth', '猫唇（M字唇）', s), true);
  assert.equal(optionVisible('hairStyle', '大波浪', s), true);
  assert.equal(isChoiceVisible('shoes', 'style', '细高跟鞋', s), true);
  assert.equal(optionVisible('pose', '平趴', s), true);
  assert.equal(optionVisible('pose', '侧躺', s), true);
  assert.equal(optionVisible('pose', '正坐', s), true);
  assert.equal(optionVisible('mouthStates', '吐舌(调皮)', s), true);
  assert.equal(optionVisible('handheld', '枪械', s), true);
  assert.equal(optionVisible('handheld', '匕首', s), true);
  assert.equal(optionVisible('colorPreset', 'night-rose', s), true);
  assert.equal(optionVisible('colorPreset', 'dark-gold', s), true);
});

test('shoujo no longer hides face tattoo, heavy blush, or battle damage', () => {
  const s = defaultState();
  assert.equal(optionVisible('facialFeatures', '面部纹身（可选位置）', s), true);
  assert.equal(optionVisible('blush', '重度（全脸通红）', s), true);
  assert.equal(optionVisible('outfitEffects', '全身战损', s), true);
  assert.equal(isChoiceVisible('shoes', 'style', '细高跟鞋', s), true);
});

test('expanded female-only clothing is hidden for males until crossdressing', () => {
  const male = applyLinkage({ ...defaultState(), gender: '男' });
  const femaleOnly = [
    ['top', '皮质胸衣'], ['top', '蕾丝吊带'], ['top', '巫女白衣'],
    ['onePiece', '婚纱'], ['onePiece', '晚礼服'], ['onePiece', '齐胸襦裙'],
    ['shoes', '玛丽珍'], ['shoes', '绑带高跟鞋'],
    ['socks', '吊带袜'], ['bottom', '高开叉长裙'],
  ];
  for (const [field, value] of femaleOnly) {
    assert.equal(isChoiceVisible(field, 'style', value, male), false, `${field}=${value} should be hidden for male`);
  }
  const crossdressing = applyLinkage({ ...defaultState(), gender: '男', crossdressing: true });
  assert.equal(isChoiceVisible('onePiece', 'style', '婚纱', crossdressing), true);
  assert.equal(isChoiceVisible('top', 'style', '皮质胸衣', crossdressing), true);
  assert.equal(isChoiceVisible('socks', 'style', '吊带袜', crossdressing), true);
  assert.equal(isChoiceVisible('top', 'style', '和服上着', male), true);
  assert.equal(isChoiceVisible('bottom', 'style', '直筒长裤', male), true);
  assert.equal(isChoiceVisible('onePiece', 'style', '战甲', male), true);
});

test('female ages never hide clothing; male-only clothing stays hidden', () => {
  const loli = applyLinkage({ ...defaultState(), age: '萝莉' });
  assert.equal(isChoiceVisible('onePiece', 'style', '婚纱', loli), true);
  assert.equal(isChoiceVisible('onePiece', 'style', '晚礼服', loli), true);
  assert.equal(isChoiceVisible('onePiece', 'style', '旗袍', loli), true);
  assert.equal(isChoiceVisible('shoes', 'style', '绑带高跟鞋', loli), true);
  assert.equal(isChoiceVisible('socks', 'style', '吊带袜', loli), true);
  assert.equal(isChoiceVisible('top', 'style', '皮质胸衣', loli), true);
  assert.equal(optionVisible('outfitEffects', '湿身', loli), true);
  assert.equal(isChoiceVisible('bottom', 'style', '高开叉长裙', loli), true);

  const shoujo = defaultState();
  assert.equal(optionVisible('outfitEffects', '全身战损', shoujo), true);
  assert.equal(optionVisible('outfitEffects', '湿身', shoujo), true);
  assert.equal(isChoiceVisible('top', 'detail', '丝绸', shoujo), true);
  assert.equal(isChoiceVisible('onePiece', 'style', '婚纱', shoujo), true);

  const male = applyLinkage({ ...defaultState(), gender: '男' });
  assert.equal(isChoiceVisible('onePiece', 'style', '婚纱', male), false);
  assert.equal(isChoiceVisible('shoes', 'style', '细高跟鞋', male), false);
});

test('handheld keeps every selected item', () => {
  const s = applyLinkage({ ...defaultState(), handheld: ['书本', '法杖', '长剑'] });
  assert.deepEqual(s.handheld, ['书本', '法杖', '长剑']);
});

test('a held item drops poses that use both hands and greys those buttons', () => {
  const linked = applyLinkage({
    ...defaultState(),
    handheld: ['长剑'],
    handPose: ['双手抱胸', '单手叉腰', '自然下垂', '提着裙摆', '持物（配合道具）', '双手背后'],
  });
  assert.equal(linked.handPose.includes('双手抱胸'), false);
  assert.equal(linked.handPose.includes('双手背后'), false);
  assert.equal(linked.handPose.includes('持物（配合道具）'), false);
  assert.equal(linked.handPose.includes('单手叉腰'), true);
  assert.equal(linked.handPose.includes('自然下垂'), true);
  assert.equal(linked.handPose.includes('单手提着裙摆'), true);
  assert.deepEqual(linked.handheld, ['长剑']);
  assert.equal(optionDisabled('handPose', '双手抱胸', linked), true);
  assert.equal(optionDisabled('handPose', '单手叉腰', linked), false);
});

test('adding a pose keeps only actions shared by every selected pose', () => {
  const linked = applyLinkage({
    ...defaultState(),
    pose: ['站立', '坐姿'],
    handPose: ['双手背后', '自然下垂', '挥手'],
    headDirection: ['回眸(回头看)', '歪头'],
    eyeEmotions: ['慵懒', '开心(弯眼)'],
  });
  assert.deepEqual(linked.handPose, ['自然下垂', '挥手']);
  assert.deepEqual(linked.headDirection, ['回眸(回头看)']);
  assert.deepEqual(linked.eyeEmotions, ['开心(弯眼)']);
  assert.equal(optionVisible('handPose', '双手背后', linked), false);
  assert.equal(optionVisible('handPose', '自然下垂', linked), true);
  assert.equal(optionVisible('eyeEmotions', '慵懒', linked), false);
  assert.equal(optionVisible('eyeEmotions', '慵懒', { ...linked, pose: ['坐姿'] }), true);
  assert.equal(optionVisible('eyeEmotions', '慵懒', { ...linked, pose: ['正坐'] }), true);
  assert.equal(optionVisible('eyeEmotions', '慵懒', { ...linked, pose: ['跷二郎腿'] }), true);
});

test('split poses replace the old pose and keep its actions', () => {
  const sitting = applyLinkage({ ...defaultState(), pose: ['坐姿'], eyeEmotions: ['慵懒'] });
  assert.deepEqual(sitting.pose, ['跷二郎腿', '正坐']);
  assert.deepEqual(sitting.eyeEmotions, ['慵懒']);
  assert.deepEqual(applyLinkage({ ...defaultState(), pose: '躺姿' }).pose, ['平躺', '侧躺']);
  const prone = applyLinkage({ ...defaultState(), pose: ['趴姿'] });
  assert.deepEqual(prone.pose, ['平趴', '小腿交叉趴着']);
  assert.equal(optionVisible('handPose', '双手撑地', { ...prone, pose: ['平趴'] }), true);
  assert.equal(optionVisible('handPose', '双手撑地', { ...prone, pose: ['小腿交叉趴着'] }), true);
  assert.equal(optionVisible('handPose', '双手撑地', { ...prone, pose: ['正坐'] }), false);
});

test('every eye emotion carries 2~5 compatible mouth states and linkage drops the rest', () => {
  for (const [eye, mouths] of Object.entries(MOUTH_COMPATIBILITY)) {
    assert.ok(mouths.length >= 2 && mouths.length <= 5, `${eye} has ${mouths.length} mouths`);
    for (const mouth of mouths) {
      assert.ok(OPTIONS.mouthStates.some((option) => option.value === mouth), `${eye} -> ${mouth} missing`);
    }
  }
  const happy = { ...defaultState(), eyeEmotions: ['开心(弯眼)'] };
  assert.equal(optionVisible('mouthStates', '微笑', happy), true);
  assert.equal(optionVisible('mouthStates', '撇嘴(嫌弃)', happy), false);
  const angry = { ...defaultState(), eyeEmotions: ['生气(皱眉)'] };
  assert.equal(optionVisible('mouthStates', '撇嘴(嫌弃)', angry), true);
  assert.equal(optionVisible('mouthStates', '微笑', angry), false);
  const linked = applyLinkage({
    ...defaultState(),
    eyeEmotions: ['开心(弯眼)'],
    mouthStates: ['微笑', '撇嘴(嫌弃)'],
  });
  assert.deepEqual(linked.mouthStates, ['微笑']);
});

test('hand actions match the body posture and the outfit', () => {
  const side = { ...defaultState(), pose: ['侧躺'] };
  assert.equal(optionVisible('handPose', '双手枕在脑后', side), false);
  assert.equal(optionVisible('handPose', '侧身单手撑头', side), true);
  assert.equal(optionVisible('handPose', '双手枕在脑后', { ...defaultState(), pose: ['平躺'] }), true);

  const values = OPTIONS.handPose.map((option) => option.value);
  assert.equal(values.includes('提着包'), false, 'holding a bag belongs to the handheld axis');
  assert.ok(values.length >= 90, `hand poses expanded to ${values.length}`);

  assert.equal(optionVisible('handPose', '单手扶帽檐', defaultState()), false);
  assert.equal(optionVisible('handPose', '单手扶帽檐', { ...defaultState(), hat: '贝雷帽' }), true);
  assert.equal(optionVisible('handPose', '整理领带', { ...defaultState(), pose: ['行走中'] }), false);
  assert.equal(optionVisible('handPose', '整理领带', {
    ...defaultState(), pose: ['行走中'], faceNeck: ['领带'],
  }), true);
  assert.equal(optionVisible('handPose', '单手扶眼镜', defaultState()), false);
  assert.equal(optionVisible('handPose', '单手扶眼镜', { ...defaultState(), faceNeck: ['金丝眼镜'] }), true);

  assert.equal(optionVisible('handPose', '单手提着裙摆', defaultState()), true);
  const pants = applyLinkage({
    ...defaultState(),
    bottom: { ...defaultState().bottom, skeleton: '长裤', style: '直筒长裤' },
  });
  assert.equal(optionVisible('handPose', '单手提着裙摆', pants), false);

  const pillow = { ...defaultState(), pose: ['平躺'], handheld: ['枕头'] };
  assert.equal(optionVisible('handPose', '抱枕头', { ...defaultState(), pose: ['平躺'] }), false);
  assert.equal(optionVisible('handPose', '抱枕头', pillow), true);
  assert.equal(optionDisabled('handPose', '抱枕头', pillow), false);
  const blanket = { ...defaultState(), pose: ['侧躺'], handheld: ['毛毯'] };
  assert.equal(optionVisible('handPose', '双手抓住毯子', blanket), true);
  assert.equal(optionDisabled('handPose', '双手抓住毯子', blanket), false);
});

test('each body posture gained at least three new hand actions', () => {
  const added = [
    '双手交叠放在身前', '手指点脸颊', '手指抵下巴思考', '单手背在身后', '单手整理袖口',
    '单手拉衣领', '单手摸后颈', '单手扶眼镜', '双手握拳放身侧', '单手扶墙',
    '单手竖起大拇指', '单手扶扶手', '单手撑在桌上', '手肘撑在桌上托腮', '双手放在桌面上',
    '双手撑在身后', '单手撑在身侧', '双手抓住毯子', '双手交握放在腹部', '双手捧脸',
    '双手捂耳朵', '单手捂嘴', '双手捂嘴', '单手遮眼', '双臂环抱自己',
    '单手抓住衣角', '双手抓住衣角', '双手举起投降', '双手比心', '单手比心',
    '单手打响指', '单手摸头', '双手抱头', '双手做喇叭状', '双手摊开耸肩',
    '双手捧起头发', '单手捏住鼻梁', '双手捂住脸', '单手撑膝', '单手抓头发',
    '单手放在肩上', '双手拉背包带', '单手擦眼泪',
  ];
  assert.ok(added.length >= 40);
  for (const value of added) {
    assert.ok(OPTIONS.handPose.some((option) => option.value === value), `missing new hand pose ${value}`);
  }
  for (const pose of OPTIONS.pose.map((option) => option.value)) {
    const hands = POSE_COMPATIBILITY[pose].hands;
    const fresh = hands.filter((value) => added.includes(value));
    assert.ok(fresh.length >= 3, `${pose} only gained ${fresh.length} new hand actions`);
  }
});

test('warnings: lying pose with eye-level camera, hat notice, too many main colors', () => {
  assert.deepEqual(warnings(defaultState()), []);
  const w1 = warnings({ ...defaultState(), pose: '躺姿' });
  assert.ok(w1.includes(LYING_WARNING), JSON.stringify(w1));
  const w1b = warnings({ ...defaultState(), pose: '趴姿' });
  assert.ok(w1b.includes(LYING_WARNING));
  assert.ok(warnings({ ...defaultState(), pose: ['平躺'] }).includes(LYING_WARNING));
  assert.ok(warnings({ ...defaultState(), pose: ['小腿交叉趴着'] }).includes(LYING_WARNING));
  assert.ok(!warnings({ ...defaultState(), pose: ['正坐'] }).includes(LYING_WARNING));
  const w2 = warnings({ ...defaultState(), hat: '贝雷帽' });
  assert.ok(w2.includes(HAT_WARNING));
  assert.ok(!w2.includes(LYING_WARNING));
  const w3 = warnings({ ...defaultState(), mainColors: ['黑', '白', '红', '银'] });
  assert.ok(w3.includes(COLOR_WARNING));
  const w4 = warnings({ ...defaultState(), accentColors: ['黑', '白', '红', '银', '金', '粉'] });
  assert.ok(w4.includes(COLOR_WARNING));
});

test('warnings: upright pose on a support surface warns about clipping', () => {
  const onSofa = warnings({ ...defaultState(), pose: '站立', background: '复古/布艺沙发' });
  assert.ok(onSofa.includes(CLIPPING_WARNING), JSON.stringify(onSofa));
  assert.ok(warnings({ ...defaultState(), pose: '奔跑中', background: '复古大床/带帷幔的床' }).includes(CLIPPING_WARNING));
  assert.ok(warnings({ ...defaultState(), pose: '跳跃中', background: '泳池边躺椅' }).includes(CLIPPING_WARNING));
  // 坐/躺姿势配支撑物、站立配地面都不该触发穿模提示。
  assert.ok(!warnings({ ...defaultState(), pose: '正坐', background: '复古/布艺沙发' }).includes(CLIPPING_WARNING));
  assert.ok(!warnings({ ...defaultState(), pose: '站立', background: '城市街道' }).includes(CLIPPING_WARNING));
});

test('orderedOptions returns every background option unchanged', () => {
  const cyber = applyLinkage({ ...defaultState(), role: '赛博朋克' });
  assert.deepEqual(
    orderedOptions('background', cyber).map((o) => o.value),
    OPTIONS.background.map((o) => o.value),
  );
  const fantasy = applyLinkage({ ...defaultState(), role: '西式奇幻（剑与魔法）' });
  assert.deepEqual(
    orderedOptions('background', fantasy).map((o) => o.value),
    OPTIONS.background.map((o) => o.value),
  );
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
  const multi = new Set(['facialFeatures', 'eyeMakeup', 'specialMakeup', 'outfitEffects',
    'feminineAccessories', 'masculineAccessories', 'fantasyAccessories', 'faceNeck', 'handsBack', 'handheld',
    'mainColors', 'accentColors', 'gazes', 'eyeEmotions', 'mouthStates', 'effectSymbols', 'visualEffects',
    'pose', 'handPose', 'headDirection']);
  const skipped = new Set(['crossdressing', 'ahoge', 'backgroundColor', 'colorNames', 'style',
    'hairColorCustom', 'streakColor', 'gradientRootColor', 'gradientTipColor',
    'eyeShadowColor', 'lipColor', 'eyeColorCustom', 'heterochromiaLeft', 'heterochromiaRight',
    'tuneGender', 'tuneShoes', 'tuneSocks', 'top', 'bottom', 'outerwear', 'onePiece', 'shoes', 'socks']);
  for (const [field, value] of Object.entries(linked)) {
    if (multi.has(field) || skipped.has(field) || field.endsWith('Aspect')) continue;
    assert.ok(Array.isArray(OPTIONS[field]), `OPTIONS missing for ${field}`);
    assert.ok(value === '无' || optionVisible(field, value, linked), `${field}=${value} must be visible`);
  }
  // legacy short labels from state.js are normalized to the catalog label
  assert.equal(linked.camera, '平视(默认)');
  assert.equal(linked.background, '纯色背景(可自选颜色)');
  assert.deepEqual(OPTIONS.hairColorExtra.map((o) => o.value), ['无', '挑染', '渐变发色']);
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

test('catalog surface: ROLE_GROUPS cover all roles, 54 presets with required fields, aspect options', () => {
  const allRoles = OPTIONS.role.map((o) => o.value);
  const grouped = ROLE_GROUPS.flatMap((g) => g.options);
  assert.deepEqual([...grouped].sort(), [...allRoles].sort());
  assert.equal(PRESETS.length, 54);
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
    handAspect: ['1:1', '4:3'],
    tuneAspect: ['3:4', '4:3', '9:16', '16:9', '1:1'],
  });
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, 54);
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

test('FACE_FIELDS lists the face fields', () => {
  assert.deepEqual(FACE_FIELDS, ['faceShape', 'eyeShape', 'pupil', 'eyebrow', 'mouth', 'nose',
    'facialFeatures', 'skin', 'heterochromiaLeft', 'heterochromiaRight',
    'blush', 'eyeMakeup', 'eyeShadowColor', 'lipstick', 'lipColor', 'specialMakeup']);
});

test('out-of-range single values fall back to the first visible option; aspects clamp to first', () => {
  const s = applyLinkage({ ...defaultState(), hairStyle: '狼尾（Mullet）', age: '萝莉' });
  assert.notEqual(s.hairStyle, '狼尾（Mullet）');
  assert.ok(optionVisible('hairStyle', s.hairStyle, s));
  const maleBottom = applyLinkage({
    ...defaultState(),
    gender: '男',
    bottom: { ...defaultState().bottom, style: '百褶裙' },
  });
  assert.notEqual(maleBottom.bottom.style, '百褶裙');
  assert.ok(optionVisible('bottom', maleBottom.bottom, maleBottom));
  const badAspect = applyLinkage({ ...defaultState(), baseAspect: '21:9' });
  assert.equal(badAspect.baseAspect, '3:4');
  const okAspect = applyLinkage({ ...defaultState(), turnaroundAspect: '3:2' });
  assert.equal(okAspect.turnaroundAspect, '3:2');
});

test('hex colors stay in mainColors and accentColors', () => {
  const state = defaultState();
  assert.equal(optionVisible('mainColors', '#abc', state), true);
  assert.equal(optionVisible('mainColors', '#a1b2c3', state), true);
  assert.equal(optionVisible('accentColors', '#ABC', state), true);
  assert.equal(optionVisible('accentColors', '#A1B2C3', state), true);
  assert.equal(optionVisible('mainColors', '#abcd', state), false);
  assert.equal(optionVisible('mainColors', '#12345', state), false);
  assert.equal(optionVisible('accentColors', '#gg0000', state), false);
  assert.equal(optionVisible('hairColor', '#fff', state), false);
  const linked = applyLinkage({
    ...defaultState(),
    mainColors: ['黑', '#abc', '#a1b2c3', '#gg0000', 'not-a-color', '#abcd'],
    accentColors: ['#fff', '#12345', '白', '#GG0000'],
    hairColor: '#fff',
  });
  assert.deepEqual(linked.mainColors, ['黑', '#abc', '#a1b2c3']);
  assert.deepEqual(linked.accentColors, ['#fff', '白']);
  assert.notEqual(linked.hairColor, '#fff');
});

test('female age hides nothing; invisible male-locked values still reset', () => {
  const s = applyLinkage({
    ...defaultState(),
    age: '萝莉',
    handheld: ['枪械', '书本'],
    mouthStates: ['微笑', '吐舌(调皮)'],
    eyeMakeup: ['眼线（上挑猫眼/下垂无辜眼）'],
  });
  assert.deepEqual(s.handheld, ['枪械', '书本']);
  assert.deepEqual(s.mouthStates, ['微笑', '吐舌(调皮)']);
  assert.deepEqual(s.eyeMakeup, ['眼线（上挑猫眼/下垂无辜眼）']);
  const preset = applyLinkage({ ...defaultState(), age: '萝莉', colorPreset: 'night-rose' });
  assert.equal(preset.colorPreset, 'night-rose');
  const male = applyLinkage({ ...defaultState(), gender: '男', hairStyle: '姬发式' });
  assert.notEqual(male.hairStyle, '姬发式');
});

test('outfit effects stay capped at two', () => {
  const s = applyLinkage({
    ...defaultState(),
    outfitEffects: ['湿身', '烧焦灰烬', '流光星尘'],
  });
  assert.deepEqual(s.outfitEffects, ['湿身', '烧焦灰烬']);
});

test('every recommended clothing value exists in its node', () => {
  for (const [role, rec] of Object.entries(ROLE_RECOMMENDATIONS)) {
    assert.ok(OPTIONS.role.some((o) => o.value === role), `unknown role ${role}`);
    for (const [field, values] of Object.entries(rec)) {
      assert.ok(Array.isArray(values), `${role}.${field} should be an array`);
      for (const value of values) {
        assert.equal(hasClothingOption(field, value), true,
          `${role} recommends missing ${field} option: ${value}`);
      }
    }
  }
});

test('eye colour hides for heterochromia, which carries its own two pickers', () => {
  assert.equal(fieldVisible('eyeColor', applyLinkage(defaultState())), true);
  const hetero = applyLinkage({ ...defaultState(), pupil: '异色瞳（左红右蓝等可配）' });
  assert.equal(fieldVisible('eyeColor', hetero), false);
});
