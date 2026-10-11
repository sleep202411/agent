#!/usr/bin/env bash
# Render contract for the Agent OS worker.
#
# Every assertion here is a mistake that renders perfectly well and only fails
# in the cluster: a probe path that 401s, an egress rule that silently becomes
# an allow-all, or a worker missing its fenced checkpoint authority. `helm
# lint` catches none of them.
set -euo pipefail
CHART="$(cd "$(dirname "$0")/.." && pwd)"
CN_VALUES="$CHART/values.cn-prod.yaml"
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "  ok — $*"; }

echo "agent-os render contract"

# ── committed values must render on their own ────────────────────────────────
render="$(helm template fizzdragon "$CHART")" || fail "default render"
ok "committed values render with no --set"

agent_os="$(helm template fizzdragon "$CHART" -s templates/agent-os.yaml)"

[ "$(grep -c '^kind: Deployment' <<<"$agent_os")" = 1 ] || fail "expected exactly one Deployment"
[ "$(grep -c '^kind: Service' <<<"$agent_os")" = 1 ] || fail "expected exactly one Service"
grep -q 'name: fizzdragon-agent-os' <<<"$agent_os" || fail "component name is not fizzdragon-agent-os"
ok "one Deployment + one Service named fizzdragon-agent-os"

# ── the probe must hit the only unauthenticated route ────────────────────────
[ "$(grep -c 'path: /health' <<<"$agent_os")" = 3 ] ||
  fail "expected three probes on /health — any other path returns 401 and CrashLoops a healthy process"
ok "all three probes target /health"

# ── the process defaults to loopback; in a pod that is unreachable ───────────
grep -q 'value: "0.0.0.0"' <<<"$agent_os" || fail "AGENT_OS_BIND_ADDRESS must be set explicitly"
ok "binds 0.0.0.0 explicitly"

grep -A1 'name: AGENT_OS_VIEWER_MODEL_PROFILE' <<<"$agent_os" | grep -q 'value: "qwen3.7-plus"' ||
  fail "viewing assistance must select a configured model profile"
ok "viewing assistance uses an explicit shipped model profile"

# ── both directions of the link are derived, never literal ───────────────────
grep -q 'value: "http://fizzdragon-server:3001"' <<<"$agent_os" ||
  fail "AGENT_OS_DOMAIN_URL must resolve to the rendered server Service"
grep -q 'value: "http://fizzdragon-agent-os:4301"' <<<"$render" ||
  fail "the server must be told the rendered worker Service"
ok "worker→server and server→worker addresses derive from the chart"

server="$(helm template fizzdragon "$CHART" -s templates/server.yaml)"
grep -A1 'name: AGENT_OS_MOBILE_CHAT_MODEL' <<<"$server" | grep -q 'value: "qwen3.7-flash"' ||
  fail "the global mobile model must remain explicitly configured"
cn_server="$(helm template fizzdragon "$CHART" -f "$CN_VALUES" -s templates/server.yaml)"
grep -A1 'name: AGENT_OS_MOBILE_CHAT_MODEL' <<<"$cn_server" | grep -q 'value: "qwen3.7-plus"' ||
  fail "CN mobile must use its qualified fixed chat model"
ok "mobile chat defaults are explicit and region-owned"

# ── scoped DSN, same execution authority, no unrelated server secrets ────────
grep -q 'name: fizzdragon-secrets' <<<"$agent_os" &&
  fail "the worker must not receive the server's broad shared secret projection"
grep -q 'name: fizzdragon-agent-os-secrets' <<<"$agent_os" ||
  fail "the worker needs its own scoped projection"
grep -q 'AGENT_OS_CHECKPOINT_DATABASE_URL' <<<"$render" ||
  fail "the worker secret projection must include its required checkpoint DSN"
grep -q 'name: AGENT_OS_CHECKPOINT_POOL_MAX' <<<"$agent_os" ||
  fail "checkpoint saver connection budget must be explicit"
grep -q 'name: AGENT_OS_CHECKPOINT_LOCK_POOL_MAX' <<<"$agent_os" ||
  fail "checkpoint guard connection budget must be explicit"
ok "worker gets the same-authority scoped DSN and explicit pool budgets"

# ── durable authorities make the Worker horizontally safe ──────────────────
replicated="$(helm template fizzdragon "$CHART" --set agentOs.replicaCount=2 \
  -s templates/agent-os.yaml)" || fail "two Agent OS replicas must render"
grep -q 'replicas: 2' <<<"$replicated" || fail "replicaCount=2 was not rendered"
ok "two replicas render against the fenced PostgreSQL authorities"

# ── guards that must reject, not warn ────────────────────────────────────────
expect_fail() {
  local why="$1"; shift
  if helm template fizzdragon "$CHART" "$@" >/dev/null 2>&1; then
    fail "$why — render succeeded when it must not"
  fi
  ok "rejected: $why"
}
expect_fail "empty clusterCidrs (the egress subtraction becomes an in-cluster allow-all)" \
  --set agentOs.networkPolicy.clusterCidrs=null
expect_fail "networkPolicy disabled" \
  --set agentOs.networkPolicy.enabled=false
expect_fail "a mutable image tag" \
  --set agentOs.image.tag=latest
expect_fail "an empty viewing assistance model profile" \
  --set agentOs.model.viewerProfile=

# ── DNS is the first egress rule; without it tools fail as provider flakes ───
policy="$(helm template fizzdragon "$CHART" -s templates/agent-os-networkpolicy.yaml)"
grep -q 'k8s-app: kube-dns' <<<"$policy" || fail "egress policy must allow cluster DNS"
grep -q 'port: 53' <<<"$policy" || fail "egress policy must allow port 53"
grep -q '169.254.0.0/16' <<<"$policy" || fail "egress must exclude node metadata"
ok "egress allows DNS and excludes node metadata"

# ── CN inherits every default it does not override ───────────────────────────
if [ -f "$CN_VALUES" ]; then
  # Assert the RENDER, not the raw values. A .com-only template that acquires a
  # `required` on a value CN leaves empty breaks deploy-cn.sh at its helm step
  # and nothing else in CI notices — which is exactly how the retired Temporal
  # template wedged CN until it was removed.
  cn_render="$(helm template fizzdragon "$CHART" -f "$CN_VALUES")" ||
    fail "CN overlay must render"
  ok "CN overlay renders"

  # Scope this to the worker template: CN either omits Agent OS entirely or
  # must clear .com's worker-pool placement. Server-side conditional wiring is
  # covered separately by cn-render-contract.sh.
  cn_agent_os="$(helm template fizzdragon "$CHART" -f "$CN_VALUES" \
    -s templates/agent-os.yaml 2>/dev/null || true)"
  if grep -q '^kind: Deployment' <<<"$cn_agent_os"; then
    if grep -q 'pool: worker' <<<"$cn_agent_os"; then
      fail "CN renders agent-os onto .com's worker pool — the pod would stay Pending"
    fi
    ok "CN enables agent-os without .com node placement"
  else
    ok "CN disables agent-os explicitly"
  fi
fi

echo "agent-os render contract: all checks passed"
