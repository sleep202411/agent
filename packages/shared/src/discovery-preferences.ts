import { z } from "zod";

export const DiscoverySiteSchema = z.enum(["global", "cn"]);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const DiscoveryPreferencesSchema = z.strictObject({
  intents: z
    .array(z.enum(["support_nearby_ips", "find_collaborators", "discover_new_ips"]))
    .min(1)
    .max(3)
    .refine(unique),
  interests: z
    .array(z.string().trim().min(1).max(120))
    .min(1)
    .max(20)
    .refine(
      (values) => unique(values.map((value) => value.toLowerCase())),
      "Interests must be distinct"
    ),
  // User-provided search area, not inferred or published device coordinates.
  area: z.string().trim().max(200),
  locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, "Use a valid IANA time zone"),
  channels: z.strictObject({ inApp: z.boolean(), email: z.boolean() }),
});
export type DiscoveryPreferences = z.infer<typeof DiscoveryPreferencesSchema>;
export const DiscoveryPreferenceUpdateSchema = z.strictObject({
  mutationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative().safe(),
  // null explicitly clears the preferences and revokes both channel consents.
  preferences: DiscoveryPreferencesSchema.nullable(),
});
export type DiscoveryPreferenceUpdate = z.infer<typeof DiscoveryPreferenceUpdateSchema>;
export const DiscoveryPreferenceRecordSchema = z.strictObject({
  ownerId: z.string().min(1).max(64),
  site: DiscoverySiteSchema,
  revision: z.number().int().nonnegative().safe(),
  preferences: DiscoveryPreferencesSchema.nullable(),
  deliveryState: z.literal("awaiting_design"),
});
export type DiscoveryPreferenceRecord = z.infer<typeof DiscoveryPreferenceRecordSchema>;

/** Scheduler foundation only: delivery time and presentation are not yet activated. */
export function discoveryLocalDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}
