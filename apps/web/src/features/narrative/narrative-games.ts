export type NarrativePlayableStatus = "draft" | "published";

export type NarrativePlayable = {
  id: string;
  sourceIpId: string;
  status: NarrativePlayableStatus;
  coverSrc: string;
  href: string;
  statKeys: Array<"aiRuntime" | "plotNodes" | "clues" | "endings">;
  tagKeys: Array<"textRpg" | "mystery" | "aiRuntime">;
  translationKey: "story36Hours";
};

export const PRIMARY_NARRATIVE_IP_ID = "2eddb763-a259-52d5-bef4-a7ade100c57c";
export const PRIMARY_NARRATIVE_PLAYABLE_ID = "story_36_hours_case";

export const NARRATIVE_PLAYABLES = [
  {
    id: PRIMARY_NARRATIVE_PLAYABLE_ID,
    sourceIpId: PRIMARY_NARRATIVE_IP_ID,
    status: "draft",
    coverSrc: "/narrative-demo/videos/plot-a-enter-elite-school.jpg",
    href: `/play/${PRIMARY_NARRATIVE_PLAYABLE_ID}`,
    statKeys: ["aiRuntime", "plotNodes", "clues", "endings"],
    tagKeys: ["textRpg", "mystery", "aiRuntime"],
    translationKey: "story36Hours",
  },
] satisfies NarrativePlayable[];

export function getNarrativePlayable(id: string) {
  return NARRATIVE_PLAYABLES.find((playable) => playable.id === id) ?? null;
}

export function getNarrativePlayablesForIp(ipId: string) {
  return NARRATIVE_PLAYABLES.filter((playable) => playable.sourceIpId === ipId);
}
