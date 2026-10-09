#!/bin/bash
# ECS-side selective build — used by deploy-cn-services.sh.
# SERVICES env: space-separated subset of: server agent agent-os game-agent admin-ui web studio
# Does NOT replace cn-remote-build.sh (full five-service builds stay there).
set -euo pipefail
REG=fizzdragon-registry-vpc.cn-hangzhou.cr.aliyuncs.com
NS=fizzdragon
TAG="${TAG:?TAG env required}"
EXPECTED_REVISION="${EXPECTED_REVISION:?EXPECTED_REVISION env required}"
SERVICES="${SERVICES:?SERVICES env required (e.g. 'web' or 'web studio')}"

echo "=== extract source ==="
rm -rf /root/src && mkdir -p /root/src
tar -xzf /root/src.tar.gz -C /root/src
cd /root/src || { echo "FATAL: no source"; exit 1; }
[ -f apps/web/.env.production.cn ] || { echo "FATAL: bad source tree"; exit 1; }
[ "$(cat .fizzdragon-source-revision 2>/dev/null || true)" = "$EXPECTED_REVISION" ] || {
  echo "FATAL: source revision does not match requested image tag" >&2
  exit 1
}

echo "=== disk free before prune: $(df -h / | awk 'NR==2{print $4}') ==="
docker image prune -f >/dev/null 2>&1 || true
echo "=== disk free after prune:  $(df -h / | awk 'NR==2{print $4}') ==="

trap 'rm -f /root/.acr_user /root/.acr_token' EXIT
docker login "$REG" -u "$(cat /root/.acr_user)" --password-stdin < /root/.acr_token
export DOCKER_BUILDKIT=1

# Hangzhou ECS cannot reliably reach registry.npmjs.org (ECONNRESET). Use the
# npmmirror via Dockerfile NPM_REGISTRY build-arg — never a context-root .npmrc
# (breaks turbo prune lockfile emission).
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
# Keep system-package downloads in region as well as npm dependencies.
APK_MIRROR="${APK_MIRROR:-mirrors.aliyun.com}"

set -a; source apps/web/.env.production.cn; set +a
SERVER_URL=http://fizzdragon-server:3001
build() {
  local name=$1 df=$2; shift 2
  local image="$REG/$NS/fizzdragon-$name:$TAG"
  echo "=== [$(date +%T)] BUILD $name (npm=$NPM_REGISTRY) ==="
  docker build -f "$df" -t "$image" \
    --build-arg "NPM_REGISTRY=$NPM_REGISTRY" "$@" .
  echo "=== [$(date +%T)] PUSH $name ==="
  docker push "$image"
  # Podman 4.9's `docker manifest inspect` treats a single-image OCI manifest
  # as a manifest list and exits 125 even after a successful push. A pull by
  # tag resolves the remote manifest through ACR and supports both media types;
  # already-present layers are reused from the local store.
  docker pull --quiet "$image" >/dev/null
  echo "=== [$(date +%T)] VERIFIED $image ==="
}

want() {
  case " $SERVICES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

for service in $SERVICES; do
  case "$service" in
    server|agent|agent-os|game-agent|admin-ui|web|studio) ;;
    *) echo "FATAL: unsupported service $service" >&2; exit 2 ;;
  esac
done

want server && build server apps/server/Dockerfile --build-arg "APK_MIRROR=$APK_MIRROR"
want agent && build agent apps/agent/Dockerfile
want agent-os && build agent-os apps/agent-os/Dockerfile
want game-agent && build game-agent apps/game-agent/Dockerfile
want admin-ui && build admin-ui apps/admin-ui/Dockerfile --build-arg NEXT_PUBLIC_ADMIN_UI_BASE_PATH=/
want web && build web apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL="$NEXT_PUBLIC_OSS_BASE_URL" \
  --build-arg NEXT_PUBLIC_BANNER_BASE_URL="$NEXT_PUBLIC_BANNER_BASE_URL" \
  --build-arg NEXT_PUBLIC_USER_BASE_URL="$NEXT_PUBLIC_USER_BASE_URL" \
  --build-arg NEXT_PUBLIC_SITE_REGION="$NEXT_PUBLIC_SITE_REGION" \
  --build-arg NEXT_PUBLIC_STUDIO_HOST="$NEXT_PUBLIC_STUDIO_HOST" \
  --build-arg NEXT_PUBLIC_CONTENT_GPS_MAP_ENABLED="${NEXT_PUBLIC_CONTENT_GPS_MAP_ENABLED:-false}" \
  --build-arg NEXT_PUBLIC_CONTENT_GPS_GOOGLE_KEY="${NEXT_PUBLIC_CONTENT_GPS_GOOGLE_KEY:-}" \
  --build-arg NEXT_PUBLIC_CONTENT_GPS_GOOGLE_MAP_ID="${NEXT_PUBLIC_CONTENT_GPS_GOOGLE_MAP_ID:-}" \
  --build-arg NEXT_PUBLIC_CONTENT_GPS_GAODE_KEY="${NEXT_PUBLIC_CONTENT_GPS_GAODE_KEY:-}" \
  --build-arg NEXT_PUBLIC_CONTENT_GPS_GAODE_PROXY_PATH="${NEXT_PUBLIC_CONTENT_GPS_GAODE_PROXY_PATH:-}" \
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

echo "=== REMOTE BUILD DONE @ $(date +%T): $SERVICES ==="
