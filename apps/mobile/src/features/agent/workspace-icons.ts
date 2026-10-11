import { z } from "zod";
export const workspaceUploadedIcon = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  });
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
