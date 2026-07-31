// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useStudioAgentComposerAttachments,
  type StudioAgentAttachmentUploadLease,
  type StudioAgentAttachmentUploadContext,
  type StudioAgentCanonicalAttachment,
  type StudioAgentComposerAttachmentQueue,
} from "./use-studio-agent-composer-attachments";

describe("useStudioAgentComposerAttachments", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queue: StudioAgentComposerAttachmentQueue | null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    queue = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000081")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000082");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps failures retryable and exposes only the canonical ready attachment", async () => {
    const upload = vi
      .fn<
        (
          file: File,
          context: StudioAgentAttachmentUploadContext
        ) => Promise<StudioAgentAttachmentUploadLease>
      >()
      .mockRejectedValueOnce(new Error("Storage unavailable"))
      .mockImplementationOnce(async (_file, context) => {
        context.onProgress(64);
        return createLease();
      });
    await render(upload);

    await act(async () => {
      queue!.addFiles([new File(["image"], "reference.webp", { type: "image/webp" })]);
      await flush();
    });
    expect(queue?.items[0]).toMatchObject({
      status: "failed",
      error: "Storage unavailable",
      retryable: true,
    });
    expect(queue?.hasBlockingAttachments).toBe(true);
    expect(queue?.readyAttachments).toEqual([]);

    await act(async () => {
      queue!.retry(queue!.items[0]!.id);
      await flush();
    });
    expect(queue?.items[0]).toMatchObject({
      status: "ready",
      progress: 100,
      attachment: canonicalAttachment,
    });
    expect(queue?.hasBlockingAttachments).toBe(false);
    expect(queue?.readyAttachments).toEqual([canonicalAttachment]);
  });

  it("projects durable ingest progress after the binary upload completes", async () => {
    let resolveUpload!: (lease: StudioAgentAttachmentUploadLease) => void;
    const upload = vi.fn(
      (_file: File, context: StudioAgentAttachmentUploadContext) =>
        new Promise<StudioAgentAttachmentUploadLease>((resolve) => {
          context.onProgress(100);
          context.onProcessing(7);
          context.onProcessing(63);
          resolveUpload = resolve;
        })
    );
    await render(upload);

    await act(async () => {
      queue!.addFiles([new File(["script"], "script.pdf", { type: "image/pdf" })]);
      await flush();
    });
    expect(queue?.items[0]).toMatchObject({
      status: "processing",
      progress: 63,
    });

    await act(async () => {
      resolveUpload(createLease());
      await flush();
    });
    expect(queue?.items[0]).toMatchObject({
      status: "ready",
      progress: 100,
    });
  });

  it("retains invalid files as removable blocking failures without calling the adapter", async () => {
    const upload = vi.fn();
    await render(upload);

    await act(async () => {
      queue!.addFiles([new File(["script"], "outline.txt", { type: "text/plain" })]);
    });
    expect(upload).not.toHaveBeenCalled();
    expect(queue?.items[0]).toMatchObject({
      status: "failed",
      error: "Unsupported image",
      retryable: false,
    });

    await act(async () => queue!.remove(queue!.items[0]!.id));
    expect(queue?.items).toEqual([]);
    expect(queue?.hasBlockingAttachments).toBe(false);
  });

  it("aborts an in-flight upload and ignores a late result after removal", async () => {
    const uploadContext: { current: StudioAgentAttachmentUploadContext | null } = {
      current: null,
    };
    const abandon = vi.fn();
    let resolveUpload!: (lease: StudioAgentAttachmentUploadLease) => void;
    const upload = vi.fn(
      (_file: File, context: StudioAgentAttachmentUploadContext) =>
        new Promise<StudioAgentAttachmentUploadLease>((resolve) => {
          uploadContext.current = context;
          resolveUpload = resolve;
        })
    );
    await render(upload);

    await act(async () => {
      queue!.addFiles([new File(["image"], "reference.webp", { type: "image/webp" })]);
    });
    const id = queue!.items[0]!.id;
    await act(async () => queue!.remove(id));

    expect(uploadContext.current?.signal.aborted).toBe(true);
    expect(queue?.items).toEqual([]);

    await act(async () => {
      resolveUpload(createLease(abandon));
      await flush();
    });
    expect(queue?.items).toEqual([]);
    expect(abandon).toHaveBeenCalledOnce();
  });

  it("abandons a ready canonical artifact exactly once when removed or cleared", async () => {
    const firstAbandon = vi.fn();
    const secondAbandon = vi.fn();
    const upload = vi
      .fn<
        (
          file: File,
          context: StudioAgentAttachmentUploadContext
        ) => Promise<StudioAgentAttachmentUploadLease>
      >()
      .mockResolvedValueOnce(createLease(firstAbandon))
      .mockResolvedValueOnce(
        createLease(secondAbandon, {
          ...canonicalAttachment,
          attachmentId: "00000000-0000-4000-8000-000000000072",
          fileName: "second.webp",
        })
      );
    await render(upload);

    await act(async () => {
      queue!.addFiles([new File(["first"], "first.webp", { type: "image/webp" })]);
      await flush();
    });
    await act(async () => {
      queue!.remove(queue!.items[0]!.id);
      queue!.remove(queue!.items[0]?.id ?? "missing");
      await flush();
    });
    expect(firstAbandon).toHaveBeenCalledOnce();

    await act(async () => {
      queue!.addFiles([new File(["second"], "second.webp", { type: "image/webp" })]);
      await flush();
      queue!.clear();
      queue!.clear();
      await flush();
    });
    expect(secondAbandon).toHaveBeenCalledOnce();
    expect(queue?.items).toEqual([]);
  });

  it("keeps a failed delivery owned and marks a successful delivery before clearing", async () => {
    const abandon = vi.fn();
    await render(vi.fn().mockResolvedValue(createLease(abandon)));

    await act(async () => {
      queue!.addFiles([new File(["image"], "reference.webp", { type: "image/webp" })]);
      await flush();
    });

    await act(async () => {
      await expect(
        queue!.deliver(queue!.readyAttachments, async () => {
          throw new Error("Submit failed");
        })
      ).rejects.toThrow("Submit failed");
    });
    expect(queue?.readyAttachments).toEqual([canonicalAttachment]);
    expect(abandon).not.toHaveBeenCalled();

    const operation = vi.fn().mockResolvedValue("accepted");
    await act(async () => {
      await expect(queue!.deliver(queue!.readyAttachments, operation)).resolves.toBe("accepted");
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(queue?.items).toEqual([]);
    expect(abandon).not.toHaveBeenCalled();
  });

  it("abandons after an in-flight delivery fails if the queue was cleared meanwhile", async () => {
    const abandon = vi.fn();
    await render(vi.fn().mockResolvedValue(createLease(abandon)));
    await act(async () => {
      queue!.addFiles([new File(["image"], "reference.webp", { type: "image/webp" })]);
      await flush();
    });

    let rejectDelivery!: (cause: Error) => void;
    const delivery = queue!.deliver(
      queue!.readyAttachments,
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDelivery = reject;
        })
    );
    await act(async () => {
      queue!.clear();
      await flush();
    });
    expect(abandon).not.toHaveBeenCalled();

    rejectDelivery(new Error("Submit failed"));
    await expect(delivery).rejects.toThrow("Submit failed");
    await flush();
    expect(abandon).toHaveBeenCalledOnce();
  });

  it("rejects a canonical artifact that was already scheduled for abandonment", async () => {
    const abandon = vi.fn().mockRejectedValue(new Error("Network unavailable"));
    const upload = vi.fn().mockResolvedValue(createLease(abandon));
    await render(upload);

    await act(async () => {
      queue!.addFiles([new File(["first"], "first.webp", { type: "image/webp" })]);
      await flush();
    });
    await act(async () => {
      queue!.remove(queue!.items[0]!.id);
      await flush();
    });
    await act(async () => {
      queue!.addFiles([new File(["second"], "second.webp", { type: "image/webp" })]);
      await flush();
    });

    expect(abandon).toHaveBeenCalledOnce();
    expect(queue?.items[0]).toMatchObject({
      status: "failed",
      error: "Upload failed",
      attachment: null,
    });
    expect(queue?.readyAttachments).toEqual([]);
  });

  it("abandons owned artifacts when the queue unmounts", async () => {
    const abandon = vi.fn();
    await render(vi.fn().mockResolvedValue(createLease(abandon)));
    await act(async () => {
      queue!.addFiles([new File(["image"], "reference.webp", { type: "image/webp" })]);
      await flush();
      root.render(null);
      await flush();
    });

    expect(abandon).toHaveBeenCalledOnce();
  });

  async function render(
    upload: (
      file: File,
      context: StudioAgentAttachmentUploadContext
    ) => Promise<StudioAgentAttachmentUploadLease>
  ) {
    await act(async () => {
      root.render(
        <Harness
          upload={upload}
          onQueue={(nextQueue) => {
            queue = nextQueue;
          }}
        />
      );
    });
  }
});

function Harness({
  upload,
  onQueue,
}: {
  upload: (
    file: File,
    context: StudioAgentAttachmentUploadContext
  ) => Promise<StudioAgentAttachmentUploadLease>;
  onQueue: (queue: StudioAgentComposerAttachmentQueue) => void;
}) {
  const queue = useStudioAgentComposerAttachments({
    upload,
    uploadFailedMessage: "Upload failed",
    validateFile: (file) => (file.type.startsWith("image/") ? null : "Unsupported image"),
  });
  onQueue(queue);
  return null;
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const canonicalAttachment: StudioAgentCanonicalAttachment = {
  type: "attachment",
  attachmentId: "00000000-0000-4000-8000-000000000071",
  fileName: "reference.webp",
  mediaType: "image/webp",
  sizeBytes: 5,
  status: "ready",
};

function createLease(
  abandon = vi.fn(),
  attachment: StudioAgentCanonicalAttachment = canonicalAttachment
): StudioAgentAttachmentUploadLease {
  return {
    attachment,
    abandon,
  };
}
