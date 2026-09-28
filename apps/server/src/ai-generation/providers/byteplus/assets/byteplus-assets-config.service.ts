import { Injectable } from '@nestjs/common';

const boolEnv = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

export type BytePlusAssetModerationStrategy = 'Default' | 'Skip';

const assetModerationStrategyEnv = (
  value: string | undefined,
  fallback: BytePlusAssetModerationStrategy,
): BytePlusAssetModerationStrategy => {
  if (value == null || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'default') return 'Default';
  if (normalized === 'skip') return 'Skip';
  throw new Error(
    'BYTEPLUS_ASSETS_MODERATION_STRATEGY must be either Default or Skip',
  );
};

export interface BytePlusAssetsConfig {
  /** CHARACTERS_REAL_PERSON_ENABLED — needs AK/SK + ACR + enrollment key. */
  realPersonEnabled: boolean;
  /** CHARACTERS_AIGC_REGISTRATION_ENABLED — needs AK/SK + ACR (no enrollment). */
  aigcRegistrationEnabled: boolean;
  /** MEDIA_ASSET_AIGC_REGISTRATION_ENABLED — canvas MediaAsset images register directly. */
  mediaAssetRegistrationEnabled: boolean;
  /** Any track needs the signed Action API — the plane is "on". */
  assetsPlaneEnabled: boolean;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  /** ModelArk ProjectName scoping asset groups (IAM/quota unit). */
  projectName: string;
  /** Signed Action API host (separate from the Ark v3 inference REST host). */
  endpoint: string;
  region: string;
  /** Signing scope service segment: {date}/{region}/{service}/request. */
  service: string;
  /** ?Version= date of the Action API. */
  apiVersion: string;
  /** CreateAsset content pre-filter strategy. BytePlus baseline safety remains enforced. */
  assetModerationStrategy: BytePlusAssetModerationStrategy;
  requestTimeoutMs: number;
  /**
   * ACR subscription expiry (design §6.1) — monitored CONFIG, not queryable
   * upstream. Null only while real_person is disabled.
   */
  acrExpiresAt: Date | null;
  /** AES-256-GCM key (base64, 32 bytes) for enrollment vendor tokens. */
  enrollmentTokenKey: string | null;
}

/**
 * Env-driven config for the ModelArk ASSETS plane (design §2.2/§6.1):
 * asset groups, asset registration, and visual-validate (liveness) sessions.
 * Separate credentials and host from the Bearer-key inference API.
 *
 * Fails LOUD at boot when CHARACTERS_REAL_PERSON_ENABLED is set without the
 * keys this plane cannot run without — a half-configured likeness feature
 * must never come up quietly (repo standard: required-env-fails-loud).
 */
@Injectable()
export class BytePlusAssetsConfigService {
  private readonly value: BytePlusAssetsConfig;

  constructor() {
    const realPersonEnabled = boolEnv(
      process.env.CHARACTERS_REAL_PERSON_ENABLED,
      false,
    );
    const aigcRegistrationEnabled = boolEnv(
      process.env.CHARACTERS_AIGC_REGISTRATION_ENABLED,
      false,
    );
    const mediaAssetRegistrationEnabled = boolEnv(
      process.env.MEDIA_ASSET_AIGC_REGISTRATION_ENABLED,
      aigcRegistrationEnabled,
    );
    // Both tracks CreateAsset against the signed Action API and share the ACR
    // capacity quota, so both need AK/SK + a monitored expiry.
    const assetsPlaneEnabled =
      realPersonEnabled ||
      aigcRegistrationEnabled ||
      mediaAssetRegistrationEnabled;
    const acrExpiresAtRaw = process.env.BYTEPLUS_ACR_EXPIRES_AT?.trim() || null;
    const acrExpiresAt = acrExpiresAtRaw ? new Date(acrExpiresAtRaw) : null;
    const isChina =
      (process.env.NEXT_PUBLIC_SITE_REGION ?? process.env.SITE_REGION) === 'cn';
    const assetModerationStrategy = assetModerationStrategyEnv(
      process.env.BYTEPLUS_ASSETS_MODERATION_STRATEGY,
      isChina ? 'Default' : 'Skip',
    );
    // CN must not disable content checks, including asset pre-filtering.
    // Reject stale deployment overrides rather than silently ignoring them.
    if (isChina && assetModerationStrategy === 'Skip') {
      throw new Error(
        'BYTEPLUS_ASSETS_MODERATION_STRATEGY=Skip is not allowed in the cn deployment; use Default',
      );
    }

    this.value = {
      realPersonEnabled,
      aigcRegistrationEnabled,
      mediaAssetRegistrationEnabled,
      assetsPlaneEnabled,
      accessKeyId: process.env.BYTEPLUS_ASSETS_AK?.trim() || null,
      secretAccessKey: process.env.BYTEPLUS_ASSETS_SK?.trim() || null,
      projectName: process.env.BYTEPLUS_ASSETS_PROJECT?.trim() || 'default',
      endpoint:
        process.env.BYTEPLUS_ASSETS_ENDPOINT?.replace(/\/+$/, '') ||
        'https://ark.ap-southeast-1.byteplusapi.com',
      region: process.env.BYTEPLUS_ASSETS_REGION?.trim() || 'ap-southeast-1',
      service: 'ark',
      apiVersion:
        process.env.BYTEPLUS_ASSETS_API_VERSION?.trim() || '2024-01-01',
      assetModerationStrategy,
      requestTimeoutMs: 30_000,
      acrExpiresAt,
      enrollmentTokenKey:
        process.env.CHARACTER_ENROLLMENT_TOKEN_KEY?.trim() || null,
    };

    if (assetsPlaneEnabled) {
      const missing: string[] = [];
      if (!this.value.accessKeyId) missing.push('BYTEPLUS_ASSETS_AK');
      if (!this.value.secretAccessKey) missing.push('BYTEPLUS_ASSETS_SK');
      if (!acrExpiresAtRaw) missing.push('BYTEPLUS_ACR_EXPIRES_AT');
      // Enrollment token is liveness-only — not required for AIGC.
      if (realPersonEnabled && !this.value.enrollmentTokenKey) {
        missing.push('CHARACTER_ENROLLMENT_TOKEN_KEY');
      }
      if (missing.length > 0) {
        const flag = realPersonEnabled
          ? 'CHARACTERS_REAL_PERSON_ENABLED'
          : mediaAssetRegistrationEnabled
            ? 'MEDIA_ASSET_AIGC_REGISTRATION_ENABLED'
            : 'CHARACTERS_AIGC_REGISTRATION_ENABLED';
        throw new Error(`${flag} requires: ${missing.join(', ')}`);
      }
      if (acrExpiresAt && Number.isNaN(acrExpiresAt.getTime())) {
        throw new Error(
          'BYTEPLUS_ACR_EXPIRES_AT must be an ISO date (ACR subscription expiry)',
        );
      }
    }
  }

  get config(): BytePlusAssetsConfig {
    return this.value;
  }

  /**
   * §6.1: new enrollments hard-block at T-7d before ACR expiry — never enroll
   * a user into a store about to be wiped.
   */
  enrollmentHardBlocked(now = new Date()): boolean {
    const expires = this.value.acrExpiresAt;
    if (!expires) return false;
    return expires.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * §6.1 grace window (expiry..+15d): existing assets keep generating while
   * attach/register surface typed errors and a user-facing banner.
   */
  inAcrGraceWindow(now = new Date()): boolean {
    const expires = this.value.acrExpiresAt;
    if (!expires) return false;
    const sinceExpiry = now.getTime() - expires.getTime();
    return sinceExpiry >= 0 && sinceExpiry <= 15 * 24 * 60 * 60 * 1000;
  }
}
