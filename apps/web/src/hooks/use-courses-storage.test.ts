// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  readLatestStoredEpisodeProgress,
  readStoredEpisodeProgress,
  writeStoredEpisodeID,
  writeStoredEpisodeProgress,
} from "./use-courses";
vi.mock("@/src/services/courses", () => ({}));
vi.mock("@/src/i18n/i18n", () => ({}));
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it("keeps reads and playback writes usable when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(readLatestStoredEpisodeProgress(1, "stable")).toBeNull();
  expect(() =>
    writeStoredEpisodeProgress(1, { currentTime: 5, duration: 10 }, "stable")
  ).not.toThrow();
  expect(() => writeStoredEpisodeID(1, 2, "episode", "series")).not.toThrow();
});
it("rejects invalid media times without replacing valid saved progress", () => {
  writeStoredEpisodeProgress(1, { currentTime: 5, duration: 10 });
  const before = localStorage.getItem("course_video_progress_1");
  for (const currentTime of [NaN, Infinity, -Infinity])
    writeStoredEpisodeProgress(1, { currentTime, duration: 10 });
  expect(localStorage.getItem("course_video_progress_1")).toBe(before);
  for (const value of ["null", "{}", '{"currentTime":null,"duration":10}', "broken"]) {
    localStorage.setItem("course_video_progress_2", value);
    expect(readStoredEpisodeProgress(2)).toBeNull();
  }
});
it("prefers timestamped progress over undated legacy records", () => {
  localStorage.setItem(
    "course_video_progress_1",
    JSON.stringify({ currentTime: 8, duration: 10, updatedAt: 100 })
  );
  localStorage.setItem(
    "course_video_progress_stable",
    JSON.stringify({ currentTime: 1, duration: 10 })
  );
  expect(readLatestStoredEpisodeProgress(1, "stable")?.currentTime).toBe(8);
  expect(readStoredEpisodeProgress("stable")?.updatedAt).toBe(0);
});
it("still saves the stable key when the numeric-key write fails", () => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "course_video_progress_1") throw new Error("quota");
    setItem.call(this, key, value);
  });
  writeStoredEpisodeProgress(1, { currentTime: 6, duration: 10 }, "stable");
  expect(readLatestStoredEpisodeProgress(1, "stable")?.currentTime).toBe(6);
});
it("does not persist invalid episode identifiers", () => {
  for (const id of [0, -1, 1.5, NaN, Infinity]) writeStoredEpisodeID(1, id);
  expect(localStorage.length).toBe(0);
  writeStoredEpisodeID(1, 2);
  expect(localStorage.getItem("course_progress_1")).toBe("2");
});
