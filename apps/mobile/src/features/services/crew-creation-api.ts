import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { loadAgentProjects } from "@/features/agent/api/studio-projects-api";
import { PlotTreeSchema } from "./crew-creation-plot";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const uuid = z.string().uuid();
const workspace = z.object({ id: uuid, name: z.string() });
const eligibility = z.object({ eligible: z.boolean(), workspaces: z.array(workspace) });
const clips = z.record(
  z.array(
    z.object({
      clipId: z.string(),
      title: z.string(),
      order: z.number(),
      durationSeconds: z.number().nullable(),
    })
  )
);
export const crewCreationInput = z
  .object({
    name: z.string().trim().min(1).max(128),
    description: z.string().trim().min(1).max(2000),
    logo: z.string().trim().min(1).max(512),
    productionTemplateLocale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    productionKind: z.enum(["series", "interactive_film"]),
    studioWorkspaceId: uuid.optional(),
    createStudioWorkspace: z
      .object({ name: z.string().trim().min(1).max(120) })
      .strict()
      .optional(),
    plotTree: PlotTreeSchema.optional(),
    storyboardClipsByNode: clips.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Boolean(value.studioWorkspaceId) === Boolean(value.createStudioWorkspace))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose an existing workspace or create a new one.",
      });
    if (
      value.productionKind !== "interactive_film" &&
      (value.plotTree || value.storyboardClipsByNode)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only interactive films can import a canvas.",
      });
    if (value.storyboardClipsByNode) {
      const nodes = new Set(value.plotTree?.nodes.map((node) => node.id));
      for (const nodeId of Object.keys(value.storyboardClipsByNode)) {
        if (!nodes.has(nodeId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Storyboard clips reference an unknown plot node.",
          });
      }
    }
  });
export type CrewCreationInput = z.infer<typeof crewCreationInput>;
export type CrewCreationEligibility = z.infer<typeof eligibility>;
const receipt = z.object({
  id,
  name: z.string(),
  description: z.string(),
  logo: z.string(),
  ownerUserId: id,
  productionKind: z.enum(["series", "interactive_film"]),
  studioWorkspaceId: uuid,
});
const attempt = z.object({
  input: crewCreationInput,
  startedAt: z.string().datetime(),
  receipt: receipt.optional(),
});
export type CrewCreationAttempt = z.infer<typeof attempt>;

const ownedCrew = receipt.extend({
  studioWorkspaceId: uuid.nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
/** Fresh owner directory for manual recovery; absence is never a creation receipt. */
export async function fetchCrewsForCreationReview(
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(userId);
  current(generation, signal);
  const result = z.object({ founded: z.array(ownedCrew) }).parse(
    await api.get("/crews/my", {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current(generation, signal);
  if (
    result.founded.some((row) => row.ownerUserId !== userId) ||
    new Set(result.founded.map((row) => row.id)).size !== result.founded.length
  )
    throw new Error("Crew ownership list could not be verified. Refresh before continuing.");
  return result.founded;
}

function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Crew creation session expired or request cancelled.");
}
export async function fetchCrewCreationEligibility(generation: number, signal: AbortSignal) {
  current(generation, signal);
  const result = eligibility.parse(
    await api.get("/crews/creation-eligibility", {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current(generation, signal);
  if (new Set(result.workspaces.map((row) => row.id)).size !== result.workspaces.length)
    throw new Error("Duplicate Crew workspace options.");
  return result;
}

export async function fetchCrewCreationCanvas(
  workspaceId: string,
  projectId: string,
  generation: number,
  signal: AbortSignal
) {
  uuid.parse(workspaceId);
  uuid.parse(projectId);
  current(generation, signal);
  const available = await loadAgentProjects(signal, workspaceId);
  current(generation, signal);
  if (
    available.workspaceId !== workspaceId ||
    !available.projects.some((row) => row.id === projectId)
  )
    throw new Error("The selected film is no longer available in this workspace.");
  const result = z
    .object({
      projectId: uuid,
      title: z.string(),
      plotTree: PlotTreeSchema,
      storyboardClipsByNode: clips.optional(),
    })
    .parse(
      await api.get(`/story-projects/${projectId}/plot-tree`, {
        service: "aurora",
        signal,
        retry: false,
      })
    );
  current(generation, signal);
  if (result.projectId !== projectId) throw new Error("Film canvas scope mismatch.");
  return result;
}

export function crewCreationPending(userId: string, generation: number) {
  id.parse(userId);
  const storage = durableRecord("crew-creation", userId, "create");
  const read = () => {
    current(generation);
    const raw = storage.read();
    return raw && raw !== "null" ? attempt.parse(JSON.parse(raw)) : null;
  };
  return {
    read,
    save(value: CrewCreationAttempt) {
      current(generation);
      if (read()) throw new Error("Review the previous Crew creation before creating another.");
      storage.write(JSON.stringify(attempt.parse(value)));
    },
    complete(value: z.infer<typeof receipt>) {
      const pending = read();
      if (!pending) throw new Error("Crew creation attempt is missing.");
      storage.write(JSON.stringify(attempt.parse({ ...pending, receipt: value })));
    },
    clear() {
      current(generation);
      storage.write("null");
    },
  };
}

/** Call only after review and explicit confirmation. Never replay an uncertain POST. */
export async function createMobileCrew(
  input: CrewCreationInput,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  const data = crewCreationInput.parse(input);
  const pending = crewCreationPending(userId, generation);
  current(generation, signal);
  if (pending.read()) throw new Error("Review the previous Crew creation before creating another.");
  const fresh = await fetchCrewCreationEligibility(generation, signal);
  if (!fresh.eligible) throw new Error("Java certification level 13 is required to create a Crew.");
  if (data.studioWorkspaceId && !fresh.workspaces.some((row) => row.id === data.studioWorkspaceId))
    throw new Error("The selected workspace is no longer available to link.");
  current(generation, signal);
  // No client operation ID or queryable creation receipt exists on the official endpoint.
  // Persist before POST; every ambiguous outcome requires review, never an automatic retry.
  pending.save({ input: data, startedAt: new Date().toISOString() });
  const result = receipt.parse(
    await api.post("/crews", { service: "aurora", data, signal, retry: false })
  );
  current(generation, signal);
  if (
    result.ownerUserId !== userId ||
    result.name !== data.name ||
    result.description !== data.description ||
    result.logo !== data.logo ||
    result.productionKind !== data.productionKind ||
    (data.studioWorkspaceId && result.studioWorkspaceId !== data.studioWorkspaceId)
  )
    throw new Error(
      "Crew creation could not be verified. Review your Crews before another attempt."
    );
  pending.complete(result);
  return result;
}
