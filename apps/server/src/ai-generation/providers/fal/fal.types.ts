import type {
  AiBillingPolicy,
  AiGenerationMode,
  AiInputSchema,
  AiJsonValue,
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
  parameterPolicy?: AiJsonValue;
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
  metrics?: Record<string, unknown>;
  error?: string;
  error_type?: string;
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

export interface FalPricingItem {
  endpoint_id?: string;
  unit_price?: number;
  unit?: string;
  currency?: string;
}

export interface FalPricingResponse {
  prices?: FalPricingItem[];
  next_cursor?: string | null;
  has_more?: boolean;
}

export interface FalRequestListItem {
  request_id?: string;
  endpoint_id?: string;
  started_at?: string;
  sent_at?: string;
  ended_at?: string;
  status_code?: number;
  duration?: number;
  json_input?: unknown;
  json_output?: unknown;
}

export interface FalRequestListResponse {
  items?: FalRequestListItem[];
  next_cursor?: string | null;
  has_more?: boolean;
}
