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

export type BailianModelService =
  | 'image-generation'
  | 'text2image'
  | 'multimodal-generation'
  | 'video-synthesis';

export type BailianCallMode = 'async' | 'sync';

export type BailianProviderTransform =
  | 'identity'
  | 'mediaUrl'
  | 'mediaArray'
  | 'mediaArrayAsImages'
  | 'mediaArrayAsVideos'
  | 'mediaArrayAsAudios'
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
  callMode: BailianCallMode;
  type: AiJobType;
  family: AiModelFamily;
  generationModes: AiGenerationMode[];
  /**
   * Per-mode endpoint routing for multi-binding canonicals (e.g. Wan 2.7:
   * text_to_video -> wan2.7-t2v, image_to_video/first_last_frame_to_video ->
   * wan2.7-i2v). Every sibling runtime of a canonical carries the SAME map, so
   * submit-time and poll-time endpoint resolution agree. Absent for
   * single-binding models (the lone endpoint is always used).
   */
  modeEndpoints?: Partial<Record<AiGenerationMode, string>>;
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
  catalogSnapshot?: AiJsonValue;
  providerPricing?: Record<string, unknown> | null;
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
