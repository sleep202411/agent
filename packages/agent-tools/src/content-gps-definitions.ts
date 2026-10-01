import { z } from "zod";
import {
  ContentGpsQuerySchema,
  ContentGpsSearchRequestSchema,
  ContentGpsSearchResultSchema,
} from "@repo/shared/content-gps";
import {
  CreatorDiscoveryRequestSchema,
  CreatorDiscoveryResultSchema,
} from "@repo/shared/creator-location";
import type { ToolDefinition } from "./types.js";

// Viewer, locale, request identity and map scope belong to the trusted host.
// A tool call cannot supply any of them, nor start analysis/geocoding.
export const ContentGpsToolInputSchema = z.strictObject({
  query: ContentGpsQuerySchema.omit({ locale: true }),
  cursor: ContentGpsSearchRequestSchema.shape.cursor,
  limit: z.number().int().min(1).max(10).default(10),
  placeSearch: ContentGpsSearchRequestSchema.shape.placeSearch,
});
export const CreatorGpsToolInputSchema = CreatorDiscoveryRequestSchema.pick({
  query: true,
  cursor: true,
}).extend({ limit: z.number().int().min(1).max(10).default(10) });

export const ContentGpsToolOutputSchema = ContentGpsSearchResultSchema.pick({
  queryId: true,
  query: true,
  items: true,
  nextCursor: true,
  matchedCount: true,
  accessibleCount: true,
  countScope: true,
  places: true,
  placeCount: true,
  placesTruncated: true,
});
export const CreatorGpsToolOutputSchema = CreatorDiscoveryResultSchema.pick({
  queryId: true,
  query: true,
  items: true,
  nextCursor: true,
  matchedCount: true,
  accessibleCount: true,
  requiresLogin: true,
  countScope: true,
});

export const CONTENT_GPS_AGENT_OS_TOOLS = [
  {
    id: "discovery.searchIps",
    description:
      "Search the viewer-accessible published IP catalogue, including beyond the current UI page. Use story_setting locations, overlaps era intervals, and episode duration with unknown=exclude unless explicitly requested otherwise. Use only catalogue place IDs returned in places and supplied genre codes; never invent IDs or infer story era from release year. placeSearch discovers available place names without imposing a location filter. Film duration and mood preferences are not supported: ask to clarify rather than silently dropping conditions. Cursor continues this exact query. Counts state their scope; places may be truncated. Recommend only returned matching items with reasons grounded in their returned fields. This read does not analyze content, geocode, publish, unlock or play it.",
    kind: "query",
    risk: "read",
    inputSchema: ContentGpsToolInputSchema,
    outputSchema: ContentGpsToolOutputSchema,
  },
  {
    id: "discovery.searchCreators",
    description:
      "Search public platform studios with listed services using separate owner-declared Based in and Serves cities, service category/title/tag, remote and availability filters. Based in requires map consent; remote studios can be found without a pin. Counts describe platform studios, not all people in a city. Cursor continues this exact query. Recommend only returned matching studios; do not infer services, certification, creator residence or physical location from their IP stories. This read does not contact a creator, buy a service or request physical location.",
    kind: "query",
    risk: "read",
    inputSchema: CreatorGpsToolInputSchema,
    outputSchema: CreatorGpsToolOutputSchema,
  },
] as const satisfies readonly ToolDefinition[];
