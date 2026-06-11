"use client";

import { useParams } from "next/navigation";
import { decodeUserId } from "@/src/lib/user-id-codec";
import { CreatorCenter } from "@/app/(site)/creators/_components/center/creator-center";

export default function CreatorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeUserId(params?.id ?? "");
  return <CreatorCenter creatorId={id} />;
}
