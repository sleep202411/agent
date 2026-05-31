import { IpStudioWorkbench } from "./_components/ip-studio-workbench";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <IpStudioWorkbench ipId={id} />;
}
