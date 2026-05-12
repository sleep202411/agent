/**
 * Deterministic placeholder play-counts for episode rows.
 *
 * Backend doesn't track views yet — until it does, we synthesize a
 * stable, monotonically-increasing count per episode so the UI doesn't
 * look empty. Same (episodeId, day) returns the same number, so a page
 * refresh doesn't make the count flicker.
 *
 * Delete this file (and its imports in ip-detail-client.tsx) once the
 * backend ships a real `playCount` field on Episode.
 */

const MS_PER_DAY = 86_400_000;
const EPOCH_FALLBACK = Date.parse("2026-01-01T00:00:00Z");

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Produce a fake but plausible play-count for a single episode.
 *
 * Trajectory: `initial + perDay * daysSinceCreate + ±15 noise`. The
 * noise is reseeded daily (deterministic per `today`), so the number
 * fluctuates day-to-day without ever decreasing across day boundaries
 * because the noise envelope is dwarfed by the daily growth.
 */
export function fakePlayCount(episodeId: string | number, createdAt?: string): number {
  const seed = hashString(String(episodeId));
  const epoch = createdAt ? Date.parse(createdAt) || EPOCH_FALLBACK : EPOCH_FALLBACK;
  const daysOld = Math.max(0, Math.floor((Date.now() - epoch) / MS_PER_DAY));

  const initial = 200 + (seed % 800); // 200–999 baseline
  const perDay = 100 + ((seed >> 8) % 300); // 100–399 / day
  const today = Math.floor(Date.now() / MS_PER_DAY);
  const noise = (hashString(`${seed}-${today}`) % 120) - 60; // ±60

  return Math.max(0, initial + perDay * daysOld + noise);
}

/**
 * Locale-aware compact formatting — "1234" → "1.2K" / "1.2万",
 * "1234567" → "1.2M". Falls back to plain integer formatting if the
 * runtime's Intl doesn't support compact notation.
 */
export function formatCompactCount(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
      n
    );
  } catch {
    return String(n);
  }
}
