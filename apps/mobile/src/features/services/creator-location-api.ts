import { z } from "zod";
import {
  CreatorLocationProfileSchema,
  CreatorGeocodeStateSchema,
  SaveCreatorLocationProfileSchema,
  type CreatorGeocodeState,
} from "@repo/shared/creator-location";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";

const path = "/creator-location/me";
const revisionSchema = z.object({
  version: z.number().int().nonnegative(),
  // Shared contracts use Zod 4; Mobile's durable-command envelope uses Zod 3.
  // Parse at the boundary rather than composing schemas from different runtimes.
  profile: z.unknown().transform((value) => CreatorLocationProfileSchema.nullable().parse(value)),
  requestId: z.string().uuid().nullable(),
});
const commandSchema = z
  .object({
    clientKey: z.string().uuid(),
    request: z.unknown().transform((value) => SaveCreatorLocationProfileSchema.parse(value)),
  })
  .refine((value) => value.clientKey === value.request.requestId);
export type LocationRevision = z.infer<typeof revisionSchema>;
export type LocationCommand = z.infer<typeof commandSchema>;
export type LocationScope = { userId: string; generation: number };
export type LocationGeocode = CreatorGeocodeState;
export const emptyLocation = {
  basedIn: null,
  serves: [],
  remote: false,
  showOnMap: false,
};
function current(scope: LocationScope, signal?: AbortSignal) {
  if (!scope.userId || scope.generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Studio location session expired.");
}
export function locationPending(scope: LocationScope) {
  current(scope);
  return pendingRequest(
    commandSchema,
    scope.generation,
    durableRecord("creator-location-save", scope.userId, "owner")
  );
}
export async function readLocation(scope: LocationScope, signal: AbortSignal) {
  current(scope, signal);
  const value = revisionSchema.parse(
    await api.get(path, { service: "aurora", signal, retry: false })
  );
  current(scope, signal);
  return value;
}
function acknowledges(value: LocationRevision, command: LocationCommand) {
  return (
    value.requestId === command.request.requestId &&
    value.version === command.request.expectedVersion + 1 &&
    JSON.stringify(value.profile) === JSON.stringify(command.request.profile)
  );
}
/** Only the exact receipt acknowledges a command. Another writer's revision does not. */
export async function recoverLocation(scope: LocationScope, signal: AbortSignal) {
  const revision = await readLocation(scope, signal);
  const store = locationPending(scope);
  let pending = store.read();
  if (pending && acknowledges(revision, pending)) {
    store.clear(pending.clientKey);
    pending = null;
  }
  return { revision, pending };
}
export async function saveLocation(
  scope: LocationScope,
  input: LocationCommand,
  signal: AbortSignal
) {
  current(scope, signal);
  const command = commandSchema.parse(input),
    store = locationPending(scope);
  store.save(command);
  current(scope, signal);
  const receipt = revisionSchema.parse(
    await api.put(path, {
      service: "aurora",
      signal,
      retry: false,
      data: command.request,
    })
  );
  current(scope, signal);
  if (!acknowledges(receipt, command))
    throw new Error("Studio location save receipt does not match.");
  store.clear(command.clientKey);
  // Replayed saves can acknowledge historical versions. Always read the current revision.
  return readLocation(scope, signal);
}
export async function checkLocationGeocode(scope: LocationScope, signal: AbortSignal) {
  current(scope, signal);
  const result = CreatorGeocodeStateSchema.parse(
    await api.get(`${path}/geocode`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current(scope, signal);
  return result;
}
export async function resolveLocationGeocode(
  scope: LocationScope,
  version: number,
  locale: string,
  signal: AbortSignal
) {
  current(scope, signal);
  const input = z
    .object({
      expectedVersion: z.number().int().positive(),
      locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    })
    .parse({ expectedVersion: version, locale });
  if (locationPending(scope).read()) throw new Error("Confirm your pending location save first.");
  const revision = await readLocation(scope, signal);
  if (revision.version !== version || !revision.profile?.basedIn || !revision.profile.showOnMap)
    throw new Error("Your saved studio location changed. Reload it before resolving.");
  const state = await checkLocationGeocode(scope, signal);
  if (state.version !== version || !["missing", "expired"].includes(state.state))
    throw new Error("Check the existing location attempt instead of resending.");
  current(scope, signal);
  const result = CreatorGeocodeStateSchema.parse(
    await api.post(`${path}/geocode`, {
      service: "aurora",
      signal,
      retry: false,
      data: input,
    })
  );
  current(scope, signal);
  if (result.version !== version)
    throw new Error("Your saved studio location changed. Reload it before resolving.");
  return result;
}
