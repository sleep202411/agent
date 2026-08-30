# Runbook — retiring the `has_audio` video flag

Four columns are being removed from the database for good:

| Table                     | Column              |
| ------------------------- | ------------------- |
| `media_asset_variants`    | `has_audio`         |
| `story_build_assets`      | `has_audio`         |
| `story_video_build_clips` | `has_audio`         |
| `story_video_selections`  | `current_has_audio` |

The end state has zero trace of the flag: no columns, no plpgsql that names
them, no triggers for them, no Prisma fields, no application code, and no
compatibility shim. Getting there takes **three releases**, in order. Each one
is safe on its own; running two of them as one deploy is what creates a window
where a running image meets a schema it cannot satisfy.

```
release A ──▶ step 1  RELAX        migration only,        no code change
release B ──▶ step 2  STOP USING   code only,             no migration
release C ──▶ step 3  DROP         migration only,        no code change
```

Do not skip, reorder, or merge them. "Release" here means **one commit, built
into one image, deployed on its own** — the migration and the application ship
in the same container, so a commit that holds both is a merged release no matter
what this document says. See "What 'a release' actually is here" below before
touching anything.

---

## Why three

Deploys apply migrations from the **`db-migrate` init container on the new pod**
(`deploy/helm/fizzdragon/templates/server.yaml`, `command: npm run db:deploy`)
while the **previous image is still serving traffic**. So every deploy has a
window in which two different code versions talk to one database, and the schema
is already at the new version for both of them.

Two independent hazards live in that window, and they point in opposite
directions:

- **A writer that omits the columns meets a schema that still demands them.**
  Fixed by relaxing the schema _before_ the code changes → step 1.
- **A reader that still names the columns meets a schema where they are gone.**
  Prisma names every column explicitly in its `SELECT`s, so a `DROP COLUMN`
  breaks the previous image instantly and keeps it broken for the whole rollout.
  Fixed by dropping _after_ every such reader is gone → step 3.

Fuse them into one release and neither ordering works, which is why the earlier
attempt needed a shim trigger. Split them and no shim is needed at all.

---

## What "a release" actually is here — read this before deploying anything

There is no separate migration job. The migration runs from the **`db-migrate`
init container of the new pod, using the same image as the application
container** (`deploy/helm/fizzdragon/templates/server.yaml`). One image = one
git commit = one Docker tag, and `deploy/deploy-com-aks.sh` builds that image
from `git rev-parse HEAD`.

**So a commit that contains both a migration and an application change ships
them together, and steps 1 and 2 become one release again.** The split is not
enforced by anything in the deploy pipeline. It is enforced by keeping them in
**two commits and deploying them one at a time.**

The two commits are already on `develop`:

```bash
git log --oneline -3 develop
# <sha-B>   refactor(story-studio): retire the has_audio video flag from the runtime
# bfd529c6  feat(server): relax the has_audio schema ahead of the code cutover
```

- **`bfd529c6` — release A.** The step 1 migration, plus the one `schema.prisma`
  line the migration makes true (`StoryVideoBuildClip.hasAudio` becomes
  optional, because the column is now nullable). Nothing else. No application
  behaviour changes.
- **`<sha-B>` — release B.** The commit immediately after it: the application
  change, no migration. Read the sha off the `git log` above rather than
  assuming — this file ships inside release B, so it cannot name its own hash.

Rules that keep this working:

- **Never squash-merge them into main together.** A squash is one commit, one
  image, and the whole point is gone. Merge with `--no-ff`, one at a time.
- **Never rebase them into one.** Same reason.
- Release C (step 3) is a third, later commit that promotes the staged
  migration. It is never in flight at the same time as A or B.

### Release A — deploy, exactly

Prod-com deploys from `main`, from a clean tree (`deploy/deploy-com-aks.sh`
refuses otherwise), and ArgoCD watches `main`.

```bash
cd <repo root>
git checkout main
git pull --ff-only origin main
git merge --no-ff bfd529c6 -m "merge(story-studio): relax has_audio schema (step 1 of 3)"
git push origin main

# Verify main now contains A and NOT B before building the image.
git log --oneline -1
git log --oneline main | grep <sha-B> && echo "STOP: B is on main, the split is gone"

deploy/deploy-com-aks.sh server
```

The script builds `fizzdragon-server:<sha>` in ACR, bumps
`deploy/helm/fizzdragon/values.yaml`, commits and pushes; ArgoCD syncs within a
few minutes. Watch the migration land:

```bash
kubectl logs -n fizzdragon-com -l app.kubernetes.io/component=server \
  -c db-migrate --tail=100
kubectl rollout status -n fizzdragon-com deploy/fizzdragon-server --timeout=10m
```

Then run the **release A confirmation** below. Do not start release B until it
passes.

### Release B — deploy, exactly

Only after release A's confirmation passes:

```bash
cd <repo root>
git checkout main
git pull --ff-only origin main
git merge --no-ff <sha-B> -m "merge(story-studio): stop using has_audio (step 2 of 3)"
git push origin main
deploy/deploy-com-aks.sh server
kubectl rollout status -n fizzdragon-com deploy/fizzdragon-server --timeout=10m
```

`prisma migrate deploy` runs again in the init container and finds nothing new
to apply — that is the expected, correct outcome for release B.

Then run the **release B confirmation** below. Release C (step 3) is gated on it.

### Getting a psql session on the prod database

Every confirmation query below runs here. The Azure PostgreSQL firewall
allow-lists the AKS egress, not an operator laptop, so query from inside the
cluster:

```bash
DBURL=$(kubectl get secret fizzdragon-secrets -n fizzdragon-com \
  -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
PSQLURL="$(printf '%s' "$DBURL" | sed 's/?.*$//')?sslmode=require"
kubectl run pgq-tmp --image=postgres:16-alpine -n fizzdragon-com \
  --restart=Never --rm -i --quiet --command -- \
  psql "$PSQLURL" -P pager=off -F $'\t' -A -c "<query>"
```

`.cn` runs the same series against its own database and gets its own pass of
every confirmation; nothing here is shared between the regions.

---

## Step 1 — RELAX (release A)

**Contains:** commit `bfd529c6` —
`prisma/migrations/20260721090000_retire_has_audio_step1_relax` and one line of
`prisma/schema.prisma`.
**Application behaviour:** unchanged.

The schema line rides with the migration because it _is_ the migration: dropping
the `NOT NULL` on `story_video_build_clips.has_audio` makes the column nullable,
so `StoryVideoBuildClip.hasAudio` has to become `Boolean?` for the datamodel to
describe the database it now runs against. Leave them apart and the next person
to run `prisma migrate dev` gets a drift-repair migration that puts the
`NOT NULL` straight back — the one change this step must never see. Nothing else
in the model moves, and the field is only ever written, never read, so the
release-A image compiles and behaves exactly as before.

Loosens every rule that would reject a writer which omits the columns:

- drops the `NOT NULL` on `story_video_build_clips.has_audio`
- rebuilds `story_build_assets_video_metadata_chk` without `has_audio IS NOT NULL`
- rebuilds `story_video_selections_media_shape_chk` without either
  `current_has_audio` conjunct
- rebuilds the three plpgsql guards that **reject** on the flag —
  `story_video_generation_attempt_integrity_guard`,
  `story_video_selection_media_guard`, `story_build_ready_guard`

Nothing is dropped and no value is rewritten. Every rule gets strictly weaker,
so the code that is currently in production keeps writing real `has_audio`
values and they keep satisfying everything. This release can sit in production
indefinitely.

### Deploy

See "Release A — deploy, exactly" above. The `db-migrate` init container applies
the migration.

### Confirm it landed — required before starting step 2

First, the migration is recorded as applied and nothing is pending:

```bash
pod=$(kubectl -n fizzdragon-com get pods -l app.kubernetes.io/component=server \
  --no-headers -o custom-columns=:metadata.name | head -1)
kubectl -n fizzdragon-com exec "$pod" -c server -- \
  npx prisma migrate status --schema prisma/schema.prisma
```

Expect `20260721090000_retire_has_audio_step1_relax` in the applied list and
"Database schema is up to date".

Then the schema itself. One query, one row, and it must come back exactly as
shown — anything else means step 1 did not fully land and step 2 must not ship
(run it through the psql recipe above):

```sql
SELECT
  -- 1. the NOT NULL is gone
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'story_video_build_clips'
      AND column_name = 'has_audio')                              AS clip_has_audio_nullable,
  -- 2. neither rebuilt check constraint mentions the flag
  (SELECT count(*) FROM pg_constraint
    WHERE conname IN ('story_build_assets_video_metadata_chk',
                      'story_video_selections_media_shape_chk')
      AND pg_get_constraintdef(oid) LIKE '%has_audio%')           AS checks_naming_flag,
  -- 3. only the two invalidation functions still name it. They merely WRITE
  --    NULL, cannot reject anything, and are step 3's job.
  (SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND pg_get_functiondef(oid) LIKE '%has_audio%')             AS functions_naming_flag,
  -- 4. the shim from the abandoned single-release attempt must not exist
  (SELECT count(*) FROM pg_trigger
    WHERE tgname LIKE '%retired_has_audio%')                      AS abandoned_shim_triggers;

-- Required result:
--   clip_has_audio_nullable | checks_naming_flag | functions_naming_flag                                                  | abandoned_shim_triggers
--   YES                     | 0                  | story_video_media_asset_invalidation,story_video_media_variant_invalidation | 0
```

(If `abandoned_shim_triggers` is not 0, see "Local databases" below — it should
be impossible in production.)

### Roll back

Redeploy the previous image (`git revert` the merge on `main`, or re-run
`deploy/deploy-com-aks.sh server` from the previous commit). **Do not revert the
migration.** It is strictly permissive, the old code satisfies it, and nothing in
the application depends on the rules it removed. A revert would have to re-add
`NOT NULL` to a column that may by then hold NULLs, which is the only way this
step can hurt you.

The `schema.prisma` line goes back with the image, and that is harmless: only
release B's code writes NULL into that column, so while release A is the newest
thing deployed there are none, and a datamodel that calls the column required
still describes every row that exists.

If you truly must undo it (you will not), the exact inverse is in
`prisma/migrations/20260717150000_story_video_direct_recipe_cutover/migration.sql`
— the original constraint text at lines 150–159 and 215–239, and the three guard
bodies at lines 743–880, 1455–1500 and 1623–1705.

### Locking

Prisma runs the file in one transaction, so all locks are held to commit; both
rebuilt check constraints revalidate their table under `ACCESS EXCLUSIVE`. Both
tables are Story Studio product plane (created 2026-07) and small — expect
sub-second. If either has grown unexpectedly, check first:

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables
WHERE relname IN ('story_build_assets', 'story_video_selections');
```

---

## Step 2 — STOP USING (release B)

**Contains:** the application change only. No migration.

Stops reading and writing all four columns: they leave the Prisma model, the
runtime manifest schema, the build compiler, the media-asset placement writer,
the preview-staleness comparison, and every DTO. The columns become inert.
Nothing can reject these writes, because step 1 already relaxed every rule.

### Deploy

See "Release B — deploy, exactly" above. `prisma migrate deploy` runs in the
init container and finds nothing to do.

### Known, accepted, bounded risk during the rollout

For the duration of the rolling update only, previous-image pods are still
serving. A new-image pod that rewrites a video selection sets the nine media
columns it knows about and leaves `current_has_audio` at its previous value —
Prisma does not touch a column it does not model. A previous-image pod that then
reads that same selection sees a partially populated tuple and raises
`corruptSelection`, a 500 out of Build and Working Preview.

- **Blast radius:** one Story project, and only if its current video is changed
  during the rollout window.
- **Duration:** the rollout window (tens of seconds), not longer. Nothing is
  corrupted and no repair is needed — the moment the last previous-image pod is
  gone, no code reads the column at all.
- **Deliberately not shimmed.** A BEFORE trigger that keeps the retired column
  in step is a permanent piece of production plpgsql bought to paper over one
  minute of rollout, and it can only ever be partly right (the previous attempt's
  version handled the clearing direction and missed the populating one).

Prefer a low-traffic window if Story Studio is busy. That is the whole
mitigation.

### Confirm it landed — required before starting step 3

**1. Every server pod runs the step 2 image.** This is the gate; step 3 is
destructive and this is what makes it safe.

```bash
kubectl get pods -n fizzdragon-com -l app.kubernetes.io/component=server \
  -o jsonpath='{range .items[*]}{.spec.containers[0].image}{"\n"}{end}' | sort -u
```

Expect exactly one line, and it must be the step 2 tag or later. If more than
one line comes back, the rollout is not finished — wait.

Also check for anything else that talks to this database with an older client:
the agent worker, one-off jobs, `kubectl debug` shells, a colleague's local app
pointed at a shared database. Step 3 breaks all of them.

**2. The running code has actually stopped writing the flag.** The image tag
proves what is deployed; this proves what it does. Freeze one Build (any Story
project, any clip) after the rollout, then:

```sql
-- Every clip frozen since the step 2 rollout must have has_audio IS NULL:
-- the new image does not model the column, so Postgres fills its default,
-- which step 1 left as none. Expect frozen_since_cutover = wrote_the_flag + 0,
-- i.e. wrote_the_flag = 0.
SELECT count(*)                                        AS frozen_since_cutover,
       count(*) FILTER (WHERE has_audio IS NOT NULL)    AS wrote_the_flag
FROM story_video_build_clips
WHERE created_at > TIMESTAMPTZ '<UTC timestamp of the release B rollout>';
```

`wrote_the_flag` must be `0`. Anything else means a pre-step-2 image is still
writing, and step 3 would break it.

### Roll back

Redeploy the previous image. The schema is unchanged, so this is a plain
application rollback with no database work. Note the direction: rolling back to
release A is fine (its code writes the flag, which the relaxed schema still
accepts); rolling back _past_ release A is fine too, for the same reason.

### Creator publication status

The Studio header now reads the interactive-film status directly from Java by
project ID. It does not infer publication state by comparing a Build's stored
`storyVideoSnapshotHash` with the current Nest draft. A work published before
this migration therefore remains `published` until the creator submits another
version or the work is taken offline; Java remains the only publication-state
authority.

---

## Step 3 — DROP (release C)

**Contains:**
`prisma/migrations-staged/20260721093000_retire_has_audio_step3_drop`, promoted.
**Application code:** unchanged.

Drops the four columns, rebuilds the two invalidation functions without them,
and recreates `media_asset_variants_story_video_invalidation_trg` without
`has_audio` in its `UPDATE OF` list.

### Two interlocks stop this running early

1. **Location.** It lives in `prisma/migrations-staged/`, which Prisma never
   reads. Neither `prisma migrate deploy` nor `prisma migrate dev` can see it,
   so it cannot ride along with step 1 or step 2 by accident.
2. **The unlock table.** Even after promotion the migration's first statement
   raises `RETIRE_HAS_AUDIO_STEP3_LOCKED` unless
   `public.story_video_has_audio_drop_unlock` exists in the target database. The
   migration drops that table on the way out, so an unlock is single-use and per
   database — arming it for `.com` does not arm it for `.cn`.

   **Always schema-qualify it as `public.`, exactly as written below.** The
   migration's check (`to_regclass`) and its `DROP TABLE` are both qualified;
   `to_regclass` resolves an unqualified name through `search_path` while a bare
   `CREATE TABLE` lands in the first writable entry of it, and on a connection
   whose `search_path` is not plain `public` those two disagree. An unlock armed
   in the wrong schema unlocks nothing at best, and at worst passes a check the
   drop then misses, leaving the unlock armed after a successful run.

   **A failed run does not consume the unlock, and that is accepted.** Prisma
   runs the migration in one transaction, so a failure rolls the `DROP TABLE`
   back with everything else; there is no way to consume it regardless of
   outcome from inside that transaction. It does not matter, because the unlock
   exists to stop an _unattended_ run, and after a failure there is no
   unattended path back: Prisma has recorded the migration as failed and
   refuses to apply anything to that database until a human runs
   `migrate resolve` (below). The rollback also un-drops the columns, so the
   state the unlock was armed for is the state that still exists, in the same
   database, minutes later — the operator's "one image tag" check has not
   expired. And it cannot leak: the next region still needs its own.

### Promote (one commit, its own release)

```bash
cd apps/server
git mv prisma/migrations-staged/20260721093000_retire_has_audio_step3_drop \
       prisma/migrations/$(date -u +%Y%m%d%H%M%S)_retire_has_audio_step3_drop
```

Rename the timestamp prefix to the promotion date so it sorts after everything
already applied. Do not edit the SQL. Then validate against the full history on
a throwaway shadow database (same procedure as step 1 — see "Validating on a
shadow database" below) and ship it as its own release, with nothing else in it:

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff <sha-C> -m "merge(server): drop the has_audio columns (step 3 of 3)"
git push origin main
```

Do **not** run `deploy/deploy-com-aks.sh server` yet — arm the unlock first.

### Arm the unlock — per database, immediately before the deploy

Only after both release B confirmations pass for that region:

```sql
CREATE TABLE "public"."story_video_has_audio_drop_unlock" (
  "unlocked_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  "unlocked_by" TEXT NOT NULL
);
INSERT INTO "public"."story_video_has_audio_drop_unlock" ("unlocked_by")
VALUES ('<your name> — verified one server image tag at <UTC timestamp>');
```

Confirm it is armed where the migration will look for it — expect one row and a
non-NULL regclass:

```sql
SELECT to_regclass('"public"."story_video_has_audio_drop_unlock"') AS unlock,
       (SELECT count(*) FROM "public"."story_video_has_audio_drop_unlock") AS rows;
```

Both production databases need their own unlock: `.com` (Azure PostgreSQL,
PG17) and `.cn` (Alibaba Cloud). Arm each one immediately before that region's
deploy, never in advance.

### Deploy

```bash
deploy/deploy-com-aks.sh server
kubectl logs -n fizzdragon-com -l app.kubernetes.io/component=server \
  -c db-migrate --tail=100 --follow
kubectl rollout status -n fizzdragon-com deploy/fizzdragon-server --timeout=10m
```

### Confirm it landed

One query, one row, and every column must be `0` or NULL as shown:

```sql
SELECT
  -- no column of either name survives, in any table
  (SELECT count(*) FROM information_schema.columns
    WHERE column_name IN ('has_audio', 'current_has_audio'))       AS columns_left,
  -- no plpgsql body still names the flag
  (SELECT count(*) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND pg_get_functiondef(oid) LIKE '%has_audio%')              AS functions_left,
  -- no trigger definition still names it (the UPDATE OF list)
  (SELECT count(*) FROM pg_trigger
    WHERE NOT tgisinternal
      AND pg_get_triggerdef(oid) LIKE '%has_audio%')               AS triggers_left,
  -- the unlock consumed itself
  to_regclass('"public"."story_video_has_audio_drop_unlock"')      AS unlock_left;

-- Required result:
--   columns_left | functions_left | triggers_left | unlock_left
--   0            | 0              | 0             | (null)
```

If `unlock_left` is not NULL after a **successful** run, stop and read the
schema-qualification note above — the check and the drop resolved to different
tables, and the unlock is still armed.

### If it ran early by accident

The `DO` block aborts the transaction, so **nothing is partially applied** — the
columns are still there and the database is exactly as it was. Prisma records
the migration as failed and refuses to run anything until you clear it:

```bash
npx prisma migrate resolve --rolled-back 20260721093000_retire_has_audio_step3_drop
```

(use the promoted directory's actual name). Then either arm the unlock properly
or move the directory back to `prisma/migrations-staged/` and redeploy.

The rollback also restored the unlock table if one had been armed, so re-check
its state before the next attempt — `to_regclass` as above — rather than
assuming either way.

### Roll back

There is no rollback. `DROP COLUMN` is not reversible and the data is gone.
Recovery is a point-in-time restore of the whole database, which is why the
unlock exists and why the step 2 image check is not optional.

The only thing worth saying about the lost data: it was wrong. A one-off direct
ingest wrote `has_audio = false` over clips that do contain AAC stereo, and that
row is what muted a published film. Nothing reads the columns after step 2, so
there is nothing to restore them for.

---

## Validating on a shadow database

Every step in this series was validated by replaying the **entire** migration
history onto an empty database, not by diffing against a live one.

```bash
cd apps/server
export PGPASSWORD=fizzdragon
createdb -h localhost -p 5433 -U fizzdragon fizzdragon_shadow
DATABASE_URL='postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon_shadow' \
  npx prisma migrate deploy
```

For step 1 the key property to prove is that **both write shapes are accepted**:
the OLD one that includes the columns and the NEW one that omits them. Insert
one of each against the relaxed constraints and confirm both commit. For step 3,
prove the lock fires without the unlock table and that the migration applies with
it — including that the unlock is gone afterwards, which is what catches a
schema-qualification mismatch between the check and the drop.

The split itself is a shadow-database property too, and it is the one that
matters most here: after replaying the history, the database must be at exactly
the step 1 shape — `story_video_build_clips.has_audio` nullable, both check
constraints rebuilt, the four columns still present. If any column is already
gone, step 3 has leaked into `prisma/migrations/` and must be moved back.

Drop the shadow database afterwards:

```bash
dropdb -h localhost -p 5433 -U fizzdragon fizzdragon_shadow
```

---

## Local databases

Local dev runs **PG16** (`docker-compose.dev.yml`, `postgres:16-alpine` on
`localhost:5433`); production is **PG17**. Nothing in this series is affected by
the difference — see the PG16/PG17 note in each migration header — but two local
issues are worth knowing about.

**1. The abandoned attempt left artifacts.** An earlier single-release version of
this change installed a shim trigger
(`story_video_selections_retired_has_audio_sync_trg`) and its function
(`story_video_selection_retired_has_audio_sync`). Neither exists in any migration
any more. If your local database has them, it predates the split:

```sql
DROP TRIGGER IF EXISTS "story_video_selections_retired_has_audio_sync_trg"
  ON "story_video_selections";
DROP FUNCTION IF EXISTS "story_video_selection_retired_has_audio_sync"();
```

If your local `_prisma_migrations` still names
`20260721090000_retire_video_has_audio_expand`, that directory was renamed to
`20260721090000_retire_has_audio_step1_relax`. Either `npx prisma migrate reset`
(cleanest), or point the existing row at the new name and checksum.

**2. Drift is expected between step 2 and step 3 — and only then.** At commit
`bfd529c6` the datamodel and the database agree exactly: the migration made
`story_video_build_clips.has_audio` nullable and the schema says `Boolean?`. From
commit `<sha-B>` the datamodel is ahead — all four fields are gone from
`schema.prisma`, which is exactly what makes the code stop writing them, but the
columns are still there. `prisma migrate dev` will report drift and offer to
generate a migration that drops them.

> **Do not accept that offer, and never commit the migration it generates.** It
> is step 3, arriving early and without either interlock.

`prisma migrate deploy` (what production runs) does not compare the datamodel to
the database and is unaffected. Locally, `npx prisma migrate reset` re-applies
the history cleanly; the drift warning simply persists until step 3 ships.
