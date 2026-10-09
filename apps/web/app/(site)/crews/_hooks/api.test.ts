/**
 * The crew client is the last thing standing between a Nest error body
 * and the user's eyes, and root `AGENTS.md § Error reporting` says what
 * lands there has to be the server's own words.
 *
 * The trap this pins down: `ZodValidationPipe`
 * (apps/server/src/common/zod.pipe.ts) puts the actionable sentence in
 * `issues[]` and hard-codes `message` to "Validation failed". Reading
 * only `message` turns every schema rejection in the module — a
 * content-free submission, a malformed deadline, an over-long link —
 * into the same two useless words.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { CrewApiError, crewApi, isCrewCursorError } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Representative refinement-shaped 400 body. The transport must surface
 * the actionable issue even when Nest's top-level message is generic. */
const CONTENT_FREE_SUBMISSION = {
  message: "Validation failed",
  issues: [{ path: "url", message: "A submission needs a url or a note", code: "custom" }],
};

function stubFetch(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
  const fetchMock = vi.fn(async () => res as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CrewApiError", () => {
  it("surfaces the refinement's own sentence, not the pipe's placeholder", () => {
    const err = new CrewApiError(400, CONTENT_FREE_SUBMISSION);

    expect(err.message).toContain("A submission needs a url or a note");
    expect(err.message).not.toBe("Validation failed");
  });

  it("names the field so a bare Zod string reads on a multi-field form", () => {
    const err = new CrewApiError(400, {
      message: "Validation failed",
      issues: [
        { path: "url", message: "Too big: expected string to have <=1024 characters" },
        { path: "note", message: "Too big: expected string to have <=2000 characters" },
      ],
    });

    expect(err.message).toBe(
      "url: Too big: expected string to have <=1024 characters; " +
        "note: Too big: expected string to have <=2000 characters"
    );
  });

  it("keeps a producer's own headline in front of its issues", () => {
    // Not every `{ message, issues }` producer is the pipe — only the
    // pipe's constant is worth dropping.
    const err = new CrewApiError(400, {
      message: "ADMIN_PASSWORD_POLICY_FAILED",
      issues: [{ message: "Needs a digit" }],
    });

    expect(err.message).toBe("ADMIN_PASSWORD_POLICY_FAILED: Needs a digit");
  });

  it("passes through the plain message the crew services actually throw", () => {
    const err = new CrewApiError(400, { message: "User is not a member of this crew" });

    expect(err.message).toBe("User is not a member of this crew");
  });

  it("falls back to the status when the body carries nothing readable", () => {
    expect(new CrewApiError(502, null).message).toBe("Crew API error 502");
    expect(new CrewApiError(500, {}).message).toBe("Crew API error 500");
    expect(new CrewApiError(400, { message: "", issues: [] }).message).toBe("Crew API error 400");
  });

  it("keeps the raw status and body for callers that branch on them", () => {
    const err = new CrewApiError(423, {
      message: "Episode is approved",
      episodeStatus: "approved",
    });

    expect(err.status).toBe(423);
    expect(err.body).toEqual({ message: "Episode is approved", episodeStatus: "approved" });
  });
});

describe("crewApi", () => {
  it("throws the readable message end-to-end from a 400 response", async () => {
    stubFetch(400, CONTENT_FREE_SUBMISSION);

    await expect(crewApi.post("/assignments/1/submit", { body: {} })).rejects.toThrow(
      "A submission needs a url or a note"
    );
  });
});

describe("Crew error response recovery", () => {
  it.each([
    ["Upstream temporarily unavailable", "Upstream temporarily unavailable"],
    [
      JSON.stringify({ message: ["Deadline is invalid", "Assignee is required"] }),
      "Deadline is invalid; Assignee is required",
    ],
    ["", "Crew API error 503"],
  ])("preserves readable error content from %j", async (body, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 503 })));
    await expect(crewApi.get("/crews/example")).rejects.toMatchObject({
      status: 503,
      message: expected,
    });
  });
  it("ignores malformed issue entries while retaining valid validation details", () => {
    expect(
      new CrewApiError(400, {
        message: "Validation failed",
        issues: [
          null,
          {},
          { message: null },
          { message: 42 },
          { message: "" },
          { message: "Missing owner", path: "owner" },
        ],
      }).message
    ).toBe("owner: Missing owner");
  });
});

describe("Crew request options", () => {
  it("keeps upload cancellation alive during navigation", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    await crewApi.delete("/crews/crew-1/assets/uploads/upload-1", { keepalive: true });
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: "DELETE",
      keepalive: true,
      credentials: "include",
    });
  });
  it("forwards cancellation signals and Headers values", async () => {
    const controller = new AbortController();
    const request = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError"))
          );
        })
    );
    vi.stubGlobal("fetch", request);
    const pending = crewApi.get("/crews/crew-1", {
      signal: controller.signal,
      headers: new Headers({ "X-Request-Id": "test-request" }),
    });
    const init = request.mock.calls[0]?.[1];
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get("X-Request-Id")).toBe("test-request");
    const result = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await result;
  });
});

it.each([
  [new CrewApiError(400, { code: "CREW_CURSOR_INVALID" }), true],
  [new CrewApiError(403, { code: "CREW_CURSOR_INVALID" }), false],
  [new CrewApiError(400, { code: "OTHER" }), false],
  [new CrewApiError(400, null), false],
  [new CrewApiError(400, "CREW_CURSOR_INVALID"), false],
  [new Error("CREW_CURSOR_INVALID"), false],
])("only restarts pagination for the endpoint's structured rejection (%s)", (error, expected) => {
  expect(isCrewCursorError(error, "CREW_CURSOR_INVALID")).toBe(expected);
});

it("renders a gateway HTML response as an actionable HTTP error", () => {
  const error = new CrewApiError(502, "<!DOCTYPE html><html><title>Bad gateway</title></html>");
  expect(error.message).toContain("HTTP 502");
  expect(error.message).not.toContain("<html>");
  expect(new CrewApiError(409, { message: "Task changed. Refresh." }).message).toBe(
    "Task changed. Refresh."
  );
});
