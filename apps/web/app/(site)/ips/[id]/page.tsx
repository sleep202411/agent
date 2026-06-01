import { IpPublicDetail } from "./_components/ip-public-detail";

export default async function IPDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <IpPublicDetail ipId={id} />;
}
