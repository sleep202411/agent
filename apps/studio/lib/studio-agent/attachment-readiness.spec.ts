import { describe, expect, it, vi } from "vitest";

import type { AgentAttachmentSummary } from "@repo/shared/agent-platform";

import { waitForAgentAttachmentReady } from "./attachment-readiness";

const processing = summary("processing");
const ready = summary("ready");

describe("waitForAgentAttachmentReady", () => {
  it("reconciles one attachment until it is ready with bounded backoff", async () => {
    const readStatus = vi.fn().mockResolvedValueOnce(processing).mockResolvedValueOnce(ready);
    const delay = vi.fn().mockResolvedValue(undefined);
    const onStatus = vi.fn();
    const result = await waitForAgentAttachmentReady({
      initial: processing,
      readStatus,
      signal: new AbortController().signal,
      onStatus,
      visibility: { waitUntilVisible: vi.fn().mockResolvedValue(undefined) },
      delay,
    });

    expect(result).toBe(ready);
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(onStatus).toHaveBeenNthCalledWith(1, processing);
    expect(onStatus).toHaveBeenNthCalledWith(2, processing);
    expect(onStatus).toHaveBeenNthCalledWith(3, ready);
    expect(delay).toHaveBeenNthCalledWith(1, 250, expect.any(AbortSignal));
    expect(delay).toHaveBeenNthCalledWith(2, 500, expect.any(AbortSignal));
  });

  it("keeps durable processing alive across transient status read failures", async () => {
    const readStatus = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(ready);
    const result = await waitForAgentAttachmentReady({
      initial: processing,
      readStatus,
      signal: new AbortController().signal,
      visibility: { waitUntilVisible: vi.fn().mockResolvedValue(undefined) },
      delay: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toBe(ready);
  });

  it("surfaces the stable ingest failure and stops polling", async () => {
    const failed = {
      ...summary("failed"),
      error: { code: "agent.document_parse_failed", message: "Unreadable file.", retryable: false },
    };
    await expect(
      waitForAgentAttachmentReady({
        initial: failed,
        readStatus: vi.fn(),
        signal: new AbortController().signal,
        visibility: { waitUntilVisible: vi.fn().mockResolvedValue(undefined) },
        delay: vi.fn(),
      })
    ).rejects.toMatchObject({
      code: "agent.document_parse_failed",
      retryable: false,
    });
  });

  it("aborts without another status request", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Removed", "AbortError"));
    const readStatus = vi.fn();
    await expect(
      waitForAgentAttachmentReady({
        initial: processing,
        readStatus,
        signal: controller.signal,
        visibility: { waitUntilVisible: vi.fn() },
        delay: vi.fn(),
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(readStatus).not.toHaveBeenCalled();
  });
});

function summary(status: AgentAttachmentSummary["status"]): AgentAttachmentSummary {
  return {
    schemaVersion: "agent-attachment/v1",
    id: "0197f4a2-0800-7000-8000-000000000001",
    conversationId: "0197f4a2-0800-7000-8000-000000000002",
    mediaAssetId: "0197f4a2-0800-7000-8000-000000000003",
    fileName: "script.txt",
    mediaType: "text/plain",
    sizeBytes: "42",
    status,
    uri: "fizzdragon-media://0197f4a2-0800-7000-8000-000000000001",
    ingest:
      status === "processing"
        ? {
            stage: "extracting",
            progress: 25,
            attempt: 1,
            maximumAttempts: 5,
            nextAttemptAt: null,
          }
        : null,
    analysis: null,
    error: null,
  };
}
