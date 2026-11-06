# AI 角色生成工作台 — 项目现状

> 本文档描述 `ai_role_gen` 目录下当前真实实现，与代码一一对应（非设计稿）。
> 最后一轮大改：Q版形象改回千问 `qwen-image-3.0` 出图（Gemini 的 Q 版太丑）；微调仍用 `gemini-3-pro-image-c` 并带防崩手补丁（试过换千问，多姿态多机位稳定性不够，已回退）；保留「手部拆解图」图种及其作为微调第三张输入的能力，生图按剩余张数 1~4 路动态并发。

---

## 1. 项目概述

一个纯本地的「二次元角色设定图」生成工作台，跑在 `127.0.0.1:8765`。用户在一个浏览器页面里配置角色（身份、外观、发型、妆容、服饰、配饰、姿势、场景），然后一键生成多种设定图，并把成品保存进本地图库、打包下载。

核心能力：

- **六种设定图**：基准立绘、三视图、表情差分图、服饰拆解图、手部拆解图、Q版形象。
- **完整设定集**：一键按「三视图 → 表情差分图 → 服饰拆解图 → Q版」顺序成套生成。
- **角色定向微调**：上传三视图 + 表情图集（+ 可选手部拆解图），按多选的姿势/表情组合批量出图。
- **锁脸一致性**：先出基准立绘，选定后作为全局参考图，后续图种同种子、同脸、同衣。
- **本地持久化**：图片上传 OSS，元数据写 SQLite；下次打开下载页仍能找回历史图片。
- **颜色实时翻译**：自由取色的 HEX 异步翻译成英文色名，拼进提示词。

无登录、无账号、无云服务依赖（除生图 API 与 OSS）。

---

## 2. 技术栈与运行

**前端**：原生 JavaScript ES Module，无构建步骤、无框架。`index.html` 引入 Tailwind CDN + 自定义 `styles/app.css`，入口 `src/main.js`。

**后端**：Python 标准库 `http.server`（`ThreadingHTTPServer`），`server/app.py` 同时承担静态文件服务与 JSON/SSE API。生图走 `urllib`，不依赖 Flask/FastAPI。

**持久化**：`server/db.py`（SQLite）+ `server/oss.py`（阿里云 OSS，`oss2` SDK 延迟导入）。

**生图后端**：

| 提供方 | 地址 | 用途 |
| --- | --- | --- |
| 阿里云百炼 | `dashscope.aliyuncs.com` | 千问文生图、颜色翻译 |
| 4sapi.org | `4sapi.org/v1/chat/completions` | Gemini 文生图（OpenAI 兼容格式） |

**测试**：JS 用 `node --test`，Python 用 `pytest`。唯一 devDependency 是 `jsdom`（DOM 测试）。

**启动**：

```bat
run.bat
```

`run.bat` 设 `chcp 65001`、切到脚本目录、延迟 2 秒自动打开浏览器，然后 `python server\app.py`。等价手动命令：

```bash
python server/app.py
# 或
npm start
```

---

## 3. 目录结构

```
ai_role_gen/
├── run.bat                     # 一键启动（切 UTF-8、开浏览器、跑 app.py）
├── index.html                  # 单页外壳：侧边栏 8 项 + 8 个 page 容器 + 全屏预览 + toast
├── package.json                # name ai-role-gen, type module, scripts: test/start
├── PLAN.md                     # 本文档
├── styles/
│   └── app.css                 # 全部自定义样式（变量主题、侧边栏、药丸、网格、下载页）
├── assets/
│   ├── chibi-style/            # 预留目录（空）
│   └── q_photos_reference/     # Q版风格参考图（.png，由 /api/chibi-style 读取）
├── data/
│   ├── gallery.db              # SQLite（运行时生成：图片、任务、采集）
│   └── tasks/                  # 任务工作区（运行时生成，每个任务一个目录，跑完可删）
├── src/
│   ├── main.js                 # 入口：装配 store/gallery/images，mount + loadHistory
│   ├── state.js                # 默认状态、防抖持久化、sanitize
│   ├── catalog.js              # 选项目录：OPTIONS/ROLE_GROUPS/PRESETS/颜色词/姿势兼容/推荐
│   ├── clothing.js             # 服饰节点系统（骨架/款式/细配/颜色 + 门禁 + 迁移）
│   ├── rules.js                # 联动：显隐/禁用/applyLinkage/警告
│   ├── view.js                 # 纯视图模型：把状态整理成控件树
│   ├── dom.js                  # 渲染 + 事件 + 生图流程 + 下载页 + 批量水印/动态壁纸 + 拖拽/主题/重置
│   ├── watermark.js            # 批量水印：Canvas 满屏斜向平铺半透明文字水印
│   ├── videoWatermark.js       # 视频水印：漂移轨迹 + 透明度呼吸的纯计算与 canvas 绘制
│   ├── wallpaper.js            # 壁纸：四端比例定义 + 焦点裁剪 + Canvas 合成（静态）
│   ├── colorGrade.js           # 调色引擎：16 参数，纯函数（-100~100）
│   ├── exportVideo.js          # 视频导出：MediaRecorder 录制循环视频 + 4K 超分编排
│   ├── generate.js             # 拼请求体、SSE 流式生图、三种生图入口
│   ├── prompts.js              # 提示词拼装（6 图种 + 微调 + Nano 补丁 + 手部拆解）
│   ├── gallery.js              # 内存图库（批次/选中/基准/服饰配对）+ 历史加载
│   ├── download.js             # 文件命名 + 内存 ZIP 打包
│   ├── face.js                 # 锁脸：面部字段备份/清空/还原
│   ├── theme.js                # 明暗主题解析与切换
│   ├── imageModels.js          # 模型表、价格、modelForGenerate
│   ├── colorTranslate.js       # HEX→英文色名（mock HSL + 真实模型链路兜底）
│   ├── gradeLut.js             # 调色参数 → ffmpeg lut3d / 锐化清晰颗粒暗角的滤镜串
│   ├── tasks.js                # 任务队列客户端：提交、1 秒轮询、取消、取产物
│   └── taskview.js             # 任务看板纯视图：三栏分组、状态文案、分页、文件名
├── server/
│   ├── app.py                  # HTTP 服务 + 生图/翻译/图库/壁纸/任务/SSE 接口
│   ├── db.py                   # SQLite 读写（images / tasks）
│   ├── oss.py                  # OSS 配置/上传/连通性探测
│   ├── tasks.py                # 任务队列：两个单线程池 + 阻塞队列（上限 64）
│   ├── progress.py             # 任务 step 进度上报
│   └── rife_parallel.py        # 补帧：多 CUDA stream 并行 RIFE
└── tests/
    ├── *.test.js               # 前端单测（node --test）
    ├── test_server.py          # 后端单测（pytest）：HTTP 接口与生图编排
    ├── test_tasks.py           # 后端单测：任务队列两池、上限、取消删除
    └── test_rife_parallel.py   # 后端单测：补帧切段与并行路数估算
```

---

## 4. 界面与导航

界面是**侧边栏 + 主内容区**（不是旧设计稿的三栏）。`index.html` 左侧八个导航项，主区八个 `<section>` 按路由一一对应。整站没有 hash 路由，`showPage` 只由侧边栏点击、任务卡片跳转和重置驱动。顶栏固定「🌙 主题切换」「重置」按钮。

| 路由 | 页面 | 内容 |
| --- | --- | --- |
| `base` | 身份基底 | 性别/年龄/种族/角色定位/伪娘开关 + 配色预设 |
| `detail` | 细节样式 | 面部、发型、妆容、服饰、头部配饰、配饰（手风琴分组） |
| `tune` | 角色定向微调 | 姿势/表情/场景多选 + 三图上传 + 性别 + 微调生成 |
| `generate` | 生成与处理（一般） | 模型/风格展示、基准立绘、四类单图、完整设定集、参考图上传、输出条 |
| `watermark` | 批量水印 | 上方「批量图片水印」（满屏斜向水印 + 单张下载/打包 ZIP），下方「批量视频水印」（漂移 + 透明度呼吸水印，实时预览、逐个/批量导出） |
| `wallpaper` | 动态壁纸 | 一条流水线走完：立绘 → 万相 wan3.0 首尾帧待机循环（4/6/8 秒，默认 6 秒）→ 色彩锁定 / 补帧 60FPS / 4K 超分出母版 → 四端裁剪 + 16 参数调色 → 逐端导出并自动下载。原「动态壁纸2」已并入本页，不再有独立路由 |
| `tasks` | 任务队列 | 两个单线程池（生成 / 壁纸处理）的任务看板：三栏「已完成·部分完成 / 全部失败 / 正在队列中」，每栏各自分页（每页 5 条），可取消、重试、下载产物 |
| `download` | 下载页 | 图库列表 + 三个标签页（全部/基准立绘/服饰基准）+ 筛选 |

路由由 `dom.js` 的 `ROUTES` / `PAGE_BY_ROUTE` 维护；`showPage` 切换 `hidden` 与侧边栏 `active`。默认进入 `base`。

---

## 5. 状态模型与本地持久化

### 5.1 状态结构

全局唯一状态在 `src/state.js` 的 `DEFAULT_STATE`，字段如下（`defaultState()` 每次返回深拷贝）：

```js
{
  // 身份
  gender: '女', age: '少女', race: '人类', role: '日常休闲', crossdressing: false,
  // 面部
  faceShape: '鹅蛋脸（标准）', eyeShape: '杏眼（标准）', pupil: '圆形瞳', eyebrow: '细平眉',
  mouth: '嘴角上扬（默认微笑）', nose: '小翘鼻（默认）', facialFeatures: [], skin: '自然肤色',
  heterochromiaLeft: '', heterochromiaRight: '',
  // 发型
  hairLength: '中长发', hairStyle: '双马尾（高/低）', ahoge: false, bangs: '空气刘海',
  hairColor: '黑', hairColorCustom: '', hairColorExtra: '无',
  streakColor: '', gradientRootColor: '', gradientTipColor: '',
  // 妆容
  blush: '轻微（眼下微红）', eyeMakeup: [], eyeShadowColor: '', lipstick: '自然色', lipColor: '', specialMakeup: [],
  // 服饰（6 个节点，见 6.5）
  top: {…}, bottom: {…}, outerwear: {…}, onePiece: {…}, shoes: {…}, socks: {…},
  outfitEffects: [],
  // 配饰
  hat: '无', feminineAccessories: [], masculineAccessories: [], fantasyAccessories: [],
  faceNeck: [], handsBack: [], handheld: [],
  // 配色
  colorPreset: '', mainColors: [], accentColors: [], backgroundColor: '#ffffff',
  // 姿势与表情（体态/手部/头向为数组，供微调多选；基准图只取其一）
  pose: ['站立'], handPose: ['自然下垂'], headDirection: ['正面平视'], gazes: ['看着镜头'],
  eyeEmotions: [], mouthStates: [], effectSymbols: [],
  // 场景
  shot: '全身像', camera: '平视', background: '纯色背景', lighting: '默认柔光', visualEffects: [],
  // 宽高比
  baseAspect: '3:4', turnaroundAspect: '16:9', clothingAspect: '1:1', handAspect: '1:1', tuneAspect: '3:4',
  // 风格 / 微调性别 / 微调鞋袜开关 / 已翻译色名
  style: '米哈游风', tuneGender: '女', tuneShoes: true, tuneSocks: true, colorNames: {},
}
```

服饰六件套每个部位存 `{ skeleton, style, detail, color, colorCustom }`；`color` 为「无」时跟随主色。

### 5.2 持久化

- **键**：`myCharacterConfig`（配置）、`myCharacterFaceBackup`（锁脸备份）、`theme`（主题）。
- **防抖**：任意修改后 1 秒防抖写入 `localStorage`（`createStore` 的 `schedule`）。首次成功提示「配置已保存到本地」，连续保存只提示一次。
- **sanitize**（`sanitizeState`）：
  - 禁止键：`image/images/base64/dataUrl/objectUrl/seed/reference/baseImage`，命中整份作废。
  - 字符串超 500 字符或含 `data:image/`、`blob:` 前缀判为可疑，作废。
  - `colorNames` 必须是 `{#rrggbb: 英文}` 的普通对象，值 ≤ 100 字符。
  - 逐键校验类型（按 `DEFAULT_STATE` 运行时类型）；`style/tuneAspect/tuneGender/tuneShoes/tuneSocks` 是后加字段，旧存档缺失时回退默认而不作废整份。
- **迁移**：`migrateTuneState` 把 `pose/handPose/headDirection` 从字符串迁成数组；`migrateClothing` 把旧平铺服装字符串收成节点（见 6.5 末尾）。
- **图片绝不入 localStorage**：参考图、生成图、种子只留在内存（`mount` 的 `images` 对象与图库）。

### 5.3 重置

顶栏「重置」：`confirm` 后删除 `myCharacterConfig` 与 `myCharacterFaceBackup`，保留 `theme`，刷新页面回到默认。

---

## 6. 选项目录

### 6.1 身份基底

| 字段 | 类型 | 选项 | 标签（示例） |
| --- | --- | --- | --- |
| 性别 | 单选 | 女 / 男 | `1girl` / `1boy` |
| 年龄 | 单选 | 女：萝莉/少女/成女；男：小孩/少年/青年/成年 | `loli` / `girl` / `child` … |
| 种族 | 单选 | 人类/精灵耳/兽耳/魔族/天使/亚人/机械改造人/吸血鬼 | `pointy ears` / `cyborg` … |
| 角色定位 | 单选（分组下拉） | 现代都市、古典幻想、科幻末日、亚文化与特殊、职业与身份（共 23 项） | `casual` / `maid` … |
| 特殊/伪娘 | 开关 | 仅男性可见 | — |

角色定位的分组由 `ROLE_GROUPS` 定义；标签在 `OPTIONS.role`。职业与身份组包含：女仆·家政、医疗·护理、教师·学者、军警·执法、运动竞技、舞台表演、消防·救援、航空·飞行、餐饮·服务。

### 6.2 外观（面部与肤色）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| 脸型 | 单选 | 圆脸/鹅蛋脸/瓜子脸/肉肉脸/方脸 |
| 眼型 | 单选 | 杏眼/圆眼/上挑眼/下垂眼/半眯眼/死鱼眼/星星眼 |
| 瞳孔 | 单选 | 圆形瞳/猫瞳竖瞳/无高光/异色瞳（左右各一个取色器） |
| 眉毛 | 单选 | 细平眉/粗平眉/柳叶眉/剑眉/八字眉/挑眉 |
| 嘴巴 | 单选 | 樱桃小嘴/猫唇/薄唇/厚唇/嘴角上扬 |
| 鼻子 | 单选 | 小翘鼻/直挺鼻 |
| 面部特征 | 多选 | 泪痣/雀斑/虎牙/小虎牙/面部纹身/创可贴/眼镜 |
| 肤色 | 单选 | 冷白皮/自然肤色/小麦色/黑皮/特殊肤色 |

### 6.3 发型

长度（单选）、基础造型（单选）、刘海（单选）、发色（单选 + 自定义取色）、挑染与渐变（多选：挑染/渐变发色，各带取色器）、呆毛（开关）。

### 6.4 妆容

腮红（单选）、眼妆（多选，含「眼影（可选颜色）」取色器）、唇妆（单选，含「唇彩颜色可选」取色器）、特殊妆容（多选，含「无」互斥占位）。

### 6.5 服饰（节点系统）

服饰在 `src/clothing.js`，六个部位（`CLOTHING_SLOTS` = `top/bottom/outerwear/onePiece/shoes/socks`）。每个部位按四段选择，上一段不兼容的下一段不出现：

1. **骨架**（盖到哪 / 有没有）
2. **款式**（特殊结构，按组分类）
3. **细配**（质感与边缘，只选一项）
4. **颜色**（只涂这一件；「无」跟随主色，「自定义」走取色器）

款式分五组：**现代 / 东亚传统 / 西方历史 / 制服职业 / 幻想机能**。与角色定位匹配的款式排最前并标黄（`recommended`）。

**骨架选项**：

| 部位 | 骨架 |
| --- | --- |
| 上装 | 无 / 胸衣短款 / 短衣摆 / 常规衣摆 / 中长衣摆 |
| 下装 | 无 / 热裤 / 短裤 / 长裤 / 短裙 / 及膝裙 / 长裙 / 曳地裙 |
| 外套 | 无 / 坎肩 / 短外套 / 中长外套 / 长外套 / 披挂 |
| 连体装 | 无 / 短连体 / 及膝 / 及踝 / 曳地 |
| 鞋子 | 赤脚 / 鞋面 / 踝靴 / 中筒靴 / 过膝靴 |
| 袜子 | 无 / 船袜 / 短袜 / 小腿袜 / 过膝袜 / 大腿袜（绝对领域） |

**款式**（部分带 `male:hide` 门禁，见 7.2）：

- **上装**（现代：T恤、衬衫、套头毛衣、卫衣、露脐上衣、吊带背心、抹胸、蕾丝吊带、皮质胸衣、荷叶边衬衫、泡泡袖衬衫、娃娃领衬衫、蕾丝衬衫、高领毛衣、针织背心、运动背心、网球衫、露肩上衣、挂脖上衣、一字肩毛衣、舞台打歌服上衣、工装衬衫；东亚传统：交领右衽襦、对襟衫、旗袍式短上衣、和服上着、长襦袢、巫女白衣、赤古里、库尔塔；西方历史：突尼克、维多利亚罩衫；制服职业：水手服上衣、西装内搭、制服上衣、女仆上衣、护士服上衣、警服上衣、军装上衣、学院衬衫、啦啦队上衣、厨师服上衣、空姐制服上衣、飞行员衬衫；幻想机能：机能紧身衣、战术背心）
- **下装**（现代：热裤、运动短裤、牛仔短裤、灯笼短裤、直筒长裤、牛仔裤、阔腿裤、打底裤、皮裤、百褶裙、包臀裙、蓬蓬裙、A字裙、蕾丝半裙、高开叉长裙、鱼尾裙、洛丽塔裙撑下裙、荷叶边半裙、网球裙、运动长裤、瑜伽裤、牛仔长裙、纱裙、打歌短裙、皮短裙、毛呢半裙；东亚传统：犊鼻裈、灯笼裤、汉服袴、裙裤、绯袴、马面裙、褶裙、齐胸褶裙、和服式长下摆；西方历史：马裤；制服职业：西裤、女仆围裙裙、护士裙、警服裙、空姐裙、军装长裤、西装裙、啦啦队短裙；幻想机能：工装裤、机甲腿甲、工装短裤）
- **外套**（现代：马甲背心、薄纱罩衫、夹克、棒球服、机车皮衣、针织开衫、风衣、羽绒服、毛领大衣、围裙、运动外套、毛皮披肩、披肩、偶像演出外套；东亚传统：比甲、羽织、汉服大袖衫、鹤氅、披帛；西方历史：斗篷、披风；制服职业：西装外套、军大衣、女仆围裙、校服西装、军装外套、警用风衣、白大褂、消防外套、飞行员皮夹克、侍者马甲；幻想机能：战术防弹衣、机能风外套、魔法师法袍、机甲外骨骼）
- **连体装**（现代：背带短裤、一件式泳装、连体紧身衣、背带裙、A字连衣裙、衬衫裙、甜系洛丽塔、古典洛丽塔、哥特洛丽塔、体操服、芭蕾舞裙、网球连衣裙、偶像打歌服、舞台礼服；东亚传统：旗袍、长衫、圆领袍、道袍、直裰、蒙古袍、奥黛、布布长袍、齐胸襦裙、齐腰襦裙、交领襦裙、袄裙、直裾深衣、曲裾深衣、留袖、振袖、访问着、浴衣、男性和服、巫女服、韩服、纱丽、罩袍；西方历史：晚礼服、婚纱、希顿、佩普洛斯、洛可可宫廷裙、维多利亚长裙；制服职业：JK制服、水手服连体裙、女仆装、白大褂、修女服、护士服、警服连衣裙、军装礼服、啦啦队服、厨师服、空姐制服、外科手术服；幻想机能：太空服、忍者夜行服、战甲、飞行服、消防战斗服）
- **鞋子**（赤脚：纯赤脚、脚链、脚趾甲油、足袋（分趾）、绑带缠绕；鞋面：运动鞋、帆布鞋、小皮鞋、乐福鞋、牛津鞋、玛丽珍、芭蕾平底、细高跟鞋、绑带高跟鞋、厚底松糕鞋、凉鞋、绑带凉鞋、拖鞋、舞蹈鞋、体操鞋、布履、绣花布鞋、草鞋、木屐、草履、护士鞋；踝靴：马丁靴、切尔西靴、尖头细跟短靴、绑带短靴、袜靴；中筒靴：长筒靴、骑士靴、牛仔靴、粗跟中筒靴、堆堆靴、流苏中筒靴、军靴、雪地靴、云头靴、雨靴、消防靴；过膝靴：过膝长靴、弹力过膝靴、绑带过膝靴、翻折过膝靴、亮面皮质长靴、骑士长靴、机甲战靴）
- **袜子**（现代：常规、连裤袜、吊带袜、渔网袜、破洞袜、踩脚袜、丝袜、运动长袜；东亚传统：分趾足袋）

**细配**：

| 部位 | 细配池 |
| --- | --- |
| 上装 | 无额外细节/蕾丝花边/丝绸/薄纱/棉麻/毛呢/皮革/破损/刺绣/发光线条/广袖/箭袖/泡袖/连帽/高领 |
| 下装 | 无额外细节/蕾丝边/丝绸/牛仔/皮革/破损/刺绣/高开叉/内衬安全裤/金属 |
| 外套 | 无额外细节/连帽/毛领/腰带/皮革/金属/薄纱/丝绸/毛呢/刺绣/破损/发光线条 |
| 连体装 | 无额外细节/蕾丝花边/丝绸/薄纱/刺绣/高开叉/破损/发光线条/板甲/鳞甲/锁子甲 |
| 袜子 | 无额外细节/蕾丝边/堆堆袜/半透明薄透/泡泡袜/条纹/绑带绕腿/8D/20D/80D/100D/120D/200D |

「多少D」（丹数）只出现在**过膝袜**骨架与**连裤袜**款式下：数值越小越薄透、越大越厚实不透明，映射为 `8 denier, ultra sheer` / `20 denier, sheer` / `80 denier, semi-opaque` / `100/120 denier, opaque` / `200 denier, thick opaque`。

鞋子细配随款式过滤（平跟/低跟/高跟/厚底/绑带/金属包头/破损/发光/木齿等，见 `DETAIL_TAG`）。

**共用色板**（`CLOTHING_COLORS`）：无 / 黑 / 白 / 粉 / 红 / 蓝 / 棕 / 灰 / 紫 / 绿 / 藏青 / 米色 / 银 / 金 / 自定义。

**强制伴随标签**（`forced`）：洛丽塔三款、芭蕾舞裙 → `petticoat`（裙撑）；留袖/振袖/访问着/浴衣/男性和服/巫女服 → `obi`（腰带）；吊带袜 → `garter belt`（吊带腰带）。界面上会提示「已加上××」。

**整身特效**（`outfitEffects`，最多 2 项）：湿身/烧焦灰烬/流光星尘/霓虹反光/玻璃质感/全身战损。

**提示词拼装**（`clothingTerms`）：一件衣服拼成「颜色 + 细配 + 款式标签」；连体装骨架非「无」时跳过上装、下装；大腿袜（绝对领域）且下装是短裙/及膝裙时加 `zettai ryouiki`。

**连体装轮廓排除**（`clothingExclusions`）：贴身连体款（体操服 / 一件式泳装 / 连体紧身衣 / 背带短裤）通过款式上的 `noExtra` 声明「这个轮廓里不该出现什么」，返回 `{ positive, negative }`。实测只写 `leotard` 时，模型会自动补半透明袖套和身后半片裙摆（风格锚点 `ornate costume design` / `metallic accents` / `dreamy ethereal lighting` 会放大这个倾向），所以：
- `sleeves` → 正向 `(sleeveless:1.2), bare arms, bare shoulders`，负向 `(detached sleeves:1.4), (oversleeves:1.4), (sheer arm covers:1.3), (arm warmers:1.3)`
- `skirt` → 正向 `single-piece bodysuit silhouette, high-cut leg openings`，负向 `(overskirt:1.4), (half skirt:1.4), (back skirt panel:1.4), (skirt:1.3), (bustle:1.3), (peplum:1.2)`
- `cape` → 负向 `(cape:1.3), (back drape:1.3), (floaty fabric behind the body:1.3)`

叠了外套时手臂由外套定义，`sleeves` 自动取消；外套是披挂类（斗篷/披风/披帛）时 `cape` 自动取消。这套词只进基准立绘、三视图、Q版形象；表情差分图不描述服装，不吃这套词。

**旧缓存迁移**（`migrateClothing`）：旧平铺字符串（`top: '衬衫'` 等）按 `LEGACY` 表收成节点；旧材质多选第一项写主衣细配，湿身/烧焦等写 `outfitEffects`（保留前两项）。

### 6.6 头部配饰

帽子/头饰类（单选）：无/贝雷帽/鸭舌帽/草帽/巫师帽/兜帽/军帽/警帽/护士帽/女仆头饰/圣诞帽/安全头盔·机甲头盔。

女生向小发饰（多选）：蝴蝶结/发带/发箍/发卡/发簪步摇/花环/运动发带/护额/耳机/护目镜/单片眼镜/绷带。男生向配饰（多选）：运动发带/护额/耳机/护目镜/单片眼镜/绷带。特殊奇幻（多选）：皇冠/光环/恶魔角/兽耳/精灵尖耳/面具/眼罩。

### 6.7 配饰与手持物

面部颈部（多选）：圆框/方框/金丝眼镜、口罩、面纱、Choker、领带、领结。手部背部（多选）：手套（半指/全指）、戒指、手链、翅膀、披风绑带、机械臂、纹身。手持道具（多选）：书本/法杖/长剑/匕首/枪械/雨伞/扇子/玩偶/捧花/咖啡杯/手机/枕头/毛毯/背包。

### 6.8 姿势与表情

体态（`pose`）、手部动作（`handPose`）、头部朝向（`headDirection`）在微调页为**多选**（基准图只取一个），视线 `gazes` 多选，眼部情绪/嘴部状态/特效符号多选（只进表情差分图与微调）。

**体态细分**（父姿势 → 子姿势，子姿势继承父姿势的动作表 `POSE_COMPATIBILITY`）：

| 父姿势 | 子姿势 |
| --- | --- |
| 坐姿 | 跷二郎腿、正坐 |
| 躺姿 | 平躺、侧躺 |
| 趴姿 | 平趴、小腿交叉趴着 |

其余体态独立：站立、蹲姿、跪姿、行走中、奔跑中、跳跃中。`POSE_INHERIT` 记录父子关系，子姿势在 `POSE_COMPATIBILITY` 中复制父项，再按现实修正手部动作（`POSE_HANDS`）。

**情绪搭配**：`MOUTH_COMPATIBILITY` 给每种眼部情绪挂 2~5 种嘴部状态，避免「开心 + 撇嘴」。选了眼部情绪后，嘴部只显示并集允许值（`mouthAllowedValues`）。

### 6.9 场景、构图与光影

景别（全身像/半身像/特写/大头贴）、镜头（平视/俯视/仰视/广角）、背景（分组下拉：基础=纯色可自选/透明/星空/王座/咖啡馆/教室/城市街道；慵懒日常系=复古布艺沙发/阳光飘窗/公园长椅/学校天台/图书馆角落/秋千；奇幻仙侠系=云端云海/花海草地/魔法阵悬浮平台/巨型树根藤蔓/水面浅滩；私密高定系=复古帷幔大床/日式榻榻米/泳池边躺椅）、光影（默认柔光/逆光/顶光/霓虹光/暖色调/冷色调）、画面特效（多选，最多 2 项）。

背景自带英文复合 tag（如 `luxurious velvet sofa, cushions`），并标注物理类型（`BACKGROUND_PHYSICS`）：`support`=有坐卧支撑物（沙发/床/长椅/秋千等），`ground`=无支撑物硬地（街道/教室/天台/花海），其余悬空/纯色/透明不做处理。

### 6.10 配色系统

- **主色**（多选 1~3）、**辅色**（多选 2~5），命名色走 `COLOR_WORDS` 英文映射；自由取色直接追加 HEX。
- **快捷预设**（`PRESETS`，24 个，单选）：经典学院与日常 / 甜美与马卡龙 / 暗黑与哥特 / 赛博与机能 / 古风与东方奇幻 / 神圣与奇幻。点选覆盖主/辅色并写 `colorPreset`，提示词追加该预设的 `tags`。
- **配色句**（`colorPhrases`）：`主色 and 主色 clothes`、`辅色 and 辅色 accents`；超出上限的降权为 `(颜色:0.5)`。
- **颜色翻译**：自由取色的 HEX 异步请求 `/api/translate-color`（模型链 `qwen3.8-flash → deepseek-v4.1-flash → qwen3.7-flash`），成功把英文名写入 `state.colorNames`；未配置/失败/超时由 `colorTranslate.js` 本地 HSL 映射兜底。拼提示词时 `colorNameOf` 优先读翻译名，否则回退 HEX。

---

## 7. 联动与防呆规则（`src/rules.js`）

### 7.1 性别与年龄

- 年龄池按性别切：男 `小孩/少年/青年/成年`，女 `萝莉/少女/成女`。
- 男（未开伪娘）隐藏女性专属项 `FEMALE_ONLY`：发型「双马尾/丸子头/麻花辫/姬发式」、长度「超长拖地发」、脸型「肉肉脸」、嘴巴「樱桃小嘴」、唇妆「亮面唇釉/咬唇妆」、眼妆「浓密睫毛/卧蚕」、帽子「女仆头饰」、手部动作「单手提着裙摆」、嘴部状态「嘟嘴」。女生向小发饰整组对男性隐藏。
- 女隐藏男性专属发型 `MALE_ONLY`：狼尾/碎发/大背头/飞机头。
- **服装只做男/女与伪娘差异**（`clothing.js` 的 `gateOf`）：女性不再按年龄隐藏或折叠任何衣物（`L = {}`、`SH = {}` 为空）。男性未开伪娘隐藏所有带 `male:hide` 的裙装/女性化款式。

### 7.2 服饰门禁

- 连体装骨架非「无」→ 上装、下装整组禁用，提示「连体装已覆盖上装和下装」。
- 骨架「无」→ 后续段隐藏。
- 鞋子「赤脚」不再是「空」：仍可选足部装饰款式（纯赤脚/脚链/脚趾甲油/足袋/绑带缠绕），但隐藏颜色段（皮肤本色）；床姿（躺/趴/跪）里赤脚连同足部装饰都按 `barefoot` 处理，不触发穿鞋确认。
- 款式与骨架不兼容时，选款式自动切到其默认骨架。
- 细配按款式/骨架过滤（广袖只给交领襦等、板甲鳞甲锁子甲只给战甲、高开叉只给旗袍/晚礼服/奥黛/纱丽、内衬安全裤只给短裙及膝裙等）。

### 7.3 姿势联动

- `poseCompatibleValues`：多选体态时，手部/头向/视线/情绪/嘴部/特效只显示各体态的交集。
- `HAND_POSE_NEEDS`：单手扶帽檐（需帽子）、单手扶眼镜（需眼镜）、整理领带（需领带/领结）、单手提着裙摆（需穿裙）。
- `HAND_POSE_ITEM`：抱枕头（需枕头）、双手抓毯子（需毛毯）、双手拉背包带（需背包）。
- `BOTH_HANDS` 占双手的动作与手持道具互斥（选了双手动作则手持禁用，选了道具则双手动作置灰）。
- `MULTI_WITH_WU`：选了「无」清空该字段；`CAPPED_TWO`（`visualEffects`/`outfitEffects`）最多 2 项。

### 7.4 警告（`warnings`）

- 躺/趴姿势 + 平视镜头 → 「建议改为俯视」。
- 帽子非「无」→ 「可能遮挡部分发型」。
- 主色 > 3 或辅色 > 5 → 「颜色过多，建议精简」。
- **物理支撑联动**：直立姿势（站立/行走/奔跑/跳跃）+ `support` 背景（沙发/床等低矮坐卧支撑物）→ 「可能穿模，建议改为坐姿或躺姿」（`isUprightPose` × `BACKGROUND_PHYSICS`）。

### 7.5 物理支撑与防悬空（`src/prompts.js`）

- **贴地保险**：坐/蹲/跪/躺/趴（`isRestingPose`）+ `ground` 背景（城市街道/教室/学校天台/花海草地）→ 正向自动补 `(resting on the ground, sitting on the floor:1.2)`，避免画成悬空。
- **防悬空负向**：任何坐/蹲/跪/躺/趴姿势（无论背景）→ 负向补 `(floating in the air, antigravity, stiff pose, no surface support:1.3)`。

---

## 8. 提示词拼装（`src/prompts.js`）

### 8.1 通用结构

- 图种 `KINDS = ['基准立绘', '三视图', '表情差分图', '服饰拆解图', '手部拆解图', 'Q版形象']`。
- 锁脸句 `LOCK_SENTENCE = '(same face as reference:1.5)'`，有参考图时加入正向。
- 通用质量词 `QUALITY_TAGS = ['masterpiece','best quality','highres','highly detailed']`；通用负向 `UNIVERSAL_NEGATIVE`（worst/low quality、bad anatomy、missing/extra limbs、bad hands、text、watermark）。
- `collect` 按字段顺序收集英文标签并去重；`tagSequence` 定义每种图的字段白名单。
- 表情差分图用预设 9 宫格 `EXPRESSION_PRESET`（微笑/生气/哭/惊讶/脸红/得意/悲伤/眨眼/无表情），不依赖用户勾选的 `eyeEmotions/mouthStates/effectSymbols`。
- 鞋子长度锚点：`clothingTerms` 里「过膝靴」骨架除款式 tag（`thigh-high boots` / `mecha boots`）外，追加 `(thigh-high boots:1.3), (over-knee boots:1.2)` 两个加权锚点，钉死靴筒长度，防止模型把过膝靴画成中筒靴。
- 赤脚正向词：`clothingTerms` 对鞋子骨架「赤脚」固定先推 `barefoot`，再按款式追加 `bare feet / natural toes / visible toenails`（纯赤脚）、`delicate anklet / gold chain / small bells`（脚链）、`red toenails / glossy nail polish`（趾甲油）、`tabi socks / split toe`（足袋）、`ribbon wrapped around ankle / laces`（绑带缠绕）；细配可补 `metallic` / `lace-up`。
- 全身像的 `shotClause` 识别赤脚：穿鞋时写 `shoes visible`，赤脚时改写 `barefoot, bare feet`，避免模型给赤脚角色凭空补鞋；床姿（躺/趴/跪）仍走 `unshod`（`no shoes, shoes removed` + 参考图同款袜子）。

### 8.2 生成风格

`STYLE_OPTIONS = ['米哈游风', '写实风二次元']`（默认米哈游风），存 `state.style`。

- 米哈游风：`anime gacha game style`、`Genshin Impact style`、clean lineart、cel shading、miHoYo 权重等；负向排写实。
- 写实风二次元：`(semi-realistic, 2.5d:1.3)`、anime realism、cinematic lighting、detailed skin texture、8k 等；负向排平涂/赛璐璐。
- `suiteAmplification`：写实风下为设定集（除服饰拆解图）注入 `2.5d` 信号对齐千问画风。

### 8.3 各图种提示词

| 图种 | 正向要点 | 负向要点 | 宽高比 |
| --- | --- | --- | --- |
| 基准立绘 | 中文构图指令打头（纯白背景/全身居中/站姿）+ `character design, official art` + 角色标签 + 风格词 + `masterpiece, best quality` | 多人/裁切/出框 + 通用负向 | `baseAspect` |
| 三视图 | 风格锚点词最先 + 锁脸句 + `character sheet, turnaround, multiple views, front/side/back view, same character, 3 views, standing, white background` | 不同角色/不同衣/不同发 | `turnaroundAspect` |
| 表情差分图 | `(expression chart:1.5), (3x3 grid:1.5), (9 different expressions:1.4), close-up face` + 9 宫格预设 | 全身/裸体/模糊/合并格/排版乱 | 1:1 |
| Q版形象 | 中文头身比指令打头（约 2 头身、头部占全身一半、身子只有一个多头高、参考图只取长相）+ 风格锚点 + 锁脸句 + `(chibi proportions:1.6), (2 heads tall:1.6), (2.5 heads tall:1.4), (oversized head:1.5), (tiny body:1.4), head occupying half of the total height, short stubby limbs` + `chibi, super deformed, cute, full body, standing, white background` + 角色标签 | `(realistic proportions:1.4), (7 heads tall:1.4), (8 heads tall:1.4), (3 heads tall:1.3), (4 heads tall:1.3), tall slender body, adult proportions, (long legs:1.3)` + 通用负向 | 1:1 |
| 服饰拆解图 | 固定拆解词（见 8.4 前），不吃风格、不拼角色、不加锁脸句 | 禁人/禁穿 | `clothingAspect` |
| 手部拆解图 | 固定手势表词（见 8.4） | 禁人/禁错色 | `handAspect` |

### 8.4 手部拆解图（关键实现）

- 输入与服饰拆解图一致：下载页「服饰基准」选定的「基准立绘 + 配套三视图」，种子取基准立绘种子。
- 正向固定：`(hand gestures sheet:1.5), (9 different hand poses:1.5), (3x3 grid:1.4), clear boundaries, (isolated hands:1.4), (floating hands, no body, no face, no human:1.5)` + 手部颜色规则 + 九种具体手势 `HAND_POSE_LIST`（`(v sign, open palm, fist, thumbs up, pointing, peace sign, holding a sword, waving, resting chin:1.2)`）。
- **手部颜色以参考图为准**（`HAND_REFERENCE_RULE`）：`(hand color and hand covering identical to the reference:1.6), (keep the reference gloves if any:1.4), (do not recolor the hands:1.4)`。`handLookTags` 若表单选了手套/机械臂则带出配饰 tag，否则补一句肤色词。
- 负向：禁人类/禁崩坏手指 + `(wrong hand color:1.5), (recolored hands…:1.4), (invented gloves, gloves removed from a gloved character:1.4)`。

### 8.5 微调提示词（`buildTunePrompt`）

- `tuneChineseClause`：中文打头「请参考图中的人物设定，但必须让她摆出【姿势】…。不要沿用参考图里的站立姿势。」
- `tuneLensClause`：风格 tag + cinematic lighting + rim light + 光影 + depth of field（镜头俯仰不在其中）。
- `tuneCameraClause`：镜头俯仰用影视摄影术语 + 明确机位/角度自然语言单独钉死。俯视 → `high angle shot, camera placed high above the character, viewed from above at a 45-degree downward angle, looking down at the subject`，负向排 `low angle / from below / looking up at the subject / eye level`；仰视 → `low angle shot, viewed from below at a 45-degree upward angle, looking up at the subject`，负向排 `high angle / from above / looking down at the subject / eye level`；平视 → `eye level, straight-on camera angle`，负向排 `high angle / low angle`。广角 → `dynamic angle, wide-angle lens, dramatic perspective`。用自然语言而非 SD 权重括号，因为定向微调走 Gemini 图片模型、权重语法会被剥离。
- 参考图声明：`(same face, hair and clothes as the first reference:1.5)`（三视图）+ `(expressions consistent with the second reference:1.3)`（表情图集）。
- 上传了手部拆解图时，追加 `HAND_SHEET_CLAUSE`（中文说明它只参考手指结构、颜色和手套要和角色一致、别把九宫格画进成品）+ `HAND_SHEET_POSITIVE`，负向加 `HAND_SHEET_NEGATIVE`（`(3x3 grid:1.4)`、`panel borders` 等）。
- **Nano 防崩手补丁**：`NANO_HAND_POSITIVE`（`(perfect hands:1.4), (correct hand anatomy:1.3), exactly five fingers, slender fingers…`）固定在正向最末尾；`NANO_HAND_NEGATIVE`（`(bad hands:1.5), (deformed hands:1.4), extra fingers, missing fingers, fused fingers…`）整段放负向最前。
- **走光防护**（`needsModesty`）：女角色 + 坐姿/躺姿/趴姿（含子类）/蹲姿/跪姿/跳跃中 → `(safety shorts:1.4), (fully clothed:1.3)` 等正向 + `(upskirt:1.5), (pantyshot:1.5)` 等负向。
- **床姿鞋袜**（`BED_POSES`）：躺/趴/跪默认赤脚，`shotClause` 处理 `unshod`（no shoes + `(same socks as the first reference:1.3)`）；穿鞋需用户确认（`allowBedShoes`）。
- **鞋袜显式开关**（`tuneShoes` / `tuneSocks`，默认 `true` 跟随角色配置）：微调页「鞋袜」组两个切换按钮。`tuneShoes=false`（不穿鞋）→ 仍穿袜则脱鞋留袜（`unshod`），不穿袜则彻底赤脚（`barefoot`），并追加 `SHOES_OFF_NEGATIVE`（`(shoes:1.4)`、`(footwear:1.4)` 等）钉死无鞋；`tuneSocks=false`（不穿袜子）→ 追加 `SOCKS_OFF_POSITIVE`（`bare legs`、`no socks`、`no stockings` 等）与 `SOCKS_OFF_NEGATIVE`（`(socks:1.4)`、`(tights:1.4)`、`hosiery` 等），防止模型按参考图凭空补袜子。
- `tuneCombinations`：`pose/handPose/headDirection/gazes/eyeEmotions/mouthStates/effectSymbols/handheld` 中选了 ≥2 项的轴做笛卡尔积，并剔除「开心 + 撇嘴」类冲突组合。

---

## 9. 生图流程（`src/generate.js`）

### 9.1 请求与回传

所有生成走 `POST /api/generate-stream`（SSE）。前端一次性提交整批 `jobs`，服务端并发逐张回传 `{index, seed, dataUrl, url, id}`，`requestImagesStream` 按 index 放回批次。单张失败帧 `{index, error}` 可被 `tolerateItemErrors` 容忍（完整设定集与微调用），不影响同批其他张。

### 9.2 各入口

- **`generateKind`**（基准立绘 / 三视图 / 表情差分图 / 服饰拆解图 / 手部拆解图 / Q版形象）：
  - 基准立绘默认 4 张（`baseCount` 1~4），其余各 1 张。
  - `planShot` 决定参考图与种子：拆解图用 `clothingPair` 的两张图；基准立绘用上传参考图（或新种子）；其余用锁定基准图（或上传图）。
  - Q版额外把 `/api/chibi-style` 拉到的风格图作为多图输入，塞满 `maxReferences` 名额（千问只有 3 张，锁脸基准优先）。
- **`generateSuite`**（完整设定集）：必须有锁定基准（否则报「请先选择合适的基准立绘」）。按套分两波：第 1 波并发「三视图 + Q版」，第 2 波并发「表情差分图 + 服饰拆解图（用本套刚生成的三视图作配对）」；按 `KIND_ORDER` 排序后成批入库。三视图失败则该套跳过服饰拆解图（`skippedClothing`）。`suiteCount` 1~4 套。Q版那一张用 `CHIBI_IMAGE_MODEL`（千问），不受设定集模型影响。
- **`generateTune`**（角色定向微调）：必传三视图 + 表情图集（缺一报错），手部拆解图可选。参考图顺序 `[三视图, 表情图集, 手部拆解图?]`。按 `tuneCombinations` 张数出图，`tolerateItemErrors`，返回 `{batch, failed}`。

### 9.3 流式并发与停止

服务端 `generate_stream_events` 用 `ThreadPoolExecutor`，**按剩余张数动态调整并发**：

```python
STREAM_MAX_WORKERS = 4
def stream_workers(remaining):
    return max(1, min(STREAM_MAX_WORKERS, remaining))
```

- 每轮按「队列 + 在跑」重算上限，剩余越少并发越低，一路递减到 1。
- 前端点「停止生成」：`AbortController` 掐断 fetch → `GenerationStopped`；服务端 `GeneratorExit` 时取消排队任务，在跑的两张结果不再推送。整批已回显和未开始的图全部丢弃，不落库。

### 9.4 锁脸一致性与「基准图自带角色配置」

- 生成基准立绘后，在下载页「基准立绘」标签点「确定」→ `gallery.setBase` 设为全局基准。
- 后续三视图/表情/Q版都用这张图 + 锁定种子（`planShot` 里 `locked` 分支）。
- 服饰拆解图/手部拆解图**不**用锁脸基准，改用「服饰基准」选定的配对组。
- **基准图自带角色配置快照**：只有基准立绘用「当前表单」写提示词，生成时把整份 `state` 随请求体一起提交，服务端存进 `images.state`（JSON 列，旧库启动时自动 `ALTER TABLE` 补列）。
  - 锁定某张基准后，`gallery.base()` 把它当年的 `state` 一起带出来；`lockedCharacterState(snapshot, kind)` 优先用「服饰基准那组」的 `state`，其次用全局基准的，再退回当前表单。
  - 所以「选哪张基准就出哪个角色」：左侧表单里后来改了身份/服饰也不会污染已经锁定的角色。
  - 旧数据没有 `state` 时静默回退当前表单——这正是早期「选哪张基准都出紫衣角色」的根因，清库后旧数据消失，机制才彻底成立。

---

## 10. 模型与计费（`src/imageModels.js`）

| 模型 | 分组 | 价格 | maxRefs | 负向参数 |
| --- | --- | --- | --- | --- |
| `qwen-image-3.0` | 千问 | 出图 $0.024754/张（1K/2K 同价），参考图每张另 +$0.002750 | 3 | 支持 |
| `qwen-image-2.1-pro` | 千问 | $0.035333/张 | 10 | 不支持 |
| `qwen-image-2.1-turbo` | 千问 | $0.014133/张 | 10 | 不支持 |
| `gemini-3-pro-image-c` | Gemini | 1K/2K ￥0.268/张 | 10 | 不支持 |
| `gemini-nano-banana-2.1-c` | Gemini | 1K ￥0.0672/张，2K ￥0.1008/张 | 10 | 不支持 |
| `gemini-3.1-flash-image-c` | Gemini | 1K ￥0.134/张，2K ￥0.202/张 | 10 | 不支持 |

**模型按按钮锁死**（`modelForGenerate`）：

- 基准立绘 → `qwen-image-3.0`（`BASE_IMAGE_MODEL`）
- Q版形象 → `qwen-image-3.0`（`CHIBI_IMAGE_MODEL`）：单张生成与完整设定集里的 Q 版都走千问，Gemini 的 Q 版头身和脸型偏"丑娃"
- 三视图 / 表情差分图 / 服饰拆解图 / 手部拆解图 / 完整设定集其余部分 → `gemini-3-pro-image-c`（`SUITE_IMAGE_MODEL`）
- 角色定向微调 → `gemini-3-pro-image-c`（`TUNE_IMAGE_MODEL`）：试过换 `qwen-image-3.0`，多姿态多机位组合的稳定性明显不如 Gemini，已回退。

`generateSuite` 逐图种定模型：`buildJob` 的 `model` 参数在第四类图（Q版形象）时被 `CHIBI_IMAGE_MODEL` 覆盖，其余沿用调用方传入的设定集模型。因为千问 `maxReferences` 只有 3，Q版在设定集里会把「锁脸基准 + 风格图」截到 3 张（基准排在前面，名额不够先丢风格图）。

全部按 1K 出图（`resolution: '1k'`，长边 1024，见 `calc_size`）。千问标 $，Gemini 走 4sapi 实扣人民币标 ￥（1 美元按 ￥2 扣）。生成页只显示价格，不能手选模型。

---

## 11. 参考图与锁脸（`src/face.js`）

- 「生成与处理」页的「上传参考图」用于基准立绘：上传后进入锁脸模式。
- 锁脸时中栏「面部」「妆容」两组整体禁用，显示「已开启锁脸模式…」；`createFaceStore` 在联动之后再次清空面部字段（`stripFace`），`FACE_FIELDS` 含五官/肤色/瞳色/妆容/异色瞳等。
- 锁定前把原面部字段备份到 `myCharacterFaceBackup`（`backupFace`）；移除参考图或刷新后无参考图时用 `unlockReference` 还原并删备份。发型保持开放，不随锁脸置灰。
- 参考图 data URL 只存内存 `images.reference`，绝不进 `myCharacterConfig`。

---

## 12. 图库、持久化与下载

### 12.1 内存图库（`src/gallery.js`）

`createGallery` 维护 `batches`、`selectedId`、`base`（锁定基准）、`clothingPair`（服饰基准配对）。图片、种子、提示词只留内存。`removeItem/removeBatch` 会同步 `forgetLocks` 清理指向被删图的锁定。

### 12.2 服务端持久化（`server/db.py` + `server/oss.py`）

- 每张图生成后（`handle_generate`）：若 OSS 已配置，先上传 `role-images/{slug}/{uuid}.png`，再把 URL 与元数据（kind/aspect/seed/positive/negative/batch_id/base_url/base_seed/created_at）写入 SQLite `data/gallery.db`。
- OSS 未配置时图片仅本次会话可用；上传/落库失败不阻断生图，仍返回 dataUrl。
- `_KIND_SLUG`：基准立绘 `base`、三视图 `turnaround`、表情差分图 `expression`、服饰拆解图 `clothing`、手部拆解图 `handsheet`、Q版形象 `chibi`、微调角色 `tune`。
- 打开页面时 `loadHistory` 拉 `/api/gallery`，按 `batch_id` 组装回内存图库（`loadPersisted`），历史批次标记 `history: true`（只在下载页展示）。

### 12.3 下载页

- 标签页：全部 / 基准立绘 / 服饰基准。筛选复选框：微调角色图集 / 设定集。
- 批次分组（`batchGroup`）：全部 `微调角色` → `tune`；有基准图且含非三视图 → `suite`；其余 `other`。
- 「基准立绘」标签：列出所有基准立绘，点「确定」设为当前角色基准。
- 「服饰基准」标签：列出「基准立绘 + 配套三视图」配对，点「确定选定」设为 `clothingPair`（只用于单次服饰拆解图/手部拆解图）。
- 单张下载、打包本套/本次（内存 ZIP）、删除（同步调 `/api/gallery/delete`）、全屏预览。

### 12.4 文件命名与打包（`src/download.js`）

- 文件名：`makeFileKey = UUID 前 6 位 + 时间戳(YYYYMMDD-HHmmss)`，如 `064896-20261030-235948.png`。
- ZIP：纯内存实现（crc32 + 本地/中央目录），文件名 `角色设定-YYYYMMDD-HHmmss.zip`，含 `images/` 下图片与基准图。
- 远程（OSS）图片打包时经 `/api/image?url=…` 代理拉字节（服务端只允许图库里已有的地址，防开放代理）。

### 12.5 批量水印（`src/watermark.js` + `src/videoWatermark.js`）

页面分两个区块：上方「批量图片水印」，下方「批量视频水印」。

**图片水印**（`watermark.js`）：

- 纯前端 Canvas 实现，不上传服务器、不依赖后端接口。默认水印文字 `shixiaoyu-funny`（可编辑）。
- 文字沿左下→右上方向（角度 `-45°`）满屏平铺；半透明白字加暗描边保证在浅色图上也可读；输出为 PNG（原图不变，另存副本）。
- 可调参数（修改后已添加的图片会即时重渲染）：
  - 文字（默认 `shixiaoyu-funny`）；
  - 透明度（默认 18%，滑杆 5%~60%）；
  - 字号（默认 40px，滑杆 16~96px，`watermarkDataUrl` 的 `fontSize`）；
  - 字间距（默认 40px，滑杆 0~300px，`letterGap`）：沿文字书写方向的字与字空隙；
  - 行间距（默认 120px，滑杆 20~400px，`lineGap`）：行与行之间字号之外的空隙。
- 铺贴间距按文字实际宽度自适应：`measureText` 量出文字宽，沿文字方向间距 = 文字宽 + 字间距，保证文字永不粘连；行方向间距 = 字号 + 行间距（下限 1.3 倍字号）。
- 批量：拖入或点击多选（`accept="image/*" multiple`），逐张生成缩略图，支持单张下载、删除、清空，以及「打包全部」内存 ZIP（文件名 `批量水印-YYYYMMDD-HHmmss.zip`，复用 `zipBatch`）。

**视频水印**（`videoWatermark.js` 纯计算 + `dom.js` 录制）：

- 水印在画面内持续漂移：`floatPosition` 用两路不同频率的正弦叠加（相位由固定 `seed` 决定，轨迹可复现），中心点被夹在「画面内减去文字框」的范围内，永远不会飘出画面。速度滑杆按 px/s 折算成角频率，手感线性。
- 透明度呼吸：`watermarkAlphaAt` 用 `0.5 - 0.5cos(2πt/period)`，从下限平滑升到上限再回落。默认下限 15%、上限 35%；周期默认 4s（滑杆 1~20s，越小变得越快）。上下限互斥，拖过头会推开另一侧并保留 1% 间隙。
- 可调参数：文字 / 字号（16~160px）/ 漂移速度（0~400 px/s）/ 透明度下限（5~50%）/ 上限（20~80%）/ 变化周期（1~20s）。滑杆改动只更新内存与数值标签，不重绘整页，预览立刻生效。
- 实时预览：`#watermark-video-preview` 画布 + `requestAnimationFrame` 循环，有视频就逐帧画视频（`containRect` 等比居中）并叠水印，没视频就在深色渐变底上演示漂移；切页即停。
- 导出：`renderWatermarkedVideo` 用隐藏 `<video>` 实时播放，逐帧 `drawImage` 到离屏画布并 `drawVideoWatermark`，再 `canvas.captureStream(fps)` + `MediaRecorder` 录成 webm（`pickVideoMime` 依次尝试 vp9/vp8/webm/mp4）。画布长边上限 1920（`VIDEO_WATERMARK_MAX_LONG`），源视频分辨率再高也等比缩小，防止实时录制卡死。
- 批量：一次可拖入多个视频；「生成」单个导出，「全部生成」逐个串行导出（同时实时录制会吃满 CPU），导出/打包/删除均按条独立。打包走通用 `zipFiles`（文件名 `批量视频水印-YYYYMMDD-HHmmss.zip`，视频原名换成 `-vm.webm`）。

### 12.6 动态壁纸（`src/wallpaper.js` + `colorGrade.js` + `exportVideo.js`）

四端裁剪 + 调色 + 4K 超分导出，把一张基础图（或微动视频）变成四个平台的高清循环短视频。

- **四端比例**（`WALLPAPER_PLATFORMS`）：PC 16:9（1920×1080）、手机 9:20（864×1920）、安卓平板 16:10（1920×1200）、iPad 4:3（1920×1440）。
- **焦点裁剪**（`cropForFocus` / `focusDeltaFromDrag`）：`object-fit: cover` 语义，全局焦点 `(fx, fy)` 四端联动；在任一预览框拖拽，位移换算成焦点增量，四端同步重定位。
- **实时调色**（`colorGrade.js`）：16 参数、范围 -100~100，默认 0 —— 色彩（色温/色调/饱和度/自然饱和度）、明度（亮度/对比度/高光/阴影/白色/黑色）、效果（光感/锐化/清晰/颗粒/褪色/暗角）。纯函数逐像素实现（`applyGrading`），预览与导出用同一引擎，保证所见即所得。
- **预览**：4 个 `<canvas>` 按平台比例渲染（长边 440px）。图片源「裁剪+调色」底图只缓存重算（focus/参数变化时）；视频源逐帧重建。`requestAnimationFrame` 循环，切页即停。
- **导出**：成片由本机后端确定性渲染——`POST /api/wallpaper/source` 上传母版一次，`POST /api/wallpaper/export`（单端同步）或 `/api/wallpaper/export-all`（四端 `asyncio` 并行 + 打包 zip）交付。后端用 ffmpeg 一条 filter 链完成 `crop→scale→lut3d→锐化/清晰/颗粒/暗角`，前端只做裁剪/调色预览与参数交互，不再录制 Canvas。

---

### 12.7 动态壁纸2（`src/wallpaper2.js`，现已并入「动态壁纸」页）

> 路由层面的 `wallpaper2` 已经不存在了：`index.html` 的 `#page-wallpaper` 就是这条流水线（① 上传立绘/视频 → ② 生成待机循环 → ③ 重处理 → ④ 四端裁剪调色导出），本节讲的是其中「万相首尾帧出待机循环 + 重处理」这一段，代码仍在 `src/wallpaper2.js`。

上传一张角色立绘，让通义万相按**首尾帧**生成全身柔性待机循环视频（默认 6 秒）；首帧与尾帧传同一张图，因此首尾画面严格一致，可直接当无缝循环壁纸。

- **模型**（`WALLPAPER2_MODELS`）：`wan3.0-video-prime`（优速版，默认）/ `wan3.0-video`（标准版）。万相 3.0 是 All-in-One 模型，同一个 ID 覆盖文生视频 / 首帧 / 首尾帧，靠 `input.media` 的 `type` 组合路由。
  - 旧代码里的 `wan2.1-flf2v` 是**开源权重名，百炼没有这个 model ID**；`wan2.7-i2v` 已被 3.0 取代。两者现在都会被 `build_video_payload` 显式拒绝。
- **请求体**（`build_video_payload`）：`input.media = [{type:"first_frame",url},{type:"last_frame",url}]`，`parameters` 用 `resolution`（480P/720P/1080P，默认 720P）+ `ratio`（默认 `adaptive`，跟随源图比例）+ `duration`（2~30，默认 6）+ `audio:false`（壁纸不要音轨）+ `prompt_extend:false`（保留提示词原意）+ `watermark:false`。负向词折成独立的 `【负向清单】` 段落拼在 prompt 尾部（万相 3.0 官方公式的写法，不是英文 `Negative prompt:` 前缀）。
- **待机提示词**（`buildWallpaper2Prompt(duration)`）：按万相 3.0 官方公式写——`生成单镜头 + 一镜到底 + 固定机位`（2.7 起没有 `shot_type` 参数，只能靠提示词锁单镜头），再分【主体】【场景】【整体动态原则】【动作幅度阶梯】【传导与物理】【呼吸】【面部】【色彩与光影锁定】【镜头】【画质】。
- **核心概念：全身柔性待机（whole-body soft idle）**。不是「呼吸 + 眨眼 + 发丝」几个并列事件，而是**一条连续的力**：地面 → 脚踝 → 膝 → 髋 → 腰 → 胸 → 肩 → 颈 → 头 → 发梢，以及 肩 → 肘 → 腕 → 指尖 与 腰 → 衣摆。每一级比上一级晚一点、小一点，逐级衰减，没有一级在自己先动。并列事件会被模型当成「一段表演」，在首尾同帧的循环里逐帧复刻，这就是机械感的机制性来源。
- **振幅阶梯**（越到末端越大越晚，这是「柔」而不是「一起晃」）：
  | 部位 | 上限 | 延迟 |
  | --- | --- | --- |
  | 脚 / 踝 | 重心左右转移 ≤ 2mm，脚跟不离地 | 0 |
  | 膝 | 缓冲浮动 ≤ 1mm，不弯曲变化 | 略滞后 |
  | 髋 / 腰 | 横向 ≤ 3mm，骨盆微侧倾，躯干旋转 ≤ 1° | 主驱动 |
  | 胸 / 肩 | 胸部起伏 ≤ 1cm，肩线高差 ≤ 3mm | — |
  | 颈 / 头 | 倾斜 ≤ 1.5°，位移 ≤ 6mm | 0.4s |
  | 手臂 / 手 | 被躯干带着走，肘部极小内外浮动 | 0.2s（比肩线再晚） |
  | 发梢 / 衣摆 / 袖口 | 末端 1~1.5cm，丝带式连续流动 | 0.3~0.6s |
- **非机械性的三条硬约束**：① 速度是平滑正弦（缓入缓出），无停顿、无爆发、无节拍感；② **不要钟摆式匀速对称来回摆**，左右两侧幅度与时机必须有细微差异，看起来不对称、不可预测；③ 首尾处的运动速度同样平缓，避免循环边界「跳一下」或回弹。
- **色彩与光影锁定**：调色板 / 白平衡 / 曝光 / 亮度 / 饱和度 / 对比度 / 色温 / 暗部高光分布，**每一帧都与首帧完全一致**；主光方向、强度、阴影位置、边缘光形状全程不变；禁止逐帧亮度呼吸、色彩渐变、光斑移动、阴影漂移、背景色温变化、整体闪烁。动作再小，只要整体明暗在动，眼睛一样判定为假。
- **时长**（`WALLPAPER2_DURATIONS = [4, 6, 8]`，默认 6）：全身重心一个来回 ≈ 6~10 秒，静息呼吸 ≈ 4~5 秒。周期越长，同样的位移需要越慢的速度，越柔。**2 秒已移除**——它把呼吸压成 30 次/分，是旧版机械感的头号来源。
- **眨眼**：放在整段约 62% 处（黄金分割附近），避开首尾帧，否则会变成一个可见的「节拍点」。
- **负向清单**（`WALLPAPER2_NEGATIVE_PROMPT`）：按官方思路分镜头 / 动作 / 节奏 / 色彩 / 身份 / 画质六组，并补上实际翻车点——`机械式周期性重复同一个动作`、`钟摆式匀速摆动`、`节拍感`、`夸张肢体动作`、`亮度忽明忽暗`、`色彩漂移`、`阴影晃动`。
- **编排**（`runAsyncVideoJob`）：`POST /api/video-gen` 建任务 → 轮询 `/status` → 拉 `/result` 的 blob；补帧复用同一套编排打 `/api/interpolate`（RIFE → 60FPS）。
- **一键处理流水线**（`processWallpaper2`）：生成只返回模型原片，用户先看动作对不对；确认后点「一键处理」，按固定顺序跑三步，结果留在面板里预览、**不自动下载**，确认了再点「下载成片」。
  1. **色彩锁定** `POST /api/color-lock`（同步，6 秒 720P 约 5 秒）：消除整段明暗/色温漂移。
  2. **补帧 60FPS** `POST /api/interpolate`（RIFE，异步轮询，内部多 stream 并行）。
  3. **4K 超分** `POST /api/upscale`（`animevideov3`，异步轮询）。
  - **顺序不可换**：锁色必须在补帧之前——先补帧会把亮度跳变插值成一团糊；超分放最后——先放大再补帧会让帧数翻倍的同时显存翻倍。
  - **倍率**：源片是 720P，放大 2 倍只有 1440P 不算 4K，`WALLPAPER2_UPSCALE_SCALE = 3` 才真正到 3840×2160。
  - **容错**：① 失败只标记「跳过」并继续，画质增强不该让整条流水线白跑；②③ 失败才中断。`X-Color-Locked: 0` 时前端如实显示「无需调整/跳过」，不谎报。
- **补帧并行**（`server/rife_parallel.py`）：内部开 N 条线程、每条一条独立 CUDA stream，共享同一份 RIFE 权重（多进程会让权重和 CUDA context 各占一份，8GB 卡上不划算）。
  - **加速来自多 stream，不来自批推理**：720P 单路的 GPU 利用率只有约 51%，所以并发能把空转填上；而把多对图打包成一次 forward 实测无效——batch=1/2/4/6 分别是 73.9/78.1/79.4/79.6 ms/对，batch=8 直接顶到 6.5GB、退化到 438ms/对。
  - **实测（RTX 4060 Laptop 8GB，1280×720）**：1/2/3/4/6 路 = 73.9/58.0/51.2/49.3/53.1 ms/对，显存 827/1536/2333/2950/4433MB。**4 路是拐点**，所以默认 `RIFE_WORKERS=4`（上限 6）。
  - **1080P 另算**：单对 175ms、3 路反而掉到 386ms/对（带宽先打满），所以像素数 ≥ `1_200_000` 时自动收到 2 路。
  - **还会按空闲显存再收窄**：`estimate_worker_count` 用 `free - 900MB` 除以每路约 `850 B/像素` 得出能开几路；真 OOM 时逐级减半路数、再减 `rife-scale`，不会崩掉任务。
  - **切段不能错**：第 k 对图只归一条 stream，它写中间帧 `f_{2k+2}` 和原始第 k+1 帧 `f_{2k+3}`，首帧单独写 `f_000001`。这样每个输出帧有且只有一个生产者，不用重编号——`workers=1` 与 `workers=4` 的成片逐帧最大平均像素差 0.47（cuDNN 算法差异），无重复/丢帧。
  - **PNG IO 也并行**：解码/编码走线程池（`RIFE_IO_WORKERS=6`），每段只预读 2 帧，既不饿死 GPU 也不让某一段独占 IO 池。
- **选择**：默认走 `server/rife_parallel.py`；`INTERPOLATE_PARALLEL=0` 或显式给了 `INTERPOLATE_SCRIPT` 时才退回 skill 的 `interpolate_video.py`（单对串行）。两者共用 skill 的权重与 `load_rife`，不复制模型。
- **逐帧色彩锁定**（`lock_video_colors` + `handle_color_lock`）：极静画面里模型的头号破绽不是动作，而是**整段在极缓慢地一明一暗**、或色温从头到尾轻轻漂移；动作再柔，只要整体明暗在动，眼睛立刻判定为假。
  - 做法：`ffmpeg` 解成 RGB24 → 每帧算 RGB 均值 → 以**整段中位数**为基准算增益 → 增益曲线做 0.4 秒滑动平均 → 第二次解码时施加增益并用 `libx264 -crf 16 -preset veryfast` 重编码。6 秒 720P 实测约 4.8 秒。
  - 为什么基准取中位数而不是首帧：首帧万一是黑场淡入、或模型第一帧有瞬时瑕疵，以它为基准会把整段拉黑。中位数对个别异常帧免疫，仍能保证段内色调统一。
  - 为什么要平滑增益：逐帧硬对齐会把「袖子摆动导致的真实明暗变化」也压平，反而制造出新的抖；要消的是**低频漂移**。
  - 增益限幅 `0.8~1.2`，任何一步失败（缺 numpy / 缺 ffmpeg / 探测失败 / 编码失败）都**原样返回原视频**。`WALLPAPER_COLOR_LOCK=0` 可整段关掉这道后处理。
- **一次一版**：点「生成视频」只发一路请求（6 秒视频按次计费，并出两版等于双倍成本）。出片后自动选中，立刻开放「补帧至 60FPS」与「4K 超分」（`upscaleBlob`，后端 super-resolution-service）；不满意就再点一次重新生成，由用户自己决定要不要付第二次。
- **上传反馈**：`paintWallpaper2` 把 `wallpaper2Source` 落到缩略图 + 文件名，上传区边框转实线高亮，「生成」按钮在无图时禁用。
- **端点可配**：`DASHSCOPE_VIDEO_BASE` 可整段替换视频接口 base（2026 文档给的是业务空间专属域名 `https://{WorkspaceId}.{region}.maas.aliyuncs.com/api/v1`），不设则用经典 `https://dashscope.aliyuncs.com/api/v1`。

### 12.8 任务队列（`src/tasks.js` + `src/taskview.js` + `server/tasks.py`）

长任务（生图、壁纸批处理与四端导出）不在浏览器里跑，改成**服务端队列**：浏览器只提交步骤计划，然后 1 秒轮询进度；刷新或关页不会打断任务，重开任务页进度还在。

- **两个池**（`POOLS`）：`main`（一般生成 / 微调）与 `wallpaper`（动态壁纸）。**池间并行、池内串行**——每个池只有一条常驻 worker 线程，任务与任务之间排队，任务内部的各个 step 也串行（生图一张一张出，壁纸一步接一步跑）。
- **队列上限** `QUEUE_MAX = 64`：满了直接 `503` 并把 `pool`/`limit` 回给前端，不假装接收。
- **任务种类**（`TASK_*`，等于 runner 注册键，不等于界面上的标题）：`image` / `wallpaper-batch` / `wallpaper-export`。
- **状态**（`STATUS_*`）：`queued` / `running` / `done` / `partial` / `failed` / `skipped` / `cancelled`；终态是 `done`、`partial`、`failed`、`cancelled`（`skipped` 是单步状态，不是终态）。
- **持久化**：`tasks` 表（`db.py`）存任务状态、计数（`total`/`done`/`failed`/`skipped`）、`unit`、`progress`、`steps`、`results`、起止时间，刷新页面仍看得到；提交时的原始载荷另存成 `data/tasks/<id>/payload.json`（`/api/tasks/<id>/payload` 读它，前端刷新后重试失败项要用），产物也落在 `data/tasks/<id>/`。
- **看板**（`taskview.js`，纯视图可单测）：三栏「已完成·部分完成 / 全部失败 / 正在队列中」，栏内按 `created_at` 倒序、每页 5 条各自分页；页顶三个标签按池筛选（全部 / 生成队列 / 壁纸处理队列）。另有状态中文映射、进度百分比、耗时、产物文件名与「可重试」判定。
- **为什么放在服务端**：壁纸的 4K 超分与补帧要跑几分钟，浏览器标签页随时可能被关；放服务端才能「提交完就去干别的，回来收结果」。

---

## 13. 后端 API 与配置

### 13.1 路由（`server/app.py` 的 `dispatch`）

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/` `/index.html` | 静态首页 |
| GET | `styles/` `src/` `assets/` 前缀 | 静态资源 |
| POST | `/api/generate` | 单张生图（JSON，非流式） |
| POST | `/api/generate-stream` | 批量流式生图（SSE，`jobs` 数组） |
| POST | `/api/translate-color` | HEX 颜色翻译 |
| GET | `/api/chibi-style` | 返回 Q版风格参考图数组 |
| GET | `/api/gallery` | 历史图片列表 |
| POST | `/api/gallery/delete` | 按 id 删除图片 |
| GET | `/api/image` | 远程图片代理（打包用） |
| POST | `/api/video-gen` | 动态壁纸2：建万相视频任务（异步，返回 `taskId`） |
| GET | `/api/video-gen/status` | 查询视频任务状态（`running` / `done` / `error` / `cancelled`） |
| GET | `/api/video-gen/result` | 取生成好的 mp4 |
| POST | `/api/video-gen/cancel` | 取消视频任务 |
| POST | `/api/interpolate` | 补帧至 60FPS（RIFE）任务 |
| GET | `/api/interpolate/status` `/api/interpolate/result` | 补帧状态 / 结果 |
| POST | `/api/color-lock` | 逐帧色彩锁定（同步返回 mp4，响应头 `X-Color-Locked` 表示是否真的改动） |
| POST | `/api/upscale` | 4K 超分任务 |
| GET | `/api/upscale/status` `/api/upscale/result` | 超分状态 / 结果 |
| POST | `/api/wallpaper/source` | 上传动态壁纸母版（每个母版只传一次） |
| POST | `/api/wallpaper/export` | 单端同步导出（ffmpeg 一条滤镜链：crop→scale→lut3d→锐化/清晰/颗粒/暗角） |
| POST | `/api/wallpaper/export-all` | 四端并行导出 + 打包 zip |
| GET | `/api/wallpaper/export-all/status` `/api/wallpaper/export-all/result` | 四端导出状态 / 结果 |
| POST | `/api/wallpaper/export-all/cancel` | 取消四端导出 |
| GET | `/api/tasks` | 任务列表（`?pool=main\|wallpaper&limit=N`） |
| POST | `/api/tasks` | 提交任务（步骤计划 + `pool`；池满返回 503） |
| GET | `/api/tasks/<id>` | 任务详情（前端 1 秒轮询进度的地方） |
| GET | `/api/tasks/<id>/result` | 取任务产物 |
| GET | `/api/tasks/<id>/payload` | 取任务提交时的参数快照（重试用） |
| POST | `/api/tasks/<id>/cancel` | 取消任务 |
| DELETE | `/api/tasks/<id>` | 删除任务记录 |

### 13.2 环境变量

| 变量 | 用途 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 千问文生图 + 颜色翻译 + 万相视频生成 |
| `DASHSCOPE_VIDEO_BASE` | 可选，替换视频接口 base（如 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api/v1`）；不设用经典 dashscope 域名 |
| `4S_API_KEY` | Gemini（4sapi.org）生图 |
| `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`（或 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`） | OSS 凭证 |
| `OSS_ENDPOINT` | 如 `https://oss-cn-hangzhou.aliyuncs.com` |
| `OSS_BUCKET` | Bucket 名称 |
| `OSS_PUBLIC_URL_BASE` | 可选，公开访问前缀 |
| `GENERATE_MOCK=1` | 生图 mock（返回 1×1 PNG，不访问网络） |
| `TRANSLATE_MOCK=1` | 翻译 mock |

启动时 `startup_lines` 只报告密钥是否在，绝不打印密钥；`oss_connection_lines` 探测 OSS 连通性（endpoint/凭证/Bucket 区域是否匹配）。日志统一走 `_log`，密钥与图片正文一律脱敏/截断。

> **坑：从已运行的宿主进程里启动会「误报未配置密钥」。** 这些变量配在**用户级**环境（不是系统级），`run.bat` 从资源管理器双击启动时会拿到最新值；但如果从 DSH / Cursor 这类**先于配 key 就已启动**的进程里 `python server/app.py`，子进程继承的是宿主那份旧环境，启动日志会显示「未读取到 API Key / 未配置 OSS」，而实际上变量是有的。此时先显式注入再启动：
>
> ```powershell
> foreach ($n in 'DASHSCOPE_API_KEY','4S_API_KEY','ACCESS_KEY_ID','ACCESS_KEY_SECRET','OSS_ENDPOINT','OSS_BUCKET') {
>   $v = [Environment]::GetEnvironmentVariable($n,'User'); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n,'Machine') }
>   if ($v) { Set-Item -Path "Env:$n" -Value $v }
> }
> python -X utf8 server\app.py
> ```
>
> 判断依据：`[Environment]::GetEnvironmentVariable('名字')` 默认只查**当前进程**作用域，必须显式传 `'User'` / `'Machine'` 才能看到真实配置。

---

## 14. 测试

**JS**（`npm test`，`node --test`，当前 **308 通过 / 0 失败**）：

| 文件 | 覆盖 |
| --- | --- |
| `state.test.js` | 状态默认值、sanitize、持久化、迁移 |
| `catalog.test.js` / `rules.test.js` | 选项表、显隐、联动、姿势兼容、宽高比 |
| `clothing.test.js` | 服饰节点、门禁、迁移、提示词 |
| `view.test.js` | 视图模型、按钮/画幅/风格 |
| `prompts.test.js` | 各图种提示词、手部拆解图、微调、Nano 补丁、手部取色 |
| `generate` 相关（`gallery.test.js` 等） | 生图请求拼装、参考图、配对、并发 |
| `dom.test.js` | 渲染、交互、生图流程、拖拽上传、下载页、微调三图上传、壁纸页接线 |
| `wallpaper.test.js` / `wallpaper2.test.js` | 调色引擎、四端裁剪/焦点、循环时长、万相待机提示词与补帧/超分编排 |
| `gradeLut.test.js` / `exportVideo.test.js` | 调色参数→滤镜串、录制与 4K 超分编排 |
| `taskview.test.js` | 任务看板三栏分组、状态文案、分页、文件名、重试判定 |
| `download.test.js` / `face.test.js` / `theme.test.js` / `colorTranslate.test.js` | 打包、锁脸、主题、颜色翻译 |

**Python**（`pytest`，当前 **161 通过**）：`tests/test_server.py` 覆盖 `calc_size`、`build_payload`/`build_gemini_payload`、`handle_generate`（mock）、`generate_stream_events` 并发与停止、图库、翻译、静态解析、OSS 连通性、`handle_upscale` 超分任务（含 mock 脚本）；`tests/test_tasks.py` 覆盖任务队列的两个池、上限 503、取消与删除；`tests/test_rife_parallel.py` 覆盖补帧切段与并行路数估算。

---

## 15. 已知限制与待办

1. **完整设定集不含手部拆解图**：`generateSuite` 的 `SUITE` 仍为「三视图 → 表情差分图 → 服饰拆解图 → Q版」四张。手部拆解图只能单次生成。
2. **下载页无手部拆解图独立分页**：`index.html` 标签只有「全部 / 基准立绘 / 服饰基准」，手部拆解图只在「全部」里可见。
3. **Q版风格参考图目录**：服务端实际读 `assets/q_photos_reference`（当前 2 张）；`assets/chibi-style` 为空占位。
4. **前端颜色翻译默认走本地 mock**：`main.js` 未注入 `translateFetcher` 时，`translateColorName` 用 `mockTranslateColor`（本地 HSL 映射 + 300ms 延迟）；真实 `/api/translate-color` 链路已实现，需在挂载时注入 `fetcher` 才启用。
5. **生图不可中断**：`urllib` 无法中断已在跑的请求，「停止生成」只能取消排队任务、丢弃在跑结果，真正调用的那次 HTTP 仍需等其返回。
6. **换衣页已彻底移除（2026-11-06）**：那条链路（`换衣三视图` / `换衣头部三视图` / `换衣基准立绘` 三个图种、三套提示词、`modelForDressup`、整页 UI、约 190 行代码 + 10 条测试）因出图效果不达标，已连同导航、路由、样式、任务队列跳转一起删除。
   - 自查：`grep -rn '换衣\|dressup' src server tests styles index.html` 应为空。
   - 想找回：`git log --all --oneline -- src/dom.js | head`，最后含它的提交是 `3f6b903`。
7. **两份文档的口径要一起维护**：本文档是唯一事实来源，改动功能后必须同步 §3 目录、§4 路由表、§13 路由表、§14 测试条数（这三处历史上都漂过）。
