import type { CreatorServiceDetail } from "@/data/types";
import { api } from "@/lib/api-client";
export function orderPayload(
  service: CreatorServiceDetail,
  tier: string,
  answers: Record<string, string>,
  note: string,
  key: string
) {
  if (
    !Number.isSafeInteger(service.version) ||
    Number(service.version) < 0 ||
    service.status !== "listed"
  )
    throw new Error("Service must be refreshed before requesting");
  const pkg = service.packages.find((p) => p.tier === tier);
  if (
    !pkg ||
    !["basic", "standard", "premium"].includes(tier) ||
    !Number.isFinite(pkg.price) ||
    pkg.price < 0
  )
    throw new Error("Invalid package");
  if (note.trim().length > 2000 || key.length < 8 || key.length > 64)
    throw new Error("Invalid request");
  const rows = service.requirementQuestions.map((question) => {
    const answer = (answers[question.id] ?? "").trim();
    if ((question.required && !answer) || answer.length > 4000)
      throw new Error("Complete the required answers");
    return { questionId: question.id, answer };
  });
  return {
    serviceId: service.id,
    expectedServiceVersion: service.version,
    packageTier: tier,
    answers: rows,
    ...(note.trim() ? { note: note.trim() } : {}),
    idempotencyKey: key,
  };
}
export async function submitServiceOrder(payload: ReturnType<typeof orderPayload>) {
  const result = await api.post<{ id?: unknown }>("/orders", { service: "aurora", data: payload });
  if (typeof result?.id !== "string" || !result.id.trim())
    throw new Error("Invalid order response");
  return result.id;
}
