# Benkyou · 个人 AI 资讯聚合与学习平台 — 设计文档

**Version**: 0.1 (Draft)
**Date**: 2026-05-27
**Status**: 待评审

---

## 1. 概述 · Overview

Benkyou 是一个开源、自部署的个人 AI 资讯聚合平台，目标是**降低高质量信息的获取成本**：

- 整合用户订阅的多平台资讯源（RSS、HN/Reddit、YouTube/Bilibili），统一 timeline
- 用 AI 对每条内容打分（主题相关 + 内容深度 + 来源权重 + 同事件去重），过滤低质内容
- 提供每日 AI 精选日报，按"资讯"和"知识"两类分别推荐
- 用户临时看到的文章 / 视频可粘贴 URL 入库，自动提取正文 / 字幕 / 转写
- 提供基于语义检索 + 工具调用的 Q&A Agent，能根据自然语言完成检索、推荐、汇总

### 1.1 目标用户

- 自部署的个人开发者 / 信息工作者
- 关心 AI 行业前沿、但被信息过载困扰的人
- 中英双语用户均覆盖

### 1.2 项目背景

作者休假期内 ~5 个月的全职项目，目标兼顾：

1. 重新熟悉全栈开发（前端开发者第一次完整设计后端 + Worker + 数据库）
2. 作为简历项目，展示 RAG / Agent / 流水线 / 全栈系统设计能力
3. 开源到 GitHub，供他人自部署使用

---

## 2. 设计原则 · Principles

1. **Self-host first**：核心应用（web + worker + postgres）完全自部署，无强制 SaaS 依赖。AI 能力是开箱条件：用户必须提供 LLM endpoint（可选 SaaS 如 Anthropic / OpenAI / DeepSeek，或完全本地 Ollama）。embedding 同理。视频转写如果走"无字幕路径"还需要 Whisper 兼容 endpoint（也可本地化部署 faster-whisper 等）。
2. **Bring-your-own AI（多 provider 适配）**：LLM 与 embedding 通过 [Vercel AI SDK](https://sdk.vercel.dev/) 抽象，原生支持 Anthropic / OpenAI / Google / DeepSeek / Ollama 等多家 API（不强求 OpenAI Chat Completions 兼容）。Whisper 走 OpenAI Whisper-API 兼容协议。
3. **单一数据库**：PostgreSQL + pgvector 承担关系数据、向量、全文检索、任务队列四种角色。
4. **代码复用**：App（Next.js）和 Worker（Node 进程）共享一个 `packages/core` 业务逻辑库。
5. **双部署形态**：同一份代码既能跑 Docker Compose（长跑 worker），又能跑 Vercel + Supabase（cron 触发 serverless）。
6. **YAGNI**：当前不为"多用户/个性化推荐/浏览器扩展"等后期功能预留任何字段或抽象。

---

## 3. 范围 · Scope

### 3.1 MVP（v1）必做

**内容获取**

- RSS / Atom 订阅源（多个源、自定义抓取间隔）
- YouTube 频道订阅 + 字幕 API 抓取
- Bilibili 频道订阅 + 字幕 API 抓取
- 视频转写（无字幕时，调外部 Whisper 兼容 endpoint）

**AI 处理**

- 每条内容生成轻量摘要（1-2 句，列表展示用）
- 质量评分：主题相关性 (A) + 内容深度 (B) + 来源权重 (D)
- 同事件去重聚合 (E)

**UI / 功能**

- Hybrid 首页：今日 AI 日报（资讯类 + 知识类两栏） + 完整 Feed
- 完整 Feed 浏览（筛选、无限滚动）
- 统一收藏夹（订阅 + 手动粘贴内容共用）
- 临时 URL 粘贴处理（文章 / 视频）
- 语义搜索（混合"全文检索 (PG ts_rank) + 向量 + 质量重排"）
- Q&A Agent（独立 `/chat` 页 + 右下浮动球抽屉双形态，共享对话历史）
- 来源管理 UI
- 用户设置 UI（LLM endpoint、兴趣标签、来源权重、密码）
- Session-based 单密码认证
- 深色模式（跟随系统 + 手动覆盖）
- 移动端响应式
- 中英双语 i18n

### 3.2 二期（v2）

- HN / Reddit 订阅（用户选 subreddit / 类别）
- 微信公众号源（通过 RSSHub 等代理）
- 教学视频画面识别（关键帧 OCR + 多模态 LLM）

### 3.3 后期

- 个性化推荐 (C)：基于用户行为反馈学习
- 浏览器扩展（Chrome / Firefox）

### 3.4 非目标 · Non-Goals（明确不做）

- 多用户 / 多租户
- 全部依赖外部或本地推理 endpoint（不自训模型）
- 笔记 / 标注 / 高亮（不重做 Readwise）
- 社交分享 / 评论
- 离线模式
- 原生移动端 app（响应式 web 已覆盖）

---

## 4. 架构总览 · Architecture

### 4.1 代码组织

```
benkyou/
├── apps/
│   ├── web/                    # Next.js App Router 应用
│   │   ├── app/                # 路由 / 页面 / Server Components
│   │   ├── components/         # React UI 组件
│   │   ├── lib/                # Web 专属 utilities
│   │   └── messages/           # i18n 翻译文件 (en, zh)
│   └── worker/                 # Node 后台 worker 进程
│       └── index.ts            # 入口，按 DEPLOY_MODE 切换长跑/触发模式
│
├── packages/
│   └── core/                   # 共享业务逻辑库
│       ├── db/                 # Drizzle ORM schema + 迁移
│       ├── sources/            # 源适配器（rss / hn / reddit / youtube / bilibili / adhoc）
│       ├── ai/                 # LLM/embedding 走 Vercel AI SDK; Whisper 自封装 OpenAI-API 兼容客户端
│       ├── pipeline/           # 6 个 stage 的处理函数
│       ├── search/             # 混合检索 + RRF + 重排
│       ├── agent/              # Tool 定义 + 调度
│       ├── auth/               # Session + 密码相关
│       └── i18n/               # 共享 i18n 工具
│
├── docker-compose.yml
├── Dockerfile.web
├── Dockerfile.worker
├── .env.example
└── package.json (pnpm workspace)
```

### 4.2 运行时进程

```
┌──────────────────────────────────────────────────────────────┐
│ 进程 1: web (Next.js, :3000)                                 │
│   - SSR / Server Components                                  │
│   - API routes / Server Actions                              │
│   - Session middleware                                       │
│   - import packages/core/*                                   │
└────────────┬──────────────────────────────────┬──────────────┘
             │                                  │
             ▼                                  ▼
┌──────────────────────────┐    ┌──────────────────────────────┐
│ 进程 3: postgres + pgvec │    │ 进程 2: worker (no port)    │
│ - 业务数据                │◄──►│   - 长跑 / cron 触发模式    │
│ - pg-boss 任务表          │    │   - 拉源 / 处理 pipeline    │
│ - embeddings              │    │   - import packages/core/*  │
│ - tsvector ts_rank 索引      │    └──────────────────────────────┘
└──────────────────────────┘
```

### 4.3 数据流（一条 item 的生命周期）

```
触发 (cron / 用户粘贴)
  → Worker.ingest    # 抓列表/单条入库, state=pending
  → Worker.extract   # 抓正文/字幕/转写, state=extracted
  → Worker.embed     # 生成向量, state=embedded
  → Worker.score     # LLM 打分 (A + B + category), state=scored
  → Worker.dedup     # 向量聚类, 写 cluster_id, state=dedup_done
  → Worker.summary   # 生成 1-2 句摘要, state=done
       │
       ├─→ 进入 feed (默认 published_at DESC; 可切"智能排序"用 final_score)
       ├─→ 被日报候选 (每日 cron 选 top-N per category)
       ├─→ 可被搜索 (ts_rank + vector index)
       └─→ 可被 Agent 工具调用 (search_items, multi_doc_summarize, ...)

注: feed / 日报 / search / agent 工具的所有查询都加 `state = 'done'` 过滤；
处理中或失败的 item 不对用户可见（仅 /admin/jobs 能看到）。

用户点击详情 → 触发 lazy deep summary（一次性，结果缓存）
```

---

## 5. 数据模型 · Data Model

PostgreSQL 16 + pgvector 0.7+ 扩展。所有时间戳用 `timestamptz`。

### 5.1 配置表

```sql
-- 单行配置（id = 1）
user_settings
  id                int primary key default 1
  password_hash     text not null               -- argon2id
  locale            text not null default 'zh'  -- zh | en
  -- LLM (via Vercel AI SDK)
  llm_provider      text                         -- 'anthropic'|'openai'|'openai-compatible'|'google'|'mistral'|'ollama'|...
  llm_base_url      text                         -- 仅 provider ∈ {openai-compatible, ollama, ...} 时填
  llm_api_key       text                         -- 自部署明文存可接受；不需要时留空（如 ollama 本地）
  llm_model         text
  llm_cheap_model   text                         -- 用于评分等高频低需求场景
  -- embedding (via Vercel AI SDK)
  embed_provider    text
  embed_base_url    text
  embed_api_key     text
  embed_model       text
  embed_dim         int not null                 -- 在迁移期 freeze，UI 只读；切换需运行维护脚本
  -- whisper (可选, OpenAI Whisper-API 兼容)
  whisper_base_url  text
  whisper_api_key   text
  whisper_model     text
  -- 偏好
  interest_tags     text[]                       -- ["LLM", "agent", "推理", ...]
  weight_alpha      numeric default 0.6          -- 主相关性权重（search=rrf_score / digest=topic_score）
  weight_beta       numeric default 0.3          -- depth_score 权重
  weight_gamma      numeric default 0.1          -- source.weight 权重
  digest_count      int default 5                -- 日报每类条数
  video_auto_limit  int default 1800             -- 自动转写上限（秒）
  video_manual_limit int default 10800           -- 手动转写上限（秒）
  adhoc_source_weight numeric default 1.0        -- 手动粘贴（source_id IS NULL）默认权重，用于 final_score
  pipeline_max_attempts int default 3            -- 单 stage 最大重试次数
  updated_at        timestamptz default now()
```

### 5.2 认证表

```sql
sessions
  id           text primary key       -- 32 字节 base64url 随机
  expires_at   timestamptz not null
  created_at   timestamptz default now()
  last_used_at timestamptz default now()
  ip           text                   -- 审计用
  user_agent   text                   -- 审计用
```

### 5.3 内容主链

```sql
sources
  id            uuid primary key default gen_random_uuid()
  type          text not null           -- 'rss' | 'hn' | 'reddit' | 'youtube' | 'bilibili'
  name          text not null
  config        jsonb not null          -- 类型特定: {url} | {subreddit} | {channel_id}
  weight        numeric default 1.0
  enabled       bool default true
  poll_interval int default 1800        -- 秒
  last_polled_at timestamptz
  last_fetch_error text                  -- NULL = 最近一次抓取成功；失败时记录信息供 /sources 展示
  created_at    timestamptz default now()

items
  id              uuid primary key default gen_random_uuid()
  source_id       uuid references sources(id) on delete set null  -- null = 临时粘贴
  external_id     text                                              -- 源内唯一 id (RSS guid / HN id 等)
  url             text not null
  url_hash        text not null                                    -- sha256(normalize(url))，全局去重锚
  title           text not null
  author          text
  published_at    timestamptz
  content_type    text not null                                    -- 'article' | 'video' | 'discussion' | 'paper'
  raw_content     text                                             -- 正文 / 字幕 / 转写
  transcript_status text not null default 'na'                     -- 'na' | 'pending' | 'present' | 'skipped_too_long' | 'unavailable'
  transcript_segments jsonb                                        -- 视频说话人分段（如果可用）
  video_duration  int                                              -- 秒，仅视频
  video_kind      text                                             -- 'auto' | 'interview' | 'tutorial' | 'talk' | 'other'
  summary         text                                             -- 1-2 句轻量摘要
  deep_summary    text                                             -- lazy 生成的深度摘要
  deep_summary_at timestamptz
  topic_tags      text[]                                            -- LLM 输出，A 评分用
  depth_score     numeric                                           -- 0~1, B 评分
  topic_score     numeric                                           -- 0~1, A 与用户兴趣的匹配度
  category        text                                              -- 'news' | 'knowledge'
  cluster_id      uuid references event_clusters(id) on delete set null
  state           text not null default 'pending'                   -- 见下方状态机说明
  current_stage   text                                              -- 当前正在处理或下一个要处理的 stage
  attempts        int not null default 0                            -- 当前 stage 已尝试次数
  last_error      text                                              -- 最近一次失败的错误信息
  bookmarked      bool default false
  bookmarked_at   timestamptz
  ingested_at     timestamptz default now()
  updated_at      timestamptz default now()                        -- 每次 stage 状态流转时 bump，/admin/jobs 用于"最久未动/疑似卡死"排序
  search_vec      tsvector generated always as (
                    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
                    setweight(to_tsvector('simple', coalesce(summary,'')), 'B') ||
                    setweight(to_tsvector('simple', coalesce(raw_content,'')), 'C')
                  ) stored

  unique (url_hash)                                                 -- 全局唯一，覆盖手动粘贴与无 GUID feed
  unique (source_id, external_id)                                   -- 当二者均 NOT NULL 时的快速去重（部分索引在下方）

-- 状态机说明
-- state 取值: 'pending' | 'extracted' | 'embedded' | 'scored' | 'dedup_done' | 'done' | 'failed'
-- 任务执行中失败 → 仅写 attempts++ 和 last_error，state 不动；
-- pg-boss 自动 backoff 重试，直到 attempts 达到 user_settings.pipeline_max_attempts 后由 onFail 回调置 state='failed'，
-- current_stage 记录卡在哪一步，便于 /admin/jobs 重试。
-- 用户可见查询过滤 state = 'done'。

-- 索引
create index items_state_idx on items(state);
create unique index items_source_ext_uq on items(source_id, external_id)
  where source_id is not null and external_id is not null;
create index items_published_idx on items(published_at desc);
create index items_source_idx on items(source_id);
create index items_bookmarked_idx on items(bookmarked) where bookmarked = true;
create index items_updated_at_idx on items(updated_at);
create index items_search_vec_idx on items using gin(search_vec);

item_embeddings
  item_id       uuid primary key references items(id) on delete cascade
  embedding     vector($EMBED_DIM)  -- 维度在迁移期由 .env / user_settings.embed_dim 决定，并写死到 schema
  title_emb     vector($EMBED_DIM)  -- 同 embedding
  model_id      text                -- 记录用哪个模型生成

create index item_emb_hnsw on item_embeddings using hnsw (embedding vector_cosine_ops);
create index title_emb_hnsw on item_embeddings using hnsw (title_emb vector_cosine_ops);

ai_usage                                                          -- 每次 LLM/embedding 调用的 token 账本；聚合（今日/近 7 日/Top item）由此派生
  id            bigserial primary key
  item_id       uuid references items(id) on delete set null      -- agent/search 类调用无 item；item 删除后保留账本行
  stage         text not null                                     -- 'embed' | 'score' | 'summary' | 'deep_summary' | (M3+ 更多)
  kind          text not null                                     -- 'llm' | 'embedding'
  model         text not null
  input_tokens  int
  output_tokens int                                               -- embedding 为 NULL
  total_tokens  int
  created_at    timestamptz default now()

create index ai_usage_created_at_idx on ai_usage(created_at);
create index ai_usage_item_idx on ai_usage(item_id);
```

> **关于 embedding 维度**：`vector(N)` 在 pgvector 中是 hard-coded 类型参数，不能"动态 N"。因此 `embed_dim` 在**首次初始化迁移时**确定，写进 schema migration 模板。用户**一旦选定后不能在 UI 里改**；若要切换到不同维度的 model，需：改 `EMBED_DIM` → 重新生成迁移（让 `vector(N)` 匹配）→ drop `item_embeddings` 表 → 用新维度 recreate → 触发全量 re-embedding（自动以 batch 的方式跑）。**注：维护脚本 `scripts/migrate-embeddings.ts` 尚未实现，deferred 至有语料需保留时；在此之前的受支持方式是以新维度重新初始化（fresh re-install）。** 设置页面对 `embed_dim` 字段显示只读 + warning 说明（脚本就绪前不提供"运行脚本"入口）。
> **维度请求（截断）**：若所选模型原生维度高于 `embed_dim`，可在设置中开启 `embed_request_dimensions`，运行时向 provider 传入 dimensions 参数（openai: `dimensions`，google: `outputDimensionality`，openai-compatible/ollama: `openaiCompatible.dimensions`），让模型直接返回 `embed_dim` 维向量——**请求维度恒等于 `embed_dim`**，不改变冻结的列类型，也不需要 halfvec。注意：Google 在 `outputDimensionality < 原生维度` 时不会自动归一化；当前搜索用余弦距离 `<=>`（尺度无关）不受影响，若将来改用 `<#>`/`<->` 需在写入前做 L2 归一化。开启开关不会自动 re-embed 存量语料。

### 5.4 聚类与日报

```sql
event_clusters
  id              uuid primary key default gen_random_uuid()
  canonical_item  uuid references items(id) on delete set null      -- 删除 canonical 时 set null，dedup 下一轮重选
  keywords        text[]
  first_seen_at   timestamptz default now()
  last_updated_at timestamptz default now()
  item_count      int default 1

digests
  id           uuid primary key default gen_random_uuid()
  date         date not null unique
  intro_text   text
  generated_at timestamptz default now()

digest_items
  digest_id  uuid references digests(id) on delete cascade
  item_id    uuid references items(id) on delete cascade
  category   text not null      -- 'news' | 'knowledge'
  rank       int not null
  reason     text                -- LLM 给出的"为什么入选"
  primary key (digest_id, item_id)
```

### 5.5 Agent 对话

```sql
conversations
  id         uuid primary key default gen_random_uuid()
  title      text                              -- 自动生成自第一条用户消息
  created_at timestamptz default now()
  updated_at timestamptz default now()

messages
  id              uuid primary key default gen_random_uuid()
  conversation_id uuid references conversations(id) on delete cascade
  role            text not null                -- 'user' | 'assistant' | 'tool'
  content         text                          -- 用户/助手文本，或 null（如果是 tool call/result）
  tool_calls      jsonb                         -- assistant 的 tool calls
  tool_result     jsonb                         -- role=tool 时的结果
  referenced_items uuid[]                       -- 答案中引用的 item ids，用于跳转
  created_at      timestamptz default now()

create index msg_conv_idx on messages(conversation_id, created_at);
```

### 5.6 任务队列

由 `pg-boss` 库在 PG 中自动建表（schema 名 `pgboss`），应用代码通过其 API 提交/消费任务，不直接 SQL 操作。

---

## 6. 内容处理流水线 · Pipeline

### 6.1 整体设计

6 个 stage，每个 stage 是一个 pg-boss 命名任务。`items.state` 字段是状态机，幂等可重试。

```
ingest → extract → embed → score → dedup → summary → (done)
```

**触发方式**：

- 定时拉取：每个 source 按 `poll_interval` 周期，pg-boss schedule 触发 `ingest:<source_id>` 任务
- 用户粘贴 URL：API 接收 → 创建 item（state=pending）→ 直接入队 `extract` 任务（跳过 ingest）

**失败处理（关键：重试期间状态不变）**：

- 每个 stage 任务进入 worker 时：`current_stage` 写入要处理的 stage 名；`attempts++`
- 任务抛错 → 仅写 `last_error`；**不立刻**修改 `state`；pg-boss 自动 exponential backoff
- pg-boss 重试到 `user_settings.pipeline_max_attempts`（默认 3）次仍失败 → 在 `onFail` 回调中：将 `state` 置为 `'failed'`，`current_stage` 保留为卡住的 stage
- 任务成功 → state 推进到下一档（如 `extracted`），`attempts = 0`，`current_stage` 设为下一 stage
- `/admin/jobs` 列出所有 `state='failed'` 的 item，支持"从 current_stage 重试"按钮，重置 attempts 后重新入队
- 用户可见查询统一过滤 `state = 'done'`；`failed` / 中间态对普通用户不可见

**新增 stage 时的检查清单**：

1. 更新 `items.state` 枚举值（本节 + §5.3 schema）
2. Drizzle schema（如需新列）
3. `packages/core/src/pipeline/` 中的 stage handler
4. Worker 分发器 —— 长驻 loop 与 serverless batch handler **两处都要**

### 6.2 各 stage 详情

#### ingest（仅自动源）

- 输入：`source_id`
- 行为：调对应适配器（RssAdapter / YoutubeAdapter / ...）拿"新条目列表"
- 用 `(source_id, external_id)` unique 约束去重
- 每条新 item 入队一条 `extract:item_id`
- 更新 `sources.last_polled_at`

#### extract

- **RSS**：feed 里有 `content:encoded` 全文用之；只有 description 的，fetch HTML + Mozilla Readability 提取正文
- **HN/Reddit**（v2）：调官方 JSON API 拿 story + 前 N 个评论
- **YouTube**：先调字幕 API；有字幕直接存入 `raw_content`，并尝试解析说话人（若 API 提供）
- **Bilibili**：调 Bilibili 字幕 API（公开）
- **视频无字幕**：先取 video metadata 拿到 `video_duration`，写入 item。再判断转写策略：
  - 自动源 + `duration > video_auto_limit` → `transcript_status='skipped_too_long'`，`raw_content=null`，**继续后续 pipeline**（embed/score 只用 title + metadata；UI 显示"未转写"badge，用户可手动批准）
  - 手动粘贴 + `duration > video_manual_limit` → 拒绝粘贴，前端报错"超过上限，请缩短或在设置里上调上限"
  - 手动粘贴 + `duration > video_auto_limit` 但 `< video_manual_limit` → 前端展示预估成本，用户勾选"确认转写成本"后才入队 `transcribe`
  - 其他情况 → 入队 `transcribe:item_id` 子任务（`transcript_status='pending'`）
- **临时粘贴 URL**：识别是否为视频域名，分别走视频/文章路径

`transcribe` 子任务：
- 用 ffmpeg 提音频（短视频可跳过，直接送音频 URL）
- 长视频切 10min chunk，5s overlap
- `Promise.all` 并发调 Whisper endpoint
- 合并 transcripts，处理 chunk 边界（用 overlap 内的相似度对齐）
- 若 endpoint 返回 speaker labels（如 Deepgram），存入 `transcript_segments` jsonb；否则 `raw_content` 存纯文本
- 完成 → `transcript_status='present'`；失败超 max attempts → `transcript_status='unavailable'`（继续 embed/score 用 title）

#### embed

- 拼接 `title + "\n\n" + truncate(raw_content, 4000 tokens)` → 调 embedding endpoint
- 单独 embed `title` 存入 `title_emb`（用于 dedup 聚类）
- 写入 `item_embeddings`，记录 `model_id`

#### score

- 一次 LLM 调用同时产出：
  - `topic_tags[]`（标准化后存）
  - `topic_score`：与 `user_settings.interest_tags` 的匹配度
  - `depth_score`：按 hype / news / tutorial / deep-dive 四档评分（0~1）
  - `category`：`'news'` (hype/news) | `'knowledge'` (tutorial/deep-dive)
  - **针对 video_kind**：prompt 模板分支（访谈 → Q&A 风格 / 教程 → 步骤要点 / talk → 大纲）
- 用便宜模型（`llm_cheap_model`），降低成本
- **D（来源权重）不在此处烧入**，留到查询时 join `sources.weight` 现算

#### dedup

- 用 `title_emb` 在过去 N 天（默认 7 天）内 cosine 相似度 > 阈值（默认 0.85）查（HNSW 索引）
- 命中 → 加入对方 cluster；按 `effective_weight = COALESCE(sources.weight, user_settings.adhoc_source_weight)` 重选 `canonical_item`
- 未命中 → 新建 cluster
- 更新 `event_clusters.item_count` 与 `last_updated_at`
- 当 canonical_item 被删除（`ON DELETE SET NULL`）时，下一次 dedup 任务进入这个 cluster 触发时会自动 re-elect canonical

#### summary

- 调 LLM 生成 1-2 句轻量摘要（用 `llm_cheap_model`）
- 所有 item 都做，列表展示用

#### deep_summary（按需，lazy）

- **不是 pipeline 的一部分**
- 用户点击 `/items/[id]` 时，若 `deep_summary IS NULL`，前端调 `POST /api/items/[id]/deep-summary`
- API 触发 LLM 用主模型生成结构化深度摘要（TL;DR + 关键要点列表 + 你能学到什么）
- 流式返回（SSE）+ 完成后写入 `deep_summary`、`deep_summary_at`

### 6.3 日报生成

每天定时（默认本地时间 08:00）触发 `digest:generate` 任务：

1. 查询过去 24 小时（或上次日报后） `state='done'` 的 items
2. 用 `final_score = α·topic_score + β·depth_score + γ·effective_weight` 排序，其中
   `effective_weight = COALESCE(sources.weight, user_settings.adhoc_source_weight)`，
   α/β/γ 复用 `user_settings.weight_*`
3. 按 `category` 分组，各取 top `digest_count`（默认 5）
4. 用 LLM 生成 intro 段落（简介今日要点） + 每条的入选理由
5. 写入 `digests` + `digest_items`

> 注：search 与 digest 用同一组 α/β/γ 权重；不同的是 α 在 search 时乘 `rrf_score`、在 digest 时乘 `topic_score`（因为 digest 没有用户 query）。如果未来希望两边独立调权重，再加 `digest_weight_*` 三列即可，schema 改动最小。手动粘贴内容（`source_id IS NULL`）的权重统一用 `user_settings.adhoc_source_weight` 兜底。

---

## 7. 搜索 · Search

### 7.1 混合检索流程

输入：用户查询字符串 + 可选 filters（category / source_type / date_range / bookmarked_only）。

1. **filters 前置 + 并行两路查询**：用户提供的 filters 与"`state='done'`"一并作为 WHERE 条件**直接进入两路候选查询**，确保各自在筛选后的空间中召回 top 50：
   - 全文检索：`SELECT id, ts_rank(search_vec, plainto_tsquery(...)) FROM items WHERE state='done' AND <filters> ORDER BY ts_rank DESC LIMIT 50`
   - 向量：`embed(query)` → `SELECT id, embedding <=> $vec FROM items JOIN item_embeddings ... WHERE state='done' AND <filters> ORDER BY <=> ASC LIMIT 50`
2. **RRF 合并**：`score = 1/(60 + rank_lex) + 1/(60 + rank_vec)`，排序取前 30
3. **质量重排**：`final = α·rrf_score + β·depth_score + γ·effective_weight`（同 digest 公式的 `effective_weight` 处理）
4. **防御性过滤**：极少数 edge case（如 RRF 后某 item 的 source 在筛选时刚好刚被禁用）→ 再过一遍 filter
5. **返回 top 20** with `ts_headline` 高亮片段

`α / β / γ` 取自 `user_settings`，前端有"权重调试"工具供高级用户调整。

> **关于"全文检索"术语**：本设计使用 PostgreSQL 内建 `ts_rank`（基于词频 + 位置权重，**不是严格的 BM25**）。对绝大多数中英混合 AI 资讯场景已经够用。未来若需要严格 BM25，可换用 `pg_search` 扩展（社区维护）或将 lexical 路径外包到 Tantivy / Meilisearch；接口保持一致即可。

### 7.2 性能保障

- HNSW 索引（pgvector 内建）：百万级 items 仍亚秒
- GIN 索引在 `search_vec` 上
- 全表 < 50 万条时，两路并行执行 < 100ms

---

## 8. Q&A Agent

### 8.1 工具集

```typescript
search_items(query: string, filters?: {
  date_range?: '24h' | '7d' | '30d' | 'all'
  category?: 'news' | 'knowledge'
  source_type?: string
  bookmarked_only?: boolean
}, limit?: number)
  → Array<{id, title, source, summary, depth_score, category, published_at}>

list_recent(filters: {
  date_range: string
  category?: string
  source_type?: string
}, limit: number)
  → Array<{...}>

get_item_detail(item_id: string)
  → {title, full_content, deep_summary?, transcript_segments?, ...}

multi_doc_summarize(item_ids: string[], focus?: string)
  → {summary: string, by_item: Record<id, string>}

get_user_context()  // 可选
  → {interest_tags, recent_bookmarks, top_sources}
```

### 8.2 调度循环

通过 Vercel AI SDK 的 `streamText({ tools, ... })` 标准 tool-use loop——SDK 自动处理多轮工具调用 + 流式输出 + provider 差异：

```ts
const result = streamText({
  model: providerModel,           // 用户配置的 LLM (Vercel AI SDK 抽象)
  messages,
  tools: TOOL_DEFINITIONS,
  maxSteps: 5,                    // 最多 5 轮 tool-use 迭代防失控
});

for await (const chunk of result.fullStream) {
  // chunk.type ∈ {text-delta, tool-call, tool-result, finish, error}
  // 转发为 SSE 事件给前端
}
```

工具执行（`tools.execute`）内部直接调 `packages/core/search`、`packages/core/items` 等，无网络往返。

### 8.3 流式响应

- 使用 Server-Sent Events
- 前端 EventSource 或 fetch + ReadableStream
- 事件类型：`token`（增量文本）、`tool_call_start`、`tool_call_end`、`done`、`error`
- 已收到的 token 实时渲染 React state

### 8.4 UI 双形态（选项 C）

**独立页 `/chat`**：

- 左侧对话历史列表（最近 20 条 + 搜索）
- 右侧消息流 + 输入框
- 引用 item 时显示 inline 卡片，可点击跳转 `/items/[id]`

**浮动球抽屉**：

- 右下角永驻按钮（除 `/chat` 页外所有页面）
- 点开 → 右侧滑出 400px 抽屉
- 与独立页共享 `conversation_id`：抽屉里聊到一半可"展开到独立页继续"
- 移动端：抽屉占全屏

**状态共享**：通过 URL 参数 / localStorage 记录当前 `conversation_id`；两个 UI 都读同一个对话。

---

## 9. UI / UX

### 9.1 路由

| 路由 | 说明 |
|---|---|
| `/login` | 单密码登录 |
| `/` | Hybrid 首页（今日日报 + Feed） |
| `/feed` | 完整 Feed 视图（更丰富的筛选） |
| `/bookmarks` | 统一收藏夹 |
| `/search?q=` | 搜索结果 |
| `/chat` | Agent 独立对话页 |
| `/items/[id]` | 单条详情（lazy 深度摘要） |
| `/sources` | 源管理 |
| `/settings` | LLM / 兴趣 / 权重 / 密码 / 语言 |
| `/admin/jobs` | 六段式 pipeline 面板（自用）：状态分布 / 队列健康 + 孤儿任务 / 处理中（>30min 标记疑似卡死）/ 失败明细 + retry / token 消耗（今日 · 近 7 日 · Top item）/ embedding 维度漂移；可见 tab 时 5s 自动刷新 |

### 9.2 全局布局

**桌面端三栏**：

- 左侧导航（60px 折叠 / 220px 展开）
- 主内容（flex-1）
- 右侧上下文栏（280px）：兴趣标签 / 热门来源 / 今日处理统计；可隐藏

**移动端**：

- 顶栏 hamburger → 抽屉式左导航
- 右栏归并到设置页
- "粘贴 URL"按钮右下浮动

### 9.3 关键交互

- **无限滚动**：每加载 30 条显示锚点"已加载 X 条"
- **已读/未读**：localStorage 记录已点击 item id；不写库；视觉上暗淡显示
- **`Cmd+K`**：全局搜索快捷键
- **粘贴 URL modal**：
  - URL 输入框
  - 自动识别为视频时，显示视频类型下拉（auto / interview / tutorial / talk / other）
  - 显示预估成本（按时长 + 转写单价）
  - 长视频（> 30min）需勾选"确认转写成本"才能提交
  - 提交后显示处理进度：`queued → extracting → transcribing (45%) → scoring → done`
- **深色模式**：`prefers-color-scheme` 自动 + 设置页手动覆盖
- **i18n**：URL 不带 locale 前缀；Cookie 记录；header 右上角切换器

### 9.4 列表卡片元素

每个 item 卡片显示：

- 内容类型图标（📄 文章 / 🎥 视频 / 💬 讨论 / 📑 论文）
- 来源 badge + 名称（可点击 → `/?source=<id>` 按该源筛选 feed）
- 标题
- 评分指示（⭐ 数 + 类别图标：📰 资讯 / 📚 知识）
- 摘要（1-2 句）
- 时间 + 视频时长（如有）
- 操作：⭐ 收藏 / ↗ 原文

### 9.5 详情页元素

- 顶部：返回 / 收藏 / 原文 / 分享
- 元信息：标题 / 来源 / 作者 / 时间 / 评分 / 类别
- AI 深度摘要区（lazy 触发；首次有 skeleton + 进度提示）
- 原文内容（Readability 提取 / 字幕 / 转写）
- 视频带 transcript_segments 时显示说话人区分

---

## 10. 认证 · Auth

Session-based，**不用 JWT**。

### 10.1 流程

1. 首次部署：`.env` 提供 `INITIAL_PASSWORD`；启动时如 `user_settings.password_hash` 为空则 hash 后写入
2. 登录：POST 密码 → 服务端 argon2 verify → 创建 sessions 行 → 设置 HTTP-only `session_id` cookie
3. 每个请求：middleware 读 cookie → 查 `sessions` 表 → 验证未过期 → 更新 `last_used_at`（sliding expiration）
4. 登出：删 sessions 行 + 清 cookie

### 10.2 安全细节

- Cookie 属性：`HttpOnly`、`Secure`（生产）、`SameSite=Lax`
- Password hash：argon2id，参数 t=3, m=64MB, p=1
- CSRF：对所有 POST/PUT/DELETE 校验 cookie 中的 `csrf_token` 与 request header `X-CSRF-Token` 匹配
- 登录限速：每 IP 每分钟 5 次失败后退避（5 → 30 → 300 秒）
- Session TTL：30 天滑动过期；绝对过期 90 天

---

## 11. 部署与配置 · Deployment

### 11.1 Docker Compose（主推）

`docker-compose.yml` 提供三个服务：

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    volumes:
      - ./pgdata:/var/lib/postgresql/data
    env_file: .env.pg
    healthcheck: ...

  web:
    image: ghcr.io/<author>/benkyou-web:latest
    ports: ["3000:3000"]
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DEPLOY_MODE: docker

  worker:
    image: ghcr.io/<author>/benkyou-worker:latest
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DEPLOY_MODE: docker
```

### 11.2 Vercel + Supabase 兼容

- web 部署到 Vercel
- 数据库 = Supabase Postgres（启用 pgvector）
- `DEPLOY_MODE=serverless`
- worker 不启动；提供 `/api/cron/work` endpoint
- 外部 cron（cron-job.org / GitHub Actions / Upstash QStash）每 5 分钟 ping `/api/cron/work?max=20`
- Endpoint 内调 `pgboss.fetch(...)` 拉 20 条任务，逐个处理，10s 内返回

代码差异极小：worker 进程的"轮询循环"和 serverless endpoint 的"单次批处理"复用相同的 `processOne(job)` 函数。

### 11.3 .env 模板

```ini
# 部署模式
DEPLOY_MODE=docker            # docker | serverless

# Web
PORT=3000
SESSION_SECRET=               # 32 字节随机
NEXT_PUBLIC_APP_URL=http://localhost:3000

# 数据库
DATABASE_URL=postgresql://benkyou:pass@postgres:5432/benkyou?sslmode=disable

# 首次部署初始密码
INITIAL_PASSWORD=              # 首次启动后置空

# Embedding 维度（首次迁移时写入 schema，之后只能通过维护脚本变更）
EMBED_DIM=1536

# 以下默认值供首次 onboarding 预填表单使用；用户 UI 里可改。
# .env 中留空也可以，留空时 onboarding 强制用户在 UI 里填。
#
# LLM 与 embedding 通过 Vercel AI SDK 调用，provider 字段决定走哪个适配器。
# provider 可选: 'anthropic' | 'openai' | 'openai-compatible' | 'google' | 'mistral' | 'ollama' 等

DEFAULT_LLM_PROVIDER=            # 例: anthropic | openai | openai-compatible | ollama
DEFAULT_LLM_BASE_URL=            # provider=openai-compatible | ollama 时必填
DEFAULT_LLM_API_KEY=
DEFAULT_LLM_MODEL=               # 例: claude-haiku-4-5 / gpt-4.1-mini / qwen2.5:7b
DEFAULT_LLM_CHEAP_MODEL=         # 用于 score / summary 等高频低需求场景

DEFAULT_EMBED_PROVIDER=          # 例: openai | google | ollama | openai-compatible
DEFAULT_EMBED_BASE_URL=
DEFAULT_EMBED_API_KEY=
DEFAULT_EMBED_MODEL=             # 例: text-embedding-3-small / nomic-embed-text

# Whisper-API 兼容 endpoint（可选；视频无字幕路径需要）
DEFAULT_WHISPER_BASE_URL=        # 例: https://api.openai.com/v1 或 自托管 whisper-server
DEFAULT_WHISPER_API_KEY=
DEFAULT_WHISPER_MODEL=           # 例: whisper-large-v3
```

> **重要**：模板里**不预填具体 SaaS 厂商默认值**，因为 BYO AI 是用户主动决策的事（涉及隐私、费用、合规）。文档（README）会给出 4 套推荐配置作为示例：① 纯 SaaS Claude+OpenAI / ② 国内 SaaS DeepSeek+智谱 / ③ 完全本地 Ollama+本地 Whisper / ④ 混合（Claude API + 本地 embedding）。

### 11.4 首次启动 Onboarding

分两个阶段实现：

**Phase 1 · 最小可用（M1 必备）** — 让首部署用户从零到首页可用：

1. 检测 `user_settings` 为空 → 强制走 `/setup`
2. 用 `INITIAL_PASSWORD` 创建首个登录态，hash 后写入 `user_settings.password_hash`
3. LLM / embedding endpoint 表单（一次性必填 provider/base_url/api_key/model）+ 连通性测试（用 prompt "ping"）
4. 手动添加至少一个 RSS 源（输入框 + "添加"按钮）
5. 触发首次抓取 → 跳转首页（约 2 分钟后内容到达，期间显示骨架屏）

**Phase 2 · 完整引导（M5 polish）**：

6. 在 step 3 之后让用户输入兴趣标签（带候选建议 chips）
7. 在 step 4 替换为"勾选推荐源"UI：内置 10 个高质量 AI 源，用户勾选启用（仍允许跳过、自己手动加）
8. 完成步骤的可视化进度条 + 优雅文案 + 多语言翻译

### 11.5 CI/CD

- GitHub Actions：PR → lint + typecheck + unit + integration tests
- main 合并：自动构建并推送 `:latest` 到 GHCR
- Git tag `v0.x.y`：自动 release，image tag `:0.x.y`
- README 推荐用户 pin 到具体版本

---

## 12. 国际化 · i18n

- 库：`next-intl`
- 消息文件：`apps/web/messages/{en,zh}.json`
- 默认 locale：`zh`；用户可在右上角切换
- URL 不带 locale 前缀（避免 SEO 重复）
- Cookie 记录用户选择
- LLM 输出语言跟随 `user_settings.locale`（摘要、深度摘要、agent 回答都用当前语言）
- CI 加 i18n key 完整性检查（zh 和 en 必须 key 一致）

---

## 13. 测试策略 · Testing

### 13.1 工具

- Vitest（单元 + 集成）
- Playwright（E2E）
- Testcontainers-node（启 ephemeral PG）
- MSW（mock 外部 HTTP）

### 13.2 覆盖

| 层 | 数量 | 重点 |
|---|---|---|
| 单元 | ~100 | 纯函数：RRF 合并、score 公式、Readability、feed parser、dedup 阈值 |
| 集成 | ~30 | 完整 pipeline 流程（mock LLM）；每个 source adapter 的 happy + 异常路径 |
| E2E | ~10 | 登录、添加源、粘贴 URL、搜索、agent 对话、收藏、设置变更、密码改 |

### 13.3 必测点

1. Source adapters：每种源类型 fixture 覆盖正常 / 损坏 / 空 / 极长
2. Pipeline state machine：任意 stage 失败后 retry 不重复处理
3. Dedup 聚类：阈值边界 case
4. Search RRF：合并排名正确性
5. Agent tool calls：录制真实 LLM 响应做 fixture，覆盖流式 + 错误

---

## 14. 风险与缓解 · Risks

### 14.1 技术风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 视频转写成本失控 | 高 | 自动 30min 上限；手动需用户确认显示预估成本 |
| pgvector 50w+ 性能 | 中 | HNSW 索引；MVP 不太可能撞到 |
| RSS 格式多样性 | 中 | 用成熟库；try/catch 隔离单源故障 |
| HN/Reddit rate limit | 中 | worker 限速 + 退避（v2 才用到） |
| Whisper 接口质量参差 | 中 | 抽象层兼容多家；README 推荐 Deepgram for diarization |
| BYO endpoint 配错导致全线卡死 | 高 | onboarding 强制连通性测试；运行时失败有明确错误提示 |

### 14.2 项目执行风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Scope 蔓延 | 高 | 每 2 周对 spec 回顾，砍新冒出的"看着好"特性 |
| Agent UI 双形态 (C) 复杂度 | 中 | 必要时降级 A；公共状态层先做好 |
| 长视频转写体验 | 中 | UI 显示明确进度 + 预估时间 |
| i18n 同步遗漏 | 中 | CI key 完整性检查 |
| 后端能力首次系统化暴露 | 高 | 先做 vertical slice（一个源 → 一条 pipeline → 一个页面），跑通再扩 |

---

## 15. 里程碑 · Milestones

设计原则：

- **状态机的形态从 M1 开始就是最终形态**（6 个 stage 完整存在），各 stage 内部逻辑可分阶段从"stub 占位"演化为"完整实现"。这样：（a）`state='done'` 过滤语义全程稳定；（b）单元/集成测试一开始就能建立；（c）增量替换 stub 不需要改 schema。
- **首次启动闭环（auth + LLM 配置 + 添加源 + 触发抓取）从 M1 起必须可用**，但只用"最小可用 setup 流程"。完整 onboarding 引导（默认源、标签建议、文案打磨）放 M5。

| Milestone | 内容 |
|---|---|
| M0 · 骨架 | pnpm monorepo、DB schema（11 张表，含状态机字段）、Drizzle migrations、Docker Compose、CI（lint/typecheck/test）、Vercel AI SDK 接入、i18n 框架（next-intl） |
| M1 · 端到端最小闭环 | 实现完整 6-stage 状态机（**depth_score、dedup 用 stub**：前者固定 0.5，后者全部不聚类只新建 cluster），1 个 RSS 源跑通，最小 setup 流程（INITIAL_PASSWORD → 设置 LLM endpoint → 添加 RSS → 触发抓取 → 首页展示 → 详情页 lazy 深度摘要 → 搜索能找到）。**所有 user-visible 查询都按 `state='done'` 严格过滤**。 |
| M1c · 可观测性 & 源管理 | `ai_usage` token 账本 + 四处真实 AI 调用埋点（embed / score / summary / deep_summary）；`/admin/jobs` 六段式 pipeline 面板（状态分布 / 队列健康 + 孤儿 / 处理中 / 失败 / token 消耗 / 维度漂移）+ 失败与孤儿重试；`/sources` 增删改查 + 每源拉取状态（`last_fetch_error`）+ 立即抓取；feed 卡片来源徽章 → 每源筛选；setup/settings 表单校验失败时保留已填输入。 |
| M2 · 源拓展 | YouTube 字幕 / Bilibili 字幕 / 视频转写（含 chunked + diarization 解析）/ 临时 URL 粘贴 / transcript_status 各分支 |
| M3 · AI 全开 | 把 score stub 换成真 LLM 评分（A 主题相关 + B 深度分 + category）、dedup 真实聚类、日报生成、视频类型 prompt 分支 |
| M4 · Agent | 4 个工具实现、tool-use 循环、SSE 流式、独立 `/chat` 页 + 右下浮动抽屉双形态、对话历史 |
| M5 · Onboarding 打磨 | 默认源推荐列表 / 兴趣标签建议 / setup 步骤文案 / 深色模式 / 移动端响应式 / UI 细节 polish |
| M6 · 上线 | E2E 测试覆盖、README 中英双语、Vercel + Supabase 兼容路径与文档、GHCR 镜像发布、首次公开发布 |

每个 milestone 结束做一次 spec 复核，砍掉新冒出的"看着好"特性。M1 是最关键的——闭环能跑通后续都是增量。

---

## 16. 待决事项 · Open Questions

无重大未决项。次要待决：

- 默认源列表（M5 期确定）
- 兴趣标签初始候选（如 "LLM"、"Agent"、"推理" 等）的预设清单
- 日报触发时间（默认 08:00 本地，或让用户配置）

---

## 17. 附录 · 设计参考

- **daily.dev**：feed 卡片、来源管理、收藏夹、Chrome 扩展（v3+ 启发）
- **Perplexity**：搜索结果展示、引用、agent 风格回答
- **Claude.ai / ChatGPT**：对话 UI、流式渲染
- **Miniflux**：自部署 reader 的 UX 极简范式
- **Readwise**：bookmarks 与 reader 融合

---
*Spec 文档完。下一步：写实现计划（writing-plans skill）。*
