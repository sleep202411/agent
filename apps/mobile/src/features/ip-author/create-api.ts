import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
export const createCommand = z.object({
  clientKey: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(280),
  genreCodes: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  sourceLocale: z.enum(["en-US", "zh-CN", "zh-HK"]),
  region: z
    .string()
    .trim()
    .toUpperCase()
    .max(16)
    .refine((v) => !v || v.length >= 2),
  channelType: z.enum(["ip", "community"]),
});
export type CreateCommand = z.infer<typeof createCommand>;
export function createOutbox(userId: string, generation: number) {
  return pendingRequest(createCommand, generation, durableRecord("ip-create", userId, "draft"));
}
export async function createIp(
  userId: string,
  generation: number,
  input: CreateCommand,
  signal: AbortSignal
) {
  const current = () => {
    signal.throwIfAborted();
    if (generation !== getAuthGeneration()) throw new Error("IP creation session expired.");
  };
  current();
  const { clientKey, region, ...fields } = createCommand.parse(input);
  const result = z
    .object({ ip: z.object({ id: z.string().uuid(), createdById: z.string() }) })
    .parse(
      await api.post("/ip-commerce/ips", {
        service: "aurora",
        retry: false,
        signal,
        data: { ...fields, idempotencyKey: clientKey, ...(region ? { region } : {}) },
      })
    );
  current();
  if (result.ip.createdById !== userId)
    throw new Error("IP creation receipt owner mismatch. Retry the original request.");
  return result.ip.id;
}
