import { Injectable } from '@nestjs/common';
import type {
  AiPromptCompilationSnapshot,
  AiPromptDocument,
  AiPromptDocumentNode,
  AiPromptReferenceBinding,
  AiPromptReferenceKind,
  AiPromptStyleBinding,
} from './prompt-document.types';

interface CompilePromptInput {
  normalizedInput: Record<string, unknown>;
  rawInput?: Record<string, unknown>;
  promptDocument?: unknown;
  references?: unknown;
  styles?: unknown;
}

interface CompilePromptResult {
  snapshot: AiPromptCompilationSnapshot;
  normalizedInput: Record<string, unknown>;
}

const COMPILER_ID = 'fizzdragon.prompt-reference.v1' as const;

const REFERENCE_KINDS = ['image', 'video', 'audio'] as const;

const KIND_LABEL: Record<AiPromptReferenceKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
};

/** The normalizedInput key each reference kind is written back to. */
const KIND_INPUT_FIELD: Record<AiPromptReferenceKind, string> = {
  image: 'referenceImages',
  video: 'referenceVideos',
  audio: 'referenceAudios',
};

@Injectable()
export class AiPromptCompilerService {
  compile(input: CompilePromptInput): CompilePromptResult {
    const normalizedInput = { ...input.normalizedInput };
    const rawInput = input.rawInput ?? {};
    const promptText = firstString(normalizedInput.prompt, rawInput.prompt);
    const document = normalizePromptDocument(input.promptDocument, promptText);
    const references = normalizeReferenceBindings({
      rawReferences: input.references,
      rawReferenceImages: firstDefined(
        normalizedInput.referenceImages,
        rawInput.referenceImages,
      ),
      rawReferenceVideos: firstDefined(
        normalizedInput.referenceVideos,
        rawInput.referenceVideos,
      ),
      rawReferenceAudios: firstDefined(
        normalizedInput.referenceAudios,
        rawInput.referenceAudios,
      ),
    });
    const styles = normalizeStyleBindings(input.styles);
    const rendered = renderPromptDocument(document, references, styles);
    const compiledPrompt = compileProviderPrompt(rendered.providerText, {
      references,
      usedReferenceIds: rendered.usedReferenceIds,
    });
    const displayText = rendered.displayText || promptText;
    const searchText = [displayText, ...references.map((item) => item.label)]
      .filter(Boolean)
      .join(' ')
      .trim();

    normalizedInput.prompt = compiledPrompt;
    // Write each kind back to its own input field — but ONLY when bindings
    // of that kind exist, so image-only flows keep today's exact output and
    // never grow referenceVideos/referenceAudios keys out of thin air.
    for (const kind of REFERENCE_KINDS) {
      const ofKind = references.filter((reference) => reference.kind === kind);
      if (ofKind.length === 0) continue;
      normalizedInput[KIND_INPUT_FIELD[kind]] = ofKind
        .filter((reference) => reference.url)
        .map((reference) => ({
          url: reference.url,
          refId: reference.refId,
          label: reference.label,
          assetId: reference.assetId,
          ...(reference.groupRefId ? { groupRefId: reference.groupRefId } : {}),
          ...(reference.characterId
            ? { characterId: reference.characterId }
            : {}),
          ...(typeof reference.durationSeconds === 'number' &&
          Number.isFinite(reference.durationSeconds)
            ? { durationSeconds: reference.durationSeconds }
            : {}),
          ...(typeof reference.bytes === 'number' &&
          Number.isFinite(reference.bytes)
            ? { bytes: reference.bytes }
            : {}),
        }));
    }

    return {
      normalizedInput,
      snapshot: {
        version: 1,
        compiler: COMPILER_ID,
        promptDocument: document,
        displayText,
        searchText,
        compiledPrompt,
        references,
        styles,
      },
    };
  }
}

function normalizePromptDocument(
  value: unknown,
  fallbackText: string,
): AiPromptDocument {
  if (isRecord(value) && Array.isArray(value.nodes)) {
    const nodes = value.nodes
      .map(normalizePromptNode)
      .filter((node): node is AiPromptDocumentNode => Boolean(node));
    if (nodes.length > 0) {
      return {
        version: 1,
        nodes,
      };
    }
  }

  return {
    version: 1,
    nodes: fallbackText ? [{ type: 'text', text: fallbackText }] : [],
  };
}

function normalizePromptNode(value: unknown): AiPromptDocumentNode | null {
  if (!isRecord(value)) return null;
  if (value.type === 'text') {
    const text = rawStringValue(value.text);
    return text ? { type: 'text', text } : null;
  }
  if (value.type === 'asset_ref') {
    const refId = stringValue(value.refId);
    if (!refId) return null;
    const label = stringValue(value.label);
    return label
      ? { type: 'asset_ref', refId, label }
      : { type: 'asset_ref', refId };
  }
  if (value.type === 'style_ref') {
    const refId = stringValue(value.refId);
    if (!refId) return null;
    const label = stringValue(value.label);
    return label
      ? { type: 'style_ref', refId, label }
      : { type: 'style_ref', refId };
  }
  return null;
}

/** A reference binding parsed from the wire, before per-kind numbering. */
interface RawReferenceBinding {
  refId?: string;
  kind: AiPromptReferenceKind;
  label?: string;
  url?: string;
  assetId?: string;
  role?: string;
  weight?: number;
  groupRefId?: string;
  characterId?: string;
}

function normalizeReferenceBindings(input: {
  rawReferences: unknown;
  rawReferenceImages: unknown;
  rawReferenceVideos: unknown;
  rawReferenceAudios: unknown;
}): AiPromptReferenceBinding[] {
  const sources: Array<{ items: unknown; defaultKind: AiPromptReferenceKind }> =
    [
      { items: input.rawReferences, defaultKind: 'image' },
      { items: input.rawReferenceImages, defaultKind: 'image' },
      { items: input.rawReferenceVideos, defaultKind: 'video' },
      { items: input.rawReferenceAudios, defaultKind: 'audio' },
    ];
  const merged: RawReferenceBinding[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (!Array.isArray(source.items)) continue;
    for (const item of source.items) {
      const normalized = normalizeReference(item, source.defaultKind);
      if (!normalized) continue;
      // Dedupe on EVERY identity the entry carries (assetId AND url):
      // schema normalization may strip assetId off input-array entries
      // (additionalProperties: false), so a binding and its input-array
      // copy must still collapse via the shared url.
      const keys = [normalized.assetId, normalized.url].filter(
        (value): value is string => Boolean(value),
      );
      if (keys.length === 0) {
        if (!normalized.refId) continue;
        keys.push(normalized.refId);
      }
      if (keys.some((key) => seen.has(key))) continue;
      for (const key of keys) seen.add(key);
      merged.push(normalized);
    }
  }

  // Positional tokens count per kind in merged order: images 1..n
  // independently of videos and audios ([Image 1] … [Video 1] …).
  const counters: Record<AiPromptReferenceKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
  };
  return merged.map((reference) => {
    const order = ++counters[reference.kind];
    const kindLabel = KIND_LABEL[reference.kind];
    return {
      refId:
        reference.refId ?? reference.assetId ?? `${reference.kind}:${order}`,
      kind: reference.kind,
      label: reference.label || `${kindLabel} ${order}`,
      token: `[${kindLabel} ${order}]`,
      order,
      ...(reference.url ? { url: reference.url } : {}),
      ...(reference.assetId ? { assetId: reference.assetId } : {}),
      ...(reference.role ? { role: reference.role } : {}),
      ...(reference.weight !== undefined ? { weight: reference.weight } : {}),
      ...(reference.groupRefId ? { groupRefId: reference.groupRefId } : {}),
      ...(reference.characterId ? { characterId: reference.characterId } : {}),
    };
  });
}

function normalizeReference(
  value: unknown,
  defaultKind: AiPromptReferenceKind,
): RawReferenceBinding | null {
  if (typeof value === 'string') {
    const url = value.trim();
    if (!url) return null;
    return { url, kind: defaultKind };
  }
  if (!isRecord(value)) return null;
  const url = stringValue(value.url);
  const assetId = stringValue(value.assetId);
  const refId = stringValue(value.refId) || stringValue(value.id);
  if (!url && !assetId && !refId) return null;
  return {
    ...(refId ? { refId } : {}),
    kind: referenceKindValue(value.kind) ?? defaultKind,
    ...(url ? { url } : {}),
    ...(assetId ? { assetId } : {}),
    ...(stringValue(value.label) || stringValue(value.name)
      ? { label: stringValue(value.label) || stringValue(value.name) }
      : {}),
    ...(stringValue(value.role) ? { role: stringValue(value.role) } : {}),
    ...(numberValue(value.weight) !== undefined
      ? { weight: numberValue(value.weight) }
      : {}),
    ...(stringValue(value.groupRefId)
      ? { groupRefId: stringValue(value.groupRefId) }
      : {}),
    ...(stringValue(value.characterId)
      ? { characterId: stringValue(value.characterId) }
      : {}),
  };
}

function referenceKindValue(value: unknown): AiPromptReferenceKind | null {
  const kind = stringValue(value);
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null;
}

function normalizeStyleBindings(value: unknown): AiPromptStyleBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const refId = stringValue(item.refId) || stringValue(item.slug);
      const label = stringValue(item.label);
      if (!refId && !label) return null;
      return {
        refId: refId || `style:${index + 1}`,
        label: label || refId,
        token: `#${label || refId}`,
        ...(stringValue(item.slug) ? { slug: stringValue(item.slug) } : {}),
        ...(stringValue(item.type) ? { type: stringValue(item.type) } : {}),
        ...(numberValue(item.weight) !== undefined
          ? { weight: numberValue(item.weight) }
          : {}),
      };
    })
    .filter((item): item is AiPromptStyleBinding => Boolean(item));
}

function renderPromptDocument(
  document: AiPromptDocument,
  references: AiPromptReferenceBinding[],
  styles: AiPromptStyleBinding[],
): {
  displayText: string;
  providerText: string;
  usedReferenceIds: Set<string>;
} {
  const referenceById = new Map(references.map((item) => [item.refId, item]));
  // Character mentions: an asset_ref pointing at a character binding's
  // original refId resolves to the GROUP of expanded per-media bindings.
  const groupByRefId = new Map<string, AiPromptReferenceBinding[]>();
  for (const reference of references) {
    if (!reference.groupRefId) continue;
    const members = groupByRefId.get(reference.groupRefId) ?? [];
    members.push(reference);
    groupByRefId.set(reference.groupRefId, members);
  }
  const styleById = new Map(styles.map((item) => [item.refId, item]));
  const usedReferenceIds = new Set<string>();
  const displayParts: string[] = [];
  const providerParts: string[] = [];

  for (const node of document.nodes) {
    if (node.type === 'text') {
      displayParts.push(node.text);
      providerParts.push(node.text);
      continue;
    }
    if (node.type === 'asset_ref') {
      const reference = referenceById.get(node.refId);
      if (reference) {
        usedReferenceIds.add(reference.refId);
        displayParts.push(`@${node.label || reference.label}`);
        providerParts.push(reference.token);
        continue;
      }
      const group = groupByRefId.get(node.refId);
      if (group && group.length > 0) {
        for (const member of group) usedReferenceIds.add(member.refId);
        displayParts.push(`@${node.label || group[0].label}`);
        // One character mention → the joined member tokens, e.g.
        // `[Image 1, Image 2, Video 1]`.
        providerParts.push(
          `[${group.map((member) => member.token.slice(1, -1)).join(', ')}]`,
        );
        continue;
      }
      displayParts.push(`@${node.label || node.refId}`);
      providerParts.push(`[${node.label || node.refId}]`);
      continue;
    }
    const style = styleById.get(node.refId);
    displayParts.push(`#${node.label || style?.label || node.refId}`);
    providerParts.push(node.label || style?.label || node.refId);
  }

  return {
    displayText: normalizePromptText(displayParts.join('')),
    providerText: normalizePromptText(providerParts.join('')),
    usedReferenceIds,
  };
}

function compileProviderPrompt(
  providerText: string,
  input: {
    references: AiPromptReferenceBinding[];
    usedReferenceIds: Set<string>;
  },
): string {
  const prompt = providerText.trim();
  if (input.references.length === 0) return prompt;

  const bindingLines = input.references.map((reference) =>
    reference.groupRefId
      ? `${reference.token}: reference ${reference.kind} ${reference.order} — character "${reference.label}"`
      : `${reference.token}: provided reference ${reference.kind} ${reference.order}`,
  );
  const imagesOnly = input.references.every(
    (reference) => reference.kind === 'image',
  );
  const mediaNoun = imagesOnly ? 'images' : 'media';
  const hasInlineReferences = input.usedReferenceIds.size > 0;
  const referenceInstruction = hasInlineReferences
    ? undefined
    : `Use the supplied reference ${mediaNoun} as visual references.`;

  return [
    prompt,
    referenceInstruction,
    `Reference ${mediaNoun} are supplied separately in this order:`,
    bindingLines.join('\n'),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');
}

function normalizePromptText(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const string = stringValue(value);
    if (string) return string;
  }
  return '';
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function rawStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
