import { getAdminSession } from "@/lib/admin-session";
import { CaseOperationsPanel } from "@/components/admin/crews/case-operations-panel";
export default async function CaseOperationsPage() {
  const session = await getAdminSession();
  if (
    !session?.user.permissions.includes("crew.manage") ||
    !["all", session.site.key].includes(session.user.siteScope)
  ) {
    return (
      <p role="alert">
        Crew administration permission for this site is required. / 需要本站剧组管理权限。 /
        需要本站劇組管理權限。
      </p>
    );
  }
  return (
    <CaseOperationsPanel
      key={`${session.site.key}:${session.user.id}:${session.session.id}`}
      adminId={session.user.id}
      site={session.site.label}
    />
  );
}
