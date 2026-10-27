import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../src/state.js';
import { COLOR_WORDS, ROLE_GROUPS } from '../src/catalog.js';
import { viewModel } from '../src/view.js';

const COLOR_WARNING = '颜色过多可能导致AI出图画面杂乱，建议精简颜色。';
const CENTER_TITLES = ['面部', '发型', '妆容', '服饰', '头部配饰', '配饰与手持物', '姿势与表情', '场景构图与光影'];
const GENERATE_LABELS = ['生成基准立绘', '生成三视图', '生成表情差分图', '生成服饰拆解图', '生成Q版形象', '生成完整图片（一键全套）'];

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

test('center groups, folded heels, and catalog-backed choices', () => {
  const vm = viewModel(defaultState());
  assert.deepEqual(vm.center.map((group) => group.title), CENTER_TITLES);
  assert.deepEqual(vm.left.fields.map((field) => field.field), ['gender', 'age', 'race', 'role']);
  assert.equal(collect(vm.left).some((control) => control.field === 'crossdressing'), false);

  const role = vm.left.fields.find((field) => field.field === 'role');
  assert.deepEqual(role.groups.map((group) => group.label), ROLE_GROUPS.map((group) => group.label));

  const clothing = vm.center.find((group) => group.title === '服饰');
  const shoes = clothing.fields.find((field) => field.field === 'shoes');
  assert.equal(shoes.options.some((option) => option.value === '高跟鞋'), false);
  assert.equal(clothing.more.title, '更多');
  assert.equal(clothing.more.open, false);
  assert.deepEqual(clothing.more.options.map((option) => option.value), ['高跟鞋']);
  assert.equal(clothing.more.options[0].folded, true);
  assert.equal(clothing.more.options[0].field, 'shoes');
  assert.equal(clothing.fields.some((field) => field.field === 'backgroundColor'), false);
  assert.equal(clothing.fields.some((field) => field.field === 'mainColors'), true);
  assert.equal(clothing.fields.some((field) => field.field === 'accentColors'), true);

  const controls = collect(vm);
  const folded = controls.filter((control) => control.folded);
  assert.deepEqual(folded.map((control) => control.value), ['高跟鞋']);
  for (const control of controls) {
    if (control.value !== '高跟鞋') assert.equal(control.folded, false, `${control.field}=${control.value}`);
    assert.ok(['single', 'multi', 'switch'].includes(control.mode));
  }

  for (const group of vm.center) {
    if (group.title !== '服饰') assert.equal(group.more, null);
  }

  const scene = vm.center.find((group) => group.title === '场景构图与光影');
  const camera = scene.fields.find((field) => field.field === 'camera');
  const background = scene.fields.find((field) => field.field === 'background');
  assert.equal(camera.options.some((option) => option.value === '平视'), false);
  assert.equal(camera.options.find((option) => option.value === '平视(默认)').selected, true);
  assert.equal(background.options.some((option) => option.value === '纯色背景'), false);
  assert.equal(background.options[0].value, '纯色背景(可自选颜色)');
  assert.equal(background.options[0].selected, true);
  assert.equal(scene.fields.some((field) => field.field === 'backgroundColor' && field.colorInput === true), true);

  const main = clothing.fields.find((field) => field.field === 'mainColors');
  const accent = clothing.fields.find((field) => field.field === 'accentColors');
  assert.equal(main.colorInput, true);
  assert.equal(accent.colorInput, true);
  assert.deepEqual(main.options.map((option) => option.value), Object.keys(COLOR_WORDS));
  assert.deepEqual(accent.options.map((option) => option.value), Object.keys(COLOR_WORDS));
  assert.equal(main.options.every((option) => option.mode === 'multi'), true);
});

test('only the shoujo high-heel choice is folded', () => {
  const loli = viewModel({ ...defaultState(), age: '萝莉' });
  assert.equal(loli.center.find((group) => group.title === '服饰').more, null);
  const adult = viewModel({ ...defaultState(), age: '成女' });
  const shoes = adult.center.find((group) => group.title === '服饰').fields.find((field) => field.field === 'shoes');
  const heels = shoes.options.find((option) => option.value === '高跟鞋');
  assert.ok(heels);
  assert.equal(heels.folded, false);
  assert.equal(adult.center.find((group) => group.title === '服饰').more, null);
});

test('invisible presets disappear and visible presets stay grouped', () => {
  const vm = viewModel(defaultState());
  assert.deepEqual(vm.left.presets.map((group) => group.label), [
    '经典学院与日常', '甜美与马卡龙', '暗黑与哥特', '赛博与机能', '古风与东方奇幻', '神圣与奇幻',
  ]);
  const loli = viewModel({ ...defaultState(), age: '萝莉' });
  const names = loli.left.presets.flatMap((group) => group.options.map((option) => option.label));
  assert.equal(names.includes('暗夜玫瑰'), false);
  assert.equal(names.includes('暗金权贵'), false);
  assert.equal(names.includes('樱花草莓'), true);
  assert.equal(names.includes('经典黑红白'), true);
});

test('background order follows the role and hex colors stay selected', () => {
  const cyber = viewModel({ ...defaultState(), role: '赛博朋克' });
  const background = cyber.center
    .find((group) => group.title === '场景构图与光影')
    .fields.find((field) => field.field === 'background');
  assert.equal(background.options[0].value, '赛博霓虹街');

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

test('aspect switches belong to base, turnaround, and clothing sheets', () => {
  const vm = viewModel(defaultState());
  assert.deepEqual(vm.right.buttons.map((button) => button.label), GENERATE_LABELS);
  assert.deepEqual(vm.right.buttons.map((button) => (button.aspect ? button.aspect.field : null)), [
    'baseAspect', 'turnaroundAspect', null, 'clothingAspect', null, null,
  ]);
  assert.deepEqual(vm.right.buttons[0].aspect.options.map((option) => option.value), ['3:4', '9:16', '1:1']);
  assert.equal(vm.right.buttons[0].aspect.options.find((option) => option.value === '3:4').selected, true);
  assert.equal(vm.right.preview, '还没有图片');
  assert.equal(vm.right.gallery, '图库是空的');
  assert.equal(vm.right.download, '下载页');
});

test('sword in hand disables arms crossed', () => {
  const vm = viewModel({ ...defaultState(), handheld: ['长剑'] });
  const hand = vm.center
    .find((group) => group.title === '姿势与表情')
    .fields.find((field) => field.field === 'handPose');
  assert.equal(hand.options.find((option) => option.value === '双手抱胸').disabled, true);
  assert.equal(hand.options.find((option) => option.value === '自然下垂').disabled, false);
});
