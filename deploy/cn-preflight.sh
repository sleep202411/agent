#!/usr/bin/env bash
# Read-only release gate for the mainland-China ACK cell.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHART="$ROOT/deploy/helm/fizzdragon"
CN_VALUES="$CHART/values.cn-prod.yaml"
NAMESPACE="${CN_NAMESPACE:-fizzdragon}"
RELEASE="${CN_RELEASE:-fizzdragon}"
ECS_ID="${CN_BUILD_ECS_ID:-i-bp11r90r4g91u39iimnx}"
PHASE=deploy
SERVICES=()
TARGET=HEAD
SNAPSHOT=""
trap '[ -z "$SNAPSHOT" ] || rm -rf "$SNAPSHOT"' EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag) TARGET="${2:?--tag requires a Git SHA}"; shift 2 ;;
    --phase)
      PHASE="${2:?--phase requires build, deploy, or migration}"
      shift 2
      ;;
    --phase=*) PHASE="${1#*=}"; shift ;;
    --) shift; SERVICES+=("$@"); break ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) SERVICES+=("$1"); shift ;;
  esac
done

case "$PHASE" in build|deploy|migration) ;; *) echo "Invalid phase: $PHASE" >&2; exit 2 ;; esac
[ "${#SERVICES[@]}" -gt 0 ] || SERVICES=(server studio web admin-ui)

failures=0
warnings=0
ok() { printf '  OK   %s\n' "$*"; }
warn() { printf '  WARN %s\n' "$*" >&2; warnings=$((warnings + 1)); }
fail() { printf '  FAIL %s\n' "$*" >&2; failures=$((failures + 1)); }
has_service() {
  local wanted="$1" service
  for service in "${SERVICES[@]}"; do [ "$service" = "$wanted" ] && return 0; done
  return 1
}
need_command() {
  command -v "$1" >/dev/null 2>&1 && ok "$1 available" || fail "$1 is required"
}
secret_has_key() {
  local name="$1" key="$2" present
  # Return presence only; keep the encoded credential out of shell variables.
  present="$(kubectl get secret "$name" -n "$NAMESPACE" -o "go-template={{if index .data \"$key\"}}present{{end}}" 2>/dev/null || true)"
  if [ "$present" = present ]; then
    ok "Secret $name contains $key"
  else
    fail "Secret $name is missing non-empty key $key"
  fi
}

echo "==> CN preflight (phase=$PHASE services=${SERVICES[*]})"

for command in git python3 node openssl helm kubectl aliyun ssh scp tar shasum curl; do
  need_command "$command"
done

branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ "$branch" = main ]; then
  ok "production branch is main"
elif [ "$branch" = HEAD ] && git -C "$ROOT" merge-base --is-ancestor HEAD main; then
  ok "isolated production checkout belongs to main"
elif [ "${FORCE:-0}" = 1 ]; then
  warn "branch is $branch (FORCE=1 override)"
else
  fail "production releases must run from main (current: $branch)"
fi

if git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet; then
  ok "tracked worktree is clean"
elif [ "${ALLOW_DIRTY:-0}" = 1 ]; then
  warn "tracked worktree is dirty (ALLOW_DIRTY=1 override)"
else
  fail "tracked worktree is dirty"
fi

TARGET="$(git -C "$ROOT" rev-parse --verify "$TARGET^{commit}")" || exit 2
{ git -C "$ROOT" merge-base --is-ancestor "$TARGET" main || git -C "$ROOT" merge-base --is-ancestor "$TARGET" origin/main; } || { fail "release revision must belong to main"; exit 2; }
SNAPSHOT="$(mktemp -d)" || exit 1
git -C "$ROOT" archive "$TARGET" deploy/helm/fizzdragon | tar -x -C "$SNAPSHOT" || exit 1
CHART="$SNAPSHOT/deploy/helm/fizzdragon"
CN_VALUES="$CHART/values.cn-prod.yaml"

if helm lint "$CHART" -f "$CHART/values.yaml" -f "$CN_VALUES" >/dev/null 2>&1; then
  ok "CN Helm chart lints"
else
  fail "CN Helm chart lint failed"
fi
if helm template "$RELEASE" "$CHART" -n "$NAMESPACE" \
  -f "$CHART/values.yaml" -f "$CN_VALUES" >/dev/null 2>&1; then
  ok "CN Helm chart renders"
else
  fail "CN Helm chart render failed"
fi

if has_service app-story-agent; then
  if helm template "$RELEASE" "$CHART" -n "$NAMESPACE" \
    -f "$CHART/values.yaml" -f "$CN_VALUES" \
    --set-string "appStoryAgent.image.tag=$(git -C "$ROOT" rev-parse "$TARGET")" \
    --show-only templates/app-story-agent.yaml >/dev/null 2>&1; then
    ok "App Story is explicitly enabled with regional configuration"
  else
    fail "App Story requires approved appStoryAgent settings in CN values before release"
  fi
fi

if [ "$PHASE" = build ]; then
  [ -s "${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_github}" ] && ok "CN build SSH key exists" || fail "CN build SSH key is missing"
  if python3 "$ROOT/deploy/cn_build_credentials.py"; then
    ok "CN ACR can issue fresh temporary credentials"
  else
    fail "CN ACR temporary credential acquisition failed"
  fi
  if aliyun ecs DescribeInstances --InstanceIds "['$ECS_ID']" \
    --RegionId cn-hangzhou --profile default >/dev/null 2>&1; then
    ok "CN build ECS is visible"
  else
    fail "cannot read CN build ECS"
  fi
else
  export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-fizzdragon-cn}"
  [ -s "$KUBECONFIG" ] && ok "CN kubeconfig exists" || fail "CN kubeconfig is missing"
  if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    ok "ACK namespace $NAMESPACE is reachable"
  else
    fail "cannot reach ACK namespace $NAMESPACE"
  fi
  status="$(helm status "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("info",{}).get("status",""))' 2>/dev/null || true)"
  [ "$status" = deployed ] && ok "Helm release $RELEASE is deployed" || fail "Helm release $RELEASE status is ${status:-unavailable}"

  secret_has_key fizzdragon-secrets DATABASE_URL
  [ "$PHASE" = migration ] || secret_has_key fizzdragon-secrets REDIS_URL
  if has_service server && [ "$PHASE" = deploy ]; then
    secret_has_key fizzdragon-server-secrets JAVA_ADMIN_API_TOKEN
    secret_has_key fizzdragon-server-secrets CREATOR_PAYOUT_DETAILS_KEY
    secret_has_key fizzdragon-server-secrets REALTIME_WS_SECRET
    secret_has_key fizzdragon-server-secrets ABLY_API_KEY
    # These are required by the selected CN write path and enabled providers.
    for key in OSS_BUCKET OSS_REGION OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET; do
      secret_has_key fizzdragon-secrets "$key"
    done
    secret_has_key fizzdragon-server-secrets FAL_API_KEY
    secret_has_key fizzdragon-server-secrets BAILIAN_API_KEY
    secret_has_key fizzdragon-server-secrets MINIMAX_API_KEY
  fi
  if has_service game-agent; then
    secret_has_key fizzdragon-game-agent-provider GAME_AGENT_OPENAI_API_KEY
    secret_has_key fizzdragon-game-agent-internal GAME_AGENT_INTERNAL_TOKEN
  fi
  if has_service admin-ui; then
    secret_has_key fizzdragon-adminui-secrets JAVA_ADMIN_API_TOKEN
  fi

  if has_service agent; then
    fail "legacy StoryOS is frozen and quarantined; normal CN releases must not select agent"
  fi

  unhealthy="$(kubectl get deploy fizzdragon-agent -n "$NAMESPACE" -o jsonpath='{range .status.conditions[?(@.type=="Progressing")]}{.status}{"|"}{.reason}{end}' 2>/dev/null || true)"
  if [ "$unhealthy" = "False|ProgressDeadlineExceeded" ]; then
    warn "legacy Agent desired rollout is degraded; the CN chart pins the last verified API/worker tags to repair it on the next chart update"
  fi

  if has_service server && [ "$PHASE" = deploy ]; then
    live_server_tag="$(kubectl get deploy fizzdragon-server -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | awk -F: '{print $NF}')"
    if [ -n "$live_server_tag" ] && git -C "$ROOT" cat-file -e "$live_server_tag^{commit}" 2>/dev/null; then
      migration_count="$(git -C "$ROOT" diff --name-only "$live_server_tag".."$TARGET" -- apps/server/prisma/migrations | wc -l | tr -d ' ')"
      if [ "$migration_count" -gt 0 ]; then
        target_revision="$TARGET"
        migration_job="$(printf '%s-db-migrate-%s' "$RELEASE" "$target_revision" | cut -c1-63 | sed 's/-$//')"
        migration_complete="$(kubectl get job "$migration_job" -n "$NAMESPACE" -o jsonpath='{range .status.conditions[?(@.type=="Complete")]}{.status}{end}' 2>/dev/null || true)"
        if [ "$migration_complete" = True ]; then
          backup_id="$(kubectl get job "$migration_job" -n "$NAMESPACE" -o 'jsonpath={.metadata.annotations.fizzdragon\.com/rds-backup-id}' 2>/dev/null || true)"
          if [ -n "$backup_id" ]; then
            ok "$migration_count pending Prisma files were applied by completed Job $migration_job (backup $backup_id)"
          else
            fail "completed migration Job $migration_job has no RDS backup audit annotation"
          fi
        else
          fail "$migration_count Prisma migration files are pending; run the approved CN migration Job for $target_revision before deploying server"
        fi
      else
        ok "no Prisma migrations pending for server"
      fi
    else
      fail "cannot resolve live server tag ${live_server_tag:-unknown} to audit migrations"
    fi
  fi
fi

echo "==> preflight result: failures=$failures warnings=$warnings"
[ "$failures" -eq 0 ]
