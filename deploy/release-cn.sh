#!/usr/bin/env bash
# Pin once, build/verify, create/wait for manual RDS backup, migrate, deploy.
# CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh --allow-chart-update
# CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh --resume --allow-chart-update
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/deploy/cn_release.py" release "$@"
