import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../src/state.js';
import { COLOR_WORDS, ROLE_GROUPS, BACKGROUND_GROUPS } from '../src/catalog.js';
import { viewModel } from '../src/view.js';

const COLOR_WARNING = '颜色过多可能导致AI出图画面杂乱，建议精简颜色。';
const CENTER_TITLES = ['面部', '发型', '妆容', '服饰', '头部配饰', '配饰'];
const TUNE_TITLES = ['鞋袜', '姿势与表情', '手部持物', '场景构图与光影'];
const GENERATE_LABELS = ['生成基准立绘', '生成三视图', '生成表情差分图', '生成服饰拆解图', '生成手部拆解图', '生成Q版形象', '生成完整设定集'];

function collect(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if ('field' in node && 'value' in node && 'label' in node && 'selected' in node && 'disabled' in node && 'mode' in node) {
    out.push(node);
  }
  for (const value of Object.values(node)) collect(value, out);
  return out;
}

function hasValue(node, value) {
  return collect(node).some((control) => control.value === value || control.label === value);
}

test('default state shows 少女 selected in the left column, hides mullet, and has no warnings', () => {
  const vm = viewModel(defaultState());
  const shoujo = collect(vm.left).find((control) => control.value === '少女' || control.label === '少女');
  assert.ok(shoujo);
  assert.equal(shoujo.selected, true);
  assert.equal(hasValue(vm, '狼尾（Mullet）'), false);
  assert.deepEqual(vm.warnings, []);
});

test('male view hides twintails and shows mullet', () => {
  const vm = viewModel({ ...defaultState(), gender: '男' });
  assert.equal(hasValue(vm, '双马尾（高/低）'), false);
  assert.equal(hasValue(vm, '狼尾（Mullet）'), true);
  assert.equal(collect(vm.left).some((control) => control.field === 'crossdressing' && control.mode === 'switch'), true);
});

test('four main colors include the clutter warning', () => {
  const vm = viewModel({ ...defaultState(), mainColors: ['黑', '白', '红', '银'] });
  assert.ok(vm.warnings.includes(COLOR_WARNING));
});

test('center groups, inline heels, and catalog-backed choices', () => {
  const vm = viewModel(defaultState());
  assert.deepEqual(vm.center.map((group) => group.title), CENTER_TITLES);
  assert.deepEqual(vm.tune.groups.map((group) => group.title), TUNE_TITLES);
  assert.deepEqual(vm.left.fields.map((field) => field.field), ['gender', 'age', 'race', 'role']);
  assert.equal(collect(vm.left).some((control) => control.field === 'crossdressing'), false);

  const role = vm.left.fields.find((field) => field.field === 'role');
  assert.deepEqual(role.groups.map((group) => group.label), ROLE_GROUPS.map((group) => group.label));

  const clothing = vm.center.find((group) => group.title === '服饰');
  const shoes = clothing.fields.find((field) => field.field === 'shoes');
  const shoeStyles = shoes.segments.find((segment) => segment.key === 'style').groups
    .flatMap((group) => group.options);
  assert.equal(shoeStyles.some((option) => option.value === '细高跟鞋'), true);
  assert.equal(clothing.more, null);
  assert.equal(clothing.fields.some((field) => field.field === 'backgroundColor'), false);
  assert.equal(clothing.fields.some((field) => field.field === 'mainColors'), true);
  assert.equal(clothing.fields.some((field) => field.field === 'accentColors'), true);

  const controls = collect(vm);
  for (const control of controls) {
    assert.equal(control.folded, false, `${control.field}=${control.value}`);
    assert.ok(['single', 'multi', 'switch', 'clothing'].includes(control.mode));
  }

  for (const group of vm.center) {
    if (group.title !== '服饰') assert.equal(group.more, null);
  }

  const scene = vm.tune.groups.find((group) => group.title === '场景构图与光影');
  const camera = scene.fields.find((field) => field.field === 'camera');
  const background = scene.fields.find((field) => field.field === 'background');
  assert.equal(camera.options.some((option) => option.value === '平视'), false);
  assert.equal(camera.options.find((option) => option.value === '平视(默认)').selected, true);
  assert.deepEqual(background.groups.map((group) => group.label), BACKGROUND_GROUPS.map((group) => group.label));
  assert.equal(background.groups[0].options.some((option) => option.value === '纯色背景'), false);
  assert.equal(background.groups[0].options[0].value, '纯色背景(可自选颜色)');
  assert.equal(background.groups[0].options[0].selected, true);
  assert.equal(scene.fields.some((field) => field.field === 'backgroundColor' && field.colorInput === true), true);

  const main = clothing.fields.find((field) => field.field === 'mainColors');
  const accent = clothing.fields.find((field) => field.field === 'accentColors');
  assert.equal(main.colorInput, true);
  assert.equal(accent.colorInput, true);
  assert.deepEqual(main.options.map((option) => option.value), Object.keys(COLOR_WORDS));
  assert.deepEqual(accent.options.map((option) => option.value), Object.keys(COLOR_WORDS));
  assert.equal(main.options.every((option) => option.mode === 'multi'), true);
});

test('heels stay inline for every female age', () => {
  for (const age of ['萝莉', '少女', '成女']) {
    const vm = viewModel({ ...defaultState(), age });
    const clothing = vm.center.find((group) => group.title === '服饰');
    assert.equal(clothing.more, null, `${age} should not fold anything`);
    const shoes = clothing.fields.find((field) => field.field === 'shoes');
    const heels = shoes.segments.find((segment) => segment.key === 'style').groups
      .flatMap((group) => group.options)
      .find((option) => option.value === '细高跟鞋');
    assert.ok(heels, `${age} should see 细高跟鞋`);
    assert.equal(heels.folded, false);
  }
});

test('presets stay grouped and visible for every female age', () => {
  const vm = viewModel(defaultState());
  assert.deepEqual(vm.left.presets.map((group) => group.label), [
    '经典学院与日常', '甜美与马卡龙', '暗黑与哥特', '赛博与机能', '古风与东方奇幻', '神圣与奇幻',
  ]);
  const loli = viewModel({ ...defaultState(), age: '萝莉' });
  const names = loli.left.presets.flatMap((group) => group.options.map((option) => option.label));
  assert.equal(names.includes('暗夜玫瑰'), true);
  assert.equal(names.includes('暗金权贵'), true);
  assert.equal(names.includes('樱花草莓'), true);
  assert.equal(names.includes('经典黑红白'), true);
});

test('background renders grouped scenes and hex colors stay selected', () => {
  const cyber = viewModel({ ...defaultState(), role: '赛博朋克' });
  const background = cyber.tune.groups
    .find((group) => group.title === '场景构图与光影')
    .fields.find((field) => field.field === 'background');
  assert.deepEqual(background.groups.map((group) => group.label), BACKGROUND_GROUPS.map((group) => group.label));
  assert.equal(background.groups[1].options[0].value, '复古/布艺沙发');

  const vm = viewModel({ ...defaultState(), mainColors: ['黑', '#a1b2c3'], accentColors: ['#abc'] });
  const clothing = vm.center.find((group) => group.title === '服饰');
  const main = clothing.fields.find((field) => field.field === 'mainColors');
  const accent = clothing.fields.find((field) => field.field === 'accentColors');
  assert.equal(main.options.find((option) => option.value === '#a1b2c3').selected, true);
  assert.equal(accent.options.find((option) => option.value === '#abc').selected, true);
  const preset = vm.left.presets.flatMap((group) => group.options).find((option) => option.label === '经典黑红白');
  assert.equal(preset.selected, false);
  assert.equal(preset.mode, 'single');
});

test('aspect switches belong to base, turnaround, and both breakdown sheets', () => {
  const vm = viewModel(defaultState());
  assert.deepEqual(vm.right.base.map((button) => button.label), ['生成基准立绘']);
  assert.deepEqual(vm.right.types.map((button) => button.label),
    ['生成三视图', '生成表情差分图', '生成服饰拆解图', '生成手部拆解图', '生成Q版形象']);
  assert.deepEqual(vm.right.suite.map((button) => button.label), ['生成完整设定集']);
  assert.deepEqual(vm.right.types.map((button) => (button.aspect ? button.aspect.field : null)),
    ['turnaroundAspect', null, 'clothingAspect', 'handAspect', null]);
  assert.deepEqual(vm.right.base[0].aspect.options.map((option) => option.value), ['3:4', '9:16', '1:1']);
  assert.equal(vm.right.base[0].aspect.options.find((option) => option.value === '3:4').selected, true);
});

test('generation style selector offers a single style and defaults to 二次元风格', () => {
  const vm = viewModel(defaultState());
  assert.deepEqual(vm.right.style.map((option) => option.value), ['二次元风格']);
  assert.equal(vm.right.style.find((option) => option.value === '二次元风格').selected, true);
  assert.equal(vm.right.style.every((option) => option.field === 'style' && option.mode === 'single'), true);

  const unknown = viewModel({ ...defaultState(), style: '写实风二次元' });
  assert.equal(unknown.right.style.find((option) => option.value === '二次元风格').selected, false);
});

test('tune page exposes shoe and sock toggles, on by default', () => {
  const vm = viewModel(defaultState());
  const group = vm.tune.groups.find((g) => g.title === '鞋袜');
  assert.ok(group, 'tune page must have a 鞋袜 group');
  const shoes = group.fields.find((field) => field.field === 'tuneShoes');
  const socks = group.fields.find((field) => field.field === 'tuneSocks');
  assert.equal(shoes.mode, 'switch');
  assert.equal(shoes.selected, true);
  assert.equal(shoes.label, '是否穿鞋');
  assert.equal(socks.mode, 'switch');
  assert.equal(socks.selected, true);
  assert.equal(socks.label, '是否穿袜子');

  const off = viewModel({ ...defaultState(), tuneShoes: false, tuneSocks: false });
  const g = off.tune.groups.find((item) => item.title === '鞋袜');
  assert.equal(g.fields.find((field) => field.field === 'tuneShoes').selected, false);
  assert.equal(g.fields.find((field) => field.field === 'tuneSocks').selected, false);
});

test('a held item greys out poses that use both hands', () => {
  const vm = viewModel({
    ...defaultState(),
    handheld: ['长剑'],
    handPose: ['自然下垂', '双手抱胸', '单手叉腰'],
  });
  const hand = vm.tune.groups
    .find((group) => group.title === '姿势与表情')
    .fields.find((field) => field.field === 'handPose');
  assert.equal(hand.options.some((option) => option.value === '持物（配合道具）'), false);
  assert.equal(hand.options.some((option) => option.value === '单手提着裙摆'), true);
  assert.equal(hand.options.find((option) => option.value === '双手抱胸').selected, false);
  assert.equal(hand.options.find((option) => option.value === '双手抱胸').disabled, true);
  assert.equal(hand.options.find((option) => option.value === '单手叉腰').selected, true);
  assert.equal(hand.options.find((option) => option.value === '单手叉腰').disabled, false);
  assert.equal(hand.options.find((option) => option.value === '自然下垂').selected, true);
  const props = vm.tune.groups.find((group) => group.title === '手部持物');
  assert.equal(props.fields[0].field, 'handheld');
  assert.equal(props.fields[0].options.find((option) => option.value === '长剑').selected, true);
});

test('color fields expose swatches and conditional color inputs', () => {
  const vm = viewModel({ ...defaultState(), hairColor: '自定义', hairColorCustom: '#c71585' });
  const hair = vm.center.find((group) => group.title === '发型')
    .fields.find((field) => field.field === 'hairColor');
  assert.equal(hair.options.find((option) => option.value === '黑').swatch, '#1a1a1a');
  const customInput = hair.colorInputs.find((spec) => spec.stateField === 'hairColorCustom');
  assert.equal(customInput.active, true);
  assert.equal(customInput.value, '#c71585');
  assert.equal(customInput.mode, 'value');

  const makeup = vm.center.find((group) => group.title === '妆容');
  const lip = makeup.fields.find((field) => field.field === 'lipstick');
  assert.equal(lip.colorInputs.find((spec) => spec.stateField === 'lipColor').active, false);
  const eye = makeup.fields.find((field) => field.field === 'eyeMakeup');
  assert.equal(eye.colorInputs.find((spec) => spec.stateField === 'eyeShadowColor').active, false);

  const pupil = vm.center.find((group) => group.title === '面部')
    .fields.find((field) => field.field === 'pupil');
  assert.equal(pupil.colorInputs.length, 2);
  assert.equal(pupil.colorInputs.every((spec) => spec.active === false), true);
});

test('role recommendations reorder clothing and mark them as recommended', () => {
  const vm = viewModel({ ...defaultState(), role: '东方古风（仙侠/武侠）' });
  const clothing = vm.center.find((group) => group.title === '服饰');
  const top = clothing.fields.find((field) => field.field === 'top');
  const topStyles = top.segments.find((segment) => segment.key === 'style');
  assert.equal(topStyles.groups[0].label, '推荐');
  assert.deepEqual(topStyles.groups[0].options.slice(0, 2).map((o) => o.value), ['交领右衽襦', '旗袍式短上衣']);
  assert.equal(topStyles.groups[0].options[0].recommended, true);
  assert.equal(topStyles.groups[0].options[1].recommended, true);
  const tee = topStyles.groups.flatMap((group) => group.options).find((o) => o.value === 'T恤');
  assert.equal(tee.recommended, false);

  const dressed = viewModel({
    ...defaultState(),
    role: '东方古风（仙侠/武侠）',
    onePiece: { ...defaultState().onePiece, skeleton: '曳地', style: '齐胸襦裙' },
  });
  const onePiece = dressed.center.find((group) => group.title === '服饰')
    .fields.find((field) => field.field === 'onePiece');
  assert.equal(onePiece.segments[0].options[0].value, '无');
  const dressStyles = onePiece.segments.find((segment) => segment.key === 'style');
  assert.deepEqual(dressStyles.groups[0].options.slice(0, 2).map((o) => o.value), ['齐胸襦裙', '交领襦裙']);

  const detective = viewModel({ ...defaultState(), role: '悬疑·侦探' });
  const detectiveSocks = detective.center.find((group) => group.title === '服饰')
    .fields.find((field) => field.field === 'socks');
  assert.equal(detectiveSocks.segments[0].options[0].value, '无');
  assert.equal(detectiveSocks.segments[0].options[1].value, '船袜');
  assert.equal(detectiveSocks.segments[0].options[1].recommended, false);
});

test('socks recommendations respect the wu placeholder first', () => {
  const vm = viewModel({ ...defaultState(), role: '学院制服' });
  const clothing = vm.center.find((group) => group.title === '服饰');
  const socks = clothing.fields.find((field) => field.field === 'socks');
  const skeletons = socks.segments[0].options;
  assert.equal(skeletons[0].value, '无');
  assert.deepEqual(skeletons.slice(1, 3).map((o) => o.value), ['小腿袜', '过膝袜']);
  assert.equal(skeletons[1].recommended, true);
});
