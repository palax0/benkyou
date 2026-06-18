# Benkyou UX 可读性重设计 · Legibility Redesign

> 状态:**Proposal**(待接受)· 2026-06-18
> 关系:本文是对主 spec [`2026-05-27-benkyou-design.md`](./2026-05-27-benkyou-design.md) **§9(UI/UX)与 §11.4(Onboarding)的提案级修订**。**在本文被接受前,主 spec 仍为唯一权威**;接受时须在**同一变更内**于主 spec 对应行(§9.1 / §9.2 / §9.3 / §11.4)回标「→ 见 2026-06-18 ux-legibility §X」,双向同步完成后本文方生效。在此之前 agent 一律以主 spec 为准。
> 性质:**IA / UX / 信息架构**级设计。最终视觉(色、字、间距、动效)留给 impeccable 的 polish 遍,本文只定结构与交互。

---

## 0. 背景与目标

平台当前 UI 在四处让用户"迷茫":

1. **源管理不聚焦**:手动粘贴(首页内联表单)与 RSS(`/sources`)分处两地;`/settings` 是无层次的扁平表单堆叠。
2. **处理进度模糊**:单条详情只显示一行当前 stage 文字(看不出共几步);RSS 只有全局大盘,无每源视图。
3. **首登强制配置**:`user_settings` 空 → 强制走 `/setup`,且该页用早于 token 系统的原始样式(`slate-*`/`red-*`),风格与平台割裂。
4. **逻辑黑盒**:`poll_interval`、`weight`、`interest_tags`、排序公式 α/β/γ 的影响不读代码无从得知,且大多不可自定义。

**根因是同一个:产品不"自解释"。** 它怎么组织内容(心智模型)、此刻在替用户做什么(进度)、用户能调什么·调了有何影响(旋钮),都应当"不看代码就能懂"。

**本设计的目标 = 让 Benkyou legible(自解释),且不越 PRODUCT.md「阅读优先·界面退后」的红线。**

---

## 1. 设计原则(规范 · 长期准绳)

> 这 5 条是本轮所有决定的共同母体。**后续任何相关改动先对照这 5 条**;它们与 PRODUCT.md 的 Design Principles 同级,专门约束"信息架构 / 配置暴露 / 进度反馈"这一层。

**P1 · 产品自解释(Legibility-first).** 凡是会影响结果的机制——它怎么组织内容、此刻在替你做什么、某个设置影响什么——都在产品内、用平静语言**就地**说清,不必读代码。暴露先服务"理解",再服务"控制"。

**P2 · 一套词汇,多尺度复用(One vocabulary, many scopes).** 一个概念只定义一次,在所有相关尺度复用:pipeline 的 5 步词汇 = 单条/单源/全局共用;"内容入口"注册表 = 源页/onboarding/粘贴共用。**不为每屏另发明一套——这是防返工的核心**;映射逻辑落在 `packages/core` 单点实现。

**P3 · 配置聚合,动作随处(Aggregate config · ubiquitous actions).** "管理某能力"集中在一个**按 type 可拓展**的家(源页);"高频执行某动作"(粘贴 URL)保持全局可达。两者不混。**加新 type = 加一个自洽区块,而非重构。**

**P4 · 引导在产品内,渐进不挡路(Onboarding within, not in front).** 首登带用户**穿过**产品,而非挡在门口。空产品本身被设计好(空状态即引导)。硬前置(配 AI 服务)是引导的**第一步**,不是一堵墙。

**P5 · 暴露不越"阅读优先"红线(Exposure within the calm line).** 拿不准时:**解释 + 好默认 + 抽象预设 > 裸旋钮**;裸旋钮收进"高级"折叠;还没上线的功能给轻暴露、不提前堆面板。承接 PRODUCT.md 原则 5(状态透明·语气平静):状态默认紧凑、按需展开,失败是平静红点 + 原因 + 下一步,绝不警报轰炸。

---

## 2. 源管理 IA(痛点 ①)

### 2.1 心智模型决定:UI 层统一,**不动 schema**

"源管理聚焦一处"在 UI 层实现,**不改数据模型**。重申并守住主 spec 的 hard invariant:

- 手动粘贴的 item 仍 `source_id IS NULL`,排序走 `user_settings.adhoc_source_weight` 兜底(主 spec §6 score/dedup/digest 不变)。
- "手动导入"在 UI 上是一个**一等的伪源(pseudo-source)**,不是 `sources` 表里的行。
- 不新增 `type='manual'` 的源行;不碰 `source_id IS NULL` 的兜底逻辑、dedup canonical 选择、final_score 公式。

> 被否决的备选:给"手动"建真 `sources` 行。它概念更纯,但要改 schema 并触动 §6 多处兜底,涟漪大、风险高,与"聚焦一处"这个**纯 UI 诉求**不匹配。

### 2.2 `/sources` = 由 source-adapter 注册表驱动的页面

主 spec 已有正式的 **SourceAdapter 模型**:`sources.type ∈ {rss, hn, reddit, youtube, bilibili}`(主 spec §5 schema 第 239 行),每种 type 一个 adapter 住在 `packages/core/src/sources/<type>.ts`,extract stage 按 type 分派(主 spec §6.2)。**`/sources` 页据此注册表渲染,而非写死"RSS + 粘贴"** —— RSS 只是当前已实现的 type 之一;绝不能在 IA 上把 Benkyou 收窄成"RSS 管理器"(主 spec §3.1 的 v1 即多平台:RSS / YouTube / Bilibili)。

布局:**顶部总览条 + 每种 source type 一个自洽区块 + 一个独立的"手动导入"区块**(新增/修改全在此页)。

```
源管理            总览  7 源 · 启用 6 · 失败 1
──────────────────────────────────────────
▾ RSS 订阅源 (6)                  [ + 添加 RSS ]
   Hacker News     w1.0 · 30m · ✓ · 124 条
   Simon Willison  w1.2 · 60m · ✓ ·  38 条
   机器之心          w0.8 · 30m · ✗ ·   9 条  ⚠
   …

▾ YouTube 频道                    [ M2a · 规划中 ]
▾ Bilibili 频道                   [ M2a · 规划中 ]
▾ HN / Reddit                     [ v2 · 规划中 ]

▷ 手动导入(adhoc)               [ 粘贴 URL ]
   排序权重 1.0 · 累计 17 条 · 无需轮询
──────────────────────────────────────────
```

**总览条**:`共 N 源 · 启用 M · 失败 K`。给"整体情况"一个 O(1) 入口,弥补分区块后"全局一眼"的缺口。

**source-type 区块(由注册表生成)**:
- **已实现 type(当前 = RSS)**:feed 列表,每行 名称 · 标识(url / channel)· `weight` · `poll_interval` · 启用/暂停 · 每源处理状态(§3.4)· 操作(立即抓取 / 编辑 / 删除);`[ + 添加 ]` 内联表单,字段随 type 而定(RSS:`name` · `url` · `weight` · `poll_interval`,带说明见 §5.2)。
- **已规划但本轮不实现 type(YouTube / Bilibili = M2a;HN / Reddit = v2)**:区块**渲染为占位**(标注所属里程碑 + "规划中",新增禁用)。它们是主 spec 已承诺的内容获取能力,出现在 IA 里防止"RSS 化"误读;**adapter 本体在各自里程碑实现,不在本 UX 轮**。
- **绝不**把未承诺类型(X / Newsletter / 播客)摆进 IA。

**手动导入区块(adhoc,非 adapter)**:
- 概念上**不是 source type** —— 它对应 `source_id IS NULL` 的粘贴条目,独立于 adapter 注册表单列。
- 一张卡(非列表):`adhoc_source_weight`(可改 + 影响说明)· 累计入库条数 · "无需轮询"。
- `[ 粘贴 URL ]` = 触发全局粘贴动作的快捷入口(动作本体见 §2.3)。
- 顺带缝合痛点 ④ 的"`adhoc_source_weight` 无处可配"。

> **拓展路径(P3)**:加一种新平台 = 加一个 adapter(`sources/<type>.ts`)+ 注册表登记一条 → `/sources` 页**自动多出一个区块**,无需改页面结构。这正是"按注册表渲染"的收益。

### 2.3 粘贴 URL 是全局动作,但**不占右下浮动位**(P3 + 阅读优先)

粘贴动作本体是主 spec §9.3 的**全局 modal**,入口为:**顶栏按钮 + `Cmd+K` command palette 的一个 action + `/sources` 手动导入卡的快捷入口**。随处可达,但**不做右下浮动按钮**。

> **冲突修正(右下角只能有一个常驻入口)**:主 spec §9.2 让"粘贴 URL"右下浮动,而 §8.4(第 650 行)又让 Agent 浮动球"右下角永驻(除 `/chat` 外所有页)"。两个右下常驻入口互抢,且违背 PRODUCT.md「阅读优先·界面退后」。**裁定:右下浮动位独留 Agent 浮动球(§8.4 已承诺);粘贴退到顶栏 + Cmd+K + sources 快捷入口。** 这是对主 spec §9.2 的修订(见 §7)。
>
> 现状修正:当前实现把粘贴做成**首页 `/` 顶部内联表单**(`apps/web/app/(authed)/page.tsx` 挂 `PasteForm`)。本设计改为上述全局入口,首页内联表单移除。

### 2.4 数据 / 查询影响

- `listSourcesWithStats`(已存在,返回 `itemCount` / `lastPolledAt` / `lastFetchError`)扩展出每源处理状态摘要(见 §3.4),或新增伴随查询。
- 总览条计数(源数 / 启用 / 失败)由现有 source 数据聚合,无新表。
- 手动导入卡的"累计条数"= `COUNT(items WHERE source_id IS NULL)`。
- **无 schema 变更。**

---

## 3. 处理进度 / Pipeline 可读性(痛点 ②)

### 3.1 一套用户向步骤词汇(P2)

定义**唯一**的用户向 pipeline 词汇,全站复用:

```
抓取  →  提取/转写  →  嵌入  →  打分  →  完成
```

与主 spec §6.1 六段内部状态机的映射(**仅用于呈现**,不改状态机):

| 用户向步骤 | 内部 state 区间 | 含义 |
|---|---|---|
| ① 抓取 | item 创建(`pending`) | 已从源/粘贴取得条目 |
| ② 提取/转写 | `pending → extracted` | Readability 提取;视频走字幕/转写(转写期 state 仍 `pending`,见主 spec §6 转写归属;`transcript_status` 驱动本步子标签) |
| ③ 嵌入 | `extracted → embedded` | 向量化,使其可被搜索 |
| ④ 打分 | `embedded → scored` | 相关性 + 深度评分 |
| ⑤ 完成 | `scored → dedup_done → done` | 去重+摘要为内部环节,**不单独示人**;`done` 才进 feed |
| ✗ 失败 | `failed` | 任一步红点 + `last_error` + 重试入口 |

> **对主 spec §9.3 的修订**:原用户向序列为 `queued → extracting → transcribing → scoring → done`,把"嵌入"藏了。本设计把**嵌入显出来**(它=可被搜索,对用户有意义),去重/摘要仍藏。保留 §9.3 既有约束:**stage 级,不做 chunk 级百分比**。
> **P2 落点 + 映射签名(钉死)**:state→步骤的映射在 `packages/core` 单点实现(如 `items/pipeline-view.ts`),三尺度共用,严禁各 UI 各写一份。**签名 = `mapStep(state, currentStage, transcriptStatus, lastError)`**。单看 `state` 不够:`state='pending'` 会混淆"刚创建 / 提取中 / 转写中",真正表达"当前在哪一步"的是 `items.current_stage`(`ItemProgress` 已含,`packages/core/src/items/queries.ts`;`completeStage` 写下一步、`recordFailure` 只写 `last_error` 不改 state、`markFailed` 写 `state='failed' + current_stage`,见 `pipeline/state.ts`)。映射以 `current_stage` 为主轴,`transcript_status` 区分视频转写子态,`state='failed' + last_error` 标失败步。

### 3.2 失败语义(承接 P5 / DESIGN.md Calm-Status)

失败 = 该步一个 `--err` 红点 + 一行 `last_error` + `[重试]`。**不闪烁、不铺红块、不弹窗**。重试入口复用 `/admin/jobs` 既有的 retry action。主 spec 不变量:重试期间 **state 不变**,只 `attempts++`;耗尽 `pipeline_max_attempts` 后 onFail 置 `failed`——UI 只在 `failed` 时显红,中间态重试静默。

### 3.3 单条尺度:补完 stepper

`/items/[id]` 处理中视图,把当前的"一行字"升级为 5 步 stepper:

```
处理中 · 你粘贴的文章正在入库
①抓取 ✓ — ②提取 ✓ — ③嵌入 ● — ④打分 ○ — ⑤完成 ○
```

- 这是**补完主 spec §9.3 既有承诺**(原本就该有 stage 级进度),非新设计。
- 轮询机制沿用 §9.3 的 `GET /api/items/[id]/status`,但**载荷须补 `current_stage`**:返回 `state` + `current_stage` + `transcript_status` + `last_error`;前端把这四者喂给 §3.1 的 `mapStep(...)` 得出步骤位置(对主 spec §9.3 status 载荷的修订,见 §7)。
- 视频:② 提取/转写步显示 `transcript_status` 子标签(转写中 / 已入 / 无字幕降级——`unavailable` 是常态,不显红,见主 spec §6 与 DESIGN.md §2)。

### 3.4 单源尺度:紧凑状态行 + 可展开(新)

每个源在 `/sources` RSS 区块里显示一行**平静状态**,需要时展开看细节:

```
▾ RSS 订阅源 (6)              [ + 添加 RSS ]
  Hacker News    ● 处理中 4 · ✓ 120 · ✗ 2   ⌄
  └─ 展开后:
     · "GPT-5 发布"      ③嵌入 ●
     · "某论文解读"       ④打分 ●
     ✗ "断链文章"   提取失败 HTTP 403  [重试]

  Simon Willison ✓ 全部完成 38
```

- **默认**:一行 `● 处理中 N · ✓ 完成 M · ✗ 失败 K`(P5:日常安静)。
- **展开**:列出**在途**条目各自卡在哪步(复用 §3.1 词汇 + §3.3 stepper 形态)+ **失败**条目的原因与重试。
- 不常驻漏斗、不列全部近期条目(避免吵闹 + 与单条详情重复)。

**需要的 core 能力(无 schema 变更)**:
- 新增按源聚合的查询,如 `getSourcePipelineStatus(sourceId)` → `{ inFlight: {itemId, title, step}[], doneCount, failed: {itemId, title, error}[] }`。
- 数据来源:`items` 表的 `state` / `source_id` / `last_error`,GROUP BY 即可。
- 全局已读级别的列表展开可懒加载(点开才查 inFlight 明细)。

### 3.5 全局尺度:不重做

`PipelineHealthBanner`(feed 顶部全局横幅)+ `/admin/jobs` 六段面板**保持不变**。它们已是全局尺度的成熟实现;本轮只新增"单源"这一层。

---

## 4. 首登 Onboarding(痛点 ③)

### 4.1 哲学修订:门禁 → 站内渐进引导(P4)

**对主 spec §11.4 的修订**:Phase 1 从"检测 `user_settings` 空 → **强制走 `/setup`**(一次性必填 provider/源 才能进)"改为"**登录后落地 app shell + 站内渐进引导清单 + 空状态即引导**"。Phase 2(M5)的推荐源 / 兴趣 chips / 文案打磨保留不变。

### 4.2 边界:登录保留,只拆"配置墙"

- **登录(密码)是安全底线,不动**。
- **当前实现**(`packages/core/src/setup/index.ts`):`completeSetup()` 把密码 + provider 配置 + `embed_dim` **一次性原子写入** `user_settings` 单行,`/setup` 表单一次收齐;首条源由 `addRssSource()` 紧随其后。`isInitialized()` = 该行是否存在。
- **渐进引导要求拆分这次原子写入**:
  - bootstrap 只创建带**密码(+ locale + `embed_dim`)**的 `user_settings` 行,provider 字段留 `NULL`;
  - provider 配置改由站内引导**步骤 ①** 经设置更新写入(复用既有 `testLLM` / `testEmbedding` 连通性测试)。
  - 故 `SetupInput` / `completeSetup` 需重构,使 **provider/model 不再是行创建的必填**。
  - **无需 schema 变更**:`llm_*` / `embed_*` provider 列**本就 nullable**(`embed_dim` 为 `NOT NULL` 无默认,bootstrap 时从 `env.EMBED_DIM` 供给,与现 `completeSetup` 一致)。
- `/setup` 路由去留:移除其 provider + 源收集职责;首登成功后直接进 app shell。是否保留 `/setup` 作纯 bootstrap 落点留给 writing-plans(推荐:能并入登录流程则删,减一个割裂表面)。

### 4.3 站内引导清单

登录后落到 app shell(空 feed),挂一个**常驻但不挡路**的引导卡:

```
勉 Benkyou     [feed][search][sources][settings]
──────────────────────────────────────────
                              ┌─ 开始使用 ────┐
  今日还没有内容              │ ① 配置 AI 服务 ▸│
  完成配置后,这里会出现       │ ② 添加第一个源  │
  今日精选与 feed。           │ ③ 看它处理入库 │
                              └───────────────┘
  [平静的空状态]
```

三步,每步深链到对应表面,完成态由真实数据驱动:

| 步骤 | 深链到 | 完成判定 |
|---|---|---|
| ① 配置 AI 服务 | `/settings` AI 服务段 | `llmProvider` 且 `embedProvider` 已配 + 连通性测试通过 |
| ② 添加第一个源 / 粘贴 URL | `/sources` 加源(未配 AI 时存为草稿,§4.4)/ 粘贴入库需先 `aiConfigured` | 存在 ≥1 个源 **或** ≥1 条 item |
| ③ 看它处理入库 | 自动(item 跑流水线时,引导指向单条 stepper §3.3) | 首条 item 到达 `done` |

- 三步全完成 → 引导卡收起(可在某处再次唤起,或彻底消失,细节留 writing-plans),feed 此时已有内容。
- 引导卡可手动收起(P4 不挡路),但未完成时下次进站再现,直到完成。
- 完成态读取的是**真实状态**(provider 是否已配 / 源数 / item 数 / 首条是否 `done`),**不引入 onboarding 进度表或新列**。"已手动收起"用 localStorage(沿用主 spec §9.3 的已读 localStorage 模式);未完成时即使收起,下次进站仍提示,直到三步真完成——无需 DB 持久化。

### 4.4 AI readiness 边界与硬约束的诚实呈现(P1)

`buildLLMConfig` / `buildEmbeddingConfig`(`packages/core/src/settings/index.ts`)在 provider/model 缺失时**直接抛错**。故 bootstrapped(只有密码)态下若放任"抓取 / 粘贴入库 / 搜索",pipeline 会真失败——用户看到**处理失败**而非"空状态引导"。必须用显式 readiness 边界挡住。

**两个派生态(无新列,从 `user_settings` 现有字段算):**
- **`bootstrapped`**:`user_settings` 行存在(有密码),provider 未配。
- **`aiConfigured`**:`llm_provider`+`llm_model` 且 `embed_provider`+`embed_model` 均已配(理想情况下连通性测试通过)。

**能力闸门(按 readiness):**

| 能力 | bootstrapped | aiConfigured |
|---|---|---|
| 浏览 app shell / 空状态 / 设置 | ✅ | ✅ |
| 配置 AI 服务(引导步骤 ①) | ✅ | ✅ |
| 添加源(以**暂停草稿** `enabled=false` 存,轮询循环跳过) | ✅ | ✅ |
| 立即抓取 / 粘贴入库 / 搜索 | **禁用**(平静提示"先完成 AI 配置 →") | ✅ |

- **不造假失败**:未 `aiConfigured` 时,触发 pipeline 的动作一律以平静禁用态 + "先配置 AI"指引呈现,绝不让 item 跑进 `failed`。
- 转入 `aiConfigured` 后,草稿源可启用(自动 or 提示,细节留 writing-plans)。
- **不造演示数据**掩盖空态(已否决"demo data":单用户自部署里维护者通常立刻就配,ROI 低 + 假数据维护成本)。空状态即引导:feed / search / sources 的空态用平静语言说清"为什么空 + 下一步",指回引导清单。
- 引导第一步显式就是"配置 AI 服务"——硬前置不藏着,但以"第一步 + 能力闸门"而非"一堵墙"的形态出现。

### 4.5 样式清账(痛点 ③ 的机械另一半)

"风格完全不同"一半是 DESIGN-GAP 技术债:`SetupForm` / `LoginForm` 用早于 token 系统的 `slate-*` / `red-*` 原始类。**本轮把首登链路接入语义 token**,使其与平台一致(详见 §8)。

---

## 5. 配置可读性(痛点 ④)

### 5.1 `/settings` 分段 IA(替代当前扁平堆叠)

当前设置是一坨无层次表单(只有 reader 一个 `h2`)。重构为带标题的分段:

| 段 | 内容 | 备注 |
|---|---|---|
| **AI 服务** | LLM(provider/base_url/key/model/cheap_model)· Embedding(同上 + `embed_request_dimensions`)· Reader · Whisper | 每子块带连通性测试;**`embed_dim` 只读 + warning**(守主 spec §5.3,UI 不可改) |
| **排序与打分** | 排序风格预设 + α/β/γ 高级折叠(§5.3) | 全局排序偏好 |
| **兴趣标签** | `interest_tags` + 影响说明(M5 加候选 chips) | 影响 topic_score |
| **外观与语言** | locale · 深色模式覆盖(主 spec §9.3) | |
| **账户安全** | 改密码 | 复用 `PasswordForm` |

**IA 收口原则**:**每源级**配置(`weight` / `poll_interval` / 手动导入的 `adhoc_source_weight`)归 `/sources`;**全局级**偏好(排序公式 / 兴趣 / 外观 / 安全 / AI 服务)归 `/settings`。

### 5.2 "暴露 + 解释"清单(P1,无争议项)

| 项 | 字段 | 暴露位置 | 解释文案(就地) |
|---|---|---|---|
| RSS 拉取频率 | `sources.poll_interval` | `/sources` RSS 新增/编辑 | "每隔多久自动拉取一次该源"(带单位:分钟/小时;默认 30 分钟) |
| 来源权重 | `sources.weight` | `/sources` RSS 行/编辑 | "越高 → 该源内容在排序里越靠前" |
| 手动权重 | `user_settings.adhoc_source_weight` | `/sources` 手动导入卡 | "你手动粘贴的内容在排序里的权重" |
| 兴趣标签 | `user_settings.interest_tags` | `/settings` 兴趣段 | "用于算'相关性'分,影响日报与智能排序" |

### 5.3 排序公式 α/β/γ:预设 + 高级折叠(P5)

`final_score = α·topic + β·depth + γ·effective_weight`(主 spec §6)对用户全黑盒。**关键事实**:该公式**当前仅在搜索重排生效**;feed 智能排序 + 日报要到 **M3** 才用上它——所以现在不堆重型调参面板,做"轻暴露"。

**"排序与打分"段呈现**:

```
排序与打分
──────────────────────────────────
 排序风格  (•均衡)( 偏相关 )( 偏深度 )( 偏高权重源 )
 决定 feed 智能排序 / 日报 / 搜索怎么排。

 ▸ 高级:自定义权重 α/β/γ        (默认折叠)
```

- **预设**(普通用户):4 选 1,每个预设 = 一组写入 `weight_alpha/beta/gamma` 的值。
- **高级折叠**(维护者/power user):展开后可直接编辑 α/β/γ 三个数。若当前值不匹配任何预设 → 预设态显示"自定义"。

**预设 → α/β/γ 初始值**(三者和 ≈ 1;为可调起点,M3 智能排序上线后据实调优):

| 预设 | α(相关) | β(深度) | γ(来源) |
|---|---|---|---|
| 均衡(默认) | 0.6 | 0.3 | 0.1 |
| 偏相关 | 0.75 | 0.15 | 0.1 |
| 偏深度 | 0.4 | 0.5 | 0.1 |
| 偏高权重源 | 0.5 | 0.2 | 0.3 |

**守不变量**:预设/高级都只是把值写进 `user_settings.weight_*`;**`final_score` 公式与 `effective_weight` 兜底仍是 `packages/core` 单点实现**(主 spec §6 实现约束),UI 不复制公式。

---

## 6. 页面 IA 收口(汇总)

| 表面 | 角色 | 关键内容 |
|---|---|---|
| `/sources` | 由 source-adapter 注册表驱动;**每源级配置之家** | 总览条 · 已实现 type 区块(当前 RSS:列表+新增,含 weight/poll_interval)· 已规划 type 占位(YouTube/Bilibili=M2a、HN/Reddit=v2)· 手动导入 adhoc 卡 · **单源处理状态**(§3.4) |
| `/settings` | **全局级偏好之家**,分段 | AI 服务 · 排序与打分(预设 + 高级)· 兴趣标签 · 外观语言 · 账户安全;embed_dim 只读 |
| `/items/[id]`(处理中) | 单条进度 | 5 步 stepper(§3.3) |
| 全局 | 高频动作 + 全局状态 | 粘贴 URL = 顶栏 + Cmd+K action + sources 快捷入口(**非右下浮动**;右下留 Agent §8.4)· PipelineHealthBanner · `/admin/jobs` |
| 首登 | 站内渐进引导 | app shell + 3 步引导卡 + 空状态即引导(§4) |

---

## 7. 对主 spec 的修订点(逐条)

落地时在主 spec 对应行加标注「→ 见 2026-06-18 ux-legibility §X」:

1. **§9.1 路由表**
   - `/sources`:"源管理" → "**由 source-adapter 注册表驱动**的页面(`rss` 已实现;`youtube`/`bilibili`=M2a、`hn`/`reddit`=v2 作已规划 type 占位);**每源级**配置(权重·拉取频率)之家;手动导入(adhoc,`source_id IS NULL`)独立单列"。
   - `/settings`:"LLM / 兴趣 / 权重 / 密码 / 语言" → "分段:AI 服务 · 排序与打分(预设+高级 α/β/γ)· 兴趣 · 外观语言 · 账户安全"。
2. **§9.2 全局布局**
   - **移除**"'粘贴 URL'按钮右下浮动";粘贴改 **顶栏 + Cmd+K action + sources 快捷入口**。右下浮动位**独留 Agent 浮动球**(§8.4),避免两个右下常驻入口互抢(本文 §2.3)。
3. **§9.3 关键交互**
   - 用户向 pipeline 步骤:`queued→extracting→transcribing→scoring→done` → `抓取→提取/转写→嵌入→打分→完成`(显出"嵌入")。
   - `GET /api/items/[id]/status` 载荷补 `current_stage`(映射签名见本文 §3.1)。
   - 新增"单源处理视图"(紧凑状态行 + 展开,§3.4)。
   - "粘贴 URL"是全局 modal(非右下浮动);移除"首页内联粘贴表单"现状实现。
4. **§11.4 Onboarding**
   - Phase 1:"强制走 `/setup`" → "登录后落地 app shell + 站内渐进引导清单 + AI readiness 能力闸门(§4.4)+ 空状态即引导"。Phase 2(M5)不变。

---

## 8. token 债务清账(承接 §4.5)

以下表面/组件早于 token 系统,用原始 `slate-*` / `red-*` / `green-*`,本轮**接入语义 token**(DESIGN.md §5 已记为 DESIGN-GAP):

- `app/setup/SetupForm.tsx` · `app/login/LoginForm.tsx`(首登链路,§4.5)
- `app/(authed)/sources/AddSourceForm.tsx` · `SourceList.tsx` · `EditSourceForm.tsx` · `DeleteSourceForm.tsx`(源页重构本就要改)
- `app/(authed)/settings/SettingsForm.tsx`(设置分段重构本就要改)

**约束(DESIGN.md §6 机械护栏)**:`apps/web/components` 与上述表面**不得**出现原始 hex / Tailwind 任意值方括号 / 内联 `style=`;一切走语义 token。净新表面缺 primitive 时留 `{/* DESIGN-GAP: … */}` 中性壳,交给 impeccable 遍补。

---

## 9. 落地分期

> **全程零 schema 迁移**:四块用到的字段(`poll_interval` / `weight` / `adhoc_source_weight` / `weight_alpha·beta·gamma` / `interest_tags`)均已存在;provider 列本就 nullable;onboarding 完成态派生 + localStorage。本轮只动 **UI + 少量 core 函数/查询**(新增按源聚合查询、state→步骤映射、`completeSetup`/`SetupInput` 拆分),不碰 schema、不碰打分公式实现位置。

遵循 CLAUDE.md 的 superpowers × impeccable 工作流。细分任务(及 🔧/🎨 标签)在 writing-plans 产出;此处只给骨架:

0. **先决:回标主 spec** —— 接受本提案时,在同一变更内于主 spec §9.1/§9.2/§9.3/§11.4 加跳转标注(见状态行),完成双向同步;此后本文生效。
1. **功能优先一遍(本设计主体,🔧 为主)**:
   - `/sources` 由 source-adapter 注册表驱动重构(RSS 区块 + 已规划 type 占位 + 手动导入 adhoc 卡)+ 每源处理状态查询 + poll_interval/weight/adhoc 暴露与解释。
   - pipeline 用户向词汇单点实现(`mapStep` 签名见 §3.1)+ 单条 stepper 补完(+ status 载荷补 `current_stage`)+ 单源状态行。
   - 站内渐进引导 + AI readiness 能力闸门(§4.4)+ `completeSetup`/`SetupInput` 拆分(密码-only bootstrap)+ 空状态。
   - `/settings` 分段 + 排序风格预设/高级。
   - token 清账(§8)。
   - 净新视觉缺口留 `DESIGN-GAP` 中性壳,**不在功能遍即兴发挥视觉**(CLAUDE.md 半成品中间态禁令)。
2. **impeccable 视觉遍(🎨)**:对净新表面(源页区块、引导卡、pipeline 视图、设置分段)`live` 迭代 → `document` 折进 `DESIGN.md`。在 requesting-code-review **之前**做。
3. **M5(主 spec 已规划)**:推荐源列表 · 兴趣 chips 候选建议 · onboarding 文案打磨与多语言。

---

## 10. 非目标 / 守住的不变量

- **不改 schema**:源统一是纯 UI;手动导入是伪源;pasted item 保持 `source_id IS NULL` + `adhoc_source_weight`。
- **不改状态机**:5 步是呈现层映射,内部仍 6 段;state 在重试期不变(主 spec §6.1)。
- **不动 `final_score` 公式实现位置**:预设/高级只写 `user_settings.weight_*`,公式仍 core 单点。
- **`embed_dim` 设置里只读**(主 spec §5.3)。
- **单用户**:不引入多用户/per-user 概念;引导完成态派生自真实状态 + localStorage,无新列。
- **不造演示数据**(§4.4 已否决)。
- **本轮不实现任何新 source adapter**:`/sources` 按注册表渲染,已规划 type(YouTube/Bilibili=M2a、HN/Reddit=v2)仅作 IA 占位,adapter 在各自里程碑落地;不引入未承诺类型(X/Newsletter/播客)。

---

## 11. 开放问题(留待 writing-plans / 实现期)

1. `/setup` 路由最终去留(并入登录流程则删,见 §4.2)。
2. 引导卡完成后是"彻底消失"还是"可再唤起";承载它的具体壳(docked 卡 / context rail 一节 / 顶部条)。
3. 单源展开明细的懒加载粒度与轮询频率(复用 AutoRefresh 还是独立)。
4. 预设 α/β/γ 初始值(§5.3)在 M3 智能排序上线后据真实数据复核。
5. 草稿源(`enabled=false`)转入 `aiConfigured` 后自动启用还是提示启用(§4.4)。
6. 已规划 type 占位"现在就显"还是"临近其里程碑再显",以免长期摆 dead UI(§2.2)。
