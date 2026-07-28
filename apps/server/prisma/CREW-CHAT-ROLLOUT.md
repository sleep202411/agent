# Crew chat rollout

Crew chat adds `crew` to `conversation_context_type` and `member` to
`conversation_participant_role`. A Prisma Client generated before
those enum values existed cannot safely decode rows that contain them.
Do not enable the first crew-chat write while an old server pod can
still receive conversation reads.

## Phase A — compatibility

1. Keep `CREW_CHAT_WRITES_ENABLED=false` (this is also the production
   default when the variable is absent).
2. Run `prisma migrate deploy`.
3. Deploy the new server image to every pod.
4. Verify that no pre-crew-chat image remains in service.

Normal crew, membership, application, and assignment operations keep
working in this phase. Chat side effects are deliberately skipped, and
the crew-chat endpoint returns an actionable `503`.

## Phase B — enable writes

1. Set `CREW_CHAT_WRITES_ENABLED=true`.
2. Roll the configuration through the fleet.
3. Open one test crew chat and verify the conversation inbox, message
   send, and reconnect recovery.

Every pod in this rollout already has the compatible Prisma Client, so
mixed `false`/`true` pods are safe: disabled pods can read rows written
by enabled pods.

## Rollback boundary

Before Phase B, the application image can be rolled back normally.
After Phase B has written the first crew conversation, do **not** roll
back to a Prisma Client that predates the enum values. First disable
new writes, then deploy a compatibility build that still contains the
expanded enums.

## Migration transaction note

The comments in the initial `20260728100000` and `20260728110000`
migration files assumed Prisma always wraps a PostgreSQL migration file
in one explicit transaction. That is not a stable Prisma Migrate
guarantee and must not be used as an operational safety argument.

The migrations are retry-safe without that assumption:

- each enum value is added with `IF NOT EXISTS`;
- the nullable column is catalog-only and uses `IF NOT EXISTS`;
- the index uses `IF NOT EXISTS`;
- the following verification migrations reject an invalid or
  differently-defined same-name index.

Use the concurrent-index escape hatch from the migration itself when
the production `messages` table is large enough that a normal index
build would create an unacceptable writer stall.
