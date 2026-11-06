// 服饰节点：每个部位按骨架、款式、细配、颜色四段细选。
// 上一档不兼容的下一档不出现；连体装盖住上装和下装。

import { ROLE_RECOMMENDATIONS } from './catalog.js';

export const CLOTHING_SLOTS = ['top', 'bottom', 'outerwear', 'onePiece', 'shoes', 'socks'];

const GROUPS = ['现代', '东亚传统', '西方历史', '制服职业', '幻想机能'];

export const CLOTHING_COLORS = [
  { value: '无', tag: '' },
  { value: '黑', tag: 'black' }, { value: '白', tag: 'white' }, { value: '粉', tag: 'pink' },
  { value: '红', tag: 'red' }, { value: '蓝', tag: 'blue' }, { value: '棕', tag: 'brown' },
  { value: '灰', tag: 'gray' }, { value: '紫', tag: 'purple' }, { value: '绿', tag: 'green' },
  { value: '藏青', tag: 'navy blue' }, { value: '米色', tag: 'beige' },
  { value: '银', tag: 'silver' }, { value: '金', tag: 'gold' }, { value: '自定义', tag: '' },
];

const COLOR_TAG = Object.fromEntries(CLOTHING_COLORS.map((item) => [item.value, item.tag]));

const emptyPiece = () => ({
  skeleton: '无', style: '无', detail: '无额外细节', color: '无', colorCustom: '',
});

function piece(skeleton, style, detail = '无额外细节', color = '无', colorCustom = '') {
  return { skeleton, style, detail, color, colorCustom };
}

export function defaultClothing() {
  return {
    top: piece('常规衣摆', '衬衫'),
    bottom: piece('及膝裙', '百褶裙'),
    outerwear: emptyPiece(),
    onePiece: emptyPiece(),
    shoes: piece('鞋面', '小皮鞋', '平跟'),
    socks: emptyPiece(),
  };
}

function sk(value, gates = {}) {
  return { value, gates };
}

function st(value, tag, group, skeletons, gates = {}, extra = {}) {
  const list = Array.isArray(skeletons) ? skeletons : [skeletons];
  return {
    value, tag, group, gates,
    skeletons: list,
    defaultSkeleton: extra.defaultSkeleton || list[0],
    details: extra.details || null,
    forced: extra.forced || [],
  };
}

const M = { male: 'hide' };
// 女角色不再按年龄隐藏或折叠任何衣物，全部只保留男/女与伪娘差异。
const L = {};
const SH = {};
const ML = { male: 'hide' };
const MLS = { male: 'hide' };
const MS = { male: 'hide' };
const MLF = { male: 'hide' };

const TOP_SKELETONS = [
  sk('无'), sk('胸衣短款'), sk('短衣摆'), sk('常规衣摆'), sk('中长衣摆'),
];
const TOP_STYLES = [
  st('T恤', 't-shirt', '现代', ['常规衣摆', '短衣摆']),
  st('衬衫', 'shirt', '现代', ['常规衣摆', '短衣摆', '中长衣摆']),
  st('套头毛衣', 'sweater', '现代', ['常规衣摆', '中长衣摆']),
  st('卫衣', 'hoodie', '现代', ['常规衣摆', '短衣摆']),
  st('露脐上衣', 'crop top', '现代', '短衣摆', ML),
  st('吊带背心', 'camisole', '现代', '胸衣短款', ML),
  st('抹胸', 'tube top', '现代', '胸衣短款', MLS),
  st('蕾丝吊带', 'lace camisole', '现代', '胸衣短款', ML),
  st('皮质胸衣', 'leather bustier', '现代', '胸衣短款', MLS),
  st('水手服上衣', 'serafuku', '制服职业', '常规衣摆', M),
  st('西装内搭', 'dress shirt', '制服职业', '常规衣摆'),
  st('制服上衣', 'uniform shirt', '制服职业', '常规衣摆'),
  st('交领右衽襦', 'hanfu ru, cross-collar, right lapel', '东亚传统', ['常规衣摆', '短衣摆']),
  st('对襟衫', 'hanfu parallel-collar shirt', '东亚传统', ['常规衣摆', '中长衣摆']),
  st('旗袍式短上衣', 'qipao top, mandarin collar', '东亚传统', '常规衣摆', M),
  st('和服上着', 'kimono top', '东亚传统', '中长衣摆'),
  st('长襦袢', 'nagajuban', '东亚传统', '中长衣摆'),
  st('巫女白衣', 'miko kosode', '东亚传统', ['常规衣摆', '中长衣摆'], M),
  st('赤古里', 'jeogori', '东亚传统', '常规衣摆', M),
  st('库尔塔', 'kurta', '东亚传统', ['常规衣摆', '中长衣摆']),
  st('突尼克', 'tunic', '西方历史', ['常规衣摆', '中长衣摆']),
  st('维多利亚罩衫', 'victorian blouse, high neck', '西方历史', '常规衣摆', M),
  st('机能紧身衣', 'techwear shirt', '幻想机能', ['常规衣摆', '胸衣短款']),
  st('战术背心', 'tactical vest', '幻想机能', ['常规衣摆', '胸衣短款']),
  // 扩充：日常甜美、职业制服与舞台身份可自由组合的上装。
  st('荷叶边衬衫', 'frilled blouse', '现代', ['常规衣摆', '中长衣摆']),
  st('泡泡袖衬衫', 'puff-sleeve blouse', '现代', ['常规衣摆', '短衣摆']),
  st('娃娃领衬衫', 'peter pan collar blouse', '现代', '常规衣摆'),
  st('蕾丝衬衫', 'lace blouse', '现代', ['常规衣摆', '中长衣摆'], M),
  st('高领毛衣', 'turtleneck sweater', '现代', ['常规衣摆', '中长衣摆']),
  st('针织背心', 'knit vest', '现代', '常规衣摆'),
  st('运动背心', 'athletic tank top', '现代', '胸衣短款'),
  st('网球衫', 'polo shirt, tennis', '现代', '常规衣摆'),
  st('露肩上衣', 'off-shoulder top', '现代', '胸衣短款', M),
  st('挂脖上衣', 'halter top', '现代', '胸衣短款', M),
  st('一字肩毛衣', 'off-shoulder sweater', '现代', '常规衣摆', M),
  st('女仆上衣', 'maid blouse, apron straps', '制服职业', '常规衣摆', M),
  st('护士服上衣', 'nurse uniform top', '制服职业', '常规衣摆', M),
  st('警服上衣', 'police uniform shirt', '制服职业', '常规衣摆'),
  st('军装上衣', 'military tunic, epaulettes', '制服职业', '常规衣摆'),
  st('学院衬衫', 'school blouse, ribbon tie', '制服职业', '常规衣摆', M),
  st('啦啦队上衣', 'cheerleader top', '制服职业', '短衣摆', M),
  st('厨师服上衣', 'chef jacket', '制服职业', '常规衣摆'),
  st('空姐制服上衣', 'flight attendant uniform top', '制服职业', '常规衣摆', M),
  st('舞台打歌服上衣', 'stage costume top', '现代', ['常规衣摆', '短衣摆']),
  st('工装衬衫', 'work shirt', '现代', ['常规衣摆', '中长衣摆']),
  st('飞行员衬衫', 'pilot shirt, epaulettes', '制服职业', '常规衣摆'),
];

const BOTTOM_SKELETONS = [
  sk('无'), sk('热裤', ML), sk('短裤'), sk('长裤'),
  sk('短裙', M), sk('及膝裙', M), sk('长裙', M), sk('曳地裙', M),
];
const BOTTOM_STYLES = [
  st('热裤', 'hot pants', '现代', '热裤', ML),
  st('运动短裤', 'athletic shorts', '现代', '短裤'),
  st('牛仔短裤', 'denim shorts', '现代', ['短裤', '热裤']),
  st('灯笼短裤', 'lantern shorts', '现代', '短裤'),
  st('犊鼻裈', 'hanfu labor shorts', '东亚传统', '短裤'),
  st('直筒长裤', 'pants', '现代', '长裤'),
  st('牛仔裤', 'jeans', '现代', '长裤'),
  st('阔腿裤', 'wide-leg pants', '现代', '长裤'),
  st('西裤', 'dress pants', '制服职业', '长裤'),
  st('工装裤', 'cargo pants', '幻想机能', '长裤'),
  st('灯笼裤', 'lantern pants', '东亚传统', '长裤'),
  st('打底裤', 'leggings', '现代', '长裤'),
  st('皮裤', 'leather pants', '现代', '长裤', L),
  st('汉服袴', 'hanfu trousers', '东亚传统', '长裤'),
  st('裙裤', 'culottes', '东亚传统', ['长裤', '及膝裙']),
  st('绯袴', 'hakama', '东亚传统', ['及膝裙', '长裙'], M),
  st('机甲腿甲', 'mecha leg armor', '幻想机能', '长裤'),
  st('百褶裙', 'pleated skirt', '现代', ['及膝裙', '短裙', '长裙'], M),
  st('包臀裙', 'tight skirt', '现代', '短裙', MLS),
  st('蓬蓬裙', 'tutu skirt', '现代', ['短裙', '及膝裙'], M),
  st('A字裙', 'a-line skirt', '现代', ['及膝裙', '短裙', '长裙'], M),
  st('蕾丝半裙', 'lace skirt', '现代', ['短裙', '及膝裙'], ML),
  st('马面裙', 'horse-face skirt, pleated side panels', '东亚传统', ['长裙', '曳地裙'], M),
  st('褶裙', 'hanfu pleated skirt', '东亚传统', ['长裙', '曳地裙'], M),
  st('齐胸褶裙', 'chest-high skirt', '东亚传统', ['曳地裙', '长裙'], M),
  st('高开叉长裙', 'high-slit skirt', '现代', ['长裙', '曳地裙'], MLS),
  st('鱼尾裙', 'mermaid skirt', '现代', ['曳地裙', '长裙'], M),
  st('和服式长下摆', 'kimono skirt', '东亚传统', ['长裙', '曳地裙'], M),
  // 扩充：制服、职业与甜美风格的下装，可与上装自由叠穿（女仆 = 洛丽塔衬衫 + 裙 + 围裙）。
  st('洛丽塔裙撑下裙', 'lolita skirt, petticoat', '现代', ['及膝裙', '长裙'], {}, { forced: ['petticoat'] }),
  st('荷叶边半裙', 'frilled skirt', '现代', ['短裙', '及膝裙']),
  st('女仆围裙裙', 'maid skirt, apron', '制服职业', ['短裙', '及膝裙'], M),
  st('护士裙', 'nurse skirt', '制服职业', '及膝裙', M),
  st('警服裙', 'police skirt', '制服职业', '短裙', M),
  st('空姐裙', 'flight attendant skirt', '制服职业', '及膝裙', M),
  st('军装长裤', 'military trousers', '制服职业', '长裤'),
  st('西装裙', 'pencil skirt', '制服职业', ['及膝裙', '短裙']),
  st('网球裙', 'tennis skirt', '现代', '短裙'),
  st('啦啦队短裙', 'cheerleader skirt', '制服职业', '短裙', M),
  st('运动长裤', 'track pants', '现代', '长裤'),
  st('瑜伽裤', 'yoga pants', '现代', '长裤'),
  st('工装短裤', 'cargo shorts', '幻想机能', '短裤'),
  st('牛仔长裙', 'denim skirt', '现代', ['长裙', '及膝裙']),
  st('纱裙', 'tulle skirt', '现代', ['长裙', '及膝裙']),
  st('马裤', 'riding breeches', '西方历史', '长裤'),
  st('打歌短裙', 'stage skirt', '现代', '短裙'),
  st('皮短裙', 'leather skirt', '现代', '短裙'),
  st('毛呢半裙', 'wool skirt', '现代', '及膝裙'),
];

const OUTER_SKELETONS = [
  sk('无'), sk('坎肩'), sk('短外套'), sk('中长外套'), sk('长外套'), sk('披挂'),
];
const OUTER_STYLES = [
  st('马甲背心', 'vest', '现代', '坎肩'),
  st('比甲', 'bijia', '东亚传统', ['坎肩', '中长外套']),
  st('战术防弹衣', 'body armor', '幻想机能', ['坎肩', '短外套']),
  st('薄纱罩衫', 'sheer shrug', '现代', ['坎肩', '短外套']),
  st('夹克', 'jacket', '现代', '短外套'),
  st('棒球服', 'baseball jacket', '现代', '短外套'),
  st('机车皮衣', 'biker leather jacket', '现代', '短外套'),
  st('西装外套', 'suit jacket', '制服职业', ['短外套', '中长外套']),
  st('针织开衫', 'cardigan', '现代', ['短外套', '中长外套']),
  st('机能风外套', 'techwear jacket', '幻想机能', ['短外套', '中长外套']),
  st('风衣', 'trench coat', '现代', ['中长外套', '长外套']),
  st('羽绒服', 'down jacket', '现代', ['中长外套', '短外套']),
  st('军大衣', 'military coat', '制服职业', ['中长外套', '长外套']),
  st('毛领大衣', 'fur-collared coat', '现代', ['中长外套', '长外套']),
  st('羽织', 'haori', '东亚传统', ['中长外套', '短外套']),
  st('汉服大袖衫', 'wide-sleeve outer robe', '东亚传统', '长外套'),
  st('魔法师法袍', 'mage robe', '幻想机能', ['长外套', '中长外套']),
  st('机甲外骨骼', 'mecha exoskeleton', '幻想机能', ['长外套', '中长外套']),
  st('斗篷', 'cape', '西方历史', '披挂'),
  st('披风', 'cloak', '西方历史', '披挂'),
  st('鹤氅', 'crane cloak', '东亚传统', '披挂'),
  st('披帛', 'shawl ribbon', '东亚传统', '披挂'),
  // 扩充：围裙、职业外套与舞台外套。
  st('围裙', 'apron', '现代', '坎肩'),
  st('女仆围裙', 'maid apron, frills', '制服职业', '坎肩', M),
  st('校服西装', 'school blazer', '制服职业', '短外套'),
  st('军装外套', 'military jacket', '制服职业', ['短外套', '中长外套']),
  st('警用风衣', 'police trench coat', '制服职业', '中长外套'),
  st('运动外套', 'track jacket', '现代', '短外套'),
  st('毛皮披肩', 'fur stole', '现代', '坎肩'),
  st('披肩', 'shawl', '现代', '披挂'),
  st('白大褂', 'lab coat', '制服职业', ['长外套', '中长外套']),
  st('偶像演出外套', 'stage jacket', '现代', '短外套'),
  st('消防外套', 'firefighter turnout coat, reflective stripes', '制服职业', '中长外套'),
  st('飞行员皮夹克', 'bomber jacket', '制服职业', '短外套'),
  st('侍者马甲', 'waiter vest', '制服职业', '坎肩'),
];

const DRESS = { male: 'hide' };
const ONE_SKELETONS = [sk('无'), sk('短连体'), sk('及膝'), sk('及踝'), sk('曳地')];
const ONE_STYLES = [
  st('背带短裤', 'short overalls', '现代', '短连体'),
  st('一件式泳装', 'one-piece swimsuit', '现代', '短连体', ML),
  st('连体紧身衣', 'bodysuit', '幻想机能', ['短连体', '及踝'], L),
  st('背带裙', 'pinafore dress', '现代', '及膝', M),
  st('A字连衣裙', 'a-line dress', '现代', ['及膝', '及踝', '曳地'], DRESS),
  st('衬衫裙', 'shirt dress', '现代', ['及膝', '及踝'], DRESS),
  st('JK制服', 'school uniform, blazer, pleated skirt', '制服职业', '及膝', DRESS),
  st('水手服连体裙', 'sailor dress', '制服职业', '及膝', DRESS),
  st('女仆装', 'maid outfit, apron, frills', '制服职业', ['及膝', '及踝'], DRESS),
  st('甜系洛丽塔', 'sweet lolita, petticoat', '现代', ['及膝', '曳地'], { ...DRESS, forced: ['petticoat'] }),
  st('古典洛丽塔', 'classic lolita, petticoat', '现代', ['及膝', '曳地'], { ...DRESS, forced: ['petticoat'] }),
  st('哥特洛丽塔', 'gothic lolita, petticoat', '现代', ['及膝', '曳地'], { ...DRESS, forced: ['petticoat'] }),
  st('旗袍', 'qipao, mandarin collar', '东亚传统', ['及踝', '及膝', '曳地'], { ...DRESS }),
  st('白大褂', 'lab coat', '制服职业', '及踝'),
  st('太空服', 'spacesuit', '幻想机能', '及踝'),
  st('忍者夜行服', 'ninja outfit', '幻想机能', '及踝'),
  st('战甲', 'full armor', '幻想机能', '及踝'),
  st('修女服', 'nun habit', '制服职业', ['及踝', '曳地'], DRESS),
  st('长衫', 'changshan', '东亚传统', '及踝'),
  st('圆领袍', 'round-collar robe', '东亚传统', ['及踝', '曳地']),
  st('道袍', 'taoist robe, cross-collar', '东亚传统', ['及踝', '曳地']),
  st('直裰', 'zhizhuo', '东亚传统', '及踝'),
  st('蒙古袍', 'deel, side slit, belt', '东亚传统', '及踝'),
  st('奥黛', 'ao dai', '东亚传统', '及踝', DRESS),
  st('布布长袍', 'boubou robe', '东亚传统', ['及踝', '曳地']),
  st('晚礼服', 'evening gown', '西方历史', '曳地', { ...DRESS }),
  st('婚纱', 'wedding dress', '西方历史', '曳地', { ...DRESS }),
  st('齐胸襦裙', 'chest-high ruqun, cross-collar, right lapel', '东亚传统', '曳地', DRESS),
  st('齐腰襦裙', 'waist-high ruqun, cross-collar, right lapel', '东亚传统', ['曳地', '及踝'], DRESS),
  st('交领襦裙', 'cross-collar ruqun, cross-collar, right lapel', '东亚传统', ['及踝', '曳地'], DRESS),
  st('袄裙', 'ming-style jacket and skirt', '东亚传统', '及踝', DRESS),
  st('直裾深衣', 'straight-hem shenyi, cross-collar, right lapel', '东亚传统', ['曳地', '及踝']),
  st('曲裾深衣', 'curved-hem shenyi, cross-collar, right lapel', '东亚传统', '曳地'),
  st('留袖', 'tomesode, obi', '东亚传统', '曳地', { ...DRESS, forced: ['obi'] }),
  st('振袖', 'furisode, long sleeves, obi', '东亚传统', '曳地', { ...DRESS, forced: ['obi'] }),
  st('访问着', 'homongi, obi', '东亚传统', ['及踝', '曳地'], { ...DRESS, forced: ['obi'] }),
  st('浴衣', 'yukata, obi', '东亚传统', '及踝', { ...DRESS, forced: ['obi'] }),
  st('男性和服', "men's kimono, obi", '东亚传统', '及踝', { forced: ['obi'] }),
  st('巫女服', 'miko outfit, hakama, obi', '东亚传统', '及踝', { ...DRESS, forced: ['obi'] }),
  st('韩服', 'hanbok, jeogori, high-waist skirt', '东亚传统', ['曳地', '及踝'], DRESS),
  st('纱丽', 'sari, blouse', '东亚传统', '曳地', DRESS),
  st('罩袍', 'abaya', '东亚传统', ['曳地', '及踝']),
  st('希顿', 'chiton, pinned shoulders', '西方历史', ['曳地', '及踝']),
  st('佩普洛斯', 'peplos, folded drape', '西方历史', '曳地', DRESS),
  st('洛可可宫廷裙', 'robe a la francaise, pannier', '西方历史', '曳地', DRESS),
  st('维多利亚长裙', 'victorian dress', '西方历史', ['曳地', '及踝'], DRESS),
  // 扩充：职业连体制服与舞台服装。
  st('护士服', 'nurse dress', '制服职业', '及膝', DRESS),
  st('警服连衣裙', 'police dress uniform', '制服职业', '及膝', DRESS),
  st('军装礼服', 'military dress uniform', '制服职业', '及踝'),
  st('啦啦队服', 'cheerleader uniform', '制服职业', '及膝', DRESS),
  st('体操服', 'leotard', '现代', '短连体'),
  st('芭蕾舞裙', 'ballet tutu', '现代', '短连体', DRESS, { forced: ['petticoat'] }),
  st('网球连衣裙', 'tennis dress', '现代', '及膝', DRESS),
  st('偶像打歌服', 'idol stage outfit', '现代', '及膝', DRESS),
  st('舞台礼服', 'stage gown', '现代', '曳地', DRESS),
  st('厨师服', 'chef uniform', '制服职业', '及踝'),
  st('空姐制服', 'flight attendant uniform', '制服职业', '及膝', DRESS),
  st('消防战斗服', 'firefighter turnout gear, reflective stripes', '制服职业', '及踝'),
  st('飞行服', 'flight suit, zippers', '制服职业', '及踝'),
  st('外科手术服', 'surgical scrubs', '制服职业', '及膝'),
];

// st() puts gates in the 5th arg. Loita entries above passed a gates object that also
// contains `forced`, which would be ignored. Rebuild those four with extra.
function withForced(list, value, forced) {
  const item = list.find((entry) => entry.value === value);
  if (item) item.forced = forced;
}

withForced(ONE_STYLES, '甜系洛丽塔', ['petticoat']);
withForced(ONE_STYLES, '古典洛丽塔', ['petticoat']);
withForced(ONE_STYLES, '哥特洛丽塔', ['petticoat']);
withForced(ONE_STYLES, '留袖', ['obi']);
withForced(ONE_STYLES, '振袖', ['obi']);
withForced(ONE_STYLES, '访问着', ['obi']);
withForced(ONE_STYLES, '浴衣', ['obi']);
withForced(ONE_STYLES, '男性和服', ['obi']);
withForced(ONE_STYLES, '巫女服', ['obi']);

// 连体装里「贴身、露臂、无裙摆」的款式：只写一个 leotard，模型会自作主张往上加东西。
// 实测（千问与 Gemini 都会）：体操服出图必带半透明袖套和身后半片裙摆/后摆，
// 风格锚点里的 ornate costume design / metallic accents / dreamy ethereal lighting 会放大这个倾向。
// 所以按款式声明「这个轮廓里不该出现什么」，由 clothingExclusions 转成正负向词。
function withNoExtra(list, value, extra) {
  const item = list.find((entry) => entry.value === value);
  if (item) item.noExtra = extra;
}

withNoExtra(ONE_STYLES, '体操服', ['sleeves', 'skirt', 'cape']);
withNoExtra(ONE_STYLES, '一件式泳装', ['sleeves', 'skirt', 'cape']);
withNoExtra(ONE_STYLES, '连体紧身衣', ['skirt', 'cape']);
withNoExtra(ONE_STYLES, '背带短裤', ['skirt', 'cape']);

const SHOE_SKELETONS = [sk('赤脚'), sk('鞋面'), sk('踝靴'), sk('中筒靴'), sk('过膝靴')];
const flatish = ['无额外细节', '平跟', '厚底', '破损'];
const heeled = ['无额外细节', '破损', '发光', '金属包头'];
const SHOE_STYLES = [
  // 赤脚系列：不穿鞋，只保留足部装饰。赤脚骨架不再是「空」，所以可以选款式。
  st('纯赤脚', 'barefoot, bare feet, natural toes, visible toenails', '现代', '赤脚', {}, { details: ['无额外细节'] }),
  st('脚链', 'barefoot, delicate anklet, gold chain, small bells', '现代', '赤脚', {}, { details: ['无额外细节', '金属'] }),
  st('脚趾甲油', 'barefoot, red toenails, glossy nail polish', '现代', '赤脚', {}, { details: ['无额外细节'] }),
  st('足袋（分趾）', 'barefoot, tabi socks, split toe', '东亚传统', '赤脚', {}, { details: ['无额外细节'] }),
  st('绑带缠绕', 'barefoot, ribbon wrapped around ankle, laces', '幻想机能', '赤脚', {}, { details: ['无额外细节', '绑带'] }),
  st('运动鞋', 'sneakers', '现代', '鞋面', {}, { details: flatish }),
  st('帆布鞋', 'canvas shoes', '现代', '鞋面', {}, { details: flatish }),
  st('小皮鞋', 'leather shoes', '现代', '鞋面', {}, { details: ['无额外细节', '平跟', '低跟', '破损'] }),
  st('乐福鞋', 'loafers', '现代', '鞋面', {}, { details: ['无额外细节', '平跟', '低跟'] }),
  st('牛津鞋', 'oxfords', '现代', '鞋面', {}, { details: ['无额外细节', '平跟', '低跟'] }),
  st('玛丽珍', 'mary janes', '现代', '鞋面', M, { details: ['无额外细节', '低跟', '平跟'] }),
  st('芭蕾平底', 'ballet flats', '现代', '鞋面', M, { details: ['无额外细节', '平跟'] }),
  st('细高跟鞋', 'high heels', '现代', '鞋面', MLF, { details: heeled }),
  st('绑带高跟鞋', 'lace-up high heels', '现代', '鞋面', MLF, { details: heeled }),
  st('厚底松糕鞋', 'platform shoes', '现代', '鞋面', {}, { details: ['无额外细节', '破损'] }),
  st('凉鞋', 'sandals', '现代', '鞋面', {}, { details: ['无额外细节', '平跟', '低跟', '绑带'] }),
  st('绑带凉鞋', 'strappy sandals', '现代', '鞋面', {}, { details: ['无额外细节', '平跟', '低跟', '高跟'] }),
  st('拖鞋', 'slippers', '现代', '鞋面', {}, { details: ['无额外细节', '平跟'] }),
  st('布履', 'cloth shoes', '东亚传统', '鞋面', {}, { details: flatish }),
  st('绣花布鞋', 'embroidered cloth shoes', '东亚传统', '鞋面', {}, { details: flatish }),
  st('草鞋', 'straw sandals', '东亚传统', '鞋面', {}, { details: flatish }),
  st('木屐', 'geta', '东亚传统', '鞋面', {}, { details: ['无额外细节', '木齿'] }),
  st('草履', 'zori', '东亚传统', '鞋面', {}, { details: flatish }),
  st('马丁靴', 'combat boots', '现代', '踝靴', {}, { details: ['无额外细节', '平跟', '厚底', '破损'] }),
  st('切尔西靴', 'chelsea boots', '现代', '踝靴', {}, { details: ['无额外细节', '低跟', '平跟'] }),
  st('尖头细跟短靴', 'pointed-toe ankle boots, stiletto heels', '现代', '踝靴', {}, { details: ['无额外细节', '高跟', '金属包头', '破损'] }),
  st('绑带短靴', 'lace-up ankle boots, vintage style', '西方历史', '踝靴', {}, { details: ['无额外细节', '平跟', '低跟', '皮革', '破损'] }),
  st('袜靴', 'sock boots, tight fitting, stretchy fabric', '现代', '踝靴', {}, { details: ['无额外细节', '高跟', '平跟'] }),
  st('长筒靴', 'knee-high boots', '西方历史', '中筒靴', {}, { details: ['无额外细节', '平跟', '低跟', '高跟'] }),
  st('骑士靴', 'riding boots', '西方历史', '中筒靴', {}, { details: ['无额外细节', '低跟', '高跟'] }),
  st('牛仔靴', 'cowboy boots, western style, embroidery', '现代', '中筒靴', {}, { details: ['无额外细节', '刺绣', '低跟', '平跟', '破损'] }),
  st('粗跟中筒靴', 'block heel mid-calf boots', '现代', '中筒靴', {}, { details: ['无额外细节', '低跟', '厚底', '破损'] }),
  st('堆堆靴', 'slouchy boots, wrinkled leather', '现代', '中筒靴', {}, { details: ['无额外细节', '皮革', '平跟', '破损'] }),
  st('流苏中筒靴', 'fringe mid-calf boots, tassels', '现代', '中筒靴', {}, { details: ['无额外细节', '皮革', '平跟', '低跟'] }),
  st('军靴', 'tactical boots', '幻想机能', '中筒靴', {}, { details: ['无额外细节', '金属包头', '发光', '破损'] }),
  st('雪地靴', 'snow boots', '现代', '中筒靴', {}, { details: flatish }),
  st('云头靴', 'cloud-toe boots', '东亚传统', '中筒靴', {}, { details: ['无额外细节', '平跟', '低跟'] }),
  st('过膝长靴', 'thigh-high boots', '现代', '过膝靴', {}, { details: ['无额外细节', '高跟', '平跟', '破损'] }),
  st('弹力过膝靴', 'stretch over-the-knee boots, tight fit', '现代', '过膝靴', {}, { details: ['无额外细节', '高跟', '平跟', '破损'] }),
  st('绑带过膝靴', 'lace-up thigh-high boots, corset lacing', '现代', '过膝靴', {}, { details: ['无额外细节', '高跟', '皮革', '破损'] }),
  st('翻折过膝靴', 'cuffed over-knee boots, folded top', '现代', '过膝靴', {}, { details: ['无额外细节', '高跟', '平跟', '破损'] }),
  st('亮面皮质长靴', 'patent leather thigh-high boots, glossy', '现代', '过膝靴', {}, { details: ['无额外细节', '高跟', '金属包头', '发光', '破损'] }),
  st('骑士长靴', 'tall riding boots, over the knee', '西方历史', '过膝靴', {}, { details: ['无额外细节', '低跟', '高跟', '皮革'] }),
  st('机甲战靴', 'mecha boots', '幻想机能', '过膝靴', {}, { details: ['无额外细节', '金属包头', '发光', '破损'] }),
  // 扩充：职业与舞台鞋款。
  st('护士鞋', 'nurse shoes', '制服职业', '鞋面', {}, { details: flatish }),
  st('舞蹈鞋', 'dance shoes', '现代', '鞋面', {}, { details: ['无额外细节', '平跟', '绑带'] }),
  st('雨靴', 'rain boots', '现代', '中筒靴', {}, { details: flatish }),
  st('消防靴', 'firefighter boots', '制服职业', '中筒靴', {}, { details: ['无额外细节', '金属包头', '破损'] }),
  st('体操鞋', 'gym shoes', '现代', '鞋面', {}, { details: flatish }),
];

const SOCK_SKELETONS = [
  sk('无'), sk('船袜'), sk('短袜'), sk('小腿袜'), sk('过膝袜'), sk('大腿袜（绝对领域）'),
];
const SOCK_LENGTH = {
  船袜: 'ankle socks', 短袜: 'socks', 小腿袜: 'calf socks', 过膝袜: 'over-the-knee socks', '大腿袜（绝对领域）': 'thighhighs',
};
const SOCK_STYLES = [
  st('常规', '', '现代', ['船袜', '短袜', '小腿袜', '过膝袜', '大腿袜（绝对领域）']),
  st('连裤袜', 'pantyhose', '现代', ['过膝袜', '大腿袜（绝对领域）'], M),
  st('吊带袜', 'garter stockings', '现代', ['过膝袜', '大腿袜（绝对领域）'], MLS, { forced: ['garter belt'] }),
  st('渔网袜', '', '现代', ['短袜', '小腿袜', '过膝袜', '大腿袜（绝对领域）'], MLS),
  st('破洞袜', 'torn socks', '现代', ['船袜', '短袜', '小腿袜', '过膝袜', '大腿袜（绝对领域）']),
  st('分趾足袋', 'tabi socks', '东亚传统', ['短袜', '小腿袜']),
  st('踩脚袜', 'stirrup socks', '现代', ['小腿袜', '过膝袜']),
  st('丝袜', 'sheer stockings', '现代', ['过膝袜', '大腿袜（绝对领域）'], {}, { details: ['无额外细节', '蕾丝边', '半透明薄透'] }),
  st('运动长袜', 'tube socks', '现代', ['小腿袜', '短袜']),
];

const SLOT_DEFS = {
  top: { skeletons: TOP_SKELETONS, styles: TOP_STYLES },
  bottom: { skeletons: BOTTOM_SKELETONS, styles: BOTTOM_STYLES },
  outerwear: { skeletons: OUTER_SKELETONS, styles: OUTER_STYLES },
  onePiece: { skeletons: ONE_SKELETONS, styles: ONE_STYLES },
  shoes: { skeletons: SHOE_SKELETONS, styles: SHOE_STYLES },
  socks: { skeletons: SOCK_SKELETONS, styles: SOCK_STYLES },
};

const DETAIL_TAG = {
  蕾丝花边: 'lace trim', 丝绸: 'silk', 薄纱: 'sheer fabric', 棉麻: 'linen', 毛呢: 'wool',
  皮革: 'leather', 破损: 'torn', 刺绣: 'embroidery', 发光线条: 'glowing lines',
  广袖: 'wide sleeves', 箭袖: 'arrow sleeves', 泡袖: 'puff sleeves', 连帽: 'hood', 高领: 'high collar',
  蕾丝边: 'lace trim', 堆堆袜: 'slouch socks', 半透明薄透: 'sheer', 泡泡袜: 'loose wool socks',
  条纹: 'striped', 绑带绕腿: 'leg ribbon',
  '8D': '8 denier, ultra sheer', '20D': '20 denier, sheer', '80D': '80 denier, semi-opaque',
  '100D': '100 denier, opaque', '120D': '120 denier, opaque', '200D': '200 denier, thick opaque',
  高开叉: 'high slit', 内衬安全裤: 'safety shorts under skirt',
  金属: 'metallic', 毛领: 'fur collar', 腰带: 'belt', 板甲: 'plate armor', 鳞甲: 'scale armor',
  锁子甲: 'chainmail', 平跟: 'flat heel', 低跟: 'low heel', 高跟: 'high heel', 厚底: 'platform sole',
  绑带: 'lace-up', 金属包头: 'metal toe', 发光: 'glowing', 木齿: 'wooden teeth',
};

const TOP_DETAILS = ['无额外细节', '蕾丝花边', '丝绸', '薄纱', '棉麻', '毛呢', '皮革', '破损', '刺绣', '发光线条', '广袖', '箭袖', '泡袖', '连帽', '高领'];
const BOTTOM_DETAILS = ['无额外细节', '蕾丝边', '丝绸', '牛仔', '皮革', '破损', '刺绣', '高开叉', '内衬安全裤', '金属'];
const OUTER_DETAILS = ['无额外细节', '连帽', '毛领', '腰带', '皮革', '金属', '薄纱', '丝绸', '毛呢', '刺绣', '破损', '发光线条'];
const ONE_DETAILS = ['无额外细节', '蕾丝花边', '丝绸', '薄纱', '刺绣', '高开叉', '破损', '发光线条', '板甲', '鳞甲', '锁子甲'];
const SOCK_DETAILS = ['无额外细节', '蕾丝边', '堆堆袜', '半透明薄透', '泡泡袜', '条纹', '绑带绕腿', '8D', '20D', '80D', '100D', '120D', '200D'];

const DETAIL_GATES = {
  半透明薄透: { male: 'hide' },
  蕾丝边: { male: 'hide' },
};

function gateOf(item, state) {
  const gates = item?.gates || {};
  if (state.gender === '男' && !state.crossdressing && gates.male) return 'hide';
  // 女角色不分年龄：不再按 loli / shoujo 隐藏或折叠任何衣物。
  return null;
}

function findStyle(slot, value) {
  return SLOT_DEFS[slot].styles.find((item) => item.value === value) || null;
}

function findSkeleton(slot, value) {
  return SLOT_DEFS[slot].skeletons.find((item) => item.value === value) || null;
}

// 「赤脚」不算空：它下面挂着足部装饰款式（脚链/足袋/绑带等），只有「无」才是真的不穿。
export function isEmptySkeleton(slot, skeleton) {
  return skeleton === '无' || !skeleton;
}

function onePieceWorn(state) {
  const piece = coercePiece('onePiece', state.onePiece);
  return !isEmptySkeleton('onePiece', piece.skeleton);
}

export function slotCovered(slot, state) {
  return (slot === 'top' || slot === 'bottom') && onePieceWorn(state);
}

const SKIRT_SKELETONS = new Set(['短裙', '及膝裙', '长裙', '曳地裙']);
const DRESS_SKELETONS = new Set(['及膝', '及踝', '曳地']);

// 是否穿着裙装（下装是裙子，或连体装是裙/长袍类）。用于过滤「提着裙摆」这类动作。
export function wearingSkirt(state) {
  const dress = coercePiece('onePiece', state.onePiece);
  if (!isEmptySkeleton('onePiece', dress.skeleton)) return DRESS_SKELETONS.has(dress.skeleton);
  const bottom = coercePiece('bottom', state.bottom);
  return SKIRT_SKELETONS.has(bottom.skeleton);
}

function styleTag(slot, style, skeleton) {
  if (slot === 'socks' && style.value === '常规') return SOCK_LENGTH[skeleton] || '';
  if (slot === 'socks' && style.value === '渔网袜') {
    return skeleton === '短袜' ? 'fishnet socks' : 'fishnets';
  }
  return style.tag || '';
}

function detailList(slot) {
  if (slot === 'top') return TOP_DETAILS;
  if (slot === 'bottom') return BOTTOM_DETAILS;
  if (slot === 'outerwear') return OUTER_DETAILS;
  if (slot === 'onePiece') return ONE_DETAILS;
  if (slot === 'socks') return SOCK_DETAILS;
  return [];
}

function detailAllowed(slot, piece, value, state) {
  if (value === '无额外细节') return gateOf({ gates: DETAIL_GATES[value] }, state) !== 'hide';
  if (gateOf({ gates: DETAIL_GATES[value] }, state) === 'hide') return false;
  const style = findStyle(slot, piece.style);
  if (style?.details) return style.details.includes(value);
  if (!detailList(slot).includes(value)) return false;
  return detailRule(slot, piece, value);
}

function detailRule(slot, piece, value) {
  const { skeleton, style } = piece;
  if (slot === 'socks') {
    if (skeleton === '船袜') return ['蕾丝边', '条纹'].includes(value);
    if (value === '堆堆袜') {
      return ['小腿袜', '过膝袜', '大腿袜（绝对领域）'].includes(skeleton) && ['常规', '破洞袜'].includes(style);
    }
    if (value === '泡泡袜') return ['小腿袜', '过膝袜'].includes(skeleton) && style === '常规';
    if (value === '半透明薄透' || value === '条纹') return style !== '渔网袜';
    if (value === '绑带绕腿') {
      return ['过膝袜', '大腿袜（绝对领域）'].includes(skeleton) && style !== '连裤袜';
    }
    // 「多少D」只属于过膝袜（骨架）与连裤袜（款式）：丹数决定丝袜薄厚与透明度。
    if (/^\d+D$/.test(value)) return skeleton === '过膝袜' || style === '连裤袜';
    return value === '蕾丝边';
  }
  if (slot === 'top') {
    if (value === '广袖' || value === '箭袖') return ['交领右衽襦', '对襟衫', '突尼克', '和服上着'].includes(style);
    if (value === '泡袖') return ['衬衫', '维多利亚罩衫', '赤古里'].includes(style);
    if (value === '连帽') return ['卫衣', '机能紧身衣'].includes(style);
    if (value === '皮革') return !['套头毛衣', '巫女白衣', '交领右衽襦'].includes(style);
    return true;
  }
  if (slot === 'bottom') {
    if (style === '机甲腿甲') return ['金属', '破损'].includes(value);
    if (value === '金属') return false;
    if (value === '高开叉') return ['长裙', '曳地裙'].includes(skeleton) && style !== '高开叉长裙';
    if (value === '内衬安全裤') return ['短裙', '及膝裙'].includes(skeleton);
    return true;
  }
  if (slot === 'outerwear') {
    if (['机甲外骨骼', '战术防弹衣'].includes(style)) return ['金属', '发光线条', '破损'].includes(value);
    if (style === '披帛') return ['丝绸', '薄纱', '刺绣'].includes(value);
    if (value === '连帽') return ['夹克', '机能风外套', '羽绒服', '斗篷', '披风'].includes(style);
    if (value === '毛领') return ['毛领大衣', '军大衣', '斗篷', '鹤氅'].includes(style);
    return true;
  }
  if (slot === 'onePiece') {
    if (style === '战甲') return ['板甲', '鳞甲', '锁子甲', '破损', '发光线条'].includes(value);
    if (['板甲', '鳞甲', '锁子甲'].includes(value)) return false;
    if (value === '高开叉') return ['旗袍', '晚礼服', '奥黛', '纱丽'].includes(style);
    return true;
  }
  return false;
}

function skeletonVisible(slot, value, state) {
  const item = findSkeleton(slot, value);
  if (!item) return false;
  return gateOf(item, state) !== 'hide';
}

function styleVisible(slot, value, state) {
  const item = findStyle(slot, value);
  if (!item) return false;
  return gateOf(item, state) !== 'hide';
}

export function isChoiceVisible(slot, part, value, state) {
  if (part === 'skeleton') return skeletonVisible(slot, value, state);
  if (part === 'style') return styleVisible(slot, value, state);
  if (part === 'detail') return detailAllowed(slot, { skeleton: '常规衣摆', style: '衬衫', ...state[slot] }, value, state);
  if (part === 'color') return CLOTHING_COLORS.some((item) => item.value === value);
  return false;
}

function compatibleStyles(slot, skeleton, state) {
  return SLOT_DEFS[slot].styles.filter((item) => item.skeletons.includes(skeleton) && styleVisible(slot, item.value, state));
}

function wornSkeleton(slot, state, avoid) {
  const skirts = new Set(['短裙', '及膝裙', '长裙', '曳地裙']);
  if (skirts.has(avoid) && skeletonVisible(slot, '长裤', state)) return '长裤';
  const found = SLOT_DEFS[slot].skeletons.find((item) => !isEmptySkeleton(slot, item.value)
    && skeletonVisible(slot, item.value, state)
    && compatibleStyles(slot, item.value, state).length);
  return found ? found.value : '无';
}

export function coercePiece(slot, value) {
  if (typeof value === 'string') return legacyPiece(slot, value);
  const base = defaultClothing()[slot];
  if (!value || typeof value !== 'object') return { ...base };
  return {
    skeleton: typeof value.skeleton === 'string' ? value.skeleton : base.skeleton,
    style: typeof value.style === 'string' ? value.style : base.style,
    detail: typeof value.detail === 'string' ? value.detail : '无额外细节',
    color: typeof value.color === 'string' ? value.color : '无',
    colorCustom: typeof value.colorCustom === 'string' ? value.colorCustom : '',
  };
}

function clearPiece(piece) {
  piece.style = '无';
  piece.detail = '无额外细节';
  piece.color = '无';
}

export function normalizeClothing(state) {
  for (const slot of CLOTHING_SLOTS) state[slot] = coercePiece(slot, state[slot]);
  for (const slot of CLOTHING_SLOTS) normalizeSlot(slot, state);
  if (!Array.isArray(state.outfitEffects)) state.outfitEffects = [];
  const torn = CLOTHING_SLOTS.some((slot) => state[slot].detail === '破损');
  state.outfitEffects = state.outfitEffects.filter((value) => !(torn && value === '全身战损'));
  return state;
}

function normalizeSlot(slot, state) {
  const piece = state[slot];
  if (!skeletonVisible(slot, piece.skeleton, state)) {
    piece.skeleton = wornSkeleton(slot, state, piece.skeleton);
  }
  if (isEmptySkeleton(slot, piece.skeleton)) {
    clearPiece(piece);
    return;
  }
  const styles = compatibleStyles(slot, piece.skeleton, state);
  if (!styles.some((item) => item.value === piece.style)) {
    if (styles.length) piece.style = styles[0].value;
    else {
      piece.skeleton = wornSkeleton(slot, state, piece.skeleton);
      const next = compatibleStyles(slot, piece.skeleton, state);
      if (!next.length) {
        piece.skeleton = '无';
        clearPiece(piece);
        return;
      }
      piece.style = next[0].value;
    }
  }
  if (!detailAllowed(slot, piece, piece.detail, state)) {
    const first = detailList(slot).find((value) => detailAllowed(slot, piece, value, state))
      || (findStyle(slot, piece.style)?.details || []).find((value) => detailAllowed(slot, piece, value, state))
      || '无额外细节';
    piece.detail = first;
  }
  if (!CLOTHING_COLORS.some((item) => item.value === piece.color)) piece.color = '无';
}

export function applyClothingSelection(state, slot, part, value) {
  const next = structuredClone(state);
  const piece = coercePiece(slot, next[slot]);
  if (part === 'skeleton') piece.skeleton = value;
  if (part === 'style') {
    const def = findStyle(slot, value);
    if (def && !def.skeletons.includes(piece.skeleton)) piece.skeleton = def.defaultSkeleton;
    piece.style = value;
  }
  if (part === 'detail') piece.detail = value;
  if (part === 'color') piece.color = value;
  next[slot] = piece;
  return next;
}

function hexColor(value) {
  return typeof value === 'string' && (/^#[0-9a-fA-F]{3}$/.test(value) || /^#[0-9a-fA-F]{6}$/.test(value));
}

function colorWord(piece, state) {
  if (!piece.color || piece.color === '无') return '';
  if (piece.color === '自定义') {
    if (!hexColor(piece.colorCustom)) return '';
    const key = piece.colorCustom.toLowerCase();
    return (state.colorNames || {})[key] || piece.colorCustom;
  }
  return COLOR_TAG[piece.color] || '';
}

function splitTerms(tag) {
  return String(tag).split(/,\s*/).map((term) => term.trim()).filter(Boolean);
}

export function clothingTerms(state) {
  const terms = [];
  const seen = new Set();
  const push = (term) => {
    for (const part of splitTerms(term)) {
      if (!seen.has(part)) {
        seen.add(part);
        terms.push(part);
      }
    }
  };
  const worn = onePieceWorn(state);
  for (const slot of CLOTHING_SLOTS) {
    if ((slot === 'top' || slot === 'bottom') && worn) continue;
    const piece = coercePiece(slot, state[slot]);
    if (slot === 'shoes' && piece.skeleton === '赤脚') {
      push('barefoot');
      // 足部装饰：纯赤脚自带 bare feet / natural toes / 趾甲，其余款式各自追加描述。
      const style = findStyle(slot, piece.style);
      if (style) {
        for (const part of splitTerms(styleTag(slot, style, piece.skeleton))) push(part);
        if (piece.detail !== '无额外细节' && detailAllowed(slot, piece, piece.detail, state)) {
          const tag = DETAIL_TAG[piece.detail] || '';
          if (tag) push(tag);
        }
      }
      continue;
    }
    if (isEmptySkeleton(slot, piece.skeleton)) continue;
    const style = findStyle(slot, piece.style);
    if (!style || !style.skeletons.includes(piece.skeleton)) continue;
    const main = styleTag(slot, style, piece.skeleton);
    const parts = splitTerms(main);
    const color = colorWord(piece, state);
    if (color && parts.length) parts[0] = `${color} ${parts[0]}`;
    for (const part of parts) push(part);
    if (piece.detail !== '无额外细节' && detailAllowed(slot, piece, piece.detail, state)) {
      const tag = piece.detail === '牛仔' ? 'denim' : (DETAIL_TAG[piece.detail] || '');
      if (tag) push(tag);
    }
    for (const forced of style.forced || []) push(forced);
    // 过膝靴骨架：靴筒长度是核心辨识特征。款式 tag（thigh-high boots / mecha boots）
    // 权重不足时模型常画成中筒靴，这里追加加权锚点把长度钉死。
    if (slot === 'shoes' && piece.skeleton === '过膝靴') {
      push('(thigh-high boots:1.3)');
      push('(over-knee boots:1.2)');
    }
    if (slot === 'socks' && piece.skeleton === '大腿袜（绝对领域）' && piece.style !== '连裤袜' && !worn) {
      const bottom = coercePiece('bottom', state.bottom);
      if (['短裙', '及膝裙'].includes(bottom.skeleton)) push('zettai ryouiki');
    }
  }
  return terms;
}

// ---------------- 连体装轮廓排除：别给露臂的连体款补袖子和裙摆 ----------------
// 每个键对应一组「正向锚点 + 排除词」。正向词描述真正想要的轮廓（贴身、露臂），
// 负向词直接点名模型爱加的那几件东西。
const NO_EXTRA_TERMS = {
  sleeves: {
    positive: ['(sleeveless:1.2)', 'bare arms', 'bare shoulders', 'sleeveless silhouette'],
    negative: [
      '(detached sleeves:1.4)', '(oversleeves:1.4)', '(sheer arm covers:1.3)',
      '(arm warmers:1.3)', '(sleeves attached with ribbons:1.2)',
    ],
  },
  skirt: {
    positive: ['single-piece bodysuit silhouette', 'high-cut leg openings'],
    negative: [
      '(overskirt:1.4)', '(half skirt:1.4)', '(back skirt panel:1.4)', '(skirt:1.3)',
      '(layered skirt:1.3)', '(bustle:1.3)', '(attached train:1.2)', '(peplum:1.2)',
    ],
  },
  cape: {
    // 正向不写 "no cape"：正向里的否定词模型常常反过来理解，只留一个形态锚点。
    positive: ['clean body-hugging silhouette'],
    negative: [
      '(cape:1.3)', '(back drape:1.3)', '(floaty fabric behind the body:1.3)',
      '(long trailing fabric:1.2)',
    ],
  },
};

// 按当前穿着的连体装款式返回 { positive, negative }。
// 外套的取舍：
//   ① 叠了外套（坎肩/短外套/长外套…）时，手臂被外套定义，不能再断言「无袖」，否则两边打架；
//   ② 外套是披挂类（斗篷/披风/披帛）时，后摆是用户自己要的，不能再排除 cape。
export function clothingExclusions(state) {
  const piece = coercePiece('onePiece', state.onePiece);
  if (isEmptySkeleton('onePiece', piece.skeleton)) return { positive: [], negative: [] };
  const style = findStyle('onePiece', piece.style);
  const drop = new Set((style && style.noExtra) || []);
  if (!drop.size) return { positive: [], negative: [] };
  const outer = coercePiece('outerwear', state.outerwear);
  if (!isEmptySkeleton('outerwear', outer.skeleton)) {
    drop.delete('sleeves');
    if (outer.skeleton === '披挂') drop.delete('cape');
  }
  const positive = [];
  const negative = [];
  for (const key of Object.keys(NO_EXTRA_TERMS)) {
    if (!drop.has(key)) continue;
    for (const tag of NO_EXTRA_TERMS[key].positive) if (!positive.includes(tag)) positive.push(tag);
    for (const tag of NO_EXTRA_TERMS[key].negative) if (!negative.includes(tag)) negative.push(tag);
  }
  return { positive, negative };
}

const FORCED_NOTE = {
  'garter belt': '已加上吊带腰带',
  petticoat: '已加上裙撑',
  obi: '已加上腰带',
};

export function clothingNotes(slot, state) {
  if (slotCovered(slot, state)) return ['连体装已覆盖上装和下装'];
  const notes = [];
  const piece = coercePiece(slot, state[slot]);
  const style = findStyle(slot, piece.style);
  if (style) {
    for (const forced of style.forced || []) {
      if (FORCED_NOTE[forced]) notes.push(FORCED_NOTE[forced]);
    }
  }
  if (slot === 'bottom' && piece.style === '齐胸褶裙') {
    const top = coercePiece('top', state.top);
    if (!onePieceWorn(state) && top.skeleton === '中长衣摆') notes.push('上装会挡住齐胸腰线');
  }
  if (slot === 'socks' && piece.skeleton === '大腿袜（绝对领域）' && piece.style !== '连裤袜' && !onePieceWorn(state)) {
    const bottom = coercePiece('bottom', state.bottom);
    if (['长裤', '长裙', '曳地裙'].includes(bottom.skeleton)) notes.push('下装挡住了绝对领域');
  }
  if (slot === 'socks') {
    const shoes = coercePiece('shoes', state.shoes);
    if (shoes.skeleton === '过膝靴' && ['过膝袜', '大腿袜（绝对领域）'].includes(piece.skeleton)) {
      notes.push('靴筒会挡住袜口');
    }
  }
  if (slot === 'shoes' && ['木屐', '草履'].includes(piece.style)) {
    const socks = coercePiece('socks', state.socks);
    if (socks.skeleton !== '无' && socks.style !== '分趾足袋') notes.push('传统搭配是足袋');
  }
  return notes;
}

function recommendedSet(slot, state) {
  return new Set((ROLE_RECOMMENDATIONS[state.role] || {})[slot] || []);
}

export function clothingView(slot, state) {
  const piece = coercePiece(slot, state[slot]);
  const covered = slotCovered(slot, state);
  const rec = recommendedSet(slot, state);
  if (covered) {
    return { disabled: true, notes: clothingNotes(slot, state), segments: [] };
  }
  const recOrder = (ROLE_RECOMMENDATIONS[state.role] || {})[slot] || [];
  const placeholders = [];
  const preferred = [];
  const rest = [];
  for (const item of SLOT_DEFS[slot].skeletons) {
    if (!skeletonVisible(slot, item.value, state)) continue;
    const entry = { value: item.value, recommended: rec.has(item.value) };
    if (item.value === '无') placeholders.push(entry);
    else if (entry.recommended) preferred.push(entry);
    else rest.push(entry);
  }
  preferred.sort((a, b) => recOrder.indexOf(a.value) - recOrder.indexOf(b.value));
  const skeletonOptions = [...placeholders, ...preferred, ...rest];
  const segments = [{ key: 'skeleton', label: '骨架', options: skeletonOptions }];
  if (!isEmptySkeleton(slot, piece.skeleton)) {
    const styles = SLOT_DEFS[slot].styles.filter((item) => styleVisible(slot, item.value, state));
    const compatible = new Set(styles.filter((item) => item.skeletons.includes(piece.skeleton)).map((item) => item.value));
    const grouped = new Map(GROUPS.map((label) => [label, []]));
    const featured = [];
    for (const item of styles) {
      const folded = gateOf(item, state) === 'fold';
      const entry = { value: item.value, folded, recommended: rec.has(item.value) };
      if (rec.has(item.value)) featured.push(entry);
      else if (compatible.has(item.value)) grouped.get(item.group).push(entry);
    }
    featured.sort((a, b) => recOrder.indexOf(a.value) - recOrder.indexOf(b.value));
    const groups = [];
    if (featured.length) groups.push({ label: '推荐', options: featured });
    for (const label of GROUPS) {
      if (grouped.get(label).length) groups.push({ label, options: grouped.get(label) });
    }
    segments.push({ key: 'style', label: '款式', groups });
    const details = (findStyle(slot, piece.style)?.details || detailList(slot))
      .filter((value) => detailAllowed(slot, piece, value, state))
      .map((value) => ({ value, recommended: rec.has(value) }));
    const colors = CLOTHING_COLORS.map((item) => ({ value: item.value }));
    segments.push({ key: 'detail', label: '细配', options: details, fine: true });
    // 赤脚是皮肤本色，不给颜色段（脚链/足袋的颜色已在款式描述里）。
    if (!(slot === 'shoes' && piece.skeleton === '赤脚')) {
      segments.push({ key: 'color', label: '颜色', options: colors, fine: true, swatch: true });
    }
  }
  return { disabled: false, notes: clothingNotes(slot, state), segments };
}

export function hasClothingOption(slot, value) {
  const def = SLOT_DEFS[slot];
  if (!def) return false;
  if (def.skeletons.some((item) => item.value === value)) return true;
  if (def.styles.some((item) => item.value === value)) return true;
  const details = new Set([
    ...detailList(slot),
    ...def.styles.flatMap((item) => item.details || []),
  ]);
  return details.has(value);
}

const LEGACY = {
  top: {
    T恤: piece('常规衣摆', 'T恤'),
    衬衫: piece('常规衣摆', '衬衫'),
    水手服上衣: piece('常规衣摆', '水手服上衣'),
    西装内搭: piece('常规衣摆', '西装内搭'),
    毛衣: piece('常规衣摆', '套头毛衣'),
    卫衣: piece('常规衣摆', '卫衣'),
    吊带: piece('胸衣短款', '吊带背心'),
    露脐装: piece('短衣摆', '露脐上衣'),
    抹胸: piece('胸衣短款', '抹胸'),
    制服内搭: piece('常规衣摆', '制服上衣'),
    汉服交领上襦: piece('常规衣摆', '交领右衽襦'),
    旗袍上衣: piece('常规衣摆', '旗袍式短上衣'),
    和服上衣: piece('中长衣摆', '和服上着'),
    巫女服白衣: piece('常规衣摆', '巫女白衣'),
    机能紧身衣: piece('常规衣摆', '机能紧身衣'),
    战术背心: piece('常规衣摆', '战术背心'),
    皮质胸衣: piece('胸衣短款', '皮质胸衣'),
    蕾丝内搭: piece('胸衣短款', '蕾丝吊带'),
    针织开衫: piece('常规衣摆', '衬衫'),
    斗篷内搭: piece('常规衣摆', '衬衫'),
  },
  bottom: {
    百褶裙: piece('及膝裙', '百褶裙'),
    包臀裙: piece('短裙', '包臀裙'),
    长裤: piece('长裤', '直筒长裤'),
    短裤: piece('短裤', '运动短裤'),
    牛仔裤: piece('长裤', '牛仔裤'),
    热裤: piece('热裤', '热裤'),
    阔腿裤: piece('长裤', '阔腿裤'),
    灯笼裤: piece('长裤', '灯笼裤'),
    马面裙: piece('长裙', '马面裙'),
    齐胸下裙: piece('曳地裙', '齐胸褶裙'),
    和服下裙: piece('长裙', '和服式长下摆'),
    巫女服绯袴: piece('及膝裙', '绯袴'),
    战术工装裤: piece('长裤', '工装裤'),
    机甲腿甲: piece('长裤', '机甲腿甲'),
    皮裤: piece('长裤', '皮裤'),
    蕾丝半裙: piece('短裙', '蕾丝半裙'),
    运动短裤: piece('短裤', '运动短裤'),
    打底裤: piece('长裤', '打底裤'),
    蓬蓬裙: piece('短裙', '蓬蓬裙'),
    高开叉长裙: piece('长裙', '高开叉长裙'),
  },
  outerwear: {
    无: emptyPiece(),
    西装外套: piece('短外套', '西装外套'),
    风衣: piece('中长外套', '风衣'),
    夹克: piece('短外套', '夹克'),
    针织开衫: piece('短外套', '针织开衫'),
    斗篷: piece('披挂', '斗篷'),
    军大衣: piece('中长外套', '军大衣'),
    披风: piece('披挂', '披风'),
    机能风外套: piece('短外套', '机能风外套'),
    汉服大袖衫: piece('长外套', '汉服大袖衫'),
    和风羽织: piece('中长外套', '羽织'),
    魔法师法袍: piece('长外套', '魔法师法袍'),
    战术防弹衣: piece('坎肩', '战术防弹衣'),
    机车皮衣: piece('短外套', '机车皮衣'),
    羽绒服: piece('中长外套', '羽绒服'),
    棒球服: piece('短外套', '棒球服'),
    马甲背心: piece('坎肩', '马甲背心'),
    薄纱罩衫: piece('坎肩', '薄纱罩衫'),
    机甲外骨骼: piece('长外套', '机甲外骨骼'),
    毛领大衣: piece('中长外套', '毛领大衣'),
  },
  onePiece: {
    无: emptyPiece(),
    连衣裙: piece('及膝', 'A字连衣裙'),
    洛丽塔洋装: piece('及膝', '甜系洛丽塔'),
    JK制服套装: piece('及膝', 'JK制服'),
    旗袍: piece('及踝', '旗袍'),
    和服: piece('及踝', '浴衣'),
    女仆装: piece('及膝', '女仆装'),
    战甲: piece('及踝', '战甲'),
    修女服: piece('及踝', '修女服'),
    汉服齐胸襦裙: piece('曳地', '齐胸襦裙'),
    汉服交领襦裙: piece('及踝', '交领襦裙'),
    晚礼服: piece('曳地', '晚礼服'),
    婚纱: piece('曳地', '婚纱'),
    连体紧身衣: piece('短连体', '连体紧身衣'),
    太空服: piece('及踝', '太空服'),
    泳装: piece('短连体', '一件式泳装'),
    白大褂: piece('及踝', '白大褂'),
    水手服连体裙: piece('及膝', '水手服连体裙'),
    哥特裙: piece('曳地', '哥特洛丽塔'),
    忍者夜行服: piece('及踝', '忍者夜行服'),
  },
  shoes: {
    运动鞋: piece('鞋面', '运动鞋', '平跟'),
    小皮鞋: piece('鞋面', '小皮鞋', '平跟'),
    马丁靴: piece('踝靴', '马丁靴', '平跟'),
    长筒靴: piece('中筒靴', '长筒靴', '平跟'),
    高跟鞋: piece('鞋面', '细高跟鞋', '高跟'),
    拖鞋: piece('鞋面', '拖鞋', '平跟'),
    赤脚: piece('赤脚', '无'),
    古风布鞋: piece('鞋面', '布履', '平跟'),
    日式木屐: piece('鞋面', '木屐', '木齿'),
    战术军靴: piece('中筒靴', '军靴', '无额外细节'),
    机甲战靴: piece('过膝靴', '机甲战靴'),
    玛丽珍鞋: piece('鞋面', '玛丽珍', '低跟'),
    绑带凉鞋: piece('鞋面', '绑带凉鞋', '平跟'),
    雪地靴: piece('中筒靴', '雪地靴', '平跟'),
    帆布鞋: piece('鞋面', '帆布鞋', '平跟'),
    骑士靴: piece('中筒靴', '骑士靴', '低跟'),
    绑带高跟鞋: piece('鞋面', '绑带高跟鞋', '高跟'),
    过膝长靴: piece('过膝靴', '过膝长靴', '高跟'),
    厚底松糕鞋: piece('鞋面', '厚底松糕鞋', '无额外细节'),
    光脚穿袜: piece('赤脚', '无'),
  },
  socks: {
    无: emptyPiece(),
    船袜: piece('船袜', '常规'),
    短袜: piece('短袜', '常规'),
    运动袜: piece('短袜', '常规'),
    小腿袜: piece('小腿袜', '常规'),
    长筒袜: piece('过膝袜', '常规'),
    过膝袜: piece('过膝袜', '常规'),
    绝对领域: piece('大腿袜（绝对领域）', '常规'),
    '连裤袜（黑丝/白丝）': piece('大腿袜（绝对领域）', '连裤袜', '半透明薄透', '黑'),
    渔网袜: piece('大腿袜（绝对领域）', '渔网袜'),
    破洞袜: piece('短袜', '破洞袜'),
    泡泡袜: piece('小腿袜', '常规', '泡泡袜'),
    堆堆袜: piece('小腿袜', '常规', '堆堆袜'),
    踩脚袜: piece('小腿袜', '踩脚袜'),
    吊带袜: piece('大腿袜（绝对领域）', '吊带袜'),
    吊带黑丝: piece('大腿袜（绝对领域）', '吊带袜', '半透明薄透', '黑'),
    '日式分趾袜（足袋）': piece('短袜', '分趾足袋'),
    条纹袜: piece('短袜', '常规', '条纹'),
    蕾丝袜: piece('短袜', '常规', '蕾丝边'),
    绑带袜: piece('大腿袜（绝对领域）', '常规', '绑带绕腿'),
  },
};

function legacyPiece(slot, value) {
  const found = LEGACY[slot][value];
  if (found) return { ...found };
  return { ...defaultClothing()[slot] };
}

const MATERIAL_DETAIL = {
  蕾丝花边: '蕾丝花边', 皮革: '皮革', 金属反光: '金属', '破损（战损）': '破损',
  半透明: '薄纱', 发光线条: '发光线条', 丝绸: '丝绸', 薄纱: '薄纱', 粗糙麻布: '棉麻',
};
const MATERIAL_EFFECT = {
  湿身效果: '湿身', '烧焦/灰烬': '烧焦灰烬', '流光/星尘': '流光星尘',
  霓虹反光: '霓虹反光', 玻璃质感: '玻璃质感',
};

function applyLegacyMaterials(next, materials) {
  const list = Array.isArray(materials) ? materials : [];
  const effects = [];
  let detail = '';
  for (const value of list) {
    if (MATERIAL_DETAIL[value] && !detail) detail = MATERIAL_DETAIL[value];
    if (MATERIAL_EFFECT[value]) effects.push(MATERIAL_EFFECT[value]);
    if (value === '毛绒' && next.outerwear.skeleton !== '无') next.outerwear.detail = '毛领';
    if (value === '手工编织') {
      if (next.top.style === '套头毛衣') next.top.detail = '毛呢';
      else if (next.outerwear.style === '针织开衫') next.outerwear.detail = '毛呢';
    }
    if (value === '鳞片' && next.onePiece.style === '战甲') next.onePiece.detail = '鳞甲';
    if (value === '重甲纹理' && next.onePiece.style === '战甲') next.onePiece.detail = '板甲';
  }
  if (detail) {
    const target = next.onePiece.skeleton !== '无' ? 'onePiece' : 'top';
    if (detail === '金属' && target === 'top') {
      if (next.outerwear.skeleton !== '无') next.outerwear.detail = '金属';
    } else if (detail === '薄纱' && target === 'top' && next.socks.skeleton !== '无' && list.includes('半透明')) {
      next.socks.detail = '半透明薄透';
    } else next[target].detail = detail === '薄纱' && next.socks.skeleton !== '无' && !next.top ? detail : detail;
  }
  next.outfitEffects = effects.slice(0, 2);
}

function applyLegacyColor(piece, color, custom) {
  if (!piece || isEmptySkeleton(piece.skeleton === '赤脚' ? 'shoes' : 'top', piece.skeleton) && piece.style === '无' && piece.skeleton !== '船袜') {
    if (piece.skeleton === '无' || piece.skeleton === '赤脚') return;
  }
  if (piece.skeleton === '无' || piece.skeleton === '赤脚') return;
  if (typeof color !== 'string' || color === '无' || color === '') return;
  piece.color = color;
  if (color === '自定义' && typeof custom === 'string') piece.colorCustom = custom;
}

export function migrateClothing(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const next = { ...raw };
  const legacy = CLOTHING_SLOTS.some((slot) => typeof next[slot] === 'string');
  if (legacy) {
    const original = raw;
    for (const slot of CLOTHING_SLOTS) {
      if (typeof next[slot] === 'string') next[slot] = legacyPiece(slot, next[slot]);
    }
    if (original.top === '针织开衫') next.outerwear = piece('短外套', '针织开衫');
    if (original.top === '斗篷内搭') next.outerwear = piece('披挂', '斗篷');
    if (original.shoes === '光脚穿袜' && next.socks.skeleton === '无') next.socks = piece('短袜', '常规');
    applyLegacyMaterials(next, original.materials);
    applyLegacyColor(next.shoes, original.shoesColor, original.shoesColorCustom);
    applyLegacyColor(next.socks, original.socksColor, original.socksColorCustom);
    if (!Array.isArray(next.outfitEffects)) next.outfitEffects = [];
  }
  for (const slot of CLOTHING_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(next, slot)) continue;
    next[slot] = coercePiece(slot, next[slot]);
  }
  return next;
}
