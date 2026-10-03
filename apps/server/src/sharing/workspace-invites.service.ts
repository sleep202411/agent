/**
 * Workspace invite links — create / list / revoke / accept. A link is a
 * shareable bearer secret: only `sha256(token)` is stored (`tokenHash`); the
 * raw token is returned exactly once at creation and never persisted. Anyone
 * with the link can join the team at the link's role until it is revoked or
 * expires (multi-use, the Figma/Notion "anyone with the link" model — distinct
 * from the targeted add-by-account path in WorkspaceMembersService).
 *
 * Accept is idempotent per user: joining twice is a no-op (the partial-unique
 * active-membership index + an existence check guard the race). Expiry is lazy
 * (no sweeper) — a pending link past `expiresAt` reads as expired and is
 * persisted as such on the next touch. A personal workspace takes links too; the
 * seat policy alone decides how many people can join through them.
 */
import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WorkspaceInviteStatus,
  WorkspaceMemberAccessScope,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  WorkspaceStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { EntitlementService } from '../entitlements/entitlement.service';
import { PrismaService } from '../infra/db/db.module';
import { PlatformAuditLogService } from '../workspaces/audit-log.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import type { CreateInviteInput, AssignableRole } from './dto';
import { generateInviteToken } from './invite-token';
import {
  acquireSeatLock,
  assertCreatorSeatAvailable,
  workspaceRoleConsumesCreatorSeat,
} from './seat-guard';
import { enqueueTeamMemberChanged } from './team-realtime';
import {
  toWorkspaceInviteDTO,
  type InvitePreviewDTO,
  type ShareInviteDTO,
} from './mappers';
import {
  effectiveInviteStatus,
  isUniqueViolation,
  existingInviteAccess,
  resolveInviteExpiresAt,
} from './util';

const ROLE_MAP: Record<AssignableRole, WorkspaceMemberRole> = {
  admin: WorkspaceMemberRole.admin,
  editor: WorkspaceMemberRole.editor,
  viewer: WorkspaceMemberRole.viewer,
};

@Injectable()
export class WorkspaceInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: WorkspacePermissionService,
    private readonly audit: PlatformAuditLogService,
    private readonly entitlements: EntitlementService,
  ) {}

  /** Create a shareable link. Returns the raw token once — caller builds the URL. */
  async create(workspaceId: string, actor: AuthUser, input: CreateInviteInput) {
    // 404 a deleted/suspended workspace before minting a link for it.
    await this.requireWorkspace(workspaceId);
    await this.permissions.requireWorkspaceRole(
      actor.userId,
      workspaceId,
      WorkspaceMemberRole.admin,
    );

    const role = ROLE_MAP[input.role];
    const { token, tokenHash } = generateInviteToken();
    const expiresAt = resolveInviteExpiresAt(input.expiresInDays);
    const invite = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.workspaceInvite.create({
        data: {
          workspaceId,
          role,
          tokenHash,
          status: WorkspaceInviteStatus.pending,
          invitedById: actor.userId,
          expiresAt,
        },
      });
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor.userId,
          action: 'workspace.invite.created',
          entityType: 'workspace_invite',
          entityId: invite.id,
          after: { role, expiresAt: expiresAt?.toISOString() ?? null },
        },
        tx,
      );
      return invite;
    });
    return {
      inviteId: invite.id,
      token,
      role: invite.role,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    };
  }

  /** Admin view of active links (effective status, never the token). */
  async list(workspaceId: string, actor: AuthUser): Promise<ShareInviteDTO[]> {
    await this.permissions.requireWorkspaceRole(
      actor.userId,
      workspaceId,
      WorkspaceMemberRole.admin,
    );
    const invites = await this.prisma.workspaceInvite.findMany({
      where: { workspaceId, status: WorkspaceInviteStatus.pending },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      ...toWorkspaceInviteDTO(i),
      status: effectiveInviteStatus(i),
    }));
  }

  async revoke(
    workspaceId: string,
    actor: AuthUser,
    inviteId: string,
  ): Promise<void> {
    await this.permissions.requireWorkspaceRole(
      actor.userId,
      workspaceId,
      WorkspaceMemberRole.admin,
    );
    const invite = await this.prisma.workspaceInvite.findFirst({
      where: {
        id: inviteId,
        workspaceId,
        status: WorkspaceInviteStatus.pending,
      },
    });
    if (!invite) {
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        msg: 'Invite not found or already closed.',
      });
    }
    await this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: { status: WorkspaceInviteStatus.revoked, revokedAt: new Date() },
    });
    await this.audit.record({
      workspaceId,
      actorUserId: actor.userId,
      action: 'workspace.invite.revoked',
      entityType: 'workspace_invite',
      entityId: inviteId,
    });
  }

  /** Scope-agnostic resolver used by InvitesController (any status). */
  findByHash(tokenHash: string) {
    return this.prisma.workspaceInvite.findUnique({ where: { tokenHash } });
  }

  async preview(
    invite: NonNullable<Awaited<ReturnType<this['findByHash']>>>,
    user: AuthUser,
  ): Promise<InvitePreviewDTO> {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: invite.workspaceId, deletedAt: null },
      select: { name: true },
    });
    let currentRole: WorkspaceMemberRole | undefined;
    const existingAccess = workspace
      ? await existingInviteAccess(async () => {
          const member = await this.permissions.requireWorkspaceRole(
            user.userId,
            invite.workspaceId,
            WorkspaceMemberRole.viewer,
          );
          currentRole = member.role;
          return {
            scope: 'workspace' as const,
            workspaceId: invite.workspaceId,
            targetName: workspace.name,
          };
        })
      : null;
    return {
      existingAccess,
      currentRole,
      scope: 'workspace',
      targetName: workspace?.name ?? 'a team',
      role: invite.role,
      status: effectiveInviteStatus(invite),
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    };
  }

  /** Join the workspace via the link. Idempotent per user; 410 if not usable. */
  async accept(
    invite: NonNullable<Awaited<ReturnType<this['findByHash']>>>,
    user: AuthUser,
  ): Promise<{ scope: 'workspace'; workspaceId: string; targetName: string }> {
    const workspace = await this.requireWorkspace(invite.workspaceId);

    // The caller's row may be stale (a revoke could have landed since lookup);
    // re-read fresh, then re-validate under a row lock below.
    const current = await this.prisma.workspaceInvite.findUnique({
      where: { id: invite.id },
    });
    if (!current) {
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        msg: 'This invite link is invalid.',
      });
    }
    await this.assertUsable(current);

    let created = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (workspaceRoleConsumesCreatorSeat(current.role)) {
          await acquireSeatLock(tx, invite.workspaceId);
        }
        // Lock the invite row so a concurrent revoke/expiry cannot slip between
        // the status check and the membership insert (TOCTOU).
        const locked = await tx.$queryRaw<
          { status: WorkspaceInviteStatus; expires_at: Date | null }[]
        >`SELECT status, expires_at FROM workspace_invites WHERE id = ${invite.id}::uuid FOR UPDATE`;
        const row = locked[0];
        if (
          !row ||
          row.status !== WorkspaceInviteStatus.pending ||
          (row.expires_at !== null && row.expires_at.getTime() <= Date.now())
        ) {
          throw new GoneException({
            code: 'INVITE_NOT_ACTIVE',
            msg: 'This invite link is no longer active.',
          });
        }

        const active = await tx.workspaceMember.findFirst({
          where: {
            workspaceId: invite.workspaceId,
            userId: user.userId,
            removedAt: null,
          },
          select: { id: true, accessScope: true },
        });
        if (active?.accessScope === WorkspaceMemberAccessScope.workspace) {
          return;
        }

        // A previously-removed member must not silently rejoin via an open link
        // (offboarding bypass); an admin re-adds them by account explicitly.
        const removed = active
          ? null
          : await tx.workspaceMember.findFirst({
              where: {
                workspaceId: invite.workspaceId,
                userId: user.userId,
                removedAt: { not: null },
              },
              select: { id: true },
            });
        if (removed) {
          throw new ForbiddenException({
            code: 'REMOVED_CANNOT_REJOIN',
            msg: 'You were removed from this team. Ask an admin to re-invite you.',
          });
        }

        if (workspaceRoleConsumesCreatorSeat(current.role)) {
          await assertCreatorSeatAvailable(
            tx,
            invite.workspaceId,
            user.userId,
            this.entitlements,
          );
        }

        const memberData = {
          role: current.role,
          status: WorkspaceMemberStatus.active,
          accessScope: WorkspaceMemberAccessScope.workspace,
          invitedById: current.invitedById,
          joinedAt: new Date(),
        } as const;
        const m = active
          ? await tx.workspaceMember.update({
              where: { id: active.id },
              data: memberData,
            })
          : await tx.workspaceMember.create({
              data: {
                workspaceId: invite.workspaceId,
                userId: user.userId,
                ...memberData,
              },
            });
        // Stamp last-accepted; the link stays pending (multi-use) until revoke/expiry.
        await tx.workspaceInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
        // Realtime: same as add-by-account — teammates see the new member live.
        await enqueueTeamMemberChanged(tx, {
          workspaceId: invite.workspaceId,
          action: 'added',
          member: {
            id: m.id,
            userId: m.userId,
            role: m.role,
            status: m.status,
          },
          actorUserId: user.userId,
        });
        created = true;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A unique failure can roll back any write in the transaction. Only an
      // independently committed access grant makes this an idempotent success.
      const hasAccess = await existingInviteAccess(async () => {
        await this.permissions.requireWorkspaceRole(
          user.userId,
          invite.workspaceId,
          WorkspaceMemberRole.viewer,
        );
        return true;
      });
      if (!hasAccess) throw err;
    }

    // Record the accept regardless of whether this call created the row or
    // raced/no-op'd, so concurrent accepts aren't a forensics gap.
    await this.audit.record({
      workspaceId: invite.workspaceId,
      actorUserId: user.userId,
      action: 'workspace.invite.accepted',
      entityType: 'workspace_invite',
      entityId: invite.id,
      after: { userId: user.userId, role: current.role, created },
    });

    return {
      scope: 'workspace',
      workspaceId: invite.workspaceId,
      targetName: workspace.name,
    };
  }

  /**
   * Fast-path 410 for a link that is already closed (revoked / expired /
   * accepted), persisting lazy expiry. The locked re-check in accept() is the
   * race-safe backstop; this avoids opening a transaction for the common case.
   */
  private async assertUsable(invite: {
    id: string;
    status: WorkspaceInviteStatus;
    expiresAt: Date | null;
  }): Promise<void> {
    const status = effectiveInviteStatus(invite);
    if (status === WorkspaceInviteStatus.revoked) {
      throw new GoneException({
        code: 'INVITE_REVOKED',
        msg: 'This invite link has been revoked.',
      });
    }
    if (status === 'expired') {
      if (invite.status === WorkspaceInviteStatus.pending) {
        await this.prisma.workspaceInvite
          .update({
            where: { id: invite.id },
            data: { status: WorkspaceInviteStatus.expired },
          })
          .catch(() => undefined);
      }
      throw new GoneException({
        code: 'INVITE_EXPIRED',
        msg: 'This invite link has expired.',
      });
    }
    if (status === WorkspaceInviteStatus.accepted) {
      throw new GoneException({
        code: 'INVITE_NOT_ACTIVE',
        msg: 'This invite link is no longer active.',
      });
    }
  }

  private async requireWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        deletedAt: null,
        status: WorkspaceStatus.active,
      },
      select: { id: true, name: true },
    });
    if (!ws) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        msg: 'Workspace not found.',
      });
    }
    return ws;
  }
}
