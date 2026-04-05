import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createAlibaba } from '@ai-sdk/alibaba';
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

  private readonly provider = createAlibaba({
    apiKey: process.env.ALIBABA_API_KEY,
    baseURL: process.env.ALIBABA_BASE_URL,
    fetch: async (
      url: string | URL | globalThis.Request,
      init?: RequestInit,
    ) => {
      if (typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as {
          messages?: {
            role: string;
            content: unknown;
            tool_calls?: unknown;
          }[];
        };
        if (body.messages) {
          for (let i = 0; i < body.messages.length; i++) {
            const m = body.messages[i];
            this.logger.log(
              `  API msg[${i}]: role=${m.role} content_type=${m.content === null ? 'null' : typeof m.content} isArray=${Array.isArray(m.content)} tool_calls=${!!m.tool_calls} content=${JSON.stringify(m.content).slice(0, 200)}`,
            );
          }
          // Fix: DashScope rejects null content on assistant messages
          for (const m of body.messages) {
            if (m.role === 'assistant' && m.content == null) {
              m.content = '';
            }
          }
          init = { ...init, body: JSON.stringify(body) };
        }
      }
      return fetch(url, init);
    },
  });

  getModel(modelId?: string): LanguageModelV3 {
    const id = modelId || process.env.AI_MODEL || 'qwen-plus';
    return this.provider(id);
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
