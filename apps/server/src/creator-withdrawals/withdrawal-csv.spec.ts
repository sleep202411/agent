import {
  WithdrawalAdminService,
  WITHDRAWAL_MANAGE_PERMISSION,
  withdrawalCsvCell,
} from './withdrawal-admin.service';
import type { AdminActor } from '../admin-auth';
const admin = {
  id: 'finance',
  status: 'active',
  siteScope: 'all',
  permissions: [WITHDRAWAL_MANAGE_PERMISSION],
} as AdminActor;
describe('withdrawal CSV', () => {
  it.each(['=HYPERLINK("bad")', '+1', '-1', '@SUM(A1)', ' \t=1'])(
    'neutralizes spreadsheet formula %s',
    (value) => {
      expect(withdrawalCsvCell(value)).toBe(
        `"'${value.replaceAll('"', '""')}"`,
      );
    },
  );
  it('quotes commas, quotes and line breaks without changing data', () => {
    expect(withdrawalCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it('exports exact large amounts and only selected metadata', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'request',
        userId: 'creator',
        recipientLabel: 'Creator ••••1234',
        currency: 'USD',
        amountMinor: 9007199254740993n,
        status: 'paid',
        paymentReference: '=danger',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        paidAt: null,
      },
    ]);
    const service = new WithdrawalAdminService(
      { creatorWithdrawal: { findMany } } as never,
      {} as never,
    );
    const result = await service.exportCsv(admin, {
      currency: 'USD',
      q: 'creator',
    });
    expect(result.count).toBe(1);
    expect(result.csv).toContain('"90071992547409.93"');
    expect(result.csv).toContain('"\'=danger"');
    const [args] = findMany.mock.calls[0] as [
      {
        take: number;
        where: { currency: string };
        select: Record<string, boolean>;
      },
    ];
    expect(args.take).toBe(10001);
    expect(args.where.currency).toBe('USD');
    expect(args.select).not.toHaveProperty('recipientEncrypted');
    expect(args.select).not.toHaveProperty('accountNumber');
  });
  it('refuses oversized exports and unauthorized operators', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue(Array.from({ length: 10001 }, () => ({})));
    const service = new WithdrawalAdminService(
      { creatorWithdrawal: { findMany } } as never,
      {} as never,
    );
    await expect(
      service.exportCsv({ ...admin, permissions: [] }, {}),
    ).rejects.toThrow('permission');
    expect(findMany).not.toHaveBeenCalled();
    await expect(service.exportCsv(admin, {})).rejects.toThrow('10,000');
  });
});
