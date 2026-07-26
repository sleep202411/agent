import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import { type ExperienceRuntimeManifest } from '@repo/shared/experience-runtime';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import { canonicalJsonHash, canonicalJsonString } from './canonical-json';

/**
 * A chapter Runtime Manifest is published as its own object, and the Game
 * Manifest points at it. Java never sees these bytes — it only stores the URL
 * we hand it — so this object IS the chapter's permanent runtime address.
 *
 * Chapter manifests pin `s3_compatible` explicitly instead of taking the cell
 * default: the cell default is Azure Blob, whose public host is not the R2
 * custom domain the release URLs are meant to live on. This is the same
 * per-unit-of-work provider pin an AI job uses.
 */
const CHAPTER_MANIFEST_PROVIDER = MediaStorageProvider.s3_compatible;
const CHAPTER_MANIFEST_CONTENT_TYPE = 'application/json';

export interface StoryChapterManifestObject {
  projectId: string;
  buildId: string;
  /** `StoryBuild.runtimeHash` — the digest of the canonical manifest bytes. */
  runtimeHash: string;
}

export interface StoryChapterManifestPlacement {
  key: string;
  url: string;
  manifestHash: string;
}

/**
 * Object key for one chapter manifest.
 *
 * Three segments, each ruling out one collision:
 * - `projectId` — two projects cannot share a key, so a takedown or a rewrite
 *   inside one project can never reach another project's chapter.
 * - `buildId` — a Build is immutable and uniquely identified, so two chapters
 *   of the same project, and two rebuilds of the same chapter, always land on
 *   different keys. Nothing published is ever overwritten by later authoring.
 * - `runtimeHash` — the digest of the exact bytes stored, which makes the key
 *   content-addressed: re-publishing the same Build writes byte-identical
 *   content to the same key, and content that differs cannot reuse the key.
 */
export function storyChapterManifestKey(
  object: StoryChapterManifestObject,
): string {
  return `story-chapters/${object.projectId}/${object.buildId}/${object.runtimeHash}.json`;
}

@Injectable()
export class StoryChapterManifestStorageService {
  constructor(
    private readonly registry: StorageProviderRegistry,
    private readonly urls: MediaAssetUrlResolverService,
  ) {}

  /**
   * The permanent public URL a chapter manifest will have, resolvable BEFORE
   * the bytes are uploaded. The Game Manifest — and therefore the release
   * contentVersion derived from it — is assembled from these URLs, so they
   * must be a pure function of the Build rather than of an upload response.
   */
  publicUrl(object: StoryChapterManifestObject): string {
    // Without the public base URL the resolver falls back to an AWS host shape
    // that does not exist for R2. Publishing that URL would hand Java a
    // permanently dead manifest address, so refuse instead.
    if (!process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE?.trim()) {
      throw new ServiceUnavailableException({
        code: 'STORY_CHAPTER_MANIFEST_PUBLIC_URL_UNCONFIGURED',
        message:
          'MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE must name the public bucket domain before a chapter manifest can be published.',
      });
    }
    return this.urls.resolve({
      storageProvider: CHAPTER_MANIFEST_PROVIDER,
      bucket: this.requireBucket(),
      region: null,
      objectKey: storyChapterManifestKey(object),
      externalUrl: null,
    });
  }

  /** Where a chapter manifest will live, resolved without any storage call. */
  placement(object: StoryChapterManifestObject): StoryChapterManifestPlacement {
    return {
      key: storyChapterManifestKey(object),
      url: this.publicUrl(object),
      manifestHash: object.runtimeHash,
    };
  }

  /**
   * Uploads the chapter manifest and returns where it now lives. Safe to
   * re-run: the key is content-addressed, so a repeated upload replaces the
   * object with identical bytes.
   */
  async upload(
    object: StoryChapterManifestObject,
    manifest: ExperienceRuntimeManifest,
  ): Promise<StoryChapterManifestPlacement> {
    const url = this.publicUrl(object);
    // Stored in the same canonical form the Build hashed, so the digest of the
    // published bytes IS `StoryBuild.runtimeHash`.
    const canonical = canonicalJsonString(manifest);
    const manifestHash = canonicalJsonHash(manifest);
    if (manifestHash !== object.runtimeHash) {
      throw new ServiceUnavailableException({
        code: 'STORY_CHAPTER_MANIFEST_HASH_MISMATCH',
        message:
          'The chapter manifest bytes do not hash to the Build runtime hash the key is addressed by.',
      });
    }
    const storage = this.requireStorage();
    const result = await storage.upload({
      body: Buffer.from(canonical, 'utf8'),
      key: storyChapterManifestKey(object),
      contentType: CHAPTER_MANIFEST_CONTENT_TYPE,
    });
    return { key: result.storagePath, url, manifestHash };
  }

  private requireStorage() {
    const storage = this.registry.forProvider(CHAPTER_MANIFEST_PROVIDER);
    if (!storage) {
      throw new ServiceUnavailableException({
        code: 'STORY_CHAPTER_MANIFEST_STORAGE_UNAVAILABLE',
        message: 'Chapter manifest storage is not configured.',
      });
    }
    return storage;
  }

  private requireBucket(): string {
    const bucket = process.env.S3_BUCKET?.trim();
    if (!bucket) {
      throw new ServiceUnavailableException({
        code: 'STORY_CHAPTER_MANIFEST_STORAGE_UNAVAILABLE',
        message: 'S3_BUCKET must be configured to publish a chapter manifest.',
      });
    }
    return bucket;
  }
}
