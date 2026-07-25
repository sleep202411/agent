#!/usr/bin/env bash
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT

runtime_render="$temporary_dir/runtime.yaml"
temporal_render="$temporary_dir/temporal.yaml"
network_policy_render="$temporary_dir/network-policy.yaml"
full_render="$temporary_dir/full.yaml"
render_error="$temporary_dir/render-error.log"

release="git-0123456789abcdef"
runtime_values=(
  --set "studioAgentRuntime.image.tag=$release"
  --set temporal.database.host=pg-temporal.postgres.database.azure.com
  --set temporal.database.user=temporal
  --set-string 'studioAgentRuntime.networkPolicy.model.cidrs[0]=198.51.100.0/24'
  --set-string 'studioAgentRuntime.networkPolicy.database.cidrs[0]=20.24.30.0/24'
)

# Studio Agent is a product surface every region runs, so an unconfigured chart
# must refuse to render rather than quietly omit the runtime — a deployment that
# silently drops it leaves the client offering an entry point nothing serves.
#
# The placeholder tag is rejected because it is also the Temporal build ID: a
# mutable tag there would let two different worker builds claim one pinned
# history.
if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --set studioAgentRuntime.image.tag=set-at-deploy \
  >"$temporary_dir/unconfigured.yaml" 2>"$render_error"; then
  echo "Render without an immutable runtime revision must fail." >&2
  exit 1
fi
grep -q 'image.tag must be an immutable deployment revision' "$render_error"

# The committed values must be deployable as-is: a region that renders only
# with extra --set flags is a region whose GitOps source of truth is incomplete.
helm template fizzdragon "$chart_dir" --namespace fizzdragon-test \
  >"$temporary_dir/committed.yaml" 2>"$render_error" || {
  echo "The committed values must render without any --set override." >&2
  cat "$render_error" >&2
  exit 1
}

# Temporal's persistence must be a dedicated PostgreSQL 16 server, never the
# application database — a region that has not provisioned one cannot deploy.
if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --set "studioAgentRuntime.image.tag=$release" \
  --set temporal.database.host="" \
  --set-string 'studioAgentRuntime.networkPolicy.model.cidrs[0]=198.51.100.0/24' \
  --set-string 'studioAgentRuntime.networkPolicy.database.cidrs[0]=20.24.30.0/24' \
  >"$temporary_dir/no-database.yaml" 2>"$render_error"; then
  echo "Render without Temporal persistence configuration must fail." >&2
  exit 1
fi
grep -q 'temporal.database.host is required' "$render_error"

helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/studio-agent-runtime.yaml \
  "${runtime_values[@]}" \
  >"$runtime_render"

if [[ "$(grep -c '^kind: Deployment$' "$runtime_render")" -ne 2 ]]; then
  echo "Render must contain exactly two runtime Deployments." >&2
  exit 1
fi
if [[ "$(grep -c '^kind: PodDisruptionBudget$' "$runtime_render")" -ne 2 ]]; then
  echo "Render must contain exactly two runtime PodDisruptionBudgets." >&2
  exit 1
fi
grep -Eq 'name: fizzdragon-studio-agent-control-[a-f0-9]{12}$' "$runtime_render"
grep -Eq 'name: fizzdragon-studio-agent-activities-[a-f0-9]{12}$' "$runtime_render"
grep -q 'helm.sh/resource-policy: keep' "$runtime_render"
grep -q 'fizzdragon.com/studio-agent-deployment-name: "fizzdragon-studio-agent"' "$runtime_render"
# The image tag IS the Temporal build ID. Keeping them one value is what makes
# the deploy script's tag bump sufficient to move pinned workflow histories.
grep -q "fizzdragon.com/studio-agent-build-id: \"$release\"" "$runtime_render"
grep -q 'name: STUDIO_AGENT_WORKER_DEPLOYMENT_NAME' "$runtime_render"

# --- Temporal server ---------------------------------------------------------
helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/temporal.yaml \
  "${runtime_values[@]}" \
  >"$temporal_render"

grep -q '^kind: Service$' "$temporal_render"
grep -q '^kind: Deployment$' "$temporal_render"
if [[ "$(grep -c '^kind: Job$' "$temporal_render")" -ne 2 ]]; then
  echo "Temporal render must contain the schema and namespace Jobs." >&2
  exit 1
fi
# Schema tooling must never run from the server container: auto-setup would race
# itself across replicas and on every pod restart.
grep -q 'name: SKIP_SCHEMA_SETUP' "$temporal_render"
grep -q 'helm.sh/hook: pre-install,pre-upgrade' "$temporal_render"
grep -q 'helm.sh/hook: post-install,post-upgrade' "$temporal_render"
# Immutable after the first boot — a silent default of 4 would permanently cap
# throughput, so the rendered value is asserted rather than assumed.
grep -A1 'name: NUM_HISTORY_SHARDS' "$temporal_render" | grep -q '"512"'

# --- TLS posture -------------------------------------------------------------
# Plaintext is permitted for exactly one endpoint: this chart's own in-cluster
# Service. Anything else is off-cluster by definition and must be mTLS.
if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  "${runtime_values[@]}" \
  --set studioAgentRuntime.temporal.address=temporal.example.com:7233 \
  >"$temporary_dir/external-plaintext.yaml" 2>"$render_error"; then
  echo "Plaintext against an off-cluster Temporal endpoint must fail." >&2
  exit 1
fi
grep -q 'plaintext is permitted only for' "$render_error"

helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  "${runtime_values[@]}" \
  >"$full_render"

# The Key Vault CSI projection is fail-closed, so a mapping to a secret that was
# never created breaks the whole projected Secret. Under plaintext there are no
# client certificates, so the entire chain must be absent — not merely unused.
if grep -q 'studio-agent-temporal-kv\|studio-agent-temporal-secrets' "$full_render"; then
  echo "Plaintext render must not reference the Temporal mTLS secret chain." >&2
  exit 1
fi

# --- NetworkPolicy -----------------------------------------------------------
helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/studio-agent-runtime-networkpolicy.yaml \
  "${runtime_values[@]}" \
  >"$network_policy_render"

# deny-all + two worker roles + Temporal's own ingress and egress.
if [[ "$(grep -c '^kind: NetworkPolicy$' "$network_policy_render")" -ne 5 ]]; then
  echo "Render must contain default-deny, two role allow policies, and Temporal's own pair." >&2
  exit 1
fi
grep -q 'fizzdragon.com/studio-agent-role: control' "$network_policy_render"
grep -q 'fizzdragon.com/studio-agent-role: activities' "$network_policy_render"
grep -q 'cidr: "198.51.100.0/24"' "$network_policy_render"
# Temporal is in-cluster, so worker egress to it must be pod-selected. An
# ipBlock here would mean allowing the whole pod CIDR — an allow-all.
grep -q 'app.kubernetes.io/component: temporal' "$network_policy_render"
# Clients are selected by one label rather than enumerated, so a new client
# (the namespace-registration Job, an admin pod) cannot be silently omitted.
grep -q 'fizzdragon.com/temporal-client: "true"' "$network_policy_render"
if grep -Eq 'cidr: "(0\.0\.0\.0/0|::/0)"' "$network_policy_render"; then
  echo "Runtime NetworkPolicy must not contain unrestricted egress." >&2
  exit 1
fi

# Every pod that dials Temporal must carry the client label the ingress policy
# selects, or it is denied and the execution plane stalls with no error.
for workload in fizzdragon-server fizzdragon-temporal-namespace; do
  if ! grep -q "$workload" "$full_render"; then
    echo "Expected $workload in the full render." >&2
    exit 1
  fi
done
if [[ "$(grep -c 'fizzdragon.com/temporal-client: "true"' "$full_render")" -lt 5 ]]; then
  echo "Temporal clients (server, both workers, namespace Job) must carry the client label." >&2
  exit 1
fi

# The database rule is the first private range this policy legitimises, so the
# width floor is what stops it becoming an allow-all to the cluster.
if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --set "studioAgentRuntime.image.tag=$release" \
  --set temporal.database.host=pg-temporal.postgres.database.azure.com \
  --set temporal.database.user=temporal \
  --set-string 'studioAgentRuntime.networkPolicy.model.cidrs[0]=198.51.100.0/24' \
  --set-string 'studioAgentRuntime.networkPolicy.database.cidrs[0]=10.0.0.0/16' \
  >"$temporary_dir/broad-db-cidr.yaml" 2>"$render_error"; then
  echo "A database CIDR wider than the /24 floor must fail." >&2
  exit 1
fi
grep -q 'wider than the /24 floor' "$render_error"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --set "studioAgentRuntime.image.tag=$release" \
  --set temporal.database.host=pg-temporal.postgres.database.azure.com \
  --set temporal.database.user=temporal \
  --set 'studioAgentRuntime.networkPolicy.model.cidrs=null' \
  >"$temporary_dir/missing-cidrs.yaml" 2>"$render_error"; then
  echo "Render without explicit endpoint CIDRs must fail." >&2
  exit 1
fi
grep -q 'networkPolicy.model.cidrs must list the exact model-provider endpoint CIDRs' "$render_error"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  "${runtime_values[@]}" \
  --set-string 'studioAgentRuntime.networkPolicy.model.cidrs[0]=0.0.0.0/0' \
  >"$temporary_dir/broad-cidr.yaml" 2>"$render_error"; then
  echo "Render with unrestricted model egress must fail." >&2
  exit 1
fi
grep -q 'NetworkPolicy forbids broad egress CIDR 0.0.0.0/0' "$render_error"

echo "Studio Agent Helm render contract passed."
