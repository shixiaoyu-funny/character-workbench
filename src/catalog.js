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
    o('女仆·家政', 'maid'), o('医疗·护理', 'nurse'), o('教师·学者', 'teacher'),
    o('军警·执法', 'military uniform, police'), o('运动竞技', 'athlete'),
    o('舞台表演', 'stage performer'),
    o('消防·救援', 'firefighter'), o('航空·飞行', 'pilot, flight attendant'),
    o('餐饮·服务', 'waiter, chef'),
  ],
  faceShape: [
    o('圆脸（幼态）', 'round face'), o('鹅蛋脸（标准）', 'oval face'),
    o('瓜子脸·尖脸（清冷）', 'sharp chin'), o('肉肉脸（可爱）', 'chubby face'),
    o('方脸·硬朗（偏男性）', 'square jaw'),
  ],
  eyeShape: [
    o('杏眼（标准）', 'almond eyes'), o('圆眼（天真）', 'round eyes'),
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
    o('绿', 'green hair'), o('棕', 'brown hair'), o('自定义', ''),
  ],
  hairColorExtra: [wu(), o('挑染', 'streaked hair'), o('渐变发色', 'gradient hair')],
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
  outfitEffects: [
    o('湿身', 'wet clothes'), o('烧焦灰烬', 'burnt clothes'), o('流光星尘', 'flowing stardust'),
    o('霓虹反光', 'neon reflective'), o('玻璃质感', 'glass texture'), o('全身战损', 'torn clothes'),
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
    o('枕头', 'holding pillow'), o('毛毯', 'holding blanket'), o('背包', 'holding backpack'),
  ],
  pose: [
    o('站立', 'standing'),
    o('跷二郎腿', 'sitting with legs crossed'), o('正坐', 'sitting upright'),
    o('平躺', 'lying flat on back'), o('侧躺', 'lying on side'),
    o('平趴', 'lying flat on stomach'), o('小腿交叉趴着', 'lying on stomach with calves crossed'),
    o('蹲姿', 'squatting'), o('跪姿', 'kneeling'), o('行走中', 'walking'),
    o('奔跑中', 'running'), o('跳跃中', 'jumping'),
  ],
  handPose: [
    o('自然下垂', 'arms at sides'), o('单手叉腰', 'hand on hip'), o('双手抱胸', 'arms crossed'),
    o('双手背后', 'arms behind back'), o('单手摸脸·托腮', 'hand on own cheek'), o('比耶(V)', 'v sign'),
    o('挥手', 'waving'), o('单手提着裙摆', 'holding skirt in one hand'), o('手插口袋', 'hand in pocket'),
    o('双手合十', 'hands clasped'), o('撩拨头发', 'playing with hair'), o('摊开双手', 'arms spread'),
    o('单手捂脸', 'hand over face'), o('握拳', 'clenched fist'), o('双手放腿上', 'hands on lap'),
    o('单手撑地', 'one hand on the ground'), o('抱膝', 'hugging knees'),
    o('双手枕在脑后', 'hands behind head'), o('盘腿', 'cross-legged'), o('托下巴', 'hand on chin'),
    o('拨弄头发', 'twirling hair'), o('撑着下巴发呆', 'resting chin on hand'),
    o('双手放腹部', 'hands on stomach'), o('单手放身侧', 'arm at side'),
    o('单手向上伸', 'one arm raised'), o('双手交叉放胸前', 'arms crossed over chest'),
    o('侧身单手撑头', 'head resting on one hand'), o('抱枕头', 'hugging pillow'),
    o('双手撑地', 'both hands on the ground'), o('双手托下巴', 'chin resting on both hands'),
    o('单手向前伸', 'one arm reaching forward'), o('双手放在胸前', 'hands on chest'),
    o('单手肘撑地', 'propped on one elbow'), o('双手垫在脸下', 'face resting on hands'),
    o('单手玩头发', 'playing with own hair'), o('双手举起', 'both arms raised'),
    o('双手抱膝', 'hugging own knees'), o('双手放膝盖', 'hands on knees'),
    o('单手扶额', 'hand on forehead'), o('抱着膝盖发呆', 'hugging knees, staring blankly'),
    o('祈祷', 'praying hands'), o('单手抚摸地面', 'hand touching the ground'),
    o('单手扶帽檐', 'hand on hat brim'), o('整理领带', 'adjusting necktie'),
    o('双手插兜', 'hands in pockets'),
    o('单手前伸', 'one hand reaching forward'), o('向前伸出手', 'reaching forward'),
    o('手放在胸前', 'hand on chest'), o('双手张开', 'arms open'), o('双手向上伸', 'both arms up'),
    // 扩充：日常、职业、情绪与躺坐场景的手部动作。
    o('双手交叠放在身前', 'hands clasped in front'), o('手指点脸颊', 'finger to cheek'),
    o('手指抵下巴思考', 'finger to chin'), o('单手背在身后', 'arm behind back'),
    o('单手整理袖口', 'adjusting sleeve'), o('单手拉衣领', 'adjusting collar'),
    o('单手摸后颈', 'hand on own neck'), o('单手扶眼镜', 'adjusting glasses'),
    o('双手握拳放身侧', 'fists at sides'), o('单手扶墙', 'leaning against wall'),
    o('单手竖起大拇指', 'thumbs up'), o('单手扶扶手', 'hand on armrest'),
    o('单手撑在桌上', 'hand on table'), o('手肘撑在桌上托腮', 'chin resting on hand, elbow on table'),
    o('双手放在桌面上', 'hands on table'), o('双手撑在身后', 'leaning back on hands'),
    o('单手撑在身侧', 'leaning on one hand'), o('双手抓住毯子', 'holding blanket'),
    o('双手交握放在腹部', 'hands folded on stomach'), o('双手捧脸', 'hands on own cheeks'),
    o('双手捂耳朵', 'covering ears'), o('单手捂嘴', 'hand over own mouth'),
    o('双手捂嘴', 'hands over own mouth'), o('单手遮眼', 'hand over own eye'),
    o('双臂环抱自己', 'hugging own arms'), o('单手抓住衣角', 'holding own clothes'),
    o('双手抓住衣角', 'holding own hem'), o('双手举起投降', 'hands up'),
    o('双手比心', 'heart hands'), o('单手比心', 'finger heart'),
    o('单手打响指', 'finger snap'), o('单手摸头', 'hand on own head'),
    o('双手抱头', 'head in hands'), o('双手做喇叭状', 'hands cupped around mouth'),
    o('双手摊开耸肩', 'shrugging'), o('双手捧起头发', 'hands in own hair'),
    o('单手捏住鼻梁', 'pinching bridge of nose'), o('双手捂住脸', 'covering face'),
    o('单手撑膝', 'hand on knee'), o('单手抓头发', 'grabbing own hair'),
    o('单手放在肩上', 'hand on own shoulder'), o('双手拉背包带', 'holding backpack straps'),
    o('单手擦眼泪', 'wiping tears'),
  ],
  headDirection: [
    o('正面平视', 'looking at viewer'), o('侧脸(微侧)', 'from side'),
    o('回眸(回头看)', 'looking back'), o('低头', 'looking down'), o('仰头', 'looking up'),
    o('歪头', 'head tilt'), o('仰头(看镜头)', 'looking up at viewer'), o('后仰', 'leaning back'),
  ],
  gazes: [
    o('看着镜头', 'looking at viewer'), o('看向侧方', 'looking to the side'),
    o('闭眼', 'closed eyes'), o('眼神向别处飘', 'looking away'),
    o('向上看', 'looking up'), o('向下看', 'looking down'),
  ],
  eyeEmotions: [
    o('开心(弯眼)', 'happy'), o('生气(皱眉)', 'angry'), o('嫌弃(半眯眼)', 'half-closed eyes'),
    o('惊讶(瞪大)', 'surprised'), o('悲伤(下垂)', 'sad'), o('冷漠(无神)', 'expressionless'),
    o('慵懒', 'drowsy'), o('迷离', 'unfocused eyes'), o('无辜', 'innocent'), o('委屈', 'teary'),
    o('虔诚', 'reverent'), o('自信', 'confident'), o('焦急', 'anxious'), o('兴奋', 'excited'),
  ],
  mouthStates: [
    o('微笑', 'smile'), o('大笑(张嘴)', 'open mouth'), o('撇嘴(嫌弃)', 'frown'),
    o('嘟嘴(生气/可爱)', 'pout'), o('抿嘴(紧张)', 'clenched mouth'), o('吐舌(调皮)', 'tongue out'),
    o('飞吻', 'blowing a kiss'), o('打哈欠', 'yawning'), o('呼吸(微张)', 'slightly open mouth'),
    o('叹气', 'sighing'), o('鼓腮帮', 'puffed cheeks'), o('默念', 'murmuring'),
    o('哼唱', 'humming'), o('呼喊', 'shouting'), o('欢呼', 'cheering'),
    o('啜泣', 'sobbing'),
  ],
  effectSymbols: [
    wu(), o('汗滴', 'sweatdrop'), o('青筋(生气)', 'anger vein'), o('爱心', 'heart'),
    o('星星眼', 'sparkling eyes'), o('泪滴', 'teardrop'), o('闪亮', 'sparkles'),
    o('眩晕圈', 'dizzy'), o('音符', 'musical note'), o('困倦(Zzz)', 'sleepy'),
    o('晕眩', 'dizzy symbols'), o('睡眠符号(Zzz)', 'sleep symbols'), o('问号', 'question mark'),
    o('阴影(沮丧)', 'gloomy shadow'), o('蘑菇(蹲角落)', 'mushroom'), o('阴影', 'shadow'),
    o('光环', 'halo'), o('祈祷光效', 'prayer light'), o('风线', 'wind lines'),
    o('速度线', 'speed lines'), o('烟尘', 'dust cloud'), o('星星', 'star'), o('闪光', 'sparkle'),
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
    // 基础
    o('纯色背景(可自选颜色)', 'simple background'), o('透明背景', 'transparent background'),
    o('星空', 'starry sky'), o('王座', 'throne'), o('咖啡馆', 'cafe'),
    o('教室', 'classroom'), o('城市街道', 'city street'),
    // 慵懒/日常系
    o('复古/布艺沙发', 'luxurious velvet sofa, cushions'),
    o('阳光飘窗', 'sunlit bay window, window seat, cushions, indoor plants'),
    o('公园长椅', 'wooden park bench, falling leaves, park'),
    o('学校天台', 'school rooftop, chain-link fence, blue sky'),
    o('图书馆角落', 'cozy library corner, high bookshelves, reading nook'),
    o('秋千', 'wooden swing, hanging from a large tree'),
    // 奇幻/仙侠系
    o('云端云海', 'sea of clouds, soft fluffy clouds, ethereal'),
    o('花海/草地', 'vast flower field, soft grass, glowing pollen'),
    o('魔法阵/悬浮平台', 'magic circle, floating stone platform, glowing runes'),
    o('巨型树根/藤蔓', 'giant tree roots, ancient forest, soft moss'),
    o('水面/浅滩', 'shallow water, reflecting surface, gentle ripples'),
    // 私密/高定系
    o('复古大床/带帷幔的床', 'four-poster bed, canopy, luxurious silk sheets'),
    o('日式榻榻米', 'tatami mat, japanese room, shoji screen'),
    o('泳池边躺椅', 'poolside lounge chair, sunny resort, splashing water'),
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

// 背景按用途分组展示：基础 + 三类有支撑物的慵懒/仙侠/高定场景。
export const BACKGROUND_GROUPS = [
  {
    label: '基础',
    options: ['纯色背景(可自选颜色)', '透明背景', '星空', '王座', '咖啡馆', '教室', '城市街道'],
  },
  {
    label: '慵懒/日常系',
    options: ['复古/布艺沙发', '阳光飘窗', '公园长椅', '学校天台', '图书馆角落', '秋千'],
  },
  {
    label: '奇幻/仙侠系',
    options: ['云端云海', '花海/草地', '魔法阵/悬浮平台', '巨型树根/藤蔓', '水面/浅滩'],
  },
  {
    label: '私密/高定系',
    options: ['复古大床/带帷幔的床', '日式榻榻米', '泳池边躺椅'],
  },
];

// 背景物理类型：support=有坐卧支撑物（站立/跑/跳易穿模）；
// ground=无支撑物硬地（躺/坐只能贴地）；其余悬空/纯色/透明不做特殊处理。
export const BACKGROUND_PHYSICS = {
  '复古/布艺沙发': 'support',
  '阳光飘窗': 'support',
  '公园长椅': 'support',
  '图书馆角落': 'support',
  '秋千': 'support',
  '魔法阵/悬浮平台': 'support',
  '巨型树根/藤蔓': 'support',
  '水面/浅滩': 'support',
  '复古大床/带帷幔的床': 'support',
  '日式榻榻米': 'support',
  '泳池边躺椅': 'support',
  '王座': 'support',
  '城市街道': 'ground',
  '教室': 'ground',
  '学校天台': 'ground',
  '花海/草地': 'ground',
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
  {
    label: '职业与身份',
    options: [
      '女仆·家政', '医疗·护理', '教师·学者', '军警·执法', '运动竞技', '舞台表演',
      '消防·救援', '航空·飞行', '餐饮·服务',
    ],
  },
];

const preset = (id, group, name, main, accent, tags, swatch) =>
  ({ id, group, name, main, accent, tags, swatch });

// 配色来源（每组扩充时按这几种成熟的配色体系挑，而不是随手搭色）：
//   · 学院/休闲：常春藤与 New England Prep 的固定盘 —— 藏青、奶油、米色、卡其、
//     牛津蓝、猎装绿、酒红(oxblood)、驼色；配比按 60-30-10（大面积中性 + 一个深色重点）。
//     另收 Country Club Casual（卡其/浅蓝/米白）与 Dark Academia（深咖/猎装绿/酒红/黄铜）。
//   · 甜美：马卡龙与 pastel 盘的取色（raspberry / pistachio / lavender / lemon /
//     peach / sage / sea glass / powder blue），并各带一个"锚点深色"，避免整张图发灰。
//   · 古风：中国传统色的成对公式 —— 宋式(天青+月白+缃色+墨灰)、茶(竹青+茶褐+月白)、
//     敦煌(石绿+赭石+沙色+朱红)、文人(墨黑+月白+苍青)。
//   注：main/accent 里的每个中文色名都必须在 COLOR_WORDS 里存在，否则会被静默丢弃。
export const PRESETS = [
  preset('classic-black-red', '经典学院与日常', '经典黑红白', ['黑', '红'], ['白', '灰'],
    ['black skirt', 'red ribbon', 'white shirt'], ['#1a1a1a', '#f5f5f5']),
  preset('navy-white', '经典学院与日常', '藏青与白', ['藏青', '白'], ['浅灰', '浅蓝'],
    ['navy blue serafuku', 'white collar'], ['#1f2f4e', '#cccccc']),
  preset('oat-coffee', '经典学院与日常', '燕麦暖咖', ['卡其', '浅棕'], ['白', '米色'],
    ['beige cardigan', 'brown skirt', 'white shirt'], ['#c3b091', '#ffffff']),
  preset('black-white', '经典学院与日常', '黑白极简', ['黑', '白'], ['银', '灰'],
    ['black suit', 'white shirt', 'monochrome'], ['#111111', '#c0c0c0']),
  // 常春藤经典：猎装绿 + 奶油 + 酒红，学术感最正的一套。
  preset('ivy-cream', '经典学院与日常', '常春藤奶油', ['奶油白', '墨绿'], ['酒红', '金'],
    ['ivy league outfit', 'cream and hunter green blazer', 'burgundy necktie'],
    ['#355e3b', '#f5f5dc']),
  preset('navy-burgundy', '经典学院与日常', '藏青酒红', ['藏青'], ['酒红', '奶油白'],
    ['navy blazer', 'burgundy accents', 'cream knit sweater'],
    ['#1f2a44', '#800020']),
  preset('country-club', '经典学院与日常', '乡村俱乐部', ['卡其', '浅蓝'], ['白', '浅棕'],
    ['khaki chinos', 'light blue oxford shirt', 'country club casual'],
    ['#c3b091', '#add8e6']),
  preset('nautical-stripe', '经典学院与日常', '海魂条纹', ['藏青', '白'], ['红', '金'],
    ['striped sailor shirt', 'nautical stripes', 'navy and white'],
    ['#1f2a44', '#b22222']),
  preset('modern-prep', '经典学院与日常', '现代预科', ['藏青', '石南灰'], ['藕粉'],
    ['relaxed navy blazer', 'heather gray knit', 'soft pink accent'],
    ['#1f2a44', '#fadadd']),
  preset('dark-academia', '经典学院与日常', '暗黑学院', ['深咖', '墨绿'], ['酒红', '黄铜'],
    ['brown tweed blazer', 'dark academia', 'oxblood accessories'],
    ['#3a2e2a', '#355e3b']),
  preset('oxford-shirt', '经典学院与日常', '牛津衬衫', ['牛津蓝', '白'], ['藏青', '灰'],
    ['oxford blue shirt', 'button-down collar', 'crisp cotton'],
    ['#8fa9c8', '#ffffff']),
  preset('camel-coat', '经典学院与日常', '驼绒大衣', ['驼色', '米色'], ['深咖', '金'],
    ['camel wool coat', 'tailored autumn outfit', 'campus style'],
    ['#c19a6b', '#e8dfc8']),
  preset('denim-tee', '经典学院与日常', '丹宁白T', ['牛仔蓝', '白'], ['灰', '米色'],
    ['denim jacket', 'white t-shirt', 'casual everyday outfit'],
    ['#4a6e9b', '#ffffff']),
  preset('sage-linen', '经典学院与日常', '鼠尾草亚麻', ['鼠尾草绿', '米色'], ['浅棕', '白'],
    ['sage green linen shirt', 'relaxed casual', 'natural fabric'],
    ['#bcc8b4', '#e8dfc8']),
  preset('sakura', '甜美与马卡龙', '樱花草莓', ['浅粉'], ['白', '红'],
    ['pastel pink dress', 'white lace', 'strawberry motif'], ['#ffb7d5', '#ffffff']),
  preset('mint', '甜美与马卡龙', '薄荷奶油', ['薄荷绿'], ['白', '浅黄'],
    ['mint green clothes', 'white accent'], ['#a8e6cf', '#ffffff']),
  preset('taro', '甜美与马卡龙', '香芋星云', ['浅紫'], ['粉', '白'],
    ['pastel purple hair', 'pink and white dress'], ['#d5c7f0', '#ffc0cb']),
  preset('lemon', '甜美与马卡龙', '柠檬苏打', ['鹅黄'], ['白', '浅蓝'],
    ['yellow sundress', 'light blue bow'], ['#fff2a8', '#ffffff']),
  preset('peach-sage', '甜美与马卡龙', '蜜桃鼠尾草', ['蜜桃粉'], ['鼠尾草绿', '奶油白'],
    ['peach cardigan', 'sage green skirt', 'soft warm pastel'],
    ['#f9d5c7', '#cfe3d1']),
  preset('sea-glass', '甜美与马卡龙', '海玻璃', ['海玻璃绿', '粉蓝'], ['白', '湖蓝'],
    ['sea glass outfit', 'powder blue and mint', 'light and airy'],
    ['#c9e9e4', '#c9dff2']),
  preset('lavender-lemon', '甜美与马卡龙', '薰衣草柠檬', ['薰衣草紫', '柠檬黄'], ['白', '紫'],
    ['lavender and lemon', 'spring pastel', 'cheerful pastel outfit'],
    ['#ddd3f2', '#fbf0b5']),
  preset('sorbet', '甜美与马卡龙', '雪酪', ['蜜桃粉', '杏色'], ['浅黄', '莓红'],
    ['sorbet pastel', 'apricot sundress', 'raspberry accent'],
    ['#f6cfdc', '#fcd9b8']),
  preset('pistachio', '甜美与马卡龙', '开心果奶昔', ['开心果绿'], ['白', '奶油白'],
    ['pistachio green', 'cream knit', 'soft bakery palette'],
    ['#c9e4b4', '#fdf9f4']),
  preset('blueberry-milk', '甜美与马卡龙', '蓝莓牛奶', ['蓝莓蓝', '白'], ['丁香紫', '浅蓝'],
    ['blueberry milk colors', 'pale blue and white', 'milky pastel'],
    ['#a8d8ea', '#fdf9f4']),
  preset('honey-toast', '甜美与马卡龙', '蜂蜜吐司', ['蜂蜜黄', '奶油白'], ['浅棕', '白'],
    ['honey yellow knit', 'butter yellow', 'warm bakery tones'],
    ['#fbe3a6', '#fdf9f4']),
  preset('cloud-lilac', '甜美与马卡龙', '云朵丁香', ['丁香紫', '白'], ['浅粉', '银'],
    ['lilac dress', 'cloud white', 'dreamy soft pastel'],
    ['#dcd3ff', '#ffffff']),
  preset('matcha-latte', '甜美与马卡龙', '抹茶拿铁', ['抹茶绿', '奶油白'], ['焦糖', '白'],
    ['matcha green', 'milky cream', 'latte color scheme'],
    ['#c8e6c9', '#f5f5dc']),
  preset('soda-pop', '甜美与马卡龙', '汽水糖', ['粉蓝', '糖果粉'], ['白', '柠檬黄'],
    ['soda pop colors', 'candy pink and blue', 'playful pastel'],
    ['#b3d9ff', '#f9c6d3']),
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
  // 宋式公式：天青 + 月白 + 缃色 + 墨灰。大面积月白留白，缃色只做点缀。
  preset('song-sky', '古风与东方奇幻', '宋式天青', ['天青'], ['月白', '缃色', '墨灰'],
    ['ru ware celadon robe', 'sky blue after rain', 'song dynasty hanfu'],
    ['#6c9bca', '#eef7f2']),
  preset('dai-blue', '古风与东方奇幻', '黛蓝远山', ['黛蓝'], ['月白', '银'],
    ['indigo blue hanfu', 'distant mountains', 'elegant oriental'],
    ['#2a3c5c', '#eef7f2']),
  preset('lotus-haze', '古风与东方奇幻', '藕荷烟雨', ['藕荷'], ['月白', '青'],
    ['lotus pink hanfu', 'misty rain', 'soft oriental pastel'],
    ['#edc3ae', '#eef7f2']),
  preset('eel-yellow', '古风与东方奇幻', '鳝鱼黄锦', ['鳝鱼黄'], ['墨黑', '朱红'],
    ['eel yellow silk robe', 'gold brocade', 'imperial contrast'],
    ['#f2c867', '#111111']),
  // 茶文化公式：竹青 + 茶褐 + 月白 + 低饱和黄（这里用鳝鱼黄）。
  preset('tea-bamboo', '古风与东方奇幻', '茶烟竹青', ['竹青', '茶褐'], ['月白', '鳝鱼黄'],
    ['bamboo green robe', 'tea brown sash', 'tea ceremony mood'],
    ['#789262', '#5d3d21']),
  // 敦煌公式：矿物蓝绿 + 暖赭 + 低饱和红 + 沙色中性。
  preset('dunhuang', '古风与东方奇幻', '敦煌矿彩', ['石绿', '赭石'], ['沙色', '朱红'],
    ['dunhuang mural colors', 'malachite and ochre', 'mineral pigments'],
    ['#57c3c2', '#862617']),
  preset('ink-landscape', '古风与东方奇幻', '墨色山水', ['墨黑', '月白'], ['苍青', '银'],
    ['ink wash landscape', 'monochrome hanfu', 'literati style'],
    ['#111111', '#eef7f2']),
  preset('fei-cui', '古风与东方奇幻', '绯红点翠', ['月白'], ['绯红', '金'],
    ['moon white hanfu', 'crimson trim', 'gold hairpin'],
    ['#eef7f2', '#e3256b']),
  preset('tan-purple', '古风与东方奇幻', '檀紫夜宴', ['檀紫', '墨黑'], ['金', '月白'],
    ['sandalwood purple robe', 'gold embroidery', 'night banquet'],
    ['#5b3a56', '#d4af37']),
  preset('xiang-autumn', '古风与东方奇幻', '缃色秋香', ['缃色'], ['茶褐', '墨黑'],
    ['pale gold silk', 'autumn maple', 'subtle oriental elegance'],
    ['#f0c239', '#5d3d21']),
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
  // 学院/休闲（常春藤与 New England Prep 的固定盘）
  '奶油白': 'cream', '墨绿': 'hunter green', '酒红': 'burgundy', '石南灰': 'heather gray',
  '藕粉': 'dusty pink', '深咖': 'dark chocolate brown', '驼色': 'camel',
  '牛津蓝': 'oxford blue', '牛仔蓝': 'denim blue', '鼠尾草绿': 'sage green',
  // 甜美（马卡龙与 pastel 盘）
  '蜜桃粉': 'peach pink', '海玻璃绿': 'sea glass green', '粉蓝': 'powder blue',
  '湖蓝': 'lagoon blue', '薰衣草紫': 'lavender', '柠檬黄': 'lemon yellow',
  '杏色': 'apricot', '莓红': 'raspberry red', '开心果绿': 'pistachio green',
  '蓝莓蓝': 'blueberry blue', '蜂蜜黄': 'honey yellow', '丁香紫': 'lilac',
  '抹茶绿': 'matcha green', '焦糖': 'caramel', '糖果粉': 'candy pink',
  // 古风（中国传统色）
  '天青': 'sky blue', '月白': 'moon white', '黛蓝': 'indigo blue', '藕荷': 'lotus pink',
  '绯红': 'crimson', '鳝鱼黄': 'eel yellow', '竹青': 'young bamboo green',
  '茶褐': 'tea brown', '缃色': 'pale gold', '墨灰': 'ink gray',
  '石绿': 'malachite green', '赭石': 'ochre', '檀紫': 'sandalwood purple',
  '苍青': 'slate blue',
};

// 中文色名到代表十六进制值的映射，仅用于界面色块展示（不参与提示词）。
export const COLOR_HEX = {
  '黑': '#1a1a1a', '纯黑': '#0a0a0a', '白': '#f5f5f5', '纯白': '#ffffff', '灰': '#8a8a8a',
  '深灰': '#4a4a4a', '浅灰': '#cccccc', '银': '#c0c0c0', '米色': '#e8dfc8', '卡其': '#c3b091',
  '浅棕': '#c89b7b', '棕': '#8a5a2b', '深棕': '#3e2612', '沙色': '#d9c49a',
  '藏青': '#1f2f4e', '墨蓝': '#1b2a5e', '深蓝': '#1b2a5e', '亮蓝': '#1e90ff', '浅蓝': '#a8c8e8',
  '青': '#3b82c4', '青色': '#39c5d7', '墨黑': '#111111', '蕾丝': '#e6d6c0',
  '红': '#d94f4f', '暗红': '#8b0000', '朱红': '#c3272b', '血红': '#a01020', '生锈红': '#9a463d',
  '粉': '#f4a7c0', '浅粉': '#ffb7d5', '荧光粉': '#ff4fa3', '紫': '#8b5cf6', '浅紫': '#d5c7f0',
  '金': '#d4af37', '暗金': '#b8860b', '黄铜': '#b08d3f', '暗黄': '#b8a24a', '鹅黄': '#fff2a8',
  '浅黄': '#f7e7a0', '浅绿': '#c2e0b0', '竹绿': '#4e7a45', '橄榄绿': '#6b8e23', '深绿': '#0e3a2a',
  '薄荷绿': '#a8e6cf', '荧光绿': '#39ff14', '蓝': '#3b82f6', '绿': '#22c55e',
  // 学院/休闲
  '奶油白': '#f5f5dc', '墨绿': '#355e3b', '酒红': '#800020', '石南灰': '#b2beb5',
  '藕粉': '#f2c9d0', '深咖': '#3a2e2a', '驼色': '#c19a6b', '牛津蓝': '#8fa9c8',
  '牛仔蓝': '#4a6e9b', '鼠尾草绿': '#bcc8b4',
  // 甜美
  '蜜桃粉': '#f9d5c7', '海玻璃绿': '#c9e9e4', '粉蓝': '#c9dff2', '湖蓝': '#3f7f86',
  '薰衣草紫': '#ddd3f2', '柠檬黄': '#fbf0b5', '杏色': '#fcd9b8', '莓红': '#b54f6e',
  '开心果绿': '#c9e4b4', '蓝莓蓝': '#a8d8ea', '蜂蜜黄': '#fbe3a6', '丁香紫': '#dcd3ff',
  '抹茶绿': '#c8e6c9', '焦糖': '#a97449', '糖果粉': '#f9c6d3',
  // 古风
  '天青': '#6c9bca', '月白': '#eef7f2', '黛蓝': '#2a3c5c', '藕荷': '#edc3ae',
  '绯红': '#e3256b', '鳝鱼黄': '#f2c867', '竹青': '#789262', '茶褐': '#5d3d21',
  '缃色': '#f0c239', '墨灰': '#4a4a4a', '石绿': '#57c3c2', '赭石': '#862617',
  '檀紫': '#5b3a56', '苍青': '#7397ab',
};

export const FACE_FIELDS = [
  'faceShape', 'eyeShape', 'pupil', 'eyebrow', 'mouth', 'nose',
  'facialFeatures', 'skin', 'heterochromiaLeft', 'heterochromiaRight',
  'blush', 'eyeMakeup', 'eyeShadowColor', 'lipstick', 'lipColor', 'specialMakeup',
];

export const ASPECT_OPTIONS = {
  baseAspect: ['3:4', '9:16', '1:1'],
  turnaroundAspect: ['16:9', '3:2'],
  clothingAspect: ['1:1', '4:3'],
  handAspect: ['1:1', '4:3'],
    tuneAspect: ['3:4', '4:3', '9:16', '16:9', '1:1'],
};

// 生成风格：仅保留二次元风格（赛璐璐平涂，米哈游风）。写实风已删除。
export const STYLE_OPTIONS = [
  { value: '二次元风格', label: '二次元风格' },
];

// 多选字段里表示「空/无」的占位值：选它会清空该字段（互斥）。
export const WU_VALUES = ['无', '常规'];

// 眼部情绪 → 可搭配的嘴部状态（每种情绪挂 2~5 种，避免「开心 + 撇嘴」这类冲突）。
export const MOUTH_COMPATIBILITY = {
  '开心(弯眼)': ['微笑', '大笑(张嘴)', '吐舌(调皮)', '欢呼', '哼唱'],
  '生气(皱眉)': ['撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '呼喊'],
  '嫌弃(半眯眼)': ['撇嘴(嫌弃)', '抿嘴(紧张)', '叹气', '嘟嘴(生气/可爱)'],
  '惊讶(瞪大)': ['呼吸(微张)', '呼喊', '大笑(张嘴)', '抿嘴(紧张)'],
  '悲伤(下垂)': ['啜泣', '抿嘴(紧张)', '叹气', '撇嘴(嫌弃)'],
  '冷漠(无神)': ['抿嘴(紧张)', '叹气', '默念', '呼吸(微张)'],
  '慵懒': ['打哈欠', '叹气', '呼吸(微张)', '抿嘴(紧张)'],
  '迷离': ['呼吸(微张)', '抿嘴(紧张)', '叹气'],
  '无辜': ['嘟嘴(生气/可爱)', '抿嘴(紧张)', '呼吸(微张)', '微笑'],
  '委屈': ['嘟嘴(生气/可爱)', '啜泣', '抿嘴(紧张)', '撇嘴(嫌弃)'],
  '虔诚': ['默念', '抿嘴(紧张)', '微笑'],
  '自信': ['微笑', '哼唱', '大笑(张嘴)', '飞吻'],
  '焦急': ['呼喊', '抿嘴(紧张)', '叹气', '呼吸(微张)'],
  '兴奋': ['欢呼', '大笑(张嘴)', '呼喊', '吐舌(调皮)'],
};

// 没选眼部情绪时不限制；选了之后返回所有已选情绪的可选嘴部并集。
export function mouthAllowedValues(eyeEmotions) {
  const eyes = (Array.isArray(eyeEmotions) ? eyeEmotions : []).filter((value) => MOUTH_COMPATIBILITY[value]);
  if (!eyes.length) return null;
  const allowed = [];
  for (const eye of eyes) {
    for (const mouth of MOUTH_COMPATIBILITY[eye]) {
      if (!allowed.includes(mouth)) allowed.push(mouth);
    }
  }
  return allowed;
}

export function mouthMatchesEyes(eyeEmotions, mouthState) {
  const eyes = (Array.isArray(eyeEmotions) ? eyeEmotions : []).filter((value) => MOUTH_COMPATIBILITY[value]);
  if (!eyes.length) return true;
  return eyes.some((eye) => MOUTH_COMPATIBILITY[eye].includes(mouthState));
}

// 每个体态自己的可选动作。多选体态时，界面只留这些列表的交集。
export const POSE_COMPATIBILITY = {
  '站立': {
    hands: ['自然下垂', '单手叉腰', '双手抱胸', '双手背后', '单手摸脸·托腮', '比耶(V)', '挥手',
      '单手提着裙摆', '手插口袋', '双手合十', '撩拨头发', '摊开双手', '单手捂脸', '握拳',
      '双手交叠放在身前', '单手整理袖口', '单手拉衣领', '单手摸后颈', '单手背在身后',
      '手指点脸颊', '手指抵下巴思考', '单手扶眼镜', '双手握拳放身侧', '单手扶墙',
      '单手竖起大拇指', '单手扶帽檐'],
    head: ['正面平视', '侧脸(微侧)', '回眸(回头看)', '低头', '仰头'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '飞吻', '呼吸(微张)', '叹气', '啜泣', '呼喊', '欢呼', '哼唱', '默念'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '闪亮', '眩晕圈'],
  },
  '坐姿': {
    hands: ['自然下垂', '单手摸脸·托腮', '比耶(V)', '挥手', '双手放腿上', '单手撑地', '双手抱胸',
      '盘腿', '双手合十', '托下巴', '拨弄头发', '撑着下巴发呆', '双手交叠放在身前',
      '双手撑在身后', '单手撑在身侧', '双手放在桌面上', '单手撑在桌上', '单手扶扶手',
      '手肘撑在桌上托腮', '双手交握放在腹部', '手指点脸颊', '单手摸后颈'],
    head: ['正面平视', '侧脸(微侧)', '回眸(回头看)', '低头', '仰头', '歪头'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)', '慵懒'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '打哈欠', '呼吸(微张)', '叹气', '啜泣', '呼喊', '欢呼', '哼唱', '默念'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '音符', '困倦(Zzz)'],
  },
  '躺姿': {
    hands: ['自然下垂', '单手摸脸·托腮', '双手枕在脑后', '双手放腹部', '单手放身侧', '单手向上伸',
      '双手抱胸', '双手交叉放胸前', '抱枕头', '双手举起', '双手抓住毯子', '双手交握放在腹部',
      '双手捧脸', '单手摸头'],
    head: ['正面平视', '侧脸(微侧)', '仰头', '歪头', '后仰'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)', '迷离'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '呼吸(微张)', '叹气', '啜泣', '呼喊', '欢呼'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '晕眩', '睡眠符号(Zzz)'],
  },
  '趴姿': {
    hands: ['单手摸脸·托腮', '双手撑地', '双手托下巴', '单手向前伸', '双手放在胸前', '单手肘撑地',
      '双手垫在脸下', '单手玩头发', '双手举起', '双手捧脸', '单手捂嘴', '双手抱头',
      '双手做喇叭状', '双手抓住毯子'],
    head: ['正面平视', '侧脸(微侧)', '仰头(看镜头)', '低头', '歪头'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)', '无辜'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '叹气', '呼吸(微张)', '啜泣', '呼喊', '欢呼'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '问号', '阴影(沮丧)'],
  },
  '蹲姿': {
    hands: ['双手抱膝', '单手摸脸·托腮', '自然下垂', '单手撑地', '双手放膝盖', '单手扶额', '比耶(V)',
      '抱着膝盖发呆', '双手合十', '单手撑膝', '单手摸头', '单手捂嘴', '双手捧脸', '手指点脸颊'],
    head: ['正面平视', '侧脸(微侧)', '低头', '仰头', '歪头'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)', '委屈'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '鼓腮帮', '叹气', '呼吸(微张)', '啜泣', '呼喊', '欢呼'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '蘑菇(蹲角落)', '阴影'],
  },
  '跪姿': {
    hands: ['自然下垂', '双手抱胸', '单手摸脸·托腮', '双手放腿上', '单手撑地', '双手合十', '祈祷',
      '比耶(V)', '单手抚摸地面', '双手交叠放在身前', '双手交握放在腹部', '单手摸后颈',
      '单手捂嘴', '双手捧脸'],
    head: ['正面平视', '侧脸(微侧)', '低头', '仰头', '歪头'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)', '虔诚'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '默念', '叹气', '啜泣', '呼吸(微张)', '呼喊', '欢呼'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '光环', '祈祷光效'],
  },
  '行走中': {
    hands: ['自然下垂', '单手提着裙摆', '挥手', '单手摸脸·托腮', '手插口袋', '单手扶帽檐',
      '整理领带', '双手插兜', '单手前伸', '单手整理袖口', '单手拉衣领', '单手扶墙',
      '单手竖起大拇指', '双手拉背包带'],
    head: ['正面平视', '侧脸(微侧)', '回眸(回头看)', '低头', '仰头'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)', '自信'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '哼唱', '飞吻', '啜泣', '叹气', '呼喊', '欢呼'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '音符', '风线'],
  },
  '奔跑中': {
    hands: ['自然下垂', '单手提着裙摆', '挥手', '向前伸出手', '单手扶帽檐', '握拳', '双手张开',
      '手放在胸前', '双手握拳放身侧', '单手背在身后', '单手拉衣领', '单手竖起大拇指'],
    head: ['正面平视', '侧脸(微侧)', '回眸(回头看)', '低头', '仰头'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)', '焦急'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '呼喊', '叹气', '呼吸(微张)', '啜泣', '欢呼', '哼唱'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '速度线', '烟尘'],
  },
  '跳跃中': {
    hands: ['自然下垂', '比耶(V)', '挥手', '双手张开', '单手摸脸·托腮', '双手向上伸', '单手扶帽檐',
      '双手抱膝', '单手向前伸', '双手举起', '双手摊开耸肩', '双手比心', '单手比心', '双手捧脸'],
    head: ['正面平视', '侧脸(微侧)', '仰头', '低头', '歪头'],
    gaze: ['看着镜头', '看向侧方', '闭眼', '眼神向别处飘', '向上看', '向下看'],
    eyes: ['开心(弯眼)', '生气(皱眉)', '嫌弃(半眯眼)', '惊讶(瞪大)', '悲伤(下垂)', '冷漠(无神)', '兴奋'],
    mouth: ['微笑', '大笑(张嘴)', '撇嘴(嫌弃)', '嘟嘴(生气/可爱)', '抿嘴(紧张)', '吐舌(调皮)',
      '欢呼', '呼喊', '啜泣', '叹气', '呼吸(微张)'],
    effects: ['无', '汗滴', '青筋(生气)', '爱心', '星星眼', '泪滴', '星星', '闪光'],
  },
};

// 细分姿势沿用父姿势的动作表。旧的坐姿、躺姿、趴姿只留在这张表里，界面不再单列。
export const POSE_INHERIT = {
  跷二郎腿: '坐姿',
  正坐: '坐姿',
  平躺: '躺姿',
  侧躺: '躺姿',
  平趴: '趴姿',
  小腿交叉趴着: '趴姿',
};

for (const [child, parent] of Object.entries(POSE_INHERIT)) {
  POSE_COMPATIBILITY[child] = { ...POSE_COMPATIBILITY[parent] };
}

// 细分姿势按现实补正手部动作：侧躺不能「双手枕在脑后」、正坐不会「盘腿」等。
const POSE_HANDS = {
  跷二郎腿: ['自然下垂', '单手摸脸·托腮', '比耶(V)', '挥手', '双手放腿上', '双手抱胸',
    '双手枕在脑后', '托下巴', '撑着下巴发呆', '拨弄头发', '单手扶扶手', '单手撑在桌上',
    '手肘撑在桌上托腮', '双手放在桌面上', '双手交叠放在身前', '手指点脸颊', '单手整理袖口',
    '单手扶帽檐'],
  正坐: ['自然下垂', '单手摸脸·托腮', '比耶(V)', '挥手', '双手放腿上', '单手撑地', '双手抱胸',
    '单手撑膝', '双手合十', '托下巴', '拨弄头发', '撑着下巴发呆', '双手交叠放在身前',
    '双手撑在身后', '单手撑在身侧', '双手放在桌面上', '单手撑在桌上',
    '手肘撑在桌上托腮', '双手交握放在腹部', '手指点脸颊', '单手摸后颈'],
  平躺: ['自然下垂', '单手摸脸·托腮', '双手枕在脑后', '双手放腹部', '单手放身侧', '单手向上伸',
    '双手抱胸', '双手交叉放胸前', '抱枕头', '双手举起', '双手抓住毯子', '双手交握放在腹部',
    '双手捧脸', '单手摸头'],
  侧躺: ['自然下垂', '单手摸脸·托腮', '单手放身侧', '侧身单手撑头', '单手肘撑地', '双手垫在脸下',
    '抱枕头', '单手玩头发', '单手向前伸', '双手抓住毯子', '单手撑在身侧', '单手捂嘴', '单手摸头'],
  平趴: ['单手摸脸·托腮', '双手撑地', '双手托下巴', '单手向前伸', '双手放在胸前', '单手肘撑地',
    '双手垫在脸下', '单手玩头发', '双手举起', '双手捧脸', '单手捂嘴', '双手抱头',
    '双手做喇叭状', '双手抓住毯子'],
  小腿交叉趴着: ['单手摸脸·托腮', '双手撑地', '双手托下巴', '单手向前伸', '双手放在胸前',
    '单手肘撑地', '双手垫在脸下', '单手玩头发', '双手举起', '双手捧脸', '单手捂嘴',
    '双手抱头', '双手做喇叭状', '双手抓住毯子'],
};

for (const [pose, hands] of Object.entries(POSE_HANDS)) {
  POSE_COMPATIBILITY[pose].hands = hands;
}

export const POSE_AXIS = {
  handPose: 'hands',
  headDirection: 'head',
  gazes: 'gaze',
  eyeEmotions: 'eyes',
  mouthStates: 'mouth',
  effectSymbols: 'effects',
};

export function poseCompatibleValues(field, poses) {
  const key = POSE_AXIS[field];
  if (!key) return null;
  const selected = (Array.isArray(poses) ? poses : []).filter((pose) => POSE_COMPATIBILITY[pose]);
  if (!selected.length) return [];
  const lists = selected.map((pose) => POSE_COMPATIBILITY[pose][key]);
  return lists[0].filter((value) => lists.every((list) => list.includes(value)));
}

// 角色定位 → 推荐服装：选中角色定位后，这些值会排到对应字段最前并标黄。
// 值为空数组表示该定位不推荐该字段的服装。
export const ROLE_RECOMMENDATIONS = {
  '日常休闲': {
    top: ['T恤', '卫衣', '套头毛衣'],
    bottom: ['牛仔裤', '运动短裤', '阔腿裤'],
    outerwear: ['夹克', '针织开衫', '棒球服'],
    onePiece: [], shoes: ['运动鞋', '帆布鞋'], socks: ['短袜', '船袜'],
  },
  '学院制服': {
    top: ['衬衫', '水手服上衣', '制服上衣'],
    bottom: ['百褶裙'],
    outerwear: ['针织开衫', '西装外套'],
    onePiece: ['JK制服'], shoes: ['小皮鞋', '运动鞋'], socks: ['小腿袜', '过膝袜'],
  },
  '都市职场': {
    top: ['衬衫', '西装内搭', '蕾丝吊带'],
    bottom: ['包臀裙', '直筒长裤', '打底裤'],
    outerwear: ['西装外套', '风衣'],
    onePiece: ['白大褂'], shoes: ['细高跟鞋', '小皮鞋'], socks: ['连裤袜'],
  },
  '娱乐圈·偶像': {
    top: ['抹胸', '露脐上衣', '蕾丝吊带'],
    bottom: ['蓬蓬裙', '热裤'],
    outerwear: ['机车皮衣', '薄纱罩衫'],
    onePiece: ['晚礼服'], shoes: ['细高跟鞋', '过膝长靴'], socks: ['渔网袜', '吊带袜'],
  },
  '悬疑·侦探': {
    top: ['衬衫', '西装内搭'],
    bottom: ['直筒长裤'],
    outerwear: ['风衣', '马甲背心'],
    onePiece: [], shoes: ['马丁靴', '小皮鞋'], socks: [],
  },
  '赛博朋克': {
    top: ['机能紧身衣', '战术背心'],
    bottom: ['工装裤'],
    outerwear: ['机能风外套', '机甲外骨骼'],
    onePiece: ['连体紧身衣'], shoes: ['机甲战靴', '军靴'], socks: ['破洞袜'],
  },
  '西式奇幻（剑与魔法）': {
    top: ['蕾丝吊带', '皮质胸衣'],
    bottom: ['直筒长裤', '高开叉长裙'],
    outerwear: ['斗篷', '披风', '毛领大衣'],
    onePiece: ['战甲'], shoes: ['骑士靴', '长筒靴'], socks: ['过膝袜'],
  },
  '东方古风（仙侠/武侠）': {
    top: ['交领右衽襦', '旗袍式短上衣'],
    bottom: ['马面裙', '齐胸褶裙', '高开叉长裙'],
    outerwear: ['汉服大袖衫'],
    onePiece: ['齐胸襦裙', '交领襦裙'], shoes: ['布履'], socks: [],
  },
  '和风（阴阳师/妖怪）': {
    top: ['和服上着', '巫女白衣'],
    bottom: ['和服式长下摆', '绯袴'],
    outerwear: ['羽织'],
    onePiece: ['浴衣'], shoes: ['木屐', '足袋（分趾）'], socks: ['分趾足袋'],
  },
  '蒸汽朋克': {
    top: ['西装内搭', '皮质胸衣'],
    bottom: ['包臀裙', '皮裤'],
    outerwear: ['风衣', '机车皮衣'],
    onePiece: [], shoes: ['马丁靴', '骑士靴'], socks: ['渔网袜'],
  },
  '星际科幻（太空/机甲）': {
    top: ['机能紧身衣'],
    bottom: ['工装裤'],
    outerwear: ['机甲外骨骼'],
    onePiece: ['太空服', '连体紧身衣'], shoes: ['机甲战靴'], socks: [],
  },
  '末世废土': {
    top: ['战术背心', '露脐上衣'],
    bottom: ['工装裤', '直筒长裤'],
    outerwear: ['战术防弹衣', '夹克'],
    onePiece: [], shoes: ['军靴', '马丁靴'], socks: ['破洞袜'],
  },
  '异世界穿越': {
    top: ['衬衫', '蕾丝吊带'],
    bottom: ['运动短裤', '蓬蓬裙'],
    outerwear: ['斗篷', '披风'],
    onePiece: [], shoes: ['长筒靴', '运动鞋'], socks: ['过膝袜'],
  },
  '哥特洛丽塔': {
    top: ['蕾丝吊带'],
    bottom: ['蓬蓬裙', '蕾丝半裙'],
    outerwear: ['薄纱罩衫'],
    onePiece: ['甜系洛丽塔', '哥特洛丽塔'], shoes: ['玛丽珍', '厚底松糕鞋'], socks: ['蕾丝边', '堆堆袜'],
  },
  '地雷系·亚文化': {
    top: ['卫衣', '露脐上衣'],
    bottom: ['百褶裙'],
    outerwear: ['夹克', '薄纱罩衫'],
    onePiece: [], shoes: ['厚底松糕鞋', '马丁靴'], socks: ['堆堆袜', '渔网袜'],
  },
  '灵异·克苏鲁': {
    top: [],
    bottom: ['高开叉长裙'],
    outerwear: ['斗篷'],
    onePiece: ['修女服'], shoes: ['纯赤脚', '布履'], socks: [],
  },
  '神话神明': {
    top: ['抹胸', '蕾丝吊带'],
    bottom: ['高开叉长裙'],
    outerwear: ['薄纱罩衫'],
    onePiece: ['晚礼服'], shoes: ['绑带凉鞋', '纯赤脚'], socks: [],
  },
  '女仆·家政': {
    top: ['女仆上衣', '荷叶边衬衫', '泡泡袖衬衫', '娃娃领衬衫'],
    bottom: ['洛丽塔裙撑下裙', '女仆围裙裙', '荷叶边半裙'],
    outerwear: ['女仆围裙'],
    onePiece: ['女仆装'], shoes: ['玛丽珍', '小皮鞋'], socks: ['蕾丝边', '小腿袜'],
  },
  '医疗·护理': {
    top: ['护士服上衣', '衬衫'],
    bottom: ['护士裙', '直筒长裤'],
    outerwear: ['白大褂'],
    onePiece: ['护士服', '白大褂', '外科手术服'], shoes: ['护士鞋', '小皮鞋'], socks: ['连裤袜'],
  },
  '教师·学者': {
    top: ['衬衫', '娃娃领衬衫', '针织背心'],
    bottom: ['西装裙', '直筒长裤'],
    outerwear: ['西装外套', '针织开衫'],
    onePiece: ['衬衫裙'], shoes: ['乐福鞋', '牛津鞋'], socks: ['小腿袜'],
  },
  '军警·执法': {
    top: ['军装上衣', '警服上衣', '战术背心'],
    bottom: ['军装长裤', '警服裙'],
    outerwear: ['军装外套', '警用风衣', '战术防弹衣'],
    onePiece: ['军装礼服', '警服连衣裙'], shoes: ['军靴', '马丁靴'], socks: [],
  },
  '运动竞技': {
    top: ['运动背心', '网球衫', 'T恤'],
    bottom: ['运动长裤', '网球裙', '瑜伽裤'],
    outerwear: ['运动外套', '棒球服'],
    onePiece: ['啦啦队服', '网球连衣裙', '体操服'], shoes: ['运动鞋', '帆布鞋'],
    socks: ['运动长袜', '短袜'],
  },
  '舞台表演': {
    top: ['舞台打歌服上衣', '露肩上衣'],
    bottom: ['打歌短裙', '纱裙'],
    outerwear: ['偶像演出外套', '薄纱罩衫'],
    onePiece: ['偶像打歌服', '舞台礼服', '芭蕾舞裙'], shoes: ['舞蹈鞋', '细高跟鞋'],
    socks: ['丝袜', '渔网袜'],
  },
  '消防·救援': {
    top: ['工装衬衫', 'T恤'],
    bottom: ['工装裤', '军装长裤'],
    outerwear: ['消防外套', '战术防弹衣'],
    onePiece: ['消防战斗服'], shoes: ['消防靴', '军靴'], socks: [],
  },
  '航空·飞行': {
    top: ['飞行员衬衫', '衬衫'],
    bottom: ['西裤', '军装长裤', '空姐裙'],
    outerwear: ['飞行员皮夹克', '西装外套'],
    onePiece: ['飞行服', '空姐制服'], shoes: ['军靴', '小皮鞋'], socks: ['丝袜'],
  },
  '餐饮·服务': {
    top: ['厨师服上衣', '衬衫'],
    bottom: ['西裤', '直筒长裤'],
    outerwear: ['侍者马甲', '围裙'],
    onePiece: ['厨师服'], shoes: ['小皮鞋', '乐福鞋'], socks: ['短袜'],
  },
};

// 预设作为 colorPreset 的选项：空字符串表示未选预设。
OPTIONS.colorPreset = [o('', ''), ...PRESETS.map((p) => o(p.id, p.tags.join(', ')))];

// 主色/辅色选项由中文色名词表生成，标签是英文色名。
OPTIONS.mainColors = Object.entries(COLOR_WORDS).map(([value, tag]) => o(value, tag));
OPTIONS.accentColors = OPTIONS.mainColors.map((entry) => ({ ...entry }));
