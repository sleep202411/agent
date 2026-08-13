import type { SkillGenerationPolicy } from "./types.js";

export interface BundledCatalogSkillVersionSource {
  id: string;
  version: string;
  manifestSchemaVersion: "fizzdragon.skill/v1";
  publishedAt: string;
  instructions: string;
  generationPolicy: SkillGenerationPolicy;
  configSchema: Readonly<Record<string, unknown>>;
  capabilities: readonly string[];
  projectKinds: readonly ("platform" | "story")[];
  workbenchModes: readonly string[];
  toolIds: readonly string[];
  riskPolicy: Readonly<Record<string, unknown>>;
  evalSuite: string;
}

export interface BundledCatalogSkillSource {
  id: string;
  slug: string;
  name: string;
  description: string;
  translationKey: string;
  publisherName: string;
  category: "style" | "production" | "commercial";
  kind: "general" | "image" | "video";
  previewImageFile: string | null;
  previewVideoFile: string | null;
  version: BundledCatalogSkillVersionSource;
}

export interface BundledCatalogSkillVersion extends BundledCatalogSkillVersionSource {
  checksum: string;
}

export interface BundledCatalogSkill extends Omit<
  BundledCatalogSkillSource,
  "previewImageFile" | "previewVideoFile" | "version"
> {
  previewUrl: string | null;
  previewVideoUrl: string | null;
  version: BundledCatalogSkillVersion;
}
