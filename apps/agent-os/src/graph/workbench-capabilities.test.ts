import { describe, expect, it, vi } from "vitest";
import { resolveSkillMounts } from "@repo/agent-skills";
import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";

import {
  buildLangChainTools,
  userInputResumePayload,
  type ToolRuntimeContext,
} from "./build-langchain-tools.js";
import { resolveAgentOsSkillMount } from "./create-agent-graph.js";
import { AgentOsExecutionSupersededError } from "../runtime/http-domain-port.js";

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
    expect(names).toContain("request_user_input");
    expect(names).toContain("story_confirmCreativeProfile");
    expect(names).toContain("story_addScene");
    expect(names).toContain("story_addBranch");
    expect(names).toContain("story_putInteraction");
    expect(names).toContain("story_removeInteraction");
    expect(names).toContain("story_removeSubtree");
    expect(names).not.toContain("canvas_applyPatch");
    expect(names).not.toContain("characters_upsert");
    expect(mount.instructions).toMatch(/intent-level tools/i);
    expect(mount.instructions).toMatch(/answer normally and call NO Story tool/);
    expect(mount.instructions).toContain("chapterHasNoScript=true");
    expect(mount.instructions).toContain('Examples include "一只小猫"');
    expect(mount.instructions).toMatch(/Only when canonical context has no valid chapter Script/);
    expect(mount.instructions).toMatch(/script\.status=missing selects screenplay creation/);
    expect(mount.instructions).toMatch(/productionState\.ready=true\s+selects no-op/);
    const storyAuthor = tools.find((tool) => tool.name === "story_author");
    expect(storyAuthor?.description).toMatch(/Server-side canonical next-stage planner/);
    expect(storyAuthor?.description).toMatch(/Set continueThrough once/);
    expect(storyAuthor?.description).toMatch(/never generates media directly/i);
    expect(storyAuthor?.description).toMatch(/without a second Asset confirmation/i);
    const quoteAssets = tools.find((tool) => tool.name === "story_generation_quoteAssets");
    expect(
      quoteAssets?.schema.safeParse({
        assetKinds: ["character"],
        outputKind: "image",
      }).success
    ).toBe(true);
    expect(
      quoteAssets?.schema.safeParse({
        assetKinds: '["character"]',
        outputKind: "image",
      }).success
    ).toBe(false);
  });

  it("removes profile blockers from the trusted mobile H5 Story mount", () => {
    const mount = resolveAgentOsSkillMount({
      projectKind: "story",
      workbenchMode: "story",
      workbenchContext: { experience: "mobile_h5" },
    });
    const tools = buildLangChainTools(runtime, mount.toolIds);
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("story_read");
    expect(names).toContain("story_author");
    expect(names).toContain("story_storyboard_read");
    expect(names).toContain("story_storyboard_putTimeline");
    expect(names).toContain("story_storyboard_patchClip");
    expect(names).not.toContain("request_user_input");
    expect(names).not.toContain("story_confirmCreativeProfile");
    expect(mount.instructions).toContain("Mandatory mobile H5 Story state machine");
    expect(mount.instructions).toContain("call story_author immediately");
    expect(mount.instructions).toContain("The Server atomically applies the H5 product defaults");
  });

  it("exposes version-free Storyboard clip editing tools on desktop and mobile H5", () => {
    for (const experience of [undefined, "mobile_h5"] as const) {
      const mount = resolveAgentOsSkillMount({
        projectKind: "story",
        workbenchMode: "story",
        ...(experience ? { workbenchContext: { experience } } : {}),
      });
      const tools = buildLangChainTools(runtime, mount.toolIds);
      const timeline = tools.find((candidate) => candidate.name === "story_storyboard_putTimeline");
      expect(timeline).toBeDefined();
      // No CAS token anywhere in the model-facing contract.
      expect(
        timeline?.schema.safeParse({
          sequenceId: "0197f4a2-0800-7000-8000-0000000000b1",
          durationMs: 2_500,
          clips: [
            {
              stableKey: "shot.scene.gate.hold",
              title: "Held gate frame",
              description: null,
              startMs: 0,
              durationMs: 2_500,
              kind: "image",
              imagePrompt: "A sealed gate in rain.",
            },
          ],
        }).success
      ).toBe(true);
      expect(
        timeline?.schema.safeParse({
          sequenceId: "0197f4a2-0800-7000-8000-0000000000b1",
          durationMs: 2_500,
          clips: [{ kind: "video", videoPrompt: "x" }],
        }).success
      ).toBe(false);
      const patch = tools.find((candidate) => candidate.name === "story_storyboard_patchClip");
      expect(patch).toBeDefined();
      expect(
        patch?.schema.safeParse({
          clipId: "0197f4a2-0800-7000-8000-0000000000b2",
          imagePrompt: "A sealed gate in heavier rain.",
        }).success
      ).toBe(true);
    }
  });

  it("binds every curated Story visual-style Skill as a creative-profile value", () => {
    const mount = resolveSkillMounts({ projectKind: "story", workbenchMode: "story" });
    const tool = buildLangChainTools(runtime, mount.toolIds).find(
      (candidate) => candidate.name === "story_confirmCreativeProfile"
    );
    expect(tool).toBeDefined();

    for (const visualDirection of STORY_VISUAL_STYLE_SKILL_SLUGS) {
      expect(
        tool?.schema.safeParse({
          aspectRatio: "portrait_9_16",
          targetRuntime: "short_5_15",
          visualDirection,
          storyLanguage: "zh-CN",
        }).success
      ).toBe(true);
    }
    expect(
      tool?.schema.safeParse({
        aspectRatio: "portrait_9_16",
        targetRuntime: "short_5_15",
        visualDirection: "cinematic_realism",
        storyLanguage: "zh-CN",
      }).success
    ).toBe(false);
  });

  it("returns complete creative-profile answers without allowing known values to be overwritten", () => {
    expect(
      userInputResumePayload(
        {
          aspect_ratio: "landscape_16_9",
          visual_direction: "cinematic-realism",
        },
        {
          requestId: "11111111-1111-4111-8111-111111111111",
          answers: {
            aspect_ratio: "portrait_9_16",
            target_runtime: "short_5_15",
            story_language: "zh-CN",
          },
        }
      )
    ).toEqual({
      requestId: "11111111-1111-4111-8111-111111111111",
      answers: {
        aspect_ratio: "landscape_16_9",
        target_runtime: "short_5_15",
        visual_direction: "cinematic-realism",
        story_language: "zh-CN",
      },
    });
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

  it("does not emit ToolFailed when a stale execution is fenced", async () => {
    const onToolEvent = vi.fn();
    const fencedRuntime = {
      ...runtime,
      turnId: "11111111-1111-4111-8111-111111111111",
      skillResolutionId: "33333333-3333-4333-8333-333333333333",
      skillVersionIds: [],
      permissionMode: "full",
      domain: {
        execute: vi.fn(async () => {
          throw new AgentOsExecutionSupersededError(
            "AGENT_OS_CONTINUATION_EXECUTION_FENCED",
            "another epoch owns the run"
          );
        }),
      },
      onToolEvent,
    } as unknown as ToolRuntimeContext;
    const list = buildLangChainTools(fencedRuntime, ["characters.list"])[0]!;

    await expect(
      list.invoke({}, { toolCall: { id: "stale-call" } } as never)
    ).rejects.toBeInstanceOf(AgentOsExecutionSupersededError);
    expect(onToolEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "ToolStarted" }));
    expect(onToolEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ToolFailed" }));
  });
});
