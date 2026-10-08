import { MediaGovernancePanel } from "@/components/admin/media/media-governance-panel";
import { requireAdminPagePermission } from "@/lib/admin-content-permission";
import { fetchAdminMediaInitial, type AdminMediaView } from "@/lib/admin-media";
import { currentAdminSite } from "@/lib/admin-sites";

export async function MediaRoute({ view }: { view: AdminMediaView }) {
  await requireAdminPagePermission("media.read");
  const [site, initialData] = await Promise.all([currentAdminSite(), fetchAdminMediaInitial(view)]);
  return (
    <MediaGovernancePanel
      view={view}
      siteLabel={site.shortLabel}
      databaseLabel={site.databaseLabel}
      initialData={initialData}
    />
  );
}
