import { z } from "zod";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
export const SKILL_PACKAGE_MAX_BYTES = 1_048_576;
export const skillPackage = z
  .object({
    name: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (v) => /\.(md|zip)$/i.test(v) && !/[\x00-\x1f/\\]/.test(v),
        "Select a Markdown file or ZIP Skill package."
      ),
    bytes: z.number().int().positive().max(SKILL_PACKAGE_MAX_BYTES),
    hex: z
      .string()
      .min(2)
      .max(SKILL_PACKAGE_MAX_BYTES * 2)
      .regex(/^[a-f0-9]+$/),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .refine((v) => v.hex.length === v.bytes * 2, "Skill package size mismatch.");
export type SkillPackage = z.infer<typeof skillPackage>;
export function assertSkillPackageSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > SKILL_PACKAGE_MAX_BYTES)
    throw new Error("Select a non-empty Skill package no larger than 1 MiB.");
}
export function packSkillPackage(name: string, bytes: Uint8Array): SkillPackage {
  assertSkillPackageSize(bytes.length);
  return skillPackage.parse({
    name,
    bytes: bytes.length,
    hex: bytesToHex(bytes),
    checksum: bytesToHex(sha256(bytes)),
  });
}
export function unpackSkillPackage(value: SkillPackage) {
  const file = skillPackage.parse(value),
    bytes = hexToBytes(file.hex);
  if (bytesToHex(sha256(bytes)) !== file.checksum)
    throw new Error(
      "Saved Skill package checksum mismatch. The original import is retained for review."
    );
  return bytes;
}
export const skillPackageMime = (name: string) =>
  /\.zip$/i.test(name) ? "application/zip" : "text/markdown";
