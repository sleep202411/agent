import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiteLlmChatModel, IncompleteModelStreamError } from "./create-model.js";

afterEach(() => vi.unstubAllGlobals());

function modelResponse(finishReason?: string) {
  const chunk = (delta: unknown, reason: string | null) => ({
    id: "completion-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "qwen3.7-plus",
    choices: [{ index: 0, delta, finish_reason: reason }],
  });
  const chunks = [chunk({ role: "assistant", content: "I will read the script and" }, null)];
  if (finishReason) chunks.push(chunk({}, finishReason));
  return new Response(
    chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n",
    {
      headers: { "content-type": "text/event-stream" },
    }
  );
}

function model() {
  return createLiteLlmChatModel({
    profileId: "qwen3.7-plus",
    config: { baseUrl: "http://model.test/v1", apiKey: "test-only" },
  });
}

describe("model stream completion", () => {
  it("rejects an EOF without a provider finish reason instead of returning a partial answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(modelResponse()))
    );
    await expect(model().invoke("Read this script")).rejects.toBeInstanceOf(
      IncompleteModelStreamError
    );
  });

  it("retains the provider finish reason for a normally completed stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(modelResponse("stop")))
    );
    const result = await model().invoke("Read this script");
    expect(result.response_metadata.finish_reason).toBe("stop");
  });

  it.each(["length", "content_filter"])(
    "does not report %s as successful completion",
    async (reason) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => Promise.resolve(modelResponse(reason)))
      );
      await expect(model().invoke("Read this script")).rejects.toThrow();
    }
  );
});

describe("mobile speed profile", () => {
  it("sends Flash with thinking disabled to the provider", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(modelResponse("stop")));
    vi.stubGlobal("fetch", fetchMock);
    await createLiteLlmChatModel({
      profileId: "qwen3.7-flash",
      config: { baseUrl: "http://model.test/v1", apiKey: "test-only" },
    }).invoke("Continue");
    const [request, init] = fetchMock.mock.calls[0]!;
    const body = request instanceof Request ? await request.text() : init.body;
    expect(JSON.parse(body)).toMatchObject({ model: "qwen3.7-flash", enable_thinking: false });
  });
});
