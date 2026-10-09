"""Committed per-service build identities shared by regional release planners."""
from functools import lru_cache
import hashlib
import json
import re
import subprocess

SERVICES = ('web', 'server', 'studio', 'admin-ui', 'agent', 'agent-os', 'game-agent')
SHA = re.compile(r'^[0-9a-f]{40}$')

def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True,
                          capture_output=True).stdout

@lru_cache(maxsize=256)
def inputs(root, revision, service, region):
    if region not in ("cn", "com"):
        raise ValueError("Invalid region")
    if service not in SERVICES or not SHA.fullmatch(revision):
        raise ValueError('Invalid image input identity')
    entries = git(root, 'ls-tree', '-r', '-z', revision).split(b'\0')
    # Resolve workspace dependencies at each revision rather than assuming every
    # shared package's implementation participates in every service build.
    manifests = {}
    for entry in entries:
        if not entry:
            continue
        _, path_bytes = entry.split(b'\t', 1)
        path = path_bytes.decode()
        if re.fullmatch(r'(apps|packages)/[^/]+/package.json', path):
            value = json.loads(git(root, 'show', f'{revision}:{path}'))
            manifests[path.rsplit('/', 1)[0]] = value
    by_name = {value.get('name'): path for path, value in manifests.items() if value.get('name')}
    included = {f'apps/{service}'}
    pending = list(included)
    while pending:
        path = pending.pop()
        value = manifests.get(path, {})
        for kind in ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'):
            for name in value.get(kind, {}):
                dependency = by_name.get(name)
                if dependency and dependency not in included:
                    included.add(dependency)
                    pending.append(dependency)
    # Old/unknown layouts are conservative rather than silently under-scoped.
    known_layout = f'apps/{service}' in manifests
    selected = []
    for entry in entries:
        if not entry:
            continue
        metadata, raw_path = entry.split(b'\t', 1)
        path = raw_path.decode()
        if path.startswith(('docs/', '.github/')) or ('/' not in path and path.endswith('.md')):
            continue
        if path.startswith('deploy/'):
            continue
        if path.startswith('packages/') and known_layout:
            workspace = '/'.join(path.split('/')[:2])
            if workspace not in included and not path.endswith('/package.json'):
                continue
        if path.startswith('apps/'):
            # npm ci consumes every workspace manifest even for a pruned build.
            if not ('/'.join(path.split('/')[:2]) in included or path.endswith('/package.json')):
                # Web's regional env supplies build arguments for Studio too.
                if not (service == 'studio' and path == f'apps/web/.env.production.{region}'):
                    continue
            if path.startswith('apps/web/.env.production.') and path != f'apps/web/.env.production.{region}':
                continue
        workspace = path.rsplit("/", 1)[0]
        if path.endswith("/package.json") and workspace in manifests and workspace not in included:
            # Entry points/documentation of an unconsumed workspace do not affect
            # installation. Keep every other field conservatively (including
            # version, dependency declarations, engines and lifecycle scripts).
            manifest = dict(manifests[workspace])
            for key in ("main", "description", "homepage", "bugs", "keywords"):
                manifest.pop(key, None)
            entry = raw_path + b"\0" + json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        selected.append(entry)
    # Include build arguments/recipe, but not publication, chart or polling code.
    recipe_path = "deploy/cn-remote-build-services.sh" if region == "cn" else "deploy/aliyun-sg/production-build.py"
    recipe = git(root, "show", f"{revision}:{recipe_path}")
    return hashlib.sha256(region.encode() + b'\0' + service.encode() + b'\0' + b'\0'.join(selected) + recipe).hexdigest()

