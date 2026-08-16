import { Injectable } from '@nestjs/common';

function parseBoolean(name: string, value: string | undefined): boolean {
  if (value == null || value.trim() === '') return false;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean value.`);
}

@Injectable()
export class FalHappyOysterConfig {
  readonly enabled: boolean;
  readonly apiKey: string | null;

  constructor() {
    this.enabled = parseBoolean(
      'WORLD_MODEL_HAPPY_OYSTER_ENABLED',
      process.env.WORLD_MODEL_HAPPY_OYSTER_ENABLED,
    );
    this.apiKey = process.env.FAL_API_KEY?.trim() || null;

    if (this.enabled && !this.apiKey) {
      throw new Error(
        'WORLD_MODEL_HAPPY_OYSTER_ENABLED=true requires FAL_API_KEY.',
      );
    }
  }
}
