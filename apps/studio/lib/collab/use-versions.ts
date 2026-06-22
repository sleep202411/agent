"use client";

import { useCallback, useEffect, useState } from "react";
import { listDocumentVersions, type VersionDto } from "./versions-api";
import type { DocumentProvider } from "./document-provider";

const VERSIONS_CHANGED = "versions_changed";

function isVersionsChanged(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === VERSIONS_CHANGED
  );
}

export interface DocumentVersionsHandle {
  versions: VersionDto[];
  loading: boolean;
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
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!documentId) return;
    try {
      setVersions(await listDocumentVersions(documentId));
    } catch {
      /* 401 raises the login dialog; transient errors retry on next signal */
    }
  }, [documentId]);

  useEffect(() => {
    if (!documentId) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setVersions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void refetch().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, refetch]);

  // Refetch when a peer reports a version change (a new checkpoint).
  useEffect(() => {
    if (!provider) return;
    return provider.onAppEvent((data) => {
      if (isVersionsChanged(data)) void refetch();
    });
  }, [provider, refetch]);

  return { versions, loading };
}
