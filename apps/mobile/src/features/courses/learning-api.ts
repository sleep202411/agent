import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().uuid();
const courseId = z.string().regex(/^[1-9]\d*$/);
const amount = z.string().regex(/^\d+$/);
const enrollment = z.object({
  id,
  courseId,
  studentId: z.string(),
  teacherId: z.string(),
  version: z.number().int().positive(),
  priceCredits: amount,
  teacherCredits: amount,
  instructorShares: z.array(z.object({ teacherId: z.string(), credits: amount })).nullish(),
  status: z.enum(["enrolled", "submitted", "revision", "approved"]),
  description: z.string().nullable(),
  assetIds: z.array(id),
  score: z.number().nullable(),
  feedback: z.string().nullable(),
  badgeIssuedAt: z.string().nullable(),
  createdAt: z.string(),
  studentName: z.string().optional(),
  courseTitle: z.string().optional(),
});
const offering = z.object({
  version: z.number().int().positive(),
  enabled: z.boolean(),
  priceCredits: amount,
  teacherId: z.string(),
});
const course = z.object({
  offering: offering.nullable(),
  enrollment: enrollment.nullable(),
  instructor: z.boolean().optional(),
});
const summary = z.object({
  courses: z.number().int().nonnegative(),
  students: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  earnedCredits: amount,
});
const page = z.object({ items: z.array(enrollment), nextCursor: id.nullable() });
export type Enrollment = z.infer<typeof enrollment>;
export type LearningCourse = z.infer<typeof course>;
export type TeachingSummary = z.infer<typeof summary>;
const submit = z.object({
  expectedVersion: z.number().int().positive(),
  description: z.string().trim().min(1).max(10000),
  assetIds: z
    .array(id)
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
});
const review = z.object({
  expectedVersion: z.number().int().positive(),
  decision: z.enum(["approved", "revision"]),
  score: z.number().int().min(0).max(100),
  feedback: z.string().trim().min(1).max(10000),
});
async function request<T>(schema: z.ZodType<T>, path: string, signal: AbortSignal, data?: unknown) {
  const generation = getAuthGeneration();
  signal.throwIfAborted();
  const options = { service: "aurora" as const, signal, retry: false, data };
  const result =
    data === undefined
      ? await api.get(`/academy/learning/${path}`, options)
      : await api.post(`/academy/learning/${path}`, options);
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw new Error("Academy account changed");
  return schema.parse(result);
}
export const learningApi = {
  course: (value: string, signal: AbortSignal) =>
    request(course, `courses/${courseId.parse(value)}`, signal),
  enroll: (value: string, expectedVersion: number, signal: AbortSignal) =>
    request(enrollment, `courses/${courseId.parse(value)}/enroll`, signal, {
      expectedVersion: z.number().int().positive().parse(expectedVersion),
    }),
  submit: (value: string, body: z.infer<typeof submit>, signal: AbortSignal) =>
    request(enrollment, `enrollments/${id.parse(value)}/submit`, signal, submit.parse(body)),
  review: (value: string, body: z.infer<typeof review>, signal: AbortSignal) =>
    request(enrollment, `enrollments/${id.parse(value)}/review`, signal, review.parse(body)),
  summary: (signal: AbortSignal) => request(summary, "teaching/summary", signal),
  teaching: (after: string | null, signal: AbortSignal) =>
    request(page, `teaching${after ? `?after=${id.parse(after)}` : ""}`, signal),
  attachment: (value: string, asset: string, signal: AbortSignal) =>
    request(
      z.object({
        url: z
          .string()
          .url()
          .refine((value) => {
            const url = new URL(value);
            return url.protocol === "https:" && !url.username && !url.password;
          }),
      }),
      `enrollments/${id.parse(value)}/attachments/${id.parse(asset)}`,
      signal
    ),
};
