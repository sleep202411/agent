/**
 * save_project_meta — silent writer for the project's header fields (name,
 * description) and the world's world-building fields (description, core).
 *
 * Only fills EMPTY / default-placeholder slots. Never overwrites a value
 * the user has manually set. Callable by the supervisor immediately after
 * analyze_brief on a fresh project, so the user's first params form is
 * rendered against a properly named project instead of "未命名世界".
 *
 * Wire semantics:
 *   Java's `/api/user/world/update/worldproduct` is the project updater
 *   (confusing name — worldproduct = project in the fizz data model).
 *   Java's `/api/user/world/update/world` is the world updater. Both are
 *   full-record REPLACEMENTS: omitted fields get blanked. We read current
 *   state first and echo everything we aren't changing.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";

type ProjectDetail = {
  id?: string;
  name?: string;
  description?: string | null;
  type?: unknown;
  episode?: unknown;
  imagePath?: string | null;
  aspectRatioType?: string | null;
  chapterLength?: number | null;
  stylePainting?: string | null;
  dialogLanguage?: string | null;
  worldId?: string;
};

type WorldDetail = {
  id?: string;
  name?: string;
  description?: string | null;
  core?: string | null;
  devAdvise?: string | null;
  bannerLink?: string | null;
  filePath?: string | null;
};

// Java's default project name. We treat this as "empty" for the purposes
// of deciding whether to fill in a user-derived name.
const DEFAULT_PROJECT_NAME = "未命名世界";

function isEmptyString(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim().length === 0);
}

export const saveProjectMeta = createTool({
  id: "save_project_meta",
  description:
    "Persist the analyze_brief output (project name / one-line synopsis / visual core) onto the project + world records. Only fills empty or default-value fields — never overwrites anything the user has set by hand. Call exactly once per project, right after analyze_brief returns on a fresh project.",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe("Project name. Omit or empty string means leave unchanged."),
    description: z.string().optional().describe("One-sentence project synopsis."),
    core: z
      .string()
      .optional()
      .describe("Core visual / world-building motifs (comma- or enumeration-comma separated)."),
  }),
  outputSchema: z.object({
    projectUpdated: z.boolean(),
    worldUpdated: z.boolean(),
    setFields: z.array(z.string()),
  }),
  execute: async ({ name, description, core }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    // 1. Read current project + world state.
    const project = await javaRequest<ProjectDetail>(
      ctx,
      `/api/user/project/detail/${ctx.projectId}`
    ).catch(() => null);
    if (!project) {
      throw new Error(`save_project_meta: project ${ctx.projectId} not found`);
    }
    const worldId = ctx.worldId ?? project.worldId;
    const world = worldId
      ? await javaRequest<WorldDetail>(ctx, `/api/user/world/query/world?id=${worldId}`).catch(
          () => null
        )
      : null;

    const setFields: string[] = [];

    // 2. Decide what to patch on the project. The worldproduct update is a
    //    full replacement — echo every preserved field or it gets blanked.
    const nextProjectName =
      !isEmptyString(name) && (isEmptyString(project.name) || project.name === DEFAULT_PROJECT_NAME)
        ? (name as string)
        : (project.name ?? DEFAULT_PROJECT_NAME);
    const nextProjectDescription =
      !isEmptyString(description) && isEmptyString(project.description)
        ? (description as string)
        : (project.description ?? "");

    const projectChanged =
      nextProjectName !== (project.name ?? "") ||
      nextProjectDescription !== (project.description ?? "");

    let projectUpdated = false;
    if (projectChanged) {
      await javaRequest(ctx, "/api/user/world/update/worldproduct", {
        data: {
          id: ctx.projectId,
          worldId: worldId ?? "",
          name: nextProjectName,
          description: nextProjectDescription,
          type: project.type ?? null,
          episode: project.episode ?? null,
          imagePath: project.imagePath ?? "",
          aspectRatioType: project.aspectRatioType ?? "",
          chapterLength: project.chapterLength ?? 0,
          stylePainting: project.stylePainting ?? "",
          dialogLanguage: project.dialogLanguage ?? "",
        },
      });
      projectUpdated = true;
      if (nextProjectName !== (project.name ?? "")) setFields.push("name");
      if (nextProjectDescription !== (project.description ?? "")) setFields.push("description");
    }

    // 3. Decide what to patch on the world. Both fields we care about
    //    (description, core) are "empty → fill, set → skip".
    let worldUpdated = false;
    if (world && worldId) {
      const nextWorldDescription =
        !isEmptyString(description) && isEmptyString(world.description)
          ? (description as string)
          : (world.description ?? "");
      const nextWorldCore =
        !isEmptyString(core) && isEmptyString(world.core) ? (core as string) : (world.core ?? "");

      const worldChanged =
        nextWorldDescription !== (world.description ?? "") || nextWorldCore !== (world.core ?? "");

      if (worldChanged) {
        await javaRequest(ctx, "/api/user/world/update/world", {
          data: {
            id: worldId,
            name: world.name ?? "",
            description: nextWorldDescription,
            core: nextWorldCore,
            devAdvise: world.devAdvise ?? "",
            bannerLink: world.bannerLink ?? "",
            filePath: world.filePath ?? "",
          },
        });
        worldUpdated = true;
        if (nextWorldDescription !== (world.description ?? "")) setFields.push("world.description");
        if (nextWorldCore !== (world.core ?? "")) setFields.push("world.core");
      }
    }

    return { projectUpdated, worldUpdated, setFields };
  },
});
