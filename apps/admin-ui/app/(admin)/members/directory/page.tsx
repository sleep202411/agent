import { MemberDirectoryPanel } from "@/components/admin/billing/member-directory-panel";
import { requireAdminPagePermission } from "@/lib/admin-content-permission";

export default async function MemberDirectoryPage() {
  const session = await requireAdminPagePermission("user.read");
  return (
    <MemberDirectoryPanel
      canReadWorkspaces={session.user.permissions.includes("billing.read")}
      canWriteBilling={session.user.permissions.includes("billing.write")}
    />
  );
}
