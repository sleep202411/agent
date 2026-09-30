import { z } from "zod";
import { api } from "@/lib/api-client";
const named = z.object({
  id: z.string().uuid(),
  crewId: z.string().min(1),
  name: z.string().min(1),
});
const cycle = named.extend({ status: z.enum(["planned", "active", "completed", "cancelled"]) });
const episode = z.object({
  id: z.string().uuid(),
  crewId: z.string().min(1),
  title: z.string().min(1),
  number: z.number().int().positive(),
  status: z.enum(["planned", "in_production", "in_review", "completed", "cancelled"]),
});
export type PlanningKind = "labels" | "cycle" | "episode";
export type PlanningOption = { id: string; name: string };
export async function fetchTaskPlanningOptions(
  crewId: string,
  kind: PlanningKind,
  signal: AbortSignal
): Promise<PlanningOption[]> {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const data = await api.get(
    `/crews/${encodeURIComponent(crewId)}/${kind === "episode" ? "episodes" : "task-project"}`,
    { service: "aurora", signal }
  );
  const rows =
    kind === "episode"
      ? z.array(episode).parse(data)
      : kind === "cycle"
        ? z.object({ cycles: z.array(cycle) }).parse(data).cycles
        : z.object({ labels: z.array(named) }).parse(data).labels;
  if (
    rows.some((row) => row.crewId !== crewId) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error("Task planning scope mismatch");
  return rows
    .filter(
      (row) =>
        !("status" in row) ||
        (row.status !== "cancelled" && (kind !== "episode" || row.status !== "completed"))
    )
    .map((row) => ({
      id: row.id,
      name: "title" in row ? `${row.number} · ${row.title}` : row.name,
    }));
}
