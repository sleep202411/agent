import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type ExperienceRuntimeManifest } from '@repo/shared/experience-runtime';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { OutputStorageService } from '../infra/storage/storage.types';
import { canonicalJsonHash, canonicalJsonString } from './canonical-json';

/**
 * A chapter Runtime Manifest is published as its own object, and the Game
 * Manifest points at it. Java never sees these bytes — it only stores the URL
 * we hand it — so this object IS the chapter's permanent runtime address.
 *
 * Uses the same validated write storage as generation and uploads.
 */
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
    private readonly storage: OutputStorageService,
    private readonly urls: MediaAssetUrlResolverService,
  ) {}

  /**
   * The permanent public URL a chapter manifest will have, resolvable BEFORE
   * the bytes are uploaded. The Game Manifest — and therefore the release
   * contentVersion derived from it — is assembled from these URLs, so they
   * must be a pure function of the Build rather than of an upload response.
   */
  publicUrl(object: StoryChapterManifestObject): string {
    return this.urls.resolve(
      this.storage.objectLocation(storyChapterManifestKey(object)),
    );
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
    const result = await this.storage.upload({
      body: Buffer.from(canonical, 'utf8'),
      key: storyChapterManifestKey(object),
      contentType: CHAPTER_MANIFEST_CONTENT_TYPE,
    });
    return { key: result.storagePath, url, manifestHash };
  }
}
