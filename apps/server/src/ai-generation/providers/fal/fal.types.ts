import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiInputSchema,
  AiJobType,
  AiModelFamily,
  AiOutputSchema,
  AiQueueName,
  AiQueuePolicy,
  AiRequiredPlan,
} from '../../types';

export interface FalModelRuntimeConfig {
  endpointId: string;
  type: AiJobType;
  family: AiModelFamily;
  generationModes: AiGenerationMode[];
  name: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  requiredPlan: AiRequiredPlan | null;
  queue: {
    queueName: AiQueueName;
    globalConcurrency: number;
    perUserRunning: number;
    perUserQueued: number;
  };
  queuePolicy: AiQueuePolicy;
  billingPolicy: AiBillingPolicy;
  inputSchema: AiInputSchema;
  outputSchema: AiOutputSchema;
  providerInputMap: Record<string, FalProviderFieldBinding>;
  outputPaths: string[];
  documentation?: Array<{ title: string; url: string; scope: string }>;
}

export interface FalProviderFieldBinding {
  parameter: string;
  transform?:
    | 'identity'
    | 'omitAuto'
    | 'mediaUrl'
    | 'mediaArrayToUrls'
    | 'secondsToInteger';
  omitIfEmpty?: boolean;
  omitIfDefault?: boolean;
}

export interface FalSubmitResponse {
  request_id?: string;
  requestId?: string;
  queue_position?: number;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
}

export interface FalStatusResponse {
  status?: string;
  queue_position?: number;
  logs?: Array<{ message?: string; level?: string; timestamp?: string }>;
  response_url?: string;
}

export interface FalMediaObject {
  url?: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration?: number;
}
