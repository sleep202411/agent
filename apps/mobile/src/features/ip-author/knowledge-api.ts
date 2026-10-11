import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const document = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  content: z.string().trim().min(1).max(20000),
  isPublished: z.boolean(),
});
const documents = z.array(document).max(50);
const snapshot = z.object({ documents, version: z.number().int().nonnegative() });
export type KnowledgeSnapshot = z.infer<typeof snapshot>;
function session(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("Knowledge session expired.");
}
const path = (ipId: string) =>
  `/ip-commerce/me/ips/${z.string().uuid().parse(ipId)}/knowledge-documents`;
export async function fetchKnowledge(ipId: string, generation: number, signal: AbortSignal) {
  session(generation, signal);
  const result = snapshot.parse(
    await api.get(path(ipId), { service: "aurora", signal, retry: false })
  );
  session(generation, signal);
  return result;
}
export async function saveKnowledge(
  ipId: string,
  generation: number,
  value: KnowledgeSnapshot,
  signal: AbortSignal
) {
  session(generation, signal);
  const parsed = snapshot.parse(value);
  const result = snapshot.parse(
    await api.put(path(ipId), {
      service: "aurora",
      signal,
      retry: false,
      data: { documents: parsed.documents, expectedVersion: parsed.version },
    })
  );
  session(generation, signal);
  return result;
}
