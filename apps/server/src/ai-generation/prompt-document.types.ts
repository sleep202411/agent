export type AiPromptDocumentNode =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'asset_ref';
      refId: string;
      label?: string;
    }
  | {
      type: 'style_ref';
      refId: string;
      label?: string;
    };

export interface AiPromptDocument {
  version: 1;
  nodes: AiPromptDocumentNode[];
}

export type AiPromptReferenceKind = 'image' | 'video' | 'audio';

/**
 * Wire shape of one `referenceBindings` entry as clients submit it (and as
 * the job's `referenceSnapshot` persists it for retry). Everything beyond
 * `refId` is optional: plain uploads carry `url`/`assetId`, while character
 * bindings carry `role: 'character'` + `characterId` and NO url — the
 * generation path expands them into per-media bindings (with `groupRefId`
 * pointing back at the original character refId) before compilation.
 */
export interface AiSubmitReferenceBinding {
  refId: string;
  kind?: AiPromptReferenceKind;
  role?: string;
  label?: string;
  order?: number;
  url?: string;
  assetId?: string;
  weight?: number;
  characterId?: string;
  groupRefId?: string;
  /** Measured media duration when known (video/audio). */
  durationSeconds?: number;
  bytes?: number;
}

export interface AiPromptReferenceBinding {
  refId: string;
  kind: AiPromptReferenceKind;
  label: string;
  token: string;
  order: number;
  url?: string;
  assetId?: string;
  role?: string;
  weight?: number;
  /** Set on members of an expanded character group — the original binding's refId. */
  groupRefId?: string;
  /** Set on members of an expanded character group — the StudioCharacter id. */
  characterId?: string;
  durationSeconds?: number;
  bytes?: number;
}

export interface AiPromptStyleBinding {
  refId: string;
  label: string;
  token: string;
  slug?: string;
  type?: string;
  weight?: number;
}

export interface AiPromptCompilationSnapshot {
  version: 1;
  compiler: 'fizzdragon.prompt-reference.v1';
  promptDocument: AiPromptDocument;
  displayText: string;
  searchText: string;
  compiledPrompt: string;
  references: AiPromptReferenceBinding[];
  styles: AiPromptStyleBinding[];
}
