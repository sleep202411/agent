#!/usr/bin/env python3
"""Validate coordinator per-service image overrides at the deployment boundary."""
import json
import os
from pathlib import Path
import sys
from release_images import inputs, git, SHA
from cn_registry import verify


def check(root, source, service, tag):
    if not SHA.fullmatch(tag):
        raise RuntimeError('Invalid service image tag')
    if tag != source:
        git(root, 'merge-base', '--is-ancestor', tag, source)
        if inputs(root, source, service, 'cn') != inputs(root, tag, service, 'cn'):
            raise RuntimeError('Reused service image does not match the release build inputs')
    digest = verify(tag, [service])[service]
    expected = json.loads(os.environ.get('CN_RELEASE_IMAGE_DIGESTS', '{}')).get(service)
    if expected and digest != expected:
        raise RuntimeError('Service image digest changed before deployment')
    print(f'==> verified selected CN {service}:{tag} ({digest})')


if __name__ == '__main__':
    check(Path(sys.argv[1]), *sys.argv[2:])
