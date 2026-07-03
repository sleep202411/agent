import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  CharacterConsentRecordType,
  CharacterKind,
  CharacterProjectGrantStatus,
  CharacterStatus,
  PlatformProjectStatus,
  Prisma,
  ProjectMemberRole,
  ProjectMemberStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { CharactersConfigService } from './characters-config.service';
import { GRANT_CONSENT_VERSION, grantConsentTextSha256 } from './consent';
import type { ProjectGrantDto } from './dto';
import {
  REAL_PERSON_JOB_CANCELLER,
  type RealPersonJobCanceller,
} from './ports/real-person-job-canceller';
import {
  REAL_PERSON_LIKENESS_OUTPUTS,
  type LikenessOutputItem,
  type RealPersonLikenessOutputs,
} from './ports/real-person-likeness-outputs';

/**
 * Per-project likeness authorization grants (design v2 §4/§5). A subject
 * authorizes ONE project to use their real_person likeness; the GRANT — not
 * character/group status — is the per-project enforcement source of truth
 * (character-generation.service + the worker seam key on it). Revocation flips
 * only the grant, appends a scoped ledger record, and actively cancels the
 * project's in-flight jobs for that character (defense-in-depth over the
 * worker seam). The account-level enrollment / self-use path is untouched.
 */
/** Versioned consent affirmation the client captures on the grant screen. */
export interface GrantConsent {
  version: string;
  adultAttested: true;
}

/** The grant/casting consent screen must be accepted at the current version. */
function requireGrantConsent(consent: GrantConsent): void {
  if (
    consent?.version !== GRANT_CONSENT_VERSION ||
    consent.adultAttested !== true
  ) {
    throw new BadRequestException({
      code: 'CONSENT_REQUIRED',
      message:
        'The current likeness-authorization consent must be accepted (with adult attestation).',
    });
  }
}

@Injectable()
export class CharacterGrantService {
  private readonly logger = new Logger(CharacterGrantService.name);

  private cachedCanceller: RealPersonJobCanceller | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlags: CharactersConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Resolve the job-cancellation port lazily (strict:false scans the whole
   * container) so the characters module does not import AiGenerationModule —
   * that would cycle, since generation imports characters for reference
   * expansion. Cached after first resolution.
   */
  private get jobCanceller(): RealPersonJobCanceller {
    if (!this.cachedCanceller) {
      this.cachedCanceller = this.moduleRef.get<RealPersonJobCanceller>(
        REAL_PERSON_JOB_CANCELLER,
        { strict: false },
      );
    }
    return this.cachedCanceller;
  }

  private cachedOutputs: RealPersonLikenessOutputs | null = null;

  /** Lazily resolve the likeness-outputs port (same rationale as above). */
  private get likenessOutputs(): RealPersonLikenessOutputs {
    if (!this.cachedOutputs) {
      this.cachedOutputs = this.moduleRef.get<RealPersonLikenessOutputs>(
        REAL_PERSON_LIKENESS_OUTPUTS,
        { strict: false },
      );
    }
    return this.cachedOutputs;
  }

  /**
   * Subject self-grants a project (the B1 collaborator path — the subject is
   * already a project editor). Idempotent: an existing active grant is
   * returned unchanged. Appends a fresh scoped consent_granted record.
   */
  async grantProject(
    user: AuthUser,
    characterId: string,
    projectId: string,
    consent: GrantConsent,
    context: { ip?: string; userAgent?: string } = {},
  ): Promise<ProjectGrantDto> {
    requireGrantConsent(consent);
    const character = await this.requireOwnRealPerson(user, characterId);
    if (character.status !== CharacterStatus.active) {
      throw new ConflictException({
        code: 'CHARACTER_NOT_ACTIVE',
        message: 'Complete identity verification before authorizing a project.',
      });
    }
    const project = await this.prisma.platformProject.findFirst({
      where: {
        id: projectId,
        status: PlatformProjectStatus.active,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found.',
      });
    }
    await this.requireProjectEditor(user, projectId);

    return this.createActiveGrant({
      characterId,
      project,
      grantedByUserId: user.userId,
      context,
      via: 'self_grant',
    });
  }

  /**
   * Grant authorized by an ACCEPTED casting invite (design §D-B), NOT by
   * ProjectMember-ship — the external actor lends their likeness without
   * joining the project. Caller (CharacterCastingService) has already
   * validated the invite + that `user` is the invitee + owns an active
   * real_person `characterId`.
   */
  async grantViaAcceptedInvite(args: {
    user: AuthUser;
    characterId: string;
    project: { id: string; name: string };
    inviteId: string;
    consent: GrantConsent;
    context?: { ip?: string; userAgent?: string };
  }): Promise<ProjectGrantDto> {
    requireGrantConsent(args.consent);
    return this.createActiveGrant({
      characterId: args.characterId,
      project: args.project,
      grantedByUserId: args.user.userId,
      context: args.context ?? {},
      via: 'casting_invite',
      inviteId: args.inviteId,
    });
  }

  /** Shared grant-creation core: idempotent, appends the scoped consent. */
  private async createActiveGrant(args: {
    characterId: string;
    project: { id: string; name: string };
    grantedByUserId: string;
    context: { ip?: string; userAgent?: string };
    via: 'self_grant' | 'casting_invite';
    inviteId?: string;
  }): Promise<ProjectGrantDto> {
    const existing = await this.prisma.characterProjectGrant.findFirst({
      where: {
        characterId: args.characterId,
        projectId: args.project.id,
        status: CharacterProjectGrantStatus.active,
      },
    });
    if (existing) return this.toDto(existing, args.project.name);

    const now = new Date();
    let grant;
    try {
      grant = await this.prisma.$transaction(async (tx) => {
        // The scoped consent is the legal anchor for THIS authorization — a
        // fresh, timestamped record (never reused across re-grants).
        const consent = await tx.characterConsentRecord.create({
          data: {
            characterId: args.characterId,
            type: CharacterConsentRecordType.consent_granted,
            provider: null,
            consentVersion: GRANT_CONSENT_VERSION,
            scopeProjectId: args.project.id,
            occurredAt: now,
            evidence: {
              grantConsentVersion: GRANT_CONSENT_VERSION,
              grantConsentTextSha256: grantConsentTextSha256(args.project.name),
              projectId: args.project.id,
              projectName: args.project.name,
              via: args.via,
              ...(args.inviteId ? { castingInviteId: args.inviteId } : {}),
              // The client-affirmed consent (adult attestation) captured on the
              // grant screen — the reversed-proof burden for third-party use.
              adultAttested: true,
              grantedAt: now.toISOString(),
              ip: args.context.ip ?? null,
              userAgent: args.context.userAgent?.slice(0, 300) ?? null,
            },
          },
        });
        return tx.characterProjectGrant.create({
          data: {
            characterId: args.characterId,
            projectId: args.project.id,
            grantedByUserId: args.grantedByUserId,
            status: CharacterProjectGrantStatus.active,
            consentRecordId: consent.id,
          },
        });
      });
    } catch (err) {
      // Lost the race to the partial-active unique index (two concurrent
      // grants for the same character+project) — re-read and return the
      // committed active grant, keeping the operation idempotent.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.prisma.characterProjectGrant.findFirst({
          where: {
            characterId: args.characterId,
            projectId: args.project.id,
            status: CharacterProjectGrantStatus.active,
          },
        });
        if (winner) return this.toDto(winner, args.project.name);
      }
      throw err;
    }
    return this.toDto(grant, args.project.name);
  }

  /**
   * Subject withdraws a project authorization. Reachable from the character
   * detail surface even if the subject was removed from the project (they must
   * always be able to withdraw). Flips the grant, appends a scoped revocation,
   * and cancels the project's in-flight jobs for this character. Idempotent.
   */
  async revokeProjectGrant(
    user: AuthUser,
    characterId: string,
    projectId: string,
  ): Promise<void> {
    const character = await this.requireOwnRealPerson(user, characterId);
    await this.revokeGrantRows(
      { characterId, projectId },
      { revokedByUserId: user.userId, trigger: 'self_revocation' },
    );
    // Prompt cleanup (worker seam is the barrier): cancel this project's
    // in-flight jobs for the character + release holds. Best-effort.
    void this.cancelJobsSafe(character.id, projectId, 'grant_revoked');
  }

  /** Subject lists their per-project authorizations (active + revoked). */
  async listGrants(
    user: AuthUser,
    characterId: string,
  ): Promise<{ items: ProjectGrantDto[] }> {
    await this.requireOwnRealPerson(user, characterId);
    const grants = await this.prisma.characterProjectGrant.findMany({
      where: { characterId },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } },
    });
    return {
      items: grants.map((g) => this.toDto(g, g.project.name)),
    };
  }

  // ── §6 subject visibility + takedown over their own likeness outputs ──────

  /** Every video generated from the subject's likeness (optionally one project). */
  async listLikenessOutputs(
    user: AuthUser,
    characterId: string,
    projectId?: string,
  ): Promise<{ items: LikenessOutputItem[] }> {
    await this.requireOwnRealPerson(user, characterId, {
      includeDeleted: true,
    });
    const items = await this.likenessOutputs.listForCharacter({
      characterId,
      projectId,
    });
    return { items };
  }

  /**
   * Subject takes down outputs made from their likeness (design §6): the
   * withdrawal path over ALREADY-GENERATED videos that per-project grant
   * revocation cannot reach. Scoped to a project or a single job. Physical
   * takedown runs through the media moderation service (block + CDN purge).
   */
  async takedownLikenessOutputs(
    user: AuthUser,
    characterId: string,
    scope: { projectId?: string; jobId?: string },
  ): Promise<{ blocked: number }> {
    await this.requireOwnRealPerson(user, characterId, {
      includeDeleted: true,
    });
    const blocked = await this.likenessOutputs.takedownForCharacter({
      characterId,
      projectId: scope.projectId,
      jobId: scope.jobId,
      byUserId: user.userId,
    });
    return { blocked };
  }

  // ── Reconciliation (called from other lifecycle seams) ───────────────────

  /**
   * Global character revoke (design §5): the enrollment.revoke() transaction
   * flips every active grant → revoked + appends a scoped revocation per grant.
   * Runs INSIDE the caller's transaction (no job cancel here — the caller does
   * that after commit via {@link cancelJobsForCharacterAllProjects}).
   */
  async revokeAllGrantsInTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    trigger: string,
    revokedByUserId: string,
  ): Promise<void> {
    const active = await tx.characterProjectGrant.findMany({
      where: { characterId, status: CharacterProjectGrantStatus.active },
      select: { id: true, projectId: true },
    });
    if (active.length === 0) return;
    const now = new Date();
    for (const grant of active) {
      const consent = await tx.characterConsentRecord.create({
        data: {
          characterId,
          type: CharacterConsentRecordType.revocation,
          consentVersion: GRANT_CONSENT_VERSION,
          scopeProjectId: grant.projectId,
          occurredAt: now,
          evidence: { revokedByUserId, revokedAt: now.toISOString(), trigger },
        },
      });
      void consent;
      await tx.characterProjectGrant.update({
        where: { id: grant.id },
        data: { status: CharacterProjectGrantStatus.revoked, revokedAt: now },
      });
    }
  }

  /** Post-commit job cancel across every project (global revoke). */
  async cancelJobsForCharacterAllProjects(
    characterId: string,
    reason: string,
  ): Promise<void> {
    await this.cancelJobsSafe(characterId, undefined, reason);
  }

  /**
   * Membership-loss trigger (design §5): when a user is removed from a project,
   * auto-revoke any grants where THEY are the subject for THAT project — a
   * likeness owner who leaves a project should not keep it authorized. The
   * generation-time re-check already blocks removed GENERATORS; this cleans up
   * the owner's dangling grant + cancels in-flight jobs.
   */
  async revokeGrantsOnMembershipLoss(
    subjectUserId: string,
    projectId: string,
  ): Promise<void> {
    const grants = await this.prisma.characterProjectGrant.findMany({
      where: {
        projectId,
        status: CharacterProjectGrantStatus.active,
        character: { subjectUserId },
      },
      select: { characterId: true },
    });
    for (const grant of grants) {
      try {
        await this.revokeGrantRows(
          { characterId: grant.characterId, projectId },
          { revokedByUserId: subjectUserId, trigger: 'membership_loss' },
        );
        void this.cancelJobsSafe(
          grant.characterId,
          projectId,
          'membership_loss',
        );
      } catch (err) {
        this.logger.warn(
          `membership-loss grant revoke failed (char=${grant.characterId}, project=${projectId}): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  /**
   * Project delete/archive trigger (design §5/§7): revoke every active grant
   * for the project with an audited ledger record + job cancel. The grant's
   * project FK is Restrict, so this MUST run before the project row is removed.
   */
  async revokeGrantsForProject(
    projectId: string,
    trigger: string,
  ): Promise<void> {
    const grants = await this.prisma.characterProjectGrant.findMany({
      where: { projectId, status: CharacterProjectGrantStatus.active },
      select: { characterId: true },
    });
    for (const grant of grants) {
      try {
        await this.revokeGrantRows(
          { characterId: grant.characterId, projectId },
          { revokedByUserId: 'system', trigger },
        );
        void this.cancelJobsSafe(grant.characterId, projectId, trigger);
      } catch (err) {
        this.logger.warn(
          `project-teardown grant revoke failed (char=${grant.characterId}, project=${projectId}): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** Flip the active grant (if any) → revoked + append a scoped revocation. */
  private async revokeGrantRows(
    key: { characterId: string; projectId: string },
    audit: { revokedByUserId: string; trigger: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const grant = await tx.characterProjectGrant.findFirst({
        where: {
          characterId: key.characterId,
          projectId: key.projectId,
          status: CharacterProjectGrantStatus.active,
        },
        select: { id: true },
      });
      if (!grant) return; // idempotent
      const now = new Date();
      await tx.characterConsentRecord.create({
        data: {
          characterId: key.characterId,
          type: CharacterConsentRecordType.revocation,
          consentVersion: GRANT_CONSENT_VERSION,
          scopeProjectId: key.projectId,
          occurredAt: now,
          evidence: {
            revokedByUserId: audit.revokedByUserId,
            revokedAt: now.toISOString(),
            trigger: audit.trigger,
            projectId: key.projectId,
          },
        },
      });
      await tx.characterProjectGrant.update({
        where: { id: grant.id },
        data: { status: CharacterProjectGrantStatus.revoked, revokedAt: now },
      });
    });
  }

  private async cancelJobsSafe(
    characterId: string,
    projectId: string | undefined,
    reason: string,
  ): Promise<void> {
    try {
      await this.jobCanceller.cancelJobsForCharacter({
        characterId,
        projectId,
        reason,
      });
    } catch (err) {
      this.logger.warn(
        `job cancellation on revoke failed (char=${characterId}, project=${projectId ?? 'ALL'}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async requireProjectEditor(
    user: AuthUser,
    projectId: string,
  ): Promise<void> {
    // Explicit ProjectMember editor+ ONLY — no workspace-role fallback (design
    // §4: a grant must be scoped to the project team, not the host workspace).
    const member = await this.prisma.projectMember.findFirst({
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
    if (!member) {
      throw new ForbiddenException({
        code: 'PROJECT_EDITOR_REQUIRED',
        message: 'You must be a project editor to authorize it.',
      });
    }
  }

  private async requireOwnRealPerson(
    user: AuthUser,
    characterId: string,
    opts: { includeDeleted?: boolean } = {},
  ) {
    const character = await this.prisma.studioCharacter.findFirst({
      // §6 output visibility/takedown must survive the character being
      // tombstoned (deletedAt set) — the outputs persist and the subject must
      // still be able to withdraw them. Grant/list-grant paths keep the
      // deletedAt:null constraint (a deleted character can't be re-granted).
      where: {
        id: characterId,
        ...(opts.includeDeleted ? {} : { deletedAt: null }),
      },
      select: {
        id: true,
        kind: true,
        status: true,
        subjectUserId: true,
      },
    });
    if (!character) {
      throw new NotFoundException({
        code: 'CHARACTER_NOT_FOUND',
        message: 'Character not found.',
      });
    }
    if (character.kind !== CharacterKind.real_person) {
      throw new BadRequestException({
        code: 'CHARACTER_NOT_REAL_PERSON',
        message:
          'Project authorization applies to real-person characters only.',
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
        message: 'Only the enrolled person can authorize their own likeness.',
      });
    }
    return character;
  }

  private toDto(
    grant: {
      id: string;
      projectId: string;
      status: CharacterProjectGrantStatus;
      createdAt: Date;
      revokedAt: Date | null;
    },
    projectName: string,
  ): ProjectGrantDto {
    return {
      id: grant.id,
      projectId: grant.projectId,
      projectName,
      status: grant.status,
      createdAt: grant.createdAt.toISOString(),
      revokedAt: grant.revokedAt?.toISOString() ?? null,
    };
  }
}
