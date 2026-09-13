#!/usr/bin/env bash
# Render contract for the server's keyless Google Vertex AI identity path.
set -euo pipefail

CHART="$(cd "$(dirname "$0")/.." && pwd)"
CN_VALUES="$CHART/values.cn-prod.yaml"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "  ok — $*"; }

echo "google-vertex render contract"

server="$(helm template fizzdragon "$CHART" -s templates/server.yaml)" ||
  fail "default server render"

grep -q 'name: GOOGLE_VERTEX_ENABLED' <<<"$server" ||
  fail "the .com server must enable Google Vertex explicitly"
grep -q 'value: "glass-proxy-501907-d2"' <<<"$server" ||
  fail "the .com server must receive the configured Google project"
grep -q 'name: GOOGLE_VERTEX_IMAGE_LOCATION' <<<"$server" ||
  fail "the .com server must configure the Gemini image location"
grep -q 'name: GOOGLE_VERTEX_VIDEO_LOCATION' <<<"$server" ||
  fail "the .com server must configure the Veo location independently"
grep -q 'value: "us-central1"' <<<"$server" ||
  fail "Veo 3.1 GA must use its supported regional endpoint"
grep -q 'name: GOOGLE_APPLICATION_CREDENTIALS' <<<"$server" ||
  fail "the server must use the rendered ADC external-account file"
grep -q '^kind: ConfigMap' <<<"$server" ||
  fail "the ADC external-account ConfigMap is missing"
grep -q '"type": "external_account"' <<<"$server" ||
  fail "the rendered credential must be a keyless external account"
grep -q 'serviceAccountToken:' <<<"$server" ||
  fail "the pod must receive a projected, short-lived Kubernetes token"
grep -q 'service_account_impersonation_url' <<<"$server" ||
  fail "the external account must impersonate the configured Google service account"
if grep -Eq 'private_key|private_key_id|client_secret' <<<"$server"; then
  fail "the rendered Vertex identity path must not contain long-lived credentials"
fi
ok ".com renders keyless AKS→GCP Workload Identity Federation"

cn_server="$(helm template fizzdragon "$CHART" -f "$CN_VALUES" -s templates/server.yaml)" ||
  fail "CN server render"
if grep -Eq 'GOOGLE_VERTEX|google-vertex|external_account|sts.googleapis.com' <<<"$cn_server"; then
  fail "the CN server must not inherit the .com Google Vertex identity path"
fi
ok "CN renders with no Google Vertex configuration"

expect_fail() {
  local why="$1"; shift
  if helm template fizzdragon "$CHART" -s templates/server.yaml "$@" >/dev/null 2>&1; then
    fail "$why — render succeeded when it must not"
  fi
  ok "rejected: $why"
}

expect_fail "Google Vertex enabled outside the AKS identity path" \
  --set azure.enabled=false
expect_fail "Google Vertex enabled without a project" \
  --set-string server.googleVertex.project=
expect_fail "Google Vertex enabled without a Veo region" \
  --set-string server.googleVertex.videoLocation=
expect_fail "Google Vertex enabled without a WIF provider" \
  --set-string server.googleVertex.workloadIdentityFederation.provider=

echo "google-vertex render contract: all checks passed"
