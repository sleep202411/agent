# FizzDragon Server

NestJS 后端，负责 AI 智能体、剧本拆解 Pipeline、AI 图像/视频生成（多 provider）、以及 Java 后端代理。

## 开发

```bash
# 从 monorepo 根目录
npx turbo dev --filter=server
```

## Server test resources

The Server Jest suite includes real local PostgreSQL/Redis workflows and uses
a 30-second default for tests and fixture hooks. The default two-worker run
uses [Jest worker recycling](https://jestjs.io/docs/configuration#workeridlememorylimit-numberstring)
above 512 MB between suites to avoid accumulating imported module contexts
across the full repository. This recycling does not apply to
`--runInBand`; reserve that mode for targeted integration suites. Explicit per-test limits and
asserted transaction/query budgets remain in force. This allows migrated
fixture setup and multi-step integration journeys on slower development/CI
machines; it does not change production request or transaction timeouts.

## Production deployment

The `.com` Server runs in Alibaba Cloud Singapore ACK, account
`5332868355276356`, cluster `fizzdragon-com-sg`, namespace `fizzdragon`.
Release it through `deploy/deploy-com.sh server` from the repository root;
see [the production runbook](../../deploy/aliyun-sg/README.md).
The release runs native Prisma migrations in a Job with existing in-cluster
credentials before changing the Server image. Runtime Secrets, database TLS,
networking and the Harness workspace volume are preserved.

`.cn` uses its independent regional deployment. Java/MySQL remains an external
service in the original account. Azure Key Vault is no longer the `.com`
application configuration source; current credentials are injected from ACK
Secrets. Front Door and legacy Blob media remain separate dependencies.

## Background tasks

Production uses `BACKGROUND_TASKS_ENABLED=true`. Setting it to `false` on an
isolated instance stops autonomous consumers, recovery, outbox delivery,
provider registration, reconciliation and scheduled cleanup. Existing job and
outbox records remain durable. Explicit values must be `true` or `false`;
invalid values fail startup. Restart the process to apply a change.

This switch is not a live traffic drain or an HTTP sandbox: request-driven
writes and direct provider, payment, storage and realtime calls can still occur.
Use independent fixture datastores for local validation and keep external side
effects controlled. Required credentials remain validated. Historical migration
isolation overlays are not production deployment inputs.

## Full type checking

`npm run check-types -w server` covers every root in `tsconfig.spec.json`,
including production source, tests, seeds and scripts. It checks production
source and groups of 80 remaining roots in separate sequential compiler
processes, each capped at 4 GiB. Imports are still checked in full; script
globals and ambient augmentations are present in every group. No diagnostics
are suppressed. This bounds retained Prisma/test instantiations on developer
machines and CI. CI also runs workspace type checks sequentially. The runner fails on the first failing group and prints its
name; rerun the full command after fixing errors.

`npm run test:typecheck-runner -w server` verifies complete root coverage,
ambient declarations and failure propagation from the final group.

## GPS database regressions

Run `npm run test:integration:gps -w server` from the repository root with
`CONTENT_GPS_TEST_DATABASE_URL` pointing to a disposable UTF-8 PostgreSQL database
named `gps_test` on `127.0.0.1:55441`. The runner rejects missing or non-fixture
URLs and runs all seven suites serially because they create/drop shared fixture
tables. CI provisions this database separately from the migrated product-test
DB. Do not run these fixtures concurrently or against a production database.

## HTTP and project-move regressions

`npm run test:e2e -w server` tests the real `/healthz` and `/ready` HTTP
routes with owned dependency fixtures: success, dependency failure, recovery,
and self-hosted realtime configuration. It does not start production workers
or connect to external services.

`npm run test:story-project-move -w server` verifies owner permissions,
atomic moves, document/media access, historical versus new payers, generation
holds/settlement and concurrent admission. It requires `DATABASE_URL` pointing
to a migrated disposable loopback database whose name ends in
`_workspace_preview`. The script uses test-only environment defaults and
leaves fixture rows in that disposable database; remove the fixture afterward.
CI creates a separate database for this check.

## Platform integration regressions

`npm run test:integration:platform -w server` runs finance, immutable contracts,
feedback, dispute/purchase reporting, referral cash totals, device city consent,
project concurrency, saved storyboard rendering and real S3 storage tests serially. The runner fails on missing
configuration, failures or skipped tests. CI provisions and migrates its two
owned PostgreSQL fixtures, installs FFmpeg and starts MinIO; see the
“Platform finance, contracts, exports and storage regressions” step in
`.github/workflows/ci.yml` for the complete environment mapping.

For a local run, use disposable databases only: `task01` on
`127.0.0.1:55439` and `audit_migrations_20261005` on `127.0.0.1:55441`.
Apply all Prisma migrations to both. Set each test URL to its matching fixture
without URL options; never use a production database. MinIO uses
`127.0.0.1:19000`, user `fizz-local-test`, password `fizz-local-test-password`
(test-only values shared with the existing multipart fixture). Set
`S3_LOCAL_INTEGRATION`, `STORYBOARD_RENDER_INTEGRATION`,
`MEDIA_RETENTION_SCALE` and `WITHDRAWAL_SCALE_TEST` to `1`. Scaled retention is
a synthetic regression, not a production capacity claim. No external AI, payment or storage credentials
are required.

## Prisma Migration 策略

本仓库以 `apps/server/prisma/migrations/*/migration.sql` 作为数据库变更的
唯一来源。未部署、未执行、未 push 的 migration 可以在开发期继续整理；
一旦进入共享环境或生产环境，就只能追加新 migration，不再改写历史目录。

本地开发：

```bash
npm run db:migrate -w server
```

`db:migrate` 和 `db:studio` 带本地数据库守卫，只允许
`DATABASE_URL` 指向 `localhost` / `127.0.0.1` / `::1`。如果本机 `.env`
误指向共享库或线上库，命令会在连接数据库前直接退出。

共享环境 / 生产环境：

```bash
npm run db:deploy -w server
```

约束：

- 生产环境只跑 `prisma migrate deploy`，不跑 `prisma migrate dev`。
- 不手写临时 SQL 改结构；确需数据修复时，单独写可审计脚本或 migration。
- `migrate status` 在本地返回 non-zero 只代表还有未应用 migration；先看
  “Following migrations have not yet been applied” 列表，不等于 schema 错误。
- 当前 admin/payment/IP 相关新 migration 是：
  `20260528120000_billing_core`、`20260528130000_ip_commerce_core`、
  `20260528150000_admin_auth_core`、`20260528170000_admin_security_governance`。

## Billing Catalog 边界

国际站和中国站部署同一套代码，但连接不同数据库。商品、价格、订单、
钱包流水、IP 价格规则都只描述当前数据库所属站点的数据，不通过
`site_region` 在同库里混放两站。

支付供应商不是商品目录的源头。`billing_catalog_items` 和
`billing_prices` 是内部事实表；Airwallex Product/Price、微信支付商户侧
配置等外部对象只通过 `billing_provider_price_bindings` 映射到内部价格。
结账时使用内部 `priceId`，订单快照锁定内部金额和权益，provider webhook
只推进支付状态，不反推商品、价格或会员权益。

## Admin Auth

后台管理账号独立于普通用户体系，存储在 Postgres 的 `admin_*` 表中。
本地或部署初始化管理员时，使用显式脚本创建账号，避免手写 SQL：

```bash
npm run admin:create-user -w server -- \
  --email admin@example.com \
  --password '<temporary-password>' \
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
ADMIN_BOOTSTRAP_PASSWORD='<temporary-password>'
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

本地开发可免登录访问 Admin API，方便调试管理台页面和控制平面接口。该旁路只在
以下条件同时满足时启用：

- `NODE_ENV !== "production"`；
- `ADMIN_DEV_AUTH_BYPASS !== "false"`；
- `DATABASE_URL` 使用 `postgresql:` / `postgres:` 且 host 是
  `localhost` / `127.0.0.1` / `::1`。

旁路会生成一个仅存在于请求上下文里的 super admin actor，不写入数据库，也不会创建
`admin_sessions`。本地需要验证真实登录、MFA、锁定、审计时，设置
`ADMIN_DEV_AUTH_BYPASS=false`。可选 `ADMIN_DEV_AUTH_EMAIL` 和
`ADMIN_DEV_AUTH_NAME` 用于调整本地显示身份。

## 剧组合同（BoldSign）

合同是剧组协作的可选能力，不阻断邀请、任务、资产或积分结算。本地默认关闭且不需要建立公网隧道。
生产部署启用前必须同时配置：

```bash
BOLDSIGN_ENABLED=true
BOLDSIGN_API_KEY=...
BOLDSIGN_API_BASE_URL=https://api-eu.boldsign.com
BOLDSIGN_CREW_AGREEMENT_TEMPLATE_ID=...
BOLDSIGN_WEBHOOK_SECRET=...
```

`BOLDSIGN_ENABLED=true` 时，缺少任一必填配置会让服务拒绝启动，生产环境不会静默降级为“未连接”。
首次开通时先保持 `BOLDSIGN_ENABLED=false` 部署代码；未签名的官方 `Verification` 探针仍会返回
200，但其他事件全部拒绝。Webhook 保存后在 BoldSign 管理页 Reveal 签名 Secret，将三个生产密钥
写入对应区域的 Server Secret，再开启功能。这样既避免启动配置的循环依赖，也不会在缺少验签 Secret 时处理业务事件。

在 BoldSign 配置 Account-level webhook：

```text
https://fizzdragon.com/aurora/webhooks/boldsign
```

`/aurora` 是公网 ingress 前缀；ingress 转发给 NestJS 前会将其剥离，控制器内部路由仍是
`/webhooks/boldsign`。不要为本地开发建立 Quick Tunnel。

Webhook 使用 `X-BoldSign-Signature` 的 HMAC-SHA256 验签并校验时间窗；
`Sent / SendFailed / Completed / Declined / Expired / Revoked` 会自动推进合同状态并发送站内通知。
数据库保存最后一个 provider event 游标，重复或乱序回调不会把已签署合同回退为“已发送”。
`POST /crew-agreements/:agreementId/sync` 仍保留为人工修复入口，而不是主要同步机制。

成员邀请可以附带可选合同意图，但接受邀请只负责原子地建立成员权限、群聊参与者和合同发送任务，
不会在事务中调用 BoldSign，也不会因第三方故障阻塞成员进入工作台。多实例发送 worker 使用
PostgreSQL 租约处理任务；每个签署请求同时写入稳定 metadata 与无空格 label，重试前先按 label
向 BoldSign 对账，覆盖“第三方已接收、HTTP 响应丢失”的模糊窗口，避免重复合同。API 返回
`documentId` 时状态只进入 `sending`，最终 `sent / failed` 以 BoldSign 官方异步 webhook 为准。
初始发送连续失败达到上限后，管理员可调用
`POST /crew-agreements/:agreementId/send/retry` 显式重新入队。

BoldSign 确认 `Sent` 后，合同绑定成员可调用
`POST /crew-agreements/:agreementId/signing-session` 获取 15 分钟有效的嵌入签署链接。
服务端同时校验当前登录用户、有效剧组成员身份和合同签署人，管理员不能代取其他成员的签署凭证。
签署链接不写数据库、不进入日志或通知；站内通知只深链到合同面板，用户点击时才按需生成。

`Completed` 状态会与一个持久归档任务在同一事务中写入。多实例 worker 通过数据库租约下载
签署 PDF 与 Audit Trail，并按站点区域写入 `.com/global → R2`、`.cn → OSS`，随后建立
两条受限剧组资产（管理员可管理，签署成员只读）。下载、存储或进程故障会指数退避重试；
达到上限后 UI 会显示归档失败，管理员可调用
`POST /crew-agreements/:agreementId/archive/retry` 重新入队。Webhook 不承担外部文件 IO。

Agreement archives use the provider's separate private upload destination
(`S3_PRIVATE_BUCKET` globally, `OSS_PRIVATE_BUCKET` in CN). The worker keeps
the signed write URL server-side and verifies stored size/type before linking
the restricted assets. Missing private storage fails the job; it never falls
back to the media bucket. This applies to new archives only. Before rollout,
operators should inventory existing `crew_agreement_archive` media placements
and verify their buckets deny anonymous reads. Existing objects in public media
storage need a separate migration and public-copy cleanup; this worker change
does not relocate them.

## Story project publication gateway

Authenticated Studio clients use the project gateway instead of Java's
creator-only management GET/status endpoints:

- `GET /aurora/story-projects/:projectId/publication`: requires `story.read`;
  returns `{ code: 200, data: null | { gameId, status, rejectReason } }`.
  Only Java's actual not-found business response becomes `null`.
- `POST /aurora/story-projects/:projectId/publication/submit`: requires
  `story.release` (owner/producer). The body is the exact prepared draft
  `ExperienceReleaseRequest`. Its project, request hash, ready builds and its immutable
  release receipt are verified before Java is contacted. Upload forwards
  the current actor's own session; existing Java authorship is retained.
- `POST /aurora/story-projects/:projectId/publication/offline`, body `{}`:
  requires `story.release`; withdraws review or takes a published work offline.

Nest authorizes project access and calls the existing Java admin GET/status
contract with the regional server-only `JAVA_ADMIN_API_TOKEN`. Studio cannot
choose a Java endpoint or status action. Only read, submit and offline are
implemented; approve, reject, force-offline and unrelated admin operations are
not exposed. Upload uses the selected authenticated actor's own session, never
an owner's borrowed session. Existing Java authorship is retained. No Java
source change is required for this integration.

`JAVA_STUDIO_URL` and `JAVA_ADMIN_API_TOKEN` are required at server readiness.
An optional `JAVA_ADMIN_API_TOKEN_HEADER` overrides `X-Admin-Api-Token` with a
dedicated HTTP header name. Supply the regional value from the existing secret
store to the server Secret; never expose it through public environment variables,
client bundles, response payloads or audit records. Do not copy production
credentials into local development configuration. The COM and CN credentials
are configured independently. Known credential values are removed from
upstream error text before it reaches clients or audit logs.

The gateway records the actual actor and requested/completed/failed operation
in the platform audit log. Project mutation advisory locks serialize the
gateway across Nest replicas. Capabilities are checked again before each write,
along with the prepared candidate, exact builds and current media availability.
Every write requires a live lock transaction; a shared deadline stops further
requests after timeout. Java remains the moderation authority. Its business
code/message are retained except for known credentials. Service credential
rejections are 502, while an expired actor upload session is 401.

Java's existing status API has no expected-version CAS. Older clients that
still call Java directly and external moderation operations do not participate
in the Nest advisory lock. The gateway checks the candidate version before and
after submission and recognizes a retry of the same reviewing version. This
does not make a Java write atomic or undo an already accepted request. A
dedicated Java credential and conditional/idempotent transitions would further
restrict authority and external races; they are separate Java enhancements,
not prerequisites for the project-permission repair.

Release the server before the migrated Studio client, then validate member
reads, a non-author producer submission, editor write denial, revoked access,
service/session failures and retry behavior independently on COM and CN.
Local fixture tests do not establish the two deployments' runtime configuration.

## Java 对接：积分桥接接口（`/internal/points`）

> 📄 **完整对接文档已独立成文，以它为准、并直接发给 Java：**
> **[`docs/compute-points-migration-java.md`](../../docs/compute-points-migration-java.md)**
>
> 内含：实测线上地址（含 `/aurora` 前缀坑）、鉴权、4 个接口的请求/响应/curl、
> 错误码、错误兼容与平滑迁移、注意事项。

## AI Generation architecture

Generation follows a durable path:

`submit → validate and persist → BullMQ → provider → durable media → finalize → realtime`

`ai-generation/` owns orchestration, persistence, queue recovery, billing and
outbox delivery. Provider-specific requests live under `providers/` and enter
through `ProviderRegistry`. Registered adapters include fal, Alibaba Bailian,
BytePlus ModelArk and speech, Google Vertex, Agnes and MiniMax; configured
catalog bindings and credentials determine which models are usable.

| Responsibility                              | Current implementation                                            |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Jobs, attempts, provider events and outputs | PostgreSQL / Prisma                                               |
| Queues, delayed retries and worker recovery | Redis / BullMQ                                                    |
| Provider admission and concurrency          | Provider capacity runtime and image/video/audio workers           |
| Durable events                              | `ai_event_outbox`, retrying dispatcher and dead-letter state      |
| Client updates                              | Self-hosted WebSocket gateway with REST reconciliation            |
| New global media                            | Cloudflare R2 through `OutputStorageService`                      |
| China media                                 | Alibaba OSS                                                       |
| Legacy media                                | Resolved using each stored asset's provider, including Azure Blob |

A job pins its output storage provider when submitted; retries use that same
provider. Completion requires durable output upload and database finalization.
Provider temporary URLs are not completed product assets. Provider receipts,
job/attempt identities and immutable billing records support recovery without
creating a second customer charge.

The client reconciles durable state on initial load, reconnect and return from
background. WebSocket delivery improves responsiveness; PostgreSQL remains the
source of job status, outputs and errors. Realtime requires
`REALTIME_TRANSPORT=self-hosted` and `REALTIME_WS_SECRET`; Azure Web PubSub is
retired.

`/healthz` reports process liveness. `/ready` checks PostgreSQL, Redis, configured
output storage and realtime configuration. Healthy probes do not prove every
provider, payment callback or authenticated product journey works. Review
migration compatibility and exercise affected flows before release.

### Local startup and storage

From the repository root, with the approved local environment configured:

```bash
npm run db:up -w server
npm run db:migrate -w server
npm run start:dev -w server
curl http://localhost:4399/ready
```

The global cell defaults to R2. Required endpoint, region, bucket, public domain
and credentials must be configured; startup fails if required settings are
missing. Use approved development credentials in ignored environment files;
never copy production credentials into a local test environment. Runtime
precedence is process environment, then `apps/server/.env.local`, then
`apps/server/.env`.

Storage buckets and public domains are provisioned separately. The service does
not create the main bucket during startup or health checks. Production `.com`
uses its existing ACK configuration and Secrets; `.cn` uses its own OSS settings.

### 剧组任务查询边界

`GET /aurora/crews/:crewId/tasks` 必须携带持久化 `viewId`，由服务端执行
视图 scope、筛选、排序、搜索和精确计数，并以 opaque cursor 分页；列表只返回
卡片/表格所需字段，提交版本和结算明细只由
`GET /aurora/crew-tasks/:taskId` 加载。关系选择器和聊天任务卡使用独立的
`/task-options` 有界搜索接口，聊天侧栏统计使用 `/task-summary` 聚合接口。
不要重新引入“拉取整剧组任务后在浏览器筛选”的旁路。

The code also supports a dedicated `WORKER_ONLY=true` process, which runs
without an HTTP listener. Ordinary `.com` releases preserve the current
workload layout; they do not create additional workers.

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

### Creator manual withdrawals

Creator withdrawals reserve confirmed task earnings in their original USD/CNY
currency. FizzDragon finance records bank transfers made outside the platform;
these endpoints do not initiate a payment or convert community points into cash.

Before deploying this module, provision `CREATOR_PAYOUT_DETAILS_KEY` in the
server-only regional secret: 32 cryptographically random bytes represented by
64 hexadecimal characters. Configure the `CREATOR_PAYOUT_DETAILS_KEY` entry in
the international `fizzdragon-secrets` or CN `fizzdragon-server-secrets`.
Startup fails if this key is absent or malformed. Preserve and back up the key
with the database; replacing it without re-encrypting stored records makes saved
bank details and withdrawal recipient snapshots unreadable. Never expose it to
Web, Studio, admin-ui, logs, or source control.

Admin access requires `creator.withdrawals.manage` and a matching site scope.
Bank-detail reads are audited before details are returned. Payment transitions
require a processing claim, current request version, and a transfer reference.
Queue filters include creator ID, stored recipient label/withdrawal ID search,
inclusive UTC request dates, and currency-specific minor-unit amount ranges.
`GET /admin/creator-withdrawals/export` applies the same filters across all pages
and returns a CSV download payload. Exports contain masked recipient labels,
exact decimal amounts and payment references, never decrypted bank details.
Formula-like cells are escaped for spreadsheet import. Above 10,000 matches the
request fails with an instruction to narrow filters; exports are never silently
truncated. The admin UI exports the applied filters, not unsaved form edits.

Admin batch recording selects up to 50 available requests on the current page,
requires a transfer reference for each and explicit confirmation that transfers
already completed. It uses the existing claim/version/payment endpoints per
request, reports partial failures, and retries remaining requests only. Before a
retry, current state is fetched; an already-paid request is accepted only when
the payment reference and paying administrator match. Batch recording does not
initiate bank transfers or take over another administrator's processing claim.

Optional payment proofs use `POST /admin/creator-withdrawals/:id/proofs`
(single `file`, PDF/JPG/PNG up to 10 MB, detected from bytes). The server holds
private write capabilities, verifies the stored object, and rechecks the current
processing claim before accepting a proof. The finance-only download endpoint is
`POST /admin/creator-withdrawals/:id/proofs/:proofId/download`; reads are audited
and links last 60 seconds. The admin payment form waits for a selected upload,
retains failed work for retry, and can include an internal note of up to 2,000
characters. Historical paid records without attachments remain valid.

Creators can download their attached paid proof through authenticated
`POST /me/withdrawals/:id/payment-proof/download`. The owner-scoped lookup
requires a paid withdrawal and its verified, immutable proof; processing proofs
and other users' withdrawals return not found. Creator history exposes only
`hasPaymentProof`, and the web history requests a fresh 60-second private link
on each click. Admin notes and storage metadata remain private.

Migrations `20261006140000_withdrawal_payment_proofs` and
`20261006150000_withdrawal_proof_state_guards` add the SQL-owned proof/cleanup
table and immutable payment evidence. Payment binds only a verified proof for
that withdrawal and removes it from cleanup in the same transaction. A minute
sweep retires unattached uploads after 24 hours, then deletes private objects;
failed deletions retry after 15 minutes. Recovery is recorded before any bytes
are uploaded. Cleanup and payment use the same creator lock, and attached paid
proofs cannot be retired or deleted. Internal notes are excluded from creator
history. Local PostgreSQL, HTTP, proxy, component and fixture-browser checks
cover this flow; real regional storage still needs lead-owned acceptance.

### Creator device city suggestions

`POST /creator-location/me/device-city` requires the authenticated owner, a UUID
`requestId`, `consent: true`, device latitude/longitude and locale. A lookup only
suggests a city: it does not save a profile, enable public discovery, or resolve
public map coordinates. The creator must confirm the city, save their location
profile, and separately choose map visibility. Manual city entry remains usable.

Enable with `CREATOR_DEVICE_CITY_ENABLED=true` only after configuring
`CREATOR_GPS_GEOCODING_REGION` (`global` or `cn`),
`CREATOR_GPS_GEOCODING_KEY`, `CREATOR_DEVICE_CITY_DAILY_LIMIT` (provider-call
budget, UTC day) and `CREATOR_DEVICE_CITY_MAX_IN_FLIGHT` (concurrent attempts).
These are explicit **additional** budgets, separate from saved-city forward
geocoding. Enabled misconfiguration fails startup. CN reserves two calls (GPS
conversion and reverse lookup); global reserves one. Accounts are limited to
five attempts per rolling hour. Providers have a bounded ten-second deadline;
there are no automatic provider retries.

Apply migration `20261005120000_creator_device_city` before starting this code.
The private SQL ledger stores attempt metadata and city/country only. Coordinates
are sent in the POST body and to the regional provider, never persisted by this
feature. Keep request-body capture disabled in proxies/APM for this endpoint.
City suggestions expire after ten minutes; the worker removes expired city data
on its next one-minute sweep. Quota/replay metadata is retained. Owner-only
`GET /creator-location/me/device-city/:requestId` recovers an interrupted response
without dispatching another lookup; replaying the same UUID never calls a provider
again. Uncertain attempts require an explicit new request or manual entry.

Local validation uses mocked Google/Amap responses and a dedicated PostgreSQL
fixture. Real device accuracy, provider credentials, regional availability and
provider retention policies still need deployment-owner verification.

### Private revenue-contract upload recovery

Migration `20261005123000_revenue_contract_upload_recovery` adds the SQL-owned
`crew_revenue_contract_uploads` queue; preserve it during schema reconciliation.
The server records private placement before sending bytes. Publication and
cleanup share an object-specific transaction lock. Successful publication removes
the queue record atomically with the contract and audit. Cleanup rechecks contract
references and permanently retires unreferenced uploads before deleting bytes;
retired/missing attempts cannot subsequently become contract evidence.

The service sweeps up to 50 due uploads every minute. Interrupted pending writes
become eligible after 24 hours, well beyond the server-held two-minute write URL
and 30-second PUT timeout. Failed requests attempt immediate safe cleanup;
failed deletions remain durable and retry after 15 minutes. Concurrent replicas
claim under the same lock. A database failure after object deletion is safe to
retry. No signed URLs, document contents or bank information are stored in this
queue. This recovers newly recorded uploads, not historical orphan objects that
predate the queue. Live regional object-store deletion remains a release check.

### Storyboard export jobs

`src/storyboard-export/local-video-renderer.ts` renders ordered local MP4/WebM
clips with FFmpeg into H.264/AAC MP4. It preserves clip audio offsets, supplies
silence for clips without audio, fits the requested even-sized output dimensions,
and normalizes to 30 fps (duration rounds to the nearest frame). It accepts only
owned local input filenames, refuses symlinks/network protocols, bounds input
bytes/duration/clip count and output size, and cleans temporary output on failure.
The successful caller must invoke `dispose()` after storing the result privately.
Real-codec tests run with `STORYBOARD_RENDER_INTEGRATION=1`.

Authenticated `POST /storyboard-exports`, `GET /storyboard-exports/:id`,
`POST /storyboard-exports/:id/cancel` and `POST /storyboard-exports/:id/download`
expose job creation, status, cancellation and protected download. Account-scoped
`GET /storyboard-exports?documentId=...` returns the latest 20 jobs for return visits.
The creative-project storyboard dialog submits only fully acknowledged canvas
revisions, preserves request identity after an interrupted response, and polls
history for status, cancellation and download. Interactive Story timelines remain
outside merged-export scope. Durable admission records
the authorized saved snapshot and source-media usages atomically, serializes
idempotent requests per account, and limits each account to three active jobs.
Migration `20261006120000_storyboard_export_jobs` adds this queue. Internal worker
coordination uses renewable one-minute leases, fences stale workers, permits at
most three interrupted attempts, and releases source retention on failure,
cancellation or expiry. Completed jobs retain sources until their 24-hour expiry
so download authorization can recheck the referenced media. Expired private
output references remain recorded until storage cleanup succeeds.

Source reauthorization refreshes and locks the job, checks current canvas access,
active retained media and moderation, and rejects changed storage identities.
The input spool streams signed HTTPS reads with redirects disabled, enforces
declared and actual byte limits, writes private local files, and removes them on
failure or cancellation.

Private output upload now records placement in the SQL-owned
`storyboard_export_outputs` queue (migration `20261006130000`) before transfer,
verifies stored size/type, and publishes only with current source authorization
and a live lease. Cleanup permanently retires unreferenced objects before deletion;
failed deletions remain queued. Pending uploads wait one hour before cleanup,
beyond their five-minute write capability and two-minute transfer deadline.
Download signing rechecks job ownership, canvas access and source moderation,
then issues a private link valid for at most 60 seconds or the remaining job TTL.

The worker polls every ten seconds with one active render per server process,
renews its lease every twenty seconds, and aborts on lease loss or cancellation.
Shutdown aborts active work and leaves the lease recoverable by another replica.
It rechecks authorization before downloading, before rendering and when publishing.
Queue and private-output cleanup run each cycle. The container already includes
FFmpeg. Local codec tests exercise actual FFmpeg; storage-transfer tests use fixtures.

Local Chromium walkthroughs cover desktop/mobile creation, interrupted request
retry, cancellation and history reopening with API/auth/collaboration fixtures.
An isolated PostgreSQL integration runs the actual FFmpeg worker through private
publication, protected download authorization and expiry cleanup with storage
transfer fixtures. Run it with both `STORYBOARD_RENDER_INTEGRATION=1` and the
allowlisted `STORYBOARD_EXPORT_TEST_DATABASE_URL`. Real regional storage and
production worker capacity remain deployment acceptance checks.
Lease ownership is never a substitute for current document
and media authorization; recheck before rendering, publishing and downloading.
Worker capacity/disk isolation and COM/CN deployment acceptance remain necessary.

Saved export capture folds the persisted Yjs checkpoint and acknowledged tail
under the document mutation lock, checks the expected sequence, rejects pending
insert/delete dependencies, and projects saved shot order without rewriting the
canvas. Media IDs/URLs in this projection are identity hints, not authorization
or fetch capabilities; the admission path must resolve and pin canonical media.

### Resolution record search

The new-case task selector uses `GET /crew-task-center` with `scope`, `status=all`
and an optional `query`. Search matches task title, Crew name, exact task UUID,
or an exact task-linked income-entry UUID belonging to the requesting user.
All matches remain inside the existing live Crew membership and task-permission
scope; an income code is not an access capability. The same new-case page also embeds the existing IP/content report form; switching
record types preserves drafts, and successful reports link to their history.
The IP-purchase option uses authenticated `GET /ip-commerce/me/report-purchases`
to search the caller's orders by order number, purchase UUID or wallet transaction
UUID. It supports purchases whose content is no longer publicly listed. Reports
bind the owned order and its canonical IP/episode target; the database prevents
reassignment of the report link. The payment reason requires this verified link.
The form supplies a stable request UUID for unchanged retries; the server serializes
concurrent retries and rejects reused identities with different payloads. Purchase
references appear in initiated history and admin moderation, never the creator's
response projection. Creating a report does not refund or alter an order.

General Java-service transaction disputes and a dedicated published resolution-policy
URL remain outside these implemented contracts.

Initial evidence remains private until the uploader explicitly submits it with
an authorized case. Submission binds at most five verified attachments atomically
to the case; other participants cannot list unsubmitted drafts. Abandoned drafts
currently remain private and retained; no automatic deletion period is implied.

### Academy course → skill certificate mappings

`AcademyModule` stores explicit regional course associations in
`academy_course_certificates`. Apply the normal Prisma migrations before releasing
this module. The existing `JAVA_CONTENT_URL` and `JAVA_ADMIN_API_TOKEN` must reach
that region's Java Admin courses and `/api/admin/user-levels/levels` APIs.

In Admin → Courses → a saved course, use **Academy Skill Certificate** to choose
and save a live type-4 certificate. Empty means unassigned. Saves require
`courses.write` for the deployment's site, use an expected revision, and write
an Admin audit entry in the same transaction. Removal retains the revision;
changes do not alter certificates already awarded to students.

- Admin: `GET` / `PUT /admin/academy/course-certificates/:courseId`.
- Web / Mobile: `GET /academy/course-certificates/:courseId` for the published
  course's certificate; `GET /academy/certificates/:certificateId/courses`
  for published related courses (`locale`, optional `after` cursor).
- These routes are under the server's normal `/aurora` prefix on Web. Mobile
  uses its regional Aurora base and opens the corresponding regional Web course.

There are no seeded course/certificate pairs. Existing skill-to-certificate
configuration does not establish a course relationship. Saving an association
also does not award a badge: student qualification remains governed by the
existing Java review and certification flow, not playback progress.
