import {
  ExperienceGameManifestSchema,
  ExperienceJsonObjectSchema,
  ExperienceReleaseRequestSchema,
  canonicalizeExperienceJson,
  canonicalizeExperienceRuntimeManifest,
  materializeExperienceRuntimeManifest,
  type ExperienceGameManifest,
  type ExperienceJsonValue,
  type ExperienceReleaseRequest,
  type ExperienceRuntimeManifest,
} from '@repo/shared/experience-runtime';

export type VerifiedExperienceReleaseRequest = Omit<
  ExperienceReleaseRequest,
  'manifest' | 'setCurrent'
> & {
  manifest: ExperienceRuntimeManifest;
  setCurrent: boolean;
};

export class ExperienceReleaseRequestError extends Error {
  constructor(
    readonly code:
      | 'MANIFEST_NOT_MATERIALIZED'
      | 'GAME_ID_MISMATCH'
      | 'CONTENT_VERSION_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'ExperienceReleaseRequestError';
  }
}

/**
 * Builds the exact POST {prefix}/releases body. All manifest defaults are
 * materialized before transport because Java persists this JSON verbatim.
 */
export function createExperienceReleaseRequest(
  input: Omit<ExperienceReleaseRequest, 'manifest'>,
  manifestInput: unknown,
): VerifiedExperienceReleaseRequest {
  const manifest = materializeExperienceRuntimeManifest(manifestInput);
  return parseAndVerifyExperienceReleaseRequest({ ...input, manifest });
}

/**
 * Publisher-side validation only. Java intentionally does not parse the
 * manifest, so the compiler must reject incomplete or cross-version payloads
 * before calling the release API.
 */
export function parseAndVerifyExperienceReleaseRequest(
  input: unknown,
): VerifiedExperienceReleaseRequest {
  const transport = ExperienceReleaseRequestSchema.parse(input);
  const rawManifest = ExperienceJsonObjectSchema.parse(transport.manifest);
  const manifest = materializeExperienceRuntimeManifest(rawManifest);

  if (
    canonicalizeExperienceJson(rawManifest) !==
    canonicalizeExperienceRuntimeManifest(manifest)
  ) {
    throw new ExperienceReleaseRequestError(
      'MANIFEST_NOT_MATERIALIZED',
      'Release requests must contain the fully materialized Runtime Manifest',
    );
  }
  if (transport.gameId !== manifest.gameId) {
    throw new ExperienceReleaseRequestError(
      'GAME_ID_MISMATCH',
      `Release gameId ${transport.gameId} does not match manifest gameId ${manifest.gameId}`,
    );
  }
  if (transport.contentVersion !== manifest.contentVersion) {
    throw new ExperienceReleaseRequestError(
      'CONTENT_VERSION_MISMATCH',
      `Release contentVersion ${transport.contentVersion} does not match manifest contentVersion ${manifest.contentVersion}`,
    );
  }

  return { ...transport, manifest, setCurrent: transport.setCurrent ?? true };
}

export type VerifiedExperienceGameReleaseRequest = Omit<
  ExperienceReleaseRequest,
  'manifest' | 'setCurrent'
> & {
  manifest: ExperienceGameManifest;
  setCurrent: boolean;
};

/**
 * Builds the POST {prefix}/releases body for a multi-chapter work, whose
 * `manifest` is the Game Manifest table of contents rather than one chapter's
 * Runtime Manifest. Java stores the JSON verbatim either way, so the
 * publisher-side parse is the only validation this document will ever get.
 */
export function createExperienceGameReleaseRequest(
  input: Omit<ExperienceReleaseRequest, 'manifest'>,
  manifestInput: unknown,
): VerifiedExperienceGameReleaseRequest {
  const manifest = ExperienceGameManifestSchema.parse(manifestInput);
  const transport = ExperienceReleaseRequestSchema.parse({
    ...input,
    manifest,
  });
  const rawManifest = ExperienceJsonObjectSchema.parse(transport.manifest);

  // The Game Manifest declares no schema defaults, so a parsed document that
  // differs from its input means the shape drifted from this contract — the
  // same guarantee `parseAndVerifyExperienceReleaseRequest` gives the Runtime
  // Manifest, where Java cannot re-check anything after transport.
  if (
    canonicalizeExperienceJson(rawManifest) !==
    canonicalizeExperienceJson(manifest as unknown as ExperienceJsonValue)
  ) {
    throw new ExperienceReleaseRequestError(
      'MANIFEST_NOT_MATERIALIZED',
      'Game release requests must contain the fully materialized Game Manifest',
    );
  }
  if (transport.gameId !== manifest.gameId) {
    throw new ExperienceReleaseRequestError(
      'GAME_ID_MISMATCH',
      `Release gameId ${transport.gameId} does not match manifest gameId ${manifest.gameId}`,
    );
  }
  if (transport.contentVersion !== manifest.contentVersion) {
    throw new ExperienceReleaseRequestError(
      'CONTENT_VERSION_MISMATCH',
      `Release contentVersion ${transport.contentVersion} does not match manifest contentVersion ${manifest.contentVersion}`,
    );
  }

  return { ...transport, manifest, setCurrent: transport.setCurrent ?? true };
}
