import { createHash } from 'node:crypto';
import {
  EXPERIENCE_MANIFEST_CANONICALIZATION,
  EXPERIENCE_MANIFEST_HASH_ALGORITHM,
  canonicalizeExperienceRuntimeManifest,
  type ExperienceManifestIntegrity,
} from '@repo/shared/experience-runtime';

export function hashCanonicalExperienceManifest(
  canonicalManifest: string,
): string {
  return createHash('sha256').update(canonicalManifest, 'utf8').digest('hex');
}

export function createExperienceManifestIntegrity(
  manifest: unknown,
): ExperienceManifestIntegrity {
  const canonicalManifest = canonicalizeExperienceRuntimeManifest(manifest);
  return {
    canonicalization: EXPERIENCE_MANIFEST_CANONICALIZATION,
    hashAlgorithm: EXPERIENCE_MANIFEST_HASH_ALGORITHM,
    semanticRulesVersion: 1,
    digest: hashCanonicalExperienceManifest(canonicalManifest),
  };
}
