import { AiModelOpsPanel } from "@/components/admin/ai-model-ops/ai-model-ops-panel";
import { fetchAdminAiModelOpsView, type AdminAiModelOpsView } from "@/lib/admin-ai-model-ops";
import { getAdminSession } from "@/lib/admin-session";

export async function AiModelOpsRoute({ view }: { view: AdminAiModelOpsView }) {
  const [session, initialData] = await Promise.all([
    getAdminSession(),
    fetchAdminAiModelOpsView(view),
  ]);

  return (
    <AiModelOpsPanel
      view={view}
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={initialData}
    />
  );
}
