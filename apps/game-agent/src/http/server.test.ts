import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { createGameAgentHttpServer } from "./server.js";

const token = "test-independent-secret";

async function dispatch(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  throws = false
) {
  let status = 0;
  let content: unknown;
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const response = Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
    writeHead(value: number) {
      status = value;
      this.headersSent = true;
      return this;
    },
    end(value?: string) {
      this.writableEnded = true;
      content = value;
      finish();
      return this;
    },
  }) as unknown as ServerResponse;
  const handler = vi.fn(async (_req: IncomingMessage, res: ServerResponse) => {
    if (throws) throw new Error("sensitive-provider-data");
    res.writeHead(200).end("handled");
  });
  const server = createGameAgentHttpServer(token, { design: handler, web: handler });
  server.emit("request", { method, url, headers }, response);
  await completed;
  return { status, content, handler };
}

it("reports independent service health without exposing credentials", async () => {
  const result = await dispatch("GET", "/health");
  expect(result.status).toBe(200);
  expect(JSON.parse(String(result.content))).toMatchObject({
    service: "game-agent",
    runtime: "deepseek-harness",
  });
  expect(result.content).not.toContain(token);
  expect(result.handler).not.toHaveBeenCalled();
});

it("rejects Agent OS credentials and wrong-length tokens", async () => {
  const attempts: Record<string, string>[] = [
    { "x-agent-os-internal-token": token },
    { "x-game-agent-internal-token": "short" },
  ];
  for (const headers of attempts) {
    const result = await dispatch("POST", "/v1/game-agent/appearance/design", headers);
    expect(result.status).toBe(401);
    expect(result.handler).not.toHaveBeenCalled();
  }
});

it("serves only its independent versioned endpoints", async () => {
  const headers = { "x-game-agent-internal-token": token };
  for (const path of ["/v1/game-agent/appearance/design", "/v1/game-agent/appearance/web"]) {
    const result = await dispatch("POST", path, headers);
    expect(result.status).toBe(200);
    expect(result.handler).toHaveBeenCalledOnce();
  }
  expect((await dispatch("POST", "/v1/agent-os/appearance/design", headers)).status).toBe(404);
});

it("contains unexpected handler errors without exposing their diagnostics", async () => {
  const result = await dispatch(
    "POST",
    "/v1/game-agent/appearance/design",
    { "x-game-agent-internal-token": token },
    true
  );
  expect(result.status).toBe(500);
  expect(result.content).not.toContain("sensitive-provider-data");
});
