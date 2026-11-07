import {
  createAdFilteringHlsLoader,
  loadCustomAdFilterCode,
} from './hls-ad-filter.client';

beforeEach(() => {
  localStorage.clear();
  (window as any).RUNTIME_CONFIG = { CUSTOM_AD_FILTER_VERSION: 2 };
  global.fetch = jest.fn();
});
afterEach(() => jest.restoreAllMocks());

test('clearing custom rules replaces cached code with the built-in selection', async () => {
  localStorage.setItem('custom_ad_filter_code_cache', 'old custom code');
  localStorage.setItem('custom_ad_filter_version_cache', '1');
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ code: '', version: 2 }),
  });
  expect(await loadCustomAdFilterCode()).toBe('');
  expect(localStorage.getItem('custom_ad_filter_code_cache')).toBe('');
  expect(await loadCustomAdFilterCode()).toBe('');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('concurrent players share the rules request and cache the server version', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ code: 'current code', version: 3 }),
  });
  expect(
    await Promise.all([loadCustomAdFilterCode(), loadCustomAdFilterCode()])
  ).toEqual(['current code', 'current code']);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('custom_ad_filter_version_cache')).toBe('3');
});

test('blocked storage does not stop a fresh rules request', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ code: 'current code', version: 2 }),
  });
  expect(await loadCustomAdFilterCode()).toBe('current code');
});

test.each(['manifest', 'level', 'audioTrack', 'subtitleTrack'])(
  'filters %s playlist responses with the correct source',
  (type) => {
    const input = '#EXTM3U\n#EXTINF:6,\nmain.ts\n#EXTINF:6,\nads/0.ts';
    const onSuccess = jest.fn();
    class Loader {
      load(context: unknown, _config: unknown, callbacks: any) {
        callbacks.onSuccess({ data: input }, {}, context, {});
      }
    }
    const custom =
      'function filterAdsFromM3U8(type, content) { return type === "cms-key" ? content.replace("ads/0.ts", "filtered.ts") : content; }';
    const CustomLoader = createAdFilteringHlsLoader(
      { DefaultConfig: { loader: Loader } },
      () => 'cms-key',
      () => custom
    );
    new CustomLoader({}).load({ type }, {}, { onSuccess });
    expect(onSuccess.mock.calls[0][0].data).toContain('filtered.ts');
  }
);

test('server-processed playlists do not execute custom rules twice', () => {
  const content = '#EXTM3U\n#EXTINF:6,\nmain.ts';
  const onSuccess = jest.fn();
  const getCode = jest.fn(
    () => 'function filterAdsFromM3U8() { return "incorrect second pass"; }'
  );
  class Loader {
    load(context: unknown, _config: unknown, callbacks: any) {
      callbacks.onSuccess({ data: content }, {}, context, {});
    }
  }
  const CustomLoader = createAdFilteringHlsLoader(
    { DefaultConfig: { loader: Loader } },
    () => 'any-source',
    getCode
  );
  new CustomLoader({}).load(
    { type: 'level', url: '/api/proxy-m3u8?url=encoded' },
    {},
    { onSuccess }
  );
  expect(onSuccess.mock.calls[0][0].data).toBe(content);
  expect(getCode).not.toHaveBeenCalled();
});
