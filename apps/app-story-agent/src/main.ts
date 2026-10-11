import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readConfig } from "./config.js";
import { plan } from "./harness.js";
import { PlannerRequestSchema } from "@repo/app-story-protocol";

const config = readConfig();
const active = new Set<AbortController>();
const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  const send = (status: number, value: unknown) => {
    res.writeHead(status);
    res.end(JSON.stringify(value));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { ready: true });
  const token = req.headers["x-app-story-agent-token"];
  if (
    typeof token !== "string" ||
    Buffer.byteLength(token) !== Buffer.byteLength(config.token) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(config.token))
  )
    return send(401, { message: "Unauthorized." });
  if (req.method !== "POST" || req.url !== "/v1/plan") return send(404, { message: "Not found." });
  if (active.size >= 3) {
    res.setHeader("retry-after", "5");
    return send(503, {
      code: "APP_STORY_PLANNER_BUSY",
      message: "Story planning is busy. Please retry.",
    });
  }
  const controller = new AbortController();
  active.add(controller);
  res.once("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 512_000) {
        send(413, { message: "Request too large." });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const parsed = PlannerRequestSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8"))
    );
    if (!parsed.success) return send(400, { message: "Invalid planning request." });
    const decision = await plan(parsed.data, config, controller.signal);
    if (!res.destroyed) send(200, decision);
  } catch (error) {
    if (!res.destroyed)
      send(error instanceof SyntaxError ? 400 : 502, {
        message: error instanceof Error ? error.message : "Story planning failed.",
      });
  } finally {
    active.delete(controller);
  }
});
server.requestTimeout = 150_000;
server.headersTimeout = 15_000;
server.listen(config.port, config.host);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    for (const controller of active) controller.abort();
    server.close();
  });
