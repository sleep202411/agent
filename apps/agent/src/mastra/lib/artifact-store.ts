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
 * Lifting "what each phase produced" into the LibSQL DB that Mastra
 * already uses for its own snapshots makes the products first-class
 * records — keyed by `(project_id, kind, version)` and never expiring.
 * Redis stays as the hot cache; this module is the source of truth.
 *
 * Boundaries
 * ──────────
 *   - Schema is created lazily on first use (single `CREATE TABLE IF
 *     NOT EXISTS`). No migrations framework yet because Mastra's
 *     storage tables are managed the same way and the agent service
 *     boots fresh on every deploy.
 *   - We do NOT pipe through `LibSQLStore` from `@mastra/libsql` because
 *     that wrapper is opinionated about Mastra's own table shapes. We
 *     open our own `@libsql/client` connection against the same URL
 *     (`MASTRA_DB_URL` or the local `file:./mastra.db`).
 *   - All callers are server-side (workflow phase code). No exposure
 *     to chat / UI directly; UI sees these via existing `outline.ts`-
 *     style readers that fall through to this layer.
 */

import { createClient, type Client } from "@libsql/client";

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

let _client: Client | null = null;
let _initPromise: Promise<void> | null = null;

function getClient(): Client {
  if (_client) return _client;
  // Mirror the URL the rest of the agent uses for Mastra's own storage.
  // Intentionally lazy so unit tests can override MASTRA_DB_URL before the
  // first call.
  const url = process.env.MASTRA_DB_URL ?? "file:./mastra.db";
  const authToken = process.env.MASTRA_DB_AUTH_TOKEN;
  _client = createClient(authToken ? { url, authToken } : { url });
  return _client;
}

async function ensureSchema(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const client = getClient();
    await client.execute(`
      CREATE TABLE IF NOT EXISTS project_workflow_artifact (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        kind        TEXT NOT NULL,
        version     INTEGER NOT NULL DEFAULT 1,
        source      TEXT,
        parent_id   TEXT,
        content     TEXT NOT NULL,
        meta        TEXT,
        status      TEXT NOT NULL DEFAULT 'completed',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        UNIQUE (project_id, kind, version)
      )
    `);
    await client.execute(`
      CREATE INDEX IF NOT EXISTS project_workflow_artifact_lookup
        ON project_workflow_artifact (project_id, kind, version DESC)
    `);
  })();
  return _initPromise;
}

// ─── (De)serialization ─────────────────────────────────────────────────

interface DbRow {
  id: string;
  project_id: string;
  kind: string;
  version: number | bigint;
  source: string | null;
  parent_id: string | null;
  content: string;
  meta: string | null;
  status: string;
  created_at: number | bigint;
  updated_at: number | bigint;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToRecord<T>(row: DbRow): ArtifactRecord<T> {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    version: Number(row.version),
    source: row.source ?? undefined,
    parentId: row.parent_id ?? undefined,
    content: parseJson<T>(row.content, {} as T),
    meta: row.meta ? parseJson<Record<string, unknown>>(row.meta, {}) : undefined,
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
  const client = getClient();
  const now = Date.now();

  // Race-tolerant version bump: read max, attempt insert, retry once on
  // UNIQUE conflict (someone else slipped in between read + write).
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxRow = await client.execute({
      sql: `SELECT COALESCE(MAX(version), 0) AS max_version
              FROM project_workflow_artifact
             WHERE project_id = ? AND kind = ?`,
      args: [input.projectId, input.kind],
    });
    const previous = Number(
      (maxRow.rows[0] as { max_version?: number | bigint } | undefined)?.max_version ?? 0
    );
    const version = previous + 1;
    const id = newId();
    try {
      await client.execute({
        sql: `INSERT INTO project_workflow_artifact
                (id, project_id, kind, version, source, parent_id,
                 content, meta, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.projectId,
          input.kind,
          version,
          input.source ?? null,
          input.parentId ?? null,
          JSON.stringify(input.content),
          input.meta ? JSON.stringify(input.meta) : null,
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
      const msg = err instanceof Error ? err.message : String(err);
      // libsql raises a UNIQUE constraint error using the same wording as
      // upstream sqlite. Anything else is a real failure.
      if (!msg.includes("UNIQUE constraint failed")) throw err;
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
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, project_id, kind, version, source, parent_id,
                 content, meta, status, created_at, updated_at
            FROM project_workflow_artifact
           WHERE project_id = ? AND kind = ?
           ORDER BY version DESC
           LIMIT 1`,
    args: [projectId, kind],
  });
  const row = result.rows[0] as unknown as DbRow | undefined;
  return row ? rowToRecord<T>(row) : null;
}

/** All artifacts for a project, newest first (across all kinds). */
export async function listProjectArtifacts(projectId: string): Promise<ArtifactRecord[]> {
  await ensureSchema();
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, project_id, kind, version, source, parent_id,
                 content, meta, status, created_at, updated_at
            FROM project_workflow_artifact
           WHERE project_id = ?
           ORDER BY updated_at DESC`,
    args: [projectId],
  });
  return (result.rows as unknown as DbRow[]).map((r) => rowToRecord(r));
}

/**
 * Test-only: drop the table. Production code should never call this —
 * exposed solely so vitest can reset state between cases.
 */
export async function _resetForTests(): Promise<void> {
  const client = getClient();
  await client.execute(`DROP TABLE IF EXISTS project_workflow_artifact`);
  _initPromise = null;
}
