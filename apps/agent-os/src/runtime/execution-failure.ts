export interface TerminalExecutionFailure {
  code:
    | "MODEL_CONTENT_REJECTED"
    | "MODEL_OUTPUT_LIMIT"
    | "MODEL_TOOL_CALL_INVALID"
    | "REQUEST_REJECTED";
  message: string;
  retryable: false;
}

const TERMINAL_HTTP_STATUSES = new Set([400, 401, 403, 404, 413, 422]);
const CONTENT_REJECTION_MARKERS = [
  "data_inspection_failed",
  "content_filter",
  "content policy",
  "inappropriate content",
];
const OUTPUT_LIMIT_MARKERS = [
  "exceeded its output limit",
  "maximum context length",
  "context_length_exceeded",
];

/**
 * Only classify failures whose outcome is deterministic on an exact replay.
 * Network ambiguity, timeouts, rate limits, and provider 5xx responses stay
 * recoverable so a fenced epoch can inspect the durable graph checkpoint.
 */
export function classifyTerminalExecutionFailure(error: unknown): TerminalExecutionFailure | null {
  const details = errorDetails(error);
  const searchable = details.text.toLowerCase();

  // The model node has already exhausted its bounded retry. Redispatching the
  // whole execution must not turn a protocol failure into a silent stuck run.
  if (searchable.includes("model_tool_call_invalid")) {
    return {
      code: "MODEL_TOOL_CALL_INVALID",
      message: "The model could not execute this request. Please try again.",
      retryable: false,
    };
  }

  if (CONTENT_REJECTION_MARKERS.some((marker) => searchable.includes(marker))) {
    return {
      code: "MODEL_CONTENT_REJECTED",
      message:
        "The selected model could not process this content. Revise the content or choose another model, then try again.",
      retryable: false,
    };
  }

  if (OUTPUT_LIMIT_MARKERS.some((marker) => searchable.includes(marker))) {
    return {
      code: "MODEL_OUTPUT_LIMIT",
      message:
        "The model response exceeded its output limit. Shorten the request or split it into smaller steps, then try again.",
      retryable: false,
    };
  }

  if (details.status !== null && TERMINAL_HTTP_STATUSES.has(details.status)) {
    return {
      code: "REQUEST_REJECTED",
      message:
        "This request could not be completed as submitted. Adjust the request or choose another model, then try again.",
      retryable: false,
    };
  }

  return null;
}

function errorDetails(error: unknown): { status: number | null; text: string } {
  const seen = new Set<unknown>();
  const pending = [error];
  const text: string[] = [];
  let status: number | null = null;

  while (pending.length > 0 && seen.size < 8) {
    const value = pending.shift();
    if (value === null || value === undefined || seen.has(value)) continue;
    seen.add(value);

    if (typeof value === "string") {
      text.push(value);
      continue;
    }
    if (typeof value !== "object") {
      text.push(String(value));
      continue;
    }

    const record = value as Record<string, unknown>;
    if (value instanceof Error) text.push(value.message, value.name);
    for (const key of ["message", "code", "type"] as const) {
      const field = record[key];
      if (typeof field === "string") text.push(field);
    }
    for (const key of ["status", "statusCode"] as const) {
      const field = record[key];
      if (status === null && typeof field === "number" && Number.isInteger(field)) {
        status = field;
      }
    }
    for (const key of ["error", "cause", "response", "data"] as const) {
      if (record[key] !== undefined) pending.push(record[key]);
    }
  }

  return { status, text: text.join(" ") };
}
