"use client";
import { useParams } from "next/navigation";
import { PrivateCasesScreen } from "../../_components/private-cases";
export default function CasePage() {
  const { caseId } = useParams<{ caseId: string }>();
  return <PrivateCasesScreen caseId={caseId} />;
}
