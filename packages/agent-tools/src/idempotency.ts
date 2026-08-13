/**
 * Recommended idempotency key for domain commands (production guide §2.3).
 */
export function buildToolIdempotencyKey(input: {
  projectId: string;
  runId: string;
  toolCallId: string;
  operationVersion?: string;
}): string {
  const version = input.operationVersion ?? "v1";
  return `${input.projectId}:${input.runId}:${input.toolCallId}:${version}`;
}
