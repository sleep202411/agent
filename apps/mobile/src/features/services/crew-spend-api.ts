import { z } from "zod";
import { api } from "@/lib/api-client";
const amount = z.string().regex(/^-?(0|[1-9]\d*)$/);
const currencies = z.object({ USD: amount, CNY: amount });
const summary = z.object({
  taskRewardsByCurrency: currencies,
  reimbursementsByCurrency: currencies,
  totalByCurrency: currencies,
});
export type CrewSpend = z.infer<typeof summary>;
export async function fetchCrewSpend(crewId: string, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .parse(crewId);
  const result = summary.parse(
    await api.get(`/crews/${crewId}/expense-drafts/summary`, { service: "aurora", signal })
  );
  for (const currency of ["USD", "CNY"] as const)
    if (
      BigInt(result.taskRewardsByCurrency[currency]) +
        BigInt(result.reimbursementsByCurrency[currency]) !==
      BigInt(result.totalByCurrency[currency])
    )
      throw new Error("Crew spending totals are inconsistent. Refresh to reload.");
  return result;
}
