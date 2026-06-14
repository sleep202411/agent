"use client";

import { useState } from "react";
import * as Y from "yjs";
import { IconDeviceFloppy, IconRestore, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useDocumentVersions } from "@/lib/collab/use-versions";
import type { VersionDto, VersionSource } from "@/lib/collab/versions-api";
import type { DocumentProvider } from "@/lib/collab/document-provider";
import { FLOATING_PANEL } from "./node-toolbar";

interface CanvasHistoryProps {
  documentId: string | null;
  provider: DocumentProvider | null;
  doc: Y.Doc | null;
  restoreFromUpdate: (targetBytes: Uint8Array | null) => void;
  currentVersionId?: string | null;
  onClose: () => void;
}

const SOURCE_LABEL: Record<VersionSource, string> = {
  manual: "Saved",
  system: "Auto",
  autosave: "Auto",
  ai: "AI",
  import: "Import",
};

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Version history: save named checkpoints and restore the canvas to any of them.
 * Restore stamps a reversible "before restore" checkpoint, then converges every
 * collaborator. Real-time list via {@link useDocumentVersions}.
 */
export function CanvasHistory({
  documentId,
  provider,
  doc,
  restoreFromUpdate,
  currentVersionId,
  onClose,
}: CanvasHistoryProps) {
  const {
    versions,
    loading,
    currentVersionId: activeVersionId,
    createCheckpoint,
    restore,
  } = useDocumentVersions(documentId, provider, doc, restoreFromUpdate, currentVersionId);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await createCheckpoint(label.trim() || undefined);
      setLabel("");
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (version: VersionDto) => {
    if (busy) return;
    setBusy(true);
    try {
      await restore(version);
      setConfirmId(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "absolute top-16 left-4 z-30 flex max-h-[calc(100vh-6rem)] w-72 flex-col rounded-2xl",
        FLOATING_PANEL
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-medium">Version history</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-2 pb-2">
        <input
          value={label}
          placeholder="Name this checkpoint…"
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          className="h-9 flex-1 rounded-xl bg-muted px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label="Save checkpoint"
          disabled={busy}
          onClick={() => void save()}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-black transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <IconDeviceFloppy className="size-4" stroke={1.8} />
        </button>
      </div>

      <div className="flex flex-col overflow-y-auto px-1.5 pb-1.5">
        {loading && versions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No checkpoints yet. Save one to capture this canvas.
          </p>
        ) : (
          versions.map((version) => {
            const isCurrent = version.id === activeVersionId;
            const confirming = confirmId === version.id;
            return (
              <div
                key={version.id}
                className="group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-white/[0.05]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm">
                      {version.label || `Version ${version.versionNumber}`}
                    </span>
                    {isCurrent && (
                      <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
                        current
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{SOURCE_LABEL[version.source]}</span>
                    <span>·</span>
                    <span>{relativeTime(version.createdAt)}</span>
                  </div>
                </div>

                {confirming ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void doRestore(version)}
                      className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="rounded-full px-2 py-1 text-xs text-white/60 transition-colors hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label="Restore this version"
                    disabled={isCurrent}
                    onClick={() => setConfirmId(version.id)}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-white/50 opacity-0 transition-colors group-hover:opacity-100 hover:bg-white/[0.08] hover:text-white disabled:hidden"
                  >
                    <IconRestore className="size-4" stroke={1.8} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
