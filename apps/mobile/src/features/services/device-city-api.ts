import { z } from "zod";
import { CreatorCitySchema } from "@repo/shared/creator-location";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import type { LocationScope } from "./creator-location-api";
const result = z
  .object({
    state: z.enum(["missing", "expired", "completed", "dispatched", "uncertain"]),
    city: z.unknown().transform((value) => CreatorCitySchema.nullable().parse(value)),
  })
  .refine((value) => value.state !== "completed" || value.city !== null);
export type DeviceCityResult = z.infer<typeof result>;
export type DeviceCity = NonNullable<DeviceCityResult["city"]>;
const input = z.object({
  requestId: z.string().uuid(),
  consent: z.literal(true),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
});
function current(scope: LocationScope, signal?: AbortSignal) {
  if (!scope.userId || scope.generation !== getAuthGeneration() || signal?.aborted)
    throw Error("Device city session expired.");
}
export function deviceCityAttempt(scope: LocationScope) {
  current(scope);
  const record = durableRecord("creator-device-city", scope.userId, "attempt");
  return {
    read() {
      current(scope);
      const value = record.read();
      return value ? z.string().uuid().parse(value) : null;
    },
    write(value: string | null) {
      current(scope);
      record.write(value === null ? "" : z.string().uuid().parse(value));
    },
  };
}
export async function suggestDeviceCity(
  scope: LocationScope,
  value: z.infer<typeof input>,
  signal: AbortSignal
) {
  current(scope, signal);
  const data = input.parse(value);
  // Persist only the attempt identity; never device coordinates.
  deviceCityAttempt(scope).write(data.requestId);
  current(scope, signal);
  const response = await api.post("/creator-location/me/device-city", {
    service: "aurora",
    data,
    retry: false,
    signal,
  });
  current(scope, signal);
  return result.parse(response);
}
export async function checkDeviceCity(scope: LocationScope, attempt: string, signal: AbortSignal) {
  current(scope, signal);
  z.string().uuid().parse(attempt);
  const response = await api.get(`/creator-location/me/device-city/${attempt}`, {
    service: "aurora",
    retry: false,
    signal,
  });
  current(scope, signal);
  return result.parse(response);
}
