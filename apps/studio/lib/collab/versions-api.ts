import { api } from "@/lib/api";

/**
 * Document version checkpoints. Backed by the documents platform's version
 * routes (StudioDocumentVersion) under `/aurora/documents/:id/versions`.
 * Versions are still written (autosave + manual checkpoints) and are the
 * source for the read-only canvas activity log.
 */

export type VersionSource = "autosave" | "manual" | "import" | "ai" | "system";

export interface VersionDto {
  id: string;
  documentId: string;
  versionNumber: number;
  schemaVersion: string;
  sequence: number;
  title: string | null;
  label: string | null;
  source: VersionSource;
  sourceId: string | null;
  snapshot: unknown;
  crdtStateBase64?: string;
  metadata: unknown;
  createdById: string;
  createdAt: string;
}

export interface CreateCheckpointInput {
  label?: string;
  source?: "manual";
  crdtStateBase64?: string;
  snapshot?: Record<string, unknown>;
}

export async function listDocumentVersions(documentId: string): Promise<VersionDto[]> {
  const data = await api.get<{ versions: VersionDto[] }>(
    `/aurora/documents/${documentId}/versions`
  );
  return data.versions;
}

export async function createDocumentCheckpoint(
  documentId: string,
  input: CreateCheckpointInput
): Promise<VersionDto> {
  const data = await api.post<{ version: VersionDto }>(`/aurora/documents/${documentId}/versions`, {
    data: input,
  });
  return data.version;
}
