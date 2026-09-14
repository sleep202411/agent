import { MemberDirectoryPanel } from "@/components/admin/billing/member-directory-panel";
import { getAdminSession } from "@/lib/admin-session";

export default async function MemberDirectoryPage() {
  const session = await getAdminSession();
  return (
    <MemberDirectoryPanel
      canReadWorkspaces={session?.user.permissions.includes("billing.read") ?? false}
      canWriteBilling={session?.user.permissions.includes("billing.write") ?? false}
    />
  );
}
