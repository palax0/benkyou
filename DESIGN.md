<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Benkyou
description: 自部署的个人 AI 资讯聚合与学习平台 —— 温和、学习感、个人化的阅读工具
---

# Design System: Benkyou

## Overview

**Creative North Star: "苔庭の文庫 (The Moss-Garden Bunko)"**

一本认真维护的文库本,摊开在能望见苔庭的书桌上。Benkyou 的视觉系统服务于一件事:
让人安静地读完今天值得读的东西。界面是书桌而非展台——结构清晰、密度充足、装饰克制;
品牌的「温和 · 学习感 · 个人化」由排版的敬意、苔藓绿的少量点睛、细节处的手艺感承载,
而不是由背景色的"暖"或大面积的留白承载。

这个系统明确拒绝(承接 PRODUCT.md):SaaS 营销风(渐变大字、玻璃拟态)、
陈旧后台管理风(默认蓝 + 表格堆砌)、过度极简留白风(牺牲密度换好看)、
信息流社交风(无限刺激、注意力劫持)。

**Key Characteristics:**

- 阅读优先:正文排版是系统的第一公民,UI 在阅读时退到背景
- 密度即尊重:靠排版层次而非空白区分主次
- 苔藓绿点睛 ≤10%:颜色的稀缺本身是设计
- 中英混排一等公民:字体栈、行高、标点在 zh/en 两个 locale 下同等推敲
- 手艺感在细节:空状态、骨架屏、微动效做到位

## Colors

**The Restrained Rule.** 品牌色出现在任意一屏的占比 ≤10%。它属于:链接、当前态导航、
徽标、聚焦环、少量状态指示。正文区域永远是中性底 + 高对比墨色。

- **主色锚点(已定)**:苔藓绿 `oklch(0.60 0.154 130)` —— 西芳寺苔庭,湿石与老杉林间的绿光。
  实现时沿 hue 130°(±10°)取 L/C,深色模式与浅色模式各自校准。
- **bg / surface / ink / accent / muted**:[to be resolved during implementation]。
  组合约束:浅色模式 bg 用纯白或 chroma≈0 的真灰白(**禁止**默认米色/奶油底——
  forest-green-on-cream 是明确要避开的 AI 俗套);ink 对 bg 对比 ≥7:1;
  muted ≥3.5:1;accent 与主色在色相和明度上都拉开(赭石/墨色系候选)。
- **深浅双主题均为正式交付物**(spec §9.3:`prefers-color-scheme` 自动 + 手动覆盖),
  各自独立通过对比度检查,不做亮色取反的敷衍版。
- 饱和中明度色块上的文字一律用白/近白(Helmholtz-Kohlrausch),深字只许出现在
  极浅(L>0.85)或纯中性底上。

## Typography

**Display Font:** 衬线 [font pairing to be chosen at implementation] —— 标题、日报刊头、详情页大标
**Body Font:** 人文无衬线 [to be chosen] —— UI 与正文
**中文字体栈:** 与西文同步选型,衬线对宋体、无衬线对黑体,行高按中文习惯上调

**Character:** 文库本的编辑气质——衬线负责"这是值得认真读的内容",无衬线负责
"这是顺手好用的工具"。两者的张力就是 Benkyou 的双重身份(阅读器 × 工具)。

**The Bilingual Rule.** 任何排版决策(字号、行高、断行、标点悬挂)必须在 zh 和 en
两个 locale 下分别验证;中英混排不是英文排版的附属品。

- 正文行长 ≤ 65–75ch(中文相应折算);阅读态行高从容
- 层级(display/headline/title/body/label 具体值)[to be resolved during implementation]

## Elevation

平面为本。Responsive 档动效意味着深度只作为状态反馈出现(hover 抬升、抽屉滑出、
modal 遮罩),静止界面靠色阶分层(bg/surface)而非阴影制造层次;阴影词汇表在实现时
随组件定义,保持小而一致。

## Do's and Don'ts

### Do:

- **Do** 把品牌苔藓绿当稀缺资源用(≤10%),它的克制就是气质本身。
- **Do** 在 zh / en 两个 locale 下分别检查每个排版改动(The Bilingual Rule)。
- **Do** 让 feed 一屏呈现足量条目,用字重/字号/留白节奏区分主次,而不是砍内容。
- **Do** 为每个动效写 `prefers-reduced-motion` 降级;ease-out 指数曲线,不弹跳。
- **Do** 认真做空状态、骨架屏、错误横幅——平静的语气,明确的下一步。

### Don't:

- **Don't** SaaS 营销风:渐变大字、`background-clip: text`、玻璃拟态、英雄区指标卡。
- **Don't** 陈旧后台管理风:Ant Design 默认蓝、表格堆满、毫无排版层次的 admin 模板感。
- **Don't** 过度极简留白风:一屏只显示三条内容的"好看"。
- **Don't** 信息流社交风:无限刺激、大图卡片轰炸、互动按钮堆叠。
- **Don't** 米色/奶油/羊皮纸底色冒充"日系纸质感"——纸感由排版与质感承载,不由暖白背景承载。
- **Don't** 彩色侧条边框(`border-left` >1px 做强调)、每节一个 uppercase 小眉题、
  千篇一律的 icon+标题+描述卡片阵列。
