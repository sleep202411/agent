#!/usr/bin/env bash
# Mainland-China release path:
#   full git archive -> private OSS relay (build-relay.fizzspace.cn) -> cn-hangzhou
#   build ECS -> CN ACR -> ACK Helm release.
# Helm owns the whole release, so a chart/config change requires the explicit
# --allow-chart-update acknowledgement even for a one-service image release.
# Parse the procedure before long-running commands so an edited script cannot
# resume at a stale byte offset after a build finishes.
main() {
set -euo pipefail
RELEASE_ARGS=("$@")

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PHASE=all
FULL=0
ALLOW_CHART_UPDATE=0
REQUESTED=()
PINNED_TAG=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag) PINNED_TAG="${2:?--tag requires a Git SHA}"; shift 2 ;;
    --full) FULL=1; shift ;;
    --build-only) PHASE=build; shift ;;
    --deploy-only) PHASE=deploy; shift ;;
    --allow-chart-update) ALLOW_CHART_UPDATE=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--tag <git-sha>] [--full] [--build-only|--deploy-only] [--allow-chart-update] <service...|platform>"
      echo "Services: web studio admin-ui server agent-os game-agent; legacy agent requires ALLOW_LEGACY_AGENT_DEPLOY=1"
      exit 0
      ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) REQUESTED+=("$1"); shift ;;
  esac
done

[ "${#REQUESTED[@]}" -gt 0 ] || { echo "No services selected" >&2; exit 2; }
if [ "${REQUESTED[0]}" = platform ] || [ "${REQUESTED[0]}" = all ]; then
  SERVICES=(server studio web admin-ui agent-os game-agent)
else
  SERVICES=("${REQUESTED[@]}")
fi

for service in "${SERVICES[@]}"; do
  case "$service" in
    web|studio|admin-ui|server|agent-os|game-agent) ;;
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

# Serialize operators before source snapshots, image lookup or remote mutations.
if [ -z "${FD_REGIONAL_LOCK_CN:-}" ]; then
  if [ "$PHASE" != deploy ]; then
    python3 "$ROOT/deploy/cn_ssh_access.py" "${CN_BUILD_ECS_ID:-i-bp11r90r4g91u39iimnx}" --required
  fi
  exec python3 "$ROOT/deploy/release_lock.py" cn -- bash "$ROOT/deploy/deploy-cn-services.sh" "${RELEASE_ARGS[@]}"
fi
python3 "$ROOT/deploy/release_lock.py" cn -- true

TAG="$(git rev-parse --verify "${PINNED_TAG:-HEAD}^{commit}")"
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || exit 2
{ git merge-base --is-ancestor "$TAG" main || git merge-base --is-ancestor "$TAG" origin/main; } || { echo "FATAL: release revision must belong to main" >&2; exit 2; }
BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
SNAPSHOT_READY=0
assert_checkout_unchanged() {
  [ "$SNAPSHOT_READY" = 1 ] && return 0
  if { [ -z "$PINNED_TAG" ] && [ "$(git rev-parse HEAD)" != "$TAG" ]; } || \
     [ "$(git symbolic-ref --quiet --short HEAD || true)" != "$BRANCH" ] || \
     ! git diff --quiet || ! git diff --cached --quiet; then
    echo "FATAL: checkout changed; preserve local work, reconcile and rerun the CN release." >&2
    exit 1
  fi
}
ECS_ID="${CN_BUILD_ECS_ID:-i-bp11r90r4g91u39iimnx}"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_github}"
NAMESPACE="${CN_NAMESPACE:-fizzdragon}"
RELEASE="${CN_RELEASE:-fizzdragon}"
CHART="$ROOT/deploy/helm/fizzdragon"
CN_VALUES="$CHART/values.cn-prod.yaml"
LIVE_ORIGIN="https://fizzstudio.fizzspace.cn"
SSH=(ssh -i "$DEPLOY_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
SCP=(scp -i "$DEPLOY_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

# Only retry idempotent preparation, never the remote build command.
retry_transfer() {
  local input="$1" attempt status
  shift
  for attempt in 1 2 3; do
    if "$@" < "$input"; then return 0; else status=$?; fi
    [ "$status" = 255 ] || return "$status"
    [ "$attempt" != 3 ] || return "$status"
    echo "==> CN SSH transfer interrupted; rechecking access before retry $((attempt + 1))/3" >&2
    python3 "$TOOLS_ROOT/deploy/cn_ssh_access.py" "$ECS_ID" --required >&2 || return 2
    sleep 5
  done
}

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
  "$ROOT/deploy/cn-preflight.sh" --phase build --tag "$TAG" "${SERVICES[@]}"
fi
if [ "$PHASE" = deploy ] || [ "$PHASE" = all ]; then
  "$ROOT/deploy/cn-preflight.sh" --phase deploy --tag "$TAG" "${SERVICES[@]}"
fi

RELEASE_DIR=""
TMP_DIR=""
ECS_IP=""
MANIFEST_FILE=""
RELAY_KEY=""
SSH_SOCKET_DIR=""
cleanup() {
  if [ -n "$SSH_SOCKET_DIR" ]; then
    "${SSH[@]}" -O exit "root@$ECS_IP" >/dev/null 2>&1 || true
    rm -rf "$SSH_SOCKET_DIR"
  fi
  [ -z "$RELAY_KEY" ] || node "${TOOLS_ROOT:-$ROOT}/deploy/cn-source-relay.cjs" delete "$RELAY_KEY" >/dev/null 2>&1 || true
  [ -z "$RELEASE_DIR" ] || rm -rf "$RELEASE_DIR"
  [ -z "$MANIFEST_FILE" ] || rm -f "$MANIFEST_FILE"
  if [ -n "$ECS_IP" ] && [ "${KEEP_CN_BUILD_ECS:-0}" != 1 ]; then
    echo "==> stopping CN build ECS"
    aliyun ecs StopInstance --InstanceId "$ECS_ID" --StoppedMode StopCharging --RegionId cn-hangzhou --profile default >/dev/null || echo "WARNING: could not stop CN build ECS $ECS_ID" >&2
  fi
}
trap cleanup EXIT

assert_checkout_unchanged
RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fizz-cn-release.XXXXXX")"
TMP_DIR="$RELEASE_DIR/source"
mkdir "$TMP_DIR"
GIT_ARCHIVE="$RELEASE_DIR/source.tar"
SOURCE_ARCHIVE="$RELEASE_DIR/source.tar.gz"
git archive "$TAG" -o "$GIT_ARCHIVE"
tar -xf "$GIT_ARCHIVE" -C "$TMP_DIR"
# Build inputs, the ECS build script and Helm chart all belong to this revision.
CHART="$TMP_DIR/deploy/helm/fizzdragon"
CN_VALUES="$CHART/values.cn-prod.yaml"
printf '%s\n' "$TAG" > "$TMP_DIR/.fizzdragon-source-revision"
# Freeze release helpers as well as application/chart inputs before remote work.
TOOLS_ROOT="$RELEASE_DIR/tooling"
mkdir "$TOOLS_ROOT"
git archive HEAD deploy | tar -x -C "$TOOLS_ROOT"
[ ! -d "$ROOT/node_modules" ] || ln -s "$ROOT/node_modules" "$TOOLS_ROOT/node_modules"
SNAPSHOT_READY=1

# Direct callers get the same cross-operator reuse policy as the coordinator.
# A coordinated build already contains only services missing from its saved plan.
BUILD_SERVICES=()
if [ "${CN_RELEASE_BUILD_PLANNED:-0}" = 1 ]; then
  BUILD_SERVICES=("${SERVICES[@]}")
elif [ "${CN_RELEASE_COORDINATED:-0}" != 1 ]; then
  for service in "${SERVICES[@]}"; do
    reuse="$(python3 "$TOOLS_ROOT/deploy/release_images.py" cn "$ROOT" "$TAG" "$service")"
    if [ "$reuse" = BUILD ]; then
      BUILD_SERVICES+=("$service")
    else
      read -r reuse_tag reuse_digest <<< "$reuse"
      export CN_RELEASE_IMAGE_TAGS="$(python3 -c 'import os,json,sys; d=json.loads(os.environ.get("CN_RELEASE_IMAGE_TAGS", "{}")); d[sys.argv[1]]=sys.argv[2]; print(json.dumps(d))' "$service" "$reuse_tag")"
      export CN_RELEASE_IMAGE_DIGESTS="$(python3 -c 'import os,json,sys; d=json.loads(os.environ.get("CN_RELEASE_IMAGE_DIGESTS", "{}")); d[sys.argv[1]]=sys.argv[2]; print(json.dumps(d))' "$service" "$reuse_digest")"
      echo "==> reusing verified CN $service:$reuse_tag ($reuse_digest); no build"
    fi
  done
fi

if { [ "$PHASE" = build ] || [ "$PHASE" = all ]; } && [ "${#BUILD_SERVICES[@]}" -gt 0 ]; then
  python3 "$TOOLS_ROOT/deploy/cn_ssh_access.py" "$ECS_ID"
  echo "==> start CN build ECS (tag=$TAG services=${BUILD_SERVICES[*]})"
  start_requested=0
  for _ in $(seq 1 40); do
    state="$(aliyun ecs DescribeInstanceStatus --InstanceId.1 "$ECS_ID" --RegionId cn-hangzhou --profile default \
      | python3 -c 'import json,sys; a=json.load(sys.stdin).get("InstanceStatuses",{}).get("InstanceStatus",[]); print(a[0]["Status"] if a else "")')"
    case "$state" in
      Running) break ;;
      Stopped)
        if [ "$start_requested" = 0 ]; then
          # StopInstance is asynchronous: a previous cycle may still be stopping.
          # Start only after Stopped, and never hide a rejected start request.
          aliyun ecs StartInstance --InstanceId "$ECS_ID" --RegionId cn-hangzhou --profile default >/dev/null
          start_requested=1
        fi
        ;;
      Starting|Stopping) ;;
      *) echo "FATAL: unexpected build ECS state: $state" >&2; exit 1 ;;
    esac
    echo "==> waiting for CN build ECS (state=$state)"
    sleep 5
  done
  [ "${state:-}" = Running ] || { echo "FATAL: build ECS did not become Running (last state=$state, start requested=$start_requested)" >&2; exit 1; }
  ECS_IP="$(aliyun ecs DescribeInstances --InstanceIds "['$ECS_ID']" --RegionId cn-hangzhou --profile default 2>/dev/null \
    | python3 -c 'import json,sys; i=json.load(sys.stdin)["Instances"]["Instance"][0]; e=i.get("EipAddress",{}).get("IpAddress",""); p=i.get("PublicIpAddress",{}).get("IpAddress",[]); print(e or (p[0] if p else ""))')"
  [ -n "$ECS_IP" ] || { echo "FATAL: no build ECS public IP" >&2; exit 1; }
  # Use a short private socket path (macOS Unix sockets have a small path limit).
  SSH_SOCKET_DIR="$(mktemp -d /tmp/fd-cn-ssh.XXXXXX)"
  SSH+=(-o ControlMaster=auto -o ControlPersist=600 -o "ControlPath=$SSH_SOCKET_DIR/socket")
  SCP+=(-o ControlMaster=auto -o ControlPersist=600 -o "ControlPath=$SSH_SOCKET_DIR/socket")
  for _ in $(seq 1 12); do
    "${SSH[@]}" "root@$ECS_IP" true >/dev/null 2>&1 && break
    sleep 5
  done
  retry_transfer /dev/null "${SSH[@]}" "root@$ECS_IP" true >/dev/null

  echo "==> full secret-free source sync"
  find "$TMP_DIR" -type f -name '.env*' ! -path '*/apps/web/.env.production.cn' -delete
  sed -i'' -e "s#^NEXT_PUBLIC_PARENT_ORIGIN=.*#NEXT_PUBLIC_PARENT_ORIGIN=$LIVE_ORIGIN#" "$TMP_DIR/apps/web/.env.production.cn"
  # macOS bsdtar otherwise attaches AppleDouble/provenance xattrs to every
  # archived file, producing thousands of irrelevant warnings on Linux tar.
  COPYFILE_DISABLE=1 tar --no-xattrs -czf "$SOURCE_ARCHIVE" -C "$TMP_DIR" .
  archive_sha="$(shasum -a 256 "$SOURCE_ARCHIVE" | awk '{print $1}')"
  # Direct scp from outside China crawls (single-digit KB/s on bad days); the
  # private relay bucket is reached over OSS acceleration and read in-region.
  RELAY_KEY="src/${TAG}-$(openssl rand -hex 8).tar.gz"
  relay_url="$(node "${TOOLS_ROOT:-$ROOT}/deploy/cn-source-relay.cjs" put "$SOURCE_ARCHIVE" "$RELAY_KEY")"
  (umask 077; printf '%s\n' "$relay_url" > "$RELEASE_DIR/relay-url")
  unset relay_url
  retry_transfer "$RELEASE_DIR/relay-url" "${SSH[@]}" "root@$ECS_IP" \
    'set -e; read -r url; tmp=$(mktemp /root/src-download.XXXXXX); trap "rm -f $tmp" EXIT; curl -fsS --retry 3 --max-time 900 -o "$tmp" "$url"; mv "$tmp" /root/src.tar.gz'
  rm -f "$RELEASE_DIR/relay-url"
  node "${TOOLS_ROOT:-$ROOT}/deploy/cn-source-relay.cjs" delete "$RELAY_KEY"
  RELAY_KEY=""
  remote_sha="$(retry_transfer /dev/null "${SSH[@]}" "root@$ECS_IP" 'sha256sum /root/src.tar.gz | awk '\''{print $1}'\''' 2>/dev/null)"
  [ "$remote_sha" = "$archive_sha" ] || { echo "FATAL: source archive checksum mismatch" >&2; exit 1; }

  echo "==> in-region build and push"
  # ACR tokens last about one hour. Fetch after source transfer, not from a
  # persistent file that can silently expire between release attempts.
  python3 "$TOOLS_ROOT/deploy/cn_build_credentials.py" --output-dir "$RELEASE_DIR/credentials"
  retry_transfer /dev/null "${SCP[@]}" "$RELEASE_DIR/credentials/acr-username.txt" "root@$ECS_IP:/root/.acr_user"
  retry_transfer /dev/null "${SCP[@]}" "$RELEASE_DIR/credentials/acr-password.txt" "root@$ECS_IP:/root/.acr_token"
  retry_transfer /dev/null "${SCP[@]}" "$TMP_DIR/deploy/cn-remote-build-services.sh" "root@$ECS_IP:/root/cn-remote-build-services.sh"
  build_status=0
  "${SSH[@]}" "root@$ECS_IP" "sed -i 's/\r$//' /root/cn-remote-build-services.sh && TAG='$TAG' EXPECTED_REVISION='$TAG' SERVICES='${BUILD_SERVICES[*]}' bash /root/cn-remote-build-services.sh" \
    | tee "$RELEASE_DIR/build.log" || build_status=$?
  if [ "$build_status" -ne 0 ]; then
    if [ "$build_status" -eq 255 ]; then
      python3 "$TOOLS_ROOT/deploy/cn_ssh_access.py" "$ECS_ID" || true
    fi
    exit "$build_status"
  fi
  echo "==> images built and pushed; no ACK workload changed"
fi

if [ "$PHASE" = deploy ] || [ "$PHASE" = all ]; then
  assert_checkout_unchanged
  # The coordinator may retain older per-service tags with identical build inputs.
  image_tag() {
    python3 -c 'import json,os,sys; print(json.loads(os.environ.get("CN_RELEASE_IMAGE_TAGS", "{}" )).get(sys.argv[1], sys.argv[2]))' "$1" "$TAG"
  }
  for service in "${SERVICES[@]}"; do
    selected_tag="$(image_tag "$service")"
    python3 "$TOOLS_ROOT/deploy/verify_release_image.py" "$ROOT" "$TAG" "$service" "$selected_tag"
  done
  export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-fizzdragon-cn}"
  fingerprint="$(chart_fingerprint)"
  live_fingerprint="$(helm get values "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cnRelease",{}).get("chartFingerprint",""))' 2>/dev/null || true)"

  live_tag() {
    local deployment="$1" image
    image="$(kubectl get deploy "$deployment" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].image}')"
    printf '%s\n' "${image##*:}"
  }
  web_tag="$(contains_service web && image_tag web || live_tag fizzdragon-web)"
  studio_tag="$(contains_service studio && image_tag studio || live_tag fizzdragon-studio)"
  admin_tag="$(contains_service admin-ui && image_tag admin-ui || live_tag fizzdragon-admin-ui)"
  server_tag="$(contains_service server && image_tag server || live_tag fizzdragon-server)"
  agent_os_tag="$(contains_service agent-os && image_tag agent-os || live_tag fizzdragon-agent-os)"

  game_agent_tag="$(contains_service game-agent && image_tag game-agent || live_tag fizzdragon-game-agent)"

  helm_sets=(
    --set-string "cnRelease.chartFingerprint=$fingerprint"
    --set-string "web.image.tag=$web_tag"
    --set-string "studio.image.tag=$studio_tag"
    --set-string "adminUi.image.tag=$admin_tag"
    --set-string "server.image.tag=$server_tag"
    --set-string "agentOs.image.tag=$agent_os_tag"
    --set-string "gameAgent.image.tag=$game_agent_tag"
    --set 'server.migrationJob.enabled=false'
  )
  if contains_service agent; then
    helm_sets+=(--set-string "agent.image.tag=$(image_tag agent)" --set-string "agentWorker.image.tag=$(image_tag agent)")
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

  assert_checkout_unchanged
  if [ "${CN_RELEASE_COORDINATED:-0}" = 1 ]; then
    candidate="$(python3 "$TOOLS_ROOT/deploy/release_revision.py" "$ROOT" "$TAG" main --cn)"
    [ "$candidate" = "$TAG" ] || exit 75
  fi
  if [ "$diff_status" = 0 ]; then
    echo "==> selected CN images and chart already applied; no Helm upgrade"
  else
  echo "==> atomic ACK Helm upgrade (services=${SERVICES[*]} tag=$TAG)"
  helm upgrade "$RELEASE" "$CHART" \
    -f "$CHART/values.yaml" \
    -f "$CN_VALUES" \
    "${helm_sets[@]}" \
    --namespace "$NAMESPACE" \
    --atomic --wait --timeout 15m --history-max 20 --force-conflicts
  fi

  for service in "${SERVICES[@]}"; do
    case "$service" in
      admin-ui) deployment=fizzdragon-admin-ui ;;
      *) deployment="fizzdragon-$service" ;;
    esac
    kubectl rollout status "deploy/$deployment" -n "$NAMESPACE" --timeout=5m
  done
  curl --fail --silent --show-error --max-time 20 https://fizzstudio.fizzspace.cn/aurora/ready >/dev/null
  echo "DONE: selected CN services [${SERVICES[*]}] are healthy at $TAG"
fi

}
main "$@"; exit
