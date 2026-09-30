import { beforeEach, expect, it, vi } from "vitest";
import {
  changePlatformSection,
  fetchPlatformSections,
  SectionWriteError,
} from "./platform-sections-api";
const h = vi.hoisted(() => ({
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
const uuid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const projectId = uuid(1),
  workspaceId = uuid(2);
const section = (n: number) => ({
  id: uuid(n),
  projectId,
  title: `Chapter ${n}`,
  rank: n,
  version: 1,
  canvasDocumentId: uuid(n + 100),
});
const sections = [section(3), section(4)];
const snapshot = { projectId, workspaceId, canEdit: true, projectVersion: 7, sections };
const project = { id: projectId, workspaceId, version: 7, status: "active", role: "editor" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/sections") ? snapshot : { project }
  );
});
it("loads scoped chapters with effective editor access", async () => {
  expect(await fetchPlatformSections(projectId, workspaceId, 1)).toEqual(snapshot);
});
it.each(["viewer", undefined])(
  "keeps role %s read-only and rechecks permission before writes",
  async (role) => {
    h.get.mockImplementation(async (path: string) =>
      path.endsWith("/sections") ? snapshot : { project: { ...project, role } }
    );
    expect((await fetchPlatformSections(projectId, workspaceId, 1)).canEdit).toBe(false);
    await expect(
      changePlatformSection(snapshot, { kind: "create", title: "New" }, 1)
    ).rejects.toThrow("permission");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it.each([
  { sections: [sections[0], sections[0]] },
  { sections: [sections[1], sections[0]] },
  { sections: [{ ...sections[0], projectId: workspaceId }] },
  { sections: [sections[0], { ...sections[1], canvasDocumentId: sections[0].canvasDocumentId }] },
  { projectVersion: 8 },
])("rejects mixed or invalid collections %j", async (change) => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/sections") ? { ...snapshot, ...change } : { project }
  );
  await expect(fetchPlatformSections(projectId, workspaceId, 1)).rejects.toThrow();
});
it("rejects foreign workspace and archived projects before fetching sections", async () => {
  for (const change of [{ workspaceId: projectId }, { status: "archived" }]) {
    h.get.mockResolvedValue({ project: { ...project, ...change } });
    await expect(fetchPlatformSections(projectId, workspaceId, 1)).rejects.toThrow("scope");
  }
});
it("pins the reviewed collection and never writes over a changed title", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/sections")
      ? { ...snapshot, sections: [{ ...sections[0], title: "Changed" }, sections[1]] }
      : { project }
  );
  await expect(
    changePlatformSection(snapshot, { kind: "rename", id: sections[0].id, title: "New" }, 1)
  ).rejects.toThrow("Refresh");
  expect(h.patch).not.toHaveBeenCalled();
});
it("creates with trimmed title and project version", async () => {
  h.post.mockResolvedValue({
    projectVersion: 8,
    sections: [...sections, { ...section(5), title: "New" }],
  });
  await changePlatformSection(snapshot, { kind: "create", title: " New " }, 1);
  expect(h.post).toHaveBeenCalledWith(`/projects/${projectId}/sections`, {
    service: "aurora",
    data: { title: "New", expectedProjectVersion: 7 },
  });
});
it("renames with section version", async () => {
  h.patch.mockResolvedValue({
    projectVersion: 8,
    sections: [{ ...sections[0], title: "New", version: 2 }, sections[1]],
  });
  await changePlatformSection(snapshot, { kind: "rename", id: sections[0].id, title: "New" }, 1);
  expect(h.patch).toHaveBeenCalledWith(`/projects/${projectId}/sections/${sections[0].id}`, {
    service: "aurora",
    data: { title: "New", expectedVersion: 1 },
  });
});
it("reorders the complete set and verifies returned order", async () => {
  const ids = sections.map((s) => s.id).reverse();
  h.put.mockResolvedValue({
    projectVersion: 8,
    sections: [...sections].reverse().map((s, rank) => ({ ...s, rank })),
  });
  await changePlatformSection(snapshot, { kind: "reorder", ids }, 1);
  expect(h.put).toHaveBeenCalledWith(`/projects/${projectId}/sections/order`, {
    service: "aurora",
    data: { sectionIds: ids, expectedProjectVersion: 7 },
  });
  h.put.mockResolvedValue({ ...snapshot, projectVersion: 8 });
  await expect(changePlatformSection(snapshot, { kind: "reorder", ids }, 1)).rejects.toBeInstanceOf(
    SectionWriteError
  );
});
it.each([[uuid(3)], [uuid(3), uuid(3)], [uuid(3), uuid(9)]])(
  "rejects incomplete/duplicate/foreign order %j",
  async (...ids) => {
    await expect(changePlatformSection(snapshot, { kind: "reorder", ids }, 1)).rejects.toThrow();
    expect(h.put).not.toHaveBeenCalled();
  }
);
it("archives with both versions and protects the final chapter", async () => {
  h.post.mockResolvedValue({ projectVersion: 8, sections: [sections[1]] });
  await changePlatformSection(snapshot, { kind: "archive", id: sections[0].id }, 1);
  expect(h.post).toHaveBeenCalledWith(`/projects/${projectId}/sections/${sections[0].id}/archive`, {
    service: "aurora",
    data: { expectedProjectVersion: 7, expectedSectionVersion: 1 },
  });
  h.post.mockClear();
  const single = { ...snapshot, sections: [sections[0]] };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/sections") ? single : { project }
  );
  await expect(
    changePlatformSection(single, { kind: "archive", id: sections[0].id }, 1)
  ).rejects.toThrow("at least one");
  expect(h.post).not.toHaveBeenCalled();
});
it("does not write after cancellation or account changes", async () => {
  const c = new AbortController();
  c.abort();
  await expect(
    changePlatformSection(snapshot, { kind: "create", title: "New" }, 1, c.signal)
  ).rejects.toThrow();
  h.generation = 2;
  await expect(
    changePlatformSection(snapshot, { kind: "create", title: "New" }, 1)
  ).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("treats failed or unproven write receipts as uncertain without retrying", async () => {
  for (const raw of [
    snapshot,
    { projectVersion: 8, sections },
    { projectVersion: 8, sections: [...sections, section(5)] },
  ]) {
    h.post.mockResolvedValue(raw);
    await expect(
      changePlatformSection(snapshot, { kind: "create", title: "New" }, 1)
    ).rejects.toBeInstanceOf(SectionWriteError);
  }
  h.post.mockRejectedValue(new Error("offline"));
  await expect(
    changePlatformSection(snapshot, { kind: "create", title: "New" }, 1)
  ).rejects.toThrow("offline");
  expect(h.post).toHaveBeenCalledTimes(4);
});
