import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { CatalogSettings } from '@/lib/catalog/model';

import CatalogTaxonomyAdmin from './CatalogTaxonomyAdmin';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test('automatically saves category edits with conflict protection and preserves the selected page', async () => {
  let settings: CatalogSettings = {
    Enabled: true,
    SourceKeys: ['a'],
    IntervalMinutes: 30,
    Kinds: ['movie'],
    Categories: [
      { id: 'movie', name: '电影', kind: 'movie', parentId: '', enabled: true },
    ],
    CategoryBindings: [{ sourceKey: 'a', typeId: '1', categoryId: 'movie' }],
    SourceCategories: [
      { sourceKey: 'a', categories: [{ id: '1', name: '电影', parentId: '' }] },
    ],
  };
  const fetchMock = jest.fn().mockImplementation(async (_url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (body?.action === 'save-taxonomy') settings = body.settings;
    return {
      ok: true,
      json: async () => ({
        settings,
        sources: [{ key: 'a', name: '测试源' }],
        taxonomyRevision: body ? 'next-revision' : 'initial-revision',
      }),
    };
  });
  global.fetch = fetchMock;
  render(<CatalogTaxonomyAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑分类 电影' }));
  fireEvent.change(screen.getByLabelText('名称'), {
    target: { value: '电影馆' },
  });
  expect(screen.queryByRole('button', { name: '保存更改' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  fireEvent.click(screen.getByRole('tab', { name: '源分类绑定' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('所有更改已自动保存')
  );
  const request = JSON.parse(
    fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')?.[1]
      .body
  );
  expect(request.action).toBe('save-taxonomy');
  expect(request.expectedRevision).toBe('initial-revision');
  expect(request.settings.Categories[0].name).toBe('电影馆');
  expect(screen.getByRole('tab', { name: '源分类绑定' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});

test('keeps edits made during a save and serializes subsequent requests with the new revision', async () => {
  const settings: CatalogSettings = {
    Enabled: true,
    SourceKeys: ['a'],
    IntervalMinutes: 30,
    Kinds: ['movie'],
    Categories: [
      { id: 'movie', name: '电影', kind: 'movie', parentId: '', enabled: true },
    ],
  };
  let finish: (response: unknown) => void = () => undefined;
  const requests: Array<{
    settings: CatalogSettings;
    expectedRevision: string;
  }> = [];
  global.fetch = jest.fn().mockImplementation(async (_url, options) => {
    if (!options?.body)
      return {
        ok: true,
        json: async () => ({
          settings,
          sources: [],
          taxonomyRevision: 'initial',
        }),
      };
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return {
      ok: true,
      json: async () => ({
        settings: body.settings,
        taxonomyRevision: 'second',
      }),
    };
  });
  render(<CatalogTaxonomyAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑分类 电影' }));
  fireEvent.change(screen.getByLabelText('名称'), {
    target: { value: '电影馆' },
  });
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '编辑分类 电影馆' }));
  fireEvent.change(screen.getByLabelText('名称'), {
    target: { value: '新电影馆' },
  });
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  await act(async () =>
    finish({
      ok: true,
      json: async () => ({
        settings: requests[0].settings,
        taxonomyRevision: 'first',
      }),
    })
  );
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].expectedRevision).toBe('first');
  expect(requests[1].settings.Categories?.[0].name).toBe('新电影馆');
  expect(
    screen.getByRole('button', { name: '编辑分类 新电影馆' })
  ).toBeInTheDocument();
});

test('retains failed changes and permits retrying the automatic save', async () => {
  const settings: CatalogSettings = {
    Enabled: false,
    SourceKeys: [],
    IntervalMinutes: 30,
    Kinds: ['movie'],
    Categories: [
      { id: 'movie', name: '电影', kind: 'movie', parentId: '', enabled: true },
    ],
  };
  let fail = true;
  global.fetch = jest.fn().mockImplementation(async (_url, options) => {
    if (!options?.body)
      return {
        ok: true,
        json: async () => ({
          settings,
          sources: [],
          taxonomyRevision: 'initial',
        }),
      };
    const body = JSON.parse(options.body);
    return {
      ok: !fail,
      json: async () =>
        fail
          ? { error: '网络暂不可用' }
          : { settings: body.settings, taxonomyRevision: 'next' },
    };
  });
  render(<CatalogTaxonomyAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑分类 电影' }));
  fireEvent.change(screen.getByLabelText('名称'), {
    target: { value: '电影馆' },
  });
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('网络暂不可用');
  expect(
    screen.getByRole('button', { name: '编辑分类 电影馆' })
  ).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('所有更改已自动保存')
  );
});

test('an account without administrator access cannot load classification controls', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: '权限不足' }),
  });
  render(<CatalogTaxonomyAdmin />);
  expect(await screen.findByRole('alert')).toHaveTextContent('权限不足');
  expect(screen.queryByRole('button', { name: '保存更改' })).toBeNull();
});

test('leaving the page flushes a committed edit without waiting for the debounce', async () => {
  const settings: CatalogSettings = {
    Enabled: false,
    SourceKeys: [],
    IntervalMinutes: 30,
    Kinds: ['movie'],
    Categories: [
      { id: 'movie', name: '电影', kind: 'movie', parentId: '', enabled: true },
    ],
  };
  const fetchMock = jest.fn().mockImplementation(async (_url, options) => ({
    ok: true,
    json: async () => ({
      settings: options?.body ? JSON.parse(options.body).settings : settings,
      sources: [],
      taxonomyRevision: 'revision',
    }),
  }));
  global.fetch = fetchMock;
  const { unmount } = render(<CatalogTaxonomyAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑分类 电影' }));
  fireEvent.change(screen.getByLabelText('名称'), {
    target: { value: '电影馆' },
  });
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  unmount();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(fetchMock.mock.calls[1][1].body).settings.Categories[0].name
  ).toBe('电影馆');
  expect(fetchMock.mock.calls[1][1].keepalive).toBe(true);
});
