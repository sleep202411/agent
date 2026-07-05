#!/bin/bash
# FAST incremental CN deploy — the warm-path counterpart to deploy-cn-ack.sh.
#
# Instead of re-syncing the whole ~72MB source tree across the slow, wedge-prone
# cross-border link (deploy-cn-ack.sh step [3/6]), this PATCHES only the changed
# files into the source tarball already on the build ECS. For the common case
# (small diff, ECS already warm) this cuts the sync from ~30-40 min to seconds.
#
# ⚠️ WHY we patch the TARBALL and never scp into /root/src:
#   cn-remote-build.sh begins with `rm -rf /root/src && tar -xzf /root/src.tar.gz`
#   — it RE-EXTRACTS the tarball on every build. Files scp'd into /root/src are
#   silently CLOBBERED at build time (this cost hours of "still broken" once). So
#   we extract → patch the diff → re-tar → grep-verify BEFORE building.
#
# Use deploy-cn-ack.sh instead when: the ECS has been off a while, the tarball is
# stale/unknown, or the diff is huge. This script does NOT stop the ECS (leave it
# warm for the next incremental) — stop it manually when done (see final step).
#
#   Usage:  ./deploy/deploy-cn-incremental.sh [BASE_TAG]
#           BASE_TAG = the commit the ECS tarball is currently at. Defaults to the
#           marker /root/.deployed-tag written by the previous deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
TAG="$(git rev-parse --short HEAD)"
ECS_ID=i-bp11r90r4g91u39iimnx
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_github}"
SSH="ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=15"
SCP="scp -i $DEPLOY_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30"
LIVE_ORIGIN="https://fizzstudio.fizzspace.cn"

echo "==> [1/6] ensure build ECS is up"
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

BASE="${1:-$($SSH root@$ECS_IP 'cat /root/.deployed-tag 2>/dev/null' 2>/dev/null || true)}"
[ -n "$BASE" ] || { echo "FATAL: no BASE tag — pass it as an arg, or run deploy-cn-ack.sh once (it seeds /root/.deployed-tag)"; exit 1; }
echo "==> [2/6] patch diff ${BASE}..${TAG} into the ECS tarball"
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
# Bake the CN live origin into the web build-args (same as the full deploy).
$SSH root@$ECS_IP "sed -i 's#^NEXT_PUBLIC_PARENT_ORIGIN=.*#NEXT_PUBLIC_PARENT_ORIGIN=$LIVE_ORIGIN#' /root/stage/apps/web/.env.production.cn"

echo "==> [3/6] re-tar + verify"
$SSH root@$ECS_IP 'cd /root/stage && tar -czf /root/src.tar.gz . && echo $TAG > /root/.pending-tag'
# Re-extract + sanity-check the tarball is well-formed BEFORE burning a 15-min
# build on it (the whole point of patching the tarball is that it's error-prone).
$SSH root@$ECS_IP 'rm -rf /root/vrfy && mkdir /root/vrfy && tar -xzf /root/src.tar.gz -C /root/vrfy && [ -f /root/vrfy/apps/web/.env.production.cn ]' \
  || { echo "FATAL: re-tarred tarball failed verification"; exit 1; }

echo "==> [4/6] in-region build + push (cn-remote-build prunes disk first)"
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
  --set adminUi.image.tag="$TAG" --set studio.image.tag="$TAG" \
  --force-conflicts --namespace fizzdragon
kubectl rollout status deploy/fizzdragon-server -n fizzdragon --timeout=180s || true

echo "==> [6/6] record deployed tag; ECS left RUNNING for the next incremental"
$SSH root@$ECS_IP "echo $TAG > /root/.deployed-tag"
echo "   stop it when done:  aliyun ecs StopInstance --InstanceId $ECS_ID --StoppedMode StopCharging --profile default"
echo "DONE: incremental deploy $TAG (base $BASE) -> fizzstudio.fizzspace.cn + studio.fizzspace.cn"
