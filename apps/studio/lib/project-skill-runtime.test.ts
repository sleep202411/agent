import { describe, expect, it } from "vitest";
import {
  compatibleProjectSkillInstallations,
  projectSkillVersionSupports,
  composePromptWithProjectSkills,
  extractProjectSkillSelection,
  projectSkillMention,
  resolveEffectiveProjectSkills,
  sanitizeProjectSkillSelection,
} from "./project-skill-runtime";
import type {
  ProjectSkillInstallation,
  ProjectSkillInstallationsResponse,
} from "./project-skills-api";

const DEFAULT_ID = "10000000-0000-7000-8000-000000000001";
const OPTIONAL_ID = "10000000-0000-7000-8000-000000000002";

function installation(input: {
  id: string;
  name: string;
  defaults?: ProjectSkillInstallation["defaults"];
}): ProjectSkillInstallation {
  return {
    id: input.id,
    skillId: input.id.replace(/^1/, "2"),
    slug: input.name.toLowerCase().replaceAll(" ", "-"),
    name: input.name,
    pinnedVersionId: input.id.replace(/^1/, "3"),
    version: {
      id: input.id.replace(/^1/, "3"),
      version: "1.0.0",
      checksum: "a".repeat(64),
      capabilities: ["image_generation", "prompt_authoring"],
      projectKinds: ["platform", "story"],
      workbenchModes: [],
    },
    status: "active",
    revision: 0,
    config: {},
    defaults: input.defaults ?? [],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

const defaultSkill = installation({
  id: DEFAULT_ID,
  name: "Default Style",
  defaults: [{ scope: "image_generation", workbenchMode: null, sourceSurface: null }],
});
const optionalSkill = installation({ id: OPTIONAL_ID, name: "Optional Style" });
const projectSkills: ProjectSkillInstallationsResponse = {
  ownerKind: "platform",
  projectId: "40000000-0000-7000-8000-000000000001",
  projectRevision: 3,
  canManage: true,
  installations: [defaultSkill, optionalSkill],
};

describe("project Skill prompt runtime", () => {
  it("renders project defaults and per-card additions as inline entities", () => {
    const skills = resolveEffectiveProjectSkills({
      projectSkills,
      scope: "image_generation",
      sourceSurface: "fizzstudio-canvas",
      selection: {
        includeInstallationIds: [OPTIONAL_ID],
        anchors: { [DEFAULT_ID]: 0, [OPTIONAL_ID]: 12 },
      },
      labelFor: (item) => item.name ?? "Skill",
      promptLength: 12,
    });

    expect(skills.map((item) => [item.installation.id, item.source])).toEqual([
      [DEFAULT_ID, "project_default"],
      [OPTIONAL_ID, "turn_selection"],
    ]);
    expect(composePromptWithProjectSkills("Create a fox", skills)).toBe(
      "/Default Style Create a fox /Optional Style"
    );
  });

  it("turns chip removal into an explicit default exclusion", () => {
    const defaultMention = projectSkillMention(defaultSkill, "Default Style");
    const optionalMention = projectSkillMention(optionalSkill, "Optional Style");
    const result = extractProjectSkillSelection({
      value: "Create /Optional Style a fox",
      mentions: [defaultMention, optionalMention],
      defaultInstallationIds: new Set([DEFAULT_ID]),
    });

    expect(result.prompt).toBe("Create a fox");
    expect(result.selection).toEqual({
      includeInstallationIds: [OPTIONAL_ID],
      excludeInstallationIds: [DEFAULT_ID],
      anchors: { [OPTIONAL_ID]: 7 },
    });
  });

  it("drops stale overrides after a Skill is uninstalled", () => {
    expect(
      sanitizeProjectSkillSelection(
        {
          includeInstallationIds: [OPTIONAL_ID, "90000000-0000-7000-8000-000000000099"],
          excludeInstallationIds: [DEFAULT_ID],
          anchors: { [OPTIONAL_ID]: 2, missing: 4 },
        },
        [defaultSkill, optionalSkill]
      )
    ).toEqual({
      includeInstallationIds: [OPTIONAL_ID],
      excludeInstallationIds: [DEFAULT_ID],
      anchors: { [OPTIONAL_ID]: 2 },
    });
  });
});

it("filters installed Skills by project kind and workbench restrictions", () => {
  const restricted = {
    ...optionalSkill,
    version: {
      ...optionalSkill.version,
      projectKinds: ["story" as const],
      workbenchModes: ["storyboard"],
    },
  };
  const collection = { ...projectSkills, installations: [restricted] };
  expect(compatibleProjectSkillInstallations(collection, "image_generation", "storyboard")).toEqual(
    []
  );
  const story = { ...collection, ownerKind: "story" as const };
  expect(compatibleProjectSkillInstallations(story, "image_generation")).toEqual([]);
  expect(compatibleProjectSkillInstallations(story, "image_generation", "canvas")).toEqual([]);
  expect(compatibleProjectSkillInstallations(story, "image_generation", "storyboard")).toEqual([
    restricted,
  ]);
  expect(
    resolveEffectiveProjectSkills({
      projectSkills: story,
      scope: "image_generation",
      workbenchMode: "storyboard",
      sourceSurface: "story-studio-workbench",
      selection: { includeInstallationIds: [OPTIONAL_ID] },
      labelFor: (item) => item.name!,
      promptLength: 0,
    })
  ).toHaveLength(1);
});
it("uses unrestricted versions only for supported generation modalities", () => {
  const version = { ...optionalSkill.version, projectKinds: [] };
  expect(projectSkillVersionSupports(version, "image_generation", "platform")).toBe(true);
  expect(projectSkillVersionSupports(version, "video_generation", "platform")).toBe(false);
  expect(projectSkillVersionSupports(null, "image_generation", "platform")).toBe(false);
});
