#!/usr/bin/env bash
# Provision the CN runtime identity in the existing Google project.
# Rerun after ACK signing-key rotation to refresh Google's public JWKS copy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-fizzdragon-cn}"
PROJECT=glass-proxy-501907-d2
PROJECT_NUMBER=553701186007
POOL=fizzdragon-ack
PROVIDER=ack-cn
SERVICE_ACCOUNT="fizzdragon-cn-vertex@$PROJECT.iam.gserviceaccount.com"
SUBJECT=system:serviceaccount:fizzdragon:fizzdragon-server-vertex
PROVIDER_PATH="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
AUDIENCE="https://iam.googleapis.com/$PROVIDER_PATH"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Fail before mutations if the operator session or cluster is unavailable.
gcloud projects describe "$PROJECT" --format='value(projectNumber)' > "$TMP_DIR/project-number"
[ "$(cat "$TMP_DIR/project-number")" = "$PROJECT_NUMBER" ] || { echo 'Unexpected Google project' >&2; exit 1; }
kubectl get --raw /.well-known/openid-configuration > "$TMP_DIR/oidc.json"
kubectl get --raw /openid/v1/jwks > "$TMP_DIR/jwks.json"
ISSUER="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["issuer"])' "$TMP_DIR/oidc.json")"

gcloud iam workload-identity-pools describe "$POOL" --project "$PROJECT" --location global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --project "$PROJECT" --location global --display-name='FizzDragon ACK'
OIDC_ARGS=(--project "$PROJECT" --location global --workload-identity-pool "$POOL"
  --issuer-uri "$ISSUER" --jwk-json-path "$TMP_DIR/jwks.json"
  --allowed-audiences "$AUDIENCE" --attribute-mapping 'google.subject=assertion.sub'
  --attribute-condition "assertion.sub == '$SUBJECT'")
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --project "$PROJECT" --location global --workload-identity-pool "$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" "${OIDC_ARGS[@]}"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" "${OIDC_ARGS[@]}"
fi

gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud iam service-accounts create fizzdragon-cn-vertex --project "$PROJECT" --display-name='FizzDragon CN Vertex'
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SERVICE_ACCOUNT" --role=roles/aiplatform.user --condition=None --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" --project "$PROJECT" \
  --member="principal://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/subject/$SUBJECT" \
  --role=roles/iam.workloadIdentityUser --quiet >/dev/null

# Install only the identity resources, not the application deployment. Helm
# owns these same resources on the subsequent full CN release.
helm template fizzdragon "$ROOT/deploy/helm/fizzdragon" -n fizzdragon \
  -f "$ROOT/deploy/helm/fizzdragon/values.cn-prod.yaml" -s templates/server.yaml \
  | node -e 'const fs=require("fs"),yaml=require("yaml"); for (const d of yaml.parseAllDocuments(fs.readFileSync(0,"utf8"))) {const v=d.toJSON(); if (!["ServiceAccount","ConfigMap"].includes(v?.kind)) continue; v.metadata.labels={...v.metadata.labels,"app.kubernetes.io/managed-by":"Helm"}; v.metadata.annotations={...v.metadata.annotations,"meta.helm.sh/release-name":"fizzdragon","meta.helm.sh/release-namespace":"fizzdragon"}; process.stdout.write("---\n"+yaml.stringify(v));}' \
  | kubectl apply -f -
echo 'CN Vertex federation provisioned. Verify token exchange from an ACK pod before rollout.'
