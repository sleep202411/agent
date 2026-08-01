import { ReadableStream } from "node:stream/web";

import type { ChunkType } from "@mastra/core/stream";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { projectProductUiMessages, stripMastraInternalUiEvents } from "./product-ui-message.js";

describe("Agent Platform product UI projection", () => {
  it("removes every Mastra Observational Memory part while preserving product parts", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "data-om-status", data: { recordId: "memory-1" } },
          { type: "text", text: "The durable answer." },
          {
            type: "data-studio-agent-activity",
            data: { activityId: "activity-1" },
          },
          { type: "data-om-buffering-end", data: { cycleId: "cycle-1" } },
        ],
      },
    ] as unknown as UIMessage[];

    expect(projectProductUiMessages(messages)).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "The durable answer." },
          {
            type: "data-studio-agent-activity",
            data: { activityId: "activity-1" },
          },
        ],
      },
    ]);
  });

  it("does not expose framework-only messages as empty product messages", () => {
    const messages = [
      {
        id: "assistant-internal-only",
        role: "assistant",
        parts: [{ type: "data-om-status", data: { recordId: "memory-1" } }],
      },
    ] as unknown as UIMessage[];

    expect(projectProductUiMessages(messages)).toEqual([]);
  });

  it("removes Mastra-owned metadata while preserving product and provider metadata", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        metadata: {
          runId: "run-1",
          provider: "google",
          mastra: { responseBoundary: true },
        },
        parts: [{ type: "text", text: "Product answer." }],
      },
    ] as unknown as UIMessage[];

    expect(projectProductUiMessages(messages)).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        metadata: {
          runId: "run-1",
          provider: "google",
        },
        parts: [{ type: "text", text: "Product answer." }],
      },
    ]);
  });

  it("removes Mastra memory events from the realtime stream", async () => {
    const chunks = [
      { type: "start", payload: {} },
      { type: "data-om-status", payload: { recordId: "memory-1" } },
      { type: "text-delta", payload: { id: "text-1", text: "Hello" } },
      { type: "data-om-activation", payload: { cycleId: "cycle-1" } },
      { type: "finish", payload: {} },
    ] as unknown as ChunkType<undefined>[];
    const readable = new ReadableStream<ChunkType<undefined>>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });

    const projected: ChunkType<undefined>[] = [];
    for await (const chunk of readable.pipeThrough(stripMastraInternalUiEvents())) {
      projected.push(chunk);
    }

    expect(projected.map((chunk) => chunk.type)).toEqual(["start", "text-delta", "finish"]);
  });
});
