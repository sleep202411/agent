import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";

export const contributorRoles = [
  "owner",
  "producer",
  "director",
  "writer",
  "artist",
  "editor",
  "performer",
  "other",
] as const;
const userId = z.string().trim().min(1).max(64);
const fields = z.object({
  displayName: z.string().trim().min(1).max(120),
  userId: userId.nullable(),
  role: z.enum(contributorRoles),
  customRole: z.string().trim().max(80).nullable(),
  revenueEligible: z.boolean(),
  revenueShareBps: z.number().int().min(0).max(10000).nullable(),
});
export const contributorFields = fields.refine(
  (value) => !value.revenueEligible || !!value.userId,
  { message: "Link a platform account before enabling revenue sharing." }
);
const contributor = fields.extend({ id: z.string().uuid(), displayOrder: z.number().int() });
export type Contributor = z.infer<typeof contributor>;
export type ContributorFields = z.infer<typeof contributorFields>;
const snapshot = z.object({
  ip: z.object({ id: z.string().uuid(), title: z.string() }),
  creatorShareBps: z.number().int().min(0).max(10000),
  poolAllocatedBps: z.number().int().nonnegative(),
  contributors: z.array(contributor),
});
export type ContributorSnapshot = z.infer<typeof snapshot>;
export const contributorCommand = z.discriminatedUnion("action", [
  z.object({ clientKey: z.string().uuid(), action: z.literal("create"), data: contributorFields }),
  z.object({
    clientKey: z.string().uuid(),
    action: z.literal("edit"),
    before: contributor,
    data: contributorFields,
  }),
  z.object({ clientKey: z.string().uuid(), action: z.literal("remove"), before: contributor }),
]);
export type ContributorCommand = z.infer<typeof contributorCommand>;
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("IP editing session expired.");
}
export function contributorOutbox(ipId: string, viewerId: string, generation: number) {
  return pendingRequest(
    contributorCommand,
    generation,
    durableRecord("ip-contributor-write", viewerId, z.string().uuid().parse(ipId))
  );
}
export async function fetchContributors(ipId: string, generation: number, signal: AbortSignal) {
  z.string().uuid().parse(ipId);
  current(generation, signal);
  const result = snapshot.parse(
    await api.get(`/ip-commerce/me/ips/${ipId}/contributors`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current(generation, signal);
  if (result.ip.id !== ipId) throw new Error("IP contributor identity mismatch.");
  if (new Set(result.contributors.map((item) => item.id)).size !== result.contributors.length)
    throw new Error("Duplicate contributor identities.");
  const total = result.contributors.reduce(
    (sum, item) => sum + (item.revenueEligible ? (item.revenueShareBps ?? 0) : 0),
    0
  );
  if (total !== result.poolAllocatedBps) throw new Error("IP contributor allocation mismatch.");
  return result;
}
export async function searchContributorUsers(
  query: string,
  generation: number,
  signal: AbortSignal
) {
  const q = z.string().trim().min(3).max(64).parse(query);
  current(generation, signal);
  const result = z
    .object({
      users: z.array(z.object({ userId, nickname: z.string(), avatar: z.string().nullable() })),
    })
    .parse(
      await api.get("/ip-commerce/users/search", {
        service: "aurora",
        signal,
        retry: false,
        params: { q },
      })
    );
  current(generation, signal);
  return result.users;
}
// Use integer hundredths, without floating point rounding or accepting exponent syntax.
export function contributorShare(text: string): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= 10000 ? bps : undefined;
}
export function withinContributorPool(
  items: Contributor[],
  data: ContributorFields,
  except?: string
) {
  return (
    items.reduce(
      (sum, item) =>
        sum + (item.id !== except && item.revenueEligible ? (item.revenueShareBps ?? 0) : 0),
      0
    ) +
      (data.revenueEligible ? (data.revenueShareBps ?? 0) : 0) <=
    10000
  );
}
function matches(a: ContributorFields, b: ContributorFields) {
  return Object.keys(fields.shape).every(
    (key) => a[key as keyof ContributorFields] === b[key as keyof ContributorFields]
  );
}
/** Official contributor writes have no idempotency/version contract. Never replay an unresolved command. */
export async function submitContributor(
  ipId: string,
  viewerId: string,
  generation: number,
  input: ContributorCommand,
  signal: AbortSignal
) {
  const command = contributorCommand.parse(input);
  const outbox = contributorOutbox(ipId, viewerId, generation);
  if (outbox.read())
    throw new Error(
      "A contributor change is unresolved. Refresh and check the contributor list first."
    );
  const latest = await fetchContributors(ipId, generation, signal);
  if (command.action !== "create") {
    const target = latest.contributors.find((item) => item.id === command.before.id);
    if (!target || !matches(target, command.before))
      throw new ApiRequestError(
        "CONTRIBUTOR_CHANGED",
        "This contributor changed. Refresh before editing.",
        409
      );
  }
  if (
    command.action !== "remove" &&
    !withinContributorPool(
      latest.contributors,
      command.data,
      command.action === "edit" ? command.before.id : undefined
    )
  )
    throw new ApiRequestError(
      "CONTRIBUTOR_POOL_EXCEEDED",
      "Contributor shares exceed 100% of the creator pool.",
      400
    );
  current(generation, signal);
  // Persist BEFORE the write. Once sent, a lost reply must be reviewed by the user, including after restart.
  if (outbox.read()) throw new Error("A contributor change is already pending.");
  outbox.save(command);
  const path = `/ip-commerce/me/ips/${ipId}/contributors`;
  if (command.action === "remove") {
    z.object({ removed: z.literal(true) }).parse(
      await api.delete(`${path}/${command.before.id}`, {
        service: "aurora",
        signal,
        retry: false,
      })
    );
  } else {
    const options = {
      service: "aurora" as const,
      signal,
      retry: false as const,
      data: command.data,
    };
    const receipt = contributor.parse(
      command.action === "create"
        ? await api.post(path, options)
        : await api.patch(`${path}/${command.before.id}`, options)
    );
    if (
      !matches(receipt, command.data) ||
      (command.action === "edit" && receipt.id !== command.before.id) ||
      (command.action === "create" && latest.contributors.some((item) => item.id === receipt.id))
    )
      throw new Error("Contributor receipt mismatch. Refresh and check the contributor list.");
  }
  current(generation, signal);
  outbox.clear(command.clientKey);
}
