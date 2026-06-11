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

export interface AiPromptReferenceBinding {
  refId: string;
  kind: 'image';
  label: string;
  token: string;
  order: number;
  url?: string;
  assetId?: string;
  role?: string;
  weight?: number;
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
