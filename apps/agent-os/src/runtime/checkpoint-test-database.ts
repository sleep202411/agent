/** Restrict integration setup/cleanup to the named disposable fixtures. */
export function checkpointTestDatabase(env: Record<string, string | undefined>): string | null {
  const ciUrl = env.TASK01_TEST_DATABASE_URL?.trim();
  if (!ciUrl && env.AGENT_OS_CHECKPOINT_POSTGRES_INTEGRATION !== "1") return null;
  const raw = ciUrl || env.DATABASE_URL?.trim();
  if (!raw) throw new Error("Checkpoint integration requires an explicit test database URL");
  const url = new URL(raw);
  const namedFixture =
    (url.port === "55439" && url.pathname === "/task01") ||
    (url.port === "5433" && url.pathname === "/fizzdragon");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !namedFixture ||
    [...url.searchParams.keys()].some((key) => !["sslmode", "application_name"].includes(key))
  ) {
    throw new Error(
      "Checkpoint integration requires a named loopback fixture without connection overrides"
    );
  }
  return raw;
}
