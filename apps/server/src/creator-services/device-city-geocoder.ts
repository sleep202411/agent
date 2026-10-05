import { z } from 'zod';
import { CreatorCitySchema } from '@repo/shared/creator-location';
export const DeviceCityInput = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locale: z.enum(['en-US', 'zh-CN', 'zh-HK']),
});
type City = z.infer<typeof CreatorCitySchema>;
const Component = z.object({
  long_name: z.string(),
  short_name: z.string(),
  types: z.array(z.string()),
});
const AmapText = z.union([z.string(), z.array(z.never()).max(0)]);
/** Return city evidence only, never street addresses or device coordinates. */
export function decodeDeviceCity(
  provider: 'google' | 'amap',
  raw: unknown,
): City | null {
  if (provider === 'google') {
    const body = z
      .object({
        status: z.string(),
        results: z
          .array(
            z.object({
              address_components: z.array(Component),
              partial_match: z.boolean().optional(),
            }),
          )
          .max(100)
          .optional(),
      })
      .parse(raw);
    if (body.status === 'ZERO_RESULTS') return null;
    if (body.status !== 'OK' || !body.results?.length)
      throw new Error('Invalid city lookup response.');
    const cities = new Map<string, City>();
    for (const result of body.results) {
      if (result.partial_match) continue;
      const city =
        result.address_components.find((c) => c.types.includes('locality')) ??
        result.address_components.find((c) => c.types.includes('postal_town'));
      const country = result.address_components.find((c) =>
        c.types.includes('country'),
      );
      if (!city || !country) continue;
      const parsed = CreatorCitySchema.safeParse({
        city: city.long_name,
        countryCode: country.short_name,
      });
      if (parsed.success)
        cities.set(
          `${parsed.data.countryCode}:${parsed.data.city.normalize('NFKC').toLowerCase()}`,
          parsed.data,
        );
    }
    return cities.size === 1 ? [...cities.values()][0] : null;
  }
  const body = z
    .object({
      status: z.string(),
      regeocode: z
        .object({
          addressComponent: z.object({
            country: AmapText,
            province: AmapText,
            city: AmapText,
            adcode: AmapText,
          }),
        })
        .optional(),
    })
    .parse(raw);
  if (body.status !== '1' || !body.regeocode)
    throw new Error('Invalid city lookup response.');
  const a = body.regeocode.addressComponent;
  if (
    a.country !== '中国' ||
    typeof a.adcode !== 'string' ||
    !/^\d{6}$/.test(a.adcode)
  )
    return null;
  const countryCode = a.adcode.startsWith('81')
    ? 'HK'
    : a.adcode.startsWith('82')
      ? 'MO'
      : a.adcode.startsWith('71')
        ? 'TW'
        : 'CN';
  // Only known municipalities/SARs can substitute an empty city, not provinces.
  const municipalities = [
    '北京市',
    '天津市',
    '上海市',
    '重庆市',
    '香港特别行政区',
    '澳门特别行政区',
  ];
  const city =
    typeof a.city === 'string' && a.city.trim()
      ? a.city
      : typeof a.province === 'string' && municipalities.includes(a.province)
        ? a.province
        : null;
  return city ? CreatorCitySchema.parse({ countryCode, city }) : null;
}
async function abortable<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error('City lookup cancelled or timed out.'));
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) {
      signal.removeEventListener('abort', stop);
      stop();
      return;
    }
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', stop));
  });
}
async function readJson(
  url: URL,
  signal: AbortSignal,
  transport: typeof fetch,
): Promise<unknown> {
  const response = await abortable(
    () =>
      transport(url, {
        signal,
        redirect: 'error',
        headers: { accept: 'application/json' },
      }),
    signal,
  );
  if (!response.ok || !response.body)
    throw new Error('City lookup provider unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await abortable(() => reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_000_000)
        throw new Error('City lookup response exceeds limit.');
      chunks.push(part.value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  signal.throwIfAborted();
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
/** Explicit invocation only. Caller reserves quota: one request globally, two
 * for CN (GPS conversion then reverse lookup). No retries or persistence. */
export function createDeviceCityGeocoder(
  config: { region: 'global' | 'cn'; apiKey: string },
  transport: typeof fetch = fetch,
) {
  const settings = z
    .strictObject({
      region: z.enum(['global', 'cn']),
      apiKey: z.string().trim().min(1),
    })
    .parse(config);
  return async (
    raw: z.input<typeof DeviceCityInput>,
    signal: AbortSignal,
  ): Promise<City | null> => {
    const input = DeviceCityInput.parse(raw);
    const combined = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    try {
      combined.throwIfAborted();
      if (settings.region === 'global') {
        const url = new URL(
          'https://maps.googleapis.com/maps/api/geocode/json',
        );
        url.searchParams.set('key', settings.apiKey);
        url.searchParams.set('latlng', `${input.latitude},${input.longitude}`);
        url.searchParams.set(
          'language',
          { 'en-US': 'en', 'zh-CN': 'zh-CN', 'zh-HK': 'zh-TW' }[input.locale],
        );
        return decodeDeviceCity(
          'google',
          await readJson(url, combined, transport),
        );
      }
      const convert = new URL(
        'https://restapi.amap.com/v3/assistant/coordinate/convert',
      );
      convert.searchParams.set('key', settings.apiKey);
      convert.searchParams.set('coordsys', 'gps');
      convert.searchParams.set(
        'locations',
        `${input.longitude.toFixed(6)},${input.latitude.toFixed(6)}`,
      );
      const converted = z
        .object({
          status: z.literal('1'),
          locations: z.string().regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/),
        })
        .parse(await readJson(convert, combined, transport));
      const [longitude, latitude] = converted.locations.split(',').map(Number);
      DeviceCityInput.parse({ latitude, longitude, locale: input.locale });
      const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
      url.searchParams.set('key', settings.apiKey);
      url.searchParams.set('location', converted.locations);
      url.searchParams.set('extensions', 'base');
      return decodeDeviceCity('amap', await readJson(url, combined, transport));
    } catch {
      // Transport errors and provider bodies can contain credentials/coordinates.
      throw new Error(
        combined.aborted
          ? 'City lookup cancelled or timed out.'
          : 'City lookup failed. Please enter your city manually or try again.',
      );
    }
  };
}
