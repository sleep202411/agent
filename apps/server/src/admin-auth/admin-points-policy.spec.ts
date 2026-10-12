import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminPermissionGuard } from './admin-permission.guard';
import {
  DIRECT_POINTS_GRANT,
  isPointsOperator,
  POINTS_OPERATORS,
} from './admin-points-policy';
import { LegacyPointsAdminController } from '../legacy-points/legacy-points-admin.controller';
import { BillingAdminController } from '../billing/billing-admin.controller';

describe('Pax direct points policy', () => {
  it.each(['global', 'cn'] as const)(
    'binds active Pax and producer accounts only in %s',
    (region) => {
      const actor = {
        id: POINTS_OPERATORS[region].pax,
        status: 'active',
        siteScope: region,
      };
      expect(isPointsOperator(actor, 'pax', region)).toBe(true);
      expect(
        isPointsOperator({ ...actor, status: 'disabled' }, 'pax', region),
      ).toBe(false);
      expect(
        isPointsOperator(
          { ...actor, siteScope: region === 'cn' ? 'global' : 'cn' },
          'pax',
          region,
        ),
      ).toBe(false);
      expect(
        isPointsOperator(
          { ...actor, id: POINTS_OPERATORS[region].producer },
          'pax',
          region,
        ),
      ).toBe(false);
      expect(
        isPointsOperator(
          { ...actor, id: POINTS_OPERATORS[region].producer },
          'producer',
          region,
        ),
      ).toBe(true);
    },
  );

  it.each([
    [LegacyPointsAdminController, 'grant', 'user.write'],
    [BillingAdminController, 'createWorkspaceWalletCredit', 'billing.write'],
  ] as const)(
    'protects %s.%s even from another super admin',
    (controller, method, permission) => {
      const guard = new AdminPermissionGuard(new Reflector());
      const request = {
        admin: {
          id: 'other',
          status: 'active',
          siteScope: 'all',
          roleKeys: ['super_admin'],
          permissions: [permission, DIRECT_POINTS_GRANT],
        },
      };
      const context = {
        getHandler: () => controller.prototype[method as never],
        getClass: () => controller,
        switchToHttp: () => ({ getRequest: () => request }),
      } as never;
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
      request.admin.id = POINTS_OPERATORS.global.pax;
      expect(guard.canActivate(context)).toBe(true);
      request.admin.roleKeys = [];
      expect(guard.canActivate(context)).toBe(true);
    },
  );

  it('derives grant and producer-review capabilities from identity instead of editable roles', () => {
    const service = Object.create(
      AdminAuthService.prototype,
    ) as AdminAuthService;
    const user = {
      id: 'other',
      status: 'active',
      siteScope: 'all',
      roles: [
        {
          role: {
            key: 'admin',
            permissions: [{ permission: { key: DIRECT_POINTS_GRANT } }],
          },
        },
      ],
    };
    const actor = (id: string) =>
      service.toActor({ ...user, id } as never, 'session');
    expect(actor('other').permissions).not.toContain(DIRECT_POINTS_GRANT);
    expect(actor(POINTS_OPERATORS.global.pax).permissions).toContain(
      DIRECT_POINTS_GRANT,
    );
    expect(actor(POINTS_OPERATORS.global.producer).permissions).toContain(
      'crew.compute.review',
    );
    expect(actor(POINTS_OPERATORS.global.producer).permissions).not.toContain(
      DIRECT_POINTS_GRANT,
    );
  });
});
