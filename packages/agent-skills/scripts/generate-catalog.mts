import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const packageDirectory = resolve(scriptDirectory, "..");
const catalogDirectory = resolve(packageDirectory, "catalog");
const generatedFile = resolve(packageDirectory, "src/catalog.generated.ts");

const scopeSchema = z.enum([
  "agent_prompt",
  "prompt_authoring",
  "image_generation",
  "video_generation",
  "preflight",
  "qa",
]);
const fileSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/)
  .nullable();
const sourceManifestSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal("fizzdragon.catalog-source/v1"),
    skillId: z.string().uuid(),
    catalogOrder: z.number().int().positive(),
    displayDescription: z.string().trim().min(1).max(2_000),
    translationKey: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),
    publisherName: z.string().trim().min(1).max(160),
    category: z.enum(["style", "production", "commercial"]),
    kind: z.enum(["general", "image", "video"]),
    visibility: z.literal("public"),
    status: z.literal("published"),
    preview: z.object({ image: fileSchema, video: fileSchema }).strict(),
    version: z
      .object({
        id: z.string().uuid(),
        version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/),
        manifestSchemaVersion: z.literal("fizzdragon.skill/v1"),
        publishedAt: z.string().datetime({ offset: true }),
        capabilities: z.array(scopeSchema).min(1).max(6),
        projectKinds: z
          .array(z.enum(["platform", "story"]))
          .min(1)
          .max(2),
        workbenchModes: z.array(z.string().trim().min(1).max(64)).max(32),
        toolIds: z.array(z.string().trim().min(1).max(128)).max(64),
        configSchema: z.record(z.string(), z.unknown()),
        riskPolicy: z
          .object({ allowsWrite: z.boolean(), allowsPaidGeneration: z.boolean() })
          .strict(),
        evalSuite: z.string().trim().min(1).max(256),
      })
      .strict(),
  })
  .strict();

const frontmatterSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(64),
    description: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .refine((value) => !/[<>]/.test(value), {
        message: "Skill descriptions may not contain angle brackets",
      }),
  })
  .strict();
function parseFrontmatter(markdown: string, directory: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
  if (!match) throw new Error(`${directory}/SKILL.md requires YAML frontmatter`);
  const body = match[2].trim();
  const titleMatch = body.match(/^#\s+([^\r\n]+)(?:\r?\n|$)/);
  if (!titleMatch) {
    throw new Error(`${directory}/SKILL.md body must start with one level-one display title`);
  }
  const displayName = titleMatch[1].trim();
  if (!displayName || displayName.length > 120) {
    throw new Error(`${directory}/SKILL.md display title must contain 1-120 characters`);
  }
  return {
    frontmatter: frontmatterSchema.parse(parseYaml(match[1])),
    body,
    displayName,
  };
}

function policy(markdown: string, name: "prompt" | "image" | "video"): string | undefined {
  const start = `<!-- fizzdragon:policy:${name}:start -->`;
  const end = `<!-- fizzdragon:policy:${name}:end -->`;
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);
  if (startIndex < 0 && endIndex < 0) return undefined;
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Malformed ${name} policy markers`);
  }
  const value = markdown.slice(startIndex + start.length, endIndex).trim();
  if (!value || value.length > 20_000)
    throw new Error(`${name} policy must contain 1-20,000 characters`);
  return value;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate values`);
}

const directories = (await readdir(catalogDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const catalog = [];

for (const directory of directories) {
  const skillDirectory = resolve(catalogDirectory, directory);
  const metadata = sourceManifestSchema.parse(
    JSON.parse(await readFile(resolve(skillDirectory, "fizzdragon.json"), "utf8"))
  );
  const { frontmatter, body, displayName } = parseFrontmatter(
    await readFile(resolve(skillDirectory, "SKILL.md"), "utf8"),
    directory
  );
  if (directory !== frontmatter.name)
    throw new Error(`${directory}: folder and frontmatter name differ`);
  unique(metadata.version.capabilities, `${directory} capabilities`);
  unique(metadata.version.projectKinds, `${directory} projectKinds`);
  unique(metadata.version.workbenchModes, `${directory} workbenchModes`);
  unique(metadata.version.toolIds, `${directory} toolIds`);
  if (
    metadata.version.toolIds.length ||
    metadata.version.riskPolicy.allowsWrite ||
    metadata.version.riskPolicy.allowsPaidGeneration
  ) {
    throw new Error(
      `${directory}: bundled content Skills may not add tools, write authority, or autonomous paid generation`
    );
  }
  const prompt = policy(body, "prompt");
  const image = policy(body, "image");
  const video = policy(body, "video");
  if (!prompt) throw new Error(`${directory}: prompt policy is required`);
  if (image !== undefined && !metadata.version.capabilities.includes("image_generation")) {
    throw new Error(`${directory}: image policy requires image_generation capability`);
  }
  if (video !== undefined && !metadata.version.capabilities.includes("video_generation")) {
    throw new Error(`${directory}: video policy requires video_generation capability`);
  }
  if (metadata.version.capabilities.includes("image_generation") !== (image !== undefined)) {
    throw new Error(`${directory}: image_generation capability and image policy must agree`);
  }
  if (metadata.version.capabilities.includes("video_generation") !== (video !== undefined)) {
    throw new Error(`${directory}: video_generation capability and video policy must agree`);
  }
  if (metadata.preview.video && video === undefined) {
    throw new Error(`${directory}: video preview requires a video generation policy`);
  }
  const generationPolicy = {
    ...(image ? { image: { promptSuffix: image } } : {}),
    ...(video ? { video: { promptSuffix: video } } : {}),
    promptAuthoring: { instructions: prompt },
  };
  catalog.push({
    id: metadata.skillId,
    catalogOrder: metadata.catalogOrder,
    slug: directory,
    name: displayName,
    description: metadata.displayDescription,
    translationKey: metadata.translationKey,
    publisherName: metadata.publisherName,
    category: metadata.category,
    kind: metadata.kind,
    previewImageFile: metadata.preview.image,
    previewVideoFile: metadata.preview.video,
    version: {
      id: metadata.version.id,
      version: metadata.version.version,
      manifestSchemaVersion: metadata.version.manifestSchemaVersion,
      publishedAt: metadata.version.publishedAt,
      instructions: `## Project Skill: ${displayName}\n\n${prompt}\n\nApply this guidance only to tasks that match the mounted capability. Preserve explicit user requirements, project facts, character identity, product identity, and safety constraints. Never claim a project change or generation succeeded before the relevant tool or job reports success.`,
      generationPolicy,
      configSchema: metadata.version.configSchema,
      capabilities: metadata.version.capabilities,
      projectKinds: metadata.version.projectKinds,
      workbenchModes: metadata.version.workbenchModes,
      toolIds: metadata.version.toolIds,
      riskPolicy: metadata.version.riskPolicy,
      evalSuite: metadata.version.evalSuite,
    },
  });
}

unique(
  catalog.map((skill) => skill.id),
  "skill ids"
);
unique(
  catalog.map((skill) => skill.slug),
  "skill slugs"
);
unique(
  catalog.map((skill) => skill.version.id),
  "version ids"
);
unique(
  catalog.map((skill) => String(skill.catalogOrder)),
  "catalog order"
);
catalog.sort((left, right) => left.catalogOrder - right.catalogOrder);

const output = await format(
  [
    "/* eslint-disable */",
    "// Generated by scripts/generate-catalog.mts. Do not edit by hand.",
    'import type { BundledCatalogSkillSource } from "./catalog-types.js";',
    "",
    `export const GENERATED_BUNDLED_CATALOG_SKILLS = ${JSON.stringify(
      catalog.map(({ catalogOrder: _catalogOrder, ...skill }) => skill),
      null,
      2
    )} as const satisfies readonly BundledCatalogSkillSource[];`,
    "",
  ].join("\n"),
  {
    parser: "typescript",
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "es5",
    printWidth: 100,
    endOfLine: "lf",
  }
);

if (process.argv.includes("--check")) {
  const current = await readFile(generatedFile, "utf8").catch(() => "");
  if (current !== output) {
    throw new Error(
      `Bundled Skill catalog is stale. Run: npm run generate:catalog --workspace=@repo/agent-skills`
    );
  }
} else {
  await writeFile(generatedFile, output);
  process.stdout.write(
    `Generated ${catalog.length} bundled Skills at ${basename(generatedFile)}\n`
  );
}
