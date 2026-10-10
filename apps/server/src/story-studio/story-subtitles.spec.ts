import {
  storyboardSequenceSnapshotEntries,
  storyVideoSnapshotHash,
} from './story-video-production.schema';
import { parseStorySubtitleFile } from './story-subtitle-file';
import {
  resolveStorySubtitleTracks,
  storySubtitleTimeline,
} from './story-subtitle-tracks';
import {
  PatchStoryStoryboardClipSchema,
  PatchStoryStoryboardSequenceSchema,
} from './story-production-plan.schema';
import {
  StorySubtitleLanguageSchema,
  StorySubtitleTracksSchema,
} from '@repo/shared/story-subtitles';

const mediaVersionId = '0197f4a2-0800-7000-8000-000000000002';
const content =
  '1\n00:00:00,500 --> 00:00:02,000\nHello\nworld\n\n2\n00:00:01,000 --> 00:00:03,000\nOverlapping dialogue';
const upload = {
  language: 'en-US',
  timelineFingerprint: 'a'.repeat(64),
  format: 'srt',
  fileName: 'english.srt',
  content,
} as const;

describe('node subtitle upload', () => {
  it('preserves multiline dialogue, overlapping cues, BOM and CRLF', () => {
    expect(
      parseStorySubtitleFile('\uFEFF' + content.replace(/\n/g, '\r\n'), 'srt'),
    ).toEqual([
      { startMs: 500, endMs: 2000, text: 'Hello\nworld' },
      { startMs: 1000, endMs: 3000, text: 'Overlapping dialogue' },
    ]);
  });
  it('reads VTT identifiers, notes, settings and text markup as plain text', () => {
    expect(
      parseStorySubtitleFile(
        'WEBVTT\n\nNOTE editor note\nignored\n\ncue-id\n00:01.000 --> 00:02.100 align:start\n<v Narrator><i>Hello &amp; goodbye</i></v>',
        'vtt',
      ),
    ).toEqual([{ startMs: 1000, endMs: 2100, text: 'Hello & goodbye' }]);
  });
  it.each([
    ['', 'srt'],
    ['00:00:03,000 --> 00:00:02,000\nBackwards', 'srt'],
    ['00:61:00,000 --> 00:62:00,000\nInvalid clock', 'srt'],
    ['00:00:00,000 --> 00:00:01,000\n', 'srt'],
    ['WEBVTT\n00:01.000 --> 00:02.000\nMissing separator', 'vtt'],
    ['WEBVTT\n\nSTYLE\n::cue { color: red; }', 'vtt'],
    [
      '1\n00:00:02,000 --> 00:00:04,000\nFirst\n\n2\n00:00:01,000 --> 00:00:02,000\nUnordered',
      'srt',
    ],
    ['x'.repeat(512001), 'srt'],
    [
      Array.from(
        { length: 2001 },
        (_, i) => `${i + 1}\n00:00:00,000 --> 00:00:01,000\nText`,
      ).join('\n\n'),
      'srt',
    ],
  ] as const)('rejects malformed or oversized files', (file, format) => {
    expect(() => parseStorySubtitleFile(file, format)).toThrow();
  });
  it('accepts only the three platform languages and only node-level upload', () => {
    for (const language of ['en-US', 'zh-CN', 'zh-HK'])
      expect(StorySubtitleLanguageSchema.safeParse(language).success).toBe(
        true,
      );
    for (const language of ['ja', 'fr', 'zh-TW', 'en-GB', 'en_US'])
      expect(StorySubtitleLanguageSchema.safeParse(language).success).toBe(
        false,
      );
    expect(
      PatchStoryStoryboardSequenceSchema.safeParse({
        expectedVersion: 0,
        subtitleUpload: upload,
      }).success,
    ).toBe(true);
    expect(
      PatchStoryStoryboardClipSchema.safeParse({
        expectedVersion: 0,
        subtitleUpload: upload,
      }).success,
    ).toBe(false);
    expect(
      PatchStoryStoryboardSequenceSchema.safeParse({
        expectedVersion: 0,
        subtitleUpload: upload,
        removeSubtitleLanguage: 'en-US',
      }).success,
    ).toBe(false);
    const stored = {
      language: 'en-US',
      timelineFingerprint: upload.timelineFingerprint,
      format: 'srt',
      fileName: 'en.srt',
      cues: parseStorySubtitleFile(content, 'srt'),
    };
    expect(StorySubtitleTracksSchema.safeParse([stored, stored]).success).toBe(
      false,
    );
  });
});

function clip(
  id: string,
  startMs: number,
  actualDurationMs: number | null,
  kind = 'video',
) {
  const variant = {
    id: `variant-${id}`,
    variantKey: 'original',
    durationMs: actualDurationMs,
    checksumSha256: 'b'.repeat(64),
    status: 'ready',
    deletedAt: null,
    contentType: `${kind}/mp4`,
  };
  return {
    id,
    kind,
    track: 'visual',
    rank: startMs,
    startMs,
    durationMs: 1000,
    selectedMediaVersion: {
      id: mediaVersionId,
      archivedAt: null,
      preferredVariant: null,
      mediaAsset: {
        kind,
        status: 'ready',
        deletedAt: null,
        moderationStatus: 'approved',
        variants: [variant],
      },
    },
  };
}

describe('node subtitle timing', () => {
  const cues = [
    { startMs: 1500, endMs: 2500, text: 'Across the cut' },
    { startMs: 2000, endMs: 3000, text: 'Second segment' },
  ];
  function sequence() {
    const clips = [clip('a', 0, 2000), clip('b', 1000, 3000)];
    return {
      clips,
      subtitleTracks: [
        {
          language: 'en-US',
          timelineFingerprint: storySubtitleTimeline({ clips }).fingerprint,
          format: 'srt',
          fileName: 'whole-node.srt',
          cues,
        },
      ],
    };
  }
  it('invalidates a Build snapshot when node subtitles change', () => {
    const node = { id: 'node', version: 1, clips: [] };
    const before = storyVideoSnapshotHash(
      storyboardSequenceSnapshotEntries(node),
    );
    node.version++;
    expect(
      storyVideoSnapshotHash(storyboardSequenceSnapshotEntries(node)),
    ).not.toBe(before);
  });
  it('uses actual playback durations and slices overlapping cues across a cut, without changing authored cues', () => {
    const node = sequence(),
      result = resolveStorySubtitleTracks(node);
    expect(result.timeline.durationMs).toBe(5000);
    expect(result.byClipId.get('a')).toEqual([
      {
        language: 'en-US',
        cues: [{ startMs: 1500, endMs: 2000, text: 'Across the cut' }],
      },
    ]);
    expect(result.byClipId.get('b')).toEqual([
      {
        language: 'en-US',
        cues: [
          { startMs: 0, endMs: 500, text: 'Across the cut' },
          { startMs: 0, endMs: 1000, text: 'Second segment' },
        ],
      },
    ]);
    expect(node.subtitleTracks[0].cues).toEqual(cues);
    expect(result.stale).toBe(false);
  });
  it('makes order, footage and actual duration changes stale while unrelated prompt edits preserve timing', () => {
    for (const mutate of [
      (node: ReturnType<typeof sequence>) => {
        node.clips[0].startMs = 5000;
      },
      (node: ReturnType<typeof sequence>) => {
        node.clips[0].selectedMediaVersion.id = 'replacement';
      },
      (node: ReturnType<typeof sequence>) => {
        node.clips[0].selectedMediaVersion.mediaAsset.variants[0].durationMs = 2500;
      },
    ]) {
      const node = sequence();
      mutate(node);
      const result = resolveStorySubtitleTracks(node);
      expect(result.stale).toBe(true);
      expect([...result.byClipId.values()].flat()).toEqual([]);
    }
    const node = sequence();
    Object.assign(node.clips[0], {
      version: 123,
      imagePrompt: 'Changed prompt',
    });
    node.clips[0].selectedMediaVersion.mediaAsset.variants[0].contentType =
      'VIDEO/MP4';
    expect(resolveStorySubtitleTracks(node).stale).toBe(false);
  });
  it('does not guess video duration or omit a missing segment when aligning subtitles', () => {
    const node = sequence();
    node.clips[0].selectedMediaVersion.mediaAsset.variants[0].durationMs = null;
    expect(resolveStorySubtitleTracks(node).timeline.ready).toBe(false);
    expect(resolveStorySubtitleTracks(node).stale).toBe(true);
    const blocked = sequence();
    blocked.clips[0].selectedMediaVersion.mediaAsset.moderationStatus =
      'blocked';
    expect(resolveStorySubtitleTracks(blocked).timeline.ready).toBe(false);
  });
  it('includes held images and rejects out-of-range cues even when the timing fingerprint is current', () => {
    const node = sequence();
    node.clips[0] = clip('a', 0, null, 'image');
    node.subtitleTracks[0].timelineFingerprint =
      storySubtitleTimeline(node).fingerprint;
    expect(resolveStorySubtitleTracks(node).timeline.durationMs).toBe(4000);
    node.subtitleTracks[0].cues = [
      { startMs: 0, endMs: 4001, text: 'Too long' },
    ];
    expect(resolveStorySubtitleTracks(node).outOfRange).toBe(true);
    expect(
      [...resolveStorySubtitleTracks(node).byClipId.values()].flat(),
    ).toEqual([]);
  });
});
