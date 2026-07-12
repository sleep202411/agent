import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { JINLING_MEDIA_RELEASE } from "../../src/features/jinling-rumeng/content/media-release";
import { WEB_ROOT } from "./paths";

const OUTPUT_PATH = path.join(
  WEB_ROOT,
  "src/features/jinling-rumeng/production/manifests/s01-azure-media-release-v1.json"
);

const SOURCES = [
  {
    localRoot: path.join(WEB_ROOT, "public/jinling-rumeng/production/audio"),
    objectRoot: "audio",
    extension: ".wav",
    kind: "audio",
    contentType: "audio/wav",
  },
  {
    localRoot: path.join(WEB_ROOT, "public/jinling-rumeng/production/p00/video"),
    objectRoot: "p00",
    extension: ".mp4",
    kind: "video",
    contentType: "video/mp4",
  },
  {
    localRoot: path.join(WEB_ROOT, "public/jinling-rumeng/production/story/film-cut-v2"),
    objectRoot: "film-cut-v2",
    extension: ".mp4",
    kind: "video",
    contentType: "video/mp4",
  },
] as const;

async function sha256(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

async function collectFiles(root: string, extension: string, relativeRoot = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relativeRoot), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(relativeRoot, entry.name);
      if (entry.isDirectory()) return collectFiles(root, extension, relativePath);
      return entry.isFile() && entry.name.endsWith(extension) ? [relativePath] : [];
    })
  );
  return nested.flat();
}

async function main(): Promise<void> {
  const assets = [];

  for (const source of SOURCES) {
    const relativePaths = await collectFiles(source.localRoot, source.extension);
    for (const relativePath of relativePaths.sort()) {
      const absolutePath = path.join(source.localRoot, relativePath);
      const objectPath = `${source.objectRoot}/${relativePath.split(path.sep).join("/")}`;
      const objectKey = `${JINLING_MEDIA_RELEASE.objectPrefix}/${objectPath}`;
      const fileStat = await stat(absolutePath);
      assets.push({
        assetId: objectPath
          .replace(new RegExp(`${source.extension.replace(".", "\\.")}$`), "")
          .replaceAll("/", ":"),
        kind: source.kind,
        contentType: source.contentType,
        bytes: fileStat.size,
        sha256: await sha256(absolutePath),
        objectKey,
        publicUrl: `${JINLING_MEDIA_RELEASE.publicRoot}/${objectKey}`,
      });
    }
  }

  const manifest = {
    schemaVersion: 1,
    releaseId: JINLING_MEDIA_RELEASE.releaseId,
    provider: JINLING_MEDIA_RELEASE.provider,
    container: JINLING_MEDIA_RELEASE.container,
    objectPrefix: JINLING_MEDIA_RELEASE.objectPrefix,
    cacheControl: "public,max-age=31536000,immutable",
    publishedAt: "2026-07-12T10:17:34.000Z",
    assets,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${assets.length} assets to ${path.relative(WEB_ROOT, OUTPUT_PATH)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
