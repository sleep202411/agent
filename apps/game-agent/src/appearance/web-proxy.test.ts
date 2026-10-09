import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, expect, it } from "vitest";
import {
  closeAppearanceWebProxy,
  initializeAppearanceWebProxy,
  proxyAppearanceWebHttp,
  upgradeAppearanceWeb,
  type AppearanceWebProxyContext,
} from "./web-proxy.js";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(dispose.splice(0).map((close) => close()));
});
const origin = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const listen = (server: Server) =>
  new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

async function fixture(existingHistory: string[] = []) {
  const seen: Array<{
    path: string;
    cookie?: string;
    origin?: string;
    authorization?: string;
    body?: unknown;
  }> = [];
  const frames: unknown[] = [];
  const histories = new Map<string, string[]>(
    existingHistory.length ? [["session-owned", [...existingHistory]]] : []
  );
  let active = true;
  let startedRequests = 0;
  const requestWaiters = new Set<() => void>();
  const upstreamSockets = new Set<WebSocket>();
  const upstreamWs = new WebSocketServer({ noServer: true });
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    seen.push({
      path: req.url!,
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      authorization: req.headers.authorization,
      body,
    });
    if (req.url === "/?token=private-launch-token") {
      res
        .writeHead(303, {
          location: "./",
          "set-cookie": "dsh-auth-test=v1.private.signature; HttpOnly; SameSite=Strict; Path=/",
        })
        .end();
      return;
    }
    if (req.headers.cookie !== "dsh-auth-test=v1.private.signature") {
      res.writeHead(401).end("No internal cookie");
      return;
    }
    if (req.url === "/api/workspace/create") {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value: {
              workspace: { workspaceId: "workspace-owned", path: "/owned/workspace" },
              created: true,
            },
          },
        })
      );
      return;
    }
    if (req.url?.startsWith("/api/")) {
      if (req.url === "/api/session/create") {
        const id = body.payload.args.request.sessionId;
        if (!histories.has(id)) histories.set(id, []);
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          type: "server-response",
          rpcId: body.rpcId,
          result: {
            ok: true,
            value:
              req.url === "/api/session/create"
                ? { sessionId: body.payload.args.request.sessionId, agentPreset: "appearance" }
                : { accepted: true },
          },
        })
      );
      return;
    }
    if (req.url === "/assets/pending.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      res.write("/* pending asset */");
      return;
    }
    res
      .writeHead(200, {
        "content-type": "text/html",
        "set-cookie": "evil=not-forwarded",
        location: "https://not-forwarded.invalid/",
      })
      .end('<base href="./"><script src="./assets/index-test.js"></script>');
  });
  upstream.on("upgrade", (req, socket, head) => {
    seen.push({
      path: req.url!,
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      authorization: req.headers.authorization,
    });
    upstreamWs.handleUpgrade(req, socket, head, (ws) => {
      upstreamSockets.add(ws);
      ws.on("close", () => upstreamSockets.delete(ws));
      ws.on("message", (data) => {
        const frame = JSON.parse(data.toString());
        frames.push(frame);
        if (frame.type === "open")
          ws.send(
            JSON.stringify({ type: "item", streamId: frame.streamId, value: { type: "ready" } })
          );
      });
    });
  });
  await listen(upstream);
  const context: AppearanceWebProxyContext = {
    url: `${origin(upstream)}/?token=private-launch-token`,
    root: "/owned/workspace",
    sessionId: "session-owned",
    isActive: () => active,
  };
  const proxy = createServer((req, res) => {
    void proxyAppearanceWebHttp(req, res, context);
    startedRequests++;
    for (const notify of requestWaiters) notify();
  });
  proxy.on("upgrade", (req, socket, head) => void upgradeAppearanceWeb(req, socket, head, context));
  await listen(proxy);
  dispose.push(async () => {
    closeAppearanceWebProxy(context);
    for (const ws of upstreamSockets) ws.terminate();
    upstreamWs.close();
    await Promise.all([close(proxy), close(upstream)]);
  });
  const rpc = (endpoint: string, args: unknown, extra?: Record<string, unknown>) =>
    fetch(`${origin(proxy)}/api/${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "fd-user-cookie=must-not-reach-child",
        authorization: "Bearer fd-token-must-not-reach-child",
      },
      body: JSON.stringify({
        type: "client-request",
        rpcId: "rpc-test",
        method: endpoint,
        payload: { args },
        ...extra,
      }),
    });
  const connect = async () => {
    const ws = new WebSocket(origin(proxy).replace("http:", "ws:") + "/api/remote.mux", {
      headers: { cookie: "fd-cookie=private", authorization: "Bearer fd-token" },
    });
    // Test cleanup must never leave a rejected socket's error unhandled.
    ws.on("error", () => undefined);
    await once(ws, "open");
    return ws;
  };
  return {
    seen,
    frames,
    histories,
    context,
    url: origin(proxy),
    rpc,
    connect,
    publish: (value: unknown) => {
      for (const ws of upstreamSockets) ws.send(JSON.stringify(value));
    },
    waitForRequests: (count: number) =>
      new Promise<void>((resolve) => {
        const notify = () => {
          if (startedRequests >= count) {
            requestWaiters.delete(notify);
            resolve();
          }
        };
        requestWaiters.add(notify);
        notify();
      }),
    deactivate: () => {
      active = false;
    },
  };
}

it("privately exchanges the launch URL once, strips browser credentials and keeps relative assets intact", async () => {
  const f = await fixture();
  const response = await fetch(f.url, {
    headers: {
      cookie: "fd=secret",
      authorization: "Bearer secret",
      origin: "https://fizzdragon.com",
    },
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('<base href="./">');
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await fetch(`${f.url}/assets/index-test.js`)).status).toBe(200);
  expect(f.seen.filter((request) => request.path.includes("token="))).toHaveLength(1);
  expect(f.seen.slice(1)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        cookie: "dsh-auth-test=v1.private.signature",
        authorization: undefined,
      }),
    ])
  );
  expect(f.seen.slice(1).every((request) => request.origin?.startsWith("http://127.0.0.1:"))).toBe(
    true
  );
});

it("permits the official registered plugin combo and chunk URLs", async () => {
  const f = await fixture();
  for (const path of [
    "/plugins/??@deepseek-ai/dsh-client-connection/client.js,@repo/appearance-harness-ui/client.js&rev=1234567890abcdef",
    "/plugins/@deepseek-ai/dsh-client-ui-chat/client-abc.js?rev=1234567890abcdef",
  ])
    expect((await fetch(f.url + path)).status).toBe(200);
});

it("restores a query-serialized plugin combo before forwarding it to Harness", async () => {
  const f = await fixture();
  const resource =
    "?@deepseek-ai/dsh-client-modules/client.js,@repo/appearance-harness-ui/client.js";
  const query = new URLSearchParams([
    [resource, ""],
    ["rev", "1234567890abcdef"],
  ]);
  expect((await fetch(`${f.url}/plugins/?${query}`)).status).toBe(200);
  expect(f.seen.at(-1)?.path).toBe(`/plugins/?${resource}&rev=1234567890abcdef`);
});

it.each([
  "?%3F%40deepseek-ai%2Fdsh-client-modules%2Fclient.js=extra&rev=1234567890abcdef",
  "?%3F%40deepseek-ai%2Fdsh-client-modules%2Fclient.js=&rev=1234567890abcdef&rev=1234567890abcdef",
  "?%3F%40unregistered%2Fclient.js=&rev=1234567890abcdef",
  "?%253F%2540deepseek-ai%252Fdsh-client-modules%252Fclient.js=&rev=1234567890abcdef",
])("rejects invalid serialized plugin query %s before reaching Harness", async (query) => {
  const f = await fixture();
  expect((await fetch(`${f.url}/plugins/${query}`)).status).toBe(404);
  expect(f.seen).toHaveLength(0);
});

it("initializes the admitted workspace and fixed session before serving the first index", async () => {
  const f = await fixture();
  await Promise.all([initializeAppearanceWebProxy(f.context), fetch(f.url)]);
  expect((await fetch(f.url)).status).toBe(200);
  const workspace = f.seen.findIndex(({ path }) => path === "/api/workspace/create");
  const session = f.seen.findIndex(({ path }) => path === "/api/session/create");
  const index = f.seen.findIndex(({ path }) => path === "/");
  expect(workspace).toBeGreaterThan(0);
  expect(session).toBeGreaterThan(workspace);
  expect(index).toBeGreaterThan(session);
  expect(f.seen.filter(({ path }) => path === "/api/session/create")).toHaveLength(1);
  expect(f.seen[session].body).toMatchObject({
    payload: {
      args: {
        request: {
          sessionId: f.context.sessionId,
          workspaceId: "workspace-owned",
          agentPreset: "appearance",
        },
      },
    },
  });
});

it("adopts the same existing session on a new admission without replacing its history", async () => {
  const f = await fixture(["Earlier project message"]);
  await initializeAppearanceWebProxy(f.context);
  closeAppearanceWebProxy(f.context);
  const restarted = { ...f.context };
  try {
    await initializeAppearanceWebProxy(restarted);
    expect([...f.histories.keys()]).toEqual([f.context.sessionId]);
    expect(f.histories.get(f.context.sessionId)).toEqual(["Earlier project message"]);
    expect(f.seen.filter(({ path }) => path.startsWith("/api/"))).toHaveLength(4);
    expect(f.seen.filter(({ path }) => path === "/api/session/create")).toHaveLength(2);
    expect(f.seen.filter(({ path }) => path === "/api/session/prompt")).toHaveLength(0);
  } finally {
    closeAppearanceWebProxy(restarted);
  }
});

it.each([
  "/api/file?path=/etc/passwd",
  "/api/upload?sessionId=session-owned",
  "/plugins/events",
  "/plugins/@untrusted/package/client.js?rev=1234567890abcdef",
  "/assets/index.js.map",
  "/?token=browser-token",
  "/assets/%2e%2e/secret.js",
  "/assets/a%2fb.js",
  "/assets/a\\b.js",
])("refuses unexpected paths without touching the child: %s", async (path) => {
  const f = await fixture();
  // fetch normalizes backslashes/dot traversal; the policy still must reject the resulting path.
  const response = await fetch(f.url + path);
  expect([403, 404]).toContain(response.status);
  expect(f.seen).toHaveLength(0);
});

it("pins workspace creation and subsequent session creation to the admitted root and identity", async () => {
  const f = await fixture();
  expect((await f.rpc("workspace/create", { request: { path: "/etc" } })).status).toBe(403);
  expect(
    (
      await f.rpc("session/create", {
        request: { sessionId: "session-owned", cwd: "/owned/workspace" },
      })
    ).status
  ).toBe(403);
  expect((await f.rpc("workspace/create", { request: { path: f.context.root } })).status).toBe(200);
  expect(
    (
      await f.rpc("workspace/rename", {
        request: { workspaceId: "workspace-owned", title: "My film" },
      })
    ).status
  ).toBe(200);
  expect(
    (
      await f.rpc("session/create", {
        request: { sessionId: f.context.sessionId, workspaceId: "workspace-owned" },
      })
    ).status
  ).toBe(200);
  for (const request of [
    { sessionId: "session-other", workspaceId: "workspace-owned" },
    { sessionId: f.context.sessionId, workspaceId: "workspace-other" },
    { sessionId: f.context.sessionId, workspaceId: "workspace-owned", agentPreset: "standard" },
    { sessionId: f.context.sessionId, workspaceId: "workspace-owned", cwd: "/etc" },
  ])
    expect((await f.rpc("session/create", { request })).status).toBe(403);
  expect(f.seen.filter((request) => request.path === "/api/session/create")).toHaveLength(1);
});

it("allows official text prompting, history and cancellation for only the admitted session", async () => {
  const f = await fixture();
  const request = {
    sessionId: f.context.sessionId,
    requestId: "message-owned",
    mode: "queue",
    content: [{ type: "text", text: "Center the menu" }],
    clientTimeZone: "Europe/London",
  };
  expect((await f.rpc("session/prompt", { request })).status).toBe(200);
  expect(
    (await f.rpc("session/cancel", { request: { sessionId: f.context.sessionId } })).status
  ).toBe(200);
  expect(
    (
      await f.rpc("session/page", {
        request: {
          address: { kind: "session", sessionId: f.context.sessionId },
          throughSeq: 50,
          maxMessages: 20,
        },
      })
    ).status
  ).toBe(200);
  expect(
    (await f.rpc("session/prompt", { request: { ...request, sessionId: "session-other" } })).status
  ).toBe(403);
  expect(
    (
      await f.rpc("session/prompt", {
        request: { ...request, content: [{ type: "file", receiptId: "untrusted" }] },
      })
    ).status
  ).toBe(403);
  expect(
    (
      await f.rpc("session/page", {
        request: {
          address: {
            kind: "subagent",
            parentSessionId: f.context.sessionId,
            childSessionId: "other",
            mode: "continuable",
          },
          throughSeq: 50,
        },
      })
    ).status
  ).toBe(403);
});

it.each([
  "settings/update",
  "account/login",
  "agentPresets/select",
  "terminal/create",
  "workspaceFiles/read",
  "session/fork",
  "session/selectModel",
  "commands/execute",
  "$events/result",
])("denies hidden operator APIs: %s", async (endpoint) => {
  const f = await fixture();
  expect((await f.rpc(endpoint, {})).status).toBe(403);
  expect(f.seen).toHaveLength(0);
});

it("rejects mismatched RPC envelopes, unknown argument keys and oversized input", async () => {
  const f = await fixture();
  expect(
    (
      await f.rpc(
        "session/cancel",
        { request: { sessionId: f.context.sessionId } },
        { method: "settings/update" }
      )
    ).status
  ).toBe(400);
  expect(
    (await f.rpc("session/cancel", { request: { sessionId: f.context.sessionId }, injected: true }))
      .status
  ).toBe(403);
  const response = await fetch(`${f.url}/api/session/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "x".repeat(1024 * 1024 + 1),
  });
  expect(response.status).toBe(413);
  expect(f.seen).toHaveLength(0);
});

it("rejects inactive sessions before bootstrap and never exposes the private launch URL", async () => {
  const f = await fixture();
  f.deactivate();
  const response = await fetch(f.url);
  expect(response.status).toBe(410);
  expect(await response.text()).not.toContain("private-launch-token");
  expect(f.seen).toHaveLength(0);
});

it("carries official read streams through the private authenticated mux", async () => {
  const f = await fixture();
  const ws = await f.connect();
  const message = once(ws, "message");
  ws.send(
    JSON.stringify({
      type: "open",
      streamId: "stream-owned",
      endpoint: "session/follow",
      payload: {
        args: {
          request: {
            address: { kind: "session", sessionId: f.context.sessionId },
            assistantStream: true,
            maxMessages: 500,
            turnWindow: { minMessages: 50, minTurns: 2 },
          },
        },
      },
    })
  );
  expect(JSON.parse((await message)[0].toString())).toMatchObject({
    type: "item",
    streamId: "stream-owned",
    value: { type: "ready" },
  });
  expect(f.frames).toHaveLength(1);
  const request = f.seen.find((request) => request.path === "/api/remote.mux");
  expect(request?.cookie).toBe("dsh-auth-test=v1.private.signature");
  expect(request?.authorization).toBeUndefined();
  ws.close();
});

it.each([
  { endpoint: "settings/follow", payload: { args: {} } },
  {
    endpoint: "session/follow",
    payload: { args: { request: { address: { kind: "session", sessionId: "session-other" } } } },
  },
  { endpoint: "$events", payload: { args: { sessionId: "session-other" } } },
  {
    endpoint: "session/follow",
    payload: {
      args: {
        request: {
          address: { kind: "session", sessionId: "session-owned" },
          maxMessages: 501,
        },
      },
    },
  },
])("denies arbitrary logical mux operations: $endpoint", async (operation) => {
  const f = await fixture();
  const ws = await f.connect();
  const closed = once(ws, "close");
  ws.send(JSON.stringify({ type: "open", streamId: "stream-denied", ...operation }));
  await closed;
  expect(f.frames).toHaveLength(0);
});

it("closes existing mux connections when their admitted child expires", async () => {
  const f = await fixture();
  const ws = await f.connect();
  const closed = once(ws, "close");
  f.deactivate();
  await closed;
  expect(ws.readyState).toBe(WebSocket.CLOSED);
});

it("carries a trusted history snapshot larger than the browser request limit", async () => {
  const f = await fixture();
  const ws = await f.connect();
  const ready = once(ws, "message");
  ws.send(
    JSON.stringify({
      type: "open",
      streamId: "history",
      endpoint: "session/follow",
      payload: {
        args: {
          request: {
            address: { kind: "session", sessionId: f.context.sessionId },
            maxMessages: 500,
          },
        },
      },
    })
  );
  await ready;
  const message = once(ws, "message");
  const history = "h".repeat(2 * 1024 * 1024);
  f.publish({ type: "item", streamId: "history", value: { history } });
  expect(JSON.parse((await message)[0].toString()).value.history).toBe(history);
  ws.close();
});

it("keeps oversized browser messages denied despite the larger trusted history limit", async () => {
  const f = await fixture();
  const ws = await f.connect();
  const closed = once(ws, "close");
  ws.send("x".repeat(1024 * 1024 + 1));
  await closed;
  expect(f.frames).toHaveLength(0);
});

it("cannot reopen a proxy after explicit teardown", async () => {
  const f = await fixture();
  expect((await fetch(f.url)).status).toBe(200);
  closeAppearanceWebProxy(f.context);
  expect((await fetch(f.url)).status).toBe(410);
});

it("reserves the HTTP limit before stalled bodies and tears those requests down", async () => {
  const f = await fixture();
  const pending = Array.from({ length: 16 }, () => {
    const req = request(`${f.url}/api/session/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "10000" },
    });
    req.on("error", () => undefined);
    const closed = new Promise<void>((resolve) => req.once("close", resolve));
    req.write("{");
    return { req, closed };
  });
  await f.waitForRequests(16);
  expect((await fetch(f.url)).status).toBe(429);
  expect(f.seen).toHaveLength(0);
  closeAppearanceWebProxy(f.context);
  await Promise.all(pending.map(({ closed }) => closed));
  expect(pending.every(({ req }) => req.destroyed)).toBe(true);
});

it("ends a partially streamed asset response when its admitted child is closed", async () => {
  const f = await fixture();
  const response = await fetch(`${f.url}/assets/pending.js`);
  const reader = response.body!.getReader();
  expect((await reader.read()).done).toBe(false);
  const pending = reader.read();
  closeAppearanceWebProxy(f.context);
  await expect(pending).rejects.toThrow();
});
