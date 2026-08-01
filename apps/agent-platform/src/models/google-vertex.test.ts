import { MessageList } from "@mastra/core/agent";
import { describe, expect, it } from "vitest";

import {
  assertGoogleVertexAuthenticationReady,
  createGoogleVertexModels,
} from "./google-vertex.js";

const config = {
  provider: "google-vertex" as const,
  project: "glass-proxy-501907-d2",
  location: "global",
  interactiveModelId: "gemini-2.5-flash",
  reasoningModelId: "gemini-2.5-pro",
  observerModelId: "gemini-2.5-flash",
};

const ATTACHMENT_URI = "fizzdragon-media://0197f4a2-0800-7000-8000-000000000009";

async function assembleModelPrompt(model: { supportedUrls: unknown }) {
  const messages = new MessageList({ threadId: "thread-1", resourceId: "resource-1" });
  messages.add(
    [
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "Break this screenplay down." },
          {
            type: "file",
            url: ATTACHMENT_URI,
            mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
        ],
      } as never,
    ],
    "input"
  );
  return messages.get.all.aiV5.llmPrompt({
    supportedUrls: await model.supportedUrls,
    downloadRetries: 0,
    downloadConcurrency: 1,
  } as never);
}

describe("Google Vertex model boundary", () => {
  it("constructs AI SDK v6-compatible Vertex models without a model-router string", () => {
    const models = createGoogleVertexModels(config);

    expect(models.interactive).toMatchObject({
      specificationVersion: "v3",
      provider: "google.vertex.chat",
      modelId: "gemini-2.5-flash",
    });
    expect(models.reasoning).toMatchObject({
      specificationVersion: "v3",
      provider: "google.vertex.chat",
      modelId: "gemini-2.5-pro",
    });
    expect(models.observer).toMatchObject({
      specificationVersion: "v3",
      provider: "google.vertex.chat",
      modelId: "gemini-2.5-flash",
    });
  });

  it("leaves a FizzDragon attachment reference for the attachment processor to resolve", async () => {
    // Mastra assembles the provider prompt — downloading every file part whose
    // data parses as a URL — before input processors run, so a model that does
    // not declare this scheme makes the assembler fetch the product reference
    // itself and fail the whole turn.
    const models = createGoogleVertexModels(config);

    for (const model of [models.interactive, models.reasoning, models.observer]) {
      const prompt = await assembleModelPrompt(model);
      const filePart = (prompt[0] as { content: Array<{ type: string; data?: unknown }> })
        .content[1];

      expect(filePart?.type).toBe("file");
      expect(String(filePart?.data)).toBe(ATTACHMENT_URI);
    }
  });

  it("keeps the provider's own natively fetchable URL schemes", async () => {
    const supportedUrls = await createGoogleVertexModels(config).interactive.supportedUrls;

    expect(
      Object.values(supportedUrls)
        .flat()
        .some((pattern) => pattern.test("https://media.example.com/reference.png"))
    ).toBe(true);
    expect(
      Object.values(supportedUrls)
        .flat()
        .some((pattern) => pattern.test("gs://bucket/reference.png"))
    ).toBe(true);
  });

  it("accepts ADC only when it can issue a non-empty access token", async () => {
    await expect(
      assertGoogleVertexAuthenticationReady(config, {
        getClient: async () => ({
          getAccessToken: async () => ({ token: "short-lived-token" }),
        }),
      })
    ).resolves.toBeUndefined();

    await expect(
      assertGoogleVertexAuthenticationReady(config, {
        getClient: async () => ({
          getAccessToken: async () => ({ token: null }),
        }),
      })
    ).rejects.toThrow(/ADC authentication failed/);
  });

  it("does not expose raw authentication errors", async () => {
    const attempt = assertGoogleVertexAuthenticationReady(config, {
      getClient: async () => {
        throw new Error("sensitive-upstream-detail");
      },
    });

    await expect(attempt).rejects.toThrow(/configure Application Default Credentials/);
    await expect(attempt).rejects.not.toThrow(/sensitive-upstream-detail/);
  });
});
