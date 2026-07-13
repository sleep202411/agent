import {
  HU_BAO_REFERENCE_SLOTS,
  HU_BAO_VILLA_DRAFT_CONTENT,
} from './hu-bao-villa.fixture';

type RuntimeState = {
  variables: Record<string, number>;
  flags: Record<string, string>;
};

describe('Haw Par Villa locked story fixture', () => {
  it('keeps the product contract explicit', () => {
    expect(HU_BAO_VILLA_DRAFT_CONTENT.experience).toMatchObject({
      targetRuntimeMs: 120_000,
      maxContinuousMs: 15_000,
      choiceCount: 6,
      endingCount: 4,
      clipCount: 21,
      fullPathCount: 64,
    });
    expect(HU_BAO_REFERENCE_SLOTS).toHaveLength(16);
    expect(
      HU_BAO_REFERENCE_SLOTS.filter(([key]) => key.startsWith('JF-')),
    ).toHaveLength(5);
    expect(
      HU_BAO_REFERENCE_SLOTS.filter(([, kind]) =>
        ['first_frame', 'last_frame'].includes(kind),
      ),
    ).toHaveLength(3);
  });

  it('resolves all 64 binary paths to exactly one of four endings', () => {
    const endingCounts = new Map<string, number>();

    for (let mask = 0; mask < 64; mask += 1) {
      const state: RuntimeState = {
        variables: { truth: 0, bond: 0, echo: 0 },
        flags: {},
      };

      HU_BAO_VILLA_DRAFT_CONTENT.choices.forEach((choice, index) => {
        const optionIndex = (mask >> index) & 1;
        for (const effect of choice.options[optionIndex].effects) {
          if ('variable' in effect) {
            state.variables[effect.variable] += effect.add;
          } else {
            state.flags[effect.flag] = effect.set;
          }
        }
      });

      const matches = HU_BAO_VILLA_DRAFT_CONTENT.endings.filter((ending) =>
        evaluateCondition(ending.condition, state),
      );
      if (matches.length !== 1) {
        throw new Error(
          `Path mask ${mask} resolved to ${matches.length} endings.`,
        );
      }
      const endingKey = matches[0].key;
      endingCounts.set(endingKey, (endingCounts.get(endingKey) ?? 0) + 1);
    }

    expect([...endingCounts.keys()].sort()).toEqual([
      'E01',
      'E02',
      'E03',
      'E04',
    ]);
    expect(
      [...endingCounts.values()].reduce((sum, count) => sum + count, 0),
    ).toBe(64);
  });

  it('defines a unique stable key for every reference and graph target', () => {
    expect(new Set(HU_BAO_REFERENCE_SLOTS.map(([key]) => key)).size).toBe(16);
    expect(
      new Set(HU_BAO_VILLA_DRAFT_CONTENT.choices.map((choice) => choice.key))
        .size,
    ).toBe(6);
    expect(
      new Set(HU_BAO_VILLA_DRAFT_CONTENT.endings.map((ending) => ending.key))
        .size,
    ).toBe(4);
  });
});

function evaluateCondition(condition: unknown, state: RuntimeState): boolean {
  if (!condition || typeof condition !== 'object') return false;
  const value = condition as Record<string, unknown>;
  if (Array.isArray(value.all)) {
    return value.all.every((item) => evaluateCondition(item, state));
  }
  if (typeof value.variable === 'string') {
    const current = state.variables[value.variable] ?? 0;
    if (typeof value.gte === 'number') return current >= value.gte;
    if (typeof value.lt === 'number') return current < value.lt;
  }
  if (typeof value.flag === 'string' && typeof value.eq === 'string') {
    return state.flags[value.flag] === value.eq;
  }
  return false;
}
