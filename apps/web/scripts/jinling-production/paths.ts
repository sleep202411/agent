import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = path.resolve(SCRIPT_ROOT, "../..");
export const REPO_ROOT = path.resolve(WEB_ROOT, "../..");

export const DEFAULT_MANIFEST_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-p00-v01.json"
);

export const DEFAULT_WORK_ROOT = path.join(REPO_ROOT, "tmp/jinling-production");

export function repoRelative(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}
