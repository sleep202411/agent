"use client";

import { DocumentSyncError } from "@/components/document-sync-error";
import { createContext, useContext, useMemo } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { toCollabUser } from "@/lib/collab/collab-user";
import { useCanvasDoc, type CanvasDocHandle } from "@/lib/collab/use-canvas-doc";
import { useCanvasGraph } from "@/lib/collab/use-canvas-graph";
import { CanvasGraphProvider } from "@/lib/canvas-core/canvas-graph-context";
import { CanvasGenerationProvider } from "@/lib/canvas-authoring/use-canvas-generation";
import {
  useProjectContext,
  type StudioWorkbenchOwner,
} from "@/app/[locale]/project/_components/project-context";
import type { DocumentProvider } from "@/lib/collab/document-provider";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

/**
 * The SINGLE owner of the active section's canvas document connection.
 *
 * `DocumentProvider` is NOT a singleton — every `useCanvasDoc` call builds its
 * own WebSocket + Y.Doc + awareness. So the connection MUST be established
 * exactly once, here, and every mode editor (canvas / storyboard / brief) reads
 * `doc` / `awareness` / `provider` / `connectionStatus` from this context
 * instead of calling the hooks themselves. A second call site would open a
 * second connection (two sockets, two CRDT replicas, the user appearing twice
 * to peers).
 *
 * `useCanvasGraph` stays per-mode (it holds per-surface UI state), but it
 * consumes the `doc`/`awareness` from here.
 */
export interface CanvasConnectionValue {
  documentId: string | null;
  documentStatus: "loading" | "ready" | "error";
  doc: Y.Doc | null;
  awareness: Awareness | null;
  provider: DocumentProvider | null;
  connectionStatus: CanvasDocHandle["status"];
  rtt: number | null;
}

const CanvasConnectionContext = createContext<CanvasConnectionValue | null>(null);

export function CanvasConnectionProvider({
  owner,
  documentId,
  canEdit,
  canGenerate = true,
  generationDisabledReason = null,
  children,
}: {
  owner: StudioWorkbenchOwner;
  documentId: string;
  canEdit: boolean;
  canGenerate?: boolean;
  generationDisabledReason?: string | null;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const collabUser = useMemo(() => toCollabUser(user), [user]);
  const documentStatus = "ready" as const;
  const {
    doc,
    awareness,
    provider,
    status: connectionStatus,
    rtt,
    error,
    retry,
  } = useCanvasDoc(documentId, collabUser);
  // The graph is the document's node/edge view. It's ONE per document (not per
  // surface) — canvas and storyboard read the same nodes, so the graph lives
  // here alongside the connection. This also puts it above the CopilotPanel
  // (which needs CanvasGraphProvider for its tools).
  const graph = useCanvasGraph(doc, awareness, canEdit);
  const { catalog, projectSkills } = useProjectContext();

  const value = useMemo<CanvasConnectionValue>(
    () => ({
      documentId,
      documentStatus,
      doc,
      awareness,
      provider,
      connectionStatus,
      rtt,
    }),
    [documentId, documentStatus, doc, awareness, provider, connectionStatus, rtt]
  );

  return (
    <CanvasConnectionContext.Provider value={value}>
      <CanvasGraphProvider value={graph}>
        {/* Generation provider is also document-level (realtime/reconcile loop
            reads the graph). Lifted here so the shell-level CopilotPanel can
            call useGeneration() without each mode wrapping it. */}
        <CanvasGenerationProvider
          catalog={catalog.data}
          projectSkills={projectSkills}
          context={{
            ...(owner.kind === "platform_project"
              ? { projectId: owner.projectId }
              : { storyProjectId: owner.projectId }),
            documentId: documentId ?? undefined,
            sourceSurface:
              owner.kind === "platform_project" ? "fizzstudio-canvas" : "story-studio-workbench",
          }}
          canGenerate={canGenerate}
          disabledReason={generationDisabledReason}
        >
          {children}
          <DocumentSyncError
            error={error}
            retry={retry}
            retrying={connectionStatus === "connecting"}
            className="absolute bottom-14 left-1/2 z-50 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 shadow-xl"
          />
        </CanvasGenerationProvider>
      </CanvasGraphProvider>
    </CanvasConnectionContext.Provider>
  );
}

export function useCanvasConnection(): CanvasConnectionValue {
  const value = useContext(CanvasConnectionContext);
  if (!value) {
    throw new Error("useCanvasConnection must be used within a CanvasConnectionProvider");
  }
  return value;
}

/** Nullable variant — for components that may render outside the project shell. */
export function useOptionalCanvasConnection(): CanvasConnectionValue | null {
  return useContext(CanvasConnectionContext);
}
