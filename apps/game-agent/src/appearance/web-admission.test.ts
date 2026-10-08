import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppearanceDesignRequest } from "@repo/game-agent-protocol";

const fixture = vi.hoisted(() => ({
  open: vi.fn(),
  initialize: vi.fn(),
  closeProxy: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: fixture.spawn }));
vi.mock("./workspaces.js", () => ({
  createAppearanceWorkspaceStore: () => ({ open: fixture.open }),
}));
vi.mock("./web-proxy.js", () => ({
  initializeAppearanceWebProxy: fixture.initialize,
  closeAppearanceWebProxy: fixture.closeProxy,
}));
vi.mock("./harness.js", () => ({
  DESIGN_PROMPT: "Native appearance rules",
  appearanceHarnessConfig: () => ({
    model: { model: "fixture", enableThinking: false },
    route: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-only" },
  }),
}));
import {
  openAppearanceWeb,
  closeAppearanceWeb,
  closeAppearanceWebSessions,
  shutdownAppearanceWebSessions,
  appearanceWebProxy,
} from "./web.js";
import { serveAppearanceWeb } from "./web-http.js";

const root = await realpath(await mkdtemp(join(tmpdir(), "game-agent-admission-test-")));
vi.stubEnv("GAME_AGENT_WORKSPACE_ROOT", root);
vi.stubEnv("GAME_AGENT_INTERNAL_TOKEN", "fixture-private-token");
vi.stubEnv("GAME_AGENT_PORT", "9656");
const children: FakeChild[] = [];
let autoStart = true;
let workspace: {
  root: string;
  id: string;
  sessionId: string;
  request: AppearanceDesignRequest;
  update: ReturnType<typeof vi.fn>;
  beginLaunch: ReturnType<typeof vi.fn>;
  recordChild: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};
const scope = { userId: "actor", projectId: randomUUID() };
function input() {
  return {
    key: randomUUID(),
    leaseId: randomUUID(),
    scope,
    draft: "Unsent draft",
    parentOrigin: "http://127.0.0.1:9655",
    copy: { working: "Working", workingFor: "Working for {duration}" },
    request: {
      requestId: randomUUID(),
      prompt: "Design this existing project",
      locale: "en-US" as const,
      appearance: { version: 1 as const },
      context: { title: "Existing film", choiceLabels: [] },
      history: [],
    },
  };
}
class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((signal: NodeJS.Signals) => {
    this.exitCode = 0;
    this.signalCode = signal;
    this.emit("exit", 0, signal);
    return true;
  });
  ready() {
    this.stdout.emit("data", Buffer.from("dsh web: http://127.0.0.1:12345/?token=fixture\n"));
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  children.length = 0;
  autoStart = true;
  fixture.initialize.mockResolvedValue(undefined);
  fixture.open.mockImplementation(async ({ request }: { request: AppearanceDesignRequest }) => {
    workspace = {
      root,
      id: randomUUID(),
      sessionId: `session-${randomUUID()}`,
      request,
      update: vi.fn(async (value: AppearanceDesignRequest) => value),
      beginLaunch: vi.fn().mockResolvedValue(undefined),
      recordChild: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    return workspace;
  });
  fixture.spawn.mockImplementation(() => {
    const child = new FakeChild();
    children.push(child);
    if (autoStart) queueMicrotask(() => child.ready());
    return child as unknown as ChildProcess;
  });
});
afterEach(async () => {
  await closeAppearanceWebSessions();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("does not acquire or launch work for an already canceled admission", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(openAppearanceWeb(input(), controller.signal)).rejects.toThrow();
  expect(fixture.open).not.toHaveBeenCalled();
  expect(fixture.spawn).not.toHaveBeenCalled();
});

it("releases the launch lease when spawning fails before a child PID exists", async () => {
  fixture.spawn.mockImplementationOnce(() => {
    const child = new FakeChild();
    child.kill.mockReturnValue(false);
    children.push(child);
    queueMicrotask(() => child.emit("error", new Error("Fixture spawn failed")));
    return child as unknown as ChildProcess;
  });
  await expect(openAppearanceWeb(input())).rejects.toThrow("Fixture spawn failed");
  expect(workspace.recordChild).not.toHaveBeenCalled();
  expect(workspace.release).toHaveBeenCalledTimes(1);
});

it("stops an unclaimed child and releases its writer lease when its launch waiter cancels", async () => {
  autoStart = false;
  const controller = new AbortController();
  const pending = openAppearanceWeb(input(), controller.signal);
  const rejected = expect(pending).rejects.toThrow("canceled");
  await vi.waitFor(() => expect(children).toHaveLength(1));
  controller.abort();
  await rejected;
  expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
  expect(workspace.release).toHaveBeenCalledTimes(1);
});

it("keeps the shared launch for a newer live waiter after the original waiter cancels", async () => {
  autoStart = false;
  const first = input();
  const controller = new AbortController();
  const pending = openAppearanceWeb(first, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(children).toHaveLength(1));
  const newer = { ...first, leaseId: randomUUID() };
  const resumed = openAppearanceWeb(newer);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  children[0]!.ready();
  await rejected;
  const session = await resumed;
  expect(fixture.spawn).toHaveBeenCalledTimes(1);
  expect(children[0]!.kill).not.toHaveBeenCalled();
  expect(await closeAppearanceWeb(session.id, first.leaseId, scope)).toEqual({ closed: false });
  expect(await closeAppearanceWeb(session.id, newer.leaseId, scope)).toEqual({ closed: true });
});

it("does not revoke the original live waiter when a newer concurrent waiter cancels", async () => {
  autoStart = false;
  const first = input();
  const pending = openAppearanceWeb(first);
  await vi.waitFor(() => expect(children).toHaveLength(1));
  const controller = new AbortController();
  const newer = openAppearanceWeb({ ...first, leaseId: randomUUID() }, controller.signal);
  const rejected = expect(newer).rejects.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  children[0]!.ready();
  const session = await pending;
  await rejected;
  expect(await closeAppearanceWeb(session.id, first.leaseId, scope)).toEqual({ closed: true });
});

it.skipIf(process.platform === "win32").each([false, true])(
  "holds the workspace lease until descendants exit (leader already exited: %s)",
  async (exited) => {
    const first = input();
    const session = await openAppearanceWeb(first);
    const child = children[0]!;
    Object.assign(child, { pid: 123456 });
    if (exited) child.exitCode = 0;
    let groupAlive = true;
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === 123456 && signal === 0)
        throw Object.assign(new Error("leader gone"), { code: "ESRCH" });
      expect(pid).toBe(-123456);
      if (!groupAlive) throw Object.assign(new Error("gone"), { code: "ESRCH" });
      if (signal === "SIGTERM") {
        child.exitCode = 0;
        child.signalCode = "SIGTERM";
        child.emit("exit", 0, "SIGTERM");
      } else if (signal === "SIGKILL") {
        groupAlive = false;
      }
      return true;
    });
    vi.useFakeTimers();
    try {
      const closing = exited
        ? closeAppearanceWebSessions()
        : closeAppearanceWeb(session.id, first.leaseId, scope);
      await vi.advanceTimersByTimeAsync(0);
      expect(workspace.release).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1600);
      await closing;
      expect(kill).toHaveBeenCalledWith(-123456, "SIGKILL");
      expect(workspace.release).toHaveBeenCalledTimes(1);
    } finally {
      groupAlive = false;
      kill.mockRestore();
      vi.useRealTimers();
    }
  }
);

it.skipIf(process.platform === "win32")(
  "does not signal a reused leader PID or release its ambiguous workspace lease",
  async () => {
    await openAppearanceWeb(input());
    Object.assign(children[0]!, { pid: 123456, exitCode: 0 });
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    try {
      await expect(closeAppearanceWebSessions()).rejects.toThrow("PID was reused");
      expect(kill).toHaveBeenCalledExactlyOnceWith(123456, 0);
      expect(workspace.release).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  }
);

it.skipIf(process.platform === "win32")(
  "retains the workspace lease when process-group absence cannot be proven",
  async () => {
    const first = input();
    const session = await openAppearanceWeb(first);
    Object.assign(children[0]!, { pid: 123456 });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EPERM" });
    });
    vi.useFakeTimers();
    try {
      const closing = closeAppearanceWeb(session.id, first.leaseId, scope);
      const rejected = expect(closing).rejects.toThrow("workspace lease retained");
      await vi.advanceTimersByTimeAsync(3100);
      await rejected;
      expect(workspace.release).not.toHaveBeenCalled();
      expect(kill).toHaveBeenCalledWith(-123456, "SIGKILL");
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
    }
  }
);

it("retains an already admitted iframe when its context refresh is canceled with the same lease", async () => {
  const first = input();
  const session = await openAppearanceWeb(first);
  let finish!: (request: AppearanceDesignRequest) => void;
  workspace.update.mockImplementationOnce(
    () =>
      new Promise<AppearanceDesignRequest>((resolve) => {
        finish = resolve;
      })
  );
  const controller = new AbortController();
  const next = { ...first, request: { ...first.request, requestId: randomUUID() } };
  const pending = openAppearanceWeb(next, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(workspace.update).toHaveBeenCalledTimes(1));
  controller.abort();
  finish(next.request);
  await rejected;
  expect(appearanceWebProxy(session.id, scope).isActive()).toBe(true);
  expect(children[0]!.kill).not.toHaveBeenCalled();
  expect(await closeAppearanceWeb(session.id, first.leaseId, scope)).toEqual({ closed: true });
});

it("propagates an HTTP departure into cancellation of an otherwise unclaimed launch", async () => {
  autoStart = false;
  const req = Readable.from([JSON.stringify({ action: "open", ...input() })]) as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  }) as unknown as ServerResponse;
  const pending = serveAppearanceWeb(req, res);
  await vi.waitFor(() => expect(children).toHaveLength(1));
  Object.assign(res, { destroyed: true });
  res.emit("close");
  await pending;
  expect(children[0]!.kill).toHaveBeenCalledTimes(1);
  expect(workspace.release).toHaveBeenCalledTimes(1);
  expect(res.writeHead).not.toHaveBeenCalled();
});

it("honors a departing matching lease after its canceled context refresh settles", async () => {
  const first = input();
  const session = await openAppearanceWeb(first);
  let finish!: (request: AppearanceDesignRequest) => void;
  workspace.update.mockImplementationOnce(
    () =>
      new Promise<AppearanceDesignRequest>((resolve) => {
        finish = resolve;
      })
  );
  const controller = new AbortController();
  const refresh = openAppearanceWeb(first, controller.signal);
  const rejected = expect(refresh).rejects.toThrow();
  await vi.waitFor(() => expect(workspace.update).toHaveBeenCalledTimes(1));
  const departing = closeAppearanceWeb(session.id, first.leaseId, scope);
  expect(children[0]!.kill).not.toHaveBeenCalled();
  controller.abort();
  finish(first.request);
  await rejected;
  expect(await departing).toEqual({ closed: true });
  expect(children[0]!.kill).toHaveBeenCalledTimes(1);
  expect(workspace.release).toHaveBeenCalledTimes(1);
});

it("protects a genuinely newer admitted lease from a close deferred during its refresh", async () => {
  const first = input();
  const session = await openAppearanceWeb(first);
  let finish!: (request: AppearanceDesignRequest) => void;
  workspace.update.mockImplementationOnce(
    () =>
      new Promise<AppearanceDesignRequest>((resolve) => {
        finish = resolve;
      })
  );
  const newer = { ...first, leaseId: randomUUID() };
  const refresh = openAppearanceWeb(newer);
  await vi.waitFor(() => expect(workspace.update).toHaveBeenCalledTimes(1));
  const departing = closeAppearanceWeb(session.id, first.leaseId, scope);
  finish(newer.request);
  expect((await refresh).leaseId).toBe(newer.leaseId);
  expect(await departing).toEqual({ closed: false });
  expect(children[0]!.kill).not.toHaveBeenCalled();
  expect(appearanceWebProxy(session.id, scope).isActive()).toBe(true);
  expect(await closeAppearanceWeb(session.id, newer.leaseId, scope)).toEqual({ closed: true });
});

it("fences accepted slow bodies and opens waiting for a close before permanent shutdown", async () => {
  const first = input();
  const session = await openAppearanceWeb(first);
  let release!: () => void;
  workspace.release.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  const closing = closeAppearanceWeb(session.id, first.leaseId, scope);
  await vi.waitFor(() => expect(workspace.release).toHaveBeenCalledTimes(1));
  const lateOpen = openAppearanceWeb({ ...first, leaseId: randomUUID() });
  const rejected = expect(lateOpen).rejects.toThrow("shutting down");
  const body = JSON.stringify({ action: "open", ...input() });
  const req = new PassThrough() as unknown as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  }) as unknown as ServerResponse;
  const http = serveAppearanceWeb(req, res);
  (req as unknown as PassThrough).write(body.slice(0, 20));
  const shutdown = shutdownAppearanceWebSessions();
  (req as unknown as PassThrough).end(body.slice(20));
  release();
  await Promise.all([closing, rejected, http, shutdown]);
  expect(fixture.open).toHaveBeenCalledTimes(1);
  expect(fixture.spawn).toHaveBeenCalledTimes(1);
  expect(children[0]!.kill).toHaveBeenCalledTimes(1);
  expect(res.writeHead).toHaveBeenCalledWith(502, expect.anything());
  await expect(openAppearanceWeb(input())).rejects.toThrow("shutting down");
});
