export interface StartPayload {
  gameId: string;
  projectId?: string;
  contentVersion?: string;
  buildId?: string;
  locale?: string;
  platform?: string;
  experienceType?: string;
}

export interface ProgressChoice {
  optionId: string;
  label: string;
  decisionId: string;
}

export interface ProgressPayload {
  currentNode?: string;
  currentChapter?: string;
  choice?: ProgressChoice;
  path?: Array<{ chapter?: string; node?: string }>;
}

export interface CompletePayload {
  endingId: string;
  currentChapter?: string;
  currentNode?: string;
  path?: Array<{ chapter?: string; node?: string }>;
  choices?: ProgressChoice[];
}

export interface PlaySessionReporter {
  onStart(payload: StartPayload): Promise<{ sessionId: string } | null>;
  onProgress(sessionId: string, payload: ProgressPayload): Promise<void>;
  onComplete(sessionId: string, payload: CompletePayload): Promise<void>;
}
