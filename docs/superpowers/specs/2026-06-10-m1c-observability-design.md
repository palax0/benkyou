# M1c · 可观测性与配置管理 — 设计

> 2026-06-10。在 M2（源拓展）之前插入的小里程碑。母文档：[2026-05-27-benkyou-design.md](2026-05-27-benkyou-design.md)，本文档定义对母文档的增量与修订（见 §9 变更清单）。

## 1. 背景与动机

M1a/M1b 跑通端到端闭环后，实际使用暴露出四个 UX 问题：

1. **setup/settings 表单出错后清空已填内容**（React 19 `useActionState` + 非受控输入：action 返回后表单被重置）；
2. **setup 之后没有任何 UI 能管理 RSS 源**——spec §9.1 规划了 `/sources` 页但未排进任何 milestone；
3. **pipeline 过程完全不透明**：不知道任务执行到哪个 stage、为什么突然消耗大量 token、失败只能查代码和数据库（`scripts/pipeline-status.ts` 这个 CLI 面板正是该缺口的产物）。spec 仅在 M3 排了 `/admin/jobs`（只覆盖失败重试），**token 消耗在母 spec 中没有任何记录机制**；
4. **feed 内容与源的关联弱**：卡片上只有一行灰色小字，无法按源查看内容。

选择在 M2 前成体系解决（而非零散修补）的理由：M2 引入视频/转写后 pipeline 更长、token 消耗更大、失败模式更多——可观测性先行，M2 的开发与调试本身就是第一受益者。

## 2. 决策摘要

| 决策点 | 结论 | 理由 |
|---|---|---|
| 里程碑形态 | 插入独立 M1c，不并入 M2/M3 | 见 §1；M3 的 `/admin/jobs` 提前并扩展 |
| token 记录粒度 | 逐次调用明细账本（`ai_usage` 表） | 聚合可从明细推导，反之不行；Vercel AI SDK 每次调用返回 usage，成本可控。只记 token 数不折算金额（BYO endpoint 价格未知） |
| 状态呈现形态 | 集中 pipeline 面板 + `/sources` 每源挂状态 | 失败排查与 token 归因需要集中落脚点；「某个源挂没挂」就近看 |
| 面板刷新机制 | RSC + tab 可见时轮询 `router.refresh()`（5s） | SSE 需 worker 侧 NOTIFY 改造 + web 侧 LISTEN 常驻连接，且 serverless 模式无法持有长连接，违反「两种部署模式同一套代码」硬性约束；面板场景消费不了 <1s 延迟。轮询查询为毫秒级索引聚合，且仅面板可见时进行，负载与 pg-boss 自身的待机轮询同数量级。查询逻辑全部收口在 core（`getPipelineStatus` 等），将来换传输层只动外壳 |
| feed 源关联 | 源徽章可点击 → 按源筛选 | 覆盖「这条哪来的」与「这个源都拉了什么」两个方向；多维筛选条仍留 M5 |

> 多用户说明：用户提出未来可能拓展多用户。多用户仍是母 spec 的明确非目标（硬性约束），真要做属于 deliberate spec change，其工作量（auth、全库 user_id、单行 user_settings 重构）远超面板传输层的替换成本，故不影响本次架构选择；本设计通过「查询逻辑全部进 core」保留替换传输层的自由度。

## 3. 范围

1. **`ai_usage` 明细账本** + 四处真实调用点埋点（embed/score/summary/deep_summary，§5）；
2. **`/admin/jobs` pipeline 面板**（自 M3 提前并扩展，§6.1）；
3. **`/sources` 源管理页**（CRUD + 每源状态 + 立即拉取，§6.2）;
4. **feed 源关联**（徽章可点击 + 按源筛选，§6.3）；
5. **表单容错修复**（出错不丢已填内容，§6.4）；
6. **文档同步**（§9）。

**非目标**：右侧栏今日统计（M5）、feed 多维筛选条（M5）、SSE 实时推送、pg-boss 任务级浏览/归档历史 UI（**队列深度与孤儿检测除外**，见 §6.1）、token 金额折算、多用户预留。

**前置条件**：M1b worktree（`worktree-m1b-product`）合并回 main，M1c 在其上开发。

## 4. 数据模型

### 4.1 新表 `ai_usage`（第 12 张表）

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigserial PK | |
| item_id | uuid NULL → items，ON DELETE SET NULL | agent/搜索类调用无关联 item；item 删除后账本保留 |
| stage | text NOT NULL | 调用发生的 pipeline stage 或功能名。**现有四处真实 AI 调用**：`embed`（embedMany）、`score`（generateObject——主题评分的 LLM 调用在 M1 即为真实调用，仅 depth_score 仍是 stub）、`summary`（generateText，独立的 summary stage，非 extract 内部）、`deep_summary`（streamText）。`extract` 仅 Readability、无 AI 调用。M3+ 扩展 dedup/digest，M4 扩展 agent |
| kind | text NOT NULL | `'llm'` / `'embedding'` |
| model | text NOT NULL | 实际请求的 model 名 |
| input_tokens | integer | |
| output_tokens | integer NULL | embedding 调用为 NULL |
| total_tokens | integer | |
| created_at | timestamptz DEFAULT now() | |

索引：`created_at`（时间窗聚合）、`item_id`。

### 4.2 `sources` 表新增列

`last_fetch_error text NULL`——NULL 表示上次拉取成功。拉取时间复用已有 `last_polled_at`；每源已入库条数从 items 聚合查询，不加冗余计数列。

### 4.3 删源语义

默认删源保留内容：沿用 schema 既有 `items.source_id ON DELETE SET NULL`，孤儿条目权重自动回落 `user_settings.adhoc_source_weight`（母 spec 既有语义）。删除确认弹窗提供「连同该源全部内容一并删除」勾选项（先删 items 再删 source）。

## 5. 埋点设计

`packages/core/src/ai/` 新增统一的 best-effort 记录函数 `recordUsage(ctx, fields)`：各调用点在拿到 SDK 返回的 `usage` 后立即调用，完成后写 `ai_usage`——写入失败只记日志、不抛错，绝不影响 pipeline 本身。

- 现有四处真实调用点埋点：`embed`（embedMany）、`score`（generateObject）、`summary`（generateText）、`deep_summary`（streamText，在 `onFinish` 里记录）；
- `extract` 仅 Readability、无 AI 调用；`testLLM`/`testEmbedding` 连通性探活不记录；
- 与「provider 调用必须过 `core/ai`」的既有硬性约束共用同一收口点：新增调用点默认就有账本。

## 6. UI 设计

### 6.1 `/admin/jobs` pipeline 面板

路由 `(authed)/admin/jobs`；左侧导航新增「Pipeline」「源管理」入口。自上而下六个区块：

1. **状态分布** — 7 个 state（6 stage + failed）计数条，点击锚点跳对应明细；
2. **队列健康** — 每 stage 队列的 created/retry/active 计数；**孤儿检测**：处理中（非 done/failed）的 item 在队列中不存在对应待执行/执行中任务 → 标红「任务丢失」+「重新入队」按钮。这是 items 表自身回答不了的唯一缺口（「还在排队」vs「任务已丢」）；
3. **处理中明细** — 非 done/failed 的 item，最近 50 条、最久未动排前：标题、来源、current_stage、attempts、updated_at；超 30 分钟未动高亮「疑似卡死」。不链接详情页（详情页只查 done，硬性约束不动）；
4. **失败明细** — `state='failed'`：标题、来源、current_stage、attempts、last_error（截断可展开）、失败时间、**[从 current_stage 重试]**；
5. **Token 消耗** — 今日 / 近 7 日按 stage 汇总（次数、input/output/total）；近 7 日 Top 10 耗 token item（标题 + 总量）；无 item 关联的调用单列一行；
6. **维度漂移** — env `EMBED_DIM` / `item_embeddings` 列实际维度 / `user_settings.embed_dim` 三方一致性检查，不一致显示警告与处理说明（对应 `scripts/pipeline-status.ts` 的同名 section；CLI 脚本保留作 headless 备用）。

**刷新**：客户端组件 `<AutoRefresh>`，tab 可见时每 5s `router.refresh()`，带暂停开关与「上次刷新时间」。

**重试动作**：server action → core `retryItem(itemId)`：校验 `state='failed'`（或孤儿 in-flight），attempts 归零、state 恢复为 current_stage 的前置 state（沿用 M1a 状态机映射）、从 current_stage 重新入队。复用 M1a 的状态机校验与队列幂等去重；孤儿「重新入队」与失败重试是同一个函数。

### 6.2 `/sources` 源管理页

**列表**，每行：名称、类型徽章（M1c 仅 rss）、URL、权重、**启用/暂停开关**（即时 server action）、上次拉取相对时间、拉取状态徽章（✓ / ✗ 展开看 `last_fetch_error`）、已入库条数（点击 → `/?source=<id>`）、操作 [立即拉取] [编辑] [删除]。

- **添加**：name + url + weight，提交即创建并**自动触发一次拉取**；
- **编辑**：name / url / weight，展开式表单；
- **删除**：确认弹窗 + 「连同内容删除」勾选（§4.3）；
- **立即拉取**：入队该源 fetch 任务，按钮短暂禁用防连点；**暂停的源允许手动拉取**（暂停只关自动轮询，手动拉取正是调试暂停源的场景）；
- **fetch handler 改造**：成功 → 更新 `last_polled_at`、清空 `last_fetch_error`；失败 → 写入错误信息；
- 复用 `<AutoRefresh>`，点完「立即拉取」能看到状态变化。

### 6.3 feed 源关联

- **ItemCard**：源名由灰色小字改为可点击 chip（边框 + hover 态）→ `/?source=<id>`；
- **feed 页**：接受 `?source=` 参数，`listFeed` 增加 `sourceId` 过滤（仍只查 `state='done'`）；激活筛选时顶部显示「来源：X · n 条 · ✕ 清除」；分页链接保留参数；
- 搜索页不动（自有筛选体系，母 spec 已定）。

### 6.4 表单容错修复

统一模式：server action 校验/连通性失败时返回 `{ error, values }`，表单以 `state.values ?? 持久化值` 作为 `defaultValue` 来源——出错后已填内容原样保留。适用 setup、settings、sources 三处。**例外**：登录/改密码表单出错不回填（安全惯例）；API key 字段回填提交值（单用户自己的会话，无泄露面）。

## 7. 错误处理边界

| 场景 | 行为 |
|---|---|
| ai_usage 写入失败 | 只记日志不抛错，pipeline 不受影响 |
| 重试竞态（状态已变 / 重复点击） | 状态机校验拒绝 + 队列幂等去重兜底（M1a 已有）；action 返回错误并刷新 |
| 孤儿检测误报（判断间隙任务恰好完成） | 检测仅提示；「重新入队」过同一套状态机校验，误报无害 |
| 删源（连同内容）时有 in-flight 任务 | handler 遇 item 不存在 → 优雅跳过（no-op complete）；plan 阶段确认现有 handler 行为并补齐 |
| 改源 URL | 已入库 items 不动（url_hash 在 item 级），下次拉取按新 URL |
| AutoRefresh 请求失败 | 静默跳过本轮，下周期重试；会话过期走现有 (authed) 重定向 |

## 8. 测试策略

**core（Testcontainers，TDD）**：

- usage 包装：mock provider 返回 usage → 落行；写入失败不抛错；
- `getPipelineStatus`：各状态聚合正确；孤儿检测命中/不命中；
- `retryItem`：恢复前置状态并重新入队；拒绝非 failed/非孤儿；重复调用幂等；
- `listFeed`：按 sourceId 过滤且仍只返回 done；
- sources CRUD：删除两分支（保留/级联）；fetch handler 成功清空 / 失败写入 `last_fetch_error`。

**web e2e（Playwright，沿用 benkyou_e2e 独立库）**：

1. 源管理金路径：添加源（mock RSS）→ 自动拉取 → 面板看到流转至 done → feed 出现 → 点 chip 按源筛选 → 清除；
2. 失败排查路径：构造 failed item → 面板显示 last_error → 重试 → 恢复；
3. 表单回填回归：settings 提交非法值 → 报错且已填内容保留。

**i18n**：新增字符串 zh/en 全量，`check:i18n` CI 兜底。

## 9. 母文档与 CLAUDE.md 变更清单（随 M1c 实施提交）

1. 母 spec §15 里程碑表：M1 后插入 M1c 行；M3 行移除「`/admin/jobs` 失败 retry UI」；
2. 母 spec §15：删除 5 个月/22 周工期框架与「周」列（项目为 agent 编程主导，工期不再是设计约束）；
3. 母 spec §5 schema：补 `ai_usage` 表与 `sources.last_fetch_error`；
4. 母 spec §9.1：`/admin/jobs` 描述由「失败任务列表 + retry」扩展为本设计 §6.1；§9.4 卡片「来源 badge」标注可点击筛选；
5. CLAUDE.md：删除「5-month solo build」工期描述。

## 10. 实施顺序（plan 阶段细化为任务）

1. 合并 M1b → main（前置）；
2. 文档同步（§9）；
3. schema：`ai_usage` + `sources.last_fetch_error` + migration；
4. core：`recordUsage` + 四处调用点埋点（embed/score/summary/deep_summary）；
5. core：`getPipelineStatus` / `retryItem` / sources CRUD / `listFeed` 过滤；
6. web：表单容错修复（回归测试先行）；
7. web：`/sources` → `/admin/jobs` 面板 → feed 关联；
8. e2e + i18n 收尾。
