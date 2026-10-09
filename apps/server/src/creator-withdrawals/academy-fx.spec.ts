jest.mock('../common/region/current-cell', () => ({ CURRENT_CELL: 'cn' }));
import { academyQuote, AcademyFxInput, rateUnits } from './academy-fx';
import {
  WithdrawalAdminService,
  WITHDRAWAL_MANAGE_PERMISSION,
} from './withdrawal-admin.service';
import type { PrismaService } from '../infra/db/db.module';
import type { NotificationService } from '../notification/notification.service';
import type { AdminActor } from '../admin-auth';

const admin = {
  id: 'admin',
  status: 'active',
  permissions: [WITHDRAWAL_MANAGE_PERMISSION],
  siteScope: 'cn',
  sessionId: 'session',
} as AdminActor;
const input = () => ({
  rate: '7.123456',
  source: 'Provider quote 123',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  expectedVersion: 0,
});
function fixture() {
  const row = {
    pair: 'USD/CNY',
    ...input(),
    expiresAt: new Date(Date.now() + 3600000),
    updatedAt: new Date(),
    version: 1,
  };
  const tx = {
    $executeRaw: jest.fn(),
    academyExchangeRate: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(row),
    },
    adminAuditLog: { create: jest.fn() },
  };
  const db = {
    ...tx,
    $transaction: jest.fn((fn: (value: typeof tx) => unknown) =>
      Promise.resolve(fn(tx)),
    ),
  };
  return {
    tx,
    row,
    service: new WithdrawalAdminService(
      db as unknown as PrismaService,
      {} as NotificationService,
    ),
  };
}
it('requires a valid source and decimal rate without inventing a conversion', () => {
  expect(AcademyFxInput.safeParse({ ...input(), rate: '0.0' }).success).toBe(
    false,
  );
  expect(AcademyFxInput.safeParse({ ...input(), source: '' }).success).toBe(
    false,
  );
  expect(() => rateUnits('1e2')).toThrow();
  expect(rateUnits('7.123456')).toBe(7123456n);
});
it('retains points when CN has no current quote', async () => {
  const f = fixture();
  expect(
    await academyQuote(f.tx as unknown as Parameters<typeof academyQuote>[0]),
  ).toBeNull();
  f.tx.academyExchangeRate.findUnique.mockResolvedValue({
    ...f.row,
    expiresAt: new Date(0),
  });
  expect(
    await academyQuote(f.tx as unknown as Parameters<typeof academyQuote>[0]),
  ).toBeNull();
});
it('records authorized rate updates and their quote reference atomically', async () => {
  const f = fixture();
  await f.service.setAcademyFx(admin, input());
  expect(f.tx.$executeRaw).toHaveBeenCalled();
  expect(f.tx.adminAuditLog.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      actorUserId: 'admin',
      action: 'academy.exchange_rate.updated',
      reason: 'Provider quote 123',
      after: expect.objectContaining({ rate: '7.123456' }) as unknown,
    }) as unknown,
  });
});
it('rejects unauthorized, stale or expired updates before changing the rate', async () => {
  const f = fixture();
  await expect(
    f.service.setAcademyFx({ ...admin, permissions: [] }, input()),
  ).rejects.toThrow('permission');
  await expect(
    f.service.setAcademyFx(admin, {
      ...input(),
      expiresAt: new Date(0).toISOString(),
    }),
  ).rejects.toThrow('validity');
  f.tx.academyExchangeRate.findUnique.mockResolvedValue(f.row);
  await expect(f.service.setAcademyFx(admin, input())).rejects.toThrow(
    'changed',
  );
  expect(f.tx.academyExchangeRate.upsert).not.toHaveBeenCalled();
});
