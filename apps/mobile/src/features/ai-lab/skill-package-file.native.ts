import type { DocumentPickerAsset } from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { uuid } from "expo-modules-core";
import { assertSkillPackageSize, skillPackageMime } from "./skill-package-content";
export async function readSkillPackageFile(asset: DocumentPickerAsset, signal: AbortSignal) {
  signal.throwIfAborted();
  const file = new File(asset.uri);
  if (!file.exists) throw new Error("The selected Skill package is no longer available.");
  assertSkillPackageSize(file.size);
  const bytes = await file.bytes();
  signal.throwIfAborted();
  assertSkillPackageSize(bytes.length);
  return bytes;
}
export function skillPackageForm(bytes: Uint8Array, name: string) {
  const file = new File(Paths.cache, `skill-import-${uuid.v4()}`);
  const dispose = () => {
    try {
      if (file.exists) file.delete();
    } catch {
      /* A cache cleanup failure must not turn a confirmed import into an unknown write. */
    }
  };
  try {
    file.create();
    file.write(bytes);
    const form = new FormData();
    form.append("file", { uri: file.uri, name, type: skillPackageMime(name) } as unknown as Blob);
    return { form, dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}
