import { describe, expect, it } from "vitest";

import {
  crewFinanceCommandSchema,
  crewManagementCommandSchema,
  crewSelfServiceCommandSchema,
} from "./contract.js";

describe("Crew Agent command contracts", () => {
  it("requires an aggregate revision for every management mutation", () => {
    expect(() =>
      crewManagementCommandSchema.parse({
        schemaVersion: "crew-management-command/v2",
        reason: "Remove a former collaborator.",
        command: {
          type: "crew.member.remove",
          memberId: "member-1",
        },
      })
    ).toThrow(/baseRevision/);
  });

  it("models actual Crew production work instead of a fictional generic task", () => {
    const command = crewManagementCommandSchema.parse({
      schemaVersion: "crew-management-command/v2",
      baseRevision: 12,
      reason: "Assign the storyboard artist to episode 3.",
      command: {
        type: "crew.assignment.add",
        episodeId: "episode-3",
        userId: "artist-8",
        positionId: "position-storyboard",
        roleName: "Lead storyboard artist",
      },
    });

    expect(command.command.type).toBe("crew.assignment.add");
  });

  it("keeps finance and self-service mutations in separate least-privilege contracts", () => {
    expect(
      crewFinanceCommandSchema.parse({
        schemaVersion: "crew-finance-command/v2",
        baseRevision: 12,
        reason: "Record the approved episode payment.",
        command: {
          type: "crew.assignment.revenue.set",
          assignmentId: "assignment-2",
          amount: 125_000,
          currency: "CNY",
        },
      }).command.type
    ).toBe("crew.assignment.revenue.set");

    expect(
      crewSelfServiceCommandSchema.parse({
        schemaVersion: "crew-self-service-command/v2",
        baseRevision: 12,
        reason: "Submit my completed storyboard.",
        command: {
          type: "crew.assignment.submit",
          assignmentId: "assignment-2",
          url: "https://example.com/storyboard",
        },
      }).command.type
    ).toBe("crew.assignment.submit");
  });

  it("rejects an empty Crew or position patch", () => {
    expect(() =>
      crewManagementCommandSchema.parse({
        schemaVersion: "crew-management-command/v2",
        baseRevision: 12,
        reason: "Update the crew.",
        command: {
          type: "crew.profile.update",
          patch: {},
        },
      })
    ).toThrow(/must change at least one field/);

    expect(() =>
      crewManagementCommandSchema.parse({
        schemaVersion: "crew-management-command/v2",
        baseRevision: 12,
        reason: "Update the position.",
        command: {
          type: "crew.position.update",
          positionId: "position-1",
          patch: {},
        },
      })
    ).toThrow(/must change at least one field/);
  });
});
