import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { CrewProductionDocumentSchema } from "./production-document-schema";

const pageSchema = z.object({
  crewId: z.string(),
  version: z.number().int().positive(),
  document: CrewProductionDocumentSchema,
});
export type ProjectDocumentPage = z.infer<typeof pageSchema>;

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
      page: pageSchema,
    })
    .parse(await api.get(`/crews/${crewId}/production-overview`, { service: "aurora", signal }));
  current();
  if (page.crewId !== crewId) throw new Error("Project document scope mismatch.");
  return page;
}

export class ProjectDocumentSaveError extends Error {
  constructor(
    public readonly code: "busy" | "uncertain" | "permission" | "changed" | "receipt" | "session"
  ) {
    super(`projectDocument.save.${code}`);
    this.name = "ProjectDocumentSaveError";
  }
}

/** One editor session, bound to its original account and loaded document version.
 * After a possibly committed failure it must be replaced by a newly loaded session;
 * retries must never rebase an old draft onto another author's version.
 */
export function createProjectDocumentSaver(
  crewId: string,
  userId: string,
  generation: number,
  loaded: ProjectDocumentPage
) {
  const snapshot = pageSchema.parse(loaded);
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  if (snapshot.crewId !== crewId) throw new ProjectDocumentSaveError("receipt");
  let version = snapshot.version;
  let pending = false;
  let uncertain = false;
  const current = () => {
    if (generation !== getAuthGeneration()) throw new ProjectDocumentSaveError("session");
  };
  return async (value: unknown): Promise<ProjectDocumentPage> => {
    current();
    if (pending) throw new ProjectDocumentSaveError("busy");
    if (uncertain) throw new ProjectDocumentSaveError("uncertain");
    // Capture a detached canonical document before the first asynchronous operation.
    const document = JSON.parse(JSON.stringify(CrewProductionDocumentSchema.parse(value)));
    pending = true;
    try {
      const access = z
        .object({ userId: z.string(), permissions: z.array(z.string()) })
        .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora" }));
      current();
      if (access.userId !== userId || !access.permissions.includes("production.manage"))
        throw new ProjectDocumentSaveError("permission");
      const { page } = z
        .object({ page: pageSchema })
        .parse(await api.get(`/crews/${crewId}/production-overview`, { service: "aurora" }));
      current();
      if (page.crewId !== crewId) throw new ProjectDocumentSaveError("receipt");
      if (page.version !== version) throw new ProjectDocumentSaveError("changed");
      // Set this before dispatch: transport failures cannot prove the write did not commit.
      uncertain = true;
      const saved = pageSchema.parse(
        await api.patch(`/crews/${crewId}/production-overview/document`, {
          service: "aurora",
          data: { expectedVersion: version, document },
        })
      );
      current();
      if (
        saved.crewId !== crewId ||
        saved.version !== version + 1 ||
        stableJson(saved.document) !== stableJson(document)
      )
        throw new ProjectDocumentSaveError("receipt");
      version = saved.version;
      uncertain = false;
      return saved;
    } finally {
      pending = false;
    }
  };
}

// PostgreSQL JSONB may reorder object keys, but document child/mark ordering matters.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
