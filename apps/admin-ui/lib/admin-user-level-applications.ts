/**
 * Server-side client for Java `/api/admin/user-level-applications`.
 *
 * Base: JAVA_ADMIN_API_BASE_URL (falls back to NEWS_API_BASE_URL) — must include
 * `/content`. Auth: X-Admin-Api-Token via javaAdminAuthHeaders().
 *
 * NEVER import from client components; mutations/list refresh go through
 * app/api/admin/user-level-applications/* after getAdminSession().
 *
 * Contract: fizzdragon/docs/user-level-apply-api.md (admin section).
 */
import "server-only";

import { javaAdminAuthHeaders } from "@/lib/java-admin-auth";

function applicationsApiBaseUrl(): string {
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

async function applicationsFetch(path: string, init?: RequestInit): Promise<JavaEnvelope> {
  const response = await fetch(
    `${applicationsApiBaseUrl()}/api/admin/user-level-applications${path}`,
    {
      ...init,
      headers: {
        ...javaAdminAuthHeaders(),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    }
  );
  const payload = (await response.json().catch(() => null)) as JavaEnvelope | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(
      payload?.message ?? payload?.msg ?? `认证等级申请服务请求失败：${response.status}`
    );
  }
  return payload;
}

/** 0 pending · 1 approved · 2 rejected · 3 cancelled */
export type AdminUserLevelApplicationStatus = 0 | 1 | 2 | 3;

export type AdminUserLevelApplication = {
  id: number;
  userId: number;
  userName: string | null;
  levelId: number;
  levelName: string | null;
  crewName: string;
  crewLink: string;
  ipName: string;
  ipLink: string;
  attachmentUrl: string | null;
  extraInfo: string | null;
  status: AdminUserLevelApplicationStatus;
  adminRemark: string | null;
  createTime: string | null;
  updateTime: string | null;
};

export type AdminUserLevelApplicationListParams = {
  page?: number;
  pageSize?: number;
  status?: AdminUserLevelApplicationStatus;
  userId?: number;
  levelId?: number;
};

export type AdminUserLevelApplicationListResult = {
  items: AdminUserLevelApplication[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminUserLevelApplicationLoadResult<T> = {
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

function asStatus(value: unknown): AdminUserLevelApplicationStatus | null {
  const n = asNumber(value);
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return null;
}

function toApplication(raw: unknown): AdminUserLevelApplication | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asNumber(row.id);
  const userId = asNumber(row.userId);
  const levelId = asNumber(row.levelId);
  const status = asStatus(row.status);
  const crewName = asString(row.crewName);
  const crewLink = asString(row.crewLink);
  const ipName = asString(row.ipName);
  const ipLink = asString(row.ipLink);
  if (
    id === null ||
    userId === null ||
    levelId === null ||
    status === null ||
    !crewName ||
    !crewLink ||
    !ipName ||
    !ipLink
  ) {
    return null;
  }
  return {
    id,
    userId,
    userName: asString(row.userName),
    levelId,
    levelName: asString(row.levelName),
    crewName,
    crewLink,
    ipName,
    ipLink,
    attachmentUrl: asString(row.attachmentUrl),
    extraInfo: asString(row.extraInfo),
    status,
    adminRemark: asString(row.adminRemark),
    createTime: asString(row.createTime),
    updateTime: asString(row.updateTime),
  };
}

export async function listAdminUserLevelApplications(
  params: AdminUserLevelApplicationListParams = {}
): Promise<AdminUserLevelApplicationListResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (params.status !== undefined) query.set("status", String(params.status));
  if (params.userId !== undefined) query.set("userId", String(params.userId));
  if (params.levelId !== undefined) query.set("levelId", String(params.levelId));

  const payload = await applicationsFetch(`?${query.toString()}`);
  const items = Array.isArray(payload.data)
    ? payload.data
        .map(toApplication)
        .filter((row): row is AdminUserLevelApplication => row !== null)
    : [];

  return {
    items,
    total: asNumber(payload.total) ?? items.length,
    page: asNumber(payload.page) ?? page,
    pageSize: asNumber(payload.pageSize) ?? pageSize,
  };
}

export async function getAdminUserLevelApplication(id: number): Promise<AdminUserLevelApplication> {
  const payload = await applicationsFetch(`/${encodeURIComponent(String(id))}`);
  const row = toApplication(payload.data);
  if (!row) throw new Error("申请详情格式无效");
  return row;
}

export async function approveAdminUserLevelApplication(
  id: number,
  adminRemark?: string
): Promise<void> {
  const body: Record<string, unknown> = {};
  const remark = adminRemark?.trim();
  if (remark) body.adminRemark = remark;
  await applicationsFetch(`/${encodeURIComponent(String(id))}/approve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function rejectAdminUserLevelApplication(
  id: number,
  adminRemark?: string
): Promise<void> {
  const body: Record<string, unknown> = {};
  const remark = adminRemark?.trim();
  if (remark) body.adminRemark = remark;
  await applicationsFetch(`/${encodeURIComponent(String(id))}/reject`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function loadAdminUserLevelApplications(
  params?: AdminUserLevelApplicationListParams
): Promise<AdminUserLevelApplicationLoadResult<AdminUserLevelApplicationListResult>> {
  try {
    return { data: await listAdminUserLevelApplications(params), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "加载认证等级申请失败。",
    };
  }
}
