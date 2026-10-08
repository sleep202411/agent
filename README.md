# FizzDragon Platform

Turborepo monorepo for FizzDragon Studio — AI-powered video content creation platform.

## Project Structure

```
apps/
  web/            主站 + Studio 入口（Next.js）
  studio/         FizzStudio 画布应用（Next.js）
  admin-ui/       内部运营后台（Next.js，中文）
  server/         NestJS 后端（AI 生成 / Agent / Java 代理 / billing）
  agent-os/       当前 Agent OS（LangGraph / Temporal）
  game-agent/     独立 Harness 游戏创作服务
  agent/          旧 StoryOS（Mastra，国际站已退休，不新增功能）
  mobile/         移动端（Expo / React Native）
packages/
  shared/             跨应用共享代码
  ui/                 共享 UI 组件
  eslint-config/      ESLint 配置
  typescript-config/  TypeScript 配置
deploy/
  helm/              Helm chart（CN 部署；SG 历史准备层不可直接用于生产）
  argocd/            历史 Azure ArgoCD 声明（已暂停）
  aliyun-sg/         .com 新加坡生产发布
  deploy-com.sh      .com 部署（本地 buildx → SG ACR → ACK 镜像更新）
  deploy-com-aks.sh  已禁用的旧 Azure 入口
  deploy-cn.sh · cn-remote-build.sh   .cn 部署（build ECS → CN ACR → helm；cn-remote-build 是 ECS 侧帮手，不直接跑）
```

## Getting Started

Use the Node and npm versions declared in `package.json` (CI uses Node 24.18.1).
Configure the required app environments before starting services.

```bash
npm install

# Start configured dev services (13 persistent tasks; concurrency is 16).
npm run dev

# Start one app, when only that app is needed.
npx turbo run dev --filter=web
npx turbo run dev --filter=studio
npx turbo run dev --filter=server
```

The server's `dev` task delegates to `start:dev`, including its shared-package
build prerequisite. Root dev also includes Agent OS and the still-referenced
legacy Agent; each requires its own environment. Starting the frontend alone
does not start Aurora or establish a working backend connection.

| Service              | Local URL             |
| -------------------- | --------------------- |
| Web                  | http://localhost:9527 |
| Studio               | http://localhost:9540 |
| Admin UI             | http://localhost:9530 |
| Aurora / Nest server | http://localhost:4399 |

If a port is occupied, check the existing process and stop the appropriate dev
session before starting a replacement.

## Environment Variables

Place Next.js environment files at the app root: `apps/web/.env.local` and
`apps/studio/.env.local`, **not** inside either app's `app/` directory. Restart
the affected dev process after changing environment values. Keep existing
local environment files and credentials out of commits.

### Web (`apps/web/.env.local`)

Set `JAVA_CONTENT_URL` and `JAVA_STUDIO_URL` to the approved test backends for
the intended site. For an independently configured local Aurora server:

```dotenv
SERVER_URL=http://localhost:4399
```

See `apps/web/.env.example` for the remaining Web settings.

### Studio (`apps/studio/.env.local`)

Studio requires `AURORA_PROXY_TARGET`, `JAVA_CONTENT_URL`, `JAVA_STUDIO_URL`
and `NEXT_PUBLIC_SITE_REGION`. Use the approved site values for the Java URLs
and site region; they have no implicit production fallback. For local Aurora,
which serves its routes without the `/aurora` prefix:

```dotenv
AURORA_PROXY_TARGET=http://localhost:4399
AURORA_STRIP_PREFIX=1
```

These proxy settings are also build inputs. A successful frontend start does
not prove that those upstream services are available.

### Server (`apps/server/.env`)

Use `apps/server/.env.example` as a reference and configure the approved local
database, Redis, Java integration and any enabled provider settings. The
`start:dev` script sets port 4399. Do not run deployment scripts to resolve a
local startup problem.

## Build

```bash
# 构建所有
npm run build

# 单独构建
npx turbo build --filter=web
npx turbo build --filter=server
```

## Deployment

`.com` 和 `.cn` 发布均要求经过审核的 `main` 与干净工作区。`.com` 构建启动时固定的
已提交 HEAD，不包含本地修改或未跟踪源码。脚本不会提交、推送、合并或切换分支；
只读 `--check` 不要求当前分支为 `main` 或工作区干净。

### `.com`（国际）— Alibaba Cloud Singapore ACK + `deploy-com.sh`

六个活跃服务（Web、Server、Studio、Admin UI、Agent OS、Harness/Game Agent）
运行在阿里云新加坡 ACK。目标固定为账号
`5332868355276356`（CLI profile `acct6`）、`ap-southeast-1`、集群
`fizzdragon-com-sg`（`cb3e336c4059a4112b65c783e7bf67f1e`）、namespace `fizzdragon`。
部署者使用自己的 RAM 身份和该集群的 kubeconfig；构建需要本地已运行的 Docker/buildx，
发布需要 Python 3.9+、Git、阿里云 CLI 和 kubectl。

```bash
export KUBECONFIG=/absolute/path/to/singapore-kubeconfig
./deploy/deploy-com.sh --check         # 只读检查账号、集群及当前服务
./deploy/deploy-com.sh web             # 构建并发布选定服务
./deploy/deploy-com.sh server studio game-agent
./deploy/deploy-com.sh all             # 六个活跃服务，包括 Agent OS / Harness
```

脚本归档固定 HEAD 源码，推送新加坡 ACR，以不可变 digest 更新选定容器并等待就绪；
保留线上环境变量、Secret、PVC、网络和域名配置。Server 镜像变化时先使用现有集群
数据库凭据运行原生 Prisma migration，失败则停止应用更新。仅改镜像的发布不会重新
应用不完整的历史 Helm 准备配置。没有自动提交或自动回滚；迁移与旧版本的兼容性必须
在发布前审核。旧 Azure 脚本已禁用，Azure ArgoCD 保持暂停。

详细用法、部署者接入、已有镜像发布及故障处理见 [新加坡发布说明](deploy/aliyun-sg/README.md)。

### `.cn`（中国）— Aliyun ACK + `deploy-cn.sh`

生产 `.cn` 跑在 **Aliyun ACK**（集群 `fizzdragon-cn`，cn-hangzhou，namespace `fizzdragon`，
kubeconfig `~/.kube/config-fizzdragon-cn`），与 .com 的新加坡 ACK 完全独立（独立 VPC / RDS PG / Redis）；
Java 仅作外部 HTTPS API 调用。无托管构建、无 GitOps：在**境内 build ECS** 构建（跨境推镜像不可行）
→ push CN ACR → 直接 `helm upgrade`。

```bash
# 1. main + clean worktree；只读检查构建链路
deploy/cn-preflight.sh --phase build server studio web admin-ui

# 2. 全量跨境同步，在杭州 ECS build，并 push CN ACR；不改 ACK
deploy/deploy-cn.sh --full --build-only

# 3. 手工确认 RDS 临时恢复演练 + 即时备份后，显式运行 migration Job
CN_RDS_BACKUP_ID=<backup-id> CONFIRM_CN_PROD_MIGRATION=YES \
  deploy/run-cn-migrations.sh

# 4. 原子 Helm upgrade；chart/config 变化必须显式确认
deploy/deploy-cn.sh --deploy-only --allow-chart-update
```

- **CN 只允许全量源码同步**。旧增量 SCP 在 OpenSSH/SFTP 下会把远端引号当成文件名，可能返回成功却构建旧代码，已从入口移除。
- `--build-only` 与 `--deploy-only` 刻意分离：镜像必须先在境内构建、推送并验证，数据库迁移完成后才允许滚动 ACK。
- Helm 管理的是整套 release，不是真正的单服务资源。当前 chart/config 指纹与线上不一致时，即使只改一个镜像也必须审阅并传 `--allow-chart-update`。
- CN 普通 Server rollout 不再自动执行 Prisma migration；迁移只走带即时备份编号和显式确认的 `run-cn-migrations.sh` Job。
- Legacy StoryOS 已冻结：CN API 固定最后可用镜像，worker 独立固定当前健康镜像；普通 platform release 不构建或推进 legacy agent。
- Agent OS、MiniMax 在 CN 尚未完成区域基础设施/密钥前显式关闭；已经从生产 chart 退休的 Temporal 不会被旧 develop 配置重新带回。
- `cn-remote-build.sh` 构建前 `docker image prune -f` 清 dangling 层（防磁盘满）；不用 `-af`，会删被墙的 base 镜像。
- 密钥（WeChat Pay 等）改 live secret `fizzdragon-server-secrets` 后必须 `kubectl rollout restart deploy/fizzdragon-server`
  （envFrom 只在 pod 启动时读）。配置一律落声明式源头（values / 代码 / secret），别用运行时 `kubectl set env`——helm 升级会冲掉。
- prod PG 操作 / seed：laptop 连不上，用 pod 里跑 esbuild 打包的一次性 Prisma 脚本（`kubectl cp` + `NODE_PATH=/app/node_modules node`）；
  删数据先确认 0 订单/订阅（order→price 是 onDelete Restrict，有引用改归档 `isActive=false`）。

## Domains, DNS & TLS

所有 `*.fizzspace.cn` 共用一张通配证（Aliyun CAS，**到期 2027-01-09**，手动跨账号续）。

| 域名                      | 用途                                         | 证书 / 来源                        |
| ------------------------- | -------------------------------------------- | ---------------------------------- |
| `fizzstudio.fizzspace.cn` | .cn 主站（web）                              | LE（cert-manager / ACK）           |
| `fizzdragon.fizzspace.cn` | 旧主域，2026-06-26 cutover 到 ACK            | 通配（secret `fizzdragon-cn-tls`） |
| `java.fizzspace.cn`       | **Java 后端 API**（独立 ECS，Java 团队维护） | 通配（ECS nginx）                  |
| `media.fizzspace.cn`      | 媒体读 CDN                                   | 通配                               |
| `oss.fizzspace.cn`        | 浏览器签名直传 / 读 OSS                      | 通配                               |
| `admin.fizzspace.cn`      | .cn 管理台                                   | LE（cert-manager）                 |
| `fizzdragon.com`          | .com 主站                                    | DigiCert / Azure Front Door        |

- **web 的 `JAVA_*_URL` 是构建期烘焙的**（`apps/web/.env.production.cn` → `next.config.ts` rewrites）——改后端代理目标必须**重建镜像**，改运行时 env 无效。
- `fizzdragon.fizzspace.cn` 已从 Java ECS 挪到 ACK；**Java 后端仍在那台 ECS**，经 `java.fizzspace.cn` 调用，未下线。
- 已发布的 mobile app 内置 `fizzdragon.fizzspace.cn/content|/studio`，靠 cutover 转发到 java；下个版本改成 `java.fizzspace.cn`。

## Architecture

两个 cell 使用独立的集群、数据库、Redis 和区域配置：

```
.com（国际）
  fizzstudio / studio / admin → Cloudflare → 新加坡 ALB → ACK
    ├─ /aurora/* → server（NestJS）
    ├─ 页面 → web / studio / admin-ui
    └─ 内部服务 → Agent OS / Harness Game Agent
  fizzdragon.com / www → Azure Front Door（保留现有边缘路由）
  Java API / MySQL → 原独立账号与服务
  新媒体 → Cloudflare R2；旧 Azure Blob 媒体保留读取

.cn（中国）
  大陆用户 → Aliyun ACK ingress
    ├─ /aurora/* → server（NestJS）   /* → web（Next.js）
    └─ /content /studio → Java 后端 java.fizzspace.cn（外部）
  媒体走 media.fizzspace.cn CDN → 私有 OSS
```

AI 生成由 server 调外部 provider（Alibaba / fal / BytePlus 等）。两个 cell 部署见 [Deployment](#deployment)。

## Branch Strategy

```
main       ← 生产：.com 和 .cn 两个 cell 都从这里部署
  ↑
develop    ← 默认工作分支，日常直接在此提交（单人开发）
```

### 开发 / 上线流程

1. 日常在 `develop` 开发；提交、推送和合并均需明确指示。
2. 常规上线审核后合入 `main`；Mobile 遵循其专用分支规则。
3. `.com` 使用 `deploy/deploy-com.sh <service…>`；发布前确认当前源码与迁移兼容性。
4. `.cn` 继续使用现有 `deploy/deploy-cn.sh` 流程，要求 `main` 和干净工作区。

两边账号、集群和发布配置独立，详见 [Deployment](#deployment)。

## Edge routing and media

`fizzdragon.com` 与 `www` 保留 Azure Front Door；`fizzstudio.fizzdragon.com`、
`studio.fizzdragon.com`、`admin.fizzdragon.com` 经 Cloudflare 访问新加坡 ALB/ACK。
旧 Azure Blob 媒体继续提供读取，新生成的国际站媒体使用 Cloudflare R2。
Java/MySQL 在原独立账号 `5941647929258385`，不随 `.com` 应用发布迁移。

API、登录、支付和带认证的响应必须保持动态，不缓存带 `Set-Cookie`、
`Authorization` 或 `satoken` 的内容。带内容 hash 的静态文件可长缓存。
常规应用发布不修改 DNS、TLS 或边缘路由，也不删除保留的 Front Door/Blob 资源。
