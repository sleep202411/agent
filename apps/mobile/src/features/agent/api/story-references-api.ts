import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";

const id = z.string().uuid();
const revision = z.number().int().nonnegative();
export const referenceKinds = [
  "character",
  "location",
  "prop",
  "graphic",
  "style",
  "join_frame",
  "first_frame",
  "last_frame",
] as const;
export const referenceSpecSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Z][A-Z0-9_-]*$/),
    kind: z.enum(referenceKinds),
    label: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4000).default(""),
    required: z.boolean(),
    rank: revision.max(100000),
  })
  .strict();
const mediaSchema = z.object({
  id,
  kind: z.enum(["image", "video", "audio", "document", "other"]),
  status: z.enum(["uploading", "ready", "failed", "deleted"]),
  moderationStatus: z.enum(["unreviewed", "approved", "flagged", "blocked"]),
  contentType: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  checksumSha256: z.string().nullable(),
  previewUrl: z.string().nullable(),
});
export const referenceVersionSchema = z.object({
  id,
  slotId: id,
  number: z.number().int().positive(),
  source: z.enum(["upload", "ai_job", "import"]),
  aiJobId: id.nullable(),
  aiJobOutputId: z.string().nullable(),
  asset: mediaSchema,
  variantId: id,
  sourceRecipeSnapshot: z.record(z.string(), z.unknown()).nullable(),
  checksumSha256: z.string(),
  reviewRevision: revision,
  approved: z.boolean(),
  createdByUserId: z.string().min(1),
  createdAt: z.string(),
});
export const referenceSlotSchema = referenceSpecSchema
  .extend({
    id,
    projectId: id,
    version: revision,
    status: z.enum(["empty", "candidate", "approved", "invalidated"]),
    approvedVersionId: id.nullable(),
    versions: z.array(referenceVersionSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strip()
  .superRefine((slot, context) => {
    if (
      slot.versions.some((v) => v.slotId !== slot.id) ||
      new Set(slot.versions.map((v) => v.id)).size !== slot.versions.length
    )
      context.addIssue({ code: "custom", message: "Reference version ownership mismatch." });
    if (
      slot.status === "approved" &&
      !slot.versions.some((v) => v.id === slot.approvedVersionId && v.approved)
    )
      context.addIssue({ code: "custom", message: "Approved reference version is missing." });
  });
const checklistValue = z.enum(["pass", "fail", "na"]);
export const referenceChecklistSchema = z
  .object({
    technical: checklistValue,
    identityContinuity: checklistValue,
    rights: checklistValue,
    safety: checklistValue,
  })
  .strict();
const decision = z.enum(["approve", "reject", "request_changes"]);
export const referenceReviewInputSchema = z
  .object({
    expectedReviewRevision: revision,
    decision,
    checklist: referenceChecklistSchema,
    comment: z.string().trim().max(4000).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.decision !== "approve" && !input.comment)
      context.addIssue({
        code: "custom",
        path: ["comment"],
        message: "Reject and request_changes decisions require a comment.",
      });
    if (
      input.decision === "approve" &&
      [input.checklist.technical, input.checklist.rights, input.checklist.safety].some(
        (v) => v !== "pass"
      )
    )
      context.addIssue({
        code: "custom",
        path: ["checklist"],
        message: "Technical, rights, and safety checks must pass to approve.",
      });
  });
const reviewSchema = z.object({
  id,
  decision,
  checklist: referenceChecklistSchema,
  comment: z.string().nullable(),
  reviewerUserId: z.string().min(1),
  createdAt: z.string(),
});
export const referenceVersionInputSchema = z
  .object({
    expectedSlotVersion: revision,
    assetId: id,
    variantId: id,
    source: z.enum(["upload", "import"]),
    sourceRecipeSnapshot: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ReferenceSlot = z.infer<typeof referenceSlotSchema>;
export type ReferenceSpec = z.infer<typeof referenceSpecSchema>;
export type ReferenceVersion = z.infer<typeof referenceVersionSchema>;
export type ReferenceReviewInput = z.infer<typeof referenceReviewInputSchema>;
export type ReferenceScope = { projectId: string; generation: number };

/** Project-owned receipts and caller-owned retry keys; mutations never automatically retry. */
export function storyReferences(scope: ReferenceScope) {
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    id.parse(scope.projectId);
    if (scope.generation !== getAuthGeneration()) throw Error("Reference session expired.");
  };
  const root = `/story-projects/${scope.projectId}/reference-slots`;
  const options = (signal: AbortSignal) => {
    current(signal);
    return { service: "aurora" as const, signal, retry: false as const };
  };
  const headers = (key: string) => ({
    "Idempotency-Key": z.string().trim().min(1).max(180).parse(key),
  });
  const slotPath = (slotId: string) => `${root}/${id.parse(slotId)}`;
  const slotReceipt = (value: unknown, slotId?: string) => {
    const slot = referenceSlotSchema.parse(value);
    if (slot.projectId !== scope.projectId || (slotId && slot.id !== slotId))
      throw Error("Reference slot ownership mismatch.");
    return slot;
  };
  const versionReceipt = (value: unknown, slotId: string, versionId?: string) => {
    const version = referenceVersionSchema.parse(value);
    if (version.slotId !== slotId || (versionId && version.id !== versionId))
      throw Error("Reference version ownership mismatch.");
    return version;
  };
  return {
    async list(signal: AbortSignal) {
      const raw = await api.get(root, options(signal));
      current(signal);
      const slots = z
        .array(z.unknown())
        .parse(raw)
        .map((v) => slotReceipt(v));
      if (new Set(slots.map((v) => v.id)).size !== slots.length)
        throw Error("Duplicate reference slots.");
      return slots;
    },
    async create(slots: ReferenceSpec[], key: string, signal: AbortSignal) {
      const parsed = z.array(referenceSpecSchema).min(1).max(100).parse(slots);
      if (new Set(parsed.map((v) => v.key)).size !== parsed.length)
        throw Error("Duplicate reference keys.");
      const raw = await api.post(root, {
        ...options(signal),
        headers: headers(key),
        data: { slots: parsed },
      });
      current(signal);
      const result = z
        .array(z.unknown())
        .parse(raw)
        .map((v) => slotReceipt(v));
      if (
        result.length !== parsed.length ||
        new Set(result.map((v) => v.key)).size !== parsed.length ||
        result.some((v) => !parsed.some((s) => s.key === v.key))
      )
        throw Error("Reference creation receipt mismatch.");
      return result;
    },
    async update(
      slotId: string,
      expectedSlotVersion: number,
      slot: ReferenceSpec,
      signal: AbortSignal
    ) {
      const data = {
        expectedSlotVersion: revision.parse(expectedSlotVersion),
        slot: referenceSpecSchema.parse(slot),
      };
      const raw = await api.put(slotPath(slotId), { ...options(signal), data });
      current(signal);
      return slotReceipt(raw, slotId);
    },
    async versions(slotId: string, signal: AbortSignal) {
      const raw = await api.get(`${slotPath(slotId)}/versions`, options(signal));
      current(signal);
      return z
        .array(z.unknown())
        .parse(raw)
        .map((v) => versionReceipt(v, slotId));
    },
    async addVersion(
      slotId: string,
      input: z.infer<typeof referenceVersionInputSchema>,
      key: string,
      signal: AbortSignal
    ) {
      const data = referenceVersionInputSchema.parse(input);
      const raw = await api.post(`${slotPath(slotId)}/versions`, {
        ...options(signal),
        headers: headers(key),
        data,
      });
      current(signal);
      const version = versionReceipt(raw, slotId);
      if (
        version.asset.id !== data.assetId ||
        version.variantId !== data.variantId ||
        version.source !== data.source
      )
        throw Error("Reference media receipt mismatch.");
      return version;
    },
    async review(
      slotId: string,
      versionId: string,
      input: ReferenceReviewInput,
      signal: AbortSignal
    ) {
      const data = referenceReviewInputSchema.parse(input);
      const raw = await api.post(`${slotPath(slotId)}/versions/${id.parse(versionId)}/reviews`, {
        ...options(signal),
        data,
      });
      current(signal);
      const result = z.object({ reference: z.unknown(), review: reviewSchema }).parse(raw);
      const reference = versionReceipt(result.reference, slotId, versionId);
      if (result.review.decision !== data.decision)
        throw Error("Reference review receipt mismatch.");
      return { reference, review: result.review };
    },
    async approve(
      slotId: string,
      expectedSlotVersion: number,
      referenceVersionId: string,
      approveReviewId: string,
      signal: AbortSignal
    ) {
      const data = {
        expectedSlotVersion: revision.parse(expectedSlotVersion),
        referenceVersionId: id.parse(referenceVersionId),
        approveReviewId: id.parse(approveReviewId),
      };
      const raw = await api.post(`${slotPath(slotId)}/approval`, { ...options(signal), data });
      current(signal);
      const slot = slotReceipt(raw, slotId);
      if (slot.status !== "approved" || slot.approvedVersionId !== referenceVersionId)
        throw Error("Reference approval receipt mismatch.");
      return slot;
    },
  };
}
