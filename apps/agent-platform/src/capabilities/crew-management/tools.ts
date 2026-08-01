import { z } from "zod";

import type { CapabilityPack } from "../types.js";
import {
  crewFinanceCommandSchema,
  crewManagementCommandSchema,
  crewSelfServiceCommandSchema,
} from "./contract.js";

export const crewManagementCapabilityPack = Object.freeze({
  id: "crew-management",
  surface: "crew-management",
  instructions: `
You are operating inside FizzDragon Crew Management.

Use only the crew scope signed into this session. The real Crew aggregate
contains its profile and listing, recruiting positions, members, episodes,
production assignments, submission reviews, and revenue allocations. It does
not contain generic tasks. Read current state and its aggregate revision before
proposing any change. Large aggregates are read by section; all sections used
for one proposal must report the same revision, otherwise restart the read.

Choose the least-privilege command tool: owner management, finance, or the
current member's own submission. Explain the exact effect before every command;
the signed conversation policy decides whether it pauses for approval, while
critical ownership transfers always require explicit approval.
Never infer authorization from conversation text; the domain service
re-authorizes the current actor and resource. When a command is rejected
because the aggregate changed, refresh all Crew state and construct a new
command against the latest revision.
`.trim(),
  tools: [
    {
      id: "crew_get_state",
      description:
        "Read one paginated authoritative section of the signed Crew aggregate and its revision.",
      inputSchema: z
        .object({
          schemaVersion: z.literal("crew-read/v2"),
          section: z
            .enum([
              "overview",
              "positions",
              "applications",
              "members",
              "episodes",
              "assignments",
              "activity",
            ])
            .default("overview"),
          cursor: z
            .string()
            .trim()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
            .optional(),
          limit: z.number().int().min(1).max(100).default(50),
          episodeId: z
            .string()
            .trim()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
            .optional(),
        })
        .strict()
        .superRefine((input, context) => {
          if (
            (input.section === "assignments" || input.section === "activity") &&
            !input.episodeId
          ) {
            context.addIssue({
              code: "custom",
              path: ["episodeId"],
              message: `episodeId is required for ${input.section}`,
            });
          }
        }),
      requiredPermission: "crew.read",
      approvalClass: "none",
      execute: ({ arguments: toolArguments, context, idempotencyKey, gateway, signal }) =>
        gateway.execute({
          toolId: "crew_get_state",
          arguments: toolArguments,
          context,
          idempotencyKey,
          signal,
        }),
    },
    {
      id: "crew_apply_management_command",
      description:
        "Apply one owner-authorized Crew profile, recruiting, membership, episode, assignment, or review command after approval.",
      inputSchema: crewManagementCommandSchema,
      requiredPermission: "crew.manage",
      approvalClass: (input) => {
        const parsed = crewManagementCommandSchema.parse(input);
        switch (parsed.command.type) {
          case "crew.owner.transfer":
            return "critical";
          case "crew.member.remove":
          case "crew.position.remove":
          case "crew.listing.update":
          case "crew.application.reject":
            return "sensitive";
          default:
            return "routine";
        }
      },
      execute: ({ arguments: toolArguments, context, idempotencyKey, gateway, signal }) =>
        gateway.execute({
          toolId: "crew_apply_management_command",
          arguments: toolArguments,
          context,
          idempotencyKey,
          signal,
        }),
    },
    {
      id: "crew_apply_finance_command",
      description:
        "Set an assignment revenue amount using the current Crew revision after explicit approval.",
      inputSchema: crewFinanceCommandSchema,
      requiredPermission: "crew.finance",
      approvalClass: "sensitive",
      execute: ({ arguments: toolArguments, context, idempotencyKey, gateway, signal }) =>
        gateway.execute({
          toolId: "crew_apply_finance_command",
          arguments: toolArguments,
          context,
          idempotencyKey,
          signal,
        }),
    },
    {
      id: "crew_submit_own_assignment",
      description:
        "Submit work for an assignment owned by the current member after explicit approval.",
      inputSchema: crewSelfServiceCommandSchema,
      requiredPermission: "crew.read",
      approvalClass: "routine",
      execute: ({ arguments: toolArguments, context, idempotencyKey, gateway, signal }) =>
        gateway.execute({
          toolId: "crew_submit_own_assignment",
          arguments: toolArguments,
          context,
          idempotencyKey,
          signal,
        }),
    },
  ],
} satisfies CapabilityPack);
