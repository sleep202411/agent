/**
 * The shape of a model profile id, defined once.
 *
 * A profile id travels the whole wire: the studio picks one from
 * `/v1/agent-os/models`, the Nest gateway validates the run request, the
 * protocol package types the payload, and the worker resolves it against the
 * configured profile list. Four surfaces, and until now four regexes — three of
 * which forbade `.`, so shipping `qwen3.7-plus` made every run fail validation
 * at the gateway with a raw ZodError while the model itself was perfectly fine.
 *
 * Exported as a RegExp and a number rather than a zod schema on purpose: this
 * monorepo has a dozen physical zod installs across two 4.x minors, and schemas
 * are not type-assignable across them. Primitives cross package boundaries
 * intact; each surface builds its own schema from these. Same reason
 * `storyboard-shot.ts` exports constants instead of schemas.
 *
 * Only the SHAPE lives here. Whether a given id actually exists is the worker's
 * question — `resolveProfile()` owns the real list and names the alternatives
 * when it misses. The gateway's check is a cheap syntactic guard in front of
 * that, and a guard must never be narrower than the thing it guards.
 */
export const MODEL_PROFILE_ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;

export const MODEL_PROFILE_ID_MAX_LENGTH = 64;

/** Human-readable rule, for error messages that have to explain themselves. */
export const MODEL_PROFILE_ID_DESCRIPTION =
  "must start with a lowercase letter and use only lowercase letters, digits, dot, underscore or hyphen";

export function isModelProfileId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MODEL_PROFILE_ID_MAX_LENGTH &&
    MODEL_PROFILE_ID_PATTERN.test(value)
  );
}
