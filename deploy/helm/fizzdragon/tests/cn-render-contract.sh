#!/usr/bin/env bash
# Render-level invariants for the mainland-China production overlay.
set -euo pipefail

CHART="$(cd "$(dirname "$0")/.." && pwd)"
CN_VALUES="$CHART/values.cn-prod.yaml"
REVISION=0123456789abcdef0123456789abcdef01234567
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "  ok — $*"; }

echo "CN render contract"
render="$(helm template fizzdragon "$CHART" -n fizzdragon -f "$CHART/values.yaml" -f "$CN_VALUES" \
  --set-string "web.image.tag=$REVISION" \
  --set-string "studio.image.tag=$REVISION" \
  --set-string "adminUi.image.tag=$REVISION" \
  --set-string "server.image.tag=$REVISION" \
  --set-string "agentOs.image.tag=$REVISION")"

grep -q 'name: AGENT_OS_ENABLED' <<<"$render" || fail "server must receive AGENT_OS_ENABLED"
grep -A 1 'name: AGENT_OS_ENABLED' <<<"$render" | grep -q 'value: "true"' || fail "Agent OS must be enabled on CN"
grep -q 'name: fizzdragon-agent-os-server-secrets' <<<"$render" || fail "Agent OS server Secret dependency is missing"
grep -q 'name: fizzdragon-agent-os$' <<<"$render" || fail "Agent OS workload is missing"
grep -q 'value: "https://dashscope.aliyuncs.com/compatible-mode/v1"' <<<"$render" || fail "Agent OS must use the mainland model endpoint"
ok "Agent OS is enabled with its scoped Secret and mainland model endpoint"

grep -q 'name: fizzdragon-temporal$' <<<"$render" && fail "Temporal must not render before CN infrastructure exists"
ok "Temporal is absent from CN"

grep -A 1 'name: MINIMAX_ENABLED' <<<"$render" | grep -q 'value: "true"' || fail "MiniMax must be enabled with its provisioned account"
ok "MiniMax is explicitly enabled"

server="$(helm template fizzdragon "$CHART" -n fizzdragon -f "$CHART/values.yaml" -f "$CN_VALUES" \
  -s templates/server.yaml --set-string "server.image.tag=$REVISION")"
grep -q 'name: db-migrate' <<<"$server" && fail "ordinary CN server rollout must not run migrations"
ok "ordinary server rollouts cannot run Prisma migrations"

grep -q 'fizzdragon-r2' <<<"$server" && fail "CN server must not reference the .com R2 Secret"
grep -q 'name: S3_ENDPOINT' <<<"$server" && fail "CN server must not inherit the .com R2 endpoint"
grep -q 'name: MEDIA_PUBLIC_BASE_URL_AZURE_BLOB' <<<"$server" && fail "CN server must not inherit the .com Azure media domain"
grep -q 'name: AXON_PIXEL_ID' <<<"$server" && fail "CN server must not inherit the .com Axon pixel"
ok ".com-only storage and analytics configuration is absent from CN"

grep -A 1 'name: LEGACY_OSS_BASE_URL' <<<"$server" | grep -q 'value: "https://shotive.oss-cn-hangzhou.aliyuncs.com"' || fail "CN server must use the CN legacy project-cover bucket"
grep -q 'fizzstudio-sg.oss-ap-southeast-1.aliyuncs.com' <<<"$server" && fail "CN server must not inherit the .com legacy project-cover bucket"
ok "legacy project covers are pinned to the CN bucket"

grep -q 'fizzdragon-agent:9b0ebfba' <<<"$render" || fail "legacy Agent API pin changed"
grep -q 'fizzdragon-agent:7b94af76' <<<"$render" || fail "legacy Agent worker pin changed"
ok "legacy Agent API and worker remain independently pinned"

migration="$(helm template fizzdragon "$CHART" -n fizzdragon -f "$CHART/values.yaml" -f "$CN_VALUES" \
  -s templates/server-migration-job.yaml \
  --set-string "server.image.tag=$REVISION" \
  --set 'server.migrationJob.enabled=true' \
  --set-string "server.migrationJob.revision=$REVISION" \
  --set-string 'server.migrationJob.backupId=backup-123')"
grep -q "name: fizzdragon-db-migrate-$REVISION" <<<"$migration" || fail "explicit migration Job did not render"
grep -q 'fizzdragon.com/rds-backup-id: "backup-123"' <<<"$migration" || fail "migration Job lost its RDS backup audit annotation"
ok "explicit migration Job renders with an immutable release name and backup audit trail"

echo "CN render contract: all checks passed"
