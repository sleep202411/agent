import { describe, expect, it, beforeEach } from "vitest";

import { registerSkill, resetSkillRegistryForTests, resolveSkillMounts } from "./index.js";

describe("resolveSkillMounts", () => {
  beforeEach(() => {
    resetSkillRegistryForTests();
  });

  it("mounts core + Platform storyboard skills and unions tools", () => {
    const mount = resolveSkillMounts({ projectKind: "platform", workbenchMode: "storyboard" });
    const ids = mount.skills.map((s) => s.id);
    expect(ids).toContain("agent-os.core");
    expect(ids).toContain("agent-os.mode.platform.storyboard");
    expect(ids).not.toContain("agent-os.mode.platform.canvas");
    expect(mount.toolIds).toContain("storyboard.upsertShots");
    expect(mount.toolIds).toContain("characters.upsert");
    expect(mount.instructions).toMatch(/STORYBOARD/i);
  });

  it("storyboard instructions enforce write-intent gate for bare poetic phrases", () => {
    const mount = resolveSkillMounts({ projectKind: "platform", workbenchMode: "storyboard" });
    expect(mount.instructions).toMatch(/Write-intent gate/i);
    expect(mount.instructions).toMatch(/chat-only/i);
    expect(mount.instructions).toMatch(/随笔爱你吧/);
    expect(mount.instructions).toMatch(/NOT "add a shot"/i);
    expect(mount.instructions).toMatch(/Do NOT resubmit existing shots/i);
  });

  it("canvas mount includes applyPatch tools, not character writes", () => {
    const mount = resolveSkillMounts({ projectKind: "platform", workbenchMode: "canvas" });
    expect(mount.toolIds).toContain("canvas.applyPatch");
    expect(mount.toolIds).not.toContain("characters.upsert");
    expect(mount.toolIds).not.toContain("storyboard.upsertShots");
  });

  it("mounts attachment tools from core in Story workbenches", () => {
    const mount = resolveSkillMounts({ projectKind: "story", workbenchMode: "story" });
    expect(mount.toolIds).toContain("script.store");
    expect(mount.toolIds).toContain("script.readSection");
    expect(mount.toolIds).toContain("story.read");
    expect(mount.toolIds).toContain("story.putInteraction");
    expect(mount.toolIds).toContain("story.removeInteraction");
    expect(mount.instructions).toMatch(/untrusted user data/i);
  });

  it("applies turn skill ids when registered and context-allowed", () => {
    registerSkill({
      id: "catalog.demo-style",
      name: "Demo style",
      description: "Future catalog skill",
      instructions: "## Demo style\nUse a noir palette.",
      toolIds: [],
      projectKinds: ["platform"],
      workbenchModes: ["storyboard", "brief"],
      source: "catalog",
      alwaysOn: false,
      removable: true,
      priority: 200,
    });

    const mount = resolveSkillMounts({
      projectKind: "platform",
      workbenchMode: "storyboard",
      turnSkillIds: ["catalog.demo-style", "does-not-exist"],
    });
    expect(mount.skills.map((s) => s.id)).toContain("catalog.demo-style");
    expect(mount.instructions).toMatch(/noir palette/);
    expect(mount.skippedSkillIds).toContain("does-not-exist");
  });

  it("skips turn skills that do not allow the workbench", () => {
    registerSkill({
      id: "catalog.canvas-only",
      name: "Canvas only",
      description: "x",
      instructions: "## Canvas only skill",
      toolIds: ["canvas.read"],
      projectKinds: ["platform"],
      workbenchModes: ["canvas"],
      source: "catalog",
      alwaysOn: false,
      removable: true,
      priority: 200,
    });
    const mount = resolveSkillMounts({
      projectKind: "platform",
      workbenchMode: "storyboard",
      turnSkillIds: ["catalog.canvas-only"],
    });
    expect(mount.skills.map((s) => s.id)).not.toContain("catalog.canvas-only");
    expect(mount.skippedSkillIds).toContain("catalog.canvas-only");
  });

  it("mounts selected system skills after always-on", () => {
    const mount = resolveSkillMounts({
      projectKind: "platform",
      workbenchMode: "storyboard",
      turnSkillIds: ["agent-os.skill.long-script", "agent-os.skill.cinematic-shots"],
    });
    const ids = mount.skills.map((s) => s.id);
    expect(ids.indexOf("agent-os.core")).toBeLessThan(ids.indexOf("agent-os.skill.long-script"));
    expect(ids).toContain("agent-os.skill.long-script");
    expect(ids).toContain("agent-os.skill.cinematic-shots");
    expect(mount.instructions).toMatch(/Long script analysis/i);
    expect(mount.instructions).toMatch(/Cinematic shot language/i);
  });

  it("skips a selected system skill not allowed on the workbench", () => {
    const mount = resolveSkillMounts({
      projectKind: "platform",
      workbenchMode: "brief",
      turnSkillIds: ["agent-os.skill.cinematic-shots"],
    });
    expect(mount.skills.map((s) => s.id)).not.toContain("agent-os.skill.cinematic-shots");
    expect(mount.skippedSkillIds).toContain("agent-os.skill.cinematic-shots");
  });
});

describe("listInvocableSkills", () => {
  beforeEach(() => {
    resetSkillRegistryForTests();
  });

  it("lists only userInvocable skills for a workbench", async () => {
    const { listInvocableSkills } = await import("./public-meta.js");
    const invocable = listInvocableSkills({
      projectKind: "platform",
      workbenchMode: "storyboard",
    });
    expect(invocable.every((s) => s.userInvocable)).toBe(true);
    expect(invocable.map((s) => s.id)).toContain("agent-os.skill.long-script");
    expect(invocable.map((s) => s.id)).toContain("agent-os.skill.cinematic-shots");
    expect(invocable.map((s) => s.id)).not.toContain("agent-os.core");
  });

  it("filters invocable by project and workbench", async () => {
    const { listInvocableSkills } = await import("./public-meta.js");
    const briefOnly = listInvocableSkills({ projectKind: "platform", workbenchMode: "brief" });
    expect(briefOnly.map((s) => s.id)).toContain("agent-os.skill.long-script");
    expect(briefOnly.map((s) => s.id)).not.toContain("agent-os.skill.cinematic-shots");
  });
});
