import { Agent } from "@mastra/core/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createGoogleVertexModels } from "../models/google-vertex.js";
import { createLongDocumentAnalystAgent } from "./long-document-analyst.js";

const vertex = createGoogleVertexModels({
  provider: "google-vertex",
  project: "glass-proxy-501907-d2",
  location: "global",
  interactiveModelId: "gemini-2.5-flash",
  reasoningModelId: "gemini-2.5-pro",
  observerModelId: "gemini-2.5-flash",
});
const models = { extraction: vertex.interactive, synthesis: vertex.reasoning };
const schema = z.object({ chunkId: z.string() }).strict();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("long document analyst", () => {
  it("caps the thinking budget the caller pays for out of its output budget", async () => {
    const generate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValue({ object: { chunkId: "chunk-000005" } } as never);

    await createLongDocumentAnalystAgent(models).generateStructured({
      stage: "extract",
      prompt: "Analyze this bounded source section.",
      schema,
      maxOutputTokens: 8_192,
      thinkingBudgetTokens: 128,
      signal: new AbortController().signal,
    });

    // Gemini 2.5 draws thinking out of maxOutputTokens, so an unbounded budget
    // silently competes with the JSON body the checkpoint is made of.
    expect(generate).toHaveBeenCalledWith(
      "Analyze this bounded source section.",
      expect.objectContaining({
        providerOptions: { google: { thinkingConfig: { thinkingBudget: 128 } } },
        modelSettings: expect.objectContaining({ maxOutputTokens: 8_192, temperature: 0 }),
      })
    );
  });

  it("holds the model to the caller's schema even when Mastra hands back a looser object", async () => {
    vi.spyOn(Agent.prototype, "generate").mockResolvedValue({
      object: { chunkId: "chunk-000005", stowaway: true },
    } as never);

    await expect(
      createLongDocumentAnalystAgent(models).generateStructured({
        stage: "extract",
        prompt: "Analyze this bounded source section.",
        schema,
        maxOutputTokens: 8_192,
        thinkingBudgetTokens: 128,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow();
  });

  // Extraction reads one bounded section and lists what is in it; synthesis
  // merges checkpoints it can no longer re-read. Routing both to one tier is
  // what made every mapped section pay the reasoning tier's generation rate.
  it("routes each stage to its own model", async () => {
    const modelIds: string[] = [];
    vi.spyOn(Agent.prototype, "generate").mockImplementation(async function (this: Agent) {
      modelIds.push((await this.getModel()).modelId);
      return { object: { chunkId: "chunk-000005" } } as never;
    });
    const analyst = createLongDocumentAnalystAgent(models);
    const request = {
      prompt: "Analyze this bounded source section.",
      schema,
      maxOutputTokens: 8_192,
      thinkingBudgetTokens: 128,
      signal: new AbortController().signal,
    };

    await analyst.generateStructured({ ...request, stage: "extract" });
    await analyst.generateStructured({ ...request, stage: "synthesize" });

    expect(modelIds).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
  });
});
