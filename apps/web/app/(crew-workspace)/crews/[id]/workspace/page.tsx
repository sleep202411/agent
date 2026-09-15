"use client";
import { useParams } from "next/navigation";
import { CrewWorkspace } from "@/app/(site)/crews/_components/crew-workspace";
export default function CrewWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  return <CrewWorkspace key={id} id={id} />;
}
