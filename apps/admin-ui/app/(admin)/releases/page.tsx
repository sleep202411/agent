import { ReleasesPanel } from "@/components/admin/releases/releases-panel";
import { fetchAdminAppReleases } from "@/lib/admin-app-releases";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
  const session = await getAdminSession();
  const releases = await fetchAdminAppReleases();

  return (
    <ReleasesPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={releases.data}
      initialError={releases.error}
    />
  );
}
