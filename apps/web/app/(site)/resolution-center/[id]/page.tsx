"use client";
import { useParams } from "next/navigation";
import { PrivateCasesScreen } from "../../crews/_components/private-cases";
export default function ResolutionCase() {
  const { id } = useParams<{ id: string }>();
  return <PrivateCasesScreen caseId={id} />;
}
