import { z } from 'zod';
import { ContentGpsPointSchema } from '@repo/shared/content-gps';

const Request = z
  .object({
    label: z.string().trim().min(1).max(300),
    locale: z.enum(['en-US', 'zh-CN', 'zh-HK']),
    cityOnly: z.boolean(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .strict();
const Coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const GoogleResult = z.object({
  formatted_address: z.string().min(1).max(1000),
  place_id: z.string().min(1).max(200),
  types: z.array(z.string()),
  partial_match: z.boolean().optional(),
  address_components: z
    .array(z.object({ short_name: z.string(), types: z.array(z.string()) }))
    .optional(),
  geometry: z.object({ location: Coordinate, location_type: z.string() }),
});
const AmapResult = z.object({
  formatted_address: z.string().min(1).max(1000),
  location: z.string().regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/),
  level: z.string(),
  country: z.union([z.string(), z.array(z.never()).max(0)]).optional(),
  adcode: z.union([z.string(), z.array(z.never()).max(0)]).optional(),
});
type Point = z.infer<typeof ContentGpsPointSchema>;
export type GeocodeCandidate = {
  label: string;
  point: Point;
  partial: boolean;
};
export type GeocodeResult = {
  status: 'unresolved' | 'ambiguous' | 'resolved';
  candidates: GeocodeCandidate[];
};
function googlePrecision(types: string[]): Point['precision'] | null {
  if (types.includes('locality') || types.includes('postal_town'))
    return 'city';
  if (types.includes('country')) return 'country';
  if (types.some((type) => type.startsWith('administrative_area_level_')))
    return 'region';
  if (
    types.some((type) =>
      [
        'street_address',
        'premise',
        'subpremise',
        'establishment',
        'point_of_interest',
        'route',
      ].includes(type),
    )
  )
    return 'place';
  return null;
}
function amapPrecision(level: string): Point['precision'] | null {
  if (level === '国家') return 'country';
  if (level === '市') return 'city';
  if (['省', '区县', '开发区', '乡镇', '村庄'].includes(level)) return 'region';
  if (
    [
      '热点商圈',
      '道路',
      '道路交叉路口',
      '兴趣点',
      '门牌号',
      '单元号',
      '公交地铁站点',
      '门址',
      '住宅区',
    ].includes(level)
  )
    return 'place';
  return null;
}

/** Decode provider data without pretending a partial or multi-candidate match
 * establishes the intended story/creator location. No persistent caching here. */
export function decodeGeocodes(
  provider: 'google' | 'amap',
  raw: unknown,
  cityOnly: boolean,
  countryCode?: string,
): GeocodeResult {
  let candidates: GeocodeCandidate[];
  let uncertain = false;
  if (provider === 'google') {
    const body = z
      .object({
        status: z.string(),
        results: z.array(GoogleResult).max(100).optional(),
      })
      .parse(raw);
    if (body.status === 'ZERO_RESULTS')
      return { status: 'unresolved', candidates: [] };
    if (body.status !== 'OK')
      throw new Error(`Google geocoding failed (${safeCode(body.status)}).`);
    if (!body.results?.length)
      throw new Error('Invalid Google geocoding response.');
    candidates = body.results.flatMap((result) => {
      const precision = googlePrecision(result.types);
      if (
        countryCode &&
        !result.address_components?.some(
          (component) =>
            component.types.includes('country') &&
            component.short_name === countryCode,
        )
      ) {
        uncertain = true;
        return [];
      }
      if (!precision || (cityOnly && precision !== 'city')) {
        uncertain = true;
        return [];
      }
      return [
        {
          label: result.formatted_address,
          partial: result.partial_match === true,
          point: ContentGpsPointSchema.parse({
            latitude: result.geometry.location.lat,
            longitude: result.geometry.location.lng,
            coordinateSystem: 'WGS84',
            precision,
            provider: 'google',
            providerPlaceId: result.place_id,
          }),
        },
      ];
    });
  } else {
    const body = z
      .object({
        status: z.string(),
        infocode: z.string().optional(),
        count: z.string().optional(),
        geocodes: z.array(AmapResult).max(100).optional(),
      })
      .parse(raw);
    if (body.status !== '1')
      throw new Error(
        `Gaode geocoding failed (${safeCode(body.infocode ?? 'UNKNOWN')}).`,
      );
    if (
      !body.geocodes ||
      body.count === undefined ||
      !/^\d+$/.test(body.count) ||
      Number(body.count) !== body.geocodes.length
    )
      throw new Error('Invalid Gaode geocoding response.');
    candidates = body.geocodes.flatMap((result) => {
      const precision = amapPrecision(result.level);
      if (countryCode) {
        // This adapter uses Gaode v3's country text plus administrative codes.
        // Unrecognized country evidence stays unpinned instead of guessing.
        const code = typeof result.adcode === 'string' ? result.adcode : '';
        const actual =
          result.country === '中国' && /^\d{6}$/.test(code)
            ? code.startsWith('81')
              ? 'HK'
              : code.startsWith('82')
                ? 'MO'
                : code.startsWith('71')
                  ? 'TW'
                  : 'CN'
            : null;
        if (actual !== countryCode) {
          uncertain = true;
          return [];
        }
      }
      if (!precision || (cityOnly && precision !== 'city')) {
        uncertain = true;
        return [];
      }
      const [longitude, latitude] = result.location.split(',').map(Number);
      // adcode is an administrative code, not a unique POI identifier.
      return [
        {
          label: result.formatted_address,
          partial: false,
          point: ContentGpsPointSchema.parse({
            latitude,
            longitude,
            coordinateSystem: 'GCJ02',
            precision,
            provider: 'amap',
            providerPlaceId: null,
          }),
        },
      ];
    });
  }
  return {
    candidates,
    status: !candidates.length
      ? 'unresolved'
      : candidates.length === 1 && !uncertain && !candidates[0].partial
        ? 'resolved'
        : 'ambiguous',
  };
}
function safeCode(value: string) {
  return /^[A-Z_0-9]{1,64}$/.test(value) ? value : 'UNKNOWN';
}

function abortable<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error('Geocoding cancelled or timed out.'));
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

/** Explicit invocation only. Configuring this adapter does not start backfill,
 * select a candidate, save provider coordinates, or authorize paid requests. */
export function createContentGpsGeocoder(
  config: { region: 'global' | 'cn'; apiKey: string },
  transport: typeof fetch = fetch,
) {
  const settings = z
    .object({
      region: z.enum(['global', 'cn']),
      apiKey: z.string().trim().min(1),
    })
    .strict()
    .parse(config);
  const provider = settings.region === 'cn' ? 'amap' : 'google';
  return async (
    raw: z.input<typeof Request>,
    signal: AbortSignal,
  ): Promise<GeocodeResult> => {
    const input = Request.parse(raw);
    signal.throwIfAborted();
    const url = new URL(
      provider === 'google'
        ? 'https://maps.googleapis.com/maps/api/geocode/json'
        : 'https://restapi.amap.com/v3/geocode/geo',
    );
    url.searchParams.set('key', settings.apiKey);
    url.searchParams.set('address', input.label);
    if (provider === 'google')
      url.searchParams.set(
        'language',
        { 'en-US': 'en', 'zh-CN': 'zh-CN', 'zh-HK': 'zh-TW' }[input.locale],
      );
    else url.searchParams.set('output', 'JSON');
    if (input.countryCode && provider === 'google')
      url.searchParams.set('components', `country:${input.countryCode}`);
    const combined = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    // No retries: an uncertain network outcome must not silently spend quota again.
    try {
      const response = await abortable(
        () =>
          transport(url, {
            signal: combined,
            redirect: 'error',
            headers: { accept: 'application/json' },
          }),
        combined,
      );
      combined.throwIfAborted();
      if (!response.ok) throw new Error(`Geocoding HTTP ${response.status}.`);
      if (!response.body) throw new Error('Empty geocoding response.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const next = await abortable(() => reader.read(), combined);
          combined.throwIfAborted();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 1_000_000)
            throw new Error('Geocoding response exceeds limit.');
          chunks.push(next.value);
        }
      } finally {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      combined.throwIfAborted();
      return decodeGeocodes(
        provider,
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
        input.cityOnly,
        input.countryCode,
      );
    } catch (error) {
      if (combined.aborted)
        throw new Error('Geocoding cancelled or timed out.');
      // Provider URLs contain the key; never propagate transport errors or raw bodies.
      if (
        error instanceof Error &&
        /^(?:Geocoding HTTP \d{3}\.|(?:Google|Gaode) geocoding failed \([A-Z_0-9]+\)\.|Geocoding response exceeds limit\.)$/.test(
          error.message,
        )
      )
        throw error;
      throw new Error('Geocoding request failed or returned invalid data.');
    }
  };
}
