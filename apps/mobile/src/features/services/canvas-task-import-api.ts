import { taskRequestReceipt } from "./task-request-receipt";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import type { AppRegion } from "@/config/app-env";

// Extract identity only. The pasted URL is never fetched or used as an API origin.
export function canvasProjectId(value: string, region: AppRegion): string | null {
  if (value.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    const origin =
      region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
    if (url.origin !== origin || url.username || url.password) return null;
    const match = url.pathname.match(
      /^\/(?:en-US\/|zh-CN\/|zh-HK\/)?story-studio\/projects\/([a-f0-9-]{36})\/canvas\/?$/i
    );
    const id = z.string().uuid().safeParse(match?.[1]);
    return id.success ? id.data.toLowerCase() : null;
  } catch {
    return null;
  }
}
export const canvasTaskPreview = z
  .object({
    crewId: z.string().min(1),
    projectId: z.string().uuid(),
    title: z.string(),
    sourceRevision: z.number().int().nonnegative(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    plotTree: z.object({
      nodes: z.array(
        z.object({
          id: z.string().min(1),
          type: z.string(),
          content: z.object({ title: z.string().optional() }),
        })
      ),
    }),
  })
  .refine(
    (value) =>
      new Set(value.plotTree.nodes.map((node) => node.id)).size === value.plotTree.nodes.length,
    "Duplicate canvas nodes"
  );
export type CanvasTaskPreview = z.infer<typeof canvasTaskPreview>;
export function canvasScenes(preview: CanvasTaskPreview) {
  return preview.plotTree.nodes.filter((node) => node.type === "scene");
}
function path(crewId: string, projectId: string) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  z.string().uuid().parse(projectId);
  return `/crews/${encodeURIComponent(crewId)}/canvas-task-import/story-projects/${projectId}`;
}
export async function fetchCanvasTaskPreview(
  crewId: string,
  projectId: string,
  generation: number,
  signal: AbortSignal
) {
  const check = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Canvas import session expired");
  };
  check();
  const result = canvasTaskPreview.parse(
    await api.get(`${path(crewId, projectId)}/preview`, { service: "aurora", signal })
  );
  check();
  if (result.crewId !== crewId || result.projectId !== projectId)
    throw new Error("Canvas import scope mismatch");
  return result;
}
export async function applyCanvasTaskImport(
  crewId: string,
  preview: CanvasTaskPreview,
  generation: number
) {
  if (generation !== getAuthGeneration()) throw new Error("Canvas import session expired");
  const parsed = canvasTaskPreview.parse(preview);
  if (parsed.crewId !== crewId) throw new Error("Canvas import scope mismatch");
  const scenes = canvasScenes(parsed);
  if (!scenes.length || scenes.length > 200)
    throw new Error("Import requires between 1 and 200 scenes.");
  return taskRequestReceipt
    .or(
      z.object({
        taskIds: z.array(z.string().uuid()).refine((ids) => new Set(ids).size === ids.length),
        replayed: z.boolean(),
      })
    )
    .parse(
      await api.post(`${path(crewId, parsed.projectId)}/apply`, {
        service: "aurora",
        data: { sourceRevision: parsed.sourceRevision, sourceHash: parsed.sourceHash },
      })
    );
}
