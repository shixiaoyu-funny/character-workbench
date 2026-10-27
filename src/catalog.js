// 选项目录：全部选项、标签、角色分组、颜色预设与色彩词表。
// 标签规则：无/人类/常规 的标签为空字符串；其余为规格指定的英文标签。

const o = (value, tag) => ({ value, tag });
const wu = () => o('无', '');

export const OPTIONS = {
  gender: [o('女', '1girl'), o('男', '1boy')],
  age: [
    o('小孩', 'child'), o('少年', 'boy'), o('青年', 'young man'), o('成年', 'adult man'),
    o('萝莉', 'loli'), o('少女', 'girl'), o('成女', 'adult woman'),
  ],
  race: [
    o('人类', ''), o('精灵耳', 'pointy ears'), o('兽耳（猫/犬/狐等）', 'animal ears'),
    o('魔族（角/尾巴）', 'demon horns, demon tail'), o('天使（光环/羽翼）', 'halo, angel wings'),
    o('亚人（人鱼/蛇身）', 'mermaid'), o('机械改造人', 'cyborg'), o('吸血鬼', 'vampire'),
  ],
  role: [
    o('日常休闲', 'casual'), o('学院制服', 'school uniform'), o('都市职场', 'office wear'),
    o('娱乐圈·偶像', 'idol'), o('悬疑·侦探', 'detective'), o('赛博朋克', 'cyberpunk'),
    o('西式奇幻（剑与魔法）', 'western fantasy'), o('东方古风（仙侠/武侠）', 'xianxia'),
    o('和风（阴阳师/妖怪）', 'japanese style'), o('蒸汽朋克', 'steampunk'),
    o('星际科幻（太空/机甲）', 'sci-fi mecha'), o('末世废土', 'wasteland'), o('异世界穿越', 'isekai'),
    o('哥特洛丽塔', 'gothic lolita'), o('地雷系·亚文化', 'jirai kei'),
    o('灵异·克苏鲁', 'cthulhu'), o('神话神明', 'deity'),
  ],
  faceShape: [
    o('圆脸（幼态）', 'round face'), o('鹅蛋脸（标准）', 'oval face'),
    o('瓜子脸·尖脸（清冷）', 'sharp chin'), o('肉肉脸（可爱）', 'chubby face'),
    o('方脸·硬朗（偏男性）', 'square jaw'),
  ],
  eyeShape: [
    o('杏眼（标准）', 'tapered eyes'), o('圆眼（天真）', 'round eyes'),
    o('上挑眼（凌厉·魅惑）', 'tsurime'), o('下垂眼（无辜·狗狗眼）', 'tareme'),
    o('半眯眼（慵懒）', 'half-closed eyes'), o('死鱼眼（呆板）', 'dead eyes'),
    o('星星眼（高光拉满）', 'sparkling eyes'),
  ],
  pupil: [
    o('圆形瞳', 'round pupils'), o('猫瞳·竖瞳（兽人/恶魔）', 'slit pupils'),
    o('无高光（病娇/三无）', 'empty eyes'), o('异色瞳（左红右蓝等可配）', 'heterochromia'),
  ],
  eyebrow: [
    o('细平眉', 'thin eyebrows'), o('粗平眉', 'thick eyebrows'), o('柳叶眉', 'arched eyebrows'),
    o('剑眉（英气）', 'sharp eyebrows'), o('八字眉（委屈）', 'sad eyebrows'), o('挑眉（傲娇）', 'raised eyebrow'),
  ],
  mouth: [
    o('樱桃小嘴', 'small mouth'), o('猫唇（M字唇）', 'cat lips'), o('薄唇', 'thin lips'),
    o('厚唇', 'thick lips'), o('嘴角上扬（默认微笑）', 'slight smile'),
  ],
  nose: [o('小翘鼻（默认）', 'small nose'), o('直挺鼻（成熟）', 'straight nose')],
  facialFeatures: [
    o('泪痣', 'mole under eye'), o('雀斑', 'freckles'), o('虎牙（单颗/双颗）', 'fang'),
    o('小虎牙', 'small fang'), o('面部纹身（可选位置）', 'face tattoo'),
    o('创可贴（鼻梁/脸颊）', 'bandaid on face'), o('眼镜（圆框/方框/金丝）', 'glasses'),
  ],
  skin: [
    o('冷白皮', 'pale skin'), o('自然肤色', 'natural skin'), o('小麦色', 'tanned skin'),
    o('黑皮', 'dark skin'), o('特殊肤色（精灵白/恶魔灰/病态苍白）', 'fantasy skin'),
  ],
  hairLength: [
    o('短发', 'short hair'), o('及肩发', 'shoulder-length hair'), o('中长发', 'medium hair'),
    o('及腰长发', 'hair over waist'), o('超长拖地发', 'floor-length hair'),
  ],
  hairStyle: [
    o('直发', 'straight hair'), o('微卷', 'slightly wavy hair'), o('大波浪', 'wavy hair'),
    o('双马尾（高/低）', 'twintails'), o('单侧马尾', 'side ponytail'), o('丸子头', 'hair bun'),
    o('麻花辫', 'braid'), o('披肩发', 'hair over shoulders'), o('姬发式', 'hime cut'),
    o('狼尾（Mullet）', 'mullet'), o('碎发', 'messy hair'), o('大背头', 'slicked back hair'),
    o('飞机头', 'pompadour'),
  ],
  bangs: [
    o('齐刘海（一刀平）', 'blunt bangs'), o('空气刘海', 'air bangs'), o('中分', 'center part'),
    o('八字刘海', 'parted bangs'), o('斜刘海', 'side-swept bangs'), o('无刘海（露额头）', 'no bangs'),
  ],
  hairColor: [
    o('黑', 'black hair'), o('白', 'white hair'), o('银', 'silver hair'), o('金', 'blonde hair'),
    o('粉', 'pink hair'), o('蓝', 'blue hair'), o('红', 'red hair'), o('紫', 'purple hair'),
    o('绿', 'green hair'), o('棕', 'brown hair'),
  ],
  hairColorExtra: [o('挑染', 'streaked hair'), o('渐变发色', 'gradient hair')],
  blush: [
    wu(), o('轻微（眼下微红）', 'light blush'), o('重度（全脸通红）', 'heavy blush'),
    o('横向腮红（微醺/醉酒）', 'drunk blush'), o('晒伤妆（鼻梁横跨）', 'sunburn'),
  ],
  eyeMakeup: [
    o('眼影（可选颜色）', 'eyeshadow'), o('睫毛拉长', 'long eyelashes'),
    o('浓密睫毛', 'thick eyelashes'), o('卧蚕', 'aegyo sal'), o('泪光', 'teary eyes'),
    o('眼线（上挑猫眼/下垂无辜眼）', 'eyeliner'),
  ],
  lipstick: [
    o('自然色', 'natural lips'), o('咬唇妆（渐变）', 'gradient lips'),
    o('亮面唇釉（水润）', 'glossy lips'), o('哑光口红', 'matte lipstick'),
    o('唇彩颜色可选', 'lip gloss'),
  ],
  specialMakeup: [
    wu(), o('脸颊创可贴', 'bandaid on cheek'), o('鼻梁创可贴', 'bandaid on nose'),
    o('绷带', 'bandage on face'), o('面部彩绘（可选图案）', 'face paint'),
    o('眼泪（大哭/抽泣）', 'crying'),
  ],
  top: [
    o('T恤', 't-shirt'), o('衬衫', 'shirt'), o('水手服上衣', 'serafuku'),
    o('西装内搭', 'dress shirt'), o('毛衣', 'sweater'), o('卫衣', 'hoodie'),
    o('吊带', 'camisole'), o('露脐装', 'crop top'), o('抹胸', 'tube top'),
    o('制服内搭', 'uniform top'),
  ],
  bottom: [
    o('百褶裙', 'pleated skirt'), o('包臀裙', 'tight skirt'), o('长裤', 'pants'),
    o('短裤', 'shorts'), o('牛仔裤', 'jeans'), o('热裤', 'hot pants'),
    o('阔腿裤', 'wide-leg pants'), o('灯笼裤', 'lantern pants'),
  ],
  outerwear: [
    wu(), o('西装外套', 'suit jacket'), o('风衣', 'trench coat'), o('夹克', 'jacket'),
    o('针织开衫', 'cardigan'), o('斗篷', 'cape'), o('军大衣', 'military coat'),
    o('披风', 'cloak'), o('机能外套', 'techwear jacket'),
  ],
  onePiece: [
    wu(), o('连衣裙', 'dress'), o('洛丽塔洋装', 'lolita fashion'), o('JK制服套装', 'jk uniform'),
    o('旗袍', 'qipao'), o('和服', 'kimono'), o('女仆装', 'maid outfit'),
    o('战甲', 'armor'), o('修女服', 'nun outfit'),
  ],
  shoes: [
    o('运动鞋', 'sneakers'), o('小皮鞋', 'leather shoes'), o('马丁靴', 'boots'),
    o('长筒靴', 'knee boots'), o('高跟鞋', 'high heels'), o('拖鞋', 'slippers'),
    o('赤脚（需谨慎）', 'barefoot'),
  ],
  socks: [
    wu(), o('短袜', 'socks'), o('小腿袜', 'calf socks'), o('过膝袜（绝对领域）', 'thighhighs'),
    o('连裤袜（黑丝/白丝）', 'pantyhose'), o('渔网袜', 'fishnet'), o('泡泡袜', 'bubble socks'),
  ],
  materials: [
    o('蕾丝花边', 'lace'), o('皮革', 'leather'), o('金属反光', 'metallic'),
    o('破损（战损）', 'torn clothes'), o('半透明（需谨慎）', 'translucent clothes'),
    o('发光线条', 'glowing lines'),
  ],
  hat: [
    wu(), o('贝雷帽', 'beret'), o('鸭舌帽·棒球帽', 'baseball cap'), o('草帽', 'straw hat'),
    o('巫师帽', 'witch hat'), o('兜帽', 'hood'), o('军帽', 'military cap'), o('警帽', 'police cap'),
    o('护士帽', 'nurse cap'), o('女仆头饰', 'maid headdress'), o('圣诞帽', 'santa hat'),
    o('安全头盔·机甲头盔', 'helmet'),
  ],
  feminineAccessories: [
    wu(), o('蝴蝶结（大/小）', 'hair bow'), o('发带', 'hair ribbon'),
    o('发箍（蕾丝/女仆）', 'headband'), o('发卡（十字/星星/心形）', 'hairpin'),
    o('发簪·步摇（古风）', 'hair stick'), o('花环（森系）', 'flower wreath'),
    o('运动发带', 'sweatband'), o('护额（忍者/运动）', 'forehead protector'),
    o('头戴式耳机（电竞/赛博）', 'headphones'), o('战术护目镜', 'goggles'),
    o('单片眼镜（复古）', 'monocle'), o('绷带（战损缠头）', 'head bandage'),
  ],
  masculineAccessories: [
    wu(), o('运动发带', 'sweatband'), o('护额（忍者/运动）', 'forehead protector'),
    o('头戴式耳机（电竞/赛博）', 'headphones'), o('战术护目镜', 'goggles'),
    o('单片眼镜（复古）', 'monocle'), o('绷带（战损缠头）', 'head bandage'),
  ],
  fantasyAccessories: [
    wu(), o('皇冠（小/大）', 'crown'), o('光环（天使）', 'halo'),
    o('恶魔角（双角/独角/弯角）', 'demon horns'),
    o('兽耳（猫/狐/兔/犬，若种族未选可在此叠加）', 'animal ears'),
    o('精灵尖耳（若未选）', 'pointy ears'), o('面具（半脸/舞会）', 'mask'),
    o('眼罩（单眼/双眼）', 'eyepatch'),
  ],
  faceNeck: [
    wu(), o('圆框眼镜', 'round glasses'), o('方框眼镜', 'rectangular glasses'),
    o('金丝眼镜', 'rimless glasses'), o('口罩', 'mask'), o('面纱', 'veil'),
    o('Choker项链', 'choker'), o('领带', 'necktie'), o('领结', 'bowtie'),
  ],
  handsBack: [
    wu(), o('手套（半指/全指）', 'gloves'), o('戒指', 'ring'), o('手链', 'bracelet'),
    o('翅膀（天使/恶魔/机械）', 'wings'), o('披风绑带', 'cape strap'),
    o('机械臂', 'cybernetic arm'), o('纹身（手臂）', 'arm tattoo'),
  ],
  handheld: [
    wu(), o('书本', 'holding book'), o('法杖', 'holding staff'), o('长剑', 'holding sword'),
    o('匕首', 'holding dagger'), o('枪械', 'holding gun'), o('雨伞', 'holding umbrella'),
    o('扇子', 'holding fan'), o('玩偶', 'holding doll'), o('捧花', 'holding bouquet'),
    o('咖啡杯', 'holding coffee'), o('手机', 'holding phone'),
  ],
  pose: [
    o('站立', 'standing'), o('坐姿', 'sitting'), o('躺姿', 'lying'), o('趴姿', 'lying on stomach'),
    o('蹲姿', 'squatting'), o('跪姿', 'kneeling'), o('行走中', 'walking'),
    o('奔跑中', 'running'), o('跳跃中', 'jumping'),
  ],
  handPose: [
    o('自然下垂', 'arms at sides'), o('单手叉腰', 'hand on hip'), o('双手抱胸', 'arms crossed'),
    o('单手摸脸·托腮', 'hand on own cheek'), o('比耶(V)', 'v sign'), o('挥手', 'waving'),
    o('双手背后', 'arms behind back'), o('提着裙摆', 'holding skirt'),
    o('持物（配合道具）', 'holding item'),
  ],
  headDirection: [
    o('正面平视', 'looking at viewer'), o('侧脸(微侧)', 'from side'),
    o('回眸(回头看)', 'looking back'), o('低头', 'looking down'), o('仰头', 'looking up'),
  ],
  gazes: [
    o('看着镜头', 'looking at viewer'), o('看向侧方', 'looking to the side'),
    o('闭眼', 'closed eyes'), o('眼神向别处飘（傲娇/走神）', 'looking away'),
  ],
  eyeEmotions: [
    o('开心(弯眼)', 'happy'), o('生气(皱眉)', 'angry'), o('嫌弃(半眯眼)', 'half-closed eyes'),
    o('惊讶(瞪大)', 'surprised'), o('悲伤(下垂)', 'sad'), o('冷漠(无神)', 'expressionless'),
  ],
  mouthStates: [
    o('微笑', 'smile'), o('大笑(张嘴)', 'open mouth'), o('撇嘴(嫌弃)', 'frown'),
    o('嘟嘴(生气/可爱)', 'pout'), o('抿嘴(紧张)', 'clenched mouth'), o('吐舌(调皮)', 'tongue out'),
  ],
  effectSymbols: [
    wu(), o('汗滴', 'sweatdrop'), o('青筋(生气)', 'anger vein'), o('爱心', 'heart'),
    o('星星眼(已选可忽略)', 'sparkling eyes'), o('泪滴(委屈)', 'teardrop'),
  ],
  shot: [
    o('全身像', 'full body'), o('半身像(大腿以上)', 'upper body'),
    o('特写(胸部以上)', 'portrait'), o('大头贴(Q版专用)', 'chibi head'),
  ],
  camera: [
    o('平视(默认)', 'eye level'), o('俯视(从高往下看)', 'from above'),
    o('仰视(从下往上看)', 'from below'), o('广角(带透视感)', 'dynamic angle'),
  ],
  background: [
    o('纯色背景(可自选颜色)', 'simple background'), o('透明背景', 'transparent background'),
    o('教室', 'classroom'), o('城市街道', 'city street'), o('咖啡馆', 'cafe'),
    o('奇幻森林', 'fantasy forest'), o('赛博霓虹街', 'neon street'), o('废墟', 'ruins'),
    o('卧室', 'bedroom'), o('星空', 'starry sky'), o('王座', 'throne'),
  ],
  lighting: [
    o('默认柔光', 'soft lighting'), o('逆光(唯美)', 'backlighting'),
    o('顶光(压抑/戏剧性)', 'top lighting'), o('霓虹光(赛博感)', 'neon lighting'),
    o('暖色调(黄昏/温馨)', 'warm lighting'), o('冷色调(清冷/悬疑)', 'cold lighting'),
  ],
  visualEffects: [
    wu(), o('樱花飘落', 'falling petals'), o('雪花', 'snow'), o('萤火虫', 'fireflies'),
    o('下雨', 'rain'), o('光斑', 'bokeh'), o('速度线(战斗感)', 'speed lines'),
    o('魔法粒子', 'glowing particles'),
  ],
};

export const ROLE_GROUPS = [
  {
    label: '现代都市',
    options: ['日常休闲', '学院制服', '都市职场', '娱乐圈·偶像', '悬疑·侦探', '赛博朋克'],
  },
  {
    label: '古典幻想',
    options: ['西式奇幻（剑与魔法）', '东方古风（仙侠/武侠）', '和风（阴阳师/妖怪）', '蒸汽朋克'],
  },
  { label: '科幻末日', options: ['星际科幻（太空/机甲）', '末世废土', '异世界穿越'] },
  { label: '亚文化与特殊', options: ['哥特洛丽塔', '地雷系·亚文化', '灵异·克苏鲁', '神话神明'] },
];

const preset = (id, group, name, main, accent, tags, swatch) =>
  ({ id, group, name, main, accent, tags, swatch });

export const PRESETS = [
  preset('classic-black-red', '经典学院与日常', '经典黑红白', ['黑', '红'], ['白', '灰'],
    ['black skirt', 'red ribbon', 'white shirt'], ['#1a1a1a', '#f5f5f5']),
  preset('navy-white', '经典学院与日常', '藏青与白', ['藏青', '白'], ['浅灰', '浅蓝'],
    ['navy blue serafuku', 'white collar'], ['#1f2f4e', '#cccccc']),
  preset('oat-coffee', '经典学院与日常', '燕麦暖咖', ['卡其', '浅棕'], ['白', '米色'],
    ['beige cardigan', 'brown skirt', 'white shirt'], ['#c3b091', '#ffffff']),
  preset('black-white', '经典学院与日常', '黑白极简', ['黑', '白'], ['银', '灰'],
    ['black suit', 'white shirt', 'monochrome'], ['#111111', '#c0c0c0']),
  preset('sakura', '甜美与马卡龙', '樱花草莓', ['浅粉'], ['白', '红'],
    ['pastel pink dress', 'white lace', 'strawberry motif'], ['#ffb7d5', '#ffffff']),
  preset('mint', '甜美与马卡龙', '薄荷奶油', ['薄荷绿'], ['白', '浅黄'],
    ['mint green clothes', 'white accent'], ['#a8e6cf', '#ffffff']),
  preset('taro', '甜美与马卡龙', '香芋星云', ['浅紫'], ['粉', '白'],
    ['pastel purple hair', 'pink and white dress'], ['#d5c7f0', '#ffc0cb']),
  preset('lemon', '甜美与马卡龙', '柠檬苏打', ['鹅黄'], ['白', '浅蓝'],
    ['yellow sundress', 'light blue bow'], ['#fff2a8', '#ffffff']),
  preset('night-rose', '暗黑与哥特', '暗夜玫瑰', ['纯黑'], ['暗红', '银'],
    ['black gothic dress', 'dark red accents', 'silver cross'], ['#0a0a0a', '#8b0000']),
  preset('abyss', '暗黑与哥特', '黑紫深渊', ['黑'], ['紫', '深灰'],
    ['black clothes', 'purple trim', 'dark fantasy'], ['#0a0a0a', '#6c2fa0']),
  preset('maid-classic', '暗黑与哥特', '黑白女仆', ['黑'], ['白', '蕾丝'],
    ['black maid outfit', 'white apron', 'frills'], ['#0a0a0a', '#ffffff']),
  preset('dark-gold', '暗黑与哥特', '暗金权贵', ['深绿', '黑'], ['金', '暗黄'],
    ['dark green suit', 'gold embroidery'], ['#0e3a2a', '#c9a227']),
  preset('neon-city', '赛博与机能', '霓虹夜城', ['黑', '灰'], ['荧光绿', '荧光粉'],
    ['black techwear', 'neon green glowing lines'], ['#111111', '#39ff14']),
  preset('cyber-blue', '赛博与机能', '赛博蓝核', ['白', '银'], ['亮蓝', '青色'],
    ['white mecha suit', 'cyan glowing', 'cybernetic'], ['#f0f0f0', '#1e90ff']),
  preset('rust', '赛博与机能', '废土锈迹', ['棕', '沙色'], ['深灰', '生锈红'],
    ['wasteland clothes', 'brown jacket', 'rust color'], ['#8a5a2b', '#4a4a4a']),
  preset('brass', '赛博与机能', '蒸汽黄铜', ['深棕'], ['黄铜', '暗金'],
    ['steampunk outfit', 'brown leather', 'brass goggles'], ['#3e2612', '#b08d3f']),
  preset('ink-blue', '古风与东方奇幻', '水墨青花', ['白', '青'], ['黑', '墨蓝'],
    ['white hanfu', 'blue patterns', 'ink wash style'], ['#f8f8f2', '#111111']),
  preset('red-gold', '古风与东方奇幻', '红妆锦绣', ['朱红'], ['金', '黑'],
    ['red hanfu', 'gold embroidery', 'elegant'], ['#c3272b', '#d4af37']),
  preset('bamboo', '古风与东方奇幻', '竹影幽篁', ['竹绿'], ['白', '墨黑'],
    ['green kimono', 'bamboo motifs', 'black obi'], ['#4e7a45', '#ffffff']),
  preset('miko', '古风与东方奇幻', '和风樱火', ['红', '白'], ['黑', '金'],
    ['red and white miko outfit', 'traditional japanese'], ['#e0301e', '#1a1a1a']),
  preset('holy', '神圣与奇幻', '圣洁白金', ['纯白'], ['金', '浅黄'],
    ['white robe', 'gold trim', 'holy aura'], ['#ffffff', '#d4af37']),
  preset('galaxy', '神圣与奇幻', '星空灰蓝', ['深蓝'], ['银', '白'],
    ['dark blue cloak', 'silver stars', 'galaxy texture'], ['#1b2a5e', '#c0c0c0']),
  preset('forest', '神圣与奇幻', '自然森绿', ['橄榄绿'], ['棕', '浅绿'],
    ['green tunic', 'brown leather', 'elf ranger'], ['#6b8e23', '#7a5230']),
  preset('blood-gold', '神圣与奇幻', '血族黑金', ['黑'], ['暗金', '血红'],
    ['black elegant suit', 'gold accents', 'dark aura'], ['#0a0a0a', '#b8860b']),
];
export const COLOR_WORDS = {
  '黑': 'black', '红': 'red', '白': 'white', '纯白': 'white', '灰': 'gray', '藏青': 'navy blue',
  '浅灰': 'light gray', '浅蓝': 'light blue', '卡其': 'khaki', '浅棕': 'light brown',
  '米色': 'beige', '银': 'silver', '浅粉': 'pastel pink', '薄荷绿': 'mint green',
  '浅黄': 'light yellow', '浅紫': 'pastel purple', '粉': 'pink', '鹅黄': 'light yellow',
  '纯黑': 'black', '暗红': 'dark red', '紫': 'purple', '深灰': 'dark gray',
  '深绿': 'dark green', '金': 'gold', '暗黄': 'dark yellow', '荧光绿': 'neon green',
  '荧光粉': 'neon pink', '亮蓝': 'bright blue', '青色': 'cyan', '棕': 'brown',
  '沙色': 'sand', '生锈红': 'rust', '深棕': 'dark brown', '黄铜': 'brass',
  '暗金': 'dark gold', '青': 'blue', '墨蓝': 'ink blue', '朱红': 'vermilion',
  '竹绿': 'bamboo green', '墨黑': 'ink black', '橄榄绿': 'olive green',
  '浅绿': 'light green', '血红': 'blood red', '深蓝': 'dark blue', '蕾丝': 'lace',
};

export const FACE_FIELDS = [
  'faceShape', 'eyeShape', 'pupil', 'eyebrow', 'mouth', 'nose',
  'facialFeatures', 'skin', 'blush', 'eyeMakeup', 'lipstick', 'specialMakeup',
];

export const ASPECT_OPTIONS = {
  baseAspect: ['3:4', '9:16', '1:1'],
  turnaroundAspect: ['16:9', '3:2'],
  clothingAspect: ['1:1', '4:3'],
};

// 预设作为 colorPreset 的选项：空字符串表示未选预设。
OPTIONS.colorPreset = [o('', ''), ...PRESETS.map((p) => o(p.id, p.tags.join(', ')))];

// 主色/辅色选项由中文色名词表生成，标签是英文色名。
OPTIONS.mainColors = Object.entries(COLOR_WORDS).map(([value, tag]) => o(value, tag));
OPTIONS.accentColors = OPTIONS.mainColors.map((entry) => ({ ...entry }));
