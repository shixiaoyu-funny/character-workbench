# 角色设定工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在浏览器里做一个三栏角色设定工作台：选项自动存本地、按设定图种类拼提示词、调用百炼生图，并提供单张下载和按批次打包。

**Architecture:** 无构建步骤的原生 ES modules。纯函数负责状态、联动、提示词、压缩包；`src/dom.js` 只负责渲染。Python 标准库在 `127.0.0.1` 提供静态页和生图接口，API Key 只留在服务端。图片、提示词、种子、参考图只放页面内存。

**Tech Stack:** HTML/CSS、原生 ES modules、Node.js 内置 `node:test`、Python 3.11 `http.server`、阿里云百炼 `qwen-image-3.0`。

## Global Constraints

- 工作目录是 `D:\计算机资料\AI_Game\ai_role_gen`。不要改 `PLAN.md`。不要引入 React、打包器或 CSS 框架。
- 页面 `100vh`，页面本身不滚动，只有栏内或下载页列表滚动。
- CSS 变量白天：背景 `#f4f5f7`、面板 `#ffffff`、文字 `#2c2c34`、强调色 `#d6336c`。黑夜：背景 `#121216`、面板 `#1c1c24`、文字 `#e8e8ee`、强调色 `#ff4d8d`。背景、面板、文字、强调色 `transition: 0.3s`。
- `localStorage` 键：`theme`、`myCharacterConfig`、`myCharacterFaceBackup`。图片、Base64、对象 URL、种子、基准图不得进这些键。
- 成功保存提示原文「配置已保存到本地」，同一次页面会话只提示一次。容量失败提示原文「保存失败」。
- 重置确认原文「是否清除本地保存的角色配置并恢复默认？」。重置删除 `myCharacterConfig`，不删除 `theme`，然后 `location.reload()`。
- 锁脸说明原文「已开启锁脸模式，当前角色的面部与妆容将由参考图决定。」
- 颜色过多警告原文「颜色过多可能导致AI出图画面杂乱，建议精简颜色。」
- 躺/趴警告原文「躺/趴姿势搭配平视容易出图失败，建议改为俯视。」
- 帽子提示原文「帽子可能遮挡部分发型。」
- 未设基准时点非基准按钮的状态原文「尚未设定角色基准，本次不会锁定脸。」
- 一键全套在没有基准并完成 4 张基准立绘后的状态原文「请选择一张基准立绘，并设为当前角色基准。」
- 下载页空状态原文「还没有生成图片」。
- 服务只绑定 `127.0.0.1`。模型固定 `qwen-image-3.0`，分辨率固定 `1k`，`prompt_extend` 为 false。不要把 API Key 写进仓库或日志。
- 测试必须断言行为。禁止只写 `assert.ok(true)` 或没有断言的测试。
- 每个任务先写失败测试，看到失败后再写实现。提交信息不要带 Cursor 相关 trailer。

## File Structure

- `index.html` — 工作台和下载页的骨架。
- `styles/app.css` — 主题和三栏布局。
- `src/theme.js` — 主题解析。
- `src/state.js` — 默认状态、校验、防抖保存。
- `src/catalog.js` — 选项、英文标签、配色预设。
- `src/rules.js` — 显隐、禁用、警告、联动修正。
- `src/prompts.js` — 五种设定图的正负向提示词。
- `src/face.js` — 参考图锁脸的备份与清空。
- `src/gallery.js` — 内存中的批次、选中图、基准图。
- `src/download.js` — 单张文件名与 ZIP。
- `src/view.js` — 纯视图模型。
- `src/dom.js` — 渲染与事件。
- `src/generate.js` — 浏览器侧生图请求。
- `src/main.js` — 启动。
- `server/app.py` — 静态文件与 `/api/generate`。
- `assets/chibi-style/` — Q 版风格参考图目录，可以为空。
- `tests/*.test.js`、`tests/test_server.py` — 测试。

---

### Task 1: 主题外壳

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `styles/app.css`
- Create: `src/theme.js`
- Create: `tests/theme.test.js`
- Create: `assets/chibi-style/.gitkeep`

**Interfaces:**
- Consumes: 无。
- Produces: `resolveTheme({ stored, prefersDark })` 返回 `'light'` 或 `'dark'`。`nextTheme(current)` 在两者间切换。`index.html` 含 `#theme-toggle`、`#reset`、`#workbench`、`#col-left`、`#col-center`、`#col-right`、`#download-view`、`#download-back`、`#download-list`、`#toast`。

- [ ] **Step 1: Write the failing test**

创建 `tests/theme.test.js`：

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { nextTheme, resolveTheme } from '../src/theme.js';

test('stored theme wins over the system', () => {
  assert.equal(resolveTheme({ stored: 'dark', prefersDark: false }), 'dark');
  assert.equal(resolveTheme({ stored: 'light', prefersDark: true }), 'light');
});

test('missing or unknown theme follows the system', () => {
  assert.equal(resolveTheme({ stored: null, prefersDark: true }), 'dark');
  assert.equal(resolveTheme({ stored: '', prefersDark: false }), 'light');
  assert.equal(resolveTheme({ stored: 'blue', prefersDark: false }), 'light');
});

test('next theme toggles', () => {
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');
});

test('shell matches the workbench contract', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  for (const id of ['theme-toggle', 'reset', 'workbench', 'col-left', 'col-center', 'col-right', 'download-view', 'download-back', 'download-list', 'toast']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /src="\/src\/main\.js"/);
  for (const color of ['#f4f5f7', '#ffffff', '#2c2c34', '#d6336c', '#121216', '#1c1c24', '#e8e8ee', '#ff4d8d']) {
    assert.match(css, new RegExp(color, 'i'));
  }
  assert.match(css, /100vh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /grid-template-columns:\s*20%\s+45%\s+35%/);
  assert.match(css, /0\.3s/);
});
```

创建 `package.json`：

```json
{
  "name": "ai-role-gen",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "start": "python server/app.py"
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/theme.test.js`

Expected: FAIL because `src/theme.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

`src/theme.js`：

```javascript
export function resolveTheme({ stored, prefersDark }) {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function nextTheme(current) {
  return current === 'dark' ? 'light' : 'dark';
}
```

`index.html` 使用中文 `lang="zh-CN"`。固定顶栏放 `#theme-toggle`（初始文字 `🌙`）和 `#reset`（文字 `重置`）。`#workbench` 内三个区域依次为 `#col-left`、`#col-center`、`#col-right`。`#download-view` 带 `hidden`，里面有 `#download-back`（文字 `返回工作台`）和 `#download-list`。`#toast` 为空。底部 `<script type="module" src="/src/main.js"></script>`。`src/main.js` 本任务只写一行注释占位：`// started in a later task`，避免 404 被测试要求，但不要实现应用。

`styles/app.css`：

```css
:root[data-theme="light"] {
  --bg: #f4f5f7;
  --panel: #ffffff;
  --text: #2c2c34;
  --accent: #d6336c;
}
:root[data-theme="dark"] {
  --bg: #121216;
  --panel: #1c1c24;
  --text: #e8e8ee;
  --accent: #ff4d8d;
}
body {
  margin: 0;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  transition: background 0.3s, color 0.3s;
}
.topbar { position: fixed; top: 12px; right: 12px; z-index: 20; display: flex; gap: 8px; }
.workbench { display: grid; grid-template-columns: 20% 45% 35%; height: 100vh; }
.col, #download-view { height: 100%; overflow: auto; background: var(--panel); transition: background 0.3s, color 0.3s; }
button { color: var(--text); }
button[aria-pressed="true"] { background: var(--accent); color: #fff; }
```

`assets/chibi-style/.gitkeep` 为空文件。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/theme.test.js`

Expected: PASS，输出无警告。

- [ ] **Step 5: Commit**

```bash
git add package.json index.html styles/app.css src/theme.js src/main.js tests/theme.test.js assets/chibi-style/.gitkeep
git commit -m "feat: add themed workbench shell"
```

---

### Task 2: 配置状态与自动保存

**Files:**
- Create: `src/state.js`
- Create: `tests/state.test.js`

**Interfaces:**
- Consumes: 无。调用方稍后传入 `applyLinkage`。
- Produces:
  - `defaultState()` 返回深拷贝。
  - `sanitizeState(value)` 合法则返回补齐后的状态，否则返回 `null`。
  - `createStore({ storage, schedule, applyLinkage, onToast, delay })`。
  - `schedule.in(ms, fn)` 返回 id；`schedule.cancel(id)`。
  - `store.getState()`、`store.replace(next)`、`store.hydrate()`、`store.flush()`、`store.subscribe(fn)`。
  - 保存键是 `myCharacterConfig`。

默认状态必须是：

```javascript
{
  gender: '女', age: '少女', race: '人类', role: '日常休闲', crossdressing: false,
  faceShape: '鹅蛋脸（标准）', eyeShape: '杏眼（标准）', pupil: '圆形瞳', eyebrow: '细平眉',
  mouth: '嘴角上扬（默认微笑）', nose: '小翘鼻（默认）', facialFeatures: [], skin: '自然肤色',
  hairLength: '中长发', hairStyle: '双马尾（高/低）', ahoge: false, bangs: '空气刘海',
  hairColor: '黑', hairColorExtra: [],
  blush: '轻微（眼下微红）', eyeMakeup: [], lipstick: '自然色', specialMakeup: [],
  top: '衬衫', bottom: '百褶裙', outerwear: '无', onePiece: '无', shoes: '小皮鞋', socks: '无', materials: [],
  hat: '无', feminineAccessories: [], masculineAccessories: [], fantasyAccessories: [],
  faceNeck: [], handsBack: [], handheld: [],
  colorPreset: '', mainColors: [], accentColors: [], backgroundColor: '#ffffff',
  pose: '站立', handPose: '自然下垂', headDirection: '正面平视', gazes: ['看着镜头'],
  eyeEmotions: [], mouthStates: [], effectSymbols: [],
  shot: '全身像', camera: '平视', background: '纯色背景', lighting: '默认柔光', visualEffects: [],
  baseAspect: '3:4', turnaroundAspect: '16:9', clothingAspect: '1:1'
}
```

`backgroundColor` 是纯色背景的可选颜色，字符串，不是图片。

- [ ] **Step 1: Write the failing test**

`tests/state.test.js` 覆盖：

1. `defaultState()` 两次调用互不污染，`gender` 为 `女`，`gazes` 深相等 `['看着镜头']`。
2. `sanitizeState` 接受完整合法对象并返回拷贝。
3. `JSON.parse` 失败的调用方不在此函数；`sanitizeState('x')`、`null`、数组返回 `null`。
4. 缺任一默认键、字符串字段给了数组、数组字段给了字符串、布尔字段给了字符串，都返回 `null`。
5. 出现键 `image`、`images`、`base64`、`dataUrl`、`objectUrl`、`seed`、`reference`、`baseImage`，或任一字符串以 `data:image/`、`blob:` 开头，或任一字符串长度超过 500，返回 `null`。
6. 多余键被丢掉，不导致失败。
7. `createStore`：用内存 storage 和手动 `schedule`。`replace` 后 `delay` 必须是 `1000`。取消前一次定时，只执行最后一次。第一次成功写入后 `onToast` 收到「配置已保存到本地」，第二次成功写入不再调用 `onToast`。
8. `storage.setItem` 抛错时，`onToast` 收到「保存失败」，并且这次失败不吃掉之后的成功提示配额：失败后下一次成功仍然要提示，如果成功提示还没出现过。若成功提示已经出现过，失败仍要提示「保存失败」。
9. `hydrate` 无数据时用默认状态，不写 storage。
10. `hydrate` 有合法 JSON 时恢复，并调用 `applyLinkage`。若联动结果与存储不同，立刻 `setItem` 一次，且这次自动保存也占用成功提示。
11. 存储是坏 JSON、或 `sanitizeState` 失败时，`removeItem('myCharacterConfig')`，内存回到默认状态。
12. `subscribe` 在 `replace` 和 `hydrate` 时被调用。
13. `flush` 立刻执行尚未跑的保存并取消定时。

用下面的假调度器，不要用真实 `setTimeout`：

```javascript
function manualSchedule() {
  const jobs = new Map();
  let n = 0;
  return {
    jobs,
    in(ms, fn) { const id = ++n; jobs.set(id, { ms, fn, cancelled: false }); return id; },
    cancel(id) { const job = jobs.get(id); if (job) job.cancelled = true; },
    run(id) { const job = jobs.get(id); if (job && !job.cancelled) job.fn(); }
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/state.test.js`

Expected: FAIL，`createStore` 或 `sanitizeState` 未定义。

- [ ] **Step 3: Write minimal implementation**

`createStore` 默认 `applyLinkage` 为原样返回，默认 `delay` 为 `1000`，默认 `onToast` 为空函数。`getState` 返回 `structuredClone`。`replace` 先 `applyLinkage` 再保存调度。`hydrate` 按测试语义实现。成功提示用内存标志 `announcedSave`，只在第一次成功时置真。失败提示不看这个标志。键名常量 `CONFIG_KEY = 'myCharacterConfig'` 要导出。

类型表按 `defaultState()` 的运行时类型生成，不要手写第二份键清单。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/state.test.js`

Expected: PASS，输出无警告。

- [ ] **Step 5: Commit**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: persist character options locally"
```

---

### Task 3: 选项目录与联动规则

**Files:**
- Create: `src/catalog.js`
- Create: `src/rules.js`
- Create: `tests/rules.test.js`

**Interfaces:**
- Consumes: `defaultState` from `src/state.js`。
- Produces:
  - `OPTIONS`：每个字段的 `{ value, tag }[]`。`age` 与 `hairStyle` 用总表，显隐由规则决定。
  - `ROLE_GROUPS`：`[{ label, options: [value] }]`。
  - `PRESETS`：24 个预设，字段 `id`、`group`、`name`、`main`、`accent`、`tags`、`swatch`。
  - `COLOR_WORDS`：中文色名到英文。
  - `FACE_FIELDS`：`faceShape, eyeShape, pupil, eyebrow, mouth, nose, facialFeatures, skin, blush, eyeMakeup, lipstick, specialMakeup`。
  - `ASPECT_OPTIONS`：`baseAspect: ['3:4','9:16','1:1']`，`turnaroundAspect: ['16:9','3:2']`，`clothingAspect: ['1:1','4:3']`。
  - `applyLinkage(state)` 返回新对象。
  - `optionVisible(field, value, state)`、`fieldVisible(field, state)`、`optionDisabled(field, value, state)`、`warnings(state)`。

标签用这些值，没列出的选项标签就是其英文小写直译，`无`、`人类`、`常规` 的标签是空字符串：

- 女 `1girl`，男 `1boy`
- 小孩 `child`，少年 `boy`，青年 `young man`，成年 `adult man`，萝莉 `loli`，少女 `girl`，成女 `adult woman`
- 精灵耳 `pointy ears`，兽耳（猫/犬/狐等） `animal ears`，魔族（角/尾巴） `demon horns, demon tail`，天使（光环/羽翼） `halo, angel wings`，亚人（人鱼/蛇身） `mermaid`，机械改造人 `cyborg`，吸血鬼 `vampire`
- 日常休闲 `casual`，学院制服 `school uniform`，都市职场 `office wear`，娱乐圈·偶像 `idol`，悬疑·侦探 `detective`，赛博朋克 `cyberpunk`，西式奇幻（剑与魔法） `western fantasy`，东方古风（仙侠/武侠） `xianxia`，和风（阴阳师/妖怪） `japanese style`，蒸汽朋克 `steampunk`，星际科幻（太空/机甲） `sci-fi mecha`，末世废土 `wasteland`，异世界穿越 `isekai`，哥特洛丽塔 `gothic lolita`，地雷系·亚文化 `jirai kei`，灵异·克苏鲁 `cthulhu`，神话神明 `deity`
- 圆脸（幼态） `round face`，鹅蛋脸（标准） `oval face`，瓜子脸·尖脸（清冷） `sharp chin`，肉肉脸（可爱） `chubby face`，方脸·硬朗（偏男性） `square jaw`
- 杏眼（标准） `tapered eyes`，圆眼（天真） `round eyes`，上挑眼（凌厉·魅惑） `tsurime`，下垂眼（无辜·狗狗眼） `tareme`，半眯眼（慵懒） `half-closed eyes`，死鱼眼（呆板） `dead eyes`，星星眼（高光拉满） `sparkling eyes`
- 圆形瞳 `round pupils`，猫瞳·竖瞳（兽人/恶魔） `slit pupils`，无高光（病娇/三无） `empty eyes`，异色瞳（左红右蓝等可配） `heterochromia`
- 细平眉 `thin eyebrows`，粗平眉 `thick eyebrows`，柳叶眉 `arched eyebrows`，剑眉（英气） `sharp eyebrows`，八字眉（委屈） `sad eyebrows`，挑眉（傲娇） `raised eyebrow`
- 樱桃小嘴 `small mouth`，猫唇（M字唇） `cat lips`，薄唇 `thin lips`，厚唇 `thick lips`，嘴角上扬（默认微笑） `slight smile`
- 小翘鼻（默认） `small nose`，直挺鼻（成熟） `straight nose`
- 泪痣 `mole under eye`，雀斑 `freckles`，虎牙（单颗/双颗） `fang`，小虎牙 `small fang`，面部纹身（可选位置） `face tattoo`，创可贴（鼻梁/脸颊） `bandaid on face`，眼镜（圆框/方框/金丝） `glasses`
- 冷白皮 `pale skin`，自然肤色 `natural skin`，小麦色 `tanned skin`，黑皮 `dark skin`，特殊肤色（精灵白/恶魔灰/病态苍白） `fantasy skin`
- 短发 `short hair`，及肩发 `shoulder-length hair`，中长发 `medium hair`，及腰长发 `hair over waist`，超长拖地发 `floor-length hair`
- 直发 `straight hair`，微卷 `slightly wavy hair`，大波浪 `wavy hair`，双马尾（高/低） `twintails`，单侧马尾 `side ponytail`，丸子头 `hair bun`，麻花辫 `braid`，披肩发 `hair over shoulders`，姬发式 `hime cut`，狼尾（Mullet） `mullet`，碎发 `messy hair`，大背头 `slicked back hair`，飞机头 `pompadour`
- 齐刘海（一刀平） `blunt bangs`，空气刘海 `air bangs`，中分 `center part`，八字刘海 `parted bangs`，斜刘海 `side-swept bangs`，无刘海（露额头） `no bangs`
- 发色：黑 `black hair`，白 `white hair`，银 `silver hair`，金 `blonde hair`，粉 `pink hair`，蓝 `blue hair`，红 `red hair`，紫 `purple hair`，绿 `green hair`，棕 `brown hair`
- `hairColorExtra` 只有两项：挑染 `streaked hair`，渐变发色 `gradient hair`
- `ahoge` 是布尔开关，不是选项列表。为 true 时标签 `ahoge`。所有性别、年龄都可见。
- 腮红：无空标签，轻微（眼下微红） `light blush`，重度（全脸通红） `heavy blush`，横向腮红（微醺/醉酒） `drunk blush`，晒伤妆（鼻梁横跨） `sunburn`
- 眼影（可选颜色） `eyeshadow`，睫毛拉长 `long eyelashes`，浓密睫毛 `thick eyelashes`，卧蚕 `aegyo sal`，泪光 `teary eyes`，眼线（上挑猫眼/下垂无辜眼） `eyeliner`
- 自然色 `natural lips`，咬唇妆（渐变） `gradient lips`，亮面唇釉（水润） `glossy lips`，哑光口红 `matte lipstick`，唇彩颜色可选 `lip gloss`
- 脸颊创可贴 `bandaid on cheek`，鼻梁创可贴 `bandaid on nose`，绷带 `bandage on face`，面部彩绘（可选图案） `face paint`，眼泪（大哭/抽泣） `crying`
- 上装：T恤 `t-shirt`，衬衫 `shirt`，水手服上衣 `serafuku`，西装内搭 `dress shirt`，毛衣 `sweater`，卫衣 `hoodie`，吊带 `camisole`，露脐装 `crop top`，抹胸 `tube top`，制服内搭 `uniform top`
- 下装：百褶裙 `pleated skirt`，包臀裙 `tight skirt`，长裤 `pants`，短裤 `shorts`，牛仔裤 `jeans`，热裤 `hot pants`，阔腿裤 `wide-leg pants`，灯笼裤 `lantern pants`
- 外套：西装外套 `suit jacket`，风衣 `trench coat`，夹克 `jacket`，针织开衫 `cardigan`，斗篷 `cape`，军大衣 `military coat`，披风 `cloak`，机能外套 `techwear jacket`
- 连体：连衣裙 `dress`，洛丽塔洋装 `lolita fashion`，JK制服套装 `jk uniform`，旗袍 `qipao`，和服 `kimono`，女仆装 `maid outfit`，战甲 `armor`，修女服 `nun outfit`
- 鞋子：运动鞋 `sneakers`，小皮鞋 `leather shoes`，马丁靴 `boots`，长筒靴 `knee boots`，高跟鞋 `high heels`，拖鞋 `slippers`，赤脚（需谨慎） `barefoot`
- 袜子：短袜 `socks`，小腿袜 `calf socks`，过膝袜（绝对领域） `thighhighs`，连裤袜（黑丝/白丝） `pantyhose`，渔网袜 `fishnet`，泡泡袜 `bubble socks`
- 材质：蕾丝花边 `lace`，皮革 `leather`，金属反光 `metallic`，破损（战损） `torn clothes`，半透明（需谨慎） `translucent clothes`，发光线条 `glowing lines`
- 帽子：贝雷帽 `beret`，鸭舌帽·棒球帽 `baseball cap`，草帽 `straw hat`，巫师帽 `witch hat`，兜帽 `hood`，军帽 `military cap`，警帽 `police cap`，护士帽 `nurse cap`，女仆头饰 `maid headdress`，圣诞帽 `santa hat`，安全头盔·机甲头盔 `helmet`
- 女生向：蝴蝶结（大/小） `hair bow`，发带 `hair ribbon`，发箍（蕾丝/女仆） `headband`，发卡（十字/星星/心形） `hairpin`，发簪·步摇（古风） `hair stick`，花环（森系） `flower wreath`
- 男生向与女生向重复项只保留一份标签：运动发带 `sweatband`，护额（忍者/运动） `forehead protector`，头戴式耳机（电竞/赛博） `headphones`，战术护目镜 `goggles`，单片眼镜（复古） `monocle`，绷带（战损缠头） `head bandage`
- 奇幻：皇冠（小/大） `crown`，光环（天使） `halo`，恶魔角（双角/独角/弯角） `demon horns`，兽耳（猫/狐/兔/犬，若种族未选可在此叠加） `animal ears`，精灵尖耳（若未选） `pointy ears`，面具（半脸/舞会） `mask`，眼罩（单眼/双眼） `eyepatch`
- 面颈：圆框眼镜 `round glasses`，方框眼镜 `rectangular glasses`，金丝眼镜 `rimless glasses`，口罩 `mask`，面纱 `veil`，Choker项链 `choker`，领带 `necktie`，领结 `bowtie`
- 手背：手套（半指/全指） `gloves`，戒指 `ring`，手链 `bracelet`，翅膀（天使/恶魔/机械） `wings`，披风绑带 `cape strap`，机械臂 `cybernetic arm`，纹身（手臂） `arm tattoo`
- 手持：书本 `holding book`，法杖 `holding staff`，长剑 `holding sword`，匕首 `holding dagger`，枪械 `holding gun`，雨伞 `holding umbrella`，扇子 `holding fan`，玩偶 `holding doll`，捧花 `holding bouquet`，咖啡杯 `holding coffee`，手机 `holding phone`
- 体态：站立 `standing`，坐姿 `sitting`，躺姿 `lying`，趴姿 `lying on stomach`，蹲姿 `squatting`，跪姿 `kneeling`，行走中 `walking`，奔跑中 `running`，跳跃中 `jumping`
- 手：自然下垂 `arms at sides`，单手叉腰 `hand on hip`，双手抱胸 `arms crossed`，单手摸脸·托腮 `hand on own cheek`，比耶(V) `v sign`，挥手 `waving`，双手背后 `arms behind back`，提着裙摆 `holding skirt`，持物（配合道具） `holding item`
- 头：正面平视 `looking at viewer`，侧脸(微侧) `from side`，回眸(回头看) `looking back`，低头 `looking down`，仰头 `looking up`
- 视线：看着镜头 `looking at viewer`，看向侧方 `looking to the side`，闭眼 `closed eyes`，眼神向别处飘（傲娇/走神） `looking away`
- 眼情绪：开心(弯眼) `happy`，生气(皱眉) `angry`，嫌弃(半眯眼) `half-closed eyes`，惊讶(瞪大) `surprised`，悲伤(下垂) `sad`，冷漠(无神) `expressionless`
- 嘴：微笑 `smile`，大笑(张嘴) `open mouth`，撇嘴(嫌弃) `frown`，嘟嘴(生气/可爱) `pout`，抿嘴(紧张) `clenched mouth`，吐舌(调皮) `tongue out`
- 符号：汗滴 `sweatdrop`，青筋(生气) `anger vein`，爱心 `heart`，星星眼(已选可忽略) `sparkling eyes`，泪滴(委屈) `teardrop`
- 景别：全身像 `full body`，半身像(大腿以上) `upper body`，特写(胸部以上) `portrait`，大头贴(Q版专用) `chibi head`
- 镜头：平视(默认) `eye level`，俯视(从高往下看) `from above`，仰视(从下往上看) `from below`，广角(带透视感) `dynamic angle`
- 背景：纯色背景(可自选颜色) `simple background`，透明背景 `transparent background`，教室 `classroom`，城市街道 `city street`，咖啡馆 `cafe`，奇幻森林 `fantasy forest`，赛博霓虹街 `neon street`，废墟 `ruins`，卧室 `bedroom`，星空 `starry sky`，王座 `throne`
- 光：默认柔光 `soft lighting`，逆光(唯美) `backlighting`，顶光(压抑/戏剧性) `top lighting`，霓虹光(赛博感) `neon lighting`，暖色调(黄昏/温馨) `warm lighting`，冷色调(清冷/悬疑) `cold lighting`
- 特效：樱花飘落 `falling petals`，雪花 `snow`，萤火虫 `fireflies`，下雨 `rain`，光斑 `bokeh`，速度线(战斗感) `speed lines`，魔法粒子 `glowing particles`

角色定位分组：

- 现代都市：日常休闲、学院制服、都市职场、娱乐圈·偶像、悬疑·侦探、赛博朋克
- 古典幻想：西式奇幻（剑与魔法）、东方古风（仙侠/武侠）、和风（阴阳师/妖怪）、蒸汽朋克
- 科幻末日：星际科幻（太空/机甲）、末世废土、异世界穿越
- 亚文化与特殊：哥特洛丽塔、地雷系·亚文化、灵异·克苏鲁、神话神明

24 个预设的 `id` 用英文短横线。主色、辅色、附加标签按规格原文：

1. classic-black-red，经典黑红白，主黑/红，辅白/灰，标签 `black skirt, red ribbon, white shirt`，组「经典学院与日常」
2. navy-white，藏青与白，主藏青/白，辅浅灰/浅蓝，`navy blue serafuku, white collar`
3. oat-coffee，燕麦暖咖，主卡其/浅棕，辅白/米色，`beige cardigan, brown skirt, white shirt`
4. black-white，黑白极简，主黑/白，辅银/灰，`black suit, white shirt, monochrome`
5. sakura，樱花草莓，主浅粉，辅白/红，`pastel pink dress, white lace, strawberry motif`，组「甜美与马卡龙」
6. mint，薄荷奶油，主薄荷绿，辅白/浅黄，`mint green clothes, white accent`
7. taro，香芋星云，主浅紫，辅粉/白，`pastel purple hair, pink and white dress`
8. lemon，柠檬苏打，主鹅黄，辅白/浅蓝，`yellow sundress, light blue bow`
9. night-rose，暗夜玫瑰，主纯黑，辅暗红/银，`black gothic dress, dark red accents, silver cross`，组「暗黑与哥特」
10. abyss，黑紫深渊，主黑，辅紫/深灰，`black clothes, purple trim, dark fantasy`
11. maid-classic，黑白女仆，主黑，辅白/蕾丝，`black maid outfit, white apron, frills`
12. dark-gold，暗金权贵，主深绿/黑，辅金/暗黄，`dark green suit, gold embroidery`
13. neon-city，霓虹夜城，主黑/灰，辅荧光绿/荧光粉，`black techwear, neon green glowing lines`，组「赛博与机能」
14. cyber-blue，赛博蓝核，主白/银，辅亮蓝/青色，`white mecha suit, cyan glowing, cybernetic`
15. rust，废土锈迹，主棕/沙色，辅深灰/生锈红，`wasteland clothes, brown jacket, rust color`
16. brass，蒸汽黄铜，主深棕，辅黄铜/暗金，`steampunk outfit, brown leather, brass goggles`
17. ink-blue，水墨青花，主白/青，辅黑/墨蓝，`white hanfu, blue patterns, ink wash style`，组「古风与东方奇幻」
18. red-gold，红妆锦绣，主朱红，辅金/黑，`red hanfu, gold embroidery, elegant`
19. bamboo，竹影幽篁，主竹绿，辅白/墨黑，`green kimono, bamboo motifs, black obi`
20. miko，和风樱火，主红/白，辅黑/金，`red and white miko outfit, traditional japanese`
21. holy，圣洁白金，主纯白，辅金/浅黄，`white robe, gold trim, holy aura`，组「神圣与奇幻」
22. galaxy，星空灰蓝，主深蓝，辅银/白，`dark blue cloak, silver stars, galaxy texture`
23. forest，自然森绿，主橄榄绿，辅棕/浅绿，`green tunic, brown leather, elf ranger`
24. blood-gold，血族黑金，主黑，辅暗金/血红，`black elegant suit, gold accents, dark aura`

`COLOR_WORDS` 至少包含预设里出现的每个中文色名：黑 black，红 red，白 white，灰 gray，藏青 navy blue，浅灰 light gray，浅蓝 light blue，卡其 khaki，浅棕 light brown，米色 beige，银 silver，浅粉 pastel pink，薄荷绿 mint green，浅黄 light yellow，浅紫 pastel purple，粉 pink，鹅黄 light yellow，纯黑 black，暗红 dark red，紫 purple，深灰 dark gray，深绿 dark green，金 gold，暗黄 dark yellow，荧光绿 neon green，荧光粉 neon pink，亮蓝 bright blue，青色 cyan，棕 brown，沙色 sand，生锈红 rust，深棕 dark brown，黄铜 brass，暗金 dark gold，青 blue，墨蓝 ink blue，朱红 vermilion，竹绿 bamboo green，墨黑 ink black，橄榄绿 olive green，浅绿 light green，血红 blood red，深蓝 dark blue，蕾丝 lace。`swatch` 用两个 CSS 颜色，分别接近主色和辅色，供色块展示。

**联动规则：**

- 年龄池：女是萝莉/少女/成女；男是小孩/少年/青年/成年。当前年龄不在池内时改为该池第一项。
- 女角色不隐藏选项。`crossdressing` 仅男角色可见；女角色强制为 false。
- 男且 `crossdressing` 为 false 时隐藏：发型「双马尾（高/低）」「丸子头」「麻花辫」「姬发式」，长度「超长拖地发」，脸型「肉肉脸（可爱）」，嘴巴「樱桃小嘴」，妆容「亮面唇釉（水润）」「咬唇妆（渐变）」「浓密睫毛」「卧蚕」，服装「连衣裙」「洛丽塔洋装」「女仆装」「吊带」「抹胸」「包臀裙」「百褶裙」「高跟鞋」「连裤袜（黑丝/白丝）」，帽子「女仆头饰」，整个字段 `feminineAccessories`，手部动作「提着裙摆」，嘴部状态「嘟嘴(生气/可爱)」。男角色额外可见发型「狼尾（Mullet）」「碎发」「大背头」「飞机头」。这四项在性别为女时不可见。`crossdressing` 为 true 时，上述隐藏取消，男性替换发型仍可见。
- 萝莉隐藏：发型「大波浪」「姬发式」，长度「超长拖地发」，眼型「上挑眼（凌厉·魅惑）」，嘴巴「猫唇（M字唇）」，面部特征「面部纹身（可选位置）」，脸型「方脸·硬朗（偏男性）」，妆容「亮面唇釉（水润）」「咬唇妆（渐变）」「横向腮红（微醺/醉酒）」「重度（全脸通红）」，眼妆选项「眼线（上挑猫眼/下垂无辜眼）」整项，服装「包臀裙」「吊带」「抹胸」「露脐装」「高跟鞋」「渔网袜」，材质「半透明（需谨慎）」，体态只保留「站立」「坐姿」「行走中」「跳跃中」，嘴部「吐舌(调皮)」，手持「枪械」「匕首」，手背「纹身（手臂）」，预设 `night-rose` 与 `dark-gold`。角色定位是「末世废土」或「赛博朋克」时，枪械、匕首、手臂纹身重新可见。
- 少女隐藏：面部特征「面部纹身（可选位置）」，腮红「重度（全脸通红）」，材质「破损（战损）」和「半透明（需谨慎）」。高跟鞋不隐藏。
- 单选当前值不可见时，改为该字段第一个可见项。多选里不可见的值删掉。
- 「无」与同组其他项互斥的字段：`specialMakeup`、`effectSymbols`、`visualEffects`、`feminineAccessories`、`masculineAccessories`、`fantasyAccessories`、`faceNeck`、`handsBack`、`handheld`。这些字段不把「无」存进数组；空数组就表示无。`applyLinkage` 若见到「无」和其他值共存，丢掉「无」。
- `handheld` 最多保留 2 项。`visualEffects` 最多保留 2 项。超出时保留先选的。
- `mainColors` 最多不截断，`accentColors` 也不截断。
- 宽高比不在 `ASPECT_OPTIONS` 内时改为该数组第一项。
- `optionDisabled`：手持含「长剑」时，手部动作「双手抱胸」禁用；手部动作是「双手抱胸」时，手持「长剑」禁用。同一单选组内部不再做禁用。被禁用的当前单选改回该字段第一个未禁用且可见的项。
- `warnings` 返回字符串数组。躺姿或趴姿且镜头是「平视(默认)」时加入躺/趴警告原文。`hat` 不是「无」时加入帽子提示原文。`mainColors.length > 3` 或 `accentColors.length > 5` 时加入颜色警告原文。
- 背景推荐只排序，不隐藏。角色定位是赛博朋克时「赛博霓虹街」排第一。西式奇幻（剑与魔法）时「奇幻森林」排第一。函数名 `orderedOptions(field, state)`。

- [ ] **Step 1: Write the failing test**

`tests/rules.test.js` 至少断言：

- 默认女/少女状态下 `双马尾（高/低）` 可见，`狼尾（Mullet）` 不可见，`crossdressing` 字段不可见。
- 改为男后年龄变成 `小孩`，`crossdressing` 可见，双马尾不可见，狼尾可见，百褶裙不可见。
- 男且 `crossdressing: true` 时双马尾可见。
- 萝莉隐藏猫唇、大波浪、高跟鞋、趴姿、吐舌、枪械；角色改为末世废土后枪械可见；预设 `night-rose` 不可见。
- 少女隐藏面部纹身和重度腮红，不隐藏高跟鞋。
- 手持 `['书本','法杖','长剑']` 经联动后只剩前两项。
- 手持含长剑时双手抱胸被禁用，若当前就是双手抱胸，联动后不再是双手抱胸。
- 躺姿加平视产生指定警告；帽子不是无时产生指定提示；4 个主色产生颜色警告。
- 赛博朋克的背景第一项是赛博霓虹街。
- `specialMakeup: ['无','绷带']` 变成 `['绷带']`。
- 每个 `defaultState()` 的单选值要么是「无」，要么 `optionVisible` 为 true。`hairColorExtra` 的可选项只有「挑染」和「渐变发色」。`ahoge` 经男角色联动后仍是布尔值。
- 带「无」选项的多选字段必须在 `OPTIONS` 里包含「无」：`specialMakeup`、`effectSymbols`、`visualEffects`、`feminineAccessories`、`masculineAccessories`、`fantasyAccessories`、`faceNeck`、`handsBack`、`handheld`。女生向和男生向都包含规格里各自列出的共享项（运动发带、护额、头戴式耳机、战术护目镜、单片眼镜、绷带）。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/rules.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

按上面的数据和规则实现 `catalog.js` 与 `rules.js`。`applyLinkage` 不修改入参。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/rules.test.js tests/state.test.js`

Expected: PASS，输出无警告。

- [ ] **Step 5: Commit**

```bash
git add src/catalog.js src/rules.js tests/rules.test.js
git commit -m "feat: add character options and linkage rules"
```

---

### Task 4: 提示词拼装

**Files:**
- Create: `src/prompts.js`
- Create: `tests/prompts.test.js`

**Interfaces:**
- Consumes: `catalog.js` 的标签、`COLOR_WORDS`、`PRESETS`、`FACE_FIELDS`。
- Produces: `buildPrompt(state, kind, { hasReference, styleReference })` 返回 `{ positive, negative, aspect }`。`poseClause(state)` 返回体态标签数组。`kind` 只能是 `基准立绘`、`三视图`、`表情差分图`、`服饰拆解图`、`Q版形象`。

拼装规则：

- 标签按字段顺序收集，空标签跳过。同一个英文字符串只出现一次。
- 基准立绘正向固定包含 `character design, solo, full body, standing, official art, highly detailed, white background`，并包含 `1girl` 或 `1boy`。负向 `multiple people, cropped, out of frame`。宽高比取 `baseAspect`。包含身份、五官、妆容、发型（含 `ahoge` 与 `hairColorExtra`）、服饰、配饰、手持、手部动作、头部朝向、视线、光影、画面特效。不包含用户的体态、景别、镜头、背景。`onePiece` 不是「无」时不输出上装和下装标签。
- 三视图正向固定包含 `character sheet, three views, front view, side view, back view, same character, 3 people, standing, white background, concept art, flat colors`。负向 `different characters, different clothes`。宽高比取 `turnaroundAspect`。包含身份、五官、妆容、发型、服饰、配饰、手持。不包含体态、手部动作、头部朝向、视线、景别、镜头、背景、光影、画面特效。
- 表情差分只把 `eyeEmotions`、`mouthStates`、`effectSymbols` 的标签加入表情段，并包含身份、未锁脸时的五官妆容、发型、头饰。正向固定 `expression chart, multiple expressions, grid layout, close-up face, portrait, white background`。负向 `full body, single expression`。宽高比恒为 `1:1`。不包含服饰以外的体态和场景。视线不进入表情差分。
- 服饰拆解不包含人物、五官、妆容、发型、身份人物标签、体态和场景。包含帽子、三类头饰、面颈、服装、鞋袜、材质、配色、手背和手持的物件标签。正向以规格原文开头：`(game equipment sheet:1.4), (clothing parts breakdown:1.4), itemized components, scattered clothing parts, individual accessories, isolated items, flat lay, all items separated, various sizes, headwear, facial accessories, top, bottom, footwear, socks, jewelry, small details, white background, concept art, high resolution, clear outlines, no humans, grid layout, scattered layout`。负向原文：`human, 1girl, 1boy, body, skin, face, head, hands, legs, mannequin, person, character, wearing clothes, full outfit, merged items, connected parts`。宽高比取 `clothingAspect`。即使 `hasReference` 为 true 也不加锁脸句。
- Q 版正向固定 `chibi, super deformed, cute, 3 heads tall, full body, white background, simple background`。负向空字符串。宽高比恒为 `1:1`。包含与基准立绘相同的角色标签，但不包含景别和背景。`styleReference` 为 true 时，正向最前面加 `图1的人物，使用图2的Q版画风`。
- `hasReference` 为 true 且图种不是服饰拆解时，正向最前面是 `(same face as reference:1.5)`。此时不输出 `FACE_FIELDS` 的标签。Q 版若同时有风格句，顺序是锁脸句、风格句、其余。
- 配色：主色英文用 ` and ` 连接后加 ` clothes`；辅色同样连接后加 ` accents`。超过 3 个主色时，前 3 个进主句，其余每个写成 `(颜色 clothes:0.5)`。超过 5 个辅色时同样，权重句是 `(颜色 accents:0.5)`。`colorPreset` 非空时再追加该预设的 `tags`。没有主色和辅色时不写颜色句。
- 种族已经是精灵耳、兽耳、魔族、天使时，头饰里对应的精灵尖耳、兽耳、恶魔角、光环不再输出。天使已有羽翼时，手背「翅膀（天使/恶魔/机械）」的 `wings` 仍保留，因为规格只要求耳朵、角、光环去重。
- `poseClause(state)`：输出当前体态标签。年龄是少女且体态是趴姿或躺姿时再加 `fully clothed`。五种设定图的 `buildPrompt` 都不调用它，因为这些图种用自己的站立或无人构图覆盖体态。测试直接测 `poseClause`。

- [ ] **Step 1: Write the failing test**

用 `defaultState()` 断言基准立绘包含 `1girl`、`oval face`、`twintails`、`black hair`、`pleated skirt`、`standing`、`white background`，不包含 `classroom`，宽高比 `3:4`。把 `ahoge` 设为 true、`hairColorExtra` 设为 `['挑染']` 后，正向包含 `ahoge` 和 `streaked hair`。

把 `background` 设为教室后仍然不包含 `classroom`。

`hasReference: true` 时基准立绘以 `(same face as reference:1.5)` 开头，且不包含 `oval face`、`light blush`、`natural lips`，仍包含 `twintails`。

服饰拆解包含 `pleated skirt`，不包含 `1girl`，不以锁脸句开头。

表情差分在 `eyeEmotions: ['开心(弯眼)']`、`mouthStates: ['微笑']` 时包含 `happy` 和 `smile`，宽高比 `1:1`，不包含 `looking at viewer` 作为视线重复以外的全身词 `full body` 可以出现在负向；正向不包含 `full body`。

主色 `['黑','红']`、辅色 `['金']` 时包含 `black and red clothes, gold accents`。四个主色时包含 `(0.5)`。

`poseClause` 对少女趴姿返回的数组同时含 `lying on stomach` 和 `fully clothed`。男站立只含 `standing`。

Q 版在 `styleReference: true` 且 `hasReference: true` 时，开头两句依次是锁脸句和 `图1的人物，使用图2的Q版画风`，宽高比 `1:1`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/prompts.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

实现 `src/prompts.js`。不要在 UI 里复制这套拼接。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/prompts.test.js tests/rules.test.js`

Expected: PASS，输出无警告。

- [ ] **Step 5: Commit**

```bash
git add src/prompts.js tests/prompts.test.js
git commit -m "feat: assemble character sheet prompts"
```

---

### Task 5: 工作台界面

**Files:**
- Create: `src/view.js`
- Create: `src/dom.js`
- Modify: `src/main.js`
- Create: `tests/view.test.js`
- Create: `tests/dom.test.js`
- Modify: `package.json` 的 devDependency 增加 `jsdom`，测试脚本保持 `node --test`。

**Interfaces:**
- Consumes: `defaultState`、`createStore`、`applyLinkage`、`OPTIONS`、`ROLE_GROUPS`、`PRESETS`、`ASPECT_OPTIONS`、`optionVisible`、`fieldVisible`、`optionDisabled`、`warnings`、`orderedOptions`。
- Produces:
  - `viewModel(state)` 返回 `{ left, center, right, warnings }`。
  - `mount(document, { store, gallery })`。本任务的 `gallery` 可以是空对象。生成按钮先渲染，点击只把状态写进 `#status`，原文 `生成功能尚未接入`。
  - 六个按钮文字：生成基准立绘、生成三视图、生成表情差分图、生成服饰拆解图、生成Q版形象、生成完整图片（一键全套）。
  - 宽高比切换只出现在前三个名字对应的基准立绘、三视图、服饰拆解旁边。表情差分和 Q 版旁边没有切换。

`viewModel` 的每一项控件含 `field`、`value`、`label`、`selected`、`disabled`、`mode`（`single`、`multi`、`switch`）。隐藏项不出现。`warnings` 是 `warnings(state)` 的结果，DOM 把它们渲染进 `#warnings`。预设按组输出，不可见预设不出现。少女的高跟鞋项带 `folded: true`，放在服饰组里一个默认闭合的 `details`，标题「更多」；其他项 `folded` 为 false。背景使用 `orderedOptions`。主色和辅色是 `COLOR_WORDS` 里每个中文色名的多选按钮，再加一个 `<input type="color">`：选中后把十六进制颜色追加进对应数组。预设写进来的中文色名也用这些按钮表示选中。

左栏：性别、年龄、种族、角色定位、仅男性可见的伪娘开关、配色预设色块。中栏用 `details`：面部、发型、妆容、服饰、头部配饰、配饰与手持物、姿势与表情、场景构图与光影。服饰组里放主色、辅色和 `background` 无关的颜色；纯色背景的颜色输入放在场景组，绑定 `backgroundColor`。右栏放六个按钮、`#status`、参考图占位、预览占位「还没有图片」、图库占位「图库是空的」、`#open-download` 文字 `下载页`。

`mount` 调用 `store.hydrate()` 后渲染。点击单选调用 `store.replace`。点击多选增减数组。伪娘开关写 `crossdressing`。预设点击写入该预设的 `main`、`accent` 和 `id` 到 `colorPreset`。之后若用户改主色或辅色，`colorPreset` 变回空字符串。手持第三件加不进去。画面特效第三种加不进去。选择「无」时该多选变空数组。主题按钮写入 `localStorage.theme` 并设置 `document.documentElement.dataset.theme`，图标在黑夜显示 `🌙`，白天显示 `☀️`。没有 `theme` 时跟随 `matchMedia('(prefers-color-scheme: dark)')`，并且系统变化时更新；一旦用户点过，不再跟随系统。重置按钮用 `window.confirm`，确认原文如 Global Constraints，确认后删除 `myCharacterConfig` 并 `location.reload()`。

- [ ] **Step 1: Write the failing test**

`tests/view.test.js` 用默认状态断言左栏有「少女」且选中，没有「狼尾（Mullet）」，警告为空。男角色视图没有双马尾，有狼尾。四个主色时警告含指定长句。

`tests/dom.test.js` 用 jsdom。加载 `index.html` 的骨架可以由测试自己创建这些 id，再调用 `mount`。断言：

- 初始按钮「少女」为 `aria-pressed="true"`。
- 点击「男」后出现「小孩」且文档中没有「双马尾（高/低）」。
- 点击预设「经典黑红白」后 `store.getState().mainColors` 深相等 `['黑','红']`，`accentColors` 深相等 `['白','灰']`。
- 再点一个主色控件把颜色改成只剩「黑」后，`colorPreset` 为 `''`。
- 连续选择三件手持后状态长度仍为 2。
- `#open-download` 存在。
- 生成按钮点击后 `#status` 文本为 `生成功能尚未接入`。

安装：`npm install -D jsdom`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/view.test.js tests/dom.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

实现 `view.js`、`dom.js`，并把 `main.js` 接成在 `DOMContentLoaded` 时 `createStore({ storage: localStorage, schedule: { in: (ms, fn) => setTimeout(fn, ms), cancel: clearTimeout }, applyLinkage, onToast })` 后 `mount`。Toast 写入 `#toast`。不要接生图。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`

Expected: 全部 PASS，输出无警告。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/view.js src/dom.js src/main.js tests/view.test.js tests/dom.test.js
git commit -m "feat: render the character workbench"
```

---

### Task 6: 参考图与锁脸

**Files:**
- Create: `src/face.js`
- Modify: `src/dom.js`
- Modify: `src/main.js`
- Create: `tests/face.test.js`
- Modify: `tests/dom.test.js`

**Interfaces:**
- Consumes: `FACE_FIELDS`、`createStore`。
- Produces:
  - `backupFace(state)` 只拷贝 `FACE_FIELDS`。
  - `stripFace(state)` 返回新状态，这些字段里字符串变 `''`，数组变 `[]`。
  - `restoreFace(state, backup)` 把备份写回。
  - 存储键 `myCharacterFaceBackup`。
  - `mount` 增加 `images` 内存对象：`{ reference: null }`，`reference` 是 data URL 或 null。不要放进 store。

上传控件在右栏，文字 `上传参考图`。选择图片后读取 data URL，调用 `backupFace`，`localStorage.setItem('myCharacterFaceBackup', JSON.stringify(backup))`，再 `stripFace` 后 `replace`。面部和妆容两个 `details` 设 `disabled`，并显示锁脸说明原文。移除按钮文字 `移除`。移除时读备份并 `restoreFace`，删除 `myCharacterFaceBackup`，参考图内存清空，面板恢复可点。

`hydrate` 之后：若存在 `myCharacterFaceBackup` 且内存里没有参考图，用备份 `restoreFace`，删除备份，并 `flush`。不要在没有参考图时保持锁脸。

锁脸期间性别联动不再隐藏面部和妆容字段。实现方式：`viewModel(state, { faceLocked })` 在 `faceLocked` 时面部和妆容字段全部可见，但面板禁用，因此这些控件不发出 replace。

- [ ] **Step 1: Write the failing test**

`tests/face.test.js`：备份只含面部字段；`stripFace` 把 `faceShape` 变空字符串、`facialFeatures` 变空数组，且不改 `hairStyle`；`restoreFace` 能还原。

DOM 测试：设置一个 1 像素 png 的 file input 后，面部 `details` 被禁用，状态中 `faceShape` 为 `''`，`myCharacterFaceBackup` 含原来的 `鹅蛋脸（标准）`。点击移除后 `faceShape` 恢复，备份键不存在。

另测：只有备份、没有参考图时，`mount` 会恢复脸并删除备份。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/face.test.js tests/dom.test.js`

Expected: FAIL，新断言失败。

- [ ] **Step 3: Write minimal implementation**

按接口实现。文件读取在测试里可以替身为直接调用导出的 `lockReference(store, storage, dataUrl)` 和 `unlockReference(store, storage)`，DOM 按钮调用这两个函数。这样 jsdom 不必真的解码大文件。`lockReference` 仍要拒绝非 `data:image/` 开头的字符串并不改状态。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`

Expected: PASS，输出无警告。

- [ ] **Step 5: Commit**

```bash
git add src/face.js src/dom.js src/main.js tests/face.test.js tests/dom.test.js
git commit -m "feat: lock the face to a reference image"
```

---

### Task 7: 生成与图库

**Files:**
- Create: `src/gallery.js`
- Create: `src/generate.js`
- Create: `server/app.py`
- Create: `tests/gallery.test.js`
- Create: `tests/test_server.py`
- Modify: `src/dom.js`
- Modify: `src/main.js`
- Modify: `tests/dom.test.js`

**Interfaces:**
- Consumes: `buildPrompt`。
- Produces:
  - `createGallery()`：`addBatch(items)`、`batches()`、`select(id)`、`selected()`、`lockSelected()`、`base()`。
  - 批次 `{ id, createdAt, status: 'complete', items }`。条目 `{ id, kind, aspect, seed, positive, negative, dataUrl }`。
  - `lockSelected` 把选中条目标为基准，记录 `dataUrl` 和 `seed`。没有选中时返回 null。
  - `requestImage({ prompt, negativePrompt, aspectRatio, seed, referenceImages, fetcher })` POST `/api/generate`，返回 `{ dataUrl, seed }`。
  - `generateKind({ kind, state, gallery, images, fetcher, now, randomSeed })`。基准立绘循环 4 次，每次新种子，合成一个完成批次。其他图种一次一张。已有基准时，参考图用基准图，种子用基准种子，`hasReference` 为 true。没有基准但有上传参考图时，用上传图，种子随机。两者都没有时不传参考图。Q 版额外请求 `GET /api/chibi-style`，若返回第一张图，则参考图顺序是角色图、风格图，且 `styleReference` 为 true。服饰拆解可以带基准图，但 `buildPrompt` 的 `hasReference` 仍按是否真有参考图传递；锁脸句由 `prompts.js` 自己排除。
  - `generateSuite`：无基准时只跑基准立绘，返回 `{ stopped: true }`。有基准时按三视图、表情差分图、服饰拆解图、Q版形象顺序各出一张，放进同一批次，返回 `{ stopped: false }`。
  - 服务端 `POST /api/generate` body：`prompt`、`negativePrompt`、`aspectRatio`、`seed`、`referenceImages`。环境变量 `GENERATE_MOCK=1` 时不访问网络，返回 1x1 PNG 的 data URL 和原种子。未 mock 且没有 `DASHSCOPE_API_KEY` 时返回 503，JSON `{ "error": "未配置 DASHSCOPE_API_KEY" }`。有 Key 时调用百炼同步接口，`model` 为 `qwen-image-3.0`，`size` 由宽高比和 `1k` 计算，`prompt_extend` false，`n` 为 1。服务把结果图片下载后以 data URL 返回。`GET /api/chibi-style` 返回 `assets/chibi-style` 里图片的 data URL 数组，空目录返回 `{ "images": [] }`。

DOM：生成中六个按钮 `disabled`。基准立绘进度写入 `#status`，格式 `正在生成基准立绘（2/4）`。完成后清空进度。任一请求失败时不写入半成品批次，`#status` 显示错误字符串，按钮恢复可点。成功的新批次进入预览和 `#gallery`。没有图时预览是「还没有图片」，图库是「图库是空的」。点击缩略图选中。按钮 `设为当前角色基准` 调用 `lockSelected`。无基准时点击三视图，`#status` 在完成后是「尚未设定角色基准，本次不会锁定脸。」一键全套无基准时，完成后状态是「请选择一张基准立绘，并设为当前角色基准。」

原先「生成功能尚未接入」的测试改为：注入 `fetcher`，点击基准立绘后图库有 4 张图。不要访问真实百炼。

- [ ] **Step 1: Write the failing test**

画廊测试：两次 `addBatch` 保持各自条目；`lockSelected` 在选中后返回该种子；未选中返回 null。

生成测试放在 `tests/gallery.test.js` 后半：假的 `fetcher` 记录 body 并返回 `{ dataUrl: 'data:image/png;base64,AA==', seed }`。无基准无参考时基准立绘调用 4 次且种子互不相同。设定基准后三视图的 body 种子等于基准种子，`referenceImages` 只有基准 data URL。一键全套在无基准时 `fetcher` 只被调用 4 次且 `stopped` 为 true；有基准时再调用 4 次，图种顺序是三视图、表情差分图、服饰拆解图、Q版形象。

`tests/test_server.py` 用 `unittest` 和假的 HTTP handler 函数，不要听端口。导出 `build_payload(body, api_key)` 和 `mock_png_data_url()`。断言 payload 的 model、negative_prompt、seed、`prompt_extend is False`。`GENERATE_MOCK` 的响应助手返回以 `data:image/png;base64,` 开头的字符串。缺 key 的助手返回 503 和指定错误句。

把 DOM 里旧的未接入断言换成 fetcher 假实现断言 4 张图。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/gallery.test.js`

Run: `python -m unittest tests.test_server`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

实现画廊、浏览器请求、DOM 接线、`server/app.py`。尺寸计算复制这些边界：`1k` 长边 1024，单边不超过 2048，宽高至少 512，比例只接受 `1:1`、`3:4`、`4:3`、`9:16`、`16:9`、`3:2`。未知比例返回 400 `{ "error": "不支持的比例" }`。静态文件从仓库根目录提供 `index.html`、`styles/`、`src/`、`assets/`。不要服务 `.env`、`.git`、`tests`。只绑定 `127.0.0.1`，端口 `8765`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`

Run: `python -m unittest tests.test_server`

Expected: PASS，输出无警告。

- [ ] **Step 5: Commit**

```bash
git add src/gallery.js src/generate.js src/dom.js src/main.js server/app.py tests/gallery.test.js tests/test_server.py tests/dom.test.js assets/chibi-style/.gitkeep
git commit -m "feat: generate character sheets into the gallery"
```

---

### Task 8: 下载页

**Files:**
- Create: `src/download.js`
- Modify: `src/dom.js`
- Create: `tests/download.test.js`
- Modify: `tests/dom.test.js`

**Interfaces:**
- Consumes: `createGallery()` 的批次条目。
- Produces:
  - `singleName(index, kind)`，`index` 从 1 开始，格式 `01-基准立绘.png`。
  - `promptsText(batch)` 返回 UTF-8 文本。每张图一块，含 `images/01-基准立绘.png`、`aspect:`、`seed:`、`POSITIVE`、正向原文、`NEGATIVE`、负向原文，块之间用一行 `---`。
  - `zipBatch(batch)` 返回 `{ filename, bytes }`。`filename` 为 `角色设定-YYYYMMDD-HHmmss.zip`，时间来自 `batch.createdAt` 的本地时间。ZIP 使用 store 方法（不压缩），文件名按 UTF-8 标记。内容只有 `images/` 下的图片和根上的 `prompts.txt`。
  - `dataUrlToBytes(dataUrl)`。

DOM：`#open-download` 隐藏 `#workbench`、显示 `#download-view`。`#download-back` 相反。列表按批次渲染。每行有缩略图、图种、`下载这张`。每批有 `打包本次`。点击单张下载该 PNG，文件名用 `singleName`。点击打包下载 `zipBatch` 的字节。图库缩略图 `contextmenu` 阻止默认菜单并下载同一张，不打开下载页。批次 `status` 不是 `complete` 时没有打包按钮。没有任何批次时 `#download-list` 的文本是「还没有生成图片」。

- [ ] **Step 1: Write the failing test**

`singleName(1, '基准立绘')` 等于 `01-基准立绘.png`。`singleName(12, '三视图')` 等于 `12-三视图.png`。

用两张假 PNG 的批次断言 `promptsText` 同时含两张文件名、两个正向和 `NEGATIVE`。

`zipBatch` 的文件名匹配 `/^角色设定-\d{8}-\d{6}\.zip$/`。用 Python 读 ZIP：

```javascript
import { spawnSync } from 'node:child_process';
const result = spawnSync('python', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print("\\n".join(z.namelist()))', path], { encoding: 'utf8' });
```

测试把 bytes 写入临时文件再跑上述命令。名单正好是 `images/01-基准立绘.png`、`images/02-三视图.png`、`prompts.txt`。读出的 `prompts.txt` 含正向提示词。

DOM：先 `addBatch` 两张，打开下载页，断言有两个「下载这张」和一个「打包本次」。空画廊打开后文本是「还没有生成图片」。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/download.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

实现 ZIP 写入：本地文件头、中央目录、EOCD。通用标志位设置 UTF-8（`0x0800`）。CRC32 要正确，否则 Python `zipfile` 读内容会失败。下载用临时 `<a download>`。不要把 ZIP 或图片写入 `localStorage`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test`

Run: `python -m unittest tests.test_server`

Expected: PASS，输出无警告。

- [ ] **Step 5: Commit**

```bash
git add src/download.js src/dom.js tests/download.test.js tests/dom.test.js
git commit -m "feat: download one image or a batch zip"
```
