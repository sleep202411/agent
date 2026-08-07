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

  const url = `${baseUrl.replace(/\/$/, "")}/agent-os/internal/runs/${encodeURIComponent(input.runId)}/journal`;
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
