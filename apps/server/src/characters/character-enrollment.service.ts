import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  AiOutboxEventType,
  AiProviderAssetGroupStatus,
  AiProviderAssetGroupType,
  AiProviderExternalAssetStatus,
  CharacterConsentRecordType,
  CharacterEnrollmentSessionStatus,
  CharacterKind,
  CharacterStatus,
  WorkspaceType,
  type Prisma,
  type StudioCharacter,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  BytePlusAssetsApiError,
  BytePlusAssetsClient,
} from '../ai-generation/providers/byteplus/assets/byteplus-assets-client';
import { BytePlusAssetsConfigService } from '../ai-generation/providers/byteplus/assets/byteplus-assets-config.service';
import { CharacterProviderSyncService } from '../ai-generation/providers/byteplus/assets/character-provider-sync.service';
import { enqueueAssetEventOutbox } from '../ai-generation/outbox.service';
import { REAL_PERSON_PROVIDER } from './character-generation.service';
import { CharacterGrantService } from './character-grant.service';
import { CharactersConfigService } from './characters-config.service';
import {
  consentTextSha256,
  decryptEnrollmentToken,
  encryptEnrollmentToken,
  REAL_PERSON_CONSENT_VERSION,
} from './consent';
import type { EnrollmentSessionDto, EnrollmentStatusDto } from './dto';

/** Sessions live 30 minutes (the vendor BytedToken TTL). */
const SESSION_TTL_MS = 30 * 60_000;

/** Request metadata captured into consent evidence (design §1). */
export interface ConsentRequestContext {
  ip?: string;
  userAgent?: string;
  locale?: string;
}

/**
 * Real-person enrollment lifecycle (design §2.1/§2.4/§5.1): the consent
 * ledger, the hosted-liveness session dance, and revocation. Trust model:
 * inbound callbacks NEVER mutate state — completion authority is exclusively
 * the authenticated `complete()` → GetVisualValidateResult server pull, and
 * the wizard requires same-session completion (no QR handoff, §2.1 ⟦R⟧).
 */
@Injectable()
export class CharacterEnrollmentService {
  private readonly logger = new Logger(CharacterEnrollmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlags: CharactersConfigService,
    private readonly assetsConfig: BytePlusAssetsConfigService,
    private readonly assetsClient: BytePlusAssetsClient,
    private readonly sync: CharacterProviderSyncService,
    private readonly grants: CharacterGrantService,
  ) {}

  // ── Create-time gates (called from CharactersService.create) ────────────

  /**
   * Validates the real_person create preconditions (§2.1a-c) and returns the
   * consent evidence to append. Throws typed errors; never returns partially.
   */
  requireRealPersonCreateAllowed(input: {
    consent?: { version: string; adultAttested: true };
    context: ConsentRequestContext;
  }): Prisma.CharacterConsentRecordUncheckedCreateWithoutCharacterInput {
    if (!this.featureFlags.config.realPersonEnabled) {
      throw new NotImplementedException({
        code: 'REAL_PERSON_NOT_AVAILABLE',
        message: 'Real-person characters are not available yet.',
      });
    }
    // §0 hard precondition: mainland users' face data to ap-southeast-1 is a
    // PIPL Art.38-39 sensitive-PI export — blocked until an onshore path
    // exists. Cell identity comes from the deployment env, not the caller.
    if ((process.env.NEXT_PUBLIC_SITE_REGION ?? 'global') === 'cn') {
      throw new ForbiddenException({
        code: 'CN_REAL_PERSON_UNAVAILABLE',
        message: 'Real-person characters are not available in this region yet.',
      });
    }
    if (this.assetsConfig.enrollmentHardBlocked()) {
      // §6.1: never enroll a user into a store about to be wiped.
      throw new ConflictException({
        code: 'ACR_ENROLLMENT_PAUSED',
        message: 'Enrollment is temporarily paused. Please try again later.',
      });
    }
    if (
      input.consent?.version !== REAL_PERSON_CONSENT_VERSION ||
      input.consent.adultAttested !== true
    ) {
      throw new BadRequestException({
        code: 'CONSENT_REQUIRED',
        message:
          'The current consent version must be accepted (with adult attestation) to enroll a likeness.',
      });
    }
    const acceptedAt = new Date();
    return {
      type: CharacterConsentRecordType.consent_granted,
      provider: REAL_PERSON_PROVIDER,
      consentVersion: REAL_PERSON_CONSENT_VERSION,
      occurredAt: acceptedAt,
      // Hashes/metadata ONLY — never face bytes, never signed URLs (§1).
      evidence: {
        consentVersion: REAL_PERSON_CONSENT_VERSION,
        consentTextSha256: consentTextSha256(),
        acceptedAt: acceptedAt.toISOString(),
        ip: input.context.ip ?? null,
        userAgent: input.context.userAgent?.slice(0, 300) ?? null,
        locale: input.context.locale?.slice(0, 32) ?? null,
        // Intl adult gate is attestation-based (§2.4, residual risk R2).
        ageGateOutcome: 'adult_attested',
      },
    };
  }

  // ── Session lifecycle ────────────────────────────────────────────────────

  async createSession(
    user: AuthUser,
    characterId: string,
  ): Promise<EnrollmentSessionDto> {
    const character = await this.requireOwnRealPerson(user, characterId);
    if (character.status === CharacterStatus.active) {
      throw new ConflictException({
        code: 'ENROLLMENT_ALREADY_COMPLETED',
        message: 'This character is already verified.',
      });
    }
    if (this.assetsConfig.enrollmentHardBlocked()) {
      throw new ConflictException({
        code: 'ACR_ENROLLMENT_PAUSED',
        message: 'Enrollment is temporarily paused. Please try again later.',
      });
    }
    // Account-wide 3 QPS upstream cap (§6.3) — typed 429, client retries.
    if (!(await this.sync.reserveVisualValidateSlot())) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Verification is busy right now — retry in a moment.',
        },
        429,
      );
    }

    const session = await this.assetsClient.createVisualValidateSession(
      this.callbackUrl(characterId),
    );
    const tokenKey = this.requireTokenKey();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const created = await this.prisma.$transaction(async (tx) => {
      // Single live session per character: stale pending sessions expire now
      // (their vendor tokens are single-use anyway) — hard-delete the token.
      await tx.characterEnrollmentSession.updateMany({
        where: {
          characterId,
          status: CharacterEnrollmentSessionStatus.pending,
        },
        data: {
          status: CharacterEnrollmentSessionStatus.expired,
          statusReason: 'superseded',
          bytedTokenEnc: null,
        },
      });
      const row = await tx.characterEnrollmentSession.create({
        data: {
          characterId,
          ownerUserId: user.userId,
          bytedTokenEnc: encryptEnrollmentToken(session.BytedToken, tokenKey),
          status: CharacterEnrollmentSessionStatus.pending,
          expiresAt,
        },
      });
      await tx.studioCharacter.update({
        where: { id: characterId },
        data: { status: CharacterStatus.pending_verification },
      });
      return row;
    });

    return {
      sessionId: created.id,
      h5Link: session.H5Link,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Completion — idempotent, takes NO client token (design §2.1 ⟦R⟧): the
   * server-stored session token is the only input to the provider pull; a
   * forged callback can at most trigger a poll that finds nothing.
   */
  async complete(user: AuthUser, characterId: string): Promise<void> {
    const character = await this.requireOwnRealPerson(user, characterId);
    if (character.status === CharacterStatus.active) return; // idempotent

    const session = await this.prisma.characterEnrollmentSession.findFirst({
      where: { characterId },
      orderBy: { createdAt: 'desc' },
    });
    if (
      !session ||
      session.status !== CharacterEnrollmentSessionStatus.pending
    ) {
      throw new ConflictException({
        code: 'ENROLLMENT_SESSION_EXPIRED',
        message: 'No active verification session — start again.',
      });
    }
    // Same-user binding: the session creator, the completer, and the
    // character subject must be one authenticated identity.
    if (session.ownerUserId !== user.userId) {
      throw new ForbiddenException({
        code: 'CHARACTER_SUBJECT_MISMATCH',
        message: 'Only the enrolling account can complete verification.',
      });
    }
    if (session.expiresAt < new Date() || !session.bytedTokenEnc) {
      await this.expireSession(session.id, 'expired');
      throw new ConflictException({
        code: 'ENROLLMENT_SESSION_EXPIRED',
        message: 'The verification session expired — start again.',
      });
    }

    const token = decryptEnrollmentToken(
      session.bytedTokenEnc,
      this.requireTokenKey(),
    );
    let groupId: string;
    try {
      const result = await this.assetsClient.getVisualValidateResult(token);
      groupId = result.GroupId;
      if (!groupId) throw new Error('empty GroupId');
    } catch (err) {
      // Provider has no result yet — the user hasn't finished the H5 flow.
      // Keep the session; the client polls status and retries complete().
      this.logger.debug(
        `enrollment pull pending for ${characterId}: ${err instanceof BytePlusAssetsApiError ? err.code : err}`,
      );
      throw new ConflictException({
        code: 'ENROLLMENT_NOT_COMPLETED',
        message:
          'Verification is not confirmed yet — finish the check and retry.',
      });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.aiProviderAssetGroup.upsert({
        where: {
          characterId_provider: {
            characterId,
            provider: REAL_PERSON_PROVIDER,
          },
        },
        create: {
          characterId,
          provider: REAL_PERSON_PROVIDER,
          externalGroupId: groupId,
          groupType: AiProviderAssetGroupType.liveness_face,
          projectName: this.assetsConfig.config.projectName,
          status: AiProviderAssetGroupStatus.active,
        },
        update: {
          externalGroupId: groupId,
          status: AiProviderAssetGroupStatus.active,
        },
      });
      await tx.characterConsentRecord.create({
        data: {
          characterId,
          type: CharacterConsentRecordType.liveness_verification,
          provider: REAL_PERSON_PROVIDER,
          consentVersion: REAL_PERSON_CONSENT_VERSION,
          occurredAt: now,
          evidence: {
            sessionId: session.id,
            externalGroupId: groupId,
            verifiedAt: now.toISOString(),
          },
        },
      });
      await tx.characterEnrollmentSession.update({
        where: { id: session.id },
        data: {
          status: CharacterEnrollmentSessionStatus.completed,
          // Single-use vendor token is hard-deleted on completion (§1).
          bytedTokenEnc: null,
        },
      });
      await tx.studioCharacter.update({
        where: { id: characterId },
        data: { status: CharacterStatus.active },
      });
      await enqueueAssetEventOutbox(tx, {
        userId: user.userId,
        eventType: AiOutboxEventType.character_media_updated,
        payload: {
          kind: 'character_media_updated',
          characterId,
          workspaceId: character.workspaceId,
          characterStatus: CharacterStatus.active,
          updatedAt: now.toISOString(),
          ts: now.getTime(),
        },
      });
    });
  }

  async status(
    user: AuthUser,
    characterId: string,
  ): Promise<EnrollmentStatusDto> {
    const character = await this.requireOwnRealPerson(user, characterId);
    const session = await this.prisma.characterEnrollmentSession.findFirst({
      where: { characterId },
      orderBy: { createdAt: 'desc' },
    });
    if (
      session?.status === CharacterEnrollmentSessionStatus.pending &&
      session.expiresAt < new Date()
    ) {
      // Only report expired if THIS call won the guarded expiry — a
      // concurrent complete() may have flipped it to completed first.
      if (await this.expireSession(session.id, 'expired')) {
        session.status = CharacterEnrollmentSessionStatus.expired;
      }
    }
    return {
      sessionStatus: session?.status ?? 'none',
      characterStatus: character.status,
      ...(session ? { expiresAt: session.expiresAt.toISOString() } : {}),
    };
  }

  // ── §5.1 revocation ──────────────────────────────────────────────────────

  /**
   * ONE transaction: character → revoked AND every provider mirror row →
   * disabled (submit-time checks and the worker seam see it immediately —
   * upstream deletion is async cleanup on the critical lane, not the
   * barrier). Queued jobs die at the worker's prepareReferences re-check
   * before provider submit; provider-accepted in-flight tasks are the
   * documented residual window (R3), compensated by output takedown.
   * Biometric media crypto-shred after the 30-day dispute window is the GC
   * follow-up tracked in the design doc — the ledger itself is append-only
   * and survives.
   */
  async revoke(
    user: AuthUser,
    character: StudioCharacter,
    consentType: CharacterConsentRecordType = CharacterConsentRecordType.revocation,
  ): Promise<void> {
    const now = new Date();
    const teardown = await this.prisma.$transaction(async (tx) => {
      await tx.studioCharacter.update({
        where: { id: character.id },
        data: { status: CharacterStatus.revoked, revokedAt: now },
      });
      const groups = await tx.aiProviderAssetGroup.findMany({
        where: { characterId: character.id },
        include: { externalAssets: { select: { externalAssetId: true } } },
      });
      await tx.aiProviderAssetGroup.updateMany({
        where: { characterId: character.id },
        data: { status: AiProviderAssetGroupStatus.disabled },
      });
      await tx.aiProviderExternalAsset.updateMany({
        where: { providerAssetGroupId: { in: groups.map((g) => g.id) } },
        data: { status: AiProviderExternalAssetStatus.disabled },
      });
      await tx.characterConsentRecord.create({
        data: {
          characterId: character.id,
          type: consentType,
          provider: REAL_PERSON_PROVIDER,
          consentVersion: REAL_PERSON_CONSENT_VERSION,
          occurredAt: now,
          evidence: {
            revokedBy: user.userId,
            revokedAt: now.toISOString(),
            trigger:
              consentType === CharacterConsentRecordType.admin_takedown
                ? 'admin_takedown'
                : 'self_revocation',
          },
        },
      });
      // Cast rows are pure visibility — a revoked likeness leaves every
      // project cast immediately.
      await tx.characterProjectCast.deleteMany({
        where: { characterId: character.id },
      });
      // ⟦v2⟧ Global revoke reconciles every per-project GRANT: flip → revoked
      // + append a scoped revocation per grant (design §5). In-flight jobs are
      // cancelled after commit (below).
      await this.grants.revokeAllGrantsInTx(
        tx,
        character.id,
        consentType === CharacterConsentRecordType.admin_takedown
          ? 'admin_takedown'
          : 'global_revocation',
        user.userId,
      );
      await enqueueAssetEventOutbox(tx, {
        userId: character.subjectUserId ?? character.createdByUserId,
        eventType: AiOutboxEventType.character_media_updated,
        payload: {
          kind: 'character_media_updated',
          characterId: character.id,
          workspaceId: character.workspaceId,
          characterStatus: CharacterStatus.revoked,
          updatedAt: now.toISOString(),
          ts: now.getTime(),
        },
      });
      return {
        externalAssetIds: groups
          .flatMap((g) => g.externalAssets.map((a) => a.externalAssetId))
          .filter((id): id is string => Boolean(id)),
        externalGroupIds: groups.map((g) => g.externalGroupId),
      };
    });
    // Upstream deletes ride the CRITICAL lane (never behind enrollment
    // bursts). Failure here never re-enables anything local.
    await this.sync.enqueueCriticalTeardown(teardown);
    // ⟦v2⟧ Cancel in-flight jobs across EVERY granted project + release holds
    // (prompt cleanup; the worker seam is the barrier). Best-effort.
    await this.grants.cancelJobsForCharacterAllProjects(
      character.id,
      'character_revoked',
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** The character exists, is real_person, and the caller IS the subject. */
  private async requireOwnRealPerson(
    user: AuthUser,
    characterId: string,
  ): Promise<StudioCharacter> {
    const character = await this.prisma.studioCharacter.findFirst({
      where: { id: characterId, deletedAt: null },
    });
    if (!character || character.status === CharacterStatus.revoked) {
      throw new NotFoundException({
        code: 'CHARACTER_NOT_FOUND',
        message: 'Character not found.',
      });
    }
    if (character.kind !== CharacterKind.real_person) {
      throw new BadRequestException({
        code: 'CHARACTER_NOT_REAL_PERSON',
        message: 'Enrollment applies to real-person characters only.',
      });
    }
    if (!this.featureFlags.config.realPersonEnabled) {
      throw new NotImplementedException({
        code: 'REAL_PERSON_NOT_AVAILABLE',
        message: 'Real-person characters are not available yet.',
      });
    }
    if (character.subjectUserId !== user.userId) {
      throw new ForbiddenException({
        code: 'CHARACTER_SUBJECT_MISMATCH',
        message: 'Only the enrolled person can manage this character.',
      });
    }
    return character;
  }

  /** Personal-workspace assertion for real_person create (⟦R5⟧). */
  async requirePersonalWorkspace(
    user: AuthUser,
    workspaceId: string,
  ): Promise<void> {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { type: true, ownerUserId: true },
    });
    if (
      workspace?.type !== WorkspaceType.personal ||
      workspace.ownerUserId !== user.userId
    ) {
      throw new BadRequestException({
        code: 'REAL_PERSON_PERSONAL_ONLY',
        message:
          'A likeness can only be enrolled into your personal library (v1).',
      });
    }
  }

  /** Returns true iff this call actually expired a still-pending session. */
  private async expireSession(id: string, reason: string): Promise<boolean> {
    // Guarded: only a STILL-pending session expires — a concurrent complete()
    // that already committed must never be overwritten back to expired.
    const { count } = await this.prisma.characterEnrollmentSession.updateMany({
      where: { id, status: CharacterEnrollmentSessionStatus.pending },
      data: {
        status: CharacterEnrollmentSessionStatus.expired,
        statusReason: reason,
        bytedTokenEnc: null, // hard-delete on expiry (§1)
      },
    });
    return count > 0;
  }

  private requireTokenKey(): string {
    const key = this.assetsConfig.config.enrollmentTokenKey;
    if (!key) {
      // Unreachable when the flag is on (boot fails loud) — guards tests.
      throw new NotImplementedException({
        code: 'REAL_PERSON_NOT_AVAILABLE',
        message: 'Enrollment is not configured.',
      });
    }
    return key;
  }

  /**
   * The studio callback page is a UX convenience ONLY (tells the tab "go
   * poll now") — inbound callback params never mutate state (§2.1 ⟦R⟧).
   */
  private callbackUrl(characterId: string): string {
    const base =
      process.env.STUDIO_PUBLIC_BASE_URL?.replace(/\/+$/, '') ||
      'https://studio.fizzdragon.com';
    return `${base}/characters/${characterId}?enrollment=callback`;
  }
}
