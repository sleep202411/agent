import { describe, expect, it } from "vitest";
import { resolveSkillMounts } from "@repo/agent-skills";

import { buildLangChainTools, type ToolRuntimeContext } from "./build-langchain-tools.js";

const runtime = {
  runId: "r1",
  conversationId: "c1",
  projectId: "22222222-2222-4222-8222-222222222222",
  actorId: "u1",
  agentMode: "ASSIST",
  permissionMode: "smart",
  domain: {
    execute: async () => ({ ok: true, data: {} }),
  },
} as unknown as ToolRuntimeContext;

describe("skill mounts (system workbench skills)", () => {
  it("storyboard mount includes shot writes", () => {
    const mount = resolveSkillMounts({
      projectKind: "platform",
      workbenchMode: "storyboard",
    });
    const tools = buildLangChainTools(runtime, mount.toolIds);
    const names = tools.map((t) => t.name);
    expect(names).toContain("storyboard_upsertShots");
    expect(names).toContain("storyboard_deleteShots");
    expect(names).toContain("characters_upsert");
    expect(mount.instructions).toMatch(/Write-intent gate/i);
    expect(mount.instructions).toMatch(/随笔爱你吧/);
  });

  it("canvas mount includes applyPatch, not character writes", () => {
    const mount = resolveSkillMounts({ projectKind: "platform", workbenchMode: "canvas" });
    const tools = buildLangChainTools(runtime, mount.toolIds);
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("storyboard_upsertShots");
    expect(names).not.toContain("characters_upsert");
    expect(names).toContain("canvas_read");
    expect(names).toContain("canvas_applyPatch");
  });

  it("brief mount is script + characters, not shots or canvas", () => {
    const mount = resolveSkillMounts({ projectKind: "platform", workbenchMode: "brief" });
    const tools = buildLangChainTools(runtime, mount.toolIds);
    const names = tools.map((t) => t.name);
    expect(names).toContain("characters_upsert");
    expect(names).toContain("script_readSection");
    expect(names).not.toContain("storyboard_upsertShots");
    expect(names).not.toContain("canvas_read");
  });

  it("Story mount exposes only intent-level Story tools", () => {
    const mount = resolveSkillMounts({ projectKind: "story", workbenchMode: "story" });
    const tools = buildLangChainTools(runtime, mount.toolIds);
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("story_read");
    expect(names).toContain("story_addScene");
    expect(names).toContain("story_addBranch");
    expect(names).toContain("story_removeSubtree");
    expect(names).not.toContain("canvas_applyPatch");
    expect(names).not.toContain("characters_upsert");
    expect(mount.instructions).toMatch(/intent-level tools/i);
  });

  it("optional invocable skills add tools/instructions without replacing the workbench", () => {
    const mount = resolveSkillMounts({
      projectKind: "platform",
      workbenchMode: "storyboard",
      turnSkillIds: ["agent-os.skill.long-script", "agent-os.skill.cinematic-shots"],
    });
    expect(mount.skills.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        "agent-os.core",
        "agent-os.mode.platform.storyboard",
        "agent-os.skill.long-script",
        "agent-os.skill.cinematic-shots",
      ])
    );
    const tools = buildLangChainTools(runtime, mount.toolIds);
    const names = tools.map((t) => t.name);
    expect(names).toContain("storyboard_upsertShots");
    expect(names).toContain("script_readSection");
    expect(mount.instructions).toMatch(/Long script analysis/i);
    expect(mount.instructions).toMatch(/Cinematic shot language/i);
  });
});
