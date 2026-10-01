import {
  createContentGpsGeocoder,
  decodeGeocodes,
} from './content-gps-geocoder';
const google = {
  formatted_address: 'Singapore',
  place_id: 'city-id',
  types: ['locality', 'political'],
  geometry: {
    location: { lat: 1.35, lng: 103.82 },
    location_type: 'APPROXIMATE',
  },
};
const amap = {
  formatted_address: '宁波市',
  location: '121.55,29.87',
  level: '市',
  adcode: '330200',
};
const input = { label: 'Singapore', locale: 'en-US' as const, cityOnly: true };
const signal = () => new AbortController().signal;
function mock(body: unknown, status = 200) {
  return jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
describe('regional GPS geocoding', () => {
  it('retains Google WGS84 city precision and place identity', () => {
    expect(
      decodeGeocodes('google', { status: 'OK', results: [google] }, true),
    ).toMatchObject({
      status: 'resolved',
      candidates: [
        {
          point: {
            latitude: 1.35,
            longitude: 103.82,
            coordinateSystem: 'WGS84',
            precision: 'city',
            providerPlaceId: 'city-id',
          },
        },
      ],
    });
  });
  it('retains Gaode longitude/latitude order and never treats adcode as a POI id', () => {
    expect(
      decodeGeocodes(
        'amap',
        { status: '1', count: '1', geocodes: [amap] },
        true,
      ),
    ).toMatchObject({
      status: 'resolved',
      candidates: [
        {
          point: {
            latitude: 29.87,
            longitude: 121.55,
            coordinateSystem: 'GCJ02',
            precision: 'city',
            providerPlaceId: null,
          },
        },
      ],
    });
  });
  it('does not choose a partial match or the first of multiple candidates', () => {
    for (const results of [
      [{ ...google, partial_match: true }],
      [google, { ...google, place_id: 'another' }],
    ])
      expect(
        decodeGeocodes('google', { status: 'OK', results }, false).status,
      ).toBe('ambiguous');
  });
  it('keeps ambiguity when a candidate has unsupported precision', () => {
    expect(
      decodeGeocodes(
        'google',
        { status: 'OK', results: [google, { ...google, types: ['unknown'] }] },
        false,
      ).status,
    ).toBe('ambiguous');
  });
  it('does not publish a street point as a creator city centroid', () => {
    expect(
      decodeGeocodes(
        'google',
        { status: 'OK', results: [{ ...google, types: ['street_address'] }] },
        true,
      ),
    ).toEqual({ status: 'unresolved', candidates: [] });
    expect(
      decodeGeocodes(
        'amap',
        { status: '1', count: '1', geocodes: [{ ...amap, level: '门牌号' }] },
        true,
      ),
    ).toEqual({ status: 'unresolved', candidates: [] });
  });
  it('treats zero results as unresolved', () => {
    expect(
      decodeGeocodes('google', { status: 'ZERO_RESULTS', results: [] }, false)
        .status,
    ).toBe('unresolved');
    expect(
      decodeGeocodes('amap', { status: '1', count: '0', geocodes: [] }, false)
        .status,
    ).toBe('unresolved');
  });
  it.each([
    ['google', { status: 'REQUEST_DENIED' }],
    ['amap', { status: '0', infocode: '10001' }],
    ['google', { status: 'OK', results: [] }],
    ['amap', { status: '1', count: '2', geocodes: [amap] }],
    [
      'amap',
      { status: '1', count: '1', geocodes: [{ ...amap, location: '190,95' }] },
    ],
  ] as const)(
    'rejects provider errors and invalid data for %s',
    (provider, body) => {
      expect(() => decodeGeocodes(provider, body, false)).toThrow();
    },
  );
  it('uses fixed regional endpoints, encoded addresses and no redirects', async () => {
    const fetcher = mock({ status: 'OK', results: [google] });
    const lookup = createContentGpsGeocoder(
      { region: 'global', apiKey: 'test-key' },
      fetcher,
    );
    await lookup({ ...input, label: 'Singapore & key=not-a-key' }, signal());
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.origin).toBe('https://maps.googleapis.com');
    expect(url.searchParams.get('address')).toBe('Singapore & key=not-a-key');
    expect(url.searchParams.get('key')).toBe('test-key');
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
    const china = mock({ status: '1', count: '1', geocodes: [amap] });
    await createContentGpsGeocoder({ region: 'cn', apiKey: 'test-key' }, china)(
      input,
      signal(),
    );
    expect((china.mock.calls[0][0] as URL).origin).toBe(
      'https://restapi.amap.com',
    );
  });
  it('requires explicit configuration and validates before spending quota', async () => {
    const fetcher = mock({});
    expect(() =>
      createContentGpsGeocoder({ region: 'global', apiKey: ' ' }, fetcher),
    ).toThrow();
    await expect(
      createContentGpsGeocoder({ region: 'global', apiKey: 'key' }, fetcher)(
        { ...input, label: '' },
        signal(),
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels promptly even when transport ignores its abort signal', async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(
      () => new Promise(() => {}),
    );
    const controller = new AbortController();
    const result = createContentGpsGeocoder(
      { region: 'global', apiKey: 'key' },
      fetcher,
    )(input, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toThrow('cancelled');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry or expose keys from transport errors', async () => {
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockRejectedValue(new Error('https://provider?key=secret-key'));
    await expect(
      createContentGpsGeocoder(
        { region: 'global', apiKey: 'secret-key' },
        fetcher,
      )(input, signal()),
    ).rejects.toThrow('Geocoding request failed or returned invalid data.');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds response bytes', async () => {
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(
      createContentGpsGeocoder({ region: 'global', apiKey: 'key' }, fetcher)(
        input,
        signal(),
      ),
    ).rejects.toThrow('exceeds limit');
  });
});

describe('declared creator country validation', () => {
  it('requires matching Google country evidence even with a country filter', () => {
    for (const components of [
      undefined,
      [{ short_name: 'US', types: ['country'] }],
    ]) {
      expect(
        decodeGeocodes(
          'google',
          {
            status: 'OK',
            results: [{ ...google, address_components: components }],
          },
          true,
          'SG',
        ),
      ).toEqual({ status: 'unresolved', candidates: [] });
    }
    expect(
      decodeGeocodes(
        'google',
        {
          status: 'OK',
          results: [
            {
              ...google,
              address_components: [{ short_name: 'SG', types: ['country'] }],
            },
          ],
        },
        true,
        'SG',
      ).status,
    ).toBe('resolved');
  });
  it('requires Gaode country evidence and rejects a mismatched declaration', () => {
    expect(
      decodeGeocodes(
        'amap',
        {
          status: '1',
          count: '1',
          geocodes: [{ ...amap, country: '中国', adcode: [] }],
        },
        true,
        'CN',
      ).status,
    ).toBe('unresolved');
    expect(
      decodeGeocodes(
        'amap',
        { status: '1', count: '1', geocodes: [{ ...amap, country: '中国' }] },
        true,
        'CN',
      ).status,
    ).toBe('resolved');
    for (const country of ['SG', 'HK'])
      expect(
        decodeGeocodes(
          'amap',
          { status: '1', count: '1', geocodes: [{ ...amap, country: '中国' }] },
          true,
          country,
        ).status,
      ).toBe('unresolved');
    expect(
      decodeGeocodes(
        'amap',
        { status: '1', count: '1', geocodes: [{ ...amap, country: [] }] },
        true,
        'CN',
      ).status,
    ).toBe('unresolved');
  });
});
