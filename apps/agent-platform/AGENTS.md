# AGENTS.md — FizzDragon Agent Platform

Load the repository `mastra` skill before any Mastra work. Read the installed
version's embedded documentation; do not implement Mastra APIs from memory.

## Target

This application is the replacement architecture. Do not import from or add
compatibility layers for `apps/agent` or `apps/studio-agent-runtime`.

## Invariants

- One `FizzDragon` agent; business surfaces mount capability packs from trusted
  `RequestContext`.
- Product execution enters only through `POST /api/v1/invocations`.
- Temporal owns the durable loop. Never add an in-process retry or a second
  durable orchestrator.
- Each inference and tool call is one Activity and one stable Ably Step.
- Business writes go through the domain gateway with authorization,
  idempotency, versioning, and atomic domain validation.
- Never execute a mutation inside a Mastra tool callback.
- Never use conversation text as authorization or scope.
- Never initialize or migrate schemas at API/Worker boot.
- Never log tokens, prompts, full business payloads, or raw upstream errors.

## Verification

Run `npm run check-types`, `npm test`, `npm run test:integration`, and
`npm run build` for runtime changes. A Workflow change also requires a replay or
real Temporal integration test.
