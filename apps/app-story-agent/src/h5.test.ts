import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createH5Server } from "./h5.js";

const servers: ReturnType<typeof createServer>[] = [];
beforeAll(async () => {
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL("../scripts/build-ui.mjs", import.meta.url)),
  ]);
}, 30000);
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function listen(server: ReturnType<typeof createServer>) {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local fixture address.");
  return `http://127.0.0.1:${address.port}`;
}
const projectId = randomUUID(),
  chapterId = randomUUID();
const cookie = "satoken=local-h5-private-test-session";
function settings(backend: string) {
  return {
    APP_STORY_H5_SERVER_URL: `${backend}/aurora`,
    APP_STORY_H5_SESSION_COOKIE: cookie,
    APP_STORY_H5_PROJECT_ID: projectId,
    APP_STORY_H5_CHAPTER_ID: chapterId,
  };
}
const input = () => ({
  submissionId: randomUUID(),
  chapterId,
  message: "What can you create?",
  authorizedPoints: 500,
});
const post = (base: string, path: string, body: unknown, origin?: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

describe("Standalone local H5 bridge", () => {
  it("forwards scoped model choices and exact quote consent without exposing the test session", async () => {
    const runId = randomUUID(),
      batchId = randomUUID();
    const received: Array<{ path: string; body: unknown }> = [];
    const paused = {
      ...input(),
      id: runId,
      version: 2,
      status: "blocked",
      phase: "clip_media",
      assistantText: null,
      committedPoints: 0,
      requiredPoints: 50,
      error: null,
      result: null,
      mediaQuote: {
        batchId,
        version: 1,
        points: 50,
        imageCount: 0,
        videoCount: 2,
        expiresAt: "2099-01-01T00:00:00Z",
        approved: false,
        videoModelId: "minimax-h3-max",
      },
      createdAt: "2026-10-10T00:00:00Z",
      updatedAt: "2026-10-10T00:00:00Z",
    };
    const upstream = await listen(
      createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
        received.push({ path: req.url!, body });
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            code: 200,
            data:
              req.method === "GET"
                ? {
                    selectedModelId: "minimax-h3-max",
                    models: [{ id: "minimax-h3-max", name: "MiniMax H3 Max" }],
                  }
                : paused,
          })
        );
      })
    );
    const base = await listen(createH5Server(settings(upstream)));
    expect((await fetch(`${base}/api/runs/${runId}/video-models`)).status).toBe(200);
    const quote = { batchId, version: 1, points: 50 };
    const choice = { modelId: "minimax-h3-max", runVersion: 2, quote };
    expect((await post(base, `/api/runs/${runId}/video-model`, choice)).status).toBe(200);
    expect((await post(base, `/api/runs/${runId}/resume`, { confirmedQuote: quote })).status).toBe(
      200
    );
    expect(
      (await post(base, `/api/runs/${runId}/resume`, { confirmedQuote: quote, refreshQuote: true }))
        .status
    ).toBe(200);
    expect(received).toEqual([
      {
        path: `/aurora/app-story-agent/projects/${projectId}/runs/${runId}/video-models`,
        body: null,
      },
      {
        path: `/aurora/app-story-agent/projects/${projectId}/runs/${runId}/video-model`,
        body: choice,
      },
      {
        path: `/aurora/app-story-agent/projects/${projectId}/runs/${runId}/resume`,
        body: { confirmedQuote: quote },
      },
      {
        path: `/aurora/app-story-agent/projects/${projectId}/runs/${runId}/resume`,
        body: { confirmedQuote: quote, refreshQuote: true },
      },
    ]);
    expect(
      (
        await post(base, `/api/runs/${runId}/resume`, {
          confirmedQuote: quote,
          refreshQuote: true,
          authorizedPoints: 50,
        })
      ).status
    ).toBe(400);
    expect((await post(base, `/api/runs/${runId}/resume`, { refreshQuote: true })).status).toBe(
      400
    );
    expect(
      (await post(base, `/api/runs/${runId}/video-model`, { ...choice, authorizedPoints: 999 }))
        .status
    ).toBe(400);
    expect((await fetch(`${base}/api/runs/invalid/video-models`)).status).toBe(400);
  });
  it("opens the chat without login and reports missing backend configuration", async () => {
    const base = await listen(createH5Server({}));
    const page = await fetch(base);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="story-agent"');
    expect(html).not.toContain("/login");
    for (const asset of ["app.js", "app.css"]) {
      const response = await fetch(`${base}/${asset}`);
      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeGreaterThan(100);
    }
    const theme = await fetch(`${base}/experience-runtime/themes/core.film-dark.v1.json`);
    expect(theme.status).toBe(200);
    expect(await theme.json()).toMatchObject({ schemaVersion: 1, colorScheme: "dark" });
    expect((await fetch(`${base}/health`)).status).toBe(503);
    expect(await (await fetch(`${base}/api/context`)).json()).toMatchObject({ ready: false });
    expect(() => createH5Server({ NODE_ENV: "production" })).toThrow("local development");
    expect(() =>
      createH5Server({ APP_STORY_H5_SERVER_URL: "https://fizzdragon.com/aurora" })
    ).toThrow("local Server");
  });

  it("uses a fixed server-side session and project while preserving the App dialogue contract", async () => {
    const runId = randomUUID();
    const received: Array<{ path: string; cookie?: string }> = [];
    const upstream = await listen(
      createServer(async (req, res) => {
        received.push({ path: req.url!, cookie: req.headers.cookie });
        res.setHeader("content-type", "application/json");
        res.setHeader("set-cookie", cookie);
        if (req.url?.split("?")[0]?.endsWith("/outputs"))
          return res.end(JSON.stringify({ code: 200, data: [] }));
        if (req.url?.endsWith("/script")) return res.end(JSON.stringify({ code: 200, data: null }));
        if (req.method === "GET")
          return res.end(
            JSON.stringify({
              code: 200,
              data: {
                runs: [],
                legacyMessages: [],
                legacyActiveRunId: null,
                authorizationLimit: 500,
              },
            })
          );
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.end(
          JSON.stringify({
            code: 200,
            data: {
              ...body,
              id: randomUUID(),
              version: 1,
              status: "completed",
              phase: "planning",
              assistantText: "I can create a script, video or interactive film.",
              committedPoints: 0,
              requiredPoints: null,
              error: null,
              result: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          })
        );
      })
    );
    const base = await listen(createH5Server(settings(upstream)));
    const context = await (await fetch(`${base}/api/context`)).text();
    expect(context).not.toContain(cookie);
    expect(context).not.toContain("satoken");
    expect((await fetch(`${base}/api/history`)).headers.get("set-cookie")).toBeNull();
    expect(await (await fetch(`${base}/api/chapters/${chapterId}/outputs`)).json()).toEqual([]);
    expect(
      await (await fetch(`${base}/api/chapters/${chapterId}/outputs?runId=${runId}`)).json()
    ).toEqual([]);
    expect((await fetch(`${base}/api/chapters/${chapterId}/outputs?runId=invalid`)).status).toBe(
      400
    );
    expect(await (await fetch(`${base}/api/chapters/${chapterId}/script`)).json()).toBeNull();
    const reply = await post(base, "/api/runs", input());
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({
      assistantText: "I can create a script, video or interactive film.",
      status: "completed",
    });
    expect(received).toEqual([
      { path: `/aurora/app-story-agent/projects/${projectId}/history`, cookie },
      {
        path: `/aurora/app-story-agent/projects/${projectId}/chapters/${chapterId}/outputs`,
        cookie,
      },
      {
        path: `/aurora/app-story-agent/projects/${projectId}/chapters/${chapterId}/outputs?runId=${runId}`,
        cookie,
      },
      {
        path: `/aurora/app-story-agent/projects/${projectId}/chapters/${chapterId}/script`,
        cookie,
      },
      { path: `/aurora/app-story-agent/projects/${projectId}/runs`, cookie },
    ]);
    expect((await post(base, "/api/runs", input(), "https://untrusted.example")).status).toBe(403);
    // Server checks new chapter ownership; the bridge pins the project and never accepts an arbitrary URL.
    expect((await post(base, "/api/runs", { ...input(), chapterId: randomUUID() })).status).toBe(
      200
    );
    expect((await post(base, "/api/runs", { ...input(), modelId: "client-choice" })).status).toBe(
      400
    );
    expect((await post(base, "/api/arbitrary-proxy", {})).status).toBe(404);
    expect(received).toHaveLength(6);
  });

  it("forwards scoped multipart bytes, owned downloads and pagination without leaking the identity", async () => {
    const id = randomUUID(),
      hash = "a".repeat(64),
      received: Array<{ path: string; cookie?: string; body: Buffer }> = [];
    const upstream = await listen(
      createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        received.push({ path: req.url!, cookie: req.headers.cookie, body: Buffer.concat(chunks) });
        if (req.method === "GET" && req.url?.includes("/attachments/")) {
          res.writeHead(200, { "content-type": "text/plain", "set-cookie": cookie });
          return res.end("reference text");
        }
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            code: 200,
            data: req.url?.includes("/history")
              ? {
                  runs: [],
                  legacyMessages: [],
                  legacyActiveRunId: null,
                  authorizationLimit: 10,
                  nextCursor: null,
                }
              : {
                  id,
                  name: "reference.txt",
                  hash,
                  mediaType: "text/plain",
                  bytes: 14,
                  width: null,
                  height: null,
                },
          })
        );
      })
    );
    const base = await listen(createH5Server(settings(upstream)));
    const form = new FormData();
    form.append("file", new Blob(["reference text"], { type: "text/plain" }), "reference.txt");
    const uploaded = await fetch(`${base}/api/chapters/${chapterId}/attachments`, {
      method: "POST",
      body: form,
    });
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({ id, hash });
    expect(received[0].body.toString()).toContain("reference text");
    const downloaded = await fetch(`${base}/api/chapters/${chapterId}/attachments/${id}`);
    expect(await downloaded.text()).toBe("reference text");
    expect(downloaded.headers.get("set-cookie")).toBeNull();
    const cursor = randomUUID();
    expect((await fetch(`${base}/api/history?cursor=${cursor}`)).status).toBe(200);
    expect(received.map((row) => row.path)).toEqual([
      `/aurora/app-story-agent/projects/${projectId}/chapters/${chapterId}/attachments`,
      `/aurora/app-story-agent/projects/${projectId}/chapters/${chapterId}/attachments/${id}`,
      `/aurora/app-story-agent/projects/${projectId}/history?cursor=${cursor}`,
    ]);
    expect(received.every((row) => row.cookie === cookie)).toBe(true);
    expect((await fetch(`${base}/api/history?cursor=invalid`)).status).toBe(400);
    expect(
      (
        await fetch(`${base}/api/chapters/${chapterId}/attachments/${id}`, {
          headers: { origin: "https://untrusted.example" },
        })
      ).status
    ).toBe(403);
  });

  it("surfaces HTTP-200 failures and leaves malformed replies uncertain for receipt recovery", async () => {
    let payload: unknown = { code: 400, msg: "Not enough compute points." };
    const upstream = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      })
    );
    const base = await listen(createH5Server(settings(upstream)));
    const failure = await post(base, "/api/runs", input());
    expect(failure.status).toBe(400);
    expect(await failure.json()).toEqual({ message: "Not enough compute points." });
    payload = { code: 200, data: { id: randomUUID() } };
    const malformed = await post(base, "/api/runs", input());
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toMatchObject({
      message: expect.stringContaining("invalid response"),
    });
  });
});
