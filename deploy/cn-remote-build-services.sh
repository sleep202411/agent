#!/bin/bash
# ECS-side selective build — used by deploy-cn-services.sh.
# SERVICES env: space-separated subset of: server agent admin-ui web studio
# Does NOT replace cn-remote-build.sh (full five-service builds stay there).
set -uo pipefail
REG=fizzdragon-registry-vpc.cn-hangzhou.cr.aliyuncs.com
NS=fizzdragon
TAG="${TAG:?TAG env required}"
SERVICES="${SERVICES:?SERVICES env required (e.g. 'web' or 'web studio')}"

echo "=== extract source ==="
rm -rf /root/src && mkdir -p /root/src
tar -xzf /root/src.tar.gz -C /root/src
cd /root/src || { echo "FATAL: no source"; exit 1; }
[ -f apps/web/.env.production.cn ] || { echo "FATAL: bad source tree"; exit 1; }

echo "=== disk free before prune: $(df -h / | awk 'NR==2{print $4}') ==="
docker image prune -f >/dev/null 2>&1 || true
echo "=== disk free after prune:  $(df -h / | awk 'NR==2{print $4}') ==="

echo "$(cat /root/.acr_token)" | docker login "$REG" -u "$(cat /root/.acr_user)" --password-stdin \
  || { echo "FATAL: ACR login"; exit 1; }
rm -f /root/.acr_user /root/.acr_token
export DOCKER_BUILDKIT=1

set -a; source apps/web/.env.production.cn; set +a
SERVER_URL=http://fizzdragon-server:3001
RESULT=""
build() {
  local name=$1 df=$2; shift 2
  echo "=== [$(date +%T)] BUILD $name ==="
  if docker build -f "$df" -t "$REG/$NS/fizzdragon-$name:$TAG" "$@" . ; then
    echo "=== [$(date +%T)] PUSH $name ==="
    docker push "$REG/$NS/fizzdragon-$name:$TAG" && RESULT="$RESULT $name:OK" || RESULT="$RESULT $name:PUSHFAIL"
  else RESULT="$RESULT $name:BUILDFAIL"; fi
}

want() {
  case " $SERVICES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

want server && build server apps/server/Dockerfile
want agent && build agent apps/agent/Dockerfile
want admin-ui && build admin-ui apps/admin-ui/Dockerfile --build-arg NEXT_PUBLIC_ADMIN_UI_BASE_PATH=/
want web && build web apps/web/Dockerfile \
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
want studio && build studio apps/studio/Dockerfile \
  --build-arg AURORA_PROXY_TARGET="http://fizzdragon-server:3001" \
  --build-arg AURORA_STRIP_PREFIX="1" \
  --build-arg JAVA_STUDIO_URL="$JAVA_STUDIO_URL" \
  --build-arg JAVA_CONTENT_URL="$JAVA_CONTENT_URL" \
  --build-arg NEXT_PUBLIC_SITE_REGION="$NEXT_PUBLIC_SITE_REGION"

echo "=== REMOTE BUILD DONE @ $(date +%T):${RESULT} ==="
