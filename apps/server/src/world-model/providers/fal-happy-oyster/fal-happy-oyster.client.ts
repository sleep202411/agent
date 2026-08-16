import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiError, createFalClient, type FalClient } from '@fal-ai/client';
import type { ZodType } from 'zod';
import { FalHappyOysterConfig } from './fal-happy-oyster.config';

@Injectable()
export class FalHappyOysterClient {
  private readonly client: FalClient | null;

  constructor(private readonly config: FalHappyOysterConfig) {
    this.client = config.apiKey
      ? createFalClient({ credentials: config.apiKey })
      : null;
  }

  get available(): boolean {
    return this.config.enabled && this.client !== null;
  }

  async run<T>(
    endpoint: string,
    input: Record<string, unknown>,
    schema: ZodType<T>,
  ): Promise<T> {
    if (!this.available || !this.client) {
      throw new ServiceUnavailableException({
        code: 'WORLD_MODEL_PROVIDER_UNAVAILABLE',
        message: 'HappyOyster is not enabled on this server.',
      });
    }

    try {
      const result = await this.client.run(endpoint, { input });
      const parsed = schema.safeParse(result.data);
      if (!parsed.success) {
        throw new BadGatewayException({
          code: 'WORLD_MODEL_PROVIDER_CONTRACT_ERROR',
          message: `HappyOyster returned an invalid response for ${endpoint}.`,
          issues: parsed.error.issues,
        });
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (error instanceof ApiError) {
        throw new BadGatewayException({
          code: 'WORLD_MODEL_PROVIDER_ERROR',
          message: error.message,
          providerStatus: error.status,
          providerRequestId: error.requestId || undefined,
        });
      }
      throw error;
    }
  }
}
