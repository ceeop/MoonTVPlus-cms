import { loadCatalogNavigation } from './navigation.client';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test('desktop and mobile share one navigation request without cancelling each other', async () => {
  let complete!: (value: unknown) => void;
  const response = new Promise((resolve) => {
    complete = resolve;
  });
  const fetchMock = jest.fn().mockReturnValue(response);
  global.fetch = fetchMock;
  const desktop = new AbortController();
  const mobile = new AbortController();
  const first = loadCatalogNavigation(desktop.signal);
  const second = loadCatalogNavigation(mobile.signal);
  desktop.abort();
  complete({
    ok: true,
    json: async () => ({
      categoryMode: true,
      categories: [
        { id: 'movie', name: '电影', parentId: '', kind: 'movie' },
        { id: 'action', name: '动作片', parentId: 'movie', kind: 'movie' },
      ],
    }),
  });
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await expect(second).resolves.toEqual([
    {
      id: 'movie',
      name: '电影',
      parentId: '',
      kind: 'movie',
      href: '/catalog?category=movie',
    },
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/catalog?view=navigation');
});

test('a failed request can retry and later navigation reloads current settings', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true, json: async () => ({ categories: [] }) });
  await expect(
    loadCatalogNavigation(new AbortController().signal)
  ).rejects.toThrow('分类导航加载失败');
  await expect(
    loadCatalogNavigation(new AbortController().signal)
  ).resolves.toEqual([]);
  await expect(
    loadCatalogNavigation(new AbortController().signal)
  ).resolves.toEqual([]);
  expect(global.fetch).toHaveBeenCalledTimes(3);
});
