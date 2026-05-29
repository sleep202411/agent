import { AccountSettingsPanel } from "@/components/admin/account-settings-panel";
import { getAdminSession } from "@/lib/admin-session";

export default async function AccountPage() {
  const session = await getAdminSession();
  if (!session) return null;
  return <AccountSettingsPanel session={session} />;
}
