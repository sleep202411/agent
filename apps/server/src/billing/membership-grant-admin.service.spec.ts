import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BillingSubjectType,
  EntitlementGrantStatus,
  type EntitlementGrant,
} from '@prisma/client';
import { MembershipGrantAdminService } from './membership-grant-admin.service';
import type { PrismaService } from '../infra/db/db.module';
import type { EntitlementService } from '../entitlements';

const NOW = new Date('2026-07-17T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function grantRow(overrides: Partial<EntitlementGrant> = {}): EntitlementGrant {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    subjectType: BillingSubjectType.user,
    subjectId: 'user-1',
    planKey: 'studio',
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
    entitlementGrant: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let entitlements: { grantComplimentary: jest.Mock };
  let service: MembershipGrantAdminService;

  beforeEach(() => {
    prisma = {
      entitlementGrant: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    entitlements = { grantComplimentary: jest.fn() };
    service = new MembershipGrantAdminService(
      prisma as unknown as PrismaService,
      entitlements as unknown as EntitlementService,
    );
  });

  describe('grant', () => {
    it('delegates to grantComplimentary with admin_manual source and a fresh sourceId per call', async () => {
      entitlements.grantComplimentary.mockImplementation(async (input) =>
        grantRow({ sourceId: input.sourceId }),
      );

      await service.grant('admin-1', {
        userId: 'user-1',
        planKey: 'studio',
        durationDays: 7,
        note: '临时提并发',
      });
      await service.grant('admin-1', {
        userId: 'user-1',
        planKey: 'studio',
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
        planKey: 'studio',
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
        userId: 'user-1',
        planKey: 'studio',
        durationDays: 7,
        note: '临时提并发',
      });
      expect(view.note).toBe('临时提并发');
      expect(view.activeNow).toBe(true);
    });
  });

  describe('listForUser', () => {
    it('marks expired and revoked grants as not active now', async () => {
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
      ]);
      const views = await service.listForUser('user-1');
      expect(views.map((v) => v.activeNow)).toEqual([true, false, false]);
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
      prisma.entitlementGrant.update.mockResolvedValue(
        grantRow({
          status: EntitlementGrantStatus.revoked,
          revokedAt: NOW,
        }),
      );
      const view = await service.revoke(grantRow().id);
      expect(view.status).toBe(EntitlementGrantStatus.revoked);
      expect(view.activeNow).toBe(false);
      expect(prisma.entitlementGrant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: EntitlementGrantStatus.revoked,
          }),
        }),
      );
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
      expect(prisma.entitlementGrant.update).not.toHaveBeenCalled();
    });

    it('refuses to revoke a grant that is not active', async () => {
      prisma.entitlementGrant.findUnique.mockResolvedValue(
        grantRow({ status: EntitlementGrantStatus.revoked }),
      );
      await expect(service.revoke(grantRow().id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
