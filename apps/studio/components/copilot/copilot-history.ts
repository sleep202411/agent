import type { UIMessage } from "ai";

export interface CopilotHistoryPayload<UI_MESSAGE extends UIMessage = UIMessage> {
  conversationId: string;
  messages: UI_MESSAGE[];
  selectedSkillKeys?: unknown;
  revision: number;
  sessionId: string | null;
  status: CopilotConversationStatus;
  resetAvailable: boolean;
}

export type CopilotConversationStatus =
  | "ready"
  | "streaming"
  | "failed"
  | "aborted"
  | "limit_exceeded";

export class CopilotHistoryContractError extends Error {
  readonly code = "COPILOT_HISTORY_CONTRACT_ERROR";

  constructor() {
    super("COPILOT_HISTORY_CONTRACT_ERROR");
    this.name = "CopilotHistoryContractError";
  }
}

export class CopilotHistoryRemoteError extends Error {
  readonly code: string;
  readonly action: string | null;

  constructor(message: string, options?: { code?: string; action?: string | null }) {
    super(message);
    this.name = "CopilotHistoryRemoteError";
    this.code = options?.code ?? "COPILOT_HISTORY_REMOTE_ERROR";
    this.action = options?.action ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UI_MESSAGE_ROLES = new Set<string>(["system", "user", "assistant"]);

function isUIMessage(value: unknown): value is UIMessage {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    value.id.trim() !== value.id ||
    value.id.length === 0 ||
    value.id.length > 128
  )
    return false;
  if (typeof value.role !== "string" || !UI_MESSAGE_ROLES.has(value.role)) return false;
  if (!Array.isArray(value.parts)) return false;

  return value.parts.every((part) => {
    if (!isRecord(part) || typeof part.type !== "string" || !part.type.trim()) return false;
    return part.type !== "text" || typeof part.text === "string";
  });
}

export function parseCopilotHistoryPayload<UI_MESSAGE extends UIMessage = UIMessage>(
  value: unknown
): CopilotHistoryPayload<UI_MESSAGE> {
  if (!isRecord(value)) throw new CopilotHistoryContractError();
  const envelope = isRecord(value.data) ? value.data : value;
  if (!Array.isArray(envelope.messages) || !envelope.messages.every(isUIMessage)) {
    throw new CopilotHistoryContractError();
  }
  if (
    typeof envelope.conversationId !== "string" ||
    !envelope.conversationId.trim() ||
    !Number.isSafeInteger(envelope.revision) ||
    (envelope.revision as number) < 0 ||
    !isCopilotConversationStatus(envelope.status) ||
    typeof envelope.resetAvailable !== "boolean" ||
    (envelope.sessionId !== null &&
      (typeof envelope.sessionId !== "string" || !UUID_PATTERN.test(envelope.sessionId)))
  ) {
    throw new CopilotHistoryContractError();
  }
  const messages = envelope.messages as UI_MESSAGE[];
  if (new Set(messages.map((message) => message.id)).size !== messages.length) {
    throw new CopilotHistoryContractError();
  }
  if (!canonicalSequenceMatchesStatus(messages, envelope.status)) {
    throw new CopilotHistoryContractError();
  }
  if (
    (messages.length === 0 &&
      (envelope.revision !== 0 || envelope.sessionId !== null || envelope.status !== "ready")) ||
    (messages.length > 0 &&
      ((envelope.revision as number) < 1 || typeof envelope.sessionId !== "string"))
  ) {
    throw new CopilotHistoryContractError();
  }
  return {
    conversationId: envelope.conversationId,
    messages,
    selectedSkillKeys: envelope.selectedSkillKeys,
    revision: envelope.revision as number,
    sessionId: envelope.sessionId,
    status: envelope.status,
    resetAvailable: envelope.resetAvailable,
  };
}

function canonicalSequenceMatchesStatus(
  messages: UIMessage[],
  status: CopilotConversationStatus
): boolean {
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role !== (index % 2 === 0 ? "user" : "assistant")) return false;
  }
  if (messages.length === 0) return status === "ready";
  const lastRole = messages[messages.length - 1]?.role;
  if (status === "ready") return lastRole === "assistant";
  // A normal claimed turn owns a user tail. A claimed Canvas tool-result
  // continuation updates the canonical assistant in place, so streaming and
  // terminal failure states deliberately retain an assistant tail instead.
  return lastRole === "user" || lastRole === "assistant";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCopilotConversationStatus(value: unknown): value is CopilotConversationStatus {
  return (
    value === "ready" ||
    value === "streaming" ||
    value === "failed" ||
    value === "aborted" ||
    value === "limit_exceeded"
  );
}

export async function copilotResponseError(response: Response): Promise<Error> {
  const raw = (await response.text()).trim();
  if (raw) {
    try {
      const payload = JSON.parse(raw) as unknown;
      if (isRecord(payload)) {
        const message = payload.message;
        const code = typeof payload.code === "string" ? payload.code : undefined;
        const action = typeof payload.action === "string" ? payload.action : null;
        if (typeof message === "string" && message.trim()) {
          return new CopilotHistoryRemoteError(message.trim(), { code, action });
        }
        if (Array.isArray(message)) {
          const details = message.filter((item): item is string => typeof item === "string");
          if (details.length > 0)
            return new CopilotHistoryRemoteError(details.join(" "), { code, action });
        }
      }
    } catch {
      // The upstream body is already the most actionable error text available.
    }
    return new CopilotHistoryRemoteError(raw);
  }
  return new CopilotHistoryRemoteError(`${response.status} ${response.statusText}`.trim());
}

export interface CopilotQuotaErrorDetails {
  kind: "rate_limited" | "quota_exceeded";
  dimension: string;
  limit: number;
  /** ISO timestamp for when the rejected dimension resets. */
  resetAt: string;
}

export interface CopilotStreamErrorDetails {
  code: string;
  action: string | null;
  message: string;
  quota: CopilotQuotaErrorDetails | null;
}

export function copilotStreamErrorDetails(
  error: Error | undefined
): CopilotStreamErrorDetails | null {
  if (!error?.message) return null;
  try {
    const payload = JSON.parse(error.message) as unknown;
    if (!isRecord(payload)) return null;
    const quota = copilotQuotaErrorFromPayload(payload);
    if (quota) {
      return {
        code: quota.kind,
        // A quota rejection lands after the turn is claimed, so the canonical
        // conversation already carries the failed turn. Reusing the existing
        // refresh_history stream-error path surfaces its Retry affordance
        // without a manual reload. Rate limiting is checked before the claim
        // and never mutates the conversation, so it needs no refresh.
        action: quota.kind === "quota_exceeded" ? "refresh_history" : null,
        message: error.message,
        quota,
      };
    }
    if (typeof payload.code !== "string") return null;
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    return {
      code: payload.code,
      action: typeof payload.action === "string" ? payload.action : null,
      message: message || error.message,
      quota: null,
    };
  } catch {
    return null;
  }
}

/**
 * The server rejects rate/quota admission with a numeric-code HttpException
 * body: `{code: 429, error: 'rate_limited' | 'quota_exceeded', dimension,
 * limit, resetAt}` (see apps/server CopilotQuotaService). Any malformed field
 * disqualifies the payload so panels never render a partially-true limit.
 */
function copilotQuotaErrorFromPayload(
  payload: Record<string, unknown>
): CopilotQuotaErrorDetails | null {
  if (payload.code !== 429) return null;
  if (payload.error !== "rate_limited" && payload.error !== "quota_exceeded") return null;
  if (
    typeof payload.dimension !== "string" ||
    !payload.dimension.trim() ||
    typeof payload.limit !== "number" ||
    !Number.isFinite(payload.limit) ||
    payload.limit < 0 ||
    typeof payload.resetAt !== "string" ||
    Number.isNaN(Date.parse(payload.resetAt))
  ) {
    return null;
  }
  return {
    kind: payload.error,
    dimension: payload.dimension,
    limit: payload.limit,
    resetAt: payload.resetAt,
  };
}

/**
 * Localized status-notice text for a typed quota rejection. `translate` is a
 * panel-scoped next-intl `t` whose namespace defines `rateLimited` and
 * `quotaExceeded` keys accepting `{limit}` and `{time}`.
 */
export function copilotQuotaNoticeText(
  quota: CopilotQuotaErrorDetails,
  translate: (
    key: "rateLimited" | "quotaExceeded",
    values: { limit: number; time: string }
  ) => string,
  locale: string
): string {
  const resetAt = new Date(quota.resetAt);
  const now = new Date();
  const sameDay =
    resetAt.getFullYear() === now.getFullYear() &&
    resetAt.getMonth() === now.getMonth() &&
    resetAt.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat(
    locale,
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
  ).format(resetAt);
  return translate(quota.kind === "rate_limited" ? "rateLimited" : "quotaExceeded", {
    limit: quota.limit,
    time,
  });
}
