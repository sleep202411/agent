import { expect, it } from "vitest";
import { applyReferenceDurationPatches, hasKnownDuration } from "./reference-duration-patches";
const source = {
  id: "ref",
  url: "old.mp4",
  assetId: "asset",
  edgeId: "edge",
  sourceNodeId: "source",
  durationSeconds: null,
};
const patch = { ...source, field: "video", measuredSeconds: 12 };
it("fills only the original source without mutating the input", () => {
  const refs = { video: [source] };
  expect(applyReferenceDurationPatches(refs, [patch])?.video?.[0]?.durationSeconds).toBe(12);
  expect(source.durationSeconds).toBeNull();
});
it.each(["url", "assetId", "edgeId", "sourceNodeId"] as const)(
  "ignores a probe after %s changes",
  (key) => {
    const current = { ...source, [key]: "replacement" };
    expect(applyReferenceDurationPatches({ video: [current] }, [patch])?.video?.[0]).toBe(current);
  }
);
it("retains newer duration evidence and removed fields", () => {
  const current = { ...source, durationSeconds: 42 };
  expect(applyReferenceDurationPatches({ video: [current] }, [patch])?.video?.[0]).toBe(current);
  expect(applyReferenceDurationPatches(undefined, [patch])).toBeUndefined();
  expect(applyReferenceDurationPatches({}, [patch])).toEqual({});
  expect(applyReferenceDurationPatches({ video: [] }, [patch])).toEqual({ video: [] });
});
it("repairs invalid durations but never accepts invalid measurements", () => {
  for (const invalid of [0, -1, NaN, Infinity]) {
    expect(hasKnownDuration(invalid)).toBe(false);
    expect(
      applyReferenceDurationPatches({ video: [source] }, [{ ...patch, measuredSeconds: invalid }])
        ?.video?.[0]
    ).toBe(source);
    expect(
      applyReferenceDurationPatches({ video: [{ ...source, durationSeconds: invalid }] }, [
        { ...patch, durationSeconds: invalid },
      ])?.video?.[0]?.durationSeconds
    ).toBe(12);
  }
});

it.each(["constructor", "__proto__", "toString"])(
  "ignores an absent reference field named %s",
  (field) => {
    const refs = { video: [source] };
    expect(applyReferenceDurationPatches(refs, [{ ...patch, field }])).toEqual(refs);
  }
);
it("still updates an explicitly stored prototype-named field", () => {
  const refs = Object.fromEntries([["__proto__", [source]]]);
  const next = applyReferenceDurationPatches(refs, [{ ...patch, field: "__proto__" }]);
  expect(next?.["__proto__"]?.[0]?.durationSeconds).toBe(12);
});
