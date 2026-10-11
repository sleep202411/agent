import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  PlannerRequestSchema,
  StartStoryRunSchema,
  StoryHistorySchema,
  StoryRunSchema,
  StoryOutputsSchema,
  StoryScriptSchema,
  StoryPreviewSchema,
  StoryAttachmentSchema,
  StoryConversationSchema,
  StoryConversationsSchema,
  CreateStoryConversationSchema,
  UpdateStoryConversationSchema,
  ResumeStoryRunSchema,
  ChangeStoryVideoModelSchema,
  StoryVideoModelsSchema,
} from "@repo/app-story-protocol";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const EmptySchema = StartStoryRunSchema.pick({});
const IdSchema = StartStoryRunSchema.shape.chapterId;
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/app.css", ["app.css", "text/css; charset=utf-8"]],
  [
    "/experience-runtime/themes/core.film-dark.v1.json",
    ["experience-runtime/themes/core.film-dark.v1.json", "application/json; charset=utf-8"],
  ],
]);

/** Development-only bridge: fixed test identity/project, with no browser login. */
export function createH5Server(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production") throw new Error("H5 is a local development tool.");
  const locale = PlannerRequestSchema.shape.locale.parse(env.APP_STORY_H5_LOCALE ?? "en-US");
  const backend = new URL(env.APP_STORY_H5_SERVER_URL ?? "http://127.0.0.1:4399/aurora");
  if (
    backend.protocol !== "http:" ||
    !LOOPBACK.has(backend.hostname) ||
    backend.username ||
    backend.password ||
    backend.search ||
    backend.hash ||
    backend.pathname.replace(/\/$/, "") !== "/aurora"
  )
    throw new Error("APP_STORY_H5_SERVER_URL must be a local Server /aurora URL.");
  const projectId = env.APP_STORY_H5_PROJECT_ID?.trim();
  const chapterId = env.APP_STORY_H5_CHAPTER_ID?.trim();
  const cookie = env.APP_STORY_H5_SESSION_COOKIE?.trim();
  if (projectId) IdSchema.parse(projectId);
  if (chapterId) IdSchema.parse(chapterId);
  if (cookie && /[\r\n]/.test(cookie)) throw new Error("Invalid H5 session credential.");
  const ready = Boolean(projectId && chapterId && cookie);
  const basePath = `/app-story-agent/projects/${projectId}`;
  const messages = readFile(
    new URL(`../../web/messages/${locale}.json`, import.meta.url),
    "utf8"
  ).then(
    (source) =>
      JSON.parse(source).agent as {
        app: Record<string, string>;
        h5: Record<string, string>;
      }
  );
  // Observe a startup resource failure even before the browser requests context.
  void messages.catch(() => {});

  return createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; media-src 'self' https: blob:; connect-src 'self' https:; frame-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'"
    );
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const controller = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const origin = new URL(`http://${req.headers.host}`);
      if (
        !LOOPBACK.has(origin.hostname) ||
        req.headers["sec-fetch-site"] === "cross-site" ||
        (req.headers.origin && req.headers.origin !== origin.origin)
      )
        return send(403, { message: "Local same-origin access is required." });
      const url = new URL(req.url ?? "/", origin);
      const asset =
        ASSETS.get(url.pathname) ??
        (/^\/chunks\/[A-Za-z0-9_-]+\.js$/.test(url.pathname)
          ? [url.pathname.slice(1), "text/javascript; charset=utf-8"]
          : undefined);
      if (asset && req.method === "GET") {
        const source = await readFile(new URL(`../dist/ui/${asset[0]}`, import.meta.url));
        res.writeHead(200, { "content-type": asset[1] });
        return res.end(source);
      }
      if (req.method === "GET" && url.pathname === "/health")
        return send(ready ? 200 : 503, { ready });
      if (req.method === "GET" && url.pathname === "/api/context")
        return send(200, { ready, locale, projectId, chapterId });
      if (!ready) return send(503, { message: (await messages).h5.backendUnconfigured });

      let path: string;
      let body: unknown;
      let schema: { safeParse(value: unknown): { success: boolean; data?: unknown } } =
        StoryRunSchema;
      let binary = false;
      let uploadBody: Buffer | undefined;
      const chapterRoute =
        /^\/api\/chapters\/([^/]+)\/(outputs|script|preview|conversation|attachments)(?:\/([^/]+))?$/.exec(
          url.pathname
        );
      if (chapterRoute && !IdSchema.safeParse(chapterRoute[1]).success)
        return send(400, { message: "Invalid chapter ID." });
      if (req.method === "GET" && url.pathname === "/api/conversations") {
        path = `${basePath}/conversations`;
        schema = StoryConversationsSchema;
      } else if (req.method === "GET" && /^\/api\/runs\/[^/]+\/video-models$/.test(url.pathname)) {
        const runId = url.pathname.split("/")[3];
        if (!IdSchema.safeParse(runId).success) return send(400, { message: "Invalid run ID." });
        path = `${basePath}/runs/${runId}/video-models`;
        schema = StoryVideoModelsSchema;
      } else if (
        req.method === "GET" &&
        chapterRoute &&
        ["outputs", "script", "preview"].includes(chapterRoute[2]) &&
        !chapterRoute[3]
      ) {
        path = `${basePath}/chapters/${chapterRoute[1]}/${chapterRoute[2]}`;
        if (chapterRoute[2] === "outputs") {
          const runId = url.searchParams.get("runId");
          if (runId && !IdSchema.safeParse(runId).success)
            return send(400, { message: "Invalid run ID." });
          if (runId) path += `?runId=${runId}`;
        }
        schema =
          chapterRoute[2] === "outputs"
            ? StoryOutputsSchema
            : chapterRoute[2] === "script"
              ? StoryScriptSchema
              : StoryPreviewSchema;
      } else if (
        req.method === "GET" &&
        chapterRoute?.[2] === "attachments" &&
        IdSchema.safeParse(chapterRoute[3]).success
      ) {
        path = `${basePath}/chapters/${chapterRoute[1]}/attachments/${chapterRoute[3]}`;
        binary = true;
      } else if (req.method === "POST" && chapterRoute?.[2] === "attachments" && !chapterRoute[3]) {
        if (!req.headers["content-type"]?.startsWith("multipart/form-data;"))
          return send(415, { message: "A multipart attachment is required." });
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 10 * 1024 * 1024 + 64 * 1024)
            return send(413, { message: "Attachments must be at most 10MB." });
          chunks.push(chunk);
        }
        uploadBody = Buffer.concat(chunks);
        path = `${basePath}/chapters/${chapterRoute[1]}/attachments`;
        schema = StoryAttachmentSchema;
      } else if (req.method === "GET" && url.pathname === "/api/history") {
        const cursor = url.searchParams.get("cursor");
        if (cursor && !IdSchema.safeParse(cursor).success)
          return send(400, { message: "Invalid history cursor." });
        path = `${basePath}/history${cursor ? `?cursor=${cursor}` : ""}`;
        schema = StoryHistorySchema;
      } else if (req.method === "POST") {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 100_000) return send(413, { message: "Request too large." });
          chunks.push(chunk);
        }
        const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (url.pathname === "/api/runs") {
          const parsed = StartStoryRunSchema.safeParse(input);
          if (!parsed.success) return send(400, { message: "Invalid App Story API payload." });
          body = parsed.data;
          path = `${basePath}/runs`;
        } else if (url.pathname === "/api/conversations") {
          const parsed = CreateStoryConversationSchema.safeParse(input);
          if (!parsed.success) return send(400, { message: "Invalid conversation payload." });
          body = parsed.data;
          path = `${basePath}/conversations`;
          schema = StoryConversationSchema;
        } else if (chapterRoute?.[2] === "conversation" && !chapterRoute[3]) {
          const parsed = UpdateStoryConversationSchema.safeParse(input);
          if (!parsed.success) return send(400, { message: "Invalid conversation payload." });
          body = parsed.data;
          path = `${basePath}/chapters/${chapterRoute[1]}/conversation`;
          schema = StoryConversationSchema;
        } else {
          const match = /^\/api\/runs\/([^/]+)\/(cancel|resume|video-model)$/.exec(url.pathname);
          if (!match || !IdSchema.safeParse(match[1]).success)
            return send(404, { message: "Not found." });
          const parsed = (
            match[2] === "resume"
              ? ResumeStoryRunSchema
              : match[2] === "video-model"
                ? ChangeStoryVideoModelSchema
                : EmptySchema
          ).safeParse(input);
          if (!parsed.success) return send(400, { message: "Invalid App Story API payload." });
          body = parsed.data;
          path = `${basePath}/runs/${match[1]}/${match[2]}`;
        }
        if (!url.pathname.endsWith("/conversation") && url.pathname !== "/api/conversations")
          schema = StoryRunSchema;
      } else return send(404, { message: "Not found." });

      const upstream = await fetch(`${backend.href.replace(/\/$/, "")}${path}`, {
        method: req.method,
        headers: {
          cookie: cookie!,
          "content-type": uploadBody ? req.headers["content-type"]! : "application/json",
          "accept-language": locale,
        },
        body: uploadBody
          ? new Uint8Array(uploadBody)
          : body === undefined
            ? undefined
            : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      if (binary && upstream.ok) {
        res.writeHead(200, {
          "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
          "content-disposition": upstream.headers.get("content-disposition") ?? "attachment",
        });
        return res.end(Buffer.from(await upstream.arrayBuffer()));
      }
      const payload = (await upstream.json().catch(() => null)) as {
        code?: number;
        data?: unknown;
        msg?: string;
        message?: string;
      } | null;
      if (!payload || typeof payload !== "object")
        return send(502, { message: (await messages).h5.backendInvalidResponse });
      if (!upstream.ok || (payload.code !== undefined && payload.code !== 200))
        return send(
          upstream.ok
            ? typeof payload.code === "number" && payload.code >= 400 && payload.code < 500
              ? payload.code
              : 502
            : upstream.status,
          {
            message: payload.msg || payload.message || (await messages).app.requestFailed,
          }
        );
      const parsed = schema.safeParse(payload.data);
      if (!parsed.success)
        return send(502, { message: (await messages).h5.backendInvalidResponse });
      return send(200, parsed.data);
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof SyntaxError)
        return send(400, { message: "Invalid App Story API payload." });
      // Never expose the fixed session credential or fetch diagnostics to the browser.
      return send(502, { message: (await messages).h5.backendUnavailable });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.APP_STORY_H5_PORT ?? 8085);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid APP_STORY_H5_PORT.");
  const server = createH5Server();
  server.listen(port, "127.0.0.1", () => console.log(`Story Agent H5: http://localhost:${port}`));
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      server.closeAllConnections();
      server.close();
    });
}
