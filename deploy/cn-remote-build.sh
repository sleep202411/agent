#!/usr/bin/env bash
# Backward-compatible ECS helper for the non-legacy platform services.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export SERVICES="server admin-ui web studio"
exec "$SCRIPT_DIR/cn-remote-build-services.sh"
