// Task 4 tests: 提示词拼装。规格见 .superpowers/sdd/task-4-brief.md。
import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../src/state.js';
import { NANO_HAND_NEGATIVE, NANO_HAND_POSITIVE, buildPrompt, buildTunePrompt, poseClause, tuneCombinations } from '../src/prompts.js';
import { applyLinkage } from '../src/rules.js';

const count = (text, term) => text.split(term).length - 1;

// 基准立绘中文构图指令（现置于正向最前）。
const BASE_CN = '纯白背景，角色全身居中，四周留白充足，站姿。';
// Q 版中文头身比指令（置于 Q 版正向最前，压住参考图的正常比例身体）。
const CHIBI_CN = '把角色重画成 Q 版（chibi）';
// 默认二次元风格的正向锚点前缀与负向基线（设定集图种仍以风格词打头）。
const MI_PREFIX = 'anime gacha game style, Genshin Impact style, clean lineart, cel shading, '
  + 'anime style, dreamy ethereal lighting, rim light glow, vibrant saturated colors, '
  + 'ornate costume design, big anime eyes, (miHoYo style:1.2), metallic accents, '
  + 'detailed eyes, glossy eyes';
const MI_NEGATIVE = '(worst quality, low quality:1.4), '
  + '(bad anatomy, bad hands, extra fingers, extra limbs:1.3), '
  + '(realistic, photorealistic, 3d render, thick painting:1.2), watermark, signature, '
  + 'text, blurry, deformed';

test('base portrait contains identity, face, hair, clothing tags and the fixed set', () => {
  const p = buildPrompt(defaultState(), '基准立绘', {});
  for (const tag of ['1girl', 'oval face', 'twintails', 'black hair', 'pleated skirt',
    'character design', 'official art', 'light blush', 'natural lips', 'slight smile',
    'masterpiece', 'best quality']) {
    assert.ok(p.positive.includes(tag), `missing ${tag}`);
  }
  // 中文构图指令先行，构图词（站姿/全身/居中/白底）不再散落在英文标签里。
  assert.ok(p.positive.startsWith(BASE_CN), 'chinese composition must lead the base prompt');
  for (const gone of ['standing', 'white background', 'solo', 'full body', 'highly detailed']) {
    assert.ok(!p.positive.includes(gone), `${gone} must be replaced by the chinese directive`);
  }
  assert.ok(!p.positive.includes('classroom'));
  assert.ok(!p.positive.includes('soft lighting'));
  assert.ok(!p.positive.includes('arms at sides'));
  assert.equal(p.negative, `${MI_NEGATIVE}, multiple people, cropped, out of frame, `
    + 'worst quality, low quality, bad anatomy, missing limbs, extra limbs, bad hands');
  assert.equal(p.aspect, '3:4');
});

test('base portrait includes ahoge and streaked hair when selected', () => {
  const s = { ...defaultState(), ahoge: true, hairColorExtra: '挑染', streakColor: '#ff0000' };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('ahoge'));
  assert.ok(p.positive.includes('streaked hair'));
  assert.ok(p.positive.includes('#ff0000 streaks'), 'streak color must enter prompt');
});

test('hair color extra: streak and gradient are exclusive single choice', () => {
  const streak = { ...defaultState(), hairColorExtra: '挑染', streakColor: '#ff0000' };
  const p = buildPrompt(streak, '基准立绘', {});
  assert.ok(p.positive.includes('streaked hair'));
  assert.ok(p.positive.includes('#ff0000 streaks'));
  assert.ok(!p.positive.includes('gradient hair'), 'gradient must not appear with streak');

  const gradient = {
    ...defaultState(), hairColorExtra: '渐变发色',
    gradientRootColor: '#1a1a1a', gradientTipColor: '#ff0000',
  };
  const g = buildPrompt(gradient, '基准立绘', {});
  assert.ok(g.positive.includes('gradient hair'));
  assert.ok(g.positive.includes('#1a1a1a to #ff0000 hair'));
  assert.ok(!g.positive.includes('streaked hair'), 'streak must not appear with gradient');
});

test('hair color extra without a picked color stays clean', () => {
  const p = buildPrompt({ ...defaultState(), hairColorExtra: '挑染', streakColor: '' }, '基准立绘', {});
  assert.ok(p.positive.includes('streaked hair'));
  assert.ok(!p.positive.includes('streaks'), 'no color means no color phrase');
  assert.ok(!p.positive.includes('#'));
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

test('base portrait does not take gaze or pose tags from the tune page', () => {
  const p = buildPrompt(defaultState(), '基准立绘', {});
  assert.equal(count(p.positive, 'looking at viewer'), 0);
  assert.equal(p.positive.includes('soft lighting'), false);
});

test('face lock: prefix sentence, face fields suppressed, hair kept', () => {
  const p = buildPrompt(defaultState(), '基准立绘', { hasReference: true });
  assert.ok(p.positive.startsWith(BASE_CN), 'chinese composition must lead the base prompt');
  assert.ok(p.positive.includes('(same face as reference:1.5)'));
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
  for (const tag of ['character sheet', 'turnaround', 'multiple views', 'front view', 'side view',
    'back view', '(same character:1.3)', '3 views', 'standing', 'white background',
    'concept art', 'flat colors', 'masterpiece', 'best quality', 'highres', 'highly detailed',
    'twintails', 'pleated skirt']) {
    assert.ok(p.positive.includes(tag), `missing ${tag}`);
  }
  for (const gone of ['sitting', 'looking at viewer', 'soft lighting', 'falling petals',
    '3 people', 'three views']) {
    assert.ok(!p.positive.includes(gone), `${gone} must not enter turnaround`);
  }
  assert.equal(p.negative, `${MI_NEGATIVE}, different characters, different clothes, different hair`);
  assert.equal(p.aspect, '16:9');
});

test('expression chart: fixed 3x3 grid, nine preset expressions, no gaze or clothing', () => {
  const s = { ...defaultState(), eyeEmotions: ['开心(弯眼)'], mouthStates: ['微笑'] };
  const p = buildPrompt(s, '表情差分图', {});
  // 表情由系统预设的 9 宫格统一指定，不再依赖用户勾选的 eyeEmotions/mouthStates。
  for (const tag of ['(expression chart:1.5)', '(3x3 grid:1.5)', '(9 different expressions:1.4)',
    'clear boundaries', '(smiling:1.2)', '(angry:1.2)', '(crying:1.2)', '(surprised:1.2)',
    '(blushing:1.2)', '(smug:1.2)', '(sad:1.2)', '(winking:1.2)', '(expressionless:1.2)']) {
    assert.ok(p.positive.includes(tag), `missing ${tag}`);
  }
  assert.ok(p.positive.includes('close-up face'));
  assert.ok(p.positive.includes('portrait'));
  assert.ok(p.positive.includes('upper body'));
  assert.ok(p.positive.includes('highly detailed faces'));
  assert.ok(p.positive.includes('masterpiece'));
  assert.ok(p.positive.includes('best quality'));
  assert.ok(p.positive.includes('highres'));
  assert.ok(p.positive.includes('highly detailed'));
  assert.ok(!p.positive.includes('happy'), 'user-picked emotion must not enter');
  assert.ok(!p.positive.includes('looking at viewer'));
  assert.ok(!p.positive.includes('full body'));
  assert.ok(!p.positive.includes('pleated skirt'), 'clothing must stay out of expression charts');
  assert.equal(p.negative, `${MI_NEGATIVE}, full body, nude, naked, merged cells, messy layout, `
    + 'worst quality, low quality, bad anatomy, missing limbs, extra limbs, bad hands');
  assert.equal(p.aspect, '1:1');
});

test('expression chart keeps face fields when unlocked and drops them when locked', () => {
  const unlocked = buildPrompt(defaultState(), '表情差分图', {});
  assert.ok(unlocked.positive.includes('oval face'));
  const locked = buildPrompt(defaultState(), '表情差分图', { hasReference: true });
  assert.ok(locked.positive.includes('(same face as reference:1.5)'));
  assert.ok(!locked.positive.includes('oval face'));
});

test('expression chart keeps face/neck accessories like choker and glasses', () => {
  const s = { ...defaultState(), faceNeck: ['Choker项链', '圆框眼镜'] };
  const p = buildPrompt(s, '表情差分图', {});
  assert.ok(p.positive.includes('choker'));
  assert.ok(p.positive.includes('round glasses'));
  for (const gone of ['pleated skirt', 'leather shoes', 'holding book']) {
    assert.ok(!p.positive.includes(gone), `${gone} must not enter expression chart`);
  }
});

test('expression chart drops effect symbols, clothing, colors and handheld', () => {
  const s = { ...defaultState(), effectSymbols: ['汗滴'],
    mainColors: ['黑', '红'], colorPreset: 'classic-black-red' };
  const p = buildPrompt(s, '表情差分图', {});
  // 预设表情统一指定，汗滴等用户勾选的效果符号不再进入表情图。
  assert.ok(!p.positive.includes('sweatdrop'));
  for (const gone of ['pleated skirt', 'sailor collar', 'leather shoes',
    'holding book', 'soft lighting', 'black skirt', 'red ribbon', 'clothes']) {
    assert.ok(!p.positive.includes(gone), `${gone} must not enter expression chart`);
  }
});

test('clothing breakdown uses only the breakdown prompts and never the face lock', () => {
  const p = buildPrompt(defaultState(), '服饰拆解图', { hasReference: true });
  assert.equal(p.positive, 'anime style, cel shading, concept art, '
    + '(clothing parts breakdown:1.5), (game equipment sheet:1.5), flat lay, '
    + 'isolated on white background, (no character, no human:1.5), highly detailed textures, vivid colors, '
    + '(each garment and accessory appears only once:1.5), exploded into separate pieces, '
    + '(transfer side-view and back-view details onto that single piece:1.3), '
    + 'intricate lace, embroidery, ribbons, chains, jewelry, layered fabric');
  assert.equal(p.negative, '(human, person, 1girl, 1boy, body, skin, face, mannequin:1.5), '
    + 'wearing clothes, text, arrows, '
    + '(duplicate:1.4), (repeated outfit:1.4), (second dress:1.3), (another angle of the same garment:1.3), '
    + 'extra skirt, legs, feet, (realistic, photographic:1.4)');
  assert.equal(p.positive.includes('same face as reference'), false);
  assert.equal(p.positive.includes('pleated skirt'), false);
  assert.equal(p.aspect, '1:1');
  const realistic = buildPrompt({ ...defaultState(), style: '二次元风格' }, '服饰拆解图', { hasReference: true });
  assert.equal(realistic.positive, p.positive);
  assert.equal(realistic.negative, p.negative);
  assert.equal(realistic.positive.includes('detailed skin texture'), false);
  assert.equal(realistic.positive.includes('semi-realistic'), false);
});

test('hand sheet follows the reference hand color and keeps gloves when the character wears them', () => {
  const p = buildPrompt(defaultState(), '手部拆解图', { hasReference: true });
  assert.ok(p.positive.includes('(hand gestures sheet:1.5)'));
  assert.ok(p.positive.includes('(9 different hand poses:1.5)'));
  assert.ok(p.positive.includes('(3x3 grid:1.4)'));
  assert.ok(p.positive.includes('(floating hands, no body, no face, no human:1.5)'));
  assert.ok(p.positive.includes('(v sign, open palm, fist, thumbs up'));
  assert.ok(p.positive.includes('white background'));
  // 手部颜色和手套状态必须以参考图为准，不能写死裸手。
  assert.ok(p.positive.includes('(hand color and hand covering identical to the reference:1.6)'));
  assert.ok(p.positive.includes('(keep the reference gloves if any:1.4)'));
  assert.equal(p.positive.includes('bare hands'), false);
  assert.equal(p.positive.includes('no gloves'), false);
  // 默认没有手套：补肤色，且不额外塞配饰词。
  assert.ok(p.positive.includes('natural skin'));
  assert.equal(p.positive.split(', ').includes('gloves'), false);
  assert.ok(p.negative.includes('(human, 1girl, 1boy, face, head, body, arms, legs:1.5)'));
  assert.ok(p.negative.includes('(wrong hand color:1.5)'));
  assert.ok(p.negative.includes('(invented gloves, gloves removed from a gloved character:1.4)'));
  assert.ok(p.negative.includes('(bad anatomy, deformed hands'));
  // 表单里戴手套：给出配饰词，且不再塞肤色词压过手套。
  const gloved = buildPrompt({ ...defaultState(), handsBack: ['手套（半指/全指）'] }, '手部拆解图', {});
  assert.equal(gloved.positive.split(', ').includes('gloves'), true);
  assert.equal(gloved.positive.includes('natural skin'), false);
  // 设定稿不吃界面风格，也不拼角色描述。
  assert.equal(p.positive.includes('same face as reference'), false);
  assert.equal(p.aspect, '1:1');
  const tanned = buildPrompt({ ...defaultState(), skin: '小麦色' }, '手部拆解图', {});
  assert.ok(tanned.positive.includes('tanned skin'));
  const fourThree = buildPrompt({ ...defaultState(), handAspect: '4:3' }, '手部拆解图', {});
  assert.equal(fourThree.aspect, '4:3');
  const realistic = buildPrompt({ ...defaultState(), style: '二次元风格' }, '手部拆解图', {});
  assert.equal(realistic.positive, p.positive);
});

test('chibi: chinese proportion order leads, fixed set, character tags, no shot or background', () => {
  const s = { ...defaultState(), shot: '半身像(大腿以上)', background: '教室' };
  const p = buildPrompt(s, 'Q版形象', {});
  // 头身比是 Q 版成败关键：中文指令必须打头，压住参考图的正常比例身体。
  assert.ok(p.positive.startsWith(CHIBI_CN), 'chibi proportion instruction must lead the prompt');
  assert.ok(p.positive.includes(MI_PREFIX), 'style anchors must still be present');
  assert.ok(p.positive.includes('chibi'));
  assert.ok(p.positive.includes('super deformed'));
  assert.ok(p.positive.includes('(2 heads tall:1.6)'));
  assert.ok(p.positive.includes('(2.5 heads tall:1.4)'));
  assert.ok(p.positive.includes('(oversized head:1.5)'));
  assert.ok(p.positive.includes('(tiny body:1.4)'));
  assert.ok(p.positive.includes('head occupying half of the total height'));
  assert.ok(p.positive.includes('white background'));
  assert.ok(p.positive.includes('masterpiece'));
  assert.ok(p.positive.includes('best quality'));
  assert.ok(p.positive.includes('highres'));
  assert.ok(p.positive.includes('highly detailed'));
  assert.ok(p.positive.includes('1girl'));
  assert.ok(p.positive.includes('twintails'));
  assert.ok(!p.positive.includes('upper body'));
  assert.ok(!p.positive.includes('classroom'));
  assert.ok(!p.positive.includes('simple background'));
  // 负向必须排掉成人/写实头身比，否则模型照抄参考图的七头身。
  assert.ok(p.negative.startsWith(MI_NEGATIVE));
  for (const tag of ['(realistic proportions:1.4)', '(7 heads tall:1.4)', '(8 heads tall:1.4)',
    '(3 heads tall:1.3)', 'tall slender body', 'adult proportions', '(long legs:1.3)']) {
    assert.ok(p.negative.includes(tag), `chibi negative must include ${tag}`);
  }
  assert.ok(!/图\d/.test(p.positive), 'chibi prompt must not reference images by number');
  assert.equal(p.aspect, '1:1');
});

test('chibi with reference locks the face to the first image only', () => {
  const p = buildPrompt(defaultState(), 'Q版形象', { hasReference: true });
  assert.ok(p.positive.startsWith(CHIBI_CN), 'chibi proportion instruction must lead the prompt');
  assert.ok(p.positive.includes(MI_PREFIX), 'style anchors must still be present');
  // 风格图排在角色图后面，锁脸句必须点名「第 1 张」，否则模型会去抄风格图的脸与瞳色。
  assert.ok(p.positive.includes('(same face as the first reference:1.5)'));
  assert.ok(!p.positive.includes('oval face'));
  assert.ok(!/图\d/.test(p.positive), 'style reference sentence must be gone from chibi prompt');
  assert.equal(p.aspect, '1:1');
});

test('chibi declares per-image roles so the style sheet cannot donate eyes, hair or clothes', () => {
  const p = buildPrompt(defaultState(), 'Q版形象', { hasReference: true, styleCount: 2 });
  // 逐图分工：第 1 张是角色，第 2~3 张只给头身比与画风。
  assert.ok(p.positive.includes('第 1 张是角色参考图'));
  assert.ok(p.positive.includes('第 2 张到第 3 张是画风参考图'));
  assert.ok(p.positive.includes('眼睛颜色与瞳色'));
  assert.ok(p.positive.includes('绝对不要照抄它的眼睛颜色、瞳孔颜色、发型、发色、发饰和服装'));
  // 正向钉住五官与服饰归属。
  for (const tag of ['(eye color exactly as the first reference:1.6)',
    '(same eye color as the character reference:1.5)',
    '(same hairstyle and hair color as the character reference:1.5)',
    '(same outfit and accessories as the character reference:1.5)']) {
    assert.ok(p.positive.includes(tag), `chibi identity lock missing ${tag}`);
  }
  // 负向排掉「照搬风格图」的具体错误。
  for (const tag of ['(wrong eye color:1.5)', 'mismatched eye color',
    'copied eye color from the style reference', '(different outfit:1.4)']) {
    assert.ok(p.negative.includes(tag), `chibi identity negative missing ${tag}`);
  }
  // 只有一张风格图时措辞收窄，不出现区间。
  const one = buildPrompt(defaultState(), 'Q版形象', { hasReference: true, styleCount: 1 });
  assert.ok(one.positive.includes('第 2 张是画风参考图'));
  assert.equal(one.positive.includes('第 2 张到第 3 张'), false);
  // 没有风格图时不逐图声明，也不塞五官归属锁。
  const solo = buildPrompt(defaultState(), 'Q版形象', { hasReference: true });
  assert.equal(/第 \d+ 张/.test(solo.positive), false);
  assert.equal(solo.positive.includes('(eye color exactly as the first reference:1.6)'), false);
  assert.equal(solo.negative.includes('(wrong eye color:1.5)'), false);
  // 只有风格图、没有角色图时，必须说明「按文字描述来，别抄参考图里的角色」。
  const styleOnly = buildPrompt(defaultState(), 'Q版形象', { styleCount: 2 });
  assert.ok(styleOnly.positive.includes('参考图只是画风参考图'));
  assert.ok(styleOnly.positive.includes('不要照抄参考图里的具体角色'));
  assert.equal(styleOnly.positive.includes('第 1 张是角色参考图'), false);
});

test('chibi without a character image does not lock the face', () => {
  const p = buildPrompt(defaultState(), 'Q版形象', {});
  assert.ok(p.positive.startsWith(CHIBI_CN), 'chibi proportion instruction must lead the prompt');
  assert.equal(p.positive.includes('(same face as reference:1.5)'), false);
  assert.equal(p.positive.includes('(same face as the first reference:1.5)'), false);
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
  // 无主辅色时不产出「xx clothes / xx accents」配色句；风格词里的 metallic accents 不算配色句。
  assert.ok(!/\band\b.*accents/.test(bare.positive));
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

test('poseClause returns only the pose tag', () => {
  assert.deepEqual(poseClause({ ...defaultState(), pose: '平趴' }), ['lying flat on stomach']);
  assert.deepEqual(poseClause({ ...defaultState(), pose: '小腿交叉趴着' }), ['lying on stomach with calves crossed']);
  assert.deepEqual(poseClause({ ...defaultState(), pose: '平躺' }), ['lying flat on back']);
  assert.deepEqual(poseClause({ ...defaultState(), pose: '侧躺' }), ['lying on side']);
  assert.deepEqual(poseClause({ ...defaultState(), pose: '站立' }), ['standing']);
  assert.deepEqual(poseClause({ ...defaultState(), gender: '男', age: '青年', pose: '平躺' }), ['lying flat on back']);
});

test('buildPrompt never consults poseClause; unknown kind throws', () => {
  const s = { ...defaultState(), pose: '坐姿' };
  assert.ok(!buildPrompt(s, '三视图', {}).positive.includes('sitting'));
  assert.ok(!buildPrompt(s, 'Q版形象', {}).positive.includes('sitting'));
  assert.throws(() => buildPrompt(s, '不存在的图种', {}));
});

test('custom free colors append hair, eye shadow, lip and heterochromia terms', () => {
  const s = {
    ...defaultState(),
    hairColor: '自定义', hairColorCustom: '#c71585',
    eyeMakeup: ['眼影（可选颜色）'], eyeShadowColor: '#ff7f50',
    lipstick: '唇彩颜色可选', lipColor: '#d6336c',
    pupil: '异色瞳（左红右蓝等可配）', heterochromiaLeft: '#ff0000', heterochromiaRight: '#0000ff',
  };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('#c71585 hair'));
  assert.ok(p.positive.includes('#ff7f50 eyeshadow'));
  assert.ok(p.positive.includes('#d6336c lips'));
  assert.ok(p.positive.includes('#ff0000 eye'));
  assert.ok(p.positive.includes('#0000ff eye'));
  assert.ok(p.positive.includes('heterochromia'), 'named heterochromia tag still present');
});

test('custom colors only emit when the matching option is selected', () => {
  const off = buildPrompt({ ...defaultState(), hairColorCustom: '#c71585', eyeShadowColor: '#ff7f50' }, '基准立绘', {});
  assert.ok(!off.positive.includes('#c71585'), 'hair color without 自定义 must be ignored');
  assert.ok(!off.positive.includes('#ff7f50'), 'eye shadow without 眼影 must be ignored');

  const empty = buildPrompt({ ...defaultState(), hairColor: '自定义', hairColorCustom: '' }, '基准立绘', {});
  assert.ok(!empty.positive.includes('#'), 'empty custom color must not leak a hex');
  const oneEye = buildPrompt({
    ...defaultState(),
    pupil: '异色瞳（左红右蓝等可配）', heterochromiaLeft: '#ff0000', heterochromiaRight: '',
  }, '基准立绘', {});
  assert.ok(oneEye.positive.includes('#ff0000 eye'));
  assert.ok(!oneEye.positive.includes(' eye and '), 'single heterochromia eye has no dangling term');
});

test('translated english names replace hex in the prompt when present', () => {
  const s = {
    ...defaultState(),
    hairColor: '自定义', hairColorCustom: '#dbfff4',
    colorNames: { '#dbfff4': 'pale mint green' },
  };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('pale mint green hair'));
  assert.ok(!p.positive.includes('#dbfff4'), 'hex must be replaced by the english name');
});

test('color scheme resolves hex through english names while named colors stay unchanged', () => {
  const s = {
    ...defaultState(),
    mainColors: ['黑', '#c71585'],
    accentColors: ['#abc'],
    colorNames: { '#c71585': 'medium violet red', '#abc': 'soft blue' },
  };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('black and medium violet red clothes'));
  assert.ok(p.positive.includes('soft blue accents'));
});

test('gradient hair uses english names for both ends when translated', () => {
  const s = {
    ...defaultState(),
    hairColorExtra: '渐变发色',
    gradientRootColor: '#1a1a1a', gradientTipColor: '#ff0000',
    colorNames: { '#1a1a1a': 'near black', '#ff0000': 'vivid red' },
  };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('near black to vivid red hair'));
});

test('shoes and socks colors append a color phrase and default to no phrase', () => {
  const bare = buildPrompt(defaultState(), '基准立绘', {});
  assert.ok(!bare.positive.includes('black shoes'));
  assert.ok(!bare.positive.includes('pink socks'));

  const base = defaultState();
  const colored = buildPrompt({
    ...base,
    shoes: { ...base.shoes, color: '黑' },
    socks: { ...base.socks, skeleton: '短袜', style: '常规', color: '粉' },
  }, '基准立绘', {});
  assert.ok(colored.positive.includes('black leather shoes'));
  assert.ok(colored.positive.includes('pink socks'));
});

test('custom shoes and socks colors resolve through english names', () => {
  const s = {
    ...defaultState(),
    shoes: { ...defaultState().shoes, color: '自定义', colorCustom: '#a52a2a' },
    socks: {
      skeleton: '短袜', style: '常规', detail: '无额外细节', color: '自定义', colorCustom: '#dbfff4',
    },
    colorNames: { '#a52a2a': 'deep brown', '#dbfff4': 'pale mint green' },
  };
  const p = buildPrompt(s, '基准立绘', {});
  assert.ok(p.positive.includes('deep brown leather shoes'));
  assert.ok(p.positive.includes('pale mint green socks'));
  assert.ok(!p.positive.includes('#a52a2a'), 'custom hex must be replaced by english name');
});

test('shoes and socks colors stay out of expression charts', () => {
  const base = defaultState();
  const s = {
    ...base,
    shoes: { ...base.shoes, color: '红' },
    socks: { ...base.socks, skeleton: '短袜', style: '常规', color: '蓝' },
  };
  const p = buildPrompt(s, '表情差分图', {});
  assert.ok(!p.positive.includes('red shoes'));
  assert.ok(!p.positive.includes('blue socks'));
  assert.ok(!p.positive.includes('shoes'));
});

test('single style is 二次元风格 and unknown values fall back safely', () => {
  const p = buildPrompt(defaultState(), '基准立绘', {});
  assert.ok(p.positive.startsWith(BASE_CN));
  assert.ok(p.positive.includes('anime gacha game style'));
  const unknown = buildPrompt({ ...defaultState(), style: '不存在的风格' }, '基准立绘', {});
  assert.ok(unknown.positive.startsWith(BASE_CN), 'unknown style must fall back to 二次元风格');
  assert.ok(unknown.positive.includes('anime gacha game style'));
});

test('tune combinations multiply only the pose fields that have two or more picks', () => {
  const single = tuneCombinations(applyLinkage(defaultState()));
  assert.equal(single.length, 1);
  assert.equal(single[0].pose, '站立');
  assert.equal(single[0].mouthStates, undefined);
  const mixed = tuneCombinations(applyLinkage({
    ...defaultState(),
    pose: ['站立', '正坐'],
    mouthStates: ['微笑', '大笑(张嘴)'],
    eyeEmotions: ['开心(弯眼)'],
  }));
  assert.equal(mixed.length, 4);
  assert.deepEqual(mixed.map((item) => item.pose), ['站立', '站立', '正坐', '正坐']);
  assert.deepEqual(mixed.map((item) => item.mouthStates), ['微笑', '大笑(张嘴)', '微笑', '大笑(张嘴)']);
  assert.equal(mixed.every((item) => item.eyeEmotions === '开心(弯眼)'), true);
  const held = tuneCombinations(applyLinkage({
    ...defaultState(),
    pose: ['站立'],
    handheld: ['书本', '长剑'],
  }));
  assert.equal(held.length, 2);
  assert.deepEqual(held.map((item) => item.handheld), ['书本', '长剑']);
});

test('tune combinations skip eye and mouth pairs that do not match', () => {
  const state = applyLinkage({
    ...defaultState(),
    eyeEmotions: ['开心(弯眼)', '生气(皱眉)'],
    mouthStates: ['微笑', '撇嘴(嫌弃)'],
  });
  const combos = tuneCombinations(state);
  assert.equal(combos.length, 2);
  for (const combo of combos) {
    if (combo.eyeEmotions === '开心(弯眼)') assert.equal(combo.mouthStates, '微笑');
    else assert.equal(combo.mouthStates, '撇嘴(嫌弃)');
  }
});

// 取景四档改用专业景别术语后，必须满足三条硬约束：
//   ① 不出现 portrait（模型会默认理解成脸部特写，且不能与 full body 混用）；
//   ② 每档都有「物理锚点」而不只是景别名词（单写 full body 常被画成四分之三身）；
//   ③ 负向同时挡住更紧和更松两边的漂移。
test('every shot size carries professional framing terms and anti-crop anchors', () => {
  const shots = ['全身像', '半身像(大腿以上)', '特写(胸部以上)', '大头贴(Q版专用)'];
  const prompts = Object.fromEntries(shots.map((shot) => [
    shot,
    buildTunePrompt(applyLinkage({ ...defaultState(), shot }), { pose: '站姿' }),
  ]));

  for (const shot of shots) {
    const p = prompts[shot];
    assert.ok(!p.positive.includes('portrait'), `${shot} must not rely on the ambiguous word portrait`);
    // 景别先于光影词出现：景别是全局约束，越靠前权重越实。
    assert.ok(
      p.positive.indexOf('framed from the top of the head') < p.positive.indexOf('cinematic lighting'),
      `${shot} framing must precede the lighting tags`,
    );
  }

  assert.ok(prompts['全身像'].positive.includes('down to the soles of the feet'));
  assert.ok(prompts['全身像'].positive.includes('floor space below the feet'));
  assert.ok(prompts['全身像'].positive.includes('(camera pulled back:1.3)'));
  assert.ok(prompts['全身像'].positive.includes('both shoes fully inside the frame'));
  assert.ok(prompts['全身像'].negative.includes('(half-body shot:1.4)'));
  assert.ok(prompts['全身像'].negative.includes('(cropped feet:1.4)'));

  assert.ok(prompts['半身像(大腿以上)'].positive.includes('(medium-full shot:1.3)'));
  assert.ok(prompts['半身像(大腿以上)'].positive.includes('well above the knees'));
  assert.ok(prompts['半身像(大腿以上)'].negative.includes('(head to toe:1.3)'));

  assert.ok(prompts['特写(胸部以上)'].positive.includes('(medium close-up:1.4)'));
  assert.ok(prompts['特写(胸部以上)'].positive.includes('(bust shot:1.3)'));
  assert.ok(prompts['特写(胸部以上)'].negative.includes('(waist up:1.2)'));

  assert.ok(prompts['大头贴(Q版专用)'].positive.includes('(headshot:1.3)'));
  assert.ok(prompts['大头贴(Q版专用)'].positive.includes('the face dominates the frame'));
  assert.ok(prompts['大头贴(Q版专用)'].negative.includes('(medium shot:1.3)'));
});

test('tune prompt uses the turnaround lock, one combo and the shared scene', () => {
  const state = applyLinkage({
    ...defaultState(),
    pose: ['站立', '坐姿'],
    background: '教室',
    shot: '半身像(大腿以上)',
  });
  const [first] = tuneCombinations(state);
  const p = buildTunePrompt(state, first);
  // 微调正向以中文参考图声明打头，再拼英文光影镜头词与加固词。
  assert.ok(p.positive.startsWith('请参考图中的人物设定'), 'chinese reference clause must lead the tune prompt');
  assert.ok(p.positive.includes('摆出【站立】'));
  assert.ok(p.positive.includes('背景是【教室】'));
  assert.ok(p.positive.includes('cinematic lighting'));
  assert.ok(p.positive.includes('rim light'));
  assert.ok(p.positive.includes('depth of field'));
  assert.ok(p.positive.includes('(same face, hair and clothes as the first reference:1.5)'));
  assert.ok(p.positive.includes('(expressions consistent with the second reference:1.3)'));
  assert.ok(p.positive.includes('standing'));
  assert.ok(!p.positive.includes('sitting'));
  assert.ok(p.positive.includes('classroom'));
  assert.ok(p.positive.includes('(cowboy shot:1.4)'));
  assert.ok(p.positive.includes('down to mid-thigh'));
  assert.ok(p.negative.includes('(full-body shot:1.4)'));
  assert.ok(p.positive.includes('masterpiece'));
  assert.ok(!p.positive.includes('pleated skirt'));
  assert.ok(!p.positive.includes('1girl'));
  assert.ok(p.negative.includes('different character'));
  assert.equal(p.aspect, '3:4');
  const white = buildTunePrompt(applyLinkage(defaultState()), tuneCombinations(applyLinkage(defaultState()))[0]);
  assert.ok(white.positive.includes('white background'));
  assert.ok(white.positive.includes('simple background'));
  assert.ok(white.positive.includes('(full-body shot:1.5)'));
  assert.ok(white.positive.includes('shoes visible'));
  assert.ok(white.negative.includes('feet out of frame'));
  assert.ok(white.positive.includes('(detailed hands:1.2)'));
  assert.ok(white.positive.includes('(two legs:1.2)'));
  // 手部补丁现在固定追加在末尾（Nano 专属防崩手），所以必须出现而不是被排除。
  assert.ok(white.positive.includes('exactly five fingers'));
  assert.ok(white.positive.endsWith(NANO_HAND_POSITIVE), 'nano hand patch must close the prompt');
  assert.ok(white.negative.startsWith(NANO_HAND_NEGATIVE), 'nano hand negatives must lead the negative list');
  assert.ok(white.negative.includes('(extra legs:1.3)'));
  assert.ok(white.negative.includes('(missing fingers:1.3)'));
  assert.ok(white.negative.includes('(fused fingers:1.3)'));
  assert.ok(white.negative.includes('(poorly drawn feet:1.3)'));
  assert.ok(!white.negative.includes('shoes on bed'));
  // 没有上传手部拆解图时，不能出现第三张参考图相关的声明。
  assert.ok(!white.positive.includes('第三张参考图'));
  const withHand = buildTunePrompt(applyLinkage(defaultState()),
    tuneCombinations(applyLinkage(defaultState()))[0], { hasHandSheet: true });
  assert.ok(withHand.positive.includes('第三张参考图是手部手势拆解表'));
  assert.ok(withHand.positive.includes('(hand structure follows the third reference:1.3)'));
  assert.ok(withHand.negative.includes('(3x3 grid:1.4)'));
  assert.ok(withHand.negative.startsWith(NANO_HAND_NEGATIVE));
  const kneeling = buildTunePrompt(applyLinkage({ ...defaultState(), pose: ['跪姿'] }), { pose: '跪姿' });
  assert.ok(kneeling.positive.includes('no shoes'));
  assert.ok(kneeling.positive.includes('(safety shorts:1.4)'));
  assert.ok(kneeling.negative.includes('(upskirt:1.5)'));
  assert.ok(kneeling.negative.includes('(skirt lift:1.4)'));
  assert.ok(kneeling.negative.includes('(see-through:1.4)'));
  assert.ok(kneeling.positive.includes('(opaque clothes:1.3)'));
  assert.ok(kneeling.positive.includes('shoes removed'));
  assert.ok(!kneeling.positive.includes('barefoot'));
  assert.ok(!kneeling.positive.includes('shoes visible'));
  assert.ok(kneeling.negative.includes('(shoes on bed:1.4)'));
  assert.ok(kneeling.negative.includes('(high heels on bed:1.4)'));
  assert.ok(kneeling.negative.includes('mismatched socks'));
  assert.ok(kneeling.positive.includes('same socks as the first reference'));
  assert.ok(!kneeling.positive.includes('pantyhose'));
  assert.ok(kneeling.negative.includes('(wrong sock color:1.3)'));
  const kept = buildTunePrompt(applyLinkage({ ...defaultState(), pose: ['跪姿'] }), { pose: '跪姿' }, { allowBedShoes: true });
  assert.ok(!kept.positive.includes('barefoot'));
  assert.ok(kept.positive.includes('shoes visible'));
  assert.ok(!kept.negative.includes('shoes on bed'));
  const seated = buildTunePrompt(applyLinkage({ ...defaultState(), shot: '全身像', pose: ['正坐'] }), { pose: '正坐' });
  assert.ok(seated.positive.includes('legs and shoes in frame'));
  assert.ok(seated.positive.includes('sitting upright'));
  assert.ok(seated.positive.includes('(safety shorts:1.4)'));
  assert.ok(seated.positive.includes('skirt covering legs'));
  assert.ok(seated.negative.includes('(upskirt:1.5)'));
  assert.ok(seated.negative.includes('(panties:1.5)'));
  assert.ok(seated.negative.includes('spread legs'));
  const crossed = buildTunePrompt(applyLinkage({ ...defaultState(), shot: '全身像', pose: ['跷二郎腿'] }), { pose: '跷二郎腿' });
  assert.ok(crossed.positive.includes('sitting with legs crossed'));
  assert.ok(crossed.positive.includes('(modesty shorts)'));
  const squat = buildTunePrompt(applyLinkage(defaultState()), { pose: '蹲姿' });
  assert.ok(squat.positive.includes('(fully clothed:1.3)'));
  assert.ok(squat.negative.includes('(exposed crotch:1.5)'));
  const jump = buildTunePrompt(applyLinkage(defaultState()), { pose: '跳跃中' });
  assert.ok(jump.positive.includes('covered crotch'));
  assert.ok(jump.negative.includes('(nsfw:1.4)'));
  const maleSeated = buildTunePrompt(
    applyLinkage({ ...defaultState(), gender: '女', tuneGender: '男', pose: ['正坐'] }),
    { pose: '正坐' },
  );
  assert.equal(maleSeated.positive.includes('safety shorts'), false);
  assert.equal(maleSeated.negative.includes('upskirt'), false);
  const formMale = buildTunePrompt(
    applyLinkage({ ...defaultState(), gender: '男', age: '青年', tuneGender: '女', pose: ['正坐'] }),
    { pose: '正坐' },
  );
  assert.ok(formMale.positive.includes('(safety shorts:1.4)'));
  const flat = buildTunePrompt(applyLinkage({ ...defaultState(), pose: ['平躺'] }), { pose: '平躺' });
  assert.ok(flat.positive.includes('lying flat on back'));
  assert.ok(flat.positive.includes('no shoes'));
  assert.ok(flat.positive.includes('(safety shorts:1.4)'));
  assert.ok(flat.negative.includes('(panties:1.5)'));
  const side = buildTunePrompt(applyLinkage(defaultState()), { pose: '侧躺' });
  assert.ok(side.positive.includes('(modesty shorts)'));
  const prone = buildTunePrompt(applyLinkage(defaultState()), { pose: '平趴' });
  assert.ok(prone.positive.includes('skirt covering legs'));
  const calves = buildTunePrompt(applyLinkage(defaultState()), { pose: '小腿交叉趴着' });
  assert.ok(calves.negative.includes('(exposed crotch:1.5)'));
  const standing = buildTunePrompt(applyLinkage(defaultState()), { pose: '站立' });
  assert.equal(standing.positive.includes('safety shorts'), false);
  const book = buildPrompt({ ...defaultState(), handheld: ['书本'] }, '基准立绘', {});
  assert.equal(book.positive.includes('holding book'), false);
  const heldShot = buildTunePrompt(applyLinkage(defaultState()), { pose: '站立', handheld: '书本' });
  assert.ok(heldShot.positive.includes('holding book'));
});

// 微调中文指令：姿势、手部动作、背景进入中文句；纯色背景不写进背景描述。
test('tune chinese clause includes pose, hand and non-plain background', () => {
  const state = applyLinkage({
    ...defaultState(),
    pose: ['正坐'],
    handPose: ['单手摸脸·托腮'],
    background: '咖啡馆',
  });
  const [combo] = tuneCombinations(state);
  const p = buildTunePrompt(state, combo);
  assert.ok(p.positive.includes('摆出【正坐】'));
  assert.ok(p.positive.includes('单手摸脸·托腮'));
  assert.ok(p.positive.includes('背景是【咖啡馆】'));
  assert.ok(p.positive.includes('不要沿用参考图里的站立姿势'));
  // 纯色背景不写进中文背景句。
  const plain = buildTunePrompt(applyLinkage(defaultState()), tuneCombinations(applyLinkage(defaultState()))[0]);
  assert.ok(!plain.positive.includes('背景是【纯色背景'));
});

// 镜头俯仰：俯视/仰视必须用专业机位术语钉死 45° 角，并反向排除相反角度。
test('tune camera pitch writes a 45-degree high/low angle with opposite-angle exclusion', () => {
  const combo = (s) => tuneCombinations(s)[0];

  const high = buildTunePrompt(
    applyLinkage({ ...defaultState(), camera: '俯视(从高往下看)' }),
    combo(applyLinkage({ ...defaultState(), camera: '俯视(从高往下看)' })),
  );
  assert.ok(high.positive.includes('high angle shot'));
  assert.ok(high.positive.includes('viewed from above at a 45-degree downward angle'));
  assert.ok(high.positive.includes('looking down at the subject'));
  assert.ok(!high.positive.includes('from below'), 'high angle must not ask for from below');
  assert.ok(high.negative.includes('low angle'));
  assert.ok(high.negative.includes('from below'));
  assert.ok(high.negative.includes('looking up at the subject'));

  const low = buildTunePrompt(
    applyLinkage({ ...defaultState(), camera: '仰视(从下往上看)' }),
    combo(applyLinkage({ ...defaultState(), camera: '仰视(从下往上看)' })),
  );
  assert.ok(low.positive.includes('low angle shot'));
  assert.ok(low.positive.includes('viewed from below at a 45-degree upward angle'));
  assert.ok(low.positive.includes('looking up at the subject'));
  assert.ok(!low.positive.includes('from above'), 'low angle must not ask for from above');
  assert.ok(low.negative.includes('high angle'));
  assert.ok(low.negative.includes('from above'));
  assert.ok(low.negative.includes('looking down at the subject'));

  const eye = buildTunePrompt(applyLinkage(defaultState()), combo(applyLinkage(defaultState())));
  assert.ok(eye.positive.includes('eye level'));
  assert.ok(eye.positive.includes('straight-on camera angle'));
  assert.ok(eye.negative.includes('high angle'));
  assert.ok(eye.negative.includes('low angle'));});

// 定向微调回退到 Gemini 后，提示词必须是纯英文那套：中文字符只允许出现在开头的中文指令里。
test('tune prompt stays english after the revert to gemini', () => {
  const combo = (s) => tuneCombinations(s)[0];
  const high = applyLinkage({ ...defaultState(), camera: '俯视(从高往下看)' });
  const p = buildTunePrompt(high, combo(high));
  assert.ok(p.positive.includes('high angle shot'));
  assert.ok(p.positive.includes('viewed from above at a 45-degree downward angle'));
  assert.ok(p.positive.endsWith(NANO_HAND_POSITIVE));
  // 中文只出现在打头的参考图/动作句里，镜头与手部那几段不能回灌中文。
  const body = p.positive.slice(String(p.positive).indexOf('\n') + 1);
  assert.equal(/机位架在角色斜上方|机位放低|手部结构必须正确|俯角约|仰角约/.test(body), false);
  assert.equal(/多指|少指/.test(p.negative), false);
});

// 物理支撑联动：坐/躺 + 硬地背景补「贴地」正向词；坐/躺一律补「防悬空」负向词。
test('tune support linkage: ground insurance and anti-float negative', () => {
  const groundPos = '(resting on the ground, sitting on the floor:1.2)';
  const antiFloat = '(floating in the air, antigravity, stiff pose, no surface support:1.3)';

  // 坐姿 + 城市街道（硬地）：正向补贴地，负向补防悬空。
  const seated = buildTunePrompt(
    applyLinkage({ ...defaultState(), pose: ['正坐'], background: '城市街道' }),
    { pose: '正坐' },
  );
  assert.ok(seated.positive.includes(groundPos), 'sitting on a street must rest on the ground');
  assert.ok(seated.negative.includes(antiFloat), 'sitting must not float');

  // 躺姿 + 教室（硬地）：同样补贴地。
  const lying = buildTunePrompt(
    applyLinkage({ ...defaultState(), pose: ['平躺'], background: '教室' }),
    { pose: '平躺' },
  );
  assert.ok(lying.positive.includes(groundPos));
  assert.ok(lying.negative.includes(antiFloat));

  // 趴姿 + 花海/草地（硬地）：贴地。
  const prone = buildTunePrompt(
    applyLinkage({ ...defaultState(), pose: ['平趴'], background: '花海/草地' }),
    { pose: '平趴' },
  );
  assert.ok(prone.positive.includes(groundPos));
  assert.ok(prone.negative.includes(antiFloat));

  // 坐姿 + 沙发（有支撑物）：不需要「躺地上」保险，但仍防悬空。
  const onSofa = buildTunePrompt(
    applyLinkage({ ...defaultState(), pose: ['正坐'], background: '复古/布艺沙发' }),
    { pose: '正坐' },
  );
  assert.ok(!onSofa.positive.includes(groundPos), 'a sofa is a real support, no ground insurance');
  assert.ok(onSofa.negative.includes(antiFloat));

  // 站立 + 硬地：不补贴地、不补防悬空。
  const standing = buildTunePrompt(
    applyLinkage({ ...defaultState(), pose: ['站立'], background: '城市街道' }),
    { pose: '站立' },
  );
  assert.ok(!standing.positive.includes(groundPos));
  assert.ok(!standing.negative.includes(antiFloat));
});

test('barefoot full-body tune prompts bare feet instead of shoes visible', () => {
  const bare = applyLinkage({
    ...defaultState(),
    shoes: { skeleton: '赤脚', style: '脚链', detail: '无额外细节', color: '无', colorCustom: '' },
  });
  const tune = buildTunePrompt(bare, tuneCombinations(bare)[0]);
  assert.ok(tune.positive.includes('barefoot'));
  assert.ok(tune.positive.includes('bare feet'));
  assert.ok(!tune.positive.includes('shoes visible'), 'barefoot must not ask for shoes');
  assert.ok(!tune.positive.includes('legs and shoes in frame'));

  const shod = buildTunePrompt(applyLinkage(defaultState()), tuneCombinations(applyLinkage(defaultState()))[0]);
  assert.ok(shod.positive.includes('shoes visible'));
  assert.ok(!shod.positive.includes('bare feet'));
});

test('tuneShoes off forces no shoes with strong shoe-suppression (socks stay on)', () => {
  // 不穿鞋但仍穿袜：脱鞋留袜，不写 barefoot，也不补袜子负向。
  const off = buildTunePrompt(
    applyLinkage({ ...defaultState(), tuneShoes: false }),
    tuneCombinations(applyLinkage({ ...defaultState(), tuneShoes: false }))[0],
  );
  assert.ok(off.positive.includes('no shoes'), 'must drop shoes');
  assert.ok(off.positive.includes('shoes removed'));
  assert.ok(off.positive.includes('same socks as the first reference'), 'socks stay from the reference');
  assert.ok(!off.positive.includes('(barefoot:1.4)'), 'keeping socks must not force barefoot');
  assert.ok(!off.positive.includes('shoes visible'), 'must not ask for shoes');
  assert.ok(off.negative.includes('(shoes:1.4)'));
  assert.ok(off.negative.includes('(footwear:1.4)'));
  assert.ok(off.negative.includes('wearing shoes'));
  assert.ok(!off.negative.includes('(socks:1.4)'), 'keeping socks must not suppress socks');
  // 脱鞋留袜必须钉死袜子包裹脚部、脚趾不外露，防止画成赤脚。
  assert.ok(off.positive.includes('(socks still on:1.4)'));
  assert.ok(off.positive.includes('(feet fully covered by socks:1.4)'));
  assert.ok(off.positive.includes('(toes hidden inside the socks:1.3)'));
  assert.ok(off.positive.includes('no bare skin on the feet'));
  assert.ok(off.negative.includes('(visible toes:1.4)'));
  assert.ok(off.negative.includes('(toes showing through the socks:1.4)'));
  assert.ok(off.negative.includes('see-through socks'));
});

test('tuneSocks off forces no socks with strong legwear-suppression', () => {
  const off = buildTunePrompt(
    applyLinkage({ ...defaultState(), tuneSocks: false }),
    tuneCombinations(applyLinkage({ ...defaultState(), tuneSocks: false }))[0],
  );
  assert.ok(off.positive.includes('bare legs'));
  assert.ok(off.positive.includes('no socks'));
  assert.ok(off.positive.includes('no stockings'));
  assert.ok(off.positive.includes('no hosiery'));
  assert.ok(off.negative.includes('(socks:1.4)'));
  assert.ok(off.negative.includes('(stockings:1.4)'));
  assert.ok(off.negative.includes('(pantyhose:1.4)'));
  assert.ok(off.negative.includes('hosiery'));
});

test('tuneShoes and tuneSocks both off produce a fully barefoot tune', () => {
  const off = buildTunePrompt(
    applyLinkage({ ...defaultState(), tuneShoes: false, tuneSocks: false }),
    tuneCombinations(applyLinkage({ ...defaultState(), tuneShoes: false, tuneSocks: false }))[0],
  );
  assert.ok(off.positive.includes('barefoot'));
  assert.ok(off.positive.includes('bare legs'));
  assert.ok(off.positive.includes('no socks'));
  assert.ok(off.positive.includes('(barefoot:1.4)'));
  assert.ok(!off.positive.includes('same socks as the first reference'));
  assert.ok(off.negative.includes('(socks:1.4)'));
});
