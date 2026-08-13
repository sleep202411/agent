import { requiredPlanFromPolicy } from './required-plan';

describe('requiredPlanFromPolicy', () => {
  it.each([
    undefined,
    null,
    {},
    { requiredPlan: null },
    { requiredPlan: 'free' },
  ])('treats public policy %p as no paid-plan requirement', (policy) => {
    expect(requiredPlanFromPolicy(policy)).toBeNull();
  });

  it.each(['basic', 'standard', 'pro', 'team'] as const)(
    'accepts canonical paid plan %s',
    (planKey) => {
      expect(requiredPlanFromPolicy({ requiredPlan: planKey })).toBe(planKey);
    },
  );

  it.each(['vip', 'studio', 'enterprise', 'team_creator', 'none'])(
    'rejects retired or unknown plan key %s instead of unlocking the model',
    (planKey) => {
      expect(() => requiredPlanFromPolicy({ requiredPlan: planKey })).toThrow(
        `Unknown AI model requiredPlan: ${planKey}`,
      );
    },
  );
});
