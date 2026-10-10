import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { getLocale } from "@/i18n/locale-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid(),
  version = z.number().int().nonnegative(),
  locale = z.enum(["en-US", "zh-CN", "zh-HK"]);
const raw = z.record(z.string(), z.unknown()).nullable();
const snapshot = z.object({
  id,
  version,
  sourceLocale: locale,
  title: z.string(),
  summary: z.string(),
  status: z.string(),
  listingVisibility: z.string(),
  genreCodes: z.array(z.string()),
  coverAsset: z.object({ id }).nullable(),
  trailerAsset: z.object({ id }).nullable(),
  copyrightOwner: z.string().nullable(),
  rightsSummary: raw,
  aiDisclosure: raw,
});
export type ReviewSnapshot = z.infer<typeof snapshot>;
export const reviewCommand = z.object({
  clientKey: id,
  expectedVersion: version,
  sourceLocale: locale,
  changeSummary: z.string().trim().min(1).max(1000),
});
export type ReviewCommand = z.infer<typeof reviewCommand>;
export const reviewRequirements = [
  "title",
  "summary",
  "genre",
  "asset",
  "copyright",
  "rights",
  "ai",
] as const;
export function missingReviewRequirements(value: ReviewSnapshot) {
  const missing: (typeof reviewRequirements)[number][] = [];
  if (!value.title.trim()) missing.push("title");
  if (!value.summary.trim()) missing.push("summary");
  if (!value.genreCodes.length) missing.push("genre");
  if (!value.coverAsset && !value.trailerAsset) missing.push("asset");
  if (!value.copyrightOwner?.trim()) missing.push("copyright");
  if (typeof value.rightsSummary?.statement !== "string" || !value.rightsSummary.statement.trim())
    missing.push("rights");
  if (
    (value.aiDisclosure?.generatedVisuals === true || value.aiDisclosure?.generatedCopy === true) &&
    (typeof value.aiDisclosure?.statement !== "string" || !value.aiDisclosure.statement.trim())
  )
    missing.push("ai");
  return missing;
}
export const canRequestReview = (status: string) =>
  ["draft", "changes_requested", "approved"].includes(status);
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || getAuthGeneration() !== generation)
    throw new Error("IP review session expired.");
}
function normalize(ipId: string, data: unknown) {
  const value = z.object({ ip: snapshot }).parse(data).ip;
  if (value.id !== ipId) throw new Error("IP review identity mismatch.");
  return value;
}
export function reviewOutbox(ipId: string, userId: string, generation: number) {
  return pendingRequest(
    reviewCommand,
    generation,
    durableRecord("ip-review-submission", userId, id.parse(ipId))
  );
}
export async function fetchReview(ipId: string, generation: number, signal: AbortSignal) {
  id.parse(ipId);
  current(generation, signal);
  const read = async (language: string) => {
    const value = normalize(
      ipId,
      await api.get(`/ip-commerce/me/ips/${ipId}`, {
        service: "aurora",
        signal,
        retry: false,
        params: { locale: language },
      })
    );
    current(generation, signal);
    return value;
  };
  const language = getLocale(),
    first = await read(language);
  if (first.sourceLocale === language) return first;
  const source = await read(first.sourceLocale);
  if (source.sourceLocale !== first.sourceLocale)
    throw new Error("IP source language changed. Refresh before submitting.");
  return source;
}
export async function submitReview(
  ipId: string,
  userId: string,
  generation: number,
  input: ReviewCommand,
  signal: AbortSignal
) {
  current(generation, signal);
  const command = reviewCommand.parse(input),
    box = reviewOutbox(ipId, userId, generation);
  box.save(command);
  const latest = await fetchReview(ipId, generation, signal);
  if (latest.version !== command.expectedVersion || latest.sourceLocale !== command.sourceLocale)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "This IP changed or the submission response was lost. Refresh and review its status before starting a new request.",
      409
    );
  if (!canRequestReview(latest.status))
    throw new Error("This IP cannot be submitted from its current review status.");
  if (missingReviewRequirements(latest).length)
    throw new Error("Complete the missing publication requirements before submitting.");
  current(generation, signal);
  if (JSON.stringify(box.read()) !== JSON.stringify(command))
    throw new Error("The pending review request changed.");
  const result = normalize(
    ipId,
    await api.post(`/ip-commerce/me/ips/${ipId}/review-submissions`, {
      service: "aurora",
      signal,
      retry: false,
      data: { expectedVersion: command.expectedVersion, changeSummary: command.changeSummary },
    })
  );
  current(generation, signal);
  if (
    result.version !== command.expectedVersion + 1 ||
    result.status !== "submitted" ||
    result.listingVisibility !== "private" ||
    result.sourceLocale !== command.sourceLocale
  )
    throw new Error("Review submission receipt mismatch. Refresh and check the status.");
  box.clear(command.clientKey);
  return result;
}
