# FizzDragon Server

NestJS 后端，负责 AI 智能体、剧本拆解 Pipeline、AI 图像/视频生成（多 provider）、以及 Java 后端代理。

## 开发

```bash
# 从 monorepo 根目录
npx turbo dev --filter=server
```

## Admin Auth

后台管理账号独立于普通用户体系，存储在 Postgres 的 `admin_*` 表中。
本地或部署初始化管理员时，使用显式脚本创建账号，避免手写 SQL：

```bash
npm run admin:create-user -w server -- \
  --email admin@example.com \
  --password 'Violet#7291Secure' \
  --name 管理员 \
  --site-scope all \
  --role super_admin \
  --require-mfa true
```

可选 `--site-scope global|cn|all`、`--status invited|active|suspended|disabled`、
`--role super_admin|admin|operations`、`--require-mfa true|false`。密码必须至少
12 位并包含大小写字母、数字和符号，且不能复用最近 5 次管理员密码。
如果账号已存在并传入 `--password`，脚本会更新密码并按 `--role` 重新分配固定角色。

容器启动时也支持一次性 bootstrap：

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD='Violet#7291Secure'
ADMIN_BOOTSTRAP_NAME=管理员
ADMIN_BOOTSTRAP_REQUIRE_MFA=true
```

已有账号默认不会因 bootstrap 重置密码；确需重置时额外设置
`ADMIN_BOOTSTRAP_RESET_PASSWORD=true`。

后台账号管理接口挂在 `/admin/users`，受 `admin.manage` 权限保护。账号只允许
三种固定角色：超级管理员、普通管理员、运营。支持列表查询、创建管理员、
更新状态/角色/MFA 要求、重置密码、查看会话、撤销单个或全部会话。

登录链路包含登录失败风控：短时间内多次失败会记录 `admin_login_attempts`
并临时锁定账号；启用 MFA 的账号首次登录会返回 TOTP 绑定 challenge，验证成功后才创建
`admin_sessions`。后台审计查询接口挂在 `/admin/audit`，受 `audit.read` 权限保护。

## AI Generation 架构（生产态）

目标不是「能调通 Azure」，而是一个用户可连续创作、工程可滚动发布、
故障可恢复、成本可审计的多 provider 生成系统。一次点击「生成」必须
完整走完：

`提交 → 幂等落库 → 入队 → 实时进度 → Provider Adapter → OSS/CDN 持久化 → 结果入库 → 多端同步`

用户刷新页面、断网重连、打开第二个标签、服务滚动发布、Worker 被
SIGKILL，都不能让任务消失、重复扣费、结果丢失或 UI 卡死。

### 模块边界

通用层（`ai-generation/`）与 provider 实现（`ai-generation/providers/*/`）
严格分开。增一个新 provider（fal.ai、Replicate、自托管 SD …）= 加一个
adapter 文件夹，**通用层零修改**。

```
apps/server/src/ai-generation/
├── ai-generation.module.ts       Nest 模块入口
├── ai-generation.controller.ts   /aurora/ai/{models,jobs,...}
├── ai-generation.service.ts      submit / cancel / retry / list（业务编排）
├── repository.ts                 Prisma 数据层（含 OptimisticLockError）
├── worker.service.ts             BullMQ Worker — claim → call → OSS → emit
├── queue.service.ts              BullMQ Queue producer
├── queue.ts                      Queue / Worker 工厂
├── outbox.service.ts             durable Web PubSub fan-out（带 DLQ + 多 pod 锁）
├── authz.service.ts              membership tier gate
├── job-event.ts                  domain → AssetEvent payload mapper
├── eta.service.ts                ETA 估算
├── validator.service.ts          JSON Schema 校验
├── types.ts                      domain types（AiJob / AiJobOutput / …）
└── providers/
    └── foundry/                  Azure Foundry provider
        ├── catalog.service.ts    Azure /v1/models 拉取
        ├── schema.factory.ts     Foundry 模型 → 我们的 schema
        ├── schema.registry.ts    可用模型列表（合并 allowlist）
        └── request.mapper.ts     domain input → Azure HTTP body
```

### 产品体验契约

- **提交即有回执**：`POST /aurora/ai/jobs` 只负责校验、落库、入队，
  快速返回稳定 `request_id`。前端立刻插入 queued cell，不等待 provider。
- **服务器是唯一真相**：浏览器只缓存展示态；job 状态、队列位置、
  输出 URL、错误、计费都以服务端记录为准。
- **Push first, poll as safety net**：Web PubSub 负责丝滑更新；页面
  mount、reconnect、visibility resume 时用 REST 拉一次最新状态，修复
  漏帧和乱序。
- **任务不断线**：刷新、换标签、多标签并行时，同一个用户看到同一组
  queued / running / completed / failed 任务。
- **失败可行动**：失败卡片保留用户可读 `userMessage`、开发可查
  `rawError`、`retryable`、`retryOfJobId`。可重试的失败不只弹 toast。
- **结果可复用**：completed 输出进入 gallery，可下载、复制链接、作为
  reference image 继续生成；结果 URL 永远来自 FizzDragon OSS/CDN。

### 系统拓扑

```
┌───────────────────────────── Browser ─────────────────────────────┐
│ /art-studio/image                                                  │
│  ComposeBar  GalleryGrid  DetailDrawer                             │
│  optimistic cell + Web PubSub + polling reconciliation             │
└───────────────┬──────────────────────────────────────▲─────────────┘
                │ REST /aurora/ai/*                    │ push
                ▼                                      │
┌──────────────────────────── Nest API ──────────────────────────────┐
│ AiGenerationController                                              │
│  auth(Java sa-token) → schema validation → tier gate                │
│  idempotency → durable job row → BullMQ enqueue → response          │
│                                                                     │
│ RealtimeController / WebPubSubService                               │
│  short-lived read-only JWT, pre-joined assets-user:{userId} group   │
└───────────────┬──────────────────────────────────────▲─────────────┘
                │                                      │ event outbox
                ▼                                      │
┌──────────────────── Durable State ───────────────────┴─────────────┐
│ PostgreSQL (Prisma 7 + adapter-pg):                                 │
│   ai_jobs / ai_outputs / ai_attempts                                │
│   ai_provider_events / ai_event_outbox                              │
│ Redis (ioredis): BullMQ queues, future idempotency SET NX,          │
│                  token bucket, dispatcher locks                     │
└───────────────┬─────────────────────────────────────────────────────┘
                │ claim
                ▼
┌──────────────────────── Worker Pool ───────────────────────────────┐
│ AiGenerationWorkerService                                           │
│  ProviderAdapter dispatch → fetch output → upload OSS               │
│  → finalize DB (txn) → record AiEventOutbox                         │
│ Same codebase, runs as WORKER_ONLY=true pod in prod                 │
└───────────────┬─────────────────────────────────────────────────────┘
                ▼
┌─────────────────────── Provider Adapters ──────────────────────────┐
│  foundry (today)      Azure Foundry / OpenAI-compatible (sync)     │
│  fal-ai (planned)     async submit + poll/webhook                  │
│  replicate (planned)  async                                        │
│  ... new ones drop in under providers/                             │
└───────────────┬─────────────────────────────────────────────────────┘
                ▼
┌────────────────────── Azure Blob Storage ──────────────────────────┐
│ container `foundry-outputs` — public read; future SAS for private  │
│ key pattern: foundry/{yyyy}/{mm}/{dd}/{userId}/{jobId}/{idx}-{hash}│
└─────────────────────────────────────────────────────────────────────┘
```

### 状态机

Job 状态对用户保持少而稳定；stage 用于表达细进度。两者都是 Prisma
enum，DB 层拒绝 typo。

```
CREATED
  │ validate + persist + enqueue
  ▼
IN_QUEUE ── cancel ───────────────► CANCELLED
  │ claim
  ▼
IN_PROGRESS
  │ stage: calling_provider
  │ stage: provider_queued        (async provider — fal/Replicate)
  │ stage: generating
  │ stage: fetching_output
  │ stage: uploading_to_oss
  ├─ success ────────────────────► COMPLETED
  ├─ retryable provider failure ─► IN_QUEUE (attempt + backoff via BullMQ delay)
  ├─ user cancel requested ──────► CANCELLED
  └─ terminal failure ───────────► FAILED
```

原则：

- `COMPLETED` 只能在 OSS 上传成功、DB 输出记录成功后出现。
- `FAILED` 必须保留 retry policy、operator error、provider status code（落 `ai_attempts.providerStatus / error`）。
- `CANCELLED` 是产品态；provider 不支持硬取消时也要阻止后续覆盖成 completed。
- 重试创建新 attempt，但沿用原 job lineage，方便 UI 展示和计费审计。
- 软删走 `deletedAt` 而非 DELETE，repository 默认过滤；admin 才能 `includeDeleted: true`。
- 并发更新走 `version` 乐观锁：`repository.update(id, patch, expectedVersion)` 不匹配则抛 `OptimisticLockError`。

### 数据分层

| 数据                   | 权威存储                                              | 说明                                                                      |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Job 主记录             | PostgreSQL `ai_jobs`                                  | requestId、user、model、status、stage、cost、trace、version、timestamps   |
| 每次 provider 调用明细 | PostgreSQL `ai_attempts`                              | append-only；providerRequest/Response/Headers/Logs + costAccounting       |
| 输出                   | PostgreSQL `ai_outputs`（meta） + Azure Blob（bytes） | contentHash 跨用户去重；seed / safetyFlags / provenance / thumbnailUrl    |
| 队列                   | Redis + BullMQ                                        | stalled detection、delayed retry、并发控制                                |
| Idempotency            | DB unique `(userId, modelId, idempotencyKey)`         | 双击/重试同 key 拿同一 job（未来加 Redis SET NX 快速路径）                |
| 实时事件               | PostgreSQL `ai_event_outbox` + Azure Web PubSub       | outbox 保证状态变更不会因推送失败而丢；带 nextAttemptAt/lockedAt/deadAt   |
| Provider webhook 入口  | PostgreSQL `ai_provider_events`                       | 原始 payload + signatureValid + `(provider, providerEventId)` unique 防重 |
| 产品输出 URL           | OSS + CDN（计划）                                     | 前端只看 FizzDragon URL                                                   |
| 计费                   | （计划）`ai_cost_ledger` 表                           | 现在 `ai_jobs.cost` 是展示字段；真扣费要不可变 ledger（见 schema TODO）   |

### 实时与兜底

- Hub：`assets`
- Group：`assets-user:{userId}`
- 客户端 JWT：只授 `joinLeaveGroup`，不授 `send`，所有业务事件只允许服务端发布。
- 事件结构：`AssetEvent.kind` 做 discriminated union；当前唯一 kind 是 `ai_job_update`；`ts` + `job.updatedAt` 用于丢弃乱序旧消息。
- 每次 job 状态、stage、queuePosition、output、error 变化都通过 outbox（`AiGenerationOutboxService.record`）写一行 `ai_event_outbox`，同 tick 尝试推送 Web PubSub；失败由 dispatcher 按 backoff 重试，超过 MAX_ATTEMPTS 进 DLQ（`deadAt` 不为空）。
- 多 pod 安全：dispatcher 通过 `lockedAt / lockedBy` 抢锁；陈旧锁（> LOCK_TTL）可被别的 pod 回收。
- 前端必须在这些时机 REST reconcile：页面首次进入、Web PubSub reconnect、浏览器从后台恢复。

### 队列、限流、配额

| 层级               | 策略                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Provider RPM       | 计划：Redis token bucket，按 deployment 维度限流（当前仅 BullMQ concurrency 软限）                            |
| Worker concurrency | `IMAGE_WORKER_CONCURRENCY` / `VIDEO_WORKER_CONCURRENCY` 在 `worker.service.ts`                                |
| Per-user running   | `model.queue.perUserRunning`，submit 时强校验                                                                 |
| Per-user queued    | `model.queue.perUserQueued`，submit 时强校验                                                                  |
| Tier 门槛          | `FOUNDRY_IMAGE_MIN_TIER` / `FOUNDRY_VIDEO_MIN_TIER`，AuthGuard 注入的 sa-token user level 验证                |
| Backoff            | `PROVIDER_429/5XX/TIMEOUT` 指数退避（worker 内置 5 档：2/6/14/30/60s）；validation/content filter 立即 FAILED |
| Fairness           | FIFO 为默认；未来会员优先级用 BullMQ priority                                                                 |

队列位置是 best-effort 产品信号，不是强承诺。每次 claim / cancel / complete / retry 后 `repository.recomputeQueuePositions` 重算受影响 job，并广播 queue position 变更；前端按 job id 局部更新，不整页刷新。

### Provider 适配

每个 provider 是 `ai-generation/providers/<name>/` 下的一组文件。今天只有 `foundry`。**通用层从不直接引用 Azure / fal / Replicate 的 SDK 或类型**——所有 provider 细节经 adapter 隔离。

Foundry 当前实现：

- **同步 HTTP**：`/openai/v1/images/generations` 一次 fetch 等回 base64，超时 240s，由 worker 持有 fetch 生命周期。
- **请求构造**：`mapFoundryRequest` 是唯一把 domain `normalizedInput` 翻成 Azure body 的地方；Controller 不知道 Azure 字段名，前端更不拼 provider payload。
- **catalog 发现**：`FoundryCatalogService` 同时尝试 env override / Foundry project deployments API / OpenAI compat `/models`，按 `FOUNDRY_MODEL_ALLOWLIST` 过滤。
- **模型 schema**：`FoundrySchemaFactory` 生成 gpt-image-2 等模型的 input_schema + UI hints；schema 注释提示哪些选项实际可用（如 quality=auto 在 Azure preview 池死路，默认改成 `low`）。
- **错误分类**：worker 把 HTTP status 翻成统一 `AiJobError.code`（`PROVIDER_429/5XX/TIMEOUT/...`），决定是否重试。

未来 provider（fal.ai / Replicate）：

- 异步 provider 走 `providerJobId` + 后台 poll 或 webhook 模式。
- webhook 入口已经有 `AiProviderEvent` 表 + `(provider, providerEventId)` unique 防重。
- adapter 接口稳定后，加一家 provider = 一个目录 + 一行 module register。

### 输出持久化

生成结果不允许以 base64/data URL 或 provider 临时 URL 作为 completed 输出。worker 必须：

1. 拿到 provider bytes 或可下载 URL。
2. 计算内容 SHA-256（取前 12 hex）作为 `contentHash`，写入 `ai_outputs`。
3. 上传 Azure Blob，OSS key 模板：`foundry/{yyyy}/{mm}/{dd}/{userId}/{jobId}/{outputIndex}-{hash}.{ext}`（路径仍叫 foundry 是历史 container 名）。
4. 写 `mimeType / width / height / bytes / storagePath / url` 到 `ai_outputs`，幂等键 `(jobId, outputIndex)`。
5. 同事务 finalize job 为 `COMPLETED`，version 自增。
6. outbox 推 completed 事件。

幂等性：worker 重试整段时 `replaceOutputs` 是 `deleteMany + createMany` 事务；OSS 用确定性 key，再上传同内容覆盖无影响。

### 部署与高可用

- 生产建议拆 `server-api` 和 `ai-generation-worker` 两个进程：worker 跑长 provider fetch，API 进程不被占住。
  - 同一 codebase，worker 进程 `WORKER_ONLY=true npm run start:prod` 启动，不监听 HTTP。
- `/healthz` 只表示进程活着；`/ready` 检查 PG、Redis、Web PubSub 配置、provider credential、OSS credential。
- 滚动发布：先让 pod 从 `/ready` 摘流量，再 `SIGTERM` worker drain（`BeforeApplicationShutdown` 给 250s 让 BullMQ workers close）；超时由 BullMQ stalled detection 兜底重领。
- Worker crash 默认 at-least-once。重复执行可接受，丢任务不可接受；OSS key、DB finalize 都已幂等；计费 ledger（未来）必须幂等。
- DLQ：超过 `MAX_ATTEMPTS=12` 的 outbox 行设 `deadAt`，dispatcher 跳过，留给 operator UI 处理（待做）。

### 可观测与运营

| 信号              | 现状 / 标准                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 日志              | Nest 内置 Logger（按模块名分前缀）；上线前迁 pino structured logs（`requestId/jobId/attempt/modelId/userId/status/errorCode`）                                   |
| Metrics           | 计划：`ai_job_total{status,provider,model}` / `ai_queue_depth{queueName}` / `ai_job_duration_seconds{stage,provider}` / `ai_provider_error_total{code,provider}` |
| Trace             | 计划：W3C trace ID 已在 schema (`ai_jobs.trace`)；接 OTEL 把 browser submit → Nest → BullMQ → worker → provider → OSS → DB finalize 串起来                       |
| Product analytics | PostHog 已接入；规划 `ai_job_submitted/completed/failed/retried/cancelled/downloaded` 事件                                                                       |
| Alert             | 上线后：queue depth、provider 429/5XX、OSS failures、DLQ depth (`ai_event_outbox` where deadAt not null)、outbox lag (nextAttemptAt 距 now)、p95 job duration    |

### 生产验收标准

满足以下条件才算产品级闭环：

- 任务刷新页面后仍可恢复，queued/running/completed/failed 都可见。
- Web PubSub 全断时，polling 仍能让任务最终变成 completed/failed。
- 服务滚动发布不丢 job；worker 被 SIGKILL 后任务会 stalled reclaim。
- completed 输出全部是 OSS/CDN URL，不是 base64 或 provider URL。
- 重复提交同一个 idempotencyKey 不会创建第二个 job。
- Provider 429/5XX/timeout 自动重试且用户能看到等待状态。
- validation/content filter 失败不重试，并展示明确错误。
- 排队位置变化会同步到所有打开的标签。
- 每个失败 job 有 operator 可查的 raw error、attempt log、trace id。
- 计费、OSS 写入、DB finalize 都用 job/attempt/output 幂等键防重复。

### 当前进度 vs 验收

| 验收项                                 | 状态                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 任务刷新可恢复                         | ✅ PG `ai_jobs` 持久化，前端 mount/reconnect/visibility 三处 reconcile                                           |
| Web PubSub 全断仍最终一致              | ✅ `ai_event_outbox` + dispatcher 退避重试 + DLQ + 多 pod 锁                                                     |
| 滚动发布不丢 job                       | ✅ BullMQ stalled reclaim + worker `BeforeApplicationShutdown` drain（250s budget）                              |
| completed 全部 OSS URL                 | ✅ Azure Blob `foundry-outputs` container；worker `uploadAndComplete` 强制                                       |
| idempotencyKey 唯一性                  | ✅ `(userId, modelId, idempotencyKey)` PG unique                                                                 |
| 429/5XX/timeout 自动退避               | ✅ Worker 5 档指数退避 → BullMQ `add(..., {delay})`                                                              |
| validation 不重试                      | ✅ 错误码白名单（`RETRYABLE_CODES`），其它立即 FAILED                                                            |
| 排队位置同步多 tab                     | ✅ `repository.recomputeQueuePositions` 返回变更行 → service / worker 各自 emit                                  |
| 状态字段不可写脏                       | ✅ Prisma enum：AiJobType / AiJobStatus / AiJobStage / AiAttemptStatus / AiProviderEventType / AiOutboxEventType |
| 软删 schema 强保证                     | ✅ Repository 读路径默认 `deletedAt: null`；admin 才显式 `includeDeleted`                                        |
| 乐观锁                                 | ✅ `version` 字段 + `repository.update(id, patch, expectedVersion)` 抛 `OptimisticLockError`                     |
| Provider 抽象                          | ✅ `providers/foundry/` 隔离；通用层接 fal/Replicate 零代码改动                                                  |
| 完整 provider 出入参留底               | ✅ `ai_attempts.providerRequest/Response/Headers/Logs` 字段就位                                                  |
| Webhook 防重                           | ✅ `ai_provider_events.(provider, providerEventId) unique`                                                       |
| Tier 门槛                              | ✅ `AiGenerationAuthzService` + `FOUNDRY_*_MIN_TIER` env                                                         |
| Worker 写 attempts 行                  | ⚠️ 表已建，worker 还未在每次 provider 调用后落 attempt 行（attempt 字段聚合在 ai_jobs.attempt）                  |
| 计费 ledger 幂等                       | □ 待做：`ai_cost_ledger` 独立表（schema TODO 已标注）                                                            |
| 产品上下文（project/workspace/region） | □ 待做：等剧组 / 项目模块 ID 定型再加（schema TODO）                                                             |
| Soft-delete partial unique             | □ 待做：raw SQL `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`                                               |

### 本地启动

```bash
# 1. 起 Postgres + Redis（docker-compose.dev.yml）
npm run db:up

# 2. 应用 schema migration（首次或 schema 变更后）
npm run db:migrate

# 3. 起 Nest dev server
npm run start:dev

# 4. 探活
curl http://localhost:3002/ready
# → web_pubsub / foundry_provider / output_storage / postgres / redis 五项全绿
```

生产部署拆 `server-api` 和 `ai-generation-worker` 两个进程，后者通过
`WORKER_ONLY=true` boot 同一份 codebase，只跑 BullMQ Worker + outbox
dispatcher，不开 HTTP 监听。

## AI Assistant 调用的 Java 后端接口

所有接口通过 `WorkspaceService` 代理，需要透传用户的 cookie/token。

### 剧本大师 (Script Agent)

| 方法                  | HTTP | API 路径                                                 | 请求体                                       | 用途                     |
| --------------------- | ---- | -------------------------------------------------------- | -------------------------------------------- | ------------------------ |
| `batchAddEpisodes`    | POST | `/api/user/storyBoard/create`                            | `{ projectId, name }`                        | 逐个创建剧集（循环调用） |
| `batchCreateRoles`    | POST | `/api/ai/chat/batch/create/role`                         | `{ worldId, datas: [["name","desc"], ...] }` | 批量创建角色             |
| `batchCreateScenes`   | POST | `/api/ai/chat/batch/create/scene`                        | `{ worldId, datas: [["name","desc"], ...] }` | 批量创建场景             |
| `batchSaveScripts`    | POST | `/api/user/project/scripts/episode/batch/createOrUpdate` | `{ projectId, episodeIds, contents }`        | 批量保存剧本             |
| `saveStoryboardDraft` | POST | `/api/ai/chat/save/storyboard`                           | `{ episodeId, headers, rows }`               | 保存分镜草稿             |
| `listEpisodes`        | POST | `/api/user/world/list/episode`                           | `{ productId, page, pageSize }`              | 获取剧集列表             |

### 读取类 (Read Tools)

| 方法                   | HTTP | API 路径                                          | 请求体                             | 用途         |
| ---------------------- | ---- | ------------------------------------------------- | ---------------------------------- | ------------ |
| `getProjectDetail`     | POST | `/api/user/project/detail/{id}`                   | —                                  | 项目详情     |
| `listEpisodes`         | POST | `/api/user/world/list/episode`                    | `{ productId, page, pageSize }`    | 剧集列表     |
| `getWorldAssetPage`    | POST | `/api/user/world/list/world{role\|scene\|prop}`   | `{ worldId, page, pageSize }`      | 资产分页列表 |
| `getWorldAssetSummary` | POST | `/api/user/world/search/world{role\|scene\|prop}` | `{ worldId, name? }`               | 资产搜索     |
| `queryStoryboardRows`  | POST | `/api/user/shot/queryPage`                        | `{ storyBoardId, page, pageSize }` | 分镜行分页   |
| `getStoryboardSummary` | POST | `/api/user/shotColumn/list`                       | `{ storyBoardId }`                 | 分镜列列表   |

### 执行类 (Execute Tools)

| 方法                | HTTP | API 路径                                           | 请求体                                       | 用途           |
| ------------------- | ---- | -------------------------------------------------- | -------------------------------------------- | -------------- |
| `updateProject`     | POST | `/api/user/world/update/worldproduct`              | `{ id, name?, description? }`                | 更新项目       |
| `createEpisode`     | POST | `/api/user/storyBoard/create`                      | `{ projectId, name }`                        | 创建单集       |
| `updateEpisode`     | POST | `/api/user/world/update/episode`                   | `{ id, title? }`                             | 更新剧集       |
| `deleteEpisode`     | GET  | `/api/user/world/delete/episode?id=`               | —                                            | 删除剧集       |
| `saveEpisodeScript` | POST | `/api/user/project/scripts/episode/createOrUpdate` | `{ episodeId, content }`                     | 保存单集剧本   |
| `createCharacter`   | POST | `/api/user/world/create/worldrole`                 | `{ worldId, name, description? }`            | 创建角色       |
| `updateCharacter`   | POST | `/api/user/world/update/worldrole`                 | `{ id, name?, description? }`                | 更新角色       |
| `deleteCharacter`   | GET  | `/api/user/world/delete/worldrole?id=`             | —                                            | 删除角色       |
| `createScene`       | POST | `/api/user/world/create/worldscene`                | `{ worldId, name, description? }`            | 创建场景       |
| `updateScene`       | POST | `/api/user/world/update/worldscene`                | `{ id, name?, description? }`                | 更新场景       |
| `deleteScene`       | GET  | `/api/user/world/delete/worldscene?id=`            | —                                            | 删除场景       |
| `createProp`        | POST | `/api/user/world/create/worldprop`                 | `{ worldId, name, description? }`            | 创建道具       |
| `updateProp`        | POST | `/api/user/world/update/worldprop`                 | `{ id, name?, description? }`                | 更新道具       |
| `deleteProp`        | GET  | `/api/user/world/delete/worldprop?id=`             | —                                            | 删除道具       |
| `fillCell`          | POST | `/api/user/shotValue/input`                        | `{ shotId, columnKey, value }`               | 填写分镜单元格 |
| `batchCreateProps`  | POST | `/api/ai/chat/batch/create/prop`                   | `{ worldId, datas: [["name","desc"], ...] }` | 批量创建道具   |

### 后端服务地址

- **Java Studio**: `JAVA_STUDIO_URL`（所有 `/api/*` 接口）
- **Java Content**: `JAVA_CONTENT_URL`（`/user/*`, `/project/*`, `/content/*`, `/vedio/*`）

### 认证

所有请求需要透传用户的 `satoken` cookie。在代码中通过 `headers` 参数传递。
