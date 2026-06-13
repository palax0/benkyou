---
name: Benkyou
description: 自部署的个人 AI 资讯聚合与学习平台 —— 温和、学习感、个人化的阅读工具
colors:
  bg: "oklch(0.985 0.003 130)"
  surface: "oklch(1 0 0)"
  surface-2: "oklch(0.962 0.005 130)"
  ink: "oklch(0.235 0.015 130)"
  muted: "oklch(0.45 0.02 130)"
  faint: "oklch(0.54 0.015 130)"
  line: "oklch(0.905 0.007 130)"
  accent: "oklch(0.46 0.115 130)"
  accent-vivid: "oklch(0.6 0.154 130)"
  accent-soft: "oklch(0.6 0.154 130 / 0.1)"
  err: "oklch(0.5 0.16 25)"
typography:
  display:
    fontFamily: "Source Serif 4, Noto Serif SC, Source Han Serif SC, Songti SC, serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Source Serif 4, Noto Serif SC, Source Han Serif SC, Songti SC, serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "normal"
  body:
    fontFamily: "Source Sans 3, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  label:
    fontFamily: "Source Sans 3, Noto Sans SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  "2xl": "2rem"
components:
  button-primary:
    backgroundColor: "{colors.accent-vivid}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.625rem"
  button-ghost-hover:
    textColor: "{colors.ink}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0 0.625rem"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  feed-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "1rem 0"
---

# Design System: Benkyou

## 1. Overview

**Creative North Star: "苔庭の文庫 (The Moss-Garden Bunko)"**

一本认真维护的文库本,摊开在能望见苔庭的书桌上。Benkyou 的视觉系统服务于一件事:
让人安静地读完今天值得读的东西。界面是书桌而非展台——结构清晰、密度充足、装饰克制;
品牌的「温和 · 学习感 · 个人化」由排版的敬意、苔藓绿的少量点睛、细节处的手艺感承载,
而不是由背景色的"暖"或大面积的留白承载。

这是 **product 寄存器**:设计服务于任务,工具退到任务背后。可信赖的熟悉感是一种特性
——导航是侧栏 + 顶栏 + Cmd+K,卡片读起来像 Linear / Notion 那样不出戏,而不是为了
"看起来设计过"而发明陌生控件。手艺感留给瞬间(空状态、骨架屏、微动效),不铺满每一屏。

这个系统明确拒绝(承接 PRODUCT.md):SaaS 营销风(渐变大字、玻璃拟态、英雄区指标卡)、
陈旧后台管理风(默认蓝 + 表格堆砌、毫无排版层次)、过度极简留白风(牺牲密度换好看)、
信息流社交风(无限刺激、大图卡片轰炸、注意力劫持)。

**Key Characteristics:**

- 阅读优先:正文排版是第一公民,阅读时 UI 退到背景
- 密度即尊重:靠字重 / 字号 / 留白节奏区分主次,而非砍内容
- 苔藓绿点睛 ≤10%:颜色的稀缺本身就是设计
- 中英混排一等公民:字体栈、行高、断行在 zh / en 两个 locale 下同等推敲
- 平面为本:静止界面靠色阶分层,深度只作为状态反馈出现
- 手艺感在细节:空状态、骨架屏、微动效、平静语气的状态横幅

## 2. Colors

苔藓绿单色支配的中性体系——hue 130° 一以贯之,从背景到墨色全部带极微的苔色倾向
(chroma ≤0.02),而非默认暖白。颜色克制到只有"绿"一种声音。

### Primary
- **苔藓绿 / Moss Green** (`oklch(0.46 0.115 130)`, `--accent`):交互文字、图标、链接、
  当前态导航文字、聚焦环。这是日常出现的那支绿,压暗到在 `--bg` 上稳过 4.5:1。
- **苔光 / Moss Glow** (`oklch(0.6 0.154 130)`, `--accent-vivid`):品牌锚色,西芳寺苔庭
  湿石间的绿光。只用于品牌标记(勉字徽标)、大字形、主操作按钮填充——稀缺出场。
- **苔晕 / Moss Wash** (`oklch(0.6 0.154 130 / 0.1)`, `--accent-soft`):当前态导航项的
  背景薄染,唯一的"色块"。

### Neutral
- **墨 / Ink** (`oklch(0.235 0.015 130)`, `--ink`):正文与标题主色,对 `--bg` ≥7:1。
- **次墨 / Muted** (`oklch(0.45 0.02 130)`, `--muted`):摘要、次级文字、非当前导航,≥4.5:1。
- **淡墨 / Faint** (`oklch(0.54 0.015 130)`, `--faint`):占位符、禁用态、元信息(类型标签、
  日期、计数),仍守住 ≥4.5:1——不靠浅灰"显优雅"。
- **底 / Background** (`oklch(0.985 0.003 130)`, `--bg`):页面与顶栏底,带 chroma 0.003 的
  苔色倾向的真灰白(**不是**米色)。
- **面 / Surface** (`oklch(1 0 0)`, `--surface`):纯白内容面 / 悬浮层。
- **次面 / Surface-2** (`oklch(0.962 0.005 130)`, `--surface-2`):第二中性层——侧栏、
  context rail、列表行 hover 染色。比内容面略沉,给导航一个"更安静"的色调。
- **线 / Line** (`oklch(0.905 0.007 130)`, `--line`):分隔线、边框、chip 描边。

### Tertiary
- **警示 / Error** (`oklch(0.5 0.16 25)`, `--err`):仅用于失败计数、表单错误。
  平静语气下唯一允许的非苔色相,且只在真的出错时出现。

### Named Rules
**The Restrained Rule.** 品牌苔藓绿(accent + vivid + soft 三者合计)在任意一屏的占比 ≤10%。
它只属于:链接、当前态导航、徽标、聚焦环、主操作、少量状态指示。正文区域永远是中性底 +
高对比墨色。绿色的克制就是气质本身。

**The One-Hue Rule.** 整个中性体系沿 hue 130° 微染(chroma ≤0.02),禁止默认暖向调色。
warm-cream / sand / parchment 底色是要避开的 AI 俗套——纸感由排版与质感承载,不由暖白背景承载。

**The White-on-Saturated Rule.** 在饱和中明度色块(如 `--accent-vivid` 填充)上,文字一律
用 `--bg`(近白);深色文字只许出现在极浅或纯中性底上(Helmholtz–Kohlrausch)。

## 3. Typography

**Display / Title Font:** Source Serif 4(回退 Noto Serif SC → Source Han Serif SC → Songti SC)
**Body / UI Font:** Source Sans 3(回退 Noto Sans SC → PingFang SC → Hiragino Sans GB → Microsoft YaHei → system-ui)

衬线与无衬线只各一支,靠对比轴(serif × sans)拉开,不混两支相近的无衬线。
拉丁字形为本地 vendored 变量字体(仅 latin subset);CJK 走系统栈,Source 对 Han/Noto
天然和谐。

**Character:** 文库本的编辑气质——衬线负责"这是值得认真读的内容"(条目标题、刊头、
勉字徽标),无衬线负责"这是顺手好用的工具"(导航、标签、正文摘要、数据)。两者的张力
就是 Benkyou 的双重身份(阅读器 × 工具)。

### Hierarchy
固定 rem 阶梯(product 寄存器:不用流体 clamp 标题),阶比约 1.125–1.2,层级靠字重 +
字族切换而非夸张字号制造。

- **Display / Title**(serif,600,`1.125rem`/`text-lg`,line-height 1.375):条目标题、
  刊头、徽标 Wordmark。阅读流里的"这值得读"信号。
- **Body**(sans,400,`0.875rem`/`text-sm`,line-height 1.625):摘要、正文、段落。
  阅读态行高从容;正文行长 ≤ 65–75ch(中文相应折算)。
- **Label / Meta**(sans,500,`0.75rem`/`text-xs`):元信息行——类型标签(`uppercase`
  + `tracking-wider` ≈ 0.05em)、来源、日期、计数。日期与计数用 `tabular-nums`。
- **Base body**(sans,系统默认尺寸):`<body>` 全局,`font-kerning: normal` +
  `-webkit-font-smoothing: antialiased`。

### Named Rules
**The Bilingual Rule.** 任何排版决策(字号、行高、断行、标点、字重)必须在 zh 和 en
两个 locale 下分别验证;中英混排不是英文排版的附属品。中文行高相应上调,字体栈对应
(衬线对宋体、无衬线对黑体)。

**The Serif-Means-Read Rule.** 衬线只用于"内容"层(标题、刊头、徽标);UI 控件、按钮、
标签、数据一律无衬线。display 字体绝不进 UI label / button / 数据。

## 4. Elevation

平面为本。静止界面靠色阶(`--bg` < `--surface-2` < `--surface`)而非阴影制造层次;
深度只作为**状态反馈**出现——hover 抬升、抽屉滑出、modal 遮罩。阴影词汇表小而一致。

### Shadow Vocabulary
- **floating** (`--shadow-floating`,亮:`0 8px 30px oklch(0.235 0.015 130 / 0.12)`;
  暗:`0 8px 30px oklch(0 0 0 / 0.5)`):仅用于真正脱离文档流的悬浮层(下拉、弹出、
  浮动卡)。阴影也带苔色相,不用中性黑。
- **focus ring**(`outline: 2px solid var(--accent)`,`outline-offset: 2px`):全局
  `:focus-visible`。键盘可达是底线,不是装饰。

### Z-Scale
语义化、绝不用 999 / 9999:`--z-sticky: 10` → `--z-drawer: 40` → `--z-toast: 50`
→ `--z-tooltip: 60`。

### Named Rules
**The Flat-By-Default Rule.** 表面静止时一律平。阴影只回应状态(hover、悬浮、聚焦)。
列表行不靠投影成卡——靠 hover 时的 `--surface-2` 薄染。如果一个静止界面有投影,那就是
旧后台风的味道,改掉。

## 5. Components

熟悉优先,同一套视觉词汇贯穿每一屏。同样的圆角、同样的表单控件、同样的图标风格;
惊喜留给瞬间,不铺满页面。

### Buttons
- **Shape:** 中等圆角(`rounded-md` = 0.375rem)。同一形状贯穿所有按钮。
- **Primary:** `--accent-vivid` 填充 + `--bg`(近白)文字,padding `0.5rem 1rem`。
  这是 ≤10% 苔色少数被允许成为"色块"的地方——主操作 / 提交。
- **Hover:** 加深到 `--accent`(L 0.6 → 0.46),150ms 色彩过渡;`motion-reduce` 下无过渡。
- **Ghost / Icon:** 透明底,文字 `--muted` → hover `--ink` + `bg-ink/5` 薄染。
  顶栏 / 侧栏的图标按钮、折叠钮、locale 切换都属此类。`h-8 w-8` 方形命中区。
- **States:** 每个按钮都要有 default / hover / focus-visible / disabled(`opacity-50`)。

> DESIGN-GAP:`LoginForm` / `SetupForm` 仍用原始 `slate-*` / `red-600` Tailwind 类
> (早于 token 系统),未接入语义 token。这是待消除的旧债,不是系统的一部分;新表单
> 按下方 input-field / button-primary 规格走。

### Chips (Interest Tags)
- **Style:** 全圆角(`rounded-full`)、`--line` 描边、透明底、文字 `--muted`、`text-xs`。
- **State:** 当前为静态展示标签(兴趣 tag);非过滤型。padding `0.125rem 0.625rem`。

### Containers — 列表行,不是卡片
**The No-Card Rule.** feed 不用盒装卡片。条目是**列表行**(`<article>`,上下 padding,
无边框无投影),hover 时一层 `--surface-2` 薄染从文本列向左右各溢出 `0.75rem`,
像列表项点亮而非卡片浮起。整行是可点目标(stretched `::after` link),来源链接用 `z-10`
重新启用自己的指针事件。

- **Corner Style:** hover 染色块 `rounded-lg`(0.5rem);行本身无圆角。
- **Background:** 静止透明;hover `--surface-2`。
- **Shadow Strategy:** 无(见 Flat-By-Default)。
- **Internal Padding:** 纵向 `1rem`(`py-4`)。

容器面(rail / 侧栏)靠 `--surface-2` 第二中性层 + `--line` 分隔,而非边框堆叠或投影。

### Inputs / Fields
- **Style:** `--surface` 底、`--line` 1px 描边、`rounded-md`、padding `0.5rem 0.75rem`。
- **Focus:** 全局 focus ring(2px `--accent`,offset 2px);占位符 `--faint`(守 4.5:1)。
- **Error:** 错误文案 `--err`,语气平静,给明确下一步。
- **Disabled:** `opacity-50` 或 `--faint`。

### Navigation
- **Desktop 侧栏:** 60px 折叠 / 220px 展开(spec §9.2),`--surface-2` 底、右侧 `--line` 边、
  宽度 200ms ease-out 过渡。`sticky top-0 h-dvh`。折叠态居中图标 + title 提示。
- **Nav item:** `h-9`、`rounded-md`、`text-sm`。默认 `--muted` + hover `bg-ink/5`/`--ink`;
  **当前态** `--accent-soft` 底 + `--accent` 文字 + `font-medium`,`aria-current="page"`。
- **顶栏:** `h-12` sticky `z-sticky`,`--bg` 底 + 底部 `--line`。含移动端菜单钮、
  locale 切换、rail 开关、登出。
- **Mobile 抽屉:** 原生 `<dialog>` + `showModal()`(逃出 stacking context,不被裁剪),
  260px 宽,`-translate-x-full` → `open:translate-x-0` 300ms ease-out 滑入,
  `backdrop:bg-ink/25` 遮罩。
- **Context Rail:** 右侧 280px,`xl` 以上显示,可隐藏。承载 interests / top sources /
  today 统计,纯 `--line` 分隔无卡片。

### Wordmark(签名组件)
勉字徽标:`h-8 w-8` 方块、`rounded-md`、`--accent-soft` 底、`--accent-vivid` 苔光色的
serif「勉」字。这是品牌苔光色少数几个出场点之一。旁附 serif `Benkyou` 字样(展开态)。

## 6. Do's and Don'ts

### Do:
- **Do** 把品牌苔藓绿当稀缺资源(≤10%):链接、当前态导航、徽标、聚焦环、主操作、
  状态指示——其余皆中性。克制就是气质(The Restrained Rule)。
- **Do** 整个中性体系沿 hue 130° 微染(chroma ≤0.02);用真灰白底,**不用**暖白(The One-Hue Rule)。
- **Do** 在 zh / en 两个 locale 下分别检查每个排版改动(The Bilingual Rule)。
- **Do** 衬线只给"内容"(标题、刊头、徽标),无衬线给一切 UI(The Serif-Means-Read Rule)。
- **Do** 让 feed 一屏呈现足量条目,用字重 / 字号 / 留白节奏区分主次,而不是砍内容。
- **Do** 用列表行 + hover 薄染,**不要**盒装卡片(The No-Card Rule)。
- **Do** 静止界面保持平面,阴影只回应状态(The Flat-By-Default Rule)。
- **Do** 为每个动效写 `motion-reduce` 降级;过渡 150–300ms,ease-out,不弹跳。
- **Do** 每个交互组件交齐 default / hover / focus-visible / disabled;别只做一半。
- **Do** 认真做空状态、骨架屏、错误横幅——平静的语气,明确的下一步。
- **Do** 一切颜色走语义 token(`--ink` / `--accent` / …),组件**绝不**碰原始 OKLCH 值。

### Don't:
- **Don't** SaaS 营销风:渐变大字、`background-clip: text` 渐变文字、玻璃拟态、英雄区指标卡。
- **Don't** 陈旧后台管理风:Ant Design 默认蓝、表格堆满、毫无排版层次的 admin 模板感。
- **Don't** 过度极简留白风:一屏只显示三条内容的"好看"。
- **Don't** 信息流社交风:无限刺激、大图卡片轰炸、互动按钮堆叠、注意力劫持模式。
- **Don't** 米色 / 奶油 / 羊皮纸底色冒充"日系纸质感"——纸感由排版与质感承载,不由暖白背景承载。
- **Don't** 彩色侧条边框(`border-left` > 1px 做强调)、每节一个 uppercase 小眉题、
  千篇一律的 icon + 标题 + 描述卡片阵列、`01 / 02 / 03` 编号眉题。
- **Don't** 在组件里写原始 hex、Tailwind 任意值方括号(`p-[13px]`、`bg-[#abc]`)、内联 `style=`,
  或像 `LoginForm` 那样直接用 `slate-*` / `red-*`——全部走语义 token。
- **Don't** 用浅灰正文"显优雅":正文 ≥4.5:1,大字 ≥3:1,占位符同样 ≥4.5:1。
- **Don't** display 衬线字体进 UI label / button / 数据。
- **Don't** 给静止表面加投影、用任意 z-index(999 / 9999)、或让动效无 `motion-reduce` 降级。
