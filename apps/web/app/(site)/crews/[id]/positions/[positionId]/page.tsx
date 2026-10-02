"use client";
import { useParams } from "next/navigation";
import { OpeningDetails } from "../../../_components/opening-details";
export default function OpeningPage() {
  const { id, positionId } = useParams<{ id: string; positionId: string }>();
  return <OpeningDetails id={id} positionId={positionId} />;
}
