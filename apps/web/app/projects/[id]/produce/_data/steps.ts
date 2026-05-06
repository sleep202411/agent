/**
 * Produce mode — 3-step pipeline modeled on the Jianying short-drama
 * tool. URL-routed (each step is its own page) so refresh / back /
 * forward / deep-links all behave naturally:
 *   /projects/[id]/produce/script
 *   /projects/[id]/produce/asset
 *   /projects/[id]/produce/video
 *
 * Step ordering is "story-first": users typically know the plot
 * before they know the cast, so we plan + script BEFORE characters /
 * scenes / props. Step 2 then derives all visual assets from the
 * already-written script (which has explicit character lists, scene
 * headers, props mentioned). Step 3 takes the assets + script and
 * builds storyboards + videos episode-by-episode.
 *
 * Three forced-personas map onto Step 2's internal tabs (character /
 * scene / prop); episode_planner + scriptwriter feed Step 1; story-
 * board_designer feeds Step 3.
 */

export const PRODUCE_STEPS = [
  { key: "script", labelKey: "stepScript", descKey: "stepScriptDescription" },
  { key: "asset", labelKey: "stepAsset", descKey: "stepAssetDescription" },
  { key: "video", labelKey: "stepVideo", descKey: "stepVideoDescription" },
] as const;

export type ProduceStepKey = (typeof PRODUCE_STEPS)[number]["key"];

export const ASSET_TABS = [
  { key: "character", labelKey: "tabCharacter", descKey: "tabCharacterDescription" },
  { key: "scene", labelKey: "tabScene", descKey: "tabSceneDescription" },
  { key: "prop", labelKey: "tabProp", descKey: "tabPropDescription" },
] as const;

export type AssetTabKey = (typeof ASSET_TABS)[number]["key"];
