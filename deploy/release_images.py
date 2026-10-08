#!/usr/bin/env python3
"""Find existing regional images by committed service build inputs, across operators.

Never treats registry/API failures as cache misses. Existing SHA tags are retained;
we do not relabel an old image as if it had been built from a newer checkout.
"""
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from cn_registry import query, verify, INSTANCE

SERVICES = ('web', 'server', 'studio', 'admin-ui', 'agent', 'agent-os')
SHA = re.compile(r'^[0-9a-f]{40}$')
DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True,
                          capture_output=True).stdout


@lru_cache(maxsize=256)
def inputs(root, revision, service, region):
    if service not in SERVICES or region not in ('com', 'cn') or not SHA.fullmatch(revision):
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
        selected.append(entry)
    # Include build arguments/recipe, but not publication, chart or polling code.
    recipe_path = 'deploy/cn-remote-build-services.sh' if region == 'cn' else 'deploy/deploy-com-aks.sh'
    recipe = git(root, 'show', f'{revision}:{recipe_path}')
    if region == 'com':
        start = recipe.find(b'build_one()')
        end = recipe.find(b'\nbump_tag()', start)
        if start < 0 or end < 0:
            raise RuntimeError('Cannot identify COM build recipe')
        recipe = recipe[start:end]
    return hashlib.sha256(region.encode() + b'\0' + service.encode() + b'\0' + b'\0'.join(selected) + recipe).hexdigest()


def az(*args):
    result = subprocess.run(['az', 'acr', *args, '-o', 'json'], capture_output=True, text=True, check=True, timeout=60)
    return json.loads(result.stdout)


def candidates(region, service):
    repo = f'fizzdragon-{service}'
    if region == 'com':
        rows = az('repository', 'show-tags', '--name', 'acrfizzdragoncom', '--repository', repo, '--detail', '--orderby', 'time_desc')
        if not isinstance(rows, list):
            raise RuntimeError('Invalid COM tag listing')
        return [(r.get('name', ''), r.get('digest', '')) for r in rows]
    listing = query('ListRepository', RepoNamespaceName='fizzdragon', RepoName=repo)
    repositories = [r for r in listing.get('Repositories', []) if r.get('RepoName') == repo and r.get('RepoNamespaceName') == 'fizzdragon' and r.get('InstanceId') == INSTANCE and r.get('RepoStatus') == 'NORMAL']
    if len(repositories) != 1 or listing.get('TotalCount') != 1:
        raise RuntimeError(f'CN repository {repo} cannot be uniquely verified')
    result, page = [], 1
    while True:
        data = query('ListRepoTag', RepoId=repositories[0]['RepoId'], PageNo=page, PageSize=100)
        rows = data.get('Images')
        if not isinstance(rows, list) or not isinstance(data.get('TotalCount'), int):
            raise RuntimeError('Invalid CN tag listing')
        for row in rows:
            if row.get('Status') == 'NORMAL':
                digest = row.get('Digest', '')
                result.append((row.get('Tag', ''), digest if digest.startswith('sha256:') else 'sha256:' + digest))
        if page * 100 >= data['TotalCount']:
            return result
        if not rows:
            raise RuntimeError('Incomplete CN registry pagination')
        page += 1


def digest(region, service, tag):
    if region == 'cn':
        return verify(tag, [service])[service]
    value = az('repository', 'show', '--name', 'acrfizzdragoncom', '--image', f'fizzdragon-{service}:{tag}').get('digest', '')
    if not DIGEST.fullmatch(value):
        raise RuntimeError('COM image has no valid digest')
    return value


def find(root, source, region, service):
    expected = inputs(root, source, service, region)
    for tag, listed_digest in candidates(region, service):
        if not SHA.fullmatch(tag) or not DIGEST.fullmatch(listed_digest):
            continue
        # Do not pull arbitrary branch content into production or trust unknown SHAs.
        ancestry = subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', tag, source], capture_output=True)
        if ancestry.returncode:
            continue
        if inputs(root, tag, service, region) != expected:
            continue
        current = digest(region, service, tag)
        if current != listed_digest:
            raise RuntimeError(f'{service}:{tag} changed in the registry during planning; refusing reuse')
        return {'tag': tag, 'digest': current}
    return None


if __name__ == '__main__':
    try:
        region, root, source, service = sys.argv[1:]
        result = find(Path(root), source, region, service)
        print(f"{result['tag']} {result['digest']}" if result else 'BUILD')
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f'FATAL: image reuse could not be verified ({type(error).__name__}); no cache-miss fallback build is allowed.', file=sys.stderr)
        sys.exit(1)
