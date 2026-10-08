import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import type { AppearanceDesignRequest } from "@repo/game-agent-protocol";
import { createGameAgentHttpServer } from "../http/server.js";
import {
  closeAppearanceWebSessions,
  openAppearanceWeb,
  pollAppearanceWeb,
  closeAppearanceWeb,
  AppearanceWebSessionNotFound,
} from "./web.js";

const root = await realpath(await mkdtemp(join(tmpdir(), "game-agent-hosted-test-")));
const scope = { userId: "owner-one", projectId: randomUUID() };
const input = {
  scope,
  key: randomUUID(),
  leaseId: randomUUID(),
  draft: "My unsent draft",
  parentOrigin: "http://127.0.0.1:9655",
  copy: { working: "Working", workingFor: "Working for {duration}" },
  request: {
    requestId: randomUUID(),
    prompt: "Customize project menu",
    locale: "en-US",
    appearance: { version: 1 },
    context: { title: "Existing film", choiceLabels: [] },
    history: [],
  } as AppearanceDesignRequest,
};
vi.stubEnv("GAME_AGENT_WORKSPACE_ROOT", root);
vi.stubEnv("GAME_AGENT_PORT", "9656");
vi.stubEnv("GAME_AGENT_INTERNAL_TOKEN", "isolated-test-worker-token");
vi.stubEnv("GAME_AGENT_MODEL", "fixture-model");
vi.stubEnv("GAME_AGENT_OPENAI_BASE_URL", "http://127.0.0.1:1/v1");
vi.stubEnv("GAME_AGENT_OPENAI_API_KEY", "isolated-test-no-provider");
const worker = createGameAgentHttpServer("isolated-test-worker-token");
await new Promise<void>((resolve, reject) => {
  worker.once("error", reject);
  worker.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${(worker.address() as AddressInfo).port}`;
const headers = (actor = scope) => ({
  "x-game-agent-internal-token": "isolated-test-worker-token",
  "x-game-agent-scope": Buffer.from(JSON.stringify(actor)).toString("base64url"),
});
afterAll(async () => {
  await closeAppearanceWebSessions();
  worker.closeAllConnections();
  await new Promise<void>((resolve) => worker.close(() => resolve()));
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("runs the actual official Web host behind scoped transport and recovers its candidate and identity", async () => {
  const first = await openAppearanceWeb(input);
  expect(first.url).toBe("/");
  const mount = `${origin}/v1/game-agent/appearance/web/${first.id}/proxy/`;
  const page = await fetch(mount, { headers: headers() });
  expect(page.status).toBe(200);
  expect(page.headers.get("set-cookie")).toBeNull();
  const html = await page.text();
  expect(html).not.toContain("isolated-test-no-provider");
  expect(html).not.toContain("?token=");
  const boot = JSON.parse(/window\.__FIZZ_APPEARANCE__=(.+?)<\/script>/.exec(html)![1]!);
  const rpc = async (method: string, request: unknown) => {
    const response = await fetch(`${mount}api/${method}`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: randomUUID(),
        method,
        payload: { args: { request } },
      }),
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  const workspace = await rpc("workspace/create", { path: boot.cwd });
  const workspaceId = workspace.result.value.workspace.workspaceId;
  const session = await rpc("session/create", { workspaceId, sessionId: boot.sessionId });
  expect(session.result.ok).toBe(true);
  const denied = await fetch(mount, { headers: headers({ ...scope, userId: "other-owner" }) });
  expect(denied.status).toBe(404);
  await expect(
    pollAppearanceWeb(first.id, { ...scope, projectId: randomUUID() })
  ).rejects.toBeInstanceOf(AppearanceWebSessionNotFound);
  const candidate = {
    requestId: first.requestId,
    appearance: { version: 1, presentation: { copy: { start: { "en-US": "Enter story" } } } },
    message: "Candidate survives reconnect",
  };
  await writeFile(`${boot.cwd}/result.json`, JSON.stringify(candidate));
  expect((await pollAppearanceWeb(first.id, scope)).result?.message).toBe(candidate.message);
  expect(await closeAppearanceWeb(first.id, randomUUID(), scope)).toEqual({ closed: false });
  expect(await closeAppearanceWeb(first.id, first.leaseId, scope)).toEqual({ closed: true });
  expect(await readFile(`${boot.cwd}/result.json`, "utf8")).toContain(candidate.message);
  const restored = await openAppearanceWeb({
    ...input,
    leaseId: randomUUID(),
    request: { ...input.request, requestId: randomUUID() },
  });
  expect(restored.id).toBe(first.id);
  expect(restored.requestId).toBe(first.requestId);
  expect((await pollAppearanceWeb(restored.id, scope)).result?.message).toBe(candidate.message);
  const reopened = await fetch(mount, { headers: headers() });
  expect(await reopened.text()).toContain(boot.sessionId);
}, 45_000);
