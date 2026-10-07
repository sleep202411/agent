import { WithdrawalDecision } from './withdrawal-admin.service';
it('requires proof before recording a completed payment', () => {
  const payment = {
    action: 'pay',
    expectedVersion: 2,
    paymentReference: 'BANK-123',
  };
  expect(WithdrawalDecision.safeParse(payment).success).toBe(false);
  expect(
    WithdrawalDecision.safeParse({
      ...payment,
      paymentProofId: '11111111-1111-4111-8111-111111111111',
    }).success,
  ).toBe(true);
});
it('does not require payment proof to process or reject a request', () => {
  expect(
    WithdrawalDecision.safeParse({ action: 'process', expectedVersion: 1 })
      .success,
  ).toBe(true);
  expect(
    WithdrawalDecision.safeParse({
      action: 'reject',
      expectedVersion: 1,
      reason: 'Incorrect account',
    }).success,
  ).toBe(true);
});
