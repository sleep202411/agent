import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  CopilotHistoryContractError,
  CopilotHistoryRemoteError,
  copilotQuotaNoticeText,
  copilotResponseError,
  copilotStreamErrorDetails,
  parseCopilotHistoryPayload,
} from "./copilot-history";

const messages: UIMessage[] = [
  { id: "message-1", role: "user", parts: [] },
  { id: "message-2", role: "assistant", parts: [] },
];
const metadata = {
  conversationId: "conversation-a",
  revision: 2,
  sessionId: "019f7243-20c1-7054-a6fa-0a33da6efef5",
  status: "ready" as const,
  resetAvailable: true,
};

describe("copilot history contract", () => {
  it("accepts direct and enveloped history responses", () => {
    expect(
      parseCopilotHistoryPayload({
        ...metadata,
        messages,
        selectedSkillKeys: ["skill-a"],
      })
    ).toEqual({
      ...metadata,
      messages,
      selectedSkillKeys: ["skill-a"],
    });
    expect(parseCopilotHistoryPayload({ data: { ...metadata, messages } }).messages).toEqual(
      messages
    );
  });

  it("rejects malformed history instead of treating it as an empty thread", () => {
    expect(() => parseCopilotHistoryPayload({ conversationId: "conversation-a" })).toThrow(
      CopilotHistoryContractError
    );
    expect(() =>
      parseCopilotHistoryPayload({
        ...metadata,
        messages: [{ id: "broken", role: "assistant" }],
      })
    ).toThrow(CopilotHistoryContractError);
    expect(() =>
      parseCopilotHistoryPayload({
        ...metadata,
        messages: [{ id: "broken", role: "assistant", parts: [null] }],
      })
    ).toThrow(CopilotHistoryContractError);
  });

  it("rejects blank or duplicate canonical ids instead of inventing replacements", () => {
    expect(() =>
      parseCopilotHistoryPayload({
        ...metadata,
        messages: [{ id: "", role: "assistant", parts: [] }],
      })
    ).toThrow(CopilotHistoryContractError);
    expect(() =>
      parseCopilotHistoryPayload({
        ...metadata,
        messages: [
          { id: "stable", role: "user", parts: [] },
          { id: "stable", role: "assistant", parts: [] },
        ],
      })
    ).toThrow(CopilotHistoryContractError);
  });

  it("requires canonical revision, generation, and status metadata", () => {
    expect(() =>
      parseCopilotHistoryPayload({ conversationId: "conversation-a", messages })
    ).toThrow(CopilotHistoryContractError);
    expect(() => parseCopilotHistoryPayload({ ...metadata, revision: -1, messages })).toThrow(
      CopilotHistoryContractError
    );
    expect(() => parseCopilotHistoryPayload({ ...metadata, status: "unknown", messages })).toThrow(
      CopilotHistoryContractError
    );
  });

  it.each(["streaming", "failed", "aborted", "limit_exceeded"] as const)(
    "accepts an assistant tail for a %s client-tool continuation",
    (status) => {
      expect(
        parseCopilotHistoryPayload({
          ...metadata,
          status,
          messages,
        }).messages
      ).toEqual(messages);
    }
  );

  it("keeps a normal failed user tail valid while rejecting ready user tails", () => {
    const userTail = [messages[0]];
    expect(
      parseCopilotHistoryPayload({
        ...metadata,
        status: "failed",
        revision: 1,
        messages: userTail,
      }).messages
    ).toEqual(userTail);
    expect(() =>
      parseCopilotHistoryPayload({
        ...metadata,
        revision: 1,
        messages: userTail,
      })
    ).toThrow(CopilotHistoryContractError);
  });

  it("preserves the actionable upstream error message", async () => {
    await expect(
      copilotResponseError(
        new Response(JSON.stringify({ message: "Conversation storage is unavailable." }), {
          status: 503,
        })
      )
    ).resolves.toEqual(new CopilotHistoryRemoteError("Conversation storage is unavailable."));
  });
});

describe("copilot stream error details", () => {
  const resetAt = "2026-07-19T15:00:00.000Z";

  it("keeps string-code payloads intact without quota details", () => {
    expect(
      copilotStreamErrorDetails(
        new Error(
          JSON.stringify({
            code: "COPILOT_TURN_SUPERSEDED",
            message: "Superseded.",
            action: "refresh_history",
          })
        )
      )
    ).toEqual({
      code: "COPILOT_TURN_SUPERSEDED",
      action: "refresh_history",
      message: "Superseded.",
      quota: null,
    });
  });

  it("parses a numeric-code rate_limited body into typed details without a refresh", () => {
    const raw = JSON.stringify({
      code: 429,
      error: "rate_limited",
      dimension: "chat",
      limit: 20,
      resetAt,
    });
    expect(copilotStreamErrorDetails(new Error(raw))).toEqual({
      code: "rate_limited",
      action: null,
      message: raw,
      quota: { kind: "rate_limited", dimension: "chat", limit: 20, resetAt },
    });
  });

  it("parses a post-claim quota_exceeded body and requests the canonical history refresh", () => {
    const raw = JSON.stringify({
      code: 429,
      error: "quota_exceeded",
      dimension: "chat",
      used: 30,
      limit: 30,
      resetAt,
      nextTier: "basic",
      nextTierLimit: 100,
    });
    expect(copilotStreamErrorDetails(new Error(raw))).toEqual({
      code: "quota_exceeded",
      action: "refresh_history",
      message: raw,
      quota: { kind: "quota_exceeded", dimension: "chat", limit: 30, resetAt },
    });
  });

  it("disqualifies malformed numeric-code bodies instead of rendering partial limits", () => {
    for (const body of [
      { code: 429, error: "quota_exceeded", dimension: "chat", limit: 30 },
      { code: 429, error: "quota_exceeded", dimension: "chat", limit: "30", resetAt },
      { code: 429, error: "quota_exceeded", dimension: "chat", limit: 30, resetAt: "not-a-date" },
      { code: 429, error: "throttled", dimension: "chat", limit: 30, resetAt },
      { code: 500, error: "rate_limited", dimension: "chat", limit: 30, resetAt },
    ]) {
      expect(copilotStreamErrorDetails(new Error(JSON.stringify(body)))).toBeNull();
    }
  });

  it("formats localized quota notices with the limit and reset time", () => {
    const translate = vi.fn(
      (key: string, values: { limit: number; time: string }) =>
        `${key}|${values.limit}|${values.time}`
    );

    const rateLimited = copilotQuotaNoticeText(
      { kind: "rate_limited", dimension: "chat", limit: 20, resetAt },
      translate,
      "en-US"
    );
    expect(rateLimited.startsWith("rateLimited|20|")).toBe(true);

    const quotaExceeded = copilotQuotaNoticeText(
      { kind: "quota_exceeded", dimension: "chat", limit: 30, resetAt },
      translate,
      "en-US"
    );
    expect(quotaExceeded.startsWith("quotaExceeded|30|")).toBe(true);

    const [, , time] = quotaExceeded.split("|");
    expect(time.length).toBeGreaterThan(0);
  });
});
