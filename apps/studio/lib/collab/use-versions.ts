"use client";

import { useCallback, useEffect, useState } from "react";
import * as Y from "yjs";
import { base64ToBytes, bytesToBase64 } from "./protocol";
import { metaMap, readAllAssets, readAllEdges, readAllNodes } from "./canvas-doc";
import {
  createDocumentCheckpoint,
  listDocumentVersions,
  restoreDocumentVersion,
  type VersionDto,
} from "./versions-api";
import type { DocumentProvider } from "./document-provider";

const VERSIONS_CHANGED = "versions_changed";

function isVersionsChanged(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: string }).type === VERSIONS_CHANGED
  );
}

/** Snapshot the live canvas into a restorable checkpoint payload. */
function encodeCanvasState(doc: Y.Doc) {
  return {
    crdtStateBase64: bytesToBase64(Y.encodeStateAsUpdate(doc)),
    snapshot: {
      nodes: readAllNodes(doc),
      edges: readAllEdges(doc),
      assets: readAllAssets(doc),
      meta: metaMap(doc).toJSON(),
    },
  };
}

export interface DocumentVersionsHandle {
  versions: VersionDto[];
  loading: boolean;
  /** The version the canvas currently reflects (advances locally on restore). */
  currentVersionId: string | null | undefined;
  createCheckpoint: (label?: string) => Promise<void>;
  restore: (version: VersionDto) => Promise<void>;
}

/**
 * Version checkpoints with real-time list sync. Restore is client-driven: it
 * stamps a server-side "before restore" safety checkpoint from the live state,
 * then reconciles the canvas to the target — which streams as a normal CRDT
 * operation so every collaborator converges. A peer signal refreshes the list.
 */
export function useDocumentVersions(
  documentId: string | null,
  provider: DocumentProvider | null,
  doc: Y.Doc | null,
  restoreFromUpdate: (targetBytes: Uint8Array | null) => void,
  initialCurrentVersionId?: string | null
): DocumentVersionsHandle {
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [loading, setLoading] = useState(false);
  // The server's currentVersionId is stale after a restore (the pointer change
  // doesn't push to the client); track the locally-restored version so the
  // "current" marker is correct for the user who just restored.
  const [restoredVersionId, setRestoredVersionId] = useState<string | null>(null);

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

  // Refetch when a peer reports a version change (checkpoint / restore).
  useEffect(() => {
    if (!provider) return;
    return provider.onAppEvent((data) => {
      if (isVersionsChanged(data)) void refetch();
    });
  }, [provider, refetch]);

  const notifyPeers = useCallback(() => {
    provider?.broadcastAppEvent({ type: VERSIONS_CHANGED });
  }, [provider]);

  const createCheckpoint = useCallback(
    async (label?: string) => {
      if (!documentId || !doc) return;
      await createDocumentCheckpoint(documentId, {
        label,
        source: "manual",
        ...encodeCanvasState(doc),
      });
      await refetch();
      notifyPeers();
    },
    [documentId, doc, refetch, notifyPeers]
  );

  const restore = useCallback(
    async (version: VersionDto) => {
      if (!documentId || !doc) return;
      const current = encodeCanvasState(doc);
      const { target } = await restoreDocumentVersion(documentId, version.id, {
        currentCrdtStateBase64: current.crdtStateBase64,
        currentSnapshot: current.snapshot,
      });
      restoreFromUpdate(target.crdtStateBase64 ? base64ToBytes(target.crdtStateBase64) : null);
      setRestoredVersionId(target.id);
      await refetch();
      notifyPeers();
    },
    [documentId, doc, refetch, notifyPeers, restoreFromUpdate]
  );

  return {
    versions,
    loading,
    currentVersionId: restoredVersionId ?? initialCurrentVersionId,
    createCheckpoint,
    restore,
  };
}
