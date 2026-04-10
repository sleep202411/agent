import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createAlibaba } from '@ai-sdk/alibaba';
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

  private readonly aiProvider = process.env.AI_PROVIDER || 'alibaba';

  private readonly alibabaProvider = createAlibaba({
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
      // Disable content moderation for staging / production-com
      if (process.env.DISABLE_CONTENT_MODERATION === 'true' && init) {
        const headers = new Headers(init.headers);
        headers.set(
          'X-DashScope-DataInspection',
          '{"input":"disable","output":"disable"}',
        );
        init = { ...init, headers };
      }
      return fetch(url, init);
    },
  });

  private readonly deepseekProvider = createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com',
  });

  getModel(modelId?: string): LanguageModelV3 {
    if (this.aiProvider === 'deepseek') {
      const id = modelId || process.env.AI_MODEL || 'deepseek-chat';
      this.logger.log(`Using DeepSeek provider, model=${id}`);
      return this.deepseekProvider.chat(id);
    }
    const id = modelId || process.env.AI_MODEL || 'qwen-plus';
    return this.alibabaProvider(id);
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

    const files = this.findSkillFiles(skillsDir);
    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf-8');
      const { data, content } = matter(raw);
      // Derive name from frontmatter or filename (e.g. screenplay_complete.skill.md → screenplay_complete)
      const name =
        (data.name as string | undefined) ||
        path.basename(file).replace(/\.skill\.md$/, '');
      this.skills.set(name, {
        metadata: {
          name,
          description: data.description as string | undefined,
          model: data.model as string | undefined,
          temperature: data.temperature as number | undefined,
        },
        systemPrompt: content.trim(),
      });
    }

    this.logger.log(
      `Loaded ${this.skills.size} skills from ${files.length} files`,
    );
  }

  private findSkillFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.findSkillFiles(fullPath));
      } else if (entry.name.endsWith('.skill.md')) {
        results.push(fullPath);
      }
    }
    return results;
  }
}
