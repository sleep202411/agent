import { beforeEach, expect, it, vi } from "vitest";
import {
  loadProjectSkills,
  skillRows,
  skillSelection,
  skillSnapshot,
  toggleSkill,
  unavailableSkillIds,
} from "./project-skills";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const project = {
  id,
  projectId: id,
  workspaceId: other,
  kind: "platform" as const,
  title: "Project",
  canGenerate: true,
};
const row = () => ({
  id,
  name: "Lighting",
  pinnedVersionId: other,
  status: "active" as const,
  revision: 1,
  version: {
    version: "1.0",
    checksum: "sha",
    capabilities: ["image_generation"],
    projectKinds: ["platform"],
    workbenchModes: [] as string[],
  },
  defaults: [
    {
      scope: "image_generation",
      sourceSurface: null as string | null,
      workbenchMode: null as string | null,
    },
  ],
});
const data = () => ({
  ownerKind: "platform" as const,
  projectId: id,
  projectRevision: 1,
  installations: [row()],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(data());
});
it("matches server defaults, owner kinds, generation capabilities and mode restrictions", () => {
  const v = data();
  expect(skillRows(v, "image")[0]).toMatchObject({ selected: true, defaultEnabled: true });
  expect(skillRows(v, "video")).toEqual([]);
  v.installations[0]!.defaults[0]!.sourceSurface = "fizzstudio-canvas";
  expect(skillRows(v, "image")[0]!.selected).toBe(false);
  expect(skillRows(v, "image", { includeInstallationIds: [id] })[0]!.selected).toBe(true);
  v.installations[0]!.version.workbenchModes = ["storyboard"];
  expect(skillRows(v, "image")).toEqual([]);
  v.installations[0]!.version.workbenchModes = [];
  v.installations[0]!.version.projectKinds = ["story"];
  expect(skillRows(v, "image")).toEqual([]);
});
it("persists explicit choices, rejects contradictory/oversized choices and exposes removed selections", () => {
  const off = toggleSkill(undefined, id, false);
  expect(skillRows(data(), "image", off)[0]!.selected).toBe(false);
  const on = toggleSkill(off, id, true);
  expect(on).toEqual({ includeInstallationIds: [id], excludeInstallationIds: [] });
  expect(unavailableSkillIds(data(), "video", on)).toEqual([id]);
  expect(unavailableSkillIds({ ...data(), installations: [] }, "image", off)).toEqual([id]);
  expect(
    skillSelection.safeParse({ includeInstallationIds: [id], excludeInstallationIds: [id] }).success
  ).toBe(false);
  expect(skillSelection.safeParse({ includeInstallationIds: Array(33).fill(id) }).success).toBe(
    false
  );
});
it("validates project identity and session on both sides of the read", async () => {
  await expect(loadProjectSkills(project, 1, new AbortController().signal)).resolves.toEqual(
    data()
  );
  expect(h.get).toHaveBeenCalledWith(
    `/project-skills/platform/${id}/installations`,
    expect.objectContaining({ retry: false })
  );
  h.get.mockResolvedValue({ ...data(), ownerKind: "story" });
  await expect(loadProjectSkills(project, 1, new AbortController().signal)).rejects.toThrow(
    "selected project"
  );
  h.get.mockImplementation(async () => {
    h.generation++;
    return data();
  });
  await expect(loadProjectSkills(project, 1, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
});
it("detects changed installed versions and default settings", () => {
  const a = data(),
    b = data();
  expect(skillSnapshot(a)).toBe(skillSnapshot(b));
  b.installations[0]!.version.checksum = "new";
  expect(skillSnapshot(a)).not.toBe(skillSnapshot(b));
});

it("selects canvas defaults without inheriting AI Lab defaults", () => {
  const v = data();
  v.installations[0]!.defaults[0]!.sourceSurface = "fizzstudio-canvas";
  expect(skillRows(v, "image", undefined, "fizzstudio-canvas")[0]!.selected).toBe(true);
  expect(skillRows(v, "image")[0]!.selected).toBe(false);
  const excluded = toggleSkill(undefined, id, false);
  expect(skillRows(v, "image", excluded, "fizzstudio-canvas")[0]!.selected).toBe(false);
  v.installations[0]!.defaults[0]!.sourceSurface = "ai-lab";
  expect(skillRows(v, "image", undefined, "fizzstudio-canvas")[0]!.selected).toBe(false);
  v.installations[0]!.defaults[0]!.sourceSurface = null;
  expect(skillRows(v, "image", undefined, "fizzstudio-canvas")[0]!.selected).toBe(true);
  v.installations[0]!.version.workbenchModes = ["storyboard"];
  expect(skillRows(v, "image", undefined, "fizzstudio-canvas")).toEqual([]);
  expect(
    unavailableSkillIds(v, "image", { includeInstallationIds: [id] }, "fizzstudio-canvas")
  ).toEqual([id]);
});
it("rejects both included and excluded audio Skills before the server rejects a paid request", () => {
  const v = data();
  v.installations[0]!.version.capabilities = ["audio_generation"];
  v.installations[0]!.defaults[0]!.scope = "audio_generation";
  for (const surface of ["ai-lab", "fizzstudio-canvas"] as const) {
    expect(skillRows(v, "audio", undefined, surface)).toEqual([]);
    expect(unavailableSkillIds(v, "audio", undefined, surface)).toEqual([]);
    expect(unavailableSkillIds(v, "audio", { includeInstallationIds: [id] }, surface)).toEqual([
      id,
    ]);
    expect(unavailableSkillIds(v, "audio", { excludeInstallationIds: [id] }, surface)).toEqual([
      id,
    ]);
  }
});
