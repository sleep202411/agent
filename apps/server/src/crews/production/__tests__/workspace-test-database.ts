/** Only explicitly selected, named loopback fixtures may be mutated. */
export function workspaceTestDatabase(env: Record<string, string | undefined>) {
  const selected =
    env.CREW_WORKSPACE_TEST_DATABASE_URL ||
    env.TASK01_TEST_DATABASE_URL ||
    (env.DATABASE_POSTGRES_INTEGRATION === '1' ? env.DATABASE_URL : undefined);
  if (!selected) return undefined;
  const target = new URL(selected);
  const fixture = `${target.port}${target.pathname}`;
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    !['55480/crew_workspace_loop_test', '55439/task01'].includes(fixture) ||
    target.hash ||
    [...target.searchParams.keys()].some(
      (key) => !['sslmode', 'application_name'].includes(key),
    )
  )
    throw new Error('Explicit named loopback Crew test database required');
  return selected;
}
