/**
 * Process-wide gate for autonomous work, including request-triggered outbox
 * delivery. This is an operational switch, not an HTTP or external-I/O sandbox.
 * Existing deployments keep their worker behaviour when it is omitted.
 */
export function backgroundTasksEnabled(): boolean {
  const value = process.env.BACKGROUND_TASKS_ENABLED?.trim();
  if (value === undefined || value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('BACKGROUND_TASKS_ENABLED must be true or false');
}
