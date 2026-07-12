import assert from "node:assert/strict";
import test from "node:test";
import { createNewJinlingSession, JINLING_SEASON_ONE_START_NODE } from "./session";

test("creates the first stable checkpoint after the blank ledger prologue", () => {
  const session = createNewJinlingSession({
    sessionId: "session-p00",
    now: "2026-07-11T12:00:00.000Z",
    profile: {
      displayName: "云舟",
      origin: "weave",
      trait: "quick",
    },
  });

  assert.equal(session.currentNodeId, JINLING_SEASON_ONE_START_NODE);
  assert.equal(session.stableCheckpoint.nodeId, JINLING_SEASON_ONE_START_NODE);
  assert.equal(session.variables.ledgerInsight, 1);
  assert.equal(session.variables.keepsakeId, "PROP-TOKEN-WEAVE");
  assert.equal(session.flags.profileStamped, true);
});
