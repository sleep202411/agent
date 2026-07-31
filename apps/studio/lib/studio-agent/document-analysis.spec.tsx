// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentSummary } from "@repo/shared/agent-platform";

import {
  projectStudioAgentDocumentAnalysis,
  selectStudioAgentDocumentAttachmentIds,
  useStudioAgentDocumentAnalysis,
  type StudioAgentDocumentAnalysisMap,
} from "./document-analysis";
import { studioAgentAttachmentPart, type StudioAgentUIMessage } from "./transport-contract";

const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000001";
const JOB_ID = "00000000-0000-4000-8000-0000000000a1";

/**
 * The job the panel could not see.
 *
 * A 65k-character screenplay produced 46 durable checkpoints and died at 6 of
 * them; the transcript showed nothing for the whole run and nothing when it
 * failed. Everything here is that run's shape.
 */
describe("projectStudioAgentDocumentAnalysis", () => {
  it("reads a running job as in-progress work, not as a ready attachment", () => {
    const view = projectStudioAgentDocumentAnalysis(
      summary({ status: "running", stage: "mapping", completedUnits: 6, progress: 13 })
    );

    expect(view).toEqual({
      attachmentId: ATTACHMENT_ID,
      jobId: JOB_ID,
      phase: "mapping",
      progress: 13,
      completedUnits: 6,
      totalUnits: 46,
      error: null,
      settled: false,
    });
  });

  it("keeps the job's structured public failure verbatim", () => {
    const error = {
      code: "AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID",
      message: "FizzDragon could not complete the source document analysis. Please retry.",
      retryable: true,
    };

    const view = projectStudioAgentDocumentAnalysis(
      summary({ status: "failed", stage: "failed", completedUnits: 6, progress: 13, error })
    );

    expect(view).toMatchObject({ phase: "failed", settled: true, error });
  });

  it("treats an exhausted dead letter as a failure the creator must be told about", () => {
    expect(
      projectStudioAgentDocumentAnalysis(
        summary({ status: "dead_lettered", stage: "failed", completedUnits: 6, progress: 13 })
      )
    ).toMatchObject({ phase: "failed", settled: true });
  });

  it("has nothing to report for an attachment with no analysis job", () => {
    expect(projectStudioAgentDocumentAnalysis({ ...summary({}), analysis: null })).toBeNull();
  });
});

describe("selectStudioAgentDocumentAttachmentIds", () => {
  it("ignores images, which never carry an analysis job", () => {
    expect(
      selectStudioAgentDocumentAttachmentIds([
        message("m-1", [
          { attachmentId: "doc-1", mediaType: "application/pdf" },
          { attachmentId: "image-1", mediaType: "image/webp" },
        ]),
      ])
    ).toEqual(["doc-1"]);
  });

  it("keeps only the newest documents so opening a long thread is not a request burst", () => {
    const messages = Array.from({ length: 6 }, (_, index) =>
      message(`m-${index}`, [{ attachmentId: `doc-${index}`, mediaType: "text/plain" }])
    );

    expect(selectStudioAgentDocumentAttachmentIds(messages, 2)).toEqual(["doc-4", "doc-5"]);
  });
});

describe("useStudioAgentDocumentAnalysis", () => {
  let container: HTMLDivElement;
  let root: Root;
  let observed: StudioAgentDocumentAnalysisMap;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    observed = new Map();
    setVisibility("visible");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function Probe({
    readStatus,
  }: {
    readStatus: (attachmentId: string, signal: AbortSignal) => Promise<AgentAttachmentSummary>;
  }) {
    observed = useStudioAgentDocumentAnalysis({
      attachmentIds: [ATTACHMENT_ID],
      readStatus,
    });
    return null;
  }

  async function mount(
    readStatus: (attachmentId: string, signal: AbortSignal) => Promise<AgentAttachmentSummary>
  ) {
    await act(async () => {
      root.render(<Probe readStatus={readStatus} />);
    });
  }

  it("reconciles a durable analysis until it settles, then stops asking", async () => {
    const readStatus = vi
      .fn<(attachmentId: string, signal: AbortSignal) => Promise<AgentAttachmentSummary>>()
      .mockResolvedValueOnce(
        summary({ status: "running", stage: "mapping", completedUnits: 6, progress: 13 })
      )
      .mockResolvedValue(
        summary({ status: "succeeded", stage: "completed", completedUnits: 46, progress: 100 })
      );

    await mount(readStatus);

    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(observed.get(ATTACHMENT_ID)).toMatchObject({ phase: "mapping", progress: 13 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(observed.get(ATTACHMENT_ID)).toMatchObject({ phase: "succeeded", settled: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(readStatus).toHaveBeenCalledTimes(2);
  });

  it("surfaces the failure the job actually recorded", async () => {
    const error = {
      code: "AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID",
      message: "FizzDragon could not complete the source document analysis. Please retry.",
      retryable: true,
    };
    const readStatus = vi
      .fn<(attachmentId: string, signal: AbortSignal) => Promise<AgentAttachmentSummary>>()
      .mockResolvedValue(
        summary({ status: "failed", stage: "failed", completedUnits: 6, progress: 13, error })
      );

    await mount(readStatus);

    expect(observed.get(ATTACHMENT_ID)).toMatchObject({ phase: "failed", error });
  });

  it("holds a transient read failure as unchanged progress and reconciles again", async () => {
    const readStatus = vi
      .fn<(attachmentId: string, signal: AbortSignal) => Promise<AgentAttachmentSummary>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(
        summary({ status: "reducing", stage: "reducing_level_1", completedUnits: 40, progress: 86 })
      );

    await mount(readStatus);

    expect(observed.get(ATTACHMENT_ID)).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(observed.get(ATTACHMENT_ID)).toMatchObject({ phase: "reducing", progress: 86 });
  });

  it("generates no traffic for a job a hidden tab cannot show, and catches up on return", async () => {
    const readStatus = vi
      .fn<(attachmentId: string, signal: AbortSignal) => Promise<AgentAttachmentSummary>>()
      .mockResolvedValue(
        summary({ status: "running", stage: "mapping", completedUnits: 6, progress: 13 })
      );
    setVisibility("hidden");

    await mount(readStatus);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(readStatus).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(readStatus).toHaveBeenCalledTimes(2);
  });
});

function summary(
  analysis: Partial<NonNullable<AgentAttachmentSummary["analysis"]>>
): AgentAttachmentSummary {
  return {
    schemaVersion: "agent-attachment/v1",
    id: ATTACHMENT_ID,
    conversationId: "00000000-0000-4000-8000-0000000000c1",
    mediaAssetId: "00000000-0000-4000-8000-0000000000d1",
    fileName: "screenplay-test.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: "159744",
    // The attachment is ready the moment its text is extracted — the analysis
    // behind it is what these tests are about.
    status: "ready",
    uri: `fizzdragon-media://agent-attachment/${ATTACHMENT_ID}`,
    ingest: null,
    analysis: {
      jobId: JOB_ID,
      status: "running",
      stage: "mapping",
      completedUnits: 0,
      totalUnits: 46,
      progress: 0,
      finalArtifactId: null,
      error: null,
      ...analysis,
    },
    error: null,
  };
}

function message(
  id: string,
  attachments: ReadonlyArray<{ attachmentId: string; mediaType: string }>
): StudioAgentUIMessage {
  return {
    id,
    role: "user",
    parts: attachments.map((attachment) =>
      studioAgentAttachmentPart({
        type: "attachment",
        attachmentId: attachment.attachmentId,
        fileName: `${attachment.attachmentId}.bin`,
        mediaType: attachment.mediaType,
        sizeBytes: 1_024,
        status: "ready",
      })
    ),
  };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}
