import { getAdminSession } from "@/lib/admin-session";
import { ComputeRequestsPanel } from "@/components/admin/crews/compute-requests-panel";

export default async function ComputeRequestsPage() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("crew.compute.review")) {
    return <p role="alert">需要算力审批权限。</p>;
  }

  return (
    <ComputeRequestsPanel key={`${session.site.key}:${session.user.id}:${session.session.id}`} />
  );
}
