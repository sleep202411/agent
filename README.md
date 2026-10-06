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
  agent/          旧 StoryOS（Mastra，现有部署仍引用，不新增功能）
  mobile/         移动端（Expo / React Native）
packages/
  shared/             跨应用共享代码
  ui/                 共享 UI 组件
  eslint-config/      ESLint 配置
  typescript-config/  TypeScript 配置
deploy/
  helm/              Helm chart（ArgoCD 渲染部署 .com → AKS）
  argocd/            ArgoCD Application 声明
  deploy-com-aks.sh  .com 部署（az acr build → bump values → ArgoCD）
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

**规范：两个 cell 都只从 `main` 部署**（`develop` 是工作分支，上线前 merge 到 main；所有部署脚本内置 `main` 分支 guard，非 main 直接拒绝，`FORCE=1` 覆盖）。两边机制不同——`.com` 走 ArgoCD/GitOps（改 git 里的镜像 tag，ArgoCD 收敛），`.cn` 直接 `helm upgrade`——但都以 `main` 为准。

### 部署前置（一次性）

`.com` 部署脚本本身只需要 **Azure CLI**（`az acr build` + 登录检查）；`kubectl` 仅用于部署后**验证** rollout / 查 pod / 跑 prod DB 脚本。装一次即可：

```bash
# Azure CLI —— 部署必需
brew install azure-cli                 # macOS（其它平台见 docs.microsoft.com/cli/azure/install）
az login
az account set --subscription 5d94f40f-701f-45e1-ab4b-0e1506104ebd   # fizzdragon-ai-prod

# kubectl + AKS 凭据 —— 验证 / 运维用（部署脚本不需要）
brew install kubectl
az aks get-credentials \
  --subscription 5d94f40f-701f-45e1-ab4b-0e1506104ebd \
  --resource-group rg-fizzdragon-com-prod \
  --name aks-fizzdragon-com            # → 得到 `aks-fizzdragon-com` context
```

> `.cn` 走 Aliyun ACK（阿里云），凭据 / 工具见 `.cn` 小节；与上面的 Azure 凭据无关。

### `.com`（国际）— AKS + ArgoCD + `deploy-com-aks.sh`

生产 `.com` 跑在 **Azure AKS**，用 **ArgoCD**（GitOps）部署：**git 是唯一真相**，
ArgoCD 持续把集群对齐成 `main` 分支 `deploy/helm/fizzdragon/values.yaml` 里声明的镜像 tag。

```bash
# 1) 把要上线的代码合到 main（ArgoCD 盯 main）
git checkout main && git merge develop && git push

# 2) 在 main 上构建 + 上线
deploy/deploy-com-aks.sh web server     # 只部指定服务（外科手术式）
deploy/deploy-com-aks.sh all            # 全部：web studio admin-ui server agent
```

`deploy-com-aks.sh` 做的事：`az acr build` 用**不可变 git-sha** 打镜像 → push ACR →
改 `values.yaml` 的 tag → commit/push → **ArgoCD 自动同步部署**。

> ⚠️ **只 merge 到 main 不会部署**——ArgoCD 看的是 values.yaml 的镜像 tag，不是代码提交。
> 必须跑 `deploy-com-aks.sh`（它改 tag），ArgoCD 才会动。
>
> ⚠️ **不要 `kubectl set image` / `helm upgrade` 直推**——ArgoCD `selfHeal` 会在几分钟内
> 还原。部署只走 `deploy-com-aks.sh`（git 路径）。Helm 是底座（ArgoCD 渲染它），不手动 upgrade。

发布镜像和推送 tag 不等于 rollout 成功。具备集群读取权限的发布负责人可运行：

```bash
node deploy/diagnose-com-server.mjs <完整镜像SHA> [kubectl-context]
```

默认 context 为 `aks-fizzdragon-com`。该只读命令输出 ArgoCD 同步状态、Server
期望/实际镜像、Pod/init 状态和 Service/Ingress 目标；不读取 Secret 或执行容器命令。
读取失败、旧 Pod 仍在服务或 rollout 未完成时返回非零。若卡在 init，检查 `db-migrate`；
若挂载失败，检查 CSI/Key Vault 配置；若进程重启，检查启动日志。尤其确认
`creator-payout-details-key` 已按 Server README 配置，不能通过移除密钥校验绕过。
健康探针成功后仍需验证已登录的 withdrawals、task-contracts、reviews 和 disputes 接口。

- 镜像仓库：ACR `acrfizzdragoncom.azurecr.io`
- 集群：`aks-fizzdragon-com`（southeastasia），namespace `fizzdragon-com`
- ArgoCD app：`fizzdragon-com`（auto-sync + prune + selfHeal）
- 回滚：把 `values.yaml` 的 tag 改回上一个 good sha 并 push（ArgoCD 收敛），或 `git revert` 那次 bump

### `.cn`（中国）— Aliyun ACK + `deploy-cn.sh`

生产 `.cn` 跑在 **Aliyun ACK**（集群 `fizzdragon-cn`，cn-hangzhou，namespace `fizzdragon`，
kubeconfig `~/.kube/config-fizzdragon-cn`），与 .com 的 AKS 完全独立（独立 VPC / RDS PG / Redis）；
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

两个 cell，各自独立的边缘 + 集群（不再是单机 nginx/docker——那套已停用）：

```
.com（国际）
  境外用户 → Azure Front Door（WAF + TLS + 缓存，按路径分流）
    ├─ /aurora/*         → AKS server（NestJS）        [不缓存·直透]
    ├─ /content /studio  → Java 后端 java.fizzdragon.com（外部）
    ├─ /*                → AKS web（Next.js）
    └─ media.fizzdragon.com → Azure Blob（长缓存）
  实时：客户端直连自建 WebSocket 网关（不经 Front Door）

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

1. 日常在 `develop` 直接提交。
2. 上线：`develop` → `main`，用**普通 merge**（非 squash——squash 会把 `values.yaml` 里 .com 的镜像 tag 冲成 develop 的旧值）。
3. **从 `main` 部署两个 cell**（脚本都有分支 guard，非 main 拒绝）：
   - `.com`：`deploy/deploy-com-aks.sh <service…>`
   - `.cn`：`deploy/deploy-cn.sh`（日常增量）或 `deploy/deploy-cn.sh --full`（全量冷启动）

> `main` = 唯一生产真相。两边机制不同（.com 走 ArgoCD/GitOps，.cn 直接 helm），但都以 main 为准——详见 [Deployment](#deployment)。

---

## fizzdragon.com — Azure Front Door（LIVE 2026-06-20）

境外 `.com` 的 apex + www + media + studio 已全部走 Azure Front Door。下面是**已上线的边缘架构 + 缓存/路由策略**；原迁移的执行 runbook（变量、P0–P4 步骤、验证清单、回滚）已完成删去，执行细节查 git 历史。

### 架构

```
境外用户
  └─ Azure Front Door (Std/Premium)  [边缘: WAF + TLS 终止 + 缓存]
       ├─ 域: fizzdragon.com / www.fizzdragon.com
       │    ├─ /content/*  /studio/*  → 源: Java 后端 (java.fizzdragon.com)  [直透·不缓存]
       │    ├─ /aurora/*              → 源: AKS server                       [直透·不缓存]
       │    └─ /* (默认)              → 源: AKS web 应用                     [可缓存静态、HTML 不缓存]
       └─ 域: media.fizzdragon.com    → 源: Azure Blob (fizzdragonblob)      [长 TTL·immutable]

实时(.com): 客户端直连自建 WebSocket 网关 —— 不经过 Front Door（Web PubSub 已下线）。
```

关键点：FD 用**路径路由 + 多源**自己做分流，所以 AKS ingress **不需要**再把 `/content`
`/studio` 反代回 Java（避免"Java 回环"问题）。AKS 只当 `/aurora` 和 `/` 的源。

### 缓存 / 路由策略（登录态 / 媒体最容易出事）

| 路径 / 域                              | 源         | 缓存                   | 备注                                     |
| -------------------------------------- | ---------- | ---------------------- | ---------------------------------------- |
| `media.*` 公共图片/免费视频            | Blob       | **长 TTL + immutable** | key 内容寻址、不可变，可永久缓存         |
| `media.*` 付费/签名视频(SAS)           | Blob       | **禁缓存(no-store)**   | SAS ~5min,缓存命中会变 403;或直接绕过 FD |
| `/aurora/*`                            | AKS server | **禁缓存·直透**        | API + SSE + negotiate                    |
| `/aurora/copilot/stream`、Produce 流   | AKS server | **禁缓存·禁缓冲**      | 长 SSE,见 §7 超时坑                      |
| `/content/*` `/studio/*`               | Java       | **禁缓存·直透**        | 保留 cookie/header,手机硬编码靠这两条    |
| `/` HTML / 应用入口                    | AKS web    | 不缓存或短 TTL         | 避免 ChunkLoad 类问题                    |
| `/_next/static/*` 等带 hash 的前端资源 | AKS web    | 长 TTL                 | 文件名带 hash,可长缓存                   |

**铁律**：任何带 `Set-Cookie` / `Authorization` / `satoken` 的响应,FD 不得缓存、不得改写
cookie（否则 WS negotiate / 登录态出问题）。

### 已知坑

1. **FD 源响应超时 240s（4 分钟）**，而 `/aurora/copilot/stream` + Produce 可跑 30+ 分钟。FD 按"字节间空闲"计时，所以长 SSE 必须 <240s 有心跳/注释帧，否则该路径单独路由绕过 FD 直连 AKS。
2. **origin 回源 TLS**：FD→AKS 用 AKS 具名证书 + origin host header `fizzdragon.com`（AKS ingress 有 apex host 规则）。
3. **Blob 公共访问**：公共媒体容器公共读（公共对象走直连 URL），签名对象走 SAS。

### 遗留待清理（.com 边缘）

- 遗留媒体子域 `cdn` / `images` / `*-sg`、散落后端（`vpn`/`aigc`/`api`/`business`…）、WordPress/Mailchimp 记录 —— 确认无流量后单独退役。
- `static/avatar/banner.fizzspace.cn` 在 `apps/web` 的 43 处硬编码 —— 单独排期。
