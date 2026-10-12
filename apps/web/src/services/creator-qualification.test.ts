import { expect, it } from "vitest";
import { creatorQualificationKind } from "./creator-qualification";
it.each([
  [{ id: 101, type: 1 }, "fd"],
  [{ id: 13 }, "producer"],
  [{ id: 201, type: 4 }, "skill"],
  [{ id: 301, type: 5 }, "partner"],
  [{ id: 12, type: 2 }, null],
  [{ id: 20, type: 3 }, null],
  [{ id: 30, name: "FD I" }, null],
  [{ id: -1, type: 1 }, null],
  [null, null],
  [undefined, null],
])("classifies only assigned creator qualifications: %j", (level, expected) => {
  expect(creatorQualificationKind(level)).toBe(expected);
});
