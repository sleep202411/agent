/**
 * Character reference expansion for the AI generation submit path.
 *
 * A client references a character with `{refId, role:'character',
 * characterId}` — ids, not URLs. This service resolves those bindings
 * against the workspace library (server truth, never client-sent kind
 * fields) and REPLACES each one with its ordered media as per-media
 * bindings, appending the same durable public URLs into the job input's
 * referenceImages/referenceVideos/referenceAudios arrays so ROUTING and
 * PRICING see true reference counts before any wallet hold is taken.
 *
 * Runs AFTER resolveJobContext (which already proved the caller can
 * generate in the job workspace) and BEFORE routing.resolve. The single
 * ownership rule (design §3.2/⟦R5⟧): the job's workspace context must
 * EQUAL the character's home workspace — no cross-workspace use of any
 * kind. On top of that equality, the caller must hold a membership-grade
 * grant (active WorkspaceMember of the home workspace, or the character is
 * cast into the job's project), so a raw character id alone never grants
 * use. Expansion is also schema-aware: only reference kinds the selected
 * model declares are delivered, truncated to the fields' maxItems.
 *
 * URLs are the same durable public CDN URLs the media confirm endpoint
 * returns (MediaAssetUrlResolverService) — never short-TTL signed URLs,
 * because workers retry long after submit.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  AiProviderAssetGroupStatus,
  AiProviderExternalAssetStatus,
  CharacterKind,
  CharacterMediaStatus,
  CharacterProjectGrantStatus,
  CharacterStatus,
  MediaAssetKind,
  Prisma,
  ProjectMemberRole,
  ProjectMemberStatus,
  WorkspaceMemberStatus,
} from '@prisma/client';
import type { AiObjectSchema } from '@repo/shared';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import {
  PROVIDER_ASSET_URL_SCHEME,
  REAL_PERSON_PROVIDER,
} from './asset-ref.util';
import { CharactersConfigService } from './characters-config.service';
import type {
  AiPromptReferenceKind,
  AiSubmitReferenceBinding,
} from '../ai-generation/prompt-document.types';

/** Max character bindings on one generation (mirrors studio's cap). */
export const MAX_CHARACTERS_PER_GENERATION = 3;

/** Why an expanded member was dropped instead of delivered. */
export type CharacterMediaDropReason = 'kind_unsupported' | 'max_items';

/** Audit record of one expanded character binding (usage rows + trace). */
export interface CharacterBindingExpansion {
  characterId: string;
  name: string;
  refId: string;
  /** Media actually delivered into the job input (post schema fit). */
  mediaAssetIds: string[];
  /** Media dropped to fit the model schema (undeclared kind / maxItems). */
  dropped?: Array<{
    mediaAssetId: string;
    kind: AiPromptReferenceKind;
    reason: CharacterMediaDropReason;
  }>;
}

/** One declared reference-array field of a model's input schema. */
export interface CharacterReferenceFieldSchema {
  /** Schema `maxItems`; null = unbounded. */
  maxItems: number | null;
}

/**
 * The reference-array fields the SELECTED model's input schema declares.
 * Presence of a kind = the schema has that field; absence = media of that
 * kind is undeliverable and must never be token-compiled.
 */
export type CharacterReferenceSchemaByKind = Partial<
  Record<AiPromptReferenceKind, CharacterReferenceFieldSchema>
>;

export interface ExpandCharacterBindingsInput {
  /** Caller identity — checked for workspace membership / cast access
   *  (and reserved for the real_person subjectUserId assertion when the
   *  enrollment track lands). */
  user: AuthUser;
  /** The resolved job workspace context (must equal each character's home). */
  workspaceId: string;
  /** The resolved job project context, when any — a project-only editor is
   *  authorized exactly for characters CAST into this project. */
  projectId?: string;
  /** Declared reference fields of the selected model (see
   *  {@link referenceSchemaFromModelInput}) — expansion is schema-aware. */
  referenceSchema: CharacterReferenceSchemaByKind;
  bindings: AiSubmitReferenceBinding[] | undefined;
  input: Record<string, unknown>;
}

export interface ExpandCharacterBindingsResult {
  /** Bindings with each character entry replaced by its per-media members. */
  bindings: AiSubmitReferenceBinding[] | undefined;
  /** Input with member URLs appended to the per-kind reference arrays. */
  input: Record<string, unknown>;
  expansions: CharacterBindingExpansion[];
  /**
   * Unique kinds among the resolved characters — routing consumes this for
   * the real_person ⇒ byteplus-modelark post-selection pin (design §3.2
   * step 4). Server truth only; client kind fields are never read.
   */
  characterKinds: CharacterKind[];
}

// Pure asset:// helpers live in a leaf util (asset-ref.util.ts) so the
// low-level generation load chain can use them without importing this fat
// service. Re-exported here for existing importers.
export { redactProviderAssetRefs } from './asset-ref.util';
export { PROVIDER_ASSET_URL_SCHEME, REAL_PERSON_PROVIDER };

const CHARACTER_MEDIA_INCLUDE = {
  media: {
    where: { status: CharacterMediaStatus.active },
    orderBy: { sortOrder: 'asc' },
    include: {
      mediaAsset: {
        select: {
          id: true,
          storageProvider: true,
          bucket: true,
          region: true,
          objectKey: true,
          externalUrl: true,
          status: true,
          moderationStatus: true,
          deletedAt: true,
        },
      },
      // Provider mirror rows (real_person readiness, §3.2 step 2). The
      // group-status filter makes revocation instantaneous: the revoke
      // transaction flips groups to `disabled`, which empties this include
      // and fails the readiness pre-check without waiting on upstream.
      externalAssets: {
        where: {
          assetGroup: {
            provider: REAL_PERSON_PROVIDER,
            status: AiProviderAssetGroupStatus.active,
          },
        },
        select: {
          externalAssetId: true,
          status: true,
          statusReason: true,
        },
      },
    },
  },
} satisfies Prisma.StudioCharacterInclude;

type CharacterWithMedia = Prisma.StudioCharacterGetPayload<{
  include: typeof CHARACTER_MEDIA_INCLUDE;
}>;

const BINDING_KIND_BY_MEDIA_KIND: Partial<
  Record<MediaAssetKind, AiPromptReferenceKind>
> = {
  [MediaAssetKind.image]: 'image',
  [MediaAssetKind.video]: 'video',
  [MediaAssetKind.audio]: 'audio',
};

/** normalizedInput key per reference kind (matches the prompt compiler). */
const INPUT_FIELD_BY_KIND: Record<AiPromptReferenceKind, string> = {
  image: 'referenceImages',
  video: 'referenceVideos',
  audio: 'referenceAudios',
};

const REFERENCE_KINDS = ['image', 'video', 'audio'] as const;

/**
 * Derive the declared reference-array fields (and their maxItems) from a
 * model's input schema. Lives here so the kind→field mapping stays in one
 * place; callers resolve the schema however is cheapest for them.
 */
export function referenceSchemaFromModelInput(
  schema: AiObjectSchema,
): CharacterReferenceSchemaByKind {
  const byKind: CharacterReferenceSchemaByKind = {};
  for (const kind of REFERENCE_KINDS) {
    const field = schema.properties?.[INPUT_FIELD_BY_KIND[kind]];
    if (field && field.type === 'array') {
      byKind[kind] = { maxItems: field.maxItems ?? null };
    }
  }
  return byKind;
}

function isCharacterBinding(binding: AiSubmitReferenceBinding): boolean {
  return binding.role === 'character';
}

/** Fully-populated member binding produced by character expansion. */
type CharacterMemberBinding = AiSubmitReferenceBinding & {
  kind: AiPromptReferenceKind;
  url: string;
  assetId: string;
  label: string;
  groupRefId: string;
  characterId: string;
};

@Injectable()
export class CharacterGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: MediaAssetUrlResolverService,
    private readonly featureFlags: CharactersConfigService,
  ) {}

  /**
   * Reject any client-supplied `asset://` reference URL (design §3.2 security
   * invariant). These provider-hosted handles must ONLY originate from
   * server-side expansion below — a raw client-sent asset:// would skip the
   * subject-only check, the routing pin, and the forced watermark. Scans every
   * reference array plus the frame fields (the mapper forwards those too).
   */
  rejectClientAssetReferences(input: Record<string, unknown>): void {
    const scanEntry = (entry: unknown): void => {
      const url =
        typeof entry === 'string'
          ? entry
          : isRecord(entry) && typeof entry.url === 'string'
            ? entry.url
            : undefined;
      if (
        url &&
        url.trim().toLowerCase().startsWith(PROVIDER_ASSET_URL_SCHEME)
      ) {
        throw new BadRequestException({
          code: 'REFERENCE_SCHEME_FORBIDDEN',
          message:
            'Character references must be sent as referenceBindings ids, not asset:// URLs.',
        });
      }
    };
    for (const field of [
      ...REFERENCE_KINDS.map((kind) => INPUT_FIELD_BY_KIND[kind]),
      'startFrame',
      'endFrame',
    ]) {
      const value = input[field];
      if (Array.isArray(value)) value.forEach(scanEntry);
      else if (value != null) scanEntry(value);
    }
  }

  async expandCharacterBindings(
    params: ExpandCharacterBindingsInput,
  ): Promise<ExpandCharacterBindingsResult> {
    const bindings = params.bindings ?? [];
    const characterBindings = bindings.filter(isCharacterBinding);
    if (characterBindings.length === 0) {
      return {
        bindings: params.bindings,
        input: params.input,
        expansions: [],
        characterKinds: [],
      };
    }

    if (characterBindings.length > MAX_CHARACTERS_PER_GENERATION) {
      throw new BadRequestException({
        code: 'CHARACTER_REFERENCE_LIMIT',
        message: `A generation can reference at most ${MAX_CHARACTERS_PER_GENERATION} characters.`,
      });
    }

    // Schema-awareness gate: a model whose input schema declares NONE of
    // the reference-array fields cannot receive character media at all —
    // token-compiling the mention while silently dropping every member
    // would lie to the user, so fail loudly instead.
    if (REFERENCE_KINDS.every((kind) => !params.referenceSchema[kind])) {
      throw new BadRequestException({
        code: 'CHARACTER_REFERENCES_UNSUPPORTED',
        message: 'The selected model does not accept reference media.',
      });
    }

    const characterIdByRefId = new Map<string, string>();
    for (const binding of characterBindings) {
      const characterId = binding.characterId?.trim();
      if (!characterId) {
        throw new BadRequestException({
          code: 'CHARACTER_REFERENCE_INVALID',
          message: `Character reference "${binding.refId}" is missing characterId.`,
        });
      }
      if (
        characterIdByRefId.has(binding.refId) ||
        [...characterIdByRefId.values()].includes(characterId)
      ) {
        throw new BadRequestException({
          code: 'CHARACTER_REFERENCE_DUPLICATE',
          message:
            'Each character reference must use a unique refId and character.',
        });
      }
      characterIdByRefId.set(binding.refId, characterId);
    }

    const characters = await this.prisma.studioCharacter.findMany({
      where: { id: { in: [...characterIdByRefId.values()] } },
      include: CHARACTER_MEDIA_INCLUDE,
    });
    const characterById = new Map(
      characters.map((character) => [character.id, character]),
    );

    // Existence + kind gate first, so real_person feature-flag / not-found
    // errors precede any authz decision.
    const resolved: CharacterWithMedia[] = [];
    for (const characterId of characterIdByRefId.values()) {
      resolved.push(
        this.requireCharacterExists(
          characterById.get(characterId),
          characterId,
        ),
      );
    }
    const realPerson = resolved.filter(
      (c) => c.kind === CharacterKind.real_person,
    );
    const virtual = resolved.filter(
      (c) => c.kind !== CharacterKind.real_person,
    );

    // ⟦v2⟧ real_person access = self-use OR an active per-project GRANT
    // (design §4). Enforced by throw; runs BEFORE per-character validation so
    // an access denial keeps precedence over status/media errors.
    await this.resolveRealPersonAccess(
      params.user,
      params.workspaceId,
      params.projectId,
      realPerson,
    );
    // Virtual characters keep the workspace-membership / project-cast gate.
    await this.requireCharacterAccess(
      params.user,
      params.workspaceId,
      params.projectId,
      virtual.map((c) => c.id),
    );

    // Per-character usability (status / media; workspace-equality for virtual).
    const usableById = new Map<string, CharacterWithMedia>();
    for (const character of resolved) {
      usableById.set(
        character.id,
        this.requireUsableCharacter(character, params.workspaceId),
      );
    }

    const nextBindings: AiSubmitReferenceBinding[] = [];
    const expansions: CharacterBindingExpansion[] = [];
    const membersByKind: Record<
      AiPromptReferenceKind,
      CharacterMemberBinding[]
    > = { image: [], video: [], audio: [] };
    const remainingByKind = this.remainingReferenceSlots(
      params.referenceSchema,
      params.input,
    );

    for (const binding of bindings) {
      if (!isCharacterBinding(binding)) {
        nextBindings.push(binding);
        continue;
      }
      const characterId = characterIdByRefId.get(binding.refId) ?? '';
      const character = usableById.get(characterId);
      if (!character) {
        throw new NotFoundException({
          code: 'CHARACTER_NOT_FOUND',
          message: `Character ${characterId} not found.`,
        });
      }
      const members = this.expandCharacter(character, binding.refId);
      // Schema fit: drop kinds the model does not declare, and truncate
      // deterministically (members arrive images→videos→audios, each by
      // sortOrder) once a kind's remaining maxItems slots run out.
      const kept: CharacterMemberBinding[] = [];
      const dropped: NonNullable<CharacterBindingExpansion['dropped']> = [];
      for (const member of members) {
        if (!params.referenceSchema[member.kind]) {
          dropped.push({
            mediaAssetId: member.assetId,
            kind: member.kind,
            reason: 'kind_unsupported',
          });
          continue;
        }
        if (remainingByKind[member.kind] <= 0) {
          dropped.push({
            mediaAssetId: member.assetId,
            kind: member.kind,
            reason: 'max_items',
          });
          continue;
        }
        remainingByKind[member.kind] -= 1;
        kept.push(member);
        nextBindings.push(member);
        membersByKind[member.kind].push(member);
      }
      expansions.push({
        characterId: character.id,
        name: character.name,
        refId: binding.refId,
        mediaAssetIds: kept.map((member) => member.assetId),
        ...(dropped.length > 0 ? { dropped } : {}),
      });
    }

    return {
      bindings: nextBindings,
      input: this.appendReferenceInputs(params.input, membersByKind),
      expansions,
      characterKinds: [
        ...new Set([...usableById.values()].map((character) => character.kind)),
      ],
    };
  }

  /**
   * Membership-grade authz on top of the workspace-equality rule: knowing a
   * character's raw id must never be enough. The caller qualifies when they
   * are an active member of the characters' home workspace, OR — for
   * project-scoped jobs — when EVERY referenced character is cast into the
   * job's project (a project-only editor may use exactly the cast, nothing
   * else from the library).
   */
  private async requireCharacterAccess(
    user: AuthUser,
    workspaceId: string,
    projectId: string | undefined,
    characterIds: string[],
  ): Promise<void> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: user.userId,
        status: WorkspaceMemberStatus.active,
        removedAt: null,
      },
      select: { id: true },
    });
    if (membership) return;

    if (projectId) {
      const castRows = await this.prisma.characterProjectCast.findMany({
        where: { projectId, characterId: { in: characterIds } },
        select: { characterId: true },
      });
      const cast = new Set(castRows.map((row) => row.characterId));
      if (characterIds.every((id) => cast.has(id))) return;
    }

    throw new ForbiddenException({
      code: 'CHARACTER_ACCESS_DENIED',
      message: 'You do not have access to the referenced characters.',
    });
  }

  /**
   * Free slots per declared kind after counting the entries the input
   * already carries (character-stamped entries from a previous compile are
   * excluded — `appendReferenceInputs` strips them before appending).
   * Undeclared kinds stay at 0. Unbounded fields get Infinity.
   */
  private remainingReferenceSlots(
    schema: CharacterReferenceSchemaByKind,
    input: Record<string, unknown>,
  ): Record<AiPromptReferenceKind, number> {
    const remaining: Record<AiPromptReferenceKind, number> = {
      image: 0,
      video: 0,
      audio: 0,
    };
    for (const kind of REFERENCE_KINDS) {
      const field = schema[kind];
      if (!field) continue;
      const cap = field.maxItems ?? Number.POSITIVE_INFINITY;
      const existingRaw = input[INPUT_FIELD_BY_KIND[kind]];
      const existing = Array.isArray(existingRaw)
        ? existingRaw.filter((entry) => !isCharacterStampedEntry(entry)).length
        : 0;
      remaining[kind] = Math.max(0, cap - existing);
    }
    return remaining;
  }

  /** Existence + kind gate (feature-flag for real_person). Runs first. */
  private requireCharacterExists(
    character: CharacterWithMedia | undefined,
    characterId: string,
  ): CharacterWithMedia {
    if (!character || character.deletedAt) {
      throw new NotFoundException({
        code: 'CHARACTER_NOT_FOUND',
        message: `Character ${characterId} not found.`,
      });
    }
    if (
      character.kind === CharacterKind.real_person &&
      !this.featureFlags.config.realPersonEnabled
    ) {
      throw new NotImplementedException({
        code: 'REAL_PERSON_NOT_AVAILABLE',
        message: 'Real-person characters are not available yet.',
      });
    }
    return character;
  }

  /**
   * ⟦v2⟧ real_person access resolution (design §4): usable when EITHER
   *  (a) SELF-use — caller === subjectUserId and the job is in the character's
   *      home (personal) workspace; OR
   *  (b) GRANT-use — an ACTIVE CharacterProjectGrant for (characterId,
   *      job.projectId) exists AND the caller is an EXPLICIT active
   *      ProjectMember editor+ of that project (NO workspace-role fallback —
   *      that would silently widen consent to the whole host workspace).
   * The GRANT is the per-project enforcement source of truth: a per-project
   * revoke flips only the grant (character/group stay active for other
   * grants + self-use), so revocation is caught HERE at submit and re-checked
   * at the worker seam. Throws on denial; returns the mode per character.
   */
  private async resolveRealPersonAccess(
    user: AuthUser,
    workspaceId: string,
    projectId: string | undefined,
    realPersonCharacters: CharacterWithMedia[],
  ): Promise<Map<string, 'self' | 'grant'>> {
    const access = new Map<string, 'self' | 'grant'>();
    const needGrant: CharacterWithMedia[] = [];
    for (const character of realPersonCharacters) {
      if (
        character.subjectUserId === user.userId &&
        character.workspaceId === workspaceId
      ) {
        access.set(character.id, 'self');
      } else {
        needGrant.push(character);
      }
    }
    if (needGrant.length === 0) return access;

    if (!projectId) {
      throw new ForbiddenException({
        code: 'CHARACTER_ACCESS_DENIED',
        message:
          'A real-person likeness can only be used in a project it is authorized for.',
      });
    }
    const editorMembership = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        userId: user.userId,
        status: ProjectMemberStatus.active,
        removedAt: null,
        role: {
          in: [
            ProjectMemberRole.owner,
            ProjectMemberRole.admin,
            ProjectMemberRole.editor,
          ],
        },
      },
      select: { id: true },
    });
    if (!editorMembership) {
      throw new ForbiddenException({
        code: 'CHARACTER_ACCESS_DENIED',
        message:
          'You must be a project editor to generate with an authorized likeness.',
      });
    }
    const grants = await this.prisma.characterProjectGrant.findMany({
      where: {
        projectId,
        status: CharacterProjectGrantStatus.active,
        characterId: { in: needGrant.map((c) => c.id) },
      },
      select: { characterId: true },
    });
    const granted = new Set(grants.map((g) => g.characterId));
    for (const character of needGrant) {
      if (!granted.has(character.id)) {
        throw new ForbiddenException({
          code: 'CHARACTER_NOT_AUTHORIZED_FOR_PROJECT',
          message: `Character "${character.name}" is not authorized for this project.`,
        });
      }
      access.set(character.id, 'grant');
    }
    return access;
  }

  /** Status / media validation (+ workspace-equality for VIRTUAL only). */
  private requireUsableCharacter(
    character: CharacterWithMedia,
    workspaceId: string,
  ): CharacterWithMedia {
    // Virtual is workspace-owned: it may only be used in its home workspace
    // (or a project cast within it). real_person crosses workspaces by GRANT,
    // so the equality rule does not apply to it (access resolved separately).
    if (
      character.kind !== CharacterKind.real_person &&
      character.workspaceId !== workspaceId
    ) {
      throw new ForbiddenException({
        code: 'CHARACTER_WORKSPACE_MISMATCH',
        message: 'Character does not belong to the generation workspace.',
      });
    }
    if (character.status === CharacterStatus.revoked) {
      throw new ConflictException({
        code: 'CHARACTER_REVOKED',
        message: `Character "${character.name}" has been revoked.`,
      });
    }
    if (character.status !== CharacterStatus.active) {
      throw new ConflictException({
        code: 'CHARACTER_NOT_ACTIVE',
        message: `Character "${character.name}" is not active.`,
      });
    }
    if (character.media.length === 0) {
      throw new BadRequestException({
        code: 'CHARACTER_HAS_NO_MEDIA',
        message: `Character "${character.name}" has no reference media yet.`,
      });
    }
    return character;
  }

  /**
   * One character binding → its media as per-media bindings, ordered
   * images → videos → audios (each by sortOrder), numbered `refId::n`.
   *
   * virtual → durable public CDN URLs. real_person → `asset://` members
   * backed by ACTIVE provider mirrors, readiness-checked NOW (§3.2 step 2):
   * a missing/pending/failed mirror is a typed 409 BEFORE any wallet hold —
   * never a reserved-then-spinning job. The likeness bytes stay provider-side.
   */
  private expandCharacter(
    character: CharacterWithMedia,
    refId: string,
  ): CharacterMemberBinding[] {
    const realPerson = character.kind === CharacterKind.real_person;
    const ordered = (['image', 'video', 'audio'] as const).flatMap((kind) =>
      character.media.filter(
        (item) => BINDING_KIND_BY_MEDIA_KIND[item.mediaKind] === kind,
      ),
    );
    return ordered.map((item, index) => {
      const kind = BINDING_KIND_BY_MEDIA_KIND[item.mediaKind];
      if (!kind) {
        throw new ConflictException({
          code: 'CHARACTER_MEDIA_KIND_INVALID',
          message: `Character "${character.name}" has media of an unsupported kind.`,
        });
      }
      const url = realPerson
        ? this.requireActiveMirrorUrl(character, item)
        : this.urls.resolvePublicUrl(item.mediaAsset);
      if (!url) {
        throw new ConflictException({
          code: 'CHARACTER_ASSET_NOT_READY',
          message: `Reference media of character "${character.name}" is not ready.`,
        });
      }
      return {
        refId: `${refId}::${index + 1}`,
        groupRefId: refId,
        kind,
        url,
        assetId: item.mediaAssetId,
        label: character.name,
        characterId: character.id,
      };
    });
  }

  /**
   * Readiness pre-check for one real_person media row: its byteplus mirror
   * (under an ACTIVE asset group — revocation disables the group in the same
   * transaction) must be `active` with an external id, NOW. Upstream verdicts
   * (face_mismatch / multi_face / moderation / stale) surface verbatim.
   */
  private requireActiveMirrorUrl(
    character: CharacterWithMedia,
    item: CharacterWithMedia['media'][number],
  ): string {
    const mirror = item.externalAssets[0];
    if (
      !mirror?.externalAssetId ||
      mirror.status !== AiProviderExternalAssetStatus.active
    ) {
      throw new ConflictException({
        code: 'CHARACTER_ASSET_NOT_READY',
        message: mirror?.statusReason
          ? `Reference media of character "${character.name}" was rejected upstream (${mirror.statusReason}).`
          : `Reference media of character "${character.name}" is still registering with the provider.`,
      });
    }
    return `${PROVIDER_ASSET_URL_SCHEME}${mirror.externalAssetId}`;
  }

  /**
   * Append member URLs into `referenceImages` / `referenceVideos` /
   * `referenceAudios` (creating arrays as needed) so routing and pricing
   * count them. Entries a previous compile stamped with a `characterId`
   * are stripped first — on retry the input round-trips through
   * `normalizedInput`, and stale character media must not survive a
   * membership change or double-count against the fresh expansion.
   */
  private appendReferenceInputs(
    input: Record<string, unknown>,
    membersByKind: Record<AiPromptReferenceKind, CharacterMemberBinding[]>,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = { ...input };
    for (const kind of ['image', 'video', 'audio'] as const) {
      const field = INPUT_FIELD_BY_KIND[kind];
      const existing = Array.isArray(next[field])
        ? (next[field] as unknown[]).filter(
            (entry) => !isCharacterStampedEntry(entry),
          )
        : undefined;
      const members = membersByKind[kind];
      if (members.length === 0) {
        if (existing) next[field] = existing;
        continue;
      }
      const kept = existing ?? [];
      const seen = new Set<string>();
      for (const entry of kept) {
        if (typeof entry === 'string') seen.add(entry);
        if (isRecord(entry)) {
          if (typeof entry.url === 'string') seen.add(entry.url);
          if (typeof entry.assetId === 'string') seen.add(entry.assetId);
        }
      }
      const appended = members
        .filter((member) => !seen.has(member.assetId) && !seen.has(member.url))
        .map((member) => ({
          url: member.url,
          refId: member.refId,
          label: member.label,
          assetId: member.assetId,
          groupRefId: member.groupRefId,
          characterId: member.characterId,
        }));
      next[field] = [...kept, ...appended];
    }
    return next;
  }
}

function isCharacterStampedEntry(entry: unknown): boolean {
  return isRecord(entry) && typeof entry.characterId === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
