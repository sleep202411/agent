"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FizzAiReferenceKind } from "@/app/canvas/_lib/generation-api";
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
  uploading: boolean;
  progress: number;
  error?: string;
  /** Mention label, e.g. "Image1" — assigned per kind in upload order. */
  label: string;
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
export function useReferenceUploads() {
  const [items, setItems] = useState<ReferenceUpload[]>([]);
  const aborts = useRef(new Map<string, AbortController>());
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Revoke every preview URL on unmount.
  useEffect(
    () => () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      aborts.current.forEach((controller) => controller.abort());
    },
    []
  );

  const addFiles = useCallback((field: string, kind: FizzAiReferenceKind, files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      aborts.current.set(id, controller);
      setItems((prev) => {
        const count = prev.filter((item) => item.kind === kind).length;
        return [
          ...prev,
          {
            id,
            field,
            kind,
            name: file.name,
            previewUrl: URL.createObjectURL(file),
            uploading: true,
            progress: 0,
            label: `${LABEL_PREFIX[kind]}${count + 1}`,
          },
        ];
      });
      void uploadFileViaSignedUrl(file, {
        kind: UPLOAD_KIND_BY_REFERENCE[kind],
        signal: controller.signal,
        onProgress: (percent) =>
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, progress: percent } : item))
          ),
      })
        .then((result) =>
          setItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    uploading: false,
                    progress: 100,
                    url: result.url,
                    mediaAssetId: result.mediaAssetId,
                  }
                : item
            )
          )
        )
        .catch((error: unknown) => {
          if (isUploadAbort(error)) {
            setItems((prev) => prev.filter((item) => item.id !== id));
            return;
          }
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
  }, []);

  const remove = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    setItems((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    aborts.current.forEach((controller) => controller.abort());
    aborts.current.clear();
    setItems((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, []);

  return { items, addFiles, remove, clear };
}
