import { boundMusicAssetIds, resolveStoryMusicUrls } from './story-music-media';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-00000000aa01';
const THEME_ASSET_ID = '0197f4a2-0800-7000-8000-000000000008';
const ECHO_ASSET_ID = '0197f4a2-0800-7000-8000-000000000009';

/**
 * Two scenes on one theme plus a second track: three bindings, two files.
 */
function draft(
  bindings: Record<string, string> = {},
): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: '',
      synopsis: '',
      worldview: '',
      characters: [],
      endings: [],
    },
    graph: {
      entryNodeId: 'node.one',
      nodes: ['node.one', 'node.two', 'node.three'].map((nodeId) => ({
        kind: 'text' as const,
        nodeId,
        body: { 'en-US': nodeId },
        ...(bindings[nodeId]
          ? { music: { mediaAssetId: bindings[nodeId] } }
          : {}),
        exit: { kind: 'auto' as const, nextNodeId: null },
      })),
    },
    productionNotes: [],
  };
}

function prismaReturning(rows: unknown[]) {
  const queries: unknown[] = [];
  const findMany = jest.fn((args: unknown) => {
    queries.push(args);
    return Promise.resolve(rows);
  });
  return { db: { mediaAsset: { findMany } }, findMany, queries };
}

/** A ready, resolvable audio asset with a primary placement. */
function readyAudio(id: string, objectKey: string) {
  return {
    id,
    storageProvider: 'azure_blob',
    bucket: 'media',
    region: null,
    objectKey,
    externalUrl: null,
    status: 'ready',
    moderationStatus: 'approved',
    deletedAt: null,
    placements: [
      {
        storageProvider: 'azure_blob',
        bucket: 'media',
        region: null,
        objectKey,
        externalUrl: null,
        publicBaseUrl: 'https://media.example.com',
        role: 'primary',
        status: 'active',
        priority: 10,
        deletedAt: null,
      },
    ],
  };
}

describe('boundMusicAssetIds', () => {
  it('costs nothing for the stories that bind nothing', () => {
    expect(boundMusicAssetIds(draft())).toEqual([]);
  });

  it('collapses a returning theme to one asset', () => {
    expect(
      boundMusicAssetIds(
        draft({
          'node.one': THEME_ASSET_ID,
          'node.two': THEME_ASSET_ID,
          'node.three': ECHO_ASSET_ID,
        }),
      ),
    ).toEqual([THEME_ASSET_ID, ECHO_ASSET_ID]);
  });
});

describe('resolveStoryMusicUrls', () => {
  it('never queries for a story with no music', async () => {
    const { db, findMany } = prismaReturning([]);

    expect(
      await resolveStoryMusicUrls(
        db as never,
        WORKSPACE_ID,
        'text_adventure',
        draft(),
      ),
    ).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  /**
   * The cinematic player reads no scene music and the compiler drops it, so
   * resolving a film project's bindings would be a query whose result is thrown
   * away.
   */
  it('never queries for a cinematic project, however much music is bound', async () => {
    const { db, findMany } = prismaReturning([
      readyAudio(THEME_ASSET_ID, 'story-music-audio/theme.mp3'),
    ]);

    expect(
      await resolveStoryMusicUrls(
        db as never,
        WORKSPACE_ID,
        'interactive_film',
        draft({ 'node.one': THEME_ASSET_ID, 'node.two': ECHO_ASSET_ID }),
      ),
    ).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  it('resolves a bound track to its plain public media URL', async () => {
    const { db, queries } = prismaReturning([
      readyAudio(THEME_ASSET_ID, 'story-music-audio/theme.mp3'),
    ]);

    const urls = await resolveStoryMusicUrls(
      db as never,
      WORKSPACE_ID,
      'text_adventure',
      draft({ 'node.one': THEME_ASSET_ID }),
    );

    // No signature, no expiry: a bed loops for a whole run.
    expect(urls.get(THEME_ASSET_ID)).toBe(
      'https://media.example.com/story-music-audio/theme.mp3',
    );
    // The workspace and audio-kind filters are query predicates, not
    // diagnostics — a stray binding is silence, never a publish blocker.
    expect(queries[0]).toMatchObject({
      where: { workspaceId: WORKSPACE_ID, kind: 'audio' },
    });
  });

  /**
   * The whole contract of this module: every reason a track cannot play ends in
   * "no URL", which the compiler reads as "this scene has no music".
   */
  it('answers with no URL — never an error — for media that must not be served', async () => {
    for (const unusable of [
      { ...readyAudio(THEME_ASSET_ID, 'a.mp3'), deletedAt: new Date() },
      { ...readyAudio(THEME_ASSET_ID, 'a.mp3'), status: 'processing' },
      { ...readyAudio(THEME_ASSET_ID, 'a.mp3'), moderationStatus: 'blocked' },
      {
        ...readyAudio(THEME_ASSET_ID, 'a.mp3'),
        objectKey: null,
        bucket: null,
        placements: [],
      },
    ]) {
      const { db } = prismaReturning([unusable]);

      const urls = await resolveStoryMusicUrls(
        db as never,
        WORKSPACE_ID,
        'text_adventure',
        draft({ 'node.one': THEME_ASSET_ID }),
      );

      expect(urls.size).toBe(0);
    }
  });

  /**
   * The manifest accepts a root-relative path or a permanent HTTPS URL only, so
   * a URL of any other shape would fail the release parse — a bad bed failing a
   * Build, which is the one thing music must never be able to do.
   */
  it('drops a track whose URL shape the manifest could not accept', async () => {
    const misconfigured = readyAudio(THEME_ASSET_ID, 'theme.mp3');
    misconfigured.placements[0].publicBaseUrl = 'http://media.example.com';
    const { db } = prismaReturning([misconfigured]);

    const urls = await resolveStoryMusicUrls(
      db as never,
      WORKSPACE_ID,
      'text_adventure',
      draft({ 'node.one': THEME_ASSET_ID }),
    );

    expect(urls.size).toBe(0);
  });

  it('leaves an asset the query did not return simply unresolved', async () => {
    const { db } = prismaReturning([]);

    const urls = await resolveStoryMusicUrls(
      db as never,
      WORKSPACE_ID,
      'text_adventure',
      draft({ 'node.one': THEME_ASSET_ID }),
    );

    expect(urls.size).toBe(0);
  });
});
