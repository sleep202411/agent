import {
  DEFAULT_FREE_BENEFITS,
  MembershipBenefitsSchema,
  benefitsToQuotaLimits,
  benefitsToSnapshotLimits,
  parseMembershipBenefits,
} from './membership-benefits';

describe('MembershipBenefitsSchema', () => {
  it('accepts the code-defined free baseline (the only non-row benefits)', () => {
    expect(
      MembershipBenefitsSchema.safeParse(DEFAULT_FREE_BENEFITS).success,
    ).toBe(true);
  });

  it('accepts "Infinity" markers and nullable job limits', () => {
    const parsed = MembershipBenefitsSchema.safeParse({
      ...DEFAULT_FREE_BENEFITS,
      imageDaily: 'Infinity',
      chatDaily: 'Infinity',
      concurrentJobs: null,
      queuedJobs: null,
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['unknown top-level key', { ...DEFAULT_FREE_BENEFITS, bonus: 1 }],
    [
      'missing field',
      (() => {
        const clone: Record<string, unknown> = { ...DEFAULT_FREE_BENEFITS };
        delete clone.chatDaily;
        return clone;
      })(),
    ],
    ['non-integer daily cap', { ...DEFAULT_FREE_BENEFITS, chatDaily: 1.5 }],
    ['negative cap', { ...DEFAULT_FREE_BENEFITS, uploadMB: -1 }],
    ['removed policy field', { ...DEFAULT_FREE_BENEFITS, quotaTier: 'old' }],
    [
      'bare Infinity number is not JSON-safe',
      {
        ...DEFAULT_FREE_BENEFITS,
        chatDaily: Number.POSITIVE_INFINITY,
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(MembershipBenefitsSchema.safeParse(value).success).toBe(false);
  });

  it('parseMembershipBenefits throws with the plan key in the message', () => {
    expect(() => parseMembershipBenefits('basic', { nope: true })).toThrow(
      /Membership plan "basic" has invalid benefits/,
    );
  });

  it('converts "Infinity" markers into runtime Infinity limits', () => {
    const benefits = MembershipBenefitsSchema.parse({
      ...DEFAULT_FREE_BENEFITS,
      imageDaily: 'Infinity',
      chatDaily: 'Infinity',
    });
    const snapshotLimits = benefitsToSnapshotLimits(benefits);
    expect(snapshotLimits.imageDaily).toBe(Number.POSITIVE_INFINITY);
    expect(snapshotLimits.chatDaily).toBe(Number.POSITIVE_INFINITY);
    expect(snapshotLimits.workflowDaily).toBe(3);

    const quotaLimits = benefitsToQuotaLimits(benefits);
    expect(quotaLimits.imageDaily).toBe(Number.POSITIVE_INFINITY);
    expect(quotaLimits.uploadMB).toBe(100);
    expect(quotaLimits.chatPerMinute).toBe(20);
  });
});
