import { allocateConfirmedRevenue } from './revenue-allocation';

const input = {
  currency: 'USD' as const,
  amountMinor: '10001',
  participants: [
    { crewMemberId: 'b', shareBps: 5000 },
    { crewMemberId: 'a', shareBps: 5000 },
  ],
};

it('allocates confirmed cash exactly and makes row order irrelevant', () => {
  const result = allocateConfirmedRevenue(input);
  expect(result.participants).toEqual([
    { crewMemberId: 'a', shareBps: 5000, amountMinor: '5001' },
    { crewMemberId: 'b', shareBps: 5000, amountMinor: '5000' },
  ]);
  expect(
    allocateConfirmedRevenue({
      ...input,
      participants: [...input.participants].reverse(),
    }),
  ).toEqual(result);
});

it('awards a remaining cent to the largest fractional entitlement', () => {
  expect(
    allocateConfirmedRevenue({
      ...input,
      amountMinor: '1',
      participants: [
        { crewMemberId: 'a', shareBps: 1000 },
        { crewMemberId: 'b', shareBps: 9000 },
      ],
    }).participants,
  ).toEqual([
    { crewMemberId: 'a', shareBps: 1000, amountMinor: '0' },
    { crewMemberId: 'b', shareBps: 9000, amountMinor: '1' },
  ]);
});

it('preserves every minor unit beyond JavaScript safe integer range', () => {
  for (const amountMinor of [
    '1',
    '999',
    '9007199254740993',
    '9223372036854775807',
  ]) {
    const result = allocateConfirmedRevenue({ ...input, amountMinor });
    expect(
      result.participants.reduce(
        (sum, row) => sum + BigInt(row.amountMinor),
        0n,
      ),
    ).toBe(BigInt(amountMinor));
  }
});

it.each([9999, 10001])(
  'rejects incomplete or excessive total shares: %s',
  (total) => {
    expect(() =>
      allocateConfirmedRevenue({
        ...input,
        participants: [
          { crewMemberId: 'a', shareBps: 5000 },
          { crewMemberId: 'b', shareBps: total - 5000 },
        ],
      }),
    ).toThrow('100%');
  },
);

it('rejects repeated beneficiaries after whitespace normalization', () => {
  expect(() =>
    allocateConfirmedRevenue({
      ...input,
      participants: [
        { crewMemberId: 'a', shareBps: 5000 },
        { crewMemberId: ' a ', shareBps: 5000 },
      ],
    }),
  ).toThrow('only once');
});

it.each(['0', '-1', '1.5', '9223372036854775808'])(
  'rejects invalid cash amount %s',
  (amountMinor) => {
    expect(() => allocateConfirmedRevenue({ ...input, amountMinor })).toThrow();
  },
);

it('rejects point currency, injected paid state and client-calculated allocations', () => {
  for (const extra of [
    { currency: 'community_point' },
    { status: 'paid' },
    { participants: [{ ...input.participants[0], amountMinor: '999999' }] },
  ]) {
    expect(() =>
      allocateConfirmedRevenue({ ...input, ...extra } as typeof input),
    ).toThrow();
  }
});
