import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createGameSession } from "./session";
import { createGameSessionSchema } from "./session-schema";

const profileSchema = z
  .object({
    origin: z.enum(["weave", "kin", "medic"]),
  })
  .strict();
const sessionSchema = createGameSessionSchema(profileSchema);

test("validates a deterministic versioned session", () => {
  const session = createGameSession({
    sessionId: "session-001",
    gameId: "jinling-rumeng",
    releaseId: "s01-production-validation",
    contentVersion: "2026.07.11.1",
    profile: { origin: "kin" as const },
    startNodeId: "S01-P00",
    now: "2026-07-11T10:00:00.000Z",
  });

  assert.deepEqual(sessionSchema.parse(session), session);
});

test("rejects checkpoint drift and duplicate transaction ids", () => {
  const session = createGameSession({
    sessionId: "session-001",
    gameId: "jinling-rumeng",
    releaseId: "s01-production-validation",
    contentVersion: "2026.07.11.1",
    profile: { origin: "kin" as const },
    startNodeId: "S01-P00",
    now: "2026-07-11T10:00:00.000Z",
  });
  session.stableCheckpoint.nodeId = "S01-SC01";
  session.appliedTransactionIds = ["txn-001", "txn-001"];

  const result = sessionSchema.safeParse(session);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(
      result.error.issues.map((issue) => issue.message).join("\n"),
      /Checkpoint nodeId does not match|Applied transaction ids must be unique/
    );
  }
});
