/**
 * Startup self-check — prints a resolved-configuration banner at boot so
 * misconfig surfaces in the startup logs instead of during the first user
 * request. Invoked once from apps/agent/src/mastra/index.ts.
 *
 * Intentionally **read-only**: this file only inspects env + constants
 * and logs. Throwing here would crash the server; for hard-fail conditions
 * the relevant create*Model factory already throws with a clear message.
 *
 * Dev mode (tsx watch) re-runs this on every reload — that's fine, the
 * block is short and serves as a visual confirmation of what the last
 * edit actually resolved to.
 */

type Check =
  | { kind: "info"; label: string; value: string }
  | { kind: "ok"; label: string; detail: string }
  | { kind: "warn"; label: string; detail: string };

function check(): Check[] {
  const out: Check[] = [];

  // ─── Router / persona wiring ─────────────────────────────────────────
  const routerProvider = process.env.STORYOS_ROUTER_PROVIDER?.trim() || "(unset)";
  const routerModel = process.env.STORYOS_ROUTER_MODEL?.trim() || "(default)";
  const personaProvider = process.env.STORYOS_PERSONA_PROVIDER?.trim() || "(unset)";
  const personaModel = process.env.STORYOS_PERSONA_MODEL?.trim() || "(default)";
  const fallbackModel = process.env.STORYOS_ROUTER_FALLBACK_MODEL?.trim() || "deepseek-chat";

  out.push({
    kind: "info",
    label: "router",
    value: `${routerProvider} / ${routerModel}  → fallback deepseek/${fallbackModel}`,
  });
  out.push({
    kind: "info",
    label: "persona",
    value: `${personaProvider} / ${personaModel}`,
  });

  // ─── API-key sanity (format-only, no network) ────────────────────────
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (routerProvider === "anthropic") {
    if (!anthropic) {
      out.push({
        kind: "warn",
        label: "anthropic key",
        detail: "MISSING — router is anthropic but ANTHROPIC_API_KEY unset",
      });
    } else if (!anthropic.startsWith("sk-ant-")) {
      out.push({
        kind: "warn",
        label: "anthropic key",
        detail: `format looks wrong (expected "sk-ant-..." prefix, got ${anthropic.slice(0, 8)}…)`,
      });
    } else {
      out.push({
        kind: "ok",
        label: "anthropic key",
        detail: `format OK (${anthropic.slice(0, 10)}…)`,
      });
    }
  }

  const deepseek = process.env.DEEPSEEK_API_KEY?.trim();
  if (
    personaProvider === "deepseek" ||
    routerProvider === "deepseek" ||
    routerProvider === "anthropic" // Claude fallback needs DeepSeek too
  ) {
    if (!deepseek) {
      out.push({
        kind: "warn",
        label: "deepseek key",
        detail: "MISSING — needed for persona or as Claude fallback target",
      });
    } else if (!deepseek.startsWith("sk-")) {
      out.push({
        kind: "warn",
        label: "deepseek key",
        detail: `format looks wrong (expected "sk-..." prefix, got ${deepseek.slice(0, 6)}…)`,
      });
    } else {
      out.push({
        kind: "ok",
        label: "deepseek key",
        detail: `format OK (${deepseek.slice(0, 8)}…)`,
      });
    }
  }

  // ─── Java endpoints ──────────────────────────────────────────────────
  const javaStudio = process.env.JAVA_STUDIO_URL?.trim();
  const javaContent = process.env.JAVA_CONTENT_URL?.trim();
  if (!javaStudio) {
    out.push({
      kind: "warn",
      label: "java studio",
      detail: "JAVA_STUDIO_URL unset — most workflows will fail",
    });
  } else {
    out.push({ kind: "ok", label: "java studio", detail: javaStudio });
  }
  if (!javaContent) {
    out.push({
      kind: "warn",
      label: "java content",
      detail: "JAVA_CONTENT_URL unset — asset routes will fail",
    });
  } else {
    out.push({ kind: "ok", label: "java content", detail: javaContent });
  }

  // ─── Redis ───────────────────────────────────────────────────────────
  const redisUrl = process.env.REDIS_URL?.trim() || "redis://localhost:6379";
  out.push({ kind: "info", label: "redis", value: redisUrl });

  // ─── Worker concurrency ──────────────────────────────────────────────
  const workerConc = process.env.WORKER_CONCURRENCY?.trim() || "4 (default)";
  const storyboardConc = process.env.STORYBOARD_GENERATE_CONCURRENCY?.trim() || "4 (default)";
  const imageConc = process.env.IMAGE_WORKER_CONCURRENCY?.trim() || "1 (default)";
  out.push({
    kind: "info",
    label: "worker",
    value: `workflow=${workerConc}  storyboard=${storyboardConc}  image=${imageConc}`,
  });

  // ─── Anthropic hardening knobs (only meaningful if router=anthropic) ─
  if (routerProvider === "anthropic") {
    const knobs = [
      ["concurrency", process.env.STORYOS_CLAUDE_MAX_CONCURRENCY ?? "20"],
      ["queueTimeout", `${process.env.STORYOS_CLAUDE_QUEUE_TIMEOUT_MS ?? "8000"}ms`],
      ["queueMaxDepth", process.env.STORYOS_CLAUDE_QUEUE_MAX_DEPTH ?? "100"],
      ["circuitThreshold", process.env.STORYOS_CLAUDE_CIRCUIT_THRESHOLD ?? "5"],
      ["circuitCooldown", `${process.env.STORYOS_CLAUDE_CIRCUIT_COOLDOWN_MS ?? "60000"}ms`],
      ["requestTimeout", `${process.env.STORYOS_CLAUDE_REQUEST_TIMEOUT_MS ?? "30000"}ms`],
    ];
    out.push({
      kind: "info",
      label: "hardening",
      value: knobs.map(([k, v]) => `${k}=${v}`).join("  "),
    });
    out.push({
      kind: "info",
      label: "prompt cache",
      value: "ENABLED on supervisor system prompt (Mastra instructions array)",
    });
  }

  return out;
}

export function logStartupSelfCheck(): void {
  const checks = check();
  const bar = "─".repeat(66);
  // eslint-disable-next-line no-console
  console.log(`┌${bar}┐`);
  // eslint-disable-next-line no-console
  console.log(`│ storyos self-check`);
  // eslint-disable-next-line no-console
  console.log(`├${bar}┤`);
  for (const c of checks) {
    const tag = c.kind === "ok" ? "✓" : c.kind === "warn" ? "⚠" : " ";
    const body = c.kind === "info" ? c.value : c.detail;
    // eslint-disable-next-line no-console
    console.log(`│ ${tag} ${c.label.padEnd(14)}  ${body}`);
  }
  // eslint-disable-next-line no-console
  console.log(`└${bar}┘`);
}
