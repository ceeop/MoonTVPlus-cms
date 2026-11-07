import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import CatalogAdmin from './CatalogAdmin';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test('refreshes taxonomy from the management page without replacing an unsaved collection interval', async () => {
  jest.useFakeTimers();
  let name = '电影';
  global.fetch = jest.fn().mockImplementation(async (_url, options) =>
    options?.method === 'POST'
      ? new Promise(() => undefined)
      : {
          ok: true,
          json: async () => ({
            settings: {
              Enabled: true,
              SourceKeys: ['a'],
              IntervalMinutes: 30,
              Kinds: ['movie'],
              Categories: [
                {
                  id: 'movie',
                  name,
                  kind: 'movie',
                  parentId: '',
                  enabled: true,
                },
              ],
              CategoryBindings: [
                { sourceKey: 'a', typeId: '1', categoryId: 'movie' },
              ],
            },
            sources: [{ key: 'a', name: '测试源' }],
            states: [],
            cleanup: null,
          }),
        }
  );
  const { unmount } = render(<CatalogAdmin />);
  try {
    await screen.findByRole('checkbox', { name: '电影' });
    fireEvent.change(
      screen.getByRole('spinbutton', { name: '增量更新间隔（分钟）' }),
      {
        target: { value: '60' },
      }
    );
    name = '电影馆';
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    await screen.findByRole('checkbox', { name: '电影馆' });
    expect(
      screen.getByRole('spinbutton', { name: '增量更新间隔（分钟）' })
    ).toHaveValue(60);
    expect(screen.getByRole('button', { name: '立即同步' })).toBeDisabled();
  } finally {
    unmount();
    jest.useRealTimers();
  }
});

test('automatically saves changed collection types before syncing and shows manual cleanup results', async () => {
  let settings = {
    Enabled: true,
    SourceKeys: ['a'],
    IntervalMinutes: 30,
    Kinds: ['movie', 'tv', 'anime', 'variety', 'other'],
  };
  const fetchMock = jest.fn().mockImplementation(async (_url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (body?.action === 'save') settings = body.settings;
    return {
      ok: true,
      json: async () =>
        body?.action === 'cleanup'
          ? { message: '已清理 2 条过期资源、1 部作品和 1 张海报' }
          : {
              settings,
              sources: [{ key: 'a', name: '测试源' }],
              states: [],
              cleanup: null,
            },
    };
  });
  global.fetch = fetchMock;
  render(<CatalogAdmin />);
  const sync = await screen.findByRole('button', { name: '立即同步' });
  await waitFor(() => expect(sync).toBeEnabled());
  fireEvent.click(screen.getByLabelText('电影'));
  expect(sync).toBeDisabled();
  expect(screen.queryByRole('button', { name: '保存设置' })).toBeNull();
  await waitFor(() => expect(sync).toBeEnabled());
  const saved = fetchMock.mock.calls.find(
    ([, options]) =>
      options?.method === 'POST' && JSON.parse(options.body).action === 'save'
  );
  expect(JSON.parse(saved?.[1].body).settings.Kinds).toEqual([
    'tv',
    'anime',
    'variety',
    'other',
  ]);
  fireEvent.click(screen.getByRole('button', { name: '立即清理' }));
  expect(
    await screen.findByText('已清理 2 条过期资源、1 部作品和 1 张海报')
  ).toBeInTheDocument();
});

test('cleanup defaults to enabled for six months and automatically saves both controls', async () => {
  let settings = {
    Enabled: false,
    SourceKeys: ['a'],
    IntervalMinutes: 30,
    Kinds: ['movie'],
  };
  const writes: Array<Record<string, unknown>> = [];
  global.fetch = jest.fn().mockImplementation(async (_url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (body?.action === 'save') {
      settings = body.settings;
      writes.push(body.settings);
    }
    return {
      ok: true,
      json: async () => ({
        settings,
        sources: [{ key: 'a', name: '测试源' }],
        states: [],
        cleanup: null,
      }),
    };
  });
  const view = render(<CatalogAdmin />);
  const toggle = await screen.findByRole('switch', { name: '定时清理' });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('spinbutton', { name: /保留时长/ })).toHaveValue(6);
  fireEvent.change(screen.getByRole('spinbutton', { name: /保留时长/ }), {
    target: { value: '12' },
  });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].RetentionMonths).toBe(12);
  fireEvent.click(toggle);
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(
    expect.objectContaining({ CleanupEnabled: false, RetentionMonths: 12 })
  );
  view.unmount();
  render(<CatalogAdmin />);
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: '定时清理' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  );
  expect(screen.getByRole('spinbutton', { name: /保留时长/ })).toHaveValue(12);
  fireEvent.change(screen.getByRole('spinbutton', { name: /保留时长/ }), {
    target: { value: '0' },
  });
  expect(screen.getByRole('spinbutton', { name: /保留时长/ })).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  expect(screen.getByRole('button', { name: '立即清理' })).toBeDisabled();
  expect(screen.getByText('请输入 1–120 的整数月数。')).toBeInTheDocument();
});

test('automatically saves an explicit default source and chooses a remaining source when it is unchecked', async () => {
  let settings = {
    Enabled: true,
    SourceKeys: ['a', 'b'],
    DefaultSourceKey: 'a',
    IntervalMinutes: 30,
    Kinds: ['movie'],
  };
  const requests: (typeof settings)[] = [];
  global.fetch = jest.fn().mockImplementation(async (_url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (body) {
      settings = body.settings;
      requests.push(settings);
    }
    return {
      ok: true,
      json: async () => ({
        settings,
        sources: [
          { key: 'a', name: '源 A' },
          { key: 'b', name: '源 B' },
          { key: 'c', name: '源 C' },
        ],
        states: [],
        cleanup: null,
      }),
    };
  });
  render(<CatalogAdmin />);
  const select = await screen.findByRole('combobox', { name: '默认源' });
  await waitFor(() => expect(select).toHaveValue('a'));
  expect(screen.queryByRole('option', { name: '源 C' })).toBeNull();
  fireEvent.change(select, { target: { value: 'b' } });
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].DefaultSourceKey).toBe('b');
  fireEvent.click(screen.getByRole('checkbox', { name: '源 B' }));
  expect(select).toHaveValue('a');
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].DefaultSourceKey).toBe('a');
  expect(requests[1].SourceKeys).toEqual(['a']);
});
