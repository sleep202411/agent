export interface AgentOsIssue {
  /** Localized, actionable copy shown inside the FizzAgent panel. */
  message: string;
  /** Low-level transport detail kept for the diagnostics dialog. */
  technicalDetail?: string;
}

const BARE_SERVER_STATUS = /^HTTP\s+5\d{2}$/i;

/**
 * Turns an operational failure into product copy without discarding evidence.
 *
 * Server-provided messages remain verbatim. Only client-generated transport
 * placeholders (for example `HTTP 500`) are replaced in the primary UI; the
 * original value stays available in run details for diagnosis.
 */
export function toAgentOsIssue(
  error: unknown,
  fallback: string,
  serviceUnavailable: string
): AgentOsIssue {
  const raw = error instanceof Error ? error.message.trim() : "";
  const isBareServerFailure = BARE_SERVER_STATUS.test(raw);

  if (isBareServerFailure) {
    return {
      message: serviceUnavailable,
      technicalDetail: raw,
    };
  }

  return { message: raw || fallback };
}
