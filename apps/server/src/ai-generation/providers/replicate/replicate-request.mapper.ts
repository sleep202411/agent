export function mapReplicateGptImage2Request(
  input: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: stringValue(input.prompt),
    aspect_ratio: replicateAspectRatio(input.imageSize),
    quality: qualityValue(input.quality),
    number_of_images: outputCount(input.numOutputs),
    output_format: outputFormat(input.outputFormat),
    output_compression: 100,
    background: 'opaque',
    moderation: 'auto',
    user_id: userId,
  };
  const inputImages = referenceImageUrls(input.referenceImages);
  if (inputImages.length > 0) body.input_images = inputImages;
  return { input: body };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function qualityValue(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function outputFormat(value: unknown): 'png' | 'jpeg' | 'webp' {
  if (value === 'jpeg' || value === 'webp') return value;
  return 'png';
}

function outputCount(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(4, Math.max(1, Math.floor(number)));
}

function replicateAspectRatio(value: unknown): '1:1' | '3:2' | '2:3' {
  if (value === 'square' || value === 'square_hd') return '1:1';
  if (value === 'portrait_4_3' || value === 'portrait_16_9') return '2:3';
  return '3:2';
}

function referenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'url' in item) {
        return (item as { url?: unknown }).url;
      }
      return undefined;
    })
    .filter((item): item is string => typeof item === 'string' && !!item);
}
