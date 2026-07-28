# Studio Agent Runtime

Provider-independent durable execution runtime shared by Story Studio and
future creator surfaces. This app is intentionally separate from the legacy
Mastra application in `apps/agent`; do not import from, migrate through, or
silently fall back to that app.

## Ownership boundaries

- `apps/studio-agent-runtime` owns deterministic Temporal workflows, model
  activities, cancellation, steering, queued input semantics, and worker
  lifecycle.
- `apps/server/src/studio-agent` is the canonical control plane. It owns
  authentication, scope authorization, capabilities, skills, permissions,
  approvals, durable state, event ordering, and idempotency.
- `packages/shared/src/studio-agent*.ts` is the versioned wire contract.
- Host products own adapters only. Product-specific canvas logic must be
  exposed as a registered capability, never imported into this runtime.

PostgreSQL is authoritative. Temporal schedules durable work but does not
replace canonical product state or the append-only event journal. Redis
notifications are wake-ups only.

## Determinism and durability

- Workflow code must remain deterministic and must not call Node, network,
  clocks, randomness, or providers directly.
- All external effects run in activities and must be idempotent under retry.
- A domain transition and its replay event become visible in one database
  transaction.
- Treat cancellation, approval, model completion, and queued input promotion
  as competing transitions. Resolve them atomically in the control plane.
- Child runs receive an immutable context boundary and inherit the root run's
  immutable resource budget. Never reconstruct child context from whatever
  happens to be current when the child starts.
- Required secrets and deployment identity fail at startup. Do not add
  provider, plaintext, or credential fallbacks.

## Provider boundary

Model-provider code belongs in the activity worker. Provider payloads are
projected from the canonical, provider-neutral model plan and are never stored
as the public thread/run contract. Adding a provider must preserve the same
event, permission, cancellation, and usage-accounting semantics.

## Commands

Run from the repository root:

```bash
npm run dev -w studio-agent-runtime          # run the local stack (see below)
npm run check-types -w studio-agent-runtime
npm run lint -w studio-agent-runtime
npm run test -w studio-agent-runtime
npm run build -w studio-agent-runtime
```

The build precompiles `dist/studio-agent-workflow-bundle.js`; production must
not bundle workflow code at startup. Generated `dist/` output is ignored.

## Never measure against a stale worker

`npm run dev -w studio-agent-runtime` is the only supported way to run this app
locally, and it is one command deliberately: it loads this app's `.env`, keeps
`@repo/shared` compiled, refuses to start anything until that build succeeds,
gives each role its own health/metrics ports, restarts a worker when the code it
loaded changes, and reports each role's `/ready`. Do not replace it with a
sequence of commands to be run in the right order — that ordering requirement is
the defect it removes. `README.md` § Running it locally is the reference.

If you run compiled output instead (`node dist/worker-*.js`), the worker aborts
at startup when a source file is newer than the build it would load, and turns
`/ready` into `503 stale` when someone rebuilds underneath it. A worker whose
readiness is red must not be used to verify anything: it is running the previous
build. This is not a nicety — measurements were once taken against pre-fix
modules because nothing said so.

Anything that changes `packages/shared` or this app therefore needs a rebuild and
a restart before it is measured. The dev launcher does both; the compiled path
tells you when it did not happen.

## Change checklist

For a protocol or workflow change:

1. Update and test the shared Zod contract.
2. Update the Nest control-plane transition and persistence invariants.
3. Update runtime gateway/activity/workflow consumers.
4. Add adversarial tests for retry, duplicate delivery, cancellation, and
   reconnect/replay.
5. Validate both disabled and enabled Helm renders.

Breaking workflow or wire changes require a new versioned schema/task queue and
a coordinated rollout. Do not rename a live queue in place.
