import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, readlink, rename, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, parse, relative, sep } from "node:path";
import { z } from "zod";
import {
  AppearanceDesignRequestSchema,
  AppearanceWebScopeSchema,
  type AppearanceDesignRequest,
} from "@repo/game-agent-protocol";
import { validateGameAgentWorkspaceRoot } from "../config.js";
import { reconcileAppearanceWebContext } from "./web-context.js";

const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const InputSchema = z
  .object({
    scope: AppearanceWebScopeSchema,
    key: z.string().uuid(),
    request: AppearanceDesignRequestSchema,
  })
  .strict();
const RecordSchema = z
  .object({
    version: z.literal(2),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    id: z.string().uuid(),
    sessionId: z
      .string()
      .regex(/^session-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
    request: AppearanceDesignRequestSchema,
  })
  .strict();
const OwnerSchema = z
  .object({
    version: z.literal(1),
    nonce: z.string().uuid(),
    pid: z.number().int().positive(),
    host: z.string().min(1).max(256),
    bootId: z.string().max(128).nullable(),
    pidNamespace: z.string().max(128).nullable(),
    launch: z.discriminatedUnion("state", [
      z.object({ state: z.literal("idle") }).strict(),
      z.object({ state: z.literal("starting") }).strict(),
      z
        .object({
          state: z.literal("child"),
          pid: z.number().int().positive(),
          startTime: z.string().regex(/^\d+$/).max(32).nullable(),
          bootId: z.string().max(128).nullable(),
          pidNamespace: z.string().max(128).nullable(),
        })
        .strict(),
    ]),
  })
  .strict();
type WorkspaceRecord = z.infer<typeof RecordSchema>;
type LeaseOwner = z.infer<typeof OwnerSchema>;
export type AppearanceWorkspaceInput = z.infer<typeof InputSchema>;
export interface AppearanceWorkspace {
  readonly root: string;
  readonly id: string;
  readonly sessionId: string;
  readonly request: AppearanceDesignRequest;
  update(request: AppearanceDesignRequest): Promise<AppearanceDesignRequest>;
  /** Persist before spawn so a crash cannot silently orphan a writer. */
  beginLaunch(): Promise<void>;
  /** Record immediately after spawn; Linux start identity fences stale owners. */
  recordChild(pid: number): Promise<void>;
  /** Releases compute ownership. Authored files and official history are retained. */
  release(): Promise<void>;
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function busy() {
  return new Error("Appearance workspace is owned by another worker. Reconnect after it closes.");
}

async function syncDirectory(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

/** Reject symlinked ancestors too: an opaque leaf alone does not contain filesystem paths. */
async function directory(path: string, create = false) {
  const base = parse(path).root;
  let cursor = base;
  for (const part of relative(base, path).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if (!create || !isMissing(error)) throw error;
      await mkdir(cursor, { mode: 0o700 }).catch((mkdirError: NodeJS.ErrnoException) => {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      });
      info = await lstat(cursor);
      await syncDirectory(dirname(cursor));
    }
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(
        "Appearance workspace directories cannot contain symlinks or non-directories."
      );
  }
}

async function assertFile(path: string) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error("Appearance workspace records must be regular files.");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function readJson(path: string, limit = MAX_METADATA_BYTES): Promise<unknown> {
  await assertFile(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit)
      throw new Error("Appearance workspace record is invalid or exceeds its size limit.");
    // Read at most the bound even if a damaged file grows after stat().
    const buffer = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit || bytesRead > info.size)
      throw new Error("Appearance workspace record changed while being read.");
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await file.close();
  }
}

async function atomicJson(root: string, name: string, value: unknown, limit = MAX_METADATA_BYTES) {
  await directory(root);
  const destination = join(root, name);
  await assertFile(destination);
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > limit)
    throw new Error("Appearance workspace record exceeds its size limit.");
  const temporary = join(root, `.write-${randomUUID()}`);
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  try {
    try {
      await file.writeFile(data, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    await syncDirectory(root);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function owner(): Promise<LeaseOwner> {
  // No timeout-based stealing: long model calls and suspended pods can be alive.
  const [bootId, pidNamespace] = await Promise.all([
    readFile("/proc/sys/kernel/random/boot_id", "utf8")
      .then((value) => value.trim())
      .catch(() => null),
    readlink("/proc/self/ns/pid").catch(() => null),
  ]);
  return {
    version: 1,
    nonce: randomUUID(),
    pid: process.pid,
    host: hostname(),
    bootId,
    pidNamespace,
    launch: { state: "idle" },
  };
}

function provablyDead(previous: LeaseOwner, current: LeaseOwner) {
  if (
    !current.bootId ||
    !current.pidNamespace ||
    previous.host !== current.host ||
    previous.bootId !== current.bootId ||
    previous.pidNamespace !== current.pidNamespace
  )
    return false;
  try {
    process.kill(previous.pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
  }
  if (previous.launch.state === "starting") return false;
  if (previous.launch.state === "idle") return true;
  const child = previous.launch;
  if (
    !child.startTime ||
    child.bootId !== current.bootId ||
    child.pidNamespace !== current.pidNamespace
  )
    return false;
  try {
    // A live or reused PID remains ambiguous and must never be killed/stolen.
    process.kill(child.pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
  }
  try {
    process.kill(-child.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function childIdentity(pid: number, parent: LeaseOwner) {
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error("Appearance runtime child PID is invalid.");
  const [stat, pidNamespace] = await Promise.all([
    readFile(`/proc/${pid}/stat`, "utf8").catch(() => null),
    readlink(`/proc/${pid}/ns/pid`).catch(() => null),
  ]);
  // Linux comm may itself contain spaces/parentheses; fields after the final ')'
  // begin with field 3. Starttime is field 22, in kernel clock ticks since boot.
  const fields = stat
    ?.slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  const startTime = fields?.[19] && /^\d+$/.test(fields[19]) ? fields[19] : null;
  if (process.platform === "linux" && (!startTime || !pidNamespace || !parent.bootId))
    throw new Error("Appearance runtime child process identity could not be verified.");
  return { state: "child" as const, pid, startTime, bootId: parent.bootId, pidNamespace };
}

async function acquire(root: string) {
  const path = join(root, ".lease");
  let current = await owner();
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await directory(path);
    let previous: LeaseOwner;
    try {
      previous = OwnerSchema.parse(await readJson(join(path, "owner.json"), 8192));
    } catch {
      // An incomplete initializer or unknown record cannot be safely evicted.
      throw busy();
    }
    if (!provablyDead(previous, current)) throw busy();
    // Only one reaper can examine/remove a dead lease. A second reaper must
    // never accidentally rename a new owner's lock after this one is removed.
    try {
      await mkdir(join(path, "recovery"), { mode: 0o700 });
    } catch {
      throw busy();
    }
    const checked = OwnerSchema.parse(await readJson(join(path, "owner.json"), 8192));
    if (checked.nonce !== previous.nonce || !provablyDead(checked, current)) throw busy();
    const retired = join(root, `.retired-lease-${randomUUID()}`);
    await rename(path, retired);
    await rm(retired, { recursive: true, force: true });
    try {
      await mkdir(path, { mode: 0o700 });
    } catch {
      throw busy();
    }
  }
  try {
    await atomicJson(path, "owner.json", current, 8192);
    await syncDirectory(root);
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  return {
    async assert() {
      await directory(path);
      const actual = OwnerSchema.parse(await readJson(join(path, "owner.json"), 8192));
      if (actual.nonce !== current.nonce || actual.pid !== current.pid) throw busy();
    },
    async release() {
      await this.assert();
      const retired = join(root, `.retired-lease-${randomUUID()}`);
      await rename(path, retired);
      await rm(retired, { recursive: true, force: true });
      await syncDirectory(root);
    },
    async beginLaunch() {
      await this.assert();
      if (current.launch.state !== "idle")
        throw new Error("Appearance workspace runtime is already launching.");
      current = { ...current, launch: { state: "starting" } };
      await atomicJson(path, "owner.json", current, 8192);
    },
    async recordChild(pid: number) {
      await this.assert();
      if (current.launch.state !== "starting")
        throw new Error("Appearance runtime launch must be recorded before its child PID.");
      current = { ...current, launch: await childIdentity(pid, current) };
      await atomicJson(path, "owner.json", current, 8192);
    },
  };
}

/** One RWO persistent volume / one worker replica. Unknown foreign locks fail closed. */
export function createAppearanceWorkspaceStore(workspaceRoot: string) {
  validateGameAgentWorkspaceRoot(workspaceRoot);
  return {
    /** Fail readiness before admitting sessions when the configured volume cannot persist writes. */
    async initialize() {
      await directory(workspaceRoot, true);
      const probe = `.probe-${randomUUID()}`;
      try {
        await atomicJson(workspaceRoot, probe, { version: 1 });
      } finally {
        await rm(join(workspaceRoot, probe), { force: true });
      }
      await syncDirectory(workspaceRoot);
    },
    async open(value: AppearanceWorkspaceInput): Promise<AppearanceWorkspace> {
      const input = InputSchema.parse(value);
      const identity = createHash("sha256")
        .update(
          JSON.stringify([
            input.scope.userId,
            input.scope.projectId.toLowerCase(),
            input.key.toLowerCase(),
            input.request.locale,
          ])
        )
        .digest("hex");
      await directory(workspaceRoot, true);
      const root = join(workspaceRoot, identity);
      await directory(root, true);
      const lease = await acquire(root);
      let record: WorkspaceRecord;
      try {
        try {
          record = RecordSchema.parse(await readJson(join(root, "workspace.json")));
          if (record.identity !== identity || record.request.locale !== input.request.locale)
            throw new Error("Appearance workspace identity does not match its saved record.");
        } catch (error) {
          if (!isMissing(error))
            throw new Error(
              "Appearance workspace metadata is corrupt or incompatible; saved work was preserved.",
              { cause: error }
            );
          if ((await readdir(root)).some((name) => name !== ".lease"))
            throw new Error(
              "Appearance workspace metadata is missing from an existing workspace; saved work was preserved."
            );
          record = {
            version: 2,
            identity,
            id: randomUUID(),
            sessionId: `session-${randomUUID()}`,
            request: input.request,
          };
        }
        record = {
          ...record,
          request: reconcileAppearanceWebContext(record.request, input.request),
        };
        await atomicJson(root, "workspace.json", record);
        await atomicJson(root, "context.json", record.request);
      } catch (error) {
        await lease.release();
        throw error;
      }
      let released = false;
      let tail = Promise.resolve();
      function serial<T>(operation: () => Promise<T>): Promise<T> {
        const pending = tail.then(operation);
        tail = pending.then(
          () => undefined,
          () => undefined
        );
        return pending;
      }
      return {
        root,
        id: record.id,
        sessionId: record.sessionId,
        get request() {
          return structuredClone(record.request);
        },
        update(next) {
          const request = AppearanceDesignRequestSchema.parse(next);
          return serial(async () => {
            if (released) throw new Error("Appearance workspace has been released.");
            if (request.locale !== input.request.locale)
              throw new Error("Appearance workspace locale cannot change.");
            await lease.assert();
            const reconciled = reconcileAppearanceWebContext(record.request, request);
            const updated = { ...record, request: reconciled };
            await atomicJson(root, "workspace.json", updated);
            record = updated;
            await atomicJson(root, "context.json", record.request);
            return structuredClone(record.request);
          });
        },
        beginLaunch() {
          return serial(async () => {
            if (released) throw new Error("Appearance workspace has been released.");
            await lease.beginLaunch();
          });
        },
        recordChild(pid) {
          return serial(async () => {
            if (released) throw new Error("Appearance workspace has been released.");
            await lease.recordChild(pid);
          });
        },
        release() {
          return serial(async () => {
            if (released) return;
            await lease.release();
            released = true;
          });
        },
      };
    },
  };
}
