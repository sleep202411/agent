import type { AgentEventEnvelope } from "@repo/agent-protocol";

/**
 * Push the full event journal snapshot to Nest for durable storage.
 * Failures are logged but do not fail the interactive turn (worker still has memory).
 */
export async function reportJournalToNest(input: {
  runId: string;
  projectId: string;
  conversationId: string;
  actorId: string;
  modelProfileId: string;
  status: string;
  events: readonly AgentEventEnvelope[];
  pendingApproval?: unknown;
  assistantText?: string | null;
}): Promise<void> {
  const baseUrl = process.env.AGENT_OS_DOMAIN_URL?.trim();
  const token = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
  if (!baseUrl || !token) return;

  const url = `${baseUrl.replace(/\/$/, "")}/internal/agent-os/runs/${encodeURIComponent(input.runId)}/journal`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-os-internal-token": token,
      },
      body: JSON.stringify({
        projectId: input.projectId,
        conversationId: input.conversationId,
        actorId: input.actorId,
        modelProfileId: input.modelProfileId,
        status: input.status,
        events: input.events,
        pendingApproval: input.pendingApproval ?? null,
        assistantText: input.assistantText ?? null,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      process.stderr.write(
        `${JSON.stringify({
          level: "warn",
          msg: "agent-os.journal.report_failed",
          status: res.status,
          runId: input.runId,
        })}\n`
      );
    }
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        level: "warn",
        msg: "agent-os.journal.report_error",
        runId: input.runId,
        error: error instanceof Error ? error.message : String(error),
      })}\n`
    );
  }
}

/**
 * Read a run's durable journal back from Nest.
 *
 * Used when a worker restarts mid-run: the in-process journal is gone, and
 * appending from sequence 1 would make the next full-snapshot persist overwrite
 * the stored transcript with a shorter one. Returns null when the gateway is
 * not configured or does not know the run.
 */
export async function fetchJournalFromNest(runId: string): Promise<{
  status: string;
  events: AgentEventEnvelope[];
  pendingApproval: unknown;
  assistantText: string | null;
} | null> {
  const baseUrl = process.env.AGENT_OS_DOMAIN_URL?.trim();
  const token = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
  if (!baseUrl || !token) return null;

  const url = `${baseUrl.replace(/\/$/, "")}/internal/agent-os/runs/${encodeURIComponent(runId)}/journal`;
  try {
    const res = await fetch(url, {
      headers: { "x-agent-os-internal-token": token },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      status?: string;
      events?: AgentEventEnvelope[];
      pendingApproval?: unknown;
      assistantText?: string | null;
    };
    if (!body.ok || !Array.isArray(body.events)) return null;
    return {
      status: typeof body.status === "string" ? body.status : "running",
      events: body.events,
      pendingApproval: body.pendingApproval ?? null,
      assistantText: body.assistantText ?? null,
    };
  } catch {
    return null;
  }
}
