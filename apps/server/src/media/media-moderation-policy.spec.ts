import { MediaAssetModerationStatus } from '@prisma/client';
import {
  isPeerViewable,
  requireModerationApproval,
} from './media-moderation-policy';

describe('media-moderation-policy', () => {
  describe('isPeerViewable', () => {
    it('allows everyone when approval is not required (default posture)', () => {
      for (const status of Object.values(MediaAssetModerationStatus)) {
        expect(isPeerViewable(status, false, false)).toBe(true);
        expect(isPeerViewable(status, true, false)).toBe(true);
      }
    });

    it('always allows the owner, even for pending assets', () => {
      expect(
        isPeerViewable(MediaAssetModerationStatus.unreviewed, true, true),
      ).toBe(true);
      expect(
        isPeerViewable(MediaAssetModerationStatus.flagged, true, true),
      ).toBe(true);
    });

    it('withholds non-approved assets from peers when approval is required', () => {
      expect(
        isPeerViewable(MediaAssetModerationStatus.unreviewed, false, true),
      ).toBe(false);
      expect(
        isPeerViewable(MediaAssetModerationStatus.flagged, false, true),
      ).toBe(false);
      expect(
        isPeerViewable(MediaAssetModerationStatus.approved, false, true),
      ).toBe(true);
    });
  });

  describe('requireModerationApproval', () => {
    const KEY = 'MEDIA_REQUIRE_MODERATION_APPROVAL';
    const saved = process.env[KEY];
    afterEach(() => {
      if (saved === undefined) delete process.env[KEY];
      else process.env[KEY] = saved;
    });

    it('defaults to false', () => {
      delete process.env[KEY];
      expect(requireModerationApproval()).toBe(false);
    });

    it('is true only for an explicit "true"', () => {
      process.env[KEY] = 'true';
      expect(requireModerationApproval()).toBe(true);
      process.env[KEY] = 'TRUE';
      expect(requireModerationApproval()).toBe(true);
      process.env[KEY] = 'false';
      expect(requireModerationApproval()).toBe(false);
      process.env[KEY] = '1';
      expect(requireModerationApproval()).toBe(false);
    });
  });
});
