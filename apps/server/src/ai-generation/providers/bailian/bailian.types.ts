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

export type BailianModelService =
  | 'image-generation'
  | 'text2image'
  | 'multimodal-generation'
  | 'video-synthesis';

export type BailianProviderTransform =
  | 'identity'
  | 'mediaUrl'
  | 'mediaArray'
  | 'secondsToInteger'
  | 'omitAuto';

export interface BailianProviderFieldBinding {
  section: 'input' | 'parameters';
  parameter: string;
  transform?: BailianProviderTransform;
  omitIfEmpty?: boolean;
  omitIfDefault?: boolean;
}

export interface BailianModelRuntimeConfig {
  endpointId: string;
  service: BailianModelService;
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
  providerInputMap: Record<string, BailianProviderFieldBinding>;
  documentation?: Array<{ title: string; url: string; scope: string }>;
}

export interface BailianTaskSubmitResponse {
  request_id?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    message?: string;
  };
  usage?: Record<string, unknown>;
}

export interface BailianTaskStatusResponse {
  request_id?: string;
  output?: Record<string, unknown> & {
    task_id?: string;
    task_status?: string;
    message?: string;
    results?: unknown[];
    submit_time?: string;
    scheduled_time?: string;
    end_time?: string;
  };
  usage?: Record<string, unknown>;
}

export interface BailianMediaObject {
  url?: string;
  width?: number;
  height?: number;
  duration?: number;
  content_type?: string;
  file_name?: string;
  file_size?: number;
}
