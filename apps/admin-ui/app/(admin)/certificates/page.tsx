import { CertificatesPanel } from "@/components/admin/certificates/certificate-panel";
import { fetchAdminCertificates } from "@/lib/admin-certificates";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function CertificatesPage() {
  const [session, certificates] = await Promise.all([getAdminSession(), fetchAdminCertificates()]);

  return (
    <CertificatesPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={certificates.data}
      initialError={certificates.error}
    />
  );
}
