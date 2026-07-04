import { WalletBalanceKind, WalletCurrencyType } from '@prisma/client';
import { isGrantBackedCurrencyKind } from './wallet-ledger.service';

// The single source of truth for "which wallet accounts expire credits". A
// regression here silently breaks the balance==sum(grants) invariant (drift)
// or lets earned cash expire — both are money bugs.
describe('isGrantBackedCurrencyKind', () => {
  it('both consumable currencies are grant-backed (credits can expire)', () => {
    expect(
      isGrantBackedCurrencyKind(
        WalletCurrencyType.compute_point,
        WalletBalanceKind.consumable,
      ),
    ).toBe(true);
    expect(
      isGrantBackedCurrencyKind(
        WalletCurrencyType.community_point,
        WalletBalanceKind.consumable,
      ),
    ).toBe(true);
  });

  it('WITHDRAWABLE community_point (cash-out pool) is NOT grant-backed — earned money never expires', () => {
    expect(
      isGrantBackedCurrencyKind(
        WalletCurrencyType.community_point,
        WalletBalanceKind.withdrawable,
      ),
    ).toBe(false);
  });

  it('withdrawable compute is not grant-backed either', () => {
    expect(
      isGrantBackedCurrencyKind(
        WalletCurrencyType.compute_point,
        WalletBalanceKind.withdrawable,
      ),
    ).toBe(false);
  });
});
