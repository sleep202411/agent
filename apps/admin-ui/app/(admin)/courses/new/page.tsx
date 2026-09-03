import { redirect } from "next/navigation";
import { createAdminCourseDraft } from "@/lib/admin-courses";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

/** Creates a Java draft then redirects into the editor. */
export default async function NewCoursePage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  let id: string;
  try {
    id = await createAdminCourseDraft();
  } catch {
    redirect("/courses?createError=1");
  }
  redirect(`/courses/${id}/edit`);
}
