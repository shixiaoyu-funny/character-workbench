import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultState } from '../src/state.js';
import { applyLinkage } from '../src/rules.js';
import { buildPrompt } from '../src/prompts.js';
import { applyClothingSelection, clothingExclusions, clothingNotes, clothingTerms, clothingView, migrateClothing } from '../src/clothing.js';

function socks(patch) {
  return {
    ...defaultState(),
    age: '成女',
    socks: { skeleton: '短袜', style: '常规', detail: '无额外细节', color: '无', colorCustom: '', ...patch },
  };
}

test('short socks only offer plain, torn, and fishnet structures', () => {
  const state = applyLinkage(socks({ style: '吊带袜' }));
  assert.equal(state.socks.style, '常规');
  const fish = applyLinkage(socks({ style: '渔网袜' }));
  assert.equal(fish.socks.style, '渔网袜');
  assert.ok(buildPrompt(fish, '基准立绘').positive.includes('fishnet socks'));
});

test('garter stockings force a garter belt and thigh socks can leave zettai ryouiki', () => {
  const garter = applyLinkage({
    ...defaultState(),
    age: '成女',
    bottom: { skeleton: '短裙', style: '百褶裙', detail: '无额外细节', color: '无', colorCustom: '' },
    socks: { skeleton: '大腿袜（绝对领域）', style: '吊带袜', detail: '无额外细节', color: '黑', colorCustom: '' },
  });
  const prompt = buildPrompt(garter, '基准立绘').positive;
  assert.ok(prompt.includes('garter belt'));
  assert.ok(prompt.includes('black garter stockings'));
  assert.ok(prompt.includes('zettai ryouiki'));
  assert.ok(clothingNotes('socks', garter).includes('已加上吊带腰带'));
});

test('pantyhose replaces the thigh gap', () => {
  const state = applyLinkage({
    ...defaultState(),
    age: '成女',
    bottom: { skeleton: '短裙', style: '百褶裙', detail: '无额外细节', color: '无', colorCustom: '' },
    socks: { skeleton: '大腿袜（绝对领域）', style: '连裤袜', detail: '半透明薄透', color: '白', colorCustom: '' },
  });
  const prompt = buildPrompt(state, '基准立绘').positive;
  assert.ok(prompt.includes('white pantyhose'));
  assert.ok(prompt.includes('sheer'));
  assert.ok(!prompt.includes('zettai ryouiki'));
});

test('legacy flat clothing migrates into nodes', () => {
  const old = {
    ...defaultState(),
    top: '针织开衫',
    socks: '连裤袜（黑丝/白丝）',
    shoes: '光脚穿袜',
    materials: ['湿身效果', '蕾丝花边'],
  };
  delete old.outfitEffects;
  const migrated = migrateClothing(old);
  assert.equal(migrated.top.style, '衬衫');
  assert.equal(migrated.outerwear.style, '针织开衫');
  assert.equal(migrated.socks.style, '连裤袜');
  assert.equal(migrated.socks.color, '黑');
  assert.equal(migrated.socks.detail, '半透明薄透');
  assert.equal(migrated.shoes.skeleton, '赤脚');
  assert.equal(migrated.socks.skeleton, '大腿袜（绝对领域）');
  assert.deepEqual(migrated.outfitEffects, ['湿身']);
});

test('clothing terms skip top and bottom while a one-piece is worn', () => {
  const state = {
    ...defaultState(),
    onePiece: '连衣裙',
  };
  const terms = clothingTerms(state);
  assert.ok(terms.some((term) => term.includes('dress')));
  assert.ok(!terms.some((term) => term === 'shirt' || term.includes('pleated skirt')));
});

test('over-knee boots pin their length with weighted anchors', () => {
  const state = applyLinkage({
    ...defaultState(),
    age: '成女',
    shoes: { skeleton: '过膝靴', style: '过膝长靴', detail: '高跟', color: '黑', colorCustom: '' },
  });
  const terms = clothingTerms(state);
  assert.ok(terms.includes('black thigh-high boots'), 'keeps the style tag');
  assert.ok(terms.includes('(thigh-high boots:1.3)'), 'weights the thigh-high length');
  assert.ok(terms.includes('(over-knee boots:1.2)'), 'pins the over-knee reading');
  const prompt = buildPrompt(state, '基准立绘').positive;
  assert.ok(prompt.includes('(thigh-high boots:1.3)'));
  assert.ok(prompt.includes('(over-knee boots:1.2)'));
});

test('mid-calf boots are not forced toward thigh-high', () => {
  const state = applyLinkage({
    ...defaultState(),
    age: '成女',
    shoes: { skeleton: '中筒靴', style: '长筒靴', detail: '平跟', color: '无', colorCustom: '' },
  });
  const terms = clothingTerms(state);
  assert.ok(terms.includes('knee-high boots'));
  assert.ok(!terms.some((t) => t.includes('thigh-high')), 'no thigh-high anchor for mid-calf');
});

function shoes(skeleton, style, detail = '无额外细节') {
  return applyLinkage({
    ...defaultState(),
    age: '成女',
    shoes: { skeleton, style, detail, color: '无', colorCustom: '' },
  });
}

test('barefoot skeleton keeps its style and stays bare', () => {
  const state = shoes('赤脚', '纯赤脚');
  const terms = clothingTerms(state);
  assert.equal(state.shoes.skeleton, '赤脚');
  assert.equal(state.shoes.style, '纯赤脚');
  assert.ok(terms.includes('barefoot'));
  assert.ok(terms.includes('bare feet'));
  assert.ok(terms.includes('visible toenails'));
});

test('barefoot decorations add anklet, polish, tabi, and ribbon tags', () => {
  const cases = [
    ['脚链', ['delicate anklet', 'gold chain', 'small bells']],
    ['脚趾甲油', ['red toenails', 'glossy nail polish']],
    ['足袋（分趾）', ['tabi socks', 'split toe']],
    ['绑带缠绕', ['ribbon wrapped around ankle', 'laces']],
  ];
  for (const [style, tags] of cases) {
    const state = shoes('赤脚', style);
    const terms = clothingTerms(state);
    assert.ok(terms.includes('barefoot'), `${style} keeps the barefoot base`);
    for (const tag of tags) assert.ok(terms.includes(tag), `${style} should emit ${tag}`);
    assert.ok(!terms.some((term) => term.includes('thigh-high')), `${style} adds no boot anchor`);
  }
});

test('barefoot view offers styles and hides the color segment', () => {
  const state = shoes('赤脚', '脚链');
  const view = clothingView('shoes', state);
  const style = view.segments.find((segment) => segment.key === 'style');
  const options = style.groups.flatMap((group) => group.options).map((option) => option.value);
  assert.ok(options.includes('纯赤脚'));
  assert.ok(options.includes('足袋（分趾）'));
  assert.ok(options.includes('绑带缠绕'));
  assert.equal(view.segments.some((segment) => segment.key === 'color'), false);
});

test('new ankle-boot styles keep their own tags without thigh-high anchors', () => {
  const cases = [
    ['尖头细跟短靴', 'pointed-toe ankle boots'],
    ['绑带短靴', 'lace-up ankle boots'],
    ['袜靴', 'sock boots'],
    ['切尔西靴', 'chelsea boots'],
    ['马丁靴', 'combat boots'],
  ];
  for (const [style, tag] of cases) {
    const terms = clothingTerms(shoes('踝靴', style));
    assert.ok(terms.includes(tag), `${style} should emit ${tag}`);
    assert.ok(!terms.some((term) => term.includes('thigh-high')), `${style} adds no thigh-high anchor`);
    assert.ok(!terms.some((term) => term.includes('knee-high')), `${style} adds no mid-calf anchor`);
  }
});

test('new mid-calf styles stay at the calf', () => {
  const cases = [
    ['骑士靴', 'riding boots'],
    ['牛仔靴', 'cowboy boots'],
    ['粗跟中筒靴', 'block heel mid-calf boots'],
    ['堆堆靴', 'slouchy boots'],
    ['流苏中筒靴', 'fringe mid-calf boots'],
  ];
  for (const [style, tag] of cases) {
    const terms = clothingTerms(shoes('中筒靴', style));
    assert.ok(terms.includes(tag), `${style} should emit ${tag}`);
    assert.ok(!terms.some((term) => term.includes('thigh-high')), `${style} must not drift to over-knee`);
  }
});

test('every over-knee style inherits the weighted length anchors', () => {
  const styles = ['弹力过膝靴', '绑带过膝靴', '翻折过膝靴', '亮面皮质长靴', '骑士长靴', '过膝长靴', '机甲战靴'];
  for (const style of styles) {
    const terms = clothingTerms(shoes('过膝靴', style, '高跟'));
    assert.ok(terms.includes('(thigh-high boots:1.3)'), `${style} should pin the thigh-high length`);
    assert.ok(terms.includes('(over-knee boots:1.2)'), `${style} should pin the over-knee reading`);
  }
});

test('switching to barefoot replaces the boot style and back again', () => {
  let state = shoes('过膝靴', '亮面皮质长靴');
  state = applyLinkage(applyClothingSelection(state, 'shoes', 'skeleton', '赤脚'));
  assert.equal(state.shoes.skeleton, '赤脚');
  assert.equal(state.shoes.style, '纯赤脚');
  assert.ok(clothingTerms(state).includes('barefoot'));

  state = applyLinkage(applyClothingSelection(state, 'shoes', 'skeleton', '过膝靴'));
  assert.equal(state.shoes.skeleton, '过膝靴');
  assert.equal(state.shoes.style, '过膝长靴');
});

// 体操服实测会自带「半透明袖套 + 身后半片裙摆」：只写 leotard，模型的先验就会补这两件。
// 所以按款式声明排除项，正负向两头钉住。
function leotard(patch = {}) {
  return applyLinkage({
    ...defaultState(),
    age: '成女',
    onePiece: { skeleton: '短连体', style: '体操服', detail: '无额外细节', color: '无', colorCustom: '' },
    top: { skeleton: '无', style: '无', detail: '无额外细节', color: '无', colorCustom: '' },
    bottom: { skeleton: '无', style: '无', detail: '无额外细节', color: '无', colorCustom: '' },
    outerwear: { skeleton: '无', style: '无', detail: '无额外细节', color: '无', colorCustom: '' },
    ...patch,
  });
}

test('leotard forbids invented sleeves and half skirt', () => {
  const shape = clothingExclusions(leotard());
  for (const tag of ['(sleeveless:1.2)', 'bare arms']) {
    assert.ok(shape.positive.includes(tag), `leotard should ask for ${tag}`);
  }
  for (const tag of ['(detached sleeves:1.4)', '(overskirt:1.4)', '(half skirt:1.4)',
    '(back skirt panel:1.4)', '(back drape:1.3)']) {
    assert.ok(shape.negative.includes(tag), `leotard must exclude ${tag}`);
  }
  const p = buildPrompt(leotard(), '基准立绘');
  for (const tag of shape.positive) assert.ok(p.positive.includes(tag), `prompt should carry ${tag}`);
  for (const tag of shape.negative) assert.ok(p.negative.includes(tag), `negative should carry ${tag}`);
  // 裙子/袖子这类词只出现在负向，正向不能把裙摆写回来。
  assert.equal(p.positive.includes('overskirt'), false);
  // 三视图与 Q 版同样吃这套排除词，表情差分图不吃（它不描述服装）。
  assert.ok(buildPrompt(leotard(), '三视图').negative.includes('(half skirt:1.4)'));
  assert.ok(buildPrompt(leotard(), 'Q版形象').negative.includes('(half skirt:1.4)'));
  assert.equal(buildPrompt(leotard(), '表情差分图').negative.includes('(half skirt:1.4)'), false);
});

test('outerwear cancels the silhouette exclusions it would conflict with', () => {
  // 叠了外套：手臂由外套定义，不再断言无袖。
  const jacket = leotard({
    outerwear: { skeleton: '短外套', style: '夹克', detail: '无额外细节', color: '无', colorCustom: '' },
  });
  const withJacket = clothingExclusions(jacket);
  assert.equal(withJacket.positive.includes('(sleeveless:1.2)'), false);
  assert.equal(withJacket.negative.includes('(detached sleeves:1.4)'), false);
  // 裙摆仍然要排除：夹克不是裙子。
  assert.ok(withJacket.negative.includes('(half skirt:1.4)'));

  // 披挂类外套：后摆是用户自己要的。
  const cloak = leotard({
    outerwear: { skeleton: '披挂', style: '披风', detail: '无额外细节', color: '无', colorCustom: '' },
  });
  const withCloak = clothingExclusions(cloak);
  assert.equal(withCloak.negative.includes('(cape:1.3)'), false);
  assert.equal(withCloak.negative.includes('(back drape:1.3)'), false);
});

test('other short one-pieces get the same treatment, dresses do not', () => {
  const swimsuit = leotard({
    onePiece: { skeleton: '短连体', style: '一件式泳装', detail: '无额外细节', color: '无', colorCustom: '' },
  });
  assert.ok(clothingExclusions(swimsuit).negative.includes('(detached sleeves:1.4)'));
  // 裙装款式本身就有裙摆，不能再排掉。
  const dress = leotard({
    onePiece: { skeleton: '及膝', style: 'A字连衣裙', detail: '无额外细节', color: '无', colorCustom: '' },
  });
  assert.deepEqual(clothingExclusions(dress), { positive: [], negative: [] });
  // 没穿连体装时完全不产生排除词。
  const bare = leotard({
    onePiece: { skeleton: '无', style: '无', detail: '无额外细节', color: '无', colorCustom: '' },
  });
  assert.deepEqual(clothingExclusions(bare), { positive: [], negative: [] });
});
