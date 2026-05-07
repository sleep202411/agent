import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { chatRoute } from "@mastra/ai-sdk";
import { storyosAgent } from "./agents/storyos";
import { roleDesignerAgent } from "./agents/personas/role-designer";
import { scriptwriterAgent } from "./agents/personas/scriptwriter";
import { storyEditorAgent } from "./agents/personas/story-editor";
import { episodePlannerAgent } from "./agents/personas/episode-planner";
import { storyboarderAgent } from "./agents/personas/storyboarder";
import { evaluatorAgent } from "./agents/personas/evaluator";
import { artDirectorAgent } from "./agents/personas/art-director";
import { sceneDesignerAgent } from "./agents/personas/scene-designer";
import { propDesignerAgent } from "./agents/personas/prop-designer";
import { briefAnalyzerAgent } from "./agents/personas/brief-analyzer";
import { scriptSplitterAgent } from "./agents/personas/script-splitter";
import { assetsRoutes } from "./routes/assets";
import { adminRoutes } from "./routes/admin";
import { videoPromptRoutes } from "./routes/video-prompt";
import { produceRoutes } from "./routes/produce";
import { logStartupSelfCheck } from "./lib/startup-self-check";
import { produceScriptPipelineWorkflow } from "./workflows/produce-script-pipeline";
import { produceStep1EpisodesWorkflow } from "./workflows/produce-step1-episodes";
import { produceStep2AssetsWorkflow } from "./workflows/produce-step2-assets";

// StoryOS chat no longer owns workflow orchestration. The only workflow
// registered here is the dedicated produce-mode analysis pipeline; it is
// launched from /produce/script and commits nothing until the user confirms.

loadLocalEnvFallbacks();

function loadLocalEnvFallbacks(): void {
  try {
    process.loadEnvFile();
  } catch {
    // Optional: Mastra CLI usually loads apps/agent/.env already.
  }
  if (process.env.ALIBABA_API_KEY) return;

  // Local dev convenience: Spark historically kept the DashScope key in
  // apps/server/.env. The produce pipeline runs inside the agent worker,
  // so read that file as a fallback when developers start only agent env.
  const candidates = [
    resolve(process.cwd(), "apps/server/.env"),
    resolve(process.cwd(), "../server/.env"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      // Try the next candidate.
    }
    if (process.env.ALIBABA_API_KEY) return;
  }
}

// A single tool/LLM failure should degrade the one request, not crash the
// whole agent server. Mastra catches most in-flight errors but async leaks
// (e.g. custom fetch callbacks in tools) can still escape to the process.
if (!(globalThis as { __storyosErrorGuardsInstalled?: boolean }).__storyosErrorGuardsInstalled) {
  (globalThis as { __storyosErrorGuardsInstalled?: boolean }).__storyosErrorGuardsInstalled = true;
  process.on("uncaughtException", (err) => {
    // eslint-disable-next-line no-console
    console.error("[storyos-agent] uncaughtException:", err);
  });
  process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error("[storyos-agent] unhandledRejection:", reason);
  });
}

/**
 * Populate requestContext from the `x-storyos-context` header + cookie/accept-language.
 * Shared by both Mastra's built-in `/api/*` routes and our custom routes under
 * `/workflow/*` and `/drafts/*`. Factored out so we can reuse the same logic
 * across different path prefixes.
 */
const populateRequestContext = async (
  c: import("hono").Context,
  next: () => Promise<void>
): Promise<void | Response> => {
  const requestContext = c.get("requestContext") as RequestContext;

  const incomingCtx = c.req.header("x-storyos-context");
  if (incomingCtx) {
    try {
      const parsed = JSON.parse(incomingCtx) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== undefined && value !== null) {
          requestContext.set(key, value);
        }
      }
    } catch {
      // ignore malformed header
    }
  }

  const cookie = c.req.header("cookie");
  if (cookie && !requestContext.get("cookie")) {
    requestContext.set("cookie", cookie);
  }
  const acceptLanguage = c.req.header("accept-language");
  if (acceptLanguage && !requestContext.get("acceptLanguage")) {
    requestContext.set("acceptLanguage", acceptLanguage);
  }

  await next();
};

export const mastra = new Mastra({
  agents: {
    storyos: storyosAgent,
    roleDesigner: roleDesignerAgent,
    scriptwriter: scriptwriterAgent,
    storyEditor: storyEditorAgent,
    episodePlanner: episodePlannerAgent,
    storyboarder: storyboarderAgent,
    evaluator: evaluatorAgent,
    artDirector: artDirectorAgent,
    sceneDesigner: sceneDesignerAgent,
    propDesigner: propDesignerAgent,
    briefAnalyzer: briefAnalyzerAgent,
    scriptSplitter: scriptSplitterAgent,
  },
  workflows: {
    produceScriptPipeline: produceScriptPipelineWorkflow,
    produceStep1Episodes: produceStep1EpisodesWorkflow,
    produceStep2Assets: produceStep2AssetsWorkflow,
  },
  storage: new LibSQLStore({
    id: "storyos-storage",
    url: process.env.MASTRA_DB_URL ?? "file:./mastra.db",
  }),
  logger: new PinoLogger({
    name: "storyos-agent",
    level: (process.env.LOG_LEVEL as "info" | "debug" | "warn" | "error") ?? "info",
  }),
  server: {
    port: Number(process.env.PORT ?? 4111),
    host: process.env.MASTRA_HOST ?? "localhost",
    // Hono `timeout` middleware that Mastra mounts globally defaults to
    // 3 min and fires `504 Gateway Timeout` when it expires. The
    // produce-script sync route runs an in-process workflow that
    // takes ~9-10 min on the qwen3.6-plus path and can stretch on slow
    // days; allow up to 30 min so we don't false-fire. Per-LLM-call
    // timeouts (model-hardening) still cap individual upstream calls.
    timeout: 30 * 60 * 1000,
    middleware: [
      { path: "/api/*", handler: populateRequestContext },
      { path: "/drafts/*", handler: populateRequestContext },
      { path: "/chat/*", handler: populateRequestContext },
      { path: "/assets/*", handler: populateRequestContext },
      { path: "/video-prompt/*", handler: populateRequestContext },
      { path: "/produce/*", handler: populateRequestContext },
    ],
    apiRoutes: [
      ...assetsRoutes,
      ...adminRoutes,
      ...videoPromptRoutes,
      ...produceRoutes,
      // AI SDK v5–compatible chat stream. Consumed by apps/web's
      // `readUIMessageStream()` via the NestJS proxy at
      // /assistant/submit-message-to-agent.
      chatRoute({ path: "/chat/storyos", agent: "storyos" }),
    ],
  },
});

// Boot-time visibility: print resolved provider / caching / hardening state
// once so misconfig (missing key, wrong provider, env typo) surfaces in the
// startup logs instead of midway through the first user request.
logStartupSelfCheck();
