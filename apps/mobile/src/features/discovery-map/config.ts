import { mapProviderConfigSchema } from "./protocol";
import type { GpsMapConfig } from "./content-gps-map-types";
export type DiscoveryMapConfig = { documentUrl: string; provider: GpsMapConfig };
export function parseDiscoveryMapConfig(
  raw: unknown,
  region: "global" | "cn",
  production: boolean
): DiscoveryMapConfig | null {
  if (raw == null) return null;
  const value = raw as Record<string, unknown>;
  if (value.enabled === "false") return null;
  if (value.enabled !== "true") throw Error("Invalid Mobile discovery map enabled setting.");
  const provider = mapProviderConfigSchema.parse(
    value.provider === "google"
      ? {
          provider: value.provider,
          key: value.key,
          mapId: value.mapId,
        }
      : { provider: value.provider, key: value.key, securityProxyPath: value.securityProxyPath }
  );
  if (provider.provider !== (region === "cn" ? "gaode" : "google"))
    throw Error("Mobile discovery map provider does not match the app region.");
  if (typeof value.documentUrl !== "string")
    throw Error("Mobile discovery map document URL is required.");
  const url = new URL(value.documentUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local && !production)) ||
    (production && local)
  )
    throw Error("Mobile discovery map requires a hosted HTTPS document URL.");
  return { documentUrl: url.href, provider };
}
