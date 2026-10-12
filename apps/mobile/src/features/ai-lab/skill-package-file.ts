import type { DocumentPickerAsset } from "expo-document-picker";
import { assertSkillPackageSize, skillPackageMime } from "./skill-package-content";
export async function readSkillPackageFile(asset: DocumentPickerAsset, signal: AbortSignal) {
  signal.throwIfAborted();
  let blob: Blob | undefined = asset.file;
  if (!blob) {
    if (!asset.uri.startsWith("blob:"))
      throw new Error("The selected Skill package is no longer available.");
    const response = await fetch(asset.uri, { signal });
    if (!response.ok) throw new Error("Cannot read the selected Skill package.");
    blob = await response.blob();
  }
  assertSkillPackageSize(blob.size);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  assertSkillPackageSize(bytes.length);
  return bytes;
}
export function skillPackageForm(bytes: Uint8Array, name: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: skillPackageMime(name) }), name);
  return { form, dispose: () => {} };
}
