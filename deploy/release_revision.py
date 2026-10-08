#!/usr/bin/env python3
"""Resolve committed main updates without reading or modifying working files."""
import subprocess
import sys
from pathlib import Path


def git(root, *args, check=True):
    return subprocess.run(['git', '-C', str(root), *args], text=True,
                          stdout=subprocess.PIPE, check=check)


def latest_source(root, source, branch='main', cn=False):
    remote = f'refs/remotes/origin/{branch}'
    git(root, 'fetch', '--no-tags', '--no-write-fetch-head', 'origin',
        f'refs/heads/{branch}:{remote}')
    local = git(root, 'rev-parse', f'refs/heads/{branch}').stdout.strip()
    remote_sha = git(root, 'rev-parse', remote).stdout.strip()
    def ancestor(a, b):
        result = git(root, 'merge-base', '--is-ancestor', a, b, check=False)
        if result.returncode not in (0, 1):
            raise RuntimeError('Could not verify release ancestry')
        return result.returncode == 0
    if ancestor(remote_sha, local):
        candidate = local
    elif ancestor(local, remote_sha):
        candidate = remote_sha
    else:
        raise RuntimeError('Local and remote release branches diverged; reconcile before rollout')
    if not ancestor(source, candidate):
        raise RuntimeError('Pinned source is no longer in release history')
    result = git(root, 'diff', '--quiet', source, candidate, '--', '.', ':(exclude)deploy/**', check=False)
    if cn and result.returncode == 0:
        result = git(root, 'diff', '--quiet', source, candidate, '--', 'deploy/helm/fizzdragon', check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError('Could not compare release inputs')
    if candidate != source:
        kind = 'application inputs changed; restarting' if result.returncode else 'deployment-only changes accounted for'
        print(f'==> main checkpoint {candidate}: {kind}', file=sys.stderr)
    return candidate if result.returncode else source


if __name__ == '__main__':
    try:
        print(latest_source(Path(sys.argv[1]), sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'main', cn='--cn' in sys.argv))
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'FATAL: {error}', file=sys.stderr)
        sys.exit(1)
