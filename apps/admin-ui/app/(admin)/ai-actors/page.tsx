import { getAdminSession } from "@/lib/admin-session";
import { AiActorsPage } from "@/components/admin/ai-actors/ai-actors-page";
export default async function Page() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("media.read"))
    return <p className="p-6">Media read permission is required.</p>;
  return <AiActorsPage canWrite={session.user.permissions.includes("media.write")} />;
}
