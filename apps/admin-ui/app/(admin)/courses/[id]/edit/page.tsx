import { CourseEditor } from "@/components/admin/courses/course-editor";
import { fetchAdminCourseDetail } from "@/lib/admin-courses";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function CourseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, detail] = await Promise.all([getAdminSession(), fetchAdminCourseDetail(id)]);

  return (
    <CourseEditor
      course={detail.data}
      loadError={detail.error}
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
    />
  );
}
