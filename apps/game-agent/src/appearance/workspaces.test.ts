import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AppearanceDesignRequest } from "@repo/game-agent-protocol";
import {
  createAppearanceWorkspaceStore,
  type AppearanceWorkspace,
  type AppearanceWorkspaceInput,
} from "./workspaces.js";

const roots: string[] = [];
const leases: AppearanceWorkspace[] = [];
async function store() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "game-agent-workspace-test-")));
  roots.push(root);
  return { root, store: createAppearanceWorkspaceStore(root) };
}
function input(): AppearanceWorkspaceInput {
  return {
    scope: { userId: "actor:with-private-identity", projectId: randomUUID() },
    key: randomUUID(),
    request: {
      requestId: randomUUID(),
      prompt: "Center the choices",
      locale: "en-US",
      appearance: { version: 1 },
      context: { title: "A story", choiceLabels: ["Continue"] },
      history: [],
    },
  };
}
async function hold(operation: Promise<AppearanceWorkspace>) {
  const lease = await operation;
  leases.push(lease);
  return lease;
}
afterEach(async () => {
  await Promise.all(leases.splice(0).map((lease) => lease.release().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("initializes and checks a writable private root before sessions without leaving probe files", async () => {
  const { root, store: storage } = await store();
  await storage.initialize();
  expect(await readdir(root)).toEqual([]);
  const nested = join(root, "new", "workspaces");
  await createAppearanceWorkspaceStore(nested).initialize();
  expect(await readdir(nested)).toEqual([]);
});

it("fails initialization for a read-only or symlinked volume", async () => {
  const { root, store: storage } = await store();
  await chmod(root, 0o500);
  try {
    await expect(storage.initialize()).rejects.toThrow();
  } finally {
    await chmod(root, 0o700);
  }
  const link = join(root, "linked");
  await symlink(root, link);
  await expect(createAppearanceWorkspaceStore(link).initialize()).rejects.toThrow("symlinks");
});

it("separates users, projects, browser windows and locales into opaque private directories", async () => {
  const { root, store: storage } = await store();
  const original = input();
  const variants: AppearanceWorkspaceInput[] = [
    original,
    { ...original, scope: { ...original.scope, userId: "other-actor" } },
    { ...original, scope: { ...original.scope, projectId: randomUUID() } },
    { ...original, key: randomUUID() },
    { ...original, request: { ...original.request, locale: "zh-CN" } },
  ];
  const opened = await Promise.all(variants.map((value) => hold(storage.open(value))));
  expect(new Set(opened.map((item) => item.root)).size).toBe(variants.length);
  expect(await readdir(root)).toHaveLength(variants.length);
  for (const workspace of opened) {
    expect(workspace.root).toMatch(new RegExp(`^${root}/[a-f0-9]{64}$`));
    expect(await readFile(join(workspace.root, "workspace.json"), "utf8")).not.toContain(
      original.scope.userId
    );
  }
});

it("rejects actor scopes outside the shared authenticated protocol before creating workspaces", async () => {
  const { root, store: storage } = await store();
  for (const userId of ["actor/../path", "", "a".repeat(129)]) {
    const original = input();
    await expect(
      storage.open({ ...original, scope: { ...original.scope, userId } })
    ).rejects.toThrow();
  }
  expect(await readdir(root)).toEqual([]);
});

it("restores stable official and public sessions, candidates and official history after reopening", async () => {
  const { root, store: storage } = await store();
  const original = input();
  const first = await hold(storage.open(original));
  await writeFile(join(first.root, "candidate.json"), "unfinished syntax !");
  await mkdir(join(first.root, "home"));
  await writeFile(join(first.root, "home", "official-history.json"), "official transcript");
  await first.release();
  const resumed = await hold(
    createAppearanceWorkspaceStore(root).open({
      ...original,
      request: { ...original.request, requestId: randomUUID() },
    })
  );
  expect(resumed.id).toBe(first.id);
  expect(resumed.sessionId).toBe(first.sessionId);
  expect(resumed.request.requestId).toBe(original.request.requestId);
  expect(await readFile(join(first.root, "candidate.json"), "utf8")).toBe("unfinished syntax !");
  expect(await readFile(join(first.root, "home", "official-history.json"), "utf8")).toBe(
    "official transcript"
  );
});

it("serializes context updates, persists their final value and protects stored objects from mutation", async () => {
  const { root, store: storage } = await store();
  const original = input();
  const opened = await hold(storage.open(original));
  const first: AppearanceDesignRequest = {
    ...original.request,
    requestId: randomUUID(),
    prompt: "First edit",
  };
  const second: AppearanceDesignRequest = {
    ...original.request,
    requestId: randomUUID(),
    prompt: "Second edit",
  };
  await Promise.all([opened.update(first), opened.update(second)]);
  opened.request.prompt = "A caller cannot mutate persisted context";
  expect(opened.request).toEqual(second);
  expect(JSON.parse(await readFile(join(opened.root, "context.json"), "utf8"))).toEqual(second);
  await opened.release();
  await expect(opened.update(first)).rejects.toThrow("released");
  const restored = await hold(
    createAppearanceWorkspaceStore(root).open({ ...original, request: second })
  );
  expect(restored.request).toEqual(second);
  await expect(restored.update({ ...second, locale: "zh-HK" })).rejects.toThrow(
    "locale cannot change"
  );
});

it("refuses simultaneous ownership even through independent stores", async () => {
  const { root, store: storage } = await store();
  const original = input();
  const results = await Promise.allSettled([
    storage.open(original),
    createAppearanceWorkspaceStore(root).open(original),
  ]);
  const successful = results.filter((result) => result.status === "fulfilled");
  expect(successful).toHaveLength(1);
  for (const result of successful) leases.push(result.value);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    status: "rejected",
    reason: { message: expect.stringContaining("another worker") },
  });
});

it("preserves corrupted, incompatible and missing metadata rather than overwriting authored work", async () => {
  const { store: storage } = await store();
  for (const contents of [
    "{broken",
    JSON.stringify({ version: 500 }),
    " ".repeat(4 * 1024 * 1024 + 1),
  ]) {
    const original = input();
    const opened = await hold(storage.open(original));
    await opened.release();
    await writeFile(join(opened.root, "workspace.json"), contents);
    await expect(storage.open(original)).rejects.toThrow("corrupt or incompatible");
    expect(await readFile(join(opened.root, "workspace.json"), "utf8")).toBe(contents);
  }
  const original = input();
  const opened = await hold(storage.open(original));
  await opened.release();
  await rm(join(opened.root, "workspace.json"));
  await expect(storage.open(original)).rejects.toThrow("metadata is missing");
});

it("rejects symlinked roots, records and context without touching their targets", async () => {
  const { root, store: storage } = await store();
  const outside = join(root, "outside");
  await mkdir(outside);
  const link = join(root, "linked");
  await symlink(outside, link);
  await expect(createAppearanceWorkspaceStore(link).open(input())).rejects.toThrow("symlinks");
  const externalFile = join(outside, "protected.json");
  await writeFile(externalFile, "protected");
  for (const name of ["workspace.json", "context.json"]) {
    const original = input();
    const opened = await hold(storage.open(original));
    await opened.release();
    await rm(join(opened.root, name));
    await symlink(externalFile, join(opened.root, name));
    await expect(storage.open(original)).rejects.toThrow(
      name === "workspace.json" ? "corrupt" : "regular files"
    );
  }
  expect(await readFile(externalFile, "utf8")).toBe("protected");
});

it("does not release a lock replaced by another process identity", async () => {
  const { store: storage } = await store();
  const original = input();
  const opened = await hold(storage.open(original));
  const path = join(opened.root, ".lease", "owner.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  const replacement = { ...saved, nonce: randomUUID() };
  await writeFile(path, JSON.stringify(replacement));
  await expect(opened.update({ ...original.request, prompt: "Stale edit" })).rejects.toThrow(
    "another worker"
  );
  await expect(opened.release()).rejects.toThrow("another worker");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(replacement);
  await writeFile(path, JSON.stringify(saved));
});

it("never evicts a foreign host or namespace lock based on its age or PID alone", async () => {
  const { store: storage } = await store();
  const original = input();
  const opened = await hold(storage.open(original));
  const path = join(opened.root, ".lease", "owner.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  for (const replacement of [
    { ...saved, host: `${saved.host}-other`, pid: 2147483647 },
    { ...saved, pidNamespace: "pid:[unknown-namespace]", pid: 2147483647 },
    { ...saved, bootId: "previous-boot", pid: 2147483647 },
  ]) {
    await writeFile(path, JSON.stringify(replacement));
    await expect(storage.open(original)).rejects.toThrow("another worker");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(replacement);
  }
  await writeFile(path, JSON.stringify(saved));
});

it("persists a launch fence before spawn and records its exact child identity", async () => {
  const { store: storage } = await store();
  const opened = await hold(storage.open(input()));
  const path = join(opened.root, ".lease", "owner.json");
  await expect(opened.recordChild(process.pid)).rejects.toThrow("launch must be recorded");
  await opened.beginLaunch();
  expect(JSON.parse(await readFile(path, "utf8")).launch).toEqual({ state: "starting" });
  await expect(opened.beginLaunch()).rejects.toThrow("already launching");
  await expect(opened.recordChild(-1)).rejects.toThrow("PID is invalid");
  await opened.recordChild(process.pid);
  const recorded = JSON.parse(await readFile(path, "utf8"));
  expect(recorded.launch).toMatchObject({ state: "child", pid: process.pid });
  if (process.platform === "linux") {
    expect(recorded.launch.startTime).toMatch(/^\d+$/);
    expect(recorded.launch.bootId).toBe(recorded.bootId);
    expect(recorded.launch.pidNamespace).toBe(recorded.pidNamespace);
  } else {
    expect(recorded.launch.startTime).toBeNull();
  }
});

it("never reopens a crashed parent whose launch or surviving child is unproven", async () => {
  const { store: storage } = await store();
  const original = input();
  const opened = await hold(storage.open(original));
  const path = join(opened.root, ".lease", "owner.json");
  await opened.beginLaunch();
  const launching = JSON.parse(await readFile(path, "utf8"));
  const unrecorded = { ...launching, pid: 2147483647 };
  await writeFile(path, JSON.stringify(unrecorded));
  await expect(storage.open(original)).rejects.toThrow("another worker");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(unrecorded);
  await writeFile(path, JSON.stringify(launching));
  await opened.recordChild(process.pid);
  const recorded = JSON.parse(await readFile(path, "utf8"));
  const orphaned = { ...recorded, pid: 2147483647 };
  await writeFile(path, JSON.stringify(orphaned));
  await expect(storage.open(original)).rejects.toThrow("another worker");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(orphaned);
  const ambiguous = {
    ...orphaned,
    launch: { ...orphaned.launch, pid: 2147483646, startTime: null },
  };
  await writeFile(path, JSON.stringify(ambiguous));
  await expect(storage.open(original)).rejects.toThrow("another worker");
  await writeFile(path, JSON.stringify(recorded));
  await opened.release();
  const resumed = await hold(storage.open(original));
  expect(resumed.id).toBe(opened.id);
});

it.skipIf(process.platform !== "linux")(
  "retains a crashed lease while the recorded child's process group still exists",
  async () => {
    const { store: storage } = await store();
    const original = input();
    const opened = await hold(storage.open(original));
    const path = join(opened.root, ".lease", "owner.json");
    await opened.beginLaunch();
    await opened.recordChild(process.pid);
    const recorded = JSON.parse(await readFile(path, "utf8"));
    const orphaned = {
      ...recorded,
      pid: 2147483647,
      launch: { ...recorded.launch, pid: 2147483646 },
    };
    await writeFile(path, JSON.stringify(orphaned));
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(signal).toBe(0);
      if (pid === -2147483646) return true;
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    });
    try {
      await expect(storage.open(original)).rejects.toThrow("another worker");
      expect(kill).toHaveBeenCalledWith(-2147483646, 0);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(orphaned);
    } finally {
      kill.mockRestore();
      await writeFile(path, JSON.stringify(recorded));
    }
  }
);

it("refuses a live lease held by a separate worker process", async () => {
  const { root } = await store();
  const original = input();
  const module = new URL("./workspaces.ts", import.meta.url).href;
  const script = `import {createAppearanceWorkspaceStore} from ${JSON.stringify(module)};
const workspace = await createAppearanceWorkspaceStore(${JSON.stringify(root)}).open(${JSON.stringify(original)});
console.log('OWNED');
process.once('SIGTERM', async () => {await workspace.release(); process.exit(0)});
setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Worker test startup timed out")), 10_000);
      child.stdout.on("data", (value) => {
        if (String(value).includes("OWNED")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Worker test exited before acquiring ownership"));
      });
    });
    await expect(createAppearanceWorkspaceStore(root).open(original)).rejects.toThrow(
      "another worker"
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
  await hold(createAppearanceWorkspaceStore(root).open(original));
});
