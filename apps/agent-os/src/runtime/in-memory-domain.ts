import { createHash } from "node:crypto";

import type { DomainPort, ToolExecuteResult, ToolExecutionContext } from "@repo/agent-tools";

export interface InMemoryCharacter {
  id: string;
  name: Record<string, string>;
  summary: string;
}

export interface InMemoryShot {
  id: string;
  title: string;
  prompt: string;
  notes: string;
}

/**
 * Test / local DomainPort for golden paths (characters + storyboard shots).
 * Production uses Nest Domain HTTP when AGENT_OS_DOMAIN_URL is set.
 */
export class InMemoryStoryDomain implements DomainPort {
  revision = 0;
  readonly characters = new Map<string, InMemoryCharacter>();
  readonly shots = new Map<string, InMemoryShot>();
  private readonly idempotency = new Map<string, ToolExecuteResult>();

  /** Fake multi-section script body. */
  scriptSections: string[] = [];

  setScript(text: string, sectionSize = 2000): void {
    const sections: string[] = [];
    for (let i = 0; i < text.length; i += sectionSize) {
      sections.push(text.slice(i, i + sectionSize));
    }
    this.scriptSections = sections.length > 0 ? sections : [""];
  }

  async execute(
    toolId: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecuteResult> {
    const cached = this.idempotency.get(context.idempotencyKey);
    if (cached) {
      return cached;
    }

    let result: ToolExecuteResult;
    switch (toolId) {
      case "script.store":
        result = this.storeScript(input);
        break;
      case "script.readSection":
        result = this.readSection(input);
        break;
      case "characters.list":
        result = this.listCharacters();
        break;
      case "characters.upsert":
        result = this.upsertCharacters(input);
        break;
      case "storyboard.listShots":
        result = this.listShots();
        break;
      case "storyboard.upsertShots":
        result = this.upsertShots(input);
        break;
      case "storyboard.deleteShots":
        result = this.deleteShots(input);
        break;
      case "canvas.read":
        result = {
          ok: true,
          data: {
            projectId: context.projectId,
            draftRevision: 0,
            layoutRevision: 0,
            nodeCount: 0,
          },
        };
        break;
      default:
        result = {
          ok: false,
          code: "TOOL_NOT_IMPLEMENTED",
          message: `InMemoryStoryDomain does not implement ${toolId}`,
          retryable: false,
        };
    }

    if (result.ok || !result.retryable) {
      this.idempotency.set(context.idempotencyKey, result);
    }
    return result;
  }

  private storeScript(input: unknown): ToolExecuteResult {
    const body = input as { text: string; sectionSize?: number };
    this.setScript(body.text, body.sectionSize ?? 2000);
    return {
      ok: true,
      data: {
        sectionCount: this.scriptSections.length,
        surface: "memory",
        attachmentId: "00000000-0000-4000-8000-000000000001",
      },
    };
  }

  private readSection(input: unknown): ToolExecuteResult {
    const body = input as {
      attachmentId: string;
      sectionIndex: number;
      maxChars?: number;
    };
    if (!body.attachmentId) {
      return {
        ok: false,
        code: "ATTACHMENT_ID_REQUIRED",
        message: "attachmentId is required for script.readSection",
        retryable: false,
      };
    }
    if (body.sectionIndex >= this.scriptSections.length) {
      return {
        ok: false,
        code: "SECTION_OUT_OF_RANGE",
        message: `sectionIndex ${body.sectionIndex} >= ${this.scriptSections.length}`,
        retryable: false,
      };
    }
    const maxChars = body.maxChars ?? 8000;
    const text = this.scriptSections[body.sectionIndex]!.slice(0, maxChars);
    const contentHash = createHash("sha256").update(text).digest("hex");
    return {
      ok: true,
      data: {
        attachmentId: body.attachmentId,
        sectionIndex: body.sectionIndex,
        totalSections: this.scriptSections.length,
        text,
        contentHash,
      },
    };
  }

  private listCharacters(): ToolExecuteResult {
    return {
      ok: true,
      data: {
        revision: this.revision,
        surface: "memory",
        characters: [...this.characters.values()].map((c) => ({
          id: c.id,
          name: c.name["zh-CN"] ?? c.name["en-US"] ?? Object.values(c.name)[0] ?? c.id,
          summary: c.summary,
        })),
      },
    };
  }

  private upsertCharacters(input: unknown): ToolExecuteResult {
    const body = input as {
      baseRevision: number;
      characters: Array<{
        id: string;
        name: Record<string, string>;
        summary: string;
        intent?: "create" | "replace";
      }>;
    };

    if (body.baseRevision !== this.revision) {
      return {
        ok: false,
        code: "PROJECT_VERSION_CONFLICT",
        message: `Expected revision ${body.baseRevision}, current is ${this.revision}`,
        retryable: false,
        details: {
          expected: body.baseRevision,
          actual: this.revision,
        },
      };
    }

    const written: Array<{ id: string; name: string }> = [];
    for (const character of body.characters) {
      const intent = character.intent ?? "create";
      const existing = this.characters.get(character.id);
      if (intent === "create" && existing) {
        return {
          ok: false,
          code: "CHARACTER_EXISTS",
          message: `Character ${character.id} already exists`,
          retryable: false,
        };
      }
      this.characters.set(character.id, {
        id: character.id,
        name: character.name,
        summary: character.summary,
      });
      written.push({
        id: character.id,
        name: character.name["zh-CN"] ?? character.name["en-US"] ?? character.id,
      });
    }
    this.revision += 1;
    return {
      ok: true,
      data: {
        projectRevision: this.revision,
        surface: "memory",
        written,
      },
    };
  }

  private listShots(): ToolExecuteResult {
    return {
      ok: true,
      data: {
        revision: this.revision,
        surface: "memory",
        shots: [...this.shots.values()].map((s) => ({
          id: s.id,
          title: s.title,
          prompt: s.prompt,
          notes: s.notes,
        })),
      },
    };
  }

  private upsertShots(input: unknown): ToolExecuteResult {
    const body = input as {
      baseRevision: number;
      shots: Array<{
        id: string;
        title: string;
        prompt: string;
        notes?: string;
        intent?: "create" | "replace";
      }>;
    };

    if (body.baseRevision !== this.revision) {
      return {
        ok: false,
        code: "PROJECT_VERSION_CONFLICT",
        message: `Expected revision ${body.baseRevision}, current is ${this.revision}`,
        retryable: false,
        details: {
          expected: body.baseRevision,
          actual: this.revision,
        },
      };
    }

    const written: Array<{ id: string; title: string }> = [];
    for (const shot of body.shots) {
      const intent = shot.intent ?? "create";
      if (intent === "create" && this.shots.has(shot.id)) {
        return {
          ok: false,
          code: "SHOT_EXISTS",
          message: `Shot ${shot.id} already exists`,
          retryable: false,
        };
      }
      this.shots.set(shot.id, {
        id: shot.id,
        title: shot.title,
        prompt: shot.prompt,
        notes: shot.notes ?? "",
      });
      written.push({ id: shot.id, title: shot.title });
    }
    this.revision += 1;
    return {
      ok: true,
      data: {
        projectRevision: this.revision,
        surface: "memory",
        written,
      },
    };
  }

  private deleteShots(input: unknown): ToolExecuteResult {
    const body = input as {
      baseRevision: number;
      shotIds: string[];
    };

    if (body.baseRevision !== this.revision) {
      return {
        ok: false,
        code: "PROJECT_VERSION_CONFLICT",
        message: `Expected revision ${body.baseRevision}, current is ${this.revision}`,
        retryable: false,
        details: {
          expected: body.baseRevision,
          actual: this.revision,
        },
      };
    }

    const deleted: Array<{ id: string; title: string }> = [];
    const missing: string[] = [];
    for (const id of body.shotIds ?? []) {
      const row = this.shots.get(id);
      if (!row) {
        missing.push(id);
        continue;
      }
      deleted.push({ id: row.id, title: row.title });
      this.shots.delete(id);
    }
    if (missing.length > 0) {
      return {
        ok: false,
        code: "SHOT_NOT_FOUND",
        message: `Unknown shot id(s): ${missing.join(", ")}`,
        retryable: false,
        details: { missing },
      };
    }
    this.revision += 1;
    return {
      ok: true,
      data: {
        projectRevision: this.revision,
        surface: "memory",
        deleted,
      },
    };
  }
}
