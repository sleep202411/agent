import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { CrewProductionDocumentSchema } from "./production-document-schema";

export async function fetchProjectDocument(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const current = () => {
    if (getAuthGeneration() !== generation || signal.aborted)
      throw new Error("Project document session expired or request cancelled.");
  };
  current();
  const access = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current();
  if (access.userId !== userId) throw new Error("Crew membership account mismatch.");
  if (!access.permissions.includes("production.view"))
    throw new Error("Production access is required.");
  const { page } = z
    .object({
      page: z.object({
        crewId: z.string(),
        version: z.number().int().positive(),
        document: CrewProductionDocumentSchema,
      }),
    })
    .parse(await api.get(`/crews/${crewId}/production-overview`, { service: "aurora", signal }));
  current();
  if (page.crewId !== crewId) throw new Error("Project document scope mismatch.");
  return page;
}
