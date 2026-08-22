import type { StoryProductionState } from "@/lib/story-production-api";

/** Copy is derived only from authoritative chapter state, never from a
 * proposal's speculative downstream plan. */
export function storyApplyingActivityKey(
  production: StoryProductionState | null,
  baseScriptSequence: number | null
): "savingScript" | "buildingProduction" | "finalizingProduction" {
  if (
    baseScriptSequence === null ||
    production?.script.status !== "current" ||
    production.script.sequence === null ||
    production.script.sequence <= baseScriptSequence
  ) {
    return "savingScript";
  }
  return production.ready ? "finalizingProduction" : "buildingProduction";
}
