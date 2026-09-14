import { getAdminSession } from "@/lib/admin-session";
import { DeliveryCatalogPanel } from "@/components/admin/crews/delivery-catalog-panel";
export default async function DeliveryCatalogPage() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("crew.manage"))
    return <p role="alert">Crew administration permission is required.</p>;
  return (
    <DeliveryCatalogPanel key={`${session.site.key}:${session.user.id}:${session.session.id}`} />
  );
}
