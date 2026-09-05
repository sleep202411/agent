/**
 * Ephemeral chapter playtest compiled from the saved authoring head.
 * Same `GET /aurora/story-projects/:id/working-preview` as H5 playtest.
 */

import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

export type StoryBuildDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
};

export type StoryWorkingPreview = {
  draftRevision: number;
  runtime: Record<string, unknown> | null;
  coverUrl: string | null;
  diagnostics: StoryBuildDiagnostic[];
};

export async function getStoryWorkingPreview(
  projectId: string,
  chapterId?: string,
  signal?: AbortSignal
): Promise<StoryWorkingPreview> {
  const data = await api.get<unknown>(
    `/story-projects/${encodeURIComponent(projectId)}/working-preview`,
    {
      ...AURORA,
      params: chapterId?.trim() ? { chapterId: chapterId.trim() } : undefined,
      signal,
      timeout: 60_000,
    }
  );
  return parseWorkingPreview(data);
}

function parseWorkingPreview(value: unknown): StoryWorkingPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Story working preview is invalid.");
  }
  const row = value as Record<string, unknown>;
  const runtime =
    row.runtime && typeof row.runtime === "object" && !Array.isArray(row.runtime)
      ? (row.runtime as Record<string, unknown>)
      : null;
  const draftRevision =
    typeof row.draftRevision === "number" && Number.isFinite(row.draftRevision)
      ? row.draftRevision
      : 0;
  const coverUrl = typeof row.coverUrl === "string" && row.coverUrl.trim() ? row.coverUrl : null;
  return {
    draftRevision,
    runtime,
    coverUrl,
    diagnostics: parseDiagnostics(row.diagnostics),
  };
}

function parseDiagnostics(value: unknown): StoryBuildDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const severity = row.severity === "warning" ? "warning" : "error";
    const code = typeof row.code === "string" ? row.code : "";
    const message = typeof row.message === "string" ? row.message : "";
    if (!code && !message) return [];
    return [
      {
        severity,
        code,
        message,
        entityType: typeof row.entityType === "string" ? row.entityType : null,
        entityId: typeof row.entityId === "string" ? row.entityId : null,
      },
    ];
  });
}
