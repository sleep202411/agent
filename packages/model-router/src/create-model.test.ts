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

function toolResponse(deltas: unknown[], finishReason = "stop") {
  const chunks = [
    ...deltas.map((delta) => ({ delta, finish_reason: null })),
    { delta: {}, finish_reason: finishReason },
  ];
  return new Response(
    chunks
      .map(
        (choice) =>
          `data: ${JSON.stringify({
            id: "completion-test",
            object: "chat.completion.chunk",
            created: 1,
            model: "qwen3.7-plus",
            choices: [{ index: 0, ...choice }],
          })}\n\n`
      )
      .join("") + "data: [DONE]\n\n",
    {
      headers: { "content-type": "text/event-stream" },
    }
  );
}

const storyRead = {
  type: "function" as const,
  function: {
    name: "story_read",
    description: "Read the current story",
    parameters: { type: "object" },
  },
};

describe("model tool response validation", () => {
  it("rejects a fragmented bare tool name without exposing it as assistant text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        toolResponse([{ role: "assistant", content: "story_" }, { content: "read" }])
      )
    );
    const emitted: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of await model().bindTools([storyRead]).stream("Read the story")) {
          if (typeof chunk.content === "string") emitted.push(chunk.content);
        }
      })()
    ).rejects.toMatchObject({ code: "MODEL_TOOL_CALL_INVALID" });
    expect(emitted.join("")).toBe("");
  });

  it("preserves ordinary prose that mentions a tool", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        toolResponse([
          { role: "assistant", content: "story_" },
          { content: "read reads the current story." },
        ])
      )
    );
    expect((await model().bindTools([storyRead]).invoke("Explain the tool")).content).toBe(
      "story_read reads the current story."
    );
  });

  it.each([
    { suffix: "}", valid: true },
    { suffix: "broken", valid: false },
    { suffix: '\"partial\":', valid: false },
  ])("validates fragmented tool arguments (suffix=$suffix)", async ({ suffix, valid }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        toolResponse(
          [
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "read-once",
                  type: "function",
                  function: { name: "story_read", arguments: "{" },
                },
              ],
            },
            { tool_calls: [{ index: 0, function: { arguments: suffix } }] },
          ],
          "tool_calls"
        )
      )
    );
    const response = model().bindTools([storyRead]).invoke("Read the story");
    if (valid)
      expect((await response).tool_calls).toEqual([
        expect.objectContaining({ name: "story_read", args: {}, id: "read-once" }),
      ]);
    else await expect(response).rejects.toMatchObject({ code: "MODEL_TOOL_CALL_INVALID" });
  });

  it.each(["", "story_read"])(
    "rejects a tool-call finish without a real call (%s)",
    async (content) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => toolResponse([{ role: "assistant", content }], "tool_calls"))
      );
      await expect(model().bindTools([storyRead]).invoke("Read the story")).rejects.toMatchObject({
        code: "MODEL_TOOL_CALL_INVALID",
      });
    }
  );

  it.each(["not_mounted", "story_read"])(
    "rejects an unknown tool or non-object arguments (%s)",
    async (name) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          toolResponse(
            [
              {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "invalid-call",
                    type: "function",
                    function: { name, arguments: name === "story_read" ? "[]" : "{}" },
                  },
                ],
              },
            ],
            "tool_calls"
          )
        )
      );
      await expect(model().bindTools([storyRead]).invoke("Read the story")).rejects.toMatchObject({
        code: "MODEL_TOOL_CALL_INVALID",
      });
    }
  );
});

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
