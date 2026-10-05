import {
  createDeviceCityGeocoder,
  decodeDeviceCity,
} from './device-city-geocoder';
const input = { latitude: 31.2, longitude: 121.4, locale: 'en-US' as const };
const signal = () => new AbortController().signal;
const google = (city = 'Singapore') => ({
  address_components: [
    { long_name: city, short_name: city, types: ['locality'] },
    { long_name: 'Singapore', short_name: 'SG', types: ['country'] },
    { long_name: 'Private street', short_name: 'Street', types: ['route'] },
  ],
});
const amap = (city: unknown = '南京市', province = '江苏省') => ({
  status: '1',
  regeocode: {
    addressComponent: { country: '中国', province, city, adcode: '320100' },
  },
});
const response = (body: unknown) => new Response(JSON.stringify(body));
const transport = () =>
  jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
function requestUrl(value: Parameters<typeof fetch>[0]) {
  if (!(value instanceof URL)) throw new Error('Expected a provider URL');
  return value;
}
describe('device city suggestion adapter', () => {
  it('returns only city and country, deduplicating equivalent results', () => {
    expect(
      decodeDeviceCity('google', {
        status: 'OK',
        results: [google(), google()],
      }),
    ).toEqual({ countryCode: 'SG', city: 'Singapore' });
  });
  it('does not pick between cities or mistake missing city evidence for a location', () => {
    expect(
      decodeDeviceCity('google', {
        status: 'OK',
        results: [google('A'), google('B')],
      }),
    ).toBeNull();
    expect(decodeDeviceCity('google', { status: 'ZERO_RESULTS' })).toBeNull();
    expect(
      decodeDeviceCity('google', {
        status: 'OK',
        results: [{ ...google(), partial_match: true }],
      }),
    ).toBeNull();
    expect(
      decodeDeviceCity('google', {
        status: 'OK',
        results: [{ address_components: google().address_components.slice(1) }],
      }),
    ).toBeNull();
  });
  it('supports Gaode municipalities without inventing city names from provinces', () => {
    expect(decodeDeviceCity('amap', amap([], '上海市'))).toEqual({
      countryCode: 'CN',
      city: '上海市',
    });
    expect(decodeDeviceCity('amap', amap([], '江苏省'))).toBeNull();
    expect(decodeDeviceCity('amap', amap())).toEqual({
      countryCode: 'CN',
      city: '南京市',
    });
  });
  it('sends a single global lookup and strips precise data from its result', async () => {
    const fetcher = transport().mockResolvedValue(
      response({ status: 'OK', results: [google()] }),
    );
    const result = await createDeviceCityGeocoder(
      { region: 'global', apiKey: 'fixture' },
      fetcher,
    )(input, signal());
    expect(result).toEqual({ countryCode: 'SG', city: 'Singapore' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      requestUrl(fetcher.mock.calls[0][0]).searchParams.get('latlng'),
    ).toBe('31.2,121.4');
  });
  it('converts WGS84 before CN reverse lookup and uses the converted coordinates', async () => {
    const fetcher = transport()
      .mockResolvedValueOnce(
        response({ status: '1', locations: '121.41,31.21' }),
      )
      .mockResolvedValueOnce(response(amap()));
    await createDeviceCityGeocoder(
      { region: 'cn', apiKey: 'fixture' },
      fetcher,
    )(input, signal());
    const first = requestUrl(fetcher.mock.calls[0][0]);
    const second = requestUrl(fetcher.mock.calls[1][0]);
    expect(first.searchParams.get('coordsys')).toBe('gps');
    expect(first.searchParams.get('locations')).toBe('121.400000,31.200000');
    expect(second.searchParams.get('location')).toBe('121.41,31.21');
    expect(second.pathname).toBe('/v3/geocode/regeo');
  });
  it('stops on malformed conversion without using raw coordinates as a fallback', async () => {
    const fetcher = transport().mockResolvedValue(
      response({ status: '1', locations: '999,999' }),
    );
    await expect(
      createDeviceCityGeocoder({ region: 'cn', apiKey: 'fixture' }, fetcher)(
        input,
        signal(),
      ),
    ).rejects.toThrow('City lookup failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('redacts transport errors containing secret coordinates or keys and never retries', async () => {
    const fetcher = transport().mockRejectedValue(
      new Error('url?key=SECRET&latlng=PRIVATE'),
    );
    await expect(
      createDeviceCityGeocoder({ region: 'global', apiKey: 'SECRET' }, fetcher)(
        input,
        signal(),
      ),
    ).rejects.toThrow(
      'City lookup failed. Please enter your city manually or try again.',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized responses', async () => {
    const fetcher = transport().mockResolvedValue(
      new Response(' '.repeat(1_000_001)),
    );
    await expect(
      createDeviceCityGeocoder(
        { region: 'global', apiKey: 'fixture' },
        fetcher,
      )(input, signal()),
    ).rejects.toThrow('City lookup failed');
  });
  it('aborts a stalled provider even when transport ignores the signal', async () => {
    const fetcher = transport().mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = createDeviceCityGeocoder(
      { region: 'global', apiKey: 'fixture' },
      fetcher,
    )(input, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled or timed out');
  });
  it('rejects invalid coordinates before provider dispatch', async () => {
    const fetcher = transport();
    await expect(
      createDeviceCityGeocoder(
        { region: 'global', apiKey: 'fixture' },
        fetcher,
      )({ ...input, latitude: 91 }, signal()),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
