import type { Metadata } from "next";
import { getNarrativePlayable } from "@/src/features/narrative/narrative-games";
import { NarrativePlayer } from "../_components/narrative-player";
import { IpNarrativePlayer } from "../_components/ip-narrative-player";
import { BetaNotice } from "../_components/beta-notice";

export const metadata: Metadata = {
  title: "Play",
  description: "Play a FizzDragon interactive story.",
};

export default async function NarrativePlayPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // The legacy hardcoded demo keeps its baked player; any other id is an IP →
  // the IP-direct player (enter/play-turn generate the story live).
  const demo = getNarrativePlayable(id);
  if (demo) {
    return <NarrativePlayer storyId={demo.id} />;
  }
  return (
    <>
      <IpNarrativePlayer ipId={id} />
      <BetaNotice />
    </>
  );
}
