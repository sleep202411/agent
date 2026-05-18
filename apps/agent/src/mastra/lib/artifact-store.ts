/**
 * Workflow artifact store — durable home for products of every phase
 * (story_outline, user_doc, script_breakdown, role_pack, …).
 *
 * Why this exists
 * ───────────────
 * Phase outputs used to live ONLY in Redis (`outline:<projectId>` and
 * friends). That's fast but the contract is fragile:
 *   - 24-day TTL → old projects can't be retried
 *   - skipped paths (user uploads a finished script and bypasses
 *     story_outline) leave nothing behind for downstream phases to
 *     consume → the dreaded "no story outline cached" error
 *   - Redis flush / process restart wipes in-flight projects
 *
 * Lifting "what each phase produced" into Postgres (Azure PG, same
 * instance Mastra uses for its own storage) makes the products
 * first-class records — keyed by `(project_id, kind, version)` and
 * never expiring. Redis stays as the hot cache; this module is the
 * source of truth.
 *
 * Boundaries
 * ──────────
 *   - Schema is created lazily on first use (single `CREATE TABLE IF
 *     NOT EXISTS`). No migrations framework yet because Mastra's
 *     storage tables are managed the same way and the agent service
 *     boots fresh on every deploy.
 *   - Lives in PG schema `mastra` alongside Mastra's own tables — keeps
 *     `public.*` clean for server's Prisma-managed business models.
 *   - We do NOT pipe through `PostgresStore` from `@mastra/pg` because
 *     that wrapper is opinionated about Mastra's own table shapes. We
 *     open our own `pg.Pool` against the same `DATABASE_URL`.
 *   - All callers are server-side (workflow phase code). No exposure
 *     to chat / UI directly; UI sees these via existing `outline.ts`-
 *     style readers that fall through to this layer.
 */

import { Pool } from "pg";

// ─── Errors ────────────────────────────────────────────────────────────

/**
 * Thrown when a phase's required upstream artifact isn't available. Carries
 * the kind and project id so the supervisor / UI / logs can react
 * programmatically instead of regex-matching error strings.
 *
 * Use the `code` field as the stable identifier — message text is for
 * humans and may be translated.
 */
export class MissingArtifactError extends Error {
  readonly code = "MISSING_ARTIFACT" as const;
  readonly projectId: string;
  readonly kind: ArtifactKind | string;
  /** Phase that needed the artifact, e.g. "script_phase". */
  readonly requiredBy: string;
  /** Hint for the supervisor: which workflow can produce this kind. */
  readonly producedBy: string[];

  constructor(input: {
    projectId: string;
    kind: ArtifactKind | string;
    requiredBy: string;
    producedBy?: string[];
    detail?: string;
  }) {
    const producers = input.producedBy ?? [];
    const message =
      `${input.requiredBy}: missing artifact "${input.kind}" for project ${input.projectId}` +
      (producers.length ? ` (run one of: ${producers.join(", ")} first)` : "") +
      (input.detail ? ` — ${input.detail}` : "");
    super(message);
    this.name = "MissingArtifactError";
    this.projectId = input.projectId;
    this.kind = input.kind;
    this.requiredBy = input.requiredBy;
    this.producedBy = producers;
  }
}

export function isMissingArtifactError(err: unknown): err is MissingArtifactError {
  return err instanceof MissingArtifactError;
}

// ─── Types ─────────────────────────────────────────────────────────────

export type ArtifactKind =
  | "outline"
  | "user_doc"
  | "script_breakdown"
  | "role_pack"
  | "scene_pack"
  | "prop_pack"
  | "episode_pack"
  | "script_pack"
  | "storyboard_pack";

export type ArtifactStatus = "pending" | "running" | "completed" | "failed";

export interface ArtifactRecord<T = unknown> {
  id: string;
  projectId: string;
  kind: ArtifactKind | string;
  /** Monotonic per `(projectId, kind)`. Latest = highest. */
  version: number;
  /** Free-form origin label — e.g. "story_outline", "user_upload". */
  source?: string;
  /** id of the upstream artifact this one was derived from, when applicable. */
  parentId?: string;
  content: T;
  meta?: Record<string, unknown>;
  status: ArtifactStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PutArtifactInput<T = unknown> {
  projectId: string;
  kind: ArtifactKind | string;
  source?: string;
  parentId?: string;
  content: T;
  meta?: Record<string, unknown>;
  /** Defaults to "completed". Use "failed" / "running" for partial states. */
  status?: ArtifactStatus;
}

// ─── Connection ────────────────────────────────────────────────────────

let _pool: Pool | null = null;
let _initPromise: Promise<void> | null = null;

function getPool(): Pool {
  if (_pool) return _pool;
  // Same connection string the rest of the agent (and server) uses,
  // injected via K8s envFrom from KV. Intentionally lazy so unit tests
  // can override DATABASE_URL before the first call.
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("artifact-store: DATABASE_URL is not set — required for Postgres connection");
  }
  _pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false }, // Azure PG enforces SSL
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

async function ensureSchema(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const pool = getPool();
    // Lives in `mastra` schema alongside Mastra's own tables — keeps the
    // public business schema (Prisma-managed by server) untouched.
    await pool.query(`CREATE SCHEMA IF NOT EXISTS mastra`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mastra.project_workflow_artifact (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        kind        TEXT NOT NULL,
        version     INTEGER NOT NULL DEFAULT 1,
        source      TEXT,
        parent_id   TEXT,
        content     JSONB NOT NULL,
        meta        JSONB,
        status      TEXT NOT NULL DEFAULT 'completed',
        created_at  BIGINT NOT NULL,
        updated_at  BIGINT NOT NULL,
        UNIQUE (project_id, kind, version)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS project_workflow_artifact_lookup
        ON mastra.project_workflow_artifact (project_id, kind, version DESC)
    `);
  })();
  return _initPromise;
}

// ─── (De)serialization ─────────────────────────────────────────────────

interface DbRow {
  id: string;
  project_id: string;
  kind: string;
  version: number;
  source: string | null;
  parent_id: string | null;
  /** JSONB — pg driver returns native object/value, no JSON.parse needed. */
  content: unknown;
  /** JSONB — same. */
  meta: Record<string, unknown> | null;
  status: string;
  /** BIGINT — pg returns string by default; parse to number on read. */
  created_at: string | number;
  updated_at: string | number;
}

function rowToRecord<T>(row: DbRow): ArtifactRecord<T> {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    version: Number(row.version),
    source: row.source ?? undefined,
    parentId: row.parent_id ?? undefined,
    content: row.content as T,
    meta: row.meta ?? undefined,
    status: row.status as ArtifactStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function newId(): string {
  // Same ULID-ish randomness the rest of the codebase uses via randomUUID;
  // we don't need cryptographic strength, just collision-resistant ids.
  return `aw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Insert a new artifact. Each call creates a NEW version; latest-wins
 * via `getLatestArtifact`. Callers don't manage version numbers — the
 * store reads the current MAX(version) for `(projectId, kind)` and
 * inserts MAX+1 atomically.
 */
export async function putArtifact<T = unknown>(
  input: PutArtifactInput<T>
): Promise<ArtifactRecord<T>> {
  await ensureSchema();
  const pool = getPool();
  const now = Date.now();

  // Race-tolerant version bump: read max, attempt insert, retry once on
  // UNIQUE conflict (someone else slipped in between read + write). PG
  // signals UNIQUE violation with SQLSTATE 23505 — far more reliable than
  // string matching the message.
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxRow = await pool.query<{ max_version: string | number }>({
      text: `SELECT COALESCE(MAX(version), 0) AS max_version
               FROM mastra.project_workflow_artifact
              WHERE project_id = $1 AND kind = $2`,
      values: [input.projectId, input.kind],
    });
    const previous = Number(maxRow.rows[0]?.max_version ?? 0);
    const version = previous + 1;
    const id = newId();
    try {
      await pool.query({
        text: `INSERT INTO mastra.project_workflow_artifact
                 (id, project_id, kind, version, source, parent_id,
                  content, meta, status, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        values: [
          id,
          input.projectId,
          input.kind,
          version,
          input.source ?? null,
          input.parentId ?? null,
          // pg driver serializes objects to JSONB automatically when the
          // column type is JSONB.
          input.content,
          input.meta ?? null,
          input.status ?? "completed",
          now,
          now,
        ],
      });
      return {
        id,
        projectId: input.projectId,
        kind: input.kind,
        version,
        source: input.source,
        parentId: input.parentId,
        content: input.content,
        meta: input.meta,
        status: input.status ?? "completed",
        createdAt: now,
        updatedAt: now,
      };
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code;
      // 23505 = unique_violation. Anything else is a real failure.
      if (code !== "23505") throw err;
    }
  }
  throw new Error(
    `artifact-store: gave up inserting after UNIQUE conflicts ` +
      `(projectId=${input.projectId}, kind=${input.kind})`
  );
}

/** Latest version for `(projectId, kind)` regardless of status. */
export async function getLatestArtifact<T = unknown>(
  projectId: string,
  kind: ArtifactKind | string
): Promise<ArtifactRecord<T> | null> {
  await ensureSchema();
  const pool = getPool();
  const result = await pool.query<DbRow>({
    text: `SELECT id, project_id, kind, version, source, parent_id,
                  content, meta, status, created_at, updated_at
             FROM mastra.project_workflow_artifact
            WHERE project_id = $1 AND kind = $2
            ORDER BY version DESC
            LIMIT 1`,
    values: [projectId, kind],
  });
  const row = result.rows[0];
  return row ? rowToRecord<T>(row) : null;
}

/**
 * Look up the latest artifact whose `meta.attachmentRef` matches `ref`.
 *
 * Used by `attachment-resolve` so that a stale Redis attachment ref
 * (1-hour TTL) can still resolve to the original uploaded text — we
 * write a `user_doc` artifact on first resolution and read it back on
 * subsequent resolutions after Redis evicts. Scoped to (projectId, kind)
 * because attachment refs are project-scoped in the chat session.
 *
 * Uses PG's `->>` JSONB extract operator (returns text) for the
 * attachmentRef key. Index-less, but `user_doc` artifacts per project
 * are 1-2 rows in practice; full scan within the project partition is
 * fine.
 */
export async function findArtifactByAttachmentRef<T = unknown>(
  projectId: string,
  kind: ArtifactKind | string,
  ref: string
): Promise<ArtifactRecord<T> | null> {
  await ensureSchema();
  const pool = getPool();
  const result = await pool.query<DbRow>({
    text: `SELECT id, project_id, kind, version, source, parent_id,
                  content, meta, status, created_at, updated_at
             FROM mastra.project_workflow_artifact
            WHERE project_id = $1
              AND kind = $2
              AND meta ->> 'attachmentRef' = $3
            ORDER BY version DESC
            LIMIT 1`,
    values: [projectId, kind, ref],
  });
  const row = result.rows[0];
  return row ? rowToRecord<T>(row) : null;
}

/** All artifacts for a project, newest first (across all kinds). */
export async function listProjectArtifacts(projectId: string): Promise<ArtifactRecord[]> {
  await ensureSchema();
  const pool = getPool();
  const result = await pool.query<DbRow>({
    text: `SELECT id, project_id, kind, version, source, parent_id,
                  content, meta, status, created_at, updated_at
             FROM mastra.project_workflow_artifact
            WHERE project_id = $1
            ORDER BY updated_at DESC`,
    values: [projectId],
  });
  return result.rows.map((r) => rowToRecord(r));
}

/**
 * Test-only: drop the table. Production code should never call this —
 * exposed solely so vitest can reset state between cases.
 */
export async function _resetForTests(): Promise<void> {
  const pool = getPool();
  await pool.query(`DROP TABLE IF EXISTS mastra.project_workflow_artifact`);
  _initPromise = null;
}
