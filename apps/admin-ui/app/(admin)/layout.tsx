import { redirect } from "next/navigation";
import { AdminSessionBoundary } from "@/components/admin/admin-session-boundary";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  return (
    <AdminSessionBoundary
      scopeKey={JSON.stringify([session.site.key, session.user.id, session.session.id])}
    >
      <AdminShell session={session}>{children}</AdminShell>
    </AdminSessionBoundary>
  );
}
