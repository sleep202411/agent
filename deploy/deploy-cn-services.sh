#!/usr/bin/env bash
# Mainland-China release path:
#   full git archive -> private OSS relay (build-relay.fizzspace.cn) -> cn-hangzhou
#   build ECS -> CN ACR -> ACK Helm release.
# Helm owns the whole release, so a chart/config change requires the explicit
# --allow-chart-update acknowledgement even for a one-service image release.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PHASE=all
FULL=0
ALLOW_CHART_UPDATE=0
REQUESTED=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --full) FULL=1; shift ;;
    --build-only) PHASE=build; shift ;;
    --deploy-only) PHASE=deploy; shift ;;
    --allow-chart-update) ALLOW_CHART_UPDATE=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--full] [--build-only|--deploy-only] [--allow-chart-update] <service...|platform>"
      echo "Services: web studio admin-ui server agent-os; legacy agent requires ALLOW_LEGACY_AGENT_DEPLOY=1"
      exit 0
      ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) REQUESTED+=("$1"); shift ;;
  esac
done

[ "${#REQUESTED[@]}" -gt 0 ] || { echo "No services selected" >&2; exit 2; }
if [ "${REQUESTED[0]}" = platform ] || [ "${REQUESTED[0]}" = all ]; then
  SERVICES=(server studio web admin-ui agent-os)
else
  SERVICES=("${REQUESTED[@]}")
fi

for service in "${SERVICES[@]}"; do
  case "$service" in
    web|studio|admin-ui|server|agent-os) ;;
    agent)
      [ "${ALLOW_LEGACY_AGENT_DEPLOY:-0}" = 1 ] || {
        echo "FATAL: legacy agent is frozen/quarantined; set ALLOW_LEGACY_AGENT_DEPLOY=1 only after its image passes a real boot test" >&2
        exit 2
      }
      ;;
    *) echo "Unknown service: $service" >&2; exit 2 ;;
  esac
done

if [ "$PHASE" != deploy ] && [ "$FULL" -ne 1 ]; then
  echo "FATAL: CN source transfer is full-only. Pass --full." >&2
  exit 2
fi

TAG="$(git rev-parse HEAD)"
ECS_ID="${CN_BUILD_ECS_ID:-i-bp11r90r4g91u39iimnx}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_github}"
NAMESPACE="${CN_NAMESPACE:-fizzdragon}"
RELEASE="${CN_RELEASE:-fizzdragon}"
CHART="$ROOT/deploy/helm/fizzdragon"
CN_VALUES="$CHART/values.cn-prod.yaml"
LIVE_ORIGIN="https://fizzstudio.fizzspace.cn"
SSH=(ssh -i "$DEPLOY_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
SCP=(scp -i "$DEPLOY_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

contains_service() {
  local wanted="$1" service
  for service in "${SERVICES[@]}"; do [ "$service" = "$wanted" ] && return 0; done
  return 1
}

chart_fingerprint() {
  (
    cd "$CHART"
    find Chart.yaml values.yaml values.cn-prod.yaml templates -type f -print0 \
      | sort -z \
      | xargs -0 shasum -a 256
  ) | shasum -a 256 | awk '{print $1}'
}

if [ "$PHASE" = build ] || [ "$PHASE" = all ]; then
  "$ROOT/deploy/cn-preflight.sh" --phase build "${SERVICES[@]}"
fi
if [ "$PHASE" = deploy ] || [ "$PHASE" = all ]; then
  "$ROOT/deploy/cn-preflight.sh" --phase deploy "${SERVICES[@]}"
fi

TMP_DIR=""
ECS_IP=""
MANIFEST_FILE=""
RELAY_KEY=""
cleanup() {
  [ -z "$RELAY_KEY" ] || node "$ROOT/deploy/cn-source-relay.cjs" delete "$RELAY_KEY" >/dev/null 2>&1 || true
  [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"
  [ -z "$MANIFEST_FILE" ] || rm -f "$MANIFEST_FILE"
  rm -f /tmp/cn-git-archive.tar /tmp/cn-src.tar.gz /tmp/cn-build-services.log
  if [ -n "$ECS_IP" ] && [ "${KEEP_CN_BUILD_ECS:-0}" != 1 ]; then
    echo "==> stopping CN build ECS"
    aliyun ecs StopInstance --InstanceId "$ECS_ID" --StoppedMode StopCharging --profile default >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ "$PHASE" = build ] || [ "$PHASE" = all ]; then
  echo "==> start CN build ECS (tag=$TAG services=${SERVICES[*]})"
  aliyun ecs StartInstance --InstanceId "$ECS_ID" --profile default >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do
    state="$(aliyun ecs DescribeInstanceStatus --InstanceId.1 "$ECS_ID" --RegionId cn-hangzhou --profile default 2>/dev/null \
      | python3 -c 'import json,sys; a=json.load(sys.stdin).get("InstanceStatuses",{}).get("InstanceStatus",[]); print(a[0]["Status"] if a else "")')"
    [ "$state" = Running ] && break
    sleep 5
  done
  [ "${state:-}" = Running ] || { echo "FATAL: build ECS did not become Running" >&2; exit 1; }
  ECS_IP="$(aliyun ecs DescribeInstances --InstanceIds "['$ECS_ID']" --RegionId cn-hangzhou --profile default 2>/dev/null \
    | python3 -c 'import json,sys; i=json.load(sys.stdin)["Instances"]["Instance"][0]; e=i.get("EipAddress",{}).get("IpAddress",""); p=i.get("PublicIpAddress",{}).get("IpAddress",[]); print(e or (p[0] if p else ""))')"
  [ -n "$ECS_IP" ] || { echo "FATAL: no build ECS public IP" >&2; exit 1; }
  for _ in $(seq 1 12); do
    "${SSH[@]}" "root@$ECS_IP" true >/dev/null 2>&1 && break
    sleep 5
  done
  "${SSH[@]}" "root@$ECS_IP" true >/dev/null

  echo "==> full secret-free source sync"
  TMP_DIR="$(mktemp -d)"
  GIT_ARCHIVE="/tmp/cn-git-archive.tar"
  git archive HEAD -o "$GIT_ARCHIVE"
  tar -xf "$GIT_ARCHIVE" -C "$TMP_DIR"
  printf '%s\n' "$TAG" > "$TMP_DIR/.fizzdragon-source-revision"
  find "$TMP_DIR" -type f -name '.env*' ! -path '*/apps/web/.env.production.cn' -delete
  sed -i'' -e "s#^NEXT_PUBLIC_PARENT_ORIGIN=.*#NEXT_PUBLIC_PARENT_ORIGIN=$LIVE_ORIGIN#" "$TMP_DIR/apps/web/.env.production.cn"
  # macOS bsdtar otherwise attaches AppleDouble/provenance xattrs to every
  # archived file, producing thousands of irrelevant warnings on Linux tar.
  COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/cn-src.tar.gz -C "$TMP_DIR" .
  archive_sha="$(shasum -a 256 /tmp/cn-src.tar.gz | awk '{print $1}')"
  # Direct scp from outside China crawls (single-digit KB/s on bad days); the
  # private relay bucket is reached over OSS acceleration and read in-region.
  RELAY_KEY="src/${TAG}-$(openssl rand -hex 8).tar.gz"
  relay_url="$(node "$ROOT/deploy/cn-source-relay.cjs" put /tmp/cn-src.tar.gz "$RELAY_KEY")"
  printf '%s\n' "$relay_url" | "${SSH[@]}" "root@$ECS_IP" \
    'set -e; read -r url; rm -f /root/src.tar.gz; curl -fsS --retry 3 --max-time 900 -o /root/src.tar.gz "$url"'
  unset relay_url
  node "$ROOT/deploy/cn-source-relay.cjs" delete "$RELAY_KEY"
  RELAY_KEY=""
  remote_sha="$("${SSH[@]}" "root@$ECS_IP" 'sha256sum /root/src.tar.gz | awk '\''{print $1}'\''' 2>/dev/null)"
  [ "$remote_sha" = "$archive_sha" ] || { echo "FATAL: source archive checksum mismatch" >&2; exit 1; }

  echo "==> in-region build and push"
  "${SCP[@]}" "$HOME/.fizzdragon-cn/acr-username.txt" "root@$ECS_IP:/root/.acr_user"
  "${SCP[@]}" "$HOME/.fizzdragon-cn/acr-password.txt" "root@$ECS_IP:/root/.acr_token"
  "${SCP[@]}" "$ROOT/deploy/cn-remote-build-services.sh" "root@$ECS_IP:/root/cn-remote-build-services.sh"
  "${SSH[@]}" "root@$ECS_IP" "sed -i 's/\r$//' /root/cn-remote-build-services.sh && TAG='$TAG' EXPECTED_REVISION='$TAG' SERVICES='${SERVICES[*]}' bash /root/cn-remote-build-services.sh" \
    | tee /tmp/cn-build-services.log
  echo "==> images built and pushed; no ACK workload changed"
fi

if [ "$PHASE" = deploy ] || [ "$PHASE" = all ]; then
  export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-fizzdragon-cn}"
  fingerprint="$(chart_fingerprint)"
  live_fingerprint="$(helm get values "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cnRelease",{}).get("chartFingerprint",""))' 2>/dev/null || true)"

  live_tag() {
    local deployment="$1" image
    image="$(kubectl get deploy "$deployment" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].image}')"
    printf '%s\n' "${image##*:}"
  }
  web_tag="$(contains_service web && printf '%s' "$TAG" || live_tag fizzdragon-web)"
  studio_tag="$(contains_service studio && printf '%s' "$TAG" || live_tag fizzdragon-studio)"
  admin_tag="$(contains_service admin-ui && printf '%s' "$TAG" || live_tag fizzdragon-admin-ui)"
  server_tag="$(contains_service server && printf '%s' "$TAG" || live_tag fizzdragon-server)"
  agent_os_tag="$(contains_service agent-os && printf '%s' "$TAG" || live_tag fizzdragon-agent-os)"

  helm_sets=(
    --set-string "cnRelease.chartFingerprint=$fingerprint"
    --set-string "web.image.tag=$web_tag"
    --set-string "studio.image.tag=$studio_tag"
    --set-string "adminUi.image.tag=$admin_tag"
    --set-string "server.image.tag=$server_tag"
    --set-string "agentOs.image.tag=$agent_os_tag"
    --set 'server.migrationJob.enabled=false'
  )
  if contains_service agent; then
    helm_sets+=(--set-string "agent.image.tag=$TAG" --set-string "agentWorker.image.tag=$TAG")
  fi

  echo "==> server-side manifest diff (read-only)"
  MANIFEST_FILE="$(mktemp)"
  helm template "$RELEASE" "$CHART" \
    -f "$CHART/values.yaml" \
    -f "$CN_VALUES" \
    "${helm_sets[@]}" \
    --namespace "$NAMESPACE" > "$MANIFEST_FILE"
  if kubectl diff -n "$NAMESPACE" -f "$MANIFEST_FILE"; then
    diff_status=0
  else
    diff_status=$?
  fi
  [ "$diff_status" -le 1 ] || { echo "FATAL: kubectl diff failed" >&2; exit 1; }

  if [ "$live_fingerprint" != "$fingerprint" ] && [ "$ALLOW_CHART_UPDATE" -ne 1 ]; then
    echo "FATAL: live CN chart/config fingerprint differs from this checkout." >&2
    echo "Review the manifest diff above and rerun with --allow-chart-update; Helm updates the whole release." >&2
    exit 1
  fi

  echo "==> atomic ACK Helm upgrade (services=${SERVICES[*]} tag=$TAG)"
  helm upgrade "$RELEASE" "$CHART" \
    -f "$CHART/values.yaml" \
    -f "$CN_VALUES" \
    "${helm_sets[@]}" \
    --namespace "$NAMESPACE" \
    --atomic --wait --timeout 15m --history-max 20 --force-conflicts

  for service in "${SERVICES[@]}"; do
    case "$service" in
      admin-ui) deployment=fizzdragon-admin-ui ;;
      *) deployment="fizzdragon-$service" ;;
    esac
    kubectl rollout status "deploy/$deployment" -n "$NAMESPACE" --timeout=5m
  done
  curl --fail --silent --show-error --max-time 20 https://fizzstudio.fizzspace.cn/aurora/ready >/dev/null
  echo "DONE: CN release is healthy at $TAG"
fi
