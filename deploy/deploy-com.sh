#!/usr/bin/env bash
# International production: existing Alibaba Cloud Singapore ACK cluster.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$ROOT/deploy/check-python.py"
exec python3 "$ROOT/deploy/aliyun-sg/deploy-production.py" "$@"
