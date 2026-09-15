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
  Prisma,
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM project_members WHERE project_id = ${projectId}::uuid AND user_id = ${user.userId} FOR UPDATE`;
      const project = await this.requireActiveProject(projectId, tx);
      await this.requireProjectEditor(user, projectId, tx);

      const token = randomBytes(24).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const [{ now }] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
      const invite = await tx.characterCastingInvite.create({
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
    });
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
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM character_casting_invites WHERE id = ${inviteId}::uuid AND project_id = ${projectId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM project_members WHERE project_id = ${projectId}::uuid AND user_id = ${user.userId} FOR UPDATE`;
      await this.requireProjectEditor(user, projectId, tx);
      // Only a still-pending invite can be revoked (idempotent otherwise).
      await tx.characterCastingInvite.updateMany({
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
    await this.prisma.$transaction(async (tx) => {
      const tokenHash = createHash('sha256').update(token.trim()).digest('hex');
      await tx.$queryRaw`SELECT id FROM character_casting_invites WHERE token_hash = ${tokenHash} FOR UPDATE`;
      const invite = await this.requireLiveInvite(user, token, tx);
      await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${invite.projectId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM studio_characters WHERE id = ${characterId}::uuid FOR UPDATE`;
      const project = await this.requireActiveProject(invite.projectId, tx);

      const character = await tx.studioCharacter.findFirst({
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

      // Claim and consent-backed grant commit together; failed consent/storage leaves the token open.
      const [{ now }] = await tx.$queryRaw<
        Array<{ now: Date }>
      >`SELECT clock_timestamp() AS now`;
      const claimed = await tx.characterCastingInvite.updateMany({
        where: {
          id: invite.id,
          status: CharacterCastingInviteStatus.pending,
          expiresAt: { gt: now },
        },
        data: {
          status: CharacterCastingInviteStatus.accepted,
          respondedAt: now,
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
      await this.grants.grantViaAcceptedInvite({
        user,
        characterId,
        project,
        inviteId: invite.id,
        consent,
        context,
        tx,
      });
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async requireLiveInvite(
    user: AuthUser,
    token: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const tokenHash = createHash('sha256').update(token.trim()).digest('hex');
    const invite = await client.characterCastingInvite.findUnique({
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
      await client.characterCastingInvite.updateMany({
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

  private async requireActiveProject(
    projectId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const project = await client.platformProject.findFirst({
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
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const member = await client.projectMember.findFirst({
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
