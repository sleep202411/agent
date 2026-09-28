import { getAdminSession } from "@/lib/admin-session";
import { ComputeRequestsPanel } from "@/components/admin/crews/compute-requests-panel";

export default async function ComputeRequestsPage() {
  const session = await getAdminSession();
  if (
    !session?.user.permissions.includes("crew.compute.review") ||
    !session.user.roleKeys.includes("master_financial_controller")
  ) {
    return <p role="alert">Master Financial Controller permission is required.</p>;
  }

  return (
    <ComputeRequestsPanel key={`${session.site.key}:${session.user.id}:${session.session.id}`} />
  );
}
