import {
  planAutosaveRetention,
  type AutosaveRetentionConfig,
  type RetainableVersion,
} from './document-autosave';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = 1_000 * DAY; // a fixed "now" well above any age

const CONFIG: AutosaveRetentionConfig = {
  denseWindowMs: HOUR, // keep all < 1h
  hourlyWindowMs: DAY, // 1h..24h -> one per hour
  maxKeep: 200,
};

function v(id: string, ageMs: number): RetainableVersion {
  return { id, createdAtMs: NOW - ageMs };
}

function keptIds(autosaves: RetainableVersion[], config = CONFIG): Set<string> {
  const deleted = new Set(planAutosaveRetention(autosaves, NOW, config));
  return new Set(autosaves.map((a) => a.id).filter((id) => !deleted.has(id)));
}

describe('planAutosaveRetention', () => {
  it('keeps everything inside the dense window', () => {
    const list = [v('a', 1_000), v('b', 10 * 60_000), v('c', 59 * 60_000)];
    expect(planAutosaveRetention(list, NOW, CONFIG)).toEqual([]);
  });

  it('thins the hourly tier to one (newest) per hour bucket', () => {
    // Three autosaves inside the same wall-clock hour, all aged 1h..24h.
    const base = NOW - 5 * HOUR; // 5h ago, comfortably in the hourly tier
    const list: RetainableVersion[] = [
      { id: 'old', createdAtMs: base },
      { id: 'mid', createdAtMs: base + 10 * 60_000 },
      { id: 'new', createdAtMs: base + 20 * 60_000 },
    ];
    const kept = keptIds(list);
    // Same hour bucket -> only the newest of the three survives.
    expect(kept.has('new')).toBe(true);
    expect(kept.has('mid')).toBe(false);
    expect(kept.has('old')).toBe(false);
  });

  it('keeps one per distinct hour bucket in the hourly tier', () => {
    const list = [v('h2', 2 * HOUR), v('h3', 3 * HOUR), v('h4', 4 * HOUR)];
    expect(keptIds(list)).toEqual(new Set(['h2', 'h3', 'h4']));
  });

  it('thins the daily tier to one per day, dropping intra-day extras', () => {
    // All > 24h old (daily tier). d2a/d2b land in the same day bucket.
    const dayAnchor = Math.floor((NOW - 2 * DAY) / DAY) * DAY;
    const list: RetainableVersion[] = [
      { id: 'd2a', createdAtMs: dayAnchor + 2 * HOUR },
      { id: 'd2b', createdAtMs: dayAnchor + 5 * HOUR },
      { id: 'd3', createdAtMs: dayAnchor - 20 * HOUR },
    ];
    const kept = keptIds(list);
    expect(kept.has('d2b')).toBe(true); // newest in its day
    expect(kept.has('d2a')).toBe(false);
    expect(kept.has('d3')).toBe(true); // different day
  });

  it('never deletes a brand-new autosave (the one just stamped)', () => {
    const list = [v('just-now', 0), v('old', 30 * DAY)];
    expect(planAutosaveRetention(list, NOW, CONFIG)).not.toContain('just-now');
  });

  it('enforces the hard cap, dropping the oldest survivors', () => {
    // 5 distinct-hour survivors, cap at 3 -> drop the 2 oldest.
    const list = [
      v('h2', 2 * HOUR),
      v('h3', 3 * HOUR),
      v('h4', 4 * HOUR),
      v('h5', 5 * HOUR),
      v('h6', 6 * HOUR),
    ];
    const kept = keptIds(list, { ...CONFIG, maxKeep: 3 });
    expect(kept).toEqual(new Set(['h2', 'h3', 'h4']));
  });

  it('returns nothing to delete for an empty input', () => {
    expect(planAutosaveRetention([], NOW, CONFIG)).toEqual([]);
  });
});
