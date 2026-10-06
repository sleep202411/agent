import {
  DiscoveryPreferenceRecordSchema,
  DiscoveryPreferenceUpdateSchema,
  type DiscoveryPreferenceRecord,
  type DiscoveryPreferenceUpdate,
} from "@repo/shared/discovery-preferences";
import { api } from "@/src/lib/api";

export type PreferenceScope = {
  ownerId: string;
  site: "global" | "cn";
  signal: AbortSignal;
};
const path = "/aurora/me/discovery-preferences";
function current(scope: PreferenceScope) {
  scope.signal.throwIfAborted();
  if (!scope.ownerId) throw new Error("Discovery preference session expired.");
}
function accept(scope: PreferenceScope, raw: unknown): DiscoveryPreferenceRecord {
  current(scope);
  const result = DiscoveryPreferenceRecordSchema.parse(raw);
  if (result.ownerId !== scope.ownerId || result.site !== scope.site)
    throw new Error("Discovery preferences belong to a different account or site.");
  return result;
}
export async function readDiscoveryPreferences(scope: PreferenceScope) {
  current(scope);
  return accept(scope, await api.get(path, { signal: scope.signal, cache: "no-store" }));
}
/** Reuse the same mutationId/input after uncertain transport failure; never silently overwrite a newer revision. */
export async function saveDiscoveryPreferences(
  scope: PreferenceScope,
  input: DiscoveryPreferenceUpdate
) {
  current(scope);
  const data = DiscoveryPreferenceUpdateSchema.parse(input);
  return accept(scope, await api.put(path, { data, signal: scope.signal }));
}
