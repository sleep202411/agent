import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

export interface SkillMetadata {
  name: string;
  description?: string;
  model?: string;
  temperature?: number;
}

export interface Skill {
  metadata: SkillMetadata;
  systemPrompt: string;
}

const skills = new Map<string, Skill>();
let loaded = false;

function parse(raw: string, filename: string): Skill {
  const { data, content } = matter(raw);
  if (!data.name) {
    throw new Error(`Skill file "${filename}" is missing required "name" in frontmatter`);
  }
  return {
    metadata: {
      name: data.name as string,
      description: data.description as string | undefined,
      model: data.model as string | undefined,
      temperature: data.temperature as number | undefined,
    },
    systemPrompt: content.trim(),
  };
}

function loadSkills() {
  if (loaded) return;

  const skillsDir = path.join(process.cwd(), "src/lib/agent/skills");
  if (!fs.existsSync(skillsDir)) {
    console.warn(`[SkillLoader] Skills directory not found: ${skillsDir}`);
    loaded = true;
    return;
  }

  const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".skill.md"));
  for (const file of files) {
    const filePath = path.join(skillsDir, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const skill = parse(raw, file);
    skills.set(skill.metadata.name, skill);
  }

  console.log(`[SkillLoader] Loaded ${skills.size} skills: ${[...skills.keys()].join(", ")}`);
  loaded = true;
}

export function getSkill(name: string): Skill {
  loadSkills();
  const skill = skills.get(name);
  if (!skill) {
    throw new Error(`Skill "${name}" not found. Available: ${[...skills.keys()].join(", ")}`);
  }
  return skill;
}
