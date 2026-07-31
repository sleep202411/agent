import { createHash } from 'node:crypto';

import { z } from 'zod';

export const STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION =
  'story-source-material-index/v1' as const;
export const STORY_SOURCE_MATERIAL_PROJECTION_SCHEMA_VERSION =
  'story-source-material-projection/v1' as const;
export const STORY_SOURCE_MATERIAL_QUERY_RESULT_SCHEMA_VERSION =
  'story-source-material-query-result/v1' as const;

const TARGET_CHUNK_CHARACTERS = 1_800;
const MIN_CHUNK_CHARACTERS = 900;
const MAX_CHUNK_CHARACTERS = 2_400;
const MAX_QUERY_CONTEXT_CHARACTERS = 24_000;
const MAX_PROJECTION_EXCERPT_CHARACTERS = 1_000;
const MAX_HIERARCHY_ITEMS = 80;
const MAX_ENTITY_ITEMS = 64;
const MAX_CONTINUITY_ITEMS = 96;
const MAX_PROJECTION_HIERARCHY_ITEMS = 24;
const MAX_PROJECTION_ENTITY_ITEMS = 24;
const MAX_PROJECTION_CONTINUITY_ITEMS = 24;
const MAX_PROJECTION_HIERARCHY_ABSTRACT_CHARACTERS = 220;

const chunkIdSchema = z
  .string()
  .regex(/^chunk-[0-9]{6}$/u)
  .max(32);

const sourceChunkMetadataSchema = z
  .object({
    id: chunkIdSchema,
    ordinal: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    heading: z.string().max(240).nullable(),
    abstract: z.string().max(420),
    keywords: z.array(z.string().min(1).max(64)).max(20),
  })
  .strict();

const hierarchyItemSchema = z
  .object({
    level: z.number().int().min(1).max(9),
    heading: z.string().min(1).max(240),
    firstChunkId: chunkIdSchema,
    abstract: z.string().max(420),
  })
  .strict();

const entityItemSchema = z
  .object({
    name: z.string().min(1).max(80),
    mentions: z.number().int().positive(),
    firstChunkId: chunkIdSchema,
  })
  .strict();

const sceneItemSchema = z
  .object({
    heading: z.string().min(1).max(240),
    chunkId: chunkIdSchema,
    location: z.string().min(1).max(160).nullable(),
    timeOfDay: z.string().min(1).max(80).nullable(),
    characters: z.array(z.string().min(1).max(80)).max(32),
  })
  .strict();

const temporalCueSchema = z
  .object({
    cue: z.string().min(1).max(160),
    chunkId: chunkIdSchema,
  })
  .strict();

export const StorySourceMaterialProjectionSchema = z
  .object({
    schemaVersion: z.literal(STORY_SOURCE_MATERIAL_PROJECTION_SCHEMA_VERSION),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    document: z
      .object({
        format: z.enum(['screenplay', 'markdown', 'prose']),
        characterCount: z.number().int().positive().max(200_000),
        lineCount: z.number().int().positive(),
        chunkCount: z.number().int().positive(),
        title: z.string().min(1).max(255),
        abstract: z.string().max(720),
      })
      .strict(),
    hierarchy: z.array(hierarchyItemSchema).max(MAX_HIERARCHY_ITEMS),
    entities: z
      .object({
        characters: z.array(entityItemSchema).max(MAX_ENTITY_ITEMS),
        locations: z.array(entityItemSchema).max(MAX_ENTITY_ITEMS),
      })
      .strict(),
    continuity: z
      .object({
        scenes: z.array(sceneItemSchema).max(MAX_CONTINUITY_ITEMS),
        temporalCues: z.array(temporalCueSchema).max(MAX_CONTINUITY_ITEMS),
      })
      .strict(),
    representativeExcerpts: z
      .array(
        z
          .object({
            chunkId: chunkIdSchema,
            heading: z.string().max(240).nullable(),
            text: z.string().min(1).max(MAX_PROJECTION_EXCERPT_CHARACTERS),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

export const StorySourceMaterialIndexSchema = z
  .object({
    schemaVersion: z.literal(STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    document: StorySourceMaterialProjectionSchema.shape.document,
    chunks: z.array(sourceChunkMetadataSchema).min(1).max(256),
    hierarchy: z.array(hierarchyItemSchema).max(MAX_HIERARCHY_ITEMS),
    entities: StorySourceMaterialProjectionSchema.shape.entities,
    continuity: StorySourceMaterialProjectionSchema.shape.continuity,
  })
  .strict();

export const StorySourceMaterialQueryArgumentsSchema = z
  .object({
    schemaVersion: z.literal('story-source-material-query/v1'),
    attachmentId: z.uuid(),
    mode: z.enum(['overview', 'search', 'range', 'entity', 'continuity']),
    query: z.string().trim().min(1).max(500).optional(),
    cursor: chunkIdSchema.optional(),
    limit: z.number().int().min(1).max(12).default(6),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.mode === 'search' || input.mode === 'entity') && !input.query) {
      context.addIssue({
        code: 'custom',
        path: ['query'],
        message: `query is required for ${input.mode} mode`,
      });
    }
    if (input.cursor && input.mode !== 'range') {
      context.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'cursor is only supported in range mode',
      });
    }
  });

export const StorySourceAnalysisQueryArgumentsSchema = z
  .object({
    schemaVersion: z.literal('story-source-analysis-query/v1'),
    attachmentId: z.uuid(),
    lens: z
      .enum([
        'overview',
        'structure',
        'characters',
        'locations',
        'plot',
        'continuity',
        'themes',
        'production',
      ])
      .default('overview'),
    limit: z.number().int().min(1).max(8).default(8),
  })
  .strict();

export type StorySourceMaterialProjection = z.infer<
  typeof StorySourceMaterialProjectionSchema
>;
export type StorySourceMaterialQueryArguments = z.infer<
  typeof StorySourceMaterialQueryArgumentsSchema
>;
export type StorySourceAnalysisQueryArguments = z.infer<
  typeof StorySourceAnalysisQueryArgumentsSchema
>;

type SourceChunkMetadata = z.infer<typeof sourceChunkMetadataSchema>;

export type StorySourceMaterialIndex = Readonly<
  z.infer<typeof StorySourceMaterialIndexSchema>
>;

export class StorySourceMaterialIndexInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorySourceMaterialIndexInvalidError';
  }
}

export type StorySourceMaterialQueryResult = Readonly<{
  schemaVersion: typeof STORY_SOURCE_MATERIAL_QUERY_RESULT_SCHEMA_VERSION;
  attachmentId: string;
  source: Readonly<{
    contentHash: string;
    document: StorySourceMaterialProjection['document'];
  }>;
  overview: Readonly<{
    hierarchy: StorySourceMaterialProjection['hierarchy'];
    entities: StorySourceMaterialProjection['entities'];
    continuity: StorySourceMaterialProjection['continuity'];
  }> | null;
  mode: StorySourceMaterialQueryArguments['mode'];
  query: string | null;
  chunks: ReadonlyArray<{
    id: string;
    ordinal: number;
    heading: string | null;
    text: string;
    relevanceScore: number | null;
  }>;
  nextCursor: string | null;
  truncated: boolean;
}>;

export function parsePersistedStorySourceMaterialIndex(input: {
  value: unknown;
  schemaVersion: string | null;
  expectedContentHash: string;
  expectedCharacterCount: number;
}): StorySourceMaterialIndex {
  if (input.schemaVersion !== STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION) {
    throw new StorySourceMaterialIndexInvalidError(
      'The persisted Story source material index version is unsupported.',
    );
  }
  const parsed = StorySourceMaterialIndexSchema.safeParse(input.value);
  if (!parsed.success) {
    throw new StorySourceMaterialIndexInvalidError(
      'The persisted Story source material index is malformed.',
    );
  }
  const index = parsed.data;
  if (
    index.contentHash !== input.expectedContentHash ||
    index.document.characterCount !== input.expectedCharacterCount ||
    index.chunks.at(-1)?.end !== input.expectedCharacterCount
  ) {
    throw new StorySourceMaterialIndexInvalidError(
      'The persisted Story source material index does not match its source.',
    );
  }
  return index;
}

type SourceLine = Readonly<{
  text: string;
  start: number;
  end: number;
  chunkId: string;
}>;

type Heading = Readonly<{
  level: number;
  text: string;
  start: number;
  chunkId: string;
  kind: 'section' | 'scene';
}>;

const CHARACTER_LABELS = new Set([
  'action',
  'beat',
  'camera',
  'cast',
  'chapter',
  'characters',
  'cut',
  'date',
  'day',
  'description',
  'end',
  'episode',
  'ext',
  'fade in',
  'fade out',
  'int',
  'location',
  'music',
  'night',
  'note',
  'scene',
  'shot',
  'sound',
  'time',
  'title',
  '地点',
  '动作',
  '备注',
  '场景',
  '外景',
  '夜',
  '对白',
  '日',
  '时间',
  '标题',
  '角色',
  '镜头',
  '音乐',
]);

const TEMPORAL_CUE_PATTERN =
  /(?:同一时刻|与此同时|随后|片刻后|几分钟后|几小时后|第二天|次日|翌日|清晨|凌晨|黄昏|夜晚|闪回|回忆|多年后|earlier|later|meanwhile|moments? later|next (?:day|morning|night)|flashback|dawn|dusk|midnight)/giu;

export function buildStorySourceMaterialIndex(input: {
  text: string;
  fileName: string;
  contentHash?: string;
}): StorySourceMaterialIndex {
  const text = normalizeSourceText(input.text);
  if (text.length === 0 || text.length > 200_000) {
    throw new RangeError(
      'Story source material must contain between 1 and 200,000 characters.',
    );
  }
  const lines = sourceLines(text);
  const chunks = buildChunks(text);
  const chunkForOffset = (offset: number): string =>
    chunks.find((chunk) => offset >= chunk.start && offset < chunk.end)?.id ??
    chunks.at(-1)!.id;
  const linesWithChunks = lines.map((line) => ({
    ...line,
    chunkId: chunkForOffset(line.start),
  }));
  const headings = extractHeadings(linesWithChunks);
  const characters = extractCharacters(linesWithChunks);
  const locations = extractLocations(headings);
  const format = detectFormat(headings, characters);
  const metadata = chunks.map((chunk) => {
    const chunkText = text.slice(chunk.start, chunk.end);
    const heading = [...headings]
      .reverse()
      .find((candidate) => candidate.start <= chunk.start)?.text;
    return sourceChunkMetadataSchema.parse({
      ...chunk,
      heading: heading ?? null,
      abstract: extractiveAbstract(chunkText, 420),
      keywords: keywords(chunkText, 20),
    });
  });
  const byChunk = new Map(metadata.map((chunk) => [chunk.id, chunk]));
  const hierarchy = headings
    .filter((heading) => heading.kind === 'section' || heading.kind === 'scene')
    .slice(0, MAX_HIERARCHY_ITEMS)
    .map((heading) => ({
      level: heading.level,
      heading: heading.text,
      firstChunkId: heading.chunkId,
      abstract: byChunk.get(heading.chunkId)?.abstract ?? '',
    }));
  const sceneCharacters = sceneCharacterMap(headings, linesWithChunks);
  const scenes = headings
    .filter((heading) => heading.kind === 'scene')
    .slice(0, MAX_CONTINUITY_ITEMS)
    .map((heading) => {
      const scene = parseSceneHeading(heading.text);
      return {
        heading: heading.text,
        chunkId: heading.chunkId,
        location: scene.location,
        timeOfDay: scene.timeOfDay,
        characters: [...(sceneCharacters.get(heading.start) ?? [])].slice(
          0,
          32,
        ),
      };
    });
  const temporalCues = extractTemporalCues(linesWithChunks).slice(
    0,
    MAX_CONTINUITY_ITEMS,
  );
  const documentAbstract = documentExtractiveAbstract(text);

  return StorySourceMaterialIndexSchema.parse({
    schemaVersion: STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
    contentHash:
      input.contentHash ??
      createHash('sha256').update(text, 'utf8').digest('hex'),
    document: {
      format,
      characterCount: text.length,
      lineCount: lines.length,
      chunkCount: metadata.length,
      title: normalizedTitle(input.fileName, headings),
      abstract: documentAbstract,
    },
    chunks: metadata,
    hierarchy,
    entities: {
      characters: entityItems(characters, MAX_ENTITY_ITEMS),
      locations: entityItems(locations, MAX_ENTITY_ITEMS),
    },
    continuity: {
      scenes,
      temporalCues,
    },
  });
}

export function projectStorySourceMaterial(
  index: StorySourceMaterialIndex,
  text: string,
): StorySourceMaterialProjection {
  const normalized = normalizeSourceText(text);
  assertIndexMatchesText(index, normalized);
  const manifest = projectIndexManifest(index);
  const representativeExcerpts = representativeChunkOrdinals(
    index.chunks.length,
  ).map((ordinal) => {
    const chunk = index.chunks[ordinal];
    return {
      chunkId: chunk.id,
      heading: chunk.heading,
      text: normalized
        .slice(chunk.start, chunk.end)
        .slice(0, MAX_PROJECTION_EXCERPT_CHARACTERS),
    };
  });
  return StorySourceMaterialProjectionSchema.parse({
    schemaVersion: STORY_SOURCE_MATERIAL_PROJECTION_SCHEMA_VERSION,
    contentHash: index.contentHash,
    document: index.document,
    ...manifest,
    representativeExcerpts,
  });
}

export function queryStorySourceMaterial(input: {
  attachmentId: string;
  text: string;
  index: StorySourceMaterialIndex;
  query: StorySourceMaterialQueryArguments;
}): StorySourceMaterialQueryResult {
  const text = normalizeSourceText(input.text);
  assertIndexMatchesText(input.index, text);
  const startOrdinal = input.query.cursor
    ? parseChunkOrdinal(input.query.cursor)
    : 0;
  let candidates: Array<{ ordinal: number; score: number | null }>;

  if (input.query.mode === 'range') {
    candidates = input.index.chunks
      .slice(startOrdinal, startOrdinal + input.query.limit)
      .map((chunk) => ({ ordinal: chunk.ordinal, score: null }));
  } else if (input.query.mode === 'overview') {
    candidates = representativeChunkOrdinals(input.index.chunks.length)
      .slice(0, input.query.limit)
      .map((ordinal) => ({ ordinal, score: null }));
  } else {
    const query = input.query.query ?? '';
    candidates = rankedChunks({
      text,
      index: input.index,
      query,
      mode: input.query.mode,
    }).slice(0, input.query.limit);
  }

  const selected: Array<{
    id: string;
    ordinal: number;
    heading: string | null;
    text: string;
    relevanceScore: number | null;
  }> = [];
  let characters = 0;
  for (const candidate of candidates) {
    const chunk = input.index.chunks[candidate.ordinal];
    if (!chunk) continue;
    const chunkText = text.slice(chunk.start, chunk.end);
    if (
      selected.length > 0 &&
      characters + chunkText.length > MAX_QUERY_CONTEXT_CHARACTERS
    ) {
      break;
    }
    selected.push({
      id: chunk.id,
      ordinal: chunk.ordinal,
      heading: chunk.heading,
      text: chunkText,
      relevanceScore:
        candidate.score === null
          ? null
          : Math.round(candidate.score * 1_000) / 1_000,
    });
    characters += chunkText.length;
  }

  const last = selected.at(-1)?.ordinal;
  const nextOrdinal =
    input.query.mode === 'range' &&
    last !== undefined &&
    last + 1 < input.index.chunks.length
      ? last + 1
      : null;
  return {
    schemaVersion: STORY_SOURCE_MATERIAL_QUERY_RESULT_SCHEMA_VERSION,
    attachmentId: input.attachmentId,
    source: {
      contentHash: input.index.contentHash,
      document: input.index.document,
    },
    overview:
      input.query.mode === 'overview'
        ? projectIndexManifest(input.index)
        : null,
    mode: input.query.mode,
    query: input.query.query ?? null,
    chunks: selected,
    nextCursor:
      nextOrdinal === null ? null : input.index.chunks[nextOrdinal].id,
    truncated:
      selected.length < candidates.length ||
      (input.query.mode === 'range' && nextOrdinal !== null),
  };
}

function projectIndexManifest(index: StorySourceMaterialIndex): {
  hierarchy: StorySourceMaterialProjection['hierarchy'];
  entities: StorySourceMaterialProjection['entities'];
  continuity: StorySourceMaterialProjection['continuity'];
} {
  return {
    hierarchy: evenlySampled(
      index.hierarchy,
      MAX_PROJECTION_HIERARCHY_ITEMS,
    ).map((item) => ({
      ...item,
      abstract: item.abstract.slice(
        0,
        MAX_PROJECTION_HIERARCHY_ABSTRACT_CHARACTERS,
      ),
    })),
    entities: {
      characters: index.entities.characters.slice(
        0,
        MAX_PROJECTION_ENTITY_ITEMS,
      ),
      locations: index.entities.locations.slice(0, MAX_PROJECTION_ENTITY_ITEMS),
    },
    continuity: {
      scenes: evenlySampled(
        index.continuity.scenes,
        MAX_PROJECTION_CONTINUITY_ITEMS,
      ),
      temporalCues: evenlySampled(
        index.continuity.temporalCues,
        MAX_PROJECTION_CONTINUITY_ITEMS,
      ),
    },
  };
}

function normalizeSourceText(text: string): string {
  return text
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .normalize('NFC')
    .replace(/\s+$/u, '');
}

function sourceLines(text: string): Array<Omit<SourceLine, 'chunkId'>> {
  const lines: Array<Omit<SourceLine, 'chunkId'>> = [];
  let start = 0;
  for (const value of text.split('\n')) {
    const end = start + value.length;
    lines.push({ text: value, start, end });
    start = end + 1;
  }
  return lines;
}

function buildChunks(
  text: string,
): Array<Pick<SourceChunkMetadata, 'id' | 'ordinal' | 'start' | 'end'>> {
  const chunks: Array<
    Pick<SourceChunkMetadata, 'id' | 'ordinal' | 'start' | 'end'>
  > = [];
  let start = 0;
  while (start < text.length) {
    const remaining = text.length - start;
    let end = text.length;
    if (remaining > MAX_CHUNK_CHARACTERS) {
      const target = start + TARGET_CHUNK_CHARACTERS;
      const maximum = Math.min(text.length, start + MAX_CHUNK_CHARACTERS);
      const minimum = Math.min(text.length, start + MIN_CHUNK_CHARACTERS);
      end =
        lastBoundary(text, '\n\n', minimum, maximum, target) ??
        lastBoundary(text, '\n', minimum, maximum, target) ??
        lastBoundary(text, '。', minimum, maximum, target) ??
        lastBoundary(text, '. ', minimum, maximum, target) ??
        maximum;
    }
    while (end < text.length && /\s/u.test(text[end] ?? '')) end += 1;
    if (end <= start) end = Math.min(text.length, start + MAX_CHUNK_CHARACTERS);
    chunks.push({
      id: chunkId(chunks.length),
      ordinal: chunks.length,
      start,
      end,
    });
    start = end;
  }
  return chunks;
}

function lastBoundary(
  text: string,
  separator: string,
  minimum: number,
  maximum: number,
  target: number,
): number | null {
  const before = text.lastIndexOf(separator, target);
  if (before >= minimum) return before + separator.length;
  const after = text.indexOf(separator, target);
  return after >= minimum && after < maximum ? after + separator.length : null;
}

function extractHeadings(lines: readonly SourceLine[]): Heading[] {
  const headings: Heading[] = [];
  for (const line of lines) {
    const value = line.text.trim();
    if (!value) continue;
    const markdown = /^(#{1,6})\s+(.+)$/u.exec(value);
    if (markdown) {
      headings.push({
        level: markdown[1].length,
        text: cleanLabel(markdown[2], 240),
        start: line.start,
        chunkId: line.chunkId,
        kind: 'section',
      });
      continue;
    }
    if (isSceneHeading(value)) {
      headings.push({
        level: 3,
        text: cleanLabel(value, 240),
        start: line.start,
        chunkId: line.chunkId,
        kind: 'scene',
      });
      continue;
    }
    if (
      /^(?:第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[章节幕集场]|(?:chapter|episode|act)\s+[0-9ivxlcdm]+)/iu.test(
        value,
      )
    ) {
      headings.push({
        level: 2,
        text: cleanLabel(value, 240),
        start: line.start,
        chunkId: line.chunkId,
        kind: 'section',
      });
    }
  }
  return headings;
}

function isSceneHeading(value: string): boolean {
  return /^(?:(?:INT|EXT|INT\/EXT|EXT\/INT|I\/E)\.?(?:\s|[-—–])|(?:内景|外景|内外景|场景)[：:\s·.－—–-])/iu.test(
    value,
  );
}

function detectFormat(
  headings: readonly Heading[],
  characters: ReadonlyMap<string, { mentions: number; firstChunkId: string }>,
): StorySourceMaterialIndex['document']['format'] {
  const scenes = headings.filter((heading) => heading.kind === 'scene').length;
  if (scenes >= 2 || (scenes >= 1 && characters.size >= 2)) {
    return 'screenplay';
  }
  return headings.some((heading) => heading.level <= 6) &&
    headings.some((heading) => heading.kind === 'section')
    ? 'markdown'
    : 'prose';
}

function extractCharacters(
  lines: readonly SourceLine[],
): Map<string, { mentions: number; firstChunkId: string }> {
  const entities = new Map<
    string,
    { mentions: number; firstChunkId: string }
  >();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const value = line.text.trim();
    if (!value) continue;
    const dialogue = /^([\p{L}\p{N}·.'’ -]{1,32})[：:]\s*(?=\S)/u.exec(value);
    const next = lines[index + 1]?.text.trim() ?? '';
    const screenplayName =
      !dialogue &&
      next.length > 0 &&
      /^[A-Z][A-Z0-9 .'-]{1,31}(?:\s*\([^)]{1,24}\))?$/u.test(value)
        ? value.replace(/\s*\([^)]*\)\s*$/u, '')
        : null;
    const explicit =
      /^(?:角色|人物|character)\s*[：:]\s*([\p{L}\p{N}·.'’ -]{1,32})$/iu.exec(
        value,
      )?.[1] ?? null;
    const candidate = dialogue?.[1] ?? screenplayName ?? explicit;
    if (!candidate) continue;
    addEntity(entities, candidate, line.chunkId);
  }
  return entities;
}

function extractLocations(
  headings: readonly Heading[],
): Map<string, { mentions: number; firstChunkId: string }> {
  const entities = new Map<
    string,
    { mentions: number; firstChunkId: string }
  >();
  for (const heading of headings) {
    if (heading.kind !== 'scene') continue;
    const location = parseSceneHeading(heading.text).location;
    if (location) addEntity(entities, location, heading.chunkId);
  }
  return entities;
}

function addEntity(
  entities: Map<string, { mentions: number; firstChunkId: string }>,
  rawName: string,
  chunkIdValue: string,
): void {
  const name = cleanLabel(rawName, 80);
  if (!name || CHARACTER_LABELS.has(name.toLocaleLowerCase())) return;
  const existing = entities.get(name);
  if (existing) existing.mentions += 1;
  else entities.set(name, { mentions: 1, firstChunkId: chunkIdValue });
}

function entityItems(
  entities: ReadonlyMap<string, { mentions: number; firstChunkId: string }>,
  limit: number,
): Array<{ name: string; mentions: number; firstChunkId: string }> {
  return [...entities.entries()]
    .sort(
      ([aName, a], [bName, b]) =>
        b.mentions - a.mentions || aName.localeCompare(bName),
    )
    .slice(0, limit)
    .map(([name, value]) => ({ name, ...value }));
}

function parseSceneHeading(value: string): {
  location: string | null;
  timeOfDay: string | null;
} {
  const stripped = value
    .replace(
      /^(?:(?:INT|EXT|INT\/EXT|EXT\/INT|I\/E)\.?|内景|外景|内外景|场景)\s*[：:·.－—–-]?\s*/iu,
      '',
    )
    .trim();
  const parts = stripped
    .split(/\s+(?:-|—|–)\s+|[·｜|]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const timePattern =
    /^(?:日|夜|昼|晨|清晨|凌晨|上午|中午|下午|傍晚|黄昏|深夜|白天|晚上|day|night|morning|afternoon|evening|dawn|dusk|midnight)$/iu;
  const timeOfDay = parts.find((part) => timePattern.test(part)) ?? null;
  const location =
    parts.find((part) => !timePattern.test(part)) ??
    (stripped && !timePattern.test(stripped) ? stripped : null);
  return {
    location: location ? cleanLabel(location, 160) : null,
    timeOfDay: timeOfDay ? cleanLabel(timeOfDay, 80) : null,
  };
}

function sceneCharacterMap(
  headings: readonly Heading[],
  lines: readonly SourceLine[],
): Map<number, Set<string>> {
  const scenes = headings.filter((heading) => heading.kind === 'scene');
  const result = new Map<number, Set<string>>();
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const nextStart = scenes[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    const names = extractCharacters(
      lines.filter(
        (line) => line.start >= scene.start && line.start < nextStart,
      ),
    );
    result.set(scene.start, new Set(names.keys()));
  }
  return result;
}

function extractTemporalCues(
  lines: readonly SourceLine[],
): Array<{ cue: string; chunkId: string }> {
  const result: Array<{ cue: string; chunkId: string }> = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const match of line.text.matchAll(TEMPORAL_CUE_PATTERN)) {
      const cue = cleanLabel(match[0], 160);
      const key = `${cue.toLocaleLowerCase()}:${line.chunkId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ cue, chunkId: line.chunkId });
    }
  }
  return result;
}

function normalizedTitle(
  fileName: string,
  headings: readonly Heading[],
): string {
  const first = headings.find((heading) => heading.kind === 'section');
  if (first) return cleanLabel(first.text, 255);
  const withoutExtension = fileName.replace(/\.[^.]+$/u, '').trim();
  return cleanLabel(withoutExtension || fileName, 255);
}

function documentExtractiveAbstract(text: string): string {
  if (text.length <= 720) return text;
  const beginning = extractiveAbstract(text.slice(0, 1_400), 500);
  const ending = extractiveAbstract(text.slice(-900), 180);
  return `${beginning}\n…\n${ending}`.slice(0, 720);
}

function extractiveAbstract(text: string, limit: number): string {
  const compact = text.replace(/\s+/gu, ' ').trim();
  if (compact.length <= limit) return compact;
  const contentLimit = Math.max(1, limit - 1);
  const candidate = compact.slice(0, contentLimit);
  const boundary = Math.max(
    candidate.lastIndexOf('。'),
    candidate.lastIndexOf('. '),
    candidate.lastIndexOf('！'),
    candidate.lastIndexOf('？'),
    candidate.lastIndexOf('; '),
  );
  const end = boundary >= contentLimit * 0.55 ? boundary + 1 : contentLimit;
  return `${candidate.slice(0, end).trim()}…`.slice(0, limit);
}

function keywords(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) continue;
    const token = segment.segment.normalize('NFC').toLocaleLowerCase();
    if (
      token.length < 2 ||
      token.length > 64 ||
      CHARACTER_LABELS.has(token) ||
      /^(?:the|and|that|with|from|this|then|they|you|for|but|are|was|were|have|has|的|了|是|在|和|与|也|就|都|而|及|一个|我们|他们|她们|你们)$/u.test(
        token,
      )
    ) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([aToken, a], [bToken, b]) => b - a || aToken.localeCompare(bToken))
    .slice(0, limit)
    .map(([token]) => token);
}

function rankedChunks(input: {
  text: string;
  index: StorySourceMaterialIndex;
  query: string;
  mode: 'search' | 'entity' | 'continuity';
}): Array<{ ordinal: number; score: number }> {
  const normalizedQuery = input.query.trim().toLocaleLowerCase();
  const queryTerms = new Set([
    normalizedQuery,
    ...keywords(normalizedQuery, 32),
    ...cjkBigrams(normalizedQuery),
  ]);
  const sceneChunkIds = new Set(
    input.index.continuity.scenes.map((scene) => scene.chunkId),
  );
  const temporalChunkIds = new Set(
    input.index.continuity.temporalCues.map((cue) => cue.chunkId),
  );
  const ranked = input.index.chunks.map((chunk) => {
    const chunkText = input.text
      .slice(chunk.start, chunk.end)
      .toLocaleLowerCase();
    const heading = chunk.heading?.toLocaleLowerCase() ?? '';
    let score = normalizedQuery
      ? occurrenceCount(chunkText, normalizedQuery) * 12 +
        occurrenceCount(heading, normalizedQuery) * 18
      : 0;
    for (const term of queryTerms) {
      if (!term || term === normalizedQuery) continue;
      score += Math.min(8, occurrenceCount(chunkText, term)) * 2;
      score += occurrenceCount(heading, term) * 5;
      if (chunk.keywords.includes(term)) score += 4;
    }
    if (input.mode === 'entity' && normalizedQuery) {
      score += occurrenceCount(chunkText, normalizedQuery) * 18;
    }
    if (input.mode === 'continuity') {
      if (sceneChunkIds.has(chunk.id)) score += 4;
      if (temporalChunkIds.has(chunk.id)) score += 6;
    }
    return { ordinal: chunk.ordinal, score };
  });
  const nonzero = ranked.filter((candidate) => candidate.score > 0);
  if (nonzero.length === 0) {
    return representativeChunkOrdinals(input.index.chunks.length).map(
      (ordinal) => ({ ordinal, score: 0 }),
    );
  }
  return nonzero.sort((a, b) => b.score - a.score || a.ordinal - b.ordinal);
}

function cjkBigrams(value: string): string[] {
  const characters = [...value.replace(/[^\p{Script=Han}]/gu, '')];
  const values = new Set<string>();
  for (let index = 0; index + 1 < characters.length; index += 1) {
    values.add(`${characters[index]}${characters[index + 1]}`);
  }
  return [...values].slice(0, 32);
}

function occurrenceCount(text: string, value: string): number {
  if (!value) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(value, start);
    if (index < 0) return count;
    count += 1;
    start = index + Math.max(1, value.length);
  }
}

function representativeChunkOrdinals(chunkCount: number): number[] {
  const ordinals = [
    0,
    Math.floor((chunkCount - 1) / 4),
    Math.floor((chunkCount - 1) / 2),
    Math.floor(((chunkCount - 1) * 3) / 4),
    chunkCount - 1,
  ];
  return [...new Set(ordinals.filter((value) => value >= 0))];
}

function evenlySampled<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  const result: T[] = [];
  for (let index = 0; index < limit; index += 1) {
    const ordinal = Math.floor((index * (items.length - 1)) / (limit - 1));
    result.push(items[ordinal]);
  }
  return result;
}

function parseChunkOrdinal(value: string): number {
  const match = /^chunk-([0-9]{6})$/u.exec(value);
  if (!match) throw new RangeError('Invalid Story source material cursor.');
  return Number(match[1]);
}

function chunkId(ordinal: number): string {
  return `chunk-${ordinal.toString().padStart(6, '0')}`;
}

function cleanLabel(value: string, limit: number): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function assertIndexMatchesText(
  index: StorySourceMaterialIndex,
  text: string,
): void {
  if (
    index.document.characterCount !== text.length ||
    index.chunks.length === 0 ||
    index.chunks.at(-1)?.end !== text.length
  ) {
    throw new Error('Story source material index does not match its source.');
  }
}
