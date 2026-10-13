#!/usr/bin/env python3
"""Obtain short-lived CN builder credentials without logging their values."""
import argparse
import json
import fcntl
import os
from pathlib import Path
import sys
import tempfile
import time

from cn_registry import query, INSTANCE


def validate(data):
    username, token = data.get('TempUsername'), data.get('AuthorizationToken')
    if not all(isinstance(value, str) and value.strip() and '\n' not in value and '\r' not in value
               for value in (username, token)):
        raise RuntimeError('CN ACR returned invalid temporary credentials')
    try:
        expires = int(data['ExpireTime']) / 1000
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('CN ACR returned no valid credential expiry') from None
    if expires < time.time() + 300:
        raise RuntimeError(f'CN ACR credentials have less than five minutes left; retry after expiry at {time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(expires))}. No early token renewal was requested.')
    return username, token


def cache_directory():
    return Path.home() / '.cache' / 'fizzdragon' / ('cn-acr-default-' + INSTANCE)


def credentials():
    directory = cache_directory()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    with open(directory / 'lock', 'a') as lock:
        os.chmod(directory / 'lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = directory / 'token.json'
        if path.exists():
            try:
                data = json.loads(path.read_text())
                expires = int(data['ExpireTime']) / 1000
            except (ValueError, KeyError, TypeError):
                raise RuntimeError('CN ACR credential cache is invalid; inspect the private cache before retrying') from None
            if expires > time.time():
                result = validate(data)
                print('==> reusing unexpired CN ACR credentials (values hidden)')
                return result
        data = query('GetAuthorizationToken')
        result = validate(data)
        fd, temporary = tempfile.mkstemp(dir=directory)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump({key: data[key] for key in ('TempUsername', 'AuthorizationToken', 'ExpireTime')}, stream)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print('==> fresh CN ACR temporary credentials acquired (expiry checked; values hidden)')
        return result


def prepare(directory=None):
    username, token = credentials()
    if directory is not None:
        directory = Path(directory)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name, value in [('acr-username.txt', username), ('acr-password.txt', token)]:
            fd, temporary = tempfile.mkstemp(prefix='.' + name, dir=directory)
            try:
                with os.fdopen(fd, 'w') as output:
                    output.write(value)
                os.replace(temporary, directory / name)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir')
    args = parser.parse_args()
    prepare(args.output_dir)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError) as error:
        print(f'FATAL: {error}', file=sys.stderr)
        sys.exit(1)
