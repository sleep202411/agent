import { z } from "zod";
import {
  ALL_CURRENCIES,
  TASK_PAYMENT_TERMS,
  WORK_MODES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SALARY_PERIODS,
  isPresetPosition,
  ZERO_DECIMAL_CURRENCIES,
  type CurrencyCode,
} from "@repo/shared/crew";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const positionCurrencies: readonly CurrencyCode[] = ["USD", "CNY"];
export function positionAmount(value: string, currency: CurrencyCode): number | null {
  if (!value.trim()) return null;
  const pattern = ZERO_DECIMAL_CURRENCIES.has(currency)
    ? /^(0|[1-9]\d{0,8})$/
    : /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/;
  if (!pattern.test(value.trim()) || Number(value) > 100_000_000)
    throw new Error("Invalid salary amount");
  return Number(value);
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const salary = z
  .object({
    period: z.enum(SALARY_PERIODS),
    currency: z.enum(ALL_CURRENCIES),
    min: z.number().finite().min(0).max(100_000_000).nullable(),
    max: z.number().finite().min(0).max(100_000_000).nullable(),
    negotiable: z.boolean(),
  })
  .strict()
  .refine(
    (s) =>
      (s.min === null || s.max === null || s.max >= s.min) &&
      [s.min, s.max].every(
        (v) =>
          v === null ||
          Math.abs(
            v * (ZERO_DECIMAL_CURRENCIES.has(s.currency) ? 1 : 100) -
              Math.round(v * (ZERO_DECIMAL_CURRENCIES.has(s.currency) ? 1 : 100))
          ) < 0.00001
      )
  );
export const newPosition = z
  .object({
    positionType: z.string().refine(isPresetPosition),
    description: z.string().trim().min(1).max(10000),
    targetCount: z.number().int().min(1).max(99),
    workMode: z.enum(WORK_MODES),
    location: z.string().trim().min(1).max(128).nullable(),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    experienceLevel: z.enum(EXPERIENCE_LEVELS),
    requiredSkills: z.array(z.string().trim().min(1).max(64)).max(20),
    paymentTerms: z.enum(TASK_PAYMENT_TERMS).nullable().optional(),
    salary,
    durationMonths: z.number().int().min(1).max(60).nullable(),
    revenueSharePercent: z.number().min(0.5).max(50).multipleOf(0.5).nullable(),
    closeDate: z.string().refine(validDate).nullable(),
    taskId: z.string().uuid().optional(),
    recruitmentVisibility: z.enum(["public", "private"]),
  })
  .strict()
  .refine(
    (v) =>
      (v.workMode === "remote" || v.location !== null) &&
      (v.recruitmentVisibility !== "private" || !!v.taskId)
  );
export type NewPosition = z.infer<typeof newPosition>;
export const positionReceipt = z.object({
  id,
  crewId: id,
  taskId: z.string().uuid().nullable(),
  recruitmentVisibility: z.enum(["public", "private"]),
  positionType: z.string(),
  description: z.string(),
  targetCount: z.number().int(),
  recruitedCount: z.number().int(),
  status: z.enum(["open", "full", "frozen"]),
  workMode: z.enum(WORK_MODES),
  location: z.string().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  experienceLevel: z.enum(EXPERIENCE_LEVELS),
  requiredSkills: z.array(z.string()),
  paymentTerms: z.enum(TASK_PAYMENT_TERMS).nullable().optional(),
  salary: z.object({
    period: z.enum(SALARY_PERIODS).nullable(),
    currency: z.enum(ALL_CURRENCIES).nullable(),
    minAmount: z.number().int().nullable(),
    maxAmount: z.number().int().nullable(),
    negotiable: z.boolean(),
  }),
  durationMonths: z.number().nullable(),
  revenueSharePercent: z.number().nullable(),
  closeDate: z.string().nullable(),
});
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Position session expired");
}
export async function fetchPositionCreateAccess(
  crewId: string,
  userId: string,
  generation: number,
  signal?: AbortSignal
) {
  id.parse(crewId);
  id.parse(userId);
  current(generation);
  const member = z
    .object({ userId: id, permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation);
  if (member.userId !== userId || !member.permissions.includes("openings.manage"))
    throw new Error("Position management permission is required.");
  return {
    canLinkTask:
      member.permissions.includes("tasks.manage") && member.permissions.includes("tasks.view"),
  };
}
export async function createPosition(
  crewId: string,
  userId: string,
  generation: number,
  input: NewPosition
) {
  const data = newPosition.parse(input);
  current(generation);
  if (!positionCurrencies.includes(data.salary.currency))
    throw new Error("Salary currency is unavailable on this site.");
  const access = await fetchPositionCreateAccess(crewId, userId, generation);
  if (data.taskId && !access.canLinkTask)
    throw new Error("Task management and viewing permissions are required.");
  current(generation);
  const result = positionReceipt.parse(
    await api.post(`/crews/${crewId}/positions`, { service: "aurora", data })
  );
  current(generation);
  const factor = ZERO_DECIMAL_CURRENCIES.has(data.salary.currency) ? 1 : 100;
  const expected = {
    ...data,
    taskId: data.taskId ?? null,
    location: data.workMode === "remote" ? null : data.location,
    salary: {
      period: data.salary.period,
      currency: data.salary.currency,
      minAmount: data.salary.min === null ? null : Math.round(data.salary.min * factor),
      maxAmount: data.salary.max === null ? null : Math.round(data.salary.max * factor),
      negotiable: data.salary.negotiable,
    },
  };
  if (
    result.crewId !== crewId ||
    Object.entries(expected).some(
      ([key, value]) => JSON.stringify(result[key as keyof typeof result]) !== JSON.stringify(value)
    )
  )
    throw new Error(
      "Position receipt mismatch. Refresh the position list before another create attempt."
    );
  return result;
}
