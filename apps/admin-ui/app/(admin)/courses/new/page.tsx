import { redirect } from "next/navigation";
import { createAdminCourseDraft } from "@/lib/admin-courses";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

/** Creates a Java draft then redirects into the editor. */
export default async function NewCoursePage() {
  await requireContentPagePermission("courses.write");

  let id: string;
  try {
    id = await createAdminCourseDraft();
  } catch {
    redirect("/courses?createError=1");
  }
  redirect(`/courses/${id}/edit`);
}
