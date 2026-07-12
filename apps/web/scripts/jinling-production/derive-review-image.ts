import { constants } from "node:fs";
import { chmod, copyFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { RunnerError } from "./errors";
import { inspectLocalReferenceImage, type StoredImage } from "./image-file";

const MAX_SEEDREAM_PIXELS = 16_777_216;

export async function finalizeImmutableSource(
  stored: StoredImage,
  finalPath: string
): Promise<StoredImage> {
  await failIfExists(finalPath, "Immutable provider source already exists for this fingerprint.");
  await rename(stored.path, finalPath);
  try {
    await chmod(finalPath, 0o444);
  } catch {
    await rm(finalPath, { force: true }).catch(() => undefined);
    throw new RunnerError("OUTPUT_INVALID", "Provider source could not be made immutable.");
  }
  return { ...stored, path: finalPath };
}

/**
 * Preserve the provider source separately, then apply only the manifest's
 * explicit review-only Lanczos3 derivation. Same-size PNG sources are copied
 * byte-for-byte; conversions/upscales remain full-colour and never crop. A
 * provider may round a semantic aspect ratio by a few pixels; sub-1% drift is
 * normalized during the review derivation and is never promoted as a master.
 */
export async function deriveReviewPng(input: {
  source: StoredImage;
  destinationPath: string;
  maxBytes: number;
  derivation: {
    purpose: "review-only";
    method: "lanczos3";
    sourceDimensions: { width: number; height: number };
    targetDimensions: { width: number; height: number };
  };
}): Promise<StoredImage> {
  assertReviewDerivation(input.derivation);
  const partPath = `${input.destinationPath}.part`;
  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  await failIfExists(
    input.destinationPath,
    "A derived REVIEW artifact already exists for this fingerprint."
  );
  await rm(partPath, { force: true });
  try {
    const requiresResize =
      input.derivation.sourceDimensions.width !== input.derivation.targetDimensions.width ||
      input.derivation.sourceDimensions.height !== input.derivation.targetDimensions.height;
    if (input.source.format === "png" && !requiresResize) {
      await copyFile(input.source.path, partPath, constants.COPYFILE_EXCL);
    } else {
      let pipeline = sharp(input.source.path, {
        failOn: "error",
        limitInputPixels: MAX_SEEDREAM_PIXELS,
        sequentialRead: true,
      });
      if (requiresResize) {
        pipeline = pipeline.resize({
          width: input.derivation.targetDimensions.width,
          height: input.derivation.targetDimensions.height,
          fit: "fill",
          kernel: sharp.kernel.lanczos3,
          withoutEnlargement: false,
        });
      }
      await pipeline
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: false,
          force: true,
        })
        .toFile(partPath);
    }

    const metadata = await stat(partPath);
    if (metadata.size <= 0 || metadata.size > input.maxBytes) {
      throw new RunnerError(
        "OUTPUT_INVALID",
        "Derived PNG is empty or exceeds the output size limit."
      );
    }
    const handle = await open(partPath, "r+");
    await handle.sync();
    await handle.close();
    const inspected = await inspectLocalReferenceImage(partPath, input.maxBytes);
    if (inspected.format !== "png") {
      throw new RunnerError("OUTPUT_INVALID", "Sharp derivation did not produce a PNG.");
    }
    await rename(partPath, input.destinationPath);
    return {
      path: input.destinationPath,
      sha256: inspected.sha256,
      bytes: inspected.bytes,
      mimeType: inspected.mimeType,
      format: inspected.format,
    };
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function assertReviewDerivation(input: {
  purpose: "review-only";
  method: "lanczos3";
  sourceDimensions: { width: number; height: number };
  targetDimensions: { width: number; height: number };
}): void {
  if (input.purpose !== "review-only" || input.method !== "lanczos3") {
    throw new RunnerError(
      "ASSET_INVALID",
      "Image derivation must be the explicit review-only Lanczos3 contract."
    );
  }
  const { sourceDimensions: source, targetDimensions: target } = input;
  const aspectDrift = Math.abs(source.width / source.height - target.width / target.height);
  if (target.width < source.width || target.height < source.height || aspectDrift > 0.01) {
    throw new RunnerError(
      "ASSET_INVALID",
      "Review derivation must be a same-aspect, no-crop Lanczos3 upscale."
    );
  }
}

async function failIfExists(filePath: string, message: string): Promise<void> {
  try {
    await stat(filePath);
    throw new RunnerError("JOURNAL_CONFLICT", message);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
