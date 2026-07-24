#!/usr/bin/env bash
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT

runtime_render="$temporary_dir/runtime.yaml"
network_policy_render="$temporary_dir/network-policy.yaml"
render_error="$temporary_dir/render-error.log"

release="git-0123456789abcdef"
runtime_values=(
  --set "studioAgentRuntime.release=$release"
  --set "studioAgentRuntime.image.tag=$release"
  --set studioAgentRuntime.temporal.address=temporal.example.com:7233
  --set studioAgentRuntime.temporal.namespace=fizzdragon
  --set-string 'studioAgentRuntime.networkPolicy.temporal.cidrs[0]=203.0.113.10/32'
  --set-string 'studioAgentRuntime.networkPolicy.model.cidrs[0]=198.51.100.0/24'
)

# Studio Agent is a product surface every region runs, so an unconfigured chart
# must refuse to render rather than quietly omit the runtime — a deployment that
# silently drops it leaves the client offering an entry point nothing serves.
if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  >"$temporary_dir/unconfigured.yaml" 2>"$render_error"; then
  echo "Render without Studio Agent runtime configuration must fail." >&2
  exit 1
fi
grep -q 'studioAgentRuntime.temporal.address is required' "$render_error"

helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/studio-agent-runtime.yaml \
  "${runtime_values[@]}" \
  >"$runtime_render"

if [[ "$(grep -c '^kind: Deployment$' "$runtime_render")" -ne 2 ]]; then
  echo "Enabled render must contain exactly two runtime Deployments." >&2
  exit 1
fi
if [[ "$(grep -c '^kind: PodDisruptionBudget$' "$runtime_render")" -ne 2 ]]; then
  echo "Enabled render must contain exactly two runtime PodDisruptionBudgets." >&2
  exit 1
fi
grep -Eq 'name: fizzdragon-studio-agent-control-[a-f0-9]{12}$' "$runtime_render"
grep -Eq 'name: fizzdragon-studio-agent-activities-[a-f0-9]{12}$' "$runtime_render"
grep -q 'helm.sh/resource-policy: keep' "$runtime_render"
grep -q 'fizzdragon.com/studio-agent-deployment-name: "fizzdragon-studio-agent"' "$runtime_render"
grep -q 'fizzdragon.com/studio-agent-build-id: "git-0123456789abcdef"' "$runtime_render"
grep -q 'name: STUDIO_AGENT_WORKER_DEPLOYMENT_NAME' "$runtime_render"

helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --show-only templates/studio-agent-runtime-networkpolicy.yaml \
  "${runtime_values[@]}" \
  >"$network_policy_render"

if [[ "$(grep -c '^kind: NetworkPolicy$' "$network_policy_render")" -ne 3 ]]; then
  echo "Enabled render must contain default-deny and two role allow policies." >&2
  exit 1
fi
grep -q 'fizzdragon.com/studio-agent-role: control' "$network_policy_render"
grep -q 'fizzdragon.com/studio-agent-role: activities' "$network_policy_render"
grep -q 'cidr: "203.0.113.10/32"' "$network_policy_render"
grep -q 'cidr: "198.51.100.0/24"' "$network_policy_render"
if grep -Eq 'cidr: "(0\.0\.0\.0/0|::/0)"' "$network_policy_render"; then
  echo "Runtime NetworkPolicy must not contain unrestricted egress." >&2
  exit 1
fi

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  --set "studioAgentRuntime.release=$release" \
  --set "studioAgentRuntime.image.tag=$release" \
  --set studioAgentRuntime.temporal.address=temporal.example.com:7233 \
  --set studioAgentRuntime.temporal.namespace=fizzdragon \
  >"$temporary_dir/missing-cidrs.yaml" 2>"$render_error"; then
  echo "Enabled render without explicit endpoint CIDRs must fail." >&2
  exit 1
fi
grep -q 'networkPolicy.temporal.cidrs must list the exact Temporal endpoint CIDRs' "$render_error"

if helm template fizzdragon "$chart_dir" \
  --namespace fizzdragon-test \
  "${runtime_values[@]}" \
  --set-string 'studioAgentRuntime.networkPolicy.model.cidrs[0]=0.0.0.0/0' \
  >"$temporary_dir/broad-cidr.yaml" 2>"$render_error"; then
  echo "Enabled render with unrestricted model egress must fail." >&2
  exit 1
fi
grep -q 'NetworkPolicy forbids broad egress CIDR 0.0.0.0/0' "$render_error"

echo "Studio Agent Helm render contract passed."
