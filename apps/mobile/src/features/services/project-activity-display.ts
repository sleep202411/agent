import type { MessageKey } from "@/i18n";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import type { ProjectActivity } from "./project-activity-api";
export async function fetchActivityAuthors(ids: string[], generation: number, signal: AbortSignal) {
  const unique = [...new Set(ids)].filter((id) => /^\d{1,18}$/.test(id));
  const names: Record<string, string> = {};
  const check = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Activity author session expired");
  };
  check();
  for (let offset = 0; offset < unique.length; offset += 50) {
    const batch = unique.slice(offset, offset + 50);
    const result = z
      .object({
        users: z.array(
          z.object({ userId: z.string(), nickname: z.string().nullable().optional() })
        ),
      })
      .parse(
        await api.get("/users/by-ids", {
          service: "aurora",
          signal,
          params: { ids: batch.join(",") },
        })
      );
    check();
    for (const user of result.users) {
      if (!batch.includes(user.userId)) throw new Error("Activity author scope mismatch");
      if (user.nickname?.trim()) names[user.userId] = user.nickname.trim();
    }
  }
  return names;
}
const named = z.object({ name: z.string().min(1) });
const change = z.object({
  field: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export const activityFields = [
  "status",
  "priority",
  "lead_member_id",
  "start_date",
  "start_date_granularity",
  "target_date",
  "target_date_granularity",
  "studio_project_id",
  "studio_workspace_id",
] as const;
export type ActivityDetail = {
  key: `field.${(typeof activityFields)[number]}` | "added" | "removed" | "resource";
  value: string;
};
/** Only render known audit fields; never expose arbitrary event metadata. */
export function activityDetails(
  row: Pick<ProjectActivity, "kind" | "payload">,
  translate?: (key: MessageKey) => string
): ActivityDetail[] {
  const parsed = z.record(z.unknown()).safeParse(row.payload);
  if (!parsed.success) return [];
  const payload = parsed.data;
  if (row.kind === "properties_changed" && Array.isArray(payload.changes))
    return payload.changes.flatMap((value) => {
      const result = change.safeParse(value);
      if (!result.success) return [];
      const entry = result.data;
      const field = activityFields.find((field) => field === entry.field);
      if (!field) return [];
      return [
        {
          key: `field.${field}`,
          value: `${activityPropertyValue(field, entry.from, translate)} → ${activityPropertyValue(field, entry.to, translate)}`,
        },
      ];
    });
  if (row.kind === "labels_changed")
    return (["added", "removed"] as const).flatMap((key) => {
      const values = payload[key];
      if (!Array.isArray(values)) return [];
      return values.flatMap((value) => {
        const result = named.safeParse(value);
        return result.success ? [{ key, value: result.data.name }] : [];
      });
    });
  if (row.kind === "resource_added" || row.kind === "resource_removed") {
    const result = z.object({ title: z.string().min(1) }).safeParse(payload.resource);
    return result.success ? [{ key: "resource", value: result.data.title }] : [];
  }
  return [];
}

function activityPropertyValue(
  field: string,
  value: string | null,
  translate?: (key: MessageKey) => string
) {
  if (value === null) return "—";
  if (!translate) return value;
  const values =
    field === "status"
      ? (["backlog", "planned", "in_progress", "completed", "cancelled"] as const)
      : field === "priority"
        ? (["low", "normal", "high", "urgent"] as const)
        : field === "start_date_granularity" || field === "target_date_granularity"
          ? (["day", "month", "quarter", "half_year", "year"] as const)
          : [];
  const known = values.find((candidate) => candidate === value);
  return known ? translate(`projectProperties.${known}`) : value;
}
