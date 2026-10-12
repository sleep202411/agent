#!/usr/bin/env python3
"""CN cross-operator release mutex. Never expires an active remote build."""
import argparse
import datetime
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

NAME = 'fizzdragon-release-lock'
TARGETS = {
    'cn': ('config-fizzdragon-cn', '218059191361846222-c72d2039c68624a3e8d0dee257a13d451', 'fizzdragon'),
}


class Lock:
    def __init__(self, region):
        if region == 'com':
            raise RuntimeError('The Azure .com release has retired; use deploy/deploy-com.sh instead')
        config, context, namespace = TARGETS[region]
        # Explicit regional targets: never coordinate against an unrelated current context.
        self.command = ['kubectl', '--kubeconfig', str(Path.home() / '.kube' / config),
                        '--context', context, '-n', namespace, '--request-timeout=30s']
        self.region = region

    def call(self, *args, body=None):
        return subprocess.run(self.command + list(args), input=json.dumps(body) if body else None,
                              capture_output=True, text=True, timeout=40)

    def read(self):
        result = self.call('get', 'configmap', NAME, '--ignore-not-found', '-o', 'json')
        if result.returncode:
            raise RuntimeError('Cannot read regional release lock; check ConfigMap access/connectivity')
        if not result.stdout.strip():
            return None
        value = json.loads(result.stdout)
        data = value.get('data', {})
        if (not value.get('metadata', {}).get('resourceVersion') or
                data.get('region') != self.region or not isinstance(data.get('owner'), str)):
            raise RuntimeError('Malformed regional release lock; inspect it before proceeding')
        return value

    def write(self, previous, owner):
        metadata = {'name': NAME}
        if previous:
            metadata['resourceVersion'] = previous['metadata']['resourceVersion']
        value = {'apiVersion': 'v1', 'kind': 'ConfigMap', 'metadata': metadata,
                 'data': {'owner': owner, 'region': self.region,
                          'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}}
        result = self.call('replace' if previous else 'create', '-f', '-', '-o', 'json', body=value)
        if result.returncode:
            # Only a real atomic acquisition race is retryable. Uncertain writes
            # remain locked; no fail-open fallback or blind retry of mutations.
            if '(Conflict)' in result.stderr or '(AlreadyExists)' in result.stderr:
                return False
            raise RuntimeError(f'Release lock update failed (requested owner={owner!r}); inspect lock ownership before retrying')
        return True

    def status(self):
        value = self.read()
        data = (value or {}).get('data', {})
        return {'region': self.region, 'owner': data.get('owner', ''),
                'updatedAt': data.get('updatedAt'),
                'held': bool(data.get('owner')),
                'activity': 'unknown: lock ownership does not prove remote work is active'}

    def acquire(self, owner, timeout=None):
        if timeout is None:
            try:
                timeout = int(os.environ.get('CN_RELEASE_LOCK_WAIT_SECONDS', '120'))
            except ValueError:
                raise RuntimeError('CN_RELEASE_LOCK_WAIT_SECONDS must be an integer from 0 to 14400') from None
        if not isinstance(timeout, int) or not 0 <= timeout <= 14400:
            raise RuntimeError('CN_RELEASE_LOCK_WAIT_SECONDS must be an integer from 0 to 14400')
        deadline = time.monotonic() + timeout
        announced = False
        while True:
            previous = self.read()
            holder = (previous or {}).get('data', {}).get('owner', '')
            if not holder and self.write(previous, owner):
                return
            remaining = deadline - time.monotonic()
            updated = (previous or {}).get('data', {}).get('updatedAt', 'unknown')
            if not announced:
                print(f'==> {self.region} lock last updated {updated}; remote activity is unknown. '
                      f'Lock-wait budget: {timeout}s. Inspect with: python3 deploy/release_lock.py --status {self.region}', flush=True)
                announced = True
            if remaining <= 0:
                raise RuntimeError(
                    f'Timed out waiting for regional release lock (owner={holder or "acquisition race"}, '
                    f'updatedAt={updated}); no build started and no lock was cleared. '
                    'Check the existing release, remote builder, migration Jobs and Helm operations. '
                    'Only after they have stopped, use --recover-owner with the exact owner and '
                    'CONFIRM_REMOTE_RELEASE_STOPPED=YES, then resume the saved release. '
                    'Set CN_RELEASE_LOCK_WAIT_SECONDS (0..14400) to change the wait budget.')
            print(f'==> {self.region} release held by {holder or "another operator"}; waiting before image lookup '
                  f'({remaining:.0f}s remaining)', flush=True)
            time.sleep(min(15, remaining))

    def check(self, owner):
        value = self.read()
        if not value or value.get('data', {}).get('owner') != owner:
            raise RuntimeError('Regional release lock ownership changed; refusing to proceed')
        return value

    def release(self, owner):
        if not self.write(self.check(owner), ''):
            raise RuntimeError('Release lock changed during release; refusing to overwrite it')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('region', choices=('cn', 'com'))
    parser.add_argument('--status', action='store_true', help='Read lock metadata without acquiring or recovering it')
    parser.add_argument('--recover-owner', help='Release an orphan only after verifying all remote work has stopped')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    lock = Lock(args.region)
    if args.status:
        if args.recover_owner or args.command:
            parser.error('--status cannot be combined with recovery or a release command')
        print(json.dumps(lock.status(), indent=2))
        return 0
    if args.recover_owner:
        if os.environ.get('CONFIRM_REMOTE_RELEASE_STOPPED') != 'YES':
            raise RuntimeError('Recovery requires CONFIRM_REMOTE_RELEASE_STOPPED=YES after checking remote builds, migrations and deployments')
        lock.release(args.recover_owner)
        return 0
    command = args.command
    if command[:1] == ['--']:
        command = command[1:]
    if not command:
        parser.error('release command required')
    key = 'FD_REGIONAL_LOCK_' + args.region.upper()
    inherited = os.environ.get(key)
    if inherited:
        lock.check(inherited)
        os.execvp(command[0], command)
    owner = str(uuid.uuid4())
    lock.acquire(owner)
    print(f'==> acquired {args.region} shared release lock {owner}', flush=True)
    env = dict(os.environ, **{key: owner})
    child = None
    interrupted = False

    def stop(signum, _frame):
        nonlocal interrupted
        interrupted = True
        if child is not None:
            child.send_signal(signum)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        child = subprocess.Popen(command, env=env)
        status = child.wait()
        if status == 0 and not interrupted:
            lock.release(owner)
        else:
            print(f'FATAL: shared {args.region} lock retained ({owner}); remote work may still be active. See CN_RELEASE.md lock recovery.', file=sys.stderr)
        return status if status >= 0 else 128 - status
    except BaseException:
        print(f'FATAL: shared {args.region} lock retained ({owner}); inspect remote work before recovery.', file=sys.stderr)
        raise


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'FATAL: {error}', file=sys.stderr)
        sys.exit(1)
