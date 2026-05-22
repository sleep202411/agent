"use client";

import { useParams } from "next/navigation";
import { CreatorCenter } from "@/app/(site)/creators/_components/center/creator-center";

export default function CreatorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  return <CreatorCenter creatorId={id} />;
}
