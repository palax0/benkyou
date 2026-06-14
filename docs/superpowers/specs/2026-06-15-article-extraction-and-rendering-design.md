# 文章正文的抽取与呈现 — 设计

> 2026-06-15。母文档：[2026-05-27-benkyou-design.md](2026-05-27-benkyou-design.md)。本文档定义对母文档 §6.2（pipeline 降级语义）与数据模型的增量与修订（见 §9 变更清单）。范围聚焦"文章正文从抽取到展示"的一条链路；视频/转写不在本设计内（见 [2026-06-14-benkyou-video-article-design.md](2026-06-14-benkyou-video-article-design.md)）。

## 1. 背景与动机

一次系统化调试（2026-06-15）暴露了文章抽取链路的三个问题：

1. **静默失败 + 兜底掩盖。** 粘贴 Medium 文章（`javascript.plainenglish.io`）后正文为空、但 AI 总结存在。根因：该站经 Cloudflare 返 **403 JS 挑战**（`cf-mitigated: challenge`，换真实浏览器 UA 仍 403），`fetchReadable` 对 `!res.ok` **静默返回 `null`** → 正文按 `null` 落库（spec §6.2"降级不报错"），且 `last_error` 不写（extract 阶段算"成功"）；`summary.ts` 命中"无正文则据标题"兜底，仍产出一个总结。净结果是"正文空 + 总结有"且全程零可观测——用户无从判断哪里出了问题。

2. **正文结构丢失,阅读困难。** 当前 `raw_content` 存的是 `htmlToText()` / Readability `.textContent` 抹平后的**扁平纯文本**,UI 仅 `<article class="whitespace-pre-wrap">` 原样输出。对带多级标题、代码块、列表的技术文,标题与正文无区分、代码与正文混作一团。

3. **抓取能力天花板。** 简单 `fetch` 抓不了 Cloudflare 挑战 / 客户端渲染（SPA）的站点。

**调整后的预期(重要):** 引入 reader 端点是"抬高天花板",**不是 Medium 的银弹**——Medium 这类"Cloudflare 挑战 + 登录/付费墙"叠加的站点服务器侧本就拒绝匿名请求,reader 也救不了。对这类受保护页面,本设计的目标是**优雅降级**(总结 + 原文链接 + 诚实标注),而非强行抓取。受保护页面的进一步方案(粘贴正文入口、浏览器插件)是独立路线项,**不在本设计范围**(见 §3 非目标、§9)。

## 2. 决策摘要

| 决策点 | 结论 | 理由 |
|---|---|---|
| 正文存储模型 | **双存储**：`raw_content` 续存纯文本(给机器),新增 `content_md` 存 markdown(给人看) | 母 spec 硬不变量(`search_vec` 生成列、冻结的 embedding 维度、summary)全围着 `raw_content` 转;双存储把"富阅读"与"搜索/AI"彻底解耦,blast radius 最小;markdown 是天然通用格式(Jina 原生、HTML 经 turndown) |
| 抽取中间格式 | markdown 为规范产物,`raw_content = stripMarkdown(md)` | 三条抽取路径统一收敛到 markdown 一种中间形态,纯文本由其派生,单一代码路径 |
| reader 端点契约 | **Jina 约定**:`GET {base}/{targetUrl}`,可选 `Bearer`,返回 markdown | 即插即用(r.jina.ai)且可自托管,契合自托管优先;返回 markdown 与双存储天然咬合 |
| reader 启用方式 | 仅当 `reader_base_url` 配置时启用,作为直连失败后的**最后兜底** | 直连免费、先行;reader 可能限流/付费,放最后;未配置 = 维持今天行为(只是现在会记录 `extract_status`) |
| 失败可观测 | 新增 `items.extract_status` 枚举列(与 `transcript_status` 平行) | `last_error` 在 `completeStage` 会被清空、且 extract"成功"不写它,不适合承载持久的"正文未抓取"信号;需专用列 |
| 失败处理 | 仍**只降级不重试**(reader/直连失败都记 `extract_status`、不抛错) | 与 spec §6.2 文章抽取一贯的"降级不阻塞管线"一致;瞬时错误重试留作未来可选(抛 `TransientFetchError`) |
| 受保护页面缺口 | 本次**不处理**,靠优雅降级(总结+原文链接+诚实标注) | 当前设计已自动落到 daily.dev 那个"地板";粘贴正文入口 / 浏览器插件是独立路线项,后者更是母 spec §3.4 的 postponed 非目标,属 deliberate spec change |

## 3. 范围

1. **reader BYO 客户端**（`sources/reader.ts`,Jina 约定,§5.1）;
2. **`resolveContent` 三段回退链**(feed → 直连 → reader,统一产出 markdown,§5.2);
3. **`fetchReadable` 改返回带原因的 outcome**(可观测核心,§5.2);
4. **双存储 schema**(`items.content_md` + `items.extract_status`,`ExtractResult` 增量,§4);
5. **设置**(`user_settings.reader_base_url` / `reader_api_key` + 设置页表单 + i18n,§6);
6. **UI**(markdown 阅读视图 + "正文未抓取"提示 + 总结"仅据标题"标注,§7);
7. **文档同步**(母 spec §6.2,§9)。

**非目标**:
- 受保护页面的"粘贴正文"入口、bookmarklet(独立小 spec,后续);
- 浏览器插件(母 spec §3.4 postponed 非目标,需独立 deliberate spec change);
- 把 `extract_status='blocked'` 类 item 计入 pipeline-health 聚合(它们 `state='done'`,非 failed);
- reader 调用计入 `ai_usage`(非 token 计费);
- 旧 item 的 `content_md` 回填迁移(缺失时 UI fallback 到 `raw_content`;要回填另开任务);
- 多维 feed 筛选、视频/转写(各有其 spec)。

## 4. 数据模型

### 4.1 `items` 列增量

| 列 | 类型 | 说明 |
|---|---|---|
| `content_md` | `text` NULL | 抽取得到的 markdown 正文,**仅供展示**。缺失(旧 item / 无正文)时 UI fallback 到 `raw_content` |
| `extract_status` | `text` NOT NULL DEFAULT `'ok'` | 与 `transcript_status` 平行的内容状态。枚举见下 |

`extract_status` 枚举:

- `ok` — 没有任何"需要的增强步骤"失败:feed 自带正文已达阈值,**或**直连/reader 成功返回(即便结果较短——一篇合法的短文也是 `ok`)
- `blocked` — 直连 HTTP 403 或 Cloudflare 挑战(`cf-mitigated` 等)
- `fetch_failed` — 网络错误 / 5xx / 抛异常
- `empty_parse` — 抓到页面但 Readability 解析为空(典型 SPA / 客户端渲染)

`ok` 与失败值的判定**不是**单纯按正文长度,而是按"是否有需要的增强尝试失败"(精确规则见 §5.2 step 4)。失败值在两种情形下出现:`content_md` 为空(完全没抓到),或 `content_md` 是一份不足阈值的 feed 摘要而后续增强失败(部分内容);两者由 UI 据 `content_md` 是否为空区分(§7.2)。

**只对 `content_type='article'` 有意义。** 不引入 `na` 枚举;非文章 item(视频等)其值停留在默认 `'ok'`,但 UI **仅在 `content_type='article'` 时解释/展示它**(视频走 `transcript_status`)。

**不动的列:** `raw_content`(续存纯文本)、`search_vec` 生成列(schema.ts:151,仍读 `raw_content`)、embedding、summary —— 零改动,是双存储的核心收益。

### 4.2 `user_settings` 列增量

| 列 | 类型 | 说明 |
|---|---|---|
| `reader_base_url` | `text` NULL | Jina 风格 reader 端点 base;NULL = 不启用 reader 回退 |
| `reader_api_key` | `text` NULL | 可选,作 `Authorization: Bearer` |

仿现有 `whisper_*` 三件套的配置形态,但 reader 无需 model。

### 4.3 `ExtractResult` 契约增量(`sources/types.ts`)

```ts
export interface ExtractResult {
  rawContent: string | null;     // 纯文本(stripMarkdown 派生),续用
  contentMd?: string | null;     // 新增:markdown 正文,展示用
  extractStatus?: ExtractStatus; // 新增:'ok' | 'blocked' | 'fetch_failed' | 'empty_parse';dispatcher 默认 'ok'
  contentType: 'article' | 'video' | 'discussion' | 'paper';
  // …(transcript* / video* 不变)
}
```

`extract.ts` 的 `db.update(items).set({...})` 增写 `contentMd` 与 `extractStatus`(默认 `'ok'`,与 `transcriptStatus` 同样由 dispatcher 兜默认)。

### 4.4 迁移注意

加两列需 `pnpm --filter @benkyou/core exec drizzle-kit generate`。按既有约束,生成时**必须**带 `EMBED_DIM` / `DATABASE_URL` / `SESSION_SECRET` 环境变量,否则快照会把 `vector(N)` 记成 `vector(undefined)`。生成后人工 review SQL。

## 5. 抽取层

### 5.1 reader 客户端 — `packages/core/src/sources/reader.ts`(新)

```ts
export type FetchOutcome =
  | { ok: true; markdown: string }
  | { ok: false; reason: 'blocked' | 'fetch_failed' | 'empty_parse' };

// Jina 约定:GET {base}/{targetUrl},可选 Bearer。返回 markdown。
export async function fetchViaReader(
  url: string,
  cfg: { baseUrl: string; apiKey?: string },
): Promise<FetchOutcome>;
```

- 仅当 `reader_base_url` 配置时由 `resolveContent` 调用。
- 不抛错:HTTP 403/挑战 → `blocked`;网络/5xx/异常 → `fetch_failed`;200 但空 → `empty_parse`。
- 不在 reader 客户端内做 markdown→text;那是 `resolveContent` 的职责(见 5.2)。

**URL 拼接细则(plan 落实,避免低级兼容 bug):**
- `baseUrl` 去掉结尾 `/` 后再拼;最终形如 `{base}/{targetUrl}`。
- `targetUrl` **保留完整 query string**(很多文章 URL 的 id 在 query 里);按 Jina 约定原样附在 base 之后,不做额外 encode 拆解(Jina 接受裸 URL 直接拼接)。
- `apiKey` 为空/缺省时**不发** `Authorization` 头(发空 Bearer 会被部分网关拒)。
- 建议带 `Accept` 适配纯文本/markdown;具体 header 集合 plan 定。

### 5.2 `resolveContent` 三段回退 — 改 `sources/extract-article.ts`

产出统一为 markdown,逐段择优(取最长有效 markdown),并记录最终 `extract_status`。维护两个累积量:`best`(当前最长有效 markdown,初值 feed)与 `lastFail`(已发生的增强失败 reason,按 §step4 优先级合并):

1. **feed 自带正文**:`content:encoded`(HTML)→ markdown(turndown)。作为 `best` 初值。
2. **`best` 不足阈值且有 URL → 直连** `fetchReadable`:Readability **`.content`(HTML)→ markdown**(改掉现在的 `.textContent`)。`fetchReadable` **改为返回 `FetchOutcome`** 而非裸 `null` —— 这是可观测性的核心,失败原因不再被吞。成功且更长 → 更新 `best`;失败 → 并入 `lastFail`。
3. **`best` 仍不足阈值(或直连失败)且 reader 已配置 → `fetchViaReader`**。成功且更长 → 更新 `best`;失败 → 并入 `lastFail`。
   > 触发条件是"**`best` 仍不足阈值,或上一步失败**",**不是**"`best` 为空"。否则:RSS 只有 200 字摘要、直连 403 时,`best` 非空(摘要),reader 永不触发、`extract_status` 误判为 `ok`,UI 不会提示正文不完整。
4. **最终 `extract_status` 与落库:**
   - **成功覆盖失败**:若任一来源把 `best` 提供为"成功获取"(feed 自带达阈值,或直连/reader `ok`)→ `extract_status = 'ok'`(即便结果较短,合法短文也算 `ok`)。
   - **否则**(`best` 仍不足阈值,且发生过增强失败)→ `extract_status = lastFail`。**失败间优先级:`blocked` > `empty_parse` > `fetch_failed`**(保留对用户最有意义的原因——例如直连 `blocked` 而 reader `fetch_failed`,最终应是 `blocked`,不被覆盖)。
   - `content_md`:`best` 非空 → markdown;`best` 为空 → `null`。
   - `raw_content`:`best` 非空 → `stripMarkdown(best)`;为空 → `null`。
   - 据此,`extract_status != 'ok'` 有两种 UI 形态:`content_md` 为空 = "正文未抓取";`content_md` 非空(不足阈值的摘要)= "正文可能不完整"(§7.2)。

`FULLTEXT_MIN_CHARS = 600` 阈值语义不变(现在作用在 markdown 长度上,可接受),并同时承担"是否触发下一段增强"与"短文是否算完整"的判定基线。

### 5.3 markdown 工具

- HTML → markdown:`turndown`(新依赖)。
- markdown → 纯文本(`stripMarkdown`):去除标题/强调/链接/代码围栏等语法,留可读纯文本喂 `raw_content`。实现选型(轻量正则 vs `remark` + `strip-markdown`)留实现计划定;倾向轻量实现以控依赖。

### 5.4 维持的语义

- 文章抽取**只降级不重试**:reader/直连失败不抛错,记 `extract_status` 后继续。后续 stage(embed/score/dedup/summary)照常在(可能为空的)`raw_content` 上运行——与 §6.2 一致。
- `summary.ts` 逻辑基本不动:仍有"无正文据标题/feed 摘要"兜底;"仅据标题"的呈现交给 UI(见 §7),据 `extract_status` 与 `content_md` 是否为空判定,不在 summary 阶段加列。

## 6. 设置

- `user_settings` 加 `reader_base_url` / `reader_api_key`。
- `settings/index.ts` 的 `SettingsPatch` 增对应可选字段;`updateSettings` 透传。
- 设置页表单增"Reader 端点"分区(base url + api key),走 `useTranslations()`;CI i18n 校验需 zh/en 双键。
- 不读环境变量、不在 UI 暴露任何冻结量(与 `embed_dim` 一类无关)。

## 7. UI（`apps/web`）

### 7.1 阅读视图 — `app/(authed)/items/[id]/page.tsx`

- 有 `content_md` → 渲染 markdown(`react-markdown` + 消毒,如 `rehype-sanitize`;新依赖)。页面标题用 `items.title`,正文内部 H1/H2…来自 markdown —— 解决"标题/内容无区分"。
- 无 `content_md` → fallback 到现状的 `raw_content` 纯文本(`whitespace-pre-wrap`),保证旧 item 不回归。

### 7.2 抓取状态提示(仅 `content_type='article'`)

`extract_status != 'ok'` 时按 `content_md` 是否为空分两种形态(原因文案据 `extract_status` 走 i18n,均附原文链接):

- `content_md` **为空** → "正文未抓取(原因)" + 原文链接。
- `content_md` **非空**(不足阈值的摘要,部分内容) → "正文可能不完整(原因)" + 原文链接,正文照常渲染。

### 7.3 总结"仅据标题"标注

- `content_md` 为空 且 `extract_status != 'ok'`(即 7.2 第一种)→ 给 summary 加"仅据标题/摘要"标注(轻量 badge / 角标)。

### 7.4 列表角标(可选)

- 列表**行**复用 `transcript_status` 的 badge 模式给文章加 `extract_status` 角标(遵守 DESIGN.md 的 No-Card Rule,不引入卡片)。优先级低,可后置。

### 7.5 路由提示(留给 writing-plans)

- **markdown 阅读视图按 🎨 spike-first 处理。** 现 `DESIGN.md` 有正文 typography / 行长原则,但**没有 markdown prose 的 heading、code block、blockquote、list 基元**。按 CLAUDE.md 工作流先 impeccable `craft` 定这些 prose token、`document` 进 `DESIGN.md`,再把渲染逻辑建进去——避免功能 pass 里就着空白即兴发挥。
- reader 客户端、可观测列、设置表单、失败/不完整提示属 🔧 派生/逻辑任务。

## 8. 测试（TDD）

- `reader.ts`(MSW):200 markdown → `{ok:true}`;403/挑战 → `blocked`;5xx/网络 → `fetch_failed`;200 空 → `empty_parse`;Bearer 头按 `apiKey` 有无正确附带。
- `resolveContent`:
  - feed 足够 → 不抓且 `ok`;直连成功 → `ok` 且 `content_md`/`raw_content` 双写;配了 reader 且 reader 成功 → reader markdown 胜出 → `ok`。
  - 直连合法短文(成功但 < 阈值)→ `ok`(不误判失败)。
  - 直连 403 且无 reader、feed 也空 → `content_md=null` / `raw_content=null` / `extract_status='blocked'`。
  - **部分内容**:feed 给不足阈值摘要 + 直连 403(无 reader)→ `content_md` 非空(摘要)/ `extract_status='blocked'`(触发条件按"不足阈值"而非"为空")。
  - **触发**:feed 不足阈值时必触发直连;`best` 仍不足阈值时(配了 reader)必触发 reader。
  - **失败优先级**:直连 `blocked` + reader `fetch_failed` → 最终 `blocked`(不被覆盖)。
- `stripMarkdown`:标题/代码块/链接 → 干净纯文本(代码内容保留、围栏去除)。
- `extract-article` / `extract.ts`:`content_md` 与 `extract_status` 正确落库;dispatcher 默认 `'ok'`。
- (UI)e2e 或组件级:`content_md` 渲染为结构化 HTML;缺失时 fallback;空 + `blocked` → "正文未抓取" + 链接;非空 + `blocked` → "正文可能不完整" + 链接且正文仍渲染;非 article 的 item 不展示 `extract_status`。

## 9. 变更清单（对母文档的增量）

1. **§6.2 pipeline 降级语义**:文章抽取的"静默降级"改为"**降级 + 记录 `extract_status`**";补 reader 回退契约(Jina,直连失败后兜底,只降级不重试)与**双存储正文模型**(`raw_content` 纯文本 / `content_md` markdown)。
2. **数据模型**:`items` 增 `content_md`、`extract_status`;`user_settings` 增 `reader_base_url`、`reader_api_key`。
3. **§3.4 非目标(记录,不改动)**:浏览器插件仍为 postponed 非目标;受保护页面的"粘贴正文"入口为待定的独立小 spec。本设计对受保护页面的立场是优雅降级,不试图突破。
