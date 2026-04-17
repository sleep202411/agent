/**
 * Batch writers for the three world-asset entity types: role, scene, prop.
 *
 * Phase 2a: each wrapper calls the existing Java single-create endpoint in a
 * loop, routed through `batchUpsert` so idempotency via Redis is applied.
 *
 * Phase 2b: when Java exposes proper batch endpoints (see
 * `docs/storyos-v2/java-api-requirements.md` §1), replace the body with a
 * single Java call. **Do not change the exported function signatures** —
 * callers (workflows, agent tools) depend on them.
 */
import {
  batchUpsert,
  type BatchItem,
  type BatchResult,
  type BatchWriterOptions,
} from "../batch-writer";
import { javaRequest, type StoryosContext } from "../workspace-client";

// ─── Payload shapes sent to Java ──────────────────────────────────────
// Mirror the existing server/workspace.service.ts create methods so we stay
// on the contract Java already supports.

export type RoleCreateData = {
  /** World ID this role belongs to. Resolved at draft time, passed here. */
  worldId: string;
  name: string;
  description?: string;
  prompt?: string;
  roleImgPath?: string[];
  referenceImgPath?: string[];
  referenceImgDescription?: string[];
  model?: string;
  voiceId?: string;
};

export type SceneCreateData = {
  worldId: string;
  name: string;
  description?: string;
  prompt?: string;
};

export type PropCreateData = {
  worldId: string;
  name: string;
  description?: string;
};

// ─── Java single-create helpers (Phase 2a) ────────────────────────────

type JavaCreateResponse = { id?: string | number };

function toServerId(value: unknown, entityLabel: string): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "id" in (value as object)) {
    const id = (value as JavaCreateResponse).id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  throw new Error(
    `[batchUpsert${entityLabel}] Java response missing id field: ${JSON.stringify(value).slice(0, 200)}`
  );
}

async function createRoleSingle(ctx: StoryosContext, data: RoleCreateData): Promise<string> {
  const body = {
    worldId: data.worldId,
    name: data.name,
    description: data.description ?? "",
    prompt: data.prompt ?? data.description ?? "",
    roleImgPath: data.roleImgPath ?? [],
    referenceImgPath: data.referenceImgPath ?? [],
    referenceImgDescription: data.referenceImgDescription ?? [],
    model: data.model ?? "",
    voiceId: data.voiceId ?? "",
  };
  const resp = await javaRequest<unknown>(ctx, "/api/user/world/create/worldrole", { data: body });
  return toServerId(resp, "Roles");
}

async function createSceneSingle(ctx: StoryosContext, data: SceneCreateData): Promise<string> {
  const body = {
    worldId: data.worldId,
    name: data.name,
    description: data.description ?? "",
    prompt: data.prompt ?? data.description ?? "",
  };
  const resp = await javaRequest<unknown>(ctx, "/api/user/world/create/worldscene", { data: body });
  return toServerId(resp, "Scenes");
}

async function createPropSingle(ctx: StoryosContext, data: PropCreateData): Promise<string> {
  const body = {
    worldId: data.worldId,
    name: data.name,
    description: data.description ?? "",
  };
  const resp = await javaRequest<unknown>(ctx, "/api/user/world/create/worldprop", { data: body });
  return toServerId(resp, "Props");
}

// ─── Public batch wrappers ────────────────────────────────────────────

export async function batchUpsertRoles(
  ctx: StoryosContext,
  items: BatchItem<RoleCreateData>[],
  opts?: BatchWriterOptions
): Promise<BatchResult[]> {
  return batchUpsert({ ctx, entityType: "role", items, creator: createRoleSingle, opts });
}

export async function batchUpsertScenes(
  ctx: StoryosContext,
  items: BatchItem<SceneCreateData>[],
  opts?: BatchWriterOptions
): Promise<BatchResult[]> {
  return batchUpsert({ ctx, entityType: "scene", items, creator: createSceneSingle, opts });
}

export async function batchUpsertProps(
  ctx: StoryosContext,
  items: BatchItem<PropCreateData>[],
  opts?: BatchWriterOptions
): Promise<BatchResult[]> {
  return batchUpsert({ ctx, entityType: "prop", items, creator: createPropSingle, opts });
}
