"use client";

import { useDocumentFeed } from "./use-document-feed";
import { listDocumentVersions, type VersionDto } from "./versions-api";
import type { DocumentProvider } from "./document-provider";

export interface DocumentVersionsHandle {
  versions: VersionDto[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Read-only document version feed with real-time sync. Versions are written
 * elsewhere (autosave + manual checkpoints); this hook only LISTS them — it is
 * the source for the canvas activity log. A peer signal refreshes the list.
 */
export function useDocumentVersions(
  documentId: string | null,
  provider: DocumentProvider | null
): DocumentVersionsHandle {
  const {
    rows: versions,
    loading,
    error,
    refetch,
  } = useDocumentFeed(documentId, provider, "versions_changed", listDocumentVersions);
  return { versions, loading, error, refetch };
}
