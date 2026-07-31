import { z } from "zod";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const positionTypeSchema = z.enum([
  "director",
  "screenwriter",
  "storyboard",
  "character_design",
  "background_design",
  "animator",
  "voice_actor",
  "sound_designer",
  "music_composer",
  "editor",
  "compositor",
  "producer",
  "marketing",
]);
const currencySchema = z.enum(["CNY", "USD", "EUR", "GBP", "JPY", "HKD", "AUD", "CAD", "SGD"]);
const salarySchema = z
  .object({
    period: z.enum(["month", "episode", "project"]).nullable().optional(),
    currency: currencySchema.nullable().optional(),
    min: z.number().min(0).max(100_000_000).nullable().optional(),
    max: z.number().min(0).max(100_000_000).nullable().optional(),
    negotiable: z.boolean().optional(),
  })
  .strict()
  .superRefine((salary, context) => {
    if (salary.min != null && salary.max != null && salary.max < salary.min) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "salary.max must be greater than or equal to salary.min",
      });
    }
    if ((salary.min != null || salary.max != null) && salary.currency == null) {
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "salary.currency is required when an amount is set",
      });
    }
  });

const positionFields = {
  positionType: positionTypeSchema,
  description: z.string().trim().min(1).max(1_000),
  targetCount: z.number().int().min(1).max(99),
  workMode: z.enum(["remote", "hybrid", "onsite"]),
  location: z.string().trim().min(1).max(128).nullable().optional(),
  employmentType: z.enum(["full_time", "part_time", "contract", "freelance", "project_based"]),
  experienceLevel: z.enum(["any", "junior", "mid", "senior", "lead", "master"]),
  requiredSkills: z.array(z.string().trim().min(1).max(64)).max(20),
  salary: salarySchema.optional(),
  durationMonths: z.number().int().min(1).max(60).nullable().optional(),
  revenueSharePercent: z.number().min(0.5).max(50).multipleOf(0.5).nullable().optional(),
  closeDate: dateSchema.nullable().optional(),
} as const;

const createPositionSchema = z
  .object(positionFields)
  .strict()
  .refine(
    (position) => position.workMode === "remote" || position.location != null,
    "location is required for hybrid and onsite positions"
  );

const updatePositionSchema = z
  .object({
    positionId: identifierSchema,
    patch: z
      .object({
        description: positionFields.description.optional(),
        targetCount: positionFields.targetCount.optional(),
        workMode: positionFields.workMode.optional(),
        location: positionFields.location,
        employmentType: positionFields.employmentType.optional(),
        experienceLevel: positionFields.experienceLevel.optional(),
        requiredSkills: positionFields.requiredSkills.optional(),
        salary: salarySchema.optional(),
        durationMonths: positionFields.durationMonths,
        revenueSharePercent: positionFields.revenueSharePercent,
        closeDate: positionFields.closeDate,
        status: z.enum(["open", "frozen"]).optional(),
      })
      .strict()
      .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
        message: "position.update must change at least one field",
      }),
  })
  .strict();

export const crewManagementCommandSchema = z
  .object({
    schemaVersion: z.literal("crew-management-command/v2"),
    baseRevision: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(2_000),
    command: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("crew.profile.update"),
          patch: z
            .object({
              name: z.string().trim().min(1).max(128).optional(),
              description: z.string().trim().min(1).max(2_000).optional(),
              tagline: z.string().trim().max(140).nullable().optional(),
              genres: z
                .array(
                  z.enum([
                    "animation",
                    "live_action",
                    "documentary",
                    "shortform",
                    "mv",
                    "commercial",
                    "experimental",
                    "vlog",
                  ])
                )
                .max(5)
                .optional(),
              styles: z
                .array(
                  z.enum([
                    "2d",
                    "3d",
                    "mixed_media",
                    "live_action",
                    "stop_motion",
                    "ai_assisted",
                    "documentary",
                  ])
                )
                .max(5)
                .optional(),
            })
            .strict()
            .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
              message: "crew.profile.update must change at least one field",
            }),
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.listing.update"),
          listingStatus: z.enum(["unlisted", "listed"]),
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.owner.transfer"),
          toUserId: identifierSchema,
          removeOldOwner: z.boolean().default(false),
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.application.approve"),
          applicationId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.application.reject"),
          applicationId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.member.remove"),
          memberId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.member.finance.set"),
          memberId: identifierSchema,
          isFinance: z.boolean(),
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.position.create"),
          position: createPositionSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.position.update"),
          ...updatePositionSchema.shape,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.position.remove"),
          positionId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.episode.create"),
          title: z.string().trim().max(128).nullable().optional(),
          description: z.string().trim().max(2_000).nullable().optional(),
          deadline: dateSchema.nullable().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.episode.approve"),
          episodeId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.assignment.add"),
          episodeId: identifierSchema,
          userId: identifierSchema,
          positionId: identifierSchema.nullable().optional(),
          roleName: z.string().trim().max(64).nullable().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.assignment.remove"),
          assignmentId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.assignment.approve"),
          assignmentId: identifierSchema,
        })
        .strict(),
      z
        .object({
          type: z.literal("crew.assignment.reject"),
          assignmentId: identifierSchema,
          reason: z.string().trim().min(1).max(500),
          suggestion: z.string().trim().max(500).nullable().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const crewFinanceCommandSchema = z
  .object({
    schemaVersion: z.literal("crew-finance-command/v2"),
    baseRevision: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(2_000),
    command: z
      .object({
        type: z.literal("crew.assignment.revenue.set"),
        assignmentId: identifierSchema,
        amount: z.number().int().nonnegative(),
        currency: currencySchema,
      })
      .strict(),
  })
  .strict();

export const crewSelfServiceCommandSchema = z
  .object({
    schemaVersion: z.literal("crew-self-service-command/v2"),
    baseRevision: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(2_000),
    command: z
      .object({
        type: z.literal("crew.assignment.submit"),
        assignmentId: identifierSchema,
        url: z.string().trim().url().max(1_024).nullable().optional(),
        note: z.string().trim().max(2_000).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export type CrewManagementCommand = z.infer<typeof crewManagementCommandSchema>;
export type CrewFinanceCommand = z.infer<typeof crewFinanceCommandSchema>;
export type CrewSelfServiceCommand = z.infer<typeof crewSelfServiceCommandSchema>;
