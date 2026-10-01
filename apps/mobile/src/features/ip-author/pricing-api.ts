import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { getLocale } from "@/i18n/locale-store";
import { durableRecord } from "@/lib/durable-record";
const id = z.string().uuid(),
  version = z.number().int().nonnegative();
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,18}$/)
  .transform((value) => BigInt(value).toString());
const date = z.string().datetime({ offset: true }).nullable();
export const priceFields = z
  .object({
    amount: amount.refine((value) => BigInt(value) > 0n),
    originalAmount: amount.nullable(),
    startsAt: date,
    endsAt: date,
  })
  .refine(
    (value) => !value.originalAmount || BigInt(value.originalAmount) >= BigInt(value.amount),
    "The original amount must be at least the price."
  )
  .refine(
    (value) =>
      !value.startsAt || !value.endsAt || Date.parse(value.endsAt) > Date.parse(value.startsAt),
    "The end must be after the start."
  );
export type PriceFields = z.infer<typeof priceFields>;
const rule = z.object({
  id,
  targetType: z.enum(["ip", "episode"]),
  currency: z.literal("community_point"),
  amount,
  originalAmount: amount.nullable(),
  startsAt: date,
  endsAt: date,
  campaignId: id.nullable(),
  status: z.string().optional(),
});
const snapshotSchema = z.object({
  id,
  version,
  title: z.string(),
  price: rule.nullable(),
  priceRules: z.array(rule),
  episodes: z.array(
    z.object({
      id,
      title: z.string(),
      status: z.string(),
      isFreePreview: z.boolean(),
      price: rule.nullable(),
    })
  ),
});
export type PricingSnapshot = z.infer<typeof snapshotSchema>;
export const pricingCommand = z.discriminatedUnion("action", [
  z.object({
    clientKey: id,
    expectedVersion: version,
    episodeId: id.nullable(),
    initialPreview: z.boolean(),
    action: z.literal("price"),
    data: priceFields,
  }),
  z.object({
    clientKey: id,
    expectedVersion: version,
    episodeId: id,
    initialPreview: z.boolean(),
    action: z.enum(["preview", "unpriced"]),
  }),
]);
export type PricingCommand = z.infer<typeof pricingCommand>;
const checkpointSchema = z.object({
  command: pricingCommand,
  index: z.number().int().min(0).max(2),
  expectedVersion: version,
});
export type PricingCheckpoint = z.infer<typeof checkpointSchema>;
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || getAuthGeneration() !== generation)
    throw new Error("IP pricing session expired.");
}
function steps(command: PricingCommand) {
  return command.action === "price"
    ? [...(command.episodeId && command.initialPreview ? ["paid" as const] : []), "price" as const]
    : ["disable" as const, command.action === "preview" ? ("free" as const) : ("paid" as const)];
}
export function pricingOutbox(ipId: string, userId: string, generation: number) {
  const storage = durableRecord("ip-pricing", userId, id.parse(ipId));
  const read = () => {
    current(generation);
    const raw = storage.read();
    if (!raw) return null;
    const value = z
      .object({ version: z.literal(1), pending: checkpointSchema.nullable() })
      .parse(JSON.parse(raw)).pending;
    if (
      value &&
      (value.index > steps(value.command).length ||
        value.expectedVersion !== value.command.expectedVersion + value.index)
    )
      throw new Error("Invalid pricing checkpoint.");
    return value;
  };
  const write = (pending: PricingCheckpoint | null) =>
    storage.write(JSON.stringify({ version: 1, pending }));
  return {
    read,
    start(input: PricingCommand) {
      current(generation);
      const command = pricingCommand.parse(input),
        old = read();
      if (old) {
        if (JSON.stringify(old.command) !== JSON.stringify(command))
          throw new Error("Another pricing change is pending. Review it first.");
        return old;
      }
      const value = { command, index: 0, expectedVersion: command.expectedVersion };
      write(value);
      return value;
    },
    advance(old: PricingCheckpoint) {
      current(generation);
      if (JSON.stringify(read()) !== JSON.stringify(old))
        throw new Error("The pending pricing change was replaced.");
      const next = { ...old, index: old.index + 1, expectedVersion: old.expectedVersion + 1 };
      write(next);
      return next;
    },
    clear(key: string) {
      current(generation);
      const old = read();
      if (old && old.command.clientKey !== key)
        throw new Error("Another pricing change is pending.");
      write(null);
    },
  };
}
function normalize(ipId: string, input: unknown) {
  const value = z.object({ ip: snapshotSchema }).parse(input).ip;
  if (
    value.id !== ipId ||
    new Set(value.episodes.map((item) => item.id)).size !== value.episodes.length
  )
    throw new Error("Pricing IP identity mismatch.");
  return value;
}
export async function fetchPricing(ipId: string, generation: number, signal: AbortSignal) {
  current(generation, signal);
  id.parse(ipId);
  const result = normalize(
    ipId,
    await api.get(`/ip-commerce/me/ips/${ipId}`, {
      service: "aurora",
      signal,
      retry: false,
      params: { locale: getLocale() },
    })
  );
  current(generation, signal);
  return result;
}
function samePrice(candidate: z.infer<typeof rule>, data: PriceFields) {
  return (
    candidate.amount === data.amount &&
    candidate.originalAmount === data.originalAmount &&
    (candidate.startsAt ? Date.parse(candidate.startsAt) : null) ===
      (data.startsAt ? Date.parse(data.startsAt) : null) &&
    (candidate.endsAt ? Date.parse(candidate.endsAt) : null) ===
      (data.endsAt ? Date.parse(data.endsAt) : null)
  );
}
function observed(value: PricingSnapshot, checkpoint: PricingCheckpoint) {
  const command = checkpoint.command,
    step = steps(command)[checkpoint.index],
    episode = value.episodes.find((item) => item.id === command.episodeId);
  if (step === "free" || step === "paid")
    return !!episode && episode.isFreePreview === (step === "free");
  if (step === "price" && command.action === "price")
    return command.episodeId
      ? !!episode?.price && !episode.price.campaignId && samePrice(episode.price, command.data)
      : value.priceRules.some(
          (item) =>
            item.targetType === "ip" &&
            !item.campaignId &&
            item.status === "active" &&
            samePrice(item, command.data)
        );
  // A missing active episode price does not prove a scheduled rule was removed.
  return false;
}
export async function savePricing(
  ipId: string,
  userId: string,
  generation: number,
  input: PricingCommand,
  signal: AbortSignal
) {
  current(generation, signal);
  const command = pricingCommand.parse(input),
    box = pricingOutbox(ipId, userId, generation);
  let checkpoint = box.start(command),
    snapshot = await fetchPricing(ipId, generation, signal);
  while (checkpoint.index < steps(command).length) {
    current(generation, signal);
    if (JSON.stringify(box.read()) !== JSON.stringify(checkpoint))
      throw new Error("The pending pricing change was replaced.");
    const episode = snapshot.episodes.find((item) => item.id === command.episodeId);
    if (command.episodeId && !episode)
      throw new Error("Episode no longer exists. Review the pending pricing change.");
    if (snapshot.version === checkpoint.expectedVersion + 1 && observed(snapshot, checkpoint)) {
      checkpoint = box.advance(checkpoint);
      continue;
    }
    if (snapshot.version !== checkpoint.expectedVersion)
      throw new ApiRequestError(
        "IP_VERSION_CONFLICT",
        "Pricing changed or a response was lost. Refresh and review before starting a new change.",
        409
      );
    const step = steps(command)[checkpoint.index];
    const data =
      step === "free" || step === "paid"
        ? { isFreePreview: step === "free", expectedVersion: checkpoint.expectedVersion }
        : {
            targetType: command.episodeId ? "episode" : "ip",
            ...(command.episodeId ? { episodeId: command.episodeId } : {}),
            status: step === "disable" ? "disabled" : "active",
            currency: "community_point",
            maxPerUser: null,
            ...(step === "price" && command.action === "price" ? command.data : {}),
            expectedVersion: checkpoint.expectedVersion,
          };
    snapshot = normalize(
      ipId,
      await api.put(
        `/ip-commerce/me/ips/${ipId}/${step === "free" || step === "paid" ? `episodes/${command.episodeId}` : "price-rules"}`,
        { service: "aurora", signal, retry: false, data }
      )
    );
    current(generation, signal);
    if (snapshot.version !== checkpoint.expectedVersion + 1)
      throw new Error("Pricing receipt version mismatch. Review the saved result.");
    if ((step === "free" || step === "paid") && !observed(snapshot, checkpoint))
      throw new Error("Preview receipt mismatch.");
    // A successful versioned price-rule receipt is bound to this request, even if its schedule is not active yet.
    if (
      step === "price" &&
      command.action === "price" &&
      !snapshot.priceRules.some(
        (item) =>
          item.targetType === (command.episodeId ? "episode" : "ip") &&
          !item.campaignId &&
          item.status === "active" &&
          samePrice(item, command.data)
      )
    )
      throw new Error("Price receipt mismatch.");
    checkpoint = box.advance(checkpoint);
  }
  box.clear(command.clientKey);
  return snapshot;
}
/** Device-local wall-clock fields, validated by round-trip to reject impossible dates. */
export function parsePriceDate(value: string): string | null {
  if (!value.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Use YYYY-MM-DD HH:mm in your device timezone.");
  const [, y, m, d, h, n] = match.map(Number),
    date = new Date(y, m - 1, d, h, n);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== n
  )
    throw new Error("Enter a valid local date and time.");
  return date.toISOString();
}
export function priceDateText(value: string | null) {
  if (!value) return "";
  const date = new Date(value),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
