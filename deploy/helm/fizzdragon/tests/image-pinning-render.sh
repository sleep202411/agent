#!/usr/bin/env bash
# Local render contract only. No image registry, cluster or database calls.
set -euo pipefail
CHART="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHART/../../.."
FIZZDRAGON_IMAGE_CHART="$CHART" node <<'JS'
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { parse, parseAllDocuments } = require('yaml');
const chart = process.env.FIZZDRAGON_IMAGE_CHART;
const defaults = parse(readFileSync(`${chart}/values.yaml`, 'utf8'));
const components = ['server', 'studio', 'gameAgent', 'web', 'adminUi', 'agentOs'];
const digests = Object.fromEntries(components.map((component, index) => [component, `sha256:${String(index + 1).repeat(64)}`]));
const worker = ['--set', 'azure.enabled=false', '--set', 'server.googleVertex.enabled=false',
  '--set', 'gameAgent.enabled=true', '--set-string', 'gameAgent.image.tag=0123456789abcdef',
  '--set-string', 'gameAgent.persistence.storageClassName=fixture-private-disk',
  '--set-string', 'gameAgent.model.name=fixture-model',
  '--set-string', 'gameAgent.model.baseUrl=https://model.example.test/v1',
  '--set-string', 'gameAgent.studioOrigin=https://studio.example.test',
  '--set-string', 'gameAgent.secrets.apiKey.name=fixture-provider',
  '--set-string', 'gameAgent.secrets.internalToken.name=fixture-internal'];
function render(args = [], error) {
  const result = spawnSync('helm', ['template', 'image-contract', chart, '-n', 'fizzdragon', ...args], { encoding: 'utf8' });
  if (error) {
    assert.notEqual(result.status, 0, 'Unsafe image or Pod access input must fail rendering');
    assert.ok(result.stderr.includes(error), result.stderr);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  return parseAllDocuments(result.stdout).map(document => {
    assert.deepEqual(document.errors, []);
    return document.toJSON();
  }).filter(Boolean);
}
function pod(resources, component) {
  return resources.find(item => item.kind === 'Deployment' && item.metadata.name === `image-contract-${component}`).spec.template.spec;
}
const ordinary = render();
for (const component of ['server', 'studio']) {
  const actual = pod(ordinary, component);
  assert.equal(actual.containers[0].image,
    `${defaults.image.registry}/${defaults[component].image.repository}:${defaults[component].image.tag}`);
  assert.equal(actual.automountServiceAccountToken, undefined, 'Existing cell token behavior stays unchanged');
  assert.equal(actual.enableServiceLinks, undefined, 'Existing cell service-link behavior stays unchanged');
}
assert.equal(pod(ordinary, 'server').initContainers[0].image, pod(ordinary, 'server').containers[0].image);
const pinned = render([...worker, ...components.flatMap(component => ['--set-string', `${component}.image.digest=${digests[component]}`])]);
for (const component of components) {
  const deploymentComponent = { gameAgent: 'game-agent', adminUi: 'admin-ui', agentOs: 'agent-os' }[component] || component;
  const actual = pod(pinned, deploymentComponent);
  assert.equal(actual.containers[0].image, `${defaults.image.registry}/${defaults[component].image.repository}@${digests[component]}`);
}
assert.equal(pod(pinned, 'server').initContainers[0].image, pod(pinned, 'server').containers[0].image);
const migration = render(['--set-string', `server.image.digest=${digests.server}`,
  '--set', 'server.migrationJob.enabled=true', '--set-string', 'server.migrationJob.revision=fixture',
  '--set-string', 'server.migrationJob.backupId=fixture']);
assert.equal(migration.find(item => item.kind === 'Job').spec.template.spec.containers[0].image,
  pod(migration, 'server').containers[0].image, 'Separate migration Job uses the same Server digest');
for (const component of components) {
  for (const invalid of ['sha256:short', `sha256:${'A'.repeat(64)}`, `sha512:${'1'.repeat(64)}`, `sha256:${'1'.repeat(64)} `]) {
    render([...worker, '--set-string', `${component}.image.digest=${invalid}`], `${component}.image.digest`);
  }
  render([...worker, '--set', `${component}.image.digest=false`], `${component}.image.digest`);
}
for (const component of ['server', 'studio']) {
  const disabled = pod(render(['--set', `${component}.automountServiceAccountToken=false`,
    '--set', `${component}.enableServiceLinks=false`]), component);
  assert.equal(disabled.automountServiceAccountToken, false);
  assert.equal(disabled.enableServiceLinks, false);
  for (const option of ['automountServiceAccountToken', 'enableServiceLinks']) {
    render(['--set-string', `${component}.${option}=false`], `${component}.${option}`);
  }
}
console.log('Image pinning contract passed: exact digests, unchanged default tags, migration consistency and Pod access guards.');
JS
