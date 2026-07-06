# FizzDragon Platform

Turborepo monorepo for FizzDragon Studio — AI-powered video content creation platform.

## Project Structure

```
apps/
  web/            主站 + Studio 入口（Next.js）
  studio/         FizzStudio 画布应用（Next.js）
  admin-ui/       内部运营后台（Next.js，中文）
  server/         NestJS 后端（AI 生成 / Agent / Java 代理 / billing）
  agent/          StoryOS 多智能体（Mastra）
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
  deploy-cn-ack.sh · deploy-cn-incremental.sh · cn-remote-build.sh   .cn 部署（build ECS → CN ACR → helm）
  docker-compose.yml · auto-update.sh · nginx/   ← 旧 ECS/podman 方案（legacy，待 CN→Aliyun 时清理）
```

## Getting Started

```bash
# 安装依赖
npm install

# 启动所有服务
npm run dev

# 只启动前端
npx turbo dev --filter=web

# 只启动后端
npx turbo dev --filter=server
```

| Service              | URL                   |
| -------------------- | --------------------- |
| Web (TanStack Start) | http://localhost:3000 |
| Server (NestJS)      | http://localhost:3001 |

## Environment Variables

### Web (`apps/web/.env.local`)

```bash
JAVA_CONTENT_URL=http://120.26.152.164:8091
JAVA_STUDIO_URL=http://120.26.152.164:8090
SERVER_URL=http://localhost:3001
VITE_OSS_BASE_URL=https://fizzspace-test.oss-cn-hangzhou.aliyuncs.com
```

### Server (`apps/server/.env`)

```bash
JAVA_STUDIO_URL=http://120.26.152.164:8090
JAVA_CONTENT_URL=http://120.26.152.164:8091
ALIBABA_API_KEY=sk-xxx
ALIBABA_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
PORT=3001
```

参考 `apps/web/.env.example` 和 `apps/server/.env.example` 获取完整变量列表。

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

- 镜像仓库：ACR `acrfizzdragoncom.azurecr.io`
- 集群：`aks-fizzdragon-com`（southeastasia），namespace `fizzdragon-com`
- ArgoCD app：`fizzdragon-com`（auto-sync + prune + selfHeal）
- 回滚：把 `values.yaml` 的 tag 改回上一个 good sha 并 push（ArgoCD 收敛），或 `git revert` 那次 bump

### `.cn`（中国）— Aliyun ACK + `deploy-cn-ack.sh` / `deploy-cn-incremental.sh`

生产 `.cn` 跑在 **Aliyun ACK**（集群 `fizzdragon-cn`，cn-hangzhou，namespace `fizzdragon`，
kubeconfig `~/.kube/config-fizzdragon-cn`），与 .com 的 AKS 完全独立（独立 VPC / RDS PG / Redis）；
Java 仅作外部 HTTPS API 调用。无托管构建、无 GitOps：在**境内 build ECS** 构建（跨境推镜像不可行）
→ push CN ACR → 直接 `helm upgrade`。

```bash
deploy/deploy-cn-ack.sh [TAG]     # 全量冷启动：StartInstance → tarball → 分块跨境同步 → build → helm → StopInstance
deploy/deploy-cn-incremental.sh   # 增量（日常小改）：只补丁 git diff 到 ECS 已有 tarball → build → helm；base 读 /root/.deployed-tag
```

- 全量的跨境源码同步是瓶颈（~72MB 分块 scp，~30-40 分钟）；日常小改用增量脚本，只传改动文件、秒级。
  增量补丁 tarball 本身而非 `/root/src`——`cn-remote-build.sh` 每次构建会 `rm -rf /root/src` 重解压 tarball。
- `cn-remote-build.sh` 构建前 `docker image prune -f` 清 dangling 层（防磁盘满）；不用 `-af`，会删被墙的 base 镜像。
- 密钥（WeChat Pay 等）改 live secret `fizzdragon-server-secrets` 后必须 `kubectl rollout restart deploy/fizzdragon-server`
  （envFrom 只在 pod 启动时读）。配置一律落声明式源头（values / 代码 / secret），别用运行时 `kubectl set env`——helm 升级会冲掉。
- prod PG 操作 / seed：laptop 连不上，用 pod 里跑 esbuild 打包的一次性 Prisma 脚本（`kubectl cp` + `NODE_PATH=/app/node_modules node`）；
  删数据先确认 0 订单/订阅（order→price 是 onDelete Restrict，有引用改归档 `isActive=false`）。
- 旧的 `deploy/docker-compose.yml` / `nginx/`（ECS/podman 方案）已停用。

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

```
User → Nginx (443/HTTPS)
         ↓
       Web container (3000)
         ↓ (Docker internal: http://server:3001)
       Server container (3001)
         ↓
       Java Backend (external)
       Alibaba AI API (external)
```

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
   - `.cn`：`deploy/deploy-cn-incremental.sh`（日常增量）或 `deploy/deploy-cn-ack.sh`（全量冷启动）

> `main` = 唯一生产真相。两边机制不同（.com 走 ArgoCD/GitOps，.cn 直接 helm），但都以 main 为准——详见 [Deployment](#deployment)。

---

## fizzdragon.com → Azure Front Door 切换（进行中）

> 范围：**仅国际侧 `.com`**。中国侧（`fizzdragon.fizzspace.cn` / 阿里云）本轮**完全不动**。
> 原则：**只加不改**——新东西全部并行新建，老记录保留兜底；唯一"改现有记录"的是最后
> 一步 apex 的 A/CNAME 翻转，且可秒级回滚（保留 ECS）。

### 0. 已定决策

- 媒体子域：**`media.fizzdragon.com`**（`cdn` / `images` 已被遗留占用，不复用）。
- 本轮范围：**media + apex 一起**接入 Azure Front Door（Standard/Premium）。
- 边缘证书：**首选 Front Door 托管证书**（apex 免费托管 + 自动续）。
  **兜底/回源用已验证的通配符**：阿里云 CAS(qccsnj) 的 `*.fizzdragon.com`，SAN 含裸 apex
  （`DNS:*.fizzdragon.com, DNS:fizzdragon.com`），链 WoTrus→Sectigo→USERTrust（受信，
  `openssl verify` OK），到期 **2026-12-01**；本地 `/Users/isaac/workspace/fizzdragon/ssl/
25080420_fizzdragon.com_nginx/{fizzdragon.com.pem,fizzdragon.com.key}`，key 已验证匹配。
  → 万一 FD 给 apex 签托管证书卡验证，把这张当 BYOC 传 Key Vault 顶上；FD→AKS 回源那段也用它。
  **续签成本 0**：上 FD 托管后这张到期自然退役（或换 cert-manager+LE 免费自动续）。
- CN 不碰；大陆用户走 `.cn`（本轮不评估大陆经 FD 的体验，后续可单独实测）。

### 1. 目标架构

```
境外用户
  └─ Azure Front Door (Std/Premium)  [边缘: WAF + TLS 终止 + 缓存]
       ├─ 域: fizzdragon.com / www.fizzdragon.com
       │    ├─ /content/*  /studio/*  → 源: Java 后端 (java.fizzdragon.com)  [直透·不缓存]
       │    ├─ /aurora/*              → 源: AKS server                       [直透·不缓存]
       │    └─ /* (默认)              → 源: AKS web 应用                     [可缓存静态、HTML 不缓存]
       └─ 域: media.fizzdragon.com    → 源: Azure Blob (fizzdragonblob)      [长 TTL·immutable]

实时(.com): 客户端 negotiate 后直连 *.webpubsub.azure.com —— 不经过 Front Door，无需配置。
```

关键点：FD 用**路径路由 + 多源**自己做分流，所以 AKS ingress **不需要**再把 `/content`
`/studio` 反代回 Java（避免"Java 回环"问题）。AKS 只当 `/aurora` 和 `/` 的源。

### 2. 变量（执行前填好）

```bash
SUBSCRIPTION="<azure-subscription-id>"
RG="<resource-group>"                      # FD 所在资源组
FD_PROFILE="fizzdragon-com-afd"            # Front Door profile 名
AKS_ORIGIN_HOST="20.198.160.91"            # AKS 公网 LB（/aurora、/ 的源）
AKS_NS="fizzdragon-com"
BLOB_ORIGIN="fizzdragonblob.blob.core.windows.net"   # 媒体源（按实际容器/端点核实）
JAVA_ORIGIN="java.fizzdragon.com"          # /content /studio 的源（现 47.237.115.136）
APEX="fizzdragon.com"
```

> ⚠️ 上面 IP/host/容器名以**线上实测为准**：`az aks show`、`kubectl get svc -n $AKS_NS`、
> Blob 端点在 portal 里确认（是否启用 static website / 公共容器）。

### 3. 缓存 / 路由策略表（最容易出事，先定死）

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

### 4. 执行阶段

#### P0 — 前置

1. 确认 AKS 全 pod healthy,`/health` 从 `20.198.160.91` 可应答。
2. 选 FD 档：**Premium**（要 WAF 托管规则 + Private Link 回源）或 **Standard**（够用、便宜）。
   本轮建议 Standard 起步,WAF 之后加。
3. 决定 origin 回源 TLS：FD→Blob 用 Blob 端点 HTTPS;FD→AKS 用 `20.198.160.91` HTTPS,
   origin host header 设为 `fizzdragon.com`,AKS ingress 需有 apex host 规则（见 P3）。

#### P1 — 建 Front Door + 媒体源（纯增量,零影响）

```bash
az afd profile create -g $RG --profile-name $FD_PROFILE --sku Standard_AzureFrontDoor
# media 端点
az afd endpoint create -g $RG --profile-name $FD_PROFILE --endpoint-name media --enabled-state Enabled
az afd origin-group create -g $RG --profile-name $FD_PROFILE --origin-group-name og-blob \
  --probe-path / --probe-protocol Https --probe-request-type HEAD --probe-interval-in-seconds 120 \
  --sample-size 4 --successful-samples-required 3 --additional-latency-in-milliseconds 50
az afd origin create -g $RG --profile-name $FD_PROFILE --origin-group-name og-blob \
  --origin-name blob --host-name $BLOB_ORIGIN --origin-host-header $BLOB_ORIGIN \
  --https-port 443 --priority 1 --weight 1000 --enabled-state Enabled
az afd route create -g $RG --profile-name $FD_PROFILE --endpoint-name media \
  --route-name media-all --origin-group og-blob --supported-protocols Https \
  --https-redirect Enabled --forwarding-protocol HttpsOnly --link-to-default-domain Enabled
```

此时 FD 默认域 `media-xxx.z01.azurefd.net` 可访问,但 `media.fizzdragon.com` 还没指过去,
**线上零变化**。

#### P2 — 媒体自定义域 + DNS（增量）+ 切 env

1. 加自定义域 + FD 托管证书：

```bash
az afd custom-domain create -g $RG --profile-name $FD_PROFILE \
  --custom-domain-name media-fizzdragon-com --host-name media.fizzdragon.com \
  --minimum-tls-version TLS12 --certificate-type ManagedCertificate
# 关联到 media 路由
az afd route update -g $RG --profile-name $FD_PROFILE --endpoint-name media \
  --route-name media-all --custom-domains media-fizzdragon-com
```

2. **DNS（qccsnj profile,新增,不动现有）**：按 FD 提示加
   - `media` CNAME → `media-xxx.z01.azurefd.net`
   - `_dnsauth.media`（或 FD 给的）TXT → 域名归属校验值
3. `curl -I https://media.fizzdragon.com/<某public对象>` 验证命中 Blob + 200。
4. 缓存规则：给 media 路由配 Rule Set——公共对象长 TTL,响应含 `Cache-Control: private`
   的一律 bypass。
5. **切 env（与 FD 就绪同步）**：
   ```
   MEDIA_PUBLIC_BASE_URL_AZURE_BLOB = https://media.fizzdragon.com
   ```
   切完所有新返回的图片/视频 URL 走 FD;**老 `cdn`/`images`/`*-sg` 全留着,旧 URL 仍可用**。
6. **下架流程补一步 CDN purge**（`az afd endpoint purge`）,否则边缘还吐已下架内容。

#### P3 — apex/www 接入 Front Door（路由 + 证书,still 不切 DNS）

1. apex 端点 + 三个源组：

```bash
az afd endpoint create -g $RG --profile-name $FD_PROFILE --endpoint-name web --enabled-state Enabled
# 源组: AKS (server + web 复用同一 LB,用路由分 /aurora vs /)；Java 单独源组
az afd origin-group create ... --origin-group-name og-aks   # host 20.198.160.91
az afd origin-group create ... --origin-group-name og-java  # host java.fizzdragon.com
# 路由（按 §3 表）: /content* /studio* → og-java; /aurora* → og-aks(no-cache); /* → og-aks(web)
```

2. AKS ingress 加 **apex host 规则**（`deploy/helm/fizzdragon/values.yaml` 的 `ingress.entries`
   加 `fizzdragon.com`,`/`→web、`/aurora`→server）,这样 FD 以 host header `fizzdragon.com`
   回源能命中。
3. 加自定义域 `fizzdragon.com` + `www.fizzdragon.com`,**FD 托管证书**（apex 免费托管）。
4. www → 301 到 apex 的规则。
5. 用 FD 默认域 + host 改写**预演**：`curl --resolve fizzdragon.com:443:<FD-IP> https://fizzdragon.com/...`
   把 `/`、`/aurora/*`、`/content`、`/studio`、SSE、negotiate 全过一遍,**还没切 DNS**。

#### P4 — apex DNS 翻转（唯一"改现有记录",可回滚）

1. （可选但推荐）**大陆/多地实测** FD 端点可达 + 延迟可接受。
2. DNS（qccsnj）：`@` 和 `www` 从 `47.84.16.145` → 指向 FD（CNAME flattening / FD 提供的
   apex 接入方式;Alidns 用 显性 CNAME 到 FD 端点,apex 用 别名/隐性方式按 FD 文档）。TTL 保持 600s。
3. **保留 ECS `47.84.16.145` 不下线**,出问题立刻把 A/CNAME 回退。
4. 观察 24–48h（错误率、登录态、WS negotiate、SSE、手机 global 版真机跑一遍）再考虑退役 ECS。

### 5. 验证清单（每阶段）

- [ ] `curl -I https://media.fizzdragon.com/<public>` → 200 + 命中 Blob + 长 `Cache-Control`
- [ ] 签名/SAS 媒体 → `private, no-store`,FD **未**缓存
- [ ] `https://fizzdragon.com/` → 200,HTTP/2,证书有效（FD 托管,SAN 含 apex）
- [ ] `/aurora/*` 正常 + 无缓存;negotiate 返回 `*.webpubsub.azure.com` 直连 URL
- [ ] `/content` `/studio` → Java,cookie 正常
- [ ] SSE `/aurora/copilot/stream` 不被 FD 4 分钟超时切断（见 §7）
- [ ] 手机 global 版：登录 + 生成 + 看图/视频 全通
- [ ] `www` → 301 → apex

### 6. 回滚

- 媒体：把 env `MEDIA_PUBLIC_BASE_URL_AZURE_BLOB` 改回原值（或置空）→ 立即回到原媒体源。
- apex：DNS 回退到 `47.84.16.145`（ECS 仍在跑）→ 600s 内恢复。

### 7. 必须现场核实 / 已知坑

1. **FD 源响应超时上限 240s（4 分钟）**,而 `/aurora/copilot/stream` + Produce 可跑 30+ 分钟。
   FD 对流式是"字节间空闲"计时,所以 **SSE 必须在 <240s 内有心跳/注释帧**才不会被切;
   否则把这些长流路径**单独路由绕过 FD 直连 AKS**。**切前必测。**
2. **WS 空闲超时**：`.com` 实时已走 Web PubSub 直连、不过 FD,所以这条本轮基本无忧;
   只剩 negotiate 是普通 HTTP。
3. **origin 回源 TLS**：FD→AKS 那一段要有效证书。FD 用户侧证书由 FD 托管;FD→origin 可用
   AKS 现有具名证书 + origin host header,或 origin 走 HTTP（内网信任时）——二选一,核实。
4. **Blob 公共访问**：确认媒体容器是公共读（公共对象走直连 URL 的前提),签名对象才走 SAS。
5. **大陆**：本轮不评估;若日后要管大陆经 FD 的体验,单独实测,别和本轮混。

### 8. 不在本轮（明确排除）

- CN（`.cn` / 阿里云 / 备案）一切。
- 遗留媒体子域 `cdn` / `images` / `*-sg`、散落后端（`vpn`/`aigc`/`api`/`business`…）、
  WordPress/Mailchimp 记录——**全部保留不动**,确认彻底无流量后再单独退役。
- `static/avatar/banner.fizzspace.cn` 在 `apps/web` 的 43 处硬编码——单独排期。
