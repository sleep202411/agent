import { beforeEach, expect, it, vi } from "vitest";
import {
  readCoursePercent,
  readSelectedLesson,
  saveSelectedLesson,
  saveCoursePercent,
} from "./course-history";
import { saveLessonProgress } from "./lesson-progress";
const h = vi.hoisted(() => ({ data: new Map<string, string>() }));
vi.mock("@/lib/persistent-storage", () => ({
  getStoredString: async (key: string) => h.data.get(key) ?? null,
  setStoredString: async (key: string, value: string) => {
    h.data.set(key, value);
  },
}));
beforeEach(() => h.data.clear());
it("resumes the last selected lesson and falls back if it was removed", async () => {
  await saveSelectedLesson("alice", 2);
  expect(await readSelectedLesson("alice", [1, 2])).toBe(2);
  expect(await readSelectedLesson("alice", [1, 3])).toBe(1);
  expect(await readSelectedLesson("bob", [1, 2])).toBe(1);
  expect(await readSelectedLesson("alice", [])).toBeUndefined();
});
it("averages all published lessons including unwatched ones without awarding completion", async () => {
  await saveLessonProgress("a", { currentTime: 50, duration: 100 });
  await saveLessonProgress("b", { currentTime: 100, duration: 100 });
  await saveCoursePercent("course", ["a", "b", "c"]);
  expect(await readCoursePercent("course")).toBe(50);
  expect(await readCoursePercent("another-account")).toBeNull();
});
it("ignores corrupt aggregate progress", async () => {
  h.data.set("course.percent", "NaN");
  expect(await readCoursePercent("course")).toBeNull();
});
