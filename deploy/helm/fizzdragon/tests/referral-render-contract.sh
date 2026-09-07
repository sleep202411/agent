#!/usr/bin/env bash
# Invitation links must use the public web origin of their deployment.
set -euo pipefail

CHART="$(cd "$(dirname "$0")/.." && pwd)"

check_origin() {
  local expected="$1"
  shift
  helm template fizzdragon "$CHART" -n fizzdragon \
    -f "$CHART/values.yaml" "$@" -s templates/server.yaml |
    EXPECTED_REFERRAL_ORIGIN="$expected" node -e '
      const fs = require("node:fs");
      const assert = require("node:assert/strict");
      const YAML = require("yaml");
      const deployment = YAML.parseAllDocuments(fs.readFileSync(0, "utf8"))
        .map(document => document.toJS())
        .find(document => document.kind === "Deployment");
      const env = deployment.spec.template.spec.containers
        .find(container => container.name === "server").env;
      const origins = env.filter(item => item.name === "REFERRAL_INVITE_BASE_URL");
      assert.equal(origins.length, 1, "Exactly one invitation origin must be configured");
      assert.equal(origins[0].value, process.env.EXPECTED_REFERRAL_ORIGIN);
      console.log("Referral origin verified: " + origins[0].value);
    '
}

cd "$CHART/../../.."
check_origin https://fizzdragon.com
check_origin https://fizzdragon.fizzspace.cn -f "$CHART/values.cn-prod.yaml"
