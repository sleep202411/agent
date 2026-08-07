import { createHash } from "node:crypto";

import type { DomainPort, ToolExecuteResult, ToolExecutionContext } from "@repo/agent-tools";

export interface InMemoryCharacter {
  id: string;
  name: Record<string, string>;
  summary: string;
}

/**
 * Test / local DomainPort for golden path A.
 * Production replaces this with Nest Domain Command handlers.
 */
export class InMemoryStoryDomain implements DomainPort {
  revision = 0;
  readonly characters = new Map<string, InMemoryCharacter>();
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
      case "script.readSection":
        result = this.readSection(input);
        break;
      case "characters.list":
        result = this.listCharacters();
        break;
      case "characters.upsert":
        result = this.upsertCharacters(input);
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

  private readSection(input: unknown): ToolExecuteResult {
    const body = input as {
      attachmentId: string;
      sectionIndex: number;
      maxChars: number;
    };
    if (body.sectionIndex >= this.scriptSections.length) {
      return {
        ok: false,
        code: "SECTION_OUT_OF_RANGE",
        message: `sectionIndex ${body.sectionIndex} >= ${this.scriptSections.length}`,
        retryable: false,
      };
    }
    const text = this.scriptSections[body.sectionIndex]!.slice(0, body.maxChars);
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
        intent: "create" | "replace";
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
      const existing = this.characters.get(character.id);
      if (character.intent === "create" && existing) {
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
        written,
      },
    };
  }
}
