// @vitest-environment jsdom

import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCopilotPendingTurn,
  isRecord,
  pendingTurnStorageKey,
  readCopilotPendingTurn,
  writeCopilotPendingTurn,
  type CopilotPendingTurn,
  type CopilotPendingTurnScope,
} from "./copilot-pending-turn";

const scope: CopilotPendingTurnScope = {
  userId: "user-a",
  workspaceId: "019f7243-20c1-7054-a6fa-0a33da6efef1",
  projectId: "019f7243-20c1-7054-a6fa-0a33da6efef2",
  mode: "canvas",
  conversationId: "canvas:019f7243-20c1-7054-a6fa-0a33da6efef2",
};

const turn: CopilotPendingTurn<UIMessage, Record<string, never>> = {
  message: {
    id: "019f7243-20c1-7054-a6fa-0a33da6efef3",
    role: "user",
    parts: [{ type: "text", text: "Preserve me" }],
  },
  metadata: {},
};

function parseCanvasTurn(value: unknown): typeof turn | null {
  if (!isRecord(value) || !isRecord(value.message) || !isRecord(value.metadata)) return null;
  const message = value.message;
  if (
    message.id !== turn.message.id ||
    message.role !== "user" ||
    !Array.isArray(message.parts) ||
    Object.keys(value.metadata).length !== 0
  ) {
    return null;
  }
  return value as unknown as typeof turn;
}

describe("Copilot pending-turn recovery", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("round-trips only inside the exact authenticated project scope", () => {
    expect(writeCopilotPendingTurn(scope, turn)).toBe(true);
    expect(readCopilotPendingTurn(scope, parseCanvasTurn)).toEqual(turn);
    expect(readCopilotPendingTurn({ ...scope, userId: "user-b" }, parseCanvasTurn)).toBeNull();
    expect(
      readCopilotPendingTurn({ ...scope, workspaceId: "other-workspace" }, parseCanvasTurn)
    ).toBeNull();
    expect(
      readCopilotPendingTurn({ ...scope, projectId: "other-project" }, parseCanvasTurn)
    ).toBeNull();
  });

  it("uses compare-and-remove so late settlement cannot erase a newer turn", () => {
    expect(writeCopilotPendingTurn(scope, turn)).toBe(true);
    clearCopilotPendingTurn(scope, "019f7243-20c1-7054-a6fa-0a33da6efef4");
    expect(readCopilotPendingTurn(scope, parseCanvasTurn)).toEqual(turn);

    clearCopilotPendingTurn(scope, turn.message.id);
    expect(readCopilotPendingTurn(scope, parseCanvasTurn)).toBeNull();
  });

  it("rejects and removes malformed or expired envelopes", () => {
    window.sessionStorage.setItem(pendingTurnStorageKey(scope), JSON.stringify({ turn }));
    expect(readCopilotPendingTurn(scope, parseCanvasTurn)).toBeNull();
    expect(window.sessionStorage.getItem(pendingTurnStorageKey(scope))).toBeNull();

    expect(writeCopilotPendingTurn(scope, turn)).toBe(true);
    const stored = JSON.parse(
      window.sessionStorage.getItem(pendingTurnStorageKey(scope))!
    ) as Record<string, unknown>;
    stored.savedAt = Date.now() - 25 * 60 * 60 * 1_000;
    window.sessionStorage.setItem(pendingTurnStorageKey(scope), JSON.stringify(stored));
    expect(readCopilotPendingTurn(scope, parseCanvasTurn)).toBeNull();

    expect(writeCopilotPendingTurn(scope, turn)).toBe(true);
    const future = JSON.parse(
      window.sessionStorage.getItem(pendingTurnStorageKey(scope))!
    ) as Record<string, unknown>;
    future.savedAt = Date.now() + 60_000;
    window.sessionStorage.setItem(pendingTurnStorageKey(scope), JSON.stringify(future));
    expect(readCopilotPendingTurn(scope, parseCanvasTurn)).toBeNull();
  });
});
