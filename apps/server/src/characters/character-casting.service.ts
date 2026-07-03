import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  CharacterCastingInviteStatus,
  CharacterKind,
  CharacterStatus,
  PlatformProjectStatus,
  ProjectMemberRole,
  ProjectMemberStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  CharacterGrantService,
  type GrantConsent,
} from './character-grant.service';
import { CharactersConfigService } from './characters-config.service';
import type {
  CastingInviteCreatedDto,
  CastingInviteDto,
  CastingInvitePreviewDto,
  CreateCastingInviteInput,
} from './dto';

/** Casting invites live 7 days. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * B2 casting invites (design §D-B): a director invites a person to LEND their
 * likeness to a project. Distinct from ProjectMember/ProjectInvite — the actor
 * never becomes a project collaborator and never sees project content.
 * Acceptance authorizes a per-project GRANT (via CharacterGrantService) from
 * the actor's OWN active real_person character. Only the bearer sha256 of the
 * single-use token is stored (same posture as ProjectInvite).
 */
@Injectable()
export class CharacterCastingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlags: CharactersConfigService,
    private readonly grants: CharacterGrantService,
  ) {}

  async createInvite(
    user: AuthUser,
    projectId: string,
    input: CreateCastingInviteInput,
  ): Promise<CastingInviteCreatedDto> {
    this.requireRealPersonEnabled();
    const project = await this.requireActiveProject(projectId);
    await this.requireProjectEditor(user, projectId);

    const token = randomBytes(24).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const invite = await this.prisma.characterCastingInvite.create({
      data: {
        projectId: project.id,
        invitedByUserId: user.userId,
        inviteeUserId: input.inviteeUserId ?? null,
        inviteeContact: input.inviteeContact ?? null,
        tokenHash,
        status: CharacterCastingInviteStatus.pending,
        expiresAt,
      },
    });
    return { id: invite.id, token, expiresAt: expiresAt.toISOString() };
  }

  async listInvites(
    user: AuthUser,
    projectId: string,
  ): Promise<{ items: CastingInviteDto[] }> {
    await this.requireActiveProject(projectId);
    await this.requireProjectEditor(user, projectId);
    const invites = await this.prisma.characterCastingInvite.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return { items: invites.map((i) => this.toDto(i)) };
  }

  async revokeInvite(
    user: AuthUser,
    projectId: string,
    inviteId: string,
  ): Promise<void> {
    await this.requireProjectEditor(user, projectId);
    // Only a still-pending invite can be revoked (idempotent otherwise).
    await this.prisma.characterCastingInvite.updateMany({
      where: {
        id: inviteId,
        projectId,
        status: CharacterCastingInviteStatus.pending,
      },
      data: {
        status: CharacterCastingInviteStatus.revoked,
        respondedAt: new Date(),
      },
    });
  }

  /** Token-gated preview for the invited actor (before accepting). */
  async previewInvite(
    user: AuthUser,
    token: string,
  ): Promise<CastingInvitePreviewDto> {
    const invite = await this.requireLiveInvite(user, token);
    const project = await this.prisma.platformProject.findUnique({
      where: { id: invite.projectId },
      select: { id: true, name: true },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found.',
      });
    }
    return {
      projectId: project.id,
      projectName: project.name,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      acceptable: invite.status === CharacterCastingInviteStatus.pending,
    };
  }

  /**
   * Actor accepts: lends their OWN active real_person character to the project
   * via a per-project grant (the invite — not ProjectMember-ship — is the
   * authorization). The actor must have enrolled first; if they have no active
   * real_person character, they enroll separately and re-accept with its id.
   */
  async acceptInvite(
    user: AuthUser,
    token: string,
    characterId: string,
    consent: GrantConsent,
    context: { ip?: string; userAgent?: string } = {},
  ): Promise<void> {
    const invite = await this.requireLiveInvite(user, token);
    const project = await this.requireActiveProject(invite.projectId);

    const character = await this.prisma.studioCharacter.findFirst({
      where: { id: characterId, deletedAt: null },
      select: { id: true, kind: true, status: true, subjectUserId: true },
    });
    if (!character || character.subjectUserId !== user.userId) {
      throw new ForbiddenException({
        code: 'CHARACTER_SUBJECT_MISMATCH',
        message: 'You can only lend your own verified likeness.',
      });
    }
    if (character.kind !== CharacterKind.real_person) {
      throw new BadRequestException({
        code: 'CHARACTER_NOT_REAL_PERSON',
        message: 'Casting applies to real-person characters only.',
      });
    }
    if (character.status !== CharacterStatus.active) {
      throw new ConflictException({
        code: 'ENROLLMENT_REQUIRED',
        message: 'Complete identity verification before accepting a casting.',
      });
    }

    // Atomically CLAIM the single-use token (pending→accepted) BEFORE minting
    // the grant — two concurrent accepts of one invite must not both create a
    // grant. The guarded updateMany is the barrier: exactly one wins.
    const claimed = await this.prisma.characterCastingInvite.updateMany({
      where: { id: invite.id, status: CharacterCastingInviteStatus.pending },
      data: {
        status: CharacterCastingInviteStatus.accepted,
        respondedAt: new Date(),
        // Bind an open-link invite to the accepting user on first claim.
        inviteeUserId: invite.inviteeUserId ?? user.userId,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({
        code: 'CASTING_INVITE_NOT_PENDING',
        message: 'This casting invite is no longer open.',
      });
    }
    // grantViaAcceptedInvite is itself idempotent (active-grant re-read), so a
    // partial failure after the claim is safe to retry.
    await this.grants.grantViaAcceptedInvite({
      user,
      characterId,
      project,
      inviteId: invite.id,
      consent,
      context,
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async requireLiveInvite(user: AuthUser, token: string) {
    const tokenHash = createHash('sha256').update(token.trim()).digest('hex');
    const invite = await this.prisma.characterCastingInvite.findUnique({
      where: { tokenHash },
    });
    if (!invite) {
      throw new NotFoundException({
        code: 'CASTING_INVITE_NOT_FOUND',
        message: 'Casting invite not found.',
      });
    }
    if (
      invite.status === CharacterCastingInviteStatus.pending &&
      invite.expiresAt < new Date()
    ) {
      await this.prisma.characterCastingInvite.updateMany({
        where: { id: invite.id, status: CharacterCastingInviteStatus.pending },
        data: { status: CharacterCastingInviteStatus.expired },
      });
      invite.status = CharacterCastingInviteStatus.expired;
    }
    if (invite.status !== CharacterCastingInviteStatus.pending) {
      throw new ConflictException({
        code: 'CASTING_INVITE_NOT_PENDING',
        message: 'This casting invite is no longer open.',
      });
    }
    // A bound invite may be accepted ONLY by its named invitee.
    if (invite.inviteeUserId && invite.inviteeUserId !== user.userId) {
      throw new ForbiddenException({
        code: 'CASTING_INVITE_NOT_YOURS',
        message: 'This casting invite was sent to someone else.',
      });
    }
    return invite;
  }

  private async requireActiveProject(projectId: string) {
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
    return project;
  }

  private async requireProjectEditor(
    user: AuthUser,
    projectId: string,
  ): Promise<void> {
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
        message: 'You must be a project editor to invite a cast member.',
      });
    }
  }

  private requireRealPersonEnabled(): void {
    if (!this.featureFlags.config.realPersonEnabled) {
      throw new NotImplementedException({
        code: 'REAL_PERSON_NOT_AVAILABLE',
        message: 'Real-person characters are not available yet.',
      });
    }
  }

  private toDto(invite: {
    id: string;
    projectId: string;
    inviteeUserId: string | null;
    inviteeContact: string | null;
    status: CharacterCastingInviteStatus;
    expiresAt: Date;
    createdAt: Date;
    respondedAt: Date | null;
  }): CastingInviteDto {
    return {
      id: invite.id,
      projectId: invite.projectId,
      inviteeUserId: invite.inviteeUserId,
      inviteeContact: invite.inviteeContact,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
      respondedAt: invite.respondedAt?.toISOString() ?? null,
    };
  }
}
