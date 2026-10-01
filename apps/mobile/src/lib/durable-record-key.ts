import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { appEnv } from "@/config";
export interface DurableRecord {
  read(): string | null;
  write(value: string): void;
}
export function durableRecordKey(namespace: string, userId: string, identity: string) {
  const scope = JSON.stringify([
    namespace,
    appEnv.siteRegion,
    appEnv.api.auroraBaseUrl,
    userId,
    identity,
  ]);
  return `fizz-record-v1-${bytesToHex(sha256(scope))}`;
}
