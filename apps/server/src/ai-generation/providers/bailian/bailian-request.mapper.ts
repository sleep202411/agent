import type {
  BailianModelRuntimeConfig,
  BailianProviderFieldBinding,
} from './bailian.types';

export function mapBailianProviderRequest(
  config: BailianModelRuntimeConfig,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model: config.endpointId,
    input: {},
    parameters: {},
  };
  const inputBody = request.input as Record<string, unknown>;
  const parameters = request.parameters as Record<string, unknown>;

  for (const [field, binding] of Object.entries(config.providerInputMap)) {
    const schemaField = config.inputSchema.properties[field];
    const raw = input[field];
    if (binding.omitIfEmpty && isEmpty(raw)) continue;
    if (
      binding.omitIfDefault &&
      schemaField?.default !== undefined &&
      raw === schemaField.default
    ) {
      continue;
    }
    const mapped = transformValue(raw, binding.transform);
    if (mapped === undefined) continue;
    const target = binding.section === 'parameters' ? parameters : inputBody;
    target[binding.parameter] = mapped;
  }

  normalizeServiceRequest(config, request);
  if (Object.keys(parameters).length === 0) delete request.parameters;
  return request;
}

function normalizeServiceRequest(
  config: BailianModelRuntimeConfig,
  request: Record<string, unknown>,
): void {
  if (config.service !== 'image-generation') return;

  const input = request.input as Record<string, unknown>;
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const imageUrls = collectReferenceImageUrls(input);
  const content: Record<string, string>[] = [];

  for (const url of imageUrls) {
    content.push({ image: url });
  }
  if (prompt) {
    content.push({ text: prompt });
  }

  request.input = {
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  };
}

function collectReferenceImageUrls(input: Record<string, unknown>): string[] {
  const urls = new Set<string>();
  const imgUrl = typeof input.img_url === 'string' ? input.img_url.trim() : '';
  if (imgUrl) urls.add(imgUrl);

  const media = Array.isArray(input.media) ? input.media : [];
  for (const item of media) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const type = typeof raw.type === 'string' ? raw.type : '';
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!url) continue;
    if (
      !type ||
      type === 'image' ||
      type === 'reference_image' ||
      type === 'subject_image'
    ) {
      urls.add(url);
    }
  }

  return Array.from(urls);
}

function transformValue(
  value: unknown,
  transform: BailianProviderFieldBinding['transform'] = 'identity',
): unknown {
  if (transform === 'omitAuto') return value === 'auto' ? undefined : value;
  if (transform === 'mediaUrl') {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'url' in value) {
      const url = (value as { url?: unknown }).url;
      return typeof url === 'string' && url.trim() ? url : undefined;
    }
    return undefined;
  }
  if (transform === 'mediaArray') {
    if (!Array.isArray(value)) return undefined;
    const media = value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const raw = item as Record<string, unknown>;
        const url = typeof raw.url === 'string' ? raw.url.trim() : '';
        if (!url) return null;
        const type =
          typeof raw.type === 'string' && raw.type.trim()
            ? raw.type.trim()
            : 'reference_image';
        const out: Record<string, unknown> = { type, url };
        if (typeof raw.referenceVoice === 'string' && raw.referenceVoice) {
          out.reference_voice = raw.referenceVoice;
        }
        if (typeof raw.reference_voice === 'string' && raw.reference_voice) {
          out.reference_voice = raw.reference_voice;
        }
        return out;
      })
      .filter((item): item is Record<string, unknown> => Boolean(item));
    return media.length > 0 ? media : undefined;
  }
  if (transform === 'secondsToInteger') {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : undefined;
  }
  return value;
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
