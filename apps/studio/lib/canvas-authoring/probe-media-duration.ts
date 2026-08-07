/**
 * Client-side media duration probe for generation preflight.
 *
 * Prefer server MediaAsset.durationSeconds when available. This probe fills
 * the gap for local Files / blob URLs before confirm. On timeout or error
 * returns null so the shared validation kernel hard-fails with
 * MEDIA_DURATION_UNKNOWN (never hangs submit forever).
 */

const PROBE_TIMEOUT_MS = 12_000;

export function probeMediaDurationSeconds(
  source: File | string,
  kind: "video" | "audio"
): Promise<number | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.muted = true;
    (el as HTMLMediaElement & { playsInline?: boolean }).playsInline = true;

    let objectUrl: string | null = null;
    let settled = false;

    const finish = (seconds: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      el.onloadedmetadata = null;
      el.onerror = null;
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        // ignore
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      resolve(seconds);
    };

    const timeoutId = window.setTimeout(() => finish(null), PROBE_TIMEOUT_MS);

    el.onloadedmetadata = () => {
      const raw = el.duration;
      if (!Number.isFinite(raw) || raw <= 0) {
        finish(null);
        return;
      }
      finish(raw);
    };
    el.onerror = () => finish(null);

    try {
      if (typeof source === "string") {
        el.src = source;
      } else {
        objectUrl = URL.createObjectURL(source);
        el.src = objectUrl;
      }
    } catch {
      finish(null);
    }
  });
}
