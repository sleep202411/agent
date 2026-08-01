import { describe, expect, it } from "vitest";

import type { AgentSessionContext } from "../context/agent-context.js";
import {
  CapabilityDeniedError,
  createInferenceTools,
  getAuthorizedToolDefinition,
  requiresToolApproval,
} from "./registry.js";

const context = (
  permissions: string[],
  surface: AgentSessionContext["surface"] = "story-studio",
  permissionMode: AgentSessionContext["permissionMode"] = "smart"
): AgentSessionContext => {
  const common = {
    actorId: "actor-1" as const,
    actorDisplayName: "Actor One",
    conversationId: "0197f4a2-0800-7000-8000-000000000004",
    sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004",
    permissionMode,
    locale: "en-US",
    roles: ["creator"],
    permissions,
    traceId: "trace-1",
  };
  return surface === "story-studio"
    ? {
        ...common,
        surface,
        scope: {
          kind: "story-project",
          workspaceId: "workspace-1",
          projectId: "project-1",
        },
      }
    : {
        ...common,
        surface,
        scope: {
          kind: "crew",
          crewId: "crew-1",
        },
      };
};

describe("capability registry", () => {
  it("mounts only tools authorized for the signed surface and permissions", () => {
    expect(Object.keys(createInferenceTools(context(["story.read"])))).toEqual([
      "story_get_source_analysis",
      "story_query_source_material",
      "story_get_snapshot",
    ]);
    expect(
      Object.keys(createInferenceTools(context(["crew.read", "crew.manage"], "crew-management")))
    ).toEqual(["crew_get_state", "crew_apply_management_command", "crew_submit_own_assignment"]);
  });

  it("does not mount cross-surface capabilities even if a permission is present", () => {
    expect(
      Object.keys(createInferenceTools(context(["story.read", "crew.read", "crew.manage"])))
    ).toEqual(["story_get_source_analysis", "story_query_source_material", "story_get_snapshot"]);
  });

  it("mounts finance without granting owner management", () => {
    expect(
      Object.keys(createInferenceTools(context(["crew.read", "crew.finance"], "crew-management")))
    ).toEqual(["crew_get_state", "crew_apply_finance_command", "crew_submit_own_assignment"]);
  });

  it("denies tool execution when authorization has changed since inference", () => {
    expect(() =>
      getAuthorizedToolDefinition(context(["story.read"]), "story_apply_change_set")
    ).toThrowError(CapabilityDeniedError);
  });

  it("derives approval from signed policy and semantic mutation risk", () => {
    const routineStoryInput = {
      schemaVersion: "story-apply/v1",
      changeSet: {
        schemaVersion: "story-change-set/v2",
        chapterId: "0197f4a2-0800-7000-8000-000000000002",
        baseDraftRevision: 1,
        baseContentHash: "a".repeat(64),
        baseLayoutRevision: 1,
        title: "Update overview",
        summary: "Refresh the logline.",
        operations: [
          {
            kind: "story_bible.update_overview",
            payload: { logline: "A new beginning." },
          },
        ],
      },
    };
    const ask = context(["story.write"], "story-studio", "ask");
    const smart = context(["story.write"], "story-studio", "smart");
    const full = context(["story.write"], "story-studio", "full");
    const definition = getAuthorizedToolDefinition(smart, "story_apply_change_set");

    expect(requiresToolApproval(ask, definition, routineStoryInput)).toBe(true);
    expect(requiresToolApproval(smart, definition, routineStoryInput)).toBe(false);
    expect(requiresToolApproval(full, definition, routineStoryInput)).toBe(false);
  });

  it("never auto-approves a critical ownership transfer", () => {
    const criticalInput = {
      schemaVersion: "crew-management-command/v2",
      baseRevision: 1,
      reason: "Transfer ownership.",
      command: {
        type: "crew.owner.transfer",
        toUserId: "new-owner",
        removeOldOwner: false,
      },
    };

    for (const mode of ["ask", "smart", "full"] as const) {
      const value = context(["crew.manage"], "crew-management", mode);
      const definition = getAuthorizedToolDefinition(value, "crew_apply_management_command");
      expect(requiresToolApproval(value, definition, criticalInput)).toBe(true);
    }
  });
});
