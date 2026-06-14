import { api } from "@/lib/api";

/**
 * Document version checkpoints. Backed by the documents platform's version
 * routes (PlatformDocumentVersion) under `/aurora/documents/:id/versions`. A
 * version carries a full `crdtStateBase64` snapshot used to restore the canvas.
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

export interface RestoreVersionInput {
  label?: string;
  /** The caller's exact pre-restore state — stamped as a reversible checkpoint. */
  currentCrdtStateBase64?: string;
  currentSnapshot?: Record<string, unknown>;
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

export async function restoreDocumentVersion(
  documentId: string,
  versionId: string,
  input: RestoreVersionInput
): Promise<{ target: VersionDto; checkpoint: VersionDto }> {
  return api.post<{ target: VersionDto; checkpoint: VersionDto }>(
    `/aurora/documents/${documentId}/versions/${versionId}/restore`,
    { data: input }
  );
}
