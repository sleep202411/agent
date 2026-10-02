import { z } from "zod";
import { ContentGpsSearchRequestSchema } from "@repo/shared/content-gps";
import type { GpsMapFeature, GpsMapConfig, GpsViewport } from "./content-gps-map-types";

const feature = z
  .object({
    id: z.string().min(1).max(500),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    coordinateSystem: z.enum(["WGS84", "GCJ02"]),
    label: z.string().max(1000),
    matched: z.boolean(),
    selected: z.boolean(),
    count: z.number().int().nonnegative().safe(),
    entityId: z.string().min(1).max(100).nullable(),
  })
  .strict();
export const mapProviderConfigSchema = z.union([
  z
    .object({
      provider: z.literal("google"),
      key: z.string().trim().min(1).max(500),
      mapId: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      provider: z.literal("gaode"),
      key: z.string().trim().min(1).max(500),
      securityProxyPath: z.string().regex(/^\/[A-Za-z0-9_-][A-Za-z0-9/_-]*$/),
    })
    .strict(),
]);
const envelope = z.object({
  version: z.literal(1),
  channel: z.string().min(20).max(100),
  sequence: z.number().int().nonnegative().safe(),
});
const command = z.discriminatedUnion("type", [
  envelope
    .extend({
      type: z.literal("initialize"),
      config: mapProviderConfigSchema,
      viewport: z.unknown(),
    })
    .strict(),
  envelope.extend({ type: z.literal("features"), features: z.array(feature).max(500) }).strict(),
  envelope
    .extend({ type: z.literal("zoom"), delta: z.union([z.literal(-1), z.literal(1)]) })
    .strict(),
  envelope
    .extend({
      type: z.literal("focus"),
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    })
    .strict(),
]);
export type MapCommand =
  | { type: "initialize"; config: GpsMapConfig; viewport: GpsViewport; sequence: number }
  | { type: "features"; features: GpsMapFeature[]; sequence: number }
  | { type: "zoom"; delta: -1 | 1; sequence: number }
  | { type: "focus"; latitude: number; longitude: number; sequence: number };
export type MapEvent =
  | { type: "ready" }
  | { type: "loaded" }
  | { type: "viewport"; viewport: GpsViewport }
  | { type: "activate"; id: string; sequence: number }
  | { type: "error"; reason: string };
export function readMapCommand(raw: unknown, channel: string): MapCommand | null {
  try {
    if (typeof raw === "string") {
      if (raw.length > 1000000) return null;
      raw = JSON.parse(raw);
    }
    const parsed = command.safeParse(raw);
    if (!parsed.success || parsed.data.channel !== channel) return null;
    if (parsed.data.type !== "initialize") return parsed.data;
    const viewport = ContentGpsSearchRequestSchema.shape.map.safeParse(parsed.data.viewport);
    if (
      !viewport.success ||
      viewport.data.coordinateSystem !==
        (parsed.data.config.provider === "google" ? "WGS84" : "GCJ02")
    )
      return null;
    return { ...parsed.data, viewport: viewport.data };
  } catch {
    return null;
  }
}

const eventEnvelope = z.object({ version: z.literal(1), channel: z.string().min(20).max(100) });
const eventSchema = z.discriminatedUnion("type", [
  eventEnvelope.extend({ type: z.literal("ready") }).strict(),
  eventEnvelope.extend({ type: z.literal("loaded") }).strict(),
  eventEnvelope.extend({ type: z.literal("viewport"), viewport: z.unknown() }).strict(),
  eventEnvelope
    .extend({
      type: z.literal("activate"),
      id: z.string().min(1).max(500),
      sequence: z.number().int().nonnegative().safe(),
    })
    .strict(),
  eventEnvelope
    .extend({
      type: z.literal("error"),
      reason: z.enum(["configuration", "load", "authentication", "coordinates", "conflict"]),
    })
    .strict(),
]);
export function readMapEvent(raw: unknown, channel: string): MapEvent | null {
  try {
    if (typeof raw === "string") {
      if (raw.length > 10000) return null;
      raw = JSON.parse(raw);
    }
    const result = eventSchema.safeParse(raw);
    if (!result.success || result.data.channel !== channel) return null;
    if (result.data.type !== "viewport") return result.data;
    const viewport = ContentGpsSearchRequestSchema.shape.map.safeParse(result.data.viewport);
    return viewport.success ? { ...result.data, viewport: viewport.data } : null;
  } catch {
    return null;
  }
}
