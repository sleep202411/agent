import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { appEnv } from "@/config";

export interface TaskDraftStorage {
  read(): string | null;
  write(value: string): void;
}
export function taskDraftStorageKey(crewId: string, userId: string) {
  const scope = JSON.stringify([appEnv.siteRegion, appEnv.api.auroraBaseUrl, userId, crewId]);
  return `fizz-task-drafts-v1-${bytesToHex(sha256(scope))}`;
}
