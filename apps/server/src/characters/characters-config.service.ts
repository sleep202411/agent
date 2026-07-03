import { Injectable } from '@nestjs/common';

const boolEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

export interface CharactersFeatureConfig {
  /** Kill switch over the whole characters surface (routes + expansion). */
  enabled: boolean;
  /**
   * Real-person (likeness) track — design §6.4 rollout flag. OFF by default:
   * enabling requires the ModelArk assets plane to be configured, which
   * BytePlusAssetsConfigService enforces loudly at boot.
   */
  realPersonEnabled: boolean;
  /**
   * AIGC digital-human registration for VIRTUAL characters: eager-registers
   * each virtual character image as a ModelArk AIGC asset so its `asset://`
   * reference passes Seedance's real-person risk control (a photorealistic
   * AI face is otherwise rejected). No liveness / consent — content
   * moderation only. Shares the ModelArk assets plane (AK/SK + ACR quota)
   * with the real-person track, so enabling it has the same fail-loud key
   * requirement (minus the enrollment token).
   */
  aigcRegistrationEnabled: boolean;
}

/** Reads CHARACTERS_* feature flags once at boot (design §2.2/§6.4). */
@Injectable()
export class CharactersConfigService {
  private readonly value: CharactersFeatureConfig;

  constructor() {
    this.value = {
      // Default ON: the virtual-character loop shipped with v1; the flag
      // exists as an operational kill switch, not a launch gate.
      enabled: boolEnv(process.env.CHARACTERS_ENABLED, true),
      realPersonEnabled: boolEnv(
        process.env.CHARACTERS_REAL_PERSON_ENABLED,
        false,
      ),
      aigcRegistrationEnabled: boolEnv(
        process.env.CHARACTERS_AIGC_REGISTRATION_ENABLED,
        false,
      ),
    };
  }

  get config(): CharactersFeatureConfig {
    return this.value;
  }
}
