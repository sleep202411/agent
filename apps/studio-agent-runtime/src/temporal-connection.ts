import { NativeConnection, type TLSConfig } from "@temporalio/worker";
import type { TemporalRuntimeConfig } from "./config.js";

export function connectTemporal(config: TemporalRuntimeConfig): Promise<NativeConnection> {
  const tls: TLSConfig | undefined = config.tls
    ? {
        ...config.tls,
        ...(config.serverName ? { serverNameOverride: config.serverName } : {}),
      }
    : undefined;
  return NativeConnection.connect({
    address: config.address,
    tls,
  });
}
