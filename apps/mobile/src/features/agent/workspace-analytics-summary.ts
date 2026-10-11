import type { WorkspaceAnalytics } from "./api/workspace-analytics-api";

export function generationUsage(data: Pick<WorkspaceAnalytics, "ledger" | "jobs">) {
  const settled = new Map<string, bigint>();
  for (const entry of data.ledger) {
    if (entry.sourceType !== "ai_job" || !entry.sourceId || entry.entryType !== "settle") continue;
    settled.set(entry.sourceId, (settled.get(entry.sourceId) ?? 0n) + BigInt(entry.amount));
  }
  const models = new Map<string, { modelId: string; count: number; credits: bigint }>();
  for (const job of data.jobs) {
    const row = models.get(job.modelId) ?? { modelId: job.modelId, count: 0, credits: 0n };
    row.count += 1;
    row.credits += settled.get(job.id) ?? 0n;
    models.set(job.modelId, row);
  }
  return {
    settled,
    models: [...models.values()].sort(
      (a, b) => b.count - a.count || a.modelId.localeCompare(b.modelId)
    ),
  };
}
