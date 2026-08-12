#!/usr/bin/env bash
# Explicit, one-shot Prisma migration Job for the CN production database.
# This script never runs as part of an ordinary server pod rollout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHART="$ROOT/deploy/helm/fizzdragon"
CN_VALUES="$CHART/values.cn-prod.yaml"
NAMESPACE="${CN_NAMESPACE:-fizzdragon}"
RELEASE="${CN_RELEASE:-fizzdragon}"
TAG="$(git -C "$ROOT" rev-parse HEAD)"
RENDER_ONLY=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?--tag requires an immutable image tag}"; shift 2 ;;
    --tag=*) TAG="${1#*=}"; shift ;;
    --render-only) RENDER_ONLY=1; shift ;;
    -h|--help)
      echo "Usage: CN_RDS_BACKUP_ID=<id> CONFIRM_CN_PROD_MIGRATION=YES $0 [--tag <git-sha>] [--render-only]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$TAG" in ''|latest|set-at-deploy) echo "FATAL: immutable server image tag required" >&2; exit 2 ;; esac

export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-fizzdragon-cn}"
"$ROOT/deploy/cn-preflight.sh" --phase migration server

job_name="fizzdragon-db-migrate-$TAG"
manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT

helm template "$RELEASE" "$CHART" \
  --namespace "$NAMESPACE" \
  -f "$CHART/values.yaml" \
  -f "$CN_VALUES" \
  --show-only templates/server-migration-job.yaml \
  --set-string "server.image.tag=$TAG" \
  --set 'server.migrationJob.enabled=true' \
  --set-string "server.migrationJob.revision=$TAG" \
  --set-string "server.migrationJob.backupId=${CN_RDS_BACKUP_ID:-render-only-unverified}" > "$manifest"

if [ "$RENDER_ONLY" -eq 1 ]; then
  cat "$manifest"
  exit 0
fi

[ "${CONFIRM_CN_PROD_MIGRATION:-}" = YES ] || {
  echo "FATAL: set CONFIRM_CN_PROD_MIGRATION=YES after reviewing the rendered Job" >&2
  exit 2
}
[ -n "${CN_RDS_BACKUP_ID:-}" ] || {
  echo "FATAL: CN_RDS_BACKUP_ID must identify the verified on-demand backup taken immediately before migration" >&2
  exit 2
}

echo "==> verifying recent manual RDS backup $CN_RDS_BACKUP_ID"
aliyun rds DescribeBackups \
  --DBInstanceId pgm-1ud5k5e8ed864ld6 \
  --BackupId "$CN_RDS_BACKUP_ID" \
  --RegionId cn-hangzhou \
  --profile default \
  | python3 -c '
import datetime as dt
import json
import sys

backup_id = sys.argv[1]
records = json.load(sys.stdin).get("Items", {}).get("Backup", [])
if len(records) != 1 or str(records[0].get("BackupId")) != backup_id:
    raise SystemExit(f"FATAL: RDS backup {backup_id} was not found")
backup = records[0]
if backup.get("BackupStatus") != "Success" or backup.get("IsAvail") != 1:
    raise SystemExit(f"FATAL: RDS backup {backup_id} is not successful and available")
if backup.get("BackupMode") != "Manual":
    raise SystemExit(f"FATAL: RDS backup {backup_id} is not an on-demand manual backup")
ended_at = backup["BackupEndTime"]
ended = dt.datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
age = (dt.datetime.now(dt.timezone.utc) - ended).total_seconds()
if age < 0 or age > 6 * 60 * 60:
    raise SystemExit(f"FATAL: RDS backup {backup_id} is older than 6 hours")
print(f"  verified manual backup {backup_id}, completed {ended_at}")
' "$CN_RDS_BACKUP_ID"

kubectl get job "$job_name" -n "$NAMESPACE" >/dev/null 2>&1 && {
  echo "FATAL: migration Job $job_name already exists; refusing to run the same release twice" >&2
  exit 1
}

echo "==> creating CN production migration Job $job_name (backup=$CN_RDS_BACKUP_ID)"
kubectl create -f "$manifest"
if ! kubectl wait --for=condition=complete "job/$job_name" -n "$NAMESPACE" --timeout=30m; then
  kubectl logs "job/$job_name" -n "$NAMESPACE" --all-containers=true || true
  exit 1
fi
kubectl logs "job/$job_name" -n "$NAMESPACE" --all-containers=true
echo "DONE: CN migrations completed for server image $TAG"
