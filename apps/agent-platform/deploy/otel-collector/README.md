# OpenTelemetry Collector

Production uses the official multi-architecture image
`otel/opentelemetry-collector-contrib:0.157.0`, currently resolved as
`sha256:f2f01157055a9b2aab9df7118e1f1c9abf345e99b23bc7a2bc791db374a7d0f6`.
Do not use `latest`; lock and verify the manifest digest again when the pinned
Collector release changes.

The canonical Collector configuration is
[`deploy/helm/fizzdragon/files/agent-platform-otel-collector.yaml`](../../../../deploy/helm/fizzdragon/files/agent-platform-otel-collector.yaml).
The Helm chart mounts that exact file; there is no second copy that can drift.
Local development intentionally uses
[`local.yaml`](local.yaml): it exposes the same OTLP and health interfaces but
exports sampled basic debug telemetry instead of requiring a local ClickHouse
cluster. `npm run dev:stack` starts this pinned image and configuration.

Required secrets and configuration:

- `CLICKHOUSE_ENDPOINT`: TLS-enabled, multi-host ClickHouse endpoint
- `CLICKHOUSE_USERNAME` / `CLICKHOUSE_PASSWORD`: insert-only account
- `CLICKHOUSE_DATABASE`: version-managed observability database
- `OTEL_STORAGE_DIRECTORY`: persistent queue directory
- `OTEL_STORAGE_COMPACTION_DIRECTORY`: compaction scratch directory on the same
  encrypted persistent volume
- `GOMEMLIMIT`: 80% of the Collector container memory limit

The ClickHouse exporter is configured with `create_schema: false`. Apply the DDL
from the exact pinned Collector release as a reviewed infrastructure migration;
custom TTL, partitioning, replication, and indexes may change, but column names
and types must remain compatible with that release's insert statements.

The persistent queue provides at-least-once delivery, so duplicate telemetry is
possible after crash recovery. Dashboards and alert queries must not assume
exactly-once rows.
