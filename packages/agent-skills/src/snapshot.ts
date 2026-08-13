import { createHash } from "node:crypto";
import {
  ProjectSkillResolutionSnapshotSchema,
  type ProjectSkillResolutionSnapshot,
} from "./types.js";

/** Canonical JSON used to hash and verify cross-process Skill snapshot integrity. */
export function stableProjectSkillJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Project Skill snapshots require finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Project Skill snapshots require JSON values, received ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableProjectSkillJson).join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Project Skill snapshots require plain JSON objects");
  }
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableProjectSkillJson(row[key])}`)
    .join(",")}}`;
}

export function projectSkillSnapshotChecksum(value: unknown): string {
  return projectSkillVersionChecksum(value);
}

/** Canonical content digest used by immutable published Skill manifests. */
export function projectSkillVersionChecksum(value: unknown): string {
  return createHash("sha256").update(stableProjectSkillJson(value)).digest("hex");
}

export function verifyProjectSkillSnapshot(value: unknown): ProjectSkillResolutionSnapshot | null {
  const parsed = ProjectSkillResolutionSnapshotSchema.safeParse(value);
  if (!parsed.success) return null;
  const { checksum, ...unsigned } = parsed.data;
  return projectSkillSnapshotChecksum(unsigned) === checksum ? parsed.data : null;
}
