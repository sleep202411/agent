import * as DocumentPicker from "expo-document-picker";
import { generationSession } from "./jobs-api";
import { packSkillPackage, assertSkillPackageSize } from "./skill-package-content";
import { readSkillPackageFile } from "./skill-package-file";
export async function pickSkillPackage(generation: number, signal: AbortSignal) {
  generationSession(generation, signal);
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "text/markdown",
      "text/plain",
      "application/zip",
      "application/x-zip-compressed",
      "application/octet-stream",
    ],
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  generationSession(generation, signal);
  if (result.canceled) return null;
  if (result.assets.length !== 1 || !result.assets[0]?.uri)
    throw new Error("Select one Skill package.");
  const asset = result.assets[0];
  if (!/\.(md|zip)$/i.test(asset.name))
    throw new Error("Select a Markdown file or ZIP Skill package.");
  if (asset.size !== undefined) assertSkillPackageSize(asset.size);
  const bytes = await readSkillPackageFile(asset, signal);
  generationSession(generation, signal);
  return packSkillPackage(asset.name, bytes);
}
