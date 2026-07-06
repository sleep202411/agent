#!/bin/bash
# .cn 部署 —— 唯一入口（.cn 的 analogue of deploy-com-aks.sh）。
#
#   ./deploy/deploy-cn.sh            # 增量（默认，日常小改）
#   ./deploy/deploy-cn.sh --full     # 全量冷启动
#
# 增量：只把 `git diff` 的改动文件补丁进 ECS 上已有的源码 tarball，跳过整棵树的慢
#       跨境同步（秒级）。base 读 ECS 的 /root/.deployed-tag。
# 全量：打 secret-free 源码 tarball → 分块跨境同步 → 结束后 StopInstance。首次 / ECS
#       停机已久 / tarball 未知 / 大 diff 用它。
#
# 两种模式都：境内 build ECS 构建（cn-remote-build.sh，跨境推镜像不可行）→ push CN ACR
# → `helm upgrade`。生产只从 main 部署（FORCE=1 覆盖）。
#
# 前置：aliyun CLI（profile default = acct5，owns ECS+ACR）、helm v4、
#   ~/.kube/config-fizzdragon-cn、部署 SSH key、ACR 凭据 ~/.fizzdragon-cn/acr-*.txt。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"

MODE=incremental
[ "${1:-}" = "--full" ] && MODE=full

TAG="$(git rev-parse --short HEAD)"
ECS_ID=i-bp11r90r4g91u39iimnx
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_github}"
SSH="ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3"
SCP="scp -i $DEPLOY_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3"
LIVE_ORIGIN="https://fizzstudio.fizzspace.cn"   # baked PARENT_ORIGIN (CN live host)

# 生产只从 main 部署 —— 两个 cell 统一（.com 走 ArgoCD 盯 main，.cn 也对齐 main）。覆盖：FORCE=1。
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "✋ 当前分支 '$BRANCH'——生产只从 main 部署。先 merge develop→main，或 FORCE=1 覆盖。" >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✋ 工作区有未提交改动——部署的是已提交的 HEAD，先 commit/stash 以免和你看到的不一致。" >&2
  exit 1
fi

echo "==> [1/6] ensure build ECS up  (mode=$MODE, tag=$TAG)"
aliyun ecs StartInstance --InstanceId $ECS_ID --profile default >/dev/null 2>&1 || true
for i in $(seq 1 40); do
  s=$(aliyun ecs DescribeInstanceStatus --InstanceId.1 $ECS_ID --RegionId cn-hangzhou --profile default 2>/dev/null \
        | python3 -c "import sys,json;a=json.load(sys.stdin).get('InstanceStatuses',{}).get('InstanceStatus',[]);print(a[0]['Status'] if a else '?')")
  [ "$s" = "Running" ] && break; sleep 5
done
ECS_IP=$(aliyun ecs DescribeInstances --InstanceIds "['$ECS_ID']" --RegionId cn-hangzhou --profile default 2>/dev/null \
  | python3 -c "import sys,json;i=json.load(sys.stdin)['Instances']['Instance'][0];eip=i.get('EipAddress',{}).get('IpAddress','');pub=i.get('PublicIpAddress',{}).get('IpAddress',[]);print(eip or (pub[0] if pub else ''))")
[ -n "$ECS_IP" ] || { echo "FATAL: could not resolve build ECS public IP" >&2; exit 1; }
for i in $(seq 1 12); do nc -z -G 5 "$ECS_IP" 22 2>/dev/null && break; sleep 5; done
echo "  build ECS IP: $ECS_IP"

if [ "$MODE" = full ]; then
  echo "==> [2/6] full: secret-free 源码 tarball @ $TAG → 分块跨境同步"
  # 跨境链路传小文件稳、传单个大文件会 TCP wedge → 拆 4MB 块 + 每块重试 + 校验字节数。
  TMP=$(mktemp -d); trap 'rm -rf "$TMP" /tmp/cn-src.tar.gz' EXIT
  git archive HEAD | tar -x -C "$TMP"
  find "$TMP" -type f -name ".env*" ! -path "*/apps/web/.env.production.cn" -delete
  sed -i'' -e "s#^NEXT_PUBLIC_PARENT_ORIGIN=.*#NEXT_PUBLIC_PARENT_ORIGIN=$LIVE_ORIGIN#" "$TMP/apps/web/.env.production.cn"
  tar -czf /tmp/cn-src.tar.gz -C "$TMP" .
  SZ=$(stat -f%z /tmp/cn-src.tar.gz 2>/dev/null || stat -c%s /tmp/cn-src.tar.gz)
  CHUNK_DIR="$TMP/chunks"; mkdir -p "$CHUNK_DIR"
  ( cd "$CHUNK_DIR" && split -b 4m /tmp/cn-src.tar.gz part- )
  $SSH root@$ECS_IP "rm -rf /root/src-chunks && mkdir -p /root/src-chunks"
  for f in "$CHUNK_DIR"/part-*; do
    name=$(basename "$f"); want=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
    for i in $(seq 1 6); do
      $SCP "$f" root@$ECS_IP:/root/src-chunks/"$name" 2>/dev/null || true
      got=$($SSH root@$ECS_IP "stat -c%s /root/src-chunks/$name 2>/dev/null" 2>/dev/null || true)
      [ "$got" = "$want" ] && break
      echo "  $name attempt $i: $got/$want — retry"
    done
    [ "$got" = "$want" ] || { echo "FATAL: chunk $name failed"; exit 1; }
  done
  $SSH root@$ECS_IP "cat /root/src-chunks/part-* > /root/src.tar.gz && rm -rf /root/src-chunks"
  R=$($SSH root@$ECS_IP "stat -c%s /root/src.tar.gz 2>/dev/null" 2>/dev/null || true)
  [ "$R" = "$SZ" ] && echo "  synced ($SZ bytes)" || { echo "FATAL: reassembled size $R != $SZ"; exit 1; }
else
  # 增量：补丁 tarball 本身，不是 /root/src —— cn-remote-build.sh 每次构建会 `rm -rf
  # /root/src` 重解压 tarball，scp 进 /root/src 会被覆盖。
  BASE="$($SSH root@$ECS_IP 'cat /root/.deployed-tag 2>/dev/null' 2>/dev/null || true)"
  [ -n "$BASE" ] || { echo "FATAL: ECS 无 /root/.deployed-tag —— 先跑一次 --full。" >&2; exit 1; }
  echo "==> [2/6] incremental: patch diff ${BASE}..${TAG} 进 ECS tarball"
  $SSH root@$ECS_IP 'rm -rf /root/stage && mkdir -p /root/stage && tar -xzf /root/src.tar.gz -C /root/stage'
  CHANGED="$(git diff --name-only "$BASE"..HEAD || true)"
  [ -n "$CHANGED" ] || { echo "  no changes vs $BASE — nothing to deploy"; exit 0; }
  for f in $CHANGED; do
    if [ -f "$f" ]; then
      $SSH root@$ECS_IP "mkdir -p /root/stage/$(dirname "$f")"
      $SCP "$f" "root@$ECS_IP:/root/stage/$f" >/dev/null && echo "  + $f"
    else
      $SSH root@$ECS_IP "rm -f /root/stage/$f" && echo "  - $f (deleted)"
    fi
  done
  $SSH root@$ECS_IP "sed -i 's#^NEXT_PUBLIC_PARENT_ORIGIN=.*#NEXT_PUBLIC_PARENT_ORIGIN=$LIVE_ORIGIN#' /root/stage/apps/web/.env.production.cn"
  $SSH root@$ECS_IP 'cd /root/stage && tar -czf /root/src.tar.gz .'
  $SSH root@$ECS_IP 'rm -rf /root/vrfy && mkdir /root/vrfy && tar -xzf /root/src.tar.gz -C /root/vrfy && [ -f /root/vrfy/apps/web/.env.production.cn ]' \
    || { echo "FATAL: re-tarred tarball failed verification"; exit 1; }
fi

echo "==> [3/6] in-region build + push (cn-remote-build 先 prune 磁盘)"
$SCP ~/.fizzdragon-cn/acr-username.txt root@$ECS_IP:/root/.acr_user
$SCP ~/.fizzdragon-cn/acr-password.txt root@$ECS_IP:/root/.acr_token
$SCP "$ROOT/deploy/cn-remote-build.sh" root@$ECS_IP:/root/cn-remote-build.sh
$SSH root@$ECS_IP "TAG=$TAG bash /root/cn-remote-build.sh" | tee /tmp/cn-build.log
grep -q "BUILDFAIL\|PUSHFAIL" /tmp/cn-build.log && { echo "FATAL: a service failed to build/push"; exit 1; }

echo "==> [4/6] helm upgrade fizzdragon -> $TAG"
export KUBECONFIG=$HOME/.kube/config-fizzdragon-cn
helm upgrade fizzdragon "$ROOT/deploy/helm/fizzdragon" \
  -f "$ROOT/deploy/helm/fizzdragon/values.yaml" \
  -f "$ROOT/deploy/helm/fizzdragon/values.cn-prod.yaml" \
  --set web.image.tag="$TAG" --set server.image.tag="$TAG" \
  --set agent.image.tag="$TAG" --set agentWorker.image.tag="$TAG" \
  --set adminUi.image.tag="$TAG" --set studio.image.tag="$TAG" \
  --force-conflicts --namespace fizzdragon
kubectl rollout status deploy/fizzdragon-server -n fizzdragon --timeout=180s || true

echo "==> [5/6] record deployed tag"
$SSH root@$ECS_IP "echo $TAG > /root/.deployed-tag"

if [ "$MODE" = full ]; then
  echo "==> [6/6] stop build ECS"
  aliyun ecs StopInstance --InstanceId $ECS_ID --StoppedMode StopCharging --profile default >/dev/null 2>&1 || true
else
  echo "==> [6/6] ECS 留运行以便下次增量；用完手动停:"
  echo "   aliyun ecs StopInstance --InstanceId $ECS_ID --StoppedMode StopCharging --profile default"
fi
echo "DONE: $MODE deploy $TAG -> fizzstudio.fizzspace.cn + studio.fizzspace.cn"
