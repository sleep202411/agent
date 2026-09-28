import { ConflictException, Logger } from '@nestjs/common';
import type { ConfirmUploadInputDto } from './dto';
import type { MediaAssetReadinessService } from './media-asset-readiness.service';
import { MediaUploadController } from './media-upload.controller';
import type { MediaUploadService } from './media-upload.service';

describe('MediaUploadController confirmation cleanup', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])(
    'preserves the original confirmation error when cleanup fails: %s',
    async (cleanupFails) => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const original = new ConflictException({
        code: 'CREW_UPLOAD_RESERVATION_EXPIRED',
        message: 'Upload reservation expired',
      });
      const service = {
        confirmUpload: jest.fn().mockRejectedValue(original),
        cancelUpload: cleanupFails
          ? jest.fn().mockRejectedValue(new Error('Database unavailable'))
          : jest.fn().mockResolvedValue({ cancelled: true }),
      };
      const controller = new MediaUploadController(
        service as unknown as MediaUploadService,
        {} as MediaAssetReadinessService,
      );
      const input: ConfirmUploadInputDto = {
        kind: 'crew_asset_file',
        storageKey: 'crew/key.png',
        contentType: 'image/png',
        scope: { crewId: 'crew-1' },
      };

      await expect(
        controller.confirmUpload({ userId: 'user-1' }, undefined, input),
      ).rejects.toBe(original);
      expect(service.cancelUpload).toHaveBeenCalledWith('user-1', input);
    },
  );
});
