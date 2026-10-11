import { z } from "zod";
import {
  CREW_GENRES,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  SALARY_PERIODS,
  isPresetPosition,
} from "@repo/shared/crew";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { savedPage } from "./saved-openings-api";
const minor = z.string().regex(/^(0|[1-9][0-9]{0,15})$/);
export const openingFilters = z
  .object({
    q: z.string().trim().max(120).default(""),
    positionType: z
      .string()
      .refine((v) => !v || isPresetPosition(v))
      .default(""),
    genre: z.union([z.literal(""), z.enum(CREW_GENRES)]).default(""),
    employment: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
    skills: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    workMode: z.array(z.enum(WORK_MODES)).default([]),
    sort: z.enum(["newest", "oldest"]).default("newest"),
    salaryMinMinor: minor.optional(),
    salaryMaxMinor: minor.optional(),
    salaryCurrency: z.enum(["USD", "CNY"]).optional(),
    salaryPeriod: z.enum(SALARY_PERIODS).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.salaryMinMinor !== undefined || v.salaryMaxMinor !== undefined) &&
      (!v.salaryCurrency || !v.salaryPeriod)
    )
      ctx.addIssue({ code: "custom", message: "Select a salary period and currency." });
    if (
      v.salaryMinMinor !== undefined &&
      v.salaryMaxMinor !== undefined &&
      BigInt(v.salaryMinMinor) > BigInt(v.salaryMaxMinor)
    )
      ctx.addIssue({ code: "custom", message: "Minimum salary must not exceed maximum salary." });
  });
export type OpeningFilters = z.infer<typeof openingFilters>;
export function salaryMinor(value: string): string | undefined {
  if (!value.trim()) return undefined;
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value.trim()))
    throw Error("Enter a non-negative salary with up to two decimal places.");
  const [whole, cents = ""] = value.trim().split(".");
  return minor.parse((BigInt(whole!) * 100n + BigInt(cents.padEnd(2, "0"))).toString());
}
export async function fetchOpenings(
  filters: OpeningFilters,
  cursor: string | null,
  generation: number,
  signal: AbortSignal
) {
  const f = openingFilters.parse(filters);
  if (cursor)
    z.string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .parse(cursor);
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw Error("Opening session expired.");
  };
  current();
  const params: Record<string, string | number> = { limit: 20, sort: f.sort };
  for (const key of [
    "q",
    "positionType",
    "genre",
    "salaryMinMinor",
    "salaryMaxMinor",
    "salaryCurrency",
    "salaryPeriod",
  ] as const)
    if (f[key] !== undefined && f[key] !== "") params[key] = f[key]!;
  for (const key of ["employment", "workMode"] as const)
    if (f[key].length) params[key] = [...new Set(f[key])].sort().join(",");
  if (f.skills.length) params.skills = JSON.stringify([...new Set(f.skills)].sort());
  if (cursor) params.cursor = cursor;
  const page = savedPage.parse(
    await api.get("/positions", { service: "aurora", retry: false, signal, params })
  );
  current();
  if (
    page.items.some(
      ({ position, crew }) =>
        position.crewId !== crew.id ||
        position.status !== "open" ||
        position.recruitmentVisibility !== "public"
    ) ||
    new Set(page.items.map((x) => x.position.id)).size !== page.items.length ||
    (page.nextCursor && (page.nextCursor === cursor || !page.items.length))
  )
    throw Error("Openings changed. Refresh to reload.");
  return page;
}
