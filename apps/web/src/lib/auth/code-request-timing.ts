import {
  AuthTransportError,
  readEnvelope,
  type AuthRequest,
  type AuthResponse,
} from "@repo/auth-flow";

export const CODE_REQUEST_MEASURE = "fizzdragon.auth.code-request";
const MAX_MEASURES = 50;

/** Local-only diagnostics: never retain the URL, identifier, body or error message. */
export async function measureCodeRequest(
  input: AuthRequest,
  locale: string,
  send: () => Promise<AuthResponse>
): Promise<AuthResponse> {
  const channel =
    input.path === "/user/email/getCode"
      ? "email"
      : input.path === "/user/getCode"
        ? "phone"
        : input.path === "/user/new/getCode" && ["email", "phone"].includes(input.query?.type ?? "")
          ? input.query!.type
          : undefined;
  if (input.method !== "GET" || !channel) return send();

  // Diagnostics must never prevent a request, or replace its result/error.
  let start: number | undefined;
  try {
    start = performance.now();
  } catch {
    /* unavailable in this runtime */
  }
  let outcome = "transport_error";
  try {
    const response = await send();
    outcome = readEnvelope(response.body, response.status).ok ? "accepted" : "rejected";
    return response;
  } catch (error) {
    if (error instanceof AuthTransportError) outcome = error.reason;
    throw error;
  } finally {
    try {
      if (start !== undefined) {
        const end = performance.now();
        // Keep a bounded batch, not an indefinitely growing browser timeline.
        if (performance.getEntriesByName(CODE_REQUEST_MEASURE, "measure").length >= MAX_MEASURES) {
          performance.clearMeasures(CODE_REQUEST_MEASURE);
        }
        performance.measure(CODE_REQUEST_MEASURE, {
          start,
          end,
          detail: {
            channel,
            flow: input.path === "/user/new/getCode" ? "sign_in" : "password_reset",
            locale: ["en-US", "zh-CN", "zh-HK"].includes(locale) ? locale : "other",
            outcome,
          },
        });
      }
    } catch {
      /* User Timing support and observers are outside the auth contract. */
    }
  }
}
