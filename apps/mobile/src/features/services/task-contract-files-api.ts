import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { fetchTaskDetail } from "./task-detail-api";
const id = z.string().uuid();
export const contractLifecycles = ["all", "active", "archived"] as const;
export type ContractLifecycle = (typeof contractLifecycles)[number];
export const taskContractFile = z.object({
  id,
  name: z.string(),
  attachedAt: z.string().datetime({ offset: true }).nullable(),
  sizeBytes: z.string().regex(/^\d+$/).nullable(),
  contentType: z.string().nullable(),
  available: z.boolean(),
});
export type TaskContractFile = z.infer<typeof taskContractFile>;
const task = z.object({
  id,
  title: z.string(),
  number: z.number().int().positive(),
  crew: z.object({ id: z.string().min(1), name: z.string() }),
  archived: z.boolean(),
  files: z.array(taskContractFile),
});
export type ContractTask = z.infer<typeof task>;
export function contractSession(generation: number, signal?: AbortSignal) {
  if (getAuthGeneration() !== generation || signal?.aborted)
    throw Error("Contract session expired.");
}
export async function fetchTaskContracts(taskId: string, generation: number, signal: AbortSignal) {
  contractSession(generation, signal);
  const result = z.object({ items: z.array(taskContractFile) }).parse(
    await api.get(`/crew-tasks/${id.parse(taskId)}/contracts`, {
      service: "aurora",
      signal,
      retry: false,
      cache: "no-store",
    })
  );
  contractSession(generation, signal);
  return result.items;
}
export async function fetchMyTaskContracts(
  lifecycle: ContractLifecycle,
  cursor: string | null,
  generation: number,
  signal: AbortSignal
) {
  contractSession(generation, signal);
  const result = z.object({ items: z.array(task), nextCursor: id.nullable() }).parse(
    await api.get("/me/task-contracts", {
      service: "aurora",
      signal,
      retry: false,
      cache: "no-store",
      params: {
        lifecycle: z.enum(contractLifecycles).parse(lifecycle),
        limit: 20,
        ...(cursor ? { cursor: id.parse(cursor) } : {}),
      },
    })
  );
  contractSession(generation, signal);
  if (
    result.items.some((row) => lifecycle !== "all" && row.archived !== (lifecycle === "archived"))
  )
    throw Error("Contract lifecycle mismatch.");
  return result;
}
export async function attachTaskContract(
  crewId: string,
  taskId: string,
  userId: string,
  generation: number,
  assetNodeId: string,
  signal: AbortSignal
) {
  contractSession(generation, signal);
  id.parse(taskId);
  id.parse(assetNodeId);
  const [access] = await Promise.all([
    fetchTaskCommentAccess(crewId, userId, signal),
    fetchTaskDetail(crewId, taskId, signal),
  ]);
  contractSession(generation, signal);
  if (!access.canManage)
    throw Error("Task management permission is required to attach a contract.");
  // The official endpoint uniquely identifies a retained file by task + asset, so explicit retry is safe.
  const receipt = z.object({ id }).parse(
    await api.post(`/crew-tasks/${taskId}/contracts`, {
      service: "aurora",
      signal,
      retry: false,
      data: { assetNodeId },
    })
  );
  contractSession(generation, signal);
  return receipt;
}
export async function fetchTaskContractDownload(
  fileId: string,
  generation: number,
  signal: AbortSignal
) {
  contractSession(generation, signal);
  const result = z
    .object({ url: z.string().url(), expiresAt: z.string().datetime({ offset: true }) })
    .parse(
      await api.get(`/task-contract-files/${id.parse(fileId)}/download`, {
        service: "aurora",
        signal,
        retry: false,
        cache: "no-store",
      })
    );
  contractSession(generation, signal);
  const url = new URL(result.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    Date.parse(result.expiresAt) <= Date.now()
  )
    throw Error("Contract download link is invalid or expired.");
  return result.url;
}
