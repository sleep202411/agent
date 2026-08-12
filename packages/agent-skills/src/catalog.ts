import { GENERATED_BUNDLED_CATALOG_SKILLS } from "./catalog.generated.js";
import type {
  BundledCatalogSkill,
  BundledCatalogSkillSource,
  BundledCatalogSkillVersion,
  BundledCatalogSkillVersionSource,
} from "./catalog-types.js";
import { projectSkillVersionChecksum } from "./snapshot.js";

export type {
  BundledCatalogSkill,
  BundledCatalogSkillSource,
  BundledCatalogSkillVersion,
  BundledCatalogSkillVersionSource,
} from "./catalog-types.js";

export const BUNDLED_CATALOG_SKILL_SOURCES: readonly BundledCatalogSkillSource[] =
  GENERATED_BUNDLED_CATALOG_SKILLS;

function normalizePreviewBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const url = new URL(trimmed);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Project Skill preview base URL must be an HTTPS origin/path without credentials, query, or hash"
    );
  }
  return url.toString().replace(/\/$/, "");
}

function previewUrl(baseUrl: string, file: string | null): string | null {
  if (!file) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(file)) {
    throw new Error(`Invalid bundled Project Skill preview filename: ${file}`);
  }
  return `${baseUrl}/${file}`;
}

/**
 * Materializes the Git-governed catalog for one deployment cell. Source
 * manifests contain immutable media filenames; the Nest control plane owns the
 * regional CDN/OSS origin and persists the resulting public URLs.
 */
export function materializeBundledCatalogSkills(input: {
  previewBaseUrl: string;
}): readonly BundledCatalogSkill[] {
  const baseUrl = normalizePreviewBaseUrl(input.previewBaseUrl);
  return BUNDLED_CATALOG_SKILL_SOURCES.map((source) => {
    const manifest = {
      id: source.version.id,
      skillId: source.id,
      version: source.version.version,
      manifestSchemaVersion: source.version.manifestSchemaVersion,
      instructions: source.version.instructions,
      generationPolicy: source.version.generationPolicy,
      configSchema: source.version.configSchema,
      capabilities: source.version.capabilities,
      projectKinds: source.version.projectKinds,
      workbenchModes: source.version.workbenchModes,
      toolIds: source.version.toolIds,
      riskPolicy: source.version.riskPolicy,
      evalSuite: source.version.evalSuite,
    };
    return {
      id: source.id,
      slug: source.slug,
      name: source.name,
      description: source.description,
      translationKey: source.translationKey,
      publisherName: source.publisherName,
      category: source.category,
      kind: source.kind,
      previewUrl: previewUrl(baseUrl, source.previewImageFile),
      previewVideoUrl: previewUrl(baseUrl, source.previewVideoFile),
      version: {
        ...source.version,
        checksum: projectSkillVersionChecksum(manifest),
      },
    };
  });
}
