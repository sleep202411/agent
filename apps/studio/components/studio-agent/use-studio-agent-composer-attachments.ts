"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioAgentMessagePart } from "@repo/shared";

export const STUDIO_AGENT_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const STUDIO_AGENT_IMAGE_MAX_SIZE_BYTES = 30 * 1024 * 1024;
export const STUDIO_AGENT_DOCUMENT_MEDIA_TYPES = [
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
] as const;
export const STUDIO_AGENT_DOCUMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const STUDIO_AGENT_ATTACHMENT_MEDIA_TYPES = [
  ...STUDIO_AGENT_IMAGE_MEDIA_TYPES,
  ...STUDIO_AGENT_DOCUMENT_MEDIA_TYPES,
] as const;
export const STUDIO_AGENT_ATTACHMENT_ACCEPT = [
  ...STUDIO_AGENT_ATTACHMENT_MEDIA_TYPES,
  ".txt",
  ".md",
  ".docx",
  ".pdf",
].join(",");

export type StudioAgentCanonicalAttachment = Extract<
  StudioAgentMessagePart,
  { type: "attachment" }
>;

export type StudioAgentComposerAttachmentStatus = "uploading" | "processing" | "ready" | "failed";

export interface StudioAgentComposerAttachment {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  progress: number;
  status: StudioAgentComposerAttachmentStatus;
  error: string | null;
  retryable: boolean;
  attachment: StudioAgentCanonicalAttachment | null;
}

export interface StudioAgentAttachmentUploadContext {
  signal: AbortSignal;
  onProgress: (percent: number) => void;
  onProcessing: (percent: number) => void;
}

/**
 * Ownership receipt for one canonical attachment registered by a product
 * adapter.
 *
 * The adapter closes `abandon` over the exact server scope that registered the
 * artifact. The generic queue can therefore release an abandoned upload after
 * a surface switch without guessing which thread currently happens to be
 * active.
 */
export interface StudioAgentAttachmentUploadLease {
  attachment: StudioAgentCanonicalAttachment;
  abandon: () => void | Promise<void>;
}

export interface UseStudioAgentComposerAttachmentsOptions {
  upload: (
    file: File,
    context: StudioAgentAttachmentUploadContext
  ) => Promise<StudioAgentAttachmentUploadLease>;
  validateFile: (file: File) => string | null;
  uploadFailedMessage: string;
}

export interface StudioAgentComposerAttachmentQueue {
  items: readonly StudioAgentComposerAttachment[];
  readyAttachments: readonly StudioAgentCanonicalAttachment[];
  hasBlockingAttachments: boolean;
  addFiles: (files: FileList | readonly File[]) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  deliver: <T>(
    attachments: readonly StudioAgentCanonicalAttachment[],
    operation: () => Promise<T>
  ) => Promise<T>;
}

type AttachmentLifecycle = "owned" | "delivering" | "delivered" | "abandoning";

interface AttachmentEntry extends StudioAgentComposerAttachment {
  file: File;
  attempt: number;
  controller: AbortController | null;
  lease: StudioAgentAttachmentUploadLease | null;
  lifecycle: AttachmentLifecycle;
  deliveryToken: symbol | null;
}

/**
 * Ephemeral upload queue for the product-neutral Studio Agent composer.
 *
 * The queue owns browser File objects and cancellation only. A product adapter
 * performs the actual upload and must return the canonical attachment part
 * produced by the Studio Agent API.
 */
export function useStudioAgentComposerAttachments({
  upload,
  validateFile,
  uploadFailedMessage,
}: UseStudioAgentComposerAttachmentsOptions): StudioAgentComposerAttachmentQueue {
  const entriesRef = useRef(new Map<string, AttachmentEntry>());
  const uploadRef = useRef(upload);
  const validateFileRef = useRef(validateFile);
  const uploadFailedMessageRef = useRef(uploadFailedMessage);
  const mountedRef = useRef(true);
  const abandonedAttachmentIdsRef = useRef(new Set<string>());
  const [items, setItems] = useState<readonly StudioAgentComposerAttachment[]>([]);

  useEffect(() => {
    uploadRef.current = upload;
  }, [upload]);

  useEffect(() => {
    validateFileRef.current = validateFile;
  }, [validateFile]);

  useEffect(() => {
    uploadFailedMessageRef.current = uploadFailedMessage;
  }, [uploadFailedMessage]);

  const publish = useCallback(() => {
    if (!mountedRef.current) return;
    setItems(Array.from(entriesRef.current.values(), toPublicAttachment));
  }, []);

  const abandonLease = useCallback((lease: StudioAgentAttachmentUploadLease) => {
    const attachmentId = lease.attachment.attachmentId;
    if (abandonedAttachmentIdsRef.current.has(attachmentId)) return;
    abandonedAttachmentIdsRef.current.add(attachmentId);
    // Abandonment is deliberately detached from UI teardown. The server-side
    // command is idempotent and its expiry worker remains the final safety net
    // if this best-effort request cannot reach the server.
    void Promise.resolve()
      .then(() => lease.abandon())
      .catch(() => undefined);
  }, []);

  const startUpload = useCallback(
    (id: string) => {
      const current = entriesRef.current.get(id);
      if (!current) return;

      current.controller?.abort();
      const controller = new AbortController();
      const attempt = current.attempt + 1;
      entriesRef.current.set(id, {
        ...current,
        attempt,
        controller,
        progress: 0,
        status: "uploading",
        error: null,
        retryable: true,
        attachment: null,
        lease: null,
        lifecycle: "owned",
        deliveryToken: null,
      });
      publish();

      void uploadRef
        .current(current.file, {
          signal: controller.signal,
          onProgress(percent) {
            const latest = entriesRef.current.get(id);
            if (!latest || latest.attempt !== attempt || latest.controller !== controller) return;
            entriesRef.current.set(id, {
              ...latest,
              progress: clampProgress(percent),
            });
            publish();
          },
          onProcessing(percent) {
            const latest = entriesRef.current.get(id);
            if (!latest || latest.attempt !== attempt || latest.controller !== controller) return;
            entriesRef.current.set(id, {
              ...latest,
              progress: clampProgress(percent),
              status: "processing",
            });
            publish();
          },
        })
        .then((lease) => {
          const latest = entriesRef.current.get(id);
          if (
            !latest ||
            latest.attempt !== attempt ||
            latest.controller !== controller ||
            controller.signal.aborted
          ) {
            abandonLease(lease);
            return;
          }
          if (
            lease.attachment.status !== "ready" ||
            abandonedAttachmentIdsRef.current.has(lease.attachment.attachmentId)
          ) {
            abandonLease(lease);
            throw new Error(uploadFailedMessageRef.current);
          }
          entriesRef.current.set(id, {
            ...latest,
            controller: null,
            progress: 100,
            status: "ready",
            error: null,
            retryable: false,
            attachment: lease.attachment,
            lease,
          });
          publish();
        })
        .catch((cause: unknown) => {
          const latest = entriesRef.current.get(id);
          if (!latest || latest.attempt !== attempt || latest.controller !== controller) return;
          if (controller.signal.aborted) return;
          entriesRef.current.set(id, {
            ...latest,
            controller: null,
            status: "failed",
            error: toErrorMessage(cause, uploadFailedMessageRef.current),
            retryable: readRetryability(cause) ?? true,
            attachment: null,
          });
          publish();
        });
    },
    [abandonLease, publish]
  );

  const addFiles = useCallback(
    (files: FileList | readonly File[]) => {
      for (const file of Array.from(files)) {
        const id = crypto.randomUUID();
        const validationError = validateFileRef.current(file);
        const entry: AttachmentEntry = {
          id,
          file,
          fileName: file.name,
          mediaType: file.type,
          sizeBytes: file.size,
          progress: 0,
          status: validationError ? "failed" : "uploading",
          error: validationError,
          retryable: false,
          attachment: null,
          attempt: 0,
          controller: null,
          lease: null,
          lifecycle: "owned",
          deliveryToken: null,
        };
        entriesRef.current.set(id, entry);
        if (!validationError) startUpload(id);
      }
      publish();
    },
    [publish, startUpload]
  );

  const retry = useCallback(
    (id: string) => {
      const entry = entriesRef.current.get(id);
      if (!entry?.retryable || entry.status !== "failed") return;
      const validationError = validateFileRef.current(entry.file);
      if (validationError) {
        entriesRef.current.set(id, {
          ...entry,
          error: validationError,
          retryable: false,
        });
        publish();
        return;
      }
      startUpload(id);
    },
    [publish, startUpload]
  );

  const remove = useCallback(
    (id: string) => {
      const entry = entriesRef.current.get(id);
      if (!entry) return;
      entry.controller?.abort();
      if (entry.lease && entry.lifecycle === "owned") {
        entry.lifecycle = "abandoning";
        abandonLease(entry.lease);
      }
      entriesRef.current.delete(id);
      publish();
    },
    [abandonLease, publish]
  );

  const clear = useCallback(() => {
    for (const entry of entriesRef.current.values()) {
      entry.controller?.abort();
      if (entry.lease && entry.lifecycle === "owned") {
        entry.lifecycle = "abandoning";
        abandonLease(entry.lease);
      }
    }
    entriesRef.current.clear();
    publish();
  }, [abandonLease, publish]);

  const deliver = useCallback(
    async <T>(
      attachments: readonly StudioAgentCanonicalAttachment[],
      operation: () => Promise<T>
    ): Promise<T> => {
      const token = Symbol("studio-agent-attachment-delivery");
      const selectedEntries: AttachmentEntry[] = [];
      const selectedAttachmentIds = new Set<string>();

      for (const attachment of attachments) {
        if (selectedAttachmentIds.has(attachment.attachmentId)) {
          throw new Error("The attachment delivery contains a duplicate artifact.");
        }
        selectedAttachmentIds.add(attachment.attachmentId);
        const entry = Array.from(entriesRef.current.values()).find(
          (candidate) =>
            candidate.attachment?.attachmentId === attachment.attachmentId &&
            candidate.lifecycle === "owned"
        );
        if (!entry || !entry.lease || entry.status !== "ready") {
          throw new Error("The attachment is no longer available for delivery.");
        }
        selectedEntries.push(entry);
      }

      for (const entry of selectedEntries) {
        entry.lifecycle = "delivering";
        entry.deliveryToken = token;
      }

      try {
        const result = await operation();
        for (const entry of selectedEntries) {
          if (entry.deliveryToken !== token) continue;
          entry.lifecycle = "delivered";
          entry.deliveryToken = null;
          const latest = entriesRef.current.get(entry.id);
          if (latest === entry) entriesRef.current.delete(entry.id);
        }
        publish();
        return result;
      } catch (cause) {
        for (const entry of selectedEntries) {
          if (entry.deliveryToken !== token) continue;
          const latest = entriesRef.current.get(entry.id);
          entry.deliveryToken = null;
          if (latest === entry) {
            entry.lifecycle = "owned";
          } else if (entry.lease) {
            entry.lifecycle = "abandoning";
            abandonLease(entry.lease);
          }
        }
        throw cause;
      }
    },
    [abandonLease, publish]
  );

  useEffect(() => {
    mountedRef.current = true;
    const entries = entriesRef.current;
    return () => {
      mountedRef.current = false;
      for (const entry of entries.values()) {
        entry.controller?.abort();
        if (entry.lease && entry.lifecycle === "owned") {
          entry.lifecycle = "abandoning";
          abandonLease(entry.lease);
        }
      }
      entries.clear();
    };
  }, [abandonLease]);

  return {
    items,
    readyAttachments: items.flatMap((item) => (item.attachment ? [item.attachment] : [])),
    hasBlockingAttachments: items.some((item) => item.status !== "ready"),
    addFiles,
    retry,
    remove,
    clear,
    deliver,
  };
}

export function formatStudioAgentFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace(/\.?0+$/, "")} ${units[unitIndex]}`;
}

function clampProgress(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function toErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function readRetryability(cause: unknown): boolean | null {
  if (!cause || typeof cause !== "object" || !("retryable" in cause)) return null;
  return typeof cause.retryable === "boolean" ? cause.retryable : null;
}

function toPublicAttachment(entry: AttachmentEntry): StudioAgentComposerAttachment {
  return {
    id: entry.id,
    fileName: entry.fileName,
    mediaType: entry.mediaType,
    sizeBytes: entry.sizeBytes,
    progress: entry.progress,
    status: entry.status,
    error: entry.error,
    retryable: entry.retryable,
    attachment: entry.attachment,
  };
}
