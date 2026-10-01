"use client";
import { useParams } from "next/navigation";
import { CrewSetup } from "../../_components/crew-setup";
export default function CrewSetupPage() {
  const { id } = useParams<{ id: string }>();
  return <CrewSetup crewId={id} />;
}
