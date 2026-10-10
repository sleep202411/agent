import { BadRequestException } from '@nestjs/common';
import {
  STORY_SUBTITLE_FILE_MAX_BYTES,
  StorySubtitleCuesSchema,
  type StorySubtitleCue,
} from '@repo/shared/story-subtitles';

/** Parse uploaded timed text into plain, immutable cues. Never execute subtitle markup. */
export function parseStorySubtitleFile(
  content: string,
  format: 'srt' | 'vtt',
): StorySubtitleCue[] {
  const fail = (message: string): never => {
    throw new BadRequestException({ code: 'STORY_SUBTITLE_INVALID', message });
  };
  if (Buffer.byteLength(content, 'utf8') > STORY_SUBTITLE_FILE_MAX_BYTES)
    fail('Subtitle files must be no larger than 500 KB.');
  const text = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (format === 'vtt' && !/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text))
    fail('A VTT subtitle file must begin with WEBVTT.');
  const blocks = text.split(/\n[ \t]*\n/);
  if (format === 'vtt') {
    const header = blocks.shift();
    if (header?.includes('-->'))
      fail('The WEBVTT header must be followed by a blank line.');
  }
  const cues: StorySubtitleCue[] = [];
  for (const block of blocks) {
    if (format === 'vtt' && /^NOTE(?:\s|$)/.test(block)) continue;
    if (/^(STYLE|REGION)(?:\s|$)/.test(block))
      fail(
        'Upload a VTT file with timed text cues; STYLE and REGION blocks are not supported.',
      );
    const lines = block.split('\n');
    let timing = lines.shift() ?? '';
    if (!timing.includes('-->')) timing = lines.shift() ?? '';
    const match = timing.match(
      /^\s*((?:\d{2,3}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,3}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/,
    );
    if (!match)
      return fail(`Subtitle cue ${cues.length + 1} has an invalid time range.`);
    const startMs = parseTime(match[1]);
    const endMs = parseTime(match[2]);
    const cueText = lines
      .join('\n')
      .replace(
        /<\/?(?:b|i|u|ruby|rt|c(?:\.[^\s>]*)?|v(?:\s[^>]*)?|lang(?:\s[^>]*)?)>/gi,
        '',
      )
      .replace(/<\d{2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, '')
      .replace(
        /&(?:amp|lt|gt|quot|apos|nbsp);/g,
        (entity) =>
          ({
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&apos;': "'",
            '&nbsp;': ' ',
          })[entity]!,
      )
      .trim();
    cues.push({ startMs, endMs, text: cueText });
  }
  const parsed = StorySubtitleCuesSchema.safeParse(cues);
  if (!parsed.success)
    fail(
      `Invalid subtitles: ${parsed.error.issues[0]?.message ?? 'No timed text found.'}`,
    );
  return parsed.data!;
}

function parseTime(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number);
  const seconds = parts.pop()!;
  const minutes = parts.pop()!;
  const hours = parts.pop() ?? 0;
  if (minutes >= 60 || seconds >= 60) return NaN;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}
