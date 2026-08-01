import { describe, expect, it } from "vitest";

import { storyStudioCapabilityPack } from "./tools.js";

function tool(id: string) {
  const definition = storyStudioCapabilityPack.tools.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Story Studio capability pack has no ${id} tool`);
  return definition;
}

describe("change-set authoring contract communication", () => {
  const apply = () => tool("story_apply_change_set");

  it("names the operation discriminator so the first attempt validates", () => {
    // The 2026-07-31 skeleton-apply attempt 1 failed validation because the
    // model wrote `op` instead of `kind` in an operation. The tool contract
    // must state the discriminator explicitly, and name the wrong guesses.
    const contract = `${apply().description}\n${storyStudioCapabilityPack.instructions}`;

    expect(contract).toContain('"kind"');
    expect(contract).toMatch(/never "op"/iu);
    expect(contract).toContain('"payload"');
  });

  it("carries a compact valid change-set example with a graph operation", () => {
    const description = apply().description;

    expect(description).toContain('"kind":"story_graph.put_node"');
    expect(description).toContain('"schemaVersion":"story-apply/v1"');
    expect(description).toContain('"schemaVersion":"story-change-set/v2"');
  });

  it("lists every operation kind the schema accepts", () => {
    const description = apply().description;

    for (const kind of [
      "story_bible.update_overview",
      "story_bible.put_character",
      "story_bible.remove_character",
      "story_bible.put_ending",
      "story_bible.remove_ending",
      "story_graph.set_entry_node",
      "story_graph.put_node",
      "story_graph.remove_node",
      "story_graph.reorder_nodes",
      "production.replace_notes",
    ]) {
      expect(description).toContain(kind);
    }
  });

  it("keeps the atomic compare-and-swap framing intact", () => {
    expect(apply().description).toContain("Atomically compare-and-swap");
    expect(apply().description).toContain("after human approval");
  });
});

describe("durable source analysis read contract", () => {
  const analysis = () => tool("story_get_source_analysis");

  it("declares the read as non-blocking with the job's three terminal-or-not states", () => {
    const description = analysis().description;

    expect(description).toContain("never waits");
    for (const state of ["ready", "processing", "failed"]) {
      expect(description).toContain(`"${state}"`);
    }
    expect(description).toContain("progress.percent");
  });

  it("makes a not-ready analysis a successful read that must be relayed, not a dead end", () => {
    const contract = `${analysis().description}\n${storyStudioCapabilityPack.instructions}`;

    // The failure this encodes: the agent asked for a whole-script breakdown,
    // read an analysis that had barely started, and left the turn with nothing
    // for the creator while the background job kept climbing.
    expect(contract).toContain("story_query_source_material");
    expect(contract).toMatch(/never end a turn/iu);
    expect(contract).toMatch(/percent/iu);
    expect(contract).toMatch(/not an error|normal result|successful read/iu);
  });

  it("tells the agent the background job cannot be ready in the turn that uploads a document", () => {
    expect(storyStudioCapabilityPack.instructions).toMatch(/background job/iu);
    expect(storyStudioCapabilityPack.instructions).toMatch(
      /never ready in the turn that uploads/iu
    );
  });

  it("forbids polling the durable job inside one turn", () => {
    const contract = `${analysis().description}\n${storyStudioCapabilityPack.instructions}`;

    expect(contract).toMatch(/never poll/iu);
  });
});
