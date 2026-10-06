import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  GenerateVideosOperation,
  GoogleGenAI,
  VideoGenerationReferenceType,
  type GenerateContentResponse,
  type GenerateVideosResponse,
  type Interactions,
  type Part,
} from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { GoogleVertexConfigService } from './google-vertex-config.service';
import {
  googleVertexError,
  mapGoogleVertexUnknownError,
} from './google-vertex-error.mapper';
import {
  GOOGLE_GEMINI_INLINE_IMAGE_MAX_BYTES,
  GOOGLE_VERTEX_INLINE_REFERENCE_IMAGE_MAX_BYTES,
  GOOGLE_VERTEX_INLINE_VIDEO_MAX_BYTES,
  GoogleVertexMediaLoaderService,
} from './google-vertex-media-loader.service';
import type {
  GoogleVertexImageRequest,
  GoogleVertexOmniRequest,
  GoogleVertexVeoRequest,
} from './google-vertex-request.mapper';

export interface GoogleVertexImageResult {
  outputs: Array<{
    buffer: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    ext: 'png' | 'jpg' | 'webp';
  }>;
  requestId: string | null;
  status: number | null;
  headers: Record<string, string>;
  responseSummary: Record<string, unknown>;
}

export interface GoogleVertexVideoStartResult {
  operationName: string;
  requestId: string | null;
  headers: Record<string, string>;
  responseSummary: Record<string, unknown>;
}

export interface GoogleVertexVideoPollResult {
  done: boolean;
  error?: Record<string, unknown>;
  response?: GenerateVideosResponse;
  requestId: string | null;
  status: number | null;
  headers: Record<string, string>;
  responseSummary: Record<string, unknown>;
}

export interface GoogleVertexOmniOperationResult {
  state: 'pending' | 'completed' | 'failed';
  output?: {
    buffer?: Buffer;
    providerUrl?: string;
    mimeType: 'video/mp4';
    ext: 'mp4';
  };
  failure?: {
    code: 'PROVIDER_CONTENT_FILTER' | 'UNKNOWN';
    message: string;
    userMessage: string;
  };
  interactionId: string;
  interactionStatus: string;
  requestId: string | null;
  status: number | null;
  headers: Record<string, string>;
  responseSummary: Record<string, unknown>;
}

type GoogleVertexOmniInteraction = Interactions.Interaction & {
  sdkHttpResponse?: {
    headers?: Record<string, string>;
    responseInternal: Response;
  };
};

@Injectable()
export class GoogleVertexClient implements OnModuleInit {
  private readonly logger = new Logger(GoogleVertexClient.name);
  private readonly clients = new Map<string, GoogleGenAI>();

  constructor(
    private readonly configService: GoogleVertexConfigService,
    private readonly mediaLoader: GoogleVertexMediaLoaderService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = this.configService.config;
    if (!config.enabled) return;

    try {
      const auth = new GoogleAuth({
        projectId: config.project ?? undefined,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const credentials = await auth.getClient();
      const token = await credentials.getAccessToken();
      if (!token.token) throw new Error('ADC returned no access token.');
      this.clientFor(config.imageLocation ?? '');
      this.clientFor(config.videoLocation ?? '');
      this.logger.log(
        `Google Vertex AI credentials ready for project ${config.project}; image=${config.imageLocation}, video=${config.videoLocation}.`,
      );
    } catch (error) {
      throw new Error(
        `GOOGLE_VERTEX_ENABLED=true but Application Default Credentials are unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async generateImage(
    request: GoogleVertexImageRequest,
  ): Promise<GoogleVertexImageResult> {
    const images = await this.mediaLoader.loadImages(request.referenceUrls, {
      allowWebp: true,
      maxBytes: GOOGLE_GEMINI_INLINE_IMAGE_MAX_BYTES,
    });
    const parts: Part[] = [
      ...images.map((image) => ({
        inlineData: { data: image.data, mimeType: image.mimeType },
      })),
      { text: request.prompt },
    ];

    let response: GenerateContentResponse;
    try {
      response = await this.clientFor(request.location).models.generateContent({
        model: request.model,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: request.aspectRatio,
            imageSize: request.imageSize,
            outputMimeType: request.outputMimeType,
          },
          labels: request.labels,
          httpOptions: this.httpOptions(),
        },
      });
    } catch (error) {
      throw providerException(error);
    }

    const outputs = collectImageOutputs(response);
    if (outputs.length === 0) {
      const reason = imageFailureReason(response);
      throw googleVertexError(
        reason.contentFiltered ? 'PROVIDER_CONTENT_FILTER' : 'UNKNOWN',
        `Google Vertex AI returned no image: ${reason.message}`,
        reason.contentFiltered
          ? 'This request was blocked by Google safety filters. Adjust the prompt or references and try again.'
          : 'Google Vertex AI completed without an image. Please try again.',
        responseSummary(response),
      );
    }

    const headers = response.sdkHttpResponse?.headers ?? {};
    return {
      outputs,
      requestId: requestId(headers, response.responseId),
      status: response.sdkHttpResponse?.responseInternal?.status ?? null,
      headers,
      responseSummary: responseSummary(response),
    };
  }

  async startVideo(
    request: GoogleVertexVeoRequest,
  ): Promise<GoogleVertexVideoStartResult> {
    const frameUrls = [request.startFrameUrl, request.endFrameUrl].filter(
      (url): url is string => Boolean(url),
    );
    const frames = await this.mediaLoader.loadImages(frameUrls, {
      allowWebp: false,
      maxBytes: GOOGLE_VERTEX_INLINE_REFERENCE_IMAGE_MAX_BYTES,
    });
    const startFrame = request.startFrameUrl ? frames[0] : undefined;
    const endFrame = request.endFrameUrl
      ? frames[request.startFrameUrl ? 1 : 0]
      : undefined;
    const referenceImages = await this.mediaLoader.loadImages(
      request.referenceUrls,
      {
        allowWebp: false,
        maxBytes: GOOGLE_VERTEX_INLINE_REFERENCE_IMAGE_MAX_BYTES,
      },
    );

    let operation: GenerateVideosOperation;
    try {
      operation = await this.clientFor(request.location).models.generateVideos({
        model: request.model,
        ...(request.prompt ? { prompt: request.prompt } : {}),
        ...(startFrame
          ? {
              image: {
                imageBytes: startFrame.data,
                mimeType: startFrame.mimeType,
              },
            }
          : {}),
        config: {
          numberOfVideos: 1,
          durationSeconds: request.durationSeconds,
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          generateAudio: request.generateAudio,
          ...(request.negativePrompt
            ? { negativePrompt: request.negativePrompt }
            : {}),
          ...(request.seed != null ? { seed: request.seed } : {}),
          ...(endFrame
            ? {
                lastFrame: {
                  imageBytes: endFrame.data,
                  mimeType: endFrame.mimeType,
                },
              }
            : {}),
          ...(referenceImages.length
            ? {
                referenceImages: referenceImages.map((image) => ({
                  image: {
                    imageBytes: image.data,
                    mimeType: image.mimeType,
                  },
                  referenceType: VideoGenerationReferenceType.ASSET,
                })),
              }
            : {}),
          labels: request.labels,
          httpOptions: this.httpOptions(),
        },
      });
    } catch (error) {
      throw providerException(error);
    }

    if (!operation.name) {
      throw googleVertexError(
        'UNKNOWN',
        `Google Vertex AI did not return an operation name for ${request.model}.`,
      );
    }
    const headers = operation.sdkHttpResponse?.headers ?? {};
    return {
      operationName: operation.name,
      requestId: requestId(headers),
      headers,
      responseSummary: operationSummary(operation),
    };
  }

  async startOmni(
    request: GoogleVertexOmniRequest,
  ): Promise<GoogleVertexOmniOperationResult> {
    const imageUrls = [
      ...(request.startFrameUrl ? [request.startFrameUrl] : []),
      ...request.referenceUrls,
    ];
    const images = await this.mediaLoader.loadImages(imageUrls, {
      allowWebp: true,
      maxBytes: GOOGLE_VERTEX_INLINE_REFERENCE_IMAGE_MAX_BYTES,
    });
    const sourceVideo =
      request.sourceVideoUrl && !request.previousInteractionId
        ? await this.mediaLoader.loadVideo(request.sourceVideoUrl, {
            maxBytes: GOOGLE_VERTEX_INLINE_VIDEO_MAX_BYTES,
          })
        : undefined;
    const input: Array<
      | { type: 'image'; data: string; mime_type: string }
      | { type: 'video'; data: string; mime_type: string }
      | { type: 'text'; text: string }
    > = [
      ...(sourceVideo
        ? [
            {
              type: 'video' as const,
              data: sourceVideo.data,
              mime_type: sourceVideo.mimeType,
            },
          ]
        : []),
      ...images.map((image) => ({
        type: 'image' as const,
        data: image.data,
        mime_type: image.mimeType,
      })),
      { type: 'text', text: request.prompt },
    ];

    let response: GoogleVertexOmniInteraction;
    try {
      response = await this.clientFor(request.location).interactions.create(
        {
          api_version: 'v1beta1',
          model: request.model,
          input,
          stream: false,
          background: true,
          // Required for a generated video to become an editable stateful turn.
          store: true,
          ...(request.previousInteractionId
            ? { previous_interaction_id: request.previousInteractionId }
            : {}),
          response_format: [
            {
              type: 'video',
              aspect_ratio: request.aspectRatio,
              duration: `${request.durationSeconds}s`,
              delivery: 'inline',
            },
          ],
          generation_config: { video_config: { task: request.task } },
          labels: request.labels,
        },
        {
          timeout: this.configService.config.requestTimeoutMs,
          maxRetries: 0,
        },
      );
    } catch (error) {
      throw providerException(error);
    }

    return omniOperationResult(response);
  }

  async pollOmni(
    interactionId: string,
  ): Promise<GoogleVertexOmniOperationResult> {
    let response: GoogleVertexOmniInteraction;
    try {
      response = await this.clientFor('global').interactions.get(
        interactionId,
        { api_version: 'v1beta1', stream: false },
        {
          timeout: this.configService.config.requestTimeoutMs,
          maxRetries: 0,
        },
      );
    } catch (error) {
      throw providerException(error);
    }
    return omniOperationResult(response);
  }

  async pollVideo(operationName: string): Promise<GoogleVertexVideoPollResult> {
    const operation = Object.assign(new GenerateVideosOperation(), {
      name: operationName,
    });
    let current: GenerateVideosOperation;
    try {
      current = await this.clientForLocationFromOperation(
        operationName,
      ).operations.getVideosOperation({
        operation,
        config: { httpOptions: this.httpOptions() },
      });
    } catch (error) {
      throw providerException(error);
    }
    const headers = current.sdkHttpResponse?.headers ?? {};
    return {
      done: current.done === true,
      ...(current.error ? { error: current.error } : {}),
      ...(current.response ? { response: current.response } : {}),
      requestId: requestId(headers),
      status: current.sdkHttpResponse?.responseInternal?.status ?? null,
      headers,
      responseSummary: operationSummary(current),
    };
  }

  private clientFor(location: string): GoogleGenAI {
    if (!this.configService.config.enabled) {
      throw googleVertexError(
        'PROVIDER_NOT_CONFIGURED',
        'GOOGLE_VERTEX_ENABLED is not true.',
        'Google Vertex AI is not enabled in this environment.',
      );
    }
    if (!location.trim()) {
      throw googleVertexError(
        'PROVIDER_NOT_CONFIGURED',
        'Google Vertex AI request location is required.',
      );
    }
    const existing = this.clients.get(location);
    if (existing) return existing;
    const client = this.createClient(location);
    this.clients.set(location, client);
    return client;
  }

  private clientForLocationFromOperation(operationName: string): GoogleGenAI {
    const match = /\/locations\/([^/]+)\//.exec(operationName);
    if (!match?.[1]) {
      throw googleVertexError(
        'VALIDATION_ERROR',
        `Google Vertex AI operation name has no location: ${operationName}`,
      );
    }
    return this.clientFor(match[1]);
  }

  private createClient(location: string): GoogleGenAI {
    const { project } = this.configService.config;
    if (!project) {
      throw googleVertexError(
        'PROVIDER_NOT_CONFIGURED',
        'Google Vertex AI project is required.',
      );
    }
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      apiVersion: 'v1',
    });
  }

  private httpOptions() {
    return {
      timeout: this.configService.config.requestTimeoutMs,
      // The generic worker owns retries and billing/idempotency. Nested SDK
      // retries would hide attempts and can duplicate paid media generations.
      retryOptions: { attempts: 1 },
    };
  }
}

function collectImageOutputs(
  response: GenerateContentResponse,
): GoogleVertexImageResult['outputs'] {
  const outputs: GoogleVertexImageResult['outputs'] = [];
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inlineData?.data;
      const mimeType = normalizeImageMime(part.inlineData?.mimeType);
      if (!data || !mimeType) continue;
      outputs.push({
        buffer: Buffer.from(data, 'base64'),
        mimeType,
        ext:
          mimeType === 'image/png'
            ? 'png'
            : mimeType === 'image/webp'
              ? 'webp'
              : 'jpg',
      });
    }
  }
  return outputs;
}

function normalizeImageMime(
  value: string | undefined,
): GoogleVertexImageResult['outputs'][number]['mimeType'] | null {
  if (
    value === 'image/png' ||
    value === 'image/jpeg' ||
    value === 'image/webp'
  ) {
    return value;
  }
  return null;
}

function imageFailureReason(response: GenerateContentResponse): {
  contentFiltered: boolean;
  message: string;
} {
  const finishReasons = (response.candidates ?? [])
    .map((candidate) => candidate.finishReason)
    .filter(Boolean)
    .map(String);
  const blockReason = response.promptFeedback?.blockReason
    ? String(response.promptFeedback.blockReason)
    : '';
  const combined = [blockReason, ...finishReasons].filter(Boolean).join(', ');
  const contentFiltered = /safety|prohibited|recitation|block/i.test(combined);
  return {
    contentFiltered,
    message: combined || 'no output part was returned',
  };
}

function responseSummary(
  response: GenerateContentResponse,
): Record<string, unknown> {
  return {
    responseId: response.responseId ?? null,
    modelVersion: response.modelVersion ?? null,
    createTime: response.createTime ?? null,
    candidateCount: response.candidates?.length ?? 0,
    finishReasons: (response.candidates ?? []).map(
      (candidate) => candidate.finishReason ?? null,
    ),
    promptFeedback: response.promptFeedback ?? null,
    usageMetadata: response.usageMetadata ?? null,
  };
}

function operationSummary(
  operation: GenerateVideosOperation,
): Record<string, unknown> {
  return {
    name: operation.name ?? null,
    done: operation.done ?? false,
    metadata: operation.metadata ?? null,
    error: operation.error ?? null,
    generatedVideoCount: operation.response?.generatedVideos?.length ?? 0,
    raiMediaFilteredCount: operation.response?.raiMediaFilteredCount ?? 0,
    raiMediaFilteredReasons: operation.response?.raiMediaFilteredReasons ?? [],
  };
}

function omniOperationResult(
  response: GoogleVertexOmniInteraction,
): GoogleVertexOmniOperationResult {
  const headers = response.sdkHttpResponse?.headers ?? {};
  const common = {
    interactionId: response.id,
    interactionStatus: response.status,
    requestId: requestId(headers),
    status: response.sdkHttpResponse?.responseInternal?.status ?? null,
    headers,
    responseSummary: omniResponseSummary(response),
  };

  if (response.status === 'queued' || response.status === 'in_progress') {
    return { state: 'pending', ...common };
  }

  if (response.status === 'completed') {
    const video = response.output_video;
    const mimeType = video?.mime_type ?? 'video/mp4';
    if (
      mimeType === 'video/mp4' &&
      (video?.data || video?.uri?.startsWith('https://'))
    ) {
      return {
        state: 'completed',
        output: {
          ...(video.data
            ? { buffer: Buffer.from(video.data, 'base64') }
            : { providerUrl: video.uri }),
          mimeType: 'video/mp4',
          ext: 'mp4',
        },
        ...common,
      };
    }
    const outputDescription = video?.uri
      ? `non-HTTPS ${video.uri.split(':', 1)[0]} URI`
      : `${mimeType} output`;
    return {
      state: 'failed',
      failure: {
        code: 'UNKNOWN',
        message: `Gemini Omni interaction ${response.id} returned no supported inline or HTTPS MP4 video (${outputDescription}).`,
        userMessage:
          'Gemini Omni completed without a usable video. Please try again.',
      },
      ...common,
    };
  }

  const providerErrors = JSON.stringify(response.errors ?? []);
  const providerMessage = (response.errors ?? [])
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(' ');
  const contentFiltered = /safety|policy|prohibited|blocked/i.test(
    providerErrors,
  );
  return {
    state: 'failed',
    failure: {
      code: contentFiltered ? 'PROVIDER_CONTENT_FILTER' : 'UNKNOWN',
      message: `Gemini Omni interaction ${response.id} ended with status ${response.status}: ${providerErrors || 'no provider error detail'}`,
      userMessage: contentFiltered
        ? 'This video request was blocked by Google safety filters. Adjust the prompt or references and try again.'
        : providerMessage ||
          'Gemini Omni did not complete the video. Please try again.',
    },
    ...common,
  };
}

function omniResponseSummary(
  response: GoogleVertexOmniInteraction,
): Record<string, unknown> {
  return {
    id: response.id,
    model: response.model ?? null,
    status: response.status,
    created: response.created ?? null,
    updated: response.updated ?? null,
    errors: response.errors ?? [],
    usage: response.usage ?? null,
    stepCount: response.steps?.length ?? 0,
    hasOutputVideo: Boolean(response.output_video),
    outputVideoMimeType: response.output_video?.mime_type ?? null,
    outputVideoDelivery: response.output_video?.data
      ? 'inline'
      : response.output_video?.uri
        ? 'uri'
        : null,
  };
}

function requestId(
  headers: Record<string, string>,
  fallback?: string,
): string | null {
  return (
    headers['x-request-id'] ??
    headers['x-goog-request-id'] ??
    headers['x-cloud-trace-context'] ??
    fallback ??
    null
  );
}

function providerException(error: unknown): Error {
  const mapped = mapGoogleVertexUnknownError(error);
  return googleVertexError(
    mapped.code,
    mapped.message,
    mapped.userMessage,
    mapped.raw,
  );
}
