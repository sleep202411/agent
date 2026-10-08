#!/usr/bin/env bash
# Standalone migration; completed/active jobs are safely reattached on retry.
# Prefer release-cn.sh for the coordinated build, backup and rollout workflow.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/deploy/cn_release.py" migrate "$@"
