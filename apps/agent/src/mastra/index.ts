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
import { logStartupSelfCheck } from "./lib/startup-self-check";

// Workflow registrations removed 2026-05-05. Phase workflow files +
// `routes/workflow.ts` are still on disk for now in case we revisit;
// they're just no longer mounted on the Mastra server. The supervisor
// uses `ask_*` persona consults + direct CRUD instead — see
// `agents/storyos.ts`.

if (!process.env.DASHSCOPE_API_KEY && process.env.ALIBABA_API_KEY) {
  process.env.DASHSCOPE_API_KEY = process.env.ALIBABA_API_KEY;
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
    middleware: [
      { path: "/api/*", handler: populateRequestContext },
      { path: "/drafts/*", handler: populateRequestContext },
      { path: "/chat/*", handler: populateRequestContext },
      { path: "/assets/*", handler: populateRequestContext },
      { path: "/video-prompt/*", handler: populateRequestContext },
    ],
    apiRoutes: [
      ...assetsRoutes,
      ...adminRoutes,
      ...videoPromptRoutes,
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
