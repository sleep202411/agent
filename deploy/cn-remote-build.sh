#!/bin/bash
# ECS-side build helper — NOT run directly; deploy-cn.sh scp's this onto the
# cn-hangzhou build ECS and runs it there. Extracts the source tarball, logs into
# the CN ACR, builds all CN services amd64 and pushes them. ACR creds are read
# from /root/.acr_user + /root/.acr_token. Image tag is $TAG (env). Source is
# /root/src.tar.gz.
set -uo pipefail
REG=fizzdragon-registry-vpc.cn-hangzhou.cr.aliyuncs.com   # VPC endpoint (push+pull, no IP-ACL)
NS=fizzdragon
TAG="${TAG:?TAG env required}"

echo "=== extract source ==="
rm -rf /root/src && mkdir -p /root/src
tar -xzf /root/src.tar.gz -C /root/src
cd /root/src || { echo "FATAL: no source"; exit 1; }
[ -f apps/web/.env.production.cn ] || { echo "FATAL: bad source tree"; exit 1; }

# Reclaim disk BEFORE building. Sequential builds leave 100s of untagged layers
# (this ECS hit 40GB of dangling images → parallel `npm ci` failed with "no space
# left on device"). `prune -f` drops ONLY dangling layers — it keeps the base
# image + tagged builds, so it never re-triggers the blocked-docker.io base pull.
# (`prune -af` WOULD nuke the base — do NOT use it here.) See README.md § Deployment.
echo "=== disk free before prune: $(df -h / | awk 'NR==2{print $4}') ==="
docker image prune -f >/dev/null 2>&1 || true
echo "=== disk free after prune:  $(df -h / | awk 'NR==2{print $4}') ==="
# IMPORTANT: do NOT write a root .npmrc here. A root .npmrc makes
# `turbo prune --docker` (used by apps/server/Dockerfile) drop package-lock.json
# from out/json/, so `npm ci` fails with EUSAGE. registry.npmjs.org is reachable
# from cn-hangzhou ECS (npm's built-in fetch-retries cover transient blips); if a
# mirror is ever required, set it per-Dockerfile (npm ci --registry=...), never
# via a context-root .npmrc.

echo "$(cat /root/.acr_token)" | docker login "$REG" -u "$(cat /root/.acr_user)" --password-stdin \
  || { echo "FATAL: ACR login"; exit 1; }
rm -f /root/.acr_user /root/.acr_token
export DOCKER_BUILDKIT=1

set -a; source apps/web/.env.production.cn; set +a
SERVER_URL=http://fizzdragon-server:3001
RESULT=""
build() { # name dockerfile [extra build-args...]
  local name=$1 df=$2; shift 2
  echo "=== [$(date +%T)] BUILD $name ==="
  if docker build -f "$df" -t "$REG/$NS/fizzdragon-$name:$TAG" "$@" . ; then
    echo "=== [$(date +%T)] PUSH $name ==="
    docker push "$REG/$NS/fizzdragon-$name:$TAG" && RESULT="$RESULT $name:OK" || RESULT="$RESULT $name:PUSHFAIL"
  else RESULT="$RESULT $name:BUILDFAIL"; fi
}

build server apps/server/Dockerfile
build agent apps/agent/Dockerfile
build admin-ui apps/admin-ui/Dockerfile --build-arg NEXT_PUBLIC_ADMIN_UI_BASE_PATH=/
build web apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL="$NEXT_PUBLIC_OSS_BASE_URL" \
  --build-arg NEXT_PUBLIC_BANNER_BASE_URL="$NEXT_PUBLIC_BANNER_BASE_URL" \
  --build-arg NEXT_PUBLIC_USER_BASE_URL="$NEXT_PUBLIC_USER_BASE_URL" \
  --build-arg NEXT_PUBLIC_SITE_REGION="$NEXT_PUBLIC_SITE_REGION" \
  --build-arg NEXT_PUBLIC_STUDIO_HOST="$NEXT_PUBLIC_STUDIO_HOST" \
  --build-arg NEXT_PUBLIC_PARENT_ORIGIN="$NEXT_PUBLIC_PARENT_ORIGIN" \
  --build-arg NEXT_PUBLIC_API_CONTENT_PREFIX="$NEXT_PUBLIC_API_CONTENT_PREFIX" \
  --build-arg NEXT_PUBLIC_API_STUDIO_PREFIX="$NEXT_PUBLIC_API_STUDIO_PREFIX" \
  --build-arg NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN="$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN" \
  --build-arg NEXT_PUBLIC_POSTHOG_HOST="$NEXT_PUBLIC_POSTHOG_HOST" \
  --build-arg NEXT_PUBLIC_WS_HOST="" \
  --build-arg SERVER_URL="$SERVER_URL" \
  --build-arg JAVA_STUDIO_URL="$JAVA_STUDIO_URL" \
  --build-arg JAVA_CONTENT_URL="$JAVA_CONTENT_URL"

# Standalone canvas (apps/studio). NO build-args — studio bakes no NEXT_PUBLIC_*;
# all host/backend config is runtime pod env (values studio.env).
build studio apps/studio/Dockerfile \
  --build-arg AURORA_PROXY_TARGET="http://fizzdragon-server:3001" \
  --build-arg AURORA_STRIP_PREFIX="1" \
  --build-arg JAVA_STUDIO_URL="$JAVA_STUDIO_URL" \
  --build-arg JAVA_CONTENT_URL="$JAVA_CONTENT_URL" \
  --build-arg NEXT_PUBLIC_SITE_REGION="$NEXT_PUBLIC_SITE_REGION"

echo "=== REMOTE BUILD DONE @ $(date +%T):${RESULT} ==="
