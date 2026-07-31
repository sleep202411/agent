import { describe, expect, it } from "vitest";

import { preserveStoredMessageOwnership } from "./agent-memory.js";

describe("preserveStoredMessageOwnership", () => {
  const stored = {
    format: 2,
    parts: [{ type: "text", text: "Earlier input." }],
    metadata: {
      conversationId: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000010",
      provider: "google",
    },
  };

  it("restores server-owned identity omitted by an Ably history replay", () => {
    expect(
      preserveStoredMessageOwnership(
        {
          format: 2,
          parts: [{ type: "text", text: "Earlier input." }],
          metadata: { provider: "google" },
        },
        stored
      )
    ).toEqual(stored);
  });

  it("does not overwrite an explicit conflicting run identity", () => {
    const candidate = {
      format: 2,
      parts: [{ type: "text", text: "Earlier input." }],
      metadata: {
        conversationId: "00000000-0000-4000-8000-000000000001",
        runId: "00000000-0000-4000-8000-000000000099",
        provider: "google",
      },
    };

    expect(preserveStoredMessageOwnership(candidate, stored)).toEqual(candidate);
  });

  it("preserves content mutations so reconciliation still detects them", () => {
    expect(
      preserveStoredMessageOwnership(
        {
          format: 2,
          parts: [{ type: "text", text: "Tampered input." }],
          metadata: { provider: "google" },
        },
        stored
      )
    ).toEqual({
      format: 2,
      parts: [{ type: "text", text: "Tampered input." }],
      metadata: stored.metadata,
    });
  });
});
