import { Injectable } from '@nestjs/common';
import type {
  AiPromptCompilationSnapshot,
  AiPromptDocument,
  AiPromptDocumentNode,
  AiPromptReferenceBinding,
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
    if (references.length > 0) {
      normalizedInput.referenceImages = references
        .filter((reference) => reference.url)
        .map((reference) => ({
          url: reference.url,
          refId: reference.refId,
          label: reference.label,
          assetId: reference.assetId,
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

function normalizeReferenceBindings(input: {
  rawReferences: unknown;
  rawReferenceImages: unknown;
}): AiPromptReferenceBinding[] {
  const references = Array.isArray(input.rawReferences)
    ? input.rawReferences
    : [];
  const referenceImages = Array.isArray(input.rawReferenceImages)
    ? input.rawReferenceImages
    : [];
  const merged: AiPromptReferenceBinding[] = [];
  const seen = new Set<string>();

  for (const item of references) {
    const normalized = normalizeReference(item, merged.length);
    if (!normalized) continue;
    const key = normalized.assetId ?? normalized.url ?? normalized.refId;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }

  for (const item of referenceImages) {
    const normalized = normalizeReference(item, merged.length);
    if (!normalized) continue;
    const key = normalized.assetId ?? normalized.url ?? normalized.refId;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }

  return merged.map((reference, index) => ({
    ...reference,
    order: index + 1,
    label: reference.label || `Image ${index + 1}`,
    token: `[Image ${index + 1}]`,
  }));
}

function normalizeReference(
  value: unknown,
  index: number,
): AiPromptReferenceBinding | null {
  if (typeof value === 'string') {
    const url = value.trim();
    if (!url) return null;
    return referenceBinding({ url }, index);
  }
  if (!isRecord(value)) return null;
  const url = stringValue(value.url);
  const assetId = stringValue(value.assetId);
  const refId = stringValue(value.refId) || stringValue(value.id);
  if (!url && !assetId && !refId) return null;
  return referenceBinding(
    {
      refId,
      url,
      assetId,
      label: stringValue(value.label) || stringValue(value.name),
      role: stringValue(value.role),
      weight: numberValue(value.weight),
    },
    index,
  );
}

function referenceBinding(
  value: {
    refId?: string;
    url?: string;
    assetId?: string;
    label?: string;
    role?: string;
    weight?: number;
  },
  index: number,
): AiPromptReferenceBinding {
  const order = index + 1;
  const refId = value.refId || value.assetId || `image:${order}`;
  return {
    refId,
    kind: 'image',
    label: value.label || `Image ${order}`,
    token: `[Image ${order}]`,
    order,
    ...(value.url ? { url: value.url } : {}),
    ...(value.assetId ? { assetId: value.assetId } : {}),
    ...(value.role ? { role: value.role } : {}),
    ...(value.weight !== undefined ? { weight: value.weight } : {}),
  };
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

  const bindingLines = input.references.map(
    (reference) =>
      `${reference.token}: provided reference image ${reference.order}`,
  );
  const hasInlineReferences = input.usedReferenceIds.size > 0;
  const referenceInstruction = hasInlineReferences
    ? undefined
    : 'Use the supplied reference images as visual references.';

  return [
    prompt,
    referenceInstruction,
    'Reference images are supplied separately in this order:',
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
