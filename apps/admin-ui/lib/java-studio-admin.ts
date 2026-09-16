import "server-only";

import { javaAdminAuthHeaders } from "@/lib/java-admin-auth";

type JavaEnvelope = {
  code?: unknown;
  msg?: unknown;
  message?: unknown;
  data?: unknown;
};

const JAVA_STUDIO_REQUEST_TIMEOUT_MS = 5_000;

export async function requestJavaStudioAdmin(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  for (const [name, value] of Object.entries(javaAdminAuthHeaders())) {
    headers.set(name, value);
  }

  const deadline = AbortSignal.timeout(JAVA_STUDIO_REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`${javaStudioUrl()}${normalizePath(path)}`, {
      ...init,
      headers,
      cache: "no-store",
      // Undici preserves custom headers across cross-origin redirects. Never
      // allow the server-only Java admin token to follow a misconfigured 30x.
      redirect: "error",
      signal,
    });
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(error instanceof Error ? error.message : "Java Studio 管理服务暂时不可访问。");
  }

  signal.throwIfAborted();
  const payload = (await response.json().catch(() => null)) as JavaEnvelope | null;
  signal.throwIfAborted();
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(
      (typeof payload?.message === "string" && payload.message.trim()) ||
        (typeof payload?.msg === "string" && payload.msg.trim()) ||
        `Java Studio 管理请求失败：HTTP ${response.status}`
    );
  }
  return payload.data;
}

function javaStudioUrl(): string {
  const value = process.env.TEXT_GAME_API_BASE_URL?.trim();
  if (!value) {
    throw new Error("缺少 TEXT_GAME_API_BASE_URL，无法连接 Java Studio 管理服务。");
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("unsupported Java Studio URL");
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new Error("TEXT_GAME_API_BASE_URL 必须是没有凭证、查询参数或片段的 HTTP(S) 地址。");
  }
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
