import assert from "node:assert/strict";
import test from "node:test";
import { JinlingPlayerProfileSchema, keepsakeForJinlingProfile } from "./player-profile";

test("validates the authored Jinling player identity", () => {
  const profile = JinlingPlayerProfileSchema.parse({
    displayName: "沈砚",
    origin: "kin",
    trait: "careful",
  });

  assert.equal(profile.displayName, "沈砚");
  assert.equal(keepsakeForJinlingProfile(profile), "PROP-TOKEN-KIN");
});

test("rejects names beyond the reviewed eight-character limit", () => {
  const result = JinlingPlayerProfileSchema.safeParse({
    displayName: "一二三四五六七八九",
    origin: "weave",
    trait: "heart",
  });

  assert.equal(result.success, false);
});
