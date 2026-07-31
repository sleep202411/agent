#!/usr/bin/env bash
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT

release="git-0123456789abcdef"
render_error="$temporary_dir/render-error.log"
platform_render="$temporary_dir/agent-platform.yaml"
policy_render="$temporary_dir/agent-platform-networkpolicy.yaml"
server_render="$temporary_dir/server.yaml"
server_init_env="$temporary_dir/server-init-containers.yaml"
server_main_env="$temporary_dir/server-containers.yaml"
secrets_render="$temporary_dir/secrets.yaml"
observability_render="$temporary_dir/observability.yaml"
enabled_values=(
  --set agentPlatform.enabled=true
  --set "agentPlatform.api.image.tag=$release"
  --set "agentPlatform.worker.image.tag=$release"
  --set "agentPlatform.migrator.image.tag=$release"
)
agent_env_pattern='name: (AGENT_PLATFORM_|AGENT_DOMAIN_|AGENT_ADMISSION_)'

# Split the rendered server pod spec into its two container regions. A grep over
# the whole document cannot tell which of them received an env var, and the pod
# renders initContainers first: a gateway block misplaced onto db-migrate reads
# as present while the server container boots without it and crash-loops.
split_server_containers() {
  : >"$server_init_env"
  : >"$server_main_env"
  awk -v init_out="$server_init_env" -v main_out="$server_main_env" '
    !/^      / { region = ""; next }
    /^      initContainers:$/ { region = "init"; next }
    /^      containers:$/ { region = "main"; next }
    /^      [a-zA-Z]/ { region = ""; next }
    region == "init" { print > init_out; next }
    region == "main" { print > main_out }
  ' "$1"
}

env_value() {
  awk -v want="$2" '
    $1 == "-" && $2 == "name:" && $3 == want {
      getline
      sub(/^[[:space:]]*value:[[:space:]]*/, "")
      gsub(/"/, "")
      print
      exit
    }
  ' "$1"
}

# The committed migration switch is off until images and scoped secrets have
# been provisioned. The server must make that choice explicit rather than
# loading a half-configured gateway.
helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/server.yaml \
  >"$server_render"
split_server_containers "$server_render"
if [[ "$(env_value "$server_main_env" AGENT_PLATFORM_ENABLED)" != "false" ]]; then
  echo "The server container must receive AGENT_PLATFORM_ENABLED=false; app.module.ts throws without it." >&2
  exit 1
fi
if grep -Eq "$agent_env_pattern" "$server_init_env"; then
  echo "db-migrate runs prisma only and must receive no Agent Platform env." >&2
  exit 1
fi
if grep -q 'fizzdragon-agent-platform-server-secrets' "$server_render"; then
  echo "Disabled Agent Platform must not mount its unprovisioned key projection." >&2
  exit 1
fi
if grep -q 'name: AGENT_ADMISSION_' "$server_render"; then
  echo "Disabled Agent Platform must not inject an inactive admission policy." >&2
  exit 1
fi

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform.yaml \
  --set agentPlatform.enabled=true \
  >"$platform_render" 2>"$render_error"; then
  echo "Enabled Agent Platform must reject placeholder image revisions." >&2
  exit 1
fi
grep -q 'image tags must be one immutable deployment revision' "$render_error"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform.yaml \
  "${enabled_values[@]}" \
  --set agentPlatform.worker.image.tag=another-release \
  >"$platform_render" 2>"$render_error"; then
  echo "Mixed Agent Platform release images must be rejected." >&2
  exit 1
fi
grep -q 'image tags must be identical' "$render_error"

helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform.yaml \
  "${enabled_values[@]}" \
  >"$platform_render"

[[ "$(grep -c '^kind: Deployment$' "$platform_render")" -eq 2 ]]
[[ "$(grep -c '^kind: PodDisruptionBudget$' "$platform_render")" -eq 2 ]]
[[ "$(grep -c '^kind: Service$' "$platform_render")" -eq 1 ]]
[[ "$(grep -c '^kind: HorizontalPodAutoscaler$' "$platform_render")" -eq 1 ]]
[[ "$(grep -c '^kind: Job$' "$platform_render")" -eq 1 ]]
grep -q 'name: fizzdragon-agent-platform-api$' "$platform_render"
grep -Eq 'name: fizzdragon-agent-platform-worker-[a-f0-9]{12}$' "$platform_render"
grep -q "fizzdragon.com/agent-platform-build-id: \"$release\"" "$platform_render"
grep -q 'helm.sh/resource-policy: keep' "$platform_render"
grep -q 'path: /api/v1/health/ready' "$platform_render"
grep -q 'path: /health/ready' "$platform_render"
grep -q 'name: AGENT_WORKER_METRICS_BIND_ADDRESS' "$platform_render"
grep -q 'name: TEMPORAL_MAX_CONCURRENT_INFERENCE_ACTIVITIES' "$platform_render"
grep -q 'name: TEMPORAL_MAX_CONCURRENT_CLEANUP_ACTIVITIES' "$platform_render"
grep -q 'name: TEMPORAL_MAX_CONCURRENT_DOCUMENT_WORKFLOWS' "$platform_render"
grep -q 'readOnlyRootFilesystem: true' "$platform_render"
grep -q 'runAsNonRoot: true' "$platform_render"
grep -q 'name: AGENT_MEMORY_MIGRATION_DATABASE_URL_FILE' "$platform_render"
[[ "$(grep -c 'name: AGENT_MEMORY_DATABASE_ROLE' "$platform_render")" -eq 2 ]]
grep -q 'name: AGENT_MEMORY_API_DATABASE_ROLE' "$platform_render"
grep -q 'name: AGENT_MEMORY_WORKER_DATABASE_ROLE' "$platform_render"
grep -A2 'helm.sh/hook: pre-install,pre-upgrade' "$platform_render" |
  grep -q 'helm.sh/hook-weight: "-10"'

# The admission API does not possess inference authority. Vertex configuration
# exists only in the Worker, and neither process may receive an API key.
api_section="$temporary_dir/api-section.yaml"
worker_section="$temporary_dir/worker-section.yaml"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: fizzdragon-agent-platform-api/ { print }' \
  "$platform_render" >"$api_section"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: fizzdragon-agent-platform-worker-/ { print }' \
  "$platform_render" >"$worker_section"
if grep -q 'GOOGLE_CLOUD_PROJECT' "$api_section"; then
  echo "Agent API must not receive Vertex project configuration." >&2
  exit 1
fi
if grep -q 'ABLY_API_KEY' "$api_section"; then
  echo "Agent API must not receive the Worker's Ably execution credential." >&2
  exit 1
fi
grep -q 'name: GOOGLE_CLOUD_PROJECT' "$worker_section"
grep -q 'value: "glass-proxy-501907-d2"' "$worker_section"
grep -q 'name: GOOGLE_CLOUD_LOCATION' "$worker_section"
grep -q 'name: AGENT_INTERACTIVE_MODEL_ID' "$worker_section"
grep -q 'name: AGENT_REASONING_MODEL_ID' "$worker_section"
grep -q 'name: AGENT_MEMORY_OBSERVER_MODEL_ID' "$worker_section"
if grep -Eq 'GOOGLE_VERTEX_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|AGENT_MODEL_CREDENTIAL_ENV' \
  "$worker_section"; then
  echo "Agent Worker must authenticate to Vertex through ADC, not an API key." >&2
  exit 1
fi
grep -q 'AGENT_MEMORY_DATABASE_ROLE' "$worker_section"

helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/server.yaml \
  "${enabled_values[@]}" \
  >"$server_render"
split_server_containers "$server_render"
if [[ "$(env_value "$server_main_env" AGENT_PLATFORM_ENABLED)" != "true" ]]; then
  echo "The server container must receive AGENT_PLATFORM_ENABLED=true." >&2
  exit 1
fi
if grep -Eq "$agent_env_pattern" "$server_init_env"; then
  echo "db-migrate runs prisma only and must receive no Agent Platform env." >&2
  exit 1
fi
grep -q 'name: fizzdragon-agent-platform-server-secrets' "$server_render"

# The Worker derives its lanes from one base queue and the gateway appends
# -document to the same string, so the two must be rendered from one value. A
# divergence dispatches every long-document analysis onto a queue nobody polls,
# which reports as dispatched and then hangs with no error surface.
worker_task_queue="$(env_value "$worker_section" TEMPORAL_TASK_QUEUE)"
server_task_queue="$(env_value "$server_main_env" AGENT_PLATFORM_TEMPORAL_TASK_QUEUE)"
if [[ -z "$worker_task_queue" || "$server_task_queue" != "$worker_task_queue" ]]; then
  echo "Server AGENT_PLATFORM_TEMPORAL_TASK_QUEUE ($server_task_queue) must equal the Worker's base queue ($worker_task_queue)." >&2
  exit 1
fi

for platform_env in \
  AGENT_PLATFORM_URL \
  AGENT_PLATFORM_JWT_KEY_ID \
  AGENT_PLATFORM_JWT_ISSUER \
  AGENT_PLATFORM_JWT_AUDIENCE \
  AGENT_PLATFORM_TEMPORAL_TASK_QUEUE \
  AGENT_DOMAIN_JWT_ISSUER \
  AGENT_DOMAIN_JWT_AUDIENCE \
  AGENT_ADMISSION_PROVIDER_LANE \
  AGENT_ADMISSION_RETRY_AFTER_SECONDS \
  AGENT_ADMISSION_RESERVED_TOKEN_UNITS_PER_RUN \
  AGENT_ADMISSION_RESERVED_COST_MICROUSD_PER_RUN \
  AGENT_ADMISSION_MAX_ACTIVE_GLOBAL \
  AGENT_ADMISSION_MAX_ACTIVE_PER_WORKSPACE \
  AGENT_ADMISSION_MAX_ACTIVE_PER_ACTOR \
  AGENT_ADMISSION_MAX_ACTIVE_PER_PROVIDER_LANE \
  AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_GLOBAL \
  AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_WORKSPACE \
  AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_ACTOR \
  AGENT_ADMISSION_MAX_RESERVED_TOKEN_UNITS_PER_PROVIDER_LANE \
  AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_GLOBAL \
  AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_WORKSPACE \
  AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_ACTOR \
  AGENT_ADMISSION_MAX_RESERVED_COST_MICROUSD_PER_PROVIDER_LANE
do
  if ! grep -q "name: $platform_env\$" "$server_main_env"; then
    echo "$platform_env must be rendered onto the server container, not elsewhere in the pod." >&2
    exit 1
  fi
done

# Rendered from agentPlatform.temporal.taskQueue, not written as a literal.
helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/server.yaml \
  "${enabled_values[@]}" \
  --set agentPlatform.temporal.taskQueue=render-contract-queue \
  >"$temporary_dir/server-requeued.yaml"
split_server_containers "$temporary_dir/server-requeued.yaml"
if [[ "$(env_value "$server_main_env" AGENT_PLATFORM_TEMPORAL_TASK_QUEUE)" != "render-contract-queue" ]]; then
  echo "AGENT_PLATFORM_TEMPORAL_TASK_QUEUE must track agentPlatform.temporal.taskQueue." >&2
  exit 1
fi

# The Worker parses untrusted documents while holding the Ably key, the
# agent_memory DSN and the domain signing key, so both roles are default-deny
# egress with a named allow-list — the same bar the runtime it replaces sets.
helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform-networkpolicy.yaml \
  "${enabled_values[@]}" \
  >"$policy_render"
[[ "$(grep -c '^kind: NetworkPolicy$' "$policy_render")" -eq 3 ]]
grep -q 'name: fizzdragon-agent-platform-egress-deny$' "$policy_render"
grep -q 'name: fizzdragon-agent-platform-api-egress$' "$policy_render"
grep -q 'name: fizzdragon-agent-platform-worker-egress$' "$policy_render"
grep -q 'egress: \[\]' "$policy_render"
# The Collector carries the same role label. Denying it here without a matching
# allow rule would take telemetry down, so the deny must name its two roles.
deny_policy="$temporary_dir/deny-policy.yaml"
awk 'BEGIN { RS="---" } /name: fizzdragon-agent-platform-egress-deny/ { print }' \
  "$policy_render" >"$deny_policy"
deny_roles="$(awk '
  /operator: In/ { seen = 1; next }
  seen && /values:/ { collecting = 1; next }
  collecting && /^ *- / { sub(/^ *- /, ""); printf "%s ", $0; next }
  collecting { exit }
' "$deny_policy")"
if [[ "$deny_roles" != "api worker " ]]; then
  echo "The default deny must name api and worker; the Collector shares the role label and has no allow-list. Got: '$deny_roles'" >&2
  exit 1
fi
api_policy="$temporary_dir/api-policy.yaml"
worker_policy="$temporary_dir/worker-policy.yaml"
awk 'BEGIN { RS="---" } /name: fizzdragon-agent-platform-api-egress/ { print }' \
  "$policy_render" >"$api_policy"
awk 'BEGIN { RS="---" } /name: fizzdragon-agent-platform-worker-egress/ { print }' \
  "$policy_render" >"$worker_policy"
for private_range in '"10.0.0.0/16"' '"10.244.0.0/16"' '"169.254.0.0/16"'; do
  grep -q -- "- $private_range" "$api_policy"
  grep -q -- "- $private_range" "$worker_policy"
done
grep -q 'port: 443' "$worker_policy"
if grep -q 'port: 443' "$api_policy"; then
  echo "The admission API holds no model or realtime credential and must not egress on 443." >&2
  exit 1
fi

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform-networkpolicy.yaml \
  "${enabled_values[@]}" \
  --set agentPlatform.networkPolicy.enabled=false \
  >"$policy_render" 2>"$render_error"; then
  echo "Agent Platform egress containment must not be optional." >&2
  exit 1
fi
grep -q 'agentPlatform.networkPolicy.enabled must be true' "$render_error"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform-networkpolicy.yaml \
  "${enabled_values[@]}" \
  --set 'agentPlatform.networkPolicy.clusterCidrs=null' \
  >"$policy_render" 2>"$render_error"; then
  echo "An empty clusterCidrs list turns the external egress rule into an allow-all." >&2
  exit 1
fi
grep -q 'clusterCidrs must list' "$render_error"

helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/secret-provider-class.yaml \
  "${enabled_values[@]}" \
  >"$secrets_render"
for group in server api worker migration; do
  grep -q "name: fizzdragon-agent-platform-$group-kv" "$secrets_render"
done
if grep -q 'google-generative-ai-api-key' "$secrets_render"; then
  echo "Agent Platform secret projection must not contain a Gemini API key." >&2
  exit 1
fi
grep -q 'name: fizzdragon-agent-observability-kv' "$secrets_render"
grep -A12 'name: fizzdragon-agent-platform-migration-kv' "$secrets_render" |
  grep -q 'helm.sh/hook-weight: "-20"'

helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-observability.yaml \
  "${enabled_values[@]}" \
  >"$observability_render"
[[ "$(grep -c '^kind: StatefulSet$' "$observability_render")" -eq 1 ]]
[[ "$(grep -c '^kind: Service$' "$observability_render")" -eq 2 ]]
[[ "$(grep -c '^kind: PodDisruptionBudget$' "$observability_render")" -eq 1 ]]
grep -q 'replicas: 3' "$observability_render"
grep -q 'volumeClaimTemplates:' "$observability_render"
grep -q 'create_schema: false' "$observability_render"
grep -q 'storage: file_storage/agent_observability' "$observability_render"
grep -q 'readers:' "$observability_render"
grep -q 'sha256:f2f01157055a9b2aab9df7118e1f1c9abf345e99b23bc7a2bc791db374a7d0f6' \
  "$observability_render"

# Non-Azure cells receive externally-created K8s Secrets. They must not render
# an Azure CSI volume, and the migrator must consume the dedicated Secret.
helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform.yaml \
  "${enabled_values[@]}" \
  --set azure.enabled=false \
  >"$temporary_dir/non-azure.yaml"
if grep -q 'secrets-store.csi.k8s.io' "$temporary_dir/non-azure.yaml"; then
  echo "Non-Azure Agent Platform render must not depend on the Azure CSI driver." >&2
  exit 1
fi
grep -q 'name: fizzdragon-agent-platform-migration-secrets' "$temporary_dir/non-azure.yaml"
helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-observability.yaml \
  "${enabled_values[@]}" \
  --set azure.enabled=false \
  >"$temporary_dir/non-azure-observability.yaml"
if grep -q 'secrets-store.csi.k8s.io' "$temporary_dir/non-azure-observability.yaml"; then
  echo "Non-Azure Collector render must not depend on the Azure CSI driver." >&2
  exit 1
fi
grep -q 'name: fizzdragon-agent-observability-secrets' \
  "$temporary_dir/non-azure-observability.yaml"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform.yaml \
  "${enabled_values[@]}" \
  --set agentPlatform.api.replicaCount=2 \
  >"$platform_render" 2>"$render_error"; then
  echo "Production Agent API topology must reject fewer than three replicas." >&2
  exit 1
fi
grep -q 'replicaCount must be at least 3' "$render_error"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform.yaml \
  "${enabled_values[@]}" \
  --set agentPlatform.temporal.address=temporal.example.com:7233 \
  >"$platform_render" 2>"$render_error"; then
  echo "External Temporal must not silently render without its mTLS contract." >&2
  exit 1
fi
grep -q 'until external mTLS credentials are configured' "$render_error"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform.yaml \
  "${enabled_values[@]}" \
  --set agentPlatform.memory.apiDatabaseRole='Invalid-Role' \
  >"$platform_render" 2>"$render_error"; then
  echo "Invalid PostgreSQL runtime roles must be rejected at chart render time." >&2
  exit 1
fi
grep -q 'must be lowercase PostgreSQL role identifiers' "$render_error"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/agent-platform.yaml \
  "${enabled_values[@]}" \
  --set agentPlatform.memory.apiDatabaseRole=fizzdragon_agent_worker \
  >"$platform_render" 2>"$render_error"; then
  echo "Agent API and Worker PostgreSQL roles must be distinct." >&2
  exit 1
fi
grep -q 'API and Worker database roles must be separate' "$render_error"

echo "Agent Platform Helm render contract passed."
