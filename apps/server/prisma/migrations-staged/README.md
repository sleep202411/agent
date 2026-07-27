# Staged migrations

Migrations here are **written, reviewed, and deliberately not applied**. They are
the destructive tail of a multi-release schema change — the step that only
becomes safe once every pod running the previous image is gone.

Prisma only ever reads `prisma/migrations`, so nothing in this directory can be
applied by accident: neither `prisma migrate deploy` (what the `db-migrate` init
container runs) nor `prisma migrate dev` can see it.

Being invisible to Prisma is the first interlock, not the only one. A staged
migration is also expected to refuse to run on its own — see the unlock table in
the one below — so that promoting it early fails closed instead of destroying
data.

## Promoting one

`git mv` the directory into `prisma/migrations/`, renaming its timestamp prefix
to the promotion date so it sorts after everything already applied. Do not edit
the SQL. Validate against the full history on a throwaway shadow database, then
ship it as its own release with nothing else in it.

The per-change runbook has the preconditions, the confirmation queries, and the
recovery path. Read it first.

## Staged

### `20260721093000_retire_has_audio_step3_drop`

Step 3 of the `has_audio` retirement. Drops the four retired columns and the last
plpgsql that names them.

**Runbook: [`../RETIRE-HAS-AUDIO-RUNBOOK.md`](../RETIRE-HAS-AUDIO-RUNBOOK.md).**
