import { UnprocessableEntityException } from '@nestjs/common';
import type { AiModelDefinition } from '../ai-generation/types';
import type { FilmClipSpec, FilmTrailerSpec } from './interactive-film.schema';

export type StoryFilmPromptSubject = Pick<
  FilmClipSpec | FilmTrailerSpec,
  'title' | 'prompt' | 'continuityNotes'
>;

export const STORY_FILM_PROMPT_COMPILER_VERSION =
  'story-film-prompt-budget-v1' as const;

export interface StoryFilmPromptCompilation {
  text: string;
  stats: {
    strategyVersion: typeof STORY_FILM_PROMPT_COMPILER_VERSION;
    originalLength: number;
    submittedLength: number;
    maxLength: number | null;
    providerReservedLength: number;
    compacted: boolean;
    droppedSemanticUnits: number;
  };
}

const BEAT_FIELDS: Array<{
  key:
    | 'visual'
    | 'camera'
    | 'action'
    | 'performance'
    | 'emotion'
    | 'dialogue'
    | 'audio'
    | 'endState'
    | 'continuity';
  label: string;
  priority: number;
}> = [
  { key: 'visual', label: '画面', priority: 10 },
  { key: 'camera', label: '镜头', priority: 10 },
  { key: 'action', label: '动作', priority: 10 },
  { key: 'performance', label: '表演', priority: 10 },
  { key: 'emotion', label: '情绪', priority: 15 },
  { key: 'dialogue', label: '对白', priority: 5 },
  { key: 'audio', label: '声音', priority: 5 },
  { key: 'endState', label: '结束状态', priority: 1 },
  { key: 'continuity', label: '连续性', priority: 15 },
];

interface SemanticLine {
  text: string;
  priority: number;
  order: number;
  required: boolean;
}

export function modelPromptMaxLength(model: AiModelDefinition): number | null {
  const promptProperty = model.input_schema.properties?.prompt as unknown;
  const value =
    promptProperty &&
    typeof promptProperty === 'object' &&
    !Array.isArray(promptProperty)
      ? (promptProperty as Record<string, unknown>).maxLength
      : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/**
 * Provider-aware deterministic compiler. It first renders every structured
 * field exactly once. If the provider declares a smaller prompt budget, it
 * selects complete semantic clauses by priority; it never slices characters
 * through a sentence or time-coded beat.
 */
export function compileStoryFilmPrompt(input: {
  clip: StoryFilmPromptSubject;
  variationNote?: string;
  maxLength: number | null;
  providerReservedLength?: number;
}): StoryFilmPromptCompilation {
  const original = renderCompletePrompt(input.clip, input.variationNote);
  const reserved = Math.max(0, input.providerReservedLength ?? 0);
  const providerMax = input.maxLength ?? Number.MAX_SAFE_INTEGER;
  const finiteMax = providerMax - reserved;
  if (finiteMax <= 0) {
    throw promptBudgetExceeded(
      original.length + reserved,
      reserved,
      providerMax,
    );
  }
  if (original.length <= finiteMax) {
    return {
      text: original,
      stats: {
        strategyVersion: STORY_FILM_PROMPT_COMPILER_VERSION,
        originalLength: original.length + reserved,
        submittedLength: original.length + reserved,
        maxLength: input.maxLength,
        providerReservedLength: reserved,
        compacted: false,
        droppedSemanticUnits: 0,
      },
    };
  }

  const semanticLines = buildSemanticLines(input.clip, input.variationNote);
  const required = semanticLines
    .filter((line) => line.required)
    .sort((a, b) => a.order - b.order);
  const requiredText = required.map((line) => line.text).join('\n');
  if (requiredText.length > finiteMax) {
    throw promptBudgetExceeded(
      original.length + reserved,
      requiredText.length + reserved,
      providerMax,
    );
  }

  const selected = new Set(required);
  const optional = semanticLines
    .filter((line) => !line.required)
    .sort((a, b) => a.priority - b.priority || a.order - b.order);
  for (const candidate of optional) {
    const next = [...selected, candidate]
      .sort((a, b) => a.order - b.order)
      .map((line) => line.text)
      .join('\n');
    if (next.length <= finiteMax) selected.add(candidate);
  }
  const text = [...selected]
    .sort((a, b) => a.order - b.order)
    .map((line) => line.text)
    .join('\n');
  return {
    text,
    stats: {
      strategyVersion: STORY_FILM_PROMPT_COMPILER_VERSION,
      originalLength: original.length + reserved,
      submittedLength: text.length + reserved,
      maxLength: input.maxLength,
      providerReservedLength: reserved,
      compacted: true,
      droppedSemanticUnits: semanticLines.length - selected.size,
    },
  };
}

/** Exact suffix added by AiPromptCompilerService for image-only Omni inputs
 * when the prompt document contains only text. */
export function providerImageReferencePromptOverhead(count: number): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  const bindingLines = Array.from(
    { length: count },
    (_, index) => `[Image ${index + 1}]: provided reference image ${index + 1}`,
  ).join('\n');
  const suffix = [
    'Use the supplied reference images as visual references.',
    'Reference images are supplied separately in this order:',
    bindingLines,
  ].join('\n\n');
  return 2 + suffix.length;
}

function promptBudgetExceeded(
  originalLength: number,
  minimumLength: number,
  maxLength: number,
) {
  return new UnprocessableEntityException({
    code: 'STORY_FILM_PROMPT_BUDGET_EXCEEDED',
    message:
      'The provider prompt budget cannot hold the minimum timecode and end-state contract.',
    originalLength,
    minimumLength,
    maxLength,
    strategyVersion: STORY_FILM_PROMPT_COMPILER_VERSION,
  });
}

function renderCompletePrompt(
  clip: StoryFilmPromptSubject,
  variationNote?: string,
): string {
  const sections: string[] = [`镜头：${clip.title}`];
  if (clip.prompt.masterPrompt.trim()) {
    sections.push(`总导演：${clip.prompt.masterPrompt.trim()}`);
  }
  sections.push('分秒导演时间线：');
  clip.prompt.timeline.forEach((beat) => {
    sections.push(
      `[${formatSeconds(beat.startMs)}-${formatSeconds(beat.endMs)}秒]`,
    );
    const seen = new Set<string>();
    BEAT_FIELDS.forEach(({ key, label }) => {
      const value = beat[key]?.trim();
      if (!value) return;
      const normalized = normalizeSemanticValue(value);
      if (seen.has(normalized)) return;
      seen.add(normalized);
      sections.push(`${label}：${value}`);
    });
  });
  if (clip.continuityNotes.length > 0) {
    sections.push(`全局连续性：${clip.continuityNotes.join('；')}`);
  }
  if (clip.prompt.negativeConstraints.length > 0) {
    sections.push(`避免：${clip.prompt.negativeConstraints.join('；')}`);
  }
  if (variationNote?.trim()) {
    sections.push(`本次变化指令：${variationNote.trim()}`);
  }
  return sections.join('\n');
}

function buildSemanticLines(
  clip: StoryFilmPromptSubject,
  variationNote?: string,
): SemanticLine[] {
  let order = 0;
  const result: SemanticLine[] = [
    {
      text: `镜头：${clip.title}`,
      priority: 0,
      order: order++,
      required: true,
    },
  ];
  semanticUnits(clip.prompt.masterPrompt).forEach((unit, index) => {
    result.push({
      text: `${index === 0 ? '总导演' : '总导演补充'}：${unit}`,
      priority: 25 + index,
      order: order++,
      required: false,
    });
  });
  result.push({
    text: '分秒导演时间线：',
    priority: 0,
    order: order++,
    required: true,
  });

  clip.prompt.timeline.forEach((beat, beatIndex) => {
    const isFinalBeat = beatIndex === clip.prompt.timeline.length - 1;
    result.push({
      text: `[${formatSeconds(beat.startMs)}-${formatSeconds(beat.endMs)}秒]`,
      priority: 0,
      order: order++,
      required: true,
    });
    const seen = new Set<string>();
    BEAT_FIELDS.forEach(({ key, label, priority }) => {
      const value = beat[key]?.trim();
      if (!value) return;
      const normalized = normalizeSemanticValue(value);
      if (seen.has(normalized)) return;
      seen.add(normalized);
      const units = semanticUnits(value);
      units.forEach((unit, unitIndex) => {
        result.push({
          text: `${label}：${unit}`,
          priority:
            priority +
            (isFinalBeat ? -1 : 0) +
            (unitIndex === 0 ? 0 : 40 + unitIndex),
          order: order++,
          required: isFinalBeat && key === 'endState' && unitIndex === 0,
        });
      });
    });
  });
  clip.prompt.negativeConstraints.forEach((constraint, index) => {
    semanticUnits(constraint).forEach((unit, unitIndex) => {
      result.push({
        text: `避免：${unit}`,
        priority: 8 + index + unitIndex,
        order: order++,
        required: false,
      });
    });
  });
  clip.continuityNotes.forEach((note, index) => {
    semanticUnits(note).forEach((unit, unitIndex) => {
      result.push({
        text: `全局连续性：${unit}`,
        priority: 18 + index + unitIndex,
        order: order++,
        required: false,
      });
    });
  });
  if (variationNote?.trim()) {
    result.push({
      text: `本次变化指令：${variationNote.trim()}`,
      priority: 2,
      order: order++,
      required: false,
    });
  }
  return result;
}

function semanticUnits(value: string): string[] {
  return value
    .trim()
    .split(/(?<=[。！？.!?])\s+|[；;]\s*/u)
    .map((unit) => unit.trim())
    .filter(Boolean);
}

function normalizeSemanticValue(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function formatSeconds(ms: number): string {
  return Number.isInteger(ms / 1_000)
    ? String(ms / 1_000)
    : (ms / 1_000).toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '');
}
