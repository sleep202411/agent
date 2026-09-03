import { decodeUserId } from "@repo/shared";
import { NextRequest } from "next/server";
import type {
  CourseLocaleCode,
  CourseLocaleContent,
  CourseVideoLocaleContent,
} from "@/components/admin/courses/types";
import {
  deleteAdminCourse,
  fetchAdminCourseDetail,
  saveAdminCourse,
  type AdminCourseSaveInput,
} from "@/lib/admin-courses";
import { getAdminSession } from "@/lib/admin-session";

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
};

function toSaveInput(body: SaveBody): AdminCourseSaveInput {
  if (!body.localized) throw new Error("localized 必填。");
  const instructorUserIds = (body.instructorUserIds ?? [])
    .map((id) => {
      const decoded = decodeUserId(String(id));
      const n = Number(decoded);
      if (!Number.isFinite(n)) throw new Error(`无效讲师 ID：${id}`);
      return n;
    })
    .filter((n, index, all) => all.indexOf(n) === index);

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
  };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const result = await fetchAdminCourseDetail(id);
  if (result.error || !result.data) {
    return Response.json({ error: result.error ?? "加载课程失败。" }, { status: 502 });
  }
  return Response.json(result.data);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
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
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
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
