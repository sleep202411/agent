#!/bin/bash
# One-command CN deploy — the .cn analogue of deploy-com-aks.sh.
#
# Unlike .com (az acr build + ArgoCD), CN has no managed remote build and no
# GitOps. This script: builds the current commit IN-REGION on the build ECS
# (cross-border image push is infeasible), pushes to the CN ACR over the VPC
# endpoint, then `helm upgrade`s the ACK release directly.
#
#   Usage:  ./deploy/deploy-cn-ack.sh [TAG]      (TAG defaults to short HEAD)
#
# Prerequisites (one-time):
#   - aliyun CLI profiles: `default` (acct5, owns ECS+ACR+OSS), `qccsnj` (DNS)
#   - ~/.kube/config-fizzdragon-cn ; helm v4 ; a persistent deploy SSH key
#     ($DEPLOY_KEY) on the build ECS + SG 22 open for this machine's IP
#   - ACR creds at ~/.fizzdragon-cn/acr-username.txt + acr-password.txt
#   - DNS records (fizzstudio.fizzspace.cn, admin.fizzspace.cn) already point
#     at the CLB; new hosts are created out-of-band.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
TAG="${1:-$(git rev-parse --short HEAD)}"
ECS_ID=i-bp11r90r4g91u39iimnx
ECS_IP=115.29.229.152
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_github}"
SSH="ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=10"
SCP="scp -i $DEPLOY_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30"
LIVE_ORIGIN="https://fizzstudio.fizzspace.cn"   # baked PARENT_ORIGIN (CN live host)

echo "==> [1/6] start build ECS"
aliyun ecs StartInstance --InstanceId $ECS_ID --profile default >/dev/null 2>&1 || true
for i in $(seq 1 40); do
  s=$(aliyun ecs DescribeInstanceStatus --InstanceId.1 $ECS_ID --RegionId cn-hangzhou --profile default 2>/dev/null \
        | python3 -c "import sys,json;a=json.load(sys.stdin).get('InstanceStatuses',{}).get('InstanceStatus',[]);print(a[0]['Status'] if a else '?')")
  [ "$s" = "Running" ] && break; sleep 5
done

echo "==> [2/6] build secret-free source tarball @ $(git rev-parse --short HEAD)"
TMP=$(mktemp -d); trap 'rm -rf "$TMP" /tmp/cn-src.tar.gz' EXIT
git archive HEAD | tar -x -C "$TMP"
# Drop ALL committed .env* except the (secret-free) web build-args file.
find "$TMP" -type f -name ".env*" ! -path "*/apps/web/.env.production.cn" -delete
# Bake the CN live origin (web image is host-specific at build time).
sed -i'' -e "s#^NEXT_PUBLIC_PARENT_ORIGIN=.*#NEXT_PUBLIC_PARENT_ORIGIN=$LIVE_ORIGIN#" "$TMP/apps/web/.env.production.cn"
tar -czf /tmp/cn-src.tar.gz -C "$TMP" .
SZ=$(stat -f%z /tmp/cn-src.tar.gz 2>/dev/null || stat -c%s /tmp/cn-src.tar.gz)

echo "==> [3/6] sync source to ECS (byte-exact, cross-border)"
for i in $(seq 1 8); do
  $SCP /tmp/cn-src.tar.gz root@$ECS_IP:/root/src.tar.gz 2>/dev/null || true
  R=$($SSH root@$ECS_IP "stat -c%s /root/src.tar.gz 2>/dev/null" 2>/dev/null || true)
  [ "$R" = "$SZ" ] && { echo "  synced ($SZ bytes)"; break; }
  echo "  attempt $i: $R/$SZ — retry"
done
[ "$R" = "$SZ" ] || { echo "FATAL: source sync incomplete"; exit 1; }

echo "==> [4/6] in-region build + push to CN ACR"
$SCP ~/.fizzdragon-cn/acr-username.txt root@$ECS_IP:/root/.acr_user
$SCP ~/.fizzdragon-cn/acr-password.txt root@$ECS_IP:/root/.acr_token
$SCP "$ROOT/deploy/cn-remote-build.sh" root@$ECS_IP:/root/cn-remote-build.sh
$SSH root@$ECS_IP "TAG=$TAG bash /root/cn-remote-build.sh" | tee /tmp/cn-build.log
grep -q "BUILDFAIL\|PUSHFAIL" /tmp/cn-build.log && { echo "FATAL: a service failed to build/push"; exit 1; }

echo "==> [5/6] helm upgrade fizzdragon -> $TAG"
export KUBECONFIG=$HOME/.kube/config-fizzdragon-cn
helm upgrade fizzdragon "$ROOT/deploy/helm/fizzdragon" \
  -f "$ROOT/deploy/helm/fizzdragon/values.yaml" \
  -f "$ROOT/deploy/helm/fizzdragon/values.cn-prod.yaml" \
  --set web.image.tag="$TAG" --set server.image.tag="$TAG" \
  --set agent.image.tag="$TAG" --set agentWorker.image.tag="$TAG" \
  --set adminUi.image.tag="$TAG" \
  --force-conflicts --namespace fizzdragon
kubectl rollout status deploy/fizzdragon-server -n fizzdragon --timeout=180s || true

echo "==> [6/6] stop build ECS"
aliyun ecs StopInstance --InstanceId $ECS_ID --StoppedMode StopCharging --profile default >/dev/null 2>&1 || true
echo "DONE: deployed $TAG to CN ACK (fizzstudio.fizzspace.cn + admin.fizzspace.cn)"
