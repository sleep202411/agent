import { getStoredString, setStoredString } from "@/lib/persistent-storage";
import { readLessonProgress } from "./lesson-progress";

const pending = new Map<string, Promise<void>>();
function enqueue(key: string, action: () => Promise<void>) {
  const operation = (pending.get(key) ?? Promise.resolve()).then(action).catch(() => {});
  pending.set(key, operation);
  void operation.then(() => {
    if (pending.get(key) === operation) pending.delete(key);
  });
  return operation;
}
function write(key: string, value: string) {
  return enqueue(key, () => setStoredString(key, value));
}
async function read(key: string) {
  try {
    await pending.get(key);
    return await getStoredString(key);
  } catch {
    return null;
  }
}
export async function readSelectedLesson(key: string, ids: number[]) {
  const id = Number(await read(`${key}.selected`));
  return ids.includes(id) ? id : ids[0];
}
export function saveSelectedLesson(key: string, id: number) {
  return write(`${key}.selected`, String(id));
}
export async function readCoursePercent(key: string) {
  const raw = await read(`${key}.percent`);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
export function saveCoursePercent(key: string, lessonKeys: string[]) {
  if (!lessonKeys.length) return Promise.resolve();
  return enqueue(`${key}.percent`, async () => {
    const progress = await Promise.all(lessonKeys.map(readLessonProgress));
    const ratio = progress.reduce(
      (sum, value) => sum + (value ? value.currentTime / value.duration : 0),
      0
    );
    await setStoredString(`${key}.percent`, String(Math.round((100 * ratio) / lessonKeys.length)));
  });
}
