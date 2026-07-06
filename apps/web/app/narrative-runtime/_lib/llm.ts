/**
 * Qwen (Alibaba MaaS, OpenAI-compatible) JSON call helper — extracted from the
 * legacy turn route. Prototype only; the real thing is Java's.
 */

const BASE_URL =
  process.env.NARRATIVE_QWEN_BASE_URL?.trim() ||
  process.env.ALIBABA_BASE_URL?.trim() ||
  "https://llm-5bmlxd1jjvyn71k0.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

const MODEL =
  process.env.NARRATIVE_QWEN_MODEL?.trim() || process.env.ALIBABA_MODEL?.trim() || "qwen-plus";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

// TEMPORARY prototype key so enter/play-turn run without web-side env config.
// The real enter/turns is Java's — delete this when Java ships, and rotate the key.
const PROTOTYPE_LLM_KEY =
  "sk-ws-H.IMREYH.SGCG.MEUCIQDnprtwDhyxr5gAqkyOeQp6tgIWW_s8eHQiAbRBKyhQJAIgSdMOq4i3FO9Y2w99MsOhJ3GDnPDVruccXfLzrlRqJzE";

export function getLlmKey(): string | null {
  return PROTOTYPE_LLM_KEY;
}

/** Call the model with a forced JSON object response and return the parsed object. */
export async function callLlmJson<T = unknown>(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}
): Promise<T> {
  const key = getLlmKey();
  if (!key) throw new LlmError("LLM key not set (ALIBABA_API_KEY / NARRATIVE_QWEN_API_KEY).", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 900,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new LlmError(`LLM HTTP ${res.status}: ${raw.slice(0, 300)}`, 502);

    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new LlmError("LLM returned a non-JSON envelope", 502);
    }
    const content = (envelope as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new LlmError("LLM returned no content", 502);

    // Tolerate ```json fences and leading/trailing prose; fall back to the first
    // balanced-looking {…}/[…] block.
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const m = cleaned.match(/[{[][\s\S]*[}\]]/);
      if (m) {
        try {
          return JSON.parse(m[0]) as T;
        } catch {
          /* fall through */
        }
      }
      throw new LlmError("LLM content was not valid JSON (possibly truncated)", 502);
    }
  } finally {
    clearTimeout(timer);
  }
}
