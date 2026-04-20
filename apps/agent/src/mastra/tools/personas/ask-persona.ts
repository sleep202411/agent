/**
 * Shared plumbing for "ask_*" tools — the direct-call path where the
 * supervisor consults a single persona without spinning up a workflow.
 *
 * Each ask_* tool:
 *   1. Validates its input via a Zod schema.
 *   2. Loads context from Java (via context-loader) based on the scope
 *      fields the user-request touches (episode / characters / scenes).
 *   3. Assembles a prompt: [user task] + [context blocks].
 *   4. Calls the persona agent's .generate().
 *   5. Returns { persona, reply, tookMs, contextBytes } — a thin envelope
 *      so the supervisor (and observability) can see what happened.
 *
 * We also enforce:
 *   - A hard timeout via AbortSignal (default 30s) so a stuck LLM can't
 *     hang the whole chat turn.
 *   - Consistent prefixed logs so production traces are greppable.
 *   - Never throw an unformatted error into the tool result — always
 *     return a structured fallback so the supervisor knows what failed.
 */
import type { RequestContext } from "@mastra/core/request-context";

export const DEFAULT_ASK_TIMEOUT_MS = 30_000;

/**
 * Structural type for the subset of Mastra we actually use here. Keeps us
 * decoupled from the exact `MastraUnion`/`Mastra<...>` generic variants
 * that differ between Mastra versions.
 */
interface AgentLike {
  generate(input: string, opts?: Record<string, unknown>): Promise<{ text?: unknown }>;
}
interface MastraLike {
  getAgent(id: string): AgentLike | undefined;
}

export interface AskPersonaResult {
  persona: string;
  reply: string;
  tookMs: number;
  /** Bytes of context injected into the prompt (for cost observability). */
  contextBytes: number;
  /** Populated when the LLM call failed or timed out — supervisor should
   *  mention this to the user instead of silently treating it as success. */
  error?: string;
}

export interface AskPersonaOptions {
  mastra: MastraLike | undefined;
  requestContext: RequestContext | undefined;
  agentId: string;
  task: string;
  contextBlocks: Array<{ heading: string; body: string }>;
  timeoutMs?: number;
}

/** Join a user task + named context blocks into a single prompt string. */
function composePrompt(task: string, blocks: Array<{ heading: string; body: string }>): string {
  const parts: string[] = [`【用户请求】\n${task.trim()}`];
  for (const b of blocks) {
    if (!b.body?.trim()) continue;
    parts.push(`【${b.heading}】\n${b.body.trim()}`);
  }
  return parts.join("\n\n");
}

export async function askPersona(opts: AskPersonaOptions): Promise<AskPersonaResult> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
  const prompt = composePrompt(opts.task, opts.contextBlocks);
  const contextBytes = prompt.length;

  const agent = opts.mastra?.getAgent(opts.agentId);
  if (!agent) {
    const error = `persona agent "${opts.agentId}" not registered`;
    console.warn("[ask-persona]", error);
    return {
      persona: opts.agentId,
      reply: "",
      tookMs: Date.now() - startedAt,
      contextBytes,
      error,
    };
  }

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    console.info(
      `[ask-persona] → ${opts.agentId}: task=${opts.task.slice(0, 80).replace(/\n/g, " ")}… ctxBytes=${contextBytes}`
    );
    const response = await agent.generate(prompt, {
      // Thread through requestContext so persona sees the same locale / cookie.
      requestContext: opts.requestContext,
      abortSignal: abortController.signal,
    });
    const reply = String(response.text ?? "").trim();
    const tookMs = Date.now() - startedAt;
    console.info(`[ask-persona] ← ${opts.agentId} (${tookMs}ms, ${reply.length} chars)`);
    return { persona: opts.agentId, reply, tookMs, contextBytes };
  } catch (err) {
    const tookMs = Date.now() - startedAt;
    const aborted = abortController.signal.aborted;
    const error = aborted
      ? `persona "${opts.agentId}" timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    console.warn(`[ask-persona] ✕ ${opts.agentId} (${tookMs}ms) ${error}`);
    return {
      persona: opts.agentId,
      reply: "",
      tookMs,
      contextBytes,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}
