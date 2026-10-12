#!/usr/bin/env python3
"""Find existing CN images by committed service build inputs, across operators.

Never treats registry/API failures as cache misses. Existing SHA tags are retained;
we do not relabel an old image as if it had been built from a newer checkout.
"""
from release_inputs import inputs as service_inputs, newest_first
import json
from pathlib import Path
import re
import subprocess
import sys
from cn_registry import query, verify, INSTANCE

SERVICES = ('web', 'server', 'studio', 'admin-ui', 'agent', 'agent-os', 'game-agent', 'app-story-agent')
SHA = re.compile(r'^[0-9a-f]{40}$')
DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')
RETIRED_COM = 'The Azure .com image path has retired; use deploy/deploy-com.sh instead'


def require_cn(region):
    if region == 'com':
        raise RuntimeError(RETIRED_COM)
    if region != 'cn':
        raise ValueError('Invalid image region')


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True,
                          capture_output=True).stdout


def inputs(root, revision, service, region):
    require_cn(region)
    return service_inputs(root, revision, service, region)


def candidates(region, service):
    require_cn(region)
    repo = f'fizzdragon-{service}'
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
    require_cn(region)
    return verify(tag, [service])[service]


def find(root, source, region, service):
    expected = inputs(root, source, service, region)
    for tag, listed_digest in newest_first(root, source, candidates(region, service)):
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
    if sys.argv[1:2] == ['com']:
        print(f'FATAL: {RETIRED_COM}', file=sys.stderr)
        sys.exit(1)
    try:
        region, root, source, service = sys.argv[1:]
        result = find(Path(root), source, region, service)
        print(f"{result['tag']} {result['digest']}" if result else 'BUILD')
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f'FATAL: image reuse could not be verified ({type(error).__name__}); no cache-miss fallback build is allowed.', file=sys.stderr)
        sys.exit(1)
