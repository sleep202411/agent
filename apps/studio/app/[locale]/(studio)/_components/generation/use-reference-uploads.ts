"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useComposerDraft } from "./use-composer-draft";
import { useAuth } from "@/app/_components/auth-provider";
import {
  useOptionalProjectContext,
  useProjectPayerWorkspace,
} from "@/app/[locale]/project/_components/project-context";
import type {
  FizzAiReferenceKind,
  PromptReferenceRowLike,
} from "@/lib/canvas-authoring/generation-api";
import { probeMediaDurationSeconds } from "@/lib/canvas-authoring/probe-media-duration";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";

/** One reference upload (in flight or landed) bound to a schema field. */
export interface ReferenceUpload {
  id: string;
  field: string;
  kind: FizzAiReferenceKind;
  name: string;
  /** Local object URL for the thumbnail (revoked on remove/unmount). */
  previewUrl: string;
  /** Durable storage URL once confirmed. */
  url?: string;
  mediaAssetId?: string;
  /** Exact seconds when known (video/audio) — required by catalog duration rules. */
  durationSeconds?: number | null;
  bytes?: number | null;
  uploading: boolean;
  progress: number;
  error?: string;
  /** Mention label, e.g. "Image1" — assigned per kind in upload order. */
  label: string;
}

export function generationReferencesFromUploads(items: ReferenceUpload[]) {
  const references: Record<string, PromptReferenceRowLike[]> = {};
  for (const item of items) {
    (references[item.field] ??= []).push({
      ...item,
      url: item.url ?? "",
      assetId: item.mediaAssetId,
    });
  }
  return references;
}

const UPLOAD_KIND_BY_REFERENCE: Record<FizzAiReferenceKind, string> = {
  image: "ai_reference_image",
  video: "ai_reference_video",
  audio: "ai_reference_audio",
};

const LABEL_PREFIX: Record<FizzAiReferenceKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

/**
 * Owns the reference uploads of one composer: SAS direct-to-storage upload
 * with live progress, abort-on-remove, object-URL lifecycle, and mention
 * labels (Image1/Video1/…) assigned per kind.
 */
export function useReferenceUploads(modality?: "image" | "video" | "audio") {
  // Uploads carry the project's member-accessible workspace (its team pot, or
  // my own personal one when the project is personal) — the upload endpoint is
  // workspace-membership gated, so this is always a workspace I can write to,
  // never the global active selection a second tab may have switched away.
  const workspaceId = useProjectPayerWorkspace()?.id ?? null;
  const project = useOptionalProjectContext();
  const { user } = useAuth();
  const canEdit = project?.canEdit ?? true;
  const scope = JSON.stringify([
    user?.id ?? null,
    project?.projectId ?? null,
    workspaceId,
    canEdit,
  ]);
  const activeScope = useRef<string | null>(null);
  const draft = useComposerDraft(modality ?? "image");
  const [localItems, setLocalItems] = useState<ReferenceUpload[]>([]);
  const items = modality ? draft.references : localItems;
  const setItems = modality ? draft.setReferences : setLocalItems;
  const aborts = useRef(new Map<string, AbortController>());
  const previews = useRef(new Map<string, string>());
  const labels = useRef({ image: 0, video: 0, audio: 0 });
  const releasePreview = useCallback((id: string) => {
    const url = previews.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      previews.current.delete(id);
    }
  }, []);
  useLayoutEffect(() => {
    activeScope.current = scope;
    // Restored references retain their mention labels across navigation.
    for (const item of items) {
      const number = Number(item.label.replace(/\D/g, ""));
      if (Number.isFinite(number))
        labels.current[item.kind] = Math.max(labels.current[item.kind], number);
    }
    const controllers = aborts.current;
    const urls = previews.current;
    return () => {
      activeScope.current = null;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
      labels.current = { image: 0, video: 0, audio: 0 };
      setItems((previous) =>
        modality
          ? previous
              .filter((item) => item.url && !item.uploading && !item.error)
              .map((item) => ({ ...item, previewUrl: item.url! }))
          : []
      );
    };
    // Items are read only on scope entry; upload edits must not tear down uploads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, modality, setItems]);

  const addFiles = useCallback(
    (field: string, kind: FizzAiReferenceKind, files: File[]) => {
      if (activeScope.current !== scope || !canEdit) return;
      for (const file of files) {
        const id = crypto.randomUUID();
        const controller = new AbortController();
        // Allocate resources outside state updaters: React can replay an updater.
        const previewUrl = URL.createObjectURL(file);
        aborts.current.set(id, controller);
        previews.current.set(id, previewUrl);
        const label = `${LABEL_PREFIX[kind]}${++labels.current[kind]}`;
        setItems((prev) => [
          ...prev,
          { id, field, kind, name: file.name, previewUrl, uploading: true, progress: 0, label },
        ]);
        void Promise.all([
          uploadFileViaSignedUrl(file, {
            kind: UPLOAD_KIND_BY_REFERENCE[kind],
            ...(workspaceId ? { workspaceId } : {}),
            signal: controller.signal,
            onProgress: (percent) => {
              if (controller.signal.aborted) return;
              setItems((prev) =>
                prev.map((item) => (item.id === id ? { ...item, progress: percent } : item))
              );
            },
          }),
          kind === "video" || kind === "audio"
            ? probeMediaDurationSeconds(file, kind, controller.signal)
            : Promise.resolve(null as number | null),
        ])
          .then(([result, durationSeconds]) => {
            if (controller.signal.aborted) return;
            setItems((prev) =>
              prev.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      uploading: false,
                      progress: 100,
                      url: result.url,
                      mediaAssetId: result.mediaAssetId,
                      bytes: file.size,
                      ...(durationSeconds != null ? { durationSeconds } : {}),
                    }
                  : item
              )
            );
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted || isUploadAbort(error)) {
              controller.abort();
              releasePreview(id);
              setItems((prev) => prev.filter((item) => item.id !== id));
              return;
            }
            controller.abort();
            setItems((prev) =>
              prev.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      uploading: false,
                      error: error instanceof Error ? error.message : "Upload failed",
                    }
                  : item
              )
            );
          })
          .finally(() => aborts.current.delete(id));
      }
    },
    [workspaceId, releasePreview, scope, canEdit, setItems]
  );

  const remove = useCallback(
    (id: string) => {
      aborts.current.get(id)?.abort();
      aborts.current.delete(id);
      releasePreview(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [releasePreview, setItems]
  );

  const clear = useCallback(() => {
    aborts.current.forEach((controller) => controller.abort());
    aborts.current.clear();
    previews.current.forEach((url) => URL.revokeObjectURL(url));
    previews.current.clear();
    setItems([]);
  }, [setItems]);

  return { items, addFiles, remove, clear };
}
