import { z } from "zod";
import {
  EXPERIENCE_SEMANTIC_RULES_VERSION,
  ExperienceSha256Schema,
  type ExperienceJsonValue,
} from "./common.js";
import { ExperienceRuntimeManifestSchema, type ExperienceRuntimeManifest } from "./manifest.js";

export const EXPERIENCE_MANIFEST_CANONICALIZATION = "RFC8785-JCS" as const;
export const EXPERIENCE_MANIFEST_HASH_ALGORITHM = "sha-256" as const;

export const ExperienceManifestIntegritySchema = z
  .object({
    canonicalization: z.literal(EXPERIENCE_MANIFEST_CANONICALIZATION),
    hashAlgorithm: z.literal(EXPERIENCE_MANIFEST_HASH_ALGORITHM),
    semanticRulesVersion: z.literal(EXPERIENCE_SEMANTIC_RULES_VERSION),
    digest: ExperienceSha256Schema,
  })
  .strict();
export type ExperienceManifestIntegrity = z.infer<typeof ExperienceManifestIntegritySchema>;

/** RFC 8785 rejects lone UTF-16 surrogate code units. */
function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        index += 1;
        continue;
      }
      throw new TypeError("RFC 8785 input contains an unpaired high surrogate");
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("RFC 8785 input contains an unpaired low surrogate");
    }
  }
}

/** Serialize JSON using RFC 8785 JCS for publisher-side reproducibility. */
export function canonicalizeExperienceJson(value: ExperienceJsonValue): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("RFC 8785 requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeExperienceJson(entry)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => {
      assertUnicodeScalarString(key);
      return `${JSON.stringify(key)}:${canonicalizeExperienceJson(value[key] as ExperienceJsonValue)}`;
    })
    .join(",")}}`;
}

export function materializeExperienceRuntimeManifest(input: unknown): ExperienceRuntimeManifest {
  return ExperienceRuntimeManifestSchema.parse(input);
}

export function canonicalizeExperienceRuntimeManifest(input: unknown): string {
  const manifest = materializeExperienceRuntimeManifest(input);
  return canonicalizeExperienceJson(manifest as ExperienceJsonValue);
}
