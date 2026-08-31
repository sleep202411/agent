/**
 * Fail the rollout, not the reviewer, when a server-only credential is absent.
 *
 * Every variable below is already required at REQUEST time — the consumers
 * listed against them each throw when their value is missing. That is too
 * late to be useful: the chart mounts admin-ui's secret with `optional: true`
 * (deploy/helm/fizzdragon/templates/admin-ui.yaml), so a gap starts a perfectly
 * healthy pod, every page renders, and the failure only surfaces when somebody
 * opens a screen that needs it — as an opaque upstream error.
 *
 * That is exactly how the Java review API ran unauthenticated in
 * production: the pod predated the secret's key rename, `envFrom` does not
 * hot-reload, and nothing noticed until a reviewer opened 文游审核 and got a 502
 * reading "Not logged in!" — a message about Java's session, shown to an admin
 * whose own session was fine.
 *
 * Checking here turns that class of gap into a crash at startup, which the
 * readiness probe and ArgoCD both surface immediately and unmistakably.
 *
 * Production only. Local dev keeps working without a real secret because each
 * consumer above already falls back to a dev default (or, for the token, is
 * simply not exercised until you hit a Java-backed screen).
 */

/** name → where it is consumed, so a failure names its own fix. */
const REQUIRED_IN_PRODUCTION: ReadonlyArray<readonly [string, string]> = [
  ["JAVA_ADMIN_API_TOKEN", "lib/java-admin-auth.ts — X-Admin-Api-Token for every Java admin call"],
  ["NEWS_API_BASE_URL", "lib/admin-news.ts — Java 资讯 backend origin (must include /content)"],
  [
    "TEXT_GAME_API_BASE_URL",
    "lib/java-studio-admin.ts — Java 文游/影游审核 origin (must include /studio)",
  ],
];

/** Satisfied by either name; admin-api.ts reads them in this order. */
const REQUIRED_EITHER: ReadonlyArray<readonly [string, string, string]> = [
  [
    "ADMIN_API_BASE_URL",
    "ADMIN_GLOBAL_API_BASE_URL",
    "lib/admin-api.ts — the Nest admin API origin",
  ],
];

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function register(): void {
  // The edge runtime gets its own `register()` call and none of these are read
  // there; only the Node.js server talks to Java.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;

  const missing: string[] = [];
  for (const [name, usedBy] of REQUIRED_IN_PRODUCTION) {
    if (!present(name)) missing.push(`${name} — ${usedBy}`);
  }
  for (const [primary, fallback, usedBy] of REQUIRED_EITHER) {
    if (!present(primary) && !present(fallback)) {
      missing.push(`${primary} (or ${fallback}) — ${usedBy}`);
    }
  }
  if (missing.length === 0) return;

  throw new Error(
    `admin-ui is missing ${missing.length} required environment variable(s):\n` +
      missing.map((line) => `  - ${line}`).join("\n") +
      `\n\nThey are projected from Azure Key Vault by the secrets-store CSI driver ` +
      `into the Secret named by \`adminUiSecrets.projectedName\`. A pod that started ` +
      `BEFORE a key was added or renamed keeps its old environment — \`envFrom\` does ` +
      `not hot-reload — so recreating the pod is the usual fix.`
  );
}
