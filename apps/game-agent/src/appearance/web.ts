import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppearanceDesignRequestSchema,
  AppearanceDesignResultSchema,
  type AppearanceDesignRequest,
  type AppearanceWebScope,
} from "@repo/game-agent-protocol";
import { appearanceHarnessConfig, DESIGN_PROMPT } from "./harness.js";
import { createAppearanceWorkspaceStore, type AppearanceWorkspace } from "./workspaces.js";
import {
  closeAppearanceWebProxy,
  initializeAppearanceWebProxy,
  type AppearanceWebProxyContext,
} from "./web-proxy.js";
import { readGameAgentServiceConfig } from "../config.js";

interface WebSession {
  id: string;
  key: string;
  scope: AppearanceWebScope;
  root: string;
  workspace: AppearanceWorkspace;
  process: ChildProcess;
  proxy: AppearanceWebProxyContext;
  touched: number;
  request: AppearanceDesignRequest;
  updating: number;
  updatesFinished: Set<() => void>;
  leaseId: string;
  sessionId: string;
  admission: Admission;
  admittedGeneration: number;
}
interface Admission {
  generation: number;
  claimed: boolean;
  waiters: Set<symbol>;
  controller: AbortController;
  session?: WebSession;
}
interface StartingSession {
  promise: Promise<WebSession>;
  admission: Admission;
}
const sessions = new Map<string, WebSession>();
const closing = new Map<string, Promise<void>>();
const starting = new Map<string, StartingSession>();
let draining = false;
const IDLE_MS = 30 * 60_000;
const alive = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;
let store: ReturnType<typeof createAppearanceWorkspaceStore> | undefined;
function workspaceStore() {
  return (store ??= createAppearanceWorkspaceStore(readGameAgentServiceConfig().workspaceRoot));
}
export async function initializeAppearanceWebWorkspaces() {
  await workspaceStore().initialize();
}
export class AppearanceWebSessionNotFound extends Error {
  constructor() {
    super("Appearance chat session expired. Reconnect to continue.");
  }
}
function owned(id: string, scope: AppearanceWebScope) {
  const session = sessions.get(id);
  if (
    !session ||
    session.scope.userId !== scope.userId ||
    session.scope.projectId !== scope.projectId ||
    !alive(session.process)
  )
    throw new AppearanceWebSessionNotFound();
  return session;
}
export function appearanceWebProxy(id: string, scope: AppearanceWebScope) {
  const session = owned(id, scope);
  session.touched = Date.now();
  return session.proxy;
}
function close(session: WebSession) {
  const pending = closing.get(session.key);
  if (pending) return pending;
  const promise = stopSession(session);
  closing.set(session.key, promise);
  return promise.finally(() => closing.delete(session.key));
}
async function stopProcess(child: ChildProcess) {
  if (process.platform !== "win32" && child.pid) {
    if (!alive(child)) {
      try {
        process.kill(child.pid, 0);
        throw new Error("Appearance runtime PID was reused; workspace lease retained.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    const group = -child.pid;
    const signal = (value: NodeJS.Signals | 0) => {
      try {
        process.kill(group, value);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") return false;
        // Some systems report EPERM while a group is exiting. Keep its lease
        // until absence is proven; persistent permission failures time out.
        if (code === "EPERM") return true;
        throw error;
      }
    };
    const stopped = async () => {
      const deadline = Date.now() + 1500;
      while (signal(0)) {
        if (Date.now() >= deadline) return false;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      return true;
    };
    // A leader's exit does not prove that its descendants have stopped writing.
    if (!signal("SIGTERM") || (await stopped())) return;
    signal("SIGKILL");
    if (!(await stopped()))
      throw new Error("Appearance runtime process group did not stop; workspace lease retained.");
    return;
  }
  if (!alive(child)) return;
  await new Promise<void>((resolve) => {
    const finished = () => {
      clearTimeout(killTimer);
      resolve();
    };
    child.once("exit", finished);
    const signal = (value: NodeJS.Signals) => {
      try {
        if (!child.kill(value) && !child.pid) finished();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(value);
      }
    };
    const killTimer = setTimeout(() => signal("SIGKILL"), 1500);
    signal("SIGTERM");
    if (!alive(child)) finished();
  });
}
async function stopSession(session: WebSession) {
  sessions.delete(session.id);
  closeAppearanceWebProxy(session.proxy);
  await stopProcess(session.process);
  await session.workspace.release();
}
const cleanup = setInterval(() => {
  for (const session of sessions.values())
    if (Date.now() - session.touched > IDLE_MS) void close(session).catch(() => undefined);
}, 60_000);
cleanup.unref();
export async function closeAppearanceWebSessions() {
  // Unclaimed launches must not outlive shutdown or leave a persistent writer fence.
  for (const operation of starting.values()) operation.admission.controller.abort();
  await Promise.allSettled([...starting.values()].map((operation) => operation.promise));
  await Promise.all([...sessions.values()].map((session) => close(session)));
  await Promise.all([...closing.values()]);
}
/** Permanently fence admissions before HTTP shutdown can await accepted bodies. */
export function shutdownAppearanceWebSessions() {
  draining = true;
  return closeAppearanceWebSessions();
}
function assertAcceptingAdmissions() {
  if (draining) throw new Error("Appearance service is shutting down.");
}
/** A departing window can release only its own current admission. */
export async function closeAppearanceWeb(id: string, leaseId: string, scope: AppearanceWebScope) {
  let session: WebSession;
  try {
    session = owned(id, scope);
  } catch (error) {
    if (error instanceof AppearanceWebSessionNotFound) return { closed: false };
    throw error;
  }
  while (session.updating && sessions.get(session.id) === session && session.leaseId === leaseId)
    await new Promise<void>((resolve) => session.updatesFinished.add(resolve));
  if (
    sessions.get(session.id) !== session ||
    !alive(session.process) ||
    session.leaseId !== leaseId
  )
    return { closed: false };
  await close(session);
  return { closed: true };
}
function admit(session: WebSession, leaseId: string, generation: number) {
  if (generation >= session.admittedGeneration) {
    session.leaseId = leaseId;
    session.admittedGeneration = generation;
  }
  session.admission.claimed = true;
  // Nest constructs the authenticated same-origin mount. Never disclose a child's
  // private launch token, port or authentication cookie to a browser.
  return { id: session.id, url: "/", requestId: session.request.requestId, leaseId };
}
function admission() {
  const value: Admission = {
    generation: 0,
    claimed: false,
    waiters: new Set(),
    controller: new AbortController(),
  };
  value.controller.signal.addEventListener("abort", () => {
    if (!value.claimed && value.session) void close(value.session).catch(() => undefined);
  });
  return value;
}
function waiter(value: Admission, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const identity = Symbol();
  const generation = ++value.generation;
  value.waiters.add(identity);
  let finished = false;
  const release = () => {
    if (finished) return;
    finished = true;
    value.waiters.delete(identity);
    signal?.removeEventListener("abort", release);
    if (!value.claimed && !value.waiters.size) value.controller.abort();
  };
  signal?.addEventListener("abort", release, { once: true });
  return { generation, release };
}
async function refreshAdmission(
  session: WebSession,
  request: AppearanceDesignRequest,
  leaseId: string,
  generation: number,
  signal?: AbortSignal
) {
  session.updating++;
  try {
    session.request = await session.workspace.update(request);
    session.touched = Date.now();
    signal?.throwIfAborted();
    if (!alive(session.process) || sessions.get(session.id) !== session)
      throw new AppearanceWebSessionNotFound();
    return admit(session, leaseId, generation);
  } finally {
    session.updating--;
    if (!session.updating) {
      for (const resolve of session.updatesFinished) resolve();
      session.updatesFinished.clear();
    }
  }
}

export async function openAppearanceWeb(
  input: {
    key: string;
    scope: AppearanceWebScope;
    leaseId: string;
    request: AppearanceDesignRequest;
    draft: string;
    parentOrigin: string;
    copy: { working: string; workingFor: string };
  },
  signal?: AbortSignal
) {
  assertAcceptingAdmissions();
  signal?.throwIfAborted();
  const parent = new URL(input.parentOrigin);
  if (
    !(
      parent.protocol === "https:" ||
      (parent.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parent.hostname))
    ) ||
    parent.origin !== input.parentOrigin ||
    parent.username ||
    parent.password
  )
    throw new Error("Appearance Web requires an exact HTTPS or loopback Studio origin.");
  const request = AppearanceDesignRequestSchema.parse(input.request);
  const key = JSON.stringify([
    input.scope.userId,
    input.scope.projectId,
    input.key,
    request.locale,
  ]);
  await closing.get(key);
  assertAcceptingAdmissions();
  signal?.throwIfAborted();
  for (const session of sessions.values()) if (!alive(session.process)) await close(session);
  assertAcceptingAdmissions();
  signal?.throwIfAborted();
  const existing = [...sessions.values()].find((s) => s.key === key && alive(s.process));
  if (existing) {
    const claim = waiter(existing.admission, signal);
    try {
      return await refreshAdmission(existing, request, input.leaseId, claim.generation, signal);
    } finally {
      claim.release();
    }
  }
  const pending = starting.get(key);
  if (pending) {
    if (pending.admission.controller.signal.aborted) {
      await pending.promise.catch(() => undefined);
      return openAppearanceWeb(input, signal);
    }
    const claim = waiter(pending.admission, signal);
    try {
      const session = await pending.promise;
      signal?.throwIfAborted();
      return await refreshAdmission(session, request, input.leaseId, claim.generation, signal);
    } finally {
      claim.release();
    }
  }
  if (sessions.size + starting.size >= 2)
    throw new Error("Close an unused appearance workspace before opening another.");
  const ownership = admission();
  const claim = waiter(ownership, signal);
  const promise = launch(key, { ...input, request }, ownership)
    .then(async (session) => {
      ownership.session = session;
      if (ownership.controller.signal.aborted || !ownership.waiters.size) {
        await close(session);
        ownership.controller.signal.throwIfAborted();
        throw new Error("Appearance admission was canceled.");
      }
      sessions.set(session.id, session);
      return session;
    })
    .finally(() => {
      if (starting.get(key)?.admission === ownership) starting.delete(key);
    });
  starting.set(key, { promise, admission: ownership });
  try {
    const session = await promise;
    signal?.throwIfAborted();
    return admit(session, input.leaseId, claim.generation);
  } finally {
    claim.release();
  }
}

async function launch(
  key: string,
  input: {
    key: string;
    scope: AppearanceWebScope;
    request: AppearanceDesignRequest;
    draft: string;
    parentOrigin: string;
    copy: { working: string; workingFor: string };
  },
  admission: Admission
): Promise<WebSession> {
  const signal = admission.controller.signal;
  signal.throwIfAborted();
  await closing.get(key);
  assertAcceptingAdmissions();
  signal.throwIfAborted();
  const { model, route } = appearanceHarnessConfig();
  const workspace = await workspaceStore().open({
    scope: input.scope,
    key: input.key,
    request: input.request,
  });
  input = { ...input, request: workspace.request };
  const { root, id, sessionId } = workspace;
  let child: ChildProcess | undefined;
  let proxy: AppearanceWebProxyContext | undefined;
  const cancelProxy = () => {
    if (proxy) closeAppearanceWebProxy(proxy);
  };
  try {
    signal.throwIfAborted();
    const disabled = [
      "llm-deepseek",
      "session-log-deepseek",
      "plugin-package-inventory-deepseek",
      "deepseek-llm-api-extensions",
      "deepseek-account",
      "session-title-llm",
      "preset-standard",
      "preset-minimal",
      "preset-cordis",
      "preset-ptc",
      "ui-sidebar",
      "ui-brand-official",
      "ui-model-selection",
      "ui-permission",
      "ui-agent-preset",
      "ui-shortcuts",
      "ui-commands",
      "ui-reference",
      "ui-skill",
      "ui-subagent",
      "ui-goal",
      "ui-plan",
      "ui-jobs",
      "ui-trajectory",
      "ui-message-feedback",
      "ui-open-in-app",
      "ui-deliverables",
      "workspace-changes",
      "ui-attachment",
      "ui-sidebar-files",
      "ui-sidebar-terminal",
      "ui-sidebar-documentpreview",
      "ui-user-questions",
      "ui-approval",
      "ui-settings-account",
      "ui-settings-general",
      "ui-settings-models",
      "ui-settings-plugins",
      "ui-settings-plugin-inventory",
      "ui-settings-shell",
      "ui-settings-agent-loop",
      "ui-settings-subagent",
      "ui-settings-web-search",
      "ui-settings-session-log",
      "ui-plugin-manager",
      "office-to-pdf",
      "plugin-manager",
      "cordis-client-runner",
      "cordis-host-runner",
      "cordis-inspect-providers",
      "ui-cordis",
      "terminal-controller",
      "workspace-files",
      "open-in-app",
      "file-reference-local",
      "directory-picker",
      "settings-controller",
      "account-controller",
      "plugin-package-inventory",
      "client-hmr",
      "job-controller",
      "session-log-download",
    ];
    // One private official Web host per preview. Its only agent preset has our
    // bounded appearance tools; no shell, host filesystem, web or delegation tools.
    const patches = [
      ...disabled.map((id) => ({ id, disabled: true })),
      {
        id: "workspace-controller",
        config: { documentsDirectory: root, documentsLookupTimeoutMs: 1000 },
      },
      { id: "agent-default-model", config: { provider: "fizzdragon-model", model: model.model } },
      { id: "agent-preset-registry", config: { default: "appearance" } },
      {
        id: "web-runtime",
        config: { openBrowser: false, printUrl: true, surfaceContext: false, trustedHosts: [] },
      },
      {
        id: "llm-pi-ai",
        config: {
          providers: {
            "fizzdragon-model": {
              api: "openai-completions",
              apiKeyEnv: "FIZZ_APPEARANCE_MODEL_KEY",
              baseURL: route.baseUrl,
              timeoutMs: 60_000,
              streamIdleTimeoutMs: 30_000,
              reasoning: model.enableThinking ? "medium" : "off",
              compat: {
                supportsDeveloperRole: false,
                maxTokensField: "max_tokens",
                thinkingFormat: "qwen",
              },
              models: [
                {
                  id: model.model,
                  input: ["text"],
                  reasoningEfforts: { off: null, low: "low", medium: "medium", high: "high" },
                },
              ],
            },
          },
        },
      },
      {
        insert: [
          {
            id: "appearance-preset",
            name: "@deepseek-ai/dsh-agent-preset",
            config: {
              id: "appearance",
              plugins: [
                {
                  id: "persona",
                  name: "@deepseek-ai/dsh-persona",
                  config: {
                    prefix: DESIGN_PROMPT,
                    complete: true,
                    includeRuntimeContext: false,
                  },
                },
                {
                  id: "appearance-tools",
                  name: fileURLToPath(import.meta.resolve("game-agent/appearance-harness-plugin")),
                  config: {
                    contextPath: join(root, "context.json"),
                    resultPath: join(root, "result.json"),
                  },
                },
              ],
            },
          },
          {
            id: "appearance-ui",
            name: fileURLToPath(import.meta.resolve("@repo/appearance-harness-ui")),
            config: {
              sessionId,
              cwd: root,
              title: input.request.context.title,
              locale: input.request.locale,
              draft: input.draft,
              parentOrigin: input.parentOrigin,
              copy: input.copy,
            },
          },
        ],
      },
    ];
    const patch = join(root, "web.patch.json");
    await writeFile(patch, JSON.stringify(patches), { mode: 0o600 });
    signal.throwIfAborted();
    const bin = fileURLToPath(
      new URL("lib/bin.js", import.meta.resolve("@deepseek-ai/dsh/package.json")).href
    );
    await workspace.beginLaunch();
    signal.throwIfAborted();
    child = spawn(
      process.execPath,
      [bin, "--profile", "web", "--patch", patch, "--no-open", "--port", "0"],
      {
        cwd: root,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          HOME: root,
          DSH_HOME: join(root, "home"),
          DSH_TELEMETRY_DISABLED: "1",
          FIZZ_APPEARANCE_MODEL_KEY: route.apiKey,
        },
      }
    );
    if (child.pid) await workspace.recordChild(child.pid);
    signal.throwIfAborted();
    const processHandle = child;
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => finish(new Error("Harness Web startup timed out.")), 30_000);
      const aborted = () => finish(new Error("Appearance admission was canceled."));
      const finish = (error?: Error, url?: string) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        if (error) reject(error);
        else resolve(url!);
      };
      signal.addEventListener("abort", aborted, { once: true });
      child!.once("error", (error) => finish(error));
      child!.once("exit", (code) =>
        finish(new Error(`Harness Web exited during startup (${code}).`))
      );
      child!.stdout!.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-8000);
        const match = /dsh web:\s+(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/\S*)/.exec(output);
        if (match) finish(undefined, match[1]);
      });
      // Never forward startup diagnostics: configurations may contain secrets.
      child!.stderr!.resume();
    });
    proxy = {
      url,
      root,
      sessionId,
      isActive: () => alive(processHandle),
    };
    signal.addEventListener("abort", cancelProxy, { once: true });
    signal.throwIfAborted();
    await initializeAppearanceWebProxy(proxy);
    signal.throwIfAborted();
    return {
      id,
      key,
      root,
      workspace,
      scope: input.scope,
      process: processHandle,
      proxy,
      updating: 0,
      updatesFinished: new Set(),
      touched: Date.now(),
      request: input.request,
      leaseId: randomUUID(),
      sessionId,
      admission,
      admittedGeneration: 0,
    };
  } catch (error) {
    if (proxy) closeAppearanceWebProxy(proxy);
    if (child) await stopProcess(child);
    await workspace.release();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelProxy);
  }
}

export async function pollAppearanceWeb(id: string, scope: AppearanceWebScope) {
  const session = owned(id, scope);
  session.touched = Date.now();
  let data: string;
  try {
    data = await readFile(join(session.root, "result.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { result: null };
    throw error;
  }
  const result = AppearanceDesignResultSchema.parse(JSON.parse(data));
  return { result: result.requestId === session.request.requestId ? result : null };
}
