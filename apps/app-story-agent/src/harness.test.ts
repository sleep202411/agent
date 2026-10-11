import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { plan } from "./harness.js";
import { readConfig } from "./config.js";
import { ProductionPlanSchema, StartStoryRunSchema } from "@repo/app-story-protocol";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const decision = {
  kind: "production",
  goal: "video",
  firstStage: "script",
  title: "Beijing",
  summary: "A Beijing video.",
  brief: "A short linear Beijing video with no choices.",
  profile: {
    frameProfile: "portrait_9_16",
    durationPreset: "short_5_15",
    visualStyle: "cinematic-realism",
  },
};
async function provider(mode: "production" | "reply" | "invalid" | "pending") {
  let requests = 0;
  const tools: string[][] = [];
  const systemPrompts: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    systemPrompts.push(
      (body.messages ?? [])
        .filter((message: { role: string }) => message.role === "system")
        .map((message: { content: string }) => message.content)
        .join("\n")
    );
    tools.push(
      (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name)
    );
    for (const tool of body.tools ?? []) expect(tool.function.parameters.type).toBe("object");
    requests++;
    if (mode === "pending") return;
    const toolStep = mode === "reply" ? (requests === 2 ? 1 : requests === 4 ? 2 : 0) : requests;
    const call =
      ["production", "reply"].includes(mode) && toolStep > 0 && toolStep < 3
        ? {
            id: `call_${requests}`,
            type: "function",
            function: {
              name: toolStep === 1 ? "read_project" : "submit_decision",
              arguments: JSON.stringify(
                toolStep === 1
                  ? {}
                  : {
                      decision:
                        mode === "reply"
                          ? { kind: "reply", text: "Hello! What story would you like to create?" }
                          : decision,
                    }
              ),
            },
          }
        : null;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const id = `chatcmpl-${randomUUID()}`;
    for (const entry of [
      {
        delta: call
          ? { role: "assistant", tool_calls: [{ index: 0, ...call }] }
          : {
              role: "assistant",
              content:
                mode === "invalid"
                  ? "story_read"
                  : mode === "reply"
                    ? JSON.stringify({
                        decision: {
                          kind: "reply",
                          text: "Hello! What story would you like to create?",
                        },
                      })
                    : "Accepted.",
            },
        finish_reason: null,
      },
      { delta: {}, finish_reason: call ? "tool_calls" : "stop" },
    ])
      res.write(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, ...entry }] })}\n\n`
      );
    res.write(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage: { prompt_tokens: 240, completion_tokens: 20, total_tokens: 260, prompt_tokens_details: { cached_tokens: 60 } } })}\n\n`
    );
    res.end("data: [DONE]\n\n");
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as { port: number };
  return {
    tools,
    systemPrompts,
    config: readConfig({
      APP_STORY_AGENT_CONTEXT_WINDOW: "128000",
      APP_STORY_AGENT_MODEL: "fixture",
      APP_STORY_AGENT_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      APP_STORY_AGENT_API_KEY: "local-fixture-key",
      APP_STORY_AGENT_INTERNAL_TOKEN: "local-fixture-token-32-characters-long",
    }),
    count: () => requests,
  };
}
const request = {
  runId: randomUUID(),
  locale: "en-US" as const,
  message: "Create a Beijing video",
  context: { title: "Beijing" },
  history: [],
};

describe("App Harness boundaries", () => {
  it("rejects missing configuration and client model choices", () => {
    expect(() => readConfig({})).toThrow("APP_STORY_AGENT_BASE_URL");
    expect(
      StartStoryRunSchema.safeParse({
        submissionId: randomUUID(),
        chapterId: randomUUID(),
        message: "hello",
        authorizedPoints: 500,
        modelId: "chosen",
      }).success
    ).toBe(false);
    expect(
      ProductionPlanSchema.safeParse({
        ...decision,
        profile: { ...decision.profile, visualStyle: "unknown" },
      }).success
    ).toBe(false);
  });
  it("boots the official ACP runtime and submits an executable plan with only the two product tools", async () => {
    const fixture = await provider("production");
    const result = await plan(
      { ...request, context: { ...request.context, privateReference: "private-source-marker" } },
      fixture.config,
      new AbortController().signal
    );
    expect(result.decision).toEqual(decision);
    expect(result.events.some((event) => event.type === "tool/call")).toBe(true);
    expect(result.events.some((event) => event.type === "assistant/message")).toBe(true);
    const projections = result.events.find((event) => event.type === "fizz/projections")
      ?.data as Record<string, unknown>;
    expect(projections.contextPressure).toMatchObject({ contextWindow: 128000 });
    expect(projections.tokenUsage).toMatchObject({ outputTokens: 40, cacheReadTokens: 120 });
    expect(JSON.stringify(result.events)).not.toContain("private-source-marker");
    expect(JSON.stringify(result.events)).not.toContain("local-fixture-key");
    expect(fixture.count()).toBe(2);
    for (const tools of fixture.tools)
      expect(tools.sort()).toEqual(["read_project", "submit_decision"]);
    expect(fixture.systemPrompts[0]).toContain("Only the latest user message can authorize");
  }, 30000);
  it("corrects JSON printed as assistant text before and after reading and finishes only on the native decision call", async () => {
    const fixture = await provider("reply");
    expect(
      (await plan({ ...request, message: "Hello" }, fixture.config, new AbortController().signal))
        .decision
    ).toEqual({ kind: "reply", text: "Hello! What story would you like to create?" });
    expect(fixture.count()).toBe(4);
  }, 30000);
  it("does not treat a bare tool name as an executed production", async () => {
    const fixture = await provider("invalid");
    await expect(plan(request, fixture.config, new AbortController().signal)).rejects.toThrow(
      "executable decision"
    );
    expect(fixture.count()).toBe(3);
  }, 30000);
  it("cancels a stalled provider and reaps the official process", async () => {
    const fixture = await provider("pending");
    const controller = new AbortController();
    const result = plan(request, fixture.config, controller.signal);
    const start = Date.now();
    while (!fixture.count() && Date.now() - start < 10000)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fixture.count()).toBe(1);
    controller.abort(new Error("Stopped by fixture"));
    await expect(result).rejects.toThrow("Stopped by fixture");
  }, 30000);
  it("reports exhausted worker capacity without starting another model turn", async () => {
    const fixture = await provider("pending");
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as { port: number };
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("./main.ts", import.meta.url))],
      {
        env: {
          ...process.env,
          APP_STORY_AGENT_PORT: String(port),
          APP_STORY_AGENT_BIND_ADDRESS: "127.0.0.1",
          APP_STORY_AGENT_BASE_URL: fixture.config.baseUrl,
          APP_STORY_AGENT_MODEL: fixture.config.model,
          APP_STORY_AGENT_CONTEXT_WINDOW: String(fixture.config.contextWindow),
          APP_STORY_AGENT_API_KEY: fixture.config.apiKey,
          APP_STORY_AGENT_INTERNAL_TOKEN: fixture.config.token,
        },
        stdio: "ignore",
      }
    );
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const controller = new AbortController();
    const pending: Array<Promise<Response | null>> = [];
    const base = `http://127.0.0.1:${port}`;
    const submit = (signal: AbortSignal) =>
      fetch(`${base}/v1/plan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-app-story-agent-token": fixture.config.token,
        },
        body: JSON.stringify({ ...request, runId: randomUUID() }),
        signal,
      });
    try {
      await vi.waitFor(
        async () => {
          expect((await fetch(`${base}/health`)).ok).toBe(true);
        },
        { timeout: 10000, interval: 25 }
      );
      for (let index = 0; index < 3; index++)
        pending.push(submit(controller.signal).catch(() => null));
      await vi.waitFor(() => expect(fixture.count()).toBe(3), { timeout: 10000, interval: 25 });
      const busy = await submit(AbortSignal.timeout(5000));
      expect(busy.status).toBe(503);
      expect(busy.headers.get("retry-after")).toBe("5");
      expect(await busy.json()).toMatchObject({ code: "APP_STORY_PLANNER_BUSY" });
      expect(fixture.count()).toBe(3);
    } finally {
      controller.abort();
      await Promise.all(pending);
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(killTimer);
    }
  }, 30000);
});
