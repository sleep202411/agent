/**
 * Unit tests for `ensureOutline` — the helper every outline-dependent
 * phase uses to load the project skeleton or throw a typed error.
 *
 * Mocks `./outline` so we exercise the helper logic without spinning
 * up Redis or libsql; the underlying `getOutline` is covered by its
 * own integration tests in `artifact-store.test.ts` (artifact-side)
 * and the existing manual smoke (Redis-side).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryOutlineRecord } from "./outline";

vi.mock("./outline", () => ({
  getOutline: vi.fn(),
}));

import { getOutline } from "./outline";
import { ensureOutline } from "./outline-deps";
import { isMissingArtifactError } from "./artifact-store";

const mockedGetOutline = vi.mocked(getOutline);

afterEach(() => {
  mockedGetOutline.mockReset();
});

const fakeRecord = (projectId: string): StoryOutlineRecord => ({
  projectId,
  outline: {
    storySummary: "x",
    genre: "",
    tone: "",
    structure: [],
    threads: { main: "", subs: [] },
    cast: [],
    settings: [],
  },
  runId: "run-1",
  savedAt: 1,
});

describe("ensureOutline", () => {
  it("returns the record on hit", async () => {
    mockedGetOutline.mockResolvedValueOnce(fakeRecord("p1"));
    const got = await ensureOutline("p1", { requiredBy: "script_phase" });
    expect(got.projectId).toBe("p1");
  });

  it("throws MissingArtifactError on miss", async () => {
    mockedGetOutline.mockResolvedValueOnce(null);
    let caught: unknown;
    try {
      await ensureOutline("p2", { requiredBy: "role_phase" });
    } catch (err) {
      caught = err;
    }
    expect(isMissingArtifactError(caught)).toBe(true);
    if (!isMissingArtifactError(caught)) return;
    expect(caught.code).toBe("MISSING_ARTIFACT");
    expect(caught.kind).toBe("outline");
    expect(caught.requiredBy).toBe("role_phase");
    expect(caught.projectId).toBe("p2");
    expect(caught.producedBy).toEqual(["story_outline", "parse_script"]);
  });

  it("respects a custom producedBy hint", async () => {
    mockedGetOutline.mockResolvedValueOnce(null);
    let caught: unknown;
    try {
      await ensureOutline("p3", {
        requiredBy: "scene_phase",
        producedBy: ["story_outline"], // suppress parse_script suggestion
      });
    } catch (err) {
      caught = err;
    }
    expect(isMissingArtifactError(caught)).toBe(true);
    if (!isMissingArtifactError(caught)) return;
    expect(caught.producedBy).toEqual(["story_outline"]);
  });

  it("includes detail in the error message when provided", async () => {
    mockedGetOutline.mockResolvedValueOnce(null);
    let caught: unknown;
    try {
      await ensureOutline("p4", {
        requiredBy: "prop_phase",
        detail: "outline TTL'd out",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("outline TTL'd out");
  });
});
