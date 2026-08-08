import { describe, expect, it } from "vitest";
import {
  SHOT_CLIP_FIELD,
  SHOT_FRAME_FIELD,
  SHOT_NODE_TYPE,
  nextShotOrder,
  routeShotReferenceField,
  shotOrderBetween,
  sortedShots,
} from "./shot-node";

function shot(id: string, order?: string) {
  return { id, type: SHOT_NODE_TYPE, data: order === undefined ? {} : { order } };
}

describe("shot order keys", () => {
  it("keeps every insert strictly between its neighbours", () => {
    const first = shotOrderBetween(null, null);
    const last = shotOrderBetween(first, null);
    expect(first < last).toBe(true);

    // Repeatedly split the same gap — the pathological reorder case.
    let lower = first;
    const upper = last;
    for (let i = 0; i < 60; i += 1) {
      const middle = shotOrderBetween(lower, upper);
      expect(lower < middle).toBe(true);
      expect(middle < upper).toBe(true);
      lower = middle;
    }
  });

  it("orders appends and prepends without renumbering", () => {
    const keys: string[] = [];
    for (let i = 0; i < 50; i += 1) keys.push(shotOrderBetween(keys.at(-1) ?? null, null));
    expect([...keys].sort()).toEqual(keys);

    const head: string[] = [];
    for (let i = 0; i < 50; i += 1) head.unshift(shotOrderBetween(null, head[0] ?? null));
    expect([...head].sort()).toEqual(head);
  });

  it("appends after a corrupt or inverted neighbour instead of throwing", () => {
    const a = shotOrderBetween(null, null);
    expect(shotOrderBetween(a, a) > a).toBe(true);
    expect(shotOrderBetween("zz", "aa") > "zz").toBe(true);
    // A foreign key (not in the alphabet) is ignored, never crashes a render.
    expect(shotOrderBetween("shot-3", null).length).toBeGreaterThan(0);
  });

  it("appends after the current last shot", () => {
    const a = shotOrderBetween(null, null);
    const b = shotOrderBetween(a, null);
    const next = nextShotOrder([shot("s2", b), shot("s1", a), { id: "n", type: "note", data: {} }]);
    expect(next > b).toBe(true);
  });
});

describe("shot row projection", () => {
  it("sorts by order and ignores every other node type", () => {
    const rows = sortedShots([
      shot("c", "c"),
      { id: "note", type: "note", data: {} },
      shot("a", "a"),
      shot("b", "b"),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("parks an order-less shot at the end with a stable tiebreak", () => {
    const rows = sortedShots([shot("z"), shot("y"), shot("ordered", "V")]);
    expect(rows.map((row) => row.id)).toEqual(["ordered", "y", "z"]);
  });
});

describe("shot picture slots", () => {
  const frame = { id: "e1", edgeId: "e1", url: "https://x/a.png", kind: "image" as const };

  it("routes each media kind to its own slot", () => {
    expect(routeShotReferenceField({}, "image")).toEqual({ field: SHOT_FRAME_FIELD });
    expect(routeShotReferenceField({}, "video")).toEqual({ field: SHOT_CLIP_FIELD });
    expect(routeShotReferenceField({}, "audio")).toBeUndefined();
  });

  it("keeps taking stills while the frame slot has room for more candidates", () => {
    const references = { [SHOT_FRAME_FIELD]: [frame] };
    expect(routeShotReferenceField(references, "image")).toEqual({ field: SHOT_FRAME_FIELD });
  });

  it("refuses a full slot but lets the bound wire re-bind its own output", () => {
    const references = {
      [SHOT_FRAME_FIELD]: Array.from({ length: 24 }, (_, index) => ({
        id: `e${index}`,
        edgeId: `e${index}`,
        url: `https://x/${index}.png`,
        kind: "image" as const,
      })),
    };
    expect(routeShotReferenceField(references, "image")).toBeUndefined();
    expect(routeShotReferenceField(references, "image", "e0")).toEqual({
      field: SHOT_FRAME_FIELD,
    });
    // A different wire still can't take a full slot.
    expect(routeShotReferenceField(references, "image", "unbound")).toBeUndefined();
  });

  it("refuses a second clip — one animation per shot", () => {
    const references = {
      [SHOT_CLIP_FIELD]: [
        { id: "e9", edgeId: "e9", url: "https://x/a.mp4", kind: "video" as const },
      ],
    };
    expect(routeShotReferenceField(references, "video")).toBeUndefined();
    expect(routeShotReferenceField(references, "video", "e9")).toEqual({
      field: SHOT_CLIP_FIELD,
    });
  });
});
