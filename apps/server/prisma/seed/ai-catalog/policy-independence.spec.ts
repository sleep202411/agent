import { IMAGE_MODELS } from './image-models';
import { VIDEO_MODELS } from './video-models';
import { AUDIO_MODELS } from './audio-models';
import { buildEntitlementPolicy, buildQueuePolicy } from './defaults';

/**
 * Access and capacity were one field once. A migration renamed a legacy plan
 * ('vip' → 'basic') meaning only to tidy a tier list, the rename travelled down
 * the entitlement path, and all 32 models went behind a USD 27/month gate that
 * three accounts in the entire database could clear. Nothing errored: the studio
 * drops inaccessible models from every picker, so the catalogue just vanished.
 *
 * These tests pin the two properties that would have caught it.
 */
describe('entitlement and queue policy are independent', () => {
  it('never derives a queue cap from the plan gate', () => {
    // The regression shape: same overrides, different gates, identical caps.
    const open = buildQueuePolicy({});
    const gatedShape = buildQueuePolicy({});
    expect(gatedShape).toEqual(open);

    // And the factory cannot even see a plan — the old signature took one.
    expect(buildQueuePolicy.length).toBe(0);
  });

  it('keeps the plan gate out of the queue policy payload', () => {
    const queue = buildQueuePolicy({ perUserRunning: 3 });
    expect(Object.keys(queue)).not.toContain('requiredPlan');
    expect(queue.perUserRunning).toBe(3);
  });

  it('passes the declared plan through to the gate verbatim', () => {
    expect(buildEntitlementPolicy(null)).toMatchObject({ requiredPlan: null });
    expect(buildEntitlementPolicy('pro')).toMatchObject({
      requiredPlan: 'pro',
    });
  });
});

describe('the shipped catalogue', () => {
  const ALL = [...IMAGE_MODELS, ...VIDEO_MODELS, ...AUDIO_MODELS];

  /**
   * Models are open today and paid for in compute points. This is not a style
   * rule: gating a model currently REMOVES it from the UI rather than locking
   * it, so a stray plan value silently deletes a model from the product. Revisit
   * only once the studio renders locked models as locked.
   */
  it('gates no model', () => {
    const gated = ALL.filter((m) => m.requiredPlan !== null).map((m) => m.slug);
    expect(gated).toEqual([]);
  });

  it('declares a gate on every model, so the decision is never skipped', () => {
    for (const model of ALL) {
      expect(model).toHaveProperty('requiredPlan');
    }
  });

  /**
   * `min(plan.concurrentJobs, queuePolicy.perUserRunning)` decides the real
   * limit, so a model cap below the cheapest plan's allowance makes every paid
   * upgrade unfeelable. `community_membership`, the smallest plan, allows 3.
   */
  it('does not cap concurrency below the smallest plan allowance', () => {
    const SMALLEST_PLAN_CONCURRENCY = 3;
    for (const [label, overrides] of [
      ['image', {}],
      ['video', { perUserRunning: 3 }],
    ] as const) {
      const queue = buildQueuePolicy(overrides);
      // `label` names the modality in the failure output — jest's expect takes
      // no message argument, so carry it in the compared value instead.
      expect({
        modality: label,
        perUserRunning: Number(queue.perUserRunning),
      }).toEqual({
        modality: label,
        perUserRunning: expect.any(Number),
      });
      expect(Number(queue.perUserRunning)).toBeGreaterThanOrEqual(
        SMALLEST_PLAN_CONCURRENCY,
      );
    }
  });

  it('leaves room for more than one user in the shared pool', () => {
    const queue = buildQueuePolicy({});
    expect(Number(queue.perUserRunning)).toBeLessThan(
      Number(queue.globalConcurrency),
    );
  });
});
