import { grantsAdminAccess } from "@/lib/admin-capability";
import { requireAdminPagePermission } from "@/lib/admin-content-permission";
import { AiActorsPage } from "@/components/admin/ai-actors/ai-actors-page";

export default async function Page() {
  const session = await requireAdminPagePermission("ai_actors.read");
  return <AiActorsPage canWrite={grantsAdminAccess(session.user, "ai_actors.write")} />;
}
