// Task 4 tests: 提示词拼装。规格见 .superpowers/sdd/task-4-brief.md。
import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../src/state.js';
import { buildPrompt, poseClause } from '../src/prompts.js';

const count = (text, term) => text.split(term).length - 1;

test('base portrait contains identity, face, hair, clothing tags and the fixed set', () => {
  const p = buildPrompt(defaultState(), '基准立绘', {});
  for (const tag of ['1girl', 'oval face', 'twintails', 'black hair', 'pleated skirt',
    'standing', 'white background', 'character design', 'solo', 'full body',
    'official art', 'highly detailed', 'light blush', 'natural lips', 'soft lighting']) {
    assert.ok(p.positive.includes(tag), `missing ${tag}`);
  }
  assert.ok(!p.positive.includes('classroom'));
  assert.equal(p.negative, 'multiple people, cropped, out of frame');
  assert.equal(p.aspect, '3:4');
});

test('base portrait includes ahoge and streaked hair when selected', () => {
  const s = { ...defaultState(), ahoge: true, hairColorExtra: ['挑染'] };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('ahoge'));
  assert.ok(p.positive.includes('streaked hair'));
});

test('base portrait ignores user pose, shot, camera and background', () => {
  const s = { ...defaultState(), pose: '坐姿', shot: '半身像(大腿以上)',
    camera: '俯视(从高往下看)', background: '教室' };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(!p.positive.includes('sitting'));
  assert.ok(!p.positive.includes('upper body'));
  assert.ok(!p.positive.includes('from above'));
  assert.ok(!p.positive.includes('classroom'));
});

test('duplicate english terms appear only once', () => {
  const p = buildPrompt(defaultState(), '基准立绘', {});
  assert.equal(count(p.positive, 'looking at viewer'), 1);
});

test('face lock: prefix sentence, face fields suppressed, hair kept', () => {
  const p = buildPrompt(defaultState(), '基准立绘', { hasReference: true });
  assert.ok(p.positive.startsWith('(same face as reference:1.5)'));
  for (const gone of ['oval face', 'light blush', 'natural lips']) {
    assert.ok(!p.positive.includes(gone), `${gone} must be suppressed`);
  }
  assert.ok(p.positive.includes('twintails'));
});

test('one piece replaces top and bottom', () => {
  const s = { ...defaultState(), onePiece: '连衣裙' };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('dress'));
  assert.ok(!p.positive.includes('shirt'));
  assert.ok(!p.positive.includes('pleated skirt'));
});

test('turnaround: fixed set, character tags only, wide aspect', () => {
  const p = buildPrompt(defaultState(), '三视图', {});
  for (const tag of ['character sheet', 'three views', 'front view', 'side view',
    'back view', 'same character', '3 people', 'standing', 'white background',
    'concept art', 'flat colors', 'twintails', 'pleated skirt']) {
    assert.ok(p.positive.includes(tag), `missing ${tag}`);
  }
  for (const gone of ['sitting', 'looking at viewer', 'soft lighting', 'falling petals']) {
    assert.ok(!p.positive.includes(gone), `${gone} must not enter turnaround`);
  }
  assert.equal(p.negative, 'different characters, different clothes');
  assert.equal(p.aspect, '16:9');
});

test('expression chart: emotion tags, 1:1, no gaze, body or clothing words', () => {
  const s = { ...defaultState(), eyeEmotions: ['开心(弯眼)'], mouthStates: ['微笑'] };
  const p = buildPrompt(s, '表情差分图', {});
  assert.ok(p.positive.includes('happy'));
  assert.ok(p.positive.includes('smile'));
  assert.ok(p.positive.includes('expression chart'));
  assert.ok(p.positive.includes('multiple expressions'));
  assert.ok(p.positive.includes('close-up face'));
  assert.ok(p.positive.includes('portrait'));
  assert.ok(!p.positive.includes('looking at viewer'));
  assert.ok(!p.positive.includes('full body'));
  assert.ok(!p.positive.includes('pleated skirt'), 'clothing must stay out of expression charts');
  assert.equal(p.negative, 'full body, single expression');
  assert.equal(p.aspect, '1:1');
});

test('expression chart keeps face fields when unlocked and drops them when locked', () => {
  const unlocked = buildPrompt(defaultState(), '表情差分图', {});
  assert.ok(unlocked.positive.includes('oval face'));
  const locked = buildPrompt(defaultState(), '表情差分图', { hasReference: true });
  assert.ok(locked.positive.startsWith('(same face as reference:1.5)'));
  assert.ok(!locked.positive.includes('oval face'));
});

test('expression chart keeps effect symbols but drops clothing, colors and handheld', () => {
  const s = { ...defaultState(), effectSymbols: ['汗滴'],
    mainColors: ['黑', '红'], colorPreset: 'classic-black-red' };
  const p = buildPrompt(s, '表情差分图', {});
  assert.ok(p.positive.includes('sweatdrop'));
  for (const gone of ['pleated skirt', 'sailor collar', 'leather shoes',
    'holding book', 'soft lighting', 'black skirt', 'red ribbon', 'clothes', 'accents']) {
    assert.ok(!p.positive.includes(gone), `${gone} must not enter expression chart`);
  }
});

test('clothing breakdown: item tags only, spec prefix and negative verbatim', () => {
  const p = buildPrompt(defaultState(), '服饰拆解图', {});
  assert.ok(p.positive.startsWith('(game equipment sheet:1.4)'));
  assert.ok(p.positive.includes('clothing parts breakdown'));
  assert.ok(p.positive.includes('pleated skirt'));
  assert.ok(p.positive.includes('leather shoes'));
  for (const gone of ['1girl', 'girl', 'twintails', 'black hair', 'oval face', 'standing',
    'sitting', 'soft lighting', 'classroom']) {
    assert.ok(!p.positive.includes(gone), `${gone} must not enter clothing breakdown`);
  }
  assert.equal(p.negative, 'human, 1girl, 1boy, body, skin, face, head, hands, legs, '
    + 'mannequin, person, character, wearing clothes, full outfit, merged items, connected parts');
  assert.equal(p.aspect, '1:1');
});

test('clothing breakdown never gets the face lock sentence', () => {
  const p = buildPrompt(defaultState(), '服饰拆解图', { hasReference: true });
  assert.ok(!p.positive.startsWith('(same face as reference:1.5)'));
  assert.ok(!p.positive.includes('same face as reference'));
});

test('chibi: fixed set, character tags, no shot or background, empty negative', () => {
  const s = { ...defaultState(), shot: '半身像(大腿以上)', background: '教室' };
  const p = buildPrompt(s, 'Q版形象', {});
  assert.ok(p.positive.startsWith('chibi'));
  assert.ok(p.positive.includes('super deformed'));
  assert.ok(p.positive.includes('3 heads tall'));
  assert.ok(p.positive.includes('simple background'));
  assert.ok(p.positive.includes('1girl'));
  assert.ok(p.positive.includes('twintails'));
  assert.ok(!p.positive.includes('upper body'));
  assert.ok(!p.positive.includes('classroom'));
  assert.equal(p.negative, '');
  assert.equal(p.aspect, '1:1');
});

test('chibi with reference and style: lock sentence then style sentence first', () => {
  const p = buildPrompt(defaultState(), 'Q版形象', { hasReference: true, styleReference: true });
  assert.ok(p.positive.startsWith('(same face as reference:1.5), 图1的人物，使用图2的Q版画风'));
  assert.ok(!p.positive.includes('oval face'));
  assert.equal(p.aspect, '1:1');
});

test('chibi style image alone does not lock the face', () => {
  const p = buildPrompt(defaultState(), 'Q版形象', { styleReference: true });
  assert.ok(p.positive.startsWith('图1的人物，使用图2的Q版画风'));
  assert.equal(p.positive.includes('(same face as reference:1.5)'), false);
  assert.ok(p.positive.includes('oval face'));
  assert.ok(p.positive.includes('light blush'));
});

test('color scheme: main and accent sentences with preset tags', () => {
  const s = { ...defaultState(), mainColors: ['黑', '红'], accentColors: ['金'] };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('black and red clothes, gold accents'));
});

test('color scheme: fourth main color becomes a weight phrase', () => {
  const s = { ...defaultState(), mainColors: ['黑', '红', '白', '灰'] };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('black and red and white clothes'));
  assert.ok(p.positive.includes('(gray clothes:0.5)'));
});

test('color scheme: sixth accent color becomes a weight phrase', () => {
  const s = { ...defaultState(), accentColors: ['金', '银', '白', '红', '黑', '灰'] };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('gold and silver and white and red and black accents'));
  assert.ok(p.positive.includes('(gray accents:0.5)'));
});

test('hex colors use the same three-primary and five-accent weighting', () => {
  const mixed = buildPrompt({
    ...defaultState(),
    mainColors: ['黑', '#c71585'],
    accentColors: ['#abc'],
  }, '基准立绘', {});
  assert.ok(mixed.positive.includes('black and #c71585 clothes'));
  assert.ok(mixed.positive.includes('#abc accents'));

  const fourth = buildPrompt({
    ...defaultState(),
    mainColors: ['黑', '红', '白', '#c71585'],
  }, '基准立绘', {});
  assert.ok(fourth.positive.includes('black and red and white clothes'));
  assert.ok(fourth.positive.includes('(#c71585 clothes:0.5)'));

  const sixth = buildPrompt({
    ...defaultState(),
    accentColors: ['金', '银', '白', '红', '黑', '#C71585'],
  }, '基准立绘', {});
  assert.ok(sixth.positive.includes('gold and silver and white and red and black accents'));
  assert.ok(sixth.positive.includes('(#C71585 accents:0.5)'));
});

test('color scheme: preset tags are appended, no colors means no color sentence', () => {
  const withPreset = buildPrompt({ ...defaultState(), colorPreset: 'classic-black-red' },
    '基准立绘', {});
  assert.ok(withPreset.positive.includes('black skirt'));
  assert.ok(withPreset.positive.includes('red ribbon'));
  const bare = buildPrompt(defaultState(), '基准立绘', {});
  assert.ok(!/\bclothes\b/.test(bare.positive));
  assert.ok(!/accents/.test(bare.positive));
});

test('race already provides ears, horns and halo; wings stay', () => {
  const elf = { ...defaultState(), race: '精灵耳', fantasyAccessories: ['精灵尖耳（若未选）'] };
  assert.equal(count(buildPrompt(elf, '基准立绘', {}).positive, 'pointy ears'), 1);
  const angel = { ...defaultState(), race: '天使（光环/羽翼）',
    fantasyAccessories: ['光环（天使）'], handsBack: ['翅膀（天使/恶魔/机械）'] };
  const p = buildPrompt(angel, '基准立绘', {});
  assert.equal(count(p.positive, 'halo'), 1);
  assert.ok(p.positive.includes('angel wings'));
  assert.ok(p.positive.includes('wings'));
});

test('race overlap only suppresses the matching headwear term', () => {
  // 天使种族只去重光环，恶魔角头饰仍然输出。
  const angelWithHorns = { ...defaultState(), race: '天使（光环/羽翼）',
    fantasyAccessories: ['恶魔角（双角/独角/弯角）'] };
  assert.ok(buildPrompt(angelWithHorns, '基准立绘', {}).positive.includes('demon horns'));
  // 魔族种族只去重恶魔角，光环头饰仍然输出。
  const demonWithHalo = { ...defaultState(), race: '魔族（角/尾巴）',
    fantasyAccessories: ['光环（天使）'] };
  const demonPrompt = buildPrompt(demonWithHalo, '基准立绘', {});
  assert.ok(demonPrompt.positive.includes('halo'));
  assert.equal(count(demonPrompt.positive, 'demon horns'), 1);
});

test('poseClause: shoujo lying poses add fully clothed; standing male does not', () => {
  assert.deepEqual(poseClause({ ...defaultState(), pose: '趴姿' }),
    ['lying on stomach', 'fully clothed']);
  assert.deepEqual(poseClause({ ...defaultState(), pose: '躺姿' }), ['lying', 'fully clothed']);
  assert.deepEqual(poseClause({ ...defaultState(), pose: '站立' }), ['standing']);
  assert.deepEqual(poseClause({ ...defaultState(), gender: '男', pose: '站立' }), ['standing']);
});

test('buildPrompt never consults poseClause; unknown kind throws', () => {
  const s = { ...defaultState(), pose: '坐姿' };
  assert.ok(!buildPrompt(s, '三视图', {}).positive.includes('sitting'));
  assert.ok(!buildPrompt(s, 'Q版形象', {}).positive.includes('sitting'));
  assert.throws(() => buildPrompt(s, '不存在的图种', {}));
});
