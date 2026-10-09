"""Committed per-service build identities shared by regional release planners."""
from functools import lru_cache
import ast
import shlex
import hashlib
import json
import re
import subprocess

SERVICES = ('web', 'server', 'studio', 'admin-ui', 'agent', 'agent-os', 'game-agent')
SHA = re.compile(r'^[0-9a-f]{40}$')

def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True,
                          capture_output=True).stdout

def dependency_snapshot(lock, workspaces):
    """Fingerprint installed dependency closure, preserving physical resolution.

    Resolve nested/hoisted dependencies from the npm lock's installed paths.
    Include optional and peer edges, workspace links, integrity and root build
    tools. Unsupported/invalid layouts conservatively retain the full lock.
    """
    packages = lock.get('packages')
    if lock.get('lockfileVersion') not in (2, 3) or not isinstance(packages, dict):
        return None
    roots = {'', *workspaces}
    if not roots <= packages.keys():
        return None
    selected, pending = {}, list(roots)

    def resolve(path, name):
        parts = path.split('/') if path else []
        while True:
            if not parts or parts[-1] != 'node_modules':
                candidate = '/'.join(parts + ['node_modules', name])
                if candidate in packages:
                    return candidate
            if not parts:
                return None
            parts.pop()

    while pending:
        path = pending.pop()
        if path in selected:
            continue
        entry = packages.get(path)
        if not isinstance(entry, dict):
            return None
        selected[path] = entry
        if entry.get('link'):
            target = entry.get('resolved')
            if target not in packages or target.startswith(('/', '../')):
                return None
            pending.append(target)
            continue
        kinds = ['dependencies', 'optionalDependencies', 'peerDependencies']
        if path in roots or not path.startswith('node_modules/') and '/node_modules/' not in path:
            kinds.append('devDependencies')
        for kind in kinds:
            dependencies = entry.get(kind, {})
            if not isinstance(dependencies, dict):
                return None
            for name in dependencies:
                target = resolve(path, name)
                if target is not None:
                    pending.append(target)
                elif kind in ('dependencies', 'devDependencies') and name not in entry.get('optionalDependencies', {}):
                    return None
    return {'lockfileVersion': lock['lockfileVersion'], 'packages': selected}


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
    lock = json.loads(git(root, 'show', f'{revision}:package-lock.json'))
    scoped_lock = dependency_snapshot(lock, included) if known_layout else None
    selected = []
    for entry in entries:
        if not entry:
            continue
        metadata, raw_path = entry.split(b'\t', 1)
        path = raw_path.decode()
        if path.startswith(('docs/', '.github/')) or ('/' not in path and path.endswith('.md')):
            continue
        # Root handoff reports contain no application or build configuration.
        if path in {
            'MOBILE_2_4_0_ROLLBACK_REVIEW.txt',
            'MOBILE_2_3_1_BACKPORT.txt',
            'MOBILE_BRANCH_RECONCILIATION.txt',
        }:
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
        if path == 'package-lock.json' and scoped_lock is not None:
            selected.append(raw_path + b"\0" + json.dumps(scoped_lock, sort_keys=True, separators=(",", ":")).encode())
            continue
        workspace = path.rsplit("/", 1)[0]
        if scoped_lock is not None and path.endswith('/package.json') and workspace not in included:
            continue
        if path.endswith("/package.json") and workspace in manifests and workspace not in included:
            # Entry points/documentation of an unconsumed workspace do not affect
            # installation. Keep every other field conservatively (including
            # version, dependency declarations, engines and lifecycle scripts).
            manifest = dict(manifests[workspace])
            for key in ("main", "description", "homepage", "bugs", "keywords"):
                manifest.pop(key, None)
            entry = raw_path + b"\0" + json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        selected.append(entry)
    recipe = build_recipe(root, revision, service, region)
    return hashlib.sha256(region.encode() + b'\0' + service.encode() + b'\0' + b'\0'.join(selected) + recipe).hexdigest()


def build_recipe(root, revision, service, region):
    """Compare compilation settings, never authentication/publication/rollout.

    Read historical code as data: no importing or executing a candidate commit.
    Dockerfiles remain in the service tree fingerprint. Unknown recipe layouts
    fail closed instead of declaring unrelated images equivalent.
    """
    if region == 'cn':
        code = git(root, 'show', f'{revision}:deploy/cn-remote-build-services.sh').decode()
        lines = code.replace(chr(92) + chr(10), ' ').splitlines()
        invocation = [shlex.split(line) for line in lines if line.startswith(f'want {service} && build ')]
        compiler = [shlex.split(line.strip()) for line in lines if line.strip().startswith('docker build ')]
        if len(invocation) != 1 or len(compiler) != 1:
            raise ValueError('Unknown CN compilation recipe')
        # Only globals consumed by this service's arguments are relevant.
        globals_used = ['NPM_REGISTRY']
        arguments = ' '.join(invocation[0])
        globals_used += [name for name in ('APK_MIRROR', 'SERVER_URL') if '$' + name in arguments]
        settings = []
        for name in globals_used:
            values = [line for line in lines if line.startswith(name + '=')]
            if len(values) != 1:
                raise ValueError('Unknown CN build argument default')
            settings.append(shlex.split(values[0]))
        return json.dumps([invocation, compiler, settings], sort_keys=True).encode()

    code = git(root, 'show', f'{revision}:deploy/aliyun-sg/production-build.py').decode()
    tree = ast.parse(code)
    builders = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build_images']
    if len(builders) != 1:
        raise ValueError('Unknown Singapore compilation recipe')
    builder = builders[0]
    branches = []
    for node in ast.walk(builder):
        if isinstance(node, ast.If) and ast.dump(node.test) == ast.dump(ast.parse(f'service == {service!r}', mode='eval').body):
            branches.append([ast.dump(statement) for statement in node.body])
    commands = [node.value for node in ast.walk(builder) if isinstance(node, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == 'command' for t in node.targets)
                and isinstance(node.value, ast.List)]
    if len(commands) != 1:
        raise ValueError('Unknown Singapore compiler command')
    # Output location, push/load, progress, and provenance do not change the
    # application filesystem/config. Keep platform and every other build flag.
    flags = []
    skip = False
    for node in commands[0].elts:
        if skip:
            skip = False
            continue
        value = node.value if isinstance(node, ast.Constant) else None
        if value in ('--metadata-file', '--tag', '--progress', '--builder'):
            skip = True
            continue
        if value in ('--push', '--load', '--provenance=false', '--progress=plain'):
            continue
        flags.append(ast.dump(node))
    public = []
    if service == 'web':
        public = [ast.dump(n.value) for n in tree.body if isinstance(n, ast.Assign)
                  and any(isinstance(t, ast.Name) and t.id == 'PUBLIC_ARGS' for t in n.targets)]
        if len(public) != 1:
            raise ValueError('Unknown Singapore public build arguments')
    additions = [ast.dump(n) for n in ast.walk(builder) if isinstance(n, ast.AugAssign)
                 and isinstance(n.target, ast.Name) and n.target.id == 'command']
    return json.dumps([branches, flags, public, additions], sort_keys=True).encode()


def newest_first(root, source, rows):
    """Prefer the nearest ancestor source, independently of registry page order."""
    order = git(root, 'rev-list', '--topo-order', source).decode().splitlines()
    rank = {tag: index for index, tag in enumerate(order)}
    return sorted((row for row in rows if row[0] in rank), key=lambda row: rank[row[0]])
