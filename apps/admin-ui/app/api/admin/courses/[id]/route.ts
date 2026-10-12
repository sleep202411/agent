import { decodeUserId } from "@repo/shared/user-id-codec";
import { NextRequest } from "next/server";
import type {
  CourseLocaleCode,
  CourseLocaleContent,
  CourseType,
  CourseVideoLocaleContent,
} from "@/components/admin/courses/types";
import { DEFAULT_COURSE_TYPE } from "@/components/admin/courses/types";
import {
  deleteAdminCourse,
  fetchAdminCourseDetail,
  saveAdminCourse,
  type AdminCourseSaveInput,
} from "@/lib/admin-courses";
import { contentPermissionResponse } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

type SaveBody = {
  localized?: Record<CourseLocaleCode, CourseLocaleContent>;
  videos?: Array<{
    videoKey?: string;
    coverUrl?: string;
    sortOrder?: number;
    localized?: Record<CourseLocaleCode, CourseVideoLocaleContent>;
  }>;
  /** Encoded public ids or raw numeric strings from the editor. */
  instructorUserIds?: Array<string | number>;
  certificateId?: number | null;
  priceCredits?: string | number | null;
  enrollmentEnabled?: boolean;
  instructorShares?: Array<{ userId?: string | number; shareBps?: number }>;
  type?: number | string | null;
};

function toUserId(id: string | number): number {
  const decoded = decodeUserId(String(id));
  const n = Number(decoded);
  if (!Number.isFinite(n)) throw new Error(`无效讲师 ID：${id}`);
  return n;
}

function toSaveInput(body: SaveBody): AdminCourseSaveInput {
  if (!body.localized) throw new Error("localized 必填。");
  const instructorUserIds = (body.instructorUserIds ?? [])
    .map(toUserId)
    .filter((n, index, all) => all.indexOf(n) === index);
  const instructorShares = (body.instructorShares ?? [])
    .map((item) => {
      if (item.userId == null || item.shareBps == null) return null;
      if (!Number.isInteger(item.shareBps) || item.shareBps < 0 || item.shareBps > 10000) {
        throw new Error("分润比例须在 0% 到 100% 之间。");
      }
      return { userId: toUserId(item.userId), shareBps: item.shareBps };
    })
    .filter((item): item is { userId: number; shareBps: number } => item !== null);
  if (instructorShares.some((item) => !instructorUserIds.includes(item.userId))) {
    throw new Error("分润只能分配给课程讲师。");
  }
  if (instructorShares.reduce((sum, item) => sum + item.shareBps, 0) > 10000) {
    throw new Error("讲师分润合计不能超过 100%。");
  }
  const price =
    body.priceCredits == null || body.priceCredits === "" ? 0 : Number(body.priceCredits);
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(price)) {
    throw new Error("总费用须为非负整数。");
  }
  const type = parseSaveType(body.type);

  return {
    localized: body.localized,
    videos: (body.videos ?? []).map((video, index) => ({
      videoKey: video.videoKey?.trim() ?? "",
      coverUrl: video.coverUrl?.trim() ?? "",
      sortOrder: video.sortOrder ?? index + 1,
      sectionId: null,
      localized: video.localized ?? {
        "zh-CN": { title: "" },
        "en-US": { title: "" },
        "zh-HK": { title: "" },
      },
    })),
    instructorUserIds,
    certificateId: body.certificateId ?? null,
    priceCredits: price,
    enrollmentEnabled: body.enrollmentEnabled === true,
    instructorShares,
    type,
  };
}

function parseSaveType(value: unknown): CourseType {
  if (value == null || value === "") return DEFAULT_COURSE_TYPE;
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  throw new Error("课程分类须为推荐必修课、大师课或技能课。");
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await contentPermissionResponse("courses.read");
  if (denied) return denied;
  const { id } = await params;
  const result = await fetchAdminCourseDetail(id);
  if (result.error || !result.data) {
    return Response.json({ error: result.error ?? "加载课程失败。" }, { status: 502 });
  }
  return Response.json(result.data);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await contentPermissionResponse("courses.write");
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = (await request.json()) as SaveBody;
    await saveAdminCourse(id, toSaveInput(body));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "保存课程失败。" },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await contentPermissionResponse("courses.write");
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteAdminCourse(id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "删除课程失败。" },
      { status: 502 }
    );
  }
}
