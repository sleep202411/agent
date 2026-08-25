import { z } from "zod";

/** Locales supported by durable Agent-authored interaction copy. */
export const AgentDisplayLocaleSchema = z.enum(["en-US", "zh-CN", "zh-HK"]);
export type AgentDisplayLocale = z.infer<typeof AgentDisplayLocaleSchema>;

/**
 * Human-readable copy shown for a structured approval decision.
 *
 * This is transcript display data only. `approvalId`, `responseId`, and
 * `decision` remain the authorization and idempotency authority.
 */
export const AgentApprovalResponseTextSchema = z.string().trim().min(1).max(300);

/** Server-owned acknowledgement copy; clients never author Assistant text. */
export function approvalAcknowledgementText(
  locale: AgentDisplayLocale,
  decision: "approve" | "reject"
): string {
  if (locale === "zh-CN") {
    return decision === "approve"
      ? "已收到你的批准，我会继续执行此操作。"
      : "已收到你的决定，我会继续处理，但不会执行此操作。";
  }
  if (locale === "zh-HK") {
    return decision === "approve"
      ? "已收到你的批准，我會繼續執行此操作。"
      : "已收到你的決定，我會繼續處理，但不會執行此操作。";
  }
  return decision === "approve"
    ? "I have your approval and will continue with the action."
    : "I have your decision and will continue without that action.";
}
