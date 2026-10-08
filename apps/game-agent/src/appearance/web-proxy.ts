import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { z } from "zod";

/** The caller must authenticate the FD project/owner before every request. */
export interface AppearanceWebProxyContext {
  /** Private loopback URL printed by this child's official Harness runtime. */
  url: string;
  root: string;
  sessionId: string;
  isActive: () => boolean;
}

const MAX_BODY = 1024 * 1024;
const MAX_RPC_RESPONSE = 8 * 1024 * 1024;
const MAX_ASSET_RESPONSE = 64 * 1024 * 1024;
const MAX_HISTORY_RESPONSE = 8 * 1024 * 1024;
const MAX_BUFFER = MAX_HISTORY_RESPONSE;
const MAX_REQUESTS = 240;
const MAX_HTTP = 16;
const MAX_SOCKETS = 3;
const MAX_STREAMS = 8;
const EMPTY = z.object({}).strict();
const TEXT = z.object({ type: z.literal("text"), text: z.string().max(64_000) }).strict();
const CONTENT = z.array(TEXT).min(1).max(32);
const WINDOW = z
  .object({
    minMessages: z.number().int().min(0).max(500),
    minTurns: z.number().int().min(0).max(100),
  })
  .strict();
const PAGE_OPTIONS = {
  maxMessages: z.number().int().min(1).max(500).optional(),
  turnWindow: WINDOW.optional(),
};
const ENVELOPE = z
  .object({
    type: z.literal("client-request"),
    rpcId: z.string().min(1).max(128),
    method: z.string().min(1).max(128),
    payload: z.unknown(),
  })
  .strict();

interface ProxyState {
  origin: string;
  cookie?: Promise<string>;
  initialized?: Promise<void>;
  workspaceId?: string;
  requests: Set<AbortController>;
  httpRequests: number;
  sockets: Set<WebSocket>;
  pendingSockets: number;
  server: WebSocketServer;
  requestWindow: number;
  requestCount: number;
  closed: boolean;
}
const states = new WeakMap<AppearanceWebProxyContext, ProxyState>();

class Rejection extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function assertActive(context: AppearanceWebProxyContext, state?: ProxyState) {
  if (state?.closed || !context.isActive()) throw new Rejection(410, "Harness session expired.");
}

function getState(context: AppearanceWebProxyContext) {
  assertActive(context);
  const current = states.get(context);
  if (current) {
    assertActive(context, current);
    return current;
  }
  const launch = new URL(context.url);
  if (
    launch.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(launch.hostname) ||
    !launch.port ||
    launch.username ||
    launch.password ||
    launch.pathname !== "/" ||
    launch.hash ||
    [...launch.searchParams.keys()].some((key) => key !== "token") ||
    launch.searchParams.getAll("token").length !== 1 ||
    !launch.searchParams.get("token")
  )
    throw new Rejection(502, "Harness transport unavailable.");
  const state: ProxyState = {
    origin: launch.origin,
    requests: new Set(),
    httpRequests: 0,
    sockets: new Set(),
    pendingSockets: 0,
    server: new WebSocketServer({ noServer: true, maxPayload: MAX_BODY, perMessageDeflate: false }),
    requestWindow: Date.now(),
    requestCount: 0,
    closed: false,
  };
  states.set(context, state);
  return state;
}

function takeRequest(state: ProxyState) {
  if (Date.now() - state.requestWindow >= 60_000) {
    state.requestWindow = Date.now();
    state.requestCount = 0;
  }
  if (++state.requestCount > MAX_REQUESTS)
    throw new Rejection(429, "Too many Harness requests. Try again shortly.");
}

/** Runtime tokens and its authority-bound cookie never cross the FD boundary. */
async function cookie(context: AppearanceWebProxyContext, state: ProxyState) {
  state.cookie ??= (async () => {
    const controller = new AbortController();
    state.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 5000);
    timeout.unref();
    try {
      assertActive(context, state);
      const response = await fetch(context.url, {
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { "accept-encoding": "identity" },
      });
      await response.body?.cancel();
      assertActive(context, state);
      const cookies = response.headers.getSetCookie();
      const credential = cookies
        .map((value) => value.split(";", 1)[0])
        .find((value) =>
          /^dsh-auth-[A-Za-z0-9_-]+=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
        );
      if (response.status !== 303 || response.headers.get("location") !== "./" || !credential)
        throw new Rejection(502, "Harness transport unavailable.");
      return credential;
    } finally {
      clearTimeout(timeout);
      state.requests.delete(controller);
    }
  })().catch((error: unknown) => {
    state.cookie = undefined;
    throw error;
  });
  return state.cookie;
}

/** Validate raw paths before WHATWG normalization can erase traversal. */
function pathOf(raw = "/") {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("#") || raw.length > 16_384)
    throw new Rejection(404, "Harness route not found.");
  const pathname = raw.split("?", 1)[0];
  if (
    /[\\%]/.test(pathname) ||
    [...pathname].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) ||
    pathname.split("/").some((part) => part === "." || part === "..")
  )
    throw new Rejection(404, "Harness route not found.");
  return { raw, pathname };
}

function assetPath(raw: string, pathname: string) {
  if (raw === "/") return true;
  if (/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2?|ttf|svg|png)$/.test(raw)) return true;
  // The official module registry serves only advertised registered bundles.
  // Do not expose the HMR events endpoint, source maps, or filesystem routes.
  const packageName = "(?:@deepseek-ai/dsh-[A-Za-z0-9_.-]+|@repo/appearance-harness-ui)";
  if (pathname === "/plugins/")
    return new RegExp(
      `^/plugins/\\?\\?${packageName}/client\\.js(?:,${packageName}/client\\.js)*&rev=[a-f0-9]{8,64}$`
    ).test(raw);
  return new RegExp(
    `^/plugins/${packageName}/client(?:-[A-Za-z0-9_.-]+)?\\.js\\?rev=[a-f0-9]{8,64}$`
  ).test(raw);
}

function requestSchema(schema: z.ZodType) {
  return z.object({ args: z.object({ request: schema }).strict() }).strict();
}

function policy(
  endpoint: string,
  payload: unknown,
  context: AppearanceWebProxyContext,
  state: ProxyState,
  stream: boolean
) {
  const session = z.object({ sessionId: z.literal(context.sessionId) }).strict();
  const address = z
    .object({ kind: z.literal("session"), sessionId: z.literal(context.sessionId) })
    .strict();
  let schema: z.ZodType | undefined;
  if (stream) {
    if (["$events", "workspace/follow", "session/control"].includes(endpoint))
      schema = z.object({ args: EMPTY }).strict();
    else if (endpoint === "session/follow")
      schema = requestSchema(
        z.object({ address, assistantStream: z.literal(true).optional(), ...PAGE_OPTIONS }).strict()
      );
  } else {
    switch (endpoint) {
      case "workspace/create":
        schema = requestSchema(z.object({ path: z.literal(context.root) }).strict());
        break;
      case "workspace/rename":
        if (state.workspaceId)
          schema = requestSchema(
            z
              .object({
                workspaceId: z.literal(state.workspaceId),
                title: z.string().min(1).max(500),
              })
              .strict()
          );
        break;
      case "session/create":
        if (state.workspaceId)
          schema = requestSchema(
            z
              .object({
                sessionId: z.literal(context.sessionId),
                workspaceId: z.literal(state.workspaceId),
                agentPreset: z.literal("appearance").optional(),
              })
              .strict()
          );
        break;
      case "session/list":
        schema = z.object({ args: z.object({ _request: EMPTY }).strict() }).strict();
        break;
      case "session/initializeDefaultModel":
      case "session/modelCatalog":
        schema = z.object({ args: EMPTY }).strict();
        break;
      case "session/projections":
      case "session/cancel":
        schema = requestSchema(session);
        break;
      case "session/rename":
        schema = requestSchema(session.extend({ title: z.string().min(1).max(500) }).strict());
        break;
      case "session/page":
        schema = requestSchema(
          z
            .object({
              address,
              throughSeq: z.number().int().min(0),
              beforeSeq: z.number().int().min(0).optional(),
              ...PAGE_OPTIONS,
            })
            .strict()
        );
        break;
      case "session/prompt":
        schema = requestSchema(
          session
            .extend({
              requestId: z.string().min(1).max(128),
              mode: z.enum(["queue", "steer"]),
              content: CONTENT,
              clientTimeZone: z.string().min(1).max(100).optional(),
            })
            .strict()
        );
        break;
      case "session/updateQueue":
        schema = requestSchema(
          session
            .extend({
              itemId: z.string().min(1).max(128),
              action: z.discriminatedUnion("kind", [
                z.object({ kind: z.literal("remove") }).strict(),
                z.object({ kind: z.literal("steer") }).strict(),
                z.object({ kind: z.literal("edit"), content: CONTENT }).strict(),
              ]),
            })
            .strict()
        );
        break;
    }
  }
  if (!schema?.safeParse(payload).success)
    throw new Rejection(403, "Harness operation is outside this project session.");
}

async function readBody(req: IncomingMessage) {
  const length = req.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY))
    throw new Rejection(413, "Harness request is too large.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY) throw new Rejection(413, "Harness request is too large.");
    chunks.push(bytes);
  }
  try {
    return ENVELOPE.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new Rejection(400, "Invalid Harness request.");
  }
}

function errorResponse(res: ServerResponse, error: unknown) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const rejection =
    error instanceof Rejection ? error : new Rejection(502, "Harness transport unavailable.");
  res.writeHead(rejection.status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ error: { message: rejection.message } }));
}

async function boundedResponse(response: Response, maxBytes: number) {
  let size = 0;
  const chunks: Buffer[] = [];
  if (response.body)
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Rejection(502, "Harness response is too large.");
      chunks.push(Buffer.from(chunk));
    }
  return Buffer.concat(chunks);
}

/** Seed the fixed session before generic GUI navigation can create another one. */
async function initialize(context: AppearanceWebProxyContext, state: ProxyState) {
  state.initialized ??= (async () => {
    const controller = new AbortController();
    state.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    timeout.unref();
    try {
      const credential = await cookie(context, state);
      const call = async (method: string, request: unknown) => {
        assertActive(context, state);
        const rpcId = randomUUID();
        const response = await fetch(new URL(`/api/${method}`, state.origin), {
          method: "POST",
          cache: "no-store",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            cookie: credential,
            origin: state.origin,
            "accept-encoding": "identity",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            type: "client-request",
            rpcId,
            method,
            payload: { args: { request } },
          }),
        });
        const bytes = await boundedResponse(response, MAX_RPC_RESPONSE);
        assertActive(context, state);
        const parsed = z
          .object({
            type: z.literal("server-response"),
            rpcId: z.literal(rpcId),
            result: z.object({ ok: z.literal(true), value: z.unknown() }),
          })
          .safeParse(JSON.parse(bytes.toString("utf8")));
        if (!response.ok || !parsed.success)
          throw new Rejection(502, "Harness session could not be initialized.");
        return parsed.data.result.value;
      };
      const workspace = z
        .object({
          workspace: z.object({
            workspaceId: z.string().min(1).max(128),
            path: z.literal(context.root),
          }),
        })
        .parse(await call("workspace/create", { path: context.root }));
      state.workspaceId = workspace.workspace.workspaceId;
      z.object({ sessionId: z.literal(context.sessionId) }).parse(
        await call("session/create", {
          sessionId: context.sessionId,
          workspaceId: state.workspaceId,
          agentPreset: "appearance",
        })
      );
    } finally {
      clearTimeout(timeout);
      state.requests.delete(controller);
      controller.abort();
    }
  })().catch((error: unknown) => {
    state.initialized = undefined;
    throw error;
  });
  return state.initialized;
}

/** Optional fail-early boot; no browser credential or model inference is used. */
export async function initializeAppearanceWebProxy(context: AppearanceWebProxyContext) {
  await initialize(context, getState(context));
}

/** req.url is the untrusted mount-relative suffix, e.g. /api/session/prompt. */
export async function proxyAppearanceWebHttp(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppearanceWebProxyContext
): Promise<void> {
  let state: ProxyState | undefined;
  let controller: AbortController | undefined;
  let timer: NodeJS.Timeout | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let readingBody = false;
  const abort = () => controller?.abort();
  const abortBody = () => {
    if (readingBody) req.destroy();
    if (res.headersSent && !res.writableEnded) res.destroy();
  };
  try {
    state = getState(context);
    takeRequest(state);
    if (state.httpRequests >= MAX_HTTP)
      throw new Rejection(429, "Too many active Harness requests.");
    // Reserve before any await, including slow request bodies and bootstrap.
    state.httpRequests++;
    controller = new AbortController();
    state.requests.add(controller);
    controller.signal.addEventListener("abort", abortBody);
    req.once("aborted", abort);
    res.once("close", abort);
    timer = setInterval(() => {
      if (!context.isActive() || state!.closed) abort();
    }, 500);
    timer.unref();
    timeout = setTimeout(abort, 60_000);
    timeout.unref();
    const { raw, pathname } = pathOf(req.url);
    const rpc = pathname.startsWith("/api/");
    let body: ReturnType<typeof ENVELOPE.parse> | undefined;
    if (rpc) {
      if (
        req.method !== "POST" ||
        raw !== pathname ||
        req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
      )
        throw new Rejection(403, "Harness operation is outside this project session.");
      readingBody = true;
      body = await readBody(req);
      readingBody = false;
      const endpoint = pathname.slice("/api/".length);
      if (body.method !== endpoint) throw new Rejection(400, "Invalid Harness request.");
      policy(endpoint, body.payload, context, state, false);
    } else if (!["GET", "HEAD"].includes(req.method ?? "") || !assetPath(raw, pathname))
      throw new Rejection(404, "Harness route not found.");
    if (raw === "/") await initialize(context, state);
    const credential = await cookie(context, state);
    assertActive(context, state);
    const response = await fetch(new URL(raw, state.origin), {
      method: req.method,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        cookie: credential,
        origin: state.origin,
        "accept-encoding": "identity",
        ...(rpc ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assertActive(context, state);
    // Launch redirects and cookies belong only to the private child carrier.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Rejection(502, "Harness transport unavailable.");
    }
    const headers = {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    };
    if (rpc) {
      const bytes = await boundedResponse(response, MAX_RPC_RESPONSE);
      assertActive(context, state);
      if (body?.method === "workspace/create" && response.ok) {
        const value: unknown = JSON.parse(bytes.toString("utf8"));
        const created = z
          .object({
            type: z.literal("server-response"),
            rpcId: z.literal(body.rpcId),
            result: z.object({
              ok: z.literal(true),
              value: z.object({
                workspace: z.object({
                  workspaceId: z.string().min(1).max(128),
                  path: z.literal(context.root),
                }),
              }),
            }),
          })
          .safeParse(value);
        if (created.success) state.workspaceId = created.data.result.value.workspace.workspaceId;
      }
      res.writeHead(response.status, headers).end(bytes);
    } else {
      res.writeHead(response.status, headers);
      let bytes = 0;
      if (response.body)
        for await (const chunk of response.body) {
          assertActive(context, state);
          bytes += chunk.byteLength;
          if (bytes > MAX_ASSET_RESPONSE)
            throw new Rejection(502, "Harness response is too large.");
          if (res.destroyed) break;
          if (!res.write(chunk))
            await new Promise<void>((resolve) => {
              const done = () => {
                res.off("drain", done);
                res.off("close", done);
                resolve();
              };
              res.once("drain", done);
              res.once("close", done);
            });
        }
      res.end();
    }
  } catch (error) {
    errorResponse(res, error);
  } finally {
    if (timer) clearInterval(timer);
    if (timeout) clearTimeout(timeout);
    req.off("aborted", abort);
    res.off("close", abort);
    controller?.signal.removeEventListener("abort", abortBody);
    controller?.abort();
    if (controller && state) {
      state.requests.delete(controller);
      state.httpRequests--;
    }
  }
}

function rejectUpgrade(socket: Duplex, status: number) {
  if (!socket.destroyed)
    socket.end(
      `HTTP/1.1 ${status} ${status === 410 ? "Gone" : status === 429 ? "Too Many Requests" : "Forbidden"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
}

function asText(data: RawData) {
  return Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.from(data as Buffer).toString("utf8");
}

/** Both HTTP and mux logical operations are confined to the same admitted child. */
export async function upgradeAppearanceWeb(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  context: AppearanceWebProxyContext
): Promise<void> {
  let state: ProxyState | undefined;
  let upstream: WebSocket | undefined;
  let downstream: WebSocket | undefined;
  let timer: NodeJS.Timeout | undefined;
  let pending = false;
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (timer) clearInterval(timer);
    if (pending) {
      state!.pendingSockets--;
      pending = false;
    }
    if (upstream) {
      state?.sockets.delete(upstream);
      upstream.terminate();
    }
    if (downstream) {
      state?.sockets.delete(downstream);
      downstream.terminate();
    }
  };
  try {
    state = getState(context);
    takeRequest(state);
    if (req.method !== "GET" || req.url !== "/api/remote.mux")
      throw new Rejection(403, "Harness route not found.");
    if (state.sockets.size / 2 + state.pendingSockets >= MAX_SOCKETS)
      throw new Rejection(429, "Too many Harness connections.");
    state.pendingSockets++;
    pending = true;
    const credential = await cookie(context, state);
    assertActive(context, state);
    if (socket.destroyed) {
      cleanup();
      return;
    }
    const url = new URL("/api/remote.mux", state.origin);
    url.protocol = "ws:";
    upstream = new WebSocket(url, {
      headers: { cookie: credential, origin: state.origin },
      maxPayload: MAX_HISTORY_RESPONSE,
      perMessageDeflate: false,
      handshakeTimeout: 5000,
    });
    const closeSocket = () => cleanup();
    socket.once("close", closeSocket);
    upstream.on("error", cleanup);
    upstream.once("close", cleanup);
    await new Promise<void>((resolve, reject) => {
      const failed = () => reject(new Rejection(502, "Harness transport unavailable."));
      upstream!.once("error", failed);
      upstream!.once("close", failed);
      upstream!.once("open", () => {
        upstream!.off("error", failed);
        upstream!.off("close", failed);
        resolve();
      });
    });
    assertActive(context, state);
    if (disposed || socket.destroyed) {
      cleanup();
      return;
    }
    state.server.handleUpgrade(req, socket, head, (accepted) => {
      downstream = accepted;
    });
    if (!downstream) {
      cleanup();
      return;
    }
    state.pendingSockets--;
    pending = false;
    state.sockets.add(upstream);
    state.sockets.add(downstream);
    downstream.on("error", cleanup);
    downstream.once("close", cleanup);
    const streams = new Set<string>();
    let window = Date.now();
    let count = 0;
    const relay = (target: WebSocket, text: string) => {
      if (
        target.readyState !== WebSocket.OPEN ||
        target.bufferedAmount + Buffer.byteLength(text) > MAX_BUFFER
      ) {
        cleanup();
        return;
      }
      target.send(text, (error) => {
        if (error) cleanup();
      });
    };
    downstream.on("message", (data, binary) => {
      try {
        assertActive(context, state);
        if (binary) throw new Rejection(403, "Invalid Harness stream.");
        if (Date.now() - window >= 60_000) {
          window = Date.now();
          count = 0;
        }
        if (++count > 240) throw new Rejection(429, "Too many Harness stream messages.");
        const text = asText(data);
        const frame = z
          .discriminatedUnion("type", [
            z
              .object({
                type: z.literal("open"),
                streamId: z.string().min(1).max(128),
                endpoint: z.string().min(1).max(128),
                payload: z.unknown(),
              })
              .strict(),
            z.object({ type: z.literal("cancel"), streamId: z.string().min(1).max(128) }).strict(),
            z.object({ type: z.literal("end"), streamId: z.string().min(1).max(128) }).strict(),
          ])
          .parse(JSON.parse(text));
        if (frame.type === "open") {
          if (streams.size >= MAX_STREAMS || streams.has(frame.streamId))
            throw new Rejection(403, "Invalid Harness stream.");
          policy(frame.endpoint, frame.payload, context, state!, true);
          streams.add(frame.streamId);
        } else {
          if (!streams.has(frame.streamId)) throw new Rejection(403, "Invalid Harness stream.");
          if (frame.type === "cancel") streams.delete(frame.streamId);
        }
        relay(upstream!, text);
      } catch {
        downstream!.close(1008, "Harness stream operation denied.");
        cleanup();
      }
    });
    upstream.on("message", (data, binary) => {
      try {
        assertActive(context, state);
        if (binary) {
          cleanup();
          return;
        }
        const text = asText(data);
        const frame = z
          .object({ type: z.enum(["item", "end", "error"]), streamId: z.string() })
          .passthrough()
          .parse(JSON.parse(text));
        if (!streams.has(frame.streamId)) return;
        if (frame.type !== "item") streams.delete(frame.streamId);
        relay(downstream!, text);
      } catch {
        cleanup();
      }
    });
    timer = setInterval(() => {
      if (!context.isActive() || state!.closed) cleanup();
    }, 500);
    timer.unref();
  } catch (error) {
    rejectUpgrade(socket, error instanceof Rejection ? error.status : 502);
    cleanup();
  }
}

/** Call when the owning child stops; credentials cannot outlive its admission. */
export function closeAppearanceWebProxy(context: AppearanceWebProxyContext) {
  const state = states.get(context);
  if (!state) return;
  state.closed = true;
  for (const request of state.requests) request.abort();
  for (const socket of state.sockets) socket.terminate();
  state.server.close();
  state.cookie = undefined;
}
