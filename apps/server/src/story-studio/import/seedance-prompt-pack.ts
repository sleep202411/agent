export type FilmGenerationControl =
  | { mode: 'omni_reference' }
  | {
      mode: 'frame_lock';
      frameMode: 'first_frame' | 'first_last_frame';
    };

export interface PromptTimelineEntry {
  startMs: number;
  endMs: number;
  instruction: string;
}

export type ParsedSeedanceModelInput =
  | {
      kind: 'omni_reference';
      position: number;
      referenceSlotKey: string;
    }
  | {
      kind: 'first_frame' | 'last_frame';
      position: 0;
      referenceSlotKey: string;
    };

export interface ParsedSeedanceClip {
  rank: number;
  key: string;
  durationMs: number;
  generationControl: FilmGenerationControl;
  modelInput: string;
  modelInputs: ParsedSeedanceModelInput[];
  productionDependencies: string;
  positivePrompt: string;
  timeline: PromptTimelineEntry[];
  negativeConstraints: string[];
  acceptance: string;
  emotionalArc: string | null;
  endStateContract: string | null;
}

const CLIP_HEADING = /^### (\d{2})｜`([^`]+)`｜(\d+)s｜(.+)$/gm;
const TIMELINE_LINE = /^(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)s\s+(.+)$/;

export function parseSeedancePromptPack(
  markdown: string,
): ParsedSeedanceClip[] {
  const matches = [...markdown.matchAll(CLIP_HEADING)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.indexOf('\n## 5.', start);
    const body = markdown.slice(start, end === -1 ? undefined : end);
    const rank = Number.parseInt(match[1], 10);
    const key = match[2];
    const durationMs = Number.parseInt(match[3], 10) * 1_000;
    const generationControl = parseMode(match[4].trim(), key);
    const modelInput = requiredLine(body, '**模型输入**：', key);
    const modelInputs = parseModelInputs(modelInput, key);
    const productionDependencies = requiredLine(body, '**生产依赖**：', key);
    const positivePrompt = requiredCodeBlock(body, '**Positive prompt**', key);
    const timelineText = requiredCodeBlock(body, '**Shot timeline**', key);
    const timeline = parseTimeline(timelineText, key, durationMs);
    const negative = requiredLine(body, '**专属负面**：', key);
    const acceptance = requiredLine(body, '**验收重点**：', key);
    const emotionalArc = optionalLine(body, '**Emotional arc**：');
    const endStateContract = optionalLine(body, '**End-state contract**：');

    validateInputs(key, generationControl, modelInputs);

    return {
      rank,
      key,
      durationMs,
      generationControl,
      modelInput,
      modelInputs,
      productionDependencies,
      positivePrompt,
      timeline,
      negativeConstraints: negative
        .split(/[、，]/u)
        .map((item) => item.trim())
        .filter(Boolean),
      acceptance,
      emotionalArc,
      endStateContract,
    };
  });
}

function parseModelInputs(
  line: string,
  key: string,
): ParsedSeedanceModelInput[] {
  const declarations = line
    .split('；')
    .map((part) => part.trim())
    .filter(Boolean);

  return declarations.map((declaration) => {
    const match = declaration.match(
      /^`\[(Image (\d+)|Start Frame|End Frame)\]=([^`]+)`[.。]?$/u,
    );
    if (!match) {
      throw new Error(
        `Invalid model input declaration for ${key}: ${declaration}`,
      );
    }

    const label = match[1];
    const rawValue = match[3].trim();
    const referenceSlotKey = referenceSlotKeyFromModelValue(rawValue, key);
    if (label.startsWith('Image ')) {
      const imageNumber = Number.parseInt(match[2], 10);
      if (!Number.isInteger(imageNumber) || imageNumber < 1) {
        throw new Error(`Invalid Omni image position for ${key}: ${label}`);
      }
      return {
        kind: 'omni_reference' as const,
        position: imageNumber - 1,
        referenceSlotKey,
      };
    }

    return {
      kind:
        label === 'Start Frame'
          ? ('first_frame' as const)
          : ('last_frame' as const),
      position: 0 as const,
      referenceSlotKey,
    };
  });
}

function referenceSlotKeyFromModelValue(value: string, key: string): string {
  const declaredSlot = value.match(/^(REF-\d{2}|JF-\d{2})(?:\s|$)/u)?.[1];
  if (declaredSlot) return declaredSlot;

  switch (value) {
    case 'S00 审核首帧':
      return 'S00-FIRST';
    case 'S00 审核末帧':
      return 'S00-LAST';
    case 'E04 锁定黑场前构图':
      return 'E04-PREBLACK-END';
    default:
      throw new Error(`Unknown model input source for ${key}: ${value}`);
  }
}

function parseMode(mode: string, key: string): FilmGenerationControl {
  if (mode === 'Omni Reference') return { mode: 'omni_reference' };
  if (mode === 'First Frame') {
    return { mode: 'frame_lock', frameMode: 'first_frame' };
  }
  if (mode === 'First + Last Frame') {
    return { mode: 'frame_lock', frameMode: 'first_last_frame' };
  }
  throw new Error(`Unsupported generation mode "${mode}" for ${key}.`);
}

function requiredLine(body: string, marker: string, key: string): string {
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Missing ${marker} for ${key}.`);
  const lineEnd = body.indexOf('\n', markerIndex);
  return body
    .slice(markerIndex + marker.length, lineEnd === -1 ? undefined : lineEnd)
    .trim()
    .replace(/\s{2,}$/u, '');
}

function optionalLine(body: string, marker: string): string | null {
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) return null;
  const lineEnd = body.indexOf('\n', markerIndex);
  return body
    .slice(markerIndex + marker.length, lineEnd === -1 ? undefined : lineEnd)
    .trim()
    .replace(/\s{2,}$/u, '');
}

function requiredCodeBlock(body: string, marker: string, key: string): string {
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Missing ${marker} for ${key}.`);
  const fenceStart = body.indexOf('```text', markerIndex + marker.length);
  if (fenceStart === -1)
    throw new Error(`Missing text fence after ${marker} for ${key}.`);
  const contentStart = body.indexOf('\n', fenceStart) + 1;
  const fenceEnd = body.indexOf('\n```', contentStart);
  if (fenceEnd === -1)
    throw new Error(`Unclosed text fence after ${marker} for ${key}.`);
  return body.slice(contentStart, fenceEnd).trim();
}

function parseTimeline(
  timelineText: string,
  key: string,
  durationMs: number,
): PromptTimelineEntry[] {
  const entries = timelineText.split('\n').map((line) => {
    const match = line.trim().match(TIMELINE_LINE);
    if (!match) throw new Error(`Invalid timeline line for ${key}: ${line}`);
    return {
      startMs: Math.round(Number.parseFloat(match[1]) * 1_000),
      endMs: Math.round(Number.parseFloat(match[2]) * 1_000),
      instruction: match[3].trim(),
    };
  });

  if (entries.length === 0 || entries[0].startMs !== 0) {
    throw new Error(`Timeline for ${key} must start at 0ms.`);
  }
  entries.forEach((entry, index) => {
    if (entry.endMs <= entry.startMs) {
      throw new Error(
        `Timeline for ${key} contains an empty or reversed segment.`,
      );
    }
    if (index > 0 && entries[index - 1].endMs !== entry.startMs) {
      throw new Error(
        `Timeline for ${key} must be contiguous at segment ${index + 1}.`,
      );
    }
  });
  if (entries.at(-1)?.endMs !== durationMs) {
    throw new Error(`Timeline for ${key} must end at ${durationMs}ms.`);
  }
  return entries;
}

function validateInputs(
  key: string,
  control: FilmGenerationControl,
  modelInputs: ParsedSeedanceModelInput[],
): void {
  const omniInputs = modelInputs.filter(
    (input) => input.kind === 'omni_reference',
  );
  const firstFrames = modelInputs.filter(
    (input) => input.kind === 'first_frame',
  );
  const lastFrames = modelInputs.filter((input) => input.kind === 'last_frame');

  if (control.mode === 'omni_reference') {
    if (
      omniInputs.length === 0 ||
      firstFrames.length > 0 ||
      lastFrames.length > 0 ||
      omniInputs.some((input, index) => input.position !== index)
    ) {
      throw new Error(
        `Omni task ${key} must contain only ordered [Image N] inputs.`,
      );
    }
    return;
  }

  if (omniInputs.length > 0 || firstFrames.length !== 1) {
    throw new Error(`Frame-lock task ${key} must use frame inputs only.`);
  }
  if (control.frameMode === 'first_last_frame' && lastFrames.length !== 1) {
    throw new Error(`First+last task ${key} is missing [End Frame].`);
  }
  if (control.frameMode === 'first_frame' && lastFrames.length !== 0) {
    throw new Error(`First-frame task ${key} must not include [End Frame].`);
  }
}
