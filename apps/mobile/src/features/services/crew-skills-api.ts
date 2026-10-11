import { z } from "zod";
import { api } from "@/lib/api-client";
const skill = z.string().trim().min(1).max(64);
export const requiredSkillsSchema = z
  .array(skill)
  .max(20)
  .refine((items) => new Set(items).size === items.length, "Duplicate required skills");
export function sameSkills(a: string[] = [], b: string[] = []) {
  return a.length === b.length && a.every((item) => b.includes(item));
}
export async function fetchCrewSkills(signal: AbortSignal) {
  const result = z
    .object({
      skills: z
        .array(skill)
        .refine((items) => new Set(items).size === items.length, "Duplicate catalog skills"),
    })
    .parse(await api.get("/crew-qualification-catalog", { service: "aurora", signal }));
  return result.skills;
}
