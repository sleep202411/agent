#!/usr/bin/env python3
"""Build and update selected .com services in the existing Singapore cluster.

No Git writes, Helm reinstall, configuration replacement or DNS changes. A
Server update first runs native Prisma migrations using the existing DB admin
Secret inside the cluster. All other workload fields remain unchanged.
"""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
SERVICES = ('server', 'agent-os', 'game-agent', 'studio', 'web', 'admin-ui')
REGISTRY = 'fizzdragon-com-sg-registry-vpc.ap-southeast-1.cr.aliyuncs.com/fizzdragon'
NS_UID = '249a9075-37f2-4c41-aefc-050edd800e63'
PVC = 'fizzdragon-game-agent-workspaces'
PVC_UID = '9948697c-65de-4146-b279-2d4bf657d4da'
MIGRATION_SCRIPT = Path(__file__).with_name('production-migrate.cjs').read_text(encoding='utf-8')


class DeployError(Exception):
    """Locally authored errors; raw CLI output can contain credentials."""


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


preflight = load_module('sg_preflight', 'harness-preflight.py')
builder = load_module('sg_production_build', 'production-build.py')


def command(argv, data=None, timeout=45):
    try:
        result = subprocess.run(argv, input=data, capture_output=True, text=True,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise DeployError(f'{Path(argv[0]).name} timed out; inspect any existing Job/rollout before retrying') from None
    except OSError:
        raise DeployError(f'{Path(argv[0]).name} is unavailable') from None
    if result.returncode:
        raise DeployError(f'{Path(argv[0]).name} operation failed; inspect the named Job/Deployment before retrying')
    return result.stdout


def pinned_image(service, value):
    if service not in SERVICES:
        raise DeployError(f'Unsupported service: {service}')
    prefix = f'{REGISTRY}/fizzdragon-{service}@'
    if re.fullmatch(r'sha256:[0-9a-f]{64}', value):
        return prefix + value
    if not re.fullmatch(re.escape(prefix) + r'sha256:[0-9a-f]{64}', value):
        raise DeployError(f'{service} requires its Singapore VPC repository and an immutable sha256 digest')
    return value


def read(kube, kind, name=None):
    return json.loads(kube(['get', kind, *([name] if name else []), '-o', 'json']))


def verify_live(kube):
    namespace = read(kube, 'namespace', 'fizzdragon')
    if (namespace['metadata']['uid'] != NS_UID or namespace['metadata'].get('deletionTimestamp')
            or namespace.get('status', {}).get('phase') != 'Active'):
        raise DeployError('The existing Singapore production namespace does not match')
    objects = read(kube, 'deployment')['items']
    expected_names = {f'fizzdragon-{service}' for service in SERVICES}
    if len(objects) != len(SERVICES) or {x['metadata']['name'] for x in objects} != expected_names:
        raise DeployError('The six production Deployments do not match; reconcile the inventory first')
    deployments = {}
    for obj in objects:
        service = obj['metadata']['name'].removeprefix('fizzdragon-')
        pod = obj['spec']['template']['spec']
        containers = pod['containers']
        if (len(containers) != 1 or containers[0]['name'] != service
                or not obj['metadata'].get('uid') or not obj['metadata'].get('resourceVersion')
                or obj['metadata'].get('deletionTimestamp')):
            raise DeployError(f'Unexpected production workload structure: {service}')
        pinned_image(service, containers[0]['image'])
        desired, status = obj['spec'].get('replicas', 1), obj.get('status', {})
        if (desired < 1 or status.get('observedGeneration', 0) < obj['metadata']['generation']
                or any(status.get(field, 0) != desired for field in
                       ('replicas', 'readyReplicas', 'updatedReplicas', 'availableReplicas'))):
            raise DeployError(f'{service} is not fully ready; finish the existing rollout first')
        entries = containers[0].get('env', [])
        env = {entry['name']: entry for entry in entries}
        if len(env) != len(entries):
            raise DeployError(f'Duplicate environment variables: {service}')
        databases = {'server': ('DATABASE_URL', 'fizzdragon-secrets'),
                     'agent-os': ('AGENT_OS_CHECKPOINT_DATABASE_URL', 'fizzdragon-agent-os-secrets')}
        if service in databases:
            key, secret = databases[service]
            ref = env.get(key, {}).get('valueFrom', {}).get('secretKeyRef', {})
            if ref.get('name') != secret or ref.get('key') != key or ref.get('optional', False):
                raise DeployError(f'{service} must use the existing canonical database Secret')
        if service == 'server' and any(env.get(key, {}).get('value') != 'true' for key in
                                      ('BACKGROUND_TASKS_ENABLED', 'AGENT_OS_ENABLED', 'GAME_AGENT_ENABLED')):
            raise DeployError('Production background tasks, Agent OS and Harness must remain enabled')
        if service == 'game-agent':
            volumes = {volume['name'] for volume in pod.get('volumes', [])
                       if volume.get('persistentVolumeClaim', {}).get('claimName') == PVC
                       and not volume.get('persistentVolumeClaim', {}).get('readOnly', False)}
            mounted = any(mount.get('name') in volumes
                          and mount.get('mountPath') == '/var/lib/game-agent/workspaces'
                          and not mount.get('readOnly', False) and not mount.get('subPath')
                          and not mount.get('subPathExpr')
                          for mount in containers[0].get('volumeMounts', []))
            if desired != 1 or obj['spec'].get('strategy', {}).get('type') != 'Recreate' or not mounted:
                raise DeployError('Harness must retain one Recreate worker with its existing writable workspace PVC')
        deployments[service] = obj
    workspace = read(kube, 'pvc', PVC)
    if (workspace['metadata']['uid'] != PVC_UID or workspace['metadata'].get('deletionTimestamp')
            or workspace.get('status', {}).get('phase') != 'Bound'):
        raise DeployError('The existing Harness workspace volume does not match')
    return deployments


def image_patch(obj, image):
    patch = [
        {'op': 'test', 'path': '/metadata/uid', 'value': obj['metadata']['uid']},
        {'op': 'test', 'path': '/metadata/resourceVersion', 'value': obj['metadata']['resourceVersion']},
        {'op': 'replace', 'path': '/spec/template/spec/containers/0/image', 'value': image},
    ]
    # Preserve an existing migration init container, if a reviewed release adds
    # one later. Never create it or change its credentials/command here.
    if obj['metadata']['name'] == 'fizzdragon-server':
        for index, container in enumerate(obj['spec']['template']['spec'].get('initContainers', [])):
            if container['name'] == 'db-migrate':
                patch.append({'op': 'replace', 'path': f'/spec/template/spec/initContainers/{index}/image', 'value': image})
    return patch


def migration_job(server, image, name):
    source_pod = server['spec']['template']['spec']
    source_container = source_pod['containers'][0]
    container = {
        'name': 'db-migrate', 'image': image, 'imagePullPolicy': 'IfNotPresent',
        'command': ['node', '-e', MIGRATION_SCRIPT],
        'workingDir': '/app/apps/server',
        'env': [
            {'name': env, 'valueFrom': {'secretKeyRef': {'name': secret, 'key': key, 'optional': False}}}
            for env, secret, key in (
                ('DATABASE_URL', 'fizzdragon-secrets', 'DATABASE_URL'),
                ('PGADMIN_USER', 'fizzdragon-db-admin', 'PGUSER'),
                ('PGADMIN_PASSWORD', 'fizzdragon-db-admin', 'PGPASSWORD'),
            )
        ] + [{'name': 'DOTENV_CONFIG_PATH', 'value': '/dev/null'}],
        'volumeMounts': [{'name': 'datastore-ca', 'mountPath': '/etc/fizzdragon/certs', 'readOnly': True},
                         {'name': 'tmp', 'mountPath': '/tmp'}],
    }
    for key in ('resources', 'securityContext'):
        if key in source_container:
            container[key] = copy.deepcopy(source_container[key])
    pod = {
        'restartPolicy': 'Never', 'automountServiceAccountToken': False, 'enableServiceLinks': False,
        'containers': [container],
        'volumes': [{'name': 'datastore-ca', 'configMap': {'name': 'fizzdragon-datastore-ca', 'optional': False}},
                    {'name': 'tmp', 'emptyDir': {}}],
    }
    for key in ('imagePullSecrets', 'nodeSelector', 'tolerations', 'securityContext'):
        if key in source_pod:
            pod[key] = copy.deepcopy(source_pod[key])
    return {
        'apiVersion': 'batch/v1', 'kind': 'Job',
        'metadata': {'name': name, 'namespace': 'fizzdragon'},
        'spec': {'backoffLimit': 0, 'activeDeadlineSeconds': 600, 'ttlSecondsAfterFinished': 86400,
                 'template': {'metadata': {'labels': {'app.kubernetes.io/name': 'fizzdragon',
                              'app.kubernetes.io/instance': 'fizzdragon',
                              'app.kubernetes.io/component': 'db-migrate'}}, 'spec': pod}},
    }


def migrate(kube, server, image):
    name = 'fizzdragon-db-migrate-' + uuid.uuid4().hex[:12]
    print(f'Running native Prisma migrations: {name}', flush=True)
    kube(['create', '-f', '-', '-o', 'name'], data=json.dumps(migration_job(server, image, name)))
    deadline = time.monotonic() + 660
    while time.monotonic() < deadline:
        status = read(kube, 'job', name).get('status', {})
        conditions = {x['type'] for x in status.get('conditions', []) if x.get('status') == 'True'}
        if 'Failed' in conditions:
            raise DeployError(f'Migration failed; no application images changed. Inspect Job {name} logs before retrying')
        if 'Complete' in conditions:
            kube(['delete', 'job', name, '--wait=true', '--timeout=30s', '-o', 'name'])
            return
        time.sleep(2)
    raise DeployError(f'Migration timed out; no application images changed. Inspect Job {name} before retrying')


def unchanged(before, current):
    if any(before[s]['metadata']['uid'] != current[s]['metadata']['uid']
           or before[s]['spec'] != current[s]['spec'] for s in SERVICES):
        raise DeployError('Production changed during this release; stopped to avoid overwriting another deployment')


def verify_permissions(kube, services, migrate_server=False):
    """Check existing Kubernetes access before spending time building images."""
    operations = [(verb, f'deployments.apps/fizzdragon-{service}')
                  for service in SERVICES if service in services
                  for verb in ('patch', 'watch')]
    if migrate_server:
        operations += [(verb, 'jobs.batch') for verb in ('create', 'get', 'delete')]
    for verb, resource in operations:
        try:
            allowed = kube(['auth', 'can-i', verb, resource]).strip() == 'yes'
        except DeployError:
            raise DeployError(f'Cannot confirm permission to {verb} {resource} in fizzdragon; '
                              'check this kubeconfig access and connectivity before publishing') from None
        if not allowed:
            raise DeployError(f'This kubeconfig does not allow {verb} {resource} in fizzdragon; '
                              'use the existing administrator access before publishing')


def deploy(kube, images, before):
    images = {service: pinned_image(service, image) for service, image in images.items()}
    changed = [s for s in SERVICES if s in images
               and images[s] != before[s]['spec']['template']['spec']['containers'][0]['image']]
    for service in changed:
        kube(['patch', 'deployment', f'fizzdragon-{service}', '--type=json',
              '-p', json.dumps(image_patch(before[service], images[service])), '--dry-run=server', '-o', 'name'])
    unchanged(before, verify_live(kube))
    if 'server' in changed:
        migrate(kube, before['server'], images['server'])
    expected = copy.deepcopy(before)
    for service in changed:
        current = verify_live(kube)
        unchanged(expected, current)
        kube(['patch', 'deployment', f'fizzdragon-{service}', '--type=json',
              '-p', json.dumps(image_patch(current[service], images[service])), '-o', 'name'])
        print(f'Waiting for {service} rollout', flush=True)
        kube(['rollout', 'status', f'deployment/fizzdragon-{service}', '--timeout=300s'], timeout=330)
        pod = expected[service]['spec']['template']['spec']
        pod['containers'][0]['image'] = images[service]
        if service == 'server':
            for container in pod.get('initContainers', []):
                if container['name'] == 'db-migrate':
                    container['image'] = images[service]
        print(f'{service}: ready at {images[service]}', flush=True)
    unchanged(expected, verify_live(kube))
    return changed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('services', nargs='*', help='web studio admin-ui server agent-os game-agent, or all')
    parser.add_argument('--kubeconfig', default=os.environ.get('KUBECONFIG'), help='One existing Singapore kubeconfig file')
    parser.add_argument('--image', action='append', default=[], metavar='SERVICE=DIGEST', help='Deploy an already reviewed image instead of building')
    parser.add_argument('--check', action='store_true', help='Read-only identity and existing workload checks; no build/deployment')
    parser.add_argument('--npm-registry', default=os.environ.get(builder.NPM_REGISTRY_ENV),
                        help='Opt-in npm registry build-arg; unset keeps the Dockerfile default. '
                             f'Also accepted via {builder.NPM_REGISTRY_ENV}.')
    args = parser.parse_args(argv)
    services = list(SERVICES) if args.services == ['all'] else args.services
    if len(set(services)) != len(services) or any(s not in SERVICES for s in services):
        parser.error('Select unique supported services, or all by itself; legacy agent is retired')
    if args.image and services:
        parser.error('Use service builds or --image, not both')
    images = {}
    try:
        for entry in args.image:
            service, separator, image = entry.partition('=')
            if not separator or service in images:
                raise DeployError('--image requires unique SERVICE=DIGEST entries')
            images[service] = pinned_image(service, image)
        if not args.check and not services and not images:
            parser.error('Select services to deploy, or use --check')
        if not args.kubeconfig or os.pathsep in args.kubeconfig or not Path(args.kubeconfig).is_file():
            raise DeployError('Supply one existing Singapore kubeconfig with --kubeconfig or KUBECONFIG')
        source = None if args.check else builder.committed_source(ROOT)
        identity = preflight.verify(args.kubeconfig)
        if identity['namespaceUid'] != NS_UID:
            raise DeployError('The verified namespace is not the existing Singapore production namespace')

        def kube(arguments, data=None, timeout=45):
            return command(['kubectl', '--kubeconfig', args.kubeconfig, '-n', 'fizzdragon',
                            '--request-timeout=30s', *arguments], data, timeout)

        before = verify_live(kube)
        print('Verified Singapore ACK endpoint and existing fizzdragon production namespace', flush=True)
        selected = services or list(images) or (list(SERVICES) if args.check else [])
        migrate_server = 'server' in selected and (
            not images or images.get('server') != before['server']['spec']['template']['spec']['containers'][0]['image'])
        verify_permissions(kube, selected, migrate_server)
        if args.check:
            print('Read-only checks passed: six ready services, immutable images, canonical database references, '
                  'Harness volume and existing Kubernetes publishing permissions.')
            return 0
        if services:
            images = builder.build_images(ROOT, services, {s: obj['spec']['template']['spec']['containers'][0]['image']
                                                         for s, obj in before.items()}, source=source,
                                          npm_registry=args.npm_registry)
        current = verify_live(kube)
        unchanged(before, current)
        changed = deploy(kube, images, current)
        print('Deployment complete: ' + (', '.join(changed) if changed else 'selected images already current'))
        return 0
    except (DeployError, preflight.PreflightError, OSError, ValueError, RuntimeError,
            subprocess.SubprocessError, KeyError, IndexError, TypeError, AttributeError):
        error = sys.exc_info()[1]
        message = str(error) if isinstance(error, (DeployError, preflight.PreflightError, builder.BuildError)) else 'Build or metadata validation failed; no further release steps will run'
        print(f'FAILED: {message}. No automatic rollback; inspect the current release before retrying.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
