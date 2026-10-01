import { expect, it } from "vitest";
import { parseTvEntry, tvEntryPath } from "./tv-entry";
const ip = "10000000-0000-4000-8000-000000000001";
const episode = "10000000-0000-4000-8000-000000000002";
it("round trips selected IP and episode without changing playback permissions", () => {
  const path = tvEntryPath(ip, episode);
  expect(
    parseTvEntry(Object.fromEntries(new URL(path, "https://fixture.invalid").searchParams))
  ).toMatchObject({ success: true, data: { ip, episode } });
  expect(tvEntryPath(ip)).toBe(`/tv?ip=${ip}`);
  expect(parseTvEntry({}).success).toBe(true);
});
it.each([{ ip: "bad" }, { episode }, { ip: [ip, ip] }, { ip, episode: "bad" }])(
  "rejects ambiguous or malformed targets %j",
  (params) => {
    expect(parseTvEntry(params).success).toBe(false);
  }
);
