/** Test-only guard: artifact fixtures drop their shared table. */
export function configureArtifactTestDatabase(): void {
  const raw = process.env.LEGACY_AGENT_TEST_DATABASE_URL;
  if (!raw) throw new Error("Set LEGACY_AGENT_TEST_DATABASE_URL to the dedicated local fixture");
  const target = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    !["5433", "55439"].includes(target.port) ||
    target.pathname !== "/fizzdragon_legacy_agent_test" ||
    [...target.searchParams.keys()].some((key) => !["sslmode", "application_name"].includes(key))
  ) {
    throw new Error(
      "Only the named legacy Agent loopback fixture on port 5433 or 55439 may be reset"
    );
  }
  process.env.DATABASE_URL = raw;
  process.env.PGSSLMODE = "disable";
}

/** Redis accepts query options (including Unix socket paths); forbid overrides. */
export function assertLegacyRedisTestTarget(raw: string): void {
  const target = new URL(raw);
  if (
    target.protocol !== "redis:" ||
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    !["16379", "16389"].includes(target.port) ||
    target.search ||
    !["", "/", "/0"].includes(target.pathname)
  ) {
    throw new Error(
      "Only dedicated loopback Redis test ports 16379/16389 without overrides may be reset"
    );
  }
}
