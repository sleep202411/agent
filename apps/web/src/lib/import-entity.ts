import { backendApi } from "@/src/lib/api";
import type { ImportEntityType } from "@/src/types/workspace";

interface RawV1Body<T = unknown> {
  success?: boolean;
  code?: number | string;
  data?: T;
  msg?: string;
  message?: string;
}

async function v1FormData<T>(path: string, formData: FormData, timeout = 600_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method: "POST",
        credentials: "include",
        body: formData,
        signal: controller.signal,
      });
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      throw new Error(isTimeout ? "Request timed out" : "Network connection failed");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as RawV1Body<T>;
    controller.signal.throwIfAborted();
    const isSuccess = body.success === true || body.code === 200 || body.code === "SUCCESS";
    if (!isSuccess) throw new Error(body.msg || body.message || "Request failed");
    return (body.data ?? null) as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function formatImportedEntityExcel(entityType: ImportEntityType, file: File) {
  const pathMap: Record<ImportEntityType, string> = {
    role: "/api/ai/chat/format/role/excel",
    scene: "/api/ai/chat/format/sence/excel",
    prop: "/api/ai/chat/format/prop/excel",
  };
  const formData = new FormData();
  formData.append("file", file);
  return v1FormData<string[][]>(pathMap[entityType], formData);
}

export function batchCreateImportedEntities(
  entityType: ImportEntityType,
  data: { worldId: string; datas: string[][] }
) {
  const pathMap: Record<ImportEntityType, string> = {
    role: "/api/ai/chat/batch/create/role",
    scene: "/api/ai/chat/batch/create/scene",
    prop: "/api/ai/chat/batch/create/prop",
  };
  return backendApi.post(pathMap[entityType], { data, timeout: 300_000 });
}
