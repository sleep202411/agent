/**
 * Single source of truth for resolving `att_<hex>` attachment refs to the
 * underlying text the user uploaded.
 *
 * Why this exists
 * ───────────────
 * NestJS preprocess caches the extracted text of user uploads in Redis under
 * `attachment:att_xxx` with a 1-hour TTL. Any later turn that still references
 * the ref — `invoke_workflow({textRef: "att_xxx"})`, an `analyze_brief` retry,
 * the `/workflow/start` short-circuit — used to throw "Attachment ref not
 * found or expired" the moment the TTL elapsed, even though the same text
 * lives durably in our artifact store as a `user_doc`.
 *
 * Two-tier resolution
 * ───────────────────
 *   1. Redis hit → return text. **Side effect:** idempotently write a
 *      `user_doc` artifact keyed by `meta.attachmentRef` so we have a durable
 *      copy if Redis evicts before the next resolution.
 *   2. Redis miss → fall back to `findArtifactByAttachmentRef(projectId,
 *      "user_doc", ref)`. If the durable copy exists, return it.
 *   3. Both miss → throw the original "not found or expired" error.
 *
 * The dual-write happens lazily on first read rather than at upload time so
 * we don't need a cross-process write path (Nest → agent's libsql); the agent
 * reads the cache hit anyway, so promoting it to durable storage is free at
 * that moment.
 */

import { getRedis } from "./redis-client";
import { findArtifactByAttachmentRef, getLatestArtifact, putArtifact } from "./artifact-store";

export interface AttachmentPayload {
  text: string;
  filename?: string;
  mimeType?: string;
  chars?: number;
  cachedAt?: number;
}

interface ResolveOptions {
  /**
   * Project to scope durable lookups to. When absent (e.g. analyze_brief
   * pre-project-creation), the durable fallback is skipped — Redis hit
   * still returns text, but no dual-write or fallback. Pass empty string
   * or undefined to opt out.
   */
  projectId?: string;
}

/**
 * Resolve a single `att_<hex>` ref to the underlying text. Throws with the
 * canonical "Attachment ref not found or expired" message when both Redis
 * and the artifact store come up empty (callers downstream regex this
 * message in tests / logs, so keep it stable).
 */
export async function resolveAttachmentText(
  ref: string,
  opts: ResolveOptions = {}
): Promise<string> {
  if (!ref.startsWith("att_")) {
    throw new Error(`Not an attachment ref: ${ref}`);
  }
  const projectId = opts.projectId?.trim() ?? "";

  // Tier 1: Redis cache (the hot path during the 1-hour TTL window).
  const redis = getRedis();
  const raw = await redis.get(`attachment:${ref}`);
  if (raw) {
    const parsed = JSON.parse(raw) as Partial<AttachmentPayload>;
    if (typeof parsed.text !== "string") {
      throw new Error(`Attachment ${ref} has no text field`);
    }
    if (projectId) {
      // Promote to durable storage so a future resolution survives Redis
      // eviction. Idempotent: skip the write if the same ref is already
      // recorded under this project.
      try {
        const existing = await findArtifactByAttachmentRef(projectId, "user_doc", ref);
        if (!existing) {
          await putArtifact({
            projectId,
            kind: "user_doc",
            source: "attachment_promote",
            content: { text: parsed.text },
            meta: {
              attachmentRef: ref,
              filename: parsed.filename,
              mimeType: parsed.mimeType,
              chars: parsed.chars ?? parsed.text.length,
              promotedAt: Date.now(),
            },
          });
        }
      } catch (err) {
        // Best-effort: a failed promote shouldn't fail the user-visible
        // resolution. Log + continue with the Redis-resolved text.
        // eslint-disable-next-line no-console
        console.warn(
          `[attachment-resolve] promote failed for ${ref}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    return parsed.text;
  }

  // Tier 2: artifact store fallback (Redis evicted, but we kept a durable
  // copy from a previous resolution OR from parse_script's commit-time
  // user_doc write). Only meaningful when we know the project.
  if (projectId) {
    const artifact = await findArtifactByAttachmentRef<{ text?: string }>(
      projectId,
      "user_doc",
      ref
    );
    const text = artifact?.content?.text;
    if (typeof text === "string" && text.length > 0) return text;

    // Last-resort: any user_doc on this project. This is permissive — if a
    // user uploaded once, the chat session may have lost the original ref
    // but the most recent user_doc is overwhelmingly likely to be what they
    // want. Logged so we can spot when this path actually fires.
    const latest = await getLatestArtifact<{ text?: string }>(projectId, "user_doc");
    const fallbackText = latest?.content?.text;
    if (typeof fallbackText === "string" && fallbackText.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[attachment-resolve] ${ref} not in Redis or by-ref store; ` +
          `falling back to latest user_doc v${latest!.version} (project ${projectId})`
      );
      return fallbackText;
    }
  }

  throw new Error(`Attachment ref not found or expired: ${ref}`);
}

/**
 * Recursively walk an arbitrary tool / workflow input value and rewrite any
 * field whose key ends in `Ref` and value starts with `att_` into the bare
 * field (e.g. `textRef: "att_xxx"` → `text: "<resolved>"`). Mirrors the
 * convention used by `invoke_workflow` and `/workflow/start`.
 */
export async function resolveAttachmentRefs(
  value: unknown,
  opts: ResolveOptions = {}
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveAttachmentRefs(item, opts)));
  }
  if (value === null || typeof value !== "object") return value;

  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(src)) {
    if (key.endsWith("Ref") && key.length > 3 && typeof v === "string" && v.startsWith("att_")) {
      const text = await resolveAttachmentText(v, opts);
      out[key.slice(0, -"Ref".length)] = text;
    } else {
      out[key] = await resolveAttachmentRefs(v, opts);
    }
  }
  return out;
}
