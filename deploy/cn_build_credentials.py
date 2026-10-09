#!/usr/bin/env python3
"""Obtain short-lived CN builder credentials without logging their values."""
import argparse
import os
from pathlib import Path
import sys
import tempfile
import time

from cn_registry import query


def credentials():
    data = query('GetAuthorizationToken')
    username, token = data.get('TempUsername'), data.get('AuthorizationToken')
    if not all(isinstance(value, str) and value.strip() and '\n' not in value and '\r' not in value
               for value in (username, token)):
        raise RuntimeError('CN ACR returned invalid temporary credentials')
    try:
        expires = int(data['ExpireTime']) / 1000
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('CN ACR returned no valid credential expiry') from None
    if expires < time.time() + 300:
        raise RuntimeError('CN ACR credentials expire in less than five minutes; retry token acquisition')
    return username, token


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
    print('==> fresh CN ACR temporary credentials acquired (expiry checked; values hidden)')


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
