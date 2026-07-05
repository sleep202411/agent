# CN (`.cn`) 部署 Runbook

> 固化 2026-07 那次商业化部署踩过的坑。国内 `.cn` 与国际 `.com` 是**两个独立
> cell**,基建、部署方式完全不同。本文只讲 `.cn`；`.com` 走 `deploy-com-aks.sh`
>
> - ArgoCD（GitOps，声明式，几乎不用手动碰）。

## 为什么 `.cn` 特殊

|      | `.com`                                              | `.cn`                                                                                                                           |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 集群 | Azure AKS `aks-fizzdragon-com`，ns `fizzdragon-com` | Aliyun ACK，kubeconfig `~/.kube/config-fizzdragon-cn`，ns `fizzdragon`                                                          |
| 构建 | `az acr build`（云端）+ ArgoCD 自动同步             | **境内 build ECS**（跨境推镜像不可行）+ 手动 `helm upgrade`                                                                     |
| 密钥 | Azure Key Vault + CSI 投影                          | 手动 k8s Secret `fizzdragon-server-secrets`（**live secret 即真相，无 .env 主本**）                                             |
| 配置 | 全在 values.yaml / KeyVault（声明式）               | 部分靠手动。**任何配置都要落到声明式源头（values / 代码 / secret），不要用运行时 `kubectl patch/set env` —— helm 一升级就冲掉** |

**访问：** `.cn` = `kubectl --kubeconfig ~/.kube/config-fizzdragon-cn -n fizzdragon …`；
`.com` = `kubectl --context aks-fizzdragon-com -n fizzdragon-com …`。

## 部署：两种模式

前置：`aliyun` CLI（profile `default` = acct5，owns ECS+ACR）、helm v4、
`~/.kube/config-fizzdragon-cn`、部署 SSH key `~/.ssh/id_ed25519_github`、
ACR 凭据 `~/.fizzdragon-cn/acr-{username,password}.txt`。

### A) 全量冷启动 —— `deploy/deploy-cn-ack.sh [TAG]`

StartInstance → 打 secret-free 源码 tarball → **分块（4MB）跨境同步**（慢，~30-40min，
跨境单个大文件 scp 会 TCP wedge，所以分块+重试）→ 境内 build 全服务推 ACR → helm →
StopInstance（StopCharging 省钱）。**首次 / ECS 停机已久 / tarball 未知 / 大 diff 用它。**

### B) 快速增量 —— `deploy/deploy-cn-incremental.sh [BASE_TAG]`

只把 `git diff BASE..HEAD` 的改动文件**补丁进 ECS 上已有的 tarball**，跳过整棵树的慢
同步（秒级）。BASE 默认读 ECS 上 `/root/.deployed-tag`（上次部署写的）。**日常小改用它。**
不 StopInstance（留温以便下次增量）—— 用完手动停：
`aliyun ecs StopInstance --InstanceId i-bp11r90r4g91u39iimnx --StoppedMode StopCharging --profile default`

## ⚠️ 血泪坑（都已在脚本里根治，勿手改回去）

1. **`cn-remote-build.sh` 每次 build 都 `rm -rf /root/src && tar -xzf src.tar.gz`
   重解压 tarball。** → 往 `/root/src` scp 单文件会被**静默冲掉**，build 的是旧码
   （曾耗数小时"还是不对"）。增量必须**补丁 tarball 本身**（extract→patch→re-tar→
   grep 验证），不能 scp 进 /root/src。`deploy-cn-incremental.sh` 就是这么做的。
2. **磁盘满 "no space left on device"。** 顺序 build 留下几百个未打标层（曾 40GB
   dangling → 并行 `npm ci` 炸）。`cn-remote-build.sh` 现在 build 前 `docker image
prune -f`（**只删 dangling，保留 base + tagged**；千万别用 `prune -af` —— 会删掉
   base 镜像，而 docker.io 被墙，重拉要走 daocloud 镜像）。老 tagged 镜像也会慢慢
   堆，偶尔手动 `podman rmi` 清掉非最近几个 tag。
3. **跨境同步单个大文件会 hang** → 冷启动脚本分块 4MB + 每块重试 + `ServerAliveInterval`。

## 密钥（WeChat Pay 等）

live secret `fizzdragon-server-secrets` 就是真相（没有维护中的 .env 主本）。改法 =
直接 `kubectl patch` / `kubectl create secret … --dry-run | kubectl apply` 那个 secret。
**改完必须 `kubectl rollout restart deploy/fizzdragon-server`** —— envFrom 是 pod 启动时
读的，跑着的 pod 不会拿到新 key。私钥留本地 `~/workspace/fizzdragon/app/signing/`，不进仓库。

## Seed / 数据操作（prod PG）

laptop 连不上 prod PG。用 pod 里跑一次性 Prisma 脚本：

1. 写 `x.ts`：`new PrismaPg({connectionString:process.env.DATABASE_URL,max:10}); new
PrismaClient({adapter})`（Prisma 7 **必须**传 adapter，裸 `new PrismaClient()` 抛错），
   import 真 seed/逻辑（绝对路径）；**安全门**：`if (!DATABASE_URL.includes('aliyuncs.com')) throw`
   （CN=Aliyun RDS，.com=Azure PG，用它区分 cell 防误伤）。
2. `npx esbuild x.ts --bundle --platform=node --packages=external --outfile=x.js`
3. `kubectl … cp x.js POD:/tmp/ && kubectl … exec POD -- sh -c 'NODE_PATH=/app/node_modules node /tmp/x.js'`
   （**NODE_PATH 必需**，否则找不到 /app/node_modules）。跑在对应 cell 的 server pod 里 →
   DATABASE_URL 天然正确。删数据先查 0 订单/订阅再删（order→price 是 onDelete **Restrict**，
   有引用会失败 → 改归档 `isActive=false, archivedAt`，不碰订单历史）。

## 部署后验证

```sh
KC=~/.kube/config-fizzdragon-cn
NP=$(kubectl --kubeconfig $KC -n fizzdragon get pods | grep fizzdragon-server- | grep Running | tail -1 | awk '{print $1}')
# 镜像 tag 对不对
kubectl --kubeconfig $KC -n fizzdragon get pod $NP -o jsonpath='{.spec.containers[0].image}'
# 关键 env 还在不在（helm 升级后确认）
kubectl --kubeconfig $KC -n fizzdragon exec $NP -- sh -c 'echo "$BILLING_ALLOWED_RETURN_ORIGINS / $WECHAT_PAY_MCH_ID"'
```

## 计费模型（避免文档漂移）

算力积分（compute point）= **纯自定义金额充值，两个 cell 都没有"套餐包"**（前端快捷金额
按钮只是快捷方式）。cell 差异只有**币种 + 支付方式**：`.com` USD + Airwallex，`.cn` CNY + 微信。
后端从隐藏 anchor SKU（`COMPUTE_POINT_CUSTOM_RECHARGE`，`.com` USD/$1=100分, `.cn` CNY/¥7=100分）
的价↔grant 比率算积分。币种只支持 **USD + CNY**（不支持 SGD/其它）。社区积分才有套餐包。
