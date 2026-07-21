import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  enterStoryPlay,
  getStoryConcepts,
  playStoryTurn,
  StoryNarrativeApiError,
} from "./story-narrative-api";

/**
 * The client's half of the narrative wire contract.
 *
 * These fetchers are the only thing standing between a published run and the
 * player component, and the expensive mistakes live at the edges: a response
 * the normalizers reject makes the player DISCARD a live run, and an error
 * whose code is mislabelled sends it down the wrong recovery path. Both are
 * exercised here against a stubbed `fetch`, so no server is involved.
 */

const GAME_ID = "game-one";
const CONTENT_VERSION = "version-1";
const LOCALE = "en-US";
const TURN_BUDGET_MS = 135_000;

type StubbedFetch = typeof globalThis.fetch;

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer every call with one body; record what was asked for. */
function stubFetch(body: unknown, init: ResponseInit = {}) {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, request?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof request?.body === "string" ? JSON.parse(request.body) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  }) as StubbedFetch;
  return calls;
}

function conceptsBody(items: unknown) {
  return { code: 200, data: { gameId: GAME_ID, items } };
}

function concept(index: number) {
  return { id: `HC-0${index}`, contentMarkdown: `Concept ${index}\nLogline: a way in.` };
}

function enterBody(overrides: Record<string, unknown> = {}) {
  return {
    code: 200,
    data: {
      sessionId: "sess_one",
      gameId: GAME_ID,
      locale: LOCALE,
      prologue: "A visitor knocks.",
      setupOptions: {
        paces: [
          { key: "slow", label: "Slow burn" },
          { key: "standard", label: "Standard" },
          { key: "compact", label: "Compact" },
        ],
      },
      defaults: { pace: "standard" },
      turnBudgetMs: TURN_BUDGET_MS,
      ...overrides,
    },
  };
}

function turnBody(overrides: Record<string, unknown> = {}) {
  return {
    code: 200,
    data: { narrative: "You stand at the door.", options: [], finished: false, ...overrides },
  };
}

async function apiError(run: () => Promise<unknown>): Promise<StoryNarrativeApiError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof StoryNarrativeApiError, `expected an API error, got ${error}`);
    return error;
  }
  throw new Error("expected the call to reject");
}

// ── concepts ──

test("accepts a well-formed concept batch for the requested story", async () => {
  const calls = stubFetch(conceptsBody([concept(1), concept(2), concept(3)]));

  const result = await getStoryConcepts(GAME_ID, CONTENT_VERSION, LOCALE, 3);

  assert.equal(result.gameId, GAME_ID);
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["HC-01", "HC-02", "HC-03"]
  );
  assert.deepEqual(calls[0]?.body, {
    gameId: GAME_ID,
    contentVersion: CONTENT_VERSION,
    locale: LOCALE,
    count: 3,
  });
});

test("rejects a concept batch generated for a different story", async () => {
  stubFetch({
    code: 200,
    data: { gameId: "other-game", items: [concept(1), concept(2), concept(3)] },
  });

  const error = await apiError(() => getStoryConcepts(GAME_ID, CONTENT_VERSION, LOCALE, 3));

  assert.equal(error.code, "CONCEPTS_RESPONSE_INVALID");
});

test("rejects a short concept batch rather than rendering a broken pick screen", async () => {
  stubFetch(conceptsBody([concept(1), concept(2)]));

  const error = await apiError(() => getStoryConcepts(GAME_ID, CONTENT_VERSION, LOCALE, 3));

  assert.equal(error.code, "CONCEPTS_RESPONSE_INVALID");
});

// ── enter ──

test("carries the pace catalogue through enter", async () => {
  stubFetch(enterBody());

  const result = await enterStoryPlay(GAME_ID, CONTENT_VERSION, LOCALE, concept(1));

  // Key and label only: pace biases the narrator's prompt, it does not ration
  // turns, so the client has nothing to gate an affordance on.
  assert.deepEqual(result.setupOptions.paces, [
    { key: "slow", label: "Slow burn" },
    { key: "standard", label: "Standard" },
    { key: "compact", label: "Compact" },
  ]);
  assert.equal(result.defaults.pace, "standard");
  assert.equal(result.turnBudgetMs, TURN_BUDGET_MS);
});

test("rejects an enter response with no usable turn budget", async () => {
  stubFetch(enterBody({ turnBudgetMs: 0 }));

  const error = await apiError(() => enterStoryPlay(GAME_ID, CONTENT_VERSION, LOCALE, concept(1)));

  assert.equal(error.code, "ENTER_RESPONSE_INVALID");
});

test("rejects a session opened for a different story", async () => {
  stubFetch(enterBody({ gameId: "other-game" }));

  const error = await apiError(() => enterStoryPlay(GAME_ID, CONTENT_VERSION, LOCALE, concept(1)));

  assert.equal(error.code, "ENTER_RESPONSE_INVALID");
});

test("refuses to open a run around an empty concept without asking the server", async () => {
  const calls = stubFetch(enterBody());

  const error = await apiError(() =>
    enterStoryPlay(GAME_ID, CONTENT_VERSION, LOCALE, { id: "HC-01", contentMarkdown: "   " })
  );

  assert.equal(error.code, "INVALID_CONCEPT");
  assert.equal(calls.length, 0);
});

// ── turns ──

test("accepts a turn and waits longer than the run's declared budget", async () => {
  const calls = stubFetch(
    turnBody({ options: [{ id: "choice.push", label: "Force it", kind: "choice" }] })
  );

  const result = await playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS);

  assert.equal(result.finished, false);
  assert.deepEqual(result.options, [{ id: "choice.push", label: "Force it", kind: "choice" }]);
  assert.deepEqual(calls[0]?.body, { sessionId: "sess_one", action: "continue" });
});

test("accepts an empty narrative when the turn ended the run", async () => {
  stubFetch(turnBody({ narrative: "", finished: true }));

  const result = await playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS);

  // A graph may legitimately stop on a beat with nothing left to read. Throwing
  // here would destroy a run that just completed.
  assert.equal(result.narrative, "");
  assert.equal(result.finished, true);
});

test("still rejects an empty narrative while the run is going", async () => {
  stubFetch(turnBody({ narrative: "" }));

  const error = await apiError(() =>
    playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS)
  );

  assert.equal(error.code, "TURN_RESPONSE_INVALID");
});

test("rejects a turn that mixes authored choices with free suggestions", async () => {
  stubFetch(
    turnBody({
      options: [
        { id: "choice.push", label: "Force it", kind: "choice" },
        { id: "suggestion:1", label: "Knock again", kind: "suggestion" },
      ],
    })
  );

  const error = await apiError(() =>
    playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS)
  );

  assert.equal(error.code, "TURN_RESPONSE_INVALID");
});

test("rejects an ending attached to an unfinished run", async () => {
  stubFetch(
    turnBody({ ending: { endingId: "ending.truth", title: "Truth", summary: "The door opens." } })
  );

  const error = await apiError(() =>
    playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS)
  );

  assert.equal(error.code, "TURN_RESPONSE_INVALID");
});

// ── music ──

test("carries every preloadable track from the enter response", async () => {
  stubFetch(
    enterBody({
      music: {
        enabled: true,
        tracks: [
          { trackId: "asset.theme", url: "https://media.test/theme.mp3", gain: 0.5 },
          { trackId: "asset.dread", url: "https://media.test/dread.mp3", gain: 0.35 },
        ],
      },
    })
  );

  const result = await enterStoryPlay(GAME_ID, CONTENT_VERSION, LOCALE, concept(1));

  assert.deepEqual(result.music, {
    enabled: true,
    tracks: [
      { trackId: "asset.theme", url: "https://media.test/theme.mp3", gain: 0.5 },
      { trackId: "asset.dread", url: "https://media.test/dread.mp3", gain: 0.35 },
    ],
  });
});

test("reads a story with no music block as a silent run", async () => {
  // The overwhelming majority of published stories. It must cost nothing and
  // must never look like a broken response.
  stubFetch(enterBody());

  const result = await enterStoryPlay(GAME_ID, CONTENT_VERSION, LOCALE, concept(1));

  assert.deepEqual(result.music, { enabled: false, tracks: [] });
});

test("keeps the usable tracks of a malformed music block instead of failing enter", async () => {
  stubFetch(
    enterBody({
      music: {
        enabled: true,
        tracks: [
          null,
          { trackId: "asset.theme", url: "https://media.test/theme.mp3", gain: 4 },
          { trackId: "asset.theme", url: "https://media.test/duplicate.mp3", gain: 0.4 },
          { trackId: "asset.missing-url", gain: 0.4 },
          { url: "https://media.test/no-id.mp3" },
        ],
      },
    })
  );

  const result = await enterStoryPlay(GAME_ID, CONTENT_VERSION, LOCALE, concept(1));

  // Junk entries drop, the duplicate id loses to the first, and an out-of-range
  // gain is clamped rather than blowing the player's ears out.
  assert.deepEqual(result.music, {
    enabled: true,
    tracks: [{ trackId: "asset.theme", url: "https://media.test/theme.mp3", gain: 1 }],
  });
});

test("reads an enabled music block with nothing playable as silence", async () => {
  stubFetch(enterBody({ music: { enabled: true, tracks: [{ trackId: "asset.theme" }] } }));

  const result = await enterStoryPlay(GAME_ID, CONTENT_VERSION, LOCALE, concept(1));

  // Enabled with no playable track would render a control over silence.
  assert.deepEqual(result.music, { enabled: false, tracks: [] });
});

test("carries a play cue through a turn", async () => {
  stubFetch(turnBody({ music: { action: "play", trackId: "asset.theme", fadeMs: 1500 } }));
  const played = await playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS);
  assert.deepEqual(played.music, { action: "play", trackId: "asset.theme", fadeMs: 1500 });
});

test("leaves music absent on the turns that change nothing", async () => {
  stubFetch(turnBody());

  const result = await playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS);

  assert.equal(result.music, undefined);
  assert.equal("music" in result, false);
});

test("drops a malformed cue without losing the turn it arrived on", async () => {
  for (const cue of [
    { action: "explode", trackId: "asset.theme", fadeMs: 1500 },
    // `stop` was retired with the cue that never emitted it.
    { action: "stop", fadeMs: 1200 },
    { action: "play", fadeMs: 1500 },
    { action: "play", trackId: "   ", fadeMs: 1500 },
    "play",
    null,
  ]) {
    stubFetch(turnBody({ music: cue }));

    const result = await playStoryTurn(
      { sessionId: "sess_one", action: "continue" },
      TURN_BUDGET_MS
    );

    // Ignoring a cue costs one unchanged track. Throwing would cost the turn.
    assert.equal(result.music, undefined);
    assert.equal(result.narrative, "You stand at the door.");
  }
});

test("falls back to the contract's fade when a cue omits one", async () => {
  stubFetch(turnBody({ music: { action: "play", trackId: "asset.theme" } }));
  const played = await playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS);
  assert.deepEqual(played.music, { action: "play", trackId: "asset.theme", fadeMs: 1500 });

  stubFetch(turnBody({ music: { action: "play", trackId: "asset.theme", fadeMs: -1 } }));
  const negative = await playStoryTurn(
    { sessionId: "sess_one", action: "continue" },
    TURN_BUDGET_MS
  );
  assert.deepEqual(negative.music, { action: "play", trackId: "asset.theme", fadeMs: 1500 });
});

// ── error mapping ──

test("keeps the terminal and recoverable run codes distinguishable", async () => {
  // The player component routes on these codes alone: INVALID_ACTION discards
  // the run, the other two keep it, so they must survive the wire distinctly.
  for (const [status, code] of [
    [409, "INVALID_ACTION"],
    [409, "RUN_ALREADY_STARTED"],
    [409, "RUN_NOT_STARTED"],
    [409, "ACTION_NOT_ALLOWED"],
    [404, "RELEASE_NOT_FOUND"],
    [410, "SESSION_EXPIRED"],
  ] as const) {
    stubFetch({ code, message: "refused" }, { status });

    const error = await apiError(() =>
      playStoryTurn({ sessionId: "sess_one", action: "start" }, TURN_BUDGET_MS)
    );

    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.message, "refused");
  }
});

test("carries the retryable flag a throttled turn answers with", async () => {
  stubFetch({ code: "TURN_IN_FLIGHT", message: "still playing", retryable: true }, { status: 429 });

  const error = await apiError(() =>
    playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS)
  );

  assert.equal(error.code, "TURN_IN_FLIGHT");
  assert.equal(error.retryable, true);
});

test("reads a 2xx envelope that still carries a failure code as a failure", async () => {
  stubFetch({ code: "GENERATION_FAILED", message: "the narrator did not answer" });

  const error = await apiError(() =>
    playStoryTurn({ sessionId: "sess_one", action: "continue" }, TURN_BUDGET_MS)
  );

  assert.equal(error.code, "GENERATION_FAILED");
  assert.equal(error.upstream, true);
});
