import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingSubjectType,
  EntitlementGrantStatus,
  WorkspaceStatus,
  type EntitlementGrant,
} from '@prisma/client';
import { MembershipGrantAdminService } from './membership-grant-admin.service';
import type { PrismaService } from '../infra/db/db.module';
import type { EntitlementService } from '../entitlements';

jest.mock('./entitlement-realtime', () => ({
  enqueueEntitlementChanged: jest.fn().mockResolvedValue(undefined),
}));

// Relative to the real clock on purpose. This was a hard-coded
// '2026-07-17T12:00:00Z' while the service reads the real clock, so every
// fixture ended NOW+7d and the suite silently started failing once real time
// passed 2026-07-24. Faking the clock is not an option here — the service
// awaits, and fake timers stall its promises.
const NOW = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

function grantRow(overrides: Partial<EntitlementGrant> = {}): EntitlementGrant {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    subjectType: BillingSubjectType.user,
    subjectId: 'user-1',
    planKey: 'pro',
    status: EntitlementGrantStatus.active,
    sourceType: 'admin_manual',
    sourceId: 'src-1',
    startsAt: new Date(NOW.getTime() - DAY_MS),
    endsAt: new Date(NOW.getTime() + 7 * DAY_MS),
    metadata: { note: '临时提并发', grantedBy: 'admin-1' },
    createdAt: new Date(NOW.getTime() - DAY_MS),
    updatedAt: new Date(NOW.getTime() - DAY_MS),
    revokedAt: null,
    ...overrides,
  } as EntitlementGrant;
}

describe('MembershipGrantAdminService', () => {
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    entitlementGrant: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    workspace: { findFirst: jest.Mock };
  };
  let entitlements: {
    grantComplimentary: jest.MockedFunction<
      EntitlementService['grantComplimentary']
    >;
  };
  let service: MembershipGrantAdminService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ now: new Date() }]),
      entitlementGrant: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workspace: { findFirst: jest.fn() },
    };
    prisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) =>
      Promise.resolve(run(prisma)),
    );
    entitlements = { grantComplimentary: jest.fn() };
    service = new MembershipGrantAdminService(
      prisma as unknown as PrismaService,
      entitlements as unknown as EntitlementService,
    );
  });

  describe('grant', () => {
    it('delegates to grantComplimentary with admin_manual source and a fresh sourceId per call', async () => {
      entitlements.grantComplimentary.mockImplementation((input) =>
        Promise.resolve(grantRow({ sourceId: input.sourceId })),
      );

      await service.grant('admin-1', {
        subjectType: 'user',
        subjectId: 'user-1',
        planKey: 'pro',
        durationDays: 7,
        note: '临时提并发',
      });
      await service.grant('admin-1', {
        subjectType: 'user',
        subjectId: 'user-1',
        planKey: 'pro',
        durationDays: 7,
        note: '临时提并发',
      });

      expect(entitlements.grantComplimentary).toHaveBeenCalledTimes(2);
      const [first, second] = entitlements.grantComplimentary.mock.calls.map(
        (call) => call[0],
      );
      expect(first).toMatchObject({
        subjectType: BillingSubjectType.user,
        subjectId: 'user-1',
        planKey: 'pro',
        durationDays: 7,
        sourceType: 'admin_manual',
        metadata: { note: '临时提并发', grantedBy: 'admin-1' },
      });
      // Re-granting must stack, not hit the per-sourceId idempotency no-op.
      expect(first.sourceId).not.toEqual(second.sourceId);
    });

    it('surfaces the note from grant metadata in the returned view', async () => {
      entitlements.grantComplimentary.mockResolvedValue(grantRow());
      const view = await service.grant('admin-1', {
        subjectType: 'user',
        subjectId: 'user-1',
        planKey: 'pro',
        durationDays: 7,
        note: '临时提并发',
      });
      expect(view.note).toBe('临时提并发');
      expect(view.effectiveStatus).toBe(EntitlementGrantStatus.active);
    });

    it('grants a team plan to an active team workspace', async () => {
      prisma.workspace.findFirst.mockResolvedValue({
        defaultForUserId: null,
        status: WorkspaceStatus.active,
      });
      entitlements.grantComplimentary.mockResolvedValue(
        grantRow({
          subjectType: BillingSubjectType.workspace,
          subjectId: '01900000-0000-7000-8000-000000000010',
          planKey: 'team',
        }),
      );

      await service.grant('admin-1', {
        subjectType: 'workspace',
        subjectId: '01900000-0000-7000-8000-000000000010',
        planKey: 'team',
        durationDays: 30,
        note: '企业客户补发',
      });

      expect(entitlements.grantComplimentary).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectType: BillingSubjectType.workspace,
          subjectId: '01900000-0000-7000-8000-000000000010',
          planKey: 'team',
        }),
        prisma,
      );
    });

    it('rejects a plan target that is suspended', async () => {
      prisma.workspace.findFirst.mockResolvedValue({
        defaultForUserId: 'user-1',
        status: WorkspaceStatus.suspended,
      });

      await expect(
        service.grant('admin-1', {
          subjectType: 'workspace',
          subjectId: '01900000-0000-7000-8000-000000000010',
          planKey: 'team',
          durationDays: 30,
          note: '企业客户补发',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(entitlements.grantComplimentary).not.toHaveBeenCalled();
    });
  });

  describe('listForSubject', () => {
    it('derives operator-facing active, expired, revoked, and pending statuses from time', async () => {
      prisma.entitlementGrant.findMany.mockResolvedValue([
        grantRow(),
        grantRow({
          id: '01900000-0000-7000-8000-000000000002',
          endsAt: new Date(Date.now() - DAY_MS),
        }),
        grantRow({
          id: '01900000-0000-7000-8000-000000000003',
          status: EntitlementGrantStatus.revoked,
          revokedAt: NOW,
        }),
        grantRow({
          id: '01900000-0000-7000-8000-000000000004',
          startsAt: new Date(Date.now() + DAY_MS),
          endsAt: new Date(Date.now() + 8 * DAY_MS),
        }),
      ]);
      const views = await service.listForSubject({
        subjectType: 'user',
        subjectId: 'user-1',
      });
      expect(views.map((v) => v.effectiveStatus)).toEqual([
        EntitlementGrantStatus.active,
        EntitlementGrantStatus.expired,
        EntitlementGrantStatus.revoked,
        EntitlementGrantStatus.pending,
      ]);
      expect(prisma.entitlementGrant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            subjectType: BillingSubjectType.user,
            subjectId: 'user-1',
          },
        }),
      );
    });
  });

  describe('revoke', () => {
    it('revokes an active admin-issued grant', async () => {
      prisma.entitlementGrant.findUnique.mockResolvedValue(grantRow());
      const view = await service.revoke(grantRow().id);
      expect(view.effectiveStatus).toBe(EntitlementGrantStatus.revoked);
      expect(prisma.entitlementGrant.updateMany).toHaveBeenCalledTimes(1);
    });

    it('rejects unknown grants', async () => {
      prisma.entitlementGrant.findUnique.mockResolvedValue(null);
      await expect(service.revoke(grantRow().id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses to revoke a purchased (billing_order) grant', async () => {
      prisma.entitlementGrant.findUnique.mockResolvedValue(
        grantRow({ sourceType: 'billing_order' }),
      );
      await expect(service.revoke(grantRow().id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.entitlementGrant.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to revoke a grant that is not active', async () => {
      prisma.entitlementGrant.findUnique.mockResolvedValue(
        grantRow({ status: EntitlementGrantStatus.revoked }),
      );
      await expect(service.revoke(grantRow().id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows a scheduled admin grant to be cancelled before it starts', async () => {
      prisma.entitlementGrant.findUnique.mockResolvedValue(
        grantRow({
          startsAt: new Date(Date.now() + DAY_MS),
          endsAt: new Date(Date.now() + 8 * DAY_MS),
        }),
      );

      const view = await service.revoke(grantRow().id);

      expect(view.effectiveStatus).toBe(EntitlementGrantStatus.revoked);
      expect(prisma.entitlementGrant.updateMany).toHaveBeenCalledTimes(1);
    });

    it('refuses to revoke a grant whose time window has already ended', async () => {
      prisma.entitlementGrant.findUnique.mockResolvedValue(
        grantRow({ endsAt: new Date(Date.now() - DAY_MS) }),
      );

      await expect(service.revoke(grantRow().id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.entitlementGrant.updateMany).not.toHaveBeenCalled();
    });
  });
});
