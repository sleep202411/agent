import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NarrativeDemoPlayer } from "@/app/narrative-demo/_components/narrative-demo-player";
import { getNarrativePlayable } from "@/src/features/narrative/narrative-games";

export const metadata: Metadata = {
  title: "Play",
  description: "Play a FizzDragon interactive story.",
};

export default async function NarrativePlayPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const playable = getNarrativePlayable(id);

  if (!playable) {
    notFound();
  }

  return <NarrativeDemoPlayer />;
}
