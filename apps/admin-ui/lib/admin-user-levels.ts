/**
 * Server-side client for Java `/api/admin/user-levels` (认证等级).
 *
 * Base: JAVA_ADMIN_API_BASE_URL (falls back to NEWS_API_BASE_URL) — must include
 * `/content`. Auth: X-Admin-Api-Token via javaAdminAuthHeaders().
 *
 * NEVER import from client components; mutations/list refresh go through
 * app/api/admin/user-levels/* after getAdminSession().
 *
 * Contract: docs/admin-user-level-api.md
 */
import "server-only";

import { javaAdminAuthHeaders } from "@/lib/java-admin-auth";

function userLevelsApiBaseUrl(): string {
  const base = (process.env.JAVA_ADMIN_API_BASE_URL ?? process.env.NEWS_API_BASE_URL)?.trim();
  if (base) return base.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "https://java.fizzdragon.com/content";
  throw new Error("Missing JAVA_ADMIN_API_BASE_URL / NEWS_API_BASE_URL (Java content origin).");
}

type JavaEnvelope = {
  code?: number;
  msg?: string;
  message?: string;
  data?: unknown;
  total?: number;
  page?: number;
  pageSize?: number;
};

async function userLevelsFetch(path: string, init?: RequestInit): Promise<JavaEnvelope> {
  const response = await fetch(`${userLevelsApiBaseUrl()}/api/admin/user-levels${path}`, {
    ...init,
    headers: {
      ...javaAdminAuthHeaders(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    // Custom admin-token headers must never follow an upstream redirect.
    redirect: "error",
  });
  const payload = (await response.json().catch(() => null)) as JavaEnvelope | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(payload?.message ?? payload?.msg ?? `认证等级服务请求失败：${response.status}`);
  }
  return payload;
}

export type AdminUserLevelDefinition = {
  id: number;
  name: string;
  description: string;
  imagePath: string | null;
  type: number | null;
  remark: string | null;
  createTime: string | null;
  updateTime: string | null;
};

export type AdminUserLevelRelation = {
  id: number;
  userId: number;
  userName: string | null;
  levelId: number;
  levelName: string | null;
  remark: string | null;
  createTime: string | null;
  updateTime: string | null;
};

export type AdminUserLevelListParams = {
  page?: number;
  pageSize?: number;
  userId?: number;
  levelId?: number;
};

export type AdminUserLevelListResult = {
  items: AdminUserLevelRelation[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminUserLevelSaveInput = {
  id?: number;
  userId?: number;
  levelId: number;
  remark?: string;
};

export type AdminUserLevelLoadResult<T> = {
  data: T | null;
  error: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRelation(raw: unknown): AdminUserLevelRelation | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asNumber(row.id);
  const userId = asNumber(row.userId);
  const levelId = asNumber(row.levelId);
  if (id === null || userId === null || levelId === null) return null;
  return {
    id,
    userId,
    userName: asString(row.userName),
    levelId,
    levelName: asString(row.levelName),
    remark: asString(row.remark),
    createTime: asString(row.createTime),
    updateTime: asString(row.updateTime),
  };
}

function toLevelDefinition(raw: unknown): AdminUserLevelDefinition | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asNumber(row.id);
  const name = asString(row.name);
  if (id === null || !name) return null;
  return {
    id,
    name,
    description: asString(row.description) ?? "",
    imagePath: asString(row.imagePath),
    type: asNumber(row.type),
    remark: asString(row.remark),
    createTime: asString(row.createTime),
    updateTime: asString(row.updateTime),
  };
}

export async function listAdminUserLevelRelations(
  params: AdminUserLevelListParams = {}
): Promise<AdminUserLevelListResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (params.userId !== undefined) query.set("userId", String(params.userId));
  if (params.levelId !== undefined) query.set("levelId", String(params.levelId));

  const payload = await userLevelsFetch(`?${query.toString()}`);
  const items = Array.isArray(payload.data)
    ? payload.data.map(toRelation).filter((row): row is AdminUserLevelRelation => row !== null)
    : [];

  return {
    items,
    total: asNumber(payload.total) ?? items.length,
    page: asNumber(payload.page) ?? page,
    pageSize: asNumber(payload.pageSize) ?? pageSize,
  };
}

export async function listAdminUserLevelDefinitions(): Promise<AdminUserLevelDefinition[]> {
  const payload = await userLevelsFetch("/levels");
  if (!Array.isArray(payload.data)) return [];
  return payload.data
    .map(toLevelDefinition)
    .filter((row): row is AdminUserLevelDefinition => row !== null);
}

export async function saveAdminUserLevelRelation(input: AdminUserLevelSaveInput): Promise<void> {
  const body: Record<string, unknown> = {
    levelId: input.levelId,
  };
  if (input.id !== undefined) body.id = input.id;
  if (input.userId !== undefined) body.userId = input.userId;
  if (input.remark !== undefined) body.remark = input.remark;
  await userLevelsFetch("", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteAdminUserLevelRelation(id: number): Promise<void> {
  await userLevelsFetch(`?id=${encodeURIComponent(String(id))}`, {
    method: "DELETE",
  });
}

export async function loadAdminUserLevelRelations(
  params?: AdminUserLevelListParams
): Promise<AdminUserLevelLoadResult<AdminUserLevelListResult>> {
  try {
    return { data: await listAdminUserLevelRelations(params), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "加载用户认证等级失败。",
    };
  }
}

export async function loadAdminUserLevelDefinitions(): Promise<
  AdminUserLevelLoadResult<AdminUserLevelDefinition[]>
> {
  try {
    return { data: await listAdminUserLevelDefinitions(), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "加载等级定义失败。",
    };
  }
}
