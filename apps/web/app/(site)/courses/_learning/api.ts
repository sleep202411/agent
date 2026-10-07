import { api } from "@/src/lib/api";
export type Enrollment = {
  studentName?: string;
  courseTitle?: string;
  id: string;
  courseId: string;
  studentId: string;
  teacherId: string;
  version: number;
  priceCredits: string;
  teacherCredits: string;
  status: "enrolled" | "submitted" | "revision" | "approved";
  description: string | null;
  assetIds: string[];
  score: number | null;
  feedback: string | null;
  badgeIssuedAt: string | null;
  createdAt: string;
};
export type Offering = {
  version: number;
  enabled: boolean;
  priceCredits: string;
  teacherId: string;
};
export const learningApi = {
  summary: (signal?: AbortSignal) =>
    api.get<{ courses: number; students: number; pending: number; earnedCredits: string }>(
      "/aurora/academy/learning/teaching/summary",
      { signal }
    ),
  course: (courseId: string, signal?: AbortSignal) =>
    api.get<{ offering: Offering | null; enrollment: Enrollment | null }>(
      `/aurora/academy/learning/courses/${encodeURIComponent(courseId)}`,
      { signal }
    ),
  enroll: (courseId: string, expectedVersion: number, signal?: AbortSignal) =>
    api.post<Enrollment>(
      `/aurora/academy/learning/courses/${encodeURIComponent(courseId)}/enroll`,
      { data: { expectedVersion }, signal }
    ),
  submit: (
    id: string,
    body: { expectedVersion: number; description: string; assetIds: string[] },
    signal?: AbortSignal
  ) =>
    api.post<Enrollment>(`/aurora/academy/learning/enrollments/${id}/submit`, {
      data: body,
      signal,
    }),
  review: (
    id: string,
    body: {
      expectedVersion: number;
      decision: "approved" | "revision";
      score: number;
      feedback: string;
    }
  ) => api.post<Enrollment>(`/aurora/academy/learning/enrollments/${id}/review`, { data: body }),
  teaching: (after?: string, signal?: AbortSignal) =>
    api.get<{ items: Enrollment[]; nextCursor: string | null }>(
      "/aurora/academy/learning/teaching",
      { params: { after }, signal }
    ),
  attachment: (id: string, assetId: string) =>
    api.get<{ url: string }>(`/aurora/academy/learning/enrollments/${id}/attachments/${assetId}`),
};
