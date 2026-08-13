import { describe, expect, it } from "vitest";

import {
  BUNDLED_CATALOG_SKILL_SOURCES,
  materializeBundledCatalogSkills,
  projectSkillVersionChecksum,
} from "./index.js";

const GLOBAL_PREVIEW_BASE_URL = "https://r2.fizzdragon.com/product-skills/previews/v1";

describe("bundled Project Skill catalog", () => {
  it("uses unique stable identities for every catalog item and immutable version", () => {
    expect(BUNDLED_CATALOG_SKILL_SOURCES).toHaveLength(28);
    expect(new Set(BUNDLED_CATALOG_SKILL_SOURCES.map((skill) => skill.id)).size).toBe(28);
    expect(new Set(BUNDLED_CATALOG_SKILL_SOURCES.map((skill) => skill.slug)).size).toBe(28);
    expect(new Set(BUNDLED_CATALOG_SKILL_SOURCES.map((skill) => skill.version.id)).size).toBe(28);
  });

  it("derives each published checksum from the complete canonical runtime manifest", () => {
    const catalog = materializeBundledCatalogSkills({
      previewBaseUrl: GLOBAL_PREVIEW_BASE_URL,
    });
    for (const skill of catalog) {
      const { checksum, ...versionWithPublishedAt } = skill.version;
      const { publishedAt: _publishedAt, ...version } = versionWithPublishedAt;
      void _publishedAt;
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(checksum).toBe(
        projectSkillVersionChecksum({
          ...version,
          skillId: skill.id,
        })
      );
    }
  });

  it("changes the checksum when executable guidance changes", () => {
    const [skill] = materializeBundledCatalogSkills({
      previewBaseUrl: GLOBAL_PREVIEW_BASE_URL,
    });
    const { checksum, ...versionWithPublishedAt } = skill.version;
    const { publishedAt: _publishedAt, ...version } = versionWithPublishedAt;
    void _publishedAt;
    const changed = projectSkillVersionChecksum({
      ...version,
      skillId: skill.id,
      instructions: `${version.instructions}\nAdditional constraint`,
    });
    expect(changed).not.toBe(checksum);
  });

  it("keeps analysis-only Skills out of paid generation scopes", () => {
    const diagnostic = BUNDLED_CATALOG_SKILL_SOURCES.find(
      (skill) => skill.slug === "short-video-diagnostic"
    );
    const subtitles = BUNDLED_CATALOG_SKILL_SOURCES.find(
      (skill) => skill.slug === "intelligent-subtitle-director"
    );

    expect(diagnostic?.version.capabilities).toEqual(["agent_prompt", "qa"]);
    expect(diagnostic?.version.generationPolicy.video).toBeUndefined();
    expect(subtitles?.version.capabilities).toEqual(["agent_prompt", "prompt_authoring", "qa"]);
    expect(subtitles?.version.generationPolicy.video).toBeUndefined();
  });

  it("publishes detail videos only for Skills with real video-generation policy", () => {
    const videos = BUNDLED_CATALOG_SKILL_SOURCES.filter((skill) => skill.previewVideoFile);
    expect(videos).toHaveLength(7);
    for (const skill of videos) {
      expect(skill.version.capabilities).toContain("video_generation");
      expect(skill.version.generationPolicy.video).toBeDefined();
    }
  });

  it("materializes regional preview origins without changing version identity", () => {
    const global = materializeBundledCatalogSkills({
      previewBaseUrl: GLOBAL_PREVIEW_BASE_URL,
    });
    const cn = materializeBundledCatalogSkills({
      previewBaseUrl: "https://media.fizzspace.cn/product-skills/previews/v1/",
    });
    expect(global[0].previewUrl).toBe(
      `${GLOBAL_PREVIEW_BASE_URL}/${BUNDLED_CATALOG_SKILL_SOURCES[0].previewImageFile}`
    );
    expect(cn[0].previewUrl).toBe(
      `https://media.fizzspace.cn/product-skills/previews/v1/${BUNDLED_CATALOG_SKILL_SOURCES[0].previewImageFile}`
    );
    expect(cn[0].version.checksum).toBe(global[0].version.checksum);
  });

  it("rejects unsafe preview origins", () => {
    expect(() =>
      materializeBundledCatalogSkills({ previewBaseUrl: "http://example.com/previews" })
    ).toThrow(/HTTPS/);
    expect(() =>
      materializeBundledCatalogSkills({
        previewBaseUrl: "https://user:secret@example.com/previews",
      })
    ).toThrow(/without credentials/);
  });
});
