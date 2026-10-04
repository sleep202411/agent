import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import type { ChannelScope } from "./channel-submissions-api";

const id = z.string().uuid();
const status = z.enum(["pending", "approved", "rejected"]);
const entry = z.object({
  id,
  title: z.string(),
  description: z.string(),
  status,
  version: z.number().int().nonnegative(),
  url: z.string().url().nullable(),
});
const page = z.object({
  items: z.array(entry),
  canManage: z.boolean(),
  nextCursor: id.nullable(),
});
export const channelVideoInput = z
  .object({
    assetId: id,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
  })
  .strict();
const decision = z
  .object({
    id,
    status: z.enum(["approved", "rejected"]),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type ChannelVideo = z.infer<typeof entry>;
export type ChannelVideoPage = z.infer<typeof page>;
export type ChannelVideoInput = z.infer<typeof channelVideoInput>;
export type ChannelVideoDecision = z.infer<typeof decision>;

function current(scope: ChannelScope, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (getAuthGeneration() !== scope.generation) throw new Error("Channel session changed.");
}
function path(scope: ChannelScope) {
  return `/ip-commerce/ips/${id.parse(scope.ipId)}/video-submissions`;
}
export async function fetchChannelVideos(
  scope: ChannelScope,
  cursor: string | null,
  signal: AbortSignal
) {
  current(scope, signal);
  const result = page.parse(
    await api.get(path(scope), {
      service: "aurora",
      retry: false,
      signal,
      params: { cursor: cursor === null ? undefined : id.parse(cursor) },
    })
  );
  current(scope, signal);
  // Moderation can remove every item from a page without ending pagination.
  if (result.nextCursor && result.nextCursor === cursor)
    throw new Error("Invalid video submissions cursor. Refresh and retry.");
  return result;
}
export async function submitChannelVideo(scope: ChannelScope, input: ChannelVideoInput) {
  current(scope);
  const data = channelVideoInput.parse(input);
  // The server deduplicates by channel + asset + uploader. A retry must retain
  // this asset and input; uploading another asset would create another entry.
  const result = z.object({ id, status }).parse(
    await api.post(path(scope), {
      service: "aurora",
      retry: false,
      data,
    })
  );
  current(scope);
  return result;
}
export async function reviewChannelVideo(scope: ChannelScope, input: ChannelVideoDecision) {
  current(scope);
  const data = decision.parse(input);
  // Review is versioned, not idempotent. Re-read after an uncertain response.
  const result = z.object({ status: z.literal(data.status) }).parse(
    await api.patch(path(scope), {
      service: "aurora",
      retry: false,
      data,
    })
  );
  current(scope);
  return result;
}
