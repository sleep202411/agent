import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

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

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private readonly skills = new Map<string, Skill>();

  onModuleInit() {
    this.loadSkills();
  }

  private readonly provider = createOpenAI({
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKey: process.env.ALIBABA_API_KEY,
  });

  getModel(modelId?: string): LanguageModelV3 {
    const id = modelId || process.env.AI_MODEL || 'qwen-plus';
    return this.provider(id) as LanguageModelV3;
  }

  getSkill(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(
        `Skill "${name}" not found. Available: ${[...this.skills.keys()].join(', ')}`,
      );
    }
    return skill;
  }

  private loadSkills() {
    const skillsDir = path.join(__dirname, 'skills');
    if (!fs.existsSync(skillsDir)) {
      this.logger.warn(`Skills directory not found: ${skillsDir}`);
      return;
    }

    const files = fs
      .readdirSync(skillsDir)
      .filter((f) => f.endsWith('.skill.md'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
      const { data, content } = matter(raw);
      if (!data.name) {
        this.logger.warn(
          `Skill file "${file}" missing "name" in frontmatter, skipping`,
        );
        continue;
      }
      this.skills.set(data.name as string, {
        metadata: {
          name: data.name as string,
          description: data.description as string | undefined,
          model: data.model as string | undefined,
          temperature: data.temperature as number | undefined,
        },
        systemPrompt: content.trim(),
      });
    }

    this.logger.log(
      `Loaded ${this.skills.size} skills: ${[...this.skills.keys()].join(', ')}`,
    );
  }
}
