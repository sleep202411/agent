import { notFound } from "next/navigation";
import { IpPublicDetail } from "../../ips/[id]/_components/ip-public-detail";

export default async function IpRoomPage({ params }: { params: Promise<{ roomNumber: string }> }) {
  const { roomNumber } = await params;
  if (!/^[1-9][0-9]{0,18}$/.test(roomNumber)) notFound();
  return <IpPublicDetail ipReference={roomNumber} />;
}
