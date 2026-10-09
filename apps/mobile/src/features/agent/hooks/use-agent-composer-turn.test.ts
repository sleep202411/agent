import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentComposerTurn } from "./use-agent-composer-turn";

const mocks = vi.hoisted(() => ({
  picker: vi.fn(),
  uploadAttachment: vi.fn(),
  listSkills: vi.fn(),
  installations: vi.fn(),
  getStoredString: vi.fn(),
  setStoredString: vi.fn(),
  alert: vi.fn(),
  token: "alice",
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: mocks.picker }));
vi.mock("react-native", () => ({ Alert: { alert: mocks.alert } }));
vi.mock("@/auth/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { id: "alice" },
    session: { region: "com", token: { tokenName: "satoken", tokenValue: mocks.token } },
  }),
}));
vi.mock("@/lib/persistent-storage", () => ({
  getStoredString: mocks.getStoredString,
  setStoredString: mocks.setStoredString,
}));
vi.mock("@/i18n", () => ({ t: (key: string) => key }));
vi.mock("../api/agent-os-api", () => ({ agentOsApi: mocks }));
vi.mock("../api/project-skills-api", () => ({
  listProjectSkillInstallations: mocks.installations,
}));
vi.mock("../api/story-production-api", () => ({ fillMessageTemplate: (text: string) => text }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let hook: ReturnType<typeof useAgentComposerTurn>;
let project = "project-a";
let disabled = false;
function Probe() {
  const observed = useAgentComposerTurn(project, "story", disabled);
  useLayoutEffect(() => {
    hook = observed;
  });
  return null;
}
async function render() {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const picked = (count = 1) => ({
  canceled: false,
  assets: Array.from({ length: count }, (_, i) => ({
    name: `${i}.txt`,
    uri: `file://${i}.txt`,
    size: 10,
  })),
});
const ready = (id: string) => ({ id, filename: `${id}.txt`, status: "ready" });
beforeEach(() => {
  mocks.listSkills.mockResolvedValue({ invocable: [{ id: "skill-a" }] });
  mocks.installations.mockResolvedValue({ installations: [] });
  mocks.getStoredString.mockResolvedValue(null);
  mocks.setStoredString.mockResolvedValue(undefined);
  mocks.picker.mockResolvedValue(picked());
  mocks.uploadAttachment.mockResolvedValue(ready("file-a"));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  project = "project-a";
  disabled = false;
  mocks.token = "alice";
  vi.resetAllMocks();
});
it("claims before opening the picker and recovers a rejected picker without an unhandled error", async () => {
  const picker = deferred<ReturnType<typeof picked>>();
  mocks.picker.mockReturnValueOnce(picker.promise);
  await render();
  let first!: Promise<void>;
  await act(async () => {
    first = hook.pickAndUpload();
    void hook.pickAndUpload();
  });
  expect(mocks.picker).toHaveBeenCalledTimes(1);
  expect(hook.uploading).toBe(true);
  await act(async () => {
    picker.reject(new Error("Picker unavailable"));
    await first;
  });
  expect(mocks.alert).toHaveBeenLastCalledWith(expect.any(String), "Picker unavailable");
  expect(hook.uploading).toBe(false);
  await act(async () => hook.pickAndUpload());
  expect(hook.pendingFiles).toHaveLength(1);
});
it("abandons a picker after credentials change and rejects retained composer callbacks", async () => {
  const picker = deferred<ReturnType<typeof picked>>();
  mocks.picker.mockReturnValueOnce(picker.promise);
  await render();
  const old = hook;
  let first!: Promise<void>;
  await act(async () => {
    first = hook.pickAndUpload();
  });
  mocks.token = "replacement";
  await render();
  await act(async () => {
    picker.resolve(picked());
    await first;
    old.toggleTurnSkill("old");
    old.setPermissionMode("full");
    await old.pickAndUpload();
  });
  expect(mocks.uploadAttachment).not.toHaveBeenCalled();
  expect(hook.turnSkillIds).toEqual([]);
  expect(hook.permissionMode).toBe("smart");
  expect(hook.uploading).toBe(false);
});
it("aborts active uploads and queued batches without clearing replacement work", async () => {
  const firstUpload = deferred<ReturnType<typeof ready>>();
  const replacement = deferred<ReturnType<typeof ready>>();
  mocks.picker.mockResolvedValueOnce(picked(4));
  mocks.uploadAttachment
    .mockReturnValueOnce(firstUpload.promise)
    .mockReturnValueOnce(firstUpload.promise)
    .mockReturnValueOnce(firstUpload.promise)
    .mockReturnValueOnce(replacement.promise);
  await render();
  let first!: Promise<void>;
  await act(async () => {
    first = hook.pickAndUpload();
  });
  const signal = mocks.uploadAttachment.mock.calls[0][2] as AbortSignal;
  project = "project-b";
  await render();
  expect(signal.aborted).toBe(true);
  let next!: Promise<void>;
  await act(async () => {
    next = hook.pickAndUpload();
  });
  await act(async () => {
    firstUpload.reject(new Error("abandoned"));
    await first;
  });
  expect(mocks.uploadAttachment).toHaveBeenCalledTimes(4);
  expect(hook.uploading).toBe(true);
  expect(mocks.alert).not.toHaveBeenCalled();
  await act(async () => {
    replacement.resolve(ready("replacement"));
    await next;
  });
  expect(hook.pendingFiles.map((file) => file.id)).toEqual(["replacement"]);
});
it("retains successful files from partial batches and clears drafts on project changes", async () => {
  mocks.picker.mockResolvedValueOnce(picked(2));
  mocks.uploadAttachment.mockRejectedValueOnce(new Error("Storage rejected file"));
  await render();
  await act(async () => {
    await hook.pickAndUpload();
    hook.toggleTurnSkill("skill-a");
  });
  expect(hook.pendingFiles).toHaveLength(1);
  expect(mocks.alert).toHaveBeenCalledWith(expect.any(String), "Storage rejected file");
  project = "project-b";
  await render();
  expect(hook.pendingFiles).toEqual([]);
  expect(hook.turnSkillIds).toEqual([]);
});
it("cancels skill reads and ignores delayed catalogs from the previous account", async () => {
  const skills = deferred<{ invocable: { id: string }[] }>();
  const installations = deferred<{ installations: unknown[] }>();
  mocks.listSkills.mockReturnValueOnce(skills.promise);
  mocks.installations.mockReturnValueOnce(installations.promise);
  await render();
  const signal = mocks.listSkills.mock.calls[0][2] as AbortSignal;
  const projectSignal = mocks.installations.mock.calls[0][2] as AbortSignal;
  mocks.token = "replacement";
  await render();
  expect(signal.aborted).toBe(true);
  expect(projectSignal.aborted).toBe(true);
  await act(async () => {
    skills.resolve({ invocable: [{ id: "old" }] });
    installations.reject(new Error("old"));
  });
  expect(hook.invocableSkills.map((skill) => skill.id)).toEqual(["skill-a"]);
  expect(hook.projectSkillsError).toBe(false);
});
it("keeps a newer permission choice when stored preference loading finishes late", async () => {
  const saved = deferred<string>();
  mocks.getStoredString.mockReturnValueOnce(saved.promise);
  await render();
  await act(async () => hook.setPermissionMode("ask"));
  await act(async () => saved.resolve("full"));
  expect(hook.permissionMode).toBe("ask");
});
it("stops uploads when editing becomes disabled and allows retry when enabled again", async () => {
  const upload = deferred<ReturnType<typeof ready>>();
  mocks.uploadAttachment.mockReturnValueOnce(upload.promise);
  await render();
  let request!: Promise<void>;
  await act(async () => {
    request = hook.pickAndUpload();
  });
  const signal = mocks.uploadAttachment.mock.calls[0][2] as AbortSignal;
  disabled = true;
  await render();
  expect(signal.aborted).toBe(true);
  expect(hook.uploading).toBe(false);
  disabled = false;
  await render();
  await act(async () => {
    await hook.pickAndUpload();
    upload.resolve(ready("old"));
    await request;
  });
  expect(hook.pendingFiles.map((file) => file.id)).toEqual(["file-a"]);
});

it("captures extras without deleting them and consumes only accepted attachments", async () => {
  await render();
  await act(async () => {
    await hook.pickAndUpload();
    hook.toggleTurnSkill("skill-a");
  });
  const extras = hook.getSendExtras()!;
  expect(hook.pendingFiles).toHaveLength(1);
  mocks.uploadAttachment.mockResolvedValueOnce(ready("file-b"));
  await act(async () => {
    await hook.pickAndUpload();
    hook.commitSendExtras(extras);
  });
  expect(hook.pendingFiles.map((file) => file.id)).toEqual(["file-b"]);
  expect(hook.turnSkillIds).toEqual([]);
});
