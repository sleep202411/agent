#!/usr/bin/env bash
# Local manifest contracts; no cluster, token exchange, or provider request.
set -euo pipefail
CHART="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHART/../../.."
FIZZDRAGON_CHART="$CHART" node <<'JS'
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const chart = process.env.FIZZDRAGON_CHART;
function render(args = [], error) {
  const result = spawnSync('helm', ['template', 'fizzdragon', chart, '-n', 'fizzdragon',
    '-s', 'templates/server.yaml', ...args], { encoding: 'utf8' });
  if (error) {
    assert.notEqual(result.status, 0, 'Incomplete identity must fail rendering');
    assert.ok(result.stderr.includes(error), result.stderr);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!/private_key|private_key_id|client_secret/.test(result.stdout));
  return YAML.parseAllDocuments(result.stdout).map(doc => doc.toJS()).filter(Boolean);
}
function verifyIdentity(resources, { pool, provider, serviceAccount, azure }) {
  const deployment = resources.find(resource => resource.kind === 'Deployment');
  const pod = deployment.spec.template.spec;
  const container = pod.containers[0];
  const env = Object.fromEntries(container.env.map(entry => [entry.name, entry.value]));
  assert.equal(env.GOOGLE_VERTEX_ENABLED, 'true');
  assert.equal(env.GOOGLE_CLOUD_PROJECT, 'glass-proxy-501907-d2');
  assert.equal(env.GOOGLE_VERTEX_IMAGE_LOCATION, 'global');
  assert.equal(env.GOOGLE_VERTEX_VIDEO_LOCATION, 'us-central1');
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, '/etc/gcp/credential.json');
  assert.equal(pod.serviceAccountName, serviceAccount);
  assert.equal(deployment.spec.template.metadata.labels['azure.workload.identity/use'],
    azure ? 'true' : undefined);
  const cm = resources.find(resource => resource.kind === 'ConfigMap');
  const credential = JSON.parse(cm.data['credential.json']);
  const path = `projects/553701186007/locations/global/workloadIdentityPools/${pool}/providers/${provider}`;
  assert.deepEqual(credential, {
    type: 'external_account', audience: `//iam.googleapis.com/${path}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    credential_source: { file: '/var/run/google-vertex-identity/token', format: { type: 'text' } },
    service_account_impersonation_url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/fizzdragon-agent-platform@glass-proxy-501907-d2.iam.gserviceaccount.com:generateAccessToken',
  });
  const identity = pod.volumes.filter(volume => volume.name === 'google-vertex-identity');
  assert.equal(identity.length, 1);
  assert.deepEqual(identity[0].projected.sources, [{ serviceAccountToken: {
    audience: `https://iam.googleapis.com/${path}`, expirationSeconds: 3600, path: 'token',
  } }]);
  assert.deepEqual(pod.volumes.find(volume => volume.name === 'google-vertex-credential').configMap,
    { name: cm.metadata.name });
  for (const [name, mountPath] of [['google-vertex-identity', '/var/run/google-vertex-identity'],
    ['google-vertex-credential', '/etc/gcp']]) {
    assert.deepEqual(container.volumeMounts.filter(mount => mount.name === name),
      [{ name, mountPath, readOnly: true }]);
  }
  const serviceAccounts = resources.filter(resource => resource.kind === 'ServiceAccount');
  if (azure) {
    assert.equal(serviceAccounts.length, 0, 'Existing AKS identity remains externally managed');
    assert.ok(pod.volumes.some(volume => volume.csi));
  } else {
    assert.equal(serviceAccounts.length, 1);
    assert.equal(serviceAccounts[0].metadata.name, serviceAccount);
    assert.equal(serviceAccounts[0].metadata.namespace, 'fizzdragon');
    assert.equal(serviceAccounts[0].automountServiceAccountToken, false);
    assert.equal(serviceAccounts[0].metadata.annotations, undefined);
    assert.equal(pod.automountServiceAccountToken, false);
    assert.ok(!pod.volumes.some(volume => volume.csi), 'ACK receives no Azure CSI mounts');
    assert.ok(!resources.some(resource => /Role|Binding/.test(resource.kind)),
      'Google federation does not grant Kubernetes API permissions');
  }
  return pod;
}
verifyIdentity(render(), { pool: 'fizzdragon-aks', provider: 'aks-com',
  serviceAccount: 'fizzdragon-com-app', azure: true });
const ack = ['-f', `${chart}/values.sg-vertex.yaml`,
  '--set', 'server.migrateOnStart=false'];
// No datastore volumes: the explicit Google projections must still be mounted.
const standalone = verifyIdentity(render(ack), { pool: 'fizzdragon-ack', provider: 'ack-com-sg',
  serviceAccount: 'fizzdragon-com-sg-server', azure: false });
assert.deepEqual(standalone.volumes.map(volume => volume.name),
  ['google-vertex-identity', 'google-vertex-credential']);
const datastore = verifyIdentity(render([...ack,
  '--set', 'server.datastore.configMapName=fixture-datastore',
  '--set', 'server.datastore.caConfigMapName=fixture-ca']), {
  pool: 'fizzdragon-ack', provider: 'ack-com-sg', serviceAccount: 'fizzdragon-com-sg-server', azure: false,
});
assert.ok(datastore.volumes.some(volume => volume.name === 'datastore-ca'));
for (const args of [['-f', `${chart}/values.cn-prod.yaml`], [...ack, '--set', 'server.googleVertex.enabled=false']]) {
  const resources = render(args);
  assert.ok(!JSON.stringify(resources).match(/GOOGLE_VERTEX|google-vertex|external_account|sts.googleapis.com/));
  assert.ok(!resources.some(resource => resource.kind === 'ServiceAccount'));
}
render(['--set', 'azure.enabled=false'], 'kubernetesServiceAccountName is required outside Azure');
for (const name of ['default', 'Bad_Name', '-bad', 'bad.', 'a'.repeat(64)]) {
  render([...ack, '--set-string', `server.googleVertex.workloadIdentityFederation.kubernetesServiceAccountName=${name}`],
    'must be a dedicated DNS label');
}
for (const key of ['project', 'imageLocation', 'videoLocation',
  'workloadIdentityFederation.projectNumber', 'workloadIdentityFederation.pool',
  'workloadIdentityFederation.provider', 'workloadIdentityFederation.serviceAccountEmail']) {
  render([...ack, '--set-string', `server.googleVertex.${key}=`], `server.googleVertex.${key} is required`);
}
console.log('Google Vertex render checks passed: AKS, dedicated ACK identity, ADC/token/mount pairing, datastore coexistence, CN isolation, required configuration.');
JS
