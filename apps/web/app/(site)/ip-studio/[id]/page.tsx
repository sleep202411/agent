import { IpStudioWorkbench } from "./_components/ip-studio-workbench";
import { toCanonicalIpId } from "@/src/lib/ip-id";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  // Entry points and old links may carry a legacy Java numeric project id (e.g.
  // /ip-studio/290). The workbench API keys IPs by UUID, so resolve to the
  // migrated PG UUID before handing it to the (UUID-only) data layer.
  return <IpStudioWorkbench ipId={toCanonicalIpId(id)} />;
}
