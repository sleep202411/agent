import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
const id = z.string().uuid();
const entry = z.object({
  workId: id,
  title: z.string(),
  roomNumber: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  version: z.number().int().nonnegative(),
});
const page = z.object({
  community: z.boolean(),
  open: z.boolean(),
  canManage: z.boolean(),
  items: z.array(entry),
  nextCursor: id.nullish(),
});
const work = z.object({ id, title: z.string(), status: z.string(), listingVisibility: z.string() });
const works = z.object({ items: z.array(work), nextCursor: id.nullish() });
export type ChannelPage = z.infer<typeof page>;
export type ChannelEntry = z.infer<typeof entry>;
export type SubmissionWork = z.infer<typeof work>;
export type ChannelAction =
  | { kind: "submit"; workId: string }
  | { kind: "settings"; open: boolean }
  | { kind: "review"; workId: string; status: "approved" | "rejected"; expectedVersion: number };
export type ChannelScope = { ipId: string; generation: number; locale: string };
function current(scope: ChannelScope, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (getAuthGeneration() !== scope.generation) throw new Error("Channel session changed.");
}
function path(scope: ChannelScope) {
  return `/ip-commerce/ips/${id.parse(scope.ipId)}/submissions`;
}
export async function fetchChannelSubmissions(
  scope: ChannelScope,
  cursor: string | null,
  signal: AbortSignal
) {
  current(scope, signal);
  const value = page.parse(
    await api.get(path(scope), {
      service: "aurora",
      signal,
      retry: false,
      params: { locale: scope.locale, cursor: cursor ?? undefined },
    })
  );
  current(scope, signal);
  if (value.nextCursor && value.nextCursor === cursor)
    throw new Error("Invalid submissions cursor. Refresh and retry.");
  return value;
}
export async function fetchSubmissionWorks(
  scope: ChannelScope,
  cursor: string | null,
  signal: AbortSignal
) {
  current(scope, signal);
  const value = works.parse(
    await api.get("/ip-commerce/me/ips", {
      service: "aurora",
      signal,
      retry: false,
      params: { locale: scope.locale, cursor: cursor ?? undefined, limit: 50 },
    })
  );
  current(scope, signal);
  if (value.nextCursor && value.nextCursor === cursor)
    throw new Error("Invalid works cursor. Refresh and retry.");
  return {
    ...value,
    items: value.items.filter(
      (item) =>
        item.id !== scope.ipId && item.status === "published" && item.listingVisibility === "public"
    ),
  };
}
export async function changeChannelSubmission(scope: ChannelScope, action: ChannelAction) {
  current(scope);
  const endpoint = path(scope);
  if (action.kind === "submit") {
    z.object({ status: z.literal("pending") }).parse(
      await api.post(endpoint, {
        service: "aurora",
        retry: false,
        data: { workId: id.parse(action.workId) },
      })
    );
  } else if (action.kind === "settings") {
    z.object({ open: z.literal(action.open) }).parse(
      await api.patch(`${endpoint}/settings`, {
        service: "aurora",
        retry: false,
        data: { open: action.open },
      })
    );
  } else {
    const data = z
      .object({
        workId: id,
        status: z.enum(["approved", "rejected"]),
        expectedVersion: z.number().int().nonnegative(),
      })
      .parse(action);
    z.object({ status: z.literal(data.status) }).parse(
      await api.patch(endpoint, { service: "aurora", retry: false, data })
    );
  }
  current(scope);
}
