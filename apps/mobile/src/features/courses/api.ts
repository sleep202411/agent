import { z } from "zod";
import { api } from "@/lib/api-client";
import { appEnv, resolveAssetUrl } from "@/config";

const idSchema = z.number().int().positive().safe();
const localeSchema = z.enum(["en-US", "zh-CN", "zh-HK"]);
const text = z
  .string()
  .nullish()
  .transform((value) => value ?? "");
export type CourseType = 1 | 2 | 3;
export const courseTypeLabels = {
  1: "courses.typeRequired",
  2: "courses.typeMaster",
  3: "courses.typeSkill",
} as const;
// Match the public Web catalogue: older/unclassified courses are master classes.
function courseType(value: unknown): CourseType {
  const number = typeof value === "string" || typeof value === "number" ? Number(value) : 0;
  return number === 1 || number === 2 || number === 3 ? number : 2;
}
const courseSchema = z.object({
  id: idSchema,
  type: z.unknown().transform(courseType),
  title: z.string(),
  description: text,
  updateTime: text,
  coverUrl: text,
  videoCount: z.number().int().nonnegative().nullish(),
  instructors: z
    .array(z.object({ userId: idSchema, nickName: text }))
    .nullish()
    .transform((value) => value ?? []),
});
const lessonSchema = z.object({
  id: idSchema,
  title: z.string(),
  sortOrder: z
    .number()
    .nullish()
    .transform((value) => value ?? 0),
  coverUrl: text,
});
const detailSchema = courseSchema.extend({ videos: z.array(lessonSchema) });
export type Course = z.infer<typeof courseSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type CourseDetail = z.infer<typeof detailSchema>;
export const courseCover = (path: string) =>
  path ? resolveAssetUrl(path, appEnv.assets.bannerBaseUrl) : undefined;

export function validCourseId(id: string) {
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
}
function uniqueIds(items: { id: number }[]) {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error("Invalid course response: duplicate identifiers.");
}
export async function listCourses(locale: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = z.array(courseSchema).parse(
    await api.get("/project/courses", {
      service: "content",
      params: { locale: localeSchema.parse(locale) },
      signal,
    })
  );
  signal.throwIfAborted();
  uniqueIds(result);
  return result;
}
export async function getCourse(id: string, locale: string, signal: AbortSignal) {
  if (!validCourseId(id)) throw new Error("Invalid course identifier.");
  signal.throwIfAborted();
  const result = detailSchema.parse(
    await api.get(`/project/courses/${id}`, {
      service: "content",
      params: { locale: localeSchema.parse(locale) },
      signal,
    })
  );
  signal.throwIfAborted();
  if (result.id !== Number(id)) throw new Error("Invalid course response: identifier mismatch.");
  uniqueIds(result.videos);
  return result;
}
export async function getLessonUrl(id: number, locale: string, signal: AbortSignal) {
  idSchema.parse(id);
  signal.throwIfAborted();
  const result = await api.post<string>(`/project/courses/videos/${id}/play-url`, {
    service: "content",
    params: { locale: localeSchema.parse(locale) },
    signal,
  });
  signal.throwIfAborted();
  return result;
}
export function orderedLessons(videos: Lesson[]) {
  return [...videos].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

const mappingSchema = z.object({
  courseId: z.string(),
  certificate: z.object({ id: idSchema, name: z.string().min(1), type: z.literal(4) }).nullable(),
});
export async function getCourseCertificate(id: string, signal: AbortSignal) {
  if (!validCourseId(id)) throw new Error("Invalid course identifier.");
  signal.throwIfAborted();
  const result = mappingSchema.parse(
    await api.get(`/academy/course-certificates/${id}`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  signal.throwIfAborted();
  if (result.courseId !== id) throw new Error("Invalid Academy course mapping response.");
  return result;
}
