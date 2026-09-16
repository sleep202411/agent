import { configureArtifactTestDatabase } from "./postgres-test-fixture";
/** PostgreSQL artifact-store integration; only the dedicated loopback fixture may be reset. */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  MissingArtifactError,
  getLatestArtifact,
  isMissingArtifactError,
  listProjectArtifacts,
  putArtifact,
  _resetForTests,
} from "./artifact-store";

let fixtureReady = false;

beforeAll(async () => {
  configureArtifactTestDatabase();
  // Make sure each run starts clean even when vitest reuses the worker.
  await _resetForTests();
  fixtureReady = true;
});

afterEach(async () => {
  if (fixtureReady) await _resetForTests();
});

describe("putArtifact", () => {
  it("creates the first version with version=1", async () => {
    const projectId = "proj-1";
    const rec = await putArtifact({
      projectId,
      kind: "outline",
      source: "story_outline",
      content: { storySummary: "first" },
      meta: { runId: "run-a" },
    });
    expect(rec.version).toBe(1);
    expect(rec.projectId).toBe(projectId);
    expect(rec.kind).toBe("outline");
    expect(rec.source).toBe("story_outline");
    expect(rec.status).toBe("completed");
    expect(rec.id).toMatch(/^aw_/);
  });

  it("auto-increments version per (projectId, kind)", async () => {
    const projectId = "proj-2";
    const v1 = await putArtifact({ projectId, kind: "outline", content: { n: 1 } });
    const v2 = await putArtifact({ projectId, kind: "outline", content: { n: 2 } });
    const v3 = await putArtifact({ projectId, kind: "outline", content: { n: 3 } });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);
  });

  it("keeps version namespaces separate per kind", async () => {
    const projectId = "proj-3";
    const out1 = await putArtifact({ projectId, kind: "outline", content: {} });
    const doc1 = await putArtifact({ projectId, kind: "user_doc", content: {} });
    const out2 = await putArtifact({ projectId, kind: "outline", content: {} });
    expect(out1.version).toBe(1);
    expect(doc1.version).toBe(1);
    expect(out2.version).toBe(2);
  });

  it("preserves parent lineage", async () => {
    const projectId = "proj-4";
    const parent = await putArtifact({ projectId, kind: "user_doc", content: { text: "src" } });
    const child = await putArtifact({
      projectId,
      kind: "outline",
      parentId: parent.id,
      content: { fromDoc: true },
    });
    expect(child.parentId).toBe(parent.id);
  });

  it("round-trips JSON content (objects, arrays, nested)", async () => {
    const projectId = "proj-5";
    const content = {
      storySummary: "x",
      structure: [{ chapterId: "c1", title: "T", keyEvents: ["a", "b"] }],
      threads: { main: "m", subs: [] },
    };
    await putArtifact({ projectId, kind: "outline", content });
    const got = await getLatestArtifact<typeof content>(projectId, "outline");
    expect(got?.content).toEqual(content);
  });

  it("respects an explicit status override", async () => {
    const projectId = "proj-6";
    const rec = await putArtifact({
      projectId,
      kind: "outline",
      content: {},
      status: "failed",
    });
    expect(rec.status).toBe("failed");
  });
});

describe("getLatestArtifact", () => {
  it("returns null when no artifact exists for (projectId, kind)", async () => {
    expect(await getLatestArtifact("nobody", "outline")).toBeNull();
  });

  it("returns the highest version, not the most recent insert order", async () => {
    const projectId = "proj-latest";
    await putArtifact({ projectId, kind: "outline", content: { tag: "v1" } });
    const v2 = await putArtifact({ projectId, kind: "outline", content: { tag: "v2" } });
    const v3 = await putArtifact({ projectId, kind: "outline", content: { tag: "v3" } });
    void v2;
    const latest = await getLatestArtifact<{ tag: string }>(projectId, "outline");
    expect(latest?.version).toBe(3);
    expect(latest?.id).toBe(v3.id);
    expect(latest?.content.tag).toBe("v3");
  });

  it("filters by kind", async () => {
    const projectId = "proj-kind";
    await putArtifact({ projectId, kind: "outline", content: { tag: "outline" } });
    await putArtifact({ projectId, kind: "user_doc", content: { tag: "doc" } });
    const outline = await getLatestArtifact<{ tag: string }>(projectId, "outline");
    const doc = await getLatestArtifact<{ tag: string }>(projectId, "user_doc");
    expect(outline?.content.tag).toBe("outline");
    expect(doc?.content.tag).toBe("doc");
  });
});

describe("listProjectArtifacts", () => {
  it("returns every kind/version for the project, newest first", async () => {
    const projectId = "proj-list";
    await putArtifact({ projectId, kind: "outline", content: { v: 1 } });
    await putArtifact({ projectId, kind: "user_doc", content: { v: 1 } });
    await putArtifact({ projectId, kind: "outline", content: { v: 2 } });
    const all = await listProjectArtifacts(projectId);
    expect(all).toHaveLength(3);
    // Newest by updated_at — outline v2 is the last write, so it leads.
    expect(all[0].kind).toBe("outline");
    expect(all[0].version).toBe(2);
  });

  it("scopes to the requested project", async () => {
    await putArtifact({ projectId: "proj-A", kind: "outline", content: {} });
    await putArtifact({ projectId: "proj-B", kind: "outline", content: {} });
    const a = await listProjectArtifacts("proj-A");
    expect(a).toHaveLength(1);
    expect(a[0].projectId).toBe("proj-A");
  });
});

describe("MissingArtifactError", () => {
  it("carries structured fields", () => {
    const err = new MissingArtifactError({
      projectId: "p",
      kind: "outline",
      requiredBy: "script_phase",
      producedBy: ["story_outline", "parse_script"],
    });
    expect(err.code).toBe("MISSING_ARTIFACT");
    expect(err.projectId).toBe("p");
    expect(err.kind).toBe("outline");
    expect(err.requiredBy).toBe("script_phase");
    expect(err.producedBy).toEqual(["story_outline", "parse_script"]);
    expect(err.message).toContain("script_phase");
    expect(err.message).toContain("outline");
    expect(err.message).toContain("story_outline, parse_script");
  });

  it("isMissingArtifactError narrows correctly", () => {
    const err: unknown = new MissingArtifactError({
      projectId: "p",
      kind: "outline",
      requiredBy: "any",
    });
    expect(isMissingArtifactError(err)).toBe(true);
    expect(isMissingArtifactError(new Error("nope"))).toBe(false);
    expect(isMissingArtifactError(null)).toBe(false);
  });
});
