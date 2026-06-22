import { settleMigratedDebt } from './wallet-debt';

describe('settleMigratedDebt', () => {
  it('no debt (balance ≥ 0): nothing settled, full amount spendable', () => {
    expect(settleMigratedDebt(0n, 500n)).toEqual({
      debtSettled: 0n,
      availableAmount: 500n,
    });
    expect(settleMigratedDebt(100n, 500n)).toEqual({
      debtSettled: 0n,
      availableAmount: 500n,
    });
  });

  it('partial debt: settles the debt, remainder spendable', () => {
    expect(settleMigratedDebt(-50n, 500n)).toEqual({
      debtSettled: 50n,
      availableAmount: 450n,
    });
  });

  it('debt ≥ credit: whole credit settles debt, nothing spendable', () => {
    expect(settleMigratedDebt(-600n, 500n)).toEqual({
      debtSettled: 500n,
      availableAmount: 0n,
    });
    expect(settleMigratedDebt(-500n, 500n)).toEqual({
      debtSettled: 500n,
      availableAmount: 0n,
    });
  });

  it('invariant: debtSettled + availableAmount === creditAmount; both ≥ 0', () => {
    for (const pre of [-1000n, -1n, 0n, 50n, 1000n]) {
      for (const amt of [1n, 50n, 500n, 1000n]) {
        const r = settleMigratedDebt(pre, amt);
        expect(r.debtSettled + r.availableAmount).toBe(amt);
        expect(r.debtSettled >= 0n && r.availableAmount >= 0n).toBe(true);
      }
    }
  });
});
