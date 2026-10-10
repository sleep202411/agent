import { z } from "zod";
import { ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { isChinaRegion } from "@/config/app-env";
import {
  newPosition,
  positionReceipt,
  positionCurrencies,
  fetchPositionCreateAccess,
  type NewPosition,
} from "./position-create-api";
export type EditablePosition = z.infer<typeof positionReceipt>;
export const positionEditDraft = newPosition
  .innerType()
  .extend({ positionType: z.string().min(1) })
  .refine((v) => v.workMode === "remote" || v.location !== null);
export type PositionEditDraft = z.infer<typeof positionEditDraft>;
export function positionDraft(row: EditablePosition): PositionEditDraft {
  const currency = row.salary.currency ?? (isChinaRegion ? "CNY" : "USD");
  const factor = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
  return {
    positionType: row.positionType,
    description: row.description,
    targetCount: row.targetCount,
    workMode: row.workMode,
    location: row.location,
    employmentType: row.employmentType,
    experienceLevel: row.experienceLevel,
    requiredSkills: row.requiredSkills,
    paymentTerms: row.paymentTerms ?? null,
    salary: {
      period: row.salary.period ?? "project",
      currency,
      min: row.salary.minAmount === null ? null : row.salary.minAmount / factor,
      max: row.salary.maxAmount === null ? null : row.salary.maxAmount / factor,
      negotiable: row.salary.negotiable,
    },
    durationMonths: row.durationMonths,
    revenueSharePercent: row.revenueSharePercent,
    closeDate: row.closeDate,
    ...(row.taskId ? { taskId: row.taskId } : {}),
    recruitmentVisibility: row.recruitmentVisibility,
  };
}
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Position session expired");
}
export async function fetchEditablePosition(
  crewId: string,
  positionId: string,
  userId: string,
  generation: number,
  signal?: AbortSignal
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .parse(positionId);
  await fetchPositionCreateAccess(crewId, userId, generation, signal);
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = z
      .object({
        items: z.array(positionReceipt),
        nextCursor: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,128}$/)
          .nullable(),
      })
      .parse(
        await api.get(`/crews/${crewId}/positions`, {
          service: "aurora",
          signal,
          params: { limit: 100, ...(cursor ? { cursor } : {}) },
        })
      );
    current(generation);
    if (signal?.aborted) throw new Error("Position request cancelled");
    for (const row of page.items) {
      if (row.crewId !== crewId || seen.has(row.id))
        throw new Error("Position list changed. Refresh to reload.");
      seen.add(row.id);
    }
    if (page.nextCursor && page.items.at(-1)?.id !== page.nextCursor)
      throw new Error("Invalid position pagination");
    const found = page.items.find((row) => row.id === positionId);
    if (found) return found;
    cursor = page.nextCursor;
  } while (cursor);
  throw new Error("Position is no longer available.");
}
export async function editPosition(
  baseline: EditablePosition,
  userId: string,
  generation: number,
  input: PositionEditDraft
) {
  positionReceipt.parse(baseline);
  const data = positionEditDraft.parse(input),
    initial = positionDraft(baseline);
  if (
    data.positionType !== initial.positionType ||
    data.taskId !== initial.taskId ||
    data.recruitmentVisibility !== initial.recruitmentVisibility
  )
    throw new Error("Role and recruitment link cannot be changed.");
  if (data.targetCount < baseline.recruitedCount)
    throw new Error("Target count cannot be below recruited count.");
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(initial) as (keyof NewPosition)[]) {
    if (["positionType", "taskId", "recruitmentVisibility"].includes(key)) continue;
    if (JSON.stringify(data[key]) !== JSON.stringify(initial[key])) patch[key] = data[key];
  }
  if (!Object.keys(patch).length) throw new Error("No position changes to save.");
  if (patch.salary && !positionCurrencies.includes(data.salary.currency))
    throw new Error("Salary currency is unavailable on this site.");
  const fresh = await fetchEditablePosition(baseline.crewId, baseline.id, userId, generation);
  if (JSON.stringify(fresh) !== JSON.stringify(positionReceipt.parse(baseline)))
    throw new Error("Position changed. Return to the list and review it again.");
  current(generation);
  const result = positionReceipt.parse(
    await api.patch(`/crews/${baseline.crewId}/positions/${baseline.id}`, {
      service: "aurora",
      data: patch,
    })
  );
  current(generation);
  const factor = ZERO_DECIMAL_CURRENCIES.has(data.salary.currency) ? 1 : 100;
  const expected = {
    ...patch,
    ...(patch.salary
      ? {
          salary: {
            period: data.salary.period,
            currency: data.salary.currency,
            minAmount: data.salary.min === null ? null : Math.round(data.salary.min * factor),
            maxAmount: data.salary.max === null ? null : Math.round(data.salary.max * factor),
            negotiable: data.salary.negotiable,
          },
        }
      : {}),
  };
  if (
    result.id !== baseline.id ||
    result.crewId !== baseline.crewId ||
    Object.entries(expected).some(
      ([k, v]) => JSON.stringify(result[k as keyof EditablePosition]) !== JSON.stringify(v)
    )
  )
    throw new Error("Position update could not be verified. Return to the list.");
  return result;
}
