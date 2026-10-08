#!/usr/bin/env bash
# Render only: never connects to a cluster or starts a workload.
set -euo pipefail
CHART="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHART/../../.."

check_mode() {
  local expected="$1"
  shift
  helm template fizzdragon "$CHART" -n fizzdragon "$@" |
    EXPECTED_BACKGROUND_MODE="$expected" node -e '
      const fs = require("node:fs");
      const assert = require("node:assert/strict");
      const YAML = require("yaml");
      const resources = YAML.parseAllDocuments(fs.readFileSync(0, "utf8"))
        .map(document => document.toJS())
        .filter(Boolean);
      const deployments = resources.filter(document => document.kind === "Deployment");
      const component = deployment => deployment.metadata.labels["app.kubernetes.io/component"];
      const server = deployments.find(deployment => component(deployment) === "server");
      assert.ok(server, "The API server remains available for validation");
      const flags = server.spec.template.spec.containers.find(container => container.name === "server")
        .env.filter(item => item.name === "BACKGROUND_TASKS_ENABLED");
      assert.equal(flags.length, 1, "Exactly one process-wide background switch");
      assert.equal(flags[0].value, process.env.EXPECTED_BACKGROUND_MODE);
      if (process.env.EXPECTED_BACKGROUND_MODE === "false") {
        assert.ok(!server.spec.template.spec.initContainers?.some(container => container.name === "db-migrate"),
          "Paused validation must not migrate the snapshot automatically");
        assert.ok(!resources.some(resource => resource.kind === "Job"),
          "Paused validation must not render an automatic migration Job");
        assert.ok(!resources.some(resource => ["TriggerAuthentication", "ScaledObject"].includes(resource.kind)),
          "Paused validation must not retain legacy autoscaler resources");
        for (const name of ["agent-os", "agent", "agent-worker"]) {
          assert.ok(!deployments.some(deployment => component(deployment) === name),
            "Paused validation must not deploy the separate " + name + " runtime");
        }
      }
      console.log("Background task rendering verified: " + flags[0].value);
    '
}

check_mode true
check_mode true -f "$CHART/values.cn-prod.yaml"
ACTIVE_MIGRATIONS="$(mktemp)"
trap 'rm -f "$ACTIVE_MIGRATIONS"' EXIT
cat > "$ACTIVE_MIGRATIONS" <<'YAML'
server:
  migrationJob:
    enabled: true
    revision: validation-fixture
    backupId: validation-fixture
YAML
check_mode false -f "$ACTIVE_MIGRATIONS" \
  -f "$CHART/values.background-tasks-paused.yaml"
