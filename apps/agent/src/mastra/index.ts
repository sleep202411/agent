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
import { workflowRoutes } from "./routes/workflow";
import { assetsRoutes } from "./routes/assets";
import { roleDesignWorkflow } from "./workflows/role-design";
import { batchCreateAssetWorkflow } from "./workflows/batch-create-asset";
import { scriptEditWorkflow } from "./workflows/script-edit";
import { scriptBreakdownWorkflow } from "./workflows/phases/script-breakdown";
import { rolePhaseWorkflow } from "./workflows/phases/role-phase";
import { roleImagePhaseWorkflow } from "./workflows/phases/role-image-phase";
import { episodePhaseWorkflow } from "./workflows/phases/episode-phase";
import { scriptPhaseWorkflow } from "./workflows/phases/script-phase";
import { storyboardPhaseWorkflow } from "./workflows/phases/storyboard-phase";
import { mainFlowWorkflow } from "./workflows/main-flow";

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
  },
  workflows: {
    // Single-phase workflows (still reachable individually via invoke_workflow)
    role_design: roleDesignWorkflow,
    batch_create_asset: batchCreateAssetWorkflow,
    script_edit: scriptEditWorkflow,
    // Phase workflows used inside main_flow — also reachable standalone
    story_outline: scriptBreakdownWorkflow,
    role_phase: rolePhaseWorkflow,
    role_image_phase: roleImagePhaseWorkflow,
    episode_phase: episodePhaseWorkflow,
    script_phase: scriptPhaseWorkflow,
    storyboard_phase: storyboardPhaseWorkflow,
    // Main pipeline that chains all five phases with HITL gates
    main_flow: mainFlowWorkflow,
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
      { path: "/workflow/*", handler: populateRequestContext },
      { path: "/drafts/*", handler: populateRequestContext },
      { path: "/chat/*", handler: populateRequestContext },
      { path: "/assets/*", handler: populateRequestContext },
    ],
    apiRoutes: [
      ...workflowRoutes,
      ...assetsRoutes,
      // AI SDK v5–compatible chat stream. Consumed by apps/web's
      // `readUIMessageStream()` via the NestJS proxy at
      // /assistant/submit-message-to-agent.
      chatRoute({ path: "/chat/storyos", agent: "storyos" }),
    ],
  },
});
