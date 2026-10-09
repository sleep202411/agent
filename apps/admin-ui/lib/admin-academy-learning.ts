import "server-only";

import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "./admin-api";

export type AdminHomeworkRow = {
  id: string;
  courseId: string;
  courseTitle: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  version: number;
  status: "enrolled" | "submitted" | "revision" | "approved";
  description: string | null;
  assetIds: string[];
  score: number | null;
  feedback: string | null;
  teacherCredits: string;
  priceCredits: string;
  createdAt: string;
};

export type AdminHomeworkPage = {
  items: AdminHomeworkRow[];
  nextCursor: string | null;
  scope: "lecturer" | "operator";
  platformUserId: string | null;
};

export type AdminTeachingIncome = {
  courses: number;
  students: number;
  pending: number;
  earnedCredits: string;
  scope: "lecturer" | "operator";
  platformUserId: string | null;
};

async function authHeaders() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  return adminAuthHeaders(token);
}

export async function loadAdminHomework(status: "submitted" | "all" = "submitted", after?: string) {
  const headers = await authHeaders();
  if (!headers) return { data: null, error: "后台登录已失效。" };
  try {
    const response = await fetch(
      adminApiUrl(
        `/academy/learning/homework?status=${encodeURIComponent(status)}${after ? `&after=${encodeURIComponent(after)}` : ""}`
      ),
      { headers, cache: "no-store", signal: AbortSignal.timeout(15000) }
    );
    return { data: await parseAdminEnvelope<AdminHomeworkPage>(response), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "作业列表加载失败。",
    };
  }
}

export async function loadAdminTeachingIncome() {
  const headers = await authHeaders();
  if (!headers) return { data: null, error: "后台登录已失效。" };
  try {
    const response = await fetch(adminApiUrl("/academy/learning/income"), {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    return { data: await parseAdminEnvelope<AdminTeachingIncome>(response), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "授课收入加载失败。",
    };
  }
}
