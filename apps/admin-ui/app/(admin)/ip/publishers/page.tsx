import { IpPublishersPanel } from "@/components/admin/ip/publishers-panel";
import { fetchAdminIpPublishers } from "@/lib/admin-ip-commerce";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpPublishersPage() {
  const session = await getAdminSession();
  const publishers = await fetchAdminIpPublishers();

  return (
    <IpPublishersPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialPublishers={publishers.data}
      initialError={publishers.error}
    />
  );
}
