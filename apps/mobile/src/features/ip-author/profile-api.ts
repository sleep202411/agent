import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { getLocale } from "@/i18n/locale-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const locale = z.enum(["en-US", "zh-CN", "zh-HK"]);
export const profileFields = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(280),
  description: z
    .string()
    .trim()
    .max(3000)
    .nullable()
    .transform((value) => value || null),
  listingVisibility: z.enum(["private", "unlisted", "public"]),
  ageRating: z.enum(["general", "teen", "mature", "restricted"]),
  genreCodes: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
});
const snapshot = profileFields.extend({
  title: z.string(),
  summary: z.string(),
  description: z.string().nullable(),
  genreCodes: z.array(z.string()),
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  sourceLocale: locale,
  status: z.string(),
});
export type IpProfile = z.infer<typeof snapshot>;
export const profileCommand = profileFields.extend({
  clientKey: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  sourceLocale: locale,
});
export type ProfileCommand = z.infer<typeof profileCommand>;
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || getAuthGeneration() !== generation)
    throw new Error("IP editing session expired.");
}
export function profileOutbox(ipId: string, userId: string, generation: number) {
  return pendingRequest(
    profileCommand,
    generation,
    durableRecord("ip-profile-update", userId, z.string().uuid().parse(ipId))
  );
}
/** Editable recovery is separate from an immutable request with an unknown outcome. */
export function profileRecovery(ipId: string, userId: string, generation: number) {
  const storage = durableRecord("ip-profile-recovery", userId, z.string().uuid().parse(ipId));
  const check = () => {
    if (generation !== getAuthGeneration()) throw new Error("IP editing session expired.");
  };
  const read = () => {
    check();
    const raw = storage.read();
    return raw === null ? null : profileCommand.nullable().parse(JSON.parse(raw));
  };
  return {
    read,
    save(command: ProfileCommand) {
      check();
      const previous = read();
      if (previous && previous.clientKey !== command.clientKey)
        throw new Error("Another IP draft needs review. Reopen this IP.");
      storage.write(JSON.stringify(profileCommand.parse(command)));
    },
    clear(clientKey: string) {
      check();
      const previous = read();
      if (previous && previous.clientKey !== clientKey)
        throw new Error("Another IP draft needs review. Reopen this IP.");
      storage.write("null");
    },
  };
}
export async function fetchIpProfile(
  ipId: string,
  generation: number,
  signal: AbortSignal
): Promise<IpProfile> {
  z.string().uuid().parse(ipId);
  current(generation, signal);
  const read = async (language: string) => {
    const result = z.object({ ip: snapshot }).parse(
      await api.get(`/ip-commerce/me/ips/${ipId}`, {
        service: "aurora",
        signal,
        retry: false,
        params: { locale: language },
      })
    ).ip;
    current(generation, signal);
    if (result.id !== ipId) throw new Error("IP profile identity mismatch.");
    return result;
  };
  const language = getLocale();
  const first = await read(language);
  // Profile mutations edit the source localization, not the viewer's translated copy.
  if (first.sourceLocale === language) return first;
  const source = await read(first.sourceLocale);
  if (source.sourceLocale !== first.sourceLocale)
    throw new Error("IP source language changed. Refresh this IP.");
  return source;
}
export async function fetchProfileGenres(signal: AbortSignal) {
  const result = z
    .object({ items: z.array(z.object({ type: z.string(), code: z.string(), label: z.string() })) })
    .parse(
      await api.get("/ip-commerce/taxonomy", {
        service: "aurora",
        signal,
        params: { locale: getLocale() },
      })
    );
  return result.items.filter((item) => item.type === "genre");
}
export function profileMatches(a: z.infer<typeof profileFields>, b: z.infer<typeof profileFields>) {
  return (
    a.title === b.title &&
    a.summary === b.summary &&
    a.description === b.description &&
    a.listingVisibility === b.listingVisibility &&
    a.ageRating === b.ageRating &&
    [...a.genreCodes].sort().join("\0") === [...b.genreCodes].sort().join("\0")
  );
}
export async function saveIpProfile(
  ipId: string,
  generation: number,
  input: ProfileCommand,
  signal: AbortSignal
) {
  const command = profileCommand.parse(input);
  const latest = await fetchIpProfile(ipId, generation, signal);
  if (latest.sourceLocale !== command.sourceLocale)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "IP source language changed. Refresh this IP.",
      409
    );
  if (latest.version > command.expectedVersion && profileMatches(latest, command)) return latest;
  if (latest.version !== command.expectedVersion)
    throw new ApiRequestError(
      "IP_VERSION_CONFLICT",
      "This IP was updated elsewhere. Refresh and try again.",
      409
    );
  const fields = profileFields.parse(command);
  current(generation, signal);
  const saved = z.object({ ip: snapshot }).parse(
    await api.put(`/ip-commerce/me/ips/${ipId}`, {
      service: "aurora",
      signal,
      retry: false,
      data: { ...fields, expectedVersion: command.expectedVersion },
    })
  ).ip;
  current(generation, signal);
  if (
    saved.id !== ipId ||
    saved.sourceLocale !== command.sourceLocale ||
    saved.version <= command.expectedVersion ||
    !profileMatches(saved, command)
  )
    throw new Error("IP profile receipt mismatch. Retry to check the saved result.");
  return saved;
}
