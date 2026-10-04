import { beforeEach, expect, it, vi } from "vitest";
import { storyLibraryActions } from "./story-library-actions";
const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "00000000-0000-4000-8000-000000000001";
const scope = { projectId: id, generation: 1 };
const project = {
  id,
  title: "Before",
  summary: null,
  status: "active",
  projectVersion: 3,
  capabilities: ["story.read", "story.edit", "story.admin"],
};
const edit = {
  kind: "edit" as const,
  clientKey: id,
  expectedProjectVersion: 3,
  fields: { title: "After", summary: "Summary" },
};
const archive = { kind: "archive" as const, clientKey: id, expectedProjectVersion: 3 };
let raw: string | null;
const client = () =>
  storyLibraryActions(scope, "owner", {
    read: () => raw,
    write: (v) => {
      raw = v;
    },
  });
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  raw = null;
  h.generation = 1;
  h.get.mockResolvedValue(project);
  h.patch.mockResolvedValue({ ...project, ...edit.fields, projectVersion: 4 });
  h.post.mockResolvedValue({ ...project, status: "archived", projectVersion: 4 });
});
it("updates only trimmed project metadata using its version", async () => {
  const c = client();
  await c.save({ ...edit, fields: { title: " After ", summary: " Summary " } }, signal());
  expect(h.patch).toHaveBeenCalledWith(
    `/story-projects/${id}`,
    expect.objectContaining({
      retry: false,
      data: { expectedProjectVersion: 3, title: "After", summary: "Summary" },
    })
  );
  expect(c.read()).toBeNull();
});
it("archives with admin permission and verifies the archived receipt", async () => {
  await client().save(archive, signal());
  expect(h.post).toHaveBeenCalledWith(
    `/story-projects/${id}/archive`,
    expect.objectContaining({ data: { expectedProjectVersion: 3 } })
  );
});
it("reconciles lost edit and archive replies without repeating writes", async () => {
  for (const command of [edit, archive]) {
    raw = null;
    h.get.mockResolvedValue(project);
    const writer = command.kind === "edit" ? h.patch : h.post;
    writer.mockRejectedValueOnce(Error("Lost reply"));
    const c = client();
    await expect(c.save(command, signal())).rejects.toThrow("Lost reply");
    h.get.mockResolvedValue(
      command.kind === "edit"
        ? { ...project, ...edit.fields, projectVersion: 4 }
        : { ...project, status: "archived", projectVersion: 4 }
    );
    expect((await c.load(signal())).applied).toBe(true);
    expect(c.read()).toBeNull();
  }
  expect(h.patch).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("retains pending input and refuses to overwrite a newer version", async () => {
  h.get.mockResolvedValue({ ...project, projectVersion: 4 });
  const c = client();
  await expect(c.save(edit, signal())).rejects.toThrow("project changed");
  expect(c.read()).toEqual(edit);
  expect(h.patch).not.toHaveBeenCalled();
});
it("does not grant archive permission to ordinary editors", async () => {
  h.get.mockResolvedValue({ ...project, capabilities: ["story.read", "story.edit"] });
  await expect(client().save(archive, signal())).rejects.toThrow("not permitted");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects invalid metadata and unverifiable receipts", async () => {
  for (const title of [" ", "x".repeat(161)])
    await expect(
      client().save({ ...edit, fields: { ...edit.fields, title } }, signal())
    ).rejects.toThrow();
  await expect(
    client().save({ ...edit, fields: { ...edit.fields, summary: "x".repeat(2001) } }, signal())
  ).rejects.toThrow();
  expect(h.patch).not.toHaveBeenCalled();
  h.patch.mockResolvedValue({ ...project, projectVersion: 4 });
  await expect(client().save(edit, signal())).rejects.toThrow("verified");
  expect(client().read()).toEqual(edit);
});
it("rejects account changes and cross-project receipts", async () => {
  h.generation = 2;
  await expect(client().save(edit, signal())).rejects.toThrow("expired");
  h.generation = 1;
  h.get.mockResolvedValue({ ...project, id: "00000000-0000-4000-8000-000000000002" });
  await expect(client().load(signal())).rejects.toThrow("identity");
  expect(h.patch).not.toHaveBeenCalled();
});

const source = "00000000-0000-4000-8000-000000000002";
const target = "00000000-0000-4000-8000-000000000003";
const move = {
  kind: "move" as const,
  clientKey: id,
  expectedProjectVersion: 3,
  expectedWorkspaceId: source,
  targetWorkspaceId: target,
};
function moveFixture() {
  let p = { ...project, canMove: true, workspaceId: source };
  h.get.mockImplementation(async (path) =>
    path.startsWith("/workspaces/")
      ? { workspace: { id: target, role: "admin", accessScope: "workspace", status: "active" } }
      : p
  );
  h.post.mockImplementation(async () => {
    p = { ...p, workspaceId: target, projectVersion: 4 };
    return { projectId: id, workspaceId: target, projectVersion: 4 };
  });
}
it("moves only with current project and destination permissions, then reads the moved project", async () => {
  moveFixture();
  const c = client();
  expect((await c.save(move, signal())).workspaceId).toBe(target);
  expect(h.post).toHaveBeenCalledWith(
    `/story-projects/${id}/move`,
    expect.objectContaining({
      retry: false,
      data: { expectedProjectVersion: 3, expectedWorkspaceId: source, targetWorkspaceId: target },
    })
  );
  expect(c.read()).toBeNull();
});
it("reconciles a lost move response without moving twice and returns the destination", async () => {
  moveFixture();
  h.post.mockRejectedValueOnce(Error("Lost move reply"));
  const c = client();
  await expect(c.save(move, signal())).rejects.toThrow("Lost move reply");
  h.get.mockResolvedValue({ ...project, canMove: true, workspaceId: target, projectVersion: 4 });
  const result = await c.load(signal());
  expect(result.movedWorkspaceId).toBe(target);
  expect(c.read()).toBeNull();
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects non-owner, changed source, same destination and newer project versions", async () => {
  for (const change of [{ canMove: false }, { workspaceId: target }, { projectVersion: 4 }]) {
    raw = null;
    h.post.mockClear();
    h.get.mockResolvedValue({ ...project, canMove: true, workspaceId: source, ...change });
    await expect(client().save(move, signal())).rejects.toThrow();
    expect(h.post).not.toHaveBeenCalled();
  }
  raw = null;
  moveFixture();
  await expect(client().save({ ...move, targetWorkspaceId: source }, signal())).rejects.toThrow(
    "workspace changed"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects restricted, revoked and mismatched destination responses", async () => {
  for (const change of [
    { role: "editor" },
    { accessScope: "project_only" },
    { status: "suspended" },
    { id: source },
  ]) {
    raw = null;
    h.post.mockClear();
    h.get.mockImplementation(async (path) =>
      path.startsWith("/workspaces/")
        ? {
            workspace: {
              id: target,
              role: "owner",
              accessScope: "workspace",
              status: "active",
              ...change,
            },
          }
        : { ...project, canMove: true, workspaceId: source }
    );
    await expect(client().save(move, signal())).rejects.toThrow("owner or admin");
    expect(h.post).not.toHaveBeenCalled();
  }
});
it("retains a failed or unverifiable move for exact retry", async () => {
  for (const response of [
    { projectId: target, workspaceId: target, projectVersion: 4 },
    { projectId: id, workspaceId: source, projectVersion: 4 },
    { projectId: id, workspaceId: target, projectVersion: 3 },
  ]) {
    raw = null;
    moveFixture();
    h.post.mockResolvedValue(response);
    await expect(client().save(move, signal())).rejects.toThrow("verified");
    expect(client().read()).toEqual(move);
  }
  raw = null;
  moveFixture();
  h.post.mockRejectedValue(Error("Finish active generation first"));
  await expect(client().save(move, signal())).rejects.toThrow("Finish active generation first");
  expect(client().read()).toEqual(move);
});
