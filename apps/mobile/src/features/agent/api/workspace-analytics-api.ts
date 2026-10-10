import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchWorkspaceSettings } from "./studio-workspace-settings-api";
import { loadPlatformProjects } from "./platform-projects-api";
import { fetchStudioMembers } from "./studio-members-api";
const integer = z.string().regex(/^-?\d+$/);
const ledger = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      entryType: z.string(),
      amount: integer,
      availableDelta: integer,
      heldDelta: integer,
      reason: z.string(),
      sourceType: z.string(),
      sourceId: z.string().nullable(),
      description: z.string().nullable(),
      createdAt: z.string(),
    })
  ),
});
const daily = z.object({ days: z.array(z.object({ date: z.string(), credits: integer })) });
const members = z.object({
  rangeDays: z.number(),
  projectId: z.string().nullable(),
  members: z.array(
    z.object({
      userId: z.string(),
      totalCredits: integer,
      totalJobs: z.number().int().nonnegative(),
      projects: z.array(
        z.object({
          projectId: z.string().nullable(),
          projectName: z.string().nullable(),
          credits: integer,
          jobs: z.number().int().nonnegative(),
        })
      ),
    })
  ),
});
const jobs = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      workspaceId: z.string().nullable().optional(),
      modelId: z.string(),
      type: z.string(),
      status: z.string(),
      createdAt: z.string(),
    })
  ),
});
export async function loadWorkspaceAnalytics(
  workspaceId: string,
  generation: number,
  projectId: string,
  range: 7 | 30 | 90,
  signal: AbortSignal
) {
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Workspace session expired");
  };
  current();
  const workspace = await fetchWorkspaceSettings(workspaceId, generation, signal);
  if (workspace.status !== "active" || workspace.accessScope !== "workspace")
    throw new Error("Workspace access required");
  const projects = await loadPlatformProjects(workspaceId, generation, signal);
  if (projectId && !projects.some((project) => project.id === projectId))
    throw new Error("Project is not in this workspace");
  current();
  const headers = { "x-fizz-workspace-id": workspaceId };
  const config = { service: "aurora" as const, signal, headers, retry: false };
  const canViewMembers = workspace.role === "owner" || workspace.role === "admin";
  const result = await Promise.all([
    api
      .get("/billing/wallet-ledger", {
        ...config,
        params: { currency: "compute_point", balanceKind: "consumable", limit: 100 },
      })
      .then((value) => ledger.parse(value)),
    api
      .get("/billing/wallet-ledger/daily-usage", {
        ...config,
        params: { days: 30, ...(projectId ? { projectId } : {}) },
      })
      .then((value) => daily.parse(value)),
    api.get("/ai/jobs", { ...config, params: { limit: 100 } }).then((value) => jobs.parse(value)),
    canViewMembers
      ? api
          .get("/billing/wallet-ledger/member-usage", {
            ...config,
            params: { days: range, ...(projectId ? { projectId } : {}) },
          })
          .then((value) => members.parse(value))
      : Promise.resolve(undefined),
    canViewMembers
      ? fetchStudioMembers(
          { kind: "workspace", id: workspaceId, name: workspace.name },
          generation,
          signal
        )
      : Promise.resolve(undefined),
  ]);
  current();
  if (result[2].jobs.some((job) => job.workspaceId && job.workspaceId !== workspaceId))
    throw new Error("Job workspace mismatch");
  if (result[3] && (result[3].rangeDays !== range || result[3].projectId !== (projectId || null)))
    throw new Error("Member usage scope mismatch");
  return {
    workspace,
    projects,
    ledger: result[0].entries,
    daily: result[1].days,
    jobs: result[2].jobs,
    memberUsage: result[3]?.members.map((member) => ({
      ...member,
      nickname:
        result[4]?.members.find((identity) => identity.userId === member.userId)?.nickname ?? null,
    })),
  };
}
export type WorkspaceAnalytics = Awaited<ReturnType<typeof loadWorkspaceAnalytics>>;
export function analyticsTotals(entries: WorkspaceAnalytics["ledger"]) {
  let incoming = 0n,
    outgoing = 0n;
  for (const entry of entries) {
    if (["credit", "refund", "transfer_in"].includes(entry.entryType))
      incoming += BigInt(entry.amount);
    else if (!["hold", "release"].includes(entry.entryType) && BigInt(entry.availableDelta) > 0n)
      incoming += BigInt(entry.availableDelta);
    if (["settle", "debit", "expire", "transfer_out"].includes(entry.entryType))
      outgoing += BigInt(entry.amount);
  }
  return { incoming: incoming.toString(), outgoing: outgoing.toString() };
}
