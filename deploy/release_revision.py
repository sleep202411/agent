#!/usr/bin/env python3
"""Resolve CN main updates without reading or modifying working files."""
import re
import subprocess
import sys
from pathlib import Path


def git(root, *args, check=True):
    return subprocess.run(['git', '-C', str(root), *args], text=True,
                          stdout=subprocess.PIPE, check=check)



def cn_chart_changed(root, source, candidate):
    base = 'deploy/helm/fizzdragon/values.yaml'
    other = git(root, 'diff', '--quiet', source, candidate, '--',
                'deploy/helm/fizzdragon', f':(exclude){base}', check=False)
    if other.returncode not in (0, 1):
        raise RuntimeError('Could not compare CN chart inputs')
    if other.returncode:
        return True

    def normalized_values(revision):
        text = git(root, 'show', f'{revision}:{base}').stdout
        section, image = None, False
        lines = []
        for line in text.splitlines(keepends=True):
            top = re.match(r'^([A-Za-z][A-Za-z0-9]*):', line)
            if top:
                section, image = top[1], False
            elif re.match(r'^  [^ #\s]', line):
                image = line.strip() == 'image:'
            # These five tags are always overridden by the CN deploy command,
            # including unselected services (which retain their live tags).
            if image and section in ('web', 'studio', 'adminUi', 'server', 'agentOs'):
                line = re.sub(r'^(    tag:)[^\n]*', r'\1 <CN override>', line)
            lines.append(line)
        return ''.join(lines)

    # Repositories and every other chart value remain release inputs.
    changed = git(root, 'diff', '--quiet', source, candidate, '--', base, check=False)
    if changed.returncode not in (0, 1):
        raise RuntimeError('Could not compare shared Helm values')
    if not changed.returncode:
        return False
    for revision in (source, candidate):
        if git(root, 'cat-file', '-e', f'{revision}:{base}', check=False).returncode:
            return True
    return normalized_values(source) != normalized_values(candidate)


def latest_source(root, source, branch='main', cn=False):
    if not cn:
        raise RuntimeError('The legacy .com release has retired; use deploy/deploy-com.sh instead')
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
    if result.returncode not in (0, 1):
        raise RuntimeError('Could not compare release inputs')
    changed = result.returncode == 1
    if cn and not changed:
        # The ECS build helper is uploaded from the pinned source archive, unlike
        # coordinator tooling loaded from HEAD. A helper-only repair must advance
        # that source too; image reuse is independently decided by build inputs.
        helper = git(root, 'diff', '--quiet', source, candidate, '--',
                     'deploy/cn-remote-build-services.sh', check=False)
        if helper.returncode not in (0, 1):
            raise RuntimeError('Could not compare pinned CN build helper')
        changed = helper.returncode == 1 or cn_chart_changed(root, source, candidate)
    if candidate != source:
        kind = 'release inputs changed; restarting' if changed else 'deployment-only changes accounted for'
        print(f'==> main checkpoint {candidate}: {kind}', file=sys.stderr)
    return candidate if changed else source


if __name__ == '__main__':
    try:
        print(latest_source(Path(sys.argv[1]), sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'main', cn='--cn' in sys.argv))
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'FATAL: {error}', file=sys.stderr)
        sys.exit(1)
