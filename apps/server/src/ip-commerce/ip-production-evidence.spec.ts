import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminAuthGuard, AdminPermissionGuard } from '../admin-auth';
import { IpProductionEvidenceController } from './ip-production-evidence';

describe('production evidence administrator boundary', () => {
  it('requires administrator authentication and IP read permission', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, IpProductionEvidenceController),
    ).toEqual([AdminAuthGuard, AdminPermissionGuard]);
    const guard = new AdminPermissionGuard(new Reflector());
    // Use the original decorated function as metadata, without invoking or rebinding it.
    const handler = Object.getOwnPropertyDescriptor(
      IpProductionEvidenceController.prototype,
      'read',
    )!.value as IpProductionEvidenceController['read'];
    const context = (permissions: string[]) =>
      ({
        getHandler: () => handler,
        getClass: () => IpProductionEvidenceController,
        switchToHttp: () => ({
          getRequest: () => ({ admin: { permissions } }),
        }),
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context([]))).toThrow();
    expect(() => guard.canActivate(context(['ip.publish']))).toThrow();
    expect(guard.canActivate(context(['ip.read']))).toBe(true);
  });
});
