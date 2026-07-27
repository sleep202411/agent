import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import {
  ExperienceCheckpointWriteSchema,
  ExperienceGameDetailResponseSchema,
  ExperienceGameListResponseSchema,
  ExperiencePlayerEventBatchSchema,
  ExperienceReleaseRequestSchema,
  ExperienceReleaseResponseSchema,
  ExperienceRuntimeManifestSchema,
  ExperienceSessionSnapshotSchema,
} from "../dist/experience-runtime.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const outputDirectory = resolve(repositoryRoot, "contracts/experience-runtime/v2");
const prettierConfig = (await resolveConfig(resolve(repositoryRoot, "package.json"))) ?? {};

const contracts = [
  ["runtime-manifest.schema.json", "RuntimeManifest", ExperienceRuntimeManifestSchema],
  ["release-request.schema.json", "ReleaseRequest", ExperienceReleaseRequestSchema],
  ["release-response.schema.json", "ReleaseResponse", ExperienceReleaseResponseSchema],
  ["game-list-response.schema.json", "GameListResponse", ExperienceGameListResponseSchema],
  ["game-detail-response.schema.json", "GameDetailResponse", ExperienceGameDetailResponseSchema],
  ["session-snapshot.draft.schema.json", "SessionSnapshotDraft", ExperienceSessionSnapshotSchema],
  ["checkpoint-write.draft.schema.json", "CheckpointWriteDraft", ExperienceCheckpointWriteSchema],
  [
    "player-event-batch.draft.schema.json",
    "PlayerEventBatchDraft",
    ExperiencePlayerEventBatchSchema,
  ],
];

// Catalogue reads intentionally normalize malformed decorative fields through
// Zod transforms. Their JSON Schemas describe the accepted transport input;
// output-mode conversion cannot represent transforms and would leave only a
// partially written contract set.
const inputContractFiles = new Set([
  "game-list-response.schema.json",
  "game-detail-response.schema.json",
]);

const obsoleteContracts = [
  "publication-candidate.schema.json",
  "publication-envelope.schema.json",
  "session-snapshot.schema.json",
  "checkpoint-write.schema.json",
  "player-event-batch.schema.json",
];

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  obsoleteContracts.map((fileName) => rm(resolve(outputDirectory, fileName), { force: true }))
);

for (const [fileName, contractName, schema] of contracts) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
    reused: "ref",
    io: inputContractFiles.has(fileName) ? "input" : "output",
  });
  if (fileName === "release-request.schema.json") {
    jsonSchema.properties.setCurrent.default = true;
  }
  const document = {
    $id: `https://contracts.fizzdragon.com/experience-runtime/v2/${fileName}`,
    title: `FizzDragon Experience Runtime v2 ${contractName}`,
    ...jsonSchema,
  };
  assertLocalReferencesResolve(document);
  const outputPath = resolve(outputDirectory, fileName);
  const serialized = await format(JSON.stringify(document), {
    ...prettierConfig,
    filepath: outputPath,
  });
  await writeFile(outputPath, serialized);
}

function assertLocalReferencesResolve(document) {
  const references = [];
  collectDefinitionReferences(document, references, false);
  references.forEach((name) => {
    if (document.$defs?.[name]) return;
    throw new Error(`Generated contract contains unresolved local definition ${name}`);
  });
}

function collectDefinitionReferences(value, output, skipDefinitions) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectDefinitionReferences(entry, output, false));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, entry]) => {
    if (skipDefinitions && key === "$defs") return;
    if (key === "$ref" && typeof entry === "string" && entry.startsWith("#/$defs/")) {
      output.push(entry.slice("#/$defs/".length));
      return;
    }
    collectDefinitionReferences(entry, output, false);
  });
}
