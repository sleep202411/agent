/** Reject connection overrides before destructive local fixture setup. */
export function assertOutboxTestDatabase(
  rawUrl: string,
  allowIpv6 = false,
): void {
  const url = new URL(rawUrl);
  const hosts = ['localhost', '127.0.0.1', ...(allowIpv6 ? ['[::1]'] : [])];
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !hosts.includes(url.hostname) ||
    !['5433/fizzdragon_outbox_test', '55439/task01'].includes(
      `${url.port}${url.pathname}`,
    ) ||
    url.hash ||
    [...url.searchParams.keys()].some(
      (key) => !['sslmode', 'application_name'].includes(key),
    )
  ) {
    throw new Error(
      'Explicitly selected named loopback test database required.',
    );
  }
}
