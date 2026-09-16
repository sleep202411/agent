/** Parse connection options before a suite checks its own named loopback targets.
 * This deliberately does not replace each suite's host/port/database allowlist.
 */
export function postgresFixtureUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hash ||
    [...url.searchParams.keys()].some(
      (key) => !['sslmode', 'application_name'].includes(key),
    )
  )
    throw new Error(
      'PostgreSQL fixture URL must not override connection settings.',
    );
  return url;
}
