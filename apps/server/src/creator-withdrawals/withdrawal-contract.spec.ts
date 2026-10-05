import {
  calculateWithdrawalAmount,
  RequestWithdrawal,
  WithdrawalRecipient,
} from './withdrawal-contract';
const recipient = {
  fullName: 'Creator',
  accountNumber: '123456789',
  address: 'Singapore',
  swift: 'DBSSSGSG',
  branchAddress: 'Branch, Singapore',
};
it('calculates a percentage of confirmed task cash earnings without FX or point conversion', () => {
  expect(calculateWithdrawalAmount(3000n, 5000)).toBe(1500n);
  expect(calculateWithdrawalAmount(3000n, 10000)).toBe(3000n);
});
it('rounds down to the minor unit without over-reserving', () => {
  expect(calculateWithdrawalAmount(1001n, 3333)).toBe(333n);
  expect(calculateWithdrawalAmount(9_223_372_036_854_775_807n, 10000)).toBe(
    9_223_372_036_854_775_807n,
  );
});
it.each([0, 10001, NaN, 1.5])('rejects invalid percentage %s', (p) =>
  expect(() => calculateWithdrawalAmount(3000n, p)).toThrow(),
);
it('rejects zero/sub-cent and unsupported balances', () => {
  expect(() => calculateWithdrawalAmount(1n, 1)).toThrow();
  expect(() => calculateWithdrawalAmount(0n, 10000)).toThrow();
  expect(() =>
    calculateWithdrawalAmount(9_223_372_036_854_775_808n, 10000),
  ).toThrow();
});
it('accepts the requested bank fields and normalizes SWIFT', () =>
  expect(
    WithdrawalRecipient.parse({ ...recipient, swift: ' dbsssgsg ' }),
  ).toEqual(recipient));
it('rejects client-supplied beneficiary IDs, payout amounts and status', () => {
  const request = {
    requestId: '11111111-1111-4111-8111-111111111111',
    currency: 'USD',
    percentageBps: 5000,
    expectedAvailableAmountMinor: '3000',
    recipient,
  };
  expect(RequestWithdrawal.safeParse(request).success).toBe(true);
  for (const extra of [
    { userId: 'someone-else' },
    { amountMinor: '999999' },
    { status: 'paid' },
  ])
    expect(RequestWithdrawal.safeParse({ ...request, ...extra }).success).toBe(
      false,
    );
  expect(
    RequestWithdrawal.safeParse({ ...request, currency: 'community_point' })
      .success,
  ).toBe(false);
});
