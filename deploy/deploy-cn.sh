#!/usr/bin/env bash
# CN platform release entrypoint. Legacy StoryOS is intentionally excluded.
#
#   deploy/deploy-cn.sh --full --build-only
#   deploy/deploy-cn.sh --deploy-only --allow-chart-update
#   deploy/deploy-cn.sh --full --allow-chart-update
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/deploy/deploy-cn-services.sh" "$@" platform
