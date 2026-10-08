import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { AppearanceWebScopeSchema } from "@repo/game-agent-protocol";
import { serveAppearanceDesign } from "../appearance/http.js";
import { serveAppearanceWeb } from "../appearance/web-http.js";
import { appearanceWebProxy, AppearanceWebSessionNotFound } from "../appearance/web.js";
import { proxyAppearanceWebHttp, upgradeAppearanceWeb } from "../appearance/web-proxy.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
const PROXY_PATH = /^\/v1\/game-agent\/appearance\/web\/([a-f\d-]{36})\/proxy\/(.*)$/;
function scopedProxy(req: IncomingMessage) {
  const url = new URL(req.url ?? "/", "http://worker.invalid");
  const path = PROXY_PATH.exec(url.pathname);
  if (!path) return null;
  const header = req.headers["x-game-agent-scope"];
  if (typeof header !== "string" || header.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(header))
    throw new AppearanceWebSessionNotFound();
  let scope;
  try {
    scope = AppearanceWebScopeSchema.parse(JSON.parse(Buffer.from(header, "base64url").toString()));
  } catch {
    throw new AppearanceWebSessionNotFound();
  }
  const context = appearanceWebProxy(path[1]!, scope);
  req.url = `/${path[2]}${url.search}`;
  return context;
}

export function createGameAgentHttpServer(
  internalToken: string,
  handlers: { design: Handler; web: Handler } = {
    design: serveAppearanceDesign,
    web: serveAppearanceWeb,
  }
) {
  const expected = Buffer.from(internalToken);
  const authenticated = (req: IncomingMessage) => {
    const value = req.headers["x-game-agent-internal-token"];
    const actual = Buffer.from(typeof value === "string" ? value : "");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  };
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, service: "game-agent", runtime: "deepseek-harness" }));
      return;
    }
    if (!authenticated(req)) {
      res.writeHead(401).end();
      return;
    }
    try {
      if (req.method === "POST" && req.url === "/v1/game-agent/appearance/web")
        await handlers.web(req, res);
      else if (req.method === "POST" && req.url === "/v1/game-agent/appearance/design")
        await handlers.design(req, res);
      else {
        const context = scopedProxy(req);
        if (context) await proxyAppearanceWebHttp(req, res, context);
        else res.writeHead(404).end();
      }
    } catch (error) {
      const status = error instanceof AppearanceWebSessionNotFound ? 404 : 500;
      if (!res.headersSent)
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      if (!res.writableEnded)
        res.end(
          JSON.stringify({
            error: {
              message: status === 404 ? "Harness session expired." : "Game Agent request failed.",
            },
          })
        );
    }
  });
  server.on("upgrade", (req, socket, head) => {
    if (!authenticated(req)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    void (async () => {
      const context = scopedProxy(req);
      if (!context) {
        socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        return;
      }
      await upgradeAppearanceWeb(req, socket, head, context);
    })().catch(() => socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"));
  });
  return server;
}
