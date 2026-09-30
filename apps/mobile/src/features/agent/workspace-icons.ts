export const workspaceIconPresets = [
  "aurora",
  "sunset",
  "ocean",
  "lime",
  "magenta",
  "slate",
] as const;
export type WorkspaceIconPreset = (typeof workspaceIconPresets)[number];
export function workspaceIconUrl(preset: WorkspaceIconPreset, region: "global" | "cn") {
  const origin = region === "cn" ? "https://studio.fizzspace.cn" : "https://studio.fizzdragon.com";
  return `${origin}/team-icons/${preset}.svg`;
}
