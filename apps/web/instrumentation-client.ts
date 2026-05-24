/**
 * PostHog client-side init. Loaded by Next.js automatically via the
 * `instrumentation-client.ts` convention (15.3+). All event capture
 * across the app uses the `posthog-js` default export below — no
 * Provider needed because the singleton lives on `window` after init.
 *
 * Reverse-proxy: `api_host: "/ingest"` routes through nginx (see the
 * three `/ingest/*` rewrites in `next.config.ts`) so the browser
 * never opens a direct connection to `*.posthog.com`. Sidesteps both
 * adblockers and CN-region connectivity. `ui_host` stays at the real
 * domain so the Toolbar overlay (loaded by the official extension /
 * the PostHog admin UI) still resolves correctly.
 *
 * `person_profiles: "identified_only"` is the cost-control knob —
 * without it PostHog creates a Person row for every anonymous tab
 * that ever loads the site, blowing through the free 1M MAU quickly.
 * With it, anonymous events still record but get aggregated; only
 * `posthog.identify()` calls (login / register) materialise a Person.
 */
import posthog from "posthog-js";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: "/ingest",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  person_profiles: "identified_only",
  capture_exceptions: true,
  // PostHog `debug: true` floods the dev console (every $autocapture /
  // $snapshot / $heatmap / $web_vitals printed in real time). Off by
  // default; flip with `?ph_debug=1` URL or `localStorage.debug=true`
  // when you genuinely need to inspect a PostHog event.
  debug: false,
  session_recording: {
    // recordBody intentionally left at default (false) — turning it on
    // produced 100KB+ per-snapshot uploads that overwhelmed the CN
    // Alibaba ECS reverse proxy in front of AKS (2026-05-24). Re-enable
    // only once the ECS bottleneck is gone or POST traffic is sized.
    maskAllInputs: true,
    recordCrossOriginIframes: false,
  },
  disable_session_recording: false, // default false; set to true to disable session recording entirely, including snapshots, console logs, and network requests. This is a more extreme measure than just setting recordBody to false, as it turns off all recording features.
});
