#!/usr/bin/env bash
# Local rendering only: no Kubernetes connection, datastore access, or workload.
set -euo pipefail
CHART="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHART/../../.."
FIZZDRAGON_CHART="$CHART" node <<'JS'
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const chart = process.env.FIZZDRAGON_CHART;
const component = resource => resource.metadata?.labels?.['app.kubernetes.io/component'];
const overrides = values => Object.entries(values).flatMap(([key, value]) =>
  ['--set-string', `${key}=${value}`]);
function render(args = [], error) {
  const result = spawnSync('helm', ['template', 'validation', chart, '-n', 'fizzdragon', ...args],
    { encoding: 'utf8', maxBuffer: 10_000_000 });
  if (error) {
    assert.notEqual(result.status, 0, 'Invalid datastore configuration must fail rendering');
    assert.ok(result.stderr.includes(error), result.stderr);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  return YAML.parseAllDocuments(result.stdout).map(document => document.toJS()).filter(Boolean);
}
function deployment(resources) {
  return resources.find(resource => resource.kind === 'Deployment' && component(resource) === 'server');
}
function verifyDatastore(pod, containers, mountPath = '/etc/fizzdragon/certs') {
  const ca = pod.volumes.filter(volume => volume.name === 'datastore-ca');
  assert.equal(ca.length, 1);
  assert.deepEqual(ca[0].configMap, { name: 'validation-datastore-ca', optional: false });
  for (const container of containers) {
    const refs = container.envFrom.filter(ref => ref.configMapRef?.name === 'validation-datastore');
    assert.deepEqual(refs, [{ configMapRef: { name: 'validation-datastore', optional: false } }]);
    assert.deepEqual(container.envFrom.at(-1), refs[0], 'Datastore options follow legacy envFrom sources');
    assert.deepEqual(container.volumeMounts.filter(mount => mount.name === 'datastore-ca'),
      [{ name: 'datastore-ca', mountPath, readOnly: true }]);
  }
}
const datastore = overrides({
  'server.datastore.configMapName': 'validation-datastore',
  'server.datastore.caConfigMapName': 'validation-datastore-ca',
});
const noInitMigration = ['--set', 'server.migrateOnStart=false'];
const ack = ['--set', 'azure.enabled=false', '--set', 'server.googleVertex.enabled=false'];
const job = ['--set', 'server.migrationJob.enabled=true', ...overrides({
  'server.migrationJob.revision': 'validation-fixture',
  'server.migrationJob.backupId': 'validation-fixture',
  'server.migrationJob.databaseSecret.name': 'validation-migration-database',
  'server.migrationJob.databaseSecret.key': 'DATABASE_URL',
})];

for (const args of [[], ['-f', `${chart}/values.cn-prod.yaml`]]) {
  const resources = render(args);
  const pod = deployment(resources).spec.template.spec;
  assert.equal(pod.automountServiceAccountToken, undefined, 'Default token behavior is unchanged');
  assert.ok(!pod.volumes?.some(volume => volume.name === 'datastore-ca'));
  assert.ok(!pod.containers[0].envFrom.some(ref => ref.configMapRef));
  assert.ok(!pod.containers[0].env.some(entry => entry.name === 'DATABASE_URL'),
    'Existing deployments keep their original connection source');
  assert.equal(resources.filter(resource => component(resource) === 'server' && resource.kind === 'Service').length, 1);
  assert.equal(resources.filter(resource => component(resource) === 'server' && resource.kind === 'PodDisruptionBudget').length, 1);
}
for (const args of [[], ack, ['-f', `${chart}/values.cn-prod.yaml`]]) {
  const baseline = deployment(render(args)).spec.template.spec;
  const resources = render([...args, ...datastore, ...job, ...noInitMigration]);
  const pod = deployment(resources).spec.template.spec;
  assert.equal(pod.initContainers, undefined, 'Datastore cells use the dedicated migration Job');
  verifyDatastore(pod, pod.containers);
  const migrationTemplate = resources.find(resource => resource.kind === 'Job' && component(resource) === 'db-migrate')
    .spec.template;
  const migrationPod = migrationTemplate.spec;
  assert.equal(migrationTemplate.metadata.labels['azure.workload.identity/use'], undefined);
  assert.equal(migrationPod.serviceAccountName, undefined, 'Dedicated migration receives no Azure identity');
  assert.equal(migrationPod.automountServiceAccountToken, false);
  verifyDatastore(migrationPod, migrationPod.containers);
  const migration = migrationPod.containers[0];
  assert.deepEqual(migration.env, [
    { name: 'DATABASE_URL', valueFrom: { secretKeyRef: {
      name: 'validation-migration-database', key: 'DATABASE_URL', optional: false,
    } } },
    { name: 'DOTENV_CONFIG_PATH', value: '/dev/null' },
  ]);
  assert.ok(!migration.envFrom.some(ref => ref.secretRef), 'Migration receives no application/provider Secrets');
  assert.deepEqual(migrationPod.volumes.map(volume => volume.name), ['datastore-ca']);
  assert.deepEqual(pod.volumes.filter(volume => volume.name !== 'datastore-ca'), baseline.volumes ?? [],
    'Existing Azure CSI/Google identity or CN volumes are preserved');
  assert.deepEqual(pod.containers[0].volumeMounts.filter(mount => mount.name !== 'datastore-ca'),
    baseline.containers[0].volumeMounts ?? []);
}
const dedicatedWithoutCa = render([...ack, ...job]).find(resource => resource.kind === 'Job')
  .spec.template.spec;
assert.equal(dedicatedWithoutCa.containers[0].envFrom, undefined);
assert.equal(dedicatedWithoutCa.volumes, undefined);
assert.equal(dedicatedWithoutCa.automountServiceAccountToken, false);
const legacyMigration = render(['--set', 'server.migrationJob.enabled=true', ...overrides({
  'server.migrationJob.revision': 'legacy-fixture',
  'server.migrationJob.backupId': 'legacy-fixture',
})]).find(resource => resource.kind === 'Job').spec.template;
assert.equal(legacyMigration.metadata.labels['azure.workload.identity/use'], 'true');
assert.ok(legacyMigration.spec.serviceAccountName, 'Existing Azure migration identity is preserved');
assert.equal(legacyMigration.spec.automountServiceAccountToken, undefined);
for (const key of ['name', 'key']) {
  render([...ack, ...job, ...datastore, ...noInitMigration, ...overrides({ [`server.migrationJob.databaseSecret.${key}`]: '' })],
    `server.migrationJob.databaseSecret.${key} is required`);
}
for (const prefix of ['sharedEnv', 'server.env']) {
  render([...ack, ...job, ...datastore, ...noInitMigration, ...overrides({ [`${prefix}.DATABASE_URL`]: 'synthetic-rejected-value' })],
    'DATABASE_URL must come only from server.migrationJob.databaseSecret');
}
render([...ack, '--set', 'server.migrationJob.enabled=true', ...datastore, ...noInitMigration, ...overrides({
  'server.migrationJob.revision': 'validation-fixture',
  'server.migrationJob.backupId': 'validation-fixture',
})], 'server.migrationJob.databaseSecret.name is required');
render([...ack, ...datastore], 'server.migrateOnStart must be false with datastore configuration');
const custom = deployment(render([...ack, ...datastore, ...noInitMigration,
  ...overrides({ 'server.datastore.caMountPath': '/etc/fizzdragon/validation-certs' })])).spec.template.spec;
verifyDatastore(custom, custom.containers, '/etc/fizzdragon/validation-certs');

const runtimeDatabase = overrides({
  'server.datastore.databaseSecret.name': 'validation-runtime-database',
  'server.datastore.databaseSecret.key': 'DATABASE_URL',
});
const scoped = deployment(render([...ack, ...datastore, ...noInitMigration, ...runtimeDatabase,
  ...overrides({ 'server.extraSecretRefs[0]': 'optional-legacy-bundle' })])).spec.template.spec;
assert.deepEqual(scoped.containers[0].env.filter(entry => entry.name === 'DATABASE_URL'), [
  { name: 'DATABASE_URL', valueFrom: { secretKeyRef: {
    name: 'validation-runtime-database', key: 'DATABASE_URL', optional: false,
  } } },
], 'Explicit required runtime connection overrides all envFrom sources');
assert.ok(scoped.containers[0].envFrom.some(ref => ref.secretRef?.name === 'optional-legacy-bundle'));
for (const key of ['name', 'key']) {
  render([...ack, ...datastore, ...noInitMigration, ...runtimeDatabase,
    ...overrides({ [`server.datastore.databaseSecret.${key}`]: '' })],
  `server.datastore.databaseSecret.${key} is required`);
}
for (const prefix of ['sharedEnv', 'server.env']) {
  render([...ack, ...datastore, ...noInitMigration, ...runtimeDatabase,
    ...overrides({ [`${prefix}.DATABASE_URL`]: 'synthetic-rejected-value' })],
  'DATABASE_URL must come only from server.datastore.databaseSecret');
}
render([...ack, ...runtimeDatabase, ...noInitMigration], 'server.datastore.configMapName is required');

for (const args of [[], [...job, '--set', 'server.enabled=false']]) {
  render([...args, ...noInitMigration, ...overrides({ 'server.datastore.configMapName': 'validation-datastore' })],
    'server.datastore.caConfigMapName is required');
  render([...args, ...noInitMigration, ...overrides({ 'server.datastore.caConfigMapName': 'validation-datastore-ca' })],
    'server.datastore.configMapName is required');
  render([...args, ...datastore, ...noInitMigration, ...overrides({ 'server.datastore.caMountPath': '' })],
    'server.datastore.caMountPath is required');
  render([...args, ...datastore, ...noInitMigration, ...overrides({ 'server.datastore.caMountPath': 'relative/certs' })],
    'server.datastore.caMountPath must be an absolute path');
}
console.log('Datastore render checks passed: COM/CN/ACK, dedicated migration credentials, required pairs, read-only CA.');
JS
