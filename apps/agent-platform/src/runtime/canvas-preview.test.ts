import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";

import { canvasPreviewChunkForToolCall, withCanvasPreview } from "./canvas-preview.js";

const previewInput = {
  runId: "0197f4a2-0800-7000-8000-000000000010",
  toolCallId: "call-write",
  toolName: "story_apply_change_set",
  args: {
    schemaVersion: "story-apply/v1",
    changeSet: {
      schemaVersion: "story-change-set/v2",
      chapterId: "0197f4a2-0800-7000-8000-000000000011",
      baseDraftRevision: 7,
      baseContentHash: "a".repeat(64),
      baseLayoutRevision: 4,
      title: "Add an arrival",
      summary: "Adds one opening scene.",
      operations: [
        {
          kind: "story_graph.put_node",
          payload: {
            intent: "create",
            node: {
              kind: "clip",
              nodeId: "xinyi_arrival",
              clipKey: "XINYI_ARRIVAL",
              description: "心怡抵达。",
              exit: { kind: "auto", nextNodeId: null },
            },
          },
        },
      ],
    },
  },
};

describe("canvasPreviewChunkForToolCall", () => {
  it("emits a transient, deterministic projection before canonical apply", () => {
    const first = canvasPreviewChunkForToolCall(previewInput);
    const second = canvasPreviewChunkForToolCall(previewInput);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      type: "data-studio-agent-canvas-preview",
      id: "canvas-preview:call-write",
      transient: true,
      data: {
        schemaVersion: "story-canvas-preview/v1",
        runId: previewInput.runId,
        toolCallId: previewInput.toolCallId,
        operations: [
          {
            kind: "story_graph.put_node",
            payload: previewInput.args.changeSet.operations[0]!.payload,
          },
        ],
      },
    });
    expect(first?.data.operations[0]?.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  });

  it("does not emit a preview for an invalid or unrelated tool call", () => {
    expect(
      canvasPreviewChunkForToolCall({
        runId: "0197f4a2-0800-7000-8000-000000000010",
        toolCallId: "call-read",
        toolName: "story_get_snapshot",
        args: {},
      })
    ).toBeNull();
    expect(
      canvasPreviewChunkForToolCall({
        runId: "0197f4a2-0800-7000-8000-000000000010",
        toolCallId: "call-write",
        toolName: "story_apply_change_set",
        args: { schemaVersion: "story-apply/v1", changeSet: { operations: [] } },
      })
    ).toBeNull();
  });

  it("keeps the tool call ordered before a non-persistent preview on the product stream", async () => {
    const sourceChunk: UIMessageChunk = {
      type: "tool-input-available",
      toolCallId: previewInput.toolCallId,
      toolName: previewInput.toolName,
      input: previewInput.args,
    };
    const source = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue(sourceChunk);
        controller.close();
      },
    });

    const output: UIMessageChunk[] = [];
    for await (const chunk of withCanvasPreview(source, previewInput.runId)) {
      output.push(chunk);
    }

    expect(output).toHaveLength(2);
    expect(output[0]).toBe(sourceChunk);
    expect(output[1]).toMatchObject({
      type: "data-studio-agent-canvas-preview",
      id: `canvas-preview:${previewInput.toolCallId}`,
      transient: true,
      data: {
        runId: previewInput.runId,
        toolCallId: previewInput.toolCallId,
      },
    });
  });
});
