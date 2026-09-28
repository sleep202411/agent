/** Admission for the opt-in upload fixture, before any storage or DB mutation. */
export function episodeUploadTestDatabase(
  env: Record<string, string | undefined>,
): string {
  const selected = env.TASK01_TEST_DATABASE_URL ?? env.DATABASE_URL;
  if (!selected)
    throw new Error('Explicit named loopback upload test database required');
  const target = new URL(selected);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !['5433/fizzdragon_outbox_test', '55439/task01'].includes(
      `${target.port}${target.pathname}`,
    ) ||
    target.hash ||
    [...target.searchParams.keys()].some(
      (key) => !['sslmode', 'application_name'].includes(key),
    )
  )
    throw new Error('Explicit named loopback upload test database required');
  return selected;
}
