import { MediaGovernancePanel } from "@/components/admin/media/media-governance-panel";
import { fetchAdminMediaInitial } from "@/lib/admin-media";
import { currentAdminSite } from "@/lib/admin-sites";

export default async function MediaAdminPage() {
  const [site, initialData] = await Promise.all([currentAdminSite(), fetchAdminMediaInitial()]);
  return (
    <MediaGovernancePanel
      siteLabel={site.shortLabel}
      databaseLabel={site.databaseLabel}
      initialData={initialData}
    />
  );
}
