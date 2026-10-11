// Keep provider timestamp semantics aligned with Studio content-review-findings.ts.
const MAX_REVIEW_SECONDS = 3 * 60 * 60;

export function parseReviewTimeOffset(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return normalizeUnitlessOffset(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const msSuffix = /^(-?\d+(?:\.\d+)?)\s*ms$/i.exec(trimmed);
  if (msSuffix) return normalizeSeconds(Number(msSuffix[1]) / 1000);

  const secSuffix = /^(-?\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/i.exec(trimmed);
  if (secSuffix) return normalizeSeconds(Number(secSuffix[1]));

  if (/^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(trimmed)) {
    const parts = trimmed.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.at(-1)! >= 60 || (parts.length === 3 && parts[1] >= 60)) return null;
    if (parts.length === 3) {
      return normalizeSeconds(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
    return normalizeSeconds(parts[0] * 60 + parts[1]);
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? normalizeUnitlessOffset(numeric) : null;
}

export function formatReviewTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${clock}` : clock;
}

// Only unitless provider values need the legacy seconds/milliseconds heuristic.
function normalizeUnitlessOffset(value: number): number | null {
  return normalizeSeconds(value > MAX_REVIEW_SECONDS ? value / 1000 : value);
}

function normalizeSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > MAX_REVIEW_SECONDS) return null;
  return value;
}
