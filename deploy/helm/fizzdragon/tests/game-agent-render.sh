#!/usr/bin/env bash
# Render contract for the private, single-writer official Harness worker.
# Uses the repository's Node/YAML dependency; never contacts a cloud or cluster.
set -euo pipefail

CHART="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHART/../../.."
export GAME_AGENT_RENDER_CHART="$CHART"

node <<'NODE'
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { parseAllDocuments } = require('yaml');

const chart = process.env.GAME_AGENT_RENDER_CHART;
const release = 'render-harness';
const namespace = 'render-harness';
const revision = '0123456789abcdef0123456789abcdef01234567';
const providerSecret = 'render-harness-provider';
const tokenSecret = 'render-harness-token';
const origin = 'https://studio.example.test';
const fixture = [
  '--set', 'azure.enabled=false',
  '--set', 'server.googleVertex.enabled=false',
  '--set', 'gameAgent.enabled=true',
  '--set-string', `gameAgent.image.tag=${revision}`,
  '--set-string', 'gameAgent.persistence.storageClassName=render-rwo',
  '--set-string', 'gameAgent.model.name=render-model',
  '--set-string', 'gameAgent.model.baseUrl=https://models.example.test/v1',
  '--set', 'gameAgent.model.thinking=true',
  '--set', 'gameAgent.model.maxTokens=16384',
  '--set-string', `gameAgent.studioOrigin=${origin}`,
  '--set-string', `gameAgent.secrets.apiKey.name=${providerSecret}`,
  '--set-string', `gameAgent.secrets.internalToken.name=${tokenSecret}`,
];

const ok = (message) => console.log(`  ok — ${message}`);
function run(extra = [], releaseName = release) {
  const result = spawnSync('helm', [
    'template', releaseName, chart, '--namespace', namespace, ...extra,
  ], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}
function render(extra = [], releaseName = release) {
  const result = run(extra, releaseName);
  assert.equal(result.status, 0, result.stderr);
  return parseAllDocuments(result.stdout).map((document) => {
    assert.deepEqual(document.errors, [], 'rendered manifests must be valid YAML');
    return document.toJSON();
  }).filter(Boolean);
}
function one(documents, kind, name) {
  const found = documents.filter((document) =>
    document.kind === kind && document.metadata.name === name);
  assert.equal(found.length, 1, `exactly one ${kind}/${name}`);
  return found[0];
}
function container(documents, name) {
  return one(documents, 'Deployment', name).spec.template.spec.containers[0];
}
function env(container, name) {
  const values = (container.env ?? []).filter((entry) => entry.name === name);
  assert.equal(values.length, 1, `one unambiguous ${name}`);
  return values[0];
}
function failRender(message, setting, value, diagnostic = setting) {
  const typed = new Set([
    'gameAgent.replicaCount', 'gameAgent.persistence.enabled', 'azure.enabled',
    'server.enabled', 'gameAgent.terminationGracePeriodSeconds', 'gameAgent.containerPort',
  ]);
  const result = run([...fixture, typed.has(setting) ? '--set' : '--set-string', `${setting}=${value}`]);
  assert.notEqual(result.status, 0, `${message}: render unexpectedly succeeded`);
  assert.ok(result.stderr.includes(diagnostic),
    `${message}: expected actionable ${diagnostic} diagnostic, got ${result.stderr}`);
  ok(`rejected: ${message}`);
}
function assertDisabled(documents, label) {
  assert.equal(documents.some((document) =>
    document.metadata?.labels?.['app.kubernetes.io/component'] === 'game-agent' ||
    document.metadata?.name?.startsWith(`${release}-game-agent`)), false,
  `${label}: no worker workload, volume or Service`);
  const server = container(documents, `${release}-server`);
  assert.equal((server.env ?? []).some((entry) => entry.name.startsWith('GAME_AGENT_')), false,
    `${label}: disabled mode does not alter server feature configuration`);
  assert.equal(JSON.stringify(server).includes(providerSecret), false);
  assert.equal(JSON.stringify(server).includes(tokenSecret), false);
}

console.log('game-agent render contract');
const defaults = render();
assertDisabled(defaults, 'default');
ok('default render has no Harness resources, configuration or Secret dependencies');
const cn = render(['-f', `${chart}/values.cn-prod.yaml`]);
const cnWorker = container(cn, `${release}-game-agent`);
const cnServer = container(cn, `${release}-server`);
const cnStudioHost = readFileSync('apps/web/.env.production.cn', 'utf8')
  .match(/^NEXT_PUBLIC_STUDIO_HOST=(\S+)$/m)?.[1];
assert.ok(cnStudioHost, 'CN Studio host is explicitly configured');
assert.equal(env(cnServer, 'GAME_AGENT_STUDIO_ORIGIN').value, `https://${cnStudioHost}`);
assert.equal(env(cnWorker, 'GAME_AGENT_MODEL').value, 'qwen3.8-max-0902');
assert.equal(env(cnWorker, 'GAME_AGENT_OPENAI_BASE_URL').value,
  'https://dashscope.aliyuncs.com/compatible-mode/v1');
assert.deepEqual(env(cnWorker, 'GAME_AGENT_OPENAI_API_KEY').valueFrom.secretKeyRef,
  { name: 'fizzdragon-game-agent-provider', key: 'GAME_AGENT_OPENAI_API_KEY' });
assert.deepEqual(env(cnWorker, 'GAME_AGENT_INTERNAL_TOKEN').valueFrom.secretKeyRef,
  { name: 'fizzdragon-game-agent-internal', key: 'GAME_AGENT_INTERNAL_TOKEN' });
assert.equal(one(cn, 'PersistentVolumeClaim', `${release}-game-agent-workspaces`)
  .spec.storageClassName, 'alicloud-disk-essd');
ok('CN enables Harness with regional credentials, storage, model and the actual Studio origin');

const documents = render(fixture);
const name = `${release}-game-agent`;
const workload = one(documents, 'Deployment', name);
const service = one(documents, 'Service', name);
const worker = workload.spec.template.spec.containers[0];
const pod = workload.spec.template.spec;
const volumes = documents.filter((document) => document.kind === 'PersistentVolumeClaim' &&
  (document.metadata.labels?.['app.kubernetes.io/component'] === 'game-agent' ||
    document.metadata.name.startsWith(name)));
assert.equal(volumes.length, 1, 'one persistent workspace claim');
const pvc = volumes[0];
assert.equal(workload.spec.replicas, 1);
assert.equal(workload.spec.strategy.type, 'Recreate');
assert.equal(workload.spec.strategy.rollingUpdate, undefined);
assert.deepEqual(pvc.spec.accessModes, ['ReadWriteOnce']);
assert.equal(pvc.spec.storageClassName, 'render-rwo');
assert.equal(pvc.spec.resources.requests.storage, '20Gi');
assert.equal(pvc.metadata.annotations['helm.sh/resource-policy'], 'keep');
const workspaceVolume = pod.volumes.find((volume) =>
  volume.persistentVolumeClaim?.claimName === pvc.metadata.name);
assert.ok(workspaceVolume, 'worker mounts its retained claim');
assert.equal(worker.volumeMounts.find((mount) => mount.name === workspaceVolume.name).mountPath,
  '/var/lib/game-agent/workspaces');
assert.equal(env(worker, 'GAME_AGENT_WORKSPACE_ROOT').value,
  '/var/lib/game-agent/workspaces/sessions');
assert.ok(pod.terminationGracePeriodSeconds >= 30);
ok('one writer uses Recreate and a retained RWO workspace, with a private sessions child directory');

assert.equal(pod.automountServiceAccountToken, false);
assert.equal(pod.enableServiceLinks, false);
assert.deepEqual(pod.securityContext, {
  runAsNonRoot: true,
  runAsUser: 1001,
  runAsGroup: 1001,
  fsGroup: 1001,
  fsGroupChangePolicy: 'OnRootMismatch',
  seccompProfile: { type: 'RuntimeDefault' },
});
assert.equal(worker.securityContext.allowPrivilegeEscalation, false);
assert.equal(worker.securityContext.readOnlyRootFilesystem, true);
assert.deepEqual(worker.securityContext.capabilities.drop, ['ALL']);
assert.equal(pod.initContainers, undefined, 'no privileged ownership/chown initializer');
assert.equal(pod.volumes.some((volume) => volume.csi || volume.hostPath), false,
  'no unrelated Key Vault CSI or host filesystem access');
assert.equal(pod.volumes.length, 2, 'only workspace and temporary storage');
const temporary = pod.volumes.find((volume) => volume.emptyDir);
assert.ok(temporary?.emptyDir.sizeLimit, 'temporary storage is bounded');
assert.equal(worker.volumeMounts.find((mount) => mount.name === temporary.name).mountPath, '/tmp');
ok('image UID, group-owned PVC and RuntimeDefault confinement require no privileged initializer or cloud identity');

assert.equal(service.spec.type, 'ClusterIP');
assert.equal(service.spec.externalIPs, undefined);
assert.equal(service.spec.loadBalancerIP, undefined);
assert.equal(service.spec.ports.length, 1);
assert.equal(service.spec.ports[0].port, 4396);
assert.equal(service.spec.ports[0].targetPort, 'http');
assert.equal(service.spec.ports[0].nodePort, undefined);
assert.deepEqual(service.spec.selector, workload.spec.selector.matchLabels);
for (const [key, value] of Object.entries(service.spec.selector))
  assert.equal(workload.spec.template.metadata.labels[key], value, 'Service selects the worker Pod');
assert.equal(worker.ports.length, 1);
assert.equal(worker.ports[0].name, 'http');
assert.equal(worker.ports[0].containerPort, 4396);
assert.equal(worker.ports[0].hostPort, undefined);
assert.equal(pod.hostNetwork, undefined);
assert.equal(env(worker, 'GAME_AGENT_BIND_ADDRESS').value, '0.0.0.0');
assert.equal(env(worker, 'GAME_AGENT_PORT').value, '4396');
const ingress = (items) => items.filter((document) => document.kind === 'Ingress');
assert.deepEqual(ingress(documents), ingress(defaults), 'enabling Harness adds no ingress or public path');
assert.equal(documents.some((document) => document.kind === 'Secret'), false,
  'chart references pre-created scoped Secrets; it never renders credentials');
for (const probe of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
  assert.equal(worker[probe].httpGet.path, '/health');
  assert.equal(worker[probe].httpGet.port, 'http');
}
ok('worker is private ClusterIP only, with health probes and no added ingress or credentials');

assert.equal(worker.envFrom, undefined, 'worker cannot inherit broad server/provider bundles');
assert.deepEqual(env(worker, 'GAME_AGENT_OPENAI_API_KEY').valueFrom.secretKeyRef,
  { name: providerSecret, key: 'GAME_AGENT_OPENAI_API_KEY' });
assert.deepEqual(env(worker, 'GAME_AGENT_INTERNAL_TOKEN').valueFrom.secretKeyRef,
  { name: tokenSecret, key: 'GAME_AGENT_INTERNAL_TOKEN' });
assert.deepEqual(worker.env.filter((entry) => entry.valueFrom).map((entry) => entry.name).sort(),
  ['GAME_AGENT_INTERNAL_TOKEN', 'GAME_AGENT_OPENAI_API_KEY']);
assert.equal(env(worker, 'GAME_AGENT_MODEL').value, 'render-model');
assert.equal(env(worker, 'GAME_AGENT_OPENAI_BASE_URL').value, 'https://models.example.test/v1');
assert.equal(env(worker, 'GAME_AGENT_THINKING').value, 'true');
assert.equal(env(worker, 'GAME_AGENT_MAX_TOKENS').value, '16384');
const server = container(documents, `${release}-server`);
assert.equal(env(server, 'GAME_AGENT_ENABLED').value, 'true');
assert.equal(env(server, 'GAME_AGENT_WORKER_URL').value, `http://${name}:4396`);
assert.equal(env(server, 'GAME_AGENT_STUDIO_ORIGIN').value, origin);
assert.deepEqual(env(server, 'GAME_AGENT_INTERNAL_TOKEN').valueFrom.secretKeyRef,
  { name: tokenSecret, key: 'GAME_AGENT_INTERNAL_TOKEN' });
assert.equal(JSON.stringify(server).includes(providerSecret), false,
  'server never receives the Harness provider Secret');
assert.equal(JSON.stringify(server).includes('GAME_AGENT_OPENAI_API_KEY'), false);
assert.equal((server.envFrom ?? []).some((entry) => entry.secretRef?.name === tokenSecret), false,
  'server selects only the internal-token key');
const renamed = render(fixture, 'other-release');
assert.equal(env(container(renamed, 'other-release-server'), 'GAME_AGENT_WORKER_URL').value,
  'http://other-release-game-agent:4396', 'gateway endpoint follows the actual rendered Service');
ok('provider credentials stay on the worker; Nest receives only its internal token and a derived Service URL');

for (const setting of [
  'image.registry',
  'gameAgent.image.repository',
  'gameAgent.image.tag',
  'gameAgent.model.name',
  'gameAgent.model.baseUrl',
  'gameAgent.persistence.storageClassName',
  'gameAgent.studioOrigin',
  'gameAgent.secrets.apiKey.name',
  'gameAgent.secrets.internalToken.name',
]) failRender(`missing ${setting}`, setting, '');
failRender('multiple writers', 'gameAgent.replicaCount', '2');
failRender('ephemeral workspace', 'gameAgent.persistence.enabled', 'false');
failRender('mutable image', 'gameAgent.image.tag', 'latest');
failRender('Azure identity inheritance', 'azure.enabled', 'true', 'gameAgent');
failRender('worker without the authenticating server', 'server.enabled', 'false', 'server.enabled');
failRender('public origin with a path', 'gameAgent.studioOrigin', `${origin}/canvas`);
failRender('plaintext production origin', 'gameAgent.studioOrigin', 'http://studio.example.test');
failRender('shared provider and internal-token Secret', 'gameAgent.secrets.apiKey.name', tokenSecret,
  'Secret names must be distinct');
failRender('wrong provider Secret key', 'gameAgent.secrets.apiKey.key', 'API_KEY');
failRender('wrong internal-token Secret key', 'gameAgent.secrets.internalToken.key', 'TOKEN');
failRender('insufficient shutdown grace', 'gameAgent.terminationGracePeriodSeconds', '5');
failRender('wrong worker listener port', 'gameAgent.containerPort', '4397');
failRender('non-boolean enable switch', 'gameAgent.enabled', 'true');
failRender('provider URL with credentials', 'gameAgent.model.baseUrl', 'https://key@models.example.test/v1');
failRender('provider URL with query parameters', 'gameAgent.model.baseUrl', 'https://models.example.test/v1?key=ignored');
for (const key of ['GAME_AGENT_ENABLED', 'GAME_AGENT_WORKER_URL', 'GAME_AGENT_INTERNAL_TOKEN', 'GAME_AGENT_STUDIO_ORIGIN']) {
  for (const source of ['sharedEnv', 'server.env'])
    failRender(`untrusted ${source} override of ${key}`, `${source}.${key}`, 'ignored', key);
}

console.log('game-agent render contract: all checks passed');
NODE
