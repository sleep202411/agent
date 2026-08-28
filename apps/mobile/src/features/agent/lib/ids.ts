/**
 * Agent OS / Story ids are UUIDs including v7 (Nest / Prisma defaults).
 * Do not require RFC version nibble ∈ [1-5] — that rejects v7 and shows
 * "no project selected" after a successful create.
 */
const AGENT_OS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAgentOsId(value: string | null | undefined): boolean {
  return typeof value === "string" && AGENT_OS_ID_RE.test(value.trim());
}
